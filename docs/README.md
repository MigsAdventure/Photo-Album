# Project Documentation

This directory is the durable record of what we build, why we chose it, and how to
operate it. Everything here is kept current; anything that goes stale gets moved to
`history/` rather than left to mislead.

## Layout

| Path | What lives here | Update when |
|---|---|---|
| `sessions/` | One log per working session — what changed, what we learned, what's still open | Every session, before committing |
| `decisions/` | Architecture Decision Records (ADRs). One per significant, hard-to-reverse choice | Whenever we pick between real alternatives |
| `runbooks/` | Operational procedures — rotation, deployment, incident response | When a procedure is created or changes |
| `history/` | Superseded status docs kept for archaeology only. **Not authoritative.** | Never edited, only added to |
| `../AUDIT_2026-08.md` | The audit this work plan derives from. Finding IDs (SEC-1, ZIP-3…) are referenced throughout | Only when re-auditing |

## Conventions

**Session logs** are named `YYYY-MM-DD_short-slug.md` and follow
[`sessions/_TEMPLATE.md`](sessions/_TEMPLATE.md). Every session gets one, even short
ones. The log is written *during* the work, not reconstructed afterwards — the
"what we learned" section is the part that pays off later, and it's the part you
can't reconstruct.

**Decision records** are named `NNNN-short-slug.md` and follow
[`decisions/_TEMPLATE.md`](decisions/_TEMPLATE.md). Write one when a choice would
be expensive to reverse or when a future reader would reasonably ask "why on earth
did they do it this way?" A decision record is never deleted — if we change our
minds, we write a new one that supersedes it and mark the old one.

**Commits** reference the finding ID they address, so `git log --grep=SEC-2` shows
every commit touching that finding.

```
SEC-2: lock down Firestore writes with security rules

<what changed and why, in prose>

Refs: AUDIT_2026-08.md §03, docs/sessions/2026-08-12_phase-1-security.md
```

**Never** mark something "complete" or "do not revisit" in documentation. That
convention in the old `project-state.md` is the direct reason finding ZIP-3 survived
seven months of debugging: a fix was declared final, so nobody looked at it again.
Describe what the code does now and when we last verified it.

## Current state

- **Phase 1 — Security hardening**: in progress. See
  [`sessions/2026-08-12_phase-1-security.md`](sessions/2026-08-12_phase-1-security.md).
- Phases 2–6 are described in `AUDIT_2026-08.md` §07.
