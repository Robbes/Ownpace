# The first supervised run against Soverin — a walk-through

Workplan 0105 T3. One sitting, owner present; the agent watches, the owner's
hands do everything credential-shaped. Findings land as dated rows in
`docs/workplans/0105-a-target-we-do-not-host.md` the same day.

**What this proves when it is green:** the product can carry a small calendar
+ contacts migration into a provider we do not host, through the same front
door a customer walks, with the target's scheduling behaviour MEASURED (never
assumed), a positive control proving the catch-all can see, silence for the
run's tag, and a net-zero take-back.

## Before the sitting

- PRs #601–#603 merged (the verdict, the DAV-URL door, and the live lane —
  catch-all reader, this runbook, the nightly).
- At hand, on paper or in a password manager — never in the repo:
  - the Soverin mailbox credentials (IMAP/CalDAV/CardDAV — same account);
  - the ownpace.eu **catch-all** inbox's IMAP host, user, password.
- The Spark up, with the managed stack's demo Nextcloud reachable — it plays
  the SOURCE, because we may seed only what we host. **The O365 tenant is not
  in this run at all**: it stays read-only, and a run that needs seeded
  fixtures cannot use a source it must not write to.
- The run's tag is date-stamped, the same family the nightly sweeps:
  `openmig-live-YYYYMMDD` (UTC, today). Write it down; everything below says
  `<TAG>` for it. Tags are never reused — a second sitting the same day picks
  up where the first stopped rather than re-tagging.

## A — the front door (this is T1, and it is the owner's act)

Everything this section creates — tenant, connections, mappings — is the
**persistent registration the nightly reuses**: it lives in the Spark's
long-lived managed stack (the same one the 05:30 hermetic gate runs
against), rows in its Postgres with credentials SecretStore-encrypted. The
gate recreates its own containers but never `down -v`'s the volumes and
never touches a foreign tenant, so this survives night after night. The one
thing that would take it with it is rebuilding that stack from scratch — do
that, and this section plus D are walked again.

