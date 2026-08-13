# Domain Traps

The specific things that actually bit, per area. Load the section the diff touches. These are priors on
where to look, not a checklist to run.

Each entry is written as the question to ask, followed by what happened when nobody asked it.

---

## Migrations and schema

**What do the rows that already exist look like?** This is the whole area in one question. A migration
runs on every customer's database, cloud and self-hosted, on versions you do not control.

- **Duplicates before a unique index.** "if we have multiple pam projects that slugify to the same name
  this will break the unique constraint and break the migration." And: "have you checked our prod data
  to ensure that this won't throw any error due to duplicates? this might be problematic for self-hosted
  users."
- **A superseded constraint nobody dropped.** The new uniqueness constraint was added while the old
  narrower one stayed, so creates began failing against the stale one.
- **Rows the backfill never reaches.** "I don't think the migration ever sets the gateway override on
  the account, so all the existing accounts would be migrated without gateways and would be unusable."
- **A half-failed re-run.** A backfill that re-runs after a partial failure pulled an absurd number of
  rows into memory; upsert or a conflict check was the answer.
- **"Why is this nullable" and "how do we backfill" are the same question.** The answer determines
  whether existing installs work after the deploy.

**Can the child meaningfully exist without the parent?** That picks the ON DELETE behaviour, not the
default. The model answer from the corpus: "accounts cascade because they cannot exist without
resources, but resources can exist without domains." And sometimes the right answer is for the delete
to **fail**: "we don't need to attach a CASCADE behavior... so deleting an approval request row will
just fail if it has a linked certificate request."

**Does this migration read the license or a feature flag?** It must not. Migrations run before the
license service initializes, so any plan, entitlement, or flag lookup returns its default instead of the
deployment's real value and the migration silently takes the wrong branch. This has already happened: a
migration used `getMigrationEncryptionServices`, whose HSM check is license-gated, and with the license
uninitialized the flag read as off, so data was nearly re-encrypted with the wrong key. Watch for
`licenseService`, `getPlan`, entitlement lookups, `getFeatureFlag`, or a helper doing either internally
(`getMigrationEncryptionServices` without `skipHsmLicenseCheck: true`, `isHsmActiveAndEnabled` given a
`licenseService`).

**Does the column name say its unit?** An integer duration says so: `lockoutDurationInSeconds`. Sibling
fields whose difference cannot be guessed get explicit names, as with `renewedFromCertificateId` and
`renewedByCertificateId`.

**Not worth your attention:** the `down` migration, and whether the migration is wrapped in a
transaction. See `calibration.md` 5 and 6.

---

## Auth, permissions, and multi-tenancy

**Is the caller-supplied ID proven to be in the caller's scope?** The check that matters most in the
repository, covered in `SKILL.md`. What happened without it:

- A point-in-time endpoint took `envId` and `targetCommitId` with no scope check, so a caller could pass
  another project's IDs and read secret values through the generated diffs.
- "we need to add this check back otherwise anyone can create a resource under a domain that is part of
  ANOTHER PROJECT."
- A certificate template endpoint did no access validation, "so anyone can deduce the policies of any
  certificate template".
- A `recordingConnectionId` was checked only for org membership before its AWS credentials were
  decrypted and used, letting a template editor borrow another connection in the org.
- The multi-tenant version, laid out step by step by a reviewer: org B calls the create endpoint
  directly with org A's tenant ID.

Read the surrounding check before concluding. See `calibration.md` 1.

**Does the permission subject belong to the resource's own domain, or is it borrowed?** "honey tokens
need their own permissions like we have permissions for dynamic secrets and secret rotations. The secrets
subject is specifically for static secrets." Also: org-settings read access was exposing a webhook
signing secret, and permission to **use** a template is not permission to **list** templates.

**Which actor kinds does this handle?** See M2 in `SKILL.md`. `.whereNotNull("actorUserId")` skips groups
and machine identities. Rate limits keyed per-actor rather than per-org are a bypass.

