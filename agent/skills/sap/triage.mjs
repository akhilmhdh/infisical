#!/usr/bin/env node
/**
 * SAP triage gate.
 *
 * Answers one question as cheaply as possible: is this pull request small and dull enough that a human
 * can merge it on sight, or does it need a real review?
 *
 * Everything here is deterministic and costs no model tokens. The agent reads the JSON, and only reads
 * the diff itself when this says the change is small and non-critical — which is the only case where
 * judgement adds anything. A change that trips a gate is deferred without further analysis, because the
 * point of deferring is to not spend the analysis.
 *
 * Deliberately biased toward deferring. A false "needs review" costs a reviewer a few minutes; a false
 * "safe to merge" is how a migration or a permission change lands unread.
 *
 * Usage:
 *   node agent/skills/sap/triage.mjs <base-ref> <head-ref> [--json out.json] [--limit 200]
 */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

import { createResolver } from "../sweep/graph/route-resolve.mjs";

const argv = process.argv.slice(2);
const positional = argv.filter((a) => !a.startsWith("--"));
const flag = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? d : argv[i + 1];
};
const [BASE, HEAD] = positional;
if (!BASE || !HEAD) {
  console.error("usage: node agent/skills/sap/triage.mjs <base-ref> <head-ref> [--json f] [--limit 200]");
  process.exit(2);
}
const LINE_LIMIT = Number(flag("limit", 200));
const BLAST_LIMIT = Number(flag("blast", 25));
const JSON_OUT = flag("json", null);

const git = (...a) => execFileSync("git", a, { encoding: "utf8", maxBuffer: 1 << 28 });

/**
 * Paths where a small diff is still not a small change.
 *
 * Drawn from where this repository's real incidents came from: schema migrations run against every
 * customer, permission and auth code is the highest-value bug class here, the connection pool is only
 * ten deep, audit event names ship to customer SIEMs, and crypto/PKI failures are silent.
 */
const CRITICAL_PATHS = [
  [/^backend\/src\/db\/migrations\//, "database migration — runs against every customer, cloud and self-hosted"],
  [/permission|casl/i, "permission logic — the highest-value bug class in this repository"],
  [/^backend\/src\/server\/plugins\/auth\//, "authentication plugin"],
  [/(^|\/)(auth|identity|saml|oidc|ldap|scim)[-/]/i, "authentication or identity"],
  [/crypto|kms|hsm|pkcs11|certificate|(^|\/)pki/i, "cryptography, KMS or PKI"],
  [/queue-service\.ts$|cron-job\.ts$|-queue\.ts$/, "queue or scheduled job"],
  [/audit-log-types\.ts$/, "audit event contract — the type string ships to customer SIEMs"],
  [/secret-v2-bridge|secret-encryption|encrypt/i, "secret encryption path"],
  [/^backend\/src\/lib\/config\/env\.ts$/, "runtime configuration"],
  [/^\.github\/workflows\//, "CI workflow"],
  [/Dockerfile|docker-compose/, "deployment image or stack"],
  [/(^|\/)package\.json$/, "dependency manifest"]
];

/** Patterns inside the added lines that are worth a second pair of eyes regardless of size. */
const DANGER_PATTERNS = [
  [/\.transaction\(/, "opens a database transaction"],
  [/getProjectPermission|getOrgPermission|ForbiddenError|verifyAuth/, "touches an authorization check"],
  [/process\.env\./, "reads runtime configuration"],
  [/\bDROP\b|\bALTER TABLE\b|deleteById|\.del\(\)|\.delete\(/i, "deletes or alters data"],
  [/eval\(|dangerouslySetInnerHTML|innerHTML\s*=/, "executes or injects markup"],
  [/fetch\(|axios\.|request\.(get|post|put|patch|delete)\(/, "makes an outbound request"]
];

const numstat = git("diff", "--numstat", `${BASE}...${HEAD}`)
  .split("\n")
  .filter(Boolean)
  .map((l) => l.split("\t"))
  .filter((p) => p.length === 3);

// Binary files report "-"; count them as touched but contribute no lines.
let added = 0;
let removed = 0;
const files = [];
for (const [a, r, path] of numstat) {
  if (path.includes("node_modules")) continue;
  const ai = Number(a) || 0;
  const ri = Number(r) || 0;
  added += ai;
  removed += ri;
  files.push({ path, added: ai, removed: ri, binary: a === "-" });
}
const churn = added + removed;

const diff = git("diff", `${BASE}...${HEAD}`);
const addedLines = diff.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++"));

const reasons = [];

if (churn > LINE_LIMIT) {
  reasons.push({
    gate: "size",
    detail: `${churn} changed lines across ${files.length} file(s), over the ${LINE_LIMIT}-line ceiling`
  });
}

const criticalHits = [];
for (const f of files) {
  for (const [re, why] of CRITICAL_PATHS) {
    if (re.test(f.path)) {
      criticalHits.push({ path: f.path, why });
      break;
    }
  }
}
for (const h of criticalHits) {
  reasons.push({ gate: "critical-path", detail: `${h.path} — ${h.why}` });
}

const dangerHits = [];
for (const [re, why] of DANGER_PATTERNS) {
  const hit = addedLines.find((l) => re.test(l));
  if (hit) dangerHits.push({ why, sample: hit.slice(1).trim().slice(0, 120) });
}
for (const d of dangerHits) {
  reasons.push({ gate: "danger-pattern", detail: `${d.why}: \`${d.sample}\`` });
}

/**
 * Blast radius: how much of the codebase imports what this touches.
 *
 * "Correct but widely referenced" is its own reason to slow down — a one-line change to a module 200
 * files import is not a one-line change in effect. Only resolved for source files, and only when the
 * change is otherwise small, since a deferral is already decided by then.
 */
const blast = [];
if (churn <= LINE_LIMIT) {
  const R = createResolver(HEAD);
  for (const f of files) {
    if (!/\.(ts|tsx|mts)$/.test(f.path) || !R.files.has(f.path)) continue;
    const n = R.importersOf(f.path, { includeReexports: true }).length;
    if (n >= BLAST_LIMIT) blast.push({ path: f.path, importers: n });
  }
  for (const b of blast) {
    reasons.push({ gate: "blast-radius", detail: `${b.path} is imported by ${b.importers} files` });
  }
}

const uiOnly =
  files.length > 0 &&
  files.every((f) => /^frontend\/src\//.test(f.path)) &&
  !files.some((f) => /hooks\/api\//.test(f.path));

const verdict = reasons.length === 0 ? "review-diff" : "needs-review";

const out = {
  base: BASE.slice(0, 10),
  head: HEAD.slice(0, 10),
  churn,
  added,
  removed,
  fileCount: files.length,
  files: files.map((f) => f.path),
  uiOnly,
  lineLimit: LINE_LIMIT,
  verdict,
  reasons,
  criticalHits,
  dangerHits,
  blast
};

if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(out, null, 2));

const tag = verdict === "needs-review" ? "NEEDS REVIEW" : "small and non-critical";
console.log(`${tag} — ${churn} lines, ${files.length} file(s)${uiOnly ? ", frontend only" : ""}`);
for (const r of reasons) console.log(`  [${r.gate}] ${r.detail}`);
if (verdict === "review-diff") console.log("  no gate tripped — read the diff and decide");
