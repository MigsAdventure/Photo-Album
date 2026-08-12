# Phase 2 — One download pipeline — 2026-08-12

**Phase:** 2 — One pipeline
**Findings addressed:** ZIP-1, ZIP-2, ZIP-3, ZIP-4, ZIP-5, ZIP-6, ZIP-7, ZIP-8
**Branch:** `claude/photo-album-audit-be5aap`
**Status:** complete in code; **not deployed, and not yet exercised end to end**

## Goal

Fix the actual cause of the large-video archive failures, then delete the three
redundant routing tiers that grew around it. This phase is mostly deletion.

Ordered deliberately: the root-cause fix (ZIP-3) landed first as a small,
self-contained change, so that even if nothing else got done the most valuable
thing was in. The structural collapse came last, since it is the widest change
and the easiest to review as a separate diff.

## What changed

| File | Change | Finding |
|---|---|---|
| `aws-ec2-spot/archive-entries.js` (new) | Sequential append-and-drain, name sanitising, dedupe, per-file retry | ZIP-3, ZIP-7 |
| `tests/archive-entries.test.js` (new) | 17 tests, including the concurrency regression test | ZIP-3 |
| `aws-ec2-spot/wedding-photo-processor-streaming-fixed.js` | Sequential loop, visibility heartbeat, job ceiling, unique keys, drain-before-terminate | ZIP-3, ZIP-5, ZIP-6, ZIP-8 |
| `netlify/functions/email-download.js` | ~900 lines → ~280. Thin entry point; no longer archives anything | ZIP-1, ZIP-2, ZIP-4 |
| `netlify/functions/_lib/emails.js` (new) | One template replacing four drifted copies | ZIP-7 |
| `src/services/photoService.ts` | Client-side routing and the Cloud Run call removed; `downloadAllPhotos` deleted | ZIP-1 |

## Why we did it this way

**The failure was a queueing bug, not a size bug.** This is the thing worth
remembering. The old loop fetched each file and called `archive.append()` on its
live HTTP response without waiting; `archiver` drains entries strictly in order,
one at a time. With 30 files that meant 30 open connections and 29 idle. Google
Cloud Storage closes idle connections, so a 400 MB video sitting 25th in the
queue could wait minutes before archiver reached it, by which point its socket
was dead.

It degraded in proportion to file size and count, which is precisely why it
presented as "big videos break" and why seven months of work went into the
symptom — buffering strategies, instance sizes, streaming rewrites — rather than
the queue.

**Every collection now takes the same path.** The tiering existed to protect
against limits that only two of the four tiers actually had. Small collections
now wait for an EC2 instance (~60–90s cold) rather than being zipped inline in
Netlify. That is a real regression in latency and worth stating plainly — but
delivery is by email either way, so nobody is watching a progress bar, and it
buys the removal of an entire class of failure. If the wait becomes a product
problem, the answer is a warm worker, not a second code path.

**Archives are reused for 30 minutes.** Not in the original plan. It became
obvious once every collection routed to EC2: guests routinely request a download
two or three times in a row, and each was a full instance-start and re-archive
over identical bytes. Safe now only because keys are unique per job (ZIP-6) — with
the old fixed key, handing out a URL that a later job would overwrite was exactly
the corruption bug.

**Compression dropped from level 6 to level 1.** Wedding archives are JPEG and
H.264, both already compressed, so deflate was spending CPU for a percent or two.
That was hidden while downloads ran in parallel; with a sequential loop on a
2-vCPU t3.medium it becomes the bottleneck.

## What we learned

**Write the test so it fails against the old code, then check that it does.**
The concurrency assertion (`peak === 1`) is the whole fix expressed as a test. I
reimplemented the old loop against the same harness to confirm it peaks at 8 —
without that check I would have had a test that passed and proved nothing. Ten
minutes well spent, and worth doing for any regression test of a bug this
expensive.

**The tests caught me over-engineering a sanitiser.** My first `safeEntryName`
used an allowlist of `[\w.\- ]`, which turned `IMG 0001 (1).jpg` into
`IMG 0001 _1_.jpg`. A test asserting ordinary filenames survive intact failed,
and the implementation changed rather than the expectation. Allowlists feel safer
and are frequently the wrong tool when the input is a human-facing name — deny
what actually breaks (path separators, control characters, the Windows-illegal
set) and leave the rest alone.

