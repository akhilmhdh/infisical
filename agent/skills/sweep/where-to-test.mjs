#!/usr/bin/env node
/**
 * "Where to test this": the informational comment SWEEP posts alongside a review.
 *
 * A reviewer's first question on a UI change is "which screen is this even on", and on an API change
 * it is "what do I curl". Both answers are derivable from the source, so nobody should be guessing:
 * this walks the change back to the routes that expose it.
 *
 * Grouped by route on purpose. Several changed components frequently render on one screen, and listing
 * them separately implies several rounds of setup when one page visit covers the lot.
 *
 * Known limits, measured rather than assumed:
 *   - Verified accurate on single-PR diffs (the shape it is for): a changed page file, a changed shared
 *     hook, and a changed router each resolved to exactly the right screens and endpoints.
 *   - On a very wide range (20 commits, ~100 screens) a small number of spurious screens survive,
 *     including the redirect-only root route. Treat a long screen list as a hint, not a contract.
 *   - A screen reached only through 2+ import hops is not reported at all; on this repo those drift to
 *     pages that touch none of the changed code.
 *   - Endpoints come from changed router files only. A changed *service* reached by an unchanged router is
 *     not listed here: use the graph for that.
 *
 * Usage:
 *   node agent/skills/sweep/where-to-test.mjs <base-ref> <head-ref> [--out where.md] [--json where.json]
 */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { createResolver } from "./graph/route-resolve.mjs";

const argv = process.argv.slice(2);
const positional = argv.filter((a) => !a.startsWith("--"));
const flag = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? d : argv[i + 1];
};
const [BASE, HEAD] = positional;
if (!BASE || !HEAD) {
  console.error("usage: node agent/skills/sweep/where-to-test.mjs <base-ref> <head-ref> [--out f.md] [--json f.json]");
  process.exit(2);
}
const OUT = flag("out", null);
const JSON_OUT = flag("json", null);

const R = createResolver(HEAD);
const { git, files, show, routesOf, importersOf } = R;

const changed = git("diff", "--name-only", `${BASE}...${HEAD}`).split("\n").filter(Boolean);

/** New-side line ranges touched per file, so a router file's *unchanged* routes are not reported. */
function changedLines(path) {
  const ranges = [];
  let out = "";
  try {
    out = git("diff", "-U0", `${BASE}...${HEAD}`, "--", path);
  } catch {
    return ranges;
  }
  for (const m of out.matchAll(/^@@ -\S+ \+(\d+)(?:,(\d+))? @@/gm)) {
    const start = Number(m[1]);
    const count = m[2] === undefined ? 1 : Number(m[2]);
    if (count > 0) ranges.push([start, start + count - 1]);
  }
  return ranges;
}
const inChanged = (ranges, line) => ranges.some(([a, b]) => line >= a && line <= b);

// ---------------------------------------------------------------- UI: file -> URL

/**
 * Build routeFile -> URL from the generated route tree.
 *
 * routeTree.gen.ts is the authoritative mapping and already has the *fully resolved* id, including the
 * pathless layout segments (`_authenticate`, `_org-layout`) that routes.ts nests by hand. Re-deriving the
 * URL by walking routes.ts would mean reimplementing that nesting, and getting it subtly wrong sends a
 * reviewer to a URL that 404s.
 */
function buildRouteMap() {
  const src = show("frontend/src/routeTree.gen.ts");
  const byFile = new Map();
  if (!src) return byFile;

  // import { Route as someAlias } from './pages/x/y/route'
  const aliasToFile = new Map();
  for (const m of src.matchAll(/import\s*\{\s*Route as (\w+)\s*\}\s*from\s*'([^']+)'/g)) {
    aliasToFile.set(m[1], `frontend/src/${m[2].replace(/^\.\//, "")}.tsx`);
  }

  // Entries look like:  '<very/long/route/id>': { id: '...', path: '...', preLoaderRoute: typeof alias, ... }
  // A fixed-size lookahead from the key does not work: these ids are 100+ chars and repeat several times
  // inside the block, so a window big enough for one entry silently skips the next. Anchor on the
  // preLoaderRoute instead and search backwards for the key that encloses it.
  for (const m of src.matchAll(/preLoaderRoute:\s*typeof (\w+)/g)) {
    const alias = m[1];
    const file = aliasToFile.get(alias);
    if (!file) continue;
    const before = src.slice(0, m.index);
    const keyMatch = [...before.matchAll(/'(\/[^']*)':\s*\{/g)].pop();
    if (!keyMatch) continue;
    const id = keyMatch[1];
    // Skip pathless layouts and middlewares (`_authenticate`, `_org-layout`, `_inject-org-details`).
    // They wrap other routes and have no URL of their own, so stripping their underscore segments
    // collapses them to "/", which made every changed layout look like it rendered the root page and
    // turned their directories into owners of large parts of the tree. The genuine index route keeps its
    // bare "/" id, which has no trailing segment at all, so it survives this check.
    const lastSegment = id.split("/").filter(Boolean).pop();
    if (lastSegment && lastSegment.startsWith("_")) continue;
    const prev = byFile.get(file);
    // Prefer the longest id: a route file can appear under both a bare and a layout-nested id.
    if (!prev || id.length > prev.length) byFile.set(file, id);
  }

  return byFile;
}

