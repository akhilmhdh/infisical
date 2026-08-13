# SWEEP Validation

What has been tested, how, and what it proved. Written so the claims here are auditable rather than
asserted.

Nothing was posted to any PR during any of this. No source file was modified.

---

## Test 1: blind recall on PR #7510 (the one that matters)

The first two SWEEP tests were contaminated: the fix commit messages leaked the answers before review
started. This one was run blind.

**Protocol**

| Step | What was done |
| --- | --- |
| Candidate selection | Structural metadata only (size, areas, comment count). Titles and comments not read. |
| Tree under review | `9ff8c441c..e61221f1`, the exact commit the first 10 review comments targeted. The branch was force-pushed afterwards, so this tree contains **no** later fixes. |
| Read before reviewing | PR title and body only, which is what reviewers had. |
| Deliberately not read | Commit messages after the base, and every review comment. |
| Commitment | Findings written to a file **before** any comment was opened. |

`feat(pam): redis web access`, +601 across 16 files, backend + frontend + docs. Router scored it HIGH
(PAM privileged access, socket handling, tokenizer, 4 new catch blocks).

**Result against the 5 ground-truth findings from that round**

| Ground truth | SWEEP | Notes |
| --- | --- | --- |
| Escaped quotes split Redis arguments (greptile P1, codex P2) | **Found** | Same function, same root cause. SWEEP framed it as the tokenizer having no backslash state at all, plus the asymmetry with the output escaper. |
| Unbounded WebSocket command queue (veria) | **Found** | Same mechanism: unbounded promise chain, no backpressure. |
| Unbounded reply, no command deadline (veria) | **Found, split in two** | SWEEP reported the OOM and the blocking-command hang separately, and independently noted that a deadline alone does not unblock the connection. That nuance turned out to be the author's actual root cause: `quit()` was queueing behind the blocked command. |
| Disable ioredis ready checks for ACL users (codex P2) | **Correctly not reported** | The author tested it and called it a false positive. SWEEP did not raise it. |

**4 of 4 real findings, 0 missed, and the one false positive avoided.**

**Two findings SWEEP raised in round 1 that reviewers only reached later**

1. **Terminal escape injection**, `issue · high · security`: the escaper handled only `\` and `"`, so ANSI
   control bytes in a stored value reached xterm verbatim and could repaint a privileged operator's
   recorded session. `veria-ai` raised this in a later round as `Low`, and the author confirmed: "Valid,
   control bytes were going straight through to xterm." Final `main` now has an explicit `controlBytes`
   RE2 escape. SWEEP found it a round earlier and rated it higher, which for a PAM product is the better
   call.
2. **Commands that change connection mode are not rejected**, `issue · medium · reliability`:
   `SUBSCRIBE`, `MONITOR`, `SELECT`, `RESET`, `HELLO`, `CLIENT`. A later comment from `bernie-g` reads:
   **"Running `SUBSCRIBE test` crashes the entire backend"**. Final `main` now has a `BLOCKED_COMMANDS`
   set. SWEEP predicted this from reading the code; the reviewer found it by running it.

**Five suspicions investigated and dropped** before writing, which is the verification filter working:
double teardown (`sendSessionEndAndClose` guards on `readyState`), `QUIT` with trailing args, and three
more on the two earlier test PRs.

**Honest limits of this test.** One PR, one round. SWEEP had the PR body, which described the intended
behaviour precisely enough to make some claims easy to check against the code, and a real reviewer would
have had the same advantage. The severity SWEEP assigned to the reply-size finding (`critical`) is a
judgement call the author partly disagreed with in practice: they shipped the deadline first and left
response size limits for later.

---

## Test 2: live-test harness, end to end

The browser half had never been executed. It has now, on the local path.

**Fixture:** a reduced version of the historical "success toast, nothing persisted" bug, which is the most
common live finding in this repository's review history. A form clears a TTL field, the client sends
`{}` for an empty value, the server drops undefined fields, the old value survives, and the UI reports
success anyway.

**Result:** the harness caught it on the step the protocol prescribes for exactly this class, reopen after
save.

```
✅ Open cert config
✅ Confirm starting TTL
✅ Clear the TTL
✅ Save and see success
❌ Reopen and check the TTL actually cleared
   expected "input[name="ttl"]" value to equal "", got "2d"
```

Verified artifacts: 5 PNG frames including a `-FAILED` frame, a valid `session.webm` (EBML magic checked,
Playwright's bundled ffmpeg), `result.json` carrying the error, console output and failed requests, and
exit code 1 on failure.

**Redaction verified visually.** In the captured frame the org switcher is blurred while the toast and the
empty field stay legible, so the evidence is postable without leaking an org name.

**A real bug in the runner was found by running it.** `pad` and `slug` were `const` arrow functions
declared at the bottom of `run.mjs`, but the step loop is top-level code, so they were in their temporal
dead zone: every run failed on step 1 with `Cannot access 'pad' before initialization`. Now hoisted
function declarations, with a comment saying why. This is the argument for validating a harness rather
than shipping it unproven.

---

## What is still unverified

| Piece | Status |
| --- | --- |
| Cloudflare Worker path | **Never executed.** No `wrangler`, no Cloudflare auth. The code is written against the documented API and the constraints were researched, not guessed, but no line of it has run. |
| rrweb replay viewer | Unexecuted, since it depends on a recording only Cloudflare produces. |
| ngrok tunnel step | Unexecuted. `ngrok` is installed but was not needed for the local path. |
| Live test against the real app | Unexecuted. The dev stack was not running, and the PR #7510 flow needs a gateway, a Redis instance, and a PAM account. |
| Triage mode | Unexecuted against a live PR with unresolved threads. |
| Skill activation | `.claude/skills/` is empty, so SWEEP has never been invoked as a skill, only followed manually. |

The honest summary: **the reviewing half is validated and does catch real things, including two findings
ahead of the reviewers on a PR where one of them crashed the backend. The browser half is validated on
the local path only. The Cloudflare path is unproven code.**

---

## Reproducing Test 1

```bash
S=e61221f1b81859fee9d304dde95cc1db67433962
git fetch origin $S && B=$(git merge-base origin/main $S)
git diff $B $S                      # the tree reviewers saw
gh api repos/Infisical/infisical/pulls/7510/comments --paginate \
  --jq ".[] | select(.original_commit_id==\"$S\") | \"[\(.user.login)] \(.body[0:300])\""
```

## Reproducing Test 2

```bash
cd agent/skills/sweep/local && npm install && npx playwright install chromium
node agent/skills/sweep/local/run.mjs /tmp/sweep-plan.json --out /tmp/sweep-harness
```
