# Runbook — Rotating the leaked EC2 SSH key

**Trigger:** finding SEC-1. An RSA private key (`aws-ec2-spot/wedding-photo-spot-key.pem`)
was committed to this repository and is present in git history from commit `d621a32`
onward.

**Assume the key is compromised.** It has been distributed to every clone of this
repository. Removing it from the current commit — which we have done — does not
remove it from history, and does not undo any copy that already exists.

The steps below are ordered so that access is never lost mid-rotation. Steps 1–4
are required. Step 5 (history purge) is destructive to shared history and needs a
decision from the repository owner first.

---

## 1. Create the replacement key pair

```bash
aws ec2 create-key-pair \
  --key-name wedding-photo-spot-key-v2 \
  --query 'KeyMaterial' \
  --output text > ~/.ssh/wedding-photo-spot-key-v2.pem

chmod 400 ~/.ssh/wedding-photo-spot-key-v2.pem
```

Store it outside the repository. `~/.ssh/` is fine; the repo is not. `.gitignore`
now blocks `*.pem`, but do not rely on that as the only control.

## 2. Point new instances at the new key

The launcher creates instances from an inline `RunInstances` call, so the key name
lives in `aws-ec2-spot/lambda-function.js`. Update `KeyName` to
`wedding-photo-spot-key-v2` and redeploy the Lambda.

Verify a freshly launched instance accepts the new key before continuing:

```bash
ssh -i ~/.ssh/wedding-photo-spot-key-v2.pem ec2-user@<new-instance-ip>
```

## 3. Delete the old key pair from AWS

```bash
aws ec2 delete-key-pair --key-name wedding-photo-spot-key
```

This stops the leaked key from authenticating to any *new* instance. Instances
already running were launched with the old public key baked into
`~/.ssh/authorized_keys` and are unaffected — terminate them:

```bash
aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=wedding-photo-processor" \
            "Name=instance-state-name,Values=running,pending" \
  --query 'Reservations[].Instances[].InstanceId' --output text \
| xargs -r aws ec2 terminate-instances --instance-ids
```

They auto-terminate on idle anyway, and the queue will relaunch on the next job.

## 4. Rotate everything the key could reach

Anyone with shell on a processor instance could read the environment file at
`/etc/systemd/system/wedding-photo-processor.service` and the instance profile
credentials from IMDS. Treat all of the following as exposed:

- [ ] **R2 access key + secret** — Cloudflare dashboard → R2 → Manage API Tokens.
      Roll, then update `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` in Netlify,
      the Cloudflare Worker, and the EC2 launcher's user-data.
- [ ] **Mailgun SMTP password** (`EMAIL_PASSWORD`) — the instances trigger email
      through Netlify, but the credential appears in Netlify env and any log dump.
- [ ] **The EC2 instance role** — review `aws-ec2-spot/instance-policy.json` and
      narrow it. It should not be able to launch instances or read unrelated
      buckets. An attacker with the role could otherwise self-perpetuate.
- [ ] **Lambda Function URL shared secret** — see `docs/runbooks/` for SEC-3; if
      the previous value was ever on an instance, generate a new one.

Check CloudTrail for unexpected `RunInstances`, `GetObject`, or `CreateAccessKey`
calls since `d621a32` was pushed:

```bash
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=EventName,AttributeValue=RunInstances \
  --start-time 2025-07-01 --max-results 50
```

## 5. Purge from git history — requires owner approval

**This rewrites shared history.** Every collaborator must re-clone or hard-reset
afterwards; open pull requests will need rebasing. Do not run it unilaterally.

Once steps 1–4 are complete, the leaked key is inert, so the purge is hygiene
rather than an emergency. Run it when there's a quiet moment and everyone is
warned.

```bash
# from a fresh clone, with the working tree clean
pip install git-filter-repo

git filter-repo --invert-paths --path aws-ec2-spot/wedding-photo-spot-key.pem

git remote add origin https://github.com/MigsAdventure/Photo-Album.git
git push --force --all
git push --force --tags
```

Then, in the GitHub UI: Settings → check that no forks exist (a fork keeps the old
objects), and ask GitHub Support to garbage-collect cached views of the blob if the
repository is or ever was public.

Consider doing this in the same pass as ARC-2 (purging `node_modules` and the four
committed Lambda `.zip` bundles), since it's the same destructive operation and
there's no reason to inflict it twice.

---

## Prevention

- `.gitignore` now blocks `*.pem`, `*.key`, `*.p12`, `*.pfx`, `id_rsa*`.
- Enable **GitHub secret scanning with push protection** (Settings → Code security).
  It blocks a push containing a recognised private key before it reaches the remote.
- Prefer AWS Systems Manager Session Manager over SSH for instance access. It uses
  IAM rather than a key file, so there is no secret to leak. The instance role
  already has SSM permissions in `aws-ec2-spot/cloudwatch-logs-policy.json`.