/** Strip pathless layout segments (`_authenticate`), they structure the tree but are not in the URL. */
const idToUrl = (id) => {
  const url = id
    .split("/")
    .filter((s) => s && !s.startsWith("_"))
    .join("/");
  return `/${url}`;
};

const ROUTE_BY_FILE = buildRouteMap();

/**
 * Directories that hold a route file, plus the ones too coarse to own a descendant.
 *
 * `frontend/src/pages/index.tsx` is the route for `/` and its directory is the root of the whole pages
 * tree, so a plain nearest-ancestor walk made it the owner of every page lacking its own route file: a
 * project-settings sheet came out as `/`. The fix is NOT "a directory containing other route directories
 * cannot own files": `ProjectsPage/` holds both its own `route.tsx` and a nested `ProjectTypePage/route.tsx`,
 * and that rule attributed `ProjectsPage.tsx` to the nested `$type` route instead of its own. So: a
 * directory always owns the files sitting directly in it, and only a directory that is an ancestor of many
 * route directories is barred from claiming deeper descendants.
 */
const ROUTE_DIRS = new Set([...ROUTE_BY_FILE.keys()].map((f) => dirname(f)));
const COARSE_DIR_THRESHOLD = 5;
const COARSE_DIRS = new Set(
  [...ROUTE_DIRS].filter(
    (d) => [...ROUTE_DIRS].filter((other) => other !== d && other.startsWith(`${d}/`)).length >= COARSE_DIR_THRESHOLD
  )
);

const routeFileIn = (dir) => {
  if (!ROUTE_DIRS.has(dir)) return null;
  for (const candidate of ROUTE_BY_FILE.keys()) if (dirname(candidate) === dir) return candidate;
  return null;
};

/** The route file that owns a page file. Own directory first, then nearest non-coarse ancestor. */
function owningRouteFile(path) {
  const own = routeFileIn(dirname(path));
  if (own) return own;
  let dir = dirname(dirname(path));
  while (dir.startsWith("frontend/src")) {
    if (!COARSE_DIRS.has(dir)) {
      const rf = routeFileIn(dir);
      if (rf) return rf;
    }
    dir = dirname(dir);
  }
  return null;
}

const symbolCache = new Map();
const refCache = new Map();
let grepBudget = 600;
let grepBudgetHit = false;

/**
 * Exported names that carry no information about *which* module they came from.
 *
 * Every TanStack route file exports `Route`, so grepping that symbol matches all ~200 of them and made a
 * changed middleware look like it rendered every screen in the app. Framework-convention names have to be
 * dropped before the grep, or reachability degrades into "everything references everything".
 */
const AMBIGUOUS_SYMBOLS = new Set(["Route", "default", "loader", "action", "config", "meta", "handle", "Component"]);

/** Identifiers a file exports. These, not its path, are what downstream code actually references. */
function exportedSymbols(path) {
  if (symbolCache.has(path)) return symbolCache.get(path);
  const src = show(path);
  if (!src) return [];
  const out = new Set();
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) {
    out.add(m[1]);
  }
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name) && name !== "type") out.add(name);
    }
  }
  const list = [...out].filter((sym) => !AMBIGUOUS_SYMBOLS.has(sym) && sym.length > 2);
  symbolCache.set(path, list);
  return list;
}

/**
 * Files that reference any of `symbols`.
 *
 * Symbol-level rather than path-level on purpose. Walking the import graph through a barrel means
 * fanning out to every one of the hundreds of files that import `@app/hooks/api`, which is both far too
 * slow and far too broad: most of them never touch the hook that changed. Grepping the exported
 * identifiers finds exactly the call sites, through any number of barrels, in one pass.
 */
function referencingFiles(symbols) {
  if (!symbols.length) return [];
  const key = symbols.slice().sort().join("\u0000");
  if (refCache.has(key)) return refCache.get(key);
  if (grepBudget <= 0) {
    grepBudgetHit = true;
    return [];
  }
  grepBudget -= 1;
  const args = ["grep", "-l", "-w"];
  for (const s of symbols) args.push("-e", s);
  args.push(HEAD, "--", "frontend/src/*.ts", "frontend/src/*.tsx");
  try {
    const out = execFileSync("git", args, {
      encoding: "utf8",
      maxBuffer: 1 << 26,
      stdio: ["ignore", "pipe", "ignore"]
    })
      .split("\n")
      .filter(Boolean)
      .map((l) => l.replace(`${HEAD}:`, ""));
    refCache.set(key, out);
    return out;
  } catch {
    refCache.set(key, []);
    return [];
  }
}

