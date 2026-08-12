# Phase 1 — Security hardening — 2026-08-12

**Phase:** 1 — Stop the bleeding
**Findings addressed:** SEC-1, SEC-2, SEC-3, SEC-4, SEC-5, SEC-6, SEC-7, GHL-2, ZIP-9, and two new: SEC-8, SEC-9
**Branch:** `claude/photo-album-audit-be5aap`
**Status:** complete in code; **not yet deployed** — see Deployment steps

## Goal

Close every path that lets someone take money's worth of value out of the system
for free, destroy another customer's data, or use our infrastructure and sending
domain as their own. Phase 2 restructures the download pipeline; none of that
should happen while credentials are still exposed, which is why this went first.

## What changed

| File | Change | Finding |
|---|---|---|
| `aws-ec2-spot/wedding-photo-spot-key.pem` | Deleted from the index and working tree | SEC-1 |
| `.gitignore` | Blocks `*.pem`, `*.key`, `*.p12`, `*.pfx`, `id_rsa*`, vendored `node_modules`, `*.zip` | SEC-1, ARC-2 |
| `firestore.rules` (new) | Plan state, deletes and enumeration denied to clients | SEC-2, SEC-5, SEC-7 |
| `storage.rules` (new) | Replaces the untracked `.txt` rules; size and content-type bounded | SEC-6 |
| `firebase.json` (new) | Wires rules to deploy, configures the emulator | SEC-2 |
| `tests/firestore.rules.test.js` (new) | 33 emulator tests | SEC-2, ARC-3 |
| `tests/ghl-webhook.auth.test.js` (new) | 14 webhook auth tests | GHL-2 |
| `tests/rate-limit.test.js` (new) | 10 rate limiter tests | SEC-4 |
| `netlify/functions/_lib/firebase-admin.js` (new) | Admin SDK init for privileged writes | SEC-2 |
| `netlify/functions/_lib/internal-auth.js` (new) | Shared-secret gate + download-URL allowlist | SEC-8 |
| `netlify/functions/_lib/rate-limit.js` (new) | Firestore-backed sliding window | SEC-4, ZIP-9 |
| `netlify/functions/_lib/r2.js` (new) | One R2 client instead of four spellings | — |
| `netlify/functions/delete-photo.js` (new) | Deletes across Firestore, Storage and R2 as a unit | SEC-5, SEC-7 |
| `netlify/functions/ghl-webhook.js` | Rewritten: signature or shared secret, replay window, Admin SDK, no header logging | GHL-2 |
| `netlify/functions/direct-email.js` | Requires internal secret; download URL must be on the R2 host | SEC-8 |
| `netlify/functions/email-download.js` | Same gate on the worker branch; ~250 lines of dead limiter removed | SEC-4, SEC-8, ZIP-9 |
| `netlify/functions/r2-copy.js` | Client SDK → Admin SDK | SEC-2 |
| `aws-ec2-spot/lambda-function.js` | Shared-secret auth, instance cap, credentials from env | SEC-3, SEC-9 |
| `aws-ec2-spot/user-data-*.sh` (6 files) | Hardcoded R2 credentials → variable references | SEC-9 |
| `aws-ec2-spot/wedding-photo-processor-streaming-fixed.js` | Sends the internal secret when requesting email | SEC-8 |
| `cloudflare-worker/src/index.js`, `src/email.js` | Sends both shared secrets; refuses to call unauthenticated | SEC-3, SEC-8 |
| `src/services/sessionService.ts` | `crypto.randomUUID` session ids; `getOwnerToken` / `getOwnerSecret` | SEC-5 |
| `src/services/photoService.ts` | Stores the ownership hash; delete calls the server; `upgradeEventToPremium` removed | SEC-2, SEC-5 |
| `src/services/ghlService.ts` | Browser no longer grants premium | SEC-2 |

## Why we did it this way

