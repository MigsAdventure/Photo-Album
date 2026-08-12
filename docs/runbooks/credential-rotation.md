# Runbook — Rotating the leaked R2 and service credentials

**Trigger:** finding SEC-9. Live Cloudflare R2 access keys were committed to this
repository as string literals inside systemd unit files, across seven files and
two distinct key pairs.

**Assume both key pairs are compromised.** They grant read, write and delete on
the production photo bucket — every customer's photos and every generated
archive. Anyone who has ever cloned this repository has them, and they remain in
git history after this change.

This is more urgent than the SSH key in `key-rotation.md`. That key gave shell on
an ephemeral processing instance; these give direct control of the bucket holding
the product.

---

## 1. Create a replacement R2 token

Cloudflare dashboard → R2 → **Manage API Tokens** → Create API token.

- Permission: **Object Read & Write**
- Scope it to the `sharedmoments-photos-production` bucket only. The leaked
  tokens were account-scoped, which is broader than anything here needs.
- Note the Access Key ID and Secret Access Key — the secret is shown once.

## 2. Set it everywhere it is consumed

Nothing reads a hardcoded value any more; every consumer takes it from its own
environment. Set the new pair in all four places before revoking the old one, so
there is no window where a job fails.

| Consumer | Where to set it |
|---|---|
| Netlify functions | Site configuration → Environment variables (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL`) |
| Launcher Lambda | Lambda console → Configuration → Environment variables. The launcher now injects these into each instance's systemd unit at launch, so this is the only place the processor's copy comes from. |
| Cloudflare Worker | `wrangler secret put R2_ACCESS_KEY_ID` etc. Never in `wrangler.toml` — that file is committed. |
| Local development | `.env.local`, which is gitignored. |

Verify the Lambda first — it now throws on a missing variable rather than baking
an empty credential into an instance, so a misconfiguration surfaces immediately
instead of producing a processor that fails every job with an opaque auth error:

```bash
aws lambda invoke --function-name wedding-photo-spot-launcher \
  --payload '{"eventId":"smoke-test","email":"you@example.com","photos":[]}' \
  /dev/stdout
```

## 3. Revoke the old tokens

Cloudflare dashboard → R2 → Manage API Tokens → delete both leaked pairs.

Prefixes of the leaked keys, to identify them in the list — the full values are
deliberately not repeated here:

- `06da59…` (with secret `e14eb0…`)
- `726f0a…` (with secret `3b01b8…`)

## 4. Check what was done with them

R2 does not log object access by default. If **R2 event notifications** or
**Logpush** were enabled, review them for reads or deletes not originating from
our services. If neither was enabled, you cannot rule out access — check instead
for evidence of tampering:

- [ ] Bucket object count and total size against expectations for the events you
      have run. A large unexplained increase suggests the bucket was used as free
      storage by someone else.
- [ ] Any objects outside the `media/`, `events/` and `downloads/` prefixes.
- [ ] Cloudflare billing for an unexplained Class A/B operation spike.

Enable Logpush on the bucket now so the next incident is answerable.

## 5. Rotate the other secrets in the same pass

Any of these that appeared in a committed file or on a processing instance:

- [ ] **Mailgun SMTP password** (`EMAIL_PASSWORD`) — an attacker with this sends
      mail as your domain. Rotate in Mailgun, update Netlify.
- [ ] **`INTERNAL_SERVICE_SECRET`** — new in this phase; generate with
      `openssl rand -hex 32` and set in Netlify, the Lambda, and the Worker.
- [ ] **`LAUNCHER_SHARED_SECRET`** — likewise, in the Lambda and the Worker.
- [ ] **`GHL_WEBHOOK_SECRET`** — likewise, in Netlify and the GoHighLevel
      workflow's Custom Headers.
- [ ] **AWS access keys** used by any local `check-*.js` script, if they were
      ever pasted into a file rather than read from `~/.aws/credentials`.

## 6. Purge from git history

Same operation as `key-rotation.md` step 5, and there is no reason to do it
twice — combine the paths:

```bash
git filter-repo \
  --invert-paths \
  --path aws-ec2-spot/wedding-photo-spot-key.pem \
  --path aws-ec2-spot/node_modules \
  --path-glob 'aws-ec2-spot/*.zip'
```

The credentials in the shell scripts are inline rather than whole files, so they
need `--replace-text` with a file of `literal==>REDACTED` lines rather than
`--invert-paths`. Do this only after step 3 — once the tokens are revoked, the
history purge is hygiene, not an emergency, and rushing a history rewrite is how
you lose commits.

---

## Prevention

- Nothing in the repository reads a credential from a literal any more. The
  launcher throws on a missing environment variable rather than defaulting.
- Enable **GitHub secret scanning with push protection**. Cloudflare R2 tokens
  are a recognised pattern, so this would have blocked the original push.
- Add a pre-commit hook (`gitleaks`, `trufflehog`) so a literal never reaches a
  commit locally.
- When a value must reach an EC2 instance, prefer **AWS Secrets Manager** or
  **SSM Parameter Store** read by the instance role at boot, over injecting it
  into user-data. User-data is readable from IMDS by anything running on the
  instance and is visible in the console to anyone with `DescribeInstances`.