/**
 * Screens that reference the change, reported at the SHALLOWEST hop that finds any.
 *
 * Symbol grep already sees through barrels: `useUpdateFolder` is the same identifier however it was
 * imported, so hop 1 is precise for a changed hook or component. Extra hops exist only for a leaf whose
 * direct users are themselves non-page files, and they drift fast: on this repo hop 3 from a folder hook
 * reached `/cli-redirect` and `/admin/integrations`, which touch no folder code at all. So deeper levels
 * are used only when the shallower ones found nothing, and anything suppressed is reported rather than
 * quietly dropped.
 */
function routesReaching(path, maxDepth = 3) {
  const visited = new Set([path]);
  let frontier = [path];
  for (let depth = 1; depth <= maxDepth && frontier.length; depth += 1) {
    const next = [];
    const hits = new Set();
    for (const file of frontier) {
      for (const user of referencingFiles(exportedSymbols(file))) {
        if (visited.has(user)) continue;
        visited.add(user);
        const rf = owningRouteFile(user);
        if (rf && ROUTE_BY_FILE.has(rf)) {
          hits.add(ROUTE_BY_FILE.get(rf));
          continue; // a screen is terminal; climbing past it reaches unrelated pages
        }
        next.push(user);
      }
    }
    // Stop at the first hop that finds screens. Exploring further costs a grep per intermediate file and
    // only produces results this function would discard anyway.
    if (hits.size) {
      const screens = new Map();
      for (const id of hits) screens.set(id, depth);
      return { screens, deeperUnexplored: next.length > 0 };
    }
    frontier = next;
  }
  return { screens: new Map(), deeperUnexplored: false };
}

const UI_CHANGED = changed.filter(
  (p) =>
    p.startsWith("frontend/src/") &&
    /\.(tsx|ts)$/.test(p) &&
    !/routeTree\.gen\.ts$/.test(p) &&
    !/\.test\.tsx?$/.test(p)
);

// url -> { components:Set, routeFiles:Set }
const screens = new Map();
const uiUnmapped = [];
let deeperUnexplored = false;
for (const f of UI_CHANGED) {
  const direct = owningRouteFile(f);
  let ids;
  if (direct && ROUTE_BY_FILE.has(direct)) {
    ids = new Map([[ROUTE_BY_FILE.get(direct), 0]]);
  } else {
    const r = routesReaching(f);
    ids = r.screens;
    if (r.deeperUnexplored) deeperUnexplored = true;
  }
  if (!ids.size) {
    uiUnmapped.push(f);
    continue;
  }
  for (const [id, depth] of ids) {
    const url = idToUrl(id);
    if (!screens.has(url)) screens.set(url, { components: new Set(), depth });
    const entry = screens.get(url);
    entry.components.add(f);
    entry.depth = Math.min(entry.depth, depth);
  }
}

// ---------------------------------------------------------------- API: changed routers -> endpoints

const ROUTER_CHANGED = changed.filter((p) => /-router\.ts$|-endpoints\.ts$/.test(p) && files.has(p));
const endpoints = [];
for (const f of ROUTER_CHANGED) {
  const ranges = changedLines(f);
  const declared = routesOf(f).sort((a, b) => a.line - b.line);
  const totalLines = (show(f) || "").split("\n").length;
  for (let i = 0; i < declared.length; i += 1) {
    const r = declared[i];
    // A route is "changed" when a hunk lands anywhere in its block, not just on the `url:` line. The
    // interesting edits are almost always in the zod schema or the handler below the declaration: the
    // description field that started this whole review being a case in point.
    const blockEnd = i + 1 < declared.length ? declared[i + 1].line - 1 : totalLines;
    const touched = ranges.some(([a, b]) => a <= blockEnd && b >= r.line);
    // An empty base means the mount could not be resolved, so `path` is only the route's own url. The
    // app-connection routers are the live example: they are mounted in a loop through a `withRoutePrefix`
    // helper rather than `server.register(fn, { prefix })`, so nothing names the prefix statically. Saying
    // so beats printing `/:connectionId/cloudflare-dns-records` at a reviewer, which 404s.
    const prefixResolved = Boolean(r.base);
    endpoints.push({
      method: r.method,
      path: r.path,
      file: f,
      line: r.line,
      blockEnd,
      touched,
      prefixResolved
    });
  }
}
// A route's handler body sits below its declaration line, so a hunk anywhere in the file's route block
// still matters; flag the file as touched even when no declaration line itself moved.
const touchedFiles = new Set(endpoints.filter((e) => e.touched).map((e) => e.file));

