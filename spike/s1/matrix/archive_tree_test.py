import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("source_archive", Path(__file__).with_name("archive-tree.py"))
archive = importlib.util.module_from_spec(spec)
spec.loader.exec_module(archive)


class SourceArchiveTest(unittest.TestCase):
    def test_round_trip_preserves_sources_and_rejects_replacement_or_corruption(self):
        with tempfile.TemporaryDirectory(prefix="s1-source-archive-test-") as temporary:
            root = Path(temporary)
            (root / "sources").mkdir()
            source = root / "sources" / "fixture.mjs"
            content = b"export const value = 1;\r\n"
            source.write_bytes(content)
            source.chmod(0o755)
            result = archive.pack(root, ["sources"])
            compressed = root / "source-snapshots.tar.gz"
            self.assertEqual(archive.verify(compressed), result)
            self.assertEqual(source.read_bytes(), content)
            source.unlink()
            archive.restore(compressed)
            self.assertEqual(source.read_bytes(), content)
            self.assertEqual(source.stat().st_mode & 0o777, 0o755)
            source.write_bytes(b"different evidence")
            with self.assertRaisesRegex(ValueError, "existing original differs"):
                archive.restore(compressed)
            self.assertEqual(source.read_bytes(), b"different evidence")
            compressed.write_bytes(compressed.read_bytes()[:-1])
            with self.assertRaisesRegex(ValueError, "compressed bytes changed"):
                archive.verify(compressed)

    def test_unsafe_names_and_symlinks_are_rejected(self):
        for name in ["../outside", "/absolute", "sources/../outside"]:
            with self.assertRaises(ValueError):
                archive.safe_name(name)
        with tempfile.TemporaryDirectory(prefix="s1-source-archive-test-") as temporary:
            root = Path(temporary)
            (root / "sources").mkdir()
            (root / "sources" / "link").symlink_to("missing")
            with self.assertRaisesRegex(ValueError, "symlinks"):
                archive.pack(root, ["sources"])


if __name__ == "__main__":
    unittest.main()
