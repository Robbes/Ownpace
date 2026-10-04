# The first supervised run against Soverin — a walk-through

Workplan 0105 T3. One sitting, owner present; the agent watches, the owner's
hands do everything credential-shaped. Findings land as dated rows in
`docs/workplans/0105-a-target-we-do-not-host.md` the same day.

**What this proves when it is green:** the product can carry a small calendar
+ contacts migration into a provider we do not host, through the same front
door a customer walks, with the target's scheduling behaviour MEASURED (never
assumed), a positive control proving the catch-all can see, silence for the
run's tag — including for an event the Soverin account itself organises —
and a net-zero take-back.

**Corrected 2026-09-27 (workplan 0141 T7 (a)).** The owner test runbook's
Stage 10 points here. What changed, and why:

- **Where it runs.** On the OTA stack, not on `ownpace-live`. The lane step H
  arms reads that stack's persisted `.env`, and its API is the one at
  `http://localhost:3001` on that machine (0141 T7, under 0132 D7).
- **Step H signs in with a token from the identity provider.** The OTA stack
  sets `JWT_ISSUER`, and then the API verifies every token against the
  provider's keys and no longer uses `JWT_SECRET` (`selectAuthMode` in
  `apps/api/src/middleware/auth.ts`). A token the lane signs itself, which
  step H used to arm it with, is refused there.
- **Step B gains event 4**, whose organiser is the Soverin account's own
  address: 0141 T9's organiser canary, on a target we do not run. Step E
  checks its copy and one update of it.
- **The source is open.** See *Before the sitting*.
- **The rest now matches the code.** One Soverin connection carries
  calendars, contacts, mail and tasks (0106 T4, 0113 T5), so step A adds one
  connection and step D makes one mapping. The connection's Test no longer
  shows the scheduling verdict (0105 T0, the owner's instruction of
  2026-09-07), so step E reads it from the audit log. The labels are the
  ones on the screen, and the list of migrations is `GET /api/migrations`.

## Before the sitting

- PRs #601–#603 merged (the verdict, the DAV-URL door, and the live lane —
  catch-all reader, this runbook, the nightly).
- At hand, on paper or in a password manager — never in the repo:
  - the Soverin mailbox credentials (IMAP/CalDAV/CardDAV — same account);
  - the ownpace.eu **catch-all** inbox's IMAP host, user, password.
- The OTA stack up. This sitting runs there, not on `ownpace-live`.
- **A source the sitting may seed, and it has not been chosen.** This runbook
  was written for the OTA stack's demo Nextcloud as the SOURCE, because we may
  seed only what we host. **On `main` that cannot go through the front
  door.** *Start a migration* and the Accounts page offer the source cards in
  `SOURCE_CARDS` (`apps/web/src/components/front-door-cards.ts`), and the
  create route accepts the same list (`sourceType` in
  `apps/api/src/routes/migrations/index.ts`). Neither has CalDAV, CardDAV or
  Nextcloud. The demo tenants' Nextcloud source is written into the database
  by `seed-managed.ts`, which is not the door a customer walks. Which source
  the sitting uses is open question 9 in workplan 0141, and it is the
  owner's. Until it is answered, steps B and D describe the seed and the
  mapping, not where they go. Whatever the source is, it holds only what B
  seeds, and none of its own addresses is the Soverin account's, or the
  source would itself schedule event 4 when it is seeded (0141 T9 (b)).
- **The O365 tenant is not in this run at all**: it stays read-only, and a
  run that needs seeded fixtures cannot use a source it must not write to.
- The run's tag is date-stamped, the same family the nightly sweeps:
  `openmig-live-YYYYMMDD` (UTC, today). Write it down; everything below says
  `<TAG>` for it. Tags are never reused — a second sitting the same day picks
  up where the first stopped rather than re-tagging.

## A — the front door (this is T1, and it is the owner's act)

Everything this section creates — tenant, connections, mappings — is the
**persistent registration the nightly reuses**: it lives in the OTA stack,
the long-lived managed stack the nightly hermetic gate runs against, as rows
in its Postgres with credentials SecretStore-encrypted. The
gate recreates its own containers but never `down -v`'s the volumes and
never touches a foreign tenant, so this survives night after night. The one
thing that would take it with it is rebuilding that stack from scratch — do
that, and this section plus D are walked again.

