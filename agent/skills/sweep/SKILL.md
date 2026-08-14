---
name: sweep
description: Review a pull request in the Infisical monorepo the way this team's best reviewers do, including exercising the change in a real browser and attaching video evidence for behavioural bugs. Use when asked to review a PR, review a diff, sweep a PR, review changes on a branch, or check a change before it merges. Produces a professional, categorised review with severities suitable for posting to GitHub.
---

# SWEEP

You are reviewing a change in the Infisical monorepo: secret management, PKI, and privileged access.
The product **is** a trust boundary, so a defect that would be cosmetic elsewhere can be a credential
leak here.

SWEEP does two things that ordinary automated review does not:

1. **It runs the software.** 15% of human review comments on this repository exist because someone
   opened the app and clicked something. Automated reviewers managed 0.53%. That gap is most of the
   value on the table.
2. **It produces evidence.** A behavioural bug gets frames and a replay attached, so the author sees the
   failure rather than reading a claim about it.

Your job is to find the few things that are actually wrong, prove them, and write them up so they can be
posted verbatim. **A review with two proven findings beats one with fifteen observations**, and "this
looks correct, here is what I checked and what I ran" is a complete review.

Knowledge source: `PR_REVIEW_CONTEXT.md` at the repo root, two years of this repository's review history
distilled into how to think. Read it if you need the reasoning behind anything here.

---

## Pipeline

```
                    PR or working diff
                            │
                  1  Scope and intent
                            │
                  2  Router pass + danger assessment
                            │
              ┌─────────────┴─────────────┐
        empty plan                   fan out
              │                           │
              │        3  Five independent lenses, parallel
              │           tenancy · concurrency · data · contract · product
              └─────────────┬─────────────┘
                            │
                  4  LIVE TEST  (references/live-testing.md)
                     bring up the PR build, drive the browser,
                     capture frames + replay on failure
                            │
                  5  Merge, converge, verification filter
                            │
                  6  Classify and verdict  (references/review-format.md)
                            │
                  7  Deliver: summary + inline comments (only if asked to post)
                            │
                  8  Triage existing threads  (references/triage.md)
                            │
                  9  Loop, max 3 rounds
```

---

## 1. Scope and intent

```bash
gh pr view <n> --json number,title,body,headRefOid,baseRefName,state,isDraft,url,author,additions,deletions,changedFiles
gh pr diff <n> > /tmp/sweep-<n>.diff
gh pr view <n> --json files --jq '.files[].path'
gh pr view <n> --json commits --jq '.commits[].messageHeadline'
```

State the intent in one sentence before reading code. Everything the PR does not claim to do is either an
accident worth flagging or out of scope, and you cannot tell which without this.

Note the HEAD SHA. Everything you report is tied to it.

**Eligibility:**

- **Open PR** → full pipeline.
- **Draft** → review and say so; do not post.
- **No PR, just a working diff** → diff against `main`, run the pipeline, terminal output only.
- **Merged or closed** → **retrospective mode**. Never post, never edit. Two traps: `gh pr diff` returns
  the **final** state including the "address review comments" commits, so a naive retrospective reviews
  already-fixed code and finds nothing. Decide deliberately:

  ```bash
  gh pr view <n> --json commits --jq '.commits[].messageHeadline'   # look for "address ... comments"
  git diff <base>...<first-substantive-sha>                         # roughly what reviewers first saw
  ```

  Review the final state to ask "is this good now". Review the first substantive commit to ask "would
  SWEEP have caught what the reviewers caught". Say which you did. For a recall measurement, compare
  against the real threads:

  ```bash
  gh api repos/:owner/:repo/pulls/<n>/comments --paginate --jq '.[] | "\(.user.login)\t\(.path)\t\(.body[0:160])"'
  ```

  Report three counts: what you and they both found, what only you found (check each against
  `references/calibration.md` before claiming it), and what they found that you missed. The last number is
  the real score.

---

## 1b. Model tier, effort, and how much to spend

Cost here is set by **how many agents you spawn**, not by which model they run. Measured on this
repository: architecture is a ~3.8x lever, model tier only ~1.7x. Spawning a five-lens swarm on a change
that did not need one is the expensive mistake; running the lenses on a cheaper model is not the fix.