1. Sign in to the product (the Spark's managed web app) as the tenant owner.
2. Connections → Add, role **target**, type **caldav**. Host and port from
   Soverin's documentation; if their DAV root lives behind a path, put the
   full URL in **DAV base URL** — that field exists for exactly this.
   Credentials: the Soverin mailbox — **an app-password goes straight into
   the password field.** IMAP, CalDAV, CardDAV and SMTP submission all speak
   Basic auth here; no OIDC token exists or is needed anywhere on the
   Soverin side. Whether one app-password covers all four protocols or
   Soverin scopes them per protocol is not something to assume: the Test
   button answers it — a 401 on caldav beside a passing imap means
   protocol-scoped, and the fix is minting another app-password for DAV in
   Soverin's settings. Save & test.
3. **Read the whole test result aloud.** It carries two sentences now:
   - *Connected. N collections visible.* — the credentials and the URL are
     right;
   - the **scheduling verdict** — whether Soverin advertises
     `calendar-auto-schedule` (RFC 6638), measured on their server by that
     button press. This is the first number this run exists to collect:
     **record the verdict verbatim as a dated row in 0105.** If it says
     UNMEASURED, that is a finding too — unmeasured is not safe, and the
     writer neutralises regardless.
4. Repeat for **carddav** (no verdict on this one — an address book has no
   scheduling to measure) and, if mail will ever ride this tenant, **imap**.
5. Every gap the owner hits in this section — a field that does not fit
   Soverin's shape, a refusal that does not name its remedy — is a bug with
   a name. Note it; do not work around it silently.

## B — seed the source (a handful, tag-addressed, deliverable)

On the Spark's own Nextcloud (the source we host and may write to):

1. A throwaway calendar `openmig-t3`, three events. Event 1 carries an
   attendee at OUR domain — deliverable, never `@example.invalid`, which
   would bounce at a real MTA and cost reputation:

   ```text
   ATTENDEE;CN=Canary;PARTSTAT=NEEDS-ACTION:mailto:<TAG>-attendee@ownpace.eu
   ORGANIZER;CN=Owner:mailto:owner@example-source.invalid
   ```

   (Create in the UI with the attendee typed, or PUT an .ics; the address is
   what matters — it contains `<TAG>`, so the catch-all searches find it in
   To, Subject or body alike.)
2. A throwaway address book, three contacts, one of them
   `<TAG>-contact@ownpace.eu`.

## C — the positive control (before any silence may mean anything)

1. From the Soverin **webmail**, the owner sends one plain mail to
   `openmig-control-<DATE>@ownpace.eu` (the control family is deliberately
   disjoint from `<TAG>`'s so it can never count against the silence).
2. Confirm arrival in the catch-all inbox — webmail is fine, or:

   ```bash
   LIVE_CATCHALL_HOST=… LIVE_CATCHALL_USER=… LIVE_CATCHALL_PASSWORD=… \
     pnpm exec tsx -e 'import("./scripts/live-catchall.ts").then(async m => {
       const c = m.catchallFromEnv(process.env); if (!c.on) throw new Error(c.reason);
       console.log(await m.waitForTag(c, "openmig-control-…", { since: new Date(Date.now()-36e5) }));
     })'
   ```

3. No arrival within ~5 minutes → stop the sitting. The pipe Soverin → MX →
   catch-all is not proven, and every later "nothing arrived" would be
   vacuous. Diagnose (spam folder? greylisting? MX?), then restart at C.

## D — the tiny migration

1. Create two thin mappings through the wizard: source = the seeded Nextcloud
   calendar/address book, target = the Soverin connections from A. Per-domain
   by construction: the caldav target carries `calendar`, the carddav one
   `contact` (`TARGET_TYPE_DOMAINS`).
2. **Note both mapping ids** — step H needs them. Each is in the mapping
   page's URL, or listed by `GET /api/mappings`.
3. Run the sync for both (the mapping page's run button, or
   `POST /api/migrations/<id>/sync`).
4. While it runs, nothing else: a handful of DAV writes is the whole load —
   no load worth a provider's attention.

## E — the byte-check, through the published door

1. The owner opens Soverin's own calendar and contacts UI: the three events
   and three contacts are THERE, titles intact, the canary event showing its
   attendee.
2. Spot-read one event back over Soverin's CalDAV (any DAV client, or curl
   with the mailbox credentials) and check the attendee line survived —
   neutralised in transport semantics, intact as data.
3. The audit log now carries `calendar.target_scheduling` for the calendar
   mapping — the once-per-mapping record that the measurement preceded the
   first write. If the capability it recorded differs from A's button press,
   that is a finding (a server presenting different faces to different
   doors), not a shrug.

## F — the silence

1. Settle ~10 minutes (a real provider's queues drain on their own schedule;
   time is the drain here).
2. Search the catch-all for `<TAG>` (same one-liner as C with the tag
   swapped, or eyes on the inbox). **Nothing may carry it.** The control from
   C is what makes this claim non-vacuous.
3. Anything caught: the evidence (From/To/Subject) goes into 0105 verbatim,
   and the sitting's verdict is red — a red with the exact mail in hand is
   the most valuable outcome this run can produce.
4. **The day after**, once: search `<TAG>` again (the nightly's sweep does
   this automatically once armed). A queue that drained overnight is exactly
   what this window exists to catch.

## G — take-back, to net zero

1. Delete the six migrated items from the Soverin box (the owner's own box,
   which exists to be written to) — through Soverin's UI or DAV.
2. Delete the seeded calendar and address book from the source Nextcloud.
3. What remains: the tenant, the connections, the mappings (they persist for
   the nightly), the audit rows, and the dated findings in 0105. No data, no
   residue, no mail owed to anyone.

## H — arm the nightly

1. Into the Spark's persisted env (`$HOME/.persistent/ownpace-managed/.env`
   — the same file the managed gate restores; never the repo):

   ```text
   LIVE_CATCHALL_HOST=…    LIVE_CATCHALL_USER=…    LIVE_CATCHALL_PASSWORD=…
   LIVE_CONTROL_SMTP_HOST=…  LIVE_CONTROL_SMTP_USER=…  LIVE_CONTROL_SMTP_PASSWORD=…
   LIVE_TARGET_API_URL=http://localhost:3001
   LIVE_TARGET_MAPPINGS=<id>,<id>            # from D — the mapping page URLs
   LIVE_TARGET_JWT_SECRET=<the stack's own JWT_SECRET, already in this file>
   LIVE_TARGET_TENANT=<the tenant id from A>
   LIVE_TARGET_SUB=<the owner email you signed in with>
   ```

   Three different credentials, three different systems — worth keeping
   straight:

   - `LIVE_CATCHALL_*` — the **ownpace.eu catch-all** inbox's IMAP login.
   - `LIVE_CONTROL_SMTP_*` — the **Soverin** submission server, so the
     control mail originates at the target's own MTA. A Soverin
     app-password is the password here, exactly as in section A; whether
     the same app-password covers SMTP as well as IMAP/DAV is Soverin's
     scoping choice — the first control send answers it.
   - `LIVE_TARGET_*` — **our own product API**, nothing Soverin-shaped.
     The last three are **mint mode**: the nightly signs itself a fresh
     one-hour owner token per run for OUR API, exactly the way the managed
     smoke's `mint()` does — because any token pasted tonight is expired
     by tomorrow night. On a stack that verifies only against a real
     issuer, set `LIVE_TARGET_API_TOKEN=<a long-lived token>` instead;
     when both are set, the static token wins.

2. Trigger **E2E (live target)** once by hand (workflow_dispatch) and read
   its verdict line: `live-target: control=arrived sweep=silent sync=2/2
   silence=silent — PASS` is the lane earning its keep. Partial arming is a
   red that names the missing variables — that is the lane working, not
   failing.
