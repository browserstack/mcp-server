#!/usr/bin/env bash
# L2 check 1 (Truth): does each capability return what its index says?
#
# Runs scripts/check-contract.py on EVERY capability/*.capability-index.json, against
# scripts/contract-baseline/<product>.json. Only findings that are not in the baseline fail.
# An index with no baseline fails, so a new product cannot skip the check.
#
#   scripts/check-contract-all.sh                 # gate
#   scripts/check-contract-all.sh --against <ref>  # gate, then report "diff" mode against a git ref
#
# "diff" mode (a field added to a response schema, but not to `returns`) is report only.
set -u
cd "$(dirname "$0")/.."

against=""
if [ "${1:-}" = "--against" ]; then
  against="${2:?--against needs a git ref}"
fi

shopt -s nullglob
indexes=(capability/*.capability-index.json)
if [ ${#indexes[@]} -eq 0 ]; then
  echo "No capability/*.capability-index.json found."
  exit 1
fi

fail=0
for idx in "${indexes[@]}"; do
  p=$(basename "$idx" .capability-index.json)
  echo "== $p"
  baseline="scripts/contract-baseline/$p.json"
  if [ ! -f "$baseline" ]; then
    echo "No baseline for $p. Write one, then review it:"
    echo "  python3 scripts/check-contract.py $idx --write-baseline $baseline"
    fail=1
    continue
  fi
  python3 scripts/check-contract.py "$idx" --baseline "$baseline" --quiet || fail=1
done

if [ -n "$against" ]; then
  echo
  echo "== diff mode against $against (report only)"
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT
  for idx in "${indexes[@]}"; do
    p=$(basename "$idx" .capability-index.json)
    if git show "$against:$idx" > "$tmp/$p.json" 2>/dev/null; then
      echo "-- $p"
      python3 scripts/check-contract.py diff "$tmp/$p.json" "$idx" || true
    else
      echo "-- $p: new in this change, nothing to compare"
    fi
  done
fi

if [ "$fail" -ne 0 ]; then
  echo
  echo "FAIL: contract check. See the NEW disagreements above."
  exit 1
fi
echo
echo "OK: contract check passed for ${#indexes[@]} indexes."
