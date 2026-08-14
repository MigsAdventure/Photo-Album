# <Title> — <YYYY-MM-DD>

**Phase:** <e.g. 1 — Security hardening>
**Findings addressed:** <SEC-1, GHL-2, …>
**Branch:** <branch name>
**Status:** in progress | complete | blocked

## Goal

One paragraph: what this session set out to do, and why now.

## What changed

For each meaningful change — the file, what it does now, and what it did before.
Link the finding ID. Keep this factual; reasoning goes in the next section.

| File | Change | Finding |
|---|---|---|
| | | |

## Why we did it this way

The reasoning a future reader needs. Alternatives considered and rejected, with
the reason for rejection. If the choice was significant enough to be hard to
reverse, it also gets an ADR in `docs/decisions/` — link it here.

## What we learned

The part that pays off later. Surprises, misconceptions corrected, behaviour of a
third-party service that isn't in its docs, dead ends that cost time. Be specific
enough that the note saves someone an hour.

## Deployment steps required

Anything that must happen outside the repository for this change to take effect —
environment variables, console settings, credential rotation, rules deployment.
**Code merged is not the same as change deployed.** List each step and who does it.

- [ ] step

## Verification

How we confirmed it works, and what we could not confirm. Say plainly what was
tested and what was reasoned about but not exercised.

## Still open

Anything discovered but not fixed, with a finding ID if it's new. Carry these into
the next session's goal rather than losing them.
