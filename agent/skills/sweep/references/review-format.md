# Finding Taxonomy and Review Format

How SWEEP classifies a finding and how the review is written. The output goes into GitHub review
comments, so it has to read as professional work by a competent engineer.

Built from three inputs: the [Conventional Comments](https://conventionalcomments.org/) spec, the
severity conventions the automated reviewers already use on this repository, and the finding taxonomy in
`PR_REVIEW_CONTEXT.md`.

---

## Why this shape

Reviewers on this repository already read three different formats daily:

| Reviewer | Format it uses |
| --- | --- |
| `greptile-apps` | `P1` / `P2` / `P3` badge, plus a `Security` badge, then a bold title |
| `veria-ai` | `**High:** ` / `**Medium:** ` / `**Low:** ` then a title |
| `chatgpt-codex-connector` | `P1` / `P2` badge then a bold title |
| `coderabbitai` | `⚠️ Potential issue` / `🛠️ Refactor suggestion` |
| People | Prose, often a question |

So a severity-first line is already the house dialect and needs no explanation. What the existing bots
lack is Conventional Comments' **intent label**, which is what stops a suggestion reading as a demand.
SWEEP uses both: the label sets the tone, the severity sets the priority, the category says which kind of
risk, and the decoration says whether it blocks.

---

## How to write it

The author is busy and did not write this code five minutes ago. Every sentence has to earn its place.

**Write it so a smart teenager could follow it.** Not because the author is one, but because plain
language is the fastest way to be understood and the hardest place to hide a vague claim. If you cannot
say what breaks in one plain sentence, you do not understand the finding yet.

Rules, in order of how often they get broken:

1. **Say what happens, not what category it belongs to.** "The button does nothing when the field is
   empty" beats "improper validation feedback handling".
2. **One idea per sentence.** If a sentence has a comma and two clauses, split it.
3. **Name the thing.** Not "the handler" or "the component", but `updateFolder` and `FolderForm.tsx:161`.
4. **No em dashes.** Use a full stop or a colon. Short sentences do the same job better.
5. **Cut hedges.** No "it seems", "arguably", "potentially problematic". Either it breaks or it does not.
   If you are unsure, say "I did not verify this" in plain words.
6. **No jargon where a normal word exists.** "runs twice" not "double invocation". "slow" not
   "performance degradation". "not allowed" not "unauthorized access vector".
7. **Do not pad.** No "Great work overall, however". No restating the diff back at the author.

A quick test: read the finding out loud. If you run out of breath or hear yourself sounding like a
compliance document, rewrite it.

---

## The finding line

```
<label> (<decoration>) · <severity> · <category> · <what breaks>
```

Rendered:

```
issue (blocking) · critical · security · Anyone logged in can read folders from other companies
suggestion (non-blocking) · low · maintainability · Three profile lookups could be one query
question (non-blocking) · Is a 1 hour TTL still safe now that renewal runs unattended?
nitpick (non-blocking) · `dataHash` here, `dataDigest` two files over
```

Rules:

- **`label` is required.** From the list below.
- **`decoration` is required** for `issue`, optional elsewhere. Default `non-blocking`.
- **`severity` and `category` are required for `issue`, omitted for `nitpick`, `praise`, `note`, and
  usually `question`.** A nit with a severity is a contradiction.
- **The last part says what breaks, in plain words.** "Anyone logged in can read folders from other
  companies", not "insufficient tenant scoping on lookup". Someone skimming the PR list should
  understand the risk without opening the comment.

### Labels

Straight from Conventional Comments, restricted to the ones that carry their weight here:

| Label | Use when |
| --- | --- |
| `issue` | A specific problem that needs rectification. The only label that may block. |
| `suggestion` | A proposed improvement, not obligatory. |
| `question` | You have a potential concern but are not sure. **Use this for anything you could not verify**, and for anything that depends on a trust boundary or product decision. |
| `nitpick` | Trivial, preference-based. Always non-blocking, and the author may ignore it. |
| `todo` | Small, trivial, but necessary before merge. |
| `note` | Non-blocking, just something the reader should know. Use for pre-existing issues. |
| `praise` | Specific praise. Use sparingly and never as padding; it teaches what good looks like. |

Do not invent labels. `chore`, `thought`, `typo`, `polish`, and `quibble` exist in the spec but collapse
into the seven above here.

### Severity

Only on `issue`, and it drives the verdict.

| Severity | Bar |
| --- | --- |
| `critical` | Data loss, credential exposure, cross-tenant access, a deadlock condition, or a migration that fails on real customer data. Ship this and something breaks badly. |
| `high` | A real defect on a path that will be exercised, recoverable but wrong. |
| `medium` | A defect on an edge path, or a correct-but-fragile construction with a named failure mode. |
| `low` | Real but minor. Worth fixing, costs little either way. |

### Category

What kind of risk. One per finding, the closest fit.

`security` · `correctness` · `reliability` · `data-integrity` · `performance` · `contract` ·
`maintainability` · `ux` · `docs` · `test-gap`

Notes on the ones that get misused:

- **`security`** must name the attacker and the trust boundary assumed. Without that it is a `question`.
- **`data-integrity`** is for migrations, constraints, orphaned rows, and delete paths, as distinct from
  `correctness` in application logic.
- **`contract`** is for anything that breaks a caller outside this repository: a published field, a
  status code, an audit event type string.
- **`ux`** is for behaviour a user experiences, and is where live-test findings usually land.
- **`test-gap`** requires naming the specific untested path that this change makes risky. A generic
  "add tests" is not a finding.

### Decorations

| Decoration | Meaning |
| --- | --- |
| `blocking` | Should prevent merge until resolved. Reserved for `critical` and `high`. |
| `non-blocking` | Should not prevent merge. |
| `if-minor` | Resolve only if the fix turns out to be small. Good for `suggestion` on a large diff. |

---

## Anatomy of a finding

Four questions, in this order. They are the questions the author will ask anyway.

1. **What breaks?** One sentence.
2. **Why does it matter?** Who notices, and what do they see.
3. **How do I check it?** Steps to reproduce, or the command to run.
4. **How do I fix it?** A diff where possible.

Nothing else is required. Drop any part that would only restate another.

```markdown
#### issue (blocking) · high · contract · Renaming this audit event breaks customer alerts

Customers write alerts against `audit_log.event_type`. This renames
`REGISTER_KMIP_SERVER` to `KMIP_SERVER_CONNECT`, so every alert watching the old
name goes quiet. Nothing errors. It just stops firing, which is the worst way for
an alert to fail.

It also splits one activity across two names: `kmip-router.ts:379` still emits the
old one, and rows already in the database keep it too.

**How to check:** search the audit log UI for `register-kmip-server` before and
after this branch. Old rows still match, new ones do not appear.

**How to fix:** emit both names for one release so customers can migrate, or say
in the PR description and changelog that the name changed.

I traced this by reading `audit-log-queue.ts:134` to the stream. I did not run it.
```

A live-test finding replaces "How to check" with what you actually did, and attaches the evidence:

```markdown
#### issue (blocking) · high · ux · Saving says it worked, but the TTL you cleared comes back

Clear the certificate TTL, press Save, and a green "Certificate configuration
updated" appears. Reopen the dialog and the old value is still there. Nothing was
saved, and nothing said so.

This matters because the operator moves on believing the change stuck. Renewals
keep using the longer validity they meant to remove.

**How to reproduce:** create a KMIP server with TTL `2d`. Open Edit Certificate
Configuration. Clear the TTL field. Press Save. Reopen the dialog: still `2d`.

![The success toast, with the TTL still set behind it](https://<artifacts>/step-04.png)

▶️ **Recording:** [step-04.webm](https://<artifacts>/run.mp4) (12s)

**How to fix:** send `ttl: null` when the field is empty so the stored value clears.
If clearing is not meant to be allowed, disable the field and add an explicit
"reset to default" button.

Reproduced twice on a fresh organisation.
```

Notice what neither example does: no "Impact:" label on an obvious impact, no "Verified: yes", no restating
the diff. The verification note is one plain sentence at the end, and only when it changes how much the
reader should trust the finding.

---

## Verdict

Deterministic from the surviving findings. State it. **Never submit a GitHub review event**
(`--approve`, `--request-changes`) unless explicitly asked: merge authority stays with a human.

| Surviving findings | Verdict |
| --- | --- |
| Any `critical`, or 2+ `high` | 🚫 **BLOCKED** |
| 1 `high`, or 3+ `medium` | ⚠️ **REQUEST CHANGES** |
| 1-2 `medium`, or any number of `low` | 💬 **COMMENT** |
| Only `nitpick` / `note` / `praise`, or nothing | ✅ **LOOKS GOOD** |

---

## The summary comment

One per PR, upserted behind `<!-- sweep-summary -->`. Re-runs edit it in place.

```markdown
> [!NOTE]
> 🤖 **SWEEP** review

## ⚠️ REQUEST CHANGES · `9e7122f`

This adds automatic renewal for KMIP server certificates. It also renames an audit event, hides the TTL
field, and updates the docs.

I read the diff and ran the create and certificate-config flows in a browser. 6 steps, 1 failed.
[Recording](https://…/run.mp4)

| # | What breaks | Severity | Where |
|---|---|---|---|
| 1 | Customer alerts on the old audit event name go quiet | high | `kmip-server-router.ts:608` |
| 2 | A 1 hour minimum TTL allows ~8,760 certificates per server per year | medium | `kmip-server-router.ts:34` |
| 3 | The TTL field is hidden in the UI but the API still applies it | low | `KmipServerCertConfigModal.tsx:43` |

<details><summary>Findings in full</summary>

… each finding in the anatomy above …

</details>

<details><summary>Change graph</summary>

How this change connects, UI to data. Generated by `agent/skills/sweep/graph/build-graph.mjs`, so it is parsed from the
source rather than inferred, and every edge carries the file and line that produced it.

**23 traces · 133 nodes · 530 edges · 78 seam edges (76 high confidence, 2 heuristic)**

```
useWebAccessSession.ts  (hook, changed)
  └─ POST /api/v1/pam/accounts/:accountId/web-access-ticket
     └─ pam-session-router.ts  (router)
        └─ pamWebAccess.startSession
           └─ pam-web-access-service.ts  (service)
              └─ TPamAccountDALFactory
                 └─ pam-account-dal.ts  (dal)
```

```json sweep-graph
{ "version": 1, "pr": 7510, "nodes": [...], "edges": [...], "traces": [...] }
```

</details>

<details><summary>What was checked, and what was not</summary>

**Checked:** who is allowed to do what, database and queue behaviour, the API contract, and the UI.
Skipped the data lens because nothing in the schema changed.

**Ran in a browser:** create a server, edit the certificate config, clear the TTL, reopen to check it
saved, the deploy dialog, and the docs links.

**Did not check:** the KMIP daemon (it lives in another repository), AWS auth enrollment (no AWS
credentials here), and whether the audit event actually reaches a real SIEM.

</details>
```

Rules for the summary:

- **Lead with the verdict and the SHA it applies to.** A verdict with no SHA is meaningless after a push.
- **Say whether the app was exercised.** If the live test did not run, say so on its own line: a
  code-only review presented as complete is the worst failure mode SWEEP has.
- **The table is the whole review for a skim reader.** Findings in full go in a `<details>`.
- **Always include what was not checked.** Silence reads as coverage.
- **Include the change graph**, in a collapsed `<details>`, as an ASCII trace for humans plus a
  ```` ```json sweep-graph ```` block for the extension. The fenced block is the machine contract, so emit
  it verbatim from the builder and never hand-edit it. If the builder was not run, say so rather than
  drawing a graph by hand: an invented graph is worse than none.
- **No diff summary beyond one sentence.** The author knows what they wrote.
- **No praise padding.**

---

## Inline comments

Post one batched review, a comment per finding that has a real file and line. A finding whose line you
are unsure of goes in the summary instead: a wrong line number is worse than none.

Every inline comment starts with the bot header, then the finding line, then the anatomy. Keep inline
bodies short and put the long reasoning in the summary if it runs past a screen.

```markdown
> [!NOTE]
> 🤖 **SWEEP** review

**issue (blocking) · high · contract** · Renaming the audit event breaks external detections

`audit_log.event_type` ships to customer SIEMs, so a saved detection on `register-kmip-server` silently
stops matching. Historical rows keep the old value, splitting the same activity across two types.

**Expected:** keep both types for a deprecation window, or call the break out in the PR description.
```

---

## Restraint, in output terms

The format makes it easy to file findings, which makes restraint more important, not less.

- **Budget:** more than about six findings on an ordinary PR means observations are being filed as
  problems. Cut to what you would defend in person.
- **Every `issue` must survive `calibration.md`.** A match on a rejected shape is dropped, not
  downgraded to `question`.
- **Unverified becomes `question`, never `issue`.** Verification, not confidence, is what separated
  accepted from rejected findings on this repository.
- **One root cause, one finding**, listing every location. Not one finding per occurrence.
- **Pre-existing issues get at most one `note`**, labelled pre-existing. The most common rejection
  wording in this repo's history is "out of scope".
- **An empty review is a real outcome.** Say what you checked so the author can tell a genuine pass from
  a shallow one.