1. Sign in to the product (the OTA stack's managed web app) as the tenant
   owner. Use a person whose only organisation on this stack is this one:
   step H's token is theirs, and the lane names no organisation, so the API
   takes the person's only membership (`resolveTenant`).
2. *Accounts* → *Add an account*; *Source or target?* → **Targets**;
   *Provider* → **Soverin** — one row for the one account, which carries
   calendars, contacts, mail and tasks. The boxes come pre-filled
   with what Soverin's own help pages publish: host `caldav.soverin.net`,
   port 443 (calendars and contacts share that DAV host, at the root, so
   **DAV base URL** stays empty), mail server `imap.soverin.net`, mail port
   993. They are Soverin's published values, not measured ones — the Test
   button measures them, and if Soverin has moved a host it refuses in
   Soverin's own words; if their DAV root ever moves behind a path, the
   full URL goes in **DAV base URL**, which exists for exactly this. The
   username is the account's email address.
   Credentials: the Soverin mailbox — **an app-password goes straight into
   the password field.** IMAP, CalDAV, CardDAV and SMTP submission all speak
   Basic auth here; no OIDC token exists or is needed anywhere on the
   Soverin side. Whether one app-password covers all four protocols or
   Soverin scopes them per protocol is not something to assume: the Test
   button answers it — a 401 on caldav beside a passing imap means
   protocol-scoped, and the fix is minting another app-password for DAV in
   Soverin's settings. Press *Add and test*.
3. **Read the whole test result aloud.** *Connected.* says the credentials
   and the URL are right; beside it, the result lists what it measured.
   The **scheduling verdict** — whether Soverin advertises
   `calendar-auto-schedule` (RFC 6638) — is no longer shown here: the owner
   took it off the connection's Test on 2026-09-07 (0105 T0). It is still
   measured, and it is recorded to the audit log before the mapping's first
   calendar write. Step E.3 reads it there, and that is where it is
   recorded in 0105.
4. There is no second connection to add. The one Soverin row carries every
   data type this sitting uses (`TARGET_TYPE_DOMAINS` in
   `packages/shared/src/target-domains.ts`).
5. Every gap the owner hits in this section — a field that does not fit
   Soverin's shape, a refusal that does not name its remedy — is a bug with
   a name. Note it; do not work around it silently.

## B — seed the source (a handful, tag-addressed, deliverable)

On the source (*Before the sitting* says it is not chosen yet; it is one we
may write to):

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
3. **Event 4, the organiser canary** (workplan 0141 T9, on a target we do
   not run), in the same calendar. Its organiser is the Soverin account's
   own address, and its one attendee is tag-addressed and deliverable:

   ```text
   ORGANIZER;CN=Owner:mailto:<the Soverin account's own address>
   ATTENDEE;CN=Canary;PARTSTAT=NEEDS-ACTION:mailto:<TAG>-organiser@ownpace.eu
   ```

   Why it matters: a person moving their own domain keeps their address, so
   on the target the organiser is the target account itself. RFC 6638's
   implicit scheduling acts for the organiser, so a target that ignored
   `SCHEDULE-AGENT=CLIENT` would mail the attendee. Event 1's organiser is a
   third party and cannot ask that question. Put event 4 on the source as an
   .ics with exactly these two lines, so that nothing replaces the organiser
   with whoever is signed in.

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

1. Create one mapping through *Start a migration*: source = the seeded source
   (see *Before the sitting*), with *Calendar* and *Contacts* ticked on
   *What moves?*; target = the Soverin connection from A, chosen under
   *Your accounts* for both on *Where does it go?*. One Soverin connection
   carries both (`TARGET_TYPE_DOMAINS`), so one mapping does the work.
2. **Note the mapping id** — step H needs it. It is in the migration page's
   URL (`/mappings/<id>`), or listed by `GET /api/migrations`.
3. Start it with *Start* on *Check, then start*, the screen *Start a migration*
   ends on. Later passes: *Trigger sync* on the *Migrations* list, or
   `POST /api/migrations/<id>/sync`.
4. While it runs, nothing else: a handful of DAV writes is the whole load —
   no load worth a provider's attention.

## E — the byte-check, through the published door

1. The owner opens Soverin's own calendar and contacts UI: the four events
   and three contacts are THERE, titles intact, events 1 and 4 showing their
   attendee.
2. Spot-read events 1 and 4 back over Soverin's CalDAV (any DAV client, or
   curl with the mailbox credentials) and check the attendee lines survived —
   neutralised in transport semantics, intact as data. The writer sets
   `SCHEDULE-AGENT=CLIENT` on every `ATTENDEE` and `ORGANIZER` line
   (`packages/shared/src/calendar-scheduling.ts`, ADR-0043). Write down
   whether Soverin kept it: a server that drops it on storage is a finding
   for 0105, and F's silence is what decides the verdict.
3. The audit log (`audit_log`, action `calendar.target_scheduling`) now
   carries one row for the mapping — the once-per-mapping record that the
   measurement preceded the first write. Its `capability` and `sentence` are
   the **scheduling verdict**, the first number this run exists to collect:
   **record both verbatim as a dated row in 0105.** If it says unmeasured,
   that is a finding too — unmeasured is not safe, and the writer
   neutralises regardless. The Test in A no longer shows the verdict, so
   this row is the only place to read it for a Soverin target: the
   permission report's *"What the target will do with what we write"*
   section looks for a CalDAV, Nextcloud or WebDAV target, and a `soverin`
   connection is none of those (`tenantTargetConduct` in
   `apps/api/src/routes/permissions.ts`).
