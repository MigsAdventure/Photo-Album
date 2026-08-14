# Closing the four open review findings — 2026-08-12

**Phase:** 5 — follow-up to the phase 1–4 adversarial review
**Findings addressed:** the four unfixed findings recorded in `HANDOFF.md`
**Branch:** `claude/photo-album-audit-be5aap`
**Status:** complete

## Goal

The pre-handoff adversarial review raised 30 findings, of which 10 survived
refutation. Six were fixed in `c59fdd1` and `78f848a`; four were recorded in
`HANDOFF.md` and left. This session closes those four. All were introduced by
phases 1–4, so they are our own regressions rather than pre-existing defects.

## What changed

| File | Change | Finding |
|---|---|---|
| `netlify/functions/email-download.js` | Destructure `failedCount` from the processor callback and forward it to `sendArchiveReadyEmail`; persist it on the `downloadJobs` record and read it back on the reuse path | 1 |
| `netlify/functions/upload-init.js` | New `resolveContentType()` — resolves an extension-derived media type when the declared type is not `image/*` or `video/*`; the resolved value is what gets presigned, signed into the upload token, and returned to the client | 2 |
| `src/services/r2UploadService.ts` | `UploadTarget` carries `contentType`; the client PUTs and completes with the server's resolved value | 2 |
| `docs/runbooks/credential-rotation.md` | Replaced the `aws lambda invoke` smoke test with a side-effect-free `get-function-configuration` check | 3 |
| `scripts/backfill-organizer-email.js` | New one-off Admin SDK script, dry-run by default, idempotent | 4 |
| `tests/upload-contract.test.js` | New suite, 14 tests | 1, 2, 4 |
| `package.json` | `test:upload` script, wired into `test:all` | — |

## Why we did it this way

**Finding 1 had a second site the review did not name.** The reported defect was
the processor-callback branch dropping `failedCount`. The reuse branch
(`ARCHIVE_REUSE_WINDOW_MS`, ~30 minutes) drops it too, and it is arguably worse:
the reused archive is the same bytes, so it is short by the same files, but the
second requester was being told nothing was missing. Fixing only the reported
line would have left half the bug in place. `failedCount` is now stored on the
`downloadJobs` document so the reuse path can report it.

**Finding 2 could not be fixed on the server alone**, which is why it is bigger
than the one-line change the review suggested. `ContentType` is a *signed* header
on an R2 presigned URL. If the server resolves `application/octet-stream` to
`image/heic` and presigns with that, but the client still PUTs with
`Content-Type: application/octet-stream`, R2 rejects the request as a signature
mismatch — trading a 400 from our own function for an opaque 403 from storage.
The same value is also HMAC'd into the upload token that `upload-complete`
recomputes. So the resolved type has to travel back to the client and be used for
the PUT, the parts, and the completion call. All three now use it.

The fallback resolves a type from an allowlist rather than accepting the client's
declared string. That matters: whatever is signed here is what R2 stores and
later serves from the public bucket host, so honouring a declared `text/html` on
a file named `.jpg` would be stored XSS on our own domain. `resolveContentType`
returns a value from the table or `null`, never the caller's string.

**Finding 3** is replaced rather than annotated. A warning above a working
copy-pasteable command is not much of a control during an incident.

**Finding 4's script is dry-run by default.** `--apply` is required to write. The
failure mode of a backfill is silent and wide, and the dry run prints every
proposed change as `from -> to`, which is cheap to read and the only chance to
catch a bad transform before it is applied to every event.

## What we learned

**The repo's own lesson about regression tests earned its keep immediately.**
`HANDOFF.md` says to write the test so it fails against the old code and then
check that it does. Doing that here caught that 10 of the 11 initial tests failed
against the pre-fix code and one passed — the one asserting on the email template
source, which my changes never touched. That test was worth keeping but proves
nothing about the fix, and without running it against the old code it would have
looked like just another green line.

**`git stash push <paths>` is a clean way to run new tests against old code**
without touching the untracked test file, which stays in the working tree.

**Two findings were the same defect wearing different clothes.** Findings 1 and 2
are both a contract mismatch across a boundary where each side is correct in
isolation and nothing fails loudly when they disagree. The processor sends a
field the handler does not read; the client validates by extension while the
server validates by MIME type. Neither shows up in a unit test of either side.
Both new parity tests read the *other* side's source and assert agreement, which
is the only kind of test that catches this class.

**A fresh cloud session does not start where the last one stopped.** This session
opened on a branch created from `main` at the pre-audit commit, with none of the
18 commits present and the audit branch not even fetched. `HANDOFF.md` is what
made the recovery a two-minute operation. Dependencies also need `npm install` —
the first test run failed with `Cannot find module 'firebase-admin'`, which reads
alarmingly like a broken branch and is not.

## Deployment steps required

Unchanged from `HANDOFF.md` — nothing here alters the deployment order, and
none of it is deployed.

- [ ] Findings 1 and 2 ship with the normal Netlify deploy (Lambda first, per
      the phase 2 order).
- [ ] Finding 2 requires **no** R2 or Lambda change. It is confined to
      `upload-init` and the browser.
- [ ] Run `scripts/backfill-organizer-email.js` once against production, dry run
      first, before telling any existing customer the dashboard exists. Needs
      `FIREBASE_SERVICE_ACCOUNT`.

## Verification

`npm run test:all` → **136 passing** across five suites, up from 119. Build clean,
`tsc --noEmit` clean.

The new tests were run against the pre-fix code by stashing the three source
files: 10 of 11 failed as expected.

**Not exercised.** Everything below is reasoned about, not run:

- No R2, AWS or Firebase credentials exist in this environment, so no presigned
  URL was ever generated, signed, or PUT to. The claim that the resolved
  `ContentType` now matches between the presign and the PUT is read off the code,
  not observed against R2. **This is the one to watch on the first real upload
  after deploying** — the symptom of getting it wrong is a 403 from storage on
  every upload, not a partial failure.
- No `.HEIC` file was uploaded from a real Safari. The `application/octet-stream`
  behaviour is from the client source, which sends exactly that when `file.type`
  is empty.
- The backfill script has never run against a Firestore instance. Its
  `normalise` is unit-tested and it imports cleanly without connecting, but the
  batching and the `--apply` path are untested. Dry-run it first and read the
  output.
- `failedCount` reaching a real inbox depends on the processor actually sending
  it, which needs a real archive job with a fetch failure in it.

## Still open

Everything in the "Known-open, carried forward" section of `HANDOFF.md` is
unchanged. Nothing new was found while making these changes.

One thing noticed but deliberately not acted on: `upload-init` validates
`contentType` against the extension allowlist, but `extensionFor()` still derives
the stored object's extension from the *filename* first. For a file named
`photo.jpg` carrying real HEIC bytes the key ends in `.jpg` while the content type
is `image/jpeg` — consistent with each other and with what the browser claimed, so
nothing breaks. Worth knowing the key's extension is not evidence of the bytes.
