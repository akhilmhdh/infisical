#!/usr/bin/env node
/**
 * SWEEP graph builder.
 *
 * Emits a navigable call graph for a change: UI page -> query/mutation hook -> router -> service ->
 * fns/dal, plus the docs and tests that hang off it. Consumed by a GitHub extension, so the output is
 * a stable JSON contract (see ./README.md), not prose.
 *
 * Deterministic on purpose. A graph the model draws by hand is a graph nobody can trust, so every edge
 * here comes from a parse of the actual source and carries the evidence (file + line) that produced it.
 * Edges the parse can only infer are marked confidence:"heuristic" so the extension can render them
 * differently from static imports.
 *
 * Usage:
 *   node agent/skills/sweep/graph/build-graph.mjs <base-ref> <head-ref> [--pr N] [--out graph.json] [--depth 2]
 */

import { execFileSync } from "node:child_process";
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { join, basename, dirname, resolve as pathResolve } from "node:path";

import { createResolver } from "./route-resolve.mjs";

const argv = process.argv.slice(2);
const positional = argv.filter((a) => !a.startsWith("--"));
const flag = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? def : argv[i + 1];
};
const [BASE, HEAD] = positional;
if (!BASE || !HEAD) {
  console.error("usage: node agent/skills/sweep/graph/build-graph.mjs <base-ref> <head-ref> [--pr N] [--out f] [--depth 2]");
  process.exit(2);
}
const PR = flag("pr", null);
const OUT = flag("out", null);
const DEPTH = Number(flag("depth", 2));

const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 1 << 28 });
const REPO = git("rev-parse", "--show-toplevel").trim();

// Route/prefix resolution and ref-scoped file reads live in ./route-resolve.mjs, shared with
// agent/skills/sweep/where-to-test.mjs so the two can never disagree about where an endpoint is mounted.
const R = createResolver(HEAD);
const {
  files: FILES,
  show,
  normPath,
  findMountEnd,
  prefix: PREFIX,
  routesOf,
  listRouterFiles,
  resolveImport,
  importsOf,
  importersOf
} = R;



// ---------------------------------------------------------------------------- classification

const KIND_RULES = [
  [/^frontend\/src\/pages\/.*\/route\.tsx?$/, "route-def", "frontend"],
  [/^frontend\/src\/hooks\/api\/.*\/queries\.tsx?$/, "query-hook", "frontend"],
  [/^frontend\/src\/hooks\/api\/.*\/mutations\.tsx?$/, "mutation-hook", "frontend"],
  [/^frontend\/src\/hooks\/api\/.*\/types\.tsx?$/, "api-types", "frontend"],
  [/^frontend\/src\/hooks\/.*\.tsx?$/, "hook", "frontend"],
  // A use*.ts file is a hook wherever it lives; plenty sit next to the page that owns them rather than
  // under src/hooks, and calling those "frontend-lib" hid real entrypoints from the trace walk.
  [/^frontend\/src\/.*\/use[A-Z][A-Za-z0-9]*\.tsx?$/, "hook", "frontend"],
  [/^frontend\/src\/pages\/.*Page\.tsx$/, "page", "frontend"],
  [/^frontend\/src\/pages\/.*\.tsx$/, "component", "frontend"],
  [/^frontend\/src\/components\/.*\.tsx$/, "component", "frontend"],
  [/^frontend\/src\/layouts\/.*\.tsx$/, "layout", "frontend"],
  [/^frontend\/.*\.(ts|tsx)$/, "frontend-lib", "frontend"],
  [/^backend\/src\/db\/migrations\/.*\.ts$/, "migration", "data"],
  [/^backend\/src\/db\/schemas\/.*\.ts$/, "db-schema", "data"],
  [/.*-router\.ts$/, "router", "router"],
  [/^backend\/src\/server\/routes\/.*\/index\.ts$/, "route-registry", "router"],
  [/.*-endpoints\.ts$/, "router", "router"],
  [/.*\.test\.ts$/, "test", "test"],
  [/.*-dal\.ts$/, "dal", "data"],
  [/.*-service\.ts$/, "service", "service"],
  [/.*-queue\.ts$/, "queue", "service"],
  [/.*-fns\.ts$/, "fns", "service"],
  [/.*-(schemas?|types|enums|constants)\.ts$/, "schema", "service"],
  [/^backend\/src\/lib\/.*\.ts$/, "lib", "service"],
  [/^backend\/.*\.ts$/, "backend-lib", "service"],
  [/^docs\/.*\.(mdx|json)$/, "docs", "docs"],
  [/.*\.(ya?ml|json|sh|Dockerfile)$/, "config", "infra"]
];