**Duplicate filenames were silently losing photos.** Twenty guests each upload
`IMG_0001.jpg`. Duplicate ZIP entries are legal, and most extractors either
overwrite silently or prompt — so photos were disappearing at extraction time
with nothing in our logs and no way to know. Found while making entry names
unique for the drain matcher, not by looking for it. Worth a thought about how
many other silent-loss paths exist between our storage and the customer's disk.

**A `Math.max` can hide an absent timeout.** `Math.max(600000, totalSize / 100)`
reads like a floor of ten minutes. For a 5 GB collection the second term is 14
hours, so in the case that mattered there was effectively no timeout — while SQS
re-delivered at 15 minutes. Two plausible-looking numbers in different files
combining into duplicate emails is not something either file review would catch;
it needed the units written out.

**Deleting is most of the work, and reviewing deletion is harder than reviewing
addition.** `email-download.js` went from ~900 lines to ~280. The risk in this
phase is not that the new code is wrong; it is that some deleted branch was load-
bearing in a way nobody documented. That is the main thing to watch after
deploying.

## Deployment steps required

**Phase 1's steps must be done first** — the pipeline now depends on
`LAUNCHER_SHARED_SECRET` and `INTERNAL_SERVICE_SECRET` existing.

Then, and order matters here:

1. [ ] **Deploy the Lambda first.** The new `email-download` posts to it and
       nothing else can archive. Deploying Netlify first breaks all downloads.
2. [ ] Set `AWS_LAMBDA_URL` in the Netlify environment — Netlify calls the
       launcher directly now, where it used to call the Cloudflare Worker.
3. [ ] Update the EC2 launch path so instances run the current processor.
4. [ ] Deploy Netlify (functions and frontend together — the frontend's request
       shape changed).
5. [ ] **Add an R2 lifecycle rule** expiring the `archives/` prefix after 30 days.
       Without it, archives accumulate forever under the new key scheme. The old
       fixed key was self-limiting by overwriting, which was the bug, but it did
       mean storage never grew.
6. [ ] **Add an SQS dead-letter queue** with `maxReceiveCount: 2`. A poison
       message will otherwise retry until the retention period expires.
7. [ ] Optional: `CLOUDFLARE_WORKER_URL` can be removed from Netlify, and the
       Worker undeployed. Nothing routes to it.

## Verification

**Exercised:**

- 17 archive tests against a local HTTP server that tracks connection
  concurrency and streams slowly enough that overlap would be visible. New code
  peaks at 1 concurrent connection; the old loop, reproduced against the same
  harness, peaks at 8. Also covers name sanitising, traversal, dedupe, retry on
  5xx, fail-fast on 404, and one bad file not stopping the collection.
- Full suite: 74/74 (14 webhook auth, 17 archive, 43 emulator).
- `tsc --noEmit` clean; every changed module parses.

**Not exercised — this is the important list:**

- **Nothing has run end to end.** No AWS, R2 or Firebase credentials here. The
  pieces are individually tested and the seams between them are not.
- The SQS visibility heartbeat against real SQS. The logic is simple; the failure
  mode (duplicate emails) is what we are trying to fix, so **watch for duplicates
  on the first few real jobs.**
- `queueIsEmpty` and drain-before-terminate against a live queue.
- Multipart upload of a genuinely large archive to R2.
- The processor's callback into the new `email-download` branch.
- Archive reuse across two real requests.

**First real test after deploy should be a collection with at least one 200 MB+
video and at least 20 files** — that is the shape that failed before, and small
test collections would have passed even with the old bug.

## Still open

- **`direct-email.js` is now unused** — the processor calls `email-download`
  instead. Left in place for one deploy cycle so a rollback has somewhere to
  land; delete it once the new path is confirmed.
- **The Cloudflare Worker is out of the path but still deployed.** Its
  `wedding-zip-processor.js` and `queue-processor.js` are now dead code.
  Removing the directory is a Phase 5 cleanup.
- **No dead-letter queue yet** — a deployment step, not a code change, but
  nothing retries sensibly without it.
- **`downloadJobs` still has no cleanup job.** Carried over from Phase 1, and it
  now holds archive records as well as rate-limit counters.
- **The processor still trusts the photo list it receives from the launcher.**
  `email-download` reads it from Firestore, so the path is sound today, but the
  Lambda would forward anything a valid-secret caller sent. Reading the
  collection in the processor would close that; not urgent while the launcher is
  authenticated.
- **ZIP-10 (r2-copy buffers whole files) is untouched** and belongs to Phase 3.
  Large videos still never reach R2, which means the archive job pulls them from
  Firebase — the sequential loop handles that correctly now, but it is slower and
  costs egress.
