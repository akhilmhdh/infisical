# Reviewer Lenses

Five independent lenses. Each is a self-contained brief you hand to one subagent.

**Independence is the point.** A lens must not know what the other lenses found, or what the router
found. Convergence only means something if it was reached separately. Do not summarise one lens's
output into another lens's prompt, and do not tell a lens which danger factors triggered the escalation.

The lenses map onto the twelve moves in `SKILL.md`. Move **M1 (look for siblings)** is not a lens: it is
a technique every lens uses, so it appears in all five briefs.

**Behavioural verification is not one of these.** It needs the app running, so it is a separate phase in
`SKILL.md`, not a text lens.

---

## Handing off a brief

Give the subagent exactly this, filling in the placeholders:

```
You are reviewing one pull request in the Infisical monorepo through a single lens.

Repository context you must read first:
  - <repo>/sweep/references/repo-facts.md      (verified mechanisms)
  - <repo>/sweep/references/calibration.md     (shapes that were rejected here)
  - <repo>/sweep/references/domains.md         (only the sections your lens covers)

The diff: <path to diff file, or the gh command to fetch it>
HEAD SHA: <sha>

<paste the lens brief below>

You are one of several independent reviewers. You do not know what the others are looking at
and must not speculate about it. Report only what you can support from the code.

Read `SKILL.md` sections "Holding a suspicion" and "Findings" before you write anything.
End your output with the two blocks specified in "Output contract".
```

---

## Output contract

Every lens ends with these two blocks and nothing after them. The orchestrator parses them, so the
shape matters.

```
STRUCTURED_FINDINGS:
- file: backend/src/services/x/x-service.ts
  line: 214
  severity: BLOCKING | SHOULD_FIX | CONSIDER | NOTE
  type: correctness | security | reliability | performance | architecture | suggestion
  claim: <the defect in one sentence, stated as a defect>
  evidence: <what you actually read, including lines outside the diff>
  expected: <what correct looks like>
  verified: yes | no
  verification: <how you confirmed it, or exactly why you could not>
  moves: <which move numbers led you here, e.g. M2, M7>
OVERALL_SUMMARY: <two or three sentences: what this lens looked at and its overall read>
```

Rules that apply to every lens:

- **`verified: no` is allowed and honest.** It is not allowed to be hidden. An unverified finding gets
  downgraded or dropped at synthesis, which is the correct outcome, so do not dress up a suspicion as a
  confirmed defect to save it.
- **A finding with no `file`** (a behavioural or whole-PR observation) is fine. Set `line:` to `none` and
  say in `evidence` what you were doing. House style here is "ignore placement".
- **Report nothing rather than something weak.** An empty `STRUCTURED_FINDINGS:` list is a valid and
  common result.
- **Check every candidate against `calibration.md` before including it.** A candidate matching a rejected
  shape is dropped, not softened.

---

## Lens 1: Tenancy and Authorization

```
LENS: Tenancy and Authorization

You are looking for one thing above all: a caller-supplied identifier that is never proven to
belong to the caller's scope. Permission checks answer "may this actor do X in project P". They
do not answer "is the caId/envId/folderId/connectionId/domainId/templateId/groupId in this
request actually in P". The second question is the one that gets skipped, and every historical
instance of it going unasked was a real cross-tenant read or write.

For each such identifier: follow it to first use and find the assertion that ties it to the
authorized org or project. It may live in a scoped DAL method, a helper, or a query filter
further down. Read that code. Only if it genuinely is not there do you have a finding.

CRITICAL RESTRAINT: the absence of a literal projectId in a findOne filter proves nothing, and
concluding otherwise is the single most-rejected automated finding on this repository. Same for
an orWhere "bypassing tenant filters". See calibration.md items 1 and 2 before you write.

Also apply:
  M2  Which of the four actor kinds does this handle? User, group, machine identity, legacy
      service token. Permission resolution walks direct AND group memberships.
      `.whereNotNull("actorUserId")` silently drops groups and identities. A rate limit keyed
      per-actor rather than per-org is a bypass.
  M1  When you find one instance, check two or three siblings before reporting, then report the
      pattern with a count.

Also in scope:
  - Does an out-of-scope resource return NotFoundError rather than 403 or an error that names it?
    404 is the house default; a 403 is not automatically wrong if it leaks nothing.
  - Is the permission subject owned by the resource's own domain, or borrowed from a neighbour?
  - Is enforcement complete across sibling entry points, or applied at one and not the others?
  - Outbound requests to user-supplied URLs use safeRequest, not the validate-then-connect wrappers.
  - Does an error or response body disclose more than it should, including internal config?

Read in domains.md: "Auth, permissions, and multi-tenancy".

Every security finding must state who the attacker is and what trust boundary you assumed. Four
confident findings were rejected here for assuming a boundary the team does not hold; they are
listed in calibration.md item 2. If your finding depends on the boundary, ask rather than assert.

Out of scope for you: performance, naming, structure, UI, migrations except where one changes who
can reach what.
```

