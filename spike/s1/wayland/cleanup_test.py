import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import time
import unittest

spec = importlib.util.spec_from_file_location("private_cleanup", Path(__file__).with_name("cleanup.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PrivateCleanupTest(unittest.TestCase):
    def test_nul_environment_requires_both_private_addresses(self):
        with tempfile.TemporaryDirectory(prefix="s1-wayland-cleanup-") as root:
            Path(root, "system-bus.conf").write_text("fixture")
            private = {**os.environ, "XDG_RUNTIME_DIR": root + "/run", "DBUS_SESSION_BUS_ADDRESS": "unix:path=" + root + "/run/bus"}
            matching = subprocess.Popen(["sleep", "30"], env=private)
            different = subprocess.Popen(["sleep", "30"], env={**private, "DBUS_SESSION_BUS_ADDRESS": "unix:path=/different-private-bus"})
            try:
                time.sleep(0.02)
                self.assertIn(matching.pid, [item["pid"] for item in module.owned(root)])
                self.assertNotIn(different.pid, [item["pid"] for item in module.owned(root)])
                result = module.cleanup(root)
                self.assertEqual(result["remaining"], [])
                matching.wait(timeout=2)
                self.assertIsNone(different.poll())
            finally:
                for child in (matching, different):
                    if child.poll() is None:
                        child.terminate()
                    child.wait(timeout=2)


if __name__ == "__main__":
    unittest.main()
