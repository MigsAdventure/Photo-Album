# Phase 3 — Storage plane — 2026-08-12

**Phase:** 3 — Storage plane
**Findings addressed:** ZIP-10, UX-3, GHL-1 (and SEC-2 tightened further)
**Branch:** `claude/photo-album-audit-be5aap`
**Status:** complete in code; **not deployed, and blocked on R2 bucket configuration**

## Goal

Get Firebase Storage out of the write path, so large videos stop failing to reach
R2, and give the gallery something smaller than a full-resolution photo to load.

## What changed

| File | Change | Finding |
|---|---|---|
| `netlify/functions/upload-init.js` (new) | Issues presigned single/multipart targets, validates event and plan, signs an upload token | ZIP-10 |
| `netlify/functions/upload-complete.js` (new) | Completes multipart, verifies the object, writes the photo document | ZIP-10, SEC-2 |
| `src/services/r2UploadService.ts` (new) | Direct upload with real progress and per-part retry | ZIP-10 |
| `src/services/thumbnailService.ts` (new) | Client-side WebP previews; video frame grabs | UX-3 |
| `src/services/mediaUploadService.ts` | Routes through R2; no separate count write | ZIP-10 |
| `src/components/EnhancedPhotoGallery.tsx` | Grid uses thumbnails, lazy loads | UX-3 |
| `firestore.rules` | Client photo creation and all event updates denied | SEC-2 |
| `src/services/ghlService.ts` | Browser API client removed | GHL-1 |
| **Deleted** | `r2-copy.js`, `PhotoUpload.tsx`, `mobileUploadService`, `backgroundUploadService`, `pwaService`, `r2Service`, both service workers | ZIP-10 |

## Why we did it this way

**Presigned URLs, with the server choosing everything that matters.** A presigned
URL is a capability — whoever holds it can write that exact key. So the server
picks the key, the content type and the size ceiling, and signs those facts into
an `uploadToken` that `upload-complete` re-derives. Without that token a caller
could upload 20 KB and then claim it was a 2 GB video attached to someone else's
event. The `HeadObject` check then confirms the bytes are really there before any
document is written.

**Sequential parts, not parallel.** Parallel parts finish sooner on a good
connection. These uploads happen on congested venue wifi, where parallel parts
compete for the same bandwidth and time out together — and multipart is here for
resilience, not speed. Each part retries independently, so one flaky part no
longer costs a whole video.

**XMLHttpRequest for the upload.** `fetch` still has no upload progress event in
any shipping browser. A guest pushing 400 MB with a dead progress bar concludes
the app has frozen and kills it.

**Thumbnails in the browser rather than server-side.** No infrastructure, no
per-image fee, and the device has already decoded the image to show a preview.
The cost is a second small upload per file and nothing for pre-existing photos,
which keep serving originals.

**Rules got tighter, not looser.** With documents written server-side, clients no
longer need to create photos or touch events at all, so both are now denied
outright. The narrowest rule that still works is the right one.

## What we learned

**Removing a copy step fixed a counting bug nobody had reported.** `photoCount`
was a separate client write issued after the photo document. A guest who closed
the tab in between left the event permanently miscounted — and the plan limit is
computed from that count, so an event could sit one upload short of its limit
forever, or over it. It is one server call now. **Two writes that must both
happen, issued from a browser, are a bug waiting for bad wifi.**

**"Large videos are broken" had two independent causes.** Phase 2 fixed the
archive queueing bug. This phase fixed the reason those videos were on the slow
origin in the first place. Either one alone would have left the symptom partly
present, which is very likely why previous rounds of fixes felt like they half
worked.

**CORS `ExposeHeaders` is a trap worth documenting loudly.** Completing a
multipart upload needs each part's ETag, and a browser cannot read a response
header CORS has not exposed. Get it wrong and uploads under 64 MB work perfectly
while larger ones fail at the final step — presenting, once again, as "large
videos are broken". The client now throws an error naming the runbook rather than
failing obscurely.

