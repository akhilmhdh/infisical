# How to Review a Pull Request in This Repository

This is a guide to **how to think**, not a checklist. It comes from reading two years of review
comments on this repository: 13,004 from people and 11,368 from automated reviewers, across 2,586
pull requests.

The specifics change every quarter. The thinking does not. What follows is the set of mental moves
that actually found bugs here, the traps that actually bit, and the calibration to tell a real
problem from a plausible-sounding one.

If you take one thing from this file, take section 2.

---

## 1. What this repository is, and why that changes how you read a diff

**The product is a trust boundary.** This is secret management, PKI, and privileged access. A bug
that would be a minor defect in most products is a credential leak here. When you are weighing
whether something matters, the question is not "would a user notice" but "does this let someone see
something that is not theirs".

**Everything is multi-tenant, at more than one level.** Org, then project, then sub-resources with
their own membership (PKI applications, signers, PAM resources). "Is this user allowed to do X" and
"is this thing they named actually theirs" are two different questions, and the second one is the one
that gets forgotten.

**There are two deploy targets, not one.** Cloud and self-hosted. So "existing data" is not one
dataset you can inspect. It is every customer's database, on versions you do not control, and a
migration that works on cloud data can still break a self-hosted upgrade. Reviewers here ask about
this constantly.

**Every API has about five consumers.** The React frontend, the CLI, the Go backend (a partial
rewrite over the same database), the Kubernetes operator, and an external Terraform provider. The UI
is one client, not the client. This single fact generates more review comments than any other
consideration: 451 comments from 28 different people, across 280 PRs, are about a caller that is not
the UI.

**There are ten database connections per instance.** Not a hundred. This is why transaction shape is
a correctness concern here rather than a performance nicety.

**Almost everything exists in two generations at once.** Two PKI subsystems (templates and
subscribers, being replaced by profiles and applications), two component libraries (v2 and v3), two
secret engines, two backends. So a constant question is not "is this code good" but **"is this the
generation we are keeping"**.

---

## 2. The habit that matters most: use the feature, do not just read the diff

This is the biggest difference between how people review here and how machines do, and it is not
close.

**15% of human review comments carry evidence that the reviewer actually ran the thing.** 1,792
comments contain a screenshot. 777 comments open with some version of "IGNORE PLACEMENT OF COMMENT",
because the reviewer found a behavioral problem that has no line number and attached it to whatever
line was nearby. 21 different people do this.

The automated reviewers, across 11,368 comments: 0.53% included a screenshot, and **zero** ever said
"ignore placement". They cannot, because they never opened the app.

What those comments look like:

> "I couldn't seem to edit the policy of the signer"

> "Upon enabling auto-renewal again it defaults to 20 for me but I can't actually save the
> configuration"

> "if you change the connection or project the advanced settings still show the old values in the UI
> but when you save they're cleared"

> "for discovered certificates, it looks like we're not showing any fingerprints?"

> "I couldn't edit the Max Request TTL back to empty after creating it with 1h"

None of these are findable by reading a diff. Every one of them is a real defect that shipped to
review and got caught because somebody clicked the button.

**So: before you reason about the code, form an expectation about what the feature should do, then
check whether it does that.** If you cannot run it, say so, and weight your review accordingly. A
review that only reads code is doing the part machines already do well and skipping the part they
cannot do at all.

Two corollaries:

- **A finding does not need a line number to be worth reporting.** The house style is to attach it
  anywhere and say "ignore placement". Do that rather than dropping a real observation because it has
  no home in the diff.
- **"Does this look right in the UI" is a legitimate review question**, including for backend
  changes. One reviewer rejected a display name because "`Admin Admin` would look a little bit weird
  in the UI".

---

## 3. The thinking moves that find bugs here

These are ordered by how often they paid off, and each one is a question you ask the diff rather than
a rule you check it against.

### 3.1 When you find one instance, look for its siblings

The most common review move in the corpus. 105 comments from 13 people say some version of "same
applies to all the others".

> "applies to all forms"  ·  "same applies to all invocations"  ·  "this comment applies to all
> routes"  ·  "single comment but applies to all cert subject condition references"

**Why it pays off here specifically:** this codebase is built out of large families of near-identical
modules. 89 app connections, 55 secret syncs, dozens of PKI sync destinations, one file per CA type,
one form per provider. A bug written once in that pattern is almost never written once.