function classify(path) {
  for (const [re, kind, layer] of KIND_RULES) if (re.test(path)) return { kind, layer };
  return { kind: "other", layer: "other" };
}

// ---------------------------------------------------------------------------- changed set

const numstat = git("diff", "--numstat", `${BASE}..${HEAD}`)
  .split("\n")
  .filter(Boolean)
  .map((l) => l.split("\t"))
  .filter((p) => p.length === 3);

const churn = new Map();
for (const [add, del, path] of numstat) {
  churn.set(path, { added: Number(add) || 0, removed: Number(del) || 0 });
}
const changedFiles = [...churn.keys()].filter((p) => !p.includes("node_modules"));

// ---------------------------------------------------------------------------- import resolution




// ---------------------------------------------------------------------------- route prefix map


/** Turn a frontend URL (template literal, query string) into a comparable route shape. */
function normalizeCallUrl(raw) {
  let u = raw.split("?")[0];
  u = u.replace(/\$\{[^}]*\}/g, ":p"); // interpolation -> param
  // Keep the /api/vN prefix: route paths carry it too, and it disambiguates versions.
  return normPath(u);
}

const isParam = (s) => s.startsWith(":");
const segsOf = (p) => p.split("/").filter(Boolean);
const stripApi = (segs) => (segs[0] === "api" && /^v\d+$/.test(segs[1] || "") ? segs.slice(2) : segs);
const singular = (s) => s.replace(/ies$/, "y").replace(/s$/, "");

/**
 * Route params differ in name between caller and router, so compare segment shapes.
 *
 * Asymmetric on purpose. A route param accepts anything, so `:roleId` matches a literal or an
 * interpolation in the call. But an interpolated call segment must NOT match a route LITERAL: treating
 * params as wildcards on both sides made `GET /projects/${projectId}/environment-folder-tree` match
 * `GET /projects/roles/:roleId`, which produced confidently wrong seam edges.
 */
function segMatch(callSeg, routeSeg) {
  if (isParam(routeSeg)) return true;
  return callSeg === routeSeg;
}

function pathsMatch(callPath, routePath) {
  const a = segsOf(callPath);
  const b = segsOf(routePath);
  if (a.length !== b.length) return false;
  return a.every((seg, i) => segMatch(seg, b[i]));
}

/**
 * Fallback seam match for routers whose prefix cannot be resolved by name.
 *
 * Not every router is mounted through a named register function: PAM, for one, mounts sub-routers inside
 * an anonymous `server.register(async (r) => {...}, { prefix: "/accounts" })`, so there is no symbol to
 * attribute the prefix to. Rather than lose the whole frontend-to-backend seam for those, match the
 * route's declared url against the TAIL of the call path, then require every remaining prefix segment to
 * appear in the router's own file path. `/api/v1/pam/accounts/:id/permissions` against
 * `url: "/:accountId/permissions"` in `pam-routers/pam-account-router.ts` needs "pam" and "account" to
 * both appear in that path, which they do. Returns a score so the best candidate wins; 0 means no match.
 */
