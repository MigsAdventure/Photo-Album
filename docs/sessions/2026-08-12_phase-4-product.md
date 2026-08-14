# Phase 4 — Making it a product — 2026-08-12

**Phase:** 4 — Make it a product
**Findings addressed:** UX-1, UX-2 (and a further tightening of SEC-2)
**Branch:** `claude/photo-album-audit-be5aap`
**Status:** complete in code; **not deployed**, and requires two Firebase console settings

## Goal

Stop the app punishing the people it depends on, and give the person who pays a
place to stand. Two things: replace the two-photo limit that blocked guests, and
give organizers a real identity and a console.

## What changed

| File | Change | Finding |
|---|---|---|
| `netlify/functions/_lib/plan.js` (new) | Upload-window rules — the authoritative copy | UX-1 |
| `src/services/planService.ts` (new) | Same rules, so the UI can explain before a guest picks a file | UX-1 |
| `tests/plan-parity.test.js` (new) | 29 tests, including client/server agreement over 14 cases | UX-1 |
| `netlify/functions/upload-init.js` | Enforces the window; 403 with a reason, not 402 | UX-1 |
| `src/components/BottomNavbar.tsx` | Closed window states a fact instead of opening a paywall; deadline hint | UX-1 |
| `src/services/authService.ts` (new) | Firebase email-link sign-in | UX-2 |
| `src/components/OrganizerDashboard.tsx` (new) | `/dashboard` — event list, status, links | UX-2 |
| `firestore.rules` | Organizers may list and edit their own events; plan state still server-only | UX-2, SEC-2 |
| `netlify/functions/delete-photo.js` | Second auth path: verified organizer ID token. Also deletes the thumbnail. | UX-2, SEC-7 |
| `src/components/EnhancedPhotoGallery.tsx` | Organizer sees delete on every photo in their event | UX-2 |
| **Deleted** | `upload.js`, `bulk.js`, `media-download.js` and four `test-*` functions | — |

## Why we did it this way

**A window, not a count.** Two photos per *event* meant the third guest at a
wedding was blocked and shown an upgrade modal for an event they neither owned
nor could pay for. Their photos were lost permanently — nobody re-uploads after
being told no. A free event now takes everything until 72 hours after the event
date, then goes view-only. Nothing is deleted or hidden, and downloads keep
working.

That inverts who gets interrupted. A guest sees a fact about the event plus what
they can still do; the organizer, who can actually act, gets the upgrade prompt.
The window is anchored to the event date rather than creation, because planners
set galleries up weeks ahead.

**Magic links rather than passwords.** There is no account to create, nothing to
forget, and the organizer's email is already how we identify them — signing in
proves control of that mailbox, which is exactly the claim `organizerEmail`
encodes. It is also the first real identity this codebase has had, which is what
lets rules grant organizer access directly instead of proxying everything through
a server function.

**The organizer's editable set is an allowlist.** `title`, `date`, `isActive`,
branding, cover. Everything deciding what they have paid for stays Admin-SDK-only,
so an organizer cannot grant themselves premium any more than a guest could. A
denylist would have to be updated every time a field is added; an allowlist fails
closed.

**Emails compare lowercased.** Firebase preserves the case the user typed;
events store whatever was entered at creation. Comparing exactly would strand
people out of their own galleries — a support burden with no security benefit.

## What we learned

**Two copies of a business rule need a test that they agree.** The window logic
exists server-side (authoritative) and client-side (so the UI can explain itself).
Drift here fails quietly: the UI invites an upload the server rejects, or hides
one it would have accepted. `plan-parity.test.js` runs both over the same cases
and compares the decision, the closing time, and the wording. It loads the
TypeScript copy through the actual TypeScript compiler — my first attempt stripped
annotations with regexes and broke immediately, which was the right outcome.

**Build warnings caught two real bugs that types could not.**
`addOwnedPhoto` lost its only caller when uploads moved off `photoService` in
Phase 3, which would have left every guest with a gallery they could not delete
anything from — no error, no type failure, just a missing affordance. And
`PlanLimitError` still matched HTTP 402 with `reason: 'plan_limit'`, a contract
`upload-init` stopped speaking when this phase moved to 403. **Changing a status
code orphans every client branch that matched the old one, and nothing
type-checks that.** Treat an unused-import warning as a question, not noise.

