// GoHighLevel integration — server-side only.
//
// This file used to hold a full GoHighLevel API client that ran in the browser
// and read its key from REACT_APP_GHL_API_KEY (finding GHL-1). Anything prefixed
// REACT_APP_ is compiled into the JavaScript bundle and readable by every
// visitor, so populating that variable would have handed the entire GoHighLevel
// location — contacts, orders, payment links — to anyone who opened devtools.
//
// It also targeted the v1 REST API, which is superseded by the OAuth-based v2
// API where the current endpoints live.
//
// Nothing browser-side remains.
//
// -----------------------------------------------------------------------------
// sendUpgradeToGHL was the last function here, and it is gone.
//
// UpgradeModal called it at the moment the customer clicked "Upgrade", before
// any payment form had been shown, with this payload:
//
//     planType:      'premium'
//     paymentAmount: 29
//     paymentId:     `${eventId}_${Date.now()}`
//
// None of which was true. The plan had not changed, no money had moved, and the
// payment id was manufactured in the browser. Every organizer who opened the
// modal and thought better of it was recorded in the CRM as a completed upgrade,
// so the system of record for who had paid was being written by a button click.
// Any GoHighLevel workflow keyed on that event fired for people who never paid.
//
// The replacement is two honest signals, both server-side:
//
//   checkout-start.js   posts `checkout_started` when a checkout is issued —
//                       useful for abandoned-cart follow-up, and it primes the
//                       workflow with the event data the order form needs
//   ghl-webhook.js      receives GoHighLevel's confirmation of a real payment,
//                       verifies it, and writes the plan state
//
// If you need more GoHighLevel calls — contact creation on upload, lifecycle
// automations, the reseller sync in AUDIT_2026-08.md §06 — add them as Netlify
// functions. Do not reintroduce a browser-side client, and do not add a
// REACT_APP_GHL_* variable.
//
// Refs: AUDIT_2026-08.md GHL-1, GHL-2

export {};
