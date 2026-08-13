# Calibration

Read before finalising findings.

Roughly a third of the automated findings on this repository that anyone bothered to answer were
rejected. The rejections are not random: they fall into a small number of recognisable shapes. Checking
against them is cheap and catches most of what would otherwise waste an author's time.

**Of the automated findings that drew a human reply: about 511 accepted, 260 rejected.** The other ~80%
of automated comments drew no reply at all, which is evidence in neither direction.

---

## The one thing that separates accepted from rejected

Verification. Not instinct, not confidence, not severity language.

The clearest proof is one reviewer reaching opposite conclusions about the same class of finding, twice,
both times by testing:

> **Rejected:** "Not sure from where claude got this info, but this is not true. On the API does not
> exist any comment about this, and the env variable endpoint is not even paginated. Did a local test
> with more than 30 env vars and the endpoint continued to return everything."

> **Accepted:** "I was wrong. I did a test in another PR that had this query and the max page was
> breaking the type, but I checked again and this works."

**A suspicion is a reason to go look. It is never a reason to comment.** Trace it in the code, run it,
or cite the source. If you cannot, say plainly that you could not verify, or drop it.

---

## The rejected shapes

### 1. A query shape treated as a vulnerability

Two specific false-positive generators, both rejected by reviewers:

- **A `findOne` with no literal `projectId` in the filter.** Rejected: "This is fine. We throw an
  appropriate error with a 403 status code in this case and don't leak any information." The check
  existed elsewhere.
- **`orWhere` on the root query "bypassing tenant filters".** Rejected: "there's no other where
  conditions so this is safe."

The underlying concern (does a caller-supplied ID get scoped?) is the highest-value check in the whole
repository. What is rejected is the **shortcut**. Read the surrounding check before you conclude.

### 2. A trust boundary you assumed but the team does not hold

Four confident security findings, four different domains, each rejected by the engineer who owns that
area:

- **Intermediate CA signing open to any org identity.** Intentional: requiring extra permissions on the
  proxy's machine identity "only adds setup friction", and misuse already requires intercepting the
  agent's network traffic.
- **Command-blocking rules readable by project members.** "command blocking is just a soft control not
  a security boundary."
- **A null `orgId` on a shared secret permitting access.** "False positive: if `sharedSecret.orgId` is
  empty, it means a secret that can shared to external users."
- **Public DNS resolvers in PKI discovery.** "this is intentional. Private/internal domains are
  resolved by the gateway itself, which runs on the private network."

**If your finding depends on what the boundary is, ask, and state the boundary you assumed.**

### 3. Invented third-party behaviour

Pagination, rate limits, field semantics, required-versus-optional. Claims about a provider's API need a
docs citation or a test. See the pagination example at the top of this file.

### 4. A rule applied across the wrong stack

A backend regex convention (`re2`) was applied to sidebar navigation files and rejected: "not a concern
for frontend". Backend conventions, telemetry rules, and server-side input-bound rules do not
automatically transfer to `frontend/`, and vice versa.

### 5. Down-migration edge cases

"The rollback attempts to make `gatewayId` not nullable, but if any rows have null values this will
fail." Rejected: "this is expected." Independently, another reviewer: "technically we don't roll back so
this should be fine." Do not raise these.

Still valid and different: concurrent async transactions **inside** a migration are an antipattern.

### 6. "Wrap this migration in a transaction"

They already are, by knex default. Two reviewers said so independently. The useful inverse is whether a
large-table index build needs to opt out with `transaction: false` so it can run concurrently.

### 7. Suggestions that cost more than they buy

A `Record<IdentityAuthMethod, TableName>` suggestion was rejected: "No that would loose the knexjs ts
type inference." Typing changes around Knex query builders and the Zod type provider need checking
against what they cost in inference before being suggested.

### 8. Codebase-wide cosmetic crusades attached to an unrelated PR

A request to fix `infisicalSymmetricEncypt` was rejected: "It's spelled wrong everywhere. One day we'll
fix up the spelling mistakes across the codebase. *One day*." A pre-existing, consistently applied
misspelling is not this PR's problem, and fixing it in one place makes consistency worse.

### 9. Proving an absence with a grep

"There is no cleanup", "nothing validates this", "this is never released" are claims about something
**not** existing, and a grep for names you guessed cannot establish them. The function will be called
something you did not think of.

This one is not from the corpus, it is from testing this skill: a run nearly reported "uploaded private
key files are never deleted from the appliance" on a PR that contains `cleanupUploadedSourceFile`, calling
`unix-rm`, three lines away from the upload calls. The grep had looked for `deleteFile|unlink|cleanupFile`.

**Before claiming an absence, open the file and read the surrounding function.** If you still believe it,
say what you searched for and read, so the author can correct a wrong assumption in one sentence.

### 10. Pre-existing and adjacent issues framed as blockers

**The most common rejection wording in the corpus:** "out of scope", "this is fine for now",
"pre-existing". Six clear examples, including deliberately discarding old data ("no one is using
discovery yet") and a non-atomic identity-then-auth creation that matches the existing flow because
atomicity "needs a backend endpoint, out of scope here".

A pre-existing issue is worth **at most one** clearly labelled non-blocking note.

---

## What automation genuinely caught here

The accepted set is not trivial, and none of these were flagged by a person first. Worth knowing,
because they are the classes where a careful non-running review adds real value:

- A renewal writing the CA's **current** region into metadata instead of the certificate's original
  region, where the provider's ARNs are region-scoped, so the renewed certificate became unresolvable.
- A bare `catch` around a decrypt hiding KMS outages and key-rotation failures with no log line.
- A frontend permission check missing the ABAC subject conditions the backend enforces on the same
  action, so the UI and the API disagreed.
- A 100-item default limit on a list hook silently truncating an identity picker in large orgs.
- A DNS-rebinding window in a connectivity preflight check.
- `??` dropping an explicit `null` in a PATCH, so a nullable field could never be cleared.
- A breaking rename where the frontend still sent the old field name.

---

## What only people caught

The areas where a reviewer adds what pattern matching cannot. If your review contains none of these,
it is doing the machine's half of the job:

- **Behavioral defects found by using the feature.** 15% of human comments, versus 0.5% of automated
  ones. See the top of `SKILL.md`.
- **Whether the capability should exist at all**, or should exist for this variant.
- **Consequences on real data**: the installed base, self-hosted upgrades, a backfill that leaves rows
  unusable.
- **Trust-boundary judgement in both directions**: finding real cross-tenant holes, and correctly
  rejecting the four findings above.
- **Ecosystem consequences**: Terraform drift, rotation windows measured against consumer downtime, not
  spamming an external CA, matching a provider's own vocabulary.
- **Direction**: which of two coexisting subsystems is the future.

---

## How this team receives AI-assisted findings

Reviewers here routinely run AI over a PR themselves and relay the interesting part with their own
judgement attached, sometimes crediting it explicitly ("ala clood", "from claude", "I had claude write a
migration test"). Two consequences:

1. An AI-originated finding is not unwelcome.
2. It is expected to arrive **already filtered, with the verification attached.**

The model to imitate, where a relayed finding was checked against the backend before being passed on:

> "claude flagged that we should be hiding remove certificates for the nutanix sync? it's disabled on
> the backend `canRemoveCertificates: false`"
