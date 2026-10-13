"""Tests for gh-write-guard.py.

Run with: python3 -m unittest discover -s .claude/hooks -p 'test_*.py'
"""

import importlib.util
import json
import pathlib
import subprocess
import sys
import unittest

HOOK = pathlib.Path(__file__).with_name("gh-write-guard.py")
_spec = importlib.util.spec_from_file_location("gh_write_guard", HOOK)
guard = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(guard)

TOKEN = "GH_TOKEN=$(gh auth token -u 92khsang) "

ASK = [
    # gh api writes: explicit method
    TOKEN + "gh api -X PATCH repos/o/r -f squash_merge_commit_message=BLANK",
    "gh api -XPUT repos/o/r/branches/main/protection --input protection.json",
    "gh api --method=delete repos/o/r/git/refs/tags/v1",
    "gh api --method POST repos/o/r/dispatches",
    "gh api repos/o/r/actions/permissions -X PUT -F sha_pinning_required=true",
    # gh api writes: fields or input imply POST
    "gh api repos/o/r/issues -f title=x",
    "gh api repos/o/r/labels -Fname=uat",
    "gh api repos/o/r/labels --raw-field=name=uat",
    "gh api repos/o/r/rulesets --input ruleset.json",
    # GraphQL mutations, or queries the guard cannot read
    "gh api graphql -f query='mutation { addStar(input: {starrableId: \"x\"}) { clientMutationId } }'",
    "gh api graphql -F query=@mutation.graphql",
    "gh api graphql -f query=\"$Q\"",
    "gh api graphql -f query=\"${Q}\"",
    "gh api graphql -f query=\"$(cat mutation.graphql)\"",
    "gh api graphql -f query=\"$(cat <<'EOF'\nmutation { mergePullRequest(input: {pullRequestId: \"PR_x\"}) { clientMutationId } }\nEOF\n)\"",
    # commands that always need approval
    "gh pr merge 3 --squash",
    TOKEN + "gh pr merge 3 --auto --squash",
    "gh release create v1.0.0-rc.1 --prerelease",
    "gh release upload v1.0.0 a.vsix",
    "gh release delete v1.0.0-rc.1",
    "gh release new v1.0.0-rc.1",
    "gh workflow run ci.yml",
    "gh label create uat",
    "gh repo edit --enable-auto-merge",
    "gh repo deploy-key add key.pub --allow-write",
    "gh repo autolink create JIRA- 'https://example.com/<num>'",
    "gh secret set APP_KEY",
    "gh variable set NAME --body value",
    # tags
    "git tag v1.0.0",
    "git tag -a v1.0.0 -m release",
    "git tag -d v1.0.0",
    "git push --tags",
    "git push --follow-tags origin main",
    "git push origin v1.0.0",
    "git push origin tag v1.0.0",
    "git push origin refs/tags/v1.0.0:refs/tags/v1.0.0",
    "git push origin :refs/tags/v1.0.0",
    "git push --delete origin v1.0.0",
    "git -C /tmp/repo push origin v2.0.0",
    "git tag -i v1.0.0",
    "git -C . tag --sort=-v:refname v1.0.0",
    # git accepts any unambiguous prefix of a long option
    "git push origin --tag",
    "git push origin main --follow",
    "git push --m origin",
    "git push origin \"v$VERSION\"",
    # wrappers, compound commands and substitutions
    "cd /tmp && gh pr merge 1",
    "gh pr view 1; gh pr merge 1",
    "gh pr view 1\ngh pr merge 1",
    "true || gh pr merge 1",
    "echo $(gh pr merge 1)",
    "echo `gh pr merge 1`",
    "bash -c 'gh pr merge 1'",
    "sh -c \"gh api -X POST repos/o/r/dispatches\"",
    "env GH_TOKEN=x gh pr merge 1",
    "time gh pr merge 1",
    "xargs -n1 gh pr merge < prs.txt",
    "/usr/bin/gh pr merge 1",
    "(gh pr merge 1)",
    "if true; then gh pr merge 1; fi",
    "for n in 1 2; do gh pr merge $n; done",
    "echo \"$(gh pr merge 1)\"",
    "zsh -lc 'gh release create v1.0.0'",
    "eval gh pr merge 1",
    "gh pr -R o/r merge 1",
    "git push origin +v1.0.0",
    "noglob gh pr merge 1",
    "timeout 60 git push origin v1.0.0",
    "timeout -k 5 120 gh api -X PUT repos/o/r/pulls/1/merge",
    "bash -o pipefail -c 'gh pr merge 3 --squash | tee merge.log'",
    "bash -euo pipefail -c 'gh api -X PUT repos/o/r/pulls/1/merge'",
    "env GH_TOKEN=x gh release new v1.0.0-rc.1",
    "2>/dev/null gh api -X PUT repos/o/r/pulls/3/merge",
    "&>/dev/null gh pr merge 1",
    # a comment ends at the end of its line, not of the command
    "# merge after approval\ngh api -X PUT repos/o/r/pulls/3/merge -f merge_method=squash",
    "gh pr checks 3 --required # wait for green\ngit push origin v1.0.0-rc.1",
    "echo issue#3; gh api -X PUT repos/o/r/pulls/3/merge",
    # heredoc bodies are data, but their lines still run when the body is fed to a shell
    "cat > notes.md <<'EOF'\n# Release notes\nEOF\ngh api repos/o/r/releases -F tag_name=v1.0.0-rc.1",
    "cat > a.md <<'EOF'\nIt's A.\nEOF\ngh api -X PUT repos/o/r/pulls/1/merge\ncat > b.md <<'EOF'\nIt's B.\nEOF",
    "ssh host <<'EOF'\ngit push origin v1.0.0\nEOF",
    "cat <<'EOF' | bash\ngh api -X PUT repos/o/r/pulls/1/merge\nEOF",
    "cat <<EOF\nIt's $(gh pr merge 1)\nEOF",
    # unparsable input that mentions a guarded command fails closed
    "gh api -X POST 'repos/o/r",
]

