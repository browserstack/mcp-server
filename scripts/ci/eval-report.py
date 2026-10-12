#!/usr/bin/env python3
"""Turn an eval run into a CSV and a zip a job can hand to someone who was not watching.

WHY THIS IS NOT THE AGENT'S JOB. The master already writes eval-results.json, and that is
the right thing to ask of it: structured verdicts it reasoned about. Asking it to also
emit CSV invites the two failures a spreadsheet cannot survive — a dropped row, and a
diagnosis containing a comma or a newline breaking every column after it. Both are silent.
So the formatting happens here, deterministically, over data that has already been scored.

WHY IT ITERATES THE FIXTURE, NOT THE RESULTS. A case the master forgot to score is the one
you most want to see. Walking the results file would make it disappear; walking the
fixture gives it a row with verdict MISSING. An eval that silently measured 21 of 22 cases
and reported 21/21 is worse than one that fails.

Inputs from the environment (or argv):

  FIXTURE      the eval fixture that was run            (required)
  RESULTS      the master's verdicts                    (default eval-results.json)
  EVAL_LOG     session transcript, bundled if present   (default eval-console.log)
  EVAL_PROMPT  master prompt, bundled if present        (default eval-prompt.txt)
  REPORT_ZIP   where to write the bundle                (default eval-report.zip)
  CLAUDE_CONFIG_DIR  where Claude Code kept its session   (default ~/.claude)

PER-CASE TRANSCRIPTS. Each case is answered by its own subagent, and Claude Code already
writes one file per subagent under
<config>/projects/<slug>/<session>/subagents/agent-<id>.jsonl, with an .meta.json beside it
naming the agent type and the description the master gave it. So the transcripts are not
reconstructed here — they are collected, matched to a case, and bundled, with the raw JSONL
kept alongside the readable rendering so nothing depends on this file parsing correctly.
"""

import csv
import glob
import io
import json
import os
import pathlib
import re
import sys
import zipfile

FIXTURE = os.environ.get("FIXTURE") or (sys.argv[1] if len(sys.argv) > 1 else "")
RESULTS = os.environ.get("RESULTS", "eval-results.json")
EVAL_LOG = os.environ.get("EVAL_LOG", "eval-console.log")
EVAL_PROMPT = os.environ.get("EVAL_PROMPT", "eval-prompt.txt")
REPORT_ZIP = os.environ.get("REPORT_ZIP", "eval-report.zip")
CONFIG_DIR = os.environ.get("CLAUDE_CONFIG_DIR") or os.path.expanduser("~/.claude")

if not FIXTURE:
    sys.exit("ERROR: FIXTURE is not set — there is no list of cases to report against")

fixture = json.loads(pathlib.Path(FIXTURE).read_text())
results = json.loads(pathlib.Path(RESULTS).read_text())

scored = {c["id"]: c for c in results.get("cases", [])}
excluded = {c["id"]: c for c in results.get("excluded_cases", [])}

COLUMNS = [
    "case_id",
    "verdict",
    "expects",
    "reached",
    "query",
    "validates",
    "asserts",
    "diagnosis",
    "tools_called",
    "transcript",
    "why",
]


def collect_subagents():
    """One record per subagent Claude Code ran, newest session only.

    Older sessions' directories sit in the same place, and bundling them would attach
    another run's transcripts to this run's verdicts — which looks like evidence and is not.
    """
    dirs = glob.glob(os.path.join(CONFIG_DIR, "projects", "*", "*", "subagents"))
    if not dirs:
        return []
    newest = max(dirs, key=os.path.getmtime)
    out = []
    for jsonl in sorted(glob.glob(os.path.join(newest, "agent-*.jsonl"))):
        meta_path = jsonl[: -len(".jsonl")] + ".meta.json"
        meta = {}
        if os.path.isfile(meta_path):
            try:
                meta = json.loads(pathlib.Path(meta_path).read_text())
            except Exception:
                pass
        prompt, tools, final = "", [], ""
        try:
            for line in pathlib.Path(jsonl).read_text(errors="replace").splitlines():
                try:
                    e = json.loads(line)
                except Exception:
                    continue
                msg = e.get("message") or {}
                content = msg.get("content")
                if isinstance(content, str):
                    text = content
                    parts = []
                elif isinstance(content, list):
                    parts = content
                    text = " ".join(
                        c.get("text", "") for c in parts if isinstance(c, dict) and c.get("type") == "text"
                    )
                else:
                    continue
                if e.get("type") == "user" and not prompt:
                    prompt = text
                if e.get("type") == "assistant" and text.strip():
                    final = text
                for c in parts:
                    if isinstance(c, dict) and c.get("type") == "tool_use":
                        tools.append({"name": c.get("name", "?"), "input": c.get("input", {})})
        except OSError:
            continue
        out.append(
            {
                "path": jsonl,
                "meta_path": meta_path if os.path.isfile(meta_path) else None,
                "agent_type": meta.get("agentType", ""),
                "description": meta.get("description", ""),
                "prompt": prompt,
                "tools": tools,
                "final": final,
            }
        )
    return out


