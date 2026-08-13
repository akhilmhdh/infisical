#!/usr/bin/env node
/**
 * SWEEP local runner: the fallback path when Cloudflare is not configured.
 *
 * Takes the same test plan as the Worker and produces the same evidence shape, with two differences
 * that are improvements when they are available:
 *   - a real .webm video via Playwright's recordVideo, which the Worker cannot do
 *   - no tunnel needed, because the browser is on the same machine as the stack
 *
 * The tradeoff is that artifacts are local files, so links cannot be embedded in a GitHub comment.
 * Attach them by hand, or use the Worker path for postable URLs.
 *
 * Usage:
 *   node agent/skills/sweep/local/run.mjs plan.json [--out /tmp/sweep-<runId>] [--headed]
 *
 * Requires Playwright:  npx playwright install chromium
 */

import { chromium } from "playwright";
import { readFile, mkdir, writeFile, readdir, rename } from "node:fs/promises";
import { join, resolve } from "node:path";

const STEP_TIMEOUT_MS = 15_000;
const MAX_STEPS = 12;
const DEFAULT_REDACT = [
  '[data-testid="org-switcher"]',
  '[data-testid="user-menu"]',
  "img[alt*='avatar' i]",
  "[aria-label*='account' i]"
];

const args = process.argv.slice(2);
const planPath = args.find((a) => !a.startsWith("--"));
if (!planPath) {
  console.error("usage: node agent/skills/sweep/local/run.mjs plan.json [--out DIR] [--headed]");
  process.exit(2);
}
const outFlag = args.indexOf("--out");
const headed = args.includes("--headed");

const plan = JSON.parse(await readFile(planPath, "utf8"));
if (!plan.runId || !plan.baseUrl || !Array.isArray(plan.steps) || plan.steps.length === 0) {
  console.error("plan needs runId, baseUrl and a non-empty steps array");
  process.exit(2);
}
if (plan.steps.length > MAX_STEPS) {
  console.error(`steps capped at ${MAX_STEPS}; split the plan`);
  process.exit(2);
}

const outDir = resolve(outFlag !== -1 ? args[outFlag + 1] : `/tmp/sweep-${plan.runId}`);
const videoDir = join(outDir, "video");
await mkdir(outDir, { recursive: true });
await mkdir(videoDir, { recursive: true });

const redact = plan.redactSelectors?.length ? plan.redactSelectors : DEFAULT_REDACT;
const results = [];
let firstFailure = null;

const browser = await chromium.launch({ headless: !headed });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  locale: "en-US",
  timezoneId: "UTC",
  storageState: plan.storageState ?? undefined,
  // The Worker cannot do this. Locally it is free, so take it.
  recordVideo: { dir: videoDir, size: { width: 1440, height: 900 } }
});
const page = await context.newPage();

/**
 * Draw the pointer into the page.
 *
 * Playwright's recordVideo never shows the cursor: Chromium's screencast captures the page surface, and
 * the pointer is drawn by the OS compositor above it. A recording of someone clicking things therefore
 * shows fields changing and dialogs opening with nothing indicating what was pressed, which is close to
 * useless as review evidence. So the cursor becomes part of the DOM — a fixed, pointer-events:none
 * overlay that tracks real mouse events and pulses on click. It composites into the video because it is
 * genuinely on the page.
 *
 * addInitScript, not evaluate: it has to survive every navigation in the plan.
 */
