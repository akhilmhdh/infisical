# Repo Facts

Verified mechanisms, so a finding can name a real consequence instead of a general worry. **Read the
relevant entry before asserting how something works.** If the code contradicts an entry, the fact may
have gone stale, so verify and say so rather than leaning on it.

---

## Data access

**The pool is ten connections per instance.** `DB_POOL_MAX` default 10, `knexfile.ts` pool min 2 max
10. This is the number that makes transaction shape a correctness problem rather than a performance
preference.

**Reads go to a replica, writes to the primary.** `ormify` resolves `(tx || db.replicaNode())` for
reads and `(tx || db)` for writes. Two consequences: a call inside a transaction that omits `tx` takes
a **second** connection, and any read that gates a write can see pre-write state under lag.

**Transaction helpers do not wrap errors.** `ormify().transaction` and `withTransaction`
(`backend/src/lib/knex/index.ts`) call `db.transaction(cb)` and propagate the callback's error
unchanged, and the global handler dispatches on the error class. So a `BadRequestError` thrown inside a
transaction still renders as a 400.

There is a belief in the review history that errors inside a transaction surface as 500s, used to
justify moving validation before `BEGIN`. **Moving validation earlier is still right** (it shortens the
transaction), but do not repeat the 500 mechanism. It is not supported by the code.

**Migrations run inside a transaction by default.** No `disableTransactions` in `knexfile.ts`, so knex
wraps each one. Never ask for a migration to be wrapped. The useful inverse: 32 migrations deliberately
opt out with `export const config = { transaction: false }` so `CREATE INDEX CONCURRENTLY` can run,
with an explicitly acquired connection so session-local `statement_timeout` and `lock_timeout` apply to
the same connection as the index build. `20260801120000_add-alert-resource-lookup-index.ts` is the
reference implementation.

**Postgres does not auto-index foreign keys.** An unindexed FK forces a seq scan of the child table on
every parent DELETE or UPDATE through the per-row RI trigger. `createJunctionTable`
(`src/db/utils.ts`) creates CASCADE FK columns with **no index on either side**.

**Enums live in TypeScript, not Postgres.** Exactly 1 of 504 migrations uses `table.enu(...)`. Columns
are text, constrained by `z.nativeEnum(...)` at the route boundary. "Avoid putting enum in db level.
Updating this is nightmare."

**After a migration, `npm run generate:schema` regenerates `src/db/schemas/`.** A migration with no
schema change is a missing step. A hand-edited generated schema is a defect.

---

## Actors

Four kinds, and code that assumes one silently drops the others:

| Actor | Notes |
| --- | --- |
| User | Browser session, JWT |
| Group | Permission resolution walks group memberships as well as direct ones |
| Machine identity | `IDENTITY_ACCESS_TOKEN`, the supported machine path |
| Service token | Legacy, deprecated, kept for backwards compatibility |

`API_KEY` and `SERVICE_TOKEN` auth modes are **deprecated**. Do not accept them in a new route's
`verifyAuth` list, and do not recommend them.

Scopes nest: org, then project, then sub-resource membership (PKI applications, signers, PAM
resources). A permission at one level does not imply presence at another.

---

## Who consumes the API

Five, and only the first lives in this repository's frontend:

1. React frontend (`frontend/`)
2. CLI (`cli/`)
3. Go backend (`backend-go/`), a partial rewrite over the **same** database
4. Kubernetes operator (`k8-operator/`)
5. External Terraform provider (separate repository)

On any rename or tightening, grep `frontend/ backend-go/ cli/ k8-operator/` for the old name before
concluding anything, then remember the Terraform provider is not greppable from here.

The repository keeps `deprecated-*` routers rather than deleting routes. "I don't think we ever remove
routes to maintain backward compatibility."

---

## Two generations of almost everything

| Area | Keep | Deprecated, still serving traffic |
| --- | --- | --- |
| PKI | `certificate-profile`, `pki-application`, `certificate-v3` | certificate **templates**, PKI **subscribers**, `deprecated-certificate-*` routers |
| Frontend components | `components/v3` | `components/v2` (`PageHeader` is the known exception) |
| Backend | `backend/` (Node) | `backend-go/` is additive, not a replacement yet |

---

## Service wiring

No IoC container. Every service is a factory taking explicit dependencies, wired by hand in
`backend/src/server/routes/index.ts`: DALs, then ~100+ services, then
`server.decorate("services", {...})`, then route registration. **A service not wired there does not
exist at runtime.**

EE routes (`backend/src/ee/routes/`) register **before** community routes, so an EE route can silently
shadow a community one on the same method and path.

---

## Background work

**Scheduled work uses the cron manager** (`src/lib/cron/cron-job.ts`), with Redis slot election and
per-run redlocks so each fire runs once across the fleet. Names come from the `CronJobName` registry,
never raw strings.

**BullMQ repeatables and `JobScheduler` are actively cleaned up on boot**, so reintroducing one
collides with that cleanup and double-executes. BullMQ is for event-driven, payload-carrying work.

Cron handlers must be idempotent at the `handlerTimeoutMs` boundary (default 5 min), because a timeout
marks the run failed-final and waits for the next fire rather than retrying.

`QUEUE_WORKER_PROFILE` gates the consumer, never the producer: a pod that does not consume a queue must
still be able to enqueue onto it.

---

## Alerting, and why deletes need care

`src/services/alert/` is the one alerting module, with an `IResourceAlertProvider` registry. Any new
"notify me when X happens" belongs there as a provider, not as a per-domain alert service, channel
table, or notification cron. `src/services/pki-alert-v2/` predates it and is not a template.