**A test can pass without exercising the rule.** My first "an organizer cannot
inflate their photo count" test wrote the value the document already held. That
changes no keys, so `diff().affectedKeys()` was empty and `hasOnly()` matched
trivially. It passed, and proved nothing. Now it writes a genuinely different
value. Worth checking, for any rule test, that the assertion would fail if the
rule were deleted.

**Two effects, one derived value, is a race.** The gallery computed organizer
status inside the photo-subscription callback, reading `event` — which loads from
a *different* effect. Photos arriving first meant a null event and no recompute,
so organizers would intermittently get no moderation controls depending on which
request won. It only reproduces on a slow connection. Derived state belongs in a
`useEffect`/`useMemo` over its inputs, not captured inside an unrelated callback.

**Verifying is where the work is.** The sweep at the end of this phase found: 8
undocumented environment variables, a thumbnail object nothing was deleting
(recreating the SEC-7 orphan class I had "fixed" two phases earlier), and seven
orphaned production endpoints. It also nearly cost me two live ones — my first
pattern for finding dead functions missed `r2-download` and `download` because
the gallery builds those URLs as template strings. **Prove a thing is dead before
deleting it, with a different query than the one that suggested it was.**

## Deployment steps required

Phases 1–3 first. Then:

1. [ ] **Enable email-link sign-in**: Firebase console → Authentication →
       Sign-in method → Email/Password → enable, then enable the **Email link**
       toggle underneath. Sign-in fails without both.
2. [ ] **Add authorized domains**: Authentication → Settings → Authorized
       domains. Magic links refuse to complete on an unlisted domain, so add
       every domain the app is served from.
3. [ ] Deploy the rules **after** the functions: `npm run deploy:rules`.
4. [ ] Deploy Netlify.
5. [ ] Optional: set `UPLOAD_TOKEN_SECRET` (falls back to
       `INTERNAL_SERVICE_SECRET`) and `REACT_APP_GHL_UPGRADE_WEBHOOK`.

**Existing events keep working.** The window is computed from fields they already
have. Events whose date has passed by more than 72 hours will find uploads closed
on deploy — correct behaviour, but worth knowing if a live event is mid-flight.

## Verification

**Exercised:**

- 114/114 tests across four suites: 14 webhook auth, 17 archive, 29 plan and
  parity, 54 rules and rate limiting. 15 of those are new, covering the organizer
  boundary specifically — listing scope, cross-organizer access, the premium
  escalation attempt, unverified email, and case handling.
- Production build clean, no warnings. `tsc --noEmit` clean. Every function and
  worker module parses.
- Automated sweep for dead references to deleted modules, and for environment
  variables read by code but absent from `ENVIRONMENT.md`.

**Not exercised:**

- **No sign-in has ever run.** Magic-link delivery, the return journey, token
  verification in `delete-photo`, and the organizer's Firestore query are all
  untested against real Firebase.
- The dashboard has not rendered in a browser.
- Whether existing events' `organizerEmail` values match what organizers type at
  sign-in closely enough. Lowercasing handles case; it does not handle a typo or
  a different address. **Expect some support traffic here on first contact with
  real data.**
- Cross-device magic links (the `needs-email` path).

**First test after deploy:** create an event with your own address, sign in at
`/dashboard`, confirm it lists, then open the gallery and delete a photo you did
not upload. That last step exercises the whole new auth chain end to end.

## Still open

- **The agency layer is not built.** The audit's §06 model is
  Agency → Organizer → Event; this phase built the middle. Reselling needs the
  top, and it is a schema change best made before there are paying resellers.
- **UX-4 (direct and multi-select download) was not reached.** Guests still go
  through the email flow for a single photo. Single-photo download does work via
  `r2-download`; the multi-select UI is what is missing.
- **The dashboard is read-mostly.** Rules now permit editing title, date, active
  state and branding, but the UI exposes none of it yet — that is the next
  increment and needs no further rules work.
- **No moderation view.** An organizer can delete from the gallery, but there is
  no dedicated screen for reviewing recent uploads.
- **`storage.rules` still permits creates**, deliberately, so a rollback to the
  Firebase upload path has somewhere to land. Once R2 uploads are confirmed in
  production, change it to `allow create: if false`.
- **Guests still cannot be told their upload window is closing** anywhere except
  the small hint above the navbar.
