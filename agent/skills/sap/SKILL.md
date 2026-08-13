---
name: sap
description: Fast merge-safety triage for small pull requests. Decides whether a PR is dull enough to merge on sight or needs a real review, without reading the whole codebase. Use when asked to triage a PR, check if a PR is safe to merge, do a quick pass, or sanity-check a small change. Defers to SWEEP for anything that is not obviously safe.
---

# SAP

Triage, not review. SAP answers one question. **Can a human merge this on sight?** It answers in about a minute.

It is the cheap front door to SWEEP. Most pull requests in this repository are small: 41% are under 100
lines. Running five independent lenses and a browser over a typo fix is waste, and waste is the thing SAP
exists to remove. When a change is not obviously dull, SAP does not analyse it harder, it stops and hands
it to SWEEP.

## Three rules that never bend

**1. Deferring is cheap; a wrong pass is not.** A false *needs review* costs a reviewer a few minutes. A
false *safe to merge* is how a migration or a permission change lands unread. When the two are in tension,
defer. You are never penalised for deferring.

**2. Never post a merge decision without explicit permission in the current turn.** Same rule as SWEEP.
Report the verdict in the terminal by default.

**3. SAP approves, and only approves.** When the answer is ✅ and permission was given, submit a real GitHub
approval, because a triage nobody can act on is not worth running. SAP never requests changes and never
merges: a blocking review is heavier than one gate and one diff read can justify, and SAP's answer to
"something looks wrong here" is to hand the PR to SWEEP, not to stand in front of it.

## Cost

**Run SAP on Haiku.** There is no lens fan-out, no verification round and no second opinion: one gate
and at most one short diff read. Measured on this repository: the gate is **0.2s when a size or critical
path trips** (it short-circuits before resolving blast radius) and **~2.5s otherwise**, at zero model
cost. The only tokens spent are one pass over a diff that is already known to be under 200 lines.

If you catch yourself opening a third file, you have left SAP's job. Defer.

## What SAP does not do

No live browser test. No video. No screenshots. No lens fan-out. No graph. No verification round. If you
find yourself wanting any of those, that *is* the signal to defer: say so and stop.

---

## 1. Run the gate

```bash
node agent/skills/sap/triage.mjs <base-sha> <head-sha> --json /tmp/sap-<n>.json
```

Deterministic, zero model cost. It computes churn, matches changed paths against the critical list, greps
the added lines for danger patterns, and resolves how many files import what was touched.

It returns one of two verdicts:

- **`needs-review`**: a gate tripped. **Stop. Do not read the diff.** The gate is the finding; further
  analysis is exactly the spend SAP is avoiding. Report it and recommend SWEEP.
- **`review-diff`**: nothing tripped. The change is small and boring on paper, so now read it.

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

- An error path that swallows the failure: a `catch` that logs and continues, a promise with no
  rejection handling.
- A validation rule tightened or a field made required, which breaks existing callers.
- A form field, prop or handler wired on one side only. **Compare it against its siblings in the same
  file**: divergence between two things that should look alike is the highest-yield signal at this size.
- An off-by-one, an inverted condition, a `!` dropped or added.
- Copy that contradicts the behaviour around it.

If you find one, that is a `needs-review`, with the line and the reason. If you are unsure, defer. Do not
open other files to resolve the doubt: needing a second file *is* the answer.

## 4. Verdict

Exactly one of three, and nothing else:

| Verdict | Meaning | What SAP does |
| --- | --- | --- |
| ✅ **Safe to merge** | Small, non-critical, nothing found. | Approves it, via `approve.mjs` (step 5). |
| 🔶 **Needs a review** | A gate tripped, or the diff has something worth a second look. Recommend SWEEP. | Comments. Never requests changes. |
| ⛔ **Do not merge** | An outright defect visible in the diff. Rare from SAP: say what breaks. | Comments, and says which finding blocks it. Never requests changes. |

### How to write it

Three or four lines. Plain words. The author wants the decision and the reason, nothing else.

No em dashes. No hedging. No jargon where a normal word works. Say what you looked at and what you
decided. If you deferred, say exactly what tripped so the author knows whether to shorten the PR, split
it, or just accept that a migration gets a second reader. "Looks risky" is not a triage result.