4. **The update.** On the source, add a second attendee to event 4,
   `<TAG>-organiser2@ownpace.eu`, and run one more pass (D.3). Read event 4
   back as in 2: both attendees are there. Its silence is checked in F with
   everything else. Removing event 4 through the product is not part of this
   sitting: G removes by hand. 0141 T9's own sitting covers a removal.

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

1. Delete the seven migrated items from the Soverin box (the owner's own box,
   which exists to be written to) — through Soverin's UI or DAV.
2. Delete the seeded calendar and address book from the source.
3. What remains: the tenant, the connections, the mappings (they persist for
   the nightly), the audit rows, and the dated findings in 0105. No data, no
   residue, no mail owed to anyone.

## H — arm the nightly

The lane runs on the OTA stack's machine and signs in to OUR API with a
bearer token. **On the OTA stack that token has to come from the identity
provider.** The stack sets `JWT_ISSUER`, so the API verifies every token
against the provider's keys and no longer uses `JWT_SECRET`
(`selectAuthMode` in `apps/api/src/middleware/auth.ts`). The lane's *mint
mode* (`LIVE_TARGET_JWT_SECRET`, `LIVE_TARGET_TENANT`, `LIVE_TARGET_SUB`)
signs its own token with `JWT_SECRET`, as the managed smoke's `mint()` does,
and the smoke says of that: *"ON A PROVISIONED STACK THE API WILL NOT ACCEPT
WHAT THIS MINTS"* (`deploy/compose/smoke-managed.sh`). So this step uses
`LIVE_TARGET_API_TOKEN` and leaves the three mint lines out.

1. Into the OTA stack's persisted env (`$HOME/.persistent/ownpace-managed/.env`
   — the same file the managed gate restores; never the repo):

   ```text
   LIVE_CATCHALL_HOST=…    LIVE_CATCHALL_USER=…    LIVE_CATCHALL_PASSWORD=…
   LIVE_CONTROL_SMTP_HOST=…  LIVE_CONTROL_SMTP_USER=…  LIVE_CONTROL_SMTP_PASSWORD=…
   LIVE_TARGET_API_URL=http://localhost:3001
   LIVE_TARGET_MAPPINGS=<id>                  # from D — the migration page's URL
   LIVE_TARGET_API_TOKEN=<the token, below>
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
     `LIVE_TARGET_API_TOKEN` is:
     - **Whose.** The tenant owner's from A. For each mapping the lane calls
       `POST /api/migrations/<id>/sync` and names no organisation, so the
       API takes the person's only membership (`resolveTenant`). A person
       in two organisations on this stack is refused with *"This account
       belongs to 2 organisations. Name one in the x-ownpace-tenant
       header."*
     - **How it is made.** Sign in to the OTA stack's web app as that
       person, and copy the token the app holds, in the browser console:
       `localStorage.getItem('auth_token')`
       ([`managed-bring-up.md`](./managed-bring-up.md#where-the-token-comes-from)).
       It is the identity provider's ID token for that person. An access
       token for the same person is a different token, and the API refuses
       it.
     - **How long it lives.** Until its `exp` claim, which the identity
       provider sets; `managed-bring-up.md` calls it short-lived. In the
       same console, this prints the moment it ends:

       ```js
       const t = localStorage.getItem('auth_token');
       new Date(JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp * 1000)
       ```

       The lane sends the token as it is on every run and never renews it
       (`mintBearer` in `scripts/live-target-lane.ts` returns it unchanged).

2. Before the token ends, trigger **E2E (live target)** once by hand
   (workflow_dispatch) and read its verdict line: `live-target:
   control=arrived sweep=silent sync=1/1 silence=silent — PASS` is the lane
   earning its keep. Partial arming is a red that names the missing
   variables — that is the lane working, not failing. Write the verdict line
   in 0141's Status, with the stack's name.
3. **When the token ends.** Every run after that logs `sync: <id> refused —
   401 …` and ends `RED (sync <id> refused)`. Take the three `LIVE_TARGET_*`
   lines out of the file again. The lane then still sends the control,
   sweeps yesterday's tag (F.4's day after is one of those runs) and checks
   today's silence, and its verdict says `sync=off`. Put the lines back, with
   a fresh token, whenever the product half should be judged again.

   Keeping the product half armed night after night needs a token that
   outlives a night, and nothing in this repository makes one for the OTA
   stack today. A longer ID-token lifetime at the provider would apply to
   every sign-in on that instance. A lane that signs in by itself, as the
   managed smoke's `sign_in_as` does, is code nobody has written. Which, if
   either, is open question 10 in workplan 0141, and it is the owner's.
