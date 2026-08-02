# Workplan 0030 — email notifications: ad hoc + daily/weekly attention summaries

## Status — 2026-08-02 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 The channel: SMTP per edition, EN/NL templates, recipient locale | ⬜ Not started | — |
| T2 Ad hoc events (decision raised, run failing, verify done, finished) | ⬜ Not started | — |
| T3 The daily/weekly "needs attention" digest | ⬜ Not started | — |
| T4 Preferences + the rollback flag + doc truth | ⬜ Not started | — |

## Why this exists

Owner decision 2026-08-02 (0026 T3 row 5): **keep, scoped** — email only,
"with ad hoc, daily and weekly summary of what needs attention." SAD §11.2
#4/§5 promise the owner is told when the migration needs them; reality is
honest not-implemented stubs, a `notifyUsers: true` rollback flag that does
nothing (0026 T1 item 3 fixes its lie independently), and 0024's recorded
transfer: **notifications are bilingual from day one**.

The product reason: an SMB owner mid-shadow-sync checks the UI weekly at
best. The drift decision queue (0028) and the item queues only work if
"something is waiting on you" reaches an absent owner — that is an email,
not a bell icon. **No in-app notification center** — out of scope by this
decision.

Sequencing: after 0028's plumbing exists (its "decision raised" is the
flagship ad hoc event), though T1 and the digest's queue-count sources
predate 0028 and can start first.

## Tasks

- **T1 — the channel.** One `Notifier` seam in core; SMTP transport
  configured per edition (managed: operator SMTP via env secrets, rule 3;
  appliance: owner-supplied SMTP settings — self-host keeps working with
  no managed dependency, rule 5; unconfigured = notifications off, said
  honestly in the UI, never silently). Templates are typed EN/NL pairs in
  `@openmig/shared` beside each other (the 0024 T1 pattern — they cannot
  drift apart silently); the recipient's locale is a **per-member
  preference** (the small server-side column 0024's note anticipated;
  tenant default = the appliance operator's UI locale). Send failures
  surface as run/queue errors, verbatim (rule 9) — a notification that
  silently failed to send is the worst kind of missing.
- **T2 — ad hoc.** The immediate events, each deduped so one condition
  emails once, not per poll: a decision was raised (0028's seam), a
  mapping's runs are repeatedly failing, a verification run finished
  (either verdict), the migration finished. Event → template → recipients
  (owner/admin members; the appliance's configured address).
- **T3 — the digest.** "What needs attention", computed at send time from
  the same envelopes the screens read (never a parallel count): pending
  decisions (0028), waiting-on-you counts per queue (deletions / moves /
  failures), stalled or failing syncs, mappings sitting in
  READY_FOR_CUTOVER. Nothing needing attention = **no email** (an empty
  digest trains owners to ignore the channel). Daily and weekly cadences
  via the `Scheduler` seam — croner on the appliance, a scheduled
  Trigger.dev task on managed (the `managed-sync-tick` pattern).
- **T4 — preferences + truth.** Per-tenant cadence choice (ad hoc on/off,
  daily or weekly digest — owner/admin-editable on the Tenants screen,
  which 0026 T2 just made real, plus the appliance's config surface); wire
  `run-rollback`'s notify flag to the real channel once it exists (until
  then T1 item 3's honest refusal stands); dated notes in SAD §11.2 #4
  recording the scope (email-only, no in-app center) and 0024's bilingual
  requirement marked discharged.

## Hard rules that bite here

- **Rule 5:** the appliance edition notifies with nothing but the owner's
  own SMTP details; every piece lives behind the core seam.
- **Rule 3:** SMTP credentials are env/config secrets, never repo content.
- **Rule 9:** unconfigured SMTP and failed sends are stated, loudly; the
  digest never renders a blind spot as "nothing needs attention" — sources
  it cannot read are named in the email.
- **Rule 2/0024:** refusal and failure prose inside emails stays the
  server's verbatim words; the FRAME is the bilingual template.
