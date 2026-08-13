# SWEEP browser agent (Cloudflare Worker)

Runs a scripted live test against a PR build through Cloudflare Browser Run, captures a frame per step
plus an rrweb session recording, stores everything in R2, and serves a scrubbable replay whose URL can go
straight into a GitHub review comment.

**Not deployed.** No Cloudflare credentials were configured when this was written, so nothing here has run
against Cloudflare. Deploying is your call and is the only step that touches your account.

---

## What it can and cannot do

Verified against Cloudflare's docs, not assumed:

| | Status |
| --- | --- |
| `@cloudflare/playwright` on Workers | Supported, GA, synced to Playwright 1.55 |
| Playwright `recordVideo` | **Not supported** on Browser Run |
| Session recording via `{ recording: true }` | Supported. Produces **rrweb JSON events, not a video** |
| Retrieving the recording | Only **after** the session closes, via `browser.sessionId()` |
| Input field content in recordings | **Masked by default** |
| Recording retention | 30 days |
| Max session duration | 2 hours |
| Reaching `localhost` | **Impossible.** The browser is in Cloudflare's network |

So the artifact is a **seekable replay plus PNG frames**, not an `.mp4`. For review that is arguably
better: it is small, scrubbable, and the DOM is inspectable. If you specifically need a video file, use
`../local/run.mjs`, which records a real `.webm` because Playwright runs on your machine there.

GitHub renders `![](url.png)` inline but strips externally hosted `<video src>`, so frames are what get
embedded and the replay is a link.

---

## Setup

```bash
cd agent/skills/sweep/worker
npm install
npx wrangler login

# R2 bucket for artifacts
npx wrangler r2 bucket create sweep-artifacts

# Expire artifacts on the same 30-day clock as Cloudflare's recordings
npx wrangler r2 bucket lifecycle add sweep-artifacts --prefix sweep/ --expire-days 30

# Shared secret for POST /run
npx wrangler secret put SWEEP_TOKEN

# Point ARTIFACTS_BASE_URL in wrangler.toml at this Worker's own hostname, then:
npx wrangler deploy
```

Browser Run requires a paid Workers plan. Check current limits before relying on long sessions.

---

## Running a test

The browser is remote, so the target must be publicly reachable. This repository's standing preference is
**ngrok**, never SSH reverse tunnels.

```bash
# 1. PR build up
git fetch origin pull/<n>/head:sweep-pr-<n> && git switch sweep-pr-<n>
docker compose -f docker-compose.dev.yml up -d
until curl -sf http://localhost:8080 >/dev/null; do sleep 2; done

# 2. Expose it
ngrok http 8080 --log stdout > /tmp/sweep-ngrok.log &
PUBLIC_URL=$(curl -s http://127.0.0.1:4040/api/tunnels | jq -r '.tunnels[0].public_url')

# 3. Run the plan
curl -sX POST https://<worker-host>/run \
  -H "authorization: Bearer $SWEEP_TOKEN" \
  -H 'content-type: application/json' \
  --data "$(jq --arg u "$PUBLIC_URL" '.baseUrl = $u' /tmp/sweep-plan.json)" | jq
```

The Worker rejects a `baseUrl` that is loopback or RFC1918 with an explanatory error, rather than letting
every step time out and reading as a broken PR.

---

## Plan format

Same shape as `../local/run.mjs`, so a plan runs on either path unchanged.

```json
{
  "runId": "pr7542-r1",
  "baseUrl": "https://example.ngrok.app",
  "storageState": { "cookies": [], "origins": [] },
  "redactSelectors": ["[data-testid=\"org-switcher\"]", "[data-testid=\"user-menu\"]"],
  "steps": [
    { "name": "Open KMIP servers",
      "action": { "type": "goto", "path": "/organization/kmip" },
      "expect": { "type": "visible", "selector": "text=KMIP Servers" } },

    { "name": "Open cert config modal",
      "action": { "type": "click", "selector": "[data-testid=\"edit-cert-config\"]" },
      "expect": { "type": "visible", "selector": "text=Edit Certificate Configuration" } },

    { "name": "Clear the TTL",
      "action": { "type": "clear", "selector": "input[name=\"ttl\"]" } },

    { "name": "Save",
      "action": { "type": "click", "selector": "button[type=\"submit\"]" },
      "expect": { "type": "text", "selector": "[role=\"status\"]", "contains": "updated" } },

    { "name": "Reopen and check the TTL actually cleared",
      "action": { "type": "click", "selector": "[data-testid=\"edit-cert-config\"]" },
      "expect": { "type": "value", "selector": "input[name=\"ttl\"]", "equals": "" } }
  ]
}
```

Actions: `goto` · `click` · `fill` · `clear` · `select` · `waitFor`.
Expectations: `visible` · `hidden` · `text` (contains) · `value` (equals).

Notes that matter:

- **`storageState` avoids scripting a login.** Capture it once from a browser signed into the test org.
  It contains session cookies, so treat the file as a credential: keep it in `/tmp`, never commit it,
  never paste it into a comment.
- **A step without `expect` asserts nothing.** It clicks and moves on. The last step in the example is the
  pattern that catches the most bugs in this repo: reopen and verify the write actually landed.
- Steps are capped at 12, and once a step fails the rest are skipped, because the app is in an unknown
  state.

## Response

```json
{
  "runId": "pr7542-r1",
  "sessionId": "e26d4660-…",
  "passed": 4, "failed": 1, "skipped": 0,
  "replayUrl": "https://<worker-host>/sweep/pr7542-r1/replay",
  "steps": [
    { "index": 4, "name": "Reopen and check the TTL actually cleared", "status": "failed",
      "error": "expected \"input[name=\\\"ttl\\\"]\" value to equal \"\", got \"2d\"",
      "frameUrl": "https://<worker-host>/sweep/pr7542-r1/step-05-reopen-and-check-FAILED.png",
      "console": ["[error] …"], "failedRequests": ["400 PATCH https://…/api/v1/kmip/servers/…"] }
  ]
}
```

`frameUrl` goes inline in the finding, `replayUrl` goes next to it as a link. See
`../references/review-format.md` for the finding anatomy.

---

## Redaction

Artifacts are destined for a public comment on a public repository, so the Worker defends by default:

- Cloudflare masks input field content in recordings.
- Every frame is written **after** blurring `redactSelectors`, defaulting to the org switcher, the user
  menu, and the avatar.
- URLs in the console and failed-request logs are stripped of query strings, since a URL is often itself a
  credential.

**This is a backstop, not permission to skip the checks in `../references/live-testing.md`.** Use a
purpose-made test org, `John Smith` / `john.smith@example.com` / `example.com`, and never a real
credential. Look at every frame before it goes near GitHub.

---

## Cost and failure modes

- Browser Run bills per session; the router step in `SKILL.md` exists so a two-line diff never gets here.
- A missing recording is not fatal: the run still returns frames and `result.json`, and `replayUrl` is
  `null`.
- If Browser Run is unavailable, fall back to `../local/run.mjs`. The review does not change, only the
  artifact links do, and the summary must say which path ran.