---

## Lens 2: Concurrency and Connections

```
LENS: Concurrency and Connections

This lens exists because nobody catches these by accident. Over two years this repository
received 383 automated comments and ZERO human ones on enqueue-after-commit, 28 versus 4 on a
missed transaction handle, 22 versus 2 on pool exhaustion. Read the diff deliberately for these.
They will not jump out at you.

The pool is TEN connections per instance. That single number is why these are correctness
problems rather than performance preferences.

M7. Count the connections, and check which clock you are using:
  - Every DB call inside a transaction() callback must receive `tx`. A call that omits it resolves
    (tx || db) and takes a SECOND connection, running outside the transaction. One request then
    holds two of ten, and at ordinary concurrency that is a deadlock that does not clear when load
    drops. Read the whole callback and confirm every await on a DAL method ends in `, tx)`. A
    trailing `)` where you expected `, tx)` is the entire bug. Follow every helper the callback
    calls: one that touches the DB must accept and forward `tx?: Knex`.
  - Flag a nested transaction() (pass the existing tx down) and any requestMemoize inside one.
  - Nothing slow between BEGIN and COMMIT: HTTP, cloud SDKs, KMS, HSM, gateway round-trips, email,
    webhooks, sleeps, retry loops, key generation, certificate signing, hashing, bulk crypto,
    unbounded row counts. Node is single-threaded, so CPU work blocks every other request too.
  - Enqueue jobs AFTER commit, never inside, or a worker picks up a job for an uncommitted row.
  - Reads default to db.replicaNode(). A read that gates a write can be defeated by lag; name the
    guard the stale read would defeat.
  - More than one clock: comparing an application timestamp against a database timestamp is a bug
    even when both are correct. More than one pod: anything that locks, schedules, caches, or
    counts must work with several running the same code.

M8. Ask what happens between the two writes:
  - If the second write does not happen, what does the world look like? Name the orphan rather
    than invoking atomicity abstractly.
  - In reverse: what if something succeeds too early, like an upstream credential revoked before
    our own commit?
  - Deletes: when this row goes away, what still points at it? Alerts reference resources by a
    plain string column with NO foreign key, so nothing cascades and each of a resource's several
    delete paths needs its own reap.

Also in scope: cron versus BullMQ (repeatables are cleaned up on boot and will double-execute),
cron handler idempotency at the timeout boundary, unguarded DAL calls in a worker turning a
transient error into a retry cycle, and rate-shaping DB-heavy background work.

M1: if you find a missed tx in one place, check the sibling service methods.

Read in repo-facts.md: "Data access" and "Background work".

Out of scope for you: authorization, naming, UI, API shape.
```

---

## Lens 3: Data and Lifecycle

```
LENS: Data and Lifecycle

M4. Ask what the rows that already exist look like. A migration is not code that runs once on an
empty database. It runs on every customer's database, cloud AND self-hosted, on versions we do
not control.

For every constraint, default, or backfill, try to name the concrete existing row that breaks it:
  - Duplicates before a unique index, including duplicates created by slugification.
  - Nulls before a not-null.
  - Rows the backfill never reaches, leaving them unusable.
  - A superseded constraint nobody dropped, so creates fail against the stale one. This happened.
  - A half-failed migration that gets re-run: does it survive, and does it bound its memory?
If you cannot name the breaking row state, you do not have a finding.

"Why is this nullable" and "how do we backfill" are the same question, and the answer determines
whether existing installs work after the deploy.

For every new foreign key: can the child meaningfully exist without the parent? That answer picks
CASCADE, SET NULL, or NO ACTION, not the default. Sometimes the right answer is for the delete to
FAIL as a safety guarantee.

Hard rule: a migration must never read the license or a feature flag, directly or through a
helper. Migrations run before the license service initializes, so the lookup returns its default
and the migration silently takes the wrong branch. This nearly re-encrypted data with the wrong
key once. Watch for licenseService, getPlan, entitlement lookups, getFeatureFlag,
getMigrationEncryptionServices without skipHsmLicenseCheck, isHsmActiveAndEnabled.

Also in scope:
  - Every FK column needs an index. Postgres does not auto-index them, and createJunctionTable
    creates CASCADE FK columns with no index on either side.
  - Enums belong in TypeScript, not Postgres (1 of 504 migrations uses table.enu).
  - A large-table index build needs CREATE INDEX CONCURRENTLY with config = { transaction: false }.
  - A migration with no regenerated src/db/schemas/ change is a missing step.
  - Column names carry their units, and sibling fields get names whose difference can be guessed.
  - Soft delete: reads must exclude soft-deleted rows, including counts feeding quota limits, and
    Environment.deleteAfter is not Project.deleteAfter.
  - Delete and detach paths must reap alerts, with the right one of the two helpers.

DO NOT REPORT: down-migration edge cases (this team does not roll back, two reviewers said so
independently), or that a migration should be wrapped in a transaction (it already is). Both are
in calibration.md as rejected shapes.

M1: schema changes come in families; check the sibling tables and migrations.

Read in domains.md: "Migrations and schema". Read in repo-facts.md: "Data access".

Out of scope for you: authorization, UI, API naming, provider behaviour.
```

