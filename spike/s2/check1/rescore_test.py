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

    def check_ex_unknown(self, status="unknown"):
        actual, reasons = rescore.compare({"expect": self.expect}, self.trial)
        self.assertEqual(actual, status)
        self.assertIn("Ex command text not recorded: :", reasons)

    def test_ex_text_snapshot_matches_exact_command(self):
        self.expect["registers"] = {":": {"mode": "character", "lines": ["set scroll=0"]}}
        self.trial["afterRegisters"] = copy.deepcopy(self.expect["registers"])
        self.check("pass")
        self.trial["afterRegisters"][":"]["lines"] = ["set scroll=30"]
        self.check("fail")

    def test_ex_text_preservation_detects_a_different_command(self):
        self.trial["beforeRegisters"][":"] = {"mode": "character", "lines": ["s/e/X/"]}
        self.trial["afterRegisters"] = copy.deepcopy(self.trial["beforeRegisters"])
        self.check("pass")
        self.trial["afterRegisters"][":"]["lines"] = ["set scroll=0"]
        self.check("fail")

    def test_legacy_ex_text_cannot_satisfy_expected_contents(self):
        for snapshots in [True, False]:
            for value in [{"mode": "character", "lines": ["set scroll=0"]}, {"mode": "character", "keys": ""}]:
                with self.subTest(snapshots=snapshots, expected=value):
                    self.setUp()
                    self.expect["registers"] = {":": value}
                    legacy = {"mode": "character", "keys": ""}
                    if snapshots:
                        self.trial["afterRegisters"][":"] = legacy
                    else:
                        del self.trial["beforeRegisters"], self.trial["afterRegisters"]
                        self.trial["got"]["registers"][":"] = legacy
                    self.check_ex_unknown()

    def test_legacy_ex_text_cannot_prove_preservation(self):
        legacy = {"mode": "character", "keys": ""}
        self.trial["beforeRegisters"][":"] = legacy
        for after in [legacy, {"mode": "character", "lines": ["set scroll=0"]}]:
            with self.subTest(after=after):
                self.trial["afterRegisters"][":"] = after
                self.check_ex_unknown()
        del self.trial["beforeRegisters"], self.trial["afterRegisters"]
        self.trial["got"]["registers"][":"] = legacy
        self.trial["want"]["registers"][":"] = legacy
        self.check_ex_unknown()

    def test_fresh_ex_text_can_satisfy_an_explicit_write_after_legacy_baseline(self):
        self.trial["beforeRegisters"][":"] = {"mode": "character", "keys": ""}
        self.expect["registers"] = {":": {"mode": "character", "lines": ["set scroll=0"]}}
        self.trial["afterRegisters"] = copy.deepcopy(self.expect["registers"])
        self.check("pass")

    def test_legacy_ex_text_does_not_mask_independent_failures(self):
        for field, value in [("cursor", [0, 0]), ("text", ["wrong"]), ("mode", "insert"), ("registers", {"a": {"mode": "character", "lines": ["new"]}})]:
            with self.subTest(field=field):
                self.setUp()
                legacy = {"mode": "character", "keys": ""}
                self.trial["beforeRegisters"][":"] = legacy
                self.trial["afterRegisters"][":"] = legacy
                if field == "registers":
                    self.trial["afterRegisters"].update(value)
                else:
                    self.trial["got"][field] = value
                self.check_ex_unknown("fail")

    def test_legacy_ex_known_presence_and_mode_changes_still_fail(self):
        legacy = {"mode": "character", "keys": ""}
        for before, after in [(None, legacy), (legacy, None), (legacy, {"mode": "line", "lines": ["set scroll=0"]})]:
            with self.subTest(before=before, after=after):
                self.setUp()
                if before is not None:
                    self.trial["beforeRegisters"][":"] = before
                if after is not None:
                    self.trial["afterRegisters"][":"] = after
                self.check_ex_unknown("fail")

    def test_legacy_ex_undeclared_change_without_baseline_still_fails(self):
        del self.trial["beforeRegisters"], self.trial["afterRegisters"]
        self.trial["got"]["registers"][":"] = {"mode": "character", "keys": ""}
        self.check_ex_unknown("fail")


if __name__ == "__main__":
    unittest.main()