**`canvas.toBlob` fails silently.** Ask for an unsupported type and it hands back
PNG without complaint. Assuming WebP on an older iPhone would have produced
thumbnails several times larger than the JPEG being avoided — a performance fix
that made things worse, invisibly. Feature-detected now.

**Deleting the dead upload path mattered more than it looked.** `PhotoUpload.tsx`
was rendered nowhere, and it exclusively owned three services — about 2,100 lines
in total, all still using the raw-sessionId ownership model that SEC-5 replaced.
Leaving a second, divergent, vulnerable upload path in the tree while changing
the real one is how a fixed vulnerability comes back.

## Deployment steps required

**Phases 1 and 2 must be deployed first.**

1. [ ] **Apply the R2 CORS policy** — `runbooks/r2-bucket-setup.md`. **Uploads
       fail entirely without it.** `ExposeHeaders: ["ETag"]` is the part that is
       easy to miss and presents as "only large videos fail".
2. [ ] **Add the lifecycle rules** — expire `archives/` after 30 days, abort
       incomplete multipart uploads after 1 day. Without the second, abandoned
       parts are billed forever.
3. [ ] Set `UPLOAD_TOKEN_SECRET` in Netlify (falls back to
       `INTERNAL_SERVICE_SECRET` if unset, which is acceptable but not ideal).
4. [ ] Set `REACT_APP_GHL_UPGRADE_WEBHOOK` if you want the CRM notification on
       upgrade; it is skipped with a warning otherwise.
5. [ ] Remove `REACT_APP_GHL_API_KEY` from the Netlify environment, and rotate
       that key if it was ever set — it was compiled into the bundle.
6. [ ] Deploy the rules **after** the functions: `npm run deploy:rules`.
7. [ ] Deploy Netlify (functions and frontend together).

## Verification

**Exercised:**

- Production build succeeds (`npm run build`).
- `tsc --noEmit` clean.
- 70/70 tests: 14 webhook auth, 17 archive, 39 rules and rate limiting.
- Rules tests updated to assert the new denials — client photo creation and event
  updates now fail, server writes still succeed.
- `signUpload` confirmed deterministic and to detect both key and size tampering.

**Not exercised:**

- **No upload has ever run.** No R2 credentials here. Presigning, the PUT, the
  multipart flow, ETag collection and `upload-complete` are all untested against
  real infrastructure.
- Thumbnail generation needs a browser; the canvas and video paths have not run.
- WebP feature detection on Safari.
- The gallery rendering thumbnails.
- Whether R2 accepts these presigned URLs unchanged — it is S3-compatible, but
  presigning is exactly where compatibility layers tend to differ.

**First test after deploy, in order:** a photo, then **a video over 64 MB**. The
video is the one that exercises multipart and the ETag exposure; a small one
passes even with CORS misconfigured.

## Still open

- **Existing photos have no thumbnails.** They fall back to full resolution, so
  the grid improves only for new uploads. A backfill job could generate them from
  the R2 objects; worth doing before a big event, not urgent.
- **Existing photos still live in Firebase Storage.** Nothing migrates them. Both
  stores are read for the foreseeable future, and the Firebase egress bill
  continues for old events.
- **`storage.rules` can become read-only** once no client writes to Firebase
  Storage. Left permissive for now so a rollback has somewhere to land.
- **Public objects, not signed URLs.** Anyone with a URL can fetch any photo
  forever. Moving to signed expiring URLs needs the gallery, the emails and the
  archive links to change together — a phase of its own.
- **`videoService.ts` still advertises a 1.5 GB limit** while `upload-init`
  enforces 2 GB and the rules allow 2 GB. Harmless, but three numbers that should
  be one constant.
- **UX-1 is untouched.** The free plan is still two photos per event, and the
  third guest at a wedding still gets blocked. That is Phase 4 and it is the
  biggest remaining product problem.
