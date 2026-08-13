# SWEEP change graph

Emits a navigable graph for a change: **UI page → hook → router → service → fns/dal**, with the function
or symbol that connects each pair on the edge. Built for a GitHub extension to render, so the output is a
stable JSON contract rather than prose.

```bash
node agent/skills/sweep/graph/build-graph.mjs <base-ref> <head-ref> [--pr N] [--out graph.json] [--depth 2] [--debug]
```

Takes about 2.5 minutes on a 16-file change in this repo. The cost is the reverse-import scan; `--depth 1`
roughly halves it.

---

## Why it is a script and not the model

A graph is only useful if it is trustworthy, and a graph an agent draws from reading a diff is neither
reproducible nor checkable. Every node and edge here comes from parsing the source at HEAD, and every edge
carries the file and line that produced it so a reviewer can jump straight to the evidence.

That principle earned its keep during development: an early version scored candidate routers by filename
similarity and confidently attributed a PAM session route to the membership router. The fallback now
refuses to guess when more than one router could match, and reports a dangling seam instead.

---

## Contract

```jsonc
{
  "version": 1,
  "pr": 7510,
  "base": "9ff8c441c",
  "head": "e61221f1b",
  "stats": { "changedFiles": 16, "nodes": 133, "edges": 530, "traces": 23, "unresolvedApiCalls": 0 },
  "legend": { "layers": [...], "edgeKinds": { "...": "description" } },
  "nodes": [ /* see below */ ],
  "edges": [ /* see below */ ],
  "traces": [ /* see below */ ]
}
```

### Node

```jsonc
{
  "id": "backend/src/ee/services/pam-web-access/redis/pam-redis-session-handler.ts", // repo-relative, unique
  "label": "pam-redis-session-handler.ts",
  "dir": "backend/src/ee/services/pam-web-access/redis",
  "kind": "service",
  "layer": "service",
  "changed": true,                        // in this diff -> render the highlight dot
  "churn": { "added": 252, "removed": 0 },// null when unchanged
  "seed": true                            // was a changed file, versus pulled in as context
}
```

**Layers**, in flow order, which is the order to lay out columns:

`frontend` → `router` → `service` → `data`, plus `docs`, `test`, `infra`, `other` off to the side.

**Kinds** drive the sub-label and icon: `page`, `component`, `layout`, `route-def`, `hook`, `query-hook`,
`mutation-hook`, `api-types`, `frontend-lib`, `router`, `route-registry`, `service`, `fns`, `queue`,
`schema`, `lib`, `dal`, `db-schema`, `migration`, `test`, `docs`, `config`, `other`.

### Edge

Parallel edges are **intentional**. Two call paths between the same pair are two edges distinguished by
label, because the label is how a reader learns *how* the files are connected.

```jsonc
{
  "from": "frontend/src/pages/pam/PamAccountAccessPage/useWebAccessSession.ts",
  "to": "backend/src/ee/routes/v1/pam-routers/pam-session-router.ts",
  "kind": "http",
  "label": "POST /api/v1/pam/accounts/:accountId/web-access-ticket",
  "confidence": "high",                   // "high" | "heuristic"
  "evidence": [{ "file": "...useWebAccessSession.ts", "line": 88 }]
}
```

| `kind` | Meaning | Label is |
| --- | --- | --- |
| `import` | Static import | the symbols crossing the boundary |
| `import-type` | Type-only import | same; render lighter, it is not a runtime path |
| `http` | Frontend API call matched to a route declaration. **This is the frontend/backend seam.** | `METHOD /full/path` |
| `http-unresolved` | An API call whose route could not be matched. Self-edge on the caller. | `METHOD /path` |
| `service-call` | Router handler invoking `server.services.<name>.<method>()` | `name.method` |

**Render `confidence: "heuristic"` differently** (dashed is the obvious choice). It means the route's mount
prefix could not be resolved by name and the match came from a unique path-tail match.

### Trace

A precomputed path so the extension can highlight a whole UI-to-data chain on one click.

```jsonc
{
  "nodes": ["...useWebAccessSession.ts", "...pam-session-router.ts", "...pam-web-access-service.ts", "...pam-account-dal.ts"],
  "labels": ["http:POST /api/v1/pam/accounts/:accountId/web-access-ticket", "service-call:pamWebAccess.startSession", "import:TPamAccountDALFactory"],
  "entry": "...useWebAccessSession.ts",
  "sink": "...pam-account-dal.ts",
  "crossesSeam": true
}
```

`labels[i]` is the edge **between** `nodes[i]` and `nodes[i+1]`, prefixed with its kind. Every trace
contains at least one changed node, so nothing in this array is irrelevant to the review. Traces are
sorted with `crossesSeam: true` first, shortest first: those are the ones a reviewer wants.

---

## How the graph is built

1. **Seed** with the changed files from `git diff --numstat`.
2. **Expand down** through imports, bounded by `--depth`: what the change depends on.
3. **Expand up** through importers: what reaches the change. This is the half that pulls in the routers and
   pages above a changed service, and without it no UI-to-data trace exists at all. Reverse lookup is a
   `git grep` on the module stem, then every hit is re-resolved so a coincidental string match cannot
   create a fake edge.
