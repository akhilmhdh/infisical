# Thread Triage

Closing the loop: every unresolved thread on the PR ends up fixed, dismissed with a reason, or
explicitly deferred to a human. Nothing is left dangling.

Adapted from PostHog's `the upstream triage skill` (Paul D'Ambra). The departures are listed at the end.

**Load this only when triaging an existing PR's threads.** A first-pass review with no prior threads does
not need it.

---

## Why this matters more here than upstream

This repository already has **seven** automated reviewers posting: `greptile-apps`, `claude`,
`chatgpt-codex-connector`, `coderabbitai`, `veria-ai`, `devin-ai-integration`, and `Copilot`. Between
them they produced 11,368 inline comments in two years, and of the ones a human bothered to answer,
roughly **a third were rejected**.

So triage here is not mainly about our own findings. It is about the large volume of pre-existing bot
threads, and the highest-value thing it does is **dismiss the ones matching known false-positive shapes**
so a human never has to read them again.

---

## Two gates that come before any classification

### Gate 1: the human-participation gate

**If any real person has commented in a thread, defer the whole thread and touch nothing.** Not the
thread, not the code it points at, not its resolved state.

One human reply makes the entire thread human. A person is engaged in that conversation and an agent
closing it is rude and destroys context. This is the rule most worth getting right, because getting it
wrong is socially expensive rather than just technically wrong.

Identify humans properly. A GitHub `Bot` typename is not sufficient, in either direction:

- Treat as a bot only on a **known account pattern** (the seven above) or the presence of an
  `🤖 Automated comment by` / `Automated review by` header.
- Everything else is a human, including accounts you do not recognise.

Two accounts on this repository read as bots and are **people**: `varonix0` and `x032205`. Both are
Infisical engineers.

### Gate 2: staleness

Skip a bot thread whose review references a commit that is not HEAD. It was written against code that no
longer exists, so acting on it is at best wasted and at worst wrong. Note it as stale rather than
resolving it.

**On a merged or closed PR every thread is stale by this rule, so triage has nothing to do.** That is the
correct answer, not a bug: there is nothing to fix and nothing may be posted. If the goal is to learn from
a past PR rather than to act on it, use retrospective mode in `SKILL.md` and read the threads as ground
truth instead of as work.

---

## Classification, for bot-only threads

Fetch comments trimmed to about 1,500 characters for classification. Re-fetch the full body only for a
thread you are about to act on.

### Actionable

All of these, not just some:

- A concrete fix, in a **single file**, with tight scope.
- Blocking or Should fix severity.
- You can state the defect and the fix without guessing at intent.
- It does **not** match any shape in `calibration.md`.

Action: apply the edit in the working tree. **Then stop.** Do not commit, do not push, do not resolve the
thread. Record it for the report. See "The push and resolve gate".

### Nit

Style only, already addressed by a later commit, duplicated by another thread, or out of scope for this
PR.

Action: record it for the report with the reason. Resolve the thread only if the human has authorised
resolving in this turn.

### Dismissed as a known false positive

**This is the category upstream does not have and the one that earns its keep here.** The thread matches
a shape in `calibration.md`:

| Shape | Typical thread |
| --- | --- |
| Query shape read as a tenant leak | "`findOne` has no `projectId` filter", "`orWhere` bypasses tenant isolation" |
| Assumed trust boundary | A security claim that depends on a boundary this team does not hold |
| Invented third-party behaviour | A pagination or rate-limit claim with no citation |
| Cross-stack rule | A backend convention applied to `frontend/`, for example `re2` |
| Down-migration edge case | "the rollback would fail on null values" |
| "Wrap the migration in a transaction" | Migrations already are |
| Inference-costing type suggestion | A `Record<...>` that breaks Knex inference |
| Cosmetic crusade | A codebase-wide rename attached to an unrelated PR |
| Pre-existing or adjacent | Flagged against this diff but not caused by it |

Action: record it as dismissed **with the specific shape named**, so a human can audit the dismissal and
disagree. Never dismiss silently and never dismiss without naming which shape it matched.

Before dismissing, check the finding is not a genuine instance of the underlying concern. The tenancy
concern behind the query-shape false positive is the strongest check in this repository. What is rejected
is the shortcut, not the concern, so read the surrounding check before concluding.

### Ambiguous

