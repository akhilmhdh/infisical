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

## The finding line

```
<label> (<decoration>) · <severity> · <category> — <subject>
```

Rendered:

```
issue (blocking) · critical · security — Certificate policy read is not scoped to the caller's project
suggestion (non-blocking) · low · maintainability — Extract the three profile lookups into one query
question (non-blocking) — Is the 1h TTL floor still safe now that renewal is unattended?
nitpick (non-blocking) — `dataHash` here, `dataDigest` two files over
```

Rules:

- **`label` is required.** From the list below.
- **`decoration` is required** for `issue`, optional elsewhere. Default `non-blocking`.
- **`severity` and `category` are required for `issue`, omitted for `nitpick`, `praise`, `note`, and
  usually `question`.** A nit with a severity is a contradiction.
- **`subject` states the defect, not the topic.** "Read is not scoped to the project", not "scoping".

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

Six parts. A candidate that cannot fill location, impact, and evidence is not a finding.

```markdown
#### issue (blocking) · high · contract — Renaming the audit event breaks external detections

**Where:** `backend/src/ee/routes/v1/kmip-server-router.ts:608`

**Impact:** `audit_log.event_type` is shipped to customer SIEMs (`audit-log-queue.ts:134`) and is
filterable in the audit log UI. Any saved filter or detection keyed on `register-kmip-server` silently
stops matching, and the same activity is now split across two event types with no migration.

**Evidence:** the `/connect` handler previously emitted `EventType.REGISTER_KMIP_SERVER`; it now emits
`KMIP_SERVER_CONNECT`. `REGISTER_KMIP_SERVER` is still emitted from `kmip-router.ts:379`, so both types
are live and historical rows keep the old value. Verified the stream path carries the type string.

**Expected:** either keep emitting the old type alongside the new one for a deprecation window, or call
the break out in the PR description and the changelog so operators can update detections.

**Verified:** yes, by reading the queue and stream paths.
```

For a live-test finding, replace **Evidence** with the reproduction and attach artifacts:

```markdown
#### issue (blocking) · high · ux — Saving certificate config reports success but discards the TTL

**Where:** `KmipServerCertConfigModal.tsx:84` (found by live test, no exact line in the diff)

**Impact:** an operator clears a custom TTL, sees "Certificate configuration updated", and the old value
is still stored. Subsequent renewals keep the longer validity the operator meant to remove.

**Reproduction:** create a KMIP server with TTL `2d` → open Edit Certificate Configuration → clear the
TTL field → Save. Toast reports success. Re-open the modal: TTL is still `2d`.

**Evidence:** ![Step 4: success toast with stale TTL](https://<artifacts>/sweep/<run>/step-04.png)
▶ [Watch the replay](https://<artifacts>/sweep/<run>/replay)

**Expected:** clearing the field should send `ttl: null` so the stored value is cleared, or the field
should be read-only with an explicit "reset to default" action.

**Verified:** yes, reproduced twice on a clean org.
```

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
> 🤖 Automated review by **SWEEP** — not written by a human

## ⚠️ REQUEST CHANGES · `9e7122f`

Adds auto-renewal for KMIP server certificates: a new connect audit event, TTL removed from the UI,
docs updated. Reviewed the diff across 5 lenses and exercised the KMIP server create and cert-config
flows in a browser.

**Live test:** 6 steps run, 1 failure. [Replay](https://…/replay)

| # | Finding | Severity | Category | Where |
|---|---|---|---|---|
| 1 | Renaming the audit event breaks external detections | high | contract | `kmip-server-router.ts:608` |
| 2 | 1h TTL floor permits ~8,760 issuances/server/year | medium | reliability | `kmip-server-router.ts:34` |
| 3 | TTL is now invisible in the UI but still honoured by the API | low | ux | `KmipServerCertConfigModal.tsx:43` |

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

**Lenses:** tenancy ✅ · concurrency ✅ · data ⏭️ skipped (no schema change) · contract ✅ · product ✅
**Live test:** create server, edit cert config, clear TTL, verify persistence, deploy modal, docs links
**Not checked:** the KMIP daemon side (separate repository), AWS auth enrollment (no AWS creds in the
test org), audit log stream delivery to a real SIEM.

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
> 🤖 Automated review by **SWEEP** — not written by a human

**issue (blocking) · high · contract** — Renaming the audit event breaks external detections

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