4. **Import edges**, labelled with the symbols.
5. **The seam.** Frontend `apiRequest.<method>(...)` calls are normalised (template interpolation becomes a
   param) and matched against backend route declarations.
6. **Router → service**, from `server.services.<name>.<method>()`, resolved to a file through the
   `server.decorate("services", {...})` block in `routes/index.ts`.
7. **Traces**, walking forward through non-decreasing layers from each frontend entrypoint.

### Route resolution, the fiddly part

A router's declared `url` is only half the path. Prefixes come from a **registration tree**:
`routes/index.ts` mounts `registerV1Routes` at `/api/v1`, `v1/index.ts` mounts `registerPamRouters` at
`/pam`, and `pam-routers/index.ts` mounts sub-routers under `/accounts`. The builder resolves the whole
chain recursively.

Two shapes in this repo break naive resolution, and both are handled:

- **Anonymous mounts.** `server.register(async (r) => { await r.register(registerX); }, { prefix: "/accounts" })`
  has no symbol to key the prefix off, so the builder walks balanced parens and attributes the prefix to the
  register functions called inside the block.
- **Multiple exports per file.** `pam-session-router.ts` exports both the session router (mounted at
  `/sessions`) and the web-access router (mounted at `/accounts`). Routes are bound to the export block they
  physically sit in, not to the file's first export.

---

## Accuracy on PR #7510

133 nodes, 530 edges, 23 traces. Of 78 seam edges, **76 high confidence, 2 heuristic, 0 unresolved**. Five
sampled seam edges were checked by hand against the route declarations and all five were correct.

Known limits, none of them silent:

- A dynamically built URL (a path assembled from variables) will not match and shows as
  `http-unresolved`.
- `--depth` bounds how far context extends, so a long service chain can end mid-way. The trace `sink` tells
  you where it stopped.
- Only `apiRequest.*` calls are recognised. A component using `fetch` directly is invisible at the seam.
- `service-call` resolution depends on the `decorate("services")` block. A service reached some other way
  (direct import of a factory) appears as a plain `import` edge instead.

---

## `route-resolve.mjs` — shared route resolution

`build-graph.mjs` and `../where-to-test.mjs` both need to know a backend route's real path and who imports
a given file. That logic lives in `route-resolve.mjs` rather than in either consumer, because working out a
router's prefix is the part that has been wrong the most often — registration is a tree
(`/api/v1` → `/pam` → `/sessions`), some mounts are anonymous arrow functions carrying the prefix, and one
router file can export several register functions at different prefixes. Two copies would drift, and a
drifted copy tells a reviewer to curl an endpoint that does not exist.

`createResolver(ref)` returns everything scoped to one git ref (never the working tree, so a report is
reproducible regardless of which branch is checked out):

| Export | Purpose |
| --- | --- |
| `files` | every path at `ref`, as a Set — import resolution probes candidate suffixes, and a `git show` per candidate took minutes |
| `show(path)` | file contents at `ref`, cached |
| `prefix` | `registerFn` → full mounted prefix, resolved up the whole registration chain |
| `routesOf(path)` | a router file's routes as `{method, path, line}`, each bound to the export block it sits in |
| `listRouterFiles()` | every `*-router.ts` / `*-endpoints.ts` |
| `importsOf(path, {includeReexports})` | resolved import targets; opt into `export … from` traversal |
| `importersOf(path, {includeReexports})` | reverse edge, re-resolved so a coincidental string match cannot create a fake edge |

**`includeReexports` defaults to `false`** so the graph output is unchanged from before the extraction;
`where-to-test.mjs` opts in because barrel files (`@app/hooks/api`) re-export rather than import, and a scan
that only understands `import` treats every barrel as a dead end.

Extracting this was verified by diffing the graph JSON for the same base/head before and after: byte-identical.

---

## `--subset` — the block that gets posted

`--out` writes the full graph for tooling. `--subset` writes the pruned graph that goes in the review
comment, inside a ```` ```json sweep-graph ```` fence. It carries the same node and edge shape plus
`subset: true`, so a consumer can read either.

| Field | Meaning |
| --- | --- |
| `stats.ofNodes` | size of the full graph this was cut from |
| `stats.seedsNotExpanded` | changed files that did **not** radiate (definitional or very high degree) |
| `hubs[]` | modules skipped during expansion, with their importer count |
| `edge.evidenceTotal` | present when `evidence` was capped at 3 entries; the real count |

Selection rule: every seed, plus every node directly connected to a **behaviour-carrying** seed (router,
service, dal, fns, queue, page, component, hook, migration). Seeds that are types, constants or api-docs
modules stay as nodes but do not pull their neighbours in — they are imported by half the codebase, so
their neighbourhood describes the codebase rather than the change.

This exists because it was once assembled by hand for a single PR, and then silently stopped being
produced: the comment kept rendering an ASCII sketch while the extension had nothing to parse. Anything
the extension depends on has to come out of the builder.