**How to use it:** when you find something wrong in one member of a family, go look at two or three
siblings before you write the comment. Then report the pattern with a count, not the single instance.
The inverse is also worth checking: if the PR fixes something in one sibling, does the same bug
remain in the others?

**Where this pointed at real bugs:** a Cloudflare file where one list function paginated correctly
and two next to it silently returned only the first page. That is the shape.

### 3.2 Ask who else can be the actor

An actor here is a user, a group, a machine identity, or (legacy) a service token. Permission
resolution walks direct memberships *and* group memberships. Code that assumes "user" silently drops
the rest.

> "I notice in a bunch of places we do `.whereNotNull("actorUserId")` but wouldn't that mean we skip
> groups and machine identity members"

> "Won't this make it possible for users to bypass rate limits by using multiple Machine Identities?
> Or calling `login` again to generate a new bearer token? Shouldn't we use the `orgId` instead here?"

> "Looks like it's missing the identity group org permissions? Same for the identity group project
> permissions"

24 comments from 14 different people, which is unusually broad agreement for that volume. That
breadth is the signal: this is not one person's hobby horse, it is something many reviewers
independently trip over.

**How to use it:** any time you see a query filter, a permission check, a rate limit key, or a
membership lookup, name all four actor kinds and ask which ones the code handles. Rate limits keyed
per-actor rather than per-org are a bypass. Queries keyed on `actorUserId` are incomplete.

### 3.3 Ask who calls this besides the UI

The single highest-volume consideration in the corpus: 451 comments, 28 authors, 280 PRs.

The frontend can be trusted to send well-formed input because we wrote it. **Terraform, the CLI, the
operator, and direct API callers cannot.** This flips several intuitions:

- **Server-side validation is not redundant with the form.** A field the UI always populates is a
  field Terraform will omit.
- **Silently coercing bad input is worse than rejecting it**, because a Terraform user gets undebuggable
  drift instead of an error. This is why reviewers here say "throw" so often.
- **A field the API fills in that the user did not set causes Terraform plan drift.** "there's going to
  be inherent drift due to the fact that the API is pre-filling value for something that's not
  explicitly defined by the user in the terraform configuration."
- **PATCH has to distinguish "field omitted" from "field explicitly null"**, or a Terraform user can
  never clear a value. `value ?? existing` quietly makes clearing impossible.
- **A rename is a breaking change**, even if the frontend is updated in the same PR, because the other
  four consumers are not in this repository. Reviewers repeatedly caught this: "wouldn't this be
  breaking?" and "Some folks may still be on the v1 secrets router".

**How to use it:** for every input, ask what happens when it arrives without the UI's help. For every
output, ask who parses it.

### 3.4 Ask what the rows that already exist look like

A migration is not code that runs once on an empty database. It runs on every customer's data,
including self-hosted installs on unknown versions.

> "have you checked our prod data to ensure that this won't throw any error due to duplicates? this
> might be problematic for self-hosted users"

> "if we have multiple pam projects that slugify to the same name this will break the unique
> constraint and break the migration"

> "I don't think the migration ever sets the gateway override on the account, so all the existing
> accounts would be migrated without gateways and would be unusable"

**How to use it:** for any constraint, default, or backfill, try to name the concrete existing row
that breaks it. Duplicate values before a unique index. Nulls before a not-null. Rows the backfill
does not reach. A superseded constraint nobody dropped, which is a real bug that happened here: the
new constraint was added and the old narrower one left in place, so creates started failing against
the stale one.

Then ask the second question: **if this migration half-fails and gets re-run, what happens?**

**What experienced reviewers here do NOT worry about:** the `down` migration. Two of them said so
independently, "this is expected" and "technically we don't roll back". Do not spend attention there.

### 3.5 Ask what null, empty, and default actually mean

57 comments, 15 authors. Absence is a decision, and it is often a security decision wearing a schema
disguise.

> "Why is it not nullable? Couldn't it be null if the user doesn't define any allowed usernames? In
> which case, all users would be allowed to authenticate"

That is the shape to watch: **null meaning "no restriction" rather than "not configured".** Also
worth asking: what does the default do to existing rows that predate the column, and does the default
in the UI match the default in the service and the default in the database?

