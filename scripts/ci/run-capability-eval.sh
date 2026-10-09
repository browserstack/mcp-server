#!/usr/bin/env bash
#
# Run the capability evals headless, for CI.
#
# WHY THIS IS A SCRIPT IN THIS REPO rather than lines in a Jenkinsfile. What the eval
# needs — which fixture, which tools the agent may use, what the master must be told —
# changes whenever the eval changes, and the eval changes here. A job that carried those
# details would have to be edited in another repo, by someone else's review, every time a
# case was added; worse, it would drift silently, because nothing fails when a job runs
# last month's instructions against this month's fixture.
#
# WHAT IT DOES NOT DO. It does not score. It runs the eval, checks that a machine-readable
# result was actually produced, and stops. The caller decides what a FAIL or a PARTIAL is
# worth, because that is a policy question and it differs between a branch check and a
# scheduled baseline.
#
# Inputs, all from the environment:
#
#   FIXTURE       eval fixture, relative to the repo root   (required)
#   MCP_CONFIG    --mcp-config file naming the eval server  (required)
#   RESULTS       where the master writes its verdicts      (default eval-results.json)
#   EVAL_LOG      where to tee the session transcript       (default eval-console.log)
#   CLAUDE_MODEL  model pin; empty means the CLI's default  (optional)
#   CLAUDE_CODE_OAUTH_TOKEN  passed through when set        (optional)
#
# Exits non-zero only when the harness itself did not work: a missing input, a missing
# skill or agent type, or a run that produced no result. A run where cases genuinely
# failed exits 0 and says so in $RESULTS — that is a measurement, not an error.

set -u -o pipefail

RESULTS="${RESULTS:-eval-results.json}"
EVAL_LOG="${EVAL_LOG:-eval-console.log}"
CLAUDE_MODEL="${CLAUDE_MODEL:-}"

die() {
  echo "ERROR: $*" >&2
  exit 1
}

[ -n "${FIXTURE:-}" ] || die "FIXTURE is required"
[ -n "${MCP_CONFIG:-}" ] || die "MCP_CONFIG is required"
[ -f "$FIXTURE" ] || die "fixture $FIXTURE not found — is GIT_REF a branch that carries it?"
[ -s "$MCP_CONFIG" ] || die "$MCP_CONFIG is missing or empty; the agent would have no tools at all"
command -v claude >/dev/null || die "the claude CLI is not on PATH"

# The method and the agent type come from different repos now: the skill ships with the
# BrowserStack AI harness, the agent type and its read guard with this one. A session
# missing either does not fail loudly — it just quietly does very little — so check both
# before spending a run finding out.
skill_found=""
for candidate in \
  ".claude/skills/stack:capability-eval/SKILL.md" \
  ".claude/skills/capability-eval/SKILL.md" \
  "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills/stack:capability-eval/SKILL.md"; do
  if [ -f "$candidate" ]; then
    skill_found="$candidate"
    break
  fi
done
[ -n "$skill_found" ] || die "the capability-eval skill is not installed — install the stack-domain-mcp-server stack from browserstack-ai-harness, or the run has no method to follow"
echo "skill:   $skill_found"

[ -f ".claude/agents/capability-eval-case.md" ] \
  || die "the capability-eval-case agent type is missing from this checkout — the master would have nothing to spawn"
[ -x ".claude/hooks/eval-slave-read-guard.sh" ] \
  || die "the eval read guard is missing or not executable; without it a subagent can read the answer key"

skill_name="$(sed -n 's/^name: *//p' "$skill_found" | head -1)"
[ -n "$skill_name" ] || die "could not read the skill's name out of $skill_found"
echo "method:  /${skill_name}"

# The prompt says only what is true of THIS run. Everything about how to run an eval is in
# the skill, which is the whole point of the skill existing.
cat > eval-prompt.txt <<PROMPT
Run the BrowserStack capability evals end to end, following the ${skill_name} skill. Read the skill first; it is the method, and this prompt deliberately does not repeat it.

This is an unattended CI run. Nobody is watching, so anything you would normally ask a person has to be decided from the fixture.

Fixture: ${FIXTURE}
Pool:    tests/live/.id-pool.json  (this run has already seeded it — do not seed again, and resolve every {{placeholder}} from it)

You are the master. Spawn one capability-eval-case subagent per case, give it the query and nothing else, and answer the questions it hands back as the user would. Verify every assert yourself against the response rather than against the subagent's report of it.

The person who configured this job authorised the writes this fixture declares. When a case carries setup.writes: true, approve exactly the write that case describes against the scratch target it names — and nothing wider. A subagent asking to write something the fixture did not sanction gets a no, and that is a finding worth reporting.

When every case is scored, write ${RESULTS} as JSON with this shape:

{
  "fixture": "${FIXTURE}",
  "model": "${CLAUDE_MODEL:-default}",
  "ran": <cases actually scored>,
  "excluded": <cases not run>,
  "pass": <n>, "partial": <n>, "fail": <n>,
  "cases": [
    {"id": "...", "verdict": "PASS|PARTIAL|FAIL", "expects": "...", "reached": "...",
     "diagnosis": "empty on a pass; otherwise which of reached/scoped/answered/restraint failed, and why"}
  ],
  "excluded_cases": [{"id": "...", "reason": "..."}]
}

A hand-back you answered and the subagent then completed is a PASS, not an exclusion. Exclusions are for cases the harness could not run — a missing id, a tool that was not available, an expired credential — and the reason matters more than the count.

Then print the report the skill asks for: how many ran, how many were excluded and why, the pass/partial/fail split, the miss classification, the diagnosis per failing case, anything the run found that it was not looking for, and the rate last.
PROMPT

# --strict-mcp-config: only the server named in MCP_CONFIG exists. Without it the agent's
#   own servers join in and a subagent can answer from a different account entirely.
# --allowedTools: a headless run with no permission mode refuses every call quietly enough
#   to read like the agent choosing not to act. Bash is deliberately absent — the eval's
#   ground truth is in this checkout, and a subagent with a shell walks past the read guard
#   that exists to keep it from the answers.
ALLOWED_TOOLS="Task,Skill,Read,Write,Glob,Grep"
for tool in listProducts searchCapability describeCapability describeEntity invokeCapability; do
  ALLOWED_TOOLS="${ALLOWED_TOOLS},mcp__browserstack-eval__${tool}"
done

# An empty CLAUDE_MODEL means "whatever the CLI defaults to", not `--model ""`.
model_flag=()
[ -n "$CLAUDE_MODEL" ] && model_flag=(--model "$CLAUDE_MODEL")

echo "running:  claude -p (fixture ${FIXTURE}, model ${CLAUDE_MODEL:-CLI default})"
set +e
claude -p "$(cat eval-prompt.txt)" \
  "${model_flag[@]}" \
  --mcp-config "$MCP_CONFIG" \
  --strict-mcp-config \
  --permission-mode acceptEdits \
  --allowedTools "$ALLOWED_TOOLS" \
  --output-format text 2>&1 | tee "$EVAL_LOG"
status=$?
set -e
echo "claude exited ${status}"

# The verdict is in the results file, never in that exit code: a run that scored every
# case and found real failures still exits 0, and a run that died halfway often does too.
# The only thing the exit code is good for is explaining an absent result file.
[ -s "$RESULTS" ] \
  || die "the eval produced no $RESULTS (claude exited ${status}) — it did not finish, so there is no rate to read into it"

echo "wrote:   $RESULTS"
