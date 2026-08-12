# Session handoff — 2026-08-12

Everything a fresh session needs to pick this up. Read this first, then the
session log for whatever phase you are touching.

---

## Where things stand

Four phases of the audit are **code complete and pushed**, none deployed.

| Phase | State | Blocked on |
|---|---|---|
| 1 — Security | Complete | Credential rotation + 4 new secrets |
| 2 — Download pipeline | Complete | Lambda must deploy before Netlify |
| 3 — Storage plane | Complete | **R2 CORS policy** — uploads fail without it |
| 4 — Product | Complete | Two Firebase console settings |
| 5 — Modernize | Not started | — |
| 6 — Differentiate | Not started | — |

Branch: `claude/photo-album-audit-be5aap` · 16 commits from `b897696`
Tests: `npm run test:all` → **114 passing** across four suites
Build: clean, no warnings

**Nothing has run against real infrastructure.** No AWS, R2 or Firebase
credentials exist in the working environment. Components are individually
tested; the seams between them are not. Every session log has a "Not exercised"
section — read it before claiming anything works.

---

## What the connected MCPs can and cannot do

This matters, because it determines what a session can actually unblock.

### Cloudflare — connected, verified against the live account

Confirmed present: bucket `sharedmoments-photos-production` (created 2025-07-08),
worker `sharedmoments-photo-processor`.

| Can | Cannot |
|---|---|
| List, get, create, delete R2 buckets | **Set CORS policy** |
| List workers, read worker code | **Set lifecycle rules** |
| Full D1, KV, Hyperdrive CRUD | **Deploy a worker** |
| Search Cloudflare docs | **Manage worker secrets** |

**The R2 CORS blocker is still manual.** The MCP cannot set it. It has to be
done with `wrangler` or in the dashboard — see
[`runbooks/r2-bucket-setup.md`](runbooks/r2-bucket-setup.md). Same for the
lifecycle rules and for `wrangler secret put`.

Useful anyway: a session can now *verify* bucket and worker state rather than
guessing, and read the deployed worker's code to compare against the repo.

**One thing the MCP surfaced that was not previously visible:** the bucket's
location is `WNAM` (western North America), while the EC2 processor and SQS queue
are in `us-east-1`. So every archive job streams bytes coast to coast on the way
out. Not a defect, and not worth churning on now — but if archive jobs feel slow
once they are running, that is the first thing to measure. Moving the processor
to a west-coast region would put it next to the bucket.

### Netlify — connected, but to the wrong account

The connected token sees exactly one site, `the-simple-merchant`. SharedMoments
is not on it. Until that is resolved the Netlify MCP cannot help with this
project.

It *can* do a lot once pointed at the right account: `manage-env-vars`,
`create-new-project`, `deploy-site`, `get-project`, deploy status.

### GitHub — connected, scoped to `migsadventure/photo-album`

### No Firebase MCP exists

Google's official Firebase MCP is a local stdio server (`firebase experimental:mcp`)
that runs against a logged-in CLI on your own machine. It cannot attach to a
cloud session. `firebase-tools` is installed in this repo, so a session could
deploy rules if a `FIREBASE_TOKEN` were provided as an environment variable —
that is a project-wide credential and entirely the owner's call.

---

## Netlify migration plan

The goal is to move SharedMoments onto the newly upgraded account.

**Recommendation: create a new site on the new account rather than transferring
the old one.** Netlify does support a team transfer, but a fresh site is the
better move *specifically because of where this project is*:

- Phases 1–4 introduce roughly ten new environment variables and change what
  several existing ones mean. A fresh site means setting them correctly once,
  rather than reconciling a live site's config against a checklist.
- A new site gets a `*.netlify.app` URL immediately, so the whole rewritten
  stack can be tested end to end **before** any DNS changes. Given nothing has
  been exercised against real infrastructure, that staging step is worth a lot.
- The custom domain moves last, as a single cutover, with the old site still
  serving until it does. Zero downtime, and a trivial rollback.

### Steps

1. **Create the site** on the new account from the GitHub repo, build command
   `npm run build`, publish directory `build`. (The Netlify MCP can do this once
   connected to the right account.)