**Is enforcement complete across sibling entry points?** "we only `enforceUserLockStatus` on mfa and org
selection but not on actual login endpoints, should we add this to them as well?" A guard applied at one
entry point and not its siblings is the shape.

**Does this leak existence?** Out-of-scope resources return `NotFoundError`. "we'd be giving information
about which project an account belongs to with this... perhaps you can just throw 'not found' error when
there's a project mismatch?"

**Unresolved, so ask rather than assert:** whether auto-adding an actor to a product on sub-resource
assignment is still allowed. A reviewer described removing it as settled ("require people to be already
IN the project"), but current behaviour across signer, PKI application, and cert-manager membership was
not confirmed.

---

## PKI and certificates

**Is this the generation we are keeping?** Profiles and applications, not templates and subscribers. See
`repo-facts.md`. Both mistakes are live: building new behaviour on the old generation, and dismissing a
real bug because it is in the old generation.

**Does this route accept `projectId`?** Cert-manager routes must not; the plugin resolves it and handlers
read `req.internalCertManagerProjectId`.

**Is the certificate material parsed before it is stored?** A chain or certificate body from a caller
must be parsed into X.509 objects and rejected with a `BadRequestError` if it does not parse, before
being encrypted and persisted, or the failure moves to every later read. The pattern to copy, with
`importCertToCa` as the precedent:

```ts
const certificates = certificateChain
  .match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g)
  ?.map((cert) => new x509.X509Certificate(cert));
if (!certificates) throw new BadRequestError({ message: "Failed to parse ..." });
```

Backend regex uses `re2` by convention (149 files), so match the neighbours.

**Is the expensive crypto outside the transaction?** This is where the ten-connection pool actually
bites: key generation, self-signed certificate creation, CRL rebuilds, PQC signing. Node is
single-threaded, so these block every other request as well as holding a connection. The statement that
names the abuse case: move self-signed certificate creation out of the transaction because "it could be
problematic when someone spams this endpoint maliciously which would consume all the available client
connections to our DB".

**Can this CA type actually do this?** "I don't think you're able to issue a code signing certificate
using ACME anywhere." And for fields an external CA ignores: "if they're using ADCS, they shouldn't have
any policies defined for the key usages, extended key usages" (ADCS respects subject DN and SAN only, so
exposing the rest misleads the user).

**Is provider-scoped metadata taken from the right source?** An ACM renewal wrote the CA's **current**
region rather than the original certificate's region, and ACM ARNs are region-scoped, so the renewed
certificate became unresolvable.

**Are we identifying certificates by ID?** Serial numbers can collide across orgs once certificates are
imported rather than issued. The unique constraint on `internal_certificate_authorities.serialNumber`
was dropped for this reason. `certificates.serialNumber` still appears to carry one; **do not claim that
is a bug**, it was not confirmed either way.

**Does our retry behaviour become the upstream's problem?** Auto-renewal disabling itself on failure was
deliberate: "disabling on failure prevents repeated failures that could spam the external CA provider."
The inverse: a revocation sync window should absorb a fully missed cron day plus minor delay rather than
assuming an exact interval.

**Is a new sync destination shaped like its siblings?** Split into prepare, sync, cleanup, explicitly so
the pieces can be tested: "can we please break this down into multiple methods?
`prepareCertificatesForUpload` `syncCertificatesToLoadMaster` `cleanupOrphanedCertificates` ... it would
enable us to test the smaller functions." Also check name-template sanitization per destination (a real
bug: dashes were not stripped from a templated name), and cross-sync interference: "will this interfere
with certificates synced to ACM by a different secret sync?"

---

## Providers: app connections, secret syncs, rotations

**Does this list endpoint paginate, and how do you know?** Most providers default to 20 to 50 items and
say nothing about the rest, so reading `data.result` silently truncates the user's resource picker. Ask
for the provider's maximum page size, follow the provider's own signal (`nextPageToken`, `has_more`,
`total_pages`, a `Link` header), cap the loop, and log when the cap is hit. The live example in the
codebase: one Cloudflare file where `listCloudflareZones` paginates while
`listCloudflarePagesProjects` and `listCloudflareWorkersScripts` return only the first page.

