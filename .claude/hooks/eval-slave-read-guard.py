"""Read guard for the capability-eval-case subagent. Invoked by eval-slave-read-guard.sh.

WHY THIS EXISTS. The slave needs Read for exactly one thing: recovering a tool result too
large to return inline, which Claude Code spills to
~/.claude/projects/<project>/<session>/tool-results/<file>. Without it an oversized response
(tm's list_configurations returns ~196KB whatever you pass for count/per_page) is a total
loss rather than something a real caller could work around.

WHY IT IS AN ALLOW-LIST. The eval's ground truth lives in the repo this agent runs in:
tests/fixtures/tm-eval-e2e.json carries `expects`, the capability name each case is scored
against, and tests/live/.id-pool.json carries every id. A slave that can read those is not
being measured, it is reading the answer key — and the scores would look like an improvement.
A deny-list must enumerate every route to that data and stay complete forever; this allows
one directory shape and refuses everything else, so a path nobody thought of is refused
rather than permitted.

THE TRANSCRIPTS ARE THE TRAP. Session transcripts sit at
~/.claude/projects/<project>/<session>.jsonl — siblings of the allowed directory — and hold
the full text of every fixture read during a session. The allowed pattern requires a literal
`tool-results` path component, which a transcript can never have.

This is a guard, not a sandbox: it holds only while the agent has no other route to the
filesystem, which is why capability-eval-case must never be granted Bash. `grep -r` in the
working directory would walk straight past it.
"""

import json
import os
import sys
from typing import NoReturn


def block(reason: str) -> NoReturn:
    print(f"Read blocked by eval-slave-read-guard: {reason}", file=sys.stderr)
    sys.exit(2)


def main() -> None:
    try:
        payload = json.load(sys.stdin)
    except Exception as exc:  # noqa: BLE001 - any parse failure must block, not fall open
        block(f"could not parse hook payload ({exc})")

    path = (payload.get("tool_input") or {}).get("file_path")
    if not path:
        block("no file_path in tool_input")

    try:
        # realpath, because /tmp resolves to /private/tmp and a symlink must not be a way out.
        real = os.path.realpath(os.path.expanduser(str(path)))
        root = os.path.realpath(os.path.expanduser("~/.claude/projects"))
    except Exception as exc:  # noqa: BLE001
        block(f"could not resolve path ({exc})")

    rel = os.path.relpath(real, root)
    parts = rel.split(os.sep)

    # Exactly <project>/<session>/tool-results/<file...>, and never above the root.
    if rel.startswith(os.pardir) or len(parts) < 4 or parts[2] != "tool-results":
        block(f"{real} is not a spilled tool result under {root}/<project>/<session>/tool-results/")

    # Allow outright rather than merely permitting: an unattended run has nobody to answer a
    # permission prompt, so a read that stalls is the same as a read that failed.
    print(
        json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "allow",
                    "permissionDecisionReason": "spilled tool result, inside the eval slave's allowed path",
                }
            }
        )
    )
    sys.exit(0)


if __name__ == "__main__":
    main()
