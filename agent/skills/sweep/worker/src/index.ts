/**
 * SWEEP browser agent.
 *
 * Runs a scripted live test against a PR build through Cloudflare Browser Run, captures a frame per
 * step plus an rrweb session recording, writes everything to R2, and serves a scrubbable replay.
 *
 * Constraints that shaped this file, all verified against Cloudflare's docs rather than assumed:
 *   - Playwright's `recordVideo` is NOT supported on Browser Run. Session recording via
 *     `{ recording: true }` is the supported path, and it yields rrweb JSON, not a video.
 *   - The recording is only retrievable AFTER the browser session closes.
 *   - Input field content is masked in recordings by default.
 *   - The browser lives in Cloudflare's network, so `baseUrl` must be publicly reachable (ngrok).
 */

import { launch } from "@cloudflare/playwright";

export interface Env {
  BROWSER: Fetcher;
  ARTIFACTS: R2Bucket;
  SWEEP_TOKEN: string;
  ARTIFACTS_BASE_URL: string;
}

/** One step of a test plan. `expect` is what makes the step an assertion rather than a click. */
type Step = {
  name: string;
  action:
    | { type: "goto"; path: string }
    | { type: "click"; selector: string }
    | { type: "fill"; selector: string; value: string }
    | { type: "clear"; selector: string }
    | { type: "select"; selector: string; value: string }
    | { type: "waitFor"; selector: string };
  expect?:
    | { type: "visible"; selector: string }
    | { type: "hidden"; selector: string }
    | { type: "text"; selector: string; contains: string }
    | { type: "value"; selector: string; equals: string };
};

type TestPlan = {
  runId: string;
  baseUrl: string;
  /** Storage state (cookies/localStorage) so the plan does not script a login. */
  storageState?: object;
  /** Selectors blurred in every frame before it is written. Redaction backstop. */
  redactSelectors?: string[];
  steps: Step[];
};

type StepResult = {
  index: number;
  name: string;
  status: "passed" | "failed" | "skipped";
  durationMs: number;
  frameKey?: string;
  error?: string;
  console?: string[];
  failedRequests?: string[];
};

const DEFAULT_REDACT = [
  '[data-testid="org-switcher"]',
  '[data-testid="user-menu"]',
  "img[alt*='avatar' i]",
  "[aria-label*='account' i]"
];

const STEP_TIMEOUT_MS = 15_000;
const MAX_STEPS = 12;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Replay viewer and artifact serving are public reads: a GitHub comment has to be able to load
    // them without a token. Only the run endpoint is authenticated.
    if (request.method === "GET" && url.pathname.startsWith("/sweep/")) {
      return serveArtifact(url, env);
    }

    if (request.method !== "POST" || url.pathname !== "/run") {
      return json({ error: "POST /run, or GET /sweep/<runId>/<artifact>" }, 404);
    }

    if (request.headers.get("authorization") !== `Bearer ${env.SWEEP_TOKEN}`) {
      return json({ error: "unauthorized" }, 401);
    }

    let plan: TestPlan;
    try {
      plan = (await request.json()) as TestPlan;
    } catch {
      return json({ error: "invalid JSON body" }, 400);
    }

    const invalid = validatePlan(plan);
    if (invalid) return json({ error: invalid }, 400);

    return runPlan(plan, env);
  }
};