**Verification is mandatory here.** This is the class where invented behaviour was caught, and also
where a real bug was confirmed, by the same reviewer, by testing. See `calibration.md`. If you cannot
verify, ask: "Does this endpoint paginate? The sibling providers follow `total_pages` here, and I could
not confirm from the provider's docs."

**Does the field name match what the provider calls it?** "Supabase seems to refer to this as Project ID
in the dashboard so I think we should go with that as users will map that mentally when using the API."

**Did a provider boolean become a magic value in one of our enums?** The stronger version of the naming
point, because a sentinel is a correctness surface: "given this is just a boolean in their API why not
mirror that in our sync? having the `all-custom-environments` feels off as we're using an environment
slug as a special value, could have typos and leads more complicated checks."

**During rotation, do both credential sets stay valid?** "with dual credential sets we want both the
active and inactive (in the Infisical sense) to be valid so there's no downtime during the rotation
interval." So do not revoke the old credential at issuance. Be wary of a provider-side expiry at all; if
one is set it must cover **two** intervals, and "if a rotation fails or they change the rotation interval
this would result in potential application down time since it would auto-expire". And revoke only after
our own commit, or a rollback leaves a dead connection.

**Will a server-side default cause Terraform drift?** "there's going to be inherent drift due to the
fact that the API is pre-filling value for something that's not explicitly defined by the user in the
terraform configuration." Pair with the PATCH null-versus-omitted question: the provider needs both to
omit a field it does not manage and to clear a field it does.

**Is a missing `.max()` a provider-side failure?** Frame it that way when it is. An over-long name "can
cause errors in the dbt API", which is integration correctness rather than input hygiene.

---

## Frontend

**Run it.** See the top of `SKILL.md`. This is where the behavioral-testing habit pays off most, and
where most human review comments on this repository came from.

**Is there a second error toast?** `MutationCache.onError` in `src/hooks/api/reactQuery.tsx` already
surfaces the server error message, so a `createNotification` in a mutation's `onError` or `catch`
produces two. "We handle this type of error globally in the reactQuery.tsx file." Local error handling
that restores optimistic state or keeps a dialog open is still fine; it just must not notify again.
`react-toastify` was removed and must not return.

**Is this v3, with its defaults intact?** New UI uses `components/v3` and follows `DESIGN.md`
(`PageHeader` is the known exception). What to flag: v2 color tokens (`mineshaft-*`, `bunker-*`) instead
of semantic tokens (`bg-org`, `text-danger`), casing changes such as uppercase text, `className`
overrides of component defaults like height or border, hex colors not in `frontend/src/index.css`. If the
same inline style repeats across call sites, suggest a variant rather than flagging each occurrence.

**Does the permission gate carry the backend's conditions?** A `ProjectPermissionCan` with the right
action but missing the ABAC subject conditions the backend enforces will show the UI as permitted and
then fail, or hide something that should be allowed. One accepted finding: the call "omits the
`resourceName`, `accountName`, and `metadata` conditions that the backend enforces on the same action".

**What happens at item 101?** A list hook without an explicit limit inherits a default (100 for
`useGetIdentityMembershipOrgs`), so a selector silently omits entries in large orgs. Ask this of any
dropdown backed by a paginated list.

**Does the mutation invalidate what it changed?** Mutations invalidate relevant query keys in
`onSuccess`. A mutation that changes server state and invalidates nothing leaves stale UI, which is a
real finding when you can name the stale view. Global defaults are `staleTime: 60_000`,
`refetchOnWindowFocus: false`, `retry: 1`; data that must always be fresh (auth configs, lease TTLs)
overrides with `staleTime: 0`.