**Rules first, then move the writes.** Tightening `firestore.rules` immediately
breaks anything still writing from the browser, so the two had to land close
together. Writing the rules first made the list of privileged operations
explicit rather than guessed: whatever the rules deny is exactly what needed a
server function.

**Ownership is a hashed secret, not an identifier.** The photo document recorded
the uploader's raw session id, and `subscribeToPhotos` hands every document to
every guest — so any guest could read another guest's id and delete their
photos. The document now stores `sha256(sessionSecret)`; the secret stays in
`localStorage` and is presented only when calling `delete-photo`. Session ids
also moved from `Date.now()` + `Math.random()` to `crypto.randomUUID`, since a
value that acts as a bearer credential needs real entropy and `Math.random` is
not a CSPRNG.

This is honest best-effort, not a real authorisation boundary — with no user
accounts there is nothing to bind identity to. It restores the property the old
client-side check was only pretending to have. Real identity arrives with
magic-link auth in Phase 4.

**Shared secrets over IAM, for now.** The launcher's Function URL should be
`AuthType AWS_IAM` with SigV4 signing from the Worker, which removes the
standing credential entirely. That is a console change plus a signing
implementation, and this branch needed to ship without touching IAM. The shared
secret closes the hole today; the IAM migration is written up as the follow-on.

**Rate limiting fails open; authentication fails closed.** The limiter is abuse
control, so a Firestore outage should not stop a customer getting their photos.
Every secret check does the opposite: an unset secret rejects everything, since
"unset means allow" is the exact shape of the bugs being fixed.

**Left alone deliberately.** The four-tier routing, the dead Cloud Run call, the
fire-and-forget Netlify background path, and the SQS visibility timeout are all
Phase 2. Touching them here would have mixed a security change with a
behavioural one, and made both harder to review and to roll back.

## What we learned

**The audit's security section was incomplete, and in the worst direction.** Two
findings turned up during implementation that are more severe than several I
originally ranked Critical:

- **SEC-9** — live R2 access keys hardcoded in seven files, two distinct key
  pairs, including the user-data the launcher bakes into every instance. Anyone
  who has ever cloned this repository holds read, write and delete on the
  production photo bucket. My first pass grepped for `AKIA` and `sk_live`
  patterns but not for R2-style `KEY=value` assignments in shell and systemd
  files. **Lesson: grep for the shape of an assignment, not just for known
  vendor prefixes.**
- **SEC-8** — `direct-email` was a working phishing relay. It took a recipient
  and a link from an unauthenticated body and sent a branded "your photos are
  ready" message from our authenticated Mailgun domain. I audited this file for
  correctness and missed that its inputs were attacker-controlled. **Lesson: for
  any endpoint that sends email, ask who controls the recipient and who controls
  the links, before anything else.**

**The security machinery in this codebase was elaborate and non-functional.**
Roughly 250 lines of rate limiting and circuit breaking across two services
limited nothing. The Maps were process-local in a serverless runtime that
discards processes, and the circuit breaker keyed on a `requestId` generated in
the same handler, so its counter read zero on every call. Both had detailed
logging that made them look healthy. **Lesson: in a serverless or edge runtime,
any in-process state is a cache at best. If a check must hold across requests,
it needs a datastore — and a test that survives a cold start.** The rate limiter
now has exactly that test.

**Firebase API keys are not secrets, but service accounts very much are.** Worth
stating in `ENVIRONMENT.md` because the two look similar and the codebase had
already blurred them — server functions were using the public web config to
attempt privileged writes, which is why those writes had to be permitted by
rules in the first place. Tightening the rules was only possible once the
functions moved to the Admin SDK.

**The emulator caught a test bug that mocks would have hidden.** The rules suite
and the rate-limit suite initially shared a project id, and the rules suite calls
`clearFirestore()` — which wiped the other suite's data mid-run and failed two
tests depending on interleaving. Against a mock this would have passed and told
us nothing.