ALLOW = [
    "gh api repos/92khsang/vim-companion",
    TOKEN + "gh api repos/92khsang/vim-companion/branches/main/protection",
    "gh api -X GET search/issues -f q=repo:o/r",
    "gh api --method=HEAD repos/o/r",
    "gh api graphql -f query='query { viewer { login } }'",
    "gh api graphql -f query='query($owner: String!) { repository(owner: $owner, name: \"r\") { id } }' -f owner=o",
    "gh api repos/o/r/pulls --paginate --jq '.[].title'",
    "gh api -H 'Accept: application/vnd.github+json' /repos/o/r",
    "gh pr view 3",
    "gh pr create --title 'feat(spec): x' --body-file body.md",
    "gh pr list --state open",
    "gh release list",
    "gh release view v1.0.0",
    "gh workflow list",
    "gh label list",
    "gh repo view",
    "gh secret list",
    "gh variable list",
    "gh repo deploy-key list",
    "gh repo autolink list",
    "gh run view 123 --log-failed",
    "git tag",
    "git tag -l 'v1.*'",
    "git tag --sort=-v:refname",
    "git tag --contains HEAD",
    "git tag -n",
    "git tag -v v1.0.0",
    "git push -u origin chore/governance",
    "git push origin HEAD",
    "git push origin feature/v2",
    "git push -u origin chore/governance 2>&1",
    "git push origin HEAD 2>/dev/null",
    "git push --force-with-lease origin feat/window-moves > /tmp/push.log 2>&1",
    TOKEN + "gh pr create --title 'x' --body \"$(cat body.md)\"",
    "command -v gh",
    "git --no-pager tag",
    "git push --dry-run --tags",
    "git status",
    "echo 'gh pr merge 1'",
    "git commit -m 'gh api -X POST is guarded'",
    "printf '%s\\n' \"$PR_TITLE\" | pnpm exec commitlint",
    "echo issue#3",
    "gh pr view 3 # read only",
    # the commit and PR forms Claude Code writes, with apostrophes and code spans in the text
    "git commit -m \"$(cat <<'EOF'\nfix(hooks): don't treat feature-branch pushes as tag pushes\nEOF\n)\" && git push -u origin fix/drop-keys",
    TOKEN + "gh pr create --title 'chore(repo): x' --body \"$(cat <<'EOF'\n## Why\n\nContributors couldn't tell when a release needs approval.\n\nAgents must ask before `gh pr merge`.\nEOF\n)\"",
    "ls -la",
]


class DecideTest(unittest.TestCase):
    def test_asks_for_guarded_commands(self):
        for command in ASK:
            with self.subTest(command=command):
                self.assertIsNotNone(guard.decide(command), "expected a confirmation prompt")

    def test_allows_read_only_commands(self):
        for command in ALLOW:
            with self.subTest(command=command):
                self.assertIsNone(guard.decide(command))


class HookContractTest(unittest.TestCase):
    def run_hook(self, payload):
        return subprocess.run(
            [sys.executable, "-I", str(HOOK)],
            input=json.dumps(payload),
            capture_output=True,
            text=True,
            check=False,
        )

    def test_ask_output_matches_the_pretooluse_schema(self):
        result = self.run_hook({"tool_name": "Bash", "tool_input": {"command": "gh pr merge 1"}})
        self.assertEqual(result.returncode, 0, result.stderr)
        output = json.loads(result.stdout)["hookSpecificOutput"]
        self.assertEqual(output["hookEventName"], "PreToolUse")
        self.assertEqual(output["permissionDecision"], "ask")
        self.assertIn("gh pr merge", output["permissionDecisionReason"])

    def test_prints_nothing_for_allowed_commands(self):
        result = self.run_hook({"tool_name": "Bash", "tool_input": {"command": "gh pr view 1"}})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "")

    def test_checks_monitor_commands(self):
        result = self.run_hook({"tool_name": "Monitor", "tool_input": {"command": "gh pr merge 1"}})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["hookSpecificOutput"]["permissionDecision"], "ask")

    def test_ignores_other_tools(self):
        result = self.run_hook({"tool_name": "Read", "tool_input": {"file_path": "gh pr merge"}})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "")

    def test_malformed_input_mentioning_gh_asks(self):
        result = subprocess.run(
            [sys.executable, "-I", str(HOOK)],
            input='{"tool_name": "Bash", "tool_input": {"command": "gh pr merge 1"',
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["hookSpecificOutput"]["permissionDecision"], "ask")


if __name__ == "__main__":
    unittest.main()