function validatePlan(plan: TestPlan): string | null {
  if (!plan?.runId || !/^[a-zA-Z0-9._-]{1,64}$/.test(plan.runId)) return "runId must be 1-64 chars of [a-zA-Z0-9._-]";
  if (!plan?.baseUrl) return "baseUrl is required";
  let base: URL;
  try {
    base = new URL(plan.baseUrl);
  } catch {
    return "baseUrl is not a valid URL";
  }
  // The browser is remote, so a loopback or private target can never work. Fail loudly rather than
  // letting every step time out and reading as a broken PR.
  if (/^(localhost|127\.|0\.0\.0\.0|\[?::1)/i.test(base.hostname) || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(base.hostname)) {
    return `baseUrl ${base.hostname} is not reachable from Cloudflare. Expose the stack with a tunnel (ngrok) and pass the public URL.`;
  }
  if (!Array.isArray(plan.steps) || plan.steps.length === 0) return "steps must be a non-empty array";
  if (plan.steps.length > MAX_STEPS) return `steps capped at ${MAX_STEPS}; split the plan`;
  return null;
}

async function runPlan(plan: TestPlan, env: Env): Promise<Response> {
  const prefix = `sweep/${plan.runId}`;
  const redact = plan.redactSelectors?.length ? plan.redactSelectors : DEFAULT_REDACT;
  const results: StepResult[] = [];

  // `recording: true` is the only supported capture path on Browser Run; recordVideo is not.
  const browser = await launch(env.BROWSER, { recording: true });
  const sessionId = browser.sessionId();

  let firstFailure: number | null = null;

  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      // Deterministic locale and timezone so frames are reproducible and carry no local identity.
      locale: "en-US",
      timezoneId: "UTC",
      storageState: plan.storageState as never
    });
    const page = await context.newPage();

    const consoleLines: string[] = [];
    const failedRequests: string[] = [];
    page.on("console", (m) => consoleLines.push(`[${m.type()}] ${m.text()}`.slice(0, 500)));
    page.on("requestfailed", (r) => failedRequests.push(`${r.method()} ${redactUrl(r.url())} ${r.failure()?.errorText ?? ""}`));
    page.on("response", (r) => {
      if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.request().method()} ${redactUrl(r.url())}`);
    });

    for (let i = 0; i < plan.steps.length; i += 1) {
      const step = plan.steps[i];
      const started = Date.now();
      const consoleBefore = consoleLines.length;
      const requestsBefore = failedRequests.length;

      // Once something has failed, later steps are not meaningful: the app is in an unknown state.
      if (firstFailure !== null) {
        results.push({ index: i, name: step.name, status: "skipped", durationMs: 0 });
        continue;
      }

      try {
        await applyAction(page, step, plan.baseUrl);
        await assertExpectation(page, step);
        await blur(page, redact);
        const frameKey = `${prefix}/step-${pad(i + 1)}-${slug(step.name)}.png`;
        await env.ARTIFACTS.put(frameKey, await page.screenshot({ type: "png" }), {
          httpMetadata: { contentType: "image/png", cacheControl: "public, max-age=31536000, immutable" }
        });
        results.push({ index: i, name: step.name, status: "passed", durationMs: Date.now() - started, frameKey });
      } catch (error) {
        firstFailure = i;
        // Capture the failure frame immediately, before any navigation changes what went wrong.
        let frameKey: string | undefined;
        try {
          await blur(page, redact);
          frameKey = `${prefix}/step-${pad(i + 1)}-${slug(step.name)}-FAILED.png`;
          await env.ARTIFACTS.put(frameKey, await page.screenshot({ type: "png", fullPage: true }), {
            httpMetadata: { contentType: "image/png", cacheControl: "public, max-age=31536000, immutable" }
          });
        } catch {
          // A screenshot failure must not mask the real error.
        }
        results.push({
          index: i,
          name: step.name,
          status: "failed",
          durationMs: Date.now() - started,
          frameKey,
          error: String(error instanceof Error ? error.message : error).slice(0, 1000),
          console: consoleLines.slice(consoleBefore, consoleBefore + 20),
          failedRequests: failedRequests.slice(requestsBefore, requestsBefore + 10)
        });
      }
    }
  } finally {
    // The recording only becomes retrievable after the session closes, so this ordering matters.
    await browser.close().catch(() => undefined);
  }

  const recording = await fetchRecording(sessionId, env);
  if (recording) {
    await env.ARTIFACTS.put(`${prefix}/recording.json`, JSON.stringify(recording), {
      httpMetadata: { contentType: "application/json", cacheControl: "public, max-age=86400" }
    });
  }

  const summary = {
    runId: plan.runId,
    sessionId,
    baseUrl: redactUrl(plan.baseUrl),
    passed: results.filter((r) => r.status === "passed").length,
    failed: results.filter((r) => r.status === "failed").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    replayUrl: recording ? `${env.ARTIFACTS_BASE_URL}/${prefix}/replay` : null,
    steps: results.map((r) => ({
      ...r,
      frameUrl: r.frameKey ? `${env.ARTIFACTS_BASE_URL}/${r.frameKey}` : null
    }))
  };

  await env.ARTIFACTS.put(`${prefix}/result.json`, JSON.stringify(summary, null, 2), {
    httpMetadata: { contentType: "application/json" }
  });

  return json(summary, summary.failed > 0 ? 200 : 200);
}

async function applyAction(page: any, step: Step, baseUrl: string): Promise<void> {
  const a = step.action;
  switch (a.type) {
    case "goto":
      await page.goto(new URL(a.path, baseUrl).toString(), { waitUntil: "domcontentloaded", timeout: STEP_TIMEOUT_MS });
      break;
    case "click":
      await page.click(a.selector, { timeout: STEP_TIMEOUT_MS });
      break;
    case "fill":
      await page.fill(a.selector, a.value, { timeout: STEP_TIMEOUT_MS });
      break;
    case "clear":
      await page.fill(a.selector, "", { timeout: STEP_TIMEOUT_MS });
      break;
    case "select":
      await page.selectOption(a.selector, a.value, { timeout: STEP_TIMEOUT_MS });
      break;
    case "waitFor":
      await page.waitForSelector(a.selector, { timeout: STEP_TIMEOUT_MS });
      break;
  }
}

async function assertExpectation(page: any, step: Step): Promise<void> {
  const e = step.expect;
  if (!e) return;
  switch (e.type) {
    case "visible":
      await page.waitForSelector(e.selector, { state: "visible", timeout: STEP_TIMEOUT_MS });
      break;
    case "hidden":
      await page.waitForSelector(e.selector, { state: "hidden", timeout: STEP_TIMEOUT_MS });
      break;
    case "text": {
      await page.waitForSelector(e.selector, { timeout: STEP_TIMEOUT_MS });
      const text = (await page.textContent(e.selector)) ?? "";
      if (!text.includes(e.contains)) {
        throw new Error(`expected "${e.selector}" to contain "${e.contains}", got "${text.trim().slice(0, 200)}"`);
      }
      break;
    }
    case "value": {
      await page.waitForSelector(e.selector, { timeout: STEP_TIMEOUT_MS });
      const value = await page.inputValue(e.selector);
      if (value !== e.equals) {
        throw new Error(`expected "${e.selector}" value to equal "${e.equals}", got "${String(value).slice(0, 200)}"`);
      }
      break;
    }
  }
}

/** Redaction backstop. Blurs identity-bearing chrome before every frame is written. */
async function blur(page: any, selectors: string[]): Promise<void> {
  await page
    .addStyleTag({
      content: selectors.map((s) => `${s}{filter:blur(8px)!important}`).join("\n")
    })
    .catch(() => undefined);
}

/** Strip query and userinfo: a URL is often itself a credential, and these land in a public comment. */
function redactUrl(raw: string): string {
  try {
    const u = new URL(raw);
    return `${u.origin}${u.pathname}${u.search ? "?[redacted]" : ""}`;
  } catch {
    return "[unparseable url]";
  }
}

async function fetchRecording(sessionId: string, env: Env): Promise<unknown | null> {
  try {
    const res = await env.BROWSER.fetch(`https://browser/v1/recording/${sessionId}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Serves frames, result.json, the raw recording, and the replay viewer. */
async function serveArtifact(url: URL, env: Env): Promise<Response> {
  const key = url.pathname.replace(/^\//, "");

  if (key.endsWith("/replay")) {
    const runPrefix = key.slice(0, -"/replay".length);
    return new Response(replayHtml(`${env.ARTIFACTS_BASE_URL}/${runPrefix}/recording.json`), {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" }
    });
  }

  const object = await env.ARTIFACTS.get(key);
  if (!object) return json({ error: "not found" }, 404);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  return new Response(object.body, { headers });
}

/**
 * rrweb replay viewer. Cloudflare gives structured events per target rather than a video, so this
 * page reconstructs a scrubbable session from the largest target's event array.
 */
function replayHtml(recordingUrl: string): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SWEEP replay</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/rrweb-player@1.0.0-alpha.4/dist/style.css">
<style>
  body{margin:0;background:#0b0d0f;color:#e6e6e6;font:14px/1.5 system-ui,sans-serif}
  header{padding:12px 16px;border-bottom:1px solid #23282d;display:flex;gap:12px;align-items:center}
  .tag{background:#1c2126;border:1px solid #2b3238;border-radius:999px;padding:2px 10px;font-size:12px}
  #player{padding:16px}
  #err{padding:16px;color:#ff8080}
</style>
</head><body>
<header><strong>SWEEP</strong><span class="tag">session replay</span>
<span class="tag">input values masked</span></header>
<div id="player"></div><div id="err"></div>
<script src="https://cdn.jsdelivr.net/npm/rrweb-player@1.0.0-alpha.4/dist/index.js"></script>
<script>
(async () => {
  try {
    const res = await fetch(${JSON.stringify(recordingUrl)});
    if (!res.ok) throw new Error("recording not available (HTTP " + res.status + ")");
    const data = await res.json();
    // Pick the target with the most events: the tab the test actually drove.
    const events = Object.values(data.events || {}).sort((a, b) => b.length - a.length)[0] || [];
    if (events.length < 2) throw new Error("recording too short to replay");
    new rrwebPlayer({ target: document.getElementById("player"), props: { events, autoPlay: false, width: 1280, height: 720 } });
  } catch (e) {
    document.getElementById("err").textContent = "Could not load replay: " + e.message;
  }
})();
</script>
</body></html>`;
}

const pad = (n: number) => String(n).padStart(2, "0");
const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "step";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), { status, headers: { "content-type": "application/json" } });