2. **Use Shared Environment Variables** — new on the $20 plan and a genuinely
   good fit here. Define `R2_*`, `FIREBASE_SERVICE_ACCOUNT`, `EMAIL_*` and the
   shared secrets at team level, then link them to the site. When you rotate the
   R2 credentials (which you must — see below), you change them in one place.
3. **Turn on password protection** while testing. Also new on your plan, and
   exactly the right tool for validating the rewritten upload and download paths
   on a public URL without exposing a half-configured site.
4. **Set the variables** per [`ENVIRONMENT.md`](ENVIRONMENT.md). Note that
   `INTERNAL_SERVICE_SECRET` and `LAUNCHER_SHARED_SECRET` must hold identical
   values in Netlify, the Lambda, and the Cloudflare Worker.
5. **Deploy and test** against the `*.netlify.app` URL, in the order given in
   each session log.
6. **Move the custom domain** once it works, and update `R2_PUBLIC_URL`
   consumers plus the Firebase authorized-domains list.
7. **Delete the old site** only after a week of clean operation.

### On the plan features you mentioned

- **Shared environment variables** — the most useful one here, for the reason
  above.
- **Password protected projects** — use it for the staging step.
- **Custom Identity emails and templates** — worth knowing this does **not**
  apply to us. Organizer sign-in uses *Firebase* Auth email links, not Netlify
  Identity. That was deliberate: Firebase Auth puts
  `request.auth.token.email` into Firestore security rules, which is precisely
  what makes the organizer access rules in `firestore.rules` work. Netlify
  Identity would not give us that, and swapping would mean going back to
  proxying every organizer action through a server function. Don't migrate the
  auth to Netlify Identity.
- **Agent Runners / AI tasks** — could run `npm run test:all` on a schedule.
  Marginal; the tests already run in a session.
- **3+ concurrent builds** — fine, no action.

---

## Do these first, in this order

Each has a runbook. Steps 1 and 2 are the urgent ones — they are live exposures,
not deployment chores.

1. **Rotate the R2 credentials.** Two live key pairs were committed across seven
   files (finding SEC-9) and are still in git history. They grant read, write and
   delete on `sharedmoments-photos-production` — every customer's photos.
   → [`runbooks/credential-rotation.md`](runbooks/credential-rotation.md)
2. **Rotate the EC2 SSH key.** Committed private key (SEC-1), still in history.
   → [`runbooks/key-rotation.md`](runbooks/key-rotation.md)
3. **Apply the R2 CORS policy and lifecycle rules.** Uploads fail entirely
   without CORS. `ExposeHeaders: ["ETag"]` is the part that will bite: get it
   wrong and photos upload fine while videos over 64 MB fail at the final step,
   presenting as "large videos are broken" all over again.
   → [`runbooks/r2-bucket-setup.md`](runbooks/r2-bucket-setup.md)
4. **Enable Firebase email-link sign-in** and add authorized domains, or
   organizer sign-in fails silently. → [`ENVIRONMENT.md`](ENVIRONMENT.md)
5. **Generate the four new secrets** and set them everywhere listed.
6. **Decide on the git history purge.** It rewrites shared history, so it needs
   an explicit call. Once 1 and 2 are done it is hygiene, not an emergency.
   Combine it with removing the committed `node_modules` and Lambda zips —
   there is no reason to inflict a history rewrite twice.

---

## Deployment order

Order matters in three places and getting it wrong breaks things:

- **Phase 2: Lambda before Netlify.** `email-download` posts to the launcher and
  nothing else can archive. Netlify first means every download 500s.
- **Every phase: functions before rules.** Deploying tightened rules while the
  old client is live breaks deletion and upgrades in the gap.
- **Phase 3: R2 CORS before anything.** Uploads fail without it.

---

## First real test after deploying

Small test cases pass even with the bugs this work fixed. Use these specifically:

| What | Why this shape |
|---|---|
| A collection with a 200 MB+ video and 20+ files | The shape that failed before (ZIP-3). A small collection passes even with the old queueing bug. |
| A single video over 64 MB | Exercises multipart upload and the ETag CORS exposure. A small video passes with CORS misconfigured. |
| Sign in at `/dashboard`, then delete a photo you did not upload | Exercises the whole new auth chain: magic link → ID token → `verifyOrganizer` → three-store delete. |
| Request the same download twice within 30 minutes | Should reuse the archive, not rebuild it. |

