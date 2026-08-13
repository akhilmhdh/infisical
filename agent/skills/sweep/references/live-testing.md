# Live Testing Protocol

How SWEEP exercises a change in a real browser and turns a failure into evidence a reviewer can post.

This is the half of review that automated reviewers on this repository do not do at all. Over two years,
**15% of human review comments carried behavioural evidence** (a screenshot, a description of running it,
or an "IGNORE PLACEMENT" note) from 21 different people. The bots managed 0.53% and never once said
"ignore placement". That gap is the reason this file exists.

---

## The hard constraints, up front

**1. A Cloudflare browser cannot reach `localhost`.** The Worker runs in Cloudflare's network; the PR
build runs on your machine. A tunnel is mandatory. This repository's standing preference is **ngrok**,
never SSH reverse tunnels.

**2. Cloudflare session recording is not a video.** It produces
[rrweb](https://developers.cloudflare.com/browser-run/features/session-recording/) JSON events, and
Playwright's own `recordVideo` is unsupported on Cloudflare. So the artifact is a **scrubbable replay**
plus PNG frames, not an `.mp4`. In practice the replay is better than a video for review: it is
seekable, it is small, and the DOM is inspectable.

**3. GitHub does not embed externally hosted video.** `![](url.png)` renders inline; a `<video src>`
pointing off-site does not survive sanitisation. So a finding embeds **PNG frames inline** and links the
replay. If a true video file is genuinely needed, the local path below produces a real `.webm` you can
drag into the comment by hand.

### Match the artifact to the defect: video for behaviour, image for appearance

**A behavioural defect gets a video.** Anything that is about a sequence — a toast that fires twice, a
value that reverts on reopen, a button that stays enabled, a state that only breaks on the second
submit — is not provable in a still. The still shows one moment and invites the reply "how do you know
that is what happened".

**A visual defect gets a PNG.** Misalignment, wrong spacing, clipped text, a broken empty state, wrong
colour or contrast. A video of a static defect is worse than a screenshot: the reader has to scrub to find
the frame you already knew was the point.

**No GIFs.** They were a workaround for GitHub not embedding video, and they cost more than they buy:
multi-megabyte for a few seconds, palette-quantised so text goes mushy, no seek bar, no pause. Encode a
real `.mp4` and let it be a link.

**The recording draws its own pointer.** Playwright's `recordVideo` captures the page surface, and the
real cursor is drawn by the OS compositor *above* that — so an unmodified recording shows dialogs opening
and fields filling with nothing indicating what was pressed. The local runner injects a fixed,
`pointer-events:none` overlay that tracks mouse events and pulses on click, so the pointer composites into
the video because it is genuinely in the DOM. Clicks also travel to their target in ~18 steps rather than
teleporting, which is what makes the intent legible.

It is on by default; set `"cursor": false` in the plan to turn it off (worth doing for a screenshot of a
pure appearance defect, where an artificial pointer is a distraction). `fill` steps move the pointer to
the field first, since `fill` sets a value with no pointer event at all and the text would otherwise
appear from nowhere.

**Producing the `.mp4` with no ffmpeg on the box.** Playwright records `.webm` and its bundled ffmpeg is a
stripped build with only `png` and `libvpx` encoders, so it cannot make H.264. macOS AVFoundation can, via
`agent/skills/sweep/frames-to-mp4.swift` — no Homebrew, no new dependency:

```bash
ffmpeg-mac -i in.webm -r 10 /tmp/frames/f%04d.png    # decode; -vf fps=10 FAILS, filter parser absent
swiftc -O agent/skills/sweep/frames-to-mp4.swift -o /tmp/frames-to-mp4
/tmp/frames-to-mp4 /tmp/frames out.mp4 10 2.5        # 10fps, hold final frame 2.5s
```

H.264 needs even dimensions and the tool crops to that. Drop the leading page-load frames — a recording
that opens on a spinner reads as a broken artifact. Hold the final frame a couple of seconds so the end
state is legible. 17s at 10fps and full 1440x900 lands under 1MB, smaller than the GIF it replaces.

### What GitHub actually renders (tested, not assumed)

| Reference | Image | Video |
| --- | --- | --- |
| `![](raw.githubusercontent…)` | **renders inline** | becomes `<img>` → broken alt text |
| `<video src="raw…">` or `<video><source></video>` | — | **tag stripped**; renders as an empty paragraph |
| GitHub blob view (`/blob/<branch>/<path>`) | renders (`"image":true`) | no player (`"image":false`, `richText:null`) |
| Direct raw URL in a browser | `image/png` | `.webm` → `audio/webm`; `.mp4` → `application/octet-stream`, downloads |
| GitHub attachment CDN (`user-attachments/assets/…`) | player | **player — the only one that works** |

Verify with GitHub's own pipeline rather than trusting markup: `gh api -X POST /markdown -f mode=gfm
-f text='<video src="…"></video>'` returns the sanitised HTML.

**The attachment CDN is the only path to an inline player, and it has no API.** `POST
https://github.com/upload/policies/assets` needs a browser session plus CSRF; with a `gh` OAuth token it
returns **422**. So an agent cannot produce a playing video in a comment. The honest shape is: **embed a
still frame as the inline anchor, and link the `.mp4` next to it.** Say it is a recording so nobody
expects a player. A human can drag the file into the comment box to get a real player if it matters.

**4. Cloudflare masks input field content in recordings by default.** Convenient, and not a substitute
for the redaction rules below.

**5. Never reference media you have not verified is fetchable.** This is the one that has actually bitten:
a review was posted embedding three `raw.githubusercontent.com` URLs whose commit existed only locally.
Every URL 404'd, so the review shipped broken-image alt text where its evidence should have been — worse
than having posted no image at all, because it reads as a malfunction.

Bytes committed locally are not published. `raw.githubusercontent.com/<owner>/<repo>/<branch>/<path>`
resolves only after that commit is on that **remote** branch. Before posting any comment containing
media, check every URL and refuse to post on anything but a 200 with an image content-type:

```bash
for u in $URLS; do
  read -r code ctype <<<"$(curl -sL -o /dev/null -w '%{http_code} %{content_type}' "$u")"
  printf '%s  %s  %s\n' "$code" "$ctype" "$u"
  [ "$code" = 200 ] || { echo "ABORT: unpublished evidence"; exit 1; }
done
```

**If publication is not authorized, describe the evidence in prose and drop the embeds.** A sentence
saying what the frame showed is honest; a broken image is not. Posting is gated on this check, not on
the artifact existing on disk.

**Evidence belongs on a dedicated ref, never the PR branch.** A 1MB recording committed to the branch
under review shows up in that PR's own diff and files-changed count, and a reviewer now has your test
artifacts in their review. Publish blobs to a separate evidence ref via the Git Data API (blob → tree →
commit → ref) so the PR diff stays clean and nothing has to be reverted before merge. Creating or
updating that ref is a push: it needs explicit permission in the current turn, like every other push.

---

## Two execution paths

| Path | Browser runs | Recording | Use when |
| --- | --- | --- | --- |
| **Cloud** | Cloudflare Worker, `@cloudflare/playwright` | rrweb session recording plus PNG frames, stored in R2 | The default. Artifacts get durable public URLs, which is what makes them postable. |
| **Local** | Playwright on your machine | Real `.webm` via `recordVideo`, plus frames | No Cloudflare account, offline, or you want a video file. Artifacts are local, so links must be attached by hand. |

Both drive the **same test plan** and produce the **same evidence shape**. The review does not change
based on which ran, only the artifact links do. Say which one ran in the summary.

---

## Step 1: decide whether to test at all

Run the live test when the change is observable by a user or an API client:

- Any `frontend/` change that alters what is rendered, submitted, or enabled.
- A new or changed route, request schema, response shape, or error.
- A behaviour change with a "How to test" section in the PR body.
- Anything where the PR claims a user-visible outcome.

**Skip it, and say you skipped it, when:** the diff is docs only, types only, a lint or formatting pass,
a pure refactor with no behavioural claim, or infrastructure with no reachable surface. Skipping is fine.
Silently skipping is not.

---

## Step 2: bring up the PR build

```bash
# 1. Check out the PR without disturbing the working tree
git fetch origin pull/<n>/head:sweep-pr-<n>
git switch sweep-pr-<n>

# 2. Start the stack (auto-reloads)
docker compose -f docker-compose.dev.yml up -d
until curl -sf http://localhost:8080 >/dev/null; do sleep 2; done

# 3. Expose it (cloud path only)
ngrok http 8080 --log stdout > /tmp/sweep-ngrok.log &
PUBLIC_URL=$(curl -s http://127.0.0.1:4040/api/tunnels | jq -r '.tunnels[0].public_url')
```

Do not leave the branch checked out when you are done. Return to the original branch and delete
`sweep-pr-<n>`.

**If the stack will not start, that is a finding.** A PR that breaks local bring-up is
`issue (blocking) · high · reliability`, with the error output as evidence.

---

## Step 3: build the test plan from the PR

Derive steps, do not improvise. In priority order:

1. **The PR's own "How to test" section.** Follow it literally. If it does not work as written, that is
   a finding: either the code or the instructions are wrong.
2. **The changed UI surfaces.** Every form, modal, or table the diff touches.
3. **The claims in the PR description.** "Reuses the same name on renewal" is a testable assertion.
4. **The state transitions the diff implies.** Create, edit, clear a field, save, reopen, delete.

Then add the four probes that historically caught the most here:

| Probe | Why |
| --- | --- |
| **Reopen after save.** Save, close, reopen the form. | Catches "success toast, nothing persisted", which is the single most common live finding in this repo's history. |
| **Clear a previously set optional field.** | Catches PATCH treating "cleared" as "omitted", so the old value survives. Multiple real instances. |
| **Change a parent selector, then check dependent fields.** | Catches stale dependent state that the UI still displays after the parent changed. |
| **Act without permission.** Use a low-privilege actor. | Catches a UI that offers an action the backend refuses, and a gate whose conditions do not match the backend's. |

Cap the plan at about 12 steps. An exhaustive plan that times out produces nothing.

---

## Step 4: run it, and capture at every step

The worker in `../worker/` implements this. The contract it enforces:

- **A frame per step.** Named `step-NN-<slug>.png`, so the sequence reads on its own.
- **A frame on failure, immediately**, before any retry or navigation, plus the browser console log and
  any failed network requests for that step.
- **The rrweb recording for the whole session**, retrieved via `browser.sessionId()` after close.
- **A `result.json`** with each step's name, status, duration, and artifact keys.

One assertion per step, and the assertion is the expectation from Step 3. A step that "looks fine" with
no assertion tested nothing.

**Retry once, then stop.** A flaky failure that passes on retry is a `question`, not an `issue`, and say
it was flaky. A failure that reproduces twice is an `issue`.

---

## Step 5: the redaction rules

**Artifacts go into a public GitHub comment. Treat every frame as published.** This is not negotiable and
it is the part most likely to go wrong.

**Use a purpose-made test org, never a real one.** Create it fresh, or use a dedicated one whose contents
are known-safe. Never run against a customer org or a personal org with real integrations.

**Never in a test, never in a frame:**

- Real customer names, org names, project names, or domains.
- Real email addresses. Use `john.smith@example.com`.
- Real credentials of any kind, including test credentials for third-party providers.
- Any actual secret value, certificate private key, token, or connection string, even a throwaway.
- The reviewer's own identity: not your name, your email, or your account avatar.
- Anything from `.env`, and no `Authorization` header value in a captured network log.

**Use these, consistently:**

| Field | Value |
| --- | --- |
| Person | `John Smith`, `john.smith@example.com` |
| Org / project | `Example Org`, `Example Project` |
| Hostname | `example.com`, `kmip.example.com`, `10.0.0.10` |
| Secret / token value | `example-value-not-a-real-secret` |

**Before publishing any frame, check it:**

1. Is a real identity, org name, or domain visible anywhere, including the browser tab title, the org
   switcher, the avatar, and the URL bar?
2. Is any value visible that could be a live secret?
3. Would you be comfortable with this frame on a public issue tracker? This repository is public.

If the answer to 3 is no, do not post the frame. Describe the reproduction in words instead. **A finding
with no artifact is still a finding.** An artifact leaking a customer name is an incident.

The worker redacts by default: it masks input values in the recording (Cloudflare's default), and it
blurs a configurable CSS selector list before writing each frame, defaulting to the org switcher, the
user menu, and the avatar. Redaction by default is a backstop, not permission to skip the checks.

---

## Step 6: turn results into findings

A failed step becomes a finding via `review-format.md`, with two additions:

- **`Where`** is the file the behaviour lives in if you can identify it, otherwise the component plus
  "found by live test, no exact line in the diff". House style allows attaching it anywhere and saying
  "ignore placement".
- **`Reproduction`** replaces the code-reading `Evidence`: the numbered steps, then the frame embedded
  inline, then the replay link.

Severity for behavioural findings:

| What happened | Severity |
| --- | --- |
| Data loss, or a wrong value persisted silently | `critical` |
| The feature's main claim does not work | `high` |
| Success reported while nothing changed | `high` |
| An edge path is broken, main path fine | `medium` |
| Cosmetic or copy problem | `low`, or `nitpick` |

**A passing live test is worth reporting too.** One line in the summary listing the steps run is what
lets a reader trust the review. It is also the only honest way to claim the feature works.

---

## Step 7: clean up

- Stop the tunnel and the stack.
- Return to the original branch and delete `sweep-pr-<n>`.
- Delete the test org's throwaway data if it will be reused.
- Artifacts in R2 expire on the lifecycle rule (30 days by default, matching Cloudflare's recording
  retention). Do not rely on them being there later: everything load-bearing belongs in the comment text.

---

## When the live test cannot run

Say so, on its own line in the summary, with the reason:

> **Live test:** not run (no Cloudflare credentials configured). This is a code-only review.

Then do not imply behavioural coverage anywhere else in the review. The whole value of this protocol is
that the reader can tell the difference.
