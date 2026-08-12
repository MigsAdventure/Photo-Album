# 0002 — Shared secrets for service-to-service calls

**Date:** 2026-08-12
**Status:** accepted
**Related findings:** SEC-3, SEC-8, GHL-2

## Context

Four services call each other over the public internet: the Cloudflare Worker
calls the launcher Lambda; the Lambda queues to SQS; the EC2 processor calls back
to a Netlify function to send email; GoHighLevel calls a Netlify webhook.

None of those calls were authenticated. Three concrete consequences:

- The launcher's Function URL is `AuthType NONE` and its address is committed in
  `wrangler.toml` and three test scripts. Anyone could queue jobs and start EC2
  instances on our account — a denial-of-wallet endpoint.
- `direct-email` accepted a recipient address and a download link from an
  unauthenticated body and rendered the link into a SharedMoments-branded
  message sent from our authenticated Mailgun domain. A working phishing relay,
  and a fast way to lose the sending domain's reputation.
- The GoHighLevel webhook granted premium to anyone who posted the right JSON.

## Options considered

**A. IAM everywhere.** Switch the Function URL to `AuthType AWS_IAM` and sign
from the Worker with SigV4; put the Netlify endpoints behind a signed identity
token. Strongest: no standing shared credential, and AWS handles rotation. But
it needs a SigV4 implementation in the Worker, IAM role changes, and it does not
apply to GoHighLevel at all, which can only send static headers from its
workflow builder. Not shippable in this phase.

**B. HMAC signatures with a timestamp.** Each caller signs the request body plus
a timestamp; the receiver recomputes. Replay-resistant within a short window, and
the secret never crosses the wire. But it requires the caller to compute a
signature — which the EC2 processor and the Worker can do, and a GoHighLevel
workflow cannot.

**C. A static shared secret in a header.** Every caller can do it, including
GoHighLevel. Weaker: the secret crosses the wire on every request, so anyone who
observes one request can replay it indefinitely.

## Decision

**B where the caller can sign, C where it cannot, and never neither.**

- `ghl-webhook` accepts **either** an HMAC signature over `<timestamp>.<body>`
  **or** a static secret header, so GoHighLevel workflows work today and a
  future signing proxy is a config change rather than a rewrite.
- `direct-email` and the worker branch of `email-download` take the static
  `INTERNAL_SERVICE_SECRET`, since their callers are our own backend.
- The launcher takes `LAUNCHER_SHARED_SECRET` from the Worker.

Three properties apply everywhere:

**Fail closed.** An unset secret rejects every request. "Unset means allow" is
the precise shape of the bug being fixed, and it is the state a fresh deploy
starts in.

**Constant-time comparison.** Every check uses `timingSafeEqual`.

**Defence behind the secret.** A static secret is replayable, so authentication
alone is not enough. Any link we put in an email must be on the R2 host, so even
a replayed or compromised caller cannot point a customer at an arbitrary URL.
And the webhook can independently confirm the payment with GoHighLevel before
granting premium — enabled by setting `GHL_API_TOKEN`, and the reason a static
secret is tolerable there at all.

## Consequences

**Easier.** Every service-to-service call is authenticated today, with no IAM
changes and no new infrastructure. The pattern is one small shared module, so
adding an endpoint means one function call.

**Harder.** Four secrets now have to be set consistently across Netlify, the
Lambda, the Worker and GoHighLevel — a mismatch silently breaks download emails,
which is exactly the class of failure that is hard to notice. `ENVIRONMENT.md`
lists every location for this reason, and the deployment checklist calls out that
two of them must hold identical values.

There is also a real ceiling here: a static secret sitting in an EC2 instance's
systemd unit is readable by anything on that instance, and instance metadata is
visible to anyone with `DescribeInstances`. This raises the bar from "no bar" to
"needs a foothold"; it does not eliminate the credential.

**Cost of reversing.** Low. Migrating the launcher to IAM later means deleting
the check and adding SigV4 signing in the Worker — the secret becomes dead code
rather than something to unwind. That migration is the recommended follow-on and
should happen before the reseller launch, when more people have access to more
of these environments.
