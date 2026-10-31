"""Store immutable source snapshots in a verified, portable tar.gz archive."""

import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import tarfile
import tempfile


def digest(stream):
    checksum = hashlib.sha256()
    size = 0
    while chunk := stream.read(1024 * 1024):
        size += len(chunk)
        checksum.update(chunk)
    return {"bytes": size, "sha256": checksum.hexdigest()}


def file_digest(path):
    with path.open("rb") as stream:
        return digest(stream)


def safe_name(name):
    parts = PurePosixPath(name)
    if parts.is_absolute() or ".." in parts.parts or str(parts) != name:
        raise ValueError("unsafe archive member: " + name)
    return name


def members_match(archive, files):
    seen = set()
    with tarfile.open(archive, "r:gz") as bundle:
        for member in bundle:
            name = safe_name(member.name)
            if not member.isfile() or name in seen or name not in files:
                raise ValueError("unexpected archive member: " + name)
            seen.add(name)
            with bundle.extractfile(member) as stream:
                if digest(stream) != files[name]["content"]:
                    raise ValueError("decoded bytes changed: " + name)
            if member.mode != files[name]["mode"]:
                raise ValueError("file mode changed: " + name)
    if seen != set(files):
        raise ValueError("archive members missing")


def verify(archive):
    manifest = json.loads(Path(str(archive) + ".sha256.json").read_text())
    if manifest["format"] != "s1-source-tar-v1":
        raise ValueError("unsupported archive format")
    if file_digest(archive) != manifest["compressed"]:
        raise ValueError("compressed bytes changed")
    members_match(archive, manifest["files"])
    return manifest


def pack(root, directories):
    archive = root / "source-snapshots.tar.gz"
    manifest_path = Path(str(archive) + ".sha256.json")
    if archive.exists() or manifest_path.exists():
        raise FileExistsError("refusing to replace an archive")
    files = {}
    for directory in directories:
        directory = root / safe_name(directory)
        if directory.is_symlink() or not directory.is_dir():
            raise ValueError("source directory must be regular")
        for path in sorted(directory.rglob("*")):
            if "__pycache__" in path.parts or path.suffix == ".pyc":
                continue
            if path.is_symlink():
                raise ValueError("source snapshots cannot contain symlinks")
            if not path.is_file():
                continue
            name = safe_name(path.relative_to(root).as_posix())
            if name in files:
                raise ValueError("overlapping source directories")
            files[name] = {"content": file_digest(path), "mode": path.stat().st_mode & 0o777}
    if not files:
        raise ValueError("no source files")
    with archive.open("xb") as output:
        with gzip.GzipFile(filename="", mode="wb", fileobj=output, mtime=0) as compressed:
            with tarfile.open(fileobj=compressed, mode="w") as bundle:
                for name in sorted(files):
                    member = tarfile.TarInfo(name)
                    member.size = files[name]["content"]["bytes"]
                    member.mode = files[name]["mode"]
                    with (root / name).open("rb") as stream:
                        bundle.addfile(member, stream)
    members_match(archive, files)
    manifest = {"format": "s1-source-tar-v1", "compressed": file_digest(archive), "files": files}
    with manifest_path.open("x") as output:
        output.write(json.dumps(manifest, indent=2) + "\n")
    return manifest


def restore(archive):
    manifest = verify(archive)
    root = archive.parent.resolve()
    with tarfile.open(archive, "r:gz") as bundle:
        for member in bundle:
            destination = root / member.name
            destination.resolve().relative_to(root)
            if destination.is_symlink():
                raise ValueError("refusing to restore over a symlink")
            expected = manifest["files"][member.name]
            if destination.exists():
                if file_digest(destination) != expected["content"]:
                    raise ValueError("existing original differs: " + member.name)
                continue
            destination.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(dir=destination.parent, delete=False) as output:
                temporary = Path(output.name)
                try:
                    with bundle.extractfile(member) as stream:
                        while chunk := stream.read(1024 * 1024):
                            output.write(chunk)
                    output.flush()
                    if file_digest(temporary) != expected["content"]:
                        raise ValueError("restored bytes differ")
                    temporary.chmod(expected["mode"])
                    # Linking publishes only a complete file and refuses a competing writer.
                    os.link(temporary, destination)
                finally:
                    temporary.unlink(missing_ok=True)
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["pack", "verify", "restore"])
    parser.add_argument("path", type=Path)
    parser.add_argument("directories", nargs="*")
    args = parser.parse_args()
    result = pack(args.path, args.directories) if args.action == "pack" else globals()[args.action](args.path)
    print(json.dumps({"files": len(result["files"]), "compressed": result["compressed"]}))