function suffixAffinityScore(callPath, route, routerFile) {
  const call = stripApi(segsOf(callPath));
  const tail = segsOf(route.url);
  if (call.length < tail.length) return 0;
  const split = call.length - tail.length;
  const callTail = call.slice(split);
  if (!tail.every((seg, i) => segMatch(callTail[i], seg))) return 0;

  const prefixSegs = call.slice(0, split).filter((s) => !isParam(s));
  // A bare `url: "/"` would otherwise match every call, so demand real prefix evidence.
  if (prefixSegs.length === 0) return 0;
  const fileTokens = routerFile.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map(singular);
  const matched = prefixSegs.filter((s) => fileTokens.includes(singular(s.toLowerCase())));
  if (matched.length !== prefixSegs.length) return 0;
  return prefixSegs.length * 10 + tail.length;
}

// ---------------------------------------------------------------------------- extractors

// The generic can be nested (`<Record<string, T>>`) and can span lines, so allow one level of nesting
// rather than [^>]* which stops at the first inner '>'.
const API_CALL_RE =
  /apiRequest\s*\.\s*(get|post|put|patch|delete)\s*(?:<(?:[^<>]|<[^<>]*>)*>)?\s*\(\s*[`"']([^`"']+)[`"']/gi;

function apiCallsOf(path) {
  const src = show(path);
  if (!src) return [];
  const out = [];
  for (const m of src.matchAll(API_CALL_RE)) {
    const line = src.slice(0, m.index).split("\n").length;
    out.push({ method: m[1].toUpperCase(), url: normalizeCallUrl(m[2]), raw: m[2], line });
  }
  return out;
}

/** Router handlers reach business logic through server.services.<name>.<method>(). */
const SERVICE_CALL_RE = /server\.services\.([A-Za-z0-9_$]+)\.([A-Za-z0-9_$]+)\s*\(/g;

function serviceCallsOf(path) {
  const src = show(path);
  if (!src) return [];
  const out = [];
  for (const m of src.matchAll(SERVICE_CALL_RE)) {
    out.push({ service: m[1], method: m[2], line: src.slice(0, m.index).split("\n").length });
  }
  return out;
}

/**
 * server.services.<name> -> service file. routes/index.ts decorates services with factory results, so
 * match the decorated key to the factory variable, then to the import that defined it.
 */
function buildServiceFileMap() {
  const reg = "backend/src/server/routes/index.ts";
  const src = show(reg);
  const map = new Map();
  if (!src) return map;
  // decorate is called with an explicit generic: server.decorate<FastifyZodProvider["services"]>("services", {
  const decorate = src.match(
    /server\.decorate\s*(?:<[^>]*(?:\[[^\]]*\])?[^>]*>)?\s*\(\s*["'`]services["'`]\s*,\s*\{([\s\S]*?)\n\s*\}\s*\)/
  );
  const imports = importsOf(reg);
  const symbolToFile = new Map();
  for (const imp of imports) for (const s of imp.symbols) symbolToFile.set(s, imp.target);

  if (decorate) {
    for (const m of decorate[1].matchAll(/^\s*([A-Za-z0-9_$]+)\s*(?::\s*([A-Za-z0-9_$]+))?\s*,?\s*$/gm)) {
      const key = m[1];
      const value = m[2] || m[1];
      // value is usually a factory result variable, e.g. `secretService`. Find where it was assigned
      // from a factory, then map that factory symbol to its file.
      const assign = src.match(new RegExp(`const\\s+${value}\\s*=\\s*([A-Za-z0-9_$]+)\\s*\\(`));
      const factory = assign ? assign[1] : null;
      const file = (factory && symbolToFile.get(factory)) || symbolToFile.get(value) || null;
      if (file) map.set(key, file);
    }
  }
  return map;
}

const SERVICE_FILE = buildServiceFileMap();

// ---------------------------------------------------------------------------- graph assembly

const nodes = new Map();
const edges = [];

function addNode(path, { seed = false } = {}) {
  if (!path || path.includes("node_modules")) return null;
  if (nodes.has(path)) {
    if (seed) nodes.get(path).seed = true;
    return nodes.get(path);
  }
  const { kind, layer } = classify(path);
  const c = churn.get(path);
  const n = {
    id: path,
    label: basename(path),
    dir: dirname(path),
    kind,
    layer,
    changed: Boolean(c),
    churn: c || null,
    seed
  };
  nodes.set(path, n);
  return n;
}

function addEdge(from, to, kind, label, evidence, confidence = "high") {
  if (!from || !to || from === to) return;
  if (!nodes.has(from) || !nodes.has(to)) return;
  // Parallel edges are intentional: two call paths between the same pair are two edges, distinguished
  // by label, which is what makes the graph show *how* the files are connected.
  const dup = edges.find((e) => e.from === from && e.to === to && e.kind === kind && e.label === label);
  if (dup) {
    if (evidence && !dup.evidence.some((x) => x.file === evidence.file && x.line === evidence.line)) {
      dup.evidence.push(evidence);
    }
    return;
  }
  edges.push({ from, to, kind, label, confidence, evidence: evidence ? [evidence] : [] });
}

// 1. seed with the changed files
for (const f of changedFiles) addNode(f, { seed: true });

// 2. expand DOWN along imports (what the change depends on), bounded
let frontier = [...nodes.keys()];
for (let d = 0; d < DEPTH; d += 1) {
  const next = [];
  for (const path of frontier) {
    if (!/\.(ts|tsx|mts)$/.test(path)) continue;
    for (const imp of importsOf(path)) {
      const created = !nodes.has(imp.target);
      addNode(imp.target);
      if (created) next.push(imp.target);
    }
  }
  frontier = next;
}

// 3. expand UP along importers (what reaches the change). This is what pulls in the routers and pages
//    above a changed service, which is the half that makes a UI-to-data trace possible at all.
/**
 * A hub is a module so widely imported that its importers say nothing about *this* change.
 *
 * `audit-log-types.ts` has 208 importers, `auth-type.ts` 230. When one of those is in the diff (adding
 * a field to an audit event is a one-line change that happens often) expanding it pulls in essentially
 * every router in the backend, and then each of their service calls, so the graph fills with pki-scep and
 * access-approval edges that have nothing to do with the change. The signal drowns.
 *
 * The node itself stays (it is part of the change); only the fan-out is cut, and what was cut is reported
 * rather than silently dropped.
 */
const HUB_IMPORTER_LIMIT = Number(flag("hub-limit", 40));
const hubs = [];
let upFrontier = changedFiles.filter((p) => /\.(ts|tsx|mts)$/.test(p));
for (let d = 0; d < DEPTH + 1; d += 1) {
  const next = [];
  for (const path of upFrontier) {
    const importers = importersOf(path);
    if (importers.length > HUB_IMPORTER_LIMIT) {
      hubs.push({ id: path, importers: importers.length, expanded: false });
      continue;
    }
    for (const importer of importers) {
      const created = !nodes.has(importer);
      addNode(importer);
      // Stop climbing once we reach a page or router: those are entrypoints, and going further up
      // only adds layout and app-shell noise.
      const k = classify(importer).kind;
      if (created && !["page", "router", "route-def", "route-registry"].includes(k)) next.push(importer);
    }
  }
  upFrontier = next;
}

// 4. import edges, labelled with the symbols that cross the boundary
for (const path of [...nodes.keys()]) {
  if (!/\.(ts|tsx|mts)$/.test(path)) continue;
  for (const imp of importsOf(path)) {
    if (!nodes.has(imp.target)) continue;
    const label = imp.symbols.slice(0, 3).join(", ") + (imp.symbols.length > 3 ? ` +${imp.symbols.length - 3}` : "");
    addEdge(path, imp.target, imp.typeOnly ? "import-type" : "import", label || basename(imp.target), {
      file: path,
      line: imp.line
    });
  }
}

// 5. the frontend/backend seam: HTTP call -> route declaration
const routerFiles = [];
for (const p of nodes.keys()) if (classify(p).kind === "router") routerFiles.push(p);
// Widen: a changed frontend hook may call a router that is not itself in the diff.
if (changedFiles.some((f) => f.startsWith("frontend/"))) {
  for (const p of listRouterFiles()) {
    if (!routerFiles.includes(p)) routerFiles.push(p);
  }
}
const routeIndex = routerFiles.flatMap((f) => routesOf(f).map((r) => ({ ...r, file: f })));

for (const path of [...nodes.keys()]) {
  if (!path.startsWith("frontend/")) continue;
  for (const call of apiCallsOf(path)) {
    const sameMethod = routeIndex.filter((r) => r.method === call.method);
    let hits = sameMethod
      .filter((r) => pathsMatch(call.url, r.path))
      .map((r) => ({ route: r, confidence: "high", label: `${call.method} ${r.path}` }));

    if (hits.length === 0) {
      // Fallback for a route whose mount prefix still could not be resolved. Only accept it when exactly
      // ONE router in the whole index matches the call's tail: if several could, the honest output is a
      // dangling seam, not a guess. An earlier version scored candidates by filename similarity and
      // confidently attributed a PAM session route to the membership router, which is precisely the kind
      // of wrong-but-plausible edge that makes a graph untrustworthy.
      const tailMatches = sameMethod.filter((r) => suffixAffinityScore(call.url, r, r.file) > 0);
      const files = new Set(tailMatches.map((r) => r.file));
      if (files.size === 1) {
        hits = [{ route: tailMatches[0], confidence: "heuristic", label: `${call.method} ${call.url}` }];
      }
    }

    for (const hit of hits) {
      addNode(hit.route.file);
      addEdge(path, hit.route.file, "http", hit.label, { file: path, line: call.line }, hit.confidence);
    }
    if (hits.length === 0) {
      // Record the unmatched call so the extension can show a dangling seam rather than hiding it.
      addEdge(path, path, "http-unresolved", `${call.method} ${call.url}`, { file: path, line: call.line }, "heuristic");
    }
  }
}

// 6. router -> service, labelled with the service method actually called
for (const path of [...nodes.keys()]) {
  if (classify(path).kind !== "router") continue;
  for (const sc of serviceCallsOf(path)) {
    const target = SERVICE_FILE.get(sc.service);
    if (!target) continue;
    addNode(target);
    addEdge(path, target, "service-call", `${sc.service}.${sc.method}`, { file: path, line: sc.line }, "high");
  }
}

// 7. traces: entrypoint (frontend page/hook) -> sink (dal/fns/migration), so the extension can
//    highlight a whole UI-to-data path in one click.
const LAYER_ORDER = { frontend: 0, router: 1, service: 2, data: 3 };
const adj = new Map();
for (const e of edges) {
  if (e.kind === "http-unresolved") continue;
  if (!adj.has(e.from)) adj.set(e.from, []);
  adj.get(e.from).push(e);
}

// Two kinds of start point, because the useful trace is "how does this change reach the backend" and the
// changed file is not always the one holding the API call. So walk from every changed frontend file AND
// from every frontend file that owns a seam edge, then keep only traces that touch something changed.
const seamStarts = new Set(edges.filter((e) => e.kind === "http").map((e) => e.from));
const entrypoints = [
  ...new Set([
    ...[...nodes.values()]
      .filter((n) => n.seed && n.layer === "frontend")
      .map((n) => n.id),
    ...seamStarts
  ])
];
const sinkKinds = new Set(["dal", "fns", "migration", "db-schema", "service"]);

const traces = [];
const seenTrace = new Set();
for (const start of entrypoints) {
  const stack = [{ node: start, path: [start], labels: [] }];
  while (stack.length && traces.length < 300) {
    const cur = stack.pop();
    const curNode = nodes.get(cur.node);

    // Record as soon as a sink is reached, not only at a dead end: a service almost always has further
    // imports, so waiting for one meant no trace was ever emitted.
    if (
      cur.path.length >= 3 &&
      sinkKinds.has(curNode?.kind) &&
      // A trace nobody changed is not review-relevant, however well-formed it is.
      cur.path.some((p) => nodes.get(p)?.changed)
    ) {
      const key = cur.path.join(">");
      if (!seenTrace.has(key)) {
        seenTrace.add(key);
        traces.push({
          nodes: cur.path,
          labels: cur.labels,
          entry: start,
          sink: cur.node,
          crossesSeam: cur.labels.some((l) => l.startsWith("http:"))
        });
      }
    }
    if (cur.path.length >= 6) continue;

    const forward = (adj.get(cur.node) || []).filter((e) => {
      // Stay inside the layered flow: docs, tests and unclassified files are destinations, not waypoints.
      const a = LAYER_ORDER[nodes.get(e.from)?.layer];
      const b = LAYER_ORDER[nodes.get(e.to)?.layer];
      return a !== undefined && b !== undefined && b >= a && !cur.path.includes(e.to);
    });
    for (const e of forward.slice(0, 8)) {
      stack.push({ node: e.to, path: [...cur.path, e.to], labels: [...cur.labels, `${e.kind}:${e.label}`] });
    }
  }
}
// Prefer the traces that actually span the frontend/backend seam: those are the ones a reviewer wants.
traces.sort((a, b) => Number(b.crossesSeam) - Number(a.crossesSeam) || a.nodes.length - b.nodes.length);

// ---------------------------------------------------------------------------- output

if (argv.includes("--debug")) {
  console.error("--- PREFIX (routers only, first 12) ---");
  let i = 0;
  for (const [fn, p] of PREFIX) {
    if (!/Router|Routers|Endpoints/.test(fn)) continue;
    if (i++ < 12) console.error(`  ${fn} -> ${p || "(empty)"}`);
  }
  console.error(`--- routeIndex: ${routeIndex.length} routes; sample ---`);
  for (const r of routeIndex.slice(0, 6)) console.error(`  ${r.method} ${r.path}   [${basename(r.file)}]`);
  console.error("--- frontend api calls seen (first 8) ---");
  for (const p of [...nodes.keys()].filter((x) => x.startsWith("frontend/"))) {
    for (const c of apiCallsOf(p).slice(0, 2)) console.error(`  ${c.method} ${c.url}   [${basename(p)}]`);
  }
  console.error(`--- SERVICE_FILE entries: ${SERVICE_FILE.size} ---`);
}

const graph = {
  version: 1,
  generator: "agent/skills/sweep/graph/build-graph.mjs",
  pr: PR ? Number(PR) : null,
  base: git("rev-parse", "--short", BASE).trim(),
  head: git("rev-parse", "--short", HEAD).trim(),
  stats: {
    changedFiles: changedFiles.length,
    nodes: nodes.size,
    edges: edges.length,
    traces: traces.length,
    unresolvedApiCalls: edges.filter((e) => e.kind === "http-unresolved").length
  ,
    hubsSuppressed: hubs.length},
  legend: {
    layers: ["frontend", "router", "service", "data", "docs", "test", "infra", "other"],
    edgeKinds: {
      import: "static import; label lists the symbols crossing the boundary",
      "import-type": "type-only import",
      http: "frontend API call matched to a backend route declaration; label is METHOD and full path",
      "http-unresolved": "frontend API call whose route could not be matched; self-edge, shown as dangling",
      "service-call": "router handler invoking server.services.<name>.<method>()"
    }
  },
  hubs,
  nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
  edges: edges.sort((a, b) => (a.from + a.to + a.label).localeCompare(b.from + b.to + b.label)),
  traces
};

const out = OUT || join(REPO, `sweep-graph-${PR || graph.head}.json`);
writeFileSync(out, JSON.stringify(graph, null, 2));

/**
 * The postable subset: seeds plus whatever is directly wired to them.
 *
 * The full graph is the right thing to hand a tool, and the wrong thing to paste into a comment: a
 * few hundred nodes is unreadable and megabytes of JSON. What a reviewer wants is the change and its
 * immediate neighbours, including the unchanged routers and services it calls, with the call labels
 * intact. Emitting this from the builder rather than assembling it by hand is the point: the last time
 * it was hand-built, it silently stopped being produced at all.
 */
const SUBSET_OUT = flag("subset", null);
if (SUBSET_OUT) {
  const seedIds = new Set(graph.nodes.filter((n) => n.seed).map((n) => n.id));

  // Degree, so a hub seed does not drag its whole neighbourhood in. A one-line addition to a shared
  // types or constants module is a normal diff, and expanding it produced 130 nodes of unrelated PAM
  // routers around a folder change. Such a seed stays visible as a node; it just does not radiate.
  const degree = new Map();
  for (const e of graph.edges) {
    degree.set(e.from, (degree.get(e.from) || 0) + 1);
    degree.set(e.to, (degree.get(e.to) || 0) + 1);
  }
  // Only behaviour-carrying seeds radiate. A shared types, constants or api-docs module is imported by
  // half the backend, so an edge into it means "this file uses a shared definition" and says nothing
  // about the change's flow: radiating from `api-docs/constants.ts` filled a folder change with PAM
  // routers. Degree alone cannot separate them (that module scored 25 against the router's 23), so the
  // rule is the node's kind, with degree kept as a backstop for an unusually connected router.
  const BEHAVIOURAL = new Set([
    "router", "route-def", "route-registry", "service", "dal", "fns", "queue",
    "page", "component", "hook", "query-hook", "mutation-hook", "migration"
  ]);
  const kindOf = new Map(graph.nodes.map((n) => [n.id, n.kind]));
  const SUBSET_DEGREE_LIMIT = Number(flag("subset-degree", 40));
  const radiating = new Set(
    [...seedIds].filter(
      (id) => BEHAVIOURAL.has(kindOf.get(id)) && (degree.get(id) || 0) <= SUBSET_DEGREE_LIMIT
    )
  );
  const notRadiating = [...seedIds].filter((id) => !radiating.has(id));

  const keep = new Set(seedIds);
  for (const e of graph.edges) {
    if (radiating.has(e.from)) keep.add(e.to);
    if (radiating.has(e.to)) keep.add(e.from);
  }
  const subNodes = graph.nodes.filter((n) => keep.has(n.id));
  // Cap evidence: this block is pasted into a GitHub comment, which hard-limits at 65536 characters, and
  // a single `auditLog.createAuditLog` edge can carry 16 call sites. Three is enough to jump to.
  const EVIDENCE_CAP = 3;
  const subEdges = graph.edges
    .filter((e) => keep.has(e.from) && keep.has(e.to))
    .map((e) => {
      const ev = e.evidence || [];
      return ev.length > EVIDENCE_CAP
        ? { ...e, evidence: ev.slice(0, EVIDENCE_CAP), evidenceTotal: ev.length }
        : e;
    });
  const subset = {
    version: graph.version,
    pr: graph.pr,
    base: graph.base,
    head: graph.head,
    subset: true,
    stats: {
      nodes: subNodes.length,
      edges: subEdges.length,
      seeds: seedIds.size,
      ofNodes: graph.nodes.length,
      seedsNotExpanded: notRadiating
    },
    hubs: graph.hubs,
    nodes: subNodes,
    edges: subEdges
  };
  writeFileSync(SUBSET_OUT, JSON.stringify(subset));
  console.log(`subset: ${subNodes.length} nodes, ${subEdges.length} edges -> ${SUBSET_OUT}`);
}

const byLayer = {};
for (const n of graph.nodes) byLayer[n.layer] = (byLayer[n.layer] || 0) + 1;
const byEdge = {};
for (const e of graph.edges) byEdge[e.kind] = (byEdge[e.kind] || 0) + 1;

console.log(`graph: ${graph.stats.nodes} nodes, ${graph.stats.edges} edges, ${graph.stats.traces} traces`);
console.log(`  nodes by layer: ${JSON.stringify(byLayer)}`);
console.log(`  edges by kind:  ${JSON.stringify(byEdge)}`);
if (graph.stats.unresolvedApiCalls) {
  console.log(`  ${graph.stats.unresolvedApiCalls} API call(s) could not be matched to a route (shown as dangling)`);
}
if (hubs.length) {
  console.log(`  ${hubs.length} hub module(s) not expanded (>${HUB_IMPORTER_LIMIT} importers):`);
  for (const h of hubs) console.log(`    ${h.id} (${h.importers} importers)`);
}
console.log(`written: ${out}`);