**Assign tiers by stage, not uniformly:**

| Stage | Tier | Effort | Why |
| --- | --- | --- | --- |
| Router / danger scan | Haiku | n/a | Reading `--stat` and grep output against a fixed table. No judgement to lose. |
| Lenses 1-4 (tenancy, concurrency, data, contract) | **Opus** | `medium` | This is the bug-finding. Do not downgrade it. |
| Lens 5 (product / behaviour) | Sonnet | `high` | Behavioural reasoning, not the high-consequence classes. |
| Live e2e test | Sonnet | `high` | Driving a browser and asserting DOM. Cost is transcript volume, not reasoning. |
| Verification | **Opus** | `high` | It overturns real findings. Cheapening it defeats the point. |
| Synthesis | **Opus** | `high` | Writes the artifact a human reads. |
| Graph builder | *(none)* | n/a | `graph/build-graph.mjs` is deterministic. Zero model cost. Never ask a model to do this. |

**On Opus, lower the effort before you lower the tier.** Opus at `medium` costs about the same as Sonnet
at `high` and finds more. Reserve `xhigh` for a diff over ~800 lines; it buys little below that.

**Batch verification.** One verifier per finding is the single worst cost/value trade in the pipeline
(one agent's whole fixed prefix to check one claim). Give each verifier ~4 findings. Verification still
earns its place, because it has overturned findings that were already posted. Batch it, do not skip it.

**Share the lens prefix.** Order every lens prompt as `[repo docs + calibration + diff]` then
`[lens-specific brief]`, so the large half caches once and the other lenses read it at 0.1x. One caveat:
a cache entry is only readable once the first response *starts streaming*, so launch lens 1, wait for
first token, then fan out the rest. Firing all five at once means all five pay full price.

**Scale the whole thing to the diff.** Roughly 40% of merged PRs here are under 100 lines and do not
justify a swarm at all:

| Diff | Configuration |
| --- | --- |
| < 100 lines | Router + 2 lenses + 1 verifier. No live test unless UI changed. |
| 100-800 lines | Router + 4 lenses at `medium` + 2 batched verifiers. Live test only if UI or an endpoint changed. |
| > 800 lines, or any danger factor above | Full swarm, lenses at `high`/`xhigh`, 3 verifiers. |

Do not run the full swarm on every PR by reflex. **If the router's plan is empty, the router's findings
are the review**: that path is the normal one, and it is also the cheapest.

---

## 2. Router pass and danger assessment

One reviewer reads the whole diff first and returns findings **plus** a delegation plan. This keeps the
common case cheap: most changes do not need five lenses. **If the plan is empty, the router's findings are
the review.** That is the normal path, not a lesser one.

Danger factors, from where this repository's bugs actually were:

| Factor | Why it escalates |
| --- | --- |
| Permissions, roles, CASL, auth, session, MFA | Highest-value bug class here |
| A request accepting another resource's ID | Every unasked instance was a cross-tenant leak |
| A migration, constraint, index, or backfill | Runs on every customer's data, cloud and self-hosted |
| A `transaction()` callback, queue, or cron | Ten-connection pool, and humans never catch these |
| PKI issuance, renewal, revocation, or any crypto | CPU-heavy and security-critical |
| Provider credentials, app connections, rotations | Widest fan-out, credential handling |
| An outbound request to a user-supplied URL | SSRF and DNS rebinding |
| A rename or tightening of a published field | Four consumers live outside this repository |
| An audit log event defined, renamed, or re-pointed | The type string ships to customer SIEMs |
| Work becoming automatic or unattended | An event that fired on a human action now fires on a schedule |
| A delete or detach path | Alerts have no FK, so nothing cascades |
| A `catch` block added or modified | What it concludes from a failure, and what context it drops, is a repeat finding here |
| Diff over 400 lines, or a top-hotspot file | Router coverage degrades; risk concentrates |

Run the cheap mechanical scan rather than eyeballing it:

```bash
d=/tmp/sweep-<n>.diff
grep -cE 'transaction\(async' $d                       # transaction callbacks
grep -cE '^\+.*(delete|remove)' $d                     # delete paths
grep -cE 'blockLocalAndPrivateIpAddresses|safeRequest|https\.Agent|axios' $d
grep -cE '^\+.*z\.(string|object|boolean|number)' $d   # new input schemas
grep -nE '^\+.*\} catch' $d                            # every added catch: enumerate, do not skim
gh pr view <n> --json files --jq '.files[].path' | grep -cE 'db/migrations|permission|audit-log'
```

**Walk the catch blocks explicitly.** A SWEEP test run on PR #7557 found the SSRF and the missing request
timeouts but missed a third finding a human caught: a catch that re-threw without wrapping, dropping the
operation context because the surrounding helper had already converted the error. The knowledge was in the
skill; the run never read the error handling because it was focused on the request construction. Enumerate
them from the grep above rather than trusting that you will notice.

---

## 3. Lenses

Briefs are in `references/lenses.md`. Hand each subagent its brief verbatim, in parallel, one tool call
each. Do not run all five out of habit; run what the danger factors point at. Cap total delegations at six
across all rounds.

**Preserve independence.** No lens learns what another lens or the router found, and no lens is told which
danger factor triggered it. Convergence is only evidence if it was reached separately.

If a lens fails or returns nothing usable, mark it unavailable in the summary and continue. Never silently
drop one: a reader would mistake a partial review for a full one.

---

## 4. Live test

**This is the step that makes SWEEP worth running.** Full protocol in `references/live-testing.md`,
including the tunnel, the redaction rules, and the evidence contract. The short version:

- Decide whether the change is observable. Docs-only, types-only, or a pure refactor: skip it **and say
  so**.
- Bring up the PR build, expose it with `ngrok` (a Cloudflare browser cannot reach `localhost`).
- Build the plan from the PR's own "How to test" section, the UI surfaces the diff touches, and the claims
  in the description. Add the four probes that historically caught the most here: reopen after save, clear
  a previously set optional field, change a parent selector then check dependents, and act without
  permission.
- Run it. Frame per step, frame plus console plus failed requests on failure, rrweb recording for the
  session.
- **Retry once.** Passes on retry means `question`, not `issue`, and say it was flaky.

Two execution paths, same plan, same evidence shape:

```bash
# Cloud (postable URLs; needs a Cloudflare account and a deployed worker)
curl -sX POST https://<worker>/run -H "authorization: Bearer $SWEEP_TOKEN" \
  -H 'content-type: application/json' --data @/tmp/sweep-plan.json

# Local (real .webm video, artifacts on disk; no Cloudflare needed)
node agent/skills/sweep/local/run.mjs /tmp/sweep-plan.json --out /tmp/sweep-<n>
```

**Everything captured is destined for a public comment.** Test org only, `John Smith` /
`john.smith@example.com` / `example.com`, never a real credential, never your own identity. Check every
frame before it goes anywhere near GitHub. A finding with no artifact is still a finding; an artifact
leaking a customer name is an incident.

---

## 4b. Build the change graph

Run it on every review with a code change. It is what lets a reviewer see how the diff connects, UI page to
hook to router to service to dal, instead of reconstructing it by hand.

```bash
node agent/skills/sweep/graph/build-graph.mjs <base-sha> <head-sha> --pr <n> \
  --out /tmp/sweep-graph-<n>.json \
  --subset /tmp/sweep-graph-<n>-subset.json     # <- this is the file that gets posted
```

**Post `--subset`, not `--out`.** The full graph runs to hundreds of nodes and will not fit in a comment
(GitHub hard-limits at 65536 characters). The subset is the seeds plus whatever is directly wired to
them, which is the graph a reviewer actually wants: the change, the unchanged routers and services around
it, and the call labels on each edge.

Two things it deliberately does not expand, both reported in the output rather than dropped silently:

- **Hub modules** (over 40 importers). `audit-log-types.ts` has 208: adding one field to an audit event
  otherwise pulls in every router in the backend and buries the change in unrelated PAM and SCEP edges.
- **Definitional seeds.** A changed `*-types.ts`, `*-constants.ts` or `api-docs` module stays visible as a
  node but does not radiate; an edge into it means "uses a shared definition", which says nothing about
  this change's flow.

Use it while reviewing, not just as output: the traces tell you which backend paths a changed frontend file
actually reaches, which is exactly the "who calls this" question in M3, and a `service-call` edge names the
method a router invokes so you can jump straight to it. An `http-unresolved` edge is worth a look on its own,
since it means a frontend call whose route could not be matched.

Emit it into the summary per `references/review-format.md`: an ASCII trace for humans plus the
```` ```json sweep-graph ```` block for the extension. Render the trace, do not type it:

```bash
node agent/skills/sweep/graph/render-trace.mjs /tmp/sweep-graph-<n>-subset.json
```

**Never hand-draw the graph.** Paste the renderer's output and the subset JSON verbatim. If the builder did
not run, say so. Schema and limits are in `graph/README.md`.

Both scripts share `graph/route-resolve.mjs` with `where-to-test.mjs`, so a route-resolution bug shows up in
both tools at once. If an endpoint looks wrong in one, check the other before trusting either.

---

## 5. Merge, converge, verify

**Merge** findings that are the same defect, or within about five lines in the same file. Keep the
clearest statement and record how many lenses reached it independently. **Convergence raises confidence**
and belongs in the finding text, because it tells the author how much to trust it.

Then the filter that keeps this from becoming spam:

| Finding state | What happens to it |
| --- | --- |
| Verified | Keeps its severity |
| Unverified, converged across 2+ lenses | Downgrade one level, relabel `question` |
| Unverified, single lens | Drop, unless it is a critical security claim, which becomes a `question` naming what you could not confirm |
| Matches a shape in `references/calibration.md` | Drop, without softening |
| Pre-existing, not touched by this diff | At most one `note`, labelled pre-existing |

**Verification means:** you traced it in the code, you reproduced it in the browser, or you cited the
provider's documentation. Not "it looks like". Of the automated findings on this repository that anyone
answered, about a third were rejected, and verification is what separated the two groups.

`references/calibration.md` is not optional reading. It lists the shapes that fooled careful reviewers
here, including "proving an absence with a grep", which cost a previous SWEEP run a false positive.

---

## 6. Classify and verdict

`references/review-format.md` is the spec. Every finding gets:

```
<label> (<decoration>) · <severity> · <category>: <subject>
```

Labels from Conventional Comments (`issue`, `suggestion`, `question`, `nitpick`, `todo`, `note`,
`praise`). Severity only on `issue` (`critical`, `high`, `medium`, `low`). Category is one of `security`,
`correctness`, `reliability`, `data-integrity`, `performance`, `contract`, `maintainability`, `ux`,
`docs`, `test-gap`.

Verdict is deterministic: any `critical` or 2+ `high` → 🚫 BLOCKED; 1 `high` or 3+ `medium` → ⚠️ REQUEST
CHANGES; 1-2 `medium` or any `low` → 💬 COMMENT; only nits and notes → ✅ LOOKS GOOD.

**State the verdict. Never submit a GitHub review event** (`--approve`, `--request-changes`) unless
explicitly asked. Merge authority stays with a human.

**Budget:** more than about six findings on an ordinary PR means observations are being filed as problems.
Cut to what you would defend in person. On a genuinely large PR, group by theme rather than listing more.

---

## 7. Deliver

Produce the review in the format from `references/review-format.md`: verdict and SHA, one sentence of what
the PR does, whether the app was exercised, a findings table, findings in full in a `<details>`, and a
"what was checked and what was not" block. Silence reads as coverage, so name what you skipped.

**Default output is the terminal.** Posting to GitHub needs explicit permission in the current turn. When
posting is authorised:

**Write it plainly.** Short sentences, no jargon, no em dashes, no hedging. Say what breaks, why it
matters, how to check it, how to fix it. Full rules in `references/review-format.md`. A reviewer should
be able to act on a finding without rereading it.

- Every comment starts with the header:

  ```
  > [!NOTE]
  > 🤖 **SWEEP** review
  ```

- Inline comments batched into one review, one per finding with a real file and line. A finding whose line
  you are unsure of goes in the summary: a wrong line number is worse than none.
- One sticky summary per PR behind `<!-- sweep-summary -->`, upserted so re-runs edit in place:

  ```bash
  gh api repos/:owner/:repo/issues/<n>/comments --jq \
    '.[] | select(.body | contains("<!-- sweep-summary -->")) | .id'
  ```

**Post a "where to test this" comment whenever the change touches UI or a route.** It is a `note` -
informational, no severity, not a finding, and it does not affect the verdict. Reviewers here ask "which
screen is this on" and "what do I curl" on almost every full-stack PR, and both answers are derivable, so
nobody should be guessing:

```bash
node agent/skills/sweep/where-to-test.mjs <base-sha> <head-sha> --out /tmp/where.md --json /tmp/where.json
```

Deterministic, so it carries no model cost. What it does:

- **UI → screens.** Resolves each changed frontend file to the URL(s) that render it, taking route paths
  from `routeTree.gen.ts` (the generated tree already has the fully resolved path including pathless
  layouts, so nothing is re-derived by hand). Output is **grouped by route**: several changed components
  usually render on one screen, and **one screenshot per screen** is all a reviewer needs. Listing them
  per-component implies several rounds of setup for what is a single page visit.
- **API → endpoints.** Resolves changed router files to `METHOD /full/path` through the whole registration
  prefix chain, and splits them into **declaration changed in this PR** (test first) versus other endpoints
  in the same router files (regression surface).

Post it as its own comment behind `<!-- sweep-where-to-test -->`, upserted like the summary. Keep the
screens list to the shallowest hop the script reports and do not pad it: reachability past one import hop
drifts to pages that touch none of the changed code.

**Gate: every media URL must return 200 before the comment is posted.** Extract every URL from the
composed body and check it. A local commit is not a published one, so `raw.githubusercontent.com` 404s
until that commit is on the remote branch: this has already shipped a review whose three embeds were all
broken alt text.

```bash
grep -oE 'https://[^ )"]+\.(png|gif|jpg|webm|mp4)' /tmp/sweep-body.md | sort -u | while read -r u; do
  c=$(curl -sL -o /dev/null -w '%{http_code}' "$u")
  [ "$c" = 200 ] || { echo "ABORT: $c $u"; exit 1; }
done
```

On failure, do not post the embed. **Replace it with a sentence describing what the frame showed** and say
the artifact is unpublished. Broken images read as a malfunction and cost more credibility than plain prose.
`.webm` never renders as a player anywhere: use an animated GIF for motion and keep the `.webm` as a plain
file link. Details and the Pillow recipe: `references/live-testing.md`.

---

## 8. Triage existing threads

`references/triage.md`. Every unresolved thread ends fixed, dismissed with a named reason, or explicitly
deferred. The gate that matters most: **if any real person commented in a thread, defer it and touch
nothing.** This repository has seven automated reviewers posting, and about a third of their answered
findings were rejected, so the highest-value thing triage does here is retire those threads with an
auditable reason.

---

## 9. Loop

Stop when any is true: no new actionable findings this round, three rounds have run, only ambiguous or
human-deferred threads remain, or HEAD has not moved and nothing new was found. Re-reviewing an unchanged
diff produces the same findings and reads as noise.

---

## References

| File | Load when |
| --- | --- |
| `references/lenses.md` | Fanning out. Five independent briefs plus the structured output contract. |
| `references/live-testing.md` | Step 4. Tunnel, plan construction, evidence capture, redaction rules. |
| `references/review-format.md` | Step 6 and 7. Taxonomy, finding anatomy, verdict, comment formats. |
| `references/calibration.md` | **Always, before finalising.** Rejected shapes and how to hold a suspicion. |
| `references/repo-facts.md` | Before asserting any mechanism: the pool, replica reads, actor kinds, the five API consumers, deprecated surfaces, alert reaping, telemetry. |
| `references/domains.md` | The change touches migrations, auth, PKI, providers, audit logs, or frontend. |
| `references/triage.md` | Step 8. |
| `graph/` | Step 4b. The change-graph builder plus the JSON schema the GitHub extension consumes. |
| `worker/` and `local/` | The browser agent. `worker/README.md` has deploy instructions. |

Repository docs worth opening directly: `backend/CODE_QUALITY.md` for any backend change, `DESIGN.md` for
new UI or copy, `docs/STYLE_GUIDE.md` for docs, `backend/src/ee/services/pam/CLAUDE.md` before PAM work.
