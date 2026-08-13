---
name: sap
description: Fast merge-safety triage for small pull requests. Decides whether a PR is dull enough to merge on sight or needs a real review, without reading the whole codebase. Use when asked to triage a PR, check if a PR is safe to merge, do a quick pass, or sanity-check a small change. Defers to SWEEP for anything that is not obviously safe.
---

# SAP

Triage, not review. SAP answers one question — **can a human merge this on sight?** — and answers it in
about a minute.

It is the cheap front door to SWEEP. Most pull requests in this repository are small: 41% are under 100
lines. Running five independent lenses and a browser over a typo fix is waste, and waste is the thing SAP
exists to remove. When a change is not obviously dull, SAP does not analyse it harder — it stops and hands
it to SWEEP.

## Two rules that never bend

**1. Deferring is cheap; a wrong pass is not.** A false *needs review* costs a reviewer a few minutes. A
false *safe to merge* is how a migration or a permission change lands unread. When the two are in tension,
defer. You are never penalised for deferring.

**2. Never post a merge decision without explicit permission in the current turn.** Same rule as SWEEP.
Report the verdict in the terminal by default.

## Cost

**Run SAP on Haiku.** There is no lens fan-out, no verification round and no second opinion — one gate
and at most one short diff read. Measured on this repository: the gate is **0.2s when a size or critical
path trips** (it short-circuits before resolving blast radius) and **~2.5s otherwise**, at zero model
cost. The only tokens spent are one pass over a diff that is already known to be under 200 lines.

If you catch yourself opening a third file, you have left SAP's job. Defer.

## What SAP does not do

No live browser test. No video. No screenshots. No lens fan-out. No graph. No verification round. If you
find yourself wanting any of those, that *is* the signal to defer — say so and stop.

---

## 1. Run the gate

```bash
node agent/skills/sap/triage.mjs <base-sha> <head-sha> --json /tmp/sap-<n>.json
```

Deterministic, zero model cost. It computes churn, matches changed paths against the critical list, greps
the added lines for danger patterns, and resolves how many files import what was touched.

It returns one of two verdicts:

- **`needs-review`** — a gate tripped. **Stop. Do not read the diff.** The gate is the finding; further
  analysis is exactly the spend SAP is avoiding. Report it and recommend SWEEP.
- **`review-diff`** — nothing tripped. The change is small and boring on paper, so now read it.

## 2. The gates, and why each one exists

| Gate | Trips when | Why it is not negotiable |
| --- | --- | --- |
| **size** | over 200 changed lines | Past that, "I read the whole thing" stops being true. Not a judgement about the change, just about triage. |
| **critical-path** | migration, permission/CASL, auth, crypto/KMS/PKI, queue or cron, audit event contract, secret encryption, env config, CI workflow, Dockerfile, `package.json` | Small and correct is not the same as safe here. A migration runs against every customer; an audit event name ships to customer SIEMs. Correct changes to these still get a second reader. |
| **danger-pattern** | added lines open a transaction, touch an authorization check, read env, delete or alter data, inject markup, or make an outbound request | These are where this repository's real incidents came from. The ten-connection pool means a missed `tx` is a deadlock, not a slowdown. |
| **blast-radius** | a changed file is imported by 25+ files | Referenced by a lot of things is its own reason. A one-line change to a module 200 files import is not a one-line change in effect. |

A critical-path or blast-radius trip is **not an accusation**. The change may be perfectly correct. Say
that plainly: the reason is what it touches, not what it does wrong.

## 3. Read the diff (only when the gate said `review-diff`)

One pass. You are looking for the kind of defect visible in a small diff without leaving it:

- An error path that swallows the failure — a `catch` that logs and continues, a promise with no
  rejection handling.
- A validation rule tightened or a field made required, which breaks existing callers.
- A form field, prop or handler wired on one side only. **Compare it against its siblings in the same
  file** — divergence between two things that should look alike is the highest-yield signal at this size.
- An off-by-one, an inverted condition, a `!` dropped or added.
- Copy that contradicts the behaviour around it.

If you find one, that is a `needs-review`, with the line and the reason. If you are unsure, defer. Do not
open other files to resolve the doubt: needing a second file *is* the answer.

## 4. Verdict

Exactly one of three, and nothing else:

| Verdict | Meaning |
| --- | --- |
| ✅ **Safe to merge** | Small, non-critical, nothing found. |
| 🔶 **Needs a review** | A gate tripped, or the diff has something worth a second look. Recommend SWEEP. |
| ⛔ **Do not merge** | An outright defect visible in the diff. Rare from SAP — say what breaks. |

Keep the output to a few lines. The value is the decision, not the prose:

```
✅ Safe to merge — 14 lines, 1 file, frontend only.
Tooltip copy only. No gate tripped, no behaviour change.
```

```
🔶 Needs a review — 31 lines, 2 files.
[critical-path] backend/src/db/migrations/20260812_add_index.ts — runs against every customer.
The change looks correct; the reason is what it touches. Hand to SWEEP.
```

**Say which gate tripped, always.** "Looks risky" is not a triage result — the author needs to know
whether to shorten the PR, split it, or just accept that a migration gets a second reader.

## 5. When SAP is the wrong tool

Say so and stop. SAP is wrong for a PR you were asked to review properly, anything already flagged by a
human, a revert of a production incident, or a change whose author asked for scrutiny. Escalating early
costs nothing.

Full review lives in `agent/skills/sweep/SKILL.md`.
