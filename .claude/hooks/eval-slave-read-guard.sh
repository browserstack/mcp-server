#!/bin/bash
# PreToolUse(Read) guard for the capability-eval-case subagent. The reasoning lives in
# eval-slave-read-guard.py; this wrapper exists for one reason only.
#
# FAILING CLOSED. Claude Code treats exit 2 as "block" and ANY OTHER non-zero exit as a
# non-blocking error — meaning the read proceeds. So a missing python3, a syntax error, a
# moved file or an unhandled exception would all quietly grant the access this guard exists
# to withhold, and nothing in the transcript would say so. Everything except an explicit
# success is therefore mapped to 2.
set -u
guard="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/eval-slave-read-guard.py"

if [ ! -f "$guard" ]; then
  echo "Read blocked: guard script missing at $guard" >&2
  exit 2
fi

python3 -I "$guard"
rc=$?
[ "$rc" -eq 0 ] && exit 0
# 2 is the guard's own refusal; anything else is a broken guard, which must also refuse.
[ "$rc" -eq 2 ] || echo "Read blocked: guard exited $rc (treating a broken guard as a refusal)" >&2
exit 2
