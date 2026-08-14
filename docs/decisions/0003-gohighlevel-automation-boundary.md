# 0003 — How far to automate GoHighLevel, and by which door

**Date:** 2026-08-12
**Status:** accepted
**Related findings:** GHL-1, GHL-2, AUDIT_2026-08.md §01, §06

## Context

GoHighLevel is the CRM and the payment rail. Two questions came up together:

1. Could Claude Code drive GoHighLevel directly — building workflows, forms and
   landing pages from the editor, as demonstrated in a widely shared video?
2. Should we, given that the thing we most want to change right now *is* a
   GoHighLevel workflow (the one granting premium without payment — see step 0
   of `HANDOFF.md`)?

What was verified, rather than assumed:

- **HighLevel ships an official MCP server** at
  `https://services.leadconnectorhq.com/mcp/`, free on any plan, authenticated
  with a Private Integration Token plus a Location ID. Roughly 36 tools.
- **Its coverage is contacts, conversations, opportunities, calendars, payments,
  blogs, email templates and social posting.** Workflows, forms and funnels are
  absent.
- **That is an API limitation, not an MCP one.** Workflows cannot be created,
  updated, cloned or deleted through the public API at all; every workflow must
  be built in the UI. Full workflow CRUD is a long-standing, unshipped request on
  HighLevel's own ideas board.
- **There is no GoHighLevel connector in Anthropic's directory.** Adding the
  official server would mean configuring it as a custom connector by URL.
- **Cloud sessions cannot reach it regardless.** `app.gohighlevel.com`,
  `backend.leadconnectorhq.com` and `services.leadconnectorhq.com` all fail the
  egress proxy with a 403 on CONNECT. Local Claude Code is unaffected.

The video's method, once examined, works around the API gap: a browser extension
captures the Firebase session token from a logged-in GoHighLevel tab, and a
script replays it against the same internal endpoints the dashboard itself calls.
That genuinely does unlock workflow creation, because it is not using the public
API at all.

## Options considered

**A. Official MCP / v2 API with a scoped Private Integration Token.** Supported,
versioned, and scoped to exactly the permissions granted at token creation.
Covers contacts and conversations, which is what the §06 lead-capture idea needs.
Does not cover workflows, forms or funnels, and never will until HighLevel ships
the endpoints.

**B. Internal endpoints via a captured Firebase session token.** Unlocks
everything the dashboard can do, including workflow creation. Costs:

- The token is a **full-account bearer credential**, not a scoped one — it
  carries whatever the signed-in user can do. It is also short-lived (~1 hour),
  so it needs constant re-capture.
- It requires trusting a third-party browser extension whose function is to read
  auth tokens out of a logged-in session. That is, mechanically, what a
  credential harvester does; whether it is benign depends entirely on the author.
- Internal endpoints carry no versioning contract and change without notice.
- It near-certainly violates GoHighLevel's terms, and the account at risk is the
  one the business runs on.

**C. Neither — keep GoHighLevel manual.** No new credentials, no new failure
modes, no automation.

## Decision

**A for anything durable; C for the workflow problem in front of us; B only as
disposable tooling, and not yet.**

Concretely:

- Lead capture (§06 — a guest who uploads becomes a tagged contact in the
  organizer's location) is built against the **official API with a scoped PIT**.
  It is the piece with real business value and it is fully supported.
- The premium-without-payment workflow is fixed **by hand in the GoHighLevel
  UI**. It is a five-minute change; no automation makes it smaller, and option B
  could not edit it any faster.
- Option B is not adopted now. If it is ever used, it should be for genuinely
  one-off bulk work — building forty workflows for a new client — treated as
  throwaway tooling rather than infrastructure.

## Consequences

**Makes easy:** the contact-sync integration can be built and tested against a
stable, documented API, with a token scoped to just the permissions it needs.

**Makes hard:** anything involving workflows, forms or funnels stays manual.
There is no programmatic path to them we are willing to depend on, so a customer
onboarding flow that provisions workflows automatically is out of reach until
HighLevel ships the endpoints.

**Sequencing note that drove the timing:** at the point this was decided, two
live R2 credential pairs and an SSH private key were still valid and still in git
history, unrotated (SEC-9, SEC-1). Introducing a broad, constantly-refreshed
session credential on top of an unresolved credential-exposure problem is the
wrong order. If option B is revisited, do it after the rotation is complete, keep
the token in an environment variable that never touches the repository, and check
whether GoHighLevel permits a limited-permission user to capture it from rather
than the owner account.

**Cost of reversing:** low. Option A and option B are not exclusive, and nothing
built against the official API would need to change if the internal route were
added later for a specific task.
