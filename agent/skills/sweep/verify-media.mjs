#!/usr/bin/env node
// Gate: refuse to post a review body whose media does not actually render on GitHub.
//
// Two distinct failures this catches, both observed in real runs:
//   1. A URL that 404s because the commit holding it was never pushed. The comment
//      then renders broken-image alt text where the evidence should be.
//   2. A .webm (or .mp4) written as an image embed. GitHub renders no player for a
//      URL it did not serve from its own attachment CDN, so the embed is dead markup
//      however many times the file loads fine in a browser.
//
// Usage: node agent/skills/sweep/verify-media.mjs <body.md> [more.md ...]
// Exit 0 = safe to post. Exit 1 = do not post; fix or drop the embeds.

import { readFileSync } from "node:fs";

const PLAYABLE_AS_IMAGE = new Set(["png", "jpg", "jpeg", "webp"]);
const NEVER_EMBEDS = new Set(["webm", "mp4", "mov", "avi"]);
// GIFs are banned outright, not merely un-embeddable: multi-megabyte for a few seconds,
// palette-quantised so text degrades, and no seek or pause. Behaviour ships as .mp4.
const BANNED = new Set(["gif"]);

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: node agent/skills/sweep/verify-media.mjs <body.md> [...]");
  process.exit(2);
}

// Capture whether each URL was written as an embed (leading `!`) or a plain link,
// because a .webm is legitimate as a link and never legitimate as an embed.
const refs = new Map();
for (const file of files) {
  const body = readFileSync(file, "utf8");
  const re = /(!?)\[[^\]]*\]\((https?:\/\/[^\s)]+)\)|(?<!\()(https?:\/\/\S+\.(?:png|gif|jpe?g|webp|webm|mp4|mov|avi))/gi;
  let m;
  while ((m = re.exec(body)) !== null) {
    const url = m[2] ?? m[3];
    if (!url) continue;
    const ext = (url.split(".").pop() ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!PLAYABLE_AS_IMAGE.has(ext) && !NEVER_EMBEDS.has(ext) && !BANNED.has(ext)) continue;
    const isEmbed = m[1] === "!";
    const prev = refs.get(url);
    refs.set(url, { ext, isEmbed: (prev?.isEmbed ?? false) || isEmbed, file });
  }
}

if (refs.size === 0) {
  console.log("no media referenced: nothing to verify");
  process.exit(0);
}

const problems = [];
console.log(`checking ${refs.size} media URL(s)\n`);

for (const [url, { ext, isEmbed, file }] of refs) {
  let code = 0;
  let ctype = "";
  let bytes = 0;
  try {
    // GET, not HEAD: raw.githubusercontent and camo can answer HEAD differently.
    const res = await fetch(url, { redirect: "follow" });
    code = res.status;
    ctype = res.headers.get("content-type") ?? "";
    if (res.ok) bytes = (await res.arrayBuffer()).byteLength;
  } catch (err) {
    problems.push(`${url}\n    unreachable: ${err.message}`);
    console.log(`  FAIL  unreachable  ${url}`);
    continue;
  }

  const kb = bytes ? `${(bytes / 1024).toFixed(0)}KB` : "-";
  const verdict = [];

  if (BANNED.has(ext)) {
    verdict.push(`.${ext} is banned: encode behaviour as .mp4 and link it; use .png for appearance defects`);
  }

  if (code !== 200) {
    verdict.push(`HTTP ${code}: not published (a local commit is not a pushed one)`);
  } else {
    if (isEmbed && NEVER_EMBEDS.has(ext)) {
      verdict.push(`.${ext} written as an embed: GitHub turns it into <img>, so it renders as broken alt text; make it a plain link and embed a still frame instead`);
    }
    if (isEmbed && !ctype.startsWith("image/")) {
      verdict.push(`content-type "${ctype}" is not an image, so it will not render inline`);
    }
    // GitHub rejects images over 10MB.
    if (isEmbed && bytes > 10 * 1024 * 1024) {
      verdict.push(`${kb} exceeds GitHub's 10MB image limit`);
    }
  }

  const tag = verdict.length ? "FAIL" : "ok  ";
  console.log(`  ${tag}  ${String(code).padEnd(3)} ${ext.padEnd(4)} ${kb.padStart(6)}  ${isEmbed ? "embed" : "link "}  ${url}`);
  for (const v of verdict) console.log(`        ${v}`);
  if (verdict.length) problems.push(`${url}\n    ${verdict.join("\n    ")}`);
}

if (problems.length) {
  console.log(`\nDO NOT POST: ${problems.length} of ${refs.size} media reference(s) would not render.`);
  console.log("Publish the bytes to a remote ref, or drop the embed and describe the evidence in prose.");
  process.exit(1);
}
console.log(`\nall ${refs.size} media reference(s) verified: safe to post`);