```
> 🤖 **SAP** triage

✅ Safe to merge. 14 lines, 1 file, frontend only.

Tooltip wording only. Nothing critical, nothing widely used, no behaviour change.
```

```
> 🤖 **SAP** triage

🔶 Needs a review. 31 lines, 2 files.

This adds a database migration, which runs against every customer's data. The
change looks correct: the index matches the query and `down` undoes `up`. I am
handing it over because of what it touches, not because I found a problem.
```

```
> 🤖 **SAP** triage

⛔ Do not merge. 4 lines, 1 file.

The line cap now trims at 10 lines instead of 11, and keeps 9 instead of 10. So a
description that is exactly 10 lines long loses its last line as you type.

The description says the old code let an 11th line through. It did not: `> 10`
fires on the 11th line and keeps 10.
```

**When you defer because of what a change touches, say that it looks correct if it does.** Otherwise the
author reads a deferral as an accusation and argues with you instead of finding a second reader.

---

## 5. Approve, when the answer is ✅

A green check is the only thing SAP does that changes what other people do next, so the decision does not
rest on remembering the rules. `approve.mjs` re-reads the gate's own output and refuses unless every
condition holds. Run it instead of `gh pr review` directly.

```bash
node agent/skills/sap/approve.mjs <pr> --repo owner/name \
  --triage /tmp/sap-<pr>.json \       # the --json file from step 1, not a retyped summary
  --sha <head-sha-you-triaged> \
  --body-file /tmp/sap-<pr>.md \      # the same text you would have commented
  --verdict safe
```

It refuses, listing every reason at once, when:

| Refusal | Why it is there |
| --- | --- |
| the gate said anything but `review-diff` | a "safe" conclusion must never outvote a tripped gate |
| `--verdict` is not `safe` | approving is a stated decision, not a side effect of running a script |
| the body does not say "Safe to merge" | the comment and the green check have to agree |
| head has moved since the triaged SHA | otherwise an unread commit inherits the approval |
| draft, closed, or conflicting | what would land is not what was read |
| a human already requested changes | never approve over a person |
| the PR is yours | GitHub rejects self-approval, so this reports it as a reason rather than an API error |

Add `--dry-run` to see the decision without submitting anything.

**The gate cannot catch a bad one-line change, and this is where that matters.** Every probe PR on this
fork is two lines, frontend only, and passes every mechanical check. One of them replaces a working banner
with `<div className="w-full h-5 bg-red">WTH!!</div>`. Another appends `Hllo` to a tooltip that ships to
customers. The gate says `review-diff` for all of them, correctly: its job is to decide whether a diff is
*small and dull enough to read*, not whether it is *right*. Step 3 is what decides that. If step 3 is a
formality, SAP is a rubber stamp with extra steps.

**If the approval is refused, post the triage as an ordinary comment and say plainly that no approval was
given.** Silence after a refusal reads like an approval that happened.

### Who SAP has to be to approve

GitHub rejects self-approval, so **SAP cannot approve a PR opened by the account it runs as.** Running it
locally against your own PR will always refuse, correctly, and that is not a bug to work around.

In CI it runs as a different identity and can approve. `.github/workflows/sweep-review.yml` already grants
`pull-requests: write` and runs as `github-actions` via `secrets.GITHUB_TOKEN`, which is enough to submit
review events. One prerequisite is a repository setting rather than a permission in the workflow file:
**Settings > Actions > General > Allow GitHub Actions to create and approve pull requests**. With it off, a
`GITHUB_TOKEN` run can comment but its approval is rejected. `approve.mjs` prints that as the reason when it
happens; reading the setting up front needs a scope SAP does not have, so it is not checked in advance. If
you would rather not enable it, run SAP with a PAT or GitHub App token for a bot account.

## 6. When SAP is the wrong tool

Say so and stop. SAP is wrong for a PR you were asked to review properly, anything already flagged by a
human, a revert of a production incident, or a change whose author asked for scrutiny. Escalating early
costs nothing.

Full review lives in `agent/skills/sweep/SKILL.md`.