**Does the loading state come from the mutation?** Prefer `isPending` over a hand-managed flag; if one is
kept it must clear in a `finally`.

**Rules that do not apply here:** backend regex conventions (`re2`), backend telemetry rules, and
server-side input-bound rules. Frontend validation is UX; the server is the boundary. See
`calibration.md` 4.

**Unresolved, so do not rule either way:** whether to hide an action the actor cannot use or disable it
with an explanation. `isDisabled={!isAllowed}` is widespread, and one senior reviewer prefers
communicating no access over hiding while explicitly deferring to other teams.

---

## Audit logs and observability

`audit-log-types.ts` is one of the three most-commented files in the repository, so this area is live.
Owned by the Contract and Consumers lens, because an audit event is a published surface.

**Is the event type string changing, or is a route moving to a different event?** The type string is
stored on the row, filterable in the audit log UI, and shipped to external SIEMs as
`audit_log.event_type`. So a rename silently breaks saved filters and external detections, and splits the
same logical activity across two types with no migration. Nothing errors, which is what makes it easy to
miss. This is a field rename by another name: ask whether the break is intended and whether it is called
out anywhere.

Worth noting because it happened: a reviewer *asked* for a rename here (a `/connect` route emitting
`register-kmip-server` was reasonably renamed to `kmip-server-connect`) and nobody asked what it did to
existing consumers. A requested change still has consequences.

**Does every id-like field in the event `metadata` have a human-readable label?** Resolved at emission
time. A raw UUID is unactionable for an admin reading the audit log UI. Any field named or ending in `id`,
`Id`, `ID`, `_id` counts, an optional ID gets an optional label, and passing `undefined` does not satisfy
it: load the parent record. Scope is the event body, not the envelope.

**Does a new mutating endpoint emit an audit log at all?** Reviewers asked this repeatedly across several
years. The inverse also came up: fields already carried by the envelope were trimmed from an event body as
redundant, so more metadata is not automatically better.

**Is an audit event now emitted by unattended machinery?** If a change makes something automatic
(background renewal, a retry loop, a cron fan-out), the event that used to fire on a human action now
fires on a schedule. Ask what the volume becomes at the most aggressive setting the validation permits.

**Metrics:** new instruments go on the `InfisicalCore` meter with bounded attributes only. An attribute
missing from the allowlist in `telemetry-attributes.ts` is **silently dropped** by an SDK View, so it is
invisible data loss rather than an error. No per-tenant or per-actor identifiers as labels, since those
scale series count with customer count; per-actor breakdowns belong in the audit log. `http.route` must be
the parameterized template. ESLint blocks `@opentelemetry/*` imports outside `src/lib/telemetry` and blocks
`getMeter`, so the useful finding is attribute cardinality, which lint cannot see.

**Logging:** never log an outbound URL verbatim. Incoming-webhook providers put the bearer secret in the
path, so a raw URL in a log line ships a working credential to the log sink. Use `sanitizeUrlForLog`. The
`redactedKeys` list matches by key name only and does not help with a secret inside a `url` field.

---

## Docs

No distinctive convention emerged from 1,339 human comments, with one exception worth carrying: the
comments were overwhelmingly about **factual accuracy against the code**, not prose. A documented flag
value that did not exist, a Helm selector that would match zero pods, a step that assumed a setup path
the reader may not have taken. Check claims against the implementation, and follow
`docs/STYLE_GUIDE.md` for structure.

---

## Areas with no derived guidance

`backend-go/`, `cli/`, `k8-operator/`, Helm charts, Dockerfiles, CI workflows, `wasm/`, and the `e2e/`
suite carry too little review history to generalize from. Review on ordinary engineering grounds and say
that the repository review context does not extend there rather than inventing a convention.

One question is still worth asking on the Go side: if a change alters semantics both backends implement
(caching, ETag behaviour, the meaning of a shared column), does `backend-go/` need the same change? One
real divergence was found that way, a cache key and ETag mismatch between the two implementations. Ask
it; do not assert it.
