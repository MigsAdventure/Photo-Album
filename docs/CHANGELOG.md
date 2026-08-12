# Changelog

Notable changes, newest first. Each entry links the session log with the full
reasoning and the finding IDs from `AUDIT_2026-08.md`.

## 2026-08-12 — Phase 2: One download pipeline

Session: [`sessions/2026-08-12_phase-2-download-pipeline.md`](sessions/2026-08-12_phase-2-download-pipeline.md)

**Not deployed, and not yet exercised end to end.** Deploy the Lambda before
Netlify or all downloads break.

### Fixed

- **The large-video archive failures** (ZIP-3) — the cause was a queueing bug,
  not a size bug. The loop appended every file's live HTTP response to the
  archiver without waiting, and the archiver drains one at a time, so most
  connections sat idle until the origin closed them. It now streams one file at
  a time. Proven with a test that tracks connection concurrency: new code peaks
  at 1, the old loop at 8.
- **Duplicate emails** (ZIP-5) — the SQS visibility timeout was 15 minutes while
  the job timeout worked out to nearly 14 hours for a large collection, so a
  second consumer picked up work still in progress. Visibility is now extended
  on a heartbeat.
- **Corrupt downloads from concurrent requests** (ZIP-6) — every archive for an
  event wrote to the same R2 key, overwriting objects that guests might be
  mid-download of. Keys are unique per job.
- **Silently truncated archives** (ZIP-7) — a job that lost files still reported
  success, and the failure count never reached a template. Files are retried,
  losses above 5% fail the job, and any remaining are named in the email.
- **Orphaned jobs** (ZIP-8) — an instance could terminate on idle while a message
  sat unclaimed. It now drains the queue before shutting down.
- **Photos lost at extraction** — twenty guests uploading `IMG_0001.jpg`
  produced twenty identical ZIP entries that extractors silently overwrite.
  Names are now deduplicated and sanitised against path traversal.

### Removed

- **Three of four routing tiers** (ZIP-1, ZIP-2, ZIP-4). The frontend's call to
  a Google Cloud Run service decommissioned in January 2025, which burned a
  30-second timeout on every large collection. The Netlify fire-and-forget
  "background" path, which could never complete and left customers waiting for
  an email that was never sent. The Cloudflare Worker tier, now out of the path
  entirely.
- ~400 lines of duplicated email HTML across four copies that had drifted apart.
- `downloadAllPhotos`, which opened every photo in its own browser tab.
- `email-download.js`: ~900 lines → ~280.

### Added

- Archive reuse for 30 minutes, so repeat requests don't rebuild identical bytes.
- 17 archive tests. Suite total: 74.

### Known regression

Small collections now wait for an EC2 instance (~60–90s cold) instead of being
zipped inline. Accepted: delivery is by email either way, and it removes an
entire class of failure.

## 2026-08-12 — Phase 1: Security hardening

Session: [`sessions/2026-08-12_phase-1-security.md`](sessions/2026-08-12_phase-1-security.md)
Decisions: [0001](decisions/0001-privileged-writes-move-server-side.md),
[0002](decisions/0002-shared-secrets-for-internal-endpoints.md)

**Not yet deployed.** Requires credential rotation and new environment
variables — see the session log's deployment checklist.

### Closed

- **Free premium via the browser** (SEC-2) — `upgradeEventToPremium` was exported
  client-side; one console call granted unlimited uploads with no payment. Plan
  state is now Admin-SDK-only, enforced by security rules.
- **Free premium via the webhook** (GHL-2) — the GoHighLevel endpoint performed
  no verification. Now requires an HMAC signature or a shared secret, rejects
  replays, and can confirm the payment with GoHighLevel first.
- **Cross-guest photo deletion** (SEC-5) — photo documents published the
  uploader's raw session id to every guest in the gallery. They now carry a hash;
  the secret never leaves the uploader's browser.
- **Phishing relay on our own domain** (SEC-8, new) — two endpoints sent branded
  email to any address with any link, unauthenticated.
- **Committed R2 credentials** (SEC-9, new) — two live key pairs across seven
  files, granting full control of the production photo bucket.
- **Committed SSH private key** (SEC-1) — removed from the tree; rotation runbook
  written.
- **Unauthenticated EC2 launcher** (SEC-3) — a public URL that started billable
  instances. Now authenticated and capped at 2 concurrent.
- **Orphaned storage on delete** (SEC-7) — deletion touched Firestore only, so
  bytes stayed in Firebase Storage and R2 forever. Now one server operation
  across all three.
- **Unbounded uploads** (SEC-6) — storage rules accepted any file of any type or
  size. Now bounded to images and video under 2 GB.

### Added

- `firestore.rules`, `storage.rules`, `firebase.json` — rules under version
  control for the first time, with 33 emulator tests.
- Three server functions and four shared modules for privileged operations.
- Durable Firestore-backed rate limiting (SEC-4, ZIP-9), replacing ~250 lines of
  in-memory bookkeeping that could not work in a serverless runtime.
- `docs/` — session logs, decision records, runbooks, and an environment
  reference.
- 57 tests where there were none: `npm run test:security`.

### Removed

- The in-memory rate limiter and the circuit breaker, which keyed on a request id
  generated in the same handler and so could never open.
- `node_modules` and four Lambda zip bundles from version control. Tracked files:
  6,297 → 201.

### Known gaps

- Ownership remains best-effort; there is no authentication to bind it to. Real
  identity arrives in Phase 4.
- Photos uploaded before this change still carry the old plaintext ownership
  scheme, which `delete-photo` accepts for compatibility.
- Git history still contains the leaked key and credentials. Purging rewrites
  shared history and needs an explicit decision.
