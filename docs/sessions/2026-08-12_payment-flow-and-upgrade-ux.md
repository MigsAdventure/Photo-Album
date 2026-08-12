# The payment flow, and what the app tells customers about it — 2026-08-12

**Phase:** 5 — product correctness (payments and upgrade UX)
**Findings addressed:** GHL-2 (residue), UX-1 (residue), UX-7 (partial); new: PAY-1…7
**Branch:** `claude/photo-album-audit-be5aap`
**Status:** complete

## Goal

Review how the application takes money and improve the flow, and go through the
upgrade-related UI for clarity. The two turned out to be one job: the payment
surfaces were still describing the *old* pricing model. Phase 4 replaced the
two-photo paywall with a 72-hour upload window in `_lib/plan.js`, but the modal
that sells the upgrade, the chips in the gallery header, and both payment result
pages were never updated. The software charged for one thing and described
another.

## What was wrong

Numbered PAY-n for commit references. All were introduced or left behind by
earlier phases; none are new defects in this session's work.

**PAY-1 · The upgrade modal sold a product that no longer existed.** The headline
read *"Photo limit reached! You've uploaded {n}/2 photos"* and the first feature
bullet promised *"No more 20 photo limit"* — two different dead numbers in one
dialog, neither describing anything the software did.

**PAY-2 · Guests were shown the upgrade CTA.** `EnhancedPhotoGallery` gated the
button on `planType === 'free'` alone, so every guest at a free event saw
"Upgrade". This is exactly finding UX-1 — asking someone to pay for an event they
neither own nor can pay for — surviving in a component the UX-1 fix did not
touch. The component already computed `isOrganizer` for delete permissions; it
just was not used here.

**PAY-3 · The CRM was told the upgrade had completed before any money moved.**
`UpgradeModal.handleUpgrade` posted `planType: 'premium'`, `paymentAmount: 29`,
`paymentId: ${eventId}_${Date.now()}` at the moment of the click, then redirected.
Every organizer who opened the modal and thought better of it was recorded as a
completed upgrade with a fabricated payment id. The system of record for who had
paid was being written by a button press.

**PAY-4 · The price and the payment URL lived in the browser.** `amount=29` went
into the checkout query string from client code, and the destination was a
hardcoded `socialboostai.com` string.

**PAY-5 · Event↔payment correlation depended on `localStorage`.** Written just
before the redirect, read on return. That breaks in the most likely usage of this
product: scan the QR on a phone, pay on a laptop.

**PAY-6 · The post-payment page showed debug output to paying customers.** When
PAY-5 failed, the customer saw:

```
Event ID not found. Debug info:
- URL event_id: null
- localStorage data: Not found
```

**PAY-7 · The page announced success before the upgrade existed.** Returning from
the order form means the customer finished the form; the plan is written when
GoHighLevel calls `ghl-webhook`. Those are independent races and the redirect
usually wins, so a customer could read "your unlimited gallery is now active",
return to the gallery, and find uploads still closed.

Two more found while working:

- `ghl-webhook`'s `reset_to_free` wrote `photoLimit: 2`, re-creating the removed
  paywall field on any reset event.
- `BottomNavbar` mounted an `UpgradeModal` that could never open —
  `setShowUpgradeModal(true)` is never called anywhere, local state, so it was
  unreachable. Left behind when the UX-1 fix removed the trigger.

## What changed

| File | Change | Finding |
|---|---|---|
| `_lib/organizer-auth.js` | New. `verifyOrganizer` extracted from `delete-photo.js` so checkout can reuse it | PAY-2 |
| `_lib/pricing.js` | New. Server owns the price and the checkout URL | PAY-4 |
| `_lib/checkout-ref.js` | New. Signed, expiring reference identifying an event across the payment round trip | PAY-5 |
| `checkout-start.js` | New. Organizer-authenticated; issues the checkout URL, notifies the CRM of a *started* checkout | PAY-2, PAY-3, PAY-4 |
| `checkout-status.js` | New. Answers "has the upgrade landed?" for a signed ref | PAY-7 |
| `UpgradeModal.tsx` | Rewritten. Window-model copy, real closing date, server-supplied price | PAY-1, PAY-3 |
| `EnhancedPhotoGallery.tsx` | CTA gated to organizers; deadline chip replaces "Free Trial"; closed-uploads message is audience-aware | PAY-2 |
| `PaymentSuccess.tsx` | Rewritten. Polls until the plan flips; no debug output | PAY-6, PAY-7 |
| `PaymentCancelled.tsx` | Copy corrected to the window model | PAY-1 |
| `BottomNavbar.tsx` | Unreachable modal removed | — |
| `ghlService.ts` | Browser CRM client fully retired | PAY-3 |
| `ghl-webhook.js` | `reset_to_free` no longer writes `photoLimit` | — |
| `photoService.ts`, `App.tsx` | Stop writing the dead `photoLimit: 2` | PAY-1 |
| `tests/checkout.test.js` | New, 15 tests | PAY-4, PAY-5 |

## Why we did it this way

**The signed ref, rather than just putting the event id in the return URL.** The
success page reads plan state, and event ids are semi-guessable by construction
(`YYYY-MM-DD_title-slug_8char`). A bare id in the URL would make that endpoint an
enumeration oracle for every event's plan and title. The ref is an HMAC over
`{eventId, issuedAt}` with a 24-hour TTL — long enough that someone who pays,
closes the tab and follows their receipt link an hour later still lands
somewhere useful; short enough that a leaked URL is not a permanent read handle.
It is explicitly **not** proof of payment and grants nothing; only `ghl-webhook`
upgrades an event.

