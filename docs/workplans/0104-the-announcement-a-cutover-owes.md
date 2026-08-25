# Workplan 0104 — the announcement a cutover owes

## Status — 2026-08-25 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| Research | ✅ **Done 2026-08-25** | This document. The owner's hypothesis holds and the platforms force the conclusion: no API anywhere defers or resends a share notification, so the one-moment announcement must be **Ownpace's own mail**, assembled from `share_grant`, pressed once. |
| T0 Whose mail is it — the ADR seed | ⬜ proposed | Grantee addresses are personal data (§17); the tenant admin is the controller. Proposal: the announcement is **the tenant's mail** — the product assembles and the admin presses — never operator-initiated. |
| T1 Assemble per-grantee digests | ⬜ proposed | One digest per grantee from settled `share_grant` rows (`applied` + `done_manual`; `skipped` excluded; still-`open` rows flagged to the presser, not mailed about). EN/NL. |
| T2 One press, at cutover | ⬜ proposed | A single send action in the cutover window (§5 states), through 0030's mailer. The press is recorded (who, when); a second press is an explicit *resend*, never a silent duplicate. |
| T3 Template 6 | ⬜ proposed | `cutover-communication-templates.md` covers the tenant's own users five ways and the outsiders zero — add "To people your organisation shares files with", EN/NL. |
| T4 The gate | ⬜ proposed | Mailpit: exactly one mail per distinct grantee at press, **zero before** — riding the armed catcher and per-run token discipline 0103 T2 built. |

## The owner's framing, which the research confirms

> my assumption is that at some cutover one needs to inform all people shared
> with, that they have shared files at a new (different) platform. so, I think
> notifying them is normal. but, at one chosen moment in time, not constantly
> during migration of a separate folder/file over and over again.
> — the owner, 2026-08-25

Exactly right, and it is already half-built into the posture:

- **Per-item silence during migration** is ADR-0043 plus 0052's design: share
  application is one-at-a-time and human-pressed, and the future bulk verb's
  silence flags are recorded beside `applyShareGrant` (0103 T6). Nothing
  drips notifications per folder while a migration runs.
- **The one chosen moment** has no platform primitive. Verified: Google
  Drive's `sendNotificationEmail=false` grants silently and offers **no way
  to send that notification later**; Graph's `sendInvitation:false` likewise
  grants without mail and has no deferred notify. Silence at grant time is
  permanent silence, platform-side. So the announcement is necessarily
  **ours**: a mail the product composes and a person sends once.

## What the product already holds

Everything the announcement needs exists:

- **Who**: `share_grant.grantee` — every settled row carries the address the
  source platform knew. `done_manual` rows included (the person carried the
  share over by hand; the outsider still needs the new address).
- **What**: `subject`/`on` per row — each grantee's digest lists *their*
  items, not the tenant's inventory (least disclosure, §17).
- **When**: the cutover runbook's window and states (§5) — the moment is
  Template 3's ("Cutover Complete"), because before cutover the old platform
  still answers and an early announcement points people at a target that may
  yet be rolled back (rollback is a setback — ADR on record — and an
  announcement cannot be unsent).
- **How**: 0030's mail infrastructure, already gated by Mailpit in OTA.
- **The one per-item exception stays**: the checklist's *Apply* button sends
  the platform's own invitation for that grant, deliberately, labelled
  outward-facing — that is a person deciding per row, which ADR-0043 permits
  by definition.

## What this deliberately does not do

- **No platform-side re-notify hacks** (delete + re-grant to force a mail
  would drop and re-issue permissions — a real outage for the grantee, and
  non-destructive rules forbid it).
- **No operator-initiated send.** The grantee list is the tenant's data about
  third parties; the operator can see counts, not press send (§17 roles).
- **No announcement before cutover completes.** See the rollback argument
  above.

## Sources

- [Drive `permissions.create`](https://developers.google.com/workspace/drive/api/reference/rest/v3/permissions/create) — `sendNotificationEmail` exists only at create; no resend surface ([confirmed against the method list](https://developers.google.com/resources/api-libraries/documentation/drive/v3/python/latest/drive_v3.permissions.html))
- [Graph `driveItem: invite`](https://learn.microsoft.com/en-us/graph/api/driveitem-invite?view=graph-rest-1.0) — `sendInvitation` at invite time only
- Repo: `share_grant` schema (grantee column), `share-queue.ts` ("the message comes from the platform" — the per-item exception), ADR-0043, workplans 0052/0103, `docs/cutover-communication-templates.md` (five templates, none to outsiders), `docs/cutover-runbook.md` (§ states, the window)