Anything else: multi-file, unclear intent, a product decision, a trade-off, or a finding you cannot
verify.

Action: run the autonomy ladder below.

---

## The autonomy ladder, for ambiguous threads

Three rungs. Pick one, and say which you picked and why.

**Just do it.** The outcome is unambiguously better and there is essentially one sensible way to get
there. Apply it in the working tree without asking, and mention it in the report. This rung is about
owning obvious improvements rather than asking permission for them.

**Do it, and say so.** Several valid approaches exist. Implement your preferred one, then surface the
decision with conviction rather than offering a menu:

> "I did X because Y. The alternative was Z, shout if you would rather Z."

**Stop and ask.** Reserved for two cases, and asking more often than this is itself the mistake:

1. The change would make the code worse in a way that matters: it stops expressing its intent clearly,
   duplicates something, or keeps something superfluous.
2. Genuine ambiguity, where you cannot tell which outcome is better, or the requirement is unclear enough
   to change the design.

On this repository, three specific things are always **stop and ask**, because the review context could
not settle them:

- Hide versus disable for an action the actor lacks permission for.
- Whether auto-adding an actor to a product on sub-resource assignment is still allowed.
- Whether the remaining `certificates.serialNumber` unique constraint is intended.

**If no ladder judgement is available** (no human to ask, running unattended), treat every ambiguous
thread as stop and ask. Defer it.

---

## The push and resolve gate

Upstream, actionable threads get fixed, committed, pushed, and resolved silently. **Here, two of those
four are gated:**

| Action | Allowed unprompted? |
| --- | --- |
| Edit files in the working tree | Yes, for actionable and for a "just do it" ladder rung |
| `git add` / `git commit` / `git push` / amend | **No.** Explicit permission in the current turn only |
| Resolve a GitHub thread | **No.** Explicit permission in the current turn only |
| Reply in a thread | No. Put reasons in the sticky summary instead |

The repository owner requires per-turn permission to commit or push, and permission given in one turn
does not carry to the next turn or the next round of the loop.

**On replying:** do not. The upstream skill resolves silently and never replies, and that is right here
too. Seven bots already generate volume in these threads, and a reply from an eighth participant makes it
worse. Every reason belongs in the one sticky summary, where it is auditable in a single place.

---

## Report

Extend the sticky summary from `SKILL.md` with a triage section. Counts first, then detail:

```
### Triage (HEAD abc1234)

Fixed in working tree: 3     (not committed, awaiting your review)
Dismissed as known FP: 5     (shape named for each)
Nits recorded: 2
Deferred to you: 4           (3 human threads, 1 ambiguous)
Stale, skipped: 1

**Fixed in working tree**
- `x-service.ts:88` missing `tx` on `findOne` inside the transaction (greptile) -> added `, tx`

**Dismissed**
- `y-dal.ts:140` "findOne has no projectId filter" (greptile) -> calibration.md shape 1:
  the scope check is in `assertResourceInProject` two frames up, which I read

**Deferred to you**
- `z-service.ts:12` thread has replies from @scott-ray-wilson -> human thread, untouched
- `w-router.ts:44` "should this be a v2 route?" -> ambiguous, product decision, stop and ask
```

Every deferred item states **why** it was deferred. "Deferred" with no reason is the same as dropped.

---

## Where this departs from the upstream triage skill

Kept: the human-participation gate, staleness skipping, the actionable / nit / ambiguous split, the
autonomy ladder as the gate for ambiguous, resolving without replying, trimmed fetch for classification
with a full re-fetch only before acting, bot identification by account pattern rather than typename, and
graceful degradation when a dependency is missing.

Changed on purpose:

| Upstream | Here | Why |
| --- | --- | --- |
| Actionable → fix, commit, push, resolve silently | Fix in working tree only; commit, push, and resolve each need explicit per-turn permission | The repository owner requires it, and silent resolution removes a human's ability to audit |
| Three classes | Four: a "dismissed as known false positive" class with the matched shape named | Seven bots already post here and about a third of their replied-to findings were rejected; naming the shape makes the dismissal auditable |
| Bot detection by account pattern | Same, plus two named human accounts that read as bots (`varonix0`, `x032205`) | Both are Infisical engineers and deferring their threads matters |
| Reasons recorded internally | Reasons published in the one sticky summary | Keeps the audit trail in a single place instead of scattering replies |
