# Environment variables

Every configuration value the system reads, where it must be set, and what
breaks without it.

Phase 1 introduced several new secrets. **The application will not work until
they are set** — the new checks fail closed on purpose, because an unset secret
meaning "accept everything" is the exact shape of the bugs being fixed here.

## New in Phase 1 — set these before deploying

| Variable | Where | Generate with | Without it |
|---|---|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | Netlify (Functions) | Firebase console → Project settings → Service accounts → Generate new private key. Paste the JSON, or its base64. | Photo deletion and premium upgrades return 500 |
| `GHL_WEBHOOK_SECRET` | Netlify + GoHighLevel workflow header | `openssl rand -hex 32` | Every upgrade webhook is rejected with 401 |
| `INTERNAL_SERVICE_SECRET` | Netlify + Lambda + Cloudflare Worker | `openssl rand -hex 32` | No download emails are sent — every callback is rejected |
| `LAUNCHER_SHARED_SECRET` | Lambda + Cloudflare Worker | `openssl rand -hex 32` | Large collections never start processing |

The last two must hold **the same value** in every place listed, or the services
cannot talk to each other.

### Setting them

**Netlify** — Site configuration → Environment variables, scoped to Functions.

**Cloudflare Worker** — as secrets, never in `wrangler.toml` (it is committed):

```bash
cd cloudflare-worker
wrangler secret put INTERNAL_SERVICE_SECRET
wrangler secret put LAUNCHER_SHARED_SECRET
```

**Launcher Lambda** — Lambda console → Configuration → Environment variables.
It now injects the R2 configuration into each instance at launch, so this is the
only place the processor's copy comes from.

**GoHighLevel** — on the workflow's Webhook action, add a Custom Header:

```
x-sharedmoments-secret: <value of GHL_WEBHOOK_SECRET>
```

## Frontend (build time)

Anything prefixed `REACT_APP_` is **compiled into the JavaScript bundle and
readable by every visitor**. Only public values belong here.

| Variable | Notes |
|---|---|
| `REACT_APP_FIREBASE_API_KEY` | Public by design. Firebase API keys identify the project; they are not credentials. Security comes from the rules. |
| `REACT_APP_FIREBASE_AUTH_DOMAIN` | |
| `REACT_APP_FIREBASE_PROJECT_ID` | |
| `REACT_APP_FIREBASE_STORAGE_BUCKET` | |
| `REACT_APP_FIREBASE_MESSAGING_SENDER_ID` | |
| `REACT_APP_FIREBASE_APP_ID` | |
| `REACT_APP_R2_PUBLIC_DOMAIN` | Public R2 hostname used to build display URLs |
| `REACT_APP_FIREBASE_MEASUREMENT_ID` | Analytics id; optional |
| ~~`REACT_APP_GHL_UPGRADE_WEBHOOK`~~ | **No longer used.** The browser posted a *completed upgrade* to this before the customer had seen a payment form, so every abandoned checkout was recorded as a sale. Replaced by server-side `GHL_CHECKOUT_WEBHOOK_URL`. Safe to delete. |
| ~~`REACT_APP_GHL_API_KEY`~~ | **Remove this.** A GoHighLevel API key in the bundle exposes the whole location to every visitor (finding GHL-1). If it was ever deployed, rotate it. |

## Netlify Functions (server-side)

