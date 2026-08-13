/**
 * Route resolution against a git ref, shared by the graph builder and the where-to-test reporter.
 *
 * This lives on its own because working out a router's real prefix is the part that was wrong the most
 * times: registration is a tree (`/api/v1` -> `/pam` -> `/sessions`), some mounts are anonymous arrow
 * functions carrying the prefix, and a single router file can export several register functions at
 * different prefixes. Two copies of that logic would drift, and a drifted copy tells a reviewer to curl
 * an endpoint that does not exist.
 *
 * Everything reads from a git ref, never the working tree, so a report is reproducible and does not
 * depend on which branch happens to be checked out.
 */

import { execFileSync } from "node:child_process";
import { basename, dirname, resolve as pathResolve } from "node:path";

export function createResolver(ref) {
  const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 1 << 28 });

  /**
   * Every path at `ref`, listed once. Import resolution probes several candidate suffixes per
   * specifier, and doing that with a `git show` per candidate meant thousands of process spawns and a
   * runtime measured in minutes. Set membership makes it instant.
   */
  const files = new Set(git("ls-tree", "-r", "--name-only", ref).split("\n").filter(Boolean));

  const showCache = new Map();
  /** Read a file at `ref`. The working tree may be on another branch, so never read from disk. */
  function show(path) {
    if (showCache.has(path)) return showCache.get(path);
    let out = null;
    try {
      // stderr ignored: probing candidate paths during import resolution makes git print "fatal:" for
      // every miss, which would otherwise flood the console.
      out = execFileSync("git", ["show", `${ref}:${path}`], {
        encoding: "utf8",
        maxBuffer: 1 << 26,
        stdio: ["ignore", "pipe", "ignore"]
      });
    } catch {
      out = null;
    }
    showCache.set(path, out);
    return out;
  }

  const normPath = (p) => ("/" + p.replace(/^\/+/, "")).replace(/\/+/g, "/").replace(/\/$/, "") || "/";

  /** Walk balanced parens from a `server.register(` to find where that call ends. */
  function findMountEnd(src, start) {
    let depth = 0;
    for (let i = src.indexOf("(", start); i < src.length && i !== -1; i += 1) {
      const c = src[i];
      if (c === "(") depth += 1;
      else if (c === ")") {
        depth -= 1;
        if (depth === 0) return i + 1;
      }
      // A malformed or minified file could otherwise walk the whole buffer per registration.
      if (i - start > 20000) return -1;
    }
    return -1;
  }

  function buildPrefixMap() {
    // Registration is a tree, not a flat list: routes/index.ts mounts registerV1Routes at "/api/v1",
    // v1/index.ts mounts registerPamRouters at "/pam", and pam-routers/index.ts mounts
    // registerPamSessionRouter at "/sessions". A router's real prefix is the whole chain, so resolve it
    // recursively instead of taking the nearest registration.
    const registries = [...files].filter(
      (p) => /^backend\/src\/(server|ee)\/routes\/.*index\.ts$/.test(p) || p === "backend/src/server/routes/index.ts"
    );
    const child = new Map(); // childFn -> { prefix, parentFn }
    for (const reg of registries) {
      const src = show(reg);
      if (!src) continue;
      const parentFn = (src.match(/export const (register[A-Za-z0-9_$]*)/) || [])[1] || `@${reg}`;
      for (const m of src.matchAll(
        /server\.register\(\s*([A-Za-z0-9_$.]+)\s*,\s*\{\s*prefix:\s*["'`]([^"'`]*)["'`]/g
      )) {
        child.set(m[1].split(".").pop(), { prefix: m[2], parentFn });
      }
      // Anonymous mounts: `server.register(async (r) => { await r.register(registerX); ... }, { prefix: "/accounts" })`.
      // PAM uses this shape, and without handling it the routers inside get no prefix at all, which is how
      // a route ended up attributed to the wrong file.
      for (const m of src.matchAll(/server\.register\(\s*(?:async\s*)?\(/g)) {
        const start = m.index;
        const bodyEnd = findMountEnd(src, start);
        if (bodyEnd === -1) continue;
        const chunk = src.slice(start, bodyEnd);
        const prefix = (chunk.match(/\{\s*prefix:\s*["'`]([^"'`]*)["'`]/) || [])[1];
        if (!prefix) continue;
        for (const inner of chunk.matchAll(/register\(\s*([A-Za-z0-9_$.]*register[A-Za-z0-9_$.]*)/g)) {
          const fn = inner[1].split(".").pop();
          if (!child.has(fn)) child.set(fn, { prefix, parentFn });
        }
      }
    }
    const resolved = new Map();
    const resolve = (fn, seen = new Set()) => {
      if (resolved.has(fn)) return resolved.get(fn);
      const entry = child.get(fn);
      if (!entry || seen.has(fn)) return "";
      seen.add(fn);
      // Walk all the way up, so the chain includes the version mount (/api/v1). Keeping the version in the
      // path is what stops a v1 and v2 route with the same suffix from matching the same call.
      const full = `${resolve(entry.parentFn, seen)}${entry.prefix}`;
      resolved.set(fn, full);
      return full;
    };
    for (const fn of child.keys()) resolve(fn);
    return resolved;
  }

  const prefix = buildPrefixMap();

  /** Map a router file's declared routes to (method, fullPath). */
  function routesOf(path) {
    const src = show(path);
    if (!src) return [];
    const out = [];
    // A file can export SEVERAL register functions mounted at different prefixes: pam-session-router.ts
    // exports both the session router (/sessions) and the web-access router (/accounts). Attributing every
    // route in the file to the first export put routes under the wrong path, so bind each route to the
    // export block it physically sits in.
    const exportSpans = [...src.matchAll(/export const (register[A-Za-z0-9_$]*)/g)].map((m) => ({
      fn: m[1],
      at: m.index
    }));
    const baseFor = (idx) => {
      let chosen = null;
      for (const span of exportSpans) if (span.at <= idx) chosen = span.fn;
      return chosen && prefix.has(chosen) ? prefix.get(chosen) : "";
    };
    const routeRe = /server\.route\(\s*\{([\s\S]{0,600}?)\}\s*\)/g;
    for (const m of src.matchAll(routeRe)) {
      const body = m[1];
      const method = (body.match(/method:\s*["'`](\w+)["'`]/) || [])[1];
      const url = (body.match(/url:\s*["'`]([^"'`]*)["'`]/) || [])[1];
      if (!method || url === undefined) continue;
      const line = src.slice(0, m.index).split("\n").length;
      const base = baseFor(m.index);
      out.push({ method: method.toUpperCase(), path: normPath(`${base}${url}`), line, base, url });
    }
    return out;
  }

  // `-endpoints.ts` is included deliberately: some domains (pki-sync) declare routes in a file named that
  // way rather than `-router.ts`, and omitting it silently drops those endpoints from every report.
  function listRouterFiles() {
    try {
      return git("ls-tree", "-r", "--name-only", ref, "backend/src/server/routes", "backend/src/ee/routes")
        .split("\n")
        .filter((p) => /-router\.ts$|-endpoints\.ts$/.test(p));
    } catch {
      return [];
    }
  }


  // ---- import graph -------------------------------------------------------------------------------

  const EXTS = [".ts", ".tsx", ".mts", "/index.ts", "/index.tsx"];
  const IMPORT_RE = /import\s+(type\s+)?(?:([\w*\s{},$]+?)\s+from\s+)?["']([^"']+)["']/g;
  // `export * from "./queries"` / `export { x } from "./queries"`. Barrel files re-export rather than
  // import, so a scan that only understands `import` treats every barrel as a dead end, which is how a
  // component importing from `@app/hooks/api` looked like it never touched the hook it plainly uses.
  const EXPORT_FROM_RE = /export\s+(type\s+)?(?:\*|\{[^}]*\})\s*(?:as\s+\w+\s*)?from\s*["']([^"']+)["']/g;

  function resolveImport(fromFile, spec) {
    // Alias: @app/* maps to ./src/* within whichever package the importer lives in.
    let candidate = null;
    if (spec.startsWith("@app/")) {
      const pkg = fromFile.startsWith("frontend/") ? "frontend/src" : "backend/src";
      candidate = `${pkg}/${spec.slice("@app/".length)}`;
    } else if (spec.startsWith(".")) {
      candidate = pathResolve("/" + dirname(fromFile), spec).slice(1);
    } else {
      return null; // third-party
    }
    for (const ext of ["", ...EXTS]) {
      const c = candidate + ext;
      if (files.has(c)) return c;
    }
    return null;
  }

  function importsOf(path, { includeReexports = false } = {}) {
    const src = show(path);
    if (!src) return [];
    const out = [];
    if (includeReexports) {
      for (const m of src.matchAll(EXPORT_FROM_RE)) {
        const target = resolveImport(path, m[2]);
        if (!target || target === path) continue;
        const line = src.slice(0, m.index).split("\n").length;
        out.push({ target, symbols: [], line, typeOnly: Boolean(m[1]), reexport: true });
      }
    }
    for (const m of src.matchAll(IMPORT_RE)) {
      const clause = (m[2] || "").trim();
      const spec = m[3];
      const target = resolveImport(path, spec);
      if (!target || target === path) continue;
      const symbols = clause
        .replace(/[{}]/g, " ")
        .split(",")
        .map((x) => x.trim().split(/\s+as\s+/)[0].trim())
        .filter((x) => x && x !== "type" && x !== "*");
      const line = src.slice(0, m.index).split("\n").length;
      out.push({ target, symbols, line, typeOnly: Boolean(m[1]) });
    }
    return out;
  }

  /**
   * Who imports this file. `git grep` on the module basename is the cheap way to get the reverse edge,
   * but the basename alone is dangerously generic here: every API domain has a `queries.tsx`, so a
   * name-only match claims the whole frontend imports one domain's hooks. Every hit is therefore
   * re-resolved and kept only if it genuinely resolves to this exact path.
   */
  const importersCache = new Map();
  function importersOf(path, { includeReexports = false } = {}) {
    const cacheKey = includeReexports ? `re:${path}` : path;
    if (importersCache.has(cacheKey)) return importersCache.get(cacheKey);
    const stem = basename(path).replace(/\.(tsx?|mts)$/, "");
    const grepL = (pattern) => {
      try {
        return execFileSync("git", ["grep", "-l", "-F", pattern, ref, "--", "*.ts", "*.tsx"], {
          encoding: "utf8",
          maxBuffer: 1 << 26,
          stdio: ["ignore", "pipe", "ignore"]
        })
          .split("\n")
          .filter(Boolean)
          .map((l) => l.replace(`${ref}:`, ""));
      } catch {
        return [];
      }
    };
    let hits = grepL(`/${stem}"`);
    // Also catch directory-index imports ("from '.../pam-web-access'").
    const dirStem = basename(dirname(path));
    if (/index\.tsx?$/.test(basename(path)) && dirStem) {
      hits = [...new Set([...hits, ...grepL(`/${dirStem}"`)])];
    }
    const confirmed = hits.filter(
      (h) => h !== path && importsOf(h, { includeReexports }).some((i) => i.target === path)
    );
    importersCache.set(cacheKey, confirmed);
    return confirmed;
  }

  return {
    git,
    ref,
    files,
    show,
    showCache,
    normPath,
    findMountEnd,
    prefix,
    routesOf,
    listRouterFiles,
    EXTS,
    IMPORT_RE,
    resolveImport,
    importsOf,
    importersOf
  };
}