**The CRM notification was kept, not deleted.** The browser call had a real
purpose buried under the false claim: it primed the GoHighLevel workflow with the
event data the order form needs to send back. So it moved server-side and now
says `checkout_started`, which is true, is genuinely useful (abandoned-cart
follow-up is what GoHighLevel is good at), and is not a claim about money.

**Polling rather than trusting the redirect.** The alternative — have the order
form's redirect carry a "paid" flag — puts the client back in the trust path for
granting premium, which is the shape of GHL-2. Polling costs a handful of
requests and cannot be forged.

**`upload-init`-style parity was not added between the price here and the order
form's price.** They are two systems and nothing can keep them in step
automatically. `pricing.js` documents them as a pair that must be changed
together. Worth revisiting if the price ever changes often.

## What we learned

**A pricing model change is not done when the enforcement changes.** Phase 4
correctly replaced the two-photo limit in `plan.js` and fixed the upload path,
and the work looked complete — uploads behaved correctly. But the *description*
of the model lived in four other places, and all four kept describing the old one.
The enforcement and the explanation drifted apart silently, because nothing fails
when a modal lies.

**Grep for the dead concept, not the dead code path.** `photoLimit` had already
been removed from every decision, so a reader checking "does anything still
enforce a photo limit?" would correctly answer no. Searching for the *field*
found five surfaces still reading it, one of which rendered it to customers as
"a limit of 2 photos". Removing a rule means removing what it says about itself.

**The upgrade button was gated on the wrong noun.** `planType === 'free'` is a
fact about the event; who may pay is a fact about the *viewer*. Those were the
same thing under the old model, where anyone blocked was being asked to pay, and
came apart the moment UX-1 said only organizers get sold to. Worth checking any
other CTA gated on event state rather than viewer identity.

**Two components had the same paywall bug and only one was fixed.** `BottomNavbar`
was corrected during phase 4; `EnhancedPhotoGallery` was not, and nothing linked
the two. The dead modal in `BottomNavbar` is the fingerprint of a fix applied in
one place.

## Deployment steps required

- [ ] Set **`CHECKOUT_URL`** to the GoHighLevel order form URL. Without it the
      upgrade button reports upgrades unavailable — correct behaviour, but nobody
      can pay.
- [ ] Set **`CHECKOUT_REF_SECRET`** (`openssl rand -hex 32`), or rely on the
      `INTERNAL_SERVICE_SECRET` fallback.
- [ ] Optionally set `UPGRADE_PRICE_CENTS`. **It must match the order form.**
- [ ] Optionally set `GHL_CHECKOUT_WEBHOOK_URL` for abandoned-checkout follow-up.
- [ ] Configure the order form to accept `ref`, `event_id`, `event_title`,
      `organizer_email` and to send `ref`/`event_id` back on the payment webhook.
- [ ] Remove `REACT_APP_GHL_UPGRADE_WEBHOOK` — now unused.
- [ ] Point the order form's return URL at `/payment-success?ref=...`. Links
      without a ref still work via the legacy `event_id` path.

## Verification

`npm run test:all` → **151 passing** across six suites, up from 136. Build clean,
`tsc --noEmit` clean.

The 15 new tests concentrate on the negative cases for the signed ref — swapped
event id, tampered signature, foreign secret, expired, future-dated, malformed,
and unconfigured-secret-fails-closed — because those are the properties that stop
the status endpoint becoming an enumeration oracle.

**Not exercised.** No GoHighLevel account, no order form, and no Firebase
credentials exist in this environment:

- **No checkout has ever been issued or completed.** The whole round trip is
  reasoned from the code.
- `verifyOrganizer` is unchanged logic in a new file, but nothing has verified a
  real Firebase ID token here.
- The `checkout_started` CRM notification has never reached GoHighLevel.
- The polling loop's timings (2s × 15) are a guess at how long the webhook takes.
  Watch the first few real upgrades and adjust if customers routinely reach the
  "finishing up" state.
- **The order form must be configured to pass `ref` back.** If it is not, the
  upgrade still works — `ghl-webhook` reads `event_id` — but the success page
  will poll, time out, and show "finishing up" to a customer whose upgrade
  actually landed.

## Still open

- **Pricing shape is unchanged.** The audit's §06 recommendation is a per-event
  tier at $39–79 plus an agency subscription at $99–249/month, with the agency
  tier as the actual business. This session made the existing single $29 charge
  correct and configurable; it did not change the model, which is a commercial
  decision.
- **No upgrade path in the organizer dashboard.** The CTA is in the gallery
  header. A planner managing six events has no per-event upgrade control in the
  place they would look for it.
- **`describeTimeRemaining` does not re-render on its own.** The deadline chip is
  computed at render, so a gallery left open overnight shows a stale "2 days
  left" until something else re-renders. Cosmetic, but it will look wrong to
  someone watching the last hour tick down.
- **UX-7 is only partly addressed.** The `alert()` calls in `App.tsx`, the
  DOM-injected success toast, dark mode, i18n and the accessibility pass are all
  untouched.
- **No abandoned-checkout follow-up exists yet** — `checkout_started` is emitted
  but nothing consumes it. That is a GoHighLevel workflow, not code.
