#!/usr/bin/env node
/**
 * SAP approval, with the checks that make it safe to automate.
 *
 * Approving is the one thing SAP does that a human cannot easily undo by reading past it: a green check
 * changes what other people do next. So the decision does not rest on the model remembering the rules. It
 * re-reads the gate's own JSON and refuses unless every condition holds.
 *
 * It only ever approves. It never requests changes and never merges. A blocking review is heavier than
 * SAP's evidence justifies, and SAP's answer to "this looks wrong" is to hand the PR to SWEEP.
 *
 * Usage:
 *   node agent/skills/sap/approve.mjs <pr-number> --repo owner/name --triage triage.json \
 *     --sha <triaged-head-sha> --body-file body.md [--dry-run]
 */

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

const argv = process.argv.slice(2);
const positional = argv.filter((a) => !a.startsWith("--") && !isFlagValue(a));
function isFlagValue(a) {
  const i = argv.indexOf(a);
  return i > 0 && argv[i - 1].startsWith("--");
}
const flag = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? d : argv[i + 1];
};
const PR = positional[0];
const REPO = flag("repo", null);
const TRIAGE = flag("triage", null);
const SHA = flag("sha", null);
const BODY_FILE = flag("body-file", null);
const VERDICT = flag("verdict", null);
const DRY = argv.includes("--dry-run");

if (!PR || !REPO || !TRIAGE || !SHA || !BODY_FILE) {
  console.error(
    "usage: node agent/skills/sap/approve.mjs <pr> --repo owner/name --triage f.json --sha <sha> --body-file f.md --verdict safe [--dry-run]"
  );
  process.exit(2);
}

const gh = (...args) => execFileSync("gh", args, { encoding: "utf8", maxBuffer: 1 << 26 }).trim();

const refusals = [];
const refuse = (why) => refusals.push(why);

if (!existsSync(TRIAGE)) refuse(`no triage file at ${TRIAGE}. Run triage.mjs --json first.`);
if (!existsSync(BODY_FILE)) refuse(`no body file at ${BODY_FILE}.`);

// 0. The gate cannot see a bad one-line change. Every probe PR on this fork is tiny, frontend-only and
//    passes every mechanical check, yet one of them swaps a working banner for a red div reading "WTH!!".
//    So the diff read is the only thing between junk and a green check, and it has to be stated out loud:
//    approving means passing --verdict safe, and the posted text has to agree with the action taken.
if (VERDICT !== "safe") {
  refuse(`--verdict was ${VERDICT === null ? "not given" : `"${VERDICT}"`}. Only an explicit "safe" approves.`);
}
if (existsSync(BODY_FILE) && !/safe to merge/i.test(readFileSync(BODY_FILE, "utf8"))) {
  refuse('the body does not say "Safe to merge", so the comment and the approval would disagree.');
}

// 1. The gate, not the model, decides whether this was ever approvable. Re-reading its output here means a
//    "safe to merge" conclusion cannot outvote a tripped gate.
let triage = null;
if (existsSync(TRIAGE)) {
  triage = JSON.parse(readFileSync(TRIAGE, "utf8"));
  if (triage.verdict !== "review-diff") {
    refuse(`the gate said "${triage.verdict}", not "review-diff". Reasons: ${triage.reasons.map((r) => r.gate).join(", ")}`);
  }
  if (triage.head && !SHA.startsWith(triage.head) && !triage.head.startsWith(SHA)) {
    refuse(`--sha ${SHA} is not the head the gate ran on (${triage.head}).`);
  }
}

const pr = JSON.parse(
  gh("pr", "view", PR, "--repo", REPO, "--json", "author,isDraft,state,headRefOid,mergeable,reviews,url,title")
);
const viewer = JSON.parse(gh("api", "user", "--jq", "{login: .login}")).login;

if (pr.state !== "OPEN") refuse(`the pull request is ${pr.state.toLowerCase()}.`);
if (pr.isDraft) refuse("it is a draft.");
if (pr.mergeable === "CONFLICTING") refuse("it has merge conflicts, so what would land is not what was read.");

// 2. Approving a SHA that has since moved is how an unread commit inherits a green check. GitHub only
//    dismisses stale approvals when the repository is configured to, so check rather than assume.
if (pr.headRefOid !== SHA && !pr.headRefOid.startsWith(SHA)) {
  refuse(`head is now ${pr.headRefOid.slice(0, 9)} but ${SHA.slice(0, 9)} was triaged. Re-run on the new head.`);
}

// 3. Never approve over a human who asked for changes.
const blocking = (pr.reviews || []).filter((r) => r.state === "CHANGES_REQUESTED" && r.author?.login !== viewer);
if (blocking.length) {
  refuse(`${blocking.map((r) => r.author.login).join(", ")} already requested changes.`);
}

// 4. GitHub rejects self-approval outright. Detect it here so the run reports a clear reason instead of an
//    API error, and so nobody reads a failed approval as a granted one.
const selfAuthored = pr.author?.login === viewer;
if (selfAuthored) {
  refuse(`GitHub does not allow approving your own pull request. ${viewer} opened it and is running SAP.`);
}

const body = readFileSync(BODY_FILE, "utf8");

if (refusals.length) {
  console.log(`NOT APPROVED: ${pr.title}`);
  for (const r of refusals) console.log(`  - ${r}`);
  console.log("\nPost the triage as a plain comment instead, and say the approval was not given.");
  process.exit(1);
}

if (DRY) {
  console.log(`WOULD APPROVE #${PR} (${pr.headRefOid.slice(0, 9)}) as ${viewer}. Every check passed.`);
  process.exit(0);
}

try {
  gh("pr", "review", PR, "--repo", REPO, "--approve", "--body", body);
} catch (err) {
  const msg = String(err.stderr || err.stdout || err.message || "").trim();
  console.log(`NOT APPROVED: ${pr.title}`);
  console.log(`  - GitHub rejected the approval: ${msg.split("\n")[0]}`);
  // The usual cause in CI: the repository or organisation has "Allow GitHub Actions to create and approve
  // pull requests" turned off, so a GITHUB_TOKEN run can comment but not approve. Reading the setting needs
  // a scope SAP does not have, so say what to check rather than guess at it.
  if (/not permitted|GitHub Actions is not permitted|resource not accessible/i.test(msg)) {
    console.log("    Check Settings > Actions > General > Allow GitHub Actions to create and approve pull");
    console.log("    requests, or run SAP with a token that is not GITHUB_TOKEN.");
  }
  console.log("\nPost the triage as a plain comment instead, and say the approval was not given.");
  process.exit(1);
}
console.log(`APPROVED #${PR} (${pr.headRefOid.slice(0, 9)}) as ${viewer}: ${pr.url}`);