const CURSOR_ENABLED = plan.cursor !== false;
if (CURSOR_ENABLED) {
  await page.addInitScript(() => {
    const draw = () => {
      if (document.getElementById("__sweep_cursor")) return;
      const style = document.createElement("style");
      style.textContent = `
        #__sweep_cursor{position:fixed;top:0;left:0;width:22px;height:22px;margin:-11px 0 0 -11px;
          z-index:2147483647;pointer-events:none;opacity:0;transition:opacity .15s linear;
          will-change:transform}
        #__sweep_cursor .r{position:absolute;inset:0;border:2px solid rgba(255,255,255,.95);
          border-radius:50%;box-shadow:0 0 0 1.5px rgba(0,0,0,.55),0 1px 4px rgba(0,0,0,.5)}
        #__sweep_cursor .d{position:absolute;top:50%;left:50%;width:5px;height:5px;margin:-2.5px 0 0 -2.5px;
          background:#fff;border-radius:50%;box-shadow:0 0 0 1.5px rgba(0,0,0,.55)}
        #__sweep_cursor.click .r{animation:__sweep_pulse .4s ease-out}
        @keyframes __sweep_pulse{0%{transform:scale(1);opacity:1}
          100%{transform:scale(2.1);opacity:0}}`;
      document.head.appendChild(style);
      const el = document.createElement("div");
      el.id = "__sweep_cursor";
      el.innerHTML = '<div class="r"></div><div class="d"></div>';
      document.body.appendChild(el);

      const move = (e) => {
        el.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
        el.style.opacity = "1";
      };
      addEventListener("mousemove", move, true);
      addEventListener("mousedown", (e) => {
        move(e);
        el.classList.remove("click");
        void el.offsetWidth; // restart the animation
        el.classList.add("click");
      }, true);
    };
    if (document.body) draw();
    else addEventListener("DOMContentLoaded", draw, { once: true });
  });
}

/**
 * Move the pointer to an element and click it, instead of teleporting.
 *
 * `page.click()` jumps straight to the target in one event, so the overlay above appears at the
 * destination with no travel — a viewer cannot see where the click came from or that it was deliberate.
 * Stepping the move makes the intent legible in the recording, and costs a few hundred milliseconds.
 */
async function tracedClick(target, selector, timeout) {
  const locator = target.locator(selector).first();
  await locator.waitFor({ state: "visible", timeout });
  await locator.scrollIntoViewIfNeeded({ timeout }).catch(() => undefined);
  const box = await locator.boundingBox();
  if (!box) return locator.click({ timeout }); // off-screen or zero-size: fall back
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await target.mouse.move(x, y, { steps: 18 });
  await target.waitForTimeout(120);
  await target.mouse.down();
  await target.waitForTimeout(60);
  await target.mouse.up();
}