def literal_anchor(query: str) -> str:
    """The longest run of the query that carries no {{placeholder}}.

    Placeholders are resolved to live ids before a subagent ever sees the query, so the
    stored text never matches what was sent. The literal stretches around them do.
    """
    segments = [seg.strip() for seg in re.split(r"\{\{[^}]*\}\}", query or "")]
    return max(segments, key=len) if segments else ""


def match_subagents(cases, subagents):
    """case_id -> subagent record. Each subagent is claimed at most once."""
    taken, matched = set(), {}
    # Pass 1: the case id, written plainly in the master's description or its prompt.
    for case in cases:
        cid = case.get("id", "")
        if not cid:
            continue
        for i, sub in enumerate(subagents):
            if i in taken:
                continue
            if cid in sub["description"] or cid in sub["prompt"]:
                matched[cid], _ = sub, taken.add(i)
                break
    # Pass 2: the longest literal stretch of the query, for a master that numbered nothing.
    for case in cases:
        cid = case.get("id", "")
        if cid in matched:
            continue
        anchor = literal_anchor(case.get("query", ""))
        if len(anchor) < 20:
            continue
        for i, sub in enumerate(subagents):
            if i in taken:
                continue
            if anchor.lower() in sub["prompt"].lower():
                matched[cid], _ = sub, taken.add(i)
                break
    return matched


def render(case_id, sub, case):
    """A transcript somebody can read without knowing the JSONL schema."""
    lines = [
        f"# {case_id} — session transcript",
        "",
        f"- agent type: `{sub['agent_type'] or 'unknown'}`",
        f"- master's description: {sub['description'] or '(none)'}",
        f"- expects: `{case.get('expects', '')}`",
        f"- tool calls: {len(sub['tools'])}",
        "",
        "## Prompt the subagent was given",
        "",
        "```",
        sub["prompt"].strip() or "(empty)",
        "```",
        "",
        "## Tools called, in order",
        "",
    ]
    if sub["tools"]:
        for n, t in enumerate(sub["tools"], 1):
            arg = json.dumps(t["input"], ensure_ascii=False)
            if len(arg) > 600:
                arg = arg[:600] + " …(truncated; the raw JSONL beside this file has it in full)"
            lines.append(f"{n}. `{t['name']}`")
            lines.append(f"   - input: `{arg}`")
    else:
        lines.append("_No tool calls. For an `__ask_the_user__` case that is the correct behaviour._")
    lines += ["", "## Final answer", "", "```", sub["final"].strip() or "(none)", "```", ""]
    return "\n".join(lines)


def flatten(value) -> str:
    """One cell. Lists become numbered lines; csv quoting handles the rest."""
    if value is None:
        return ""
    if isinstance(value, list):
        return "\n".join(f"{i}. {v}" for i, v in enumerate(value, 1))
    return str(value)


subagents = collect_subagents()
matched = match_subagents(fixture.get("cases", []), subagents)