---

## Lens 4: Contract and Consumers

```
LENS: Contract and Consumers

M3. Ask who calls this besides the UI. This is the highest-volume consideration in this
repository's review history: 451 comments from 28 people across 280 PRs. There are five
consumers and only the first is in this repo's frontend:

  1. React frontend        2. CLI        3. Go backend (same database)
  4. Kubernetes operator   5. External Terraform provider (separate repository)

The frontend can be trusted to send well-formed input because we wrote it. The other four cannot.
So:
  - Server-side validation is not redundant with the form. A field the UI always populates is a
    field Terraform will omit.
  - Silently coercing bad input is worse than rejecting it, because a Terraform user gets
    undebuggable drift instead of an error. This is why reviewers here say "throw" so often.
  - `value ?? existing` in a PATCH means a caller can never clear a nullable field. Distinguish
    "omitted" from "explicitly null".
  - A field the API fills in that the user did not set causes Terraform plan drift.

M11. Ask whether the name you are looking at is a contract. Before treating anything as internal,
check who else says that word: role slugs get resolved by name by SAML group provisioning, SCIM,
and project bootstrap; field names are mapped by the Terraform provider.

VERIFICATION REQUIRED before reporting a breaking change: grep the old name in
frontend/  backend-go/  cli/  k8-operator/
and then remember the Terraform provider is not greppable from here. A rename is breaking even
when the frontend is updated in the same PR. The repository's answer is a new route version plus
deprecation; it keeps deprecated-* routers rather than deleting routes.

M10. Look for the second source of truth. Any fact represented twice needs something keeping the
copies in sync, and usually nothing does: a value stored in two formats, a validator that enforces
a rule and a generator that ignores it, a frontend enum and a backend enum, a UI default and a
service default, one concept named two ways.

THE ERROR PATH IS PART OF THE CONTRACT, and this lens owns it. Enumerate EVERY catch block the diff
adds or modifies (`grep -nE '^\+.*\} catch' <diff>`) and answer three questions for each:
  1. What does it CONCLUDE from the failure? A catch that maps any error to one specific meaning is a
     bug generator: "why does any error thrown by this part mean the profile is using a legacy
     template? what if it was a Forbidden error?"
  2. What CONTEXT does it drop? Check what the surrounding helper already did to the error. A real
     finding here: a gateway proxy helper already wrapped every callback failure in a
     `BadRequestError`, so a catch that only special-cased `AxiosError` and re-threw everything else
     silently lost the operation context, turning "Failed to validate Chef credentials: 401" into a
     bare inner message. The catch looked correct in isolation.
  3. Does it SWALLOW? A bare catch with no log line, or a catch-all in a shared helper where every
     call site inherits it, is worse than no catch.

AUDIT EVENTS AND METRICS ARE CONTRACTS TOO, and this lens owns them.
  - An audit log event TYPE STRING is published: it is stored on the row, filterable in the audit log
    UI, and shipped to external SIEMs as `audit_log.event_type`. So renaming the event a route
    emits, or moving a route to a different event, silently breaks any saved filter or external
    detection keyed on the old string, and splits the same logical activity across two types with
    no migration. Nothing errors. Treat it exactly like a field rename: ask whether the break is
    intended and whether it is called out anywhere.
  - Every id-like field in an event's `metadata` body needs a human-readable label resolved at
    emission time (`groupId` plus the group's name), because a raw UUID is unactionable for an admin
    reading the audit log. An optional ID gets an optional label. Passing `undefined` for the label
    does NOT satisfy this; load the parent record. Scope is the event body, not the envelope.
  - A new mutating endpoint that emits no audit log is worth a question. So is an event body
    repeating what the envelope already carries.
  - New metrics go on the `InfisicalCore` meter with bounded attributes only. An attribute missing
    from the allowlist is silently dropped, so it is invisible data loss rather than an error. No
    per-tenant or per-actor identifiers as labels; those belong in the audit log.
  - Never log an outbound URL verbatim, since webhook URLs carry the secret in the path. Use
    `sanitizeUrlForLog`.

Also in scope:
  - Input bounds: every user-supplied string bounded with .max() matched to the real column width,
    .trim() on identifiers, .uuid() on IDs, z.nativeEnum for enums, z.coerce for querystring
    numbers, shared helpers reused rather than re-derived. Never .default(x).optional(), which
    silently never applies the default. Frame a missing bound that feeds a provider as an
    integration failure, not input hygiene.
  - Responses deliberately selected: never a DB row wholesale, since rows carry encrypted* and
    hashed* columns. Redaction belongs at the response schema layer.
  - New routes need config.rateLimit and onRequest: verifyAuth([...]) with only the modes that
    need access. API_KEY and SERVICE_TOKEN are deprecated.
  - Cert-manager routes must not accept projectId; the plugin resolves it.
  - A REST deviation is raised as a question with the conforming alternative, never as a verdict.

M1: API changes come in families; check the sibling routers and schemas.

Read in repo-facts.md: "Who consumes the API", "Errors", "Route boilerplate", "Observability".
Read in domains.md: "Audit logs and observability".

Out of scope for you: concurrency, migrations, UI implementation.
```