const consoleLines = [];
const failedRequests = [];
page.on("console", (m) => consoleLines.push(`[${m.type()}] ${m.text()}`.slice(0, 500)));
page.on("requestfailed", (r) => failedRequests.push(`${r.method()} ${redactUrl(r.url())} ${r.failure()?.errorText ?? ""}`));
page.on("response", (r) => {
  if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.request().method()} ${redactUrl(r.url())}`);
});

for (let i = 0; i < plan.steps.length; i += 1) {
  const step = plan.steps[i];
  const started = Date.now();
  const cBefore = consoleLines.length;
  const rBefore = failedRequests.length;

  if (firstFailure !== null) {
    results.push({ index: i, name: step.name, status: "skipped", durationMs: 0 });
    process.stdout.write(`  ⏭  ${step.name}\n`);
    continue;
  }

  try {
    await applyAction(page, step, plan.baseUrl);
    await assertExpectation(page, step);
    await blur(page, redact);
    const frame = `step-${pad(i + 1)}-${slug(step.name)}.png`;
    await page.screenshot({ path: join(outDir, frame), type: "png" });
    results.push({ index: i, name: step.name, status: "passed", durationMs: Date.now() - started, frame });
    process.stdout.write(`  ✅ ${step.name}\n`);
  } catch (error) {
    firstFailure = i;
    let frame;
    try {
      await blur(page, redact);
      frame = `step-${pad(i + 1)}-${slug(step.name)}-FAILED.png`;
      await page.screenshot({ path: join(outDir, frame), type: "png", fullPage: true });
    } catch {
      /* a screenshot failure must not mask the real error */
    }
    results.push({
      index: i,
      name: step.name,
      status: "failed",
      durationMs: Date.now() - started,
      frame,
      error: String(error?.message ?? error).slice(0, 1000),
      console: consoleLines.slice(cBefore, cBefore + 20),
      failedRequests: failedRequests.slice(rBefore, rBefore + 10)
    });
    process.stdout.write(`  ❌ ${step.name}\n     ${String(error?.message ?? error).split("\n")[0]}\n`);
  }
}

await context.close(); // flushes the video
await browser.close();

// Playwright names videos by an internal id; give it a predictable name.
let videoFile = null;
try {
  const files = (await readdir(videoDir)).filter((f) => f.endsWith(".webm"));
  if (files[0]) {
    videoFile = "session.webm";
    await rename(join(videoDir, files[0]), join(outDir, videoFile));
  }
} catch {
  /* video is a nicety, not a requirement */
}

const summary = {
  runId: plan.runId,
  path: "local",
  baseUrl: redactUrl(plan.baseUrl),
  passed: results.filter((r) => r.status === "passed").length,
  failed: results.filter((r) => r.status === "failed").length,
  skipped: results.filter((r) => r.status === "skipped").length,
  video: videoFile,
  outDir,
  steps: results
};
await writeFile(join(outDir, "result.json"), JSON.stringify(summary, null, 2));

process.stdout.write(
  `\n${summary.failed > 0 ? "❌" : "✅"} ${summary.passed} passed · ${summary.failed} failed · ${summary.skipped} skipped\n` +
    `artifacts: ${outDir}\n` +
    (videoFile ? `video: ${join(outDir, videoFile)}  (drag into the PR comment to attach)\n` : "")
);
process.exit(summary.failed > 0 ? 1 : 0);

async function applyAction(page, step, baseUrl) {
  const a = step.action;
  if (a.type === "goto") return page.goto(new URL(a.path, baseUrl).toString(), { waitUntil: "domcontentloaded", timeout: STEP_TIMEOUT_MS });
  if (a.type === "click") {
    if (!CURSOR_ENABLED) return page.click(a.selector, { timeout: STEP_TIMEOUT_MS });
    return tracedClick(page, a.selector, STEP_TIMEOUT_MS);
  }
  if (a.type === "fill") {
    // Move to the field first so the recording shows which input is being typed into. `fill` sets the
    // value without any pointer event, so without this the text appears from nowhere.
    if (CURSOR_ENABLED) await tracedClick(page, a.selector, STEP_TIMEOUT_MS).catch(() => undefined);
    return page.fill(a.selector, a.value, { timeout: STEP_TIMEOUT_MS });
  }
  if (a.type === "clear") return page.fill(a.selector, "", { timeout: STEP_TIMEOUT_MS });
  if (a.type === "select") return page.selectOption(a.selector, a.value, { timeout: STEP_TIMEOUT_MS });
  if (a.type === "waitFor") return page.waitForSelector(a.selector, { timeout: STEP_TIMEOUT_MS });
  throw new Error(`unknown action ${a.type}`);
}

async function assertExpectation(page, step) {
  const e = step.expect;
  if (!e) return;
  if (e.type === "visible") return page.waitForSelector(e.selector, { state: "visible", timeout: STEP_TIMEOUT_MS });
  if (e.type === "hidden") return page.waitForSelector(e.selector, { state: "hidden", timeout: STEP_TIMEOUT_MS });
  if (e.type === "text") {
    await page.waitForSelector(e.selector, { timeout: STEP_TIMEOUT_MS });
    const text = (await page.textContent(e.selector)) ?? "";
    if (!text.includes(e.contains)) throw new Error(`expected "${e.selector}" to contain "${e.contains}", got "${text.trim().slice(0, 200)}"`);
    return;
  }
  if (e.type === "value") {
    await page.waitForSelector(e.selector, { timeout: STEP_TIMEOUT_MS });
    const value = await page.inputValue(e.selector);
    if (value !== e.equals) throw new Error(`expected "${e.selector}" value to equal "${e.equals}", got "${String(value).slice(0, 200)}"`);
    return;
  }
  throw new Error(`unknown expectation ${e.type}`);
}

async function blur(page, selectors) {
  await page.addStyleTag({ content: selectors.map((s) => `${s}{filter:blur(8px)!important}`).join("\n") }).catch(() => undefined);
}

function redactUrl(raw) {
  try {
    const u = new URL(raw);
    return `${u.origin}${u.pathname}${u.search ? "?[redacted]" : ""}`;
  } catch {
    return "[unparseable url]";
  }
}

// Function declarations, not const arrows: the step loop is top-level code that runs before the
// bottom of this file is evaluated, so const bindings here would still be in their temporal dead zone.
function pad(n) {
  return String(n).padStart(2, "0");
}
function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "step";
}