// ---------------------------------------------------------------- render

const paramNote = (url) => /\$|:/.test(url);

let md = "";
if (screens.size || endpoints.length) {
  md += "> [!NOTE]\n> 🤖 **SWEEP** review\n\n";
  md += "## Where to test this\n\n";
  md += "Where this change actually shows up, worked out from the diff rather than guessed.\n\n";
}

if (screens.size) {
  md += `### Screens to open (${screens.size})\n\n`;
  md += "One screenshot per screen is enough. Everything listed under a screen is visible on it.\n\n";
  const rows = [...screens.entries()].sort(
    (a, b) => a[1].depth - b[1].depth || b[1].components.size - a[1].components.size || a[0].localeCompare(b[0])
  );
  // Cap what is rendered inline: a wide PR can reach a hundred screens, and a comment that long stops
  // being read at all. The remainder is listed, not dropped: a hidden cap reads as "this is everything".
  const INLINE_CAP = 12;
  const render = (url, entry) => {
    const how = entry.depth === 0 ? "contains the changed file" : "uses the changed code indirectly";
    let t = `#### \`${url}\`\n\n_${how}_\n\n`;
    for (const c of [...entry.components].sort()) t += `- \`${c}\`\n`;
    return `${t}\n`;
  };
  for (const [url, entry] of rows.slice(0, INLINE_CAP)) md += render(url, entry);
  if (rows.length > INLINE_CAP) {
    md += `<details><summary>${rows.length - INLINE_CAP} more screen(s)</summary>\n\n`;
    for (const [url, entry] of rows.slice(INLINE_CAP)) md += render(url, entry);
    md += "</details>\n\n";
  }
  if (deeperUnexplored) {
    md += "Screens further away were not checked. On this repo they turn out to be pages that do not\n";
    md += "touch the change at all.\n\n";
  }
  if (rows.some(([u]) => paramNote(u))) {
    md += "`$projectId` and `$envSlug` are placeholders. Use your own project and environment.\n\n";
  }
}

if (uiUnmapped.length) {
  md += "<details><summary>Changed frontend files with no owning screen</summary>\n\n";
  md += "Shared code that does not belong to one screen. Worth a look by hand.\n\n";
  for (const f of uiUnmapped.sort()) md += `- \`${f}\`\n`;
  md += "\n</details>\n\n";
}

if (endpoints.length) {
  const touched = endpoints.filter((e) => e.touched);
  const rest = endpoints.filter((e) => !e.touched);
  md += `### Endpoints to try (${endpoints.length})\n\n`;
  const table = (list) => {
    let t = "| Method | Path | Declared in |\n| --- | --- | --- |\n";
    for (const e of list.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method))) {
      const shown = e.prefixResolved ? `\`${e.path}\`` : `\`…${e.path}\` ⚠️ prefix unresolved`;
      t += `| \`${e.method}\` | ${shown} | \`${e.file}:${e.line}\` |\n`;
    }
    return `${t}\n`;
  };
  if (touched.length) {
    md += `**Changed in this PR. Try these first.**\n\n${table(touched)}`;
  }
  if (rest.length) {
    md += `<details><summary>Other endpoints in the same files (${rest.length}). Worth a look if something regresses.</summary>\n\n`;
    md += "These did not change, but they live in the same file as something that did.\n\n";
    md += table(rest);
    md += "</details>\n\n";
  }
  if (endpoints.some((e) => !e.prefixResolved)) {
    md += "⚠️ means the full path could not be worked out. What is shown is only the tail of it. These\n";
    md += "routes are registered in a loop, so check the registration for the missing prefix.\n\n";
  }
  md += "Each route lists what can call it in `onRequest: verifyAuth([...])`. Check that before assuming\n";
  md += "a browser session works.\n\n";
}

if (grepBudgetHit) {
  md += "> Reachability search hit its grep budget, so the screen list may be incomplete.\n\n";
}

if (!screens.size && !endpoints.length) {
  md += "This change does not reach any screen or endpoint.\n";
}

md += "<!-- sweep-where-to-test -->\n";

const result = {
  base: BASE.slice(0, 10),
  head: HEAD.slice(0, 10),
  screens: [...screens.entries()].map(([url, e]) => ({
    url,
    depth: e.depth,
    components: [...e.components].sort()
  })),
  unmappedFrontendFiles: uiUnmapped.sort(),
  endpoints,
  changedRouterFiles: [...touchedFiles].sort()
};

if (OUT) writeFileSync(OUT, md);
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(result, null, 2));
if (!OUT) process.stdout.write(md);

console.error(
  `where-to-test: ${screens.size} screen(s), ${endpoints.length} endpoint(s) ` +
    `(${endpoints.filter((e) => e.touched).length} changed), ${uiUnmapped.length} unmapped`
);
