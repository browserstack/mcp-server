# close_exploratory_session — DRIFT

- **Product / entity:** tm / `exploratory_session` (write)
- **Environment:** preprod
- **Probed:** 2026-09-22, project PR-2005 (379335744), sessions **780** (ES-15, closed first — the expendable clone) and **779** (ES-14, closed second, for comparison)
- **Run file:** `tests/live/runs/tm/close_exploratory_session.json`
- **Why this order:** this capability was deliberately held until last in the exploratory-session family because closing is one-way (no reopen endpoint, no `session_state` acceptance anywhere) — the clone was closed first as the more expendable of the two probe-owned sessions.

## The call itself is clean

Both closes — `PATCH`-style writes with no body, per the capability's own guidance ("This call takes no body at all") — returned exactly the declared 200 shape, `{success:true}`, on the first attempt. No `declared_missing`/`undeclared_returned` on the invoke response itself; the declared contract for this endpoint is minimal and it delivered.

## The high-value question: does closing lock the session?

**Yes, and honestly.** A follow-up `update_exploratory_session` on now-closed session 780 — a harmless title-only change — was rejected with **HTTP 400**, `{success:false, message:"The API request is invalid or improperly formed"}`. This is a real 4xx, not a silent 200 no-op. Unlike this campaign's confirmed silent-no-op defects (`update_filter`'s inert `entity` field, `unlink_test_runs_from_test_plan` accepting a `TR-NNN` string with `200 {success:true}` while doing nothing), closing an exploratory session enforces its lock truthfully.

(The 400 body itself doesn't match the family's declared error envelope `{success:false, error:{code,message,details}}` — it's the flat `{success:false, message}` shape instead. That specific mismatch is not a new finding: `update_exploratory_session`'s own guidance already documents it verbatim, "Upstream validation failures all arrive as 400 {success:false, message:...}". Noted for completeness, not counted as new drift here.)

## The other high-value question: does `actual_duration` get set on close?

**No — falsified in both directions, on two sessions closed back to back.**

- **Session 780** (the clone): `actual_duration` was `null` before close (its long-standing broken value — the clone never inherited the derivation that produces a real number, per `get_exploratory_session.md` and `clone_exploratory_session.md`). After close: still `null`. Closing did not populate it.
- **Session 779** (the source): `actual_duration` was `210` before close (live-computed as the sum of its two logs' `elapsed_time`: 120 + 90). After close: still exactly `210`, unchanged. Closing did not recompute it, zero it, or touch it at all.

The declared field description — *"Final recorded duration of the session in minutes (**set on close**)"* — is confirmed wrong, not merely stale. This capability's own `describeCapability` guidance already says why: *"The handler's actual_duration pass-through is commented out, so posting a duration here returns 200 and changes nothing."* The empirical result is consistent with that: `actual_duration` is apparently set only as a side effect of logging directly against a session (matching 779's 120+90=210), never by this close call, and never backfilled for a clone whose logs arrived via copy rather than direct creation. The 779-vs-780 discrepancy first observed in `get_exploratory_session.md` now has a confirmed mechanism: it isn't close-related at all, and close does nothing to fix or reproduce it either way.

## `closed_at` / `closed_by` — populated for the first time in this family, and correctly shaped

Both had been `null` on every prior read in this campaign. Both closes populated them immediately:

```json
"closed_by": {"id": 2522, "email": "probe-user@example.invalid", "full_name": "ing", "group_id": 2615},
"closed_at": "2026-09-22T05:42:25.000Z"
```

`closed_by` matches the declared user-reference object shape (`{id, email, full_name, group_id}`) exactly. This part of the contract is confirmed **PASS** on both sessions.

## Confirmed family defects, re-confirmed post-close

- **`folder_id`**: still absent (key missing, not null) from both post-close reads of 780 and 779 — the same "declared in every schema in this family, absent from every response" pattern already confirmed on create, clone, update and read.
- **`project_id`**: both post-close reads return it as an **integer** (`379335744`), consistent with every prior plain-read observation. The write-path string-vs-read-path integer split documented elsewhere in this family doesn't reproduce here, since the close response itself carries no session object at all to check.

## Verified by read-back only

Per campaign standard, nothing here is taken from the write response — `close_exploratory_session`'s own 200 carries only `{success:true}` and reveals nothing about `session_state`, `closed_at`, `closed_by`, or `actual_duration`. All of the above comes from a `get_exploratory_session` re-read of each session after closing it.

## Both probe-owned sessions are now closed

780 closed at 05:42:25Z; 779 closed at 05:42:57Z; both by user 2522. Both are irreversible per the capability's own guidance (no `session_state` acceptance anywhere, no reopen endpoint) — this was a deliberate, informed choice to resolve the actual_duration/closed_at/closed_by/lock questions, not an accident.

## Verdict rationale

DRIFT, not PASS: the invoke path itself is clean and matches its (minimal) declared contract, but the declared field semantics for `actual_duration` ("set on close") are actively contradicted by read-back on two independent sessions. Not BLOCKED (fully invokable, both attempts succeeded first try). Not UNVERIFIED (both the lock question and the actual_duration-on-close question were fully exercised, each on two sessions, with read-back verification).