| Variable | Purpose |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | Admin SDK credential for all privileged writes |
| `INTERNAL_SERVICE_SECRET` | Authenticates the EC2 processor and Worker calling back |
| `GHL_WEBHOOK_SECRET` | Authenticates the GoHighLevel upgrade webhook |
| `GHL_API_TOKEN` | Optional but recommended. Confirms the payment with GoHighLevel before granting premium, which is what makes a static shared secret tolerable against replay. |
| `GHL_WEBHOOK_ALLOW_RESET` | Set to `true` only in a test environment. Enables the action that downgrades a paying customer. |
| `CHECKOUT_URL` | **Required for upgrades.** The GoHighLevel order form URL. Without it `checkout-start` returns 503 and the upgrade button reports that upgrades are unavailable — which is the correct failure, but no one can pay. |
| `CHECKOUT_REF_SECRET` | Signs the reference that identifies an event on the return from checkout. Falls back to `INTERNAL_SERVICE_SECRET`. `openssl rand -hex 32`. Without either, the post-payment page cannot confirm an upgrade. |
| `UPGRADE_PRICE_CENTS` | Optional, default `2900`. What the customer is *shown*. The order form is what actually charges — change both together or they will disagree. |
| `UPGRADE_CURRENCY` | Optional, default `USD` |
| `PUBLIC_SITE_URL` | Optional; Netlify's own `URL` is used if unset. Builds the return link carried into checkout. |
| `GHL_CHECKOUT_WEBHOOK_URL` | Optional. Receives a `checkout_started` event when an organizer opens checkout — useful for abandoned-cart follow-up, and it primes the workflow with the event data the order form sends back. Carries no authority. |
| `R2_ACCOUNT_ID` | |
| `R2_ACCESS_KEY_ID` | Rotate — see `runbooks/credential-rotation.md` |
| `R2_SECRET_ACCESS_KEY` | Rotate — see `runbooks/credential-rotation.md` |
| `R2_BUCKET_NAME` | |
| `R2_PUBLIC_URL` | Also the allowlist for links in outgoing email |
| `EMAIL_USER` | Mailgun SMTP user |
| `EMAIL_PASSWORD` | Mailgun SMTP password. Rotate — it was reachable from the leaked instances. |
| `CLOUDFLARE_WORKER_URL` | Where large collections are routed |
| `UPLOAD_TOKEN_SECRET` | Signs the upload token that `upload-complete` verifies. Falls back to `INTERNAL_SERVICE_SECRET` if unset — acceptable, but a separate value is better. |
| `DOWNLOAD_URL_ALLOWED_HOST` | Optional extra host allowed in emailed download links, alongside `R2_PUBLIC_URL` |
| `ARCHIVE_REUSE_WINDOW_MS` | Optional, default `1800000` (30 min). How long a completed archive is reused rather than rebuilt. |
| `EMAIL_HOST` | Optional, default `smtp.mailgun.org` |
| `EMAIL_PORT` | Optional, default `587` |
| `DOWNLOAD_LIMIT_PER_EVENT` | Optional, default `5` per hour |
| `DOWNLOAD_LIMIT_PER_EMAIL` | Optional, default `10` per hour |
| `DOWNLOAD_LIMIT_WINDOW_MS` | Optional, default `3600000` |

## Launcher Lambda

| Variable | Purpose |
|---|---|
| `LAUNCHER_SHARED_SECRET` | Rejects unauthenticated callers to the public Function URL |
| `INTERNAL_SERVICE_SECRET` | Passed through to the processor so it can send email |
| `MAX_CONCURRENT_INSTANCES` | Optional, default `2`. Ceiling on simultaneous processors. |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL` | Injected into each instance's systemd unit at launch. Previously hardcoded in the repository (finding SEC-9). |
| `AWS_SQS_QUEUE_URL` | |
| `NETLIFY_EMAIL_ENDPOINT` | |

The launcher **throws** on any missing value rather than defaulting. That is
deliberate: baking an empty credential into an instance produces a processor
that starts, polls the queue, and fails every job with an opaque auth error —
far harder to diagnose than a launch that refuses outright.

## Cloudflare Worker

| Variable | How |
|---|---|
| `AWS_LAMBDA_URL` | `wrangler.toml` (not a secret) |
| `LAUNCHER_SHARED_SECRET` | `wrangler secret put` |
| `INTERNAL_SERVICE_SECRET` | `wrangler secret put` |
| `NETLIFY_EMAIL_FUNCTION_URL` | `wrangler.toml` |

## EC2 processor

Set by the launcher into the systemd unit — do not configure by hand.

`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`,
`R2_PUBLIC_URL`, `AWS_SQS_QUEUE_URL`, `AWS_REGION`, `NETLIFY_EMAIL_ENDPOINT`,
`INTERNAL_SERVICE_SECRET`.

The processor validates all of these at startup and exits if any are missing.

## Firebase console settings

Not environment variables, but the application does not work without them.

| Setting | Where | Why |
|---|---|---|
| **Email link (passwordless) sign-in** | Authentication → Sign-in method → Email/Password → enable the "Email link" toggle underneath | Organizer sign-in (UX-2). Without it `sendSignInLinkToEmail` fails. |
| **Authorized domains** | Authentication → Settings → Authorized domains | Add every domain the app is served from. Magic links refuse to complete on an unlisted domain. |

## Local development

Put frontend values in `.env.local` (gitignored). For functions, `netlify dev`
reads the same file. For rules tests nothing is needed — the emulator supplies
its own credentials:

```bash
npm run test:rules       # Firestore rules + rate limiter, against the emulator
npm run test:functions   # webhook authentication, no emulator required
npm run test:security    # both
```
