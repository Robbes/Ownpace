# Workplan 0030 — email notifications: ad hoc + daily/weekly attention summaries

## Status — 2026-08-02 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 The channel: SMTP per edition, EN/NL templates, recipient locale | 🟡 **Rules + templates built 2026-08-03; transport and wiring are the next slice** | `packages/shared/src/notifications.ts`: the `Notifier` port (one method, so no policy can accumulate in a transport), the ad hoc `NotificationEvent` union, and EN/NL templates beside each other with **compile-time key parity** (`DigestLines`/`EventLines` interfaces — a line missing from one language is a type error, the 0024 T1 property). The two load-bearing rules are here and exhaustively tested: **an empty digest returns `undefined`** (a weekly "all clear" trains its reader to filter the channel, taking the one that mattered with it — so silence IS the signal), and **a blind spot is never silence** (a mapping whose queue could not be READ sends anyway, with the server's reason verbatim, because "I found nothing" and "I could not look" must not be the same email — rule 9). Prose boundary honoured: a decision's `summary` and a run's `lastError` ride verbatim in both languages. 14 unit tests. **Wiring landed the same day**: `MailTransport` is a function type in shared (so the browser bundle, which imports shared, never meets a mail library) and `packages/connectors/src/smtp-transport.ts` is the ONE nodemailer import in the workspace — chosen over hand-rolling SMTP+STARTTLS+AUTH, MIT, pure JS with no native build step, so ADR-0019's binary-free property holds. `readNotifierConfig(env)` turns the environment into a channel and distinguishes **nothing set** (the normal default, stated plainly) from **half set** (somebody TRIED — it names the missing variables rather than staying quietly off, rule 9); ports default to 587/STARTTLS or 465 when `SMTP_SECURE`. `disabledNotifier` says why ONCE, never throws; `createNotifier` **propagates** send failures rather than swallowing them (a notification that silently failed to send is indistinguishable from one never worth making). The appliance builds one at startup from `.env` (rule 3; rule 5 — the owner's own SMTP, nothing managed), announces ON/OFF with the reason, and exposes it on `SelfhostHandle.notifier` so T2/T3's events have a seam to call. Documented in `selfhost.env.example`. 32 unit tests across rules, config and appliance wiring. **Still no caller and no schedule** — T2 (ad hoc events) and T3 (the digest + cadence) supply those; recorded here rather than left to look finished. |
| T2 Ad hoc events (decision raised, run failing, verify done, finished) | 🟡 **Three of four wired 2026-08-03 — the three with live sources** | `runs_failing`: a pass where EVERY domain failed (the same definition the run row uses — a partly failed pass is per-item trouble the queues already report), plus a pass that threw outright. Deduped by `createFailureStreakGate`: silent below the threshold (one bad pass is usually a blip), speaks **exactly at** 3 consecutive failures and never again during that outage — a per-minute cron would otherwise send sixty emails about one unplugged server — and **resets on recovery**, so a later outage is reported again rather than the channel going permanently quiet after its first bad day. `verification_finished`: once per run per mapping, from the scan closure; only `PASS` counts as passed (WARN is not a green light, and the one email somebody reads about it is the worst place to blur that). `migration_finished`: on the real transition only — the repeat path answers `alreadyDone` and returns before reaching it, so finishing twice cannot send twice. All three go through `tell()`, which logs a failed SEND loudly but never rethrows: a migration that finished is still finished if the email about it bounced. **`decision_raised` is deliberately NOT wired** — nothing raises decisions until 0028's detectors exist (blocked on 0027 T0's admin consent), and wiring a notification to a seam with no caller is the dead-surface shape 0026 spent a day deleting. 5 gate tests; 1350/1350 unit. |
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
