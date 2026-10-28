import copy
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("rescore", Path(__file__).with_name("rescore.py"))
rescore = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rescore)


class RescoreTests(unittest.TestCase):
    def setUp(self):
        self.expect = {"text": "unchanged", "cursor": [1, 13], "mode": "normal"}
        self.trial = {"got": {"text": rescore.START, "cursor": [1, 13], "mode": "normal", "registers": {}}, "want": {"registers": {}}, "beforeRegisters": {}, "afterRegisters": {}}

    def check(self, status):
        self.assertEqual(rescore.compare({"expect": self.expect}, self.trial)[0], status)

    def test_exact_snapshot_matches(self):
        self.check("pass")

    def test_newly_written_register_cannot_be_ignored(self):
        self.trial["afterRegisters"]["a"] = {"mode": "character", "lines": ["new"]}
        self.check("fail")

    def test_unchanged_register_need_not_be_expected(self):
        value = {"mode": "character", "lines": ["unchanged"]}
        self.trial["beforeRegisters"]["a"] = value
        self.trial["afterRegisters"]["a"] = value
        self.check("pass")

    def test_new_expectation_can_use_recorded_baseline(self):
        value = {"mode": "character", "lines": ["unchanged"]}
        self.trial["beforeRegisters"]["a"] = value
        self.trial["afterRegisters"]["a"] = value
        self.expect["registers"] = {"a": value}
        self.check("pass")
        del self.trial["beforeRegisters"], self.trial["afterRegisters"]
        self.check("unknown")

    def test_old_expected_value_cannot_prove_it_was_unchanged(self):
        del self.trial["beforeRegisters"], self.trial["afterRegisters"]
        self.trial["got"]["registers"]["a"] = {"mode": "character", "lines": ["x"]}
        self.trial["want"]["registers"]["a"] = {"mode": "character", "lines": ["x"]}
        self.check("unknown")

    def test_wrong_cursor_still_fails_with_unknown_register(self):
        self.expect["registers"] = {"a": {"mode": "character", "lines": ["x"]}}
        del self.trial["beforeRegisters"], self.trial["afterRegisters"]
        self.trial["got"]["cursor"] = [0, 0]
        self.check("fail")

    def test_clipboard_creation_follows_harness_rule(self):
        self.trial["afterRegisters"]["+"] = {"mode": "character", "lines": [""]}
        self.check("pass")
        self.trial["afterRegisters"]["+"]["lines"] = ["text"]
        self.check("fail")

    def test_history_row_requires_rendered_picker(self):
        self.expect["quickPick"] = {"placeholder": "Vim search history", "focused": True}
        self.check("unknown")
        self.trial["got"]["quickPick"] = {"visible": False, **self.expect["quickPick"]}
        self.check("fail")
        self.trial["got"]["quickPick"]["visible"] = True
        self.check("pass")

    def test_numbered_shift_uses_pre_key_snapshot(self):
        self.expect["shiftNumbered"] = True
        self.trial["beforeRegisters"]["1"] = {"mode": "line", "lines": ["old"]}
        self.trial["afterRegisters"]["1"] = self.trial["beforeRegisters"]["1"]
        self.check("fail")
        self.trial["afterRegisters"]["2"] = self.trial["beforeRegisters"]["1"]
        self.check("pass")


if __name__ == "__main__":
    unittest.main()