**`git rm --cached` on `node_modules` is worth doing early.** Tracked files went
from 6,297 to 201, which made every subsequent diff in this session reviewable.
I pulled this forward from Phase 5 for that reason.

## Deployment steps required

**None of this is live yet.** In order:

1. [ ] **Rotate the R2 credentials** — `runbooks/credential-rotation.md`. Do this
       first; it is the most exposed secret and everything else can wait behind it.
2. [ ] **Rotate the EC2 SSH key** — `runbooks/key-rotation.md`.
3. [ ] **Generate the three new secrets** and set them everywhere listed in
       `ENVIRONMENT.md`. `INTERNAL_SERVICE_SECRET` and `LAUNCHER_SHARED_SECRET`
       must match across services.
4. [ ] **Create the Firebase service account** and set `FIREBASE_SERVICE_ACCOUNT`
       in Netlify.
5. [ ] **Deploy the rules**: `npm run deploy:rules`. Watch for client write
       errors in the console immediately afterwards — if anything still writes
       from the browser that we missed, it will surface here.
6. [ ] **Redeploy** the Lambda, the Worker (`wrangler deploy`) and Netlify.
7. [ ] **Add the Custom Header** to the GoHighLevel workflow's Webhook action.
8. [ ] **Enable GitHub secret scanning with push protection** — Settings → Code
       security. Cloudflare R2 tokens are a recognised pattern, so this would
       have blocked the original push.
9. [ ] Decide on the git history purge. It rewrites shared history, so it needs
       your call — and it is only hygiene once steps 1 and 2 are done.

Order matters in one place: deploy the rules **after** the functions, or
deletion and upgrades break in the window between.

## Verification

**Exercised:**

- 33 Firestore rules tests against the real emulator, including the premium
  escalation, cross-guest deletion, and count-reset paths. All pass.
- 10 rate limiter tests against the emulator, including one that reloads the
  module to simulate a cold start and asserts the counter survives. All pass.
- 14 webhook authentication tests, including the original exploit payload,
  wrong-key signatures, a valid signature over a substituted body, and an
  hour-old replay. All pass.
- Full suite run three times to confirm the isolation fix is stable: 43/43.
- `tsc --noEmit` clean; every modified function and worker module parses.
- Grep confirms no hardcoded R2 credential remains in the working tree.

**Reasoned about but not exercised** — no live credentials in this environment:

- The Admin SDK path in `delete-photo`, `r2-copy` and `ghl-webhook` against real
  Firebase. The rules tests prove the rules; they do not prove the service
  account is wired correctly. **Test deletion of a real photo first thing after
  deploying.**
- R2 object deletion.
- Mailgun delivery with the new header.
- The launcher's `requireEnv` against a real Lambda environment.
- End-to-end: upload → archive → email, with every new secret in place.

## Still open

- **SEC-8 and SEC-9 need adding to `AUDIT_2026-08.md`** so the finding list stays
  the single reference. (Done in this commit.)
- **The git history purge** — decision needed from you.
- **GHL-1** (browser-side GoHighLevel client with `REACT_APP_GHL_API_KEY`) is
  documented in `ENVIRONMENT.md` as "remove this" but the client code still
  exists. It is inert unless the variable is set. Folded into Phase 3, where the
  GoHighLevel integration moves server-side.
- **Legacy ownership records.** Photos uploaded before today store a raw session
  id, and `delete-photo` still accepts that scheme so existing events keep
  working. Those photos carry the old weakness until they age out. Remove the
  `LEGACY` branch once the current events have passed.
- **`downloadJobs` needs a cleanup job.** Documents carry `expiresAt` but nothing
  deletes them yet. Low urgency, but the collection grows unbounded.
- **Six test functions are still deployed to production** (`test.js`,
  `test-mobile.js`, `test-upload-fix.js`, `test-event-lookup.js`, and two more).
  Not exploited by anything found here, but they are unreviewed surface. Phase 5.
