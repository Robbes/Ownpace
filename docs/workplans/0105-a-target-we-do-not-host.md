# Workplan 0105 — a target we do not host

## Status — 2026-08-26 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| Research | ✅ **Done 2026-08-26** | This document. The 0103/0104 proofs split cleanly into what only self-hosting allowed (the Mailpit catcher, the cron drain) and what was API-only by design (the probe, the byte-check, the press). The owner's Soverin OTA mailbox plus the ownpace.eu **catch-all** replace the catcher in the real world; **time** replaces the drain (a real provider runs its cron); nothing replaces the probe because it never needed replacing. |
| T0 The probe becomes product | ✅ **Done 2026-08-26** | The 0103 T3 remainder, home at last. `measureTargetScheduling` (orchestration `target-scheduling.ts`) wraps the probe and runs at every DAV-target connection test: the verdict rides the probe result as a structured `scheduling` field AND appended to `detail`, rendered EN/NL by the web (`schedulingText`; carddav skipped — nothing to measure; UNKNOWN worded unmeasured-is-not-safe). Before a mapping's first calendar write, `schedulingRecorder` — wired in BOTH deps builders — measures the SAME endpoint the writer got and records `calendar.target_scheduling` to the audit log: once per mapping (the audit log is its own guard), ordered before the loop (proved by breaking the order), never a pass-killer. The migration assessment (the §14.2 permission report, both editions) now opens with "What the target will do with what we write", measured live at report time; a failed measurement is a stated unmeasured-is-not-safe line, never a dropped section. The appliance has no interactive test button — its verdict arrives through the report and the audit record, the halves a headless edition can carry. |
| T1 The live tenant, through the front door | 🟡 door prepped 2026-08-26; the supervised configuration is the owner's act | The Soverin connection is configured **in the product, through the UI**, like any customer would: tenant, connection (SecretStore-encrypted), mapping. Nothing Soverin-shaped ever enters `.env` or the repo. This is deliberate dogfooding — every gap the owner hits configuring it is a bug with a name. Done once, supervised; the tenant persists for the nightly. **Prep done:** the one gap a front-door walk found is closed — DAV targets could only say `https://host:port/`, so a provider whose DAV root lives behind a path was inexpressible; caldav/carddav/webdav targets now take an optional **DAV base URL** (wizard + Connections page + API, `davUrl`'s existing precedence, descriptor↔schema lock proved by breaking). imap/jmap unchanged. Expect per-domain mappings at configuration time: a caldav target carries calendar, carddav contacts, imap/jmap mail — three thin mappings, not one. |
| T2 The catch-all catcher | ✅ **Done 2026-08-26** | `scripts/live-catchall.ts` — harness equipment, imported by no app. `catchallFromEnv` copies `notifierFromEnv`'s discipline exactly: nothing set → honestly OFF naming every variable (`LIVE_CATCHALL_HOST/USER/PASSWORD`, port defaults 993, mailbox INBOX) — the nightly stands down loudly-but-green on this; PARTLY set → OFF **misconfigured**, naming exactly the missing variables — the nightly reds on this. `searchTag` casts the widest net a tag allows (To OR Subject OR body, since the window start; imapflow's OR compiler verified to nest n-ary ORs) — a silence check that only watched To: would call a body-tagged mail "silence". `waitForTag` is the positive-control assertion: polls, returns evidence, never throws for absence — the caller words the red. `assertableSilence` IS `searchTag` (pinned by test): no second, narrower code path for silence. One connection per poll, deliberately — a held-open live IMAP connection is a flake generator. 9 unit tests against an injected fake client. Credentials: Spark `.env` only (rule 3; the two-credential-kinds rule). |
| T3 One supervised run | 🟡 runbook ready 2026-08-26; the sitting itself waits for the owner | `docs/soverin-supervised-run.md` — the walk-through, A to H: front door with the verdict read aloud and recorded (A = T1's act), seed the SPARK's Nextcloud as source (we may seed only what we host; the O365 tenant is not in the run at all), positive control from Soverin webmail before any silence may mean anything, the tiny per-domain migration, byte-check through Soverin's published DAV plus the `calendar.target_scheduling` audit row, silence + the day-after re-check, take-back to net zero, then arm the nightly (H). Uses the nightly's own date-stamped tag family, so the armed lane's sweep covers the sitting's stragglers automatically. Findings land here as dated rows. |
| T4 The soft lane | ✅ **Built 2026-08-26** — armed by T3's step H | `.github/workflows/e2e-live-target.yml` + `scripts/live-target-lane.ts` (decisions, 14 unit tests) + `live-target-nightly.ts` (plumbing). Separate nightly (04:30 UTC + dispatch), never a PR trigger — blocks nothing by construction; red means investigate. Unconfigured → **stands down loudly-but-green**, printing every variable that would arm it; half-configured → red naming exactly the missing ones. A full run: day-after sweep (yesterday's date-tag — time as the drain's substitute), positive control through the target's OWN submission server (disjoint `openmig-control-…` family, so it can never count against the silence it proves; silence without it is said to be UNPROVEN), sync triggers for the persistent mappings + settle window, then today's silence with evidence printed on red. Credentials: the Spark's persisted `.env` (the managed gate's own file), zero GitHub secrets; the workflow greps only `LIVE_*` lines into the job env. Verdict line: `live-target: control=… sweep=… sync=… silence=… — PASS\|RED`. |
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
