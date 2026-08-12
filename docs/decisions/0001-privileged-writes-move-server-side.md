# 0001 — Privileged writes move server-side

**Date:** 2026-08-12
**Status:** accepted
**Related findings:** SEC-2, SEC-5, SEC-7

## Context

The application has no user authentication. Guests open an event URL and upload;
organizers are identified only by an email string on the event document. Every
write went directly from the browser to Firestore with no rules file under
version control.

That made two operations reachable from the developer console: setting
`planType` to `premium` with `photoLimit: -1`, which is the entire paid product;
and deleting any photo document in any event. The deletion path also left bytes
behind in Firebase Storage and R2, because the storage rules denied the client
delete and nothing ever touched R2 — so a "deleted" photo kept costing money and
could not be removed by any UI, which also meant a guest's deletion request
could not actually be honoured.

The constraint that shapes everything here: we cannot add authentication in this
phase. It needs a login surface, an organizer dashboard to log into, and a
migration for existing events — that is Phase 4. So rules cannot key on identity.

## Options considered

**A. Validate the sensitive fields in security rules and keep writing from the
browser.** Cheapest. Rules can assert `planType` never changes on a client
write. But every legitimate server-side write would then also have to satisfy
the rules, meaning either the server holds a client credential or the rules stay
loose enough to permit the operation from anywhere. It also cannot fix deletion,
which spans three stores and needs credentials no browser should hold.

**B. Move privileged writes to Netlify functions using the Admin SDK, and deny
them in rules.** More work: a service account, a shared init module, new
endpoints, and a client refactor. But the rules become a clean statement of what
a browser may do, and the server can do things a browser must never be able to —
delete an R2 object, grant a plan.

**C. Add Firebase Anonymous Auth now and key rules on `request.auth.uid`.**
Gives a real, unforgeable identity per browser without a login screen. Attractive
— but it does not solve the plan-upgrade problem (an anonymous user is still the
one asking for premium), it needs a migration for photos already uploaded under
session ids, and it overlaps heavily with the magic-link work in Phase 4. Doing
it twice is worse than doing it once, properly, later.

## Decision

**Option B.** Plan state and all deletions move to Netlify functions using the
Firebase Admin SDK, and `firestore.rules` denies both to clients.

Ownership stays advisory, but is no longer forgeable from the gallery: the photo
document now stores `sha256(sessionSecret)` rather than the raw session id, so
reading every document — which any guest can do — no longer hands over the
credential needed to delete other people's photos.

`photoCount` is the one exception. Clients may still change it, by exactly one in
either direction. Routing it through a function would add a round trip to every
upload for a counter that is cosmetic, and the rule bounds the damage to what a
caller could achieve anyway by uploading and deleting.

## Consequences

**Easier.** The rules file is now a readable statement of the client's
capabilities, and it is testable — 33 emulator tests assert it. Adding server-only
behaviour later (moderation, retention, organizer overrides) has a place to live.
Deletion is finally correct across all three stores, so the storage bill reflects
reality and a takedown request can be honoured.

**Harder.** There is now a service account credential to protect and rotate, and
a hard dependency on `FIREBASE_SERVICE_ACCOUNT` being set — deletion and upgrades
fail entirely without it. Deleting a photo is a network round trip rather than a
local call, so the UI needs a pending state. And the ownership scheme has two
formats to support until pre-existing photos age out.

**Cost of reversing.** Low for the mechanism, high for the posture. The functions
could be deleted and the rules loosened in an afternoon — but doing so restores
the free-premium path, so in practice this is one-way.

**What it does not do.** This is not authentication. A determined caller can
still create photo documents claiming any ownership hash they like. It restores
the property the old client-side check was pretending to have and makes the
money path unreachable. Superseded in part when Phase 4 introduces magic-link
auth, at which point rules should key on `request.auth.token.email` and the
organizer should gain the ability to delete anything in their own event.
