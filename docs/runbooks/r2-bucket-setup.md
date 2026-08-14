# Runbook — R2 bucket configuration

Phase 3 moved uploads directly from the browser to R2. That makes the bucket's
own CORS and lifecycle configuration load-bearing — **uploads will fail until
this is applied.** None of it is in the repository because none of it is code.

Apply with `wrangler` or in the Cloudflare dashboard under R2 → your bucket →
Settings.

---

## 1. CORS — required, uploads fail without it

The browser now issues `PUT` requests directly to R2. Two things matter here and
the second one is easy to miss.

```json
[
  {
    "AllowedOrigins": [
      "https://sharedmoments.socialboostai.com",
      "http://localhost:3000"
    ],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["content-type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

**`ExposeHeaders` must include `ETag`.** Completing a multipart upload requires
sending back the ETag of every part, and a browser cannot read a response header
that CORS has not explicitly exposed. Without it, single-PUT uploads (under
64 MB) work fine and multipart uploads fail at the final step — so this presents
as "large videos are broken" while photos are fine, which is a misleading
symptom to debug. `src/services/r2UploadService.ts` raises an explicit error
naming this file when the ETag comes back null, rather than failing obscurely.

Keep `AllowedOrigins` to the real origins. `*` would let any site use a leaked
presigned URL from a victim's browser.

Apply it:

```bash
wrangler r2 bucket cors put sharedmoments-photos-production --file cors.json
```

## 2. Lifecycle rules

Two prefixes need rules, for different reasons.

**`archives/` — expire after 30 days.** Generated ZIPs are regenerable and can
be large. Under the old fixed-key scheme (finding ZIP-6) each event had exactly
one archive that got overwritten, so storage never grew — that overwrite was the
corruption bug, and fixing it means archives now accumulate. The email tells
customers the link lasts 30 days; this is what makes that true.

**Incomplete multipart uploads — abort after 1 day.** R2 bills for uploaded parts
until an upload is completed or aborted. A guest who closes their phone mid-video
leaves parts behind forever. `upload-complete.js` aborts on a failure it sees,
but it never hears about a browser that simply went away.

```bash
wrangler r2 bucket lifecycle add sharedmoments-photos-production \
  --name expire-archives --prefix archives/ --expire-days 30

wrangler r2 bucket lifecycle add sharedmoments-photos-production \
  --name abort-incomplete-uploads --abort-multipart-days 1
```

Do **not** put a lifecycle rule on `media/`. That is the customers' photos.

## 3. Public access

`media/` and `archives/` are served publicly through the custom domain in
`R2_PUBLIC_URL`. Confirm the domain is connected under R2 → Settings → Public
access, and that it matches `R2_PUBLIC_URL` exactly — `netlify/functions/_lib/internal-auth.js`
uses that value as the allowlist for links in outgoing email, so a mismatch
silently blocks every download email (finding SEC-8).

Signed, expiring URLs instead of public objects would be better and are the right
follow-on. It needs the gallery, the email templates and the archive links to all
move together, so it is deliberately not in this phase.

## 4. Verifying

After applying, from the deployed site:

1. Upload a photo — exercises single PUT, thumbnail generation, `upload-complete`.
2. **Upload a video over 64 MB** — this is the one that exercises multipart and
   the ETag exposure. A small video will pass even with CORS misconfigured.
3. Check the object appears under `media/{eventId}/` and its thumbnail alongside.
4. Request a download and confirm the archive lands under `archives/{eventId}/`.

If step 2 fails and step 1 passes, it is almost always `ExposeHeaders`.
