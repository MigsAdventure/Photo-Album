# Session handoff — 2026-08-12

Everything a fresh session needs to pick this up. Read this first, then the
session log for whatever phase you are touching.

---

## Where things stand

Four phases of the audit are **code complete and pushed**, plus two follow-up
pieces of work. None of it is deployed.

| Phase | State | Blocked on |
|---|---|---|
| 1 — Security | Complete | Credential rotation + 4 new secrets |
| 2 — Download pipeline | Complete | Lambda must deploy before Netlify |
| 3 — Storage plane | Complete | **R2 CORS policy** — uploads fail without it |
| 4 — Product | Complete | Two Firebase console settings |
| Post-review fixes | Complete | Nothing — but the `organizerEmail` backfill still needs running |
| Payments & upgrade UX | Complete | **`CHECKOUT_URL`** + order-form config, or nobody can pay |
| 5 — Modernize | Not started | — |
| 6 — Differentiate | Not started | — |

The two follow-ups are [`sessions/2026-08-12_review-findings.md`](sessions/2026-08-12_review-findings.md)
(the four findings the adversarial review left open) and
[`sessions/2026-08-12_payment-flow-and-upgrade-ux.md`](sessions/2026-08-12_payment-flow-and-upgrade-ux.md)
(the payment surfaces still describing the paywall phase 4 removed).

Branch: `claude/photo-album-audit-be5aap` · 20 commits from `b897696`
Tests: `npm run test:all` → **151 passing** across six suites
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

Steps 0, 1 and 2 are the urgent ones — they are live exposures, not deployment
chores. Step 0 is losing money right now.

0. **Production grants premium without payment. Confirmed live, 2026-08-12.**
   The owner reproduced it: cancel the payment and the event is premium anyway.

   It is not that cancelling fails to revoke — paying was never required. The
   chain on `main` is:

   - `UpgradeModal.handleUpgrade` posts to the GoHighLevel inbound webhook
     *before the payment form is shown*, with `planType: 'premium'`,
     `paymentAmount: 29`, and a `paymentId` of `` `${eventId}_${Date.now()}` ``
     invented in the browser
   - the GoHighLevel workflow calls back to `ghl-webhook`
   - `ghl-webhook` on `main` has **no signature check, no shared secret, and no
     payment verification** (finding GHL-2), so it grants premium

   So clicking "Upgrade" is sufficient. Separately, the same missing
   authentication means anyone who can guess an event id — and they are
   semi-guessable by construction, `YYYY-MM-DD_title-slug_8char` — can `curl`
   themselves premium.

   **Immediate mitigation, no deploy needed:** disable the GoHighLevel workflow
   that fires `upgrade_confirmed`.

   This branch fixes the application side: the browser call is deleted, and
   `ghl-webhook` requires an HMAC or shared secret. But **the workflow lives in
   GoHighLevel, not in this repo**, and two things still need doing there:

   - Do not point `GHL_CHECKOUT_WEBHOOK_URL` at the same inbound webhook that
     triggers the upgrade workflow, unless the workflow branches on `action`.
     Otherwise `checkout_started` still fires `upgrade_confirmed` — and it will
     now be *authenticated*, so the new checks will not stop it. Authentication
     stops strangers, not a misconfigured workflow.
   - **Set `GHL_API_TOKEN`.** It makes `ghl-webhook` confirm the transaction with
     GoHighLevel before writing `planType`. It is optional in code and when unset
     the handler logs a warning and grants anyway. Given the above, treat it as
     required rather than optional.

   Worth auditing what was already given away: wrongly-granted events carry a
   `paymentId` matching `<eventId>_<13-digit-timestamp>`, or the string
   `'unverified'`, which makes them identifiable in Firestore.

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
5a. **Set `CHECKOUT_URL` and `CHECKOUT_REF_SECRET`**, and configure the
   GoHighLevel order form to carry `ref` through and send it back. Without these
   nobody can upgrade — the button correctly reports upgrades unavailable. →
   [`sessions/2026-08-12_payment-flow-and-upgrade-ux.md`](sessions/2026-08-12_payment-flow-and-upgrade-ux.md)
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

## Findings from the pre-handoff review

An adversarial review of all four phases raised 30 findings; **10 survived
refutation**. Six were fixed in commits `c59fdd1` and `78f848a`. The remaining
four were addressed on 2026-08-12 — see
[`sessions/2026-08-12_review-findings.md`](sessions/2026-08-12_review-findings.md).
All ten were introduced by phases 1–4.