**`alerts.resourceId` has no foreign key.** Nothing cascades, so every delete or detach path must reap
alerts itself, and a resource usually has three (hard delete, org-membership removal,
project-membership removal). Two helpers, and picking wrong is the bug:

- `deleteAlertsForDeletedResource({ resourceType, resourceId })` when the **row is gone**. Unscoped on
  purpose, because the same resource can be watched from another org.
- `deleteAlertsForResource({ orgId, projectId?, resourceType, resourceId })` when the resource merely
  **left a scope** but still exists.

Call it inside the delete transaction with `tx`. The reap is pure DB, so that is safe.

**Soft delete:** where a table has `deleteAfter`, every read must exclude soft-deleted rows, including
any count feeding a plan or quota limit. `Environment.deleteAfter` is not `Project.deleteAfter`, and
soft-deleting a project does not soft-delete its environments, so cross-project enumeration (crons,
listings) has to filter `Project.deleteAfter` too or a soft-deleted project's secrets still get rotated
and synced.

---

## Observability

**Audit events:** every id-like field in an event's `metadata` body needs a human-readable label
resolved at emission time, because a raw UUID is unactionable in the audit log UI. Any field named or
ending in `id`, `Id`, `ID`, `_id` counts, an optional ID gets an optional label, and the fix is to load
the parent record, **not** to add the field and pass `undefined`. Scope is the event body, not the
envelope. Per-actor breakdowns belong in the audit log, not in metrics.

**Metrics:** new instruments go on the `InfisicalCore` meter with **bounded** attributes only. An
attribute not in the allowlist (`telemetry-attributes.ts`) is silently dropped by an SDK View, so it is
invisible data loss rather than an error. No org id, user id or email, identity id, IP, user agent,
request id, or free-form value such as an environment slug. `http.route` must be the parameterized
template. Per-actor instruments go through `highCardinalityMeter` so
`OTEL_DROP_HIGH_CARDINALITY_METERS` can switch them off. Lint enforces this: `backend/.eslintrc.js`
blocks `@opentelemetry/*` imports outside `src/lib/telemetry` and blocks `getMeter`.

**Logging:** never log an outbound URL verbatim. Incoming-webhook providers put the bearer secret in
the path (Slack, Discord, Teams, Telegram) and many APIs accept a token as a query parameter. Use
`sanitizeUrlForLog` from `@app/lib/logger`. The `redactedKeys` list matches by key name only and does
not help with a secret inside a `url` field. Already covered: the global axios response interceptor and
`safeRequest`'s dispatch log. Put identifiers in the message as `[key=value]` so lines are searchable.

---

## Outbound requests

For a user-supplied URL, use `safeRequest` (`backend/src/lib/validator/safe-request.ts`).
`blockLocalAndPrivateIpAddresses`, `validateSsrfUrl`, `ssrfSafeGet`, and `ssrfSafePost` validate the
host and then connect with a **separate** lookup, so DNS can move to an internal address in between.
`safeRequest` validates and pins the connection to the validated IP.

It also sets `maxRedirects=0`, so a call site needing redirects requires redirect-aware handling that
re-validates and pins each hop. Do not recommend a mechanical swap.

---

## Errors

Classes in `src/lib/errors/index.ts`: `BadRequestError` (400), `UnauthorizedError` (401),
`ForbiddenRequestError` (403), `PermissionBoundaryError`, `NotFoundError` (404), `DatabaseError` (500),
`GatewayTimeoutError` (504), `InternalServerError`, `RateLimitError`, `ScimRequestError`.

A resource in another org returns **`NotFoundError`**, not `ForbiddenRequestError`, so the API cannot
confirm another tenant's resource IDs exist. A 403 is not automatically wrong (one was accepted here
because it leaked nothing), but 404 is the house default.

Never let a raw Knex or SDK error reach the client: the message carries column names, constraint names,
and SQL fragments. Never interpolate a secret, token, key, connection string, or full URL. Errors must
be uniform across clients; per-client error shaping was explicitly rejected ("we may find ourselves
doing if k8s operator, if ansible, etc.").

---

## Route boilerplate

Every route needs `config.rateLimit` (`readLimit` or `writeLimit`), `onRequest: verifyAuth([...])`
listing only the auth modes that genuinely need access, an `operationId`, and a `.describe()` on every
field with strings in `src/lib/api-docs/`. A new route missing `rateLimit` or `verifyAuth` is a real
gap.

Responses are deliberately selected. Never return a DB row wholesale, since rows carry `encrypted*` and
`hashed*` columns and internal FKs. The mechanism is the sanitized schema
(`backend/src/server/routes/sanitizedSchemas.ts` and `sanitizedSchema/`), and redaction belongs at the
response schema layer so the internal model keeps the field for its own use.

`POST` and `PATCH` return the full resource wrapped in a named key, not `{ "success": true }`.

**Cert-manager routes do not accept `projectId`.** `src/server/plugins/inject-cert-manager-project-id.ts`
resolves it and handlers read `req.internalCertManagerProjectId`.

---

## Where risk concentrates

Comment density over two years. A prior on where to spend time, not a licence to hunt.

**Files:** `ee/services/pam-account`, `services/secret-v2-bridge`, `ee/services/audit-log/audit-log-types.ts`,
`ee/services/permission/project-permission.ts`, `ee/services/pam-session`, `services/certificate-v3`,
`services/auth/auth-login-service.ts`, `lib/api-docs/constants.ts`.

**Directories:** `backend/src/ee/services` (4,358), `backend/src/server/routes` (1,333),
`backend/src/db/migrations` (946), `services/app-connection` (799), `services/secret-sync` (646).