---

## Lens 5: Product and Behaviour

```
LENS: Product and Behaviour

You are the lens that asks whether this change is right, not just whether the code is correct.
On this repository that is where most of the value was: 15% of human review comments exist
because someone opened the app and formed an expectation, versus 0.53% of automated ones.

Start by stating, from the PR description, what the feature is supposed to do. Then read the code
against that expectation rather than against itself.

M9. Ask whether the capability makes sense for this specific variant. Generic code over a set of
variants (CA types, providers, resource types, auth methods) tends to expose capabilities some
variants cannot honour: issuing a code-signing certificate over ACME, key-usage policy fields
that ADCS ignores, an SSH-only endpoint reachable for every resource type, a check that excludes
a legitimate variant. Enumerate the variants and ask which actually support it. Exposing a knob
the backend ignores is a UX bug that looks like a feature.

M12. Ask whether this is the generation we are keeping. Almost everything exists twice
mid-migration: certificate templates and subscribers being replaced by profiles and applications,
v2 components by v3, two backends. Two ways to get this wrong: building new behaviour on the old
generation, and dismissing a real bug because it is in the old generation. The old code still
serves traffic.

M5. Ask what null, empty, and default actually mean. Absence is a decision and often a security
decision in disguise: null meaning "no restriction" rather than "not configured". Check that the
default in the UI, the service, and the database agree.

M6. Ask what the error path concludes from a failure. A catch that maps any error to one specific
meaning is a bug generator: "why does any error thrown by this part mean the profile is using a
legacy template? what if it was a Forbidden error?" Silently swallowing is not handling, and a
catch-all in a shared helper is worse because every call site inherits it. Check whether the
message tells the caller anything, and whether it tells them too much.

Also in scope:
  - Frontend, when the diff touches it: a second error toast where MutationCache.onError already
    reports (createNotification in a mutation's onError or catch produces two), v2 components or
    v2 color tokens where v3 exists, a permission gate missing the ABAC conditions the backend
    enforces, a list hook whose default limit silently truncates a picker at item 101, a mutation
    that changes state and invalidates nothing.
  - Does this look right in the UI, including for backend changes? A generated display name was
    rejected here because "Admin Admin would look a little bit weird in the UI".

M1: product behaviour comes in families; if one provider form or one CA type is wrong, check its
siblings.

Read in domains.md: "PKI and certificates", "Providers", "Frontend", whichever apply.

DO NOT REPORT: UI taste, layout, or copy preferences as defects. Backend conventions applied to
frontend code. A hide-versus-disable verdict for unpermitted actions, which is unsettled here.

Out of scope for you: transaction shape, migration mechanics, tenancy scoping.
```

---

## Provider verification, for whichever lens hits it

Pagination, rate limits, and field semantics of a third-party API are the class where invented
behaviour was caught here, and also where a real bug was confirmed, by the same reviewer, by testing.

**Cite the provider's documentation or say you could not verify.** Never infer pagination behaviour
from the shape of the response handling. If you cannot verify, the finding is a question:

> "Does this endpoint paginate? The sibling providers follow `total_pages` here, and I could not
> confirm from the provider's docs."