None of it is deployed, and the content-type change in particular has never been
run against real R2 — read the "Not exercised" section of that session log before
trusting it.

### 1. `failedCount` reaches the email
`netlify/functions/email-download.js` · was: dropped

The processor sends `failedCount` in its callback; the handler destructured the
body without it, so the notice built for ZIP-7 — telling a customer some files
could not be included — could never render. The handler now forwards it, stores
it on the `downloadJobs` record, and reads it back on the **reuse path**, which
had the same defect and was not part of the original finding: a reused archive is
short by the same files, and the second requester was being told nothing was
missing.

### 2. Client and server agree on what counts as media
`netlify/functions/upload-init.js`, `src/services/r2UploadService.ts` · was: 400 on valid files

The client falls back to the extension when `file.type` is empty (`.HEIC`, some
Android pickers) and sends `application/octet-stream`; `upload-init` checked the
MIME type alone and returned 400 for a file the app had already accepted.

`resolveContentType()` now derives a media type from the extension when the
declared one is not `image/*` or `video/*`. Note this could not be fixed
server-side alone: `ContentType` is a **signed header** on the presigned URL and
is HMAC'd into the upload token, so the resolved value is returned to the client
and used for the PUT, the parts, and the completion call. It resolves from an
allowlist rather than trusting the declared string — whatever is signed here is
what R2 serves from the public host, so accepting `text/html` on a `.jpg` would be
stored XSS on our own domain.

### 3. The credential-rotation runbook no longer touches production
`docs/runbooks/credential-rotation.md`

The `aws lambda invoke` example queued a real SQS job and launched a real EC2
instance — the launcher requires only `eventId` and `email`, so an empty `photos`
array is still a real job. Replaced with `get-function-configuration` checks that
assert the variables are set without invoking anything and without printing
secret values.

### 4. Existing events still need the `organizerEmail` backfill — **operational, not done**

The casing fix normalises at write time, so **events created before it still
store whatever was typed** and remain invisible to their organizers.

[`scripts/backfill-organizer-email.js`](../scripts/backfill-organizer-email.js)
now exists. It is dry-run by default, idempotent, and prints every proposed
change. **It has not been run** — it needs `FIREBASE_SERVICE_ACCOUNT` and a
production Firestore, neither of which exists in a cloud session. Run it, dry
first, before telling any existing customer the dashboard exists.

The full verified output, including the 20 refuted findings and the evidence for
each, is in the workflow journal referenced in that session's transcript.

## The review also caught a bug in the headline fix

Worth reading before trusting the rest of this work.

An adversarial review of all four phases found that **the headline ZIP-3 fix —
the one this whole effort was built around — could not survive the failure it was
written for.** When an origin accepts a request then drops the socket mid-body
(exactly what Firebase/GCS does), streaming that response into archiver either
raised an unhandled error that the processor turned into `process.exit(1)`, or
left the append hanging forever. Reproduced both ways.

Fixed in commit `c59fdd1`: files stage to a temp file with retry, then append
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

## Picking this up locally

The branch is `claude/photo-album-audit-be5aap`. A fresh clone needs:

```bash
git fetch origin claude/photo-album-audit-be5aap
git checkout claude/photo-album-audit-be5aap
npm install          # not optional — see below
npm run test:all     # expect 153 passing across six suites
npm run build        # expect a clean build, no warnings
```

**`npm install` first, always.** `node_modules` is no longer tracked (it used to
be — 6,090 of 6,297 tracked files). Without it the first test run fails with
`Cannot find module 'firebase-admin'`, which reads alarmingly like a broken
branch and is not.

**The rules and rate-limit suites need Java** for the Firestore emulator. If
`npm run test:rules` is the only thing failing, that is almost certainly why —
the other five suites run without it.

**Nothing needs real credentials to develop.** All 153 tests, the build and
`tsc --noEmit` run with no AWS, R2, Firebase or GoHighLevel access. That is also
the limitation: none of the seams between components have ever been exercised.
For a local dev server against real services you need a gitignored `.env.local`
with the `REACT_APP_*` values from [`ENVIRONMENT.md`](ENVIRONMENT.md).

**Do not rebase or squash this branch.** Commits reference finding IDs, so
`git log --grep=ZIP-3` is how the reasoning behind a change is found.

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