Watch for **duplicate emails** on the first few real archive jobs — that was the
ZIP-5 symptom, and the visibility heartbeat fix is the one piece of Phase 2 that
cannot be tested without real SQS.

---

## A real bug the pre-handoff review caught

Worth reading before trusting the rest of this work.

An adversarial review of all four phases found that **the headline ZIP-3 fix —
the one this whole effort was built around — could not survive the failure it was
written for.** When an origin accepts a request then drops the socket mid-body
(exactly what Firebase/GCS does), streaming that response into archiver either
raised an unhandled error that the processor turned into `process.exit(1)`, or
left the append hanging forever. Reproduced both ways.

Fixed in commit `4e12dbe`: files stage to a temp file with retry, then append
from local disk. Five regression tests against a socket-destroying server.

**Why it survived my own testing:** my tests simulated *clean* HTTP failures — a
tidy 500, a tidy 404. Real origins accept the request and then vanish. The
concurrency test was correct, the retry test was correct, and the actual
production failure mode was still uncovered.

If you write a test for a network failure in this repo, make the fake server fail
the way the real one does.

## Known-open, carried forward

Not bugs found late — things deliberately left, each recorded in the relevant
session log's "Still open".

- **Agency layer not built.** The audit's §06 model is
  Agency → Organizer → Event. Phase 4 built the middle. Reselling needs the top,
  and it is a schema change best made before there are paying resellers.
- **UX-4 not reached.** No multi-select download. Single-photo download works
  via `r2-download`.
- **Dashboard is read-mostly.** Rules permit editing title, date, active state
  and branding; the UI does not expose it yet. No further rules work needed.
- **Existing photos have no thumbnails** and still live in Firebase Storage.
  Both stores are read for the foreseeable future. A backfill would fix the
  first; a migration the second.
- **`storage.rules` still permits creates**, deliberately, so a rollback has
  somewhere to land. Close it once R2 uploads are confirmed.
- **Legacy ownership records.** Photos from before Phase 1 store a raw session
  id; `delete-photo` still accepts that scheme. Remove the `LEGACY` branch once
  those age out.
- **`downloadJobs` has no cleanup job.** Documents carry `expiresAt`; nothing
  acts on it.
- **Public R2 objects, not signed URLs.** Anyone with a URL can fetch any photo
  forever. Fixing it means moving the gallery, the emails and the archive links
  together.
- **Three size limits that should be one constant**: `videoService.ts` says
  1.5 GB, `upload-init.js` enforces 2 GB, the rules allow 2 GB.
- **The Cloudflare Worker is deployed but out of the request path.** Its
  `wedding-zip-processor.js` and `queue-processor.js` are dead code. Undeploying
  it is Phase 5 cleanup.
- **`direct-email.js` is unused** — the processor calls `email-download` now.
  Left for one deploy cycle as a rollback target.

---

## How to work in this repo

- **Conventions** are in [`README.md`](README.md). One session log per session,
  written during the work; decision records for anything expensive to reverse;
  runbooks for operational procedure.
- **Never mark anything "complete — do not revisit".** That convention in the
  old `project-state.md` is the direct reason finding ZIP-3 survived seven
  months of debugging: a fix was declared final, so nobody looked again.
- **Commits reference finding IDs**, so `git log --grep=SEC-2` shows everything
  touching a finding.
- **Run `npm run test:all` before committing.** The rules and rate-limit suites
  need Java for the Firestore emulator; it is present in this environment.

### Three lessons that cost real time here

1. **Write a regression test so it fails against the old code, then check that
   it does.** The ZIP-3 concurrency test asserts one connection at a time; I
   reimplemented the old loop against the same harness to confirm it peaks at 8.
   Without that check it would have been a test that passed and proved nothing.
2. **Treat an unused-import warning as a question.** Two real bugs surfaced that
   way — a lost `addOwnedPhoto` call that would have left every guest unable to
   delete anything, and an error class still matching a status code the server
   had stopped returning. Neither was a type error.
3. **Prove a thing is dead with a different query than the one that suggested
   it.** A pattern for finding orphaned functions reported `r2-download` and
   `download` as uncalled. Both are live — the gallery builds those URLs as
   template strings. Two working endpoints nearly went.