### 3.6 Ask what the error path concludes from a failure

A catch block that maps any error to one specific meaning is a bug generator.

> "why does any error thrown by this part mean that the certificate profile is using a legacy
> template? what if it was a Forbidden error?"

That is the cleanest example in the corpus of a thinking move you will not get from pattern matching.
The code was not wrong in its happy path. It was wrong about what a failure *implied*.

Related, and repeated by six different people: **silently swallowing is not handling.** "throw. let's
see to it that we're not silently handling failures since that would make it confusing to use." And
on a shared helper, which is worse because every call site inherits it: "the approach of try-catching
and swallowing an error is kinda concerning ... scope the catch to that specific case and then fall
through, rather than being a catch-all."

Also ask: **does the error tell the caller anything?** The reader is not looking at our code. And does
it tell them too much? One reviewer trimmed an error "to just the rejected ones so we're not leaking
the whole allowlist".

### 3.7 Count the connections, and check which clock you are using

This is the cluster of concerns that humans almost never catch and that costs the most in production.
Be deliberate here, because it will not jump out at you.

**The pool is ten.** A transaction holds one connection from BEGIN to COMMIT. So:

- Any database call inside a `transaction()` callback that does not receive `tx` takes a **second**
  connection and runs outside the transaction. One request now holds two of ten. At ordinary
  concurrency that is a deadlock that does not clear when load drops. A trailing `)` where you
  expected `, tx)` is the whole bug, and it is invisible unless you look for it on purpose.
- Anything slow between BEGIN and COMMIT holds a connection and its locks for that long: network
  calls, KMS or HSM, key generation, certificate signing, hashing, bulk crypto, unbounded row counts.
  The best statement of it in the corpus names the abuse case: move self-signed certificate creation
  out of the transaction because "it could be problematic when someone spams this endpoint maliciously
  which would consume all the available client connections to our DB".
- Enqueue a job **after** commit, or a worker can pick up a job for a row that does not exist yet.

**Reads go to a replica by default.** So a read that gates a write can see pre-write state. Ask
whether the guard you are looking at can be defeated by lag.

**There is more than one clock, and more than one pod.** Two subtle catches worth internalising:

> "could it be problematic that for `staleThreshold` we're using the instance time but
> `heartbeat_updated_at` is database time?"

> "What about other instance on horizontal scaling?"

Comparing an application timestamp against a database timestamp is a bug even when both are correct.
And anything that coordinates (a lock, a schedule, a cache, a counter) has to work with several pods
running the same code.

**Calibration on this whole section:** over two years these produced 383 automated comments and zero
human ones on enqueue-after-commit, 28 versus 4 on missed `tx`, 22 versus 2 on pool exhaustion. Do
not read that as "unimportant". Read it as "nobody sees this by accident", which is exactly what
`backend/CODE_QUALITY.md` says about it.

### 3.8 Ask what happens between the two writes

When a change writes twice, ask what the world looks like if the second one does not happen.

Reviewers here name the orphan every time rather than invoking atomicity in the abstract:

> "we should make it so that certificateRequest and the actual certificate entity is created in one
> transaction for internal CAs else we might end up with orphaned certificate requests"

> "if `removeActorFromApplicationMemberships` fails due to a transient issue then it would be
> orphaned no?"

> "wouldn't it be potentially expensive to hold an orphaned HSM slot? we should add a clean-up if the
> transaction does end up throwing"

The same question in reverse is just as productive: **what does the first write do if the second one
succeeds too early?** A credential revoked upstream before our own commit leaves a dead connection
when the transaction rolls back.

And the deletion version, which is the one people forget: **when this row goes away, what still
points at it?** Alerts in this codebase reference resources by a plain string column with no foreign
key, so nothing cascades and every delete path has to clean up after itself. A resource usually has
three delete paths (a hard delete, an org-membership removal, a project-membership removal) and each
one needs it.

### 3.9 Ask whether the capability makes sense for this specific variant

Generic code over a set of variants (CA types, providers, resource types, auth methods) tends to
expose capabilities that some variants cannot honour.

> "I don't think you're able to issue a code signing certificate using ACME anywhere... does it make
> sense to be able to do that with ACME?"

> "if they're using ADCS, they shouldn't have any policies defined for the key usages, extended key
> usages"

> "it looks like this endpoint would be available for the other resource types as well"

