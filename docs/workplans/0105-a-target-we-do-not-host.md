# Workplan 0105 — a target we do not host

## Status — 2026-08-26 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| Research | ✅ **Done 2026-08-26** | This document. The 0103/0104 proofs split cleanly into what only self-hosting allowed (the Mailpit catcher, the cron drain) and what was API-only by design (the probe, the byte-check, the press). The owner's Soverin OTA mailbox plus the ownpace.eu **catch-all** replace the catcher in the real world; **time** replaces the drain (a real provider runs its cron); nothing replaces the probe because it never needed replacing. |
| T0 The probe becomes product | ⬜ proposed | The 0103 T3 remainder, now with its product home (the owner's question, 2026-08-26: *"is a probe pass also what we do when testing the connections… and listing what we will do and can not do?"* — yes, and it should be). `detectCaldavScheduling` runs at connection test and before the first calendar write; the verdict is RECORDED per mapping and SURFACED in the migration assessment as a will-do/cannot-do line: "this target auto-schedules — invitations are neutralised in every object we write" / "does not advertise scheduling" / "UNKNOWN — unmeasured, not safe". Both editions. |
| T1 The live tenant, through the front door | ⬜ proposed | The Soverin connection is configured **in the product, through the UI**, like any customer would: tenant, connection (SecretStore-encrypted), mapping. Nothing Soverin-shaped ever enters `.env` or the repo. This is deliberate dogfooding — every gap the owner hits configuring it is a bug with a name. Done once, supervised; the tenant persists for the nightly. |
| T2 The catch-all catcher | ⬜ proposed | The harness-side reader for the ownpace.eu catch-all inbox (IMAP), the live world's Mailpit. THIS half is test equipment, not product data — its credentials live in the Spark's `.env` beside the smoke's other plumbing. Same discipline as 0103/0104: a **positive control first** (one mail that must arrive, proving Soverin's MTA → internet → ownpace.eu MX → catch-all end to end), then silence for the tag. Canary addresses on a live target are **deliverable, tag-addressed @ownpace.eu** — never `@example.invalid`, which would bounce at a real MTA and cost reputation. |
| T3 One supervised run | ⬜ proposed | Probe first (what does Soverin's CalDAV actually advertise? Measure, never assume — this is the one place we can meet the residual case no header closes: a server that schedules and ignores SCHEDULE-AGENT). Then a tiny tagged migration (calendar + contacts, a handful of items), byte-check through Soverin's own DAV, silence through the catch-all, take-back to net zero. Owner watching; findings land as dated rows here. |
| T4 The soft lane | ⬜ proposed | `e2e-live-target`: a separate nightly workflow against the persistent T1 tenant. **Not** part of the managed gate — internet mail latency, greylisting and spam filtering must never make the hermetic gate flaky; red here means "investigate", it blocks no PR. The drain's substitutes: a settle window at the end of the run, and the **day-after sweep** — each nightly also queries the catch-all for the *previous* run's tag, giving every run a 24-hour queue window for free. |
| T5 Soverin as a SOURCE | ⬜ parked | The same box read the other way — a real provider's CalDAV/CardDAV/IMAP as source. Nothing blocks it technically; parked until T3/T4 have shown the target half holds. |

## What self-hosting gave us, and what replaces it

The 0103/0104 proofs were built on the Spark's own Stalwart and Nextcloud.
Splitting honestly:

**Only possible because we host the target:**

- **The catcher** — the target's SMTP pointed at Mailpit, so every mail it
  sent was visible without owning an inbox. A SaaS target's MTA delivers to
  the real internet.
- **The drain** — `docker exec … cron.php` forces background jobs NOW. No
  SaaS lets you kick its cron.

**Deliberately never dependent on hosting the target:**

- **The probe** (`detectCaldavScheduling`) — one OPTIONS request, API-only,
  built to ask any customer target the same question.
- **The byte-check** — reads the copy back through the published DAV door,
  like any client (the owner's point, 2026-08-25).
- **The press and the rescan** — pure product API. The fabricate-and-retract
  fixtures touch OUR database, never the target's.

**The replacements, on a target we do not host:**

- Catcher → **the ownpace.eu catch-all**: make every canary tag-addressed at
  a domain we own, and whatever the target fans out lands where we can read
  it over IMAP. The whole 0103/0104 assertion pattern ports: positive
  control before silence, tag-scoping so no run answers for another.
- Drain → **time**: a real provider's cron runs continuously (our demo's
  drain exists precisely because the demo has none). The honest forms are a
  settle window and the day-after sweep (T4).
- Seeding through the container wall → **the product's own connectors**,
  with the target's real published APIs. Which is not a loss but the point.

## The two credential kinds, kept apart (the owner's question)

> wouldn't we use our own migration path I could configure in the UI?

Yes — and the distinction the question surfaces is the design:

- **The migration's credentials** (the Soverin mailbox the mapping reads and
  writes) belong to the PRODUCT: entered in the UI, encrypted by
  SecretStore, attached to a connection row — exactly the path a customer
  walks. A parallel `.env`-configured harness would test a road no customer
  drives.
- **The checker's credentials** (the catch-all inbox the assertions read)
  belong to the HARNESS: they are the live world's Mailpit API, test
  equipment the product never sees. Spark `.env`, rule 3, like every other
  smoke setting.

One rule of thumb: if the product would hold it for a customer, the product
holds it here; if only the gate needs it to JUDGE the run, it stays gate-side.

## What this deliberately does not do

- **Not part of the managed gate.** The hermetic gate answers "did WE
  regress"; the live lane answers "does the world behave". Mixing them makes
  the first flaky and the second ignored.
- **No addresses we do not own.** Canaries and grantees are @ownpace.eu,
  full stop. A leak in this lane is a real mail — to us.
- **No undeliverable canaries on live targets.** `@example.invalid` bounces
  at a real MTA; bounces are noise today and reputation damage tomorrow.
- **No load worth a provider's attention.** A handful of DAV writes and one
  or two mails per nightly, net-zero take-back after, tags never reused.
- **The SMB O365 source stays read-only.** This lane writes only to the
  owner's own Soverin box, which exists to be written to.
- **No guessing Soverin's stack.** What their CalDAV advertises, whether
  their server schedules, how their sharing (if any) behaves — measured by
  T3's probe, recorded here, never assumed from what their marketing or our
  memory says.

## Sources

- Workplans 0103 (the silence machinery: canary, armed catcher, probe,
  drain) and 0104 (the press, the pipe control, the announcement) — every
  assertion this plan ports.
- `packages/connectors/src/caldav-scheduling-probe.ts` — the probe T0
  promotes into the product path.
- `deploy/compose/smoke-managed.sh` — the assertion patterns (positive
  control before silence; fabricate-and-retract; tag take-back) T3/T4 reuse
  with the catch-all as catcher.
- ADR-0043 (a migration is silent by default — the posture this lane tests
  against the world), ADR-0032, hard rules 2 and 3.
