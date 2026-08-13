#!/usr/bin/env node
/**
 * Render a graph JSON as the ASCII trace that goes in the review comment.
 *
 * Exists so nobody draws the tree by hand. A hand-drawn graph is a graph that can disagree with the code,
 * and the whole point of the builder is that every edge came from a parse. Reads either the full graph or
 * a --subset file and walks the same edges the extension gets.
 *
 * Roots are the changed nodes nothing else in the graph points at, so the tree reads in the direction the
 * request travels: UI down to data.
 *
 * Usage:
 *   node agent/skills/sweep/graph/render-trace.mjs <graph.json> [--max-depth 6]
 */

import { readFileSync } from "node:fs";
import { basename } from "node:path";

const argv = process.argv.slice(2);
const file = argv.find((a) => !a.startsWith("--"));
const flag = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? d : argv[i + 1];
};
if (!file) {
  console.error("usage: node agent/skills/sweep/graph/render-trace.mjs <graph.json> [--max-depth 6]");
  process.exit(2);
}
const MAX_DEPTH = Number(flag("max-depth", 6));

const graph = JSON.parse(readFileSync(file, "utf8"));
const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));

const out = new Map();
for (const e of graph.edges) {
  if (e.from === e.to) continue;
  if (!out.has(e.from)) out.set(e.from, []);
  out.get(e.from).push(e);
}

// A root is a changed file that no OTHER changed file reaches. Using "no incoming edge at all" hid every
// changed component that something unchanged imports, which is most of them, so the frontend leg of a
// full-stack change never appeared in the tree.
const changedIds = new Set(graph.nodes.filter((n) => n.changed).map((n) => n.id));
const reachedFromChanged = new Set();
{
  const stack = [...changedIds];
  const seen = new Set();
  while (stack.length) {
    const cur = stack.pop();
    for (const e of graph.edges) {
      if (e.from !== cur || e.to === cur) continue;
      if (changedIds.has(e.to) && e.from !== e.to) reachedFromChanged.add(e.to);
      if (!seen.has(e.to)) {
        seen.add(e.to);
        stack.push(e.to);
      }
    }
  }
}
let roots = [...changedIds].filter((id) => !reachedFromChanged.has(id));
if (roots.length === 0) {
  const hasIncoming = new Set(graph.edges.filter((e) => e.from !== e.to).map((e) => e.to));
  roots = graph.nodes.filter((n) => !hasIncoming.has(n.id)).map((n) => n.id);
}
if (roots.length === 0) roots = [...changedIds];
roots.sort();

const label = (id) => {
  const n = nodeById.get(id);
  const kind = n ? n.kind : "?";
  return `${basename(id)}  (${kind}${n && n.changed ? ", changed" : ""})`;
};

const lines = [];
const expanded = new Set();

/** Several edges into the same file (twelve service calls into one service) read as one line. */
function groupEdges(id, seen) {
  const byTarget = new Map();
  for (const e of out.get(id) || []) {
    if (seen.has(e.to)) continue;
    if (!byTarget.has(e.to)) byTarget.set(e.to, []);
    byTarget.get(e.to).push(e);
  }
  return [...byTarget.entries()]
    .map(([to, es]) => {
      const labels = [...new Set(es.map((e) => e.label).filter(Boolean))];
      const shown = labels.slice(0, 3).join(", ") + (labels.length > 3 ? ` +${labels.length - 3}` : "");
      return { to, kind: es[0].kind, label: shown };
    })
    .sort((a, b) => a.to.localeCompare(b.to));
}

function walk(id, depth, prefix, seen) {
  const kids = groupEdges(id, seen);
  kids.forEach((e, i) => {
    const last = i === kids.length - 1;
    const pad = `${prefix}${last ? "   " : "│  "}   `;
    lines.push(`${prefix}${last ? "└─" : "├─"} ${e.kind === "import" ? "" : `${e.kind}: `}${e.label}`);
    // A file already expanded elsewhere is shown once and pointed at, so one shared service does not get
    // its whole subtree reprinted under every caller.
    const repeat = expanded.has(e.to) && (out.get(e.to) || []).length > 0;
    lines.push(`${pad.slice(0, -3)}   ${label(e.to)}${repeat ? "   [see above]" : ""}`);
    if (!repeat && depth + 1 < MAX_DEPTH) {
      expanded.add(e.to);
      walk(e.to, depth + 1, pad, new Set([...seen, e.to]));
    }
  });
}

for (const root of roots) {
  expanded.add(root);
  lines.push(label(root));
  walk(root, 0, "", new Set([root]));
  lines.push("");
}

console.log(lines.join("\n").trimEnd());