> "I'm pretty sure that govslack is an enterprise-only feature of Slack. in that case, wouldn't this
> mean that this check would prevent govslack connections from working entirely?"

**How to use it:** when a PR adds a field or an action to a shared abstraction, enumerate the variants
and ask which ones actually support it. Exposing a knob a backend ignores is a UX bug that looks like
a feature.

### 3.10 Look for the second source of truth

> "why do we store both json and non-json format at the same time?"

> "if the validation can actually enforce this (regex and len) why do we not ensure generation adheres
> to this?"

> "Why are we calling this DataHash in some places and Data Digest in others?"

Any time the same fact is represented twice (two columns, two formats, a validator and a generator, a
frontend enum and a backend enum, a UI default and a service default), ask what keeps them in sync.
Usually nothing does.

### 3.11 Ask whether the name you are looking at is a contract

Before treating something as internal, check who else says that word. A column name reached by
slug lookups, a field the Terraform provider maps, a role slug that SAML group provisioning resolves
by name. One reviewer laid out exactly why a rename was blocked:

> "A bunch of stuff resolves these by slug, not id: the org default membership role, SAML group
> provisioning (looks up no-access directly), project bootstrap, SCIM, etc. Renaming or deleting would
> break those lookups"

### 3.12 Ask whether this is the generation we are keeping

Extending the deprecated half of a migrating subsystem is a common and expensive mistake here,
because the code looks perfectly healthy. Certificate templates and PKI subscribers are being
replaced by profiles and applications. v2 components are being replaced by v3. There are
`deprecated-*` routers kept alive deliberately for the API contract.

Two directions to get this wrong: building new behaviour on the old generation, and dismissing a real
bug because it is in the old generation. The old code still serves traffic.

---

## 4. Where the bugs actually were

Attention priors, from comment density and from what turned out to be real. Use these to decide where
to spend your time, not as places to go hunting for something to say.

**The recurring real defects, in rough order of how often they were genuine:**

1. A caller-supplied ID that was never checked against the caller's scope. Every instance was a real
   cross-tenant read or write.
2. A migration meeting data that already existed.
3. A UI that did not do what the feature claimed, found by using it.
4. A silent failure: swallowed, coerced, or defaulted where it should have thrown.
5. A list call that read only the first page of a paginated third-party API.
6. Something that worked for users and broke for groups or machine identities.
7. A transaction holding a connection through network or crypto work.
8. A rename or tightening that broke a non-UI caller.

**The hottest files** are worth knowing because they concentrate risk: PAM account and session
services, the secrets v2 bridge, `audit-log-types.ts`, `project-permission.ts`, `certificate-v3`,
`auth-login-service.ts`. The densest directories are `backend/src/ee/services`,
`backend/src/server/routes`, `backend/src/db/migrations`, and the app-connection and secret-sync
families.

---

## 5. How to hold a suspicion

The corpus contains a lot of confidently wrong review. Roughly a third of the automated findings that
anyone bothered to answer were rejected, and the rejections cluster into shapes worth recognising.

**The discriminator is verification, not instinct.** The clearest evidence is one reviewer reaching
opposite conclusions about the same class of finding twice, both times by testing:

> "Not sure from where claude got this info, but this is not true. On the API does not exist any
> comment about this, and the env variable endpoint is not even paginated. Did a local test with more
> than 30 env vars and the endpoint continued to return everything."

> "I was wrong. I did a test in another PR that had this query and the max page was breaking the type,
> but I checked again and this works."

So: **a suspicion is a reason to go look, never a reason to comment.** Trace it in the code, run it,
or cite the provider's documentation. If you cannot, either say plainly that you could not verify, or
drop it.

**Shapes that fooled careful readers here:**

- **A query shape is not a vulnerability.** "This `findOne` has no `projectId` filter" was rejected
  because the check was elsewhere and the code returned a 403 that leaked nothing. "This `orWhere`
  breaks tenant isolation" was rejected because there were no other where clauses to bypass. Read the
  surrounding check before you conclude.
- **A trust boundary you assumed is not a trust boundary the team assumed.** Four confident security
  findings were rejected by the engineers who own those areas: any org identity being allowed to sign
  an intermediate is deliberate, command blocking is "a soft control not a security boundary", a null
  `orgId` means "shareable with external users", and public DNS in discovery is intentional because
  the gateway resolves private domains. **If your finding depends on what the boundary is, ask, and
  say what you assumed.**