rows = []
for case in fixture.get("cases", []):
    cid = case.get("id", "")
    verdict = scored.get(cid, {}).get("verdict")
    if verdict is None:
        # EXCLUDED is a decision somebody made and wrote down. MISSING is the absence of
        # one, and the two must not share a cell: an account that cannot run a case and an
        # eval that forgot to score it need different people to do different things.
        verdict = "EXCLUDED" if cid in excluded else "MISSING"
    rows.append(
        {
            "case_id": cid,
            "verdict": verdict,
            "expects": flatten(case.get("expects")),
            "reached": flatten(scored.get(cid, {}).get("reached")),
            "query": flatten(case.get("query")),
            "validates": flatten(case.get("validates")),
            "asserts": flatten(case.get("asserts")),
            "diagnosis": flatten(
                scored.get(cid, {}).get("diagnosis")
                or excluded.get(cid, {}).get("reason")
            ),
            "tools_called": " → ".join(t["name"] for t in matched[cid]["tools"]) if cid in matched else "",
            "transcript": f"transcripts/{cid}.md" if cid in matched else "",
            "why": flatten(case.get("why")),
        }
    )

# A verdict the master reported for a case the fixture does not contain. Rare, but it means
# the results were scored against a different fixture than the one named here, and silently
# dropping the row would hide exactly that.
for cid in list(scored) + list(excluded):
    if not any(r["case_id"] == cid for r in rows):
        rows.append(
            {
                **{c: "" for c in COLUMNS},
                "case_id": cid,
                "verdict": scored.get(cid, {}).get("verdict", "EXCLUDED"),
                "diagnosis": "NOT IN THE FIXTURE NAMED BY THIS RUN — scored against a different fixture?",
            }
        )

buf = io.StringIO()
writer = csv.DictWriter(buf, fieldnames=COLUMNS, lineterminator="\n")
writer.writeheader()
writer.writerows(rows)
cases_csv = buf.getvalue()

summary = io.StringIO()
sw = csv.writer(summary, lineterminator="\n")
sw.writerow(["field", "value"])
for key in ("fixture", "model", "ran", "excluded", "pass", "partial", "fail"):
    if key in results:
        sw.writerow([key, results[key]])
for name, count in (
    ("rows_in_report", len(rows)),
    ("missing", sum(1 for r in rows if r["verdict"] == "MISSING")),
    ("subagent_transcripts_found", len(subagents)),
    ("transcripts_matched_to_a_case", len(matched)),
):
    sw.writerow([name, count])
summary_csv = summary.getvalue()

with zipfile.ZipFile(REPORT_ZIP, "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr("eval-cases.csv", cases_csv)
    z.writestr("eval-summary.csv", summary_csv)
    # The evidence behind the verdicts, so the zip answers "why" without a Jenkins login.
    for path, arcname in (
        (RESULTS, "eval-results.json"),
        (EVAL_PROMPT, "eval-prompt.txt"),
        (EVAL_LOG, "eval-console.log"),
        (FIXTURE, "fixture.json"),
    ):
        if os.path.isfile(path):
            z.write(path, arcname)

    # One readable transcript per case, plus the raw JSONL it was rendered from — so a
    # disagreement with the rendering can be settled against the source rather than argued.
    for case in fixture.get("cases", []):
        cid = case.get("id", "")
        sub = matched.get(cid)
        if not sub:
            continue
        z.writestr(f"transcripts/{cid}.md", render(cid, sub, case))
        z.write(sub["path"], f"transcripts/raw/{cid}.jsonl")
        if sub["meta_path"]:
            z.write(sub["meta_path"], f"transcripts/raw/{cid}.meta.json")

    # Subagents that answered no case we could identify. Kept, and named as unmatched:
    # a transcript quietly dropped is how you lose the one case that went wrong.
    claimed = {s["path"] for s in matched.values()}
    for sub in subagents:
        if sub["path"] in claimed:
            continue
        name = os.path.basename(sub["path"])
        z.write(sub["path"], f"transcripts/unmatched/{name}")

tally = {}
for r in rows:
    tally[r["verdict"]] = tally.get(r["verdict"], 0) + 1
print(f"report:  {REPORT_ZIP} ({len(rows)} rows: " + ", ".join(f"{v} {k}" for k, v in sorted(tally.items())) + ")")

print(f"         {len(matched)} of {len(subagents)} subagent transcripts matched to a case")
if subagents and not matched:
    print("WARNING: no transcript could be matched to a case — check CLAUDE_CONFIG_DIR points at the session this run used")

missing = [r["case_id"] for r in rows if r["verdict"] == "MISSING"]
if missing:
    print(f"WARNING: the eval scored no verdict for {len(missing)} case(s): {', '.join(missing)}")