- **Invented external behaviour.** Claims about a third-party API need a citation or a test.
- **Rules applied across the wrong stack.** A backend regex convention was applied to sidebar
  navigation and rejected with "not a concern for frontend".
- **Suggestions that cost more than they buy.** A `Record<...>` type suggestion was rejected because
  it "would loose the knexjs ts type inference".

**And the most common rejection of all: "out of scope."** Pre-existing issues, adjacent problems, and
codebase-wide cleanups presented as findings against this diff. A pre-existing issue is worth at most
one clearly labelled note. One reviewer's answer to a spelling fix is the whole lesson: "It's spelled
wrong everywhere. One day we'll fix up the spelling mistakes across the codebase. *One day*."

---

## 6. What not to spend attention on

Experienced reviewers here do not comment on these, and several actively reject them:

- Down-migration robustness. The team does not roll back.
- Whether a migration is wrapped in a transaction. It already is, by default. The genuinely useful
  inverse is whether a large-table index build needs to opt *out* so it can run concurrently.
- Formatting, import order, and lint. `make reviewable-api` and `make reviewable-ui` handle it.
- Naming you would have chosen differently, unless the current name actively misleads.
- "This function is long" with no proposed split and no payoff. The request that landed named the three
  functions to split into *and* the reason: it would let the pieces be tested. And the counterweight
  exists too, a file split unnecessarily was asked to be merged back.
- "This is duplicated" without naming the existing helper. Also note a lead reviewer arguing the other
  way: service-scoped constants should stay co-located, not hoisted into a central file.
- Adding tests as a generic request. Testability shows up here as a *reason* for a specific
  refactor, not as a standalone ask.
- Generic advice of any kind. "Consider adding error handling" says nothing.

---

## 7. Working order for a diff

1. **Read the intent.** Title, description, ticket, commits. Everything the PR does not claim to do is
   either an accident or out of scope, and you cannot tell which without this.
2. **Run it if you can.** Form an expectation, then check it. This is section 2, and it is the highest
   value thing you will do.
3. **Read the whole diff, including what is missing.** A migration with no regenerated schema, a new
   service with no wiring, a renamed field with no frontend change, deleted code nobody mentioned.
4. **Read around each hunk.** Callers, siblings, the pre-existing pattern. You cannot judge five lines
   from five lines.
5. **Apply the moves in section 3** that the change actually invites. A styling change does not need
   the transaction questions. Do not run all twelve on everything.
6. **Verify each suspicion** before it becomes a comment (section 5).
7. **Consolidate.** One root cause, one comment, listing the places it appears. Not one comment per
   occurrence.
8. **Cut.** If you have more than a handful of findings on an ordinary PR, most of them are
   observations rather than problems. A review with two real findings beats one with fifteen
   observations, and "this looks correct, here is what I checked" is a legitimate and useful review.

---

## 8. What this file cannot tell you

Honest gaps, so nobody mistakes silence for coverage.

- **The Go backend, the CLI, the Kubernetes operator, Helm charts, CI, and the WASM crates** carry too
  little review history to generalize from. Review them on ordinary engineering grounds.
- **Docs** drew 1,339 human comments and produced no distinctive thinking pattern, except one worth
  keeping: the comments were overwhelmingly about **factual accuracy against the code**, not prose.
  Documented flags that did not exist, a Helm selector that would match zero pods. Check claims against
  the implementation.
- **Testing conventions** never emerged as a review theme in their own right.
- One belief in the corpus is worth flagging as **probably wrong**: that an error thrown inside a
  transaction reaches the client as a 500. A lead reviewer said so and used it to justify moving
  validation before `BEGIN`. Reading the code, the transaction helpers propagate the error unchanged
  and the error handler dispatches on the error class, so a `BadRequestError` should still render as a
  400. Moving validation earlier is still right, for the connection-holding reason in 3.7. The stated
  mechanism is not.
- **Where the useful comments came from** is itself information: the reviewers whose comments most
  often turned into fixes were the ones who ran the feature, knew which generation of a subsystem was
  current, and knew which callers lived outside this repository. None of that is in the diff. It comes
  from having the product in your hands and knowing what else depends on it.
