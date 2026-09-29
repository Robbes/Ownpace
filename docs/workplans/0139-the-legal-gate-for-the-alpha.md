# Workplan 0139 — The legal gate for the alpha

> **In one line:** Legal gate for the alpha: `site/legal` placeholders filled and published, a lawyer's pass, alpha conditions, acceptance recorded at first sign-in, notices where data is collected, sub-processors, retention, account closure, breach procedure, `SECURITY.md`.

## Status — 2026-09-29 (update this block at the end of every session)

**2026-09-29, later still: the owner's answers to open question 4 and the demo's Stalwart**, on
branch `claude/ownpace-public-readiness-y7orc6-the-owners-answers-of-the-morning`, not merged.
Docs, comments and one guard's new cases; no behaviour changes, and nothing has run on the machine.

- **Open question 4, the acceptance record after an erasure: purged with the organisation**, as
  built. Asked *"The acceptance record after an erasure: it is currently erased with the
  organisation (open question 4)"*, the owner: *"Ok"*. `legal_acceptance` stays in
  `PURGED_TABLES`, and privacy §4.4 and §9 stand. Open question 4 and T3's row and section say so;
  so do `site/legal/README.md`, the hidden notes beside privacy §4.4 in both languages (comments;
  the rendered text is unchanged), `docs/rls-guide.md`, `docs/operator-runbook.md`, and the
  comments in `offboarding.ts`, `offboarding.unit.test.ts`, `legal-acceptance-under-rls.unit.test.ts`
  and managed migration 0032 (a comment; its SQL is unchanged). A member who leaves keeps their
  rows with the organisation until then, as built; that was not put to the owner on its own.
- **The demo's Stalwart's downloads: kept where it runs, which is not live.** Put to the owner in
  the second entry below (*Left on*): switch off its WebUI, spam-rule and ASN downloads, or keep
  them. The owner answered with questions: *"Do we need it. And where? Perhaps not in live but
  yes in OTA?"* Do we need it: the Stalwart itself, yes, as the demo's mail source and target,
  which the nightly gate migrates between; its three downloads, no, nothing here uses them
  (accounts are provisioned with `stalwart-cli`, and no SMTP port is published). Where: the OTA
  stack every night, the self-host end-to-end run and a developer's machine (`dev.yml`), which
  hold fixtures only, and not live. That is the owner's preference as written, so it stays as it
  is, downloads on. The item below, T5's row, `setup-stalwart.sh`'s header,
  `docs/managed-bring-up.md`, *Nothing phones home*, and the header of
  `scripts/a-service-that-phones-home.unit.test.ts` (a comment; its checks are unchanged) say so.
- **Not on live, as far as the scripts go.** `bootstrap-managed.sh` runs `setup-managed-demo.sh`,
  which starts this Stalwart, only in its demo phase and only with `--with-demo`; `deploy-live.sh`
  and `stand-up-live.sh` refuse the flag, and `bootstrap-managed.sh` refuses it on live's `.env`.
  The review of this branch found nothing guarding the demo phase's own skip: `deploy-live.sh` runs
  `bootstrap-managed.sh --from data`, which passes through that phase on every deploy, and taking
  the phase's `return 0` out left every guard green. `scripts/a-demo-on-a-real-address.unit.test.ts`
  now holds it (*Proved*, below). ⏳ **Follow-up**, a behaviour change and so not in this branch:
  `setup-managed-demo.sh` run by hand is not refused on live's `.env`; it should refuse the way
  `bootstrap-managed.sh` does (`stack_may_be_live`), with a case in the same guard.
- **A removed member's sign-in account** (0135 open question 13), the owner: *"Samen number of
  days"*, and, asked the same as which rule, *"7 days"*: removed 7 days after the removal, the
  window an erasure keeps. Built on branch
  `claude/ownpace-public-readiness-y7orc6-a-removed-member-goes-after-seven-days`, not merged;
  0135 records the answer there and is not touched here.
- **NetBird's sign-in (SSO) switched off**, by the owner, 2026-09-29 (*"NetBird sign-in (SSO) is
  turned off"*), the step the answer to (d) below chose (*Off everywhere at launch*). The message
  names no hosts, and nothing here has checked it from outside yet: the exposure probe's passing
  run is what shows every host, and it needs the repository variable `EXPOSURE_PROBE_LIVE_PORTS`,
  which is the owner's to set.
- **Review of this branch, fixed the same day.** Besides the two items above: the runbook says
  the record is erased with the organisation, not that nothing of it is kept (the copy before an
  update can hold it for at most 7 days, and the erasure receipt counts its rows);
  `site/legal/README.md` no longer cites open question 4 for a member who leaves, which its answer
  does not cover; and T3's and T5's rows say merged, as #1360 and #1357. T6's row still calls a
  removed member's account the owner's; the branch building that answer changes it.
- **Proved.** `scripts/a-demo-on-a-real-address.unit.test.ts` gains five cases (14 tests, was 9),
  run against the real `bootstrap-managed.sh` in a checkout of its own with the two demo scripts
  as stubs that log their call: `--only demo` without `--with-demo`, on live's `.env` and on the
  OTA stack's, says it skipped and runs neither; with `--with-demo` on the OTA stack's `.env` it
  runs both, so the stubs are the ones it calls; and no other function of the script names
  either, or `setup-stalwart.sh`. Red on two mutations, each restored: the demo phase's
  `return 0` taken out (2 failed, 12 passed), and a call to `setup-managed-demo.sh` added to
  `phase_data` (1 failed, 13 passed). Three mutations of what the answers keep, each red and
  restored: `legal_acceptance` taken out of `PURGED_TABLES` fails `offboarding.unit.test.ts`
  (2 failed, 16 passed); `cdn.jsdelivr.net` taken out of *Nothing phones home* fails the
  phones-home guard (1 failed, 37 passed); and `deploy-live.sh` no longer refusing `--with-demo`
  fails its Nextcloud row (1 failed, 37 passed), a refusal the demo's Stalwart rests on too.

**2026-09-29: review fixes to the three items below, on the same branch, not merged**, with `main`
merged in first (`b8629512`; this block's two new entries of 2026-09-28 conflicted, and both are
kept). 0132's entry of the same day has the whole record; for this plan:

- **Item 8, the NetBird sign-in check.** Two edges the probe got wrong: a redirect on the same name
  into NetBird's own pages (`/__netbird__/`) now fails as NetBird's page, not *"to another host"*,
  and a redirect with no `Location` fails as not the service, where it passed. Item 8 above says
  what is built and what is still the owner's; it stays open until the sign-in is off on all four
  and a dispatch of the probe passes.
- **ops-trust-proxy (b).** The API names the visitor only because the app's nginx appends to the
  header in `location /api/`, and the guard now holds that line and builds the header Express is
  given from it. The visitor's address, now the last field of every nginx line, is filtered out of
  the managed gate's public job log (`own-addresses.sh`, `<client-ip>`). `TRUST_PROXY` is 2 or 3
  and nothing else. The check on live reads the API's line and the nginx lines apart, and sends the
  forged header to the website too. The comment beside privacy §4.5, in both files, now says what
  is built.
- **ops-log-driver (a).** `json-file` is named Docker's default, and `local` a sibling that rotates
  by size. The breach procedure copies container output with `docker compose logs` before a deploy
  replaces it, where it read the journal, and the audit section points a collector at Docker's
  output. `stand-up-live.sh` refuses a machine whose driver is not `json-file` or `local`; the
  check on the machine now is still the owner's. T6's row and 0129's Status say so.
- **Counts.** The sign-in guard had 24 cases, not 25: the entry below is corrected. The fixes' own
  guards failed 28 of 387 first; 18 mutations each turned one red (0132).
- **`site/legal/README.md`**: the three items of *To build or to do* say what is built and what is
  still the owner's, and *«LOG_RETENTION»* says the step is out.

**2026-09-28: three items of the work list built: visitors' addresses in our own logs, the journald
step out, and the check that no NetBird sign-in answers (item 8)**, on branch
`claude/ownpace-public-readiness-y7orc6-the-visitors-address-from-netbird`, not merged, from `main`
at `96e737df`, before #1317 merged. The items are `site/legal/README.md`'s *To build or to do* on
#1317, and item 8 is #1317's, in the entry *the privacy policy (1.2) and the terms (1.3)
revisited*: *"No NetBird sign-in in front of the service (privacy §7's row, whose log names no user
ID): NetBird's sign-in (SSO) is on for the hosts NetBird serves ("No pin, but SSO on"), and by the
owner's choice ("Off everywhere at launch") goes off on `app.`, `id.`, `status.` and
`www.ownpace.eu` before the first invitation, a precondition for it. Checked from outside the NetBird
network: each host answers with the app or the site itself, not NetBird's sign-in page."* 0132's
Status block has the whole record; in short:

- **Item 8, the check.** The exposure probe (0132 T3 (c)), which runs on a GitHub-hosted runner,
  outside the NetBird network, asks each of the four names for the page a visitor asks first and
  fails a redirect to another host (NetBird's SSO), NetBird's own page (its password or PIN page),
  any other answer that is not the service, and no answer; `www.ownpace.eu` when it is on live's
  front. Guard: `scripts/a-sign-in-in-front-of-the-front-door.unit.test.ts`. **Still the owner's:**
  switching the sign-in off in NetBird on all four, then the dispatch that passes. Item 8 stays open
  until then; nothing here changes a rendered sentence.
- **ops-trust-proxy (b).** Both nginx logs record the address NetBird passes on as their last field,
  and live's `TRUST_PROXY` is 2, which `stand-up-live.sh` requires. Checked on live with one log
  line of each (0132 T3 (d)), once it stands. Guard:
  `scripts/a-visitor-every-log-called-netbird.unit.test.ts`. The comment beside privacy §4.5 says
  the app's nginx *"takes the real client address from NetBird's header"*: it records the header as
  a field of its own, and that comment follows when this branch meets #1317.
- **ops-log-driver (a).** The journald step is out of `docs/managed-bring-up.md`, including live's
  owner's steps, which now carry `docker info --format '{{.LoggingDriver}}'` (`json-file` or
  `local`) and how to undo a journald setting. **Still the owner's:** running it on the machine.
  Guard: `scripts/a-journal-that-outlived-the-container.unit.test.ts`.
- **Proved.** The three guards and three new cases of `a-first-bring-up-of-live` were written first
  and failed on `96e737df`'s code (24 of 24, 7 of 11, 4 of 54, 3 of 3); 21 mutations each turned one
  red. The counts and the gates are in 0132's entry.

**2026-09-29, morning: the Dutch texts say *migratie*, never *verhuizing*, for the lawyer's pass**
(0152 D6, the owner's word of 2026-09-28; the owner's answer 10 of 2026-09-29, *"Yes"*; by the
writing session, in 0131 §6's split). The Dutch privacy policy, terms and Alpha conditions said a
form of *verhuizen* 85 times. Each now says *migratie*, *migraties*, *migreren*, *migreert* or
*gemigreerd*, as the site and the app do. The English says *migration* already and is unchanged.

- **A word, not a meaning.** Singular and plural follow the English (*your migration* /
  *uw migratie*, *your migrations* / *uw migraties*), and a pronoun follows *de migratie*
  (*haar*, *ze*). The owner's earlier *"Verhuizing is plural in Dutch, so leave it as is"* (the
  second of the nine answers, in the entry of 2026-09-28 below) is met the same way: §11 says
  *uw migraties*, as the English does.
- **Where the old word did not mean a migration,** the sentence says what it meant:
  - the service moving to another host (Alpha §11, privacy §7 and §13) *gaat over* and is an
    *overgang*;
  - data that does not follow into a new service is not *meegenomen* (Alpha §11);
  - a household's migration is *een migratie voor uw gezin*, not *gezinsmigratie*, which in
    Dutch means family immigration (privacy §5, and §12's parent and child).
- **The compounds:** *migratieregister* (privacy §4.2 and §9, terms §11), *migratiegegevens*
  (terms §8), *migratietool* (privacy §8), *migratiedoel* (privacy §6).
- **Versions:** the texts are unpublished drafts, and the Alpha conditions are edited in place
  until the first tester accepts them, so no version number moves. The three Dutch texts'
  *Laatst bijgewerkt* is 2026-09-29. privacy.md's briefing says the Dutch now follows D6
  throughout.
- **The site's guard** (`site/site.unit.test.ts`, #1339) now reads the three legal pages too: it
  excused them until they followed D6.
- **For the lawyer:** whether *migratie* reads as intended in the defined terms and in §3's two
  roles (organisation and household) is one more item for the pass.

**2026-09-29, later: T5, the demo's Nextcloud left on after all**, a third commit on branch
`claude/ownpace-public-readiness-y7orc6-nothing-phones-home`, not merged; `main` merged in first.
Nothing has run on the machine.

- **Why.** E2E (managed) #215, the branch's run, failed in *Bring the stack up*: right after the
  demo's Nextcloud was recreated with the hook below, seed-dav's first calendar PUT answered HTTP
  500 (`ERROR: calendar PUT 1 returned 500`, no response body in the log). #216 on `main`
  recreated the same container without the hook, and seed-dav passed. The hook is the one
  difference. What in it broke the write, one of `updatechecker`, `appstoreenabled` and
  `has_internet_connection`, or its run before Apache at every start, is not known: the values
  it wrote in #215 are most likely still in `config.php` on the demo's volume, which the gate
  keeps between runs, so #216 may have passed with them in place. Nobody has looked on the
  machine.
- **What changed.** `deploy/compose/nextcloud-no-phone-home.sh` is removed, with its mounts in
  `managed.yml` and `dev.yml`. The demo's Nextcloud's three settings are **not** switched off in
  this change. This Nextcloud is the demo's DAV target on the OTA stack and the development one:
  it holds fixtures, never a tester's data, and it is not on live. Everything else the branch
  switches off stays: Trigger.dev's two PostHog halves and Prisma's checkpoint, Zitadel's service
  ping, ClickHouse's crash reports, MinIO's release check and Mailpit's.
- **The guard** (`scripts/a-service-that-phones-home.unit.test.ts`, 38 tests). The hook's cases
  are gone: reading it, checking it mounted and tracked as 100755, and the two runs against a
  stand-in `php`. Nextcloud's two rows moved from *switched* to a third list, *left on*, which
  the guard's rule now names: each row says what it sends and why it is left on, is pinned to
  `nextcloud:34-apache`, and holds it where no tester is (the bring-up starts it only with
  `--with-demo`, both live scripts refuse that, and no managed script names `dev.yml`), the first
  pass's check, back with a case of its own. No other row changed. Three mutations, each red and
  restored: `nextcloud` in the bring-up's default services, `deploy-live.sh` not refusing
  `--with-demo`, and `dev.yml`'s Nextcloud in no list.
- **Proved.** The guard: 38 passed. `pnpm exec vitest run --project unit scripts/`: 209 files, 3966 tests pass.
- **Docs**: `docs/managed-bring-up.md`, *Nothing phones home* (Nextcloud's row says *None yet*,
  *What is left on, and where* says why, and the hook's command and check are gone);
  `docs/operator-runbook.md`, *Upgrade*, step 5; the comments above both Nextcloud services.
- ⏳ **Follow-up**: switch the three off on the demo's and the development Nextcloud, with a check
  in the same change that the demo's DAV writes still work (seed-dav's calendar PUT at least),
  run on the OTA stack before it merges.

**2026-09-29: T5, the review's fixes to "nothing phones home"**, a second commit on branch
`claude/ownpace-public-readiness-y7orc6-nothing-phones-home`, not merged. Nothing has run on the
machine; the compose files are read, and Nextcloud's hook run against a stand-in, by the guard.

- **Prisma's checkpoint, missed on the first pass.** The webapp's entrypoint runs
  `prisma migrate deploy` at every start (`docker/scripts/entrypoint.sh` at v4.5.16; prisma
  6.14.0, a runtime dependency), and the Prisma CLI sends a checkpoint to `checkpoint.prisma.io`
  for every command it runs: version, OS, architecture, Node, CI, the command, hashes of the
  project's and the CLI's paths, the schema's providers and a stored random signature
  (`packages/cli/src/CLI.ts`, `utils/checkpoint.ts`; checkpoint-client 1.1.33, which forks the
  sender whatever its cache says). `CHECKPOINT_DISABLE: "1"` on `trigger-api`, the only thing
  either checks. The entrypoint's other children do not call out: pnpm 10.33.2 checks for its own
  update only on `install` and `add` (`pnpm/src/main.ts`), goose v3.27.1 has no network use of
  its own, and the dashboard agent's migration is plain drizzle-orm. The server's PostHog also
  identified the user (id, email, name) at every sign-in (`postAuth.server.ts`), not only at
  creation; the docs said less than it sent.
- **Nextcloud switched, not left on** *(taken out again the same day, in the entry above: with
  the hook, the demo's first CalDAV write answered 500 in E2E (managed) #215, so the three are
  not switched off in this change)*. The demo's Nextcloud comes up with the OTA stack every
  night (the gate's `--with-demo`), so "demo and development only" was no reason, and "`occ`
  settings this file cannot set" was wrong. A `before-starting` hook the image runs as www-data
  before Apache at every start set `updatechecker`, `appstoreenabled` and
  `has_internet_connection` to the boolean false, in `managed.yml` and `dev.yml`;
  `has_internet_connection` is what the announcements feed, the connectivity check and the
  lookup-server upload read (`stable34`). Not the reviewer's `*.config.php` mounted into
  `config/`: that makes the directory non-empty before the first install, and the image's
  entrypoint (`34/apache/entrypoint.sh`, `directory_empty`) then skips copying its own config
  files, `smtp.config.php` (the catcher, 0103) among them.
- **Left on, as the owner preferred on 2026-09-29: the demo's Stalwart** (v0.16.10, `docker run`
  from `setup-stalwart.sh`, on the OTA stack every night, in the self-host end-to-end run and on a
  developer's machine; not on live). In normal mode it downloads its WebUI from GitHub on first start and every 30
  days, its spam-filter rules from GitHub, and an ASN and country database from jsDelivr daily
  (`crates/common/src/manager/defaults.rs`, `SpamSettings` in `structs_impl.rs`). Downloads, not
  reports about anybody; they are objects in its datastore, so switching them off is new objects
  in the provisioning plan, which nothing here could run. Put to the owner: switch them off on
  the demo's Stalwart, a change to be run and watched on the OTA stack, or keep them as downloads
  on a stack that holds demo fixtures and never a tester's data. ✅ **Answered 2026-09-29: kept as
  it is where it runs, and not on live.** The owner: *"Do we need it. And where? Perhaps not in
  live but yes in OTA?"* The Stalwart itself is needed, as the demo's mail source and target;
  nothing here uses its three downloads. It runs on the OTA stack, in the self-host end-to-end run
  and on a developer's machine, and holds fixtures only. The scripted bring-up starts it only in
  its demo phase and only with `--with-demo` (`setup-managed-demo.sh`), which `deploy-live.sh` and
  `stand-up-live.sh` refuse and `bootstrap-managed.sh` refuses on live's `.env`; run by hand,
  `setup-managed-demo.sh` is not refused on live's `.env` yet (⏳ a follow-up, in the first entry
  above). That matches the owner's preference, so the downloads stay on and nothing changes.
- **The guard, tightened** (`scripts/a-service-that-phones-home.unit.test.ts`, 40 tests). A key
  with no value (`POSTHOG_PROJECT_KEY:`) reads as passed through from the shell or `.env`; YAML
  merge keys are applied as Compose applies them; every file ClickHouse merges from `config.d` or
  `conf.d` is read, wherever it is mounted from, `.yaml`, `.yml` and `.conf` included, and a mount
  it cannot read fails; the webapp is held to `WEBAPP_KEYS`, every key it may be given with the
  reason it reaches no third party, rather than to a list of third parties; a switched service may
  not take `env_file`, `extends` or an overlay; Nextcloud's hook is read, checked tracked as
  100755, and run against a stand-in `php` *(those cases went with the hook, above)*; Stalwart's pin and the doc that names its fetches are
  held. The bring-up check on `nextcloud` went with the *left on* list it served. Written first:
  6 failed, 34 passed (40) on the first pass's tree. Each regression the review found passes the
  first guard (33 of 33) and fails this one; 18 mutations, 17 red and restored, the 18th
  (`nextcloud` added to the bring-up's services) now moot, since Nextcloud is switched wherever it
  starts *(back, with the left-on list, above)*.
- **Docs**: `docs/managed-bring-up.md`, *Nothing phones home* (Prisma's row, Nextcloud's row and
  why a hook, *both rewritten above*, Stalwart named, the sign-in identify, and the command for a running stack: the pull
  sequence recreates `trigger-api` and `clickhouse`, not the identity provider, the object store,
  the catcher or Nextcloud); `docs/operator-runbook.md`, *Upgrade*, step 5; `setup-stalwart.sh`'s
  header.
- **Merged with main** after #1317: main's Status block and T5 row kept, these entries and the T5 row's addition put on top.

**2026-09-28: T5, nothing phones home (privacy §8; ops-telemetry (a), the owner: *"Switch it off
everywhere"*)**, built on branch `claude/ownpace-public-readiness-y7orc6-nothing-phones-home`, not
merged. Nothing has run on the machine; the compose file is read by a guard, not started.

- **The spec**, from `site/legal/README.md` on #1317, *To build or to do*: *"Telemetry off (privacy
  §8's negative; ops-telemetry (a)): `TRIGGER_TELEMETRY_DISABLED` for live and the test stack
  (`managed.yml`), and the sign-in service, ClickHouse and MinIO checked and switched off too."*
  Live runs the same `managed.yml` as the OTA stack, with no override file, so one change covers
  both, and no row of 0132 changes.
- **What each sent, read from upstream's source at the pinned version** (raw files from
  `raw.githubusercontent.com`; the docs sites were not needed). Trigger.dev v4.5.16: the server's
  PostHog on user, organisation and project creation, with the user's email and name
  (`telemetry.server.ts`; *and at every sign-in, and Prisma's checkpoint beside it: corrected
  2026-09-29, above*), and the dashboard's PostHog in the browser, identifying the signed-in
  user by id and email (`usePostHog.ts`), under Trigger.dev's own project key
  (`POSTHOG_PROJECT_KEY`'s default in `env.server.ts`). **`TRIGGER_TELEMETRY_DISABLED` stops only
  the first**: nothing else reads it, and the browser's half starts whenever the key is not empty.
  The supervisor (`apps/supervisor/src/env.ts`) has no analytics. Zitadel v4.19.2: a daily
  *service ping* to `zitadel.com`, with each instance's id, creation date and domains and the
  count of users, organisations and projects, **on by default** (`cmd/defaults.yaml`); it is in
  every v4 release (read at v4.0.0, v4.6.2, v4.17.1), so the OTA stack's provider has sent it
  since it first started, as far as the machine let it out. `Telemetry.Enabled` ships false.
  ClickHouse 26.2.19.43: crash and logical-error reports to `crash.clickhouse.com`, **on in the
  `config.xml` the image ships**, off in the code's default. MinIO 2025.5.24: a release check to
  `dl.min.io` at every start, its User-Agent carrying OS, architecture, version and CPU;
  call-home ships off. Mailpit v1.31.1 (the test stack's catcher): a release check to GitHub when
  its page asks for the server's info.
- **The switches**, each a literal in `managed.yml`, so no `.env` can empty one:
  `TRIGGER_TELEMETRY_DISABLED: "1"` and `POSTHOG_PROJECT_KEY: ""` on `trigger-api`;
  `ZITADEL_SERVICEPING_ENABLED` and `ZITADEL_TELEMETRY_ENABLED` `"false"`; a new
  `deploy/compose/clickhouse-no-crash-reports.xml` in ClickHouse's `config.d`; `MINIO_UPDATE` and
  `MINIO_CALLHOME_ENABLE` `"off"`; `MP_DISABLE_VERSION_CHECK: "true"`.
- **Every other service, and why it needs no switch**, is a row of the guard: PostgreSQL,
  PgBouncer, Redis, the registry, the Docker socket proxy, the supervisor, busybox, nginx, the
  status page, our own API, web app and appliance; Caddy's `tls internal` is held as a switch,
  since without it Caddy asks a public certificate authority. *(Corrected 2026-09-29, above:
  the demo's Stalwart is read and put to the owner. Nextcloud was switched off by a hook, which
  was taken out again the same day, so it is left on, as here, until a follow-up.)*
  **Left on:** Nextcloud's update
  check, app store and connectivity check, in `managed.yml` (the demo) and `dev.yml`. They are
  `occ` settings inside the instance; it holds fixtures and never a tester's data, and it starts
  only with `--with-demo`, which both live scripts refuse. Switching them off on the demo is the
  owner's call, a change to the demo's setup. Outside every compose file and not read: the demo's
  Stalwart (`docker run`).
- **Guard**: `scripts/a-service-that-phones-home.unit.test.ts`, written first. On the unchanged
  tree: 5 failed, 28 passed (33), the five switched services, each naming its missing switch. After
  the change: 33 passed. A switched row names the image its default was read at, so a new pin
  fails it until somebody re-reads that version's defaults. 14 mutations, each red and restored:
  each switch removed, emptied into `.env` or turned on, the ClickHouse mount removed, Zitadel's
  pin moved, a new unclassified service, Nextcloud in the default bring-up, `deploy-live.sh` no
  longer refusing `--with-demo`, a Caddy site without `tls internal`, a webapp third-party key, and
  an overlay setting a switch.
- **Proved.** `npx vitest run --project unit scripts`: 206 files, 3759 tests pass (a first run
  under load lost `package-appliance.unit.test.ts`'s four running-payload cases to a refused
  connection; alone it passes, 29 of 29). `pnpm -s typecheck` and eslint on the guard are clean.
- **Docs**: `docs/managed-bring-up.md`, *Nothing phones home* (the table, what is left on, and the
  check on a running stack); `docs/operator-runbook.md`, *Upgrade*, step 5.
- **Not done here.** Privacy §8's comment and the README's *Telemetry off* item on #1317 still
  say it is not true on live: it becomes true when live stands up, or deploys, from a tag that
  contains this, and the check in *Nothing phones home* is what shows it.

**2026-09-29: T6's daily script and T7's step, reviewed and fixed in 0135 T8**, not merged, on
branch `claude/ownpace-public-readiness-y7orc6-accounts-kept-that-were-let-in`. Recorded here from
0135's Status.

- **An account that was let in is kept.** The Team page's removal now records `member.removed` in
  `audit_log`, as `operator.sh leave` already did. `idp-strays.sh` keeps every subject so recorded,
  so the daily run no longer takes a removed member's used account for one *"that we never let
  in"* (privacy §9's row).
- **For the owner** (T6, below; 0135 open question 13): a removed member's sign-in account is kept
  until the organisation is erased, or removed after N days. The owner decides, and privacy §9 then
  names it. Until then it is kept.
- **Nothing is removed while the database names nobody:** `--remove` and T7's
  `--subject … --remove` refuse while `platform_operator` has no row. Only our own organisation's
  accounts with no role at the provider are weighed, and the provider's listing is read to its end
  or the run refuses.
- **A second commit, from that fix's review** (0135 Status, *later*): a role at the provider is
  read as the provider counts it, the Team page's record names the row it deleted, and a count
  below the accounts given is refused. After a reset of live's database that keeps the provider's
  accounts, the runbook turns the daily duties off until the members are back.

**2026-09-29, latest: T3's review, fixed**, same branch, with `main` merged in at `774b8310`
(the runbook took a section on each side, both kept) and again at `ab7ffc3c` (the Dashboard
went on `main`, and the gate's import stayed; this Status block took an entry on each side).
Fourteen findings; every one applied, none rejected. Guards first, each shown failing before the change (counts below).

- **Nobody accepts a draft** (major). Privacy 1.2 and terms 1.3 are drafts, and the owner's
  final-text pull request keeps the number (`site/legal/README.md`, *What a final Version line
  looks like*). An acceptance of draft 1.2 would have been recorded as one of final 1.2, whose
  words may still change, and never asked again; and live already runs `OWNPACE_STAGE=alpha`,
  so the first deploy would have asked testers to accept texts the public site refuses to
  publish. Option (b) of the review: `LEGAL_DRAFTS` in `legal-versions.ts` says which texts are
  drafts, held to the *Version* lines by the site build's own `DRAFT_WORDS`, and while any is,
  `acceptanceAsked` is false: `GET /api/me` reports nothing, no door refuses, and
  `POST /api/me/acceptance` records nothing (409 `acceptance_not_asked`, new, in the spec), as
  with the switch off. The API's start log says which: `[api] OWNPACE_STAGE=alpha, but privacy
  1.2 and terms 1.3 are drafts: nobody is asked …`. So **live may take this commit before the
  draft markers come off; it asks nobody until the release that carries the final texts**, and
  the first invitation waits for that release (the legal README's *To build or to do*). Option
  (a), a `1.2-draft` number, was not taken: the screen links the published site, which serves no
  draft, so a tester would have been asked to accept a text they could not read.
- **A final text keeps its words under its number.** `ACCEPTED_WORDS` in the version guard pins
  a digest of each final text (outside HTML comments, white space collapsed) under its number:
  the Alpha conditions 1.0 in both languages today. A final text whose words change under the
  same number fails, and the message says to give it a new number, unless no text has been
  asked for yet (some text still a draft). The legal README and the runbook say the same: the
  final-text pull request sets `LEGAL_DRAFTS` and pins the words; after that, a change is a new
  number.
- **Not now signs out of the sign-in service too** (major, found twice). The nav's sign-out,
  which ends the issuer's session as well (2026-09-01), moved into `components/SignOut.tsx`
  (`useSignOut`), and both buttons use it; `oidc.ts` gained `leaveForIssuer` so the guard can
  see the end-session address followed. Dutch *"Nu niet, uitloggen"*, as the nav says.
- **A door's refusal brings the screen up at once** (major). The client's response interceptor
  reports a 409 `conditions_not_accepted` (`services/conditions-refused.ts`); the gate reads
  again and shows the screen, keeping the page underneath (`display: none`, still mounted), so
  a half-filled form is there after accepting. Every door shows the refusal in the reader's
  language (`acceptance.refused`, `conditionsRefusal`: the connection forms, the wizard's test
  and create, the grant-link panel). The API's sentence now holds wherever it is read: *"Nothing
  was stored: accept … first. The app shows them now; if it does not, reload the page. Then try
  again."*
- **Only a bundle built for the Alpha asks on load** (minor, found twice). The gate asks
  `GET /api/me` on load only where `VITE_OWNPACE_STAGE=alpha` (`isAlpha`, held in step with the
  API by `an-alpha-both-halves-know-about`); any other managed bundle renders its pages as
  before, with no wait and no page withheld when that read fails, and starts asking at the first
  door that refuses. So *"with the switch off, nothing changes"* is true of the web app too.
- **A grant link waits for the texts** (minor). `POST /api/migrations/{mappingId}/links` asks
  `refusedUntilAccepted` for a grant link (not a progress link, which grants nothing), before
  anything is read or written; pinned in the sweep's `CHECKS_BY_FILE`, and `grant-ending.ts`'s
  excuse now names that check rather than the migration's creation. The spec's 409 for the
  route names `ConditionsNotAccepted`.
- **A member who leaves** (minor): decided as the organisation's record, like the audit log.
  Removing a member deletes nothing in `legal_acceptance` (no key to `tenant_member`, on
  purpose), the rows go with the organisation's erasure, and a member invited back is not asked
  again for a version they accepted there. Privacy §9 has a row for it in both languages (for
  the owner's review), and open question 4, `docs/rls-guide.md`, the runbook, the migration's
  and `offboarding.ts`'s comments say so; `legal-acceptance-under-rls` has two cases for it.
- **The screen itself** (minor): Dutch *aanvaarden* throughout, the texts' own word; the heading
  *"The texts have changed"* / *"De teksten zijn gewijzigd"* and a *"new version"* / *"nieuwe
  versie"* marker inside each changed text's link; a `main` landmark; the failures it can meet
  (a fault on our side with its reference kept, no answer, 403) in the reader's language
  (`acceptanceFailure`); 409 `acceptance_not_asked` reads again and gives way to the page.
- **The language on the record** (minor): privacy §4.4 says *"in which language"* / *"in welke
  taal"* in both drafts, and so does the screen; listed in the legal README's work list for the
  owner's review.
- **The UI smoke** walks the refusal path now: the bundle it builds is not an Alpha one, so it
  asks nothing on load, and the case answers the migrations list's read with the refusal, meets
  the screen (links, `main`), accepts, and gets the page back.

Proved. Written first and red on the branch head before the change: the version guard 7 of 23;
the credential sweep 8 of 23; `link-routes.unit` 1 of 34; the web guard 13 of 24; the
integration guard 4 of 15 on a throwaway Postgres (`scripts/local-pg.sh`, own port). The two
member-removal cases pin a decision the code already kept, so they passed at once; mutation 16
below shows they bite. After the change: `pnpm typecheck` clean; ESLint on
the changed files, no problem; `vitest --project unit` over `apps/api`, `packages/managed`,
the ledger's schema guard and the appliance's leakage guard, 148 files and 1958 tests; over
`scripts` and `site`, 211 files and 3898 tests; `--project unit-browser` over `apps/web`, 125
files and 2332 tests; on the throwaway Postgres, the acceptance guard with `me`,
`connections-usage`, `connection-delete-revokes`, `create-mapping`, `a-migration-past-the-cap`,
`access-requests`, `a-report-under-row-security`, `members` and `operator-links`, 10 files and 87
tests; `pnpm test:ui` 20 of 20 (a first run lost one case, *SENDS API REQUESTS SAME-ORIGIN*, to
requests of the sign-in's landing page aborted by the harness's own next navigation,
`net::ERR_ABORTED`, on a loaded machine, as the entry below saw once; the rerun passed whole).
The indexes regenerated with `--write`; the workplan, lessons and ADR `--check`s pass. Again
after `main` was merged in at `ab7ffc3c`: `pnpm typecheck` clean; ESLint on the merged files, no
problem; `--project unit` over the same four and `scripts` and `site`, 355 files and 5791 tests;
`--project unit-browser` over `apps/web`, 127 files and 2428 tests; `pnpm test:ui` 24 of 24; on
the throwaway Postgres, the acceptance guard with `me`, `create-mapping`, `members` and
`operator-links`, 5 files and 66 tests.

Sixteen mutations, each red (`mutate2.py` in the session's scratchpad, one change at a time,
the file restored after each):

| # | Mutation | Guard | Red |
|---|---|---|---|
| 1 | `LEGAL_DRAFTS.privacy` false while `privacy.md` says draft | `scripts/a-version-the-tester-accepted` | 2 of 23 |
| 2 | `acceptanceAsked` ignores the drafts | `no-credential-stored-before-the-conditions` | 4 of 23 |
| 3 | `POST /api/me/acceptance` records while nobody is asked | the same | 2 of 23 |
| 4 | the grant-link check taken out | the same, and `link-routes.unit` | 3 of 57 |
| 5 | a word of the final `alpha.md` changed under 1.0 | `scripts/a-version-the-tester-accepted` | 1 of 23 |
| 6 | the sign-out leaves the issuer's session | the web guard | 1 of 24 |
| 7 | every managed bundle asks on load | the web guard | 2 of 24 |
| 8 | the client does not report the refusal | the web guard | 2 of 24 |
| 9 | the page unmounted behind the screen | the web guard | 1 of 24 |
| 10 | the changed text not marked | the web guard | 2 of 24 |
| 11 | a failure shown in the server's English | the web guard | 1 of 24 |
| 12 | the screen no `main` landmark (`role="none"`) | the web guard | 1 of 24 |
| 13 | the Dutch button *accepteren* | the web guard | 3 of 24 |
| 14 | the doors' refusal back in the server's words | the web guard | 1 of 24 |
| 15 | the spec without `AcceptanceNotAsked` | `no-credential-stored-before-the-conditions` | 1 of 23 |
| 16 | a trigger deleting a removed member's rows | `legal-acceptance-under-rls` | 2 of 16 |

**2026-09-29, latest: review fixes to the copy before an update (T6)**, on the same branch,
`claude/ownpace-public-readiness-y7orc6-one-copy-before-each-update`, not merged. Nothing has run
on the machine; the scripts have run only against the stand-ins in their guards, and the
rollback's new step against two PGlite databases.

- **`main` merged in first, not rebased.** The branch was cut before #1317 (merged 2026-09-28,
  `df74a08f`), and this plan conflicted with it in the Status block and the task table.
  `main` at `0bcbc255` was merged into the branch (`b2986866`), both entries kept, the way
  `scripts/commit-convention.mjs` documents for a conflict; the session was not allowed to
  rebase. The entry below now names #1317 as merged.
- **The proof is the last deploy's.** `delete` (and `take`, which refuses a proven copy) read
  the LAST line of `deploys.log` at or after the copy's time, of either outcome, and require it
  to say `took`; the hold and the passes are asked about that line's time. Before, a `took`
  followed by a `did-not-take` counted as proven: lifting the hold after the did-not-take (the
  exposure check, say) and one pass on that checkout, and `delete` removed the only copy of
  what ran before.
- **A rollback no longer brings back what was erased.** Restoring the copy undid everything
  erased or deleted after it: an organisation closed after the copy came back open, one erased
  came back whole, the `erasure_record` rows written since were lost with the rest of that
  database, and a deleted connection with its credential, a deleted migration, person or
  membership, a withdrawn grant's token and a removed sign-in account all came back. New: `copy-before-update.sh since`, run
  before the restore, reads (SELECTs only) every organisation with its status and closure, every
  erasure record, the ids of every connection, migration, person and membership, and each
  withdrawn grant, and writes `since-the-copy-<stamp>.sql` into the copy's directory: ids and
  dates, no name, address or credential. Applied after the restore, in one transaction, it
  closes each organisation erased since and makes it due at once for the hourly purge, puts
  every other organisation's status and closure back as they were, restores all erasure
  records, deletes again what was deleted, takes a withdrawn grant's token again, refuses a
  database none of whose organisations it lists, and prints the `idp-strays.sh --subject …
  --remove` lines for the sign-in accounts to remove once the purge has run. The runbook's
  rollback has eleven steps now (4, 6 and 10 are new).
- **The texts #1317 merged say what is built.** `privacy.md`'s and `privacy.nl.md`'s NOT YET
  TRUE comments for the copy and the drill, `site/legal/README.md`'s two items and `alpha.md`'s
  briefing: built, and what is still to do (live runs a tag that carries it, with the daily
  duties' timer; the rollback run once on the test stack). The item *What needs code or machine
  work* below has a dated note.
- **The copy is never kept past day 7, and nothing takes one that nothing deletes.** The
  backstop deletes the copy once it is older than 6 days **less an hour** (a run that starts
  late, after the token duty's up to 20 minutes, still deletes it before its seventh day ends);
  the texts that said it *"never reaches day 7"* say *never past* it. `take` refuses while
  `systemctl --user is-active ownpace-box-duties.timer` fails, and 0134 says T0's daily look
  stays for a copy left there while the timer is off.
- **`take` refuses a kept copy the next daily run deletes**, and applies the backstop's rule
  first (a copy past it goes, as the backstop would, and a new one is taken). The rollback's own
  deploy, of the release the copy holds (its note's `from=`), is let through on that last day:
  refusing it would leave the restored databases under the new release's code.
- **A dump by hand goes by its own age.** The copy is as old as its note; every other file in
  the directory goes alone once it is past the limit. A copy taken beside an old dump is no
  longer old with it.
- **The directory is a directory.** `take`, `delete`, `expire` and `since`, and `dump-idp.sh`
  and `trigger-version.sh` on live, refuse a symbolic link there before any docker call: `find`
  does not follow one it starts on, so the backstop saw no copy behind it.
- **`deploy-live.sh` refuses a tag without the scripts live is kept by**: `deploy-live.sh`,
  `exposure-check.sh`, `box-duties.sh`, `stack-kind.sh` and `copy-before-update.sh`, the list
  now named once in `release-tag.sh` (`release_tag_carries`) and asked by `stand-up-live.sh`
  too, in its words. `v0.1.0-rc.1` carries none of them. A tag without `exposure-check.sh` is
  now refused before the checkout (exit 1) instead of not taking (exit 3).
- **Guard gaps closed.** A kept copy and a `take --trigger` that fails leaves it byte for byte;
  a hand dump survives a fresh take that fails; with two deploys that took, the later one's time
  is the one asked. `--trigger` for a `-` base, a base this clone lacks, a tag with no readable
  pin, and a base other than HEAD with another pin. `dump-idp.sh` and `trigger-version.sh` on a
  slip of live's marker (`STACK_KIND = production`).
- **Proved, guard first.** `one-copy-before-each-update`: 25 new or changed cases were red on
  the branch's scripts (85 in all), and the rollback's last-day case red on its own after them;
  `a-deploy-from-a-named-tag` and `one-rule-for-a-release-tag`: 5 of 154 red (the tag's
  scripts). The guard-gap cases were green on the old scripts, as they should be, and are shown
  red under the mutations below. With the change every guard in `scripts/` and the site's
  tests pass: 211 files, 3986 tests. Twenty-nine mutations, each restored after, each turned a
  guard red: the proof by the last `took` line with a `did-not-take` after it ignored, or by the
  first line; a failed take removing every entry; no margin; no timer check, or the system
  manager asked instead of the account's; a last-day copy kept, or the rollback's deploy refused
  on it; take not applying the backstop first; no file by its own age, or the copy as old as
  its oldest file; a linked directory followed by `copy-before-update.sh`, `dump-idp.sh` or
  `trigger-version.sh`; `since` not closing an erased organisation, applied to a database it
  does not list, leaving a deleted connection, keeping a withdrawn grant's token, dropping the
  erasure records, leaving a reopened organisation scheduled, or not checking the superuser (that
  one survived the first guard, whose answer failed the shape check first; the case now answers
  with a row of the right shape); `stack_is_live` in `dump-idp.sh` or `trigger-version.sh`; the
  four `--trigger` fail-safes; `deploy-live.sh` not asking what the tag carries; `box-duties.sh`
  left out of the list. The eight regressions the review named as guard gaps (the first took
  line, every entry removed, the four fail-safes, the two `stack_is_live`) stay green on the old
  guards with the old scripts, and are red on the new ones. A case comparing two `deploys.log`
  times computed its expected time a second time and could cross a second under load; it now
  compares the times it wrote.
- **Not true yet, or not built.** The rollback has not been run on a stack; `since` is
  rehearsed on PGlite with both chains, not on Postgres 16. The audit log's entries after the
  copy are not brought back. A sign-in account removed by hand in the provider's console after
  the copy has to be removed again by hand. The timer check asks the account's user manager,
  so `deploy-live.sh` must run from a session of that account (`systemctl --user` answers
  nothing under `sudo -u`). Nobody is told on the copy's last day but the journal (0142). The 6
  days are a constant beside `BACKUP_RETENTION_DAYS=7`, not read from it.

**2026-09-29: T6, the support screens' searches and downloads kept a year, then deleted daily
(privacy-search-records (a))**, on branch
`claude/ownpace-public-readiness-y7orc6-searches-kept-a-year`, not merged. `site/legal/README.md`'s
*To build or to do* said: *"a daily duty deletes those log records older than 12 months, over the
owner's connection, … Not built."* Nothing has run on a machine.

- **`deploy/compose/support-read-prune.sh`** deletes the `support_read` rows with no organisation
  (`tenant_id IS NULL`) recorded more than 12 months ago, and nothing else: a search by address
  (`people`), a download of the audit log (`audit_export`), the organisation list (`tenants`), the
  invoices kept after an erasure (`retained_invoices`), a log page not filtered to one organisation
  (`log`). A row that names an organisation, on any screen, goes with that organisation's erasure.
  Without `--delete` it counts. It runs `psql` as the database's owner in the stack's own
  container, because `app_user` cannot delete from the log: managed migration 0009 grants it
  `SELECT` and `INSERT` on the log and revokes `UPDATE` and `DELETE`, and its forced row security
  has no `DELETE` policy. The purge of closed organisations deletes an erased organisation's rows:
  on 2026-09-29 as the owner, since every Trigger.dev run was then given the owner's URL; after
  0138 T3 step 2 as the tasks' system role, `ownpace_system`, whose grant on the log is `SELECT` on
  `tenant_id` and `DELETE`: it can pick rows by organisation and never by their age, though it
  could delete every row with no organisation at once, and the purge is the only task that deletes
  there. The 12-month prune picks rows by age, so it stays at the machine on the owner's
  connection. Before it counts or deletes it asks, in the same call, whether its connection
  passes row security, and stops if not: an owner that is neither a superuser nor `BYPASSRLS`
  would delete nothing and say "deleted 0" every day. It prints a count.
- **Live runs it daily**: `box-duties.sh`'s seventh duty, `searches`, `--delete`, after `strays`;
  the service unit's `TimeoutStartSec` goes from 130 to 150 minutes, for seven duties of at most
  20 minutes each. It runs once live's timer is installed (the owner copies the two units again
  and reloads them). The runbook gains *Searches and downloads on the support screens*;
  `managed-bring-up.md`'s duty table and unit copy, `site/legal/README.md` and privacy §9's
  comment, in both languages, say it is built.
- **Proved by** `a-search-kept-past-its-year` (13 cases, 11 red before the script; the two about
  the migrations' grants true already), `a-search-kept-a-year-a-real-database-answers` (4 cases on
  a throwaway Postgres with both chains, all red before: a read with no organisation 13 months and
  400 days old goes, on each screen that records one; one 11 months old, one a day short of 12
  months, and one naming an organisation, however old and on whichever screen, stay; an owner
  bound by row security stops before anything; `app_user` cannot delete or change a row), and
  `a-duty-the-gate-used-to-do` (seven duties, 15 red before the wiring). Ten mutations, each
  caught: old rows kept (24 months), young rows deleted (1 day), a row naming an organisation
  deleted, `app_user` in place of the owner, no flag deleting, the row-security check left out, an
  answer that is not a count accepted; and in the wiring, the duty left out, run without
  `--delete`, and the unit's 130 minutes kept.
- **Beside 0138 T3 step 2 (#1358), which gives the tasks' system role `SELECT (tenant_id), DELETE`
  on the log** so the purge can delete an erased organisation's rows. The guard *no migration grants
  DELETE on it* would have failed once that merged (a trial merge of the two branches: 1 of 13 red),
  and six places said that the app, rather than `app_user`, could not delete from the log, which
  that step makes partly false; the script's header also called the owner's the only connection that
  may, while every Trigger.dev run was then given it too. The guard now says what it means: *no
  migration lets `app_user` or `PUBLIC` delete from it or change it* (no `DELETE`, `UPDATE`,
  `TRUNCATE` or `ALL`, by name or on every table in the schema, and no `DELETE` or `ALL` policy, a
  policy with no `FOR` counting as `ALL`), and *any other role a migration grants on it may read
  only its organisation column, and delete*, so none can pick a row by its age. A new pair, *every
  place that says why this runs at the machine says who else may delete*, reads the script,
  `box-duties.sh`, the runbook, `managed-bring-up.md`'s duty row, this entry, `site/legal/README.md`
  and privacy §9's comment in both languages: 2 of 16 red before the rewording, on this branch and
  on the trial merge alike; 16 of 16 green after, on both. On the trial merge, 13 mutations of the
  migrations each turn it red (`DELETE`, `UPDATE`, `TRUNCATE` or `ALL` to `app_user` or `PUBLIC`,
  one listing both grantees, one quoted, one on every table; the system role given the whole row,
  `at` beside `tenant_id`, or `INSERT`; a `DELETE` policy and one with no `FOR`), and 4 of the docs
  (the old phrases put back, the step's name taken out). A throwaway Postgres with the merged chains
  answers the same: `app_user` has no `DELETE`, `UPDATE` or `TRUNCATE`; `ownpace_system` has
  `DELETE` and `SELECT` on `tenant_id` only, deletes by organisation, and is refused (`permission
  denied for table support_read`) a delete by age. `a-search-kept-a-year-a-real-database-answers`
  passes 4 of 4 on this branch and on the merge.
- **Review of that fix, the same day.** `main` merged in first (`f2e028d0`), not rebased: #1361 made
  `box-duties.sh`'s second duty `copies` in place of the drill, so `searches` stays the seventh, and
  two counts in `a-duty-the-gate-used-to-do` went from six to seven. Four holes the review found,
  each closed:
  - *The grant reading let a `GRANTED BY` through.* `GRANT DELETE ON public.support_read TO app_user
    GRANTED BY CURRENT_USER` read as the role `app_user granted by current_user`, which other roles
    may be, and the guard stayed green. It now strips `GRANTED BY` and `GROUP`, reads `ALL TABLES IN
    SCHEMA` with more than one schema, and fails on a grantee it cannot take for one name instead of
    letting it by as another role.
  - *A quoted policy name with spaces was not read.* `CREATE POLICY "support read delete" ON
    public.support_read FOR DELETE …` passed. The name may now be quoted, a `CREATE POLICY` on the
    log that the reading cannot parse fails, and both of 0009's policies must be read.
  - *The system role's grant was said to decide what it deletes for.* On a throwaway Postgres with
    #1358's migration (the review's, and again here, rolled back), `ownpace_system` is refused a
    delete by age, but `DELETE … WHERE tenant_id IS NULL` and a bare `DELETE` both run: the grant
    stops it from picking rows by age, not from deleting every row with no organisation at once. The
    eight places now say that `app_user` cannot, that the system role can, for the purge, and that
    its grant lets it pick rows by organisation, never by age; the script, the runbook and this
    entry add that it could delete every row with no organisation at once and that the purge is the
    only task that deletes there. Nothing but the purge's code keeps another task that holds the
    role from doing it.
  - *The owner's URL sentence had nothing making it go.* The script's header and the runbook say
    every Trigger.dev run is given the owner's URL as `DATABASE_URL`, true on `main` today and false
    once #1358's `set-task-env.sh` uploads `SYSTEM_DATABASE_URL` instead. A new case, *says a
    Trigger.dev run receives the owner's URL only while set-task-env.sh uploads it*, reads that
    script: whichever of #1358 and this branch lands second is red until the sentence goes. This
    entry says it in the past tense, with the date. The script's inline comment and the privacy
    comments are re-wrapped.
- **Proved.** Guard first: 1 of 17 red on this branch (the new *never says …* phrase) and 2 of 17 on
  a trial merge with #1358 (that and the owner's URL); after the rewording 17 of 17 on this branch,
  and on the trial merge 1 of 17, the owner's URL, as meant, and 17 of 17 once that sentence is
  taken out there as the second to land would. On that tree, 13 migration mutations each turn it
  red: `app_user` given `DELETE` with `GRANTED BY`, with `WITH GRANT OPTION GRANTED BY`, quoted with
  a quoted grantor, as `GROUP app_user`, by name, beside another grantee, and through two schemas;
  `PUBLIC` in lower case; a `DELETE` policy with a quoted name holding spaces, a quoted policy with
  no `FOR`, and one `AS PERMISSIVE FOR ALL`; the system role given `at`, or `UPDATE (tenant_id)`.
  The last round's guard stayed green under 6 of them (the three `GRANTED BY`, `GROUP`, both quoted
  policies and the two schemas). Five of the docs each turn it red: the old *only for* phrase back
  in the runbook, `box-duties.sh` and `privacy.nl.md`; *never by age* taken out of the bring-up's
  row; the owner's URL sentence back on the merged tree. With the change,
  `a-search-kept-a-year-a-real-database-answers` passes 4 of 4 on this branch, and every guard in
  `scripts/` and the site's tests pass: 212 files, 4004 tests.

**2026-09-29, night: T7's identity-provider step and T6's daily script, built by 0135 T8 (0131 §6,
group M3, its step 7)**, merged as #1344 (`0bcbc25`) and #1345 (`a4885a5`). Recorded here from
0135's Status.

- **T7, the identity provider's account.** `deploy/compose/idp-strays.sh --subject <sub> --remove`
  removes one tester's sign-in account at any age, and refuses while the account is still a member
  anywhere, an operator, or holds an open access request or invitation. The runbook's *Tenant
  offboarding* §4 uses it, where the owner removed the account in the console.
- **T6, accounts nobody let in** (ops-unadmitted-signin-cleanup (a)). Live's daily duties remove
  them once a day, older than 30 days by the provider's own creation date, and at most 20 at a
  time: more than 20 removes none and fails the duty, for a person to look. It runs once live's
  timer is installed (the owner copies the two units again and reloads them). Privacy §9's row
  keeps its draft marker until live's first run.
- **Still open,** as 0135 T8 says: whether removing a user at the provider also removes the
  personal data in that user's earlier events.

**2026-09-28, later still: T3 built, a text accepted with its version, before the first connection**,
on branch `claude/ownpace-public-readiness-y7orc6-a-text-accepted-with-its-version`, from `main`
at `bf0cbb19` (the texts of #1317: privacy 1.2, terms 1.3, the Alpha conditions 1.0), not
merged. The owner decided it the same day (terms-acceptance-route (b), *"Build the in-app screen
first"*): *"People that are accepted in the Alpha do need to create a login for the app,
accepting fits in there and should record what time/version the accepted of what document."*

- **The record.** `legal_acceptance`, managed migration 0032: organisation, subject (the
  signed-in person as `tenant_member.user_id` holds them), document (`alpha`, `privacy`,
  `terms`), version, language (`nl`, `en`) and `accepted_at`. One row per person, text and
  version (a unique key), so a new version is a new row beside the old one and a repeat adds
  nothing and keeps the first time. Row security forced; a SELECT policy and an INSERT policy on
  the tenant, and the insert must name a member of that tenant; `app_user` has INSERT and SELECT
  and UPDATE and DELETE are revoked from the baseline's default, with no policy for either, so
  not even an organisation's own row can be changed or deleted on the request path. CHECKs hold
  the document, the language and a bare version number.
- **The versions.** `LEGAL_VERSIONS` in `packages/managed/src/legal-versions.ts` (`alpha` 1.0,
  `privacy` 1.2, `terms` 1.3), because the app may not import `site/legal/`.
  `scripts/a-version-the-tester-accepted.unit.test.ts` holds them to the *Version* lines of the
  six files, read with the site build's own `versionLineOf`. A draft line compares by its number:
  `1.2 (draft — not yet published)` is 1.2, since the draft words say whether the site may
  publish the text, which the site build refuses on its own.
- **The routes.** `GET /api/me` carries `acceptance` (`due`, and each text with its current
  version and whether it was accepted) while the deployment asks and an organisation is current.
  `POST /api/me/acceptance` takes `{ versions: { alpha, privacy, terms }, language }`, every text
  named and nothing else (400 otherwise); any version but the current one answers 409
  `version_not_current` with the stale texts and the current versions, and writes nothing.
  Accepted, it answers what `GET /api/me` now says and how many rows it wrote.
- **The doors.** Every door that stores a credential answers 409 `conditions_not_accepted`,
  naming the texts still to accept with their versions, in English and Dutch, before it probes
  or writes anything, until the person pressing it has accepted the current versions in that
  organisation: adding a connection, giving one a new key (`PUT /api/connections/{id}/
  credentials`), and creating a migration. One helper, `refusedUntilAccepted`
  (`apps/api/src/conditions-not-accepted.ts`), asked after the close's. Found by where the API
  seals a credential (`SecretStore.encryptCredentials`); two such places do not ask, each with
  its reason in the sweep: a grant link's consent (`grant-ending.ts`), whose holder is no party to
  the terms (§1) and whose migration was created behind the check, and the operator's seed. A
  member's own OAuth callbacks store nothing; the token goes back to the wizard, which stores it
  through one of the three doors. `apps/api/src/no-credential-stored-before-the-conditions.unit.
  test.ts` pins the checks per file and counts every seal, as `an-organisation-closed-at-every-
  door` does for the close, so a door added later fails until it asks or says why not.
- **The switch.** The alpha's own, `OWNPACE_STAGE=alpha` (0131 T1), read per request by the
  same rule (`alphaFrom`). The texts a tester accepts are the Alpha's, the deployment that runs
  the Alpha is the one that asks, and live sets it (`docs/managed-bring-up.md` step 6 of live's
  stand-up); every other deployment asks nobody, and nothing changes there. No new setting. The
  appliance never has any of it: no `apps/api`, and `@openmig/managed` is outside its import
  graph. When the Alpha ends, the new conditions replace the Alpha's in `LEGAL_VERSIONS`
  (Alpha §11 asks for them in the app too), and that change decides what the switch becomes
  (0086).
- **The screen.** `AcceptanceGate` stands in front of every signed-in page while `GET /api/me`
  says acceptance is due, so it comes after sign-in and before any other page, comes back when a
  version changes, and meets an invited member (0099) after they join. `pages/Acceptance.tsx`:
  the three texts, each linked in the reader's language with its version (the language switch is
  on the page), one button that sends the versions it showed and the language, *Not now* that
  signs out, focus on the heading, links that say they open a new tab. A version that changed
  while the screen was open is read again, not accepted; a read that failed is said with *Try
  again*, never taken for "nothing due". EN and NL strings (`acceptance.*`). It asks
  `GET /api/me` once per page load; right after a sign-in or a join it takes the answer that
  page just read (`rememberSignIn`), so the page it lands on shows the screen or itself at once.
- **T10's piece of it: the conditions rendered.** The links are the site's pages, from
  `legal-links.ts`, and the site build did not render the Alpha conditions, so it does now, in
  both languages, at `/alpha.html` and `/nl/alpha.html`, outside the nav (`OUTSIDE_NAV` in
  `site/build.mjs`), and `alpha` moved from `NOT_BUILT_YET` into `LEGAL_PAGES`. Serving the site
  on live (`WWW_LIVE`) is still T10's.
- **Erasure.** Named in `PURGED_TABLES`, before `tenant_member`: privacy §4.4 puts the record in
  *your account with us*, and §9 keeps the account until the data is erased and erases it then.
  Open question 4 is still the owner's; the code follows the text and T3's proposal.
- **Not built.** Alpha §11's *"Your migrations carry on under the new conditions only once you
  have accepted them in the app"*: nothing stops a running sync for acceptance; §11 closes the
  account by hand on the day, which `operator.sh close <tenant> 7` does. And 0138 T3 step 2's
  system role, when it takes the purge off the owner, must be able to delete these rows as it
  must `vat_consultation`'s (no DELETE policy for anybody on the request path).
- **Docs.** The T3 and T10 rows below; `site/legal/README.md` (*Acceptance* moved to *Done*, the
  table's row for `alpha.md`, *What is deliberately not here yet*); the comments beside privacy
  §4.4 (both languages), the privacy and terms briefings, and the Alpha briefing and header (both
  languages), with no rendered sentence changed; `docs/rls-guide.md` (46 forced tables, 18 in
  the managed chain, the policy paragraph); `docs/operator-runbook.md` (*Acceptance: who accepted
  which version*); `docs/managed-bring-up.md` §8g; `managed.env.example` and `managed.yml`'s
  comment on `OWNPACE_STAGE`; the OpenAPI spec (`/api/me`'s `acceptance`, `/api/me/acceptance`,
  and the 409 of the three doors).
- **Proved.** The guards were written first and each failed before the change: `scripts/a-version-
  the-tester-accepted` 9 of 10; `legal-acceptance-under-rls` did not load (no module); `force-rls-
  managed` 1 of 5; `offboarding.unit` 18 of 18 (its fixture seeds the table), and once the table
  existed without its list entry the fate guard (mutation 12 below); `schema-matches-migrations`
  2 of 9; `no-credential-stored-before-the-conditions` 11 of 17 and 3 skipped (the three presses
  with the switch off passed, as they must); `a-policy-link-that-answers` 2 of 20; the web guard
  did not load (no gate); the integration guard 9 of 11 on a throwaway Postgres
  (`scripts/local-pg.sh`). After it: `pnpm typecheck` clean; ESLint on the changed files, no
  problem; `vitest --project unit` over `apps/api`, `packages/managed`, the ledger's schema guard,
  the appliance's leakage guard and the two index guards, 150 files and 2179 tests; over
  `scripts` and `site`, 210 files and 3854 tests (the three `lessons` cases once `LESSONS.md` was
  regenerated); `--project unit-browser` over `apps/web`, 125 files and 2319 tests; on the
  throwaway Postgres, the new integration guard with `me`, `connections-usage`, `connection-
  delete-revokes`, `create-mapping`, `a-migration-past-the-cap`, `access-requests`, `a-report-
  under-row-security` and `tenant-pricing`, 9 files and 65 tests; `pnpm test:ui`, 20 of 20 with a
  new case that walks the built bundle through the screen and back (one earlier run lost one case
  to a request of the previous page aborted by the harness's own navigation, on a loaded machine;
  the next two runs passed whole). Fifteen mutations, each red: the check taken out of the new-key
  door; an old version accepted; UPDATE granted; row security not forced; row security off; the
  privacy constant at 1.1; the screen shown when nothing is due; the screen not shown when due;
  the Dutch alpha link at the English page; the switch always on; the switch always off; the table
  left out of `PURGED_TABLES`; a new route sealing a credential without the check; the member
  check taken out of the insert policy; and the unique key widened by the language. The indexes
  regenerated with `--write`, and the workplan, lessons and ADR `--check`s pass.

**2026-09-28, later: the owner's NetBird answers: accepted 2026-08-01, the agreement covers the

**2026-09-28: the copy before an update, and the drill off live (T6; the owner's answers
rec-copies (a) and rec-drill (a))**, built on branch
`claude/ownpace-public-readiness-y7orc6-one-copy-before-each-update`, not merged. Nothing has run
on the machine: live is not stood up (0132 T1b), and the scripts have run only against the
stand-ins in their guards.

- **What it answers.** The owner, 2026-09-28: *"deletes only after proven successful upgrade, so
  we already have one backup copy of what actually works. What about the drill?"*, and then one
  copy per update, deleted once the update is proven and never kept past day 7, and the drill on
  the test stack only. Privacy §9 and the Alpha conditions §6 (*"until that update is shown to
  work, and never longer than 7 days"*) promise it, in #1317 (merged 2026-09-28, `df74a08f`),
  whose `site/legal/README.md` (*To build or to do*) is the spec: *"one copy right before each update:
  the app's database, the sign-in service's database and the roles, and the task runner's
  database before a Trigger.dev upgrade. It is deleted once the update is proven
  (`deploy-live.sh` logged it as taken, one pass completed, and the hold lifted), and never kept
  past day 7; if the update is not proven by day 6, roll back from the copy. To build: one script
  and one directory for the copy, a delete step, a daily backstop that deletes anything older
  than 6 days, and `dump-idp.sh` writing into the same place or refusing on live."* And: *"the
  drill comes off live's duties in `box-duties.sh` and stays on the test stack.
  `trigger-version.sh backup` becomes part of the copy before a Trigger.dev upgrade on live,
  under the rule above."*
- **One script, one directory.** `deploy/compose/copy-before-update.sh`, and
  `~/.persistent/ownpace-live/copy-before-update/`, 700 with its files 600, never taken from the
  shell: the backstop looks there and nowhere else. Each command refuses a `.env` without live's
  marker.
  - `take <tag>`: the app's database (`pg_dump --format=custom`, read back with the server's own
    `pg_restore --list`), the sign-in service's database and the roles (`dump-idp.sh --dir`
    that directory), with `--trigger` the task runner's (`trigger-version.sh backup
    before-<tag>`, verified), and the note last (`copy-before-update.txt`: when, before which
    tag, from which release, the files, the rule). A part that fails leaves nothing of the run.
    A copy whose update is not proven is kept and no second one is taken: after a deploy that did
    not take it is still the copy of what ran before, and `--trigger` adds the task runner's
    database to it when it lacks it. A copy whose update is proven refuses: delete it first.
    Files there without a note, a dump by hand, become part of the copy. `--dry-run` writes
    nothing.
  - `delete`: refuses unless `deploys.log` has a `took` line at or after the moment the copy was
    taken, no hold that began at or before that line is still on, and a pass (an initial copy or
    an incremental one) that started after it succeeded, each read from live's database as the
    owner over the container's socket, with the superuser checked and one SELECT. A database it
    cannot read proves nothing.
  - `expire`: deletes the copy once it is older than 6 days, its age the note's time or its
    oldest file's, whichever is older; on day 6 it keeps it and fails, saying to roll back from
    it today or to delete it. It reads no database.
- **`deploy-live.sh`** takes it right before its checkout, after every refusal, with the hold on
  and nothing in flight: 0132 T6 step 4 is no longer the owner's. `--trigger` when the
  Trigger.dev pin at the tag differs from, or cannot be compared with, anything the one-way
  comparison names. A take that fails or refuses refuses the deploy with nothing moved. The dry
  run asks `take --dry-run`. A deploy that took ends by naming the delete step and day 6; one
  that did not take says the copy is kept.
- **The drill off live.** `box-duties.sh`'s second duty is now `copies`,
  `copy-before-update.sh expire`, and it names `trigger-version.sh` nowhere. `trigger-version.sh`
  refuses `drill` on a `.env` that is or may be live's, and there its `backup`, `backups` and
  `restore` use the copy's directory; a `MANAGED_BACKUP_DIR` naming another is refused before
  any docker call. On the OTA stack the gate's drill is as it was.
- **`dump-idp.sh` on live** writes into the copy's directory and refuses a `--dir` naming any
  other, before any docker call; on the OTA stack it is as it was. **`stand-up-live.sh`**
  refuses a tag without `copy-before-update.sh`, and its `BACKUP_RETENTION_DAYS` refusal says
  what takes the copy and what deletes it.
- **Docs.** The operator runbook: *The copy before an update (ownpace-live)* under *Backup &
  restore*, with the rollback by day 6 in eight steps, and its `BACKUP_RETENTION_DAYS`
  paragraph. The bring-up: §8g, the stand-up's `.env` step, *Live's daily duties* (the drill
  paragraph, the `copies` row, five duties, the Trigger.dev rollback), the deploy's steps 3 to 6,
  its refusals and `--dry-run`, the Trigger.dev upgrade and *What this does not cover*. The
  service unit's comment, word for word in the bring-up. The comments in `managed.env.example`,
  `managed.yml` and `erasure-timeline.ts`, which said the dump was the owner's. `stack-kind.sh`'s
  list of the scripts that read the marker.
- **Rehearsed.** Step 4 of the rollback, the app database's, on Postgres 16 with both migration
  chains applied (`scripts/local-pg.sh`), after a simulated update (a column, a table and a
  row): with a session still open, `pg_restore --clean --if-exists --create` stopped at its
  `DROP DATABASE` (*"is being accessed by other users"*), which is why the runbook stops
  `pgbouncer` too; with none, the database came back as dumped, without the three, owned as
  before and with `app_user`'s grants. The proof's SELECT answered `yes|0|1` there for a lifted
  hold and a pass after the deploy.
- **Proved, guard first.** `scripts/one-copy-before-each-update.unit.test.ts`, new, 60 cases.
  On `main`'s scripts 57 fail; the 3 that pass are controls (`dump-idp.sh` on the OTA stack,
  `--dir` naming the copy's directory spelled another way, the OTA stack's drill). Changed with
  it, before the scripts: `a-duty-the-gate-used-to-do` fails 17 of 63 on `main` (the drill with
  no form for live, `trigger-version.sh` named nowhere, `copies` where `drill` was, the backstop
  end to end), `a-deploy-from-a-named-tag` 10 of 132 (eight cases for the copy, and the one-way
  dry run's words twice), `a-first-bring-up-of-live` 2 of 156, `a-way-back-before-every-upgrade`
  1 of 19; `one-rule-for-a-release-tag` gains the stand-in its dry run now asks, and fails
  nothing. 87 of 444 in all; with the change, all pass. `two-stacks-on-one-box` found a quote in
  the new script its reader could not follow, rewritten. Eighteen mutations each turned a guard
  red, each restored after: no copy in the deploy; never `--trigger`; a failed take ignored;
  `--dry-run` given to the deploy and not the dry run; the backstop at 7 days; the hold not
  checked; any run counted as a pass; a took line before the copy counted; a second copy over an
  unproven first; a failed take's parts left behind; the directory taken from the shell; the
  note's time ignored; the superuser not checked; the drill back in live's duties; `dump-idp.sh`
  anywhere on live; the drill allowed on live; `MANAGED_BACKUP_DIR` followed on live; a tag
  without the script taken by the stand-up.
- **Not true yet, or not built.** A deploy started from a checkout without the step takes no
  copy: live's first tag must hold it, which `stand-up-live.sh` now checks. Nobody is told on
  day 6 but the journal (0142). The 6 days are a constant beside live's
  `BACKUP_RETENTION_DAYS=7`, not read from it. #1317's texts said this item was not built; the
  2026-09-29 entry above changes them. The whole rollback has not been run on a stack.

**2026-09-28, latest: the owner's NetBird answers: accepted 2026-08-01, the agreement covers the
proxy, and no NetBird sign-in at launch**, same branch (draft PR #1317). The five questions the
entry below left to the owner were put to them, and they answered the same day, in their words:

- **(a) When NetBird's terms and data-processing agreement were accepted:** 2026-08-01. T0 fact 1
  quotes the answer, which gives the date in Dutch order.
- **(b) Whether the agreement covers the Reverse Proxy**, the traffic it decrypts and its access
  log: *"It's covered"*. Recorded as the owner's confirmation; the PDF was not read here. What it
  says of sub-processors, of announcing a new one and the right to object, and whether it states
  the documentation's 7 days, stays for the lawyer's pass; it does not block the Alpha.
- **(c) Where the proxy cluster and its log run:** *"Take Germany, I'll ask later on"*. Privacy
  §7's and `subprocessors.md`'s *Where* stays *Germany (EU)*, the owner's choice, pending the
  owner's question to NetBird, which also asks whether any of NetBird's own sub-processors
  receives the traffic or the log. If NetBird's answer puts the proxy or its log outside the EU,
  §7's *Where* and §8 name it. An owner's to-do; it does not block the first invitation.
- **(d) NetBird's sign-in:** *"No pin, but SSO on"*: no PIN, and SSO on for the hosts NetBird
  serves. With SSO on, NetBird's sign-in sits in the visitor's path and its log also holds the
  signed-in user's ID; privacy §7's row names neither. Asked *"NetBird SSO is on. Which hosts sit
  behind it, and does that change before the first tester is invited?"*, the owner chose the
  option *"Off everywhere at launch"*: SSO off on every `ownpace.eu` host, `app.`, `id.`,
  `status.` and `www.ownpace.eu`, before the first invitation (the option's own words: *"SSO goes
  off on every ownpace.eu host before the first invitation, status. included."*). No other
  NetBird sign-in (password or PIN) takes its place, so no NetBird sign-in sits in front of the
  service, NetBird's log keeps no user ID for testers, and §7's row holds as it stands. A
  precondition for the first invitation, checked from outside the NetBird network: a request to
  each host is answered by the app or the site itself, not by NetBird's sign-in page.
- **(e) Terms §3.1's ban on *"commercially exploit[ing] Hosted Proxy Services"*** without
  NetBird's written permission: *"I need to ask commercial usage."* The owner asks NetBird in
  writing. The answer is needed before the first paid tier at the latest, and whether the free
  Alpha itself counts is part of the question.
- **Where it is recorded.** The privacy briefing's to-do on NetBird now follows these five
  questions: (a) and (b) recorded, (b)'s reading left for the lawyer; (c) and (e) the owner's
  questions to NetBird, (c) taking in the former (d), NetBird's own sub-processors; (d) the
  owner's words and their choice, and the switch-off a step under *Live* before the first
  invitation; and a paragraph on the answers. The comment beside privacy §7, the same in both
  languages, records (a) to (d) and says the log holds a user ID while SSO is on.
  `subprocessors.md`'s briefing (a bullet on the answers; *Open for the owner* keeps (c), *Open
  for the lawyer* gains (b)'s reading); `dpa.md`'s briefing (the NetBird record, the Annex B
  NetBird line, the to-do on NetBird and the lawyer's question 2); `site/legal/README.md`
  (NetBird's record, *To build or to do*, where *No NetBird sign-in in front of the service*
  replaces the NetBird bullet, the *Later* paragraph and *What must stay true*);
  and in this plan T0's row and fact 1, T5's row, and item 8 of *Promised in the drafts, not yet
  true on `main`* in the entry *the privacy policy (1.2) and the terms (1.3) revisited*, below.
- Only comments and plans change. No rendered sentence implied a NetBird sign-in (privacy §7's
  row names what is typed at our own sign-in, and its log names no user ID), so none changes, and
  every *Version* line stays a draft.
- **The review's correction, itself corrected, the same day.** A review of the first record of
  (d) (`af8bb644`) saw only the owner's words *"No pin, but SSO on"*, and `7042fab9` made the
  switch-off a proposal awaiting the owner. The owner did answer: after those words, asked which
  hosts sit behind SSO and whether that changes before the first tester is invited, they chose
  *"Off everywhere at launch"*. So (d) is their decision, a precondition for the first
  invitation, and `af8bb644`'s subject (*"no NetBird sign-in at launch"*) stands. What the review
  got right stays: SSO is on for the hosts NetBird serves (`www.ownpace.eu` did not resolve to
  NetBird on 2026-09-28), no reason is given for the owner's choice (*"to keep them private until
  launch"* was not theirs), and question 15 (iii) in the briefing comment stays rewrapped. The
  decision is restored in the privacy briefing, the comment beside §7 in both languages,
  `subprocessors.md` (whose open question on (d) goes), `dpa.md`, `site/legal/README.md`, item 8
  below, T0, T5 and fact 1. Only comments and plans change again, and the checks under *Proved*,
  run again, give the same results.
- **Proved.** `npx vitest run --project unit scripts/legal-docs.unit.test.ts site/site.unit.test.ts
  scripts/a-policy-link-that-answers.unit.test.ts scripts/one-way-to-report-a-vulnerability.unit.test.ts
  scripts/workplan-index.unit.test.ts scripts/lessons.unit.test.ts`: 6 files, 295 tests pass.
  `OWNPACE_APP_URL=https://app.ota.ownpace.eu node site/build.mjs --check`: *"4 legal page(s)
  marked draft"* and *"14 pages across 2 locales, 0 unfilled placeholder(s)"*; `--public
  --check` still refuses, for the draft markers alone. The workplan, lessons and ADR indexes'
  `--check`s and `commit-convention.mjs origin/main HEAD` pass. With every HTML comment taken
  out, `privacy.md`, `privacy.nl.md`, `subprocessors.md` and `dpa.md` read exactly as at
  `1094aaae`, and the comment beside §7 is the same in both languages.

**2026-09-28, later: NetBird's own sources read, and what they do not state left to the
owner**, same branch (draft PR #1317). The owner pointed to `https://trust.netbird.io` and
`https://netbird.io/terms` §3.1 (dpa-netbird-agreement (a)). Read on 2026-09-28: the terms, the
privacy policy and the imprint on `netbird.io`; the trust center's data, from the API its page
loads (`https://api.eu.scytale.ai/views/trust-center/public/page-data`), because the egress
proxy still refuses `trust.netbird.io` itself and Scytale's file host; and NetBird's
documentation, from its source (`github.com/netbirdio/docs` at `33d1b212`), because
`docs.netbird.io` is refused too.

- **Stated, and now in the texts.** The entity: NetBird GmbH, Berlin, HRB 237529 B, in the
  imprint and the privacy policy (the terms give no address or register number). For HTTP
  services *"The proxy terminates TLS at the edge"*, and traffic is *"forwarded through an
  encrypted NetBird tunnel to the target peer"* (`manage/reverse-proxy`). The access log: the
  time, the method, host and path, status, duration, bytes each way, the source IP address and a
  location from it, and *"For the cloud version of NetBird, access logs are retained for 7
  days."* (`manage/reverse-proxy/access-logs`). Terms §3.1: *"NetBird does not monitor or
  control the content of traffic transmitted via Reverse Proxy"*. Terms §13: NetBird's
  data-processing agreement applies to processing on the customer's behalf. Privacy §7's row,
  both languages, and `subprocessors.md`'s gain the time and the size each way; the comment
  beside §7 quotes each source with its address; privacy question 15 (iii) quotes the terms
  instead of search results.
- **Not stated anywhere read.** In which country, and at which provider, the proxy cluster and
  its log run: the documentation says only *"`eu` is the proxy cluster region"*, and terms §3.1
  promise no *"specific geographic routing"*. Whether any of the trust center's 18 sub-processor
  entries, all without a location, receives the proxy's traffic or log; whether Cloudflare, in
  NetBird's privacy policy but not its trust center, is in front of the proxy. NetBird's
  data-processing agreement is on the trust center as a PDF, not restricted, uploaded
  2026-06-23; it could not be downloaded here and was not read. The *Where* column keeps
  *Germany (EU)*, where NetBird GmbH is. Privacy's to-do on NetBird asks questions (a) to (e);
  the DPA briefing now says that §8's and §12's *EU* holds for NetBird only once they are
  answered, and `subprocessors.md`'s briefing says the same of its opening.
- **For the owner, beyond the texts.** Terms §3.1 forbid to *"Resell, sublicense, or
  commercially exploit Hosted Proxy Services unless explicitly authorized in writing by
  NetBird"*; the term is not defined. Whether Ownpace behind the proxy is that is NetBird's to
  answer in writing (`site/legal/README.md`). The proxy is *"currently in beta"* and *"provided
  on a shared, best-effort basis"*.
- Only comments and plans change, and the NetBird row in privacy §7 (both languages) and
  `subprocessors.md`; no other rendered sentence.

**2026-09-28, later: review fixes to the merge's notes**, same branch (draft PR #1317). A
review of `a3a2713e` found seven things. Six were right and are fixed here, in comments, this
plan and one Dutch text; the seventh needed no change. Where this entry differs from the one
below, it replaces it.

- ***Nothing uses your access after closing* is not fully true.** #1320 makes sure nothing new
  starts for a closed organisation; it does not stop all the work already running. The close
  asks the orchestrator to cancel only the runs whose row names the orchestrator's run, which
  only a sync pass records (`run-delta-sync.ts`), and a request that fails is only logged
  (`apps/api/src/close-account.ts`). A sync pass the cancel did not stop, or a discovery, reads
  to the end of the data type it is on (`stopping-a-pass.ts`; `run-discovery.ts` opens its
  access per data type). A confirmation's run row names no orchestrator run, and a verification
  writes to `verification_run`, which the close never reads; both build their readers before
  they start (`run-confirmation-pass.ts`, `run-verification.ts`) and read to their end with the
  stored access. So the item is back on privacy §9's *NOT YET TRUE* list in both languages and
  in the privacy briefing's to-do, terms precondition B is not fully done, and the comments
  beside terms §11 in both languages, the Alpha and DPA briefings (the DPA's to-do has its item
  back), `site/legal/README.md` (from *Done* to *To build or to do*), the entry below, the
  review entry's items, the Alpha's §10 note and T7's row say what holds. No rendered sentence
  changed. It becomes true when the close stops those runs too (they record the orchestrator's
  reference and the close cancels them, or they check the close between steps), or when the
  owner rewords the sentence to what the code does.
- **The DPA's *"database roles hold least privilege"*** does not hold for any task run either:
  every run receives the owner's connection string (`deploy/compose/set-task-env.sh`) and opens
  its audit key's pool on it (`apps/worker/src/jobs/task-pools.ts`), until 0138 T3 step 2; the
  API's migrations and its audit key's pool connect as the owner too (`SECURITY.md`,
  `docs/rls-guide.md`). The briefing's to-do says so.
- **Reports by mail**: four places in this plan still said 0130 T5 was on its branch; each now
  says it merged as #1318 (`0c019ab8`), which is on this branch.
- **The Dutch Alpha conditions**: *uw verhuizingen* where the English says *your migrations*
  (§5, and §11 twice), and *persoonlijk uitgenodigd* for *invited personally* (§1). Still 1.0,
  edited in place until the first tester accepts it.
- **The language note**: `terms.nl.md`'s header said the note the site prints above the Dutch
  page says what §13 says. It leaves out §13's exception for mandatory consumer law; the header,
  the opening of terms question 15 and privacy question 17 now say so. Adding the exception to
  `translationNote` in `site/copy.mjs`, as question 15 words it, is the owner's call.
- **The Alpha briefing's address line**: terms §1 and privacy §1 carry the name and the KvK and
  VAT numbers, not the address, which rec-address (c) leaves out of both during the Alpha.
- **No change: `main` moved** to `b30eea19` (#1328, 0150 T1) after the merge. It touches no
  legal file and no closed-organisation or row-security code, so every *merged into this branch
  in `c1413b53`* note holds. If `main` is merged again before pushing, `docs/workplans/README.md`
  is regenerated (0143's and 0150's Status changed).
- **Proved.** `npx vitest run --project unit scripts/legal-docs.unit.test.ts site/site.unit.test.ts
  scripts/a-policy-link-that-answers.unit.test.ts scripts/one-way-to-report-a-vulnerability.unit.test.ts
  scripts/workplan-index.unit.test.ts scripts/lessons.unit.test.ts`: 6 files, 295 tests pass.
  `OWNPACE_APP_URL=https://app.ota.ownpace.eu node site/build.mjs --check`: *"4 legal page(s)
  marked draft"* and *"14 pages across 2 locales, 0 unfilled placeholder(s)"*; `--public
  --check` still refuses, for the draft markers alone. The workplan, lessons and ADR indexes'
  `--check`s and `commit-convention.mjs origin/main HEAD` pass. Each English text and its Dutch
  one (privacy, terms, the Alpha conditions, the pricing page) keep the same headings, table
  rows, list items, links and section references, and no *je*, *jij* or *jouw* outside
  comments.

**2026-09-28, later: `main` merged, and the notes that waited for #1320 and #1323 say what
holds**, same branch (draft PR #1317). `main` at `55aa4c6a` was merged into this branch in
`c1413b53` (a merge; one conflict, `docs/workplans/README.md`, which is generated and was
regenerated). It brings #1320 (`d7868276`, 0085 T2) and #1323 (`d0138607`, 0138 T1 step 2),
which notes in the texts and in this plan waited for. Each claim was checked against the merged
tree's code, and each note now says what holds on this branch:

- ***Nothing uses your access after closing*** (privacy §9, terms §11, Alpha conditions §10,
  DPA Annex A): nothing new starts. The sync tick starts no pass for a closed organisation
  (`AN_OPEN_ORGANISATION_WHERE` in `ACTIVE_MAPPINGS_SQL`, `managed-sync-tick.ts`); a pass under
  way halts before its next data type (`organisation_closed`, `stopping-a-pass.ts`); the
  credential builders refuse (`refuseAClosedOrganisation`); every door that would start work or
  use the access answers 409 `account_closed` (`apps/api/src/closed-organisation.ts`); and the
  drift detector and group discovery read open organisations only. A member can still sign in,
  read and export until the purge: the close sets `tenant.status` alone, and reading, export and
  `authenticate` never ask; 0155 §1 and T5 say so. *(This entry called the sentence true and
  took it off privacy §9's* NOT YET TRUE *list. The entry above corrects that: work already
  running when the account closes is not all stopped, so the item is back on the list and terms
  precondition B is not fully done.)*
- ***Row-level security*** (privacy §11, this plan's §1, the DPA briefing): the app's requests
  and, since #1323, the eight per-tenant background tasks and the standalone worker, which
  connect as `app_user` on `APP_DATABASE_URL` (`openTaskPools`,
  `apps/worker/src/jobs/task-pools.ts`). The six scheduled jobs that span organisations (the
  sync tick, retention, the purge of closed organisations, the digest, the drift detector, group
  discovery) still connect as the database owner on `DATABASE_URL`; 0138 T2 and T3 step 2 move
  them, on a branch of their own, not merged, and nothing here claims them. Privacy §11 already
  said exactly that in both languages; only its comments changed. **Not borne out by the code:**
  `dpa.md`'s Annex B, *"Tenant isolation enforced in the database itself through row-level
  security … database roles hold least privilege"*, says none of these limits, and the six jobs
  connect as a superuser (and every task run still receives the owner's connection string: the
  entry above). It is not rendered and stays for the one pass before the first
  business customer (dpa-unpublished-until-business (a)); the briefing's to-do now names both.
- ***The pricing page*** (terms-s6-reverse-charge (a)): fixed in `cb1031fe`, *"All prices include
  VAT."* / *"Alle prijzen zijn inclusief btw."*; the terms briefing and this plan already said so.
- ***Still not true, for reasons of their own***, unchanged, each comment saying what makes it
  true: `TRUST_PROXY` and both nginx logs on live, the telemetry opt-outs, the acceptance screen
  (T3), the copy before an update and its script, the drill off live, the sharing list deleted
  with its migration, the 12-month clean-up, 0135 T8's daily script, the sign-in history check,
  the log driver, and Proton's mailbox pruned by hand.
- **Proved.** `npx vitest run --project unit scripts/legal-docs.unit.test.ts site/site.unit.test.ts
  scripts/a-policy-link-that-answers.unit.test.ts scripts/one-way-to-report-a-vulnerability.unit.test.ts
  scripts/workplan-index.unit.test.ts scripts/lessons.unit.test.ts`: 6 files, 295 tests pass.
  `OWNPACE_APP_URL=https://app.ota.ownpace.eu node site/build.mjs --check`: *"4 legal page(s)
  marked draft"* and *"14 pages across 2 locales, 0 unfilled placeholder(s)"*; `--public
  --check` still refuses, for the draft markers alone. The workplan, lessons and ADR indexes'
  `--check`s and `commit-convention.mjs origin/main HEAD` pass. Each English text and its Dutch
  one keep the same headings, table rows, list items, links and section references, and no *je*,
  *jij* or *jouw* outside comments; only comments changed in them.

**2026-09-28, later: the owner answered all 71 questions on the answer page, and the texts
follow**, on branch `claude/ownpace-public-readiness-y7orc6-the-privacy-policy-and-terms-revisited`
(draft PR #1317). The questions still open below (*For the owner*, the briefings' questions for
the lawyer and the owner, and the recommendations on the address, the two addresses, the copies,
the drill and Alpha §10) went to the owner on one answer page, each with its context, options and
a recommendation. The owner: *"all Ownpace Legal Choices where answered (71). Can you processess
the answers?"* Each text follows the option the owner chose, also where it is not the one
recommended, and the owner's notes are part of the answer. Nothing is published: privacy 1.2 and
terms 1.3 keep their draft markers, `dpa.md` and `subprocessors.md` stay 0.2 drafts, and the Alpha
conditions stay 1.0, edited in place because nobody has accepted them yet.

- **The answers, by group** (id → the option chosen; the owner's notes verbatim, except that a
  value is left to the legal files, as T0 requires; `site/legal/README.md` quotes those two
  notes whole). The 11 marked † differ from the recommendation.
  - **Alpha (10).** alpha-addendum-form → (a) *Leave it for the lawyer's pass*;
    alpha-briefing-comment → (a) *Update it now*; alpha-s11-erasure-window → (b) *After 7 days*;
    alpha-s11-notice → (a) *Name it in §2*; alpha-s4-liability → (a) *Keep the heading, add one
    sentence*; alpha-s5-updates → (a) *No, and Alpha §5 says so*; alpha-s9-family-google → (a)
    *Off together with the tester's, at erasure, or sooner if asked*; alpha-version-number → (a)
    *Stay 1.0*; alpha-withdrawal-right → (a) *Leave it for the lawyer's pass*;
    terms-acceptance-route → (b)† *Build the in-app screen first*, the owner: *"People that are
    accepted in the Alpha do need to create a login for the app, accepting fits in there and
    should record what time/version the accepted of what document."*
  - **DPA (10).** dpa-netbird → (a) *No change now. Add one line in the pass before the first
    business customer*; dpa-netbird-agreement → (a)† *Yes, it is already accepted*, the owner:
    *"NetBird GmbH ("NetBird") terminates the TLS, and uses WireGuard tunnel with the backend
    towards the hosting provider. Check https://trust.netbird.io (whitelisted for you) for
    overview, subprocessors and other info. https://netbird.io/terms lists the reverse proxy in
    3.1"*; dpa-q1-transfers → (c)† *Name Proton in §12, and add a clause for any later transfer*;
    dpa-q2-subprocessor-permission → (a) *General permission, as drafted*; dpa-q3-return-of-data
    → (c)† *Add a short return clause*, the owner: *"We need to add a workplan that builds this
    feature, because someone might ask it and when we need to deliver the dump/export."*;
    dpa-q4-audits → (b) *Written answers are free; the customer pays our reasonable costs of an
    on-site audit*; dpa-q5-special-categories → (b)† *Reword §4 now*; dpa-q6-liability-cap → (a)
    *One cap for business customers, data protection included*; dpa-q7-annex-b-complete → (b)†
    *Draft the usual missing items now, for the lawyer to review*;
    dpa-unpublished-until-business → (a) *Keep it unpublished, and fix it in one pass before the
    first business customer*.
  - **Recommendations (8).** fact-trademark → (b)† *Add it now; the KvK already shows it*;
    fact-vat → (a) *I'll give it now*, the owner: *"[the VAT number] (VIES might validate it only
    without dots/spaces, but in legal document that doesnt mater.)"*; rec-address → (c)† *Leave
    the address out during the Alpha*, the owner: *"KVK number: [the KvK number]"*; rec-alpha-10
    → (a) *Change the text (Alpha 1.1) to match the app* (applied to 1.0, per
    alpha-version-number); rec-copies → (a) *One copy per update, deleted once the update is
    proven, never past day 7*; rec-drill → (a) *On the test stack only; on live, a copy before
    each Trigger.dev upgrade*; rec-privacy-history-url → (a) *Link to the file's history in the
    public repository*; rec-subprocessors-url → (a) *§7's table is the complete list*.
  - **Operations (8).** ops-app-sentences → (a) *Reword them*; ops-billing-form → (b)† *Keep the
    form and both sentences as drafted*; ops-log-driver → (a) *Docker's default, as the text
    says*, the owner: *"needs checking"*; ops-notify-addresses → (a) *All to
    support@ownpace.eu*; ops-social-signin → (a) *Email and password only*; ops-telemetry → (a)
    *Switch it off everywhere*; ops-trust-proxy → (b)† *Keep visitors' addresses in all our
    logs*; ops-unadmitted-signin-cleanup → (a) *A daily script, built before the first tester*.
  - **Privacy (21).** privacy-after-alpha-questions → (a) *Leave them for the lawyer's pass,
    before the first paid tier*; privacy-bases-special-category → (a) *Leave it for the lawyer's
    pass*; privacy-children-grant-link → (a) *One line in §12: the parent completes it with the
    child*; privacy-db-access-sentence → (a) *Confirm it as drafted*; privacy-file-connectors →
    (a) *Add files*; privacy-google-testlist-basis → (a) *Leave it for the lawyer's pass*;
    privacy-household-controller → (a) *Leave it for the lawyer's pass*; privacy-limited-use →
    (a) *Leave it for the lawyer's pass, before applying to Google*, the owner: *"but do describe
    each flow so that we can use it in the verification application. The layyer will only
    review."*; privacy-other-transfers → (b) *Add one plain sentence naming both*;
    privacy-portability-note → (a) *Keep the note and add one sentence*; privacy-read-log-copy →
    (a) *Keep it, answered by hand*; privacy-search-records → (a) *12 months*;
    privacy-sent-mail-copies → (b)† *The support-mail rule: until resolved, then 6 months*;
    privacy-share-mail-notice → (a) *Add a line and a link*; privacy-sharing-list → (b) *It goes
    with its migration*; privacy-signin-history → (a) *Check first, then state the rule*, the
    owner: *"still needs to be checked."*; privacy-switzerland-wording → (b) *Add a reference in
    brackets*; privacy-task-records → (a) *Until the end of the Alpha at the latest*;
    privacy-tester-list → (a) *Use the Proton mailbox as the list*; privacy-tls-wording → (a)
    *Publish as drafted*; subprocessors-machine-housed → (a) *No. I keep it and run it myself,
    for Archico B.V.*
  - **Terms (14).** terms-paid-tier-lawyer-checks → (a) *Leave them for the lawyer's pass*;
    terms-s1-telephone → (a) *Email only for now*; terms-s11-ending-reasons-refund → (a) *Keep
    both*; terms-s11-export → (a) *Promise the migration records, made on request*, the owner:
    *"as mentioned above: draft the export function in a workplan"*; terms-s12-consumer-exit →
    (a) *Keep both*; terms-s12-reasons → (b) *Narrow it*; terms-s13-dispute-body → (a) *Name one
    case by case (as drafted)*; terms-s13-forum → (a) *Keep v1.3*; terms-s14-transfer → (a)
    *Keep v1.3*; terms-s3-minimum-age → (b) *18 or older*; terms-s3-responsibility → (a) *Keep
    the v1.3 wording*; terms-s4-privacy-part-of-contract → (b) *Only its commitments*;
    terms-s6-reverse-charge → (a) *The published price minus the VAT in it*;
    terms-unbuilt-paid-steps → (a) *Keep them, and build them before paid tiers*.
- **What changed in each text** (the same change in both languages, the Dutch with *u*; both have
  the same sections, table rows, list items, links and section references, checked by a script):
  - **Privacy 1.2.** §1: Archico B.V., trading as Ownpace, its KvK and VAT numbers, no address,
    and *"We correspond by email."*, with a hidden comment that the address returns before the
    first paid tier. §4.1: *"… calendars and files cannot write to the source"*. §4.2 and §4.6:
    the sharing list belongs to its migration. §4.4: the account records which versions of the
    three texts were accepted, and when (ops-social-signin (a) keeps the text as it is; only
    live's `.env` has a to-do, no `IDP_*` keys). §4.5: server logs record the IP address NetBird
    passes on; NetBird keeps its own log; searches and downloads on the support screens go after
    12 months. §6: a family member's Google address comes off the test list with the tester's, or
    sooner if asked. §7: NetBird's row adds the WireGuard tunnel and NetBird's own log, what it
    holds and its 7 days (from NetBird's documentation, to confirm); *"This table is the complete
    list of our sub-processors."* replaces `«SUBPROCESSORS_URL»`. §8: *(Art. 45 GDPR; Commission
    Decision 2000/518/EC)*, and a paragraph on two routes to the US the reader chooses (the
    GitHub report form, a US mailbox). §9: the rows follow rec-copies, rec-drill (the drill
    sentence is gone), privacy-search-records, privacy-sent-mail-copies, privacy-sharing-list,
    privacy-signin-history and privacy-task-records; *"no backups"* has one exception. §10:
    *"What we hold about you ourselves (§4), we send you in a common file format if you ask."*
    §11: row-level security covers the app's requests and the background tasks that run
    migrations, and not yet the scheduled jobs that span organisations, as `SECURITY.md` says
    since #1323 (d0138607), on this branch since `main` was merged into it in `c1413b53` (a
    hidden comment says so). §12: a grant link for a child under 16 is completed by the parent with the child. §13: a
    link to the policy's history on GitHub, per language, which also shows unpublished drafts.
    The briefing lists every answer by id, keeps the lawyer's questions 1 to 20 with what is left
    for the lawyer, describes the four data flows for Google's verification (question 15, as the
    owner's note asks), and ends with *Still to do before the draft marker comes off*.
  - **Terms 1.3.** §1: the company as in privacy §1, no address, *"We correspond by email"*;
    *"the commitments the privacy policy makes to you"*; acceptance happens in the app, which
    records each text's version and the time. §3: 18 or older, and the route for under-18s is
    gone. §4: *"The privacy policy explains how; the commitments it makes to you are part of this
    contract."* §10: the business cap also covers data-protection claims between the parties, and
    the no-limit clause keeps *"the rights the GDPR gives the people whose personal data it
    is"*. §11: the export is of the migration records, *"what was copied, what could not be, and
    why"*, on request. §12: *"a new feature, a change in our costs"* replaces *"a change to the
    service or its prices"*. §15: *"To: Archico B.V., email: support@ownpace.eu"*. §6 is not
    changed: terms-s6-reverse-charge (a) itself says §6 gets its sentence when business customers
    are admitted; the sentence, in both languages, is in the briefing (old question 1). The
    briefing marks each question ANSWERED, with *Left for the lawyer* after it.
  - **The pricing page** (terms-s6-reverse-charge (a), which fixes it whichever option is
    chosen). Its last paragraph said *"VAT is added where it applies"* / *"Btw komt erbij waar
    die van toepassing is"*, against the price table's *"All prices include VAT"* and terms §6.
    It now reads *"All prices include VAT. Self-hosting is free and always will be."* / *"Alle
    prijzen zijn inclusief btw. Zelf draaien is gratis en blijft dat."*
    (`site/pages/en/pricing.md`, `site/pages/nl/prijzen.md`).
  - **The Alpha conditions 1.0.** §2: terms §12's 30 days give way to §11's 7 days for the new
    conditions after the Alpha; a tester accepts the three texts in the app, which records the
    versions and the time. §4: *"We tell you about a data breach that affects your data"*, and
    *"§10 of the terms (If we get it wrong) still applies."* §5: *"We update the service often
    during the Alpha. An update can pause your migrations for a short while; we do not announce
    each one."* §6: the copy stays *"until that update is shown to work, and never longer than 7
    days"*. §9: a family member's Google address too. §10: access follows the app (rec-alpha-10),
    and a family member's Google address comes off at erasure. §11: acceptance in the app, and
    *"Your data is erased 7 days later; until then you can still accept them and carry on."* The
    briefing is rewritten for terms 1.3 and privacy 1.2.
  - **`dpa.md` 0.2.** The parties as in privacy §1, except the address: it stays the token
    `«REGISTERED_ADDRESS»`, not rendered, because rec-address (c) covers privacy §1 and terms §1
    and §15 during the Alpha only, and the DPA is for business customers, who come after it;
    §4 covers special categories in item names, which are protected, used to recognise each item
    across passes and to show which item a record is about, and deleted with the migration;
    §10 a return clause (the migration
    records first, on request, then deletion); §11 written answers free, the controller pays our
    reasonable costs of an on-site audit; §12 names Proton AG and puts notice and the standard
    contractual clauses before any later transfer; §13 one cap, data protection included, with
    data subjects' rights untouched; Annex A the item names; Annex B a new block of items for the
    lawyer, each with visible *Open:* marks (the machine, administrative access, incidents,
    copies; the incidents item says the breach procedure tells the controller, as its §5 does,
    and leaves open a timing and a template for that notice). The briefing records the answers
    and the to-dos, NetBird's Annex B line among them.
  - **`subprocessors.md` 0.2.** Unpublished until the first business customer; the opening cites
    Art. 45 GDPR and Decision 2000/518/EC; NetBird's row as in privacy §7.
  - **`site/legal/README.md`.** The placeholder table lists the two tokens still used, in no
    rendered text: `«REGISTERED_ADDRESS»` in `dpa.md` only, and `«SUBPROCESSORS_URL»` in
    `dpa.md` and `subprocessors.md`; `«REGISTERED_ADDRESS»` (for the rendered texts),
    `«VAT_NUMBER»` and `«PRIVACY_HISTORY_URL»` moved to the filled list
    with the owner's words; *Before the draft markers come off* is rewritten from the answers.
- **Recorded, with no change to a text.** The answers that leave a question for the lawyer's pass
  (alpha-addendum-form, alpha-withdrawal-right, privacy-after-alpha-questions,
  privacy-bases-special-category, privacy-google-testlist-basis, privacy-household-controller,
  privacy-limited-use, terms-paid-tier-lawyer-checks) are marked in the briefings. The answers
  that keep a text as drafted (dpa-q2-subprocessor-permission, ops-billing-form,
  ops-social-signin, privacy-db-access-sentence, privacy-tls-wording, the terms' *Keep*
  answers, terms-s1-telephone, terms-s13-dispute-body, terms-unbuilt-paid-steps) change
  nothing. ops-billing-form (b) leaves nothing to do: the Billing form, the card code and
  §4.4's and §7's sentences stay as drafted. Privacy §12 keeps its 16 beside the terms' 18, as
  terms-s3-minimum-age (b) says, and the lawyer is asked to confirm the pair.
- **Not checked from here.** NetBird's sources: `trust.netbird.io` returns only an empty page
  shell, whose content comes from a host the egress proxy refuses, and `netbird.io` is refused,
  so NetBird's sub-processors, its terms' §3.1 and its agreement were not read; the §7 *Where*
  column keeps *Germany (EU)*, marked to confirm. The date NetBird's agreement was accepted was
  not given. That the KvK extract lists *Ownpace* as a trade name rests on the chosen option
  (fact-trademark (b)); no extract was seen. The VAT number was written as given and checked
  only for its form. The sign-in history rule waits for the check on the test stack. What only
  live can show: the log driver, `TRUST_PROXY` and the two nginx log formats, the telemetry
  opt-outs, no `IDP_*` keys.
- **The export the owner asked for** (dpa-q3-return-of-data, terms-s11-export) is a plan of its
  own: [0155](0155-the-migration-records-handed-over.md). Until it is built, the records are made
  by hand.
- **What needs code or machine work** is the list in `site/legal/README.md`, *Before the draft
  markers come off*: T3's screen (terms-acceptance-route (b)); T6's copy before an update, the
  drill off live, the 12-month clean-up of support-screen searches, the sharing list deleted with
  its migration, and 0135 T8's daily script (*2026-09-29: T6's copy before an update and the
  drill off live are built, on branch `claude/ownpace-public-readiness-y7orc6-one-copy-before-each-update`,
  not merged; the entry at the top*); T4's reworded app sentences and the share mail's
  privacy line; live's `.env` (`TRUST_PROXY`, no `IDP_*`, the three mail addresses, the VIES
  requester) and both nginx log formats; the telemetry opt-outs; the log driver and the
  sign-in history checked; and, by hand, Proton's Sent folder, a family member's Google address
  and the read-log query.
- **Files**: `site/legal/privacy.md`, `privacy.nl.md`, `terms.md`, `terms.nl.md`, `alpha.md`,
  `alpha.nl.md`, `dpa.md`, `subprocessors.md`, `site/legal/README.md`, `site/pages/en/pricing.md`,
  `site/pages/nl/prijzen.md`, this plan, and the new 0155.
- **The review of these changes, fixed the same day** (11 findings, none rejected): the pricing
  page's last paragraph (terms-s6-reverse-charge (a), above); §4.4's sentence on social sign-in
  taken out again (ops-social-signin (a) keeps the text as it is); ops-billing-form (b) off the
  to-do list; `dpa.md`'s parties keep `«REGISTERED_ADDRESS»`, and its §4 and Annex B's incidents
  item say only what is true; privacy §11 follows #1323 on `main`; NetBird's row names what its
  log holds and its 7 days (NetBird's documentation on GitHub, to confirm in its agreement or
  dashboard; `trust.netbird.io`'s content and `netbird.io` are still refused by the egress
  proxy); 0155 T2 reads as `app_user`, and §1 and T5 take the closed-organisation answer from
  #1320 on `main`. Proved again after the fixes: the same five test files, 91 tests pass; the
  three index `--check`s pass; `site/build.mjs --check` reports 4 legal pages marked draft and 0
  unfilled placeholders, and `--public --check` refuses for the draft markers alone; the parity
  script finds the same structure in each English text and its Dutch one, the pricing pages
  included.
- **Proved.** `npx vitest run --project unit scripts/legal-docs.unit.test.ts site/site.unit.test.ts
  scripts/a-policy-link-that-answers.unit.test.ts scripts/one-way-to-report-a-vulnerability.unit.test.ts
  scripts/workplan-index.unit.test.ts`: 5 files, 91 tests pass. `OWNPACE_APP_URL=https://app.ota.ownpace.eu
  node site/build.mjs --check`: *"4 legal page(s) marked draft"* and *"14 pages across 2 locales,
  0 unfilled placeholder(s)"* (14 before); `--public --check` still refuses, for the draft
  markers alone. A script found the same headings, table rows (privacy 32), list items, links and
  section references in each English text and its Dutch one, and no *je*, *jij* or *jouw* in the
  Dutch outside comments. `node scripts/workplan-index.mjs --write` and `node scripts/lessons.mjs
  --write`, then all three `--check`s (with `adr-operative.mjs`), pass. The index listed 0152 to
  0154 as missing on this branch: they were on `main` (#1321); the merge of `main` in
  `c1413b53` brought them, and the regenerated index lists them.

**2026-09-28, earlier: the owner's answers to *For the owner*, applied where they are clear**, on
branch `claude/ownpace-public-readiness-y7orc6-the-privacy-policy-and-terms-revisited` (draft PR
#1317). Items 1 to 11 of *For the owner* (in the entry *the privacy policy (1.2) and the terms
(1.3) revisited*, below) were put to the owner as eight points. The answers, verbatim, each after
the point it answers:

1. Final or the lawyer (item 1): *"park them in PR that i will review."*
2. Facts (item 2: the machine's country; where TLS ends, and the ingress's legal entity and
   region; the printed form of `«REGISTERED_ADDRESS»`; `«VAT_NUMBER»`; whether "Ownpace" is a
   registered handelsnaam): *"app/site hosting is in The Netherlands, through NetBird (Germany)
   delivers the forward proxy. My address, is it needed? I also live there, and rather have
   correspondance by email. VAT number was already mentioned, check Ownpace-repo for the info:
   site/legal/README.md Ownpace is registered, check Ownpace-repo for the info: TRADEMARK.md"*
3. Proton (item 3: keep Proton AG, Switzerland; its data-processing agreement accepted for the
   account behind `support@ownpace.eu`; that account Archico B.V.'s; the service's sent mail kept
   there): *"yes"*
4. Periods (item 4: sign-in accounts nobody let in, 30 days proposed; server logs): *"30 days is
   ok, but those are free no further used accounts? Server logs: check ownpace repo on this."*
5. Addresses (item 5: `«SUBPROCESSORS_URL»`, `«PRIVACY_HISTORY_URL»`): *"recommend me what to
   do."*
6. The copies (item 7: `dump-idp.sh`'s dumps pruned at 7 days or deleted once an upgrade
   succeeds; deleting the copy before an update automated; the daily drill's dumps named in
   privacy §9, or the drill stopped on live): *"deletes only after procen successfull upgrade, so
   we already have one backup copy of what actually works. What about the drill?"*
7. Terms (item 9: no cap towards consumers, as drafted; the English governs, or both languages
   count): *"yes"*
8. The Alpha conditions §10's credentials sentence, which the code contradicts (item 11): *"what
   do you recommend?"*

Items 6, 8 and 10 were not put to the owner, and neither were these parts of the others, which
stay open as written below: item 2's telephone number; item 4's period for the background tasks'
records, or *"no period set yet"*; item 9's age rule (18, or a parent's or guardian's permission,
beside privacy §12's 16) and whether updates during the Alpha are announced in advance; and item
11's stale briefing comment and the erasure window after a closing for not accepting.

- **Applied.** Both texts stay drafts in the pull request, for the owner's own review; the
  lawyer's pass stays deferred, and no *Version* line changes until the owner approves the text.
  - `«HOSTING_REGION»`: *the Netherlands* / *Nederland* (privacy §7, `subprocessors.md`). Whether
    a company houses the machine or can reach it is not answered and stays open.
  - `«INGRESS_PROVIDER»`, `«INGRESS_REGION»`: *NetBird GmbH*, *Germany (EU)* / *Duitsland (EU)*
    (privacy §6's transfer bullet and §7's first row, both languages; `subprocessors.md`).
    *"Forward proxy"* is read as the reverse proxy in front of the machine that ends TLS, as
    `managed.yml` says. Germany is in the EU, so §8 is unchanged. The entity name was read from
    search results quoting NetBird's terms (Amtsgericht Berlin (Charlottenburg), HRB 237529 B),
    because `netbird.io` cannot be reached from here; `site/legal/README.md` marks it *to
    confirm*, with NetBird's data-processing agreement, the proxy cluster's location and HTTP
    mode. Privacy §4.5 is unchanged, because our logs are not configured alike: the app's nginx
    (`ownpace_combined`) records `$remote_addr` only, which behind NetBird would be its proxy,
    and the API does the same without `TRUST_PROXY`; the website's nginx sets no log format, so
    its image's default applies, which in official nginx images also logs `X-Forwarded-For`, and
    so may hold the visitor's IP address (the image's `nginx.conf` not read here). NetBird's
    mode, its headers and live's `TRUST_PROXY` are not checked, so whose IP address each log
    records stays a question, settled per log (privacy briefing; README; 0132 T3 (d)). New in
    the privacy briefing, from NetBird's documentation: its proxy keeps an access log with the
    visitor's IP address, a location and the full path, a grant link's secret included.
  - Proton (*"yes"*): `site/legal/README.md` records it as confirmed: the agreement accepted for
    `support@ownpace.eu`, the account Archico B.V.'s, the service's sent mail kept there.
    Privacy §4.5 now says the mailbox keeps a copy of the mail the service sends, and so do
    privacy §7's Proton row (both languages) and `subprocessors.md`; §4.6 says a copy of the mail
    to people items were shared with stays there, so §3's *"§4.6 lists it"* stays complete (the
    service mails nobody a customer invites). §9's support-mail row covers those copies: *6
    months after it was sent* / *6 maanden nadat die is verstuurd*, which reads *"Until resolved
    + 6 months"* for mail that answers no question. The owner confirms that reading in the pull
    request. Nothing prunes the Sent folder: until something does, it is pruned by hand at 6
    months, or by a Proton setting if Proton has one (not checked), a precondition in the
    README's *Before the draft markers come off* and beside privacy §9. Where Proton's agreement
    says Proton processes stays open (privacy question 11).
  - `«UNADMITTED_SIGNIN_RETENTION»`: *30 days after it was created, unless a request for access
    with that address is still open* / *30 dagen nadat het is aangemaakt, tenzij een aanvraag
    voor toegang met dat adres nog openstaat*. The row now describes a sign-in account someone
    created at our sign-in page and we never let in, which opens nothing (§4.4). The owner's
    question is answered in the README: unused, yes; free-tier, no. Anyone can create one,
    because self-registration is on, and it opens nothing until an operator grants a request
    for that address, but the sign-in service holds a name, an address, a password hash,
    sessions and its history for it. Not built: 0135 T8 removes them. Until T8 is built, either
    the owner removes these by hand in the sign-in service's console, or the row waits; the owner
    chooses (a comment beside privacy §9, both languages, and the README). One gap in T8's rule:
    it did not spare an address with an open invitation, so a person granted after registering
    who has not yet signed in to the app would be removed at day 30. 0135 now marks its open
    question 6 answered with the owner's words, and T8's rule has a fifth condition for it.
  - `«LOG_RETENTION»`: a criterion, not a number, because nothing enforces a number: *until the
    part of the service that wrote them is replaced: for the app and this website, at each
    update of the service; for our sign-in service, when its version or its settings change; for
    a background task, when its run ends. There is no fixed period.* (Dutch the same.) No
    compose file for live sets `logging`, so Docker's default keeps a container's output until
    the container is removed; `deploy-live.sh` recreates the app's and the website's containers
    at each deploy, the sign-in service's only on a change of image or configuration. The README
    lists what would make *30 days* true: journald on the machine with a 30-day retention and a
    short `MaxFileSec`, a check of `docker info --format '{{.LoggingDriver}}'` in
    `stand-up-live.sh` or `box-duties.sh`, and 0134 open question 6 re-decided. It also records
    the conflict: `docs/managed-bring-up.md` lists the journald log driver among the owner's
    steps for live, while 0134 open question 6 was answered (a). If the machine does log to
    journald, the row is wrong and must give the journal's period.
  - Terms (*"yes"*), recorded as our reading, which the owner may correct in the pull request:
    both kept as drafted, no cap towards consumers (§10) and the English governs except where
    mandatory consumer law provides otherwise (§13). In the terms briefing (the §10 decision,
    questions 13 and 15) and the README. The README said the note above the Dutch pages *"says
    the same"* as §13; it does not carry §13's exception, and now says so, with the words that
    would add it (terms question 15). `translationNote` is not changed.
  - The name: `TRADEMARK.md` records a Benelux trademark *application* (1556706, registration
    pending), not a registration and not a handelsnaam. The texts may say *"Ownpace is a
    trademark of Archico B.V."*, with ™, never ® or *registered* until the Benelux office
    registers it; *"trading as Ownpace"* only once a current KvK uittreksel shows the
    handelsnaam. Terms question 22 and the README's `«LEGAL_ENTITY»` entry say so; nothing is
    added to the texts.
- **Not filled.** `«VAT_NUMBER»`: `site/legal/README.md` has held the placeholder in every
  version, and no file in the repository records Archico B.V.'s btw-id; the KvK number printed
  beside it may be what the owner meant. It stays a token until the owner or the accountant
  supplies it, and a VAT number in a unit test's fixture is not it.
- **Not decided, recorded with the owner's words and a recommendation** (the privacy briefing's
  *For the owner before publication*, terms question 22, the README):
  - `«REGISTERED_ADDRESS»`: probably needed in the terms (BW 3:15d for an information society
    service, which a free Alpha offered by a B.V. probably is; the §15 model form), a reading for
    the lawyer. Recommended: print the vestigingsadres in privacy §1, terms §1 and §15, with
    email first beside it (the wording, both languages, in terms question 22), or register a
    business address at the KvK. The README row no longer offers a postbus as the only form. No
    address is written anywhere.
  - `«SUBPROCESSORS_URL»`: make privacy §7's table the complete list for the Alpha, and publish
    `subprocessors.md` with its Dutch text when the first business customer and the DPA arrive.
    `«PRIVACY_HISTORY_URL»`: the file's history in the public repository, per language.
  - The copies: the owner's answer is §9's *"until the next update succeeds"*; the 7-day cap
    that §9, the Alpha conditions §6 and the erasure date rest on is not settled. Recommended:
    delete the copy once the update it was made for is proven, never later than day 7, with one
    script and one directory for the whole copy and a daily backstop.
  - The drill: take it off live's duties for the Alpha and keep the OTA stack's nightly drill;
    take `trigger-version.sh backup before-<version>` before a Trigger.dev upgrade on live under
    the copy's rule; then privacy §9 drops the drill sentence and the *"daily copies"*.
  - The Alpha conditions §10: the 1.1 wording already in the entry below (*"We keep that access
    until you delete the connection; access a family member gave through a grant link, until
    you delete the migration."*, with its Dutch), so the conditions follow the code. The
    conditions are not edited.
- **Files**: `site/legal/privacy.md`, `privacy.nl.md` (§4.5, §6, §7, §9, and the briefing),
  `terms.md` (the briefing only), `subprocessors.md`, `dpa.md` (a briefing line),
  `site/legal/README.md`, and T0 fact 1 below.
- **Proved.** `npx vitest run --project unit scripts/legal-docs.unit.test.ts site/site.unit.test.ts
  scripts/a-policy-link-that-answers.unit.test.ts scripts/one-way-to-report-a-vulnerability.unit.test.ts
  scripts/workplan-index.unit.test.ts`: 5 files, 91 tests pass. `OWNPACE_APP_URL=https://app.ota.ownpace.eu
  node site/build.mjs --check`: *"4 legal page(s) marked draft"* and *"14 pages across 2 locales,
  14 unfilled placeholder(s)"* (four per language in the privacy policy, three in the terms; 28
  before). Both languages have the same sections, table rows, list items and placeholders.
- **Review fixes, the same day.** A review of this entry's commit found eight gaps, fixed in a
  commit of their own:
  - Privacy §4.6, both languages: a copy of the mail to people items were shared with stays in
    the support mailbox until 6 months after it was sent, so §3's *"§4.6 lists it"* is complete
    again. The service mails nobody a customer invites, so the invitees' bullet is unchanged.
  - Privacy §7's Proton row, both languages, and `subprocessors.md`: the mailbox also keeps a copy
    of each mail the service sends. Nothing prunes Proton's Sent folder: a precondition in the
    README's *Before the draft markers come off* and in both §9 comments, with the 6 months still
    the owner's to confirm.
  - T0 and T5 in the task table follow this entry: four placeholders open, five filled today.
  - The sentence on items 6, 8 and 10 names the parts of items 2, 4, 9 and 11 that were not put
    to the owner either.
  - 0135: open question 6 answered, in the owner's words; T8's rule has a fifth condition, an open
    invitation, and a Status entry.
  - The removal by hand of sign-in accounts nobody let in is a choice, not a duty: until T8 is
    built, either the owner removes them in the console or privacy §9's row waits (README, both §9
    comments, above).
  - The app's and the website's nginx log differently: the app's `ownpace_combined` records
    `$remote_addr` only; the website's sets no format, so the image's default applies, which in
    official nginx images also logs `X-Forwarded-For`. Privacy §4.5 is settled per log (README,
    privacy briefing, above).
  - The privacy briefing no longer says the machine uses Docker's default log driver; that is not
    checked.
  - **Files**: `site/legal/privacy.md`, `privacy.nl.md`, `subprocessors.md`, `site/legal/README.md`,
    this plan, and 0135.
  - **Proved.** The same five test files: 91 tests pass. `OWNPACE_APP_URL=https://app.ota.ownpace.eu
    node site/build.mjs --check`: *"4 legal page(s) marked draft"*, *"14 pages across 2 locales,
    14 unfilled placeholder(s)"*, as before. Both languages still have the same sections, table
    rows, list items, placeholders and section references. `node scripts/workplan-index.mjs
    --write` changed nothing; `node scripts/lessons.mjs --check`: current.

**2026-09-28, the support-mail period filled.** Asked how long report mails in `support@ownpace.eu`
are kept, the owner chose *"Until resolved + 6 months"* (with *"Both parts"* for the facts a report
carries, 0130, and *"Send anyway"* when those facts cannot be read). Privacy 1.2's §9 row *Support mail
and problem reports* now reads: until the question or problem is resolved, and then 6 months more;
then deleted from the mailbox (NL: tot de vraag of het probleem is afgehandeld, en daarna nog
6 maanden). `«SUPPORT_RETENTION»` moved to the README's filled list. The owner also added the
DMARC report address (*"DMARC record was added"*).

**2026-09-28, later: review fixes to the revision below, same branch, not committed.** A
review checked the first draft against `main` at `683525c8`, for the law, for the code's truth,
and for the two languages; this entry says what changed, and where it differs, it replaces the
entry below. Both texts keep their draft marker. The Alpha conditions are not edited.

- **Kept, with the draft marker, a comment beside the sentence in both languages, and a line in
  `site/legal/README.md`'s *Before the draft markers come off*** (the owner's decisions, which
  code on its way makes true): *nothing uses your access after closing* (privacy §9, terms §11;
  the closed-organisation fix, uncommitted then; since #1320, `d7868276`, on this branch since
  `c1413b53`, nothing new starts, and work already running is not all stopped: the latest
  entry); the copy before an update *never longer than 7
  days*, now naming the sign-in service's copy too (privacy §9; `dump-idp.sh` keeps every dump,
  and the service's copy is taken and deleted by hand); *reports by mail* (privacy §4.5; 0130
  T5, on its branch then; merged since as #1318, `0c019ab8`, and on this branch).
- **Reworded to what holds today:**
  - Terms §1: *"Before you connect your first account, we give you these texts, each with its
    version number, and ask you to accept them. We keep a record …"*. It names no screen, so T3
    or a route the owner runs by hand can make it true; one must exist before the first
    invitation (terms briefing, precondition A, question 12).
  - Terms §13's language paragraph is v1.2's again (the English governs, except where mandatory
    consumer law provides otherwise), which is what `translationNote` above the Dutch privacy and
    terms pages says; the first draft's *both texts count* contradicted that note on the rendered
    page and is now terms question 15, with the note change it needs. Terms §3: 16 or older, and
    a parent's or guardian's permission under 18, as privacy §12's 16.
  - Privacy §4.5: *"The support screens cannot show your content"* replaces *"They cannot browse
    your content"*, and a paragraph says the person who runs the machine can reach the database
    and the key, to run and repair the service and to look into a problem, and that this is not
    in the read log (the support_log view's comment: audit detail is read *"with a database
    query"*). The download of the pseudonymised audit log, members' identifiers, and what of the
    read log outlives an erasure are named. The request's log line holds the email address.
  - Privacy §7: *"Nobody else administers it"* is gone, and a first row names the service in
    front of the machine that ends TLS, with `«INGRESS_PROVIDER»` and `«INGRESS_REGION»` (T0
    fact 1), also in §6's transfer bullet and `subprocessors.md`. The owner fills them, or
    deletes the row if TLS ends on the machine. §4.4's *"not at another company"* now speaks of
    where the account is kept.
  - Privacy §9: the sign-in account and the Google test-user entry are removed by hand on
    erasure day; a row for the sign-in service's own history, which removing the account does not
    remove (Zitadel keeps every event: its maintainers' *"all events still exist in the
    eventstore"*, zitadel/zitadel#2758, and the open request #7811; not yet checked on v4.19.2);
    the task runner's daily drill copies, newest seven kept (`box-duties.sh`); the rollback
    reason an operator types; what of the read log stays after erasure; the closing paragraph no
    longer says *"in one go"* and says what stays.
  - Privacy §11: the clause on *"two of the app's checks"* is gone (#1303 moved both under row
    security); the support views pass row security by design, each with an operator check; the
    TLS switch is *"Use SSL/TLS"*, which turns TLS off altogether; the key is also in the
    background tasks' settings (`set-task-env.sh`), as in §4.1; the breach paragraph tells the
    person, as the owner answered (*"We do tell the tester."*, answer 6 below).
  - Privacy §4.4: the name on a request is optional; nobody is let in without asking unless
    invited, and anyone can create a sign-in account that opens nothing; the sessions hold the
    browser and IP address (to be checked, as the history); *"we do not ask for or keep your card
    number"* (the billing route accepts brand, last four and expiry). §4.6: a withdrawal at the
    provider leaves a useless token until the migration is deleted or the data erased; a mail per
    kind of item shared, and again only on purpose. §5: rows for the audit log, a family member
    and invitees. §7: *"Beyond what this policy names"*. §8: the negative carves out a target the
    tester chose outside the EU.
- **Briefings**: the privacy briefing names `683525c8`, has questions 19 (the sign-in history)
  and 20 (rows that outlive erasure with no period), widens 2, 12, 13, 14, 15, 17 and 18, and its
  owner list adds the ingress, the drill, the sign-in history, telemetry, Proton's agreement, the
  card route, the database-access sentence and the app's own sentences. The terms briefing has
  preconditions A to F brought up to date (D, E and F resolved), a list of v1.3's changes that
  widen the owner's exposure, with the old wording beside each, and questions 15, 16, 20 and 26
  (the export) changed or new. `subprocessors.md` has the ingress row; `dpa.md`'s stale
  sentence is gone. `privacy.nl.md`'s and `terms.nl.md`'s header comments follow §13.
- **Not taken**, and why: the quote *"Ill add people by hand"* is in this plan's D4 (§2), as
  the entry below cites it, so it stays. No product sentence, deploy script or compose file is
  changed here: the app's own sentences, `dump-idp.sh`'s pruning, the pre-update copy's
  automation, the drill on live and the telemetry opt-outs are listed for the owner, each a
  change of its own. `«SUPPORT_RETENTION»` is filled after the review, below: the owner
  answered the same day. Alpha conditions §10's
  credentials sentence stays the owner's (item 11 of *For the owner* below).
- **Proved.** The same four files, `npx vitest run --project unit scripts/legal-docs.unit.test.ts
  site/site.unit.test.ts scripts/a-policy-link-that-answers.unit.test.ts
  scripts/one-way-to-report-a-vulnerability.unit.test.ts`: 4 files, 64 tests pass.
  `OWNPACE_APP_URL=https://app.ota.ownpace.eu node site/build.mjs --check`: *"4 legal page(s)
  marked draft"* and *"14 pages across 2 locales, 28 unfilled placeholder(s)"* (eleven per
  language in the privacy policy, three in the terms); `--public --check` refuses. The rendered
  pages carry none of the comments, and the Dutch terms page's note and §13 now agree. Both
  languages have the same sections, table rows, list items and placeholders.

**2026-09-28: the privacy policy (1.2) and the terms (1.3) revisited, at the owner's request,
for the owner's review (T1's texts, T5, T6)**, on branch
`claude/ownpace-public-readiness-y7orc6-the-privacy-policy-and-terms-revisited`, on `main` at
`683525c8`, **not committed**. The owner: *"Can you revisite the privacy policy and terms? Make
changes if needed, and i'll review them. Make those with 'max effort'."* The lawyer's pass stays
deferred (*"legal: keep as is for now"*, 2026-09-27). Both texts keep their draft marker:
*Version 1.2 (draft — not yet published)* / *Versie 1.2 (concept — nog niet gepubliceerd)*, and
the same with 1.3 for the terms. The Alpha conditions (1.0, the owner's) are not edited.

- **What the revision rests on**, as the plans record it: households only, *"tester: households
  only for now."* (open question 6); the service carries on after the Alpha, *"End of aplha: we
  continue, perhapse move off the spark to other hoster."* (0131 open question 1 (b)); the site,
  and with it the service, on this machine, *"site will first be hosted on this machine during
  alpha"* (T0 fact 6; D5, *"It's all controlled by me and invite only."*); *"stored access after finished
  migration: keep until deleted or closes."* (open question 3 (a)); one copy before each update,
  *"7 days is ok"*, otherwise no backups (0134 open question 1 (b); D3); declined requests
  deleted 30 days after the decision, *"2a"* (open question 2 (a), built in #1255); *"mail at the
  start: real mail relay day one."*, through Proton, *"I was hoping to reuse my proton SMTP"*
  (0133 Status); reports by mail to `support@ownpace.eu` during the Alpha, *"b"* (0130 T5, on its
  branch, not merged then; merged since as #1318); *"public site: yes, search engine index."*
  (open question 1 (a)); the vulnerability channel, *"yes all three"* (open question 5); 7 days'
  notice and a close within 7 days (the owner's edit of the conditions, #1293); Google in Testing
  with test users added by hand, *"Ill add people by hand"* (D4); owner and admin only, *"6. The
  Roles (0137 T0): b"*.
- **Privacy, by section** (both languages; each has 13 sections and 6 subsections, 32 table rows
  and 12 list items):
  - *Header*: covers this website too; a box says the Alpha conditions apply as well and prevail.
  - *§1*: *"A person reads what arrives there."* (the Dutch *meelezen* read as monitoring).
  - *§2*: messages and files are not stored; what is kept about each item is §4.2's record.
  - *§3*: during the Alpha only households take part, so no data-processing agreement is
    involved; the people a migration touches now include a family member and the people items
    were shared with (§4.6).
  - *§4.1*: the key is kept apart from the database, but on the same machine (T1 point 11). The
    Dutch *"het doel te beschrijven"*, which also reads as "describe", is *"naar het doel te
    schrijven"*.
  - *§4.2*: the ledger keeps the name a person knows an item by (a message's subject, stored
    since 2026-09-18; a title; a contact's name; a file's name) and the provider's error text,
    which can name an address; and what each migration and the organisation keep beside it.
  - *§4.3*: the counts go with their migration (the briefing's old "30 days" was wrong).
  - *§4.4*, now *Your request for access, and your account*: the request (what is kept, the
    decision, who made it, when); the sign-in account at the sign-in service we run on the same
    machine (names, user name, password hash, sessions); the account (owner or admin during the
    Alpha); the Google address for the test-user list; no invoices during the Alpha; invoice
    details typed on the Billing page, and the VIES check.
  - *§4.5*: support mail arrives at Proton; *Report a problem* and *Report this link* go by mail
    during the Alpha, with what the mail holds and a warning about screenshots; server logs, for
    the app and this website, and what they can still name; what an operator sees (one person
    during the Alpha), including a look-up by address; the read log, which the app cannot change,
    goes at erasure and is sent on request; nobody reads content, for every provider.
  - *§4.6*, new, *People who are not our customers*: a family member who gave access through a
    grant link; people items were shared with (the list, and one mail from support@); invitees;
    link reporters; correspondents.
  - *§5*: rows for the request, the Google address, other people's data (legitimate interests,
    marked for the lawyer) and the copy before an update; no tracker on the app or the website;
    browser storage, no cookie of our own, the sign-in page's cookies; no automated decision;
    what a tester must give.
  - *§6*: the test-user list; the transfer bullet names the people a tester asks us to tell and
    the mail provider; Google is offered as a source only.
  - *§7*: during the Alpha everything runs on a machine we run ourselves, in
    `«HOSTING_REGION»`, and nobody else administers it (`«HOSTING_PROVIDER»` is gone); a row for
    Proton AG, for the mail and the support mailbox, in Switzerland; a later host is named before
    any data goes there (Alpha conditions §11); Mollie receives nothing during the Alpha; the
    owner and admins see the organisation's data; disclosure only where the law obliges.
  - *§8*: Switzerland and its adequacy decision, and the Google test-user step, replace *"no
    transfer … by us"* as an absolute.
  - *§9*: rewritten. The heading and the row *Credentials* / *Toegangsgegevens* keep their words,
    because Alpha conditions §2 cite them. Credentials by connection, grant link, finished
    migration, closing and erasure; organisation-level data (members, lists, the sharing list,
    the audit log) until erasure; a pass's record until erasure during the Alpha; log lines 60
    days; the app's errors 30 days; account and sign-in account with the 0, 7, 30 or 90-day
    windows; the request (open; declined, 30 days; granted, with the account); the read log;
    *The copy made right before an update*, at most 7 days; the background tasks' records (no
    period set, not reached by erasure); invoices (none during the Alpha); and three
    placeholders. The closing paragraph: no backups apart from the copy, a close within 7 days,
    and what an erasure removes and leaves.
  - *§10*: a check that a request is yours; §4.6's people; the right to object on its own; a
    complaint where you live or work.
  - *§11*: the key; TLS as the code does it (a person can switch it off for an account connected
    by server name; ADR-0037 §5's floors are not built); row security as `SECURITY.md` states it;
    a breach paragraph (Alpha conditions §4); the advisory form, then support@, five working
    days, and ask before testing (T9's channel).
  - *§12*, *§13*: plainer words; the version at the top shows which applies; during the Alpha,
    Alpha conditions §11 set the notice for what follows.
  - The briefing: rewritten for 1.2, with the old questions' status and new questions 11 to 18
    for the lawyer. `subprocessors.md` 0.2: the Proton AG row, no hosting row during the Alpha
    (`«HOSTING_REGION»`), the Switzerland exception in its opening, links to the rendered pages.
- **Terms, by section** (both languages; 15 sections each, the same paragraphs and bullets):
  - *§1*: the contract is these terms, the privacy policy and any additional conditions shown
    with them; during the Alpha the Alpha conditions apply as well and prevail; the texts are
    shown with their versions before the first connection, accepted there and recorded (T3);
    someone who only follows a progress link, or grants access through a link, is not a party.
  - *§2*: both switches named, *applying deletions* and *auto-applying relocations* (ADR-0031);
    copying is meant to end, and a migration kept copying after the switch-over still counts as
    running.
  - *§3*: the customer answers for what they do and for sign-in details they shared or did not
    protect; what goes wrong on our side, the sign-in service included, is ours; 18 or older, or
    a parent's or guardian's permission.
  - *§4*: the reading exceptions point at privacy §4.5 and §6.
  - *§6*, *§7* (set aside during the Alpha): a price change is a §12 change; a paid tier only
    after an order button; the express request is a confirmation in the app, confirmed by email;
    a *Withdraw from contract* function; the setup-work sentence removed.
  - *§8*: the Dutch restores *geregeld* (periodically).
  - *§9*: notice of planned maintenance that interrupts migrations; statutory rights kept.
  - *§10*: consumers, liable as the law provides, with no cap; business customers, the
    twelve-month cap; no limit for intent or deliberate recklessness, death or injury, GDPR
    compensation, or what the law does not let us limit.
  - *§11*: first paragraph: close by writing to support@, choose the erasure window, nothing uses
    the access from closing, and at erasure the credentials are destroyed and the access revoked
    where the provider allows it. It said *"On closure we delete your credentials"*, which open
    question 3 (a), Alpha conditions §10 and the code all contradicted. The second paragraph,
    which Alpha conditions §2 cite, is kept whole, with reasons given before an ending for a
    serious breach and a refund of any prepaid part.
  - *§12*: changes only for stated reasons; the customer may end at no cost before a change; a
    consumer may end within 30 days after a clearly worse one; where we ask for explicit
    acceptance, carrying on is not acceptance.
  - *§13*: consumers go to the court the law makes competent, and keep their own courts; only
    business customers go to Overijssel. Complaints: we name a dispute body by email and say
    whether we take part; ConsuWijzer and ECC-Net. Language: both texts count, the reading more
    favourable to the customer applies, and the English governs for business customers.
  - *§14*: a transfer to a successor keeps the customer's rights, is announced, and a consumer
    may end the contract first. *§15*: Dutch *"onze overeenkomst"*.
  - The briefing: preconditions A to F, what changed, and questions 12 to 25. `dpa.md` 0.2: not
    part of the Alpha; Annex A's credentials and preflight retention follow the owner's rule and
    the code; §8 and §12 (now *Transfers outside the European Union*) name the Swiss mail
    provider's adequacy basis; Annex B names auto-applying relocations.
- **Placeholders.** Filled, for the owner's review: `«EMAIL_PROVIDER»` and `«EMAIL_REGION»`,
  with Proton AG, Switzerland (0133 kept them as tokens until the owner's final-text pass; the
  owner may send them back). Dropped: `«HOSTING_PROVIDER»`. New: `«SUPPORT_RETENTION»` and
  `«UNADMITTED_SIGNIN_RETENTION»`. Left: `«REGISTERED_ADDRESS»`, `«VAT_NUMBER»`,
  `«HOSTING_REGION»`, `«LOG_RETENTION»`, `«SUBPROCESSORS_URL»` (now without backticks, so the
  build counts it) and `«PRIVACY_HISTORY_URL»`. The Alpha conditions have none.
- **`site/legal/README.md`.** The table lists exactly the eight tokens the texts use, with where,
  what fills each and who; filled and dropped tokens moved to a list under it. A new table says
  where each text stands, with its version line. What a final version line looks like no longer
  assumes the lawyer's pass. *What must stay true* follows the texts: the ledger's names and
  error text, both deletion switches, the EU with Proton's named exception and the Google
  test-user step, Google offered as a source only, households during the Alpha. The language
  paragraph and the cookie bullet say where things stand.
- **Proved.** `npx vitest run --project unit scripts/legal-docs.unit.test.ts site/site.unit.test.ts
  scripts/a-policy-link-that-answers.unit.test.ts scripts/one-way-to-report-a-vulnerability.unit.test.ts`:
  4 files, 64 tests pass. Before the README's two new rows, 63 passed and 1 failed:
  *"privacy.md uses «SUPPORT_RETENTION» but site/legal/README.md does not list it"*.
  `node site/build.mjs --check`: *"4 legal page(s) marked draft"* and *"14 pages across 2
  locales, 22 unfilled placeholder(s)"*, eight per language in the privacy policy and three in
  the terms; `--public --check` refuses, as it should. Both runs repeated at `683525c8`, with the
  same results. A script found the README's table equal to the set of tokens in the rendered text
  of all eight files. The workplan and guard indexes regenerated, and their checks and
  `adr-operative.mjs --check` pass.
- **Promised in the drafts, not yet true on `main`**, so the draft markers stay until each is
  built or the sentence changes:
  1. *Nothing uses your access after closing* (privacy §9, terms §11, Alpha conditions §10): the
     sync tick's `ACTIVE_MAPPINGS_SQL` (`managed-sync-tick.ts`) never reads the organisation's
     status, so a closed organisation still gets new passes until the purge. A fix is queued,
     *"Stop sync passes for closed organisations"*. *(Since: #1320, `d7868276`, on this branch
     since `c1413b53`, starts nothing new for a closed organisation; work already running is not
     all stopped, so it is not fully true yet: the latest entry.)*
  2. *The copy made right before an update, never longer than 7 days* (privacy §9, Alpha
     conditions §6): taken and deleted by hand (0134 T0 step 4; `stand-up-live.sh`: *"no script
     takes it or deletes it yet"*), and `deploy/compose/dump-idp.sh`, run before each upgrade of
     the sign-in service, keeps every dump (*"none is ever overwritten"*), with the provider's
     accounts and password hashes. Live's daily `drill` duty (`box-duties.sh`) also dumps the task
     runner's database and keeps the newest 7, which hold the records privacy §9's background-task
     row names.
  3. *Reports by mail* (privacy §4.5): 0130 T5 is on its branch, not merged. On `main` the form
     needs a Zammad, and item 5 of the entry below in which the owner answered the nine questions
     still names one. *(Since: #1318, `0c019ab8`, merged 2026-09-28 and on this branch; true on
     live once live's `.env` has no `ZAMMAD_URL`.)*
  4. *Acceptance shown and recorded before the first connection* (terms §1): T3, proposed.
     *(Since: built 2026-09-28, the Status block's entry of that day; not merged.)*
  5. *(Removed by the review fixes above: owner or admin only is on `main`, a1625f08, #1294,
     0137 T7. Before the first invitation, `operator.sh check role-below-admin` runs on live.)*
  6. *(Resolved by the review fixes above: terms §13 keeps v1.2's language rule, which the note
     above the Dutch privacy and terms pages states.)*
  7. Terms §6 and §7's order button, confirmation and withdrawal function: set aside during the
     Alpha, needed before any tier is paid.
  8. *(Added by the entry of the owner's NetBird answers, above.)* *No NetBird sign-in in front
     of the service* (privacy §7's row, whose log names no user ID): NetBird's sign-in (SSO) is on
     for the hosts NetBird serves (*"No pin, but SSO on"*), and by the owner's choice (*"Off
     everywhere at launch"*) goes off on `app.`, `id.`, `status.` and `www.ownpace.eu` before the
     first invitation, a precondition for it. Checked from outside the NetBird network: each host
     answers with the app or the site itself, not NetBird's sign-in page. *(Since: the check is
     built, merged 2026-09-29 as #1362 (`bfdfbf66`; the entries of 2026-09-28 and 2026-09-29): the
     exposure probe, dispatched on a GitHub-hosted runner, fails while NetBird's sign-in answers
     any of the four. The owner switched the sign-in off on 2026-09-29 (*"NetBird sign-in (SSO) is
     turned off"*). Still owed: a dispatch that passes, which needs the repository variable
     `EXPOSURE_PROBE_LIVE_PORTS`. Open until then.)*
- **The Alpha conditions, read against the revision** (not edited; they are the owner's 1.0):
  - **One contradiction.** §10 says *"We keep that access until you delete the connection or the
    migration."* Privacy §9's *Credentials* row says what the code does: a connection's access
    goes when the connection is deleted, which the app allows only once no migration uses it
    (`409 in_use` in `connections.ts`), and deleting a migration removes only access a family
    member gave through a grant link (`revokeCredentialRow` on the row's own
    `source_secret_ref`, `apps/api/src/routes/migrations/index.ts`). §2 makes the conditions
    prevail on exactly that row, so the shorter wording is the one that binds, and it promises
    more than the code does. For the owner: keep it, or in a 1.1, EN *"We keep that access until
    you delete the connection; access a family member gave through a grant link, until you delete
    the migration."* / NL *"Wij bewaren die toegang tot u de koppeling verwijdert; toegang die een
    gezinslid via een toegangslink gaf, tot u de verhuizing verwijdert."*
  - **No other rendered sentence contradicts the revision.** §2's two points of privacy §9 now
    say the same in both texts, apart from the one above. Four tensions are questions, not
    contradictions: §4's heading, *"No obligations, on either side"*, beside terms §10's consumer
    liability (the owner kept it: *"keep."*); §5's pause *"without warning"* beside terms §9's
    notice of planned maintenance, which the old §9 promised too (terms question 25); §11's 7 days
    beside terms §12's 30 (for the lawyer); and which erasure window applies to a tester whose
    account is closed for not accepting the new conditions (item 1 of *For the owner* under the
    owner's review of T2, below).
  - **The briefing comment is out of date** (it never renders): it names terms v1.2 and privacy
    v1.1, says privacy §9 still reads *"until the migration ends"* and terms §11 *"On closure we
    delete your credentials"*, reads terms §13 as making the English govern, and reads terms §10
    as capping a consumer's claim at nothing. A comment-only change, with no new version; the
    owner's to make.
  - §9 names only the tester's own Google address; privacy §6 also names the Google account of a
    family member sent a grant link. A sentence for a 1.1, if wanted.
- **Loose ends** (the privacy §11 clause, `dpa.md`'s sentence on the EU and `privacy.nl.md`'s
  header comment were fixed by the review fixes above):
  - The header of `scripts/one-way-to-report-a-vulnerability.unit.test.ts` says privacy §11
    names only the fallback. It now names the form first, then support@, so that guard can ask
    for both, in order (T9).
  - 0133's Status says `«EMAIL_PROVIDER»` and `«EMAIL_REGION»` stay placeholders until the
    owner's final-text pass; this revision filled them.
- **For the owner.** Read `privacy.nl.md` and `terms.nl.md` first; `git diff` shows every change.
  1. **Final or lawyer**: take privacy 1.2 and terms 1.3 as final yourself, as you did with the
     Alpha conditions 1.0, or wait for the lawyer's pass (T1)?
  2. **Facts** (T0): the machine's country (`«HOSTING_REGION»`), and whether any company houses
     it or can reach it; where TLS ends for `app.`, `id.`, `status.` and `www.ownpace.eu` (T0
     fact 1), and if at the mesh provider's ingress, its legal entity and region; the printed
     form of `«REGISTERED_ADDRESS»`, and `«VAT_NUMBER»`; a telephone number, and whether
     "Ownpace" is registered as a handelsnaam.
  3. **Proton**: keep *Proton AG, Switzerland* in the texts, or back to tokens? Is Proton's
     data-processing agreement accepted for the account behind `support@ownpace.eu`, and is that
     account Archico B.V.'s? Does Proton keep the service's sent mail in that mailbox?
  4. **Periods**: `«UNADMITTED_SIGNIN_RETENTION»` (30 days, as 0135 open
     question 6 proposes, built as 0135 T8 before publication?); `«LOG_RETENTION»`, and what
     enforces it now that the host keeps no month of container output; a period for the
     background tasks' records, or *"no period set yet"*.
  5. **Addresses**: `«SUBPROCESSORS_URL»` (publish `subprocessors.md`, in Dutch too, or make
     privacy §7's table the complete list?) and `«PRIVACY_HISTORY_URL»`.
  6. **Live's settings**: reports by mail with no `ZAMMAD_URL` (merge 0130 T5; merged since as
     #1318); where
     `NOTIFY_TO`, `ALERT_TO` and `REPORT_MAIL_TO` point; social sign-in on live, or email and
     password only (T0 fact 4)?
  7. **The copies**: prune `dump-idp.sh`'s dumps at 7 days, or delete them once an upgrade
     succeeds; automate deleting the copy before an update; and whether privacy §9 names the
     daily drill's dumps of the task runner's database, or the drill stops on live for the Alpha.
  8. **Wording choices**: operator searches by address stay after an erasure, or are purged in
     code; the sharing list stays after its migration is deleted, or goes with it; the Billing
     page's invoice-details form hidden during the Alpha (then privacy §4.4's sentence goes); when
     a family member's Google address comes off the test-user list; the list of testers kept off
     the machine (0134 T4), which privacy §4.4 and §9 then name; the breach sentence, *"where that
     is required"* as in the Alpha conditions §4, or every tester whose data a breach touches, as
     you answered (*"We do tell the tester."*); the new promise to send a tester what the read
     log holds about them; §11's TLS wording now, or ADR-0037 §5's floors built first; whether any
     file connector can write to a source (§4.1 names mail, contacts and calendars).
  9. **Terms**: no cap towards consumers, as drafted, or a cap with a floor (then the amount);
     18, or a parent's or guardian's permission, beside privacy §12's 16; both languages count
     (then `translationNote` changes), or the Dutch governs; updates during the Alpha announced
     in advance, or a sentence in the conditions or terms §9 that says they are not.
  10. **Before the texts go final**: is the closed-organisation fix required first (it is, for
     *"nothing uses your access after closing"* to be true), and is T3 built before the first
     invitation, or is terms §1 rewritten to another route?
  11. **The Alpha conditions**: §10's credentials sentence (the contradiction above), the stale
     briefing comment, and the erasure window after a closing for not accepting.

  For the lawyer, when the pass happens: privacy briefing questions 11 to 18 (Switzerland's
  adequacy wording, Google's role for the test-user list, legal bases and special-category data,
  targets outside the EEA, Limited Use, 7 days' notice, the language, the breach threshold) and
  terms briefing questions 12 to 25 (among them which dispute body to name), with its old
  question 5 on the EU ODR platform, whose repeal the briefing reports and does not assert.

**2026-09-28: T10, the production site deployed with live (0131 §6, group R7; T0 fact 6)**,
built on branch `claude/ownpace-public-readiness-y7orc6-the-site-deployed-with-live`, not merged.
Nothing has run on the machine. Live is not stood up (0132 T1b), and the scripts have run only
against the stubs in their guards.

- **What it builds on.** T0 fact 6, supplied 2026-09-28: *"site will first be hosted on this
  machine during alpha"*. The production site is served from live's own checkout, at the release
  tag, under the Compose project `ownpace-live-www`, live's project with `-www`. The scripts build
  the name from the project, as `two-stacks-on-one-box.unit.test.ts` requires of every name in
  them. That is PR #1275's option 1 with its option 4, run from `deploy-live.sh`. The texts a
  tester accepts are then the release's (T3). A text fix rides a new tag and a deploy with the
  hold. #1275 was merged separately (`4b93e061`) and is not on this branch's base; the tag must
  hold it.
- **The switch.** `WWW_LIVE=true` in live's `.env`, beside `WWW_PORT` and `WWW_BIND`. With
  `false` or no line, nothing about the site runs and a deploy is what it was. Any other value is
  refused, naming the key. `managed.env.example` lists `WWW_PORT=` and `WWW_LIVE=false` beside
  `WWW_BIND`, and says live's copy needs a port of its own.
- **Before the checkout, in a dry run too.** `deploy-live.sh` refuses: no `WWW_PORT` or `WWW_BIND`;
  a `WWW_PORT` that is not one port from 1 to 65535; a container of live's project with the compose
  service `www`; a tag whose `www.yml` gives the container a fixed name, or with no `www.yml` or
  `site/build.mjs`; a tag whose site still has unfilled placeholders; and a tag whose `--public`
  build refuses for any other reason. For the last two it extracts `site/` and `package.json` at the
  tag with `git archive` into a directory of its own, runs `--public --check` there and names the
  count, then, with a count of 0, the full `--public` build, the one the deploy runs after the
  checkout, and refuses on its exit code with its last words. `--check` is not that build: a refusal
  only the build makes would pass a dry run that ran `--check` alone, and fail the deploy after the
  checkout, with live moved and the hold on (a review's finding). `main` today would be refused with
  22.
- **After the bring-up, before the exposure check.** It builds the site in the checkout
  (`OWNPACE_APP_URL=https://app.ownpace.eu GIT_SHA=<commit> node site/build.mjs --public`, without a
  shell's `OWNPACE_STATUS_URL`). Then it runs `docker compose -p ownpace-live-www -f
  deploy/compose/www.yml --env-file <live's .env> up -d --force-recreate`, with Compose's words
  through the address filter. It waits up to `DEPLOY_LIVE_SITE_WAIT` seconds (120) for a healthy
  container, and asks it on loopback: `/` answers 200 without `noindex`, has at least one
  request-access link and every one leads to `https://app.ownpace.eu`, and `robots.txt` says
  `Allow: /`. Any failure is a deploy that did not take: exit 3, the hold stays on, logged. The
  exposure check still runs, and covers the site.
- **`deploy/compose/www-live.sh`**, new. It names the project, the switch and the production app
  once, and holds the Docker reads both scripts use. Its `check` is `box-duties.sh`'s fifth duty,
  `site`. Read-only, it fails on a `www` service in live's project whatever the switch, and with
  the switch on when `ownpace-live-www` is missing or not running healthy. A daemon that cannot be
  asked fails it. The service unit's `TimeoutStartSec` goes from 90 to 110 minutes, for five duties.
- **The probe (0132 T3 (c)).** `scripts/exposure-probe.mjs` knows `www.ownpace.eu` as the site's
  name, apart from the production names. Until it is routed to live it points at another host (the
  apex's, today), so the probe tries no port on an address of it that is not live's front (an
  address a production name or `EXPOSURE_PROBE_HOST` resolves to), and asks 443 for it only when
  every address of it is. The new dispatch input `site_name` says whether it must answer:
  `report`, the default, records what it found; `required` fails unless it resolves to live's
  front alone and answers over TLS. A dispatch during live's stand-up (0132 T1e, T3 (c)) is then
  not red for a site that waits on the texts.
- **Docs.** `deploy-live.sh`'s header. `docs/managed-bring-up.md`: a new section,
  *`www.ownpace.eu`: live's copy*, under *The public site*; the daily duties' table; the deploy
  section; and *The OTA site is recreated by hand*. `docs/incident-runbook.md`'s *Website* row, with
  the exact `-p ownpace-live-www` commands. `www.yml`'s comment on who recreates the site.
- **Proved, guard first.** `scripts/a-deploy-from-a-named-tag.unit.test.ts` gains 34 cases. On
  `main`'s code 31 fail and 3 pass: the two with the switch off, and that `site/dist` is ignored.
  One case builds the real `site/` from its tag and expects the count its own `--check` gives (22
  today). The site's cases pass with #1275's `www.yml` in place too.
  `scripts/a-duty-the-gate-used-to-do.unit.test.ts` gains 14 cases for the fifth duty; 23 of its
  58 fail on `main`. `scripts/exposure-probe.unit.test.ts` gains 7 cases for the site's name and
  its mode, and `a-probe-that-knows-every-port.unit.test.ts` 1 for the input. Two of the deploy
  cases came with a review (deploy and dry run): a tag whose `--check` counts 0 and whose
  `--public` build refuses is refused before the checkout; with the full test build skipped, those
  two and the two cases that count the builds go red. Sweeping every address of the site's name turns
  three of the probe's new cases red. Nineteen mutations each turned a guard red: no `-p`,
  no `--env-file`, a failed build not counted, placeholders not refused, a `www` service in live's
  project not refused, the site step after the exposure check, the switch ignored, the site checks
  after the dry run's stop, Compose's words not filtered, `OWNPACE_STATUS_URL` passed on, an
  unhealthy container taken for healthy, `robots.txt` not read, the site's state asked of live's
  project, the test build run in the checkout, `box-duties.sh` without the duty, the duty ignoring
  a `www` service, taking a Docker failure for nothing there, or passing a container that is only
  running, and the probe without `www.ownpace.eu`.
- **After a review, on the same branch.** Two refusals that survived the review's mutations now have
  cases in `a-deploy-from-a-named-tag`, which has 37 for the site: a `WWW_PORT` above 65535
  (`65536`, five digits as the pattern allows; deploy and dry run, the value never printed), and a
  home page with no request-access link at all, a deploy that did not take. Without the `-gt 65535`
  test in `deploy-live.sh` the first two go red, and without the `right -eq 0` test the third; each
  passes with the script restored. The dry run said *"Nothing was … built"* in the line just before
  the one saying the site was test-built: it now says nothing was built in the checkout, and the
  guard's pattern follows. `docs/managed-bring-up.md` said never to type a command for live's copy,
  beside the incident runbook's hand-typed restart; it now says only `deploy-live.sh` builds the
  site and every command typed for it carries `-p ownpace-live-www`, and `www.yml` ("by nothing
  else"), `www-live.sh`, `deploy-live.sh`'s header and `managed.env.example` say the same. A
  `WWW_PORT` another container publishes stops the site at its `up`, not at the wait for health, and
  the bring-up's dry-run sentences say what the dry run builds. 0132 T1e now routes `www.ownpace.eu`
  to live's `WWW_PORT`. And `www.yml`'s comment named live's copy's project by its literal name,
  which `two-stacks-on-one-box`'s guard from #1275 refuses in that file (1 case red on this branch
  since its merge with `main`); it now says live's project with `-www` after it.
- **After a second review, on the same branch.** The sentences of the first review still said too
  much. *"Every command for it carries `-p`"* is true of each `docker compose` command, not of
  `www-live.sh check`, which builds the name itself: the bring-up's lead and *Looking at it*, the
  incident runbook's *Website* row, `www-live.sh`'s and `deploy-live.sh`'s headers now say
  `docker compose`. *"By hand only restarted"* left out the `down` the bring-up gives after
  switching the site off, and *"with each deploy of live"* holds only while `WWW_LIVE=true`: the
  bring-up's *The OTA site is recreated by hand* and `www.yml`'s comment now name both. The
  header of `deploy-live.sh` said the home page passes when every request-access link is right,
  which a page with none satisfies; it now says at least one, and every one, as the code does. The
  refusal of a tag whose `--public --check` itself fails, the one a legal page marked draft meets
  once the tag's `site/build.mjs` has T2's check, named no way on; it now ends as the count's and
  the build's refusals do, *"… or set WWW_LIVE=false to deploy the app alone."* A new case in
  `a-deploy-from-a-named-tag`, run for deploy and dry run (39 for the site; the stand-in's
  `--public --check` prints the words, the count last, and exits 1, as #1293's does), goes red in
  both without that line, and the real-site case asserts it too: run against #1293's `site/` it
  passes, and goes red without the line. `managed.env.example` and the bring-up no longer say
  *"once #1293 is merged"*: they say where the tag's build has T2's draft check. T10's row said
  open question 1 was answered, which on this base has no answer line; it now says `--no-drafts`
  is not needed by that answer. **Whichever of this branch and #1293 merges second** resolves
  T10's row by hand, keeping #1293's answer line under open question 1 and this branch's wording
  of the row, and says #1293 is merged there.
- **Not built: a check that `WWW_PORT` is free.** It needs a `docker ps` of the whole daemon, which
  `two-stacks-on-one-box.unit.test.ts` allows only in `exposure-check.sh`. A port another container
  publishes stops the site's `up`, and that deploy does not take; `managed.env.example` and the
  bring-up say so.
- **The first deploy with the step.** `deploy-live.sh` runs the copy its checkout had before it
  moved. If live runs a tag from before this change, the site first comes up when
  `deploy-live.sh <same tag>` runs again, with the hold still on. The bring-up says so.
- **For the owner.** `WWW_LIVE=true` publishes an **indexable** site: the step builds with
  `--public`, and a home page with `noindex` or a `robots.txt` without `Allow: /` is a deploy that
  did not take. That follows your answer to open question 1 of 2026-09-28, *"public site: yes,
  search engine index."*, which is (a), so (c)'s `--no-drafts` is not needed. Branch
  `claude/ownpace-public-readiness-y7orc6-alpha-conditions-in-concept` (#1293, not merged) records
  the answer under open question 1, and this branch leaves that line to it. **Keep `WWW_LIVE=false`
  until the legal texts are final.** With it `true`, every deploy and every dry run test-builds the
  tag's site with `--public` before anything moves, and a site that build refuses stops the whole
  deploy, the app's release with it. Today's texts are refused for their 22 unfilled placeholders.
  #1293 also makes `--public`, and `--public --check`, refuse a legal page whose version line says
  draft or concept, which every legal text's does today; once it is merged, that stops the deploy
  before anything moves too: `site_test_build` fails on the check's exit 1, and `site_ready` refuses
  with *"did not build with --public --check"* and the build's words (checked by hand on that
  branch's `site/`: exit 1, *"4 legal page(s) marked draft"*). Merge this. Fill the texts (T0, T1)
  and make them final, and T10's rendering of the conditions and `subprocessors.md` must be built.
  Cut a tag from a `main` that holds all of it. Only then, in live's `.env`, set `WWW_LIVE=true`,
  `WWW_PORT` and `WWW_BIND`, and `STATUS_SITE_ENABLED` and `STATUS_SITE_URL`. Add live's `WWW_PORT`
  to the repository variable `EXPOSURE_PROBE_LIVE_PORTS`. Deploy, then route `www.ownpace.eu` in
  NetBird (0132 T1e), then dispatch the exposure probe with `site_name` set to `required`.

**2026-09-28, later still: the owner answered the nine questions, and both texts follow.**

1. *"Yes, add this in the Dutch version."* A tester who has not accepted the new conditions by
   the day they take effect: we close the account, the data does not move along to the new
   service, and it is erased as §10 and the privacy policy describe. §11, both languages.
2. *"Verhuizing is plural in Dutch, so leave it as is."* The Dutch keeps *"Uw verhuizing"* for
   every migration; the English says *"Your migrations"* and *"with your migrations"*.
3. *"ok."* From the current hosting environment to another hosting provider, as it stands.
4. *"yes."* §6: *"That copy does not leave the hosting environment."*
5. *"yes, we need that. I haven't seen it funcitonal yet."* The report form (0130) is on in live
   for the whole Alpha, so §12's *Report a problem* is true. It sends by mail, not to a Zammad (the
   owner's *"b"*, later the same day): `REPORT_MAIL_TO=support@ownpace.eu` in live's `.env`,
   through the Proton relay (0133), and no `ZAMMAD_*` keys, since no Zammad runs during the alpha
   (0130 T5). T0 fact 3 below is answered by it, and the form's working on live joins what waits
   for the first invitation (0131 T5's 0130 row).
6. *"We do tell the tester."* §4: *"Wij melden u een datalek"* / *"We tell you about a data
   breach"*, where that is required.
7. *"explain context, i dont get it."*, then, told that the italics in §2 name privacy §9 by its
   heading: *"it should say "Hoe lang we het bewaren", so update the privacy.nl.md."*
   `privacy.nl.md` §9 already reads *"Hoe lang we het bewaren"*, and §2 cites it so: kept, and
   nothing else changes.
8. *"keep."* §4's heading stays *"Geen verplichtingen, beide kanten uit"*.
9. *"update."* The briefing's first line says *"VERSION 1.0, 2026-09-28: the owner's text for the
   Alpha; the lawyer's pass (0139 T1) is deferred."*

**2026-09-28, later: the owner's review of T2.** The owner edited both files on GitHub, on PR
#1293 (`bc210146`, the Dutch; `983f487d`, the English), and wrote: *"I did review on the Alpha in
PR 1293. I see some differences: the english offers some more info then the dutch version, like
on usages of the process link. Please check for differences and correct if needed."*

- **What the owner changed, kept as decisions.** *Alpha* capitalised in running text, in both
  languages. The *Version* line is 1.0 in both, with no draft or concept wording: the owner takes
  the text as final for the Alpha without the lawyer's pass for now (T1, deferred on 2026-09-27:
  *"legal: keep as is for now"*). 7 days' notice before a reset, the end, or the new conditions
  after it (§5, §11; open question 7, answered below). An account closed within 7 days of the
  request (§10; T7). *Hosting environment* / *hostingomgeving* in place of *the machine*, since
  the service may move to another host. §11 rewritten. §12 is *Reaching us* / *Ons bereiken*,
  without *"a person reads it"*, with *Report a problem* no longer conditional.
- **Carried across, or fixed, so both say the same, sentence for sentence.**
  - §1: the owner's Dutch passive carried into English, *"everyone in it was invited personally"*.
  - §2: Dutch cites privacy §9 as *Hoe lang we het bewaren* again, its heading in
    `privacy.nl.md`.
  - §4: English joins its two sentences as the Dutch does, and says *"report a data breach"*, as
    the owner's Dutch *"melden een datalek"* does (was *"tell you about"*). The colon the edit put
    inside the Dutch list of duties is a full stop now, in both: two sentences.
  - §5: Dutch 7 days (was the placeholder). Both refer to §6's *lost hosting environment*.
  - §6: Dutch *"Ze verlaat de hostingomgeving niet"* and *"de hostingomgeving van de Alpha"*, as
    the owner's English. **English: the erasure sentence restored**, *"If your account is erased,
    your data can stay in the backup for at most 7 days"*, in the owner's word *backup*: 0134 T2
    requires it, and the Dutch kept it. Both: the last sentence's *machine* is the hosting
    environment.
  - §8, the progress link (the owner's *"process link"*): the Dutch did not say whom to send it
    to, and said *status* where the English and the app (`viewLink.why`) have the plural. Now
    *"stuur die persoon dan de voortgangslink …: die toont aantallen en statussen"*. The rest of
    §8 matched.
  - §10: Dutch 7 days (was the placeholder); English *"within 7 days of your request"*.
  - §11: the owner's Dutch rewrite carried into English: *"your data does not move along to the
    new service"* (was *"we close it for you, before any of your data goes to another hosting
    provider"*), *"Your migration"* in the singular, and *"What you have already copied … with
    your migration"*. The Dutch *(migratie)* is *met uw verhuizing*, the conditions' own word.
    The first paragraph joins both edits: *"from its current hosting environment to another
    hosting provider"* / *"van de huidige hostingomgeving naar een andere hostingaanbieder"*.
  - §12: *"You can also use *Report a problem*"* (was *"Or use"*); Dutch *"… gebruiken"*. The
    warning never to send a password, a token or other sensitive data stays in both.
  - *gegevns*, *least7*, *hosting omgeving* and *"since your request"* fixed; trailing spaces
    gone and long lines rewrapped.
  - The lawyer's briefing, English only: *alpha.nl.md* in lower case again (twice). The edit
    turned the placeholder into «Alpha_NOTICE_PERIOD», which the placeholder guard does not
    match; question 1 now says 7 days. The *"still placeholders"* bullet says what the owner
    decided, and the end-of-Alpha bullet that the owner's §11 replaced the drafter's rule.
  - `site/legal/README.md`: the rows for `«ALPHA_NOTICE_PERIOD»` and `«ACCOUNT_CLOSE_PERIOD»`
    are gone; no placeholder is left in the conditions. Its note on them says the owner set 1.0.
- **Proved.** `site/site.unit.test.ts` and `scripts/legal-docs.unit.test.ts`: 36 pass, with no
  test changed. Both files have 12 numbered sections and the same version number; nothing pinned
  the old version line or the two placeholders. The other two guards that read `site/legal`
  (`a-policy-link-that-answers`, `one-way-to-report-a-vulnerability`): 28 pass.
- **For the owner:**
  1. §11: your Dutch no longer says the account of a tester who does not accept is closed. §10's
     erasure follows a closing, at the period the tester chose. Is the account still closed, and
     after which period is the data erased? And *"de nieuwe dienst"* is the service under the
     new conditions?
  2. §11: *"Uw verhuizing"*, singular, where §6 and the English had the plural. The English now
     follows. If you meant every migration, both go back to the plural.
  3. §11: your English said another hosting *provider*, your Dutch another hosting
     *environment*. Both now say from the current environment to another provider, as in your
     answer *"move off the spark to other hoster"*. If you meant any other environment, possibly
     at the same provider, both say *"another hosting environment"*.
  4. §6: *"The backup doesn't leave the hosting environment"* sits under *No backups*, and is the
     text's only contraction; the Dutch says *"Ze"* (that copy). *"That copy does not leave the
     hosting environment"*?
  5. §12: the app shows *Report a problem* only while the report form is on; otherwise the
     sidebar shows *Help: address* (`help.sidebar`). Is the form on in live for the whole Alpha?
  6. §4: *"melden een datalek"*, and now *"report a data breach"*, no longer say the tester is
     told. Intended?
  7. §2: *Hoe lang we het bewaren* is restored to match `privacy.nl.md` §9. If you want the
     shorter heading, that file changes with it.
  8. §4's heading, *"beide kanten uit"*, can read as "either way"; kept as you wrote it.
     *"over en weer"* is the alternative.
  9. The briefing's first line still says *"DRAFT FOR LEGAL REVIEW — v0.1"*. Keep it for the
     lawyer's pass later, or change it?

**2026-09-28, last: the owner set the copy's days and the admin clause follows the code.** The
owner: *"7 days is ok"*. `«UPDATE_COPY_DAYS»` is 7 in §6 of both files, and its row in the legal
README is gone; two placeholders are left, `«ALPHA_NOTICE_PERIOD»` (open question 7) and
`«ACCOUNT_CLOSE_PERIOD»`. §8's last clause now says what an admin cannot do as 0137 T7 found it in
the code, the Team page's line: *"behalve de organisatie sluiten of heropenen, het toepassen van
verwijderingen of het automatisch toepassen van verplaatsingen aan- of uitzetten, en iemand
eigenaar maken"* / *"except close or reopen the organisation, turn applying deletions or
auto-applying relocations on or off, and make somebody an owner"*. 0137 §3 T0's source sentence
is that plan's, and its branch carries the same words; this branch no longer edits 0137.

**2026-09-28, later still: review fixes to T2, on the same branch.** Twelve findings, one of
them blocking, all taken. On three, the draft now says one thing for the owner to confirm:
§10's credentials after closing, §11's rule for a tester who does not accept the new conditions,
and terms §11's export.

- **`--public --check` refuses what `--public` refuses** (the blocking one). It never read the
  version lines: on a copy of `site/` with every placeholder filled, it exited 0 with
  `0 unfilled placeholder(s)`, and `--public` then threw. The entry below says nothing in
  `deploy/` or `.github/` runs the build with `--public`. That is true on this branch, but the
  site step built beside it (branch
  `claude/ownpace-public-readiness-y7orc6-the-site-deployed-with-live`, not merged) does:
  `deploy-live.sh`'s `site_ready` runs `--public --check` through `site_test_build` before
  anything moves and reads that count, and `site_up` runs `--public` after live has moved. With
  both merged, a deploy would have moved live and applied its migrations before the site refused.
  Now `--check` prints `[site] N legal page(s) marked draft on their version line, or with none`,
  and under `--public` exits 1 with the build's refusal, naming each file. The placeholder count
  stays the last line, in its shape, so `site_test_build`'s pattern still reads it, and the exit
  makes `site_ready` refuse with the refusal among the last lines it prints. That branch's
  bring-up step 1 (*"its last line must say `0 unfilled placeholder(s)`"*) stays true. It should
  also say the command exits 0, which is that branch's text to change.
- **The refusal reads every `legal/` entry of `SOURCE`**, as its comment said, not only those in
  `PAGE_KEYS`. T10 may render the conditions outside the nav, as the 404 page is.
- **`DRAFT_WORDS` gains *ontwerp* and *voorlopig*.** `VERSION_LINE`, `DRAFT_WORDS` and
  `versionLineOf` are exported. `scripts/legal-docs.unit.test.ts` reads each version line through
  `versionLineOf`, in a child process, instead of keeping a copy of the pattern.
- **Proved.** `site/site.unit.test.ts`'s block has 18 cases, 8 more: a version line inside a
  comment above a final one is not read, and a final-looking one in a comment does not hide a
  draft line; *ontwerp* and *voorlopig*; a legal `SOURCE` entry outside `PAGE_KEYS` (the copy's
  `SOURCE` patched) is refused; `--public --check` refuses a draft line and passes a final one
  with the placeholder count last; `--check` without `--public` counts and passes; today's real
  texts fail `--public --check` too. Mutations, each killed: no comment stripping (1 case fails),
  `PAGE_KEYS` instead of `SOURCE` (1), no exit code under `--check` (2), without the two Dutch
  words (2). In `legal-docs`: the build not exporting `versionLineOf` (1), a Dutch version number
  that differs (1).
- **The texts.**
  - §2: the conditions prevail over the privacy policy as well as the terms, and name privacy
    §9's two points: the copy before an update (§6) and the *Credentials* row (§10). §4 keeps data
    *"no longer than the privacy policy and §6 and §10 here say"*.
  - §2: the export in terms §11 still applies if the service is discontinued, because no answer
    of the owner's drops it. The briefing's question 1 asks whether it should stay.
  - §6: the data can stay in the copy *"for up to 7 days"* (the number since set), and the Dutch says
    what a lost machine takes: *"de gegevens van de dienst en die kopie"*.
  - §8, Dutch: *verhuizing* throughout, and *"geef die persoon dan de rol beheerder"*. 0137 T0's
    source sentence is reworded the same way.
  - §9: Ownpace's app at Google is in Google's test phase, not the tester's connection (0140).
  - §10: the access is kept until the tester deletes the connection or the migration. After
    closing nothing uses it, and it is destroyed when the data is erased, at the end of the
    chosen window. That is what the service does (`closeTenant` stops the service, and the purge
    destroys it; **corrected 2026-09-28:** the close did not stop syncs until 0085's Status entry of
    that day, and since then nothing new starts after closing, though work already running is
    not all stopped: the latest Status entry), and it departs from the owner's *"keep until deleted or closes"* and from terms
    §11's *"On closure we delete your credentials"*. The briefing flags it for the owner. A new
    paragraph: at erasure the owner also deletes the sign-in account (T7, by hand until 0135 T8)
    and the Google test-user entry (0131 T4), and the access request is erased with the data
    (0131 §1).
  - §11 follows 0131 open question 1 (b) as it reads, *"new conditions are accepted first"*:
    migrations carry on under them only once accepted. A tester who has not accepted them by the
    day they take effect is closed as in §10, before any of their data goes to another hosting
    provider. That last rule is the drafter's; deemed acceptance under terms §12 is the
    alternative. The briefing says so.
- **One wording for the copy.** The decisions branch
  (`claude/ownpace-public-readiness-y7orc6-the-owners-answers-of-28-september`, not merged)
  drafts its own sentence for the copy in 0134 T2. 0134 T2 now says §6 is the text, so when both
  merge, that sentence gives way to §6.
- **What `--public` needs, said where it is described:** T10 below, and its row, where (c),
  `--no-drafts`, is marked not needed (open question 1 (a)); `docs/google-oauth-verification.md`
  (the home-page row and step 3); `site/legal/README.md`, which now says what a final version
  line looks like; and `docs/managed-bring-up.md`, for `--check`.
- **Not in this change, and needed before the conditions go out:**
  - §6's copy. The dump before a deploy is taken by hand today (`deploy-live.sh` only suggests it
    under `--dry-run`), and nothing removes it, so *"never longer than 7 days"*
    has nothing behind it yet. 0132 T6 step 4's dump, with its automatic removal after that many
    days, comes first.
  - §8's *"a person can only be an owner or an admin"* is true once 0137 T7 is merged (branch
    `claude/ownpace-public-readiness-y7orc6-an-owner-or-an-admin-for-the-alpha`, not merged). That
    branch also corrects the last clause of 0137 T0's sentence against the code, and §8 takes it
    when both are merged.
- **For the owner:** is *"i think that might be more safe to do make a backup?"* a yes to 0134's
  (b)? Then §10 (credentials destroyed at erasure, not at closing), §11 (closing a tester who has
  not accepted), and whether the alpha keeps terms §11's export.

**2026-09-28, later: T2 drafted, at the owner's word, as version 0.1**, on branch
`claude/ownpace-public-readiness-y7orc6-alpha-conditions-in-concept`, not merged. This plan said
the owner writes the text. The owner, the same day: *"5. The alpha conditions (0139 T2): i want to
review it, where can i read it? and yes, also make the draft"*.

- **Where to read it.** `site/legal/alpha.nl.md`, the Dutch that testers read first, and
  `site/legal/alpha.md`. Both say *Versie: 0.1 (concept voor juridische toetsing — nog niet
  gepubliceerd …)* / *Version: 0.1 (draft for legal review — not yet published …)*. The site build
  does not render them (`SOURCE` is unchanged), and the app does not link them
  (`legal-links.ts` still names `conditions` in `NOT_BUILT_YET`). Rendering them is T10's.
- **What it says.** T2's ten points in twelve short sections, as an addendum to the terms. It
  lists what does not apply during the alpha, checked in `terms.md` and `terms.nl.md` (both
  v1.2): §6 (prices), §7 (withdrawal), §8 (billing), §15 (the withdrawal form) and §11's second
  paragraph (30 days' notice, and 90 days with an export). It reuses the sentences already
  drafted: 0134 T2's paragraph on backups, 0137 T0's on inviting others, 0131 T2's label and 0144
  T1's help section. The Dutch follows the glossary (*alfa*, *in rekening gebracht*,
  *Opnieuw verbinden*).
- **The owner's answers of 2026-09-28 it rests on**, verbatim:
  - the end of the alpha (0131 open question 1 (b)): *"End of aplha: we continue, perhapse move
    off the spark to other hoster."* The service carries on under new conditions, perhaps at
    another hosting provider. Testers are told in advance, with the new conditions and where the
    data would go, and may close their account instead (§11);
  - *"tester: households only for now."* (open question 6, below; §1);
  - *"stored access after finished migration: keep until deleted or closes."* (open question 3
    (a), below; §10);
  - *"database copy before live deployment: i think that might be more safe to do make a
    backup?"* (0134 open question 1 (b)): one copy of the databases right before each update,
    kept only to undo a failed update, until the next update succeeds and at most
    7 days (§6), the number the owner set the same day: *"7 days is ok"*;
  - *"mail at the start: real mail relay day one."*: sign-in codes and access decisions come from
    `support@ownpace.eu` through a real relay from the first day (§12);
  - *"public site: yes, search engine index."* (open question 1 (a), below);
  - 0137 T0 answered (b): the tester invites nobody, a progress link is for watchers, anyone
    invited is an owner or an admin, and the tester answers for whom they invite (§8).
- **Three new placeholders**, in the legal README's table: `«ALPHA_NOTICE_PERIOD»` (open
  question 7, not answered), `«UPDATE_COPY_DAYS»` (0134's answer named no number) and
  `«ACCOUNT_CLOSE_PERIOD»` (T7's stated number of days).
- **For the lawyer.** The comment at the top of `alpha.md` holds T1's questions 1 and 2, in the
  form of the briefings in `privacy.md` and `terms.md`, and what else the draft rests on:
  households only, so no data-processing agreement; privacy §9's credentials row, which open
  question 3 (a) changes; and the copy before an update.
- **A draft cannot be published by accident.** `site/build.mjs` now refuses a `--public` build
  while a legal page it renders says *draft*, *concept*, *not yet published* or *nog niet
  gepubliceerd* on its *Version* line, in any case, or has no such line. The message names each
  file and its line. A build without `--public` still works. Privacy and terms say those words
  today, so `--public` refuses them until the owner's final text, as intended. Nothing in
  `deploy/` or `.github/` runs the build with `--public` (the site step's branch does; see the
  review fixes above). In `scripts/`, only
  `the-test-site-sent-people-to-production` does: it imports the build with `--public` in a child
  process to read `rendered`. The refusal sits where the build writes, beside the placeholder
  refusal, so that test passes unchanged. `docs/managed-bring-up.md` says so.
- **Proved.**
  - `site/site.unit.test.ts`, 10 new cases, on a copy of `site/` with fixture legal files, in a
    child process. Without the build change, 7 fail: a draft version line names its file and writes
    nothing; each of the four words, in any case; no version line; today's real texts, their
    placeholders filled, are refused by name. The 3 controls pass either way: final lines build
    `--public`, the word elsewhere on the page is not a draft, and a test build from drafts still
    builds. Mutations: 5, all killed (no `/i`; the whole file read; no refusal without a version
    line; no refusal; `**Versie:**` not read).
  - `scripts/legal-docs.unit.test.ts`: `DOCS` gains `alpha.md` and `alpha.nl.md`, so their
    placeholders must be in the README and they name the support address. A new case checks a
    *Version* line in every document, the same number in both languages. The Dutch-translation
    case in `site.unit.test.ts` names `alpha`. With the two files absent, 4 cases fail.
- **Not in this change:** rendering them and T2's guard half that the build renders them (T10);
  T3. Three texts elsewhere now say less than the answers: privacy §9 (credentials, the copy), and
  0131 T1's note and the grant mail, *"nothing is backed up"* / *"er worden geen back-ups
  gemaakt"*, next to the copy before an update. 0134 T1's erasure sentence then quotes
  `«UPDATE_COPY_DAYS»` instead of 0. Those are 0131's, 0134's and the lawyer's pass.
- **For the owner:** read `alpha.nl.md` first. Then the three numbers, and open question 7.

**2026-09-28: T10 (b), the site's second copy (0131 §6, group R7, step 9)**, built on branch
`claude/ownpace-public-readiness-y7orc6-a-site-named-by-its-project`, not merged.

- **The names.** `www.yml` keeps `name: ownpace-www` as the default. Its `container_name` is now
  `${COMPOSE_PROJECT_NAME}`, so under the default the container is still `ownpace-www`. Compose
  5.1.1 gives the service the same configuration hash as on `main`, so the next `up -d` does not
  recreate the OTA site. A second copy names its own project with `-p` on every command, and its
  container and network follow. It sets its own `WWW_PORT` and `WWW_BIND` in its checkout's
  `.env`.
- **Why `-p` and not the `.env`.** `www.yml` reads the same `.env` as `managed.yml`. Live's
  `.env` will set `COMPOSE_PROJECT_NAME=ownpace-live` (0132 T1b, decided, not stood up yet), so in
  live's checkout a bare `docker compose -f deploy/compose/www.yml` would put the site in live's
  own project (checked with `docker compose config` against a stand-in `.env`). There each file sees the other's containers as orphans. Nothing in a
  compose file can refuse the bare command. `www.yml`'s header, the bring-up's section on the
  public site and `managed.env.example` say so.
- **A refusal nobody meant is gone.** On `main`, that bare command fails on a machine where the OTA
  site runs: the fixed `container_name` is the OTA site's own and is taken, the conflict 0132 T1
  names. Now the container takes live's project's name, so the command succeeds as soon as live's
  `.env` has a `WWW_PORT` of its own, which a copy from that checkout needs anyway (checked with
  `docker compose config`, not on a machine). That is the price of a second copy that can start.
  `www.yml`'s header and the bring-up say so.
- **Proved.** `scripts/two-stacks-on-one-box.unit.test.ts` gains a block for `www.yml`, 6 cases, 4
  of which fail on `main`: the fixed `container_name`, `ownpace-www` written in four places besides
  `name:` (the container name and three comments), the two copies sharing a container name, and no
  `-p` in the header. It renders the file under two projects and checks that they share no container
  name, network, volume or host port, that the OTA site's container is still `ownpace-www`, and that
  the header says the refusal above is gone. Four mutations fail it: no `container_name`, and a
  fixed network name, host port or volume name.
- **What addressed the container by name.** Nothing in `deploy/` or `scripts/` runs a command
  against it. The healthcheck asks `127.0.0.1` inside the container, and the status page's
  `Website` row asks `STATUS_SITE_URL`. The incident runbook's `Website` row now says that a copy
  brought up with `-p` takes the same `-p`.
- **T0's fact 6, supplied the same day:** the reference machine serves `www.ownpace.eu` during the
  alpha, so the second copy this makes possible is the one the alpha needs. The change is harmless to the OTA site whichever way it is
  answered: the site keeps its project and its container name.
- **For the owner, if fact 6 puts `www.ownpace.eu` on the reference machine:** knowing that a
  bare command in live's checkout is no longer refused, one of three: `-p` on every command for
  live's copy, and the name it takes; a directory and a `.env` of the site's own, so that a bare
  command is safe; or a check on live's side that refuses when live's project holds a `www`
  service. Then that copy's `WWW_PORT` and `WWW_BIND`, and the route from `www.ownpace.eu` to that
  port, as in 0132 T1e.

**2026-09-28: T10 (a), one setting for every link the app makes to the texts (0131 §6, group R1,
step 6)**, built on branch `claude/ownpace-public-readiness-y7orc6-a-policy-link-that-answers`,
not merged.

- **The setting.** `VITE_LEGAL_SITE_URL`, a build argument for the web app. `managed.yml` passes
  it to the web build as it passes `VITE_OIDC_ISSUER`, and `apps/web/Dockerfile` declares it.
  Empty is the production site, `https://www.ownpace.eu`, which the grant page linked before.
  `managed.env.example` documents it. A value that is not an http(s) origin alone is refused,
  and the error names the setting. The web build refuses it too (`vite.config.ts`), because the
  grant page reads it while it renders and the web app has no error boundary: a typo would
  otherwise blank the page for every recipient.
- **The module.** `apps/web/src/services/legal-links.ts` turns the setting into an address per
  page and per language, for the pages the site build writes: the privacy policy and the terms,
  in English and Dutch. The grant page reads it, and its own table is gone. The request form, the
  Connect panel and the report form link no text today, so nothing else moved. T4 adds their
  links from this module.
- **Not links yet.** The site build does not render the alpha conditions or `subprocessors.md`.
  Their text comes from T2 and T5, and T10 renders them. The module names both in
  `NOT_BUILT_YET` and gives them no address.
- **Proved.** `scripts/a-policy-link-that-answers.unit.test.ts`, 20 cases. On `main` all fail
  but one, the control that a good value builds. It runs the site build in a child process.
  Every address the module produces, from `legalLinks()` as the grant page reads it and from
  `legalUrl()`, with the setting empty and with the OTA site's value, is a file the build writes
  for that language and page, on the site the case expects. It fails when the build renders a
  legal page the module does not link. It checks `managed.yml`, the Dockerfile and the example,
  that the web build refuses `www.ota.ownpace.eu` and builds the OTA value, that the default is
  the address the site build calls itself (`PUBLIC_SITE_URL`), and that no other shipped file in
  the web app names the site or a legal file. `site/build.mjs` now exports `SOURCE` for it.
  `Grant.unit.test.tsx` passes unchanged: the default gives the addresses it pins.
- **`scripts/legal-docs.unit.test.ts`.** `DOCS` gains the Dutch privacy policy and terms. A new
  case holds the list to the build's `SOURCE`, and fails with the old list.
- **For the owner:** the OTA stack's `.env` sets
  `VITE_LEGAL_SITE_URL=https://www.ota.ownpace.eu`, and its web image is rebuilt. Live leaves it
  empty.
- **Not in this change, and still T10's:** rendering the alpha conditions (with T2) and
  `subprocessors.md` in the site build, which gives `«SUBPROCESSORS_URL»` an address; publishing
  the texts with `--public` at `www.ownpace.eu`, served where T0's fact 6 says; (b), `www.yml`'s
  fixed project name and container name (group R7, step 9); and (c), the `--no-drafts` switch,
  needed only if open question 1 chooses (b). 0135 T5's `IDP_PRIVACY_URL` and `IDP_TOS_URL` take
  the same addresses when that task is built.

**2026-09-27, late: T9 written (0131 §6, group M3, step 6, its second half)** on branch
`claude/mailbox-sync-errors-c2xsw2-one-way-to-report-a-vulnerability`, not merged, as the owner
decided it the same day (open question 5).

- **`SECURITY.md`** names the advisory form, then `support@ownpace.eu` for someone without a
  GitHub account, as the only two channels. It promises an acknowledgement within five working
  days, and no date for a fix. Its new **Scope** covers the code in both editions and the hosted
  service, `ownpace-live` at the `ownpace.eu` names and the test stack at `ota.ownpace.eu`. It
  says that testing against the hosted service needs the owner's permission first, and points at
  the two bring-up guides for a stack of one's own. **Supported versions:** `main`, and the release
  the hosted service runs.
- **`/.well-known/security.txt`** is written by the site build (`site/security-txt.mjs`). It has
  the same two `Contact` lines in the same order, `Expires` 180 days after the build,
  `Preferred-Languages: en, nl` and a `Policy` link. `Canonical` names `www.ownpace.eu` on a
  `--public` build only.
- **Proved.** `scripts/one-way-to-report-a-vulnerability.unit.test.ts`, 8 cases, 5 of which fail
  on `main`: the scope, the versions and the five days, and the two channels in order in
  `SECURITY.md` and in `security.txt`. It also checks that `Expires` is ahead and under a year,
  that `Canonical` is on the public build only, and that the build writes the file. Privacy §11,
  in both languages, names one of the channels.
- **Not in this change:** privacy §11 names only `support@ownpace.eu`. The texts are the
  lawyer's pass (T1), which the owner keeps as they are for now, and that pass adds the form; the
  guard then asks for both, in order.

**2026-09-27: T6's access requests built (0131 §6, group M3, step 2)**, merged as #1255. The
owner answered open question 2 with (a) the same day.

- **A declined request is deleted 30 days after its decision.** `pruneDeclinedAccessRequests`
  (`packages/managed/src/access-request-retention.ts`) deletes every request whose state is
  `declined` and whose `decided_at` is more than 30 days old. The nightly `managed-retention` task
  runs it over the owner connection and logs the count and the cutoff, never who.
- **What stays:** an open request, however old, because the owner answers every one; a granted
  one, which goes with its organisation when offboarding purges it.
- **0093's rule, for people, is unchanged.** `app_user` still has no DELETE on the table, so
  neither the operator nor anybody else can make a decision disappear. 0093's rule and the
  decline route's comment now say it ages out on a stated date.
- **Proved.**
  - `packages/managed/src/a-request-nobody-keeps-forever.unit.test.ts`, on PGlite with both chains.
    The plan names it as an integration test; it is a PGlite unit test like the other managed
    guards. A request declined 31 days ago goes, and 29 and exactly 30 days ago stay. An open one
    and a granted one, 90 days old, stay. `app_user` gets *permission denied* on DELETE.
  - `apps/worker/src/jobs/a-request-nobody-keeps-forever.unit.test.ts` reads the task body as
    text: it calls the prune, and its log line names only the count and the cutoff.
  - Both fail on `main`.
- **Not in this change:** privacy §4 and §9's row for access requests. The texts are the
  lawyer's pass (T1), and the owner keeps them as they are for now.

**2026-09-27, evening: the owner answered open questions 2 and 5, and keeps T0 and T1 as they
stand for now.**

- **Open question 2: (a)**, *"2a"*. A declined access request is deleted 30 days after the
  decision, in the managed retention job, as T6 proposes. It is M3's step 2, next.
- **Open question 5 and T9's two facts**, *"yes all three"*:
  - one channel: the GitHub advisory form, with `support@ownpace.eu` as the fallback for someone
    without a GitHub account;
  - a report is acknowledged within five working days, with no promise of when a fix lands;
  - supported: `main`, until there is a release line, and the release live runs.

  T9 is the second half of M3's step 6, after this one.
- **T0 and T1**, *"legal: keep as is for now"*. Nothing in them changes.

**2026-09-27: T8 (a) written (0131 §6, group M3, step 6)**, merged as #1241. `docs/breach-procedure.md`
is the procedure §3 names:

1. **Contain:** the hold, the passes already running cancelled in the Trigger.dev dashboard, a
   tester's own credential, and the nightly gate paused before it rebuilds the OTA stack.
2. **Keep the evidence:** `app_event`, `support_read`, `platform_pause`, the journal and the audit
   export, copied off the machine before they age out.
3. **Assess:** what data (the data-processing agreement's Annex A), whose, how, both stacks, and
   the risk.
4. **Notify the Autoriteit Persoonsgegevens** within 72 hours where feasible (Art. 33).
5. **Tell the testers** when the risk is high (Art. 34), with the message in Dutch and English. A
   business tester is told as the controller (the agreement's §7).
6. **Register every breach** (Art. 33(5)).

It adds one paragraph on keys: the stored credentials have no rotation (`SECURITY.md`). The
docs index lists the page. No code, so no guard, as §3 says.

- **Not in this change:** the record of processing and the light impact assessment, which the
  owner keeps outside this repository (T8's other two parts). T9 waits on open question 5 (the
  channel) and on the owner's response target and supported versions.

**2026-09-27: T7 (a) built (0131 §6, group M3, step 3)** on branch
`claude/mailbox-sync-errors-c2xsw2-an-account-a-tester-can-end`, merged as #1237. A tester who asks the
owner to end their account can now have it ended. The Close button needs the organisation's own
owner signed in, and the owner is not.

- **One function, two doors.** The Close button and `operator.sh close` both call `closeAccount`
  (`apps/api/src/close-account.ts`):
  - in one transaction, in the organisation's context: the kinds it connected, `closeTenant`, an
    audit row, and the passes in flight;
  - after the commit, the orchestrator asked to stop each of those passes;
  - then the dates and the sentences, in both languages.
- **`operator.sh close <tenant-id> <window-days> --by <subject> --reference <request>`**
  (`apps/api/src/scripts/operator-close.ts`):
  - the window is one of `CLOSE_WINDOWS_DAYS`;
  - `--by` must be an appointed operator's subject;
  - `--reference` names the tester's request.

  It prints what to tell the tester.
- **The audit row** is `tenant.closed`. It names the actor (the owner at the button, the operator
  at the machine), `via` (`screen` or `operator`), the window, and the operator's reference.
  `tenant_closure.closed_by` names the operator. The audit export keeps `windowDays` and
  `reference` (`AUDIT_DETAIL_FIELDS`).
- **Found and fixed: on managed, a close never stopped a pass in flight.** 0085 T8's
  `stopPassesInFlight` read `run` on the API's pool, as `app_user`, with no organisation set. `run`
  is under FORCE ROW LEVEL SECURITY, so that read saw no rows, or failed on the emptied setting and
  logged a warning. Either way the orchestrator was asked to stop nothing, and the purge's quiesce
  was the only backstop. The read is now in the organisation's own transaction.
- **The runbook's Tenant offboarding** says how to close a tester's account at the machine. It also
  gains the identity provider's account after the purge, removed by hand in the console until
  0135 T8's script exists.
- **Proved.** `apps/api/src/scripts/an-account-a-tester-can-end.unit.test.ts`, 16 cases, against
  PGlite. The button runs as `app_user` through the real route, and the command over the owner
  connection:
  - for the same organisation, window and moment, the command answers what the button answers;
  - the printed lines carry both dates and both languages;
  - the audit rows name the operator and the reference, or the owner and `screen`;
  - refusals: a window outside the list, or not a number; no subject; no reference; a flag
    without its value; something that is not a tenant id; an option it does not have;
  - a subject that is not an appointed operator's writes nothing, and an organisation that is not
    there says so;
  - the passes in flight:
    - each door stops its own organisation's pass and no other's;
    - as `app_user` with no organisation set, a read of `run` finds none, which is why the old
      close stopped none;
    - an orchestrator that does not answer never fails the close.
  - **Mutations:** 18, all killed:
    - the passes in flight: never asked to stop; one the orchestrator never took asked; every
      organisation's read; a queued one skipped; a finished one asked; an orchestrator that does
      not answer failing the close;
    - the audit row: missing, without the reference, or always `screen`;
    - the command: closing under another name, without the operator check, at any window, without
      a reference, with another retention or at another moment; the printout in English only;
    - the button: closing under nobody's name, or never asking the orchestrator.
- **Not in this change:** the self-serve screen (0144, W14 in 0131 §5), and 0135 T8's script.

**2026-09-27: T6's migration-delete revocation built** (0131 §6, group M3, step 1), merged as
#1229. §1 found that deleting a migration dropped our copy of the credential its own row holds
and revoked nothing. That credential is `source_secret_ref`, the token a person granted through a
grant link.

**2026-09-27: T6's task runner's stores checked (0131 §6, group M3, step 4)**, with 0134 T1 (c), on
branch `claude/mailbox-sync-errors-c2xsw2-what-the-task-runner-keeps`, not merged. The full finding
is in 0134's Status block. In short:

- **Trigger.dev's own database, `triggerdb`, can hold a tester's personal data.** A failed run's
  error, `run-discovery`'s output and, probably, the run's logs can name a tester's folders,
  files and mailboxes, and quote the provider's own words.
- **Nothing limits how long it is kept, and the erasure never reaches it.** The dumps of it are
  kept by count, not by age.
- **ClickHouse and MinIO probably hold none of it on this stack.** Trigger.dev's defaults put a
  run's small payloads, outputs and log events in `triggerdb`. 0134 lists the checks that settle
  it on live.
- **So this bullet of §3 is answered, and the texts cannot say how long yet.** What follows is
  0134's open question 3: keep the text out of Trigger.dev (recommended), stop the dumps and say
  how long the run history lives, or prune by age.

**2026-09-27: T6's migration-delete revocation built** (0131 §6, group M3, step 1) on branch
`claude/mailbox-sync-errors-c2xsw2-a-deleted-migration-revokes-its-grant`, not merged. §1 found
that deleting a migration dropped our copy of the credential its own row holds and revoked
nothing. That credential is `source_secret_ref`, the token a person granted through a grant link.

- **The delete now revokes it**, with `revokeCredentialRow`, as the connection delete does:
  after the delete, so nothing is revoked until the row is gone and no network call holds the
  tenant transaction open. The source connection's kind, read in the same transaction, decides
  how. Best effort: the answer carries `revocation`, and `failed` means the person withdraws it
  themselves. Only the row's own credential: the organisation's, on the connection, is never
  touched. A migration without one answers as before, with no `revocation`.
- **Proved.** `apps/api/src/routes/migrations/a-deleted-migration-revokes-its-grant.unit.test.ts`,
  against PGlite as `app_user` through the real route, with only Google's revocation endpoint
  stubbed. Deleting a migration that holds a granted token sends Google that token once, after
  the row is gone. The connection's credential is left as it was, and a migration without a
  credential of its own calls nobody. A migration that is not there, or is another
  organisation's, revokes nothing. Google not answering still deletes the migration, and the
  answer says the revocation failed. The two revoking cases fail on `main`.
- **Not in this change:** the screens do not show `revocation` after a migration delete yet;
  the rest of T6 waits on open questions 2 and 3.

**2026-09-24: opened from the owner's answers.** The readiness review of 2026-09-23 found that the
legal texts of the managed service are unpublished drafts with unfilled placeholders. It also
found that no screen shows them where a tester's data is collected, and that no tester accepts
anything. Several promises in the drafts are not what the code does. The owner answered that a
lawyer reads the texts before the first invitation, that the test is called an alpha, and that
the owner supplies the missing facts and updates the texts (§2). This plan is the single
checklist for that gate: the owner's facts (T0), the lawyer's pass (T1), the alpha conditions
(T2), the product changes that make the texts true where a tester meets them (T3, T4, T6, T7,
T10, T11), the names the texts owe (T5), the procedures behind them (T8), and the security
policy (T9).

It extends 0086 T5 and does not replace it. 0086 T5 still owns the legal surface for taking money:
the data-processing agreement for business customers and the paid journey (0086 T6). This plan
owns what must be true before the first tester is let in. Every legal sentence is the owner's to
write and the lawyer's to check. This plan names sections and never rewrites them.

Nothing in this plan is built. The grant page's links to the addresses the site build writes, in
the reader's language, and the legal README's list of those addresses are fixed in #1137, merged
2026-09-24 (`LEGAL` in `Grant.tsx`, and the README's table). Three drafts elsewhere feed this
plan: 0134 T2 drafts the paragraph on backups, 0131 T1 drafts the alpha note, and 0137 T0 drafts
the sentence on inviting others.

**2026-09-24, later: the owner chose ownpace-live beside ownpace-managed (0132 D-new), and #1137
merged.** Testers now use a second stack, `ownpace-live` (live), at the production names
(`app.ownpace.eu`, `id.ownpace.eu`, `status.ownpace.eu`), and the OTA stack stays CI's and the
demo's (D5). So the ingress T5 asks about is the one in front of the production names, the texts
are published on the production site at `www.ownpace.eu`, where the grant page already links
(T10, open question 1, now recommending the existing `--public` build), and T8's procedure no
longer starts by pausing the nightly gate, which never touches live.

| Task | Status | Notes |
|---|---|---|
| T0 The owner's facts: the placeholders and the names | ✅ **Placeholders done 2026-09-28** in the drafts, on draft PR #1317, not merged: from the owner's 71 answers, `«VAT_NUMBER»` filled (fact-vat (a)), `«REGISTERED_ADDRESS»` left out of the rendered texts for the Alpha (rec-address (c); it returns before the first paid tier) and kept in `dpa.md`'s parties, `«PRIVACY_HISTORY_URL»` filled (rec-privacy-history-url (a)), and `«SUBPROCESSORS_URL»` gone from privacy §7 (rec-subprocessors-url (a)); fact 1: NetBird GmbH's terms and data-processing agreement accepted on 2026-08-01, the agreement covering the proxy and its log (dpa-netbird-agreement (a); the owner's answers of 2026-09-28), NetBird's own sources read 2026-09-28, the proxy and its log kept at *Germany (EU)* by the owner's choice while the owner asks NetBird, and NetBird's sign-in (SSO), on for the hosts NetBird serves (*"No pin, but SSO on"*), to go off on every `ownpace.eu` host before the first invitation, the owner's choice (*"Off everywhere at launch"*), a precondition; fact 4 answered: email and password only (ops-social-signin (a)); no company houses the machine (subprocessors-machine-housed (a)) — *was:* ⏳ **Owner**, four placeholders open (`«REGISTERED_ADDRESS»`, `«VAT_NUMBER»`, `«SUBPROCESSORS_URL»`, `«PRIVACY_HISTORY_URL»`), and fact 4 without an answer | §3. No placeholder is left in a rendered text. `«REGISTERED_ADDRESS»` stays in `dpa.md`, and `«SUBPROCESSORS_URL»` in `dpa.md` and `subprocessors.md`, until the first business customer (`site/legal/README.md`). Values never go in this plan, only dates. |
| T1 A lawyer's pass before the first invitation | ⏳ **Owner**, deferred 2026-09-27 (*"legal: keep as is for now"*); the texts 🔨 **follow the owner's 71 answers of 2026-09-28**, on draft PR #1317, not merged: privacy 1.2 and terms 1.3 still drafts, the Alpha conditions 1.0 edited in place, `dpa.md` and `subprocessors.md` 0.2. The briefings mark each answered question and keep what is left for the lawyer (among them BW 3:15d without the address, the forum and language clauses, the paid-tier checks, Google's role for the test list, the legal bases); 📋 **Decided 2026-09-24** (D1) — *was:* revised 2026-09-28 for the owner's review, points 1, 2, 5 and 10 of §3 T1's list waiting on the owner or the lawyer | §3. The briefings at the top of `privacy.md`, `terms.md`, `alpha.md` and `dpa.md` are the brief. |
| T2 The alpha conditions, in Dutch and English | 🔨 **1.0 edited in place 2026-09-28** with the owner's answers, on draft PR #1317, not merged: §2 (terms §12's 30 days give way to 7; acceptance in the app), §4 (a breach that affects your data; terms §10 still applies), §5 (updates not announced), §6 (the copy until the update is shown to work, never past 7 days), §9 and §10 (a family member's Google address; access as the app keeps it), §11 (erased 7 days after not accepting); alpha-version-number (a) keeps 1.0 until the first acceptance; the briefing rewritten (alpha-briefing-comment (a)); not rendered — *was:* drafted 2026-09-28, reviewed by the owner the same day, version 1.0, the lawyer's pass deferred (T1); 📋 **Decided 2026-09-24** (D1, D2) | §3. Free, a few weeks, no obligations, no backups, no availability promise, how it ends. The owner wrote them in the plan; an agent drafted them at the owner's word. |
| T3 Acceptance recorded, with version and time, at first sign-in | 🔨 **Built 2026-09-28, review fixed 2026-09-29** on branch `claude/ownpace-public-readiness-y7orc6-a-text-accepted-with-its-version`, merged 2026-09-29 as #1360 (`2d3e113a`). Since the review: nobody is asked while any text is a draft (`LEGAL_DRAFTS`; 409 `acceptance_not_asked`), so live asks nobody until the release with the final texts, and a final text's words are pinned to its number (`ACCEPTED_WORDS`); issuing a grant link asks too; *Not now* ends the sign-in service's session; a door's refusal brings the screen up at once; only a bundle built for the Alpha asks on load; a member who leaves keeps their record until erasure. As built on 2026-09-28: `legal_acceptance` (managed 0032, appended and read, never changed), `LEGAL_VERSIONS` held to the texts by `scripts/a-version-the-tester-accepted.unit.test.ts`, `GET /api/me`'s `acceptance` and `POST /api/me/acceptance` (409 `version_not_current`), 409 `conditions_not_accepted` on adding a connection, a new key and creating a migration, the screen in front of every signed-in page, the conditions rendered by the site build, all while `OWNPACE_STAGE=alpha`; purged with the organisation (open question 4, answered 2026-09-29: *"Ok"*); Alpha §11's syncs waiting for the new conditions not built — *was:* 📋 **Decided 2026-09-28** (terms-acceptance-route (b), *"Build the in-app screen first"*); not built. The first invitation waits for it and its tests. The owner: *"People that are accepted in the Alpha do need to create a login for the app, accepting fits in there and should record what time/version the accepted of what document."* Terms §1, the Alpha conditions §2 and §11 and privacy §4.4 now describe it — *was:* 📋 **Proposed** | §3. A screen, one managed table, and no connection or migration before acceptance. The same screen asks again for the new conditions after the Alpha (Alpha §11). Open question 4 (the record after erasure) is answered: purged with the organisation (2026-09-29). |
| T4 A notice wherever a tester's data is collected | 📋 **Proposed**; two pieces 📋 **Decided 2026-09-28**, not built: the app's own sentences reworded in both languages (ops-app-sentences (a): the grant mail, the Alpha note, the request form), and a privacy line and a link in the mail to people items were shared with (privacy-share-mail-notice (a)), both before the first tester | §3. The request form, the identity provider's registration page (0135 T5), the Connect buttons, the report form, the share mail (`packages/shared/src/share-announcement.ts`). The grant page's addresses were fixed in #1137, merged 2026-09-24. |
| T5 The sub-processors named | 🔨 **Text done 2026-09-28** in the drafts, on draft PR #1317, not merged: privacy §7's table is the complete list and says so (rec-subprocessors-url (a)); NetBird GmbH, its terms and agreement accepted on 2026-08-01 and the agreement covering the proxy and its log (dpa-netbird-agreement (a); the owner, 2026-09-28), carries connections on through a WireGuard tunnel and keeps its own log of each request; Proton AG in Switzerland, with Art. 45 GDPR and Decision 2000/518/EC cited (privacy-switzerland-wording (b)); no hosting row, because no company houses the machine (subprocessors-machine-housed (a)); `subprocessors.md` unpublished until the first business customer; NetBird's own sub-processors read from its trust center 2026-09-28 (18 entries, none with a location); NetBird's sign-in (SSO), on for the hosts NetBird serves (*"No pin, but SSO on"*), to go off on every `ownpace.eu` host before the first invitation, the owner's choice (*"Off everywhere at launch"*), a precondition (privacy's to-do on NetBird, (d)), whose check ✅ is built, merged 2026-09-29 as #1362 (`bfdfbf66`): the exposure probe fails while NetBird's sign-in answers any of the four (item 8); the owner switched it off on 2026-09-29 (*"NetBird sign-in (SSO) is turned off"*), and a dispatch that passes is owed, once the repository variable `EXPOSURE_PROBE_LIVE_PORTS` is set; ⏳ **Owner**, not before the first invitation: NetBird asked where its proxy and log run, at which provider, and whether its own sub-processors receive either, the *Where* staying *Germany (EU)* by the owner's choice until it answers ((c)), and asked in writing whether the Alpha or a paid tier behind the proxy is commercial use under its terms §3.1, answered before the first paid tier at the latest ((e)); the agreement's sub-processors, their announcement, the right to object and the 7 days for the lawyer's pass ((b)) — *was:* NetBird's acceptance date, its agreement read, where its proxy and log run and at which provider, and whether its own sub-processors receive either still for the owner; before that, the text drafted 2026-09-28 with the entity name, the agreement, the proxy's location and whether a company houses the machine all to confirm; **nothing else receives anything** 🔨 **built 2026-09-28, review fixes 2026-09-29** on branch `claude/ownpace-public-readiness-y7orc6-nothing-phones-home`, merged 2026-09-29 as #1357 (`5f74ebc3`) (ops-telemetry (a)): Trigger.dev's two PostHog halves and the Prisma checkpoint its entrypoint sent, Zitadel's daily service ping, ClickHouse's crash reports, MinIO's release check and Mailpit's switched off; the demo's Nextcloud's update check, app store and connectivity check **not** switched off in this change (2026-09-29, later: a hook that did made the demo's first CalDAV write answer 500 in E2E (managed) #215, and #216 on `main`, which recreated the same container without it, passed; it holds fixtures only and is not on live; ⏳ a follow-up switches them off with a check that the demo's DAV writes still work); the demo's Stalwart's GitHub and jsDelivr downloads named and kept where it runs, the OTA stack, the self-host end-to-end run and a developer's machine, not live, as the owner preferred on 2026-09-29 (*"Perhaps not in live but yes in OTA?"*); `scripts/a-service-that-phones-home.unit.test.ts` — *was:* Nextcloud's switched off by a hook, and before that the demo's Nextcloud left on | §3. The ingress in front of the production names testers use (0132 T1e), the mail relay (0133 T5), the support channel (0130). |
| T6 What is kept, and for how long, made true | 🔨 **The copy before an update, and the drill off live, built 2026-09-28, review fixes 2026-09-29** (rec-copies (a), rec-drill (a)) on branch `claude/ownpace-public-readiness-y7orc6-one-copy-before-each-update`, **not merged**: `copy-before-update.sh`, taken by `deploy-live.sh` right before its checkout (only while the daily duties' timer runs), deleted by the owner once the update is proven and by the daily duties after 6 days less an hour, a rollback that erases again what was erased after the copy (`since`), and no drill on live; `privacy.md`'s and `privacy.nl.md`'s comments, `README.md`'s two items and `alpha.md`'s briefing say so; 🔨 **Credentials on delete built 2026-09-27**, merged as #1229; access requests 🔨 **built 2026-09-27**, merged as #1255; every period 📋 **Decided 2026-09-28** from the owner's answers and in privacy §9's draft: the copy before an update (rec-copies (a)), the drill off live (rec-drill (a)), support-screen searches and downloads 12 months (privacy-search-records (a): 🔨 built 2026-09-29 as `box-duties.sh`'s duty `searches`, `support-read-prune.sh --delete`, not merged, and running once live's timer is installed), the sharing list with its migration (privacy-sharing-list (b)), sent mail until resolved and then 6 months (privacy-sent-mail-copies (b)), the background tasks' records until the end of the Alpha (privacy-task-records (a)), the sign-in history checked first (privacy-signin-history (a)), accounts nobody let in removed by a daily script (ops-unadmitted-signin-cleanup (a), 0135 T8: ✅ built, merged 2026-09-29 as #1344 and #1345, and running once live's timer is installed; reviewed and fixed 2026-09-29, merged as #1367: an account that was let in is kept; a removed member's account 📋 **Decided 2026-09-29**, 7 days after the removal (0135 open question 13, *"Samen number of days"*, then *"7 days"*), 🔨 built the same day, not merged, with privacy §9's row in both languages), server logs with Docker's default (ops-log-driver (a), 🔨 built on branch `claude/ownpace-public-readiness-y7orc6-the-visitors-address-from-netbird`, not merged, 2026-09-28 and 2026-09-29: the journald step out of the managed guides, the breach procedure reading container output from Docker, and `stand-up-live.sh` refusing another driver; the check on the machine the owner's); the code for each of the rest 📋 **Proposed**, not built — *was:* the wording drafted 2026-09-28; the rest's code proposed | §3. Access requests, credentials, preflight counts, sign-in data, logs, the task runner's stores, run history. `site/legal/README.md`, *Before the draft markers come off*, lists what each needs. |
| T7 A tester can end their account | 🔨 **(a) built 2026-09-27, merged as #1237**: `operator.sh close`; the identity provider's account ✅ **since 0135 T8 (a), merged 2026-09-29 as #1344** (0131 §6, M3's step 7): `idp-strays.sh --subject <sub> --remove` in the runbook's *Tenant offboarding*, refused while the account still belongs somewhere — *was:* by hand until 0135 T8; *nothing uses your access after closing* is not fully true yet: since #1320 (`d7868276`, merged 2026-09-28), on this branch since `main` was merged into it in `c1413b53`, nothing new starts for a closed organisation, but work already running is not all stopped, and a verification or a confirmation reads to its end (terms briefing, precondition B); a tester who does not accept the new conditions after the Alpha is closed that day and erased 7 days later (alpha-s11-erasure-window (b)), which `operator.sh close <tenant> 7` already does — *was:* (a) built; terms §11 and privacy §9 describing the close in the drafts of 2026-09-28 | §3. An audited operator command for the close that exists without a screen, and the identity provider's account (0135 T8). |
| T8 A breach procedure, a record of processing, a light impact assessment | 🔨 **(a) the procedure written 2026-09-27**, merged as #1241: `docs/breach-procedure.md`; the record and the assessment are the owner's — *was:* 📋 **Proposed** | §3. One page in `docs/`, and two documents the owner keeps. |
| T9 SECURITY.md covers the hosted service, with one channel | ✅ **done** in #1257, merged 2026-09-27 (`12cb40fb`): `SECURITY.md`'s scope, versions and five days, and `security.txt` from the site build; privacy §11 names the form, then support@, in both languages in the draft of 2026-09-28 (not committed), so the guard, which asks for one channel, can ask for both, in order — *was:* 🔨 **Written 2026-09-27, not merged**; 📋 **Decided 2026-09-27** (open question 5): the advisory form with `support@ownpace.eu` as fallback, five working days, `main` and live's release | §3. Scope, supported versions, a response target, `security.txt`. |
| T10 The texts published where a tester can read them, with no placeholder left | (a) the link module ✅ **done** in #1270, merged 2026-09-28 (`a8ed15b5`): `VITE_LEGAL_SITE_URL` and `legal-links.ts`, the grant page on it; publishing with `--public` on the reference machine (T0 fact 6, answered 2026-09-28) 🔨 **built 2026-09-28** on branch `claude/ownpace-public-readiness-y7orc6-the-site-deployed-with-live`, **not merged**: `deploy-live.sh` builds the tag's site and serves it as `ownpace-live-www` when live's `.env` says `WWW_LIVE=true`, and `box-duties.sh` watches it. That build is `--public`, so indexable: the step follows the owner's answer to open question 1, (a), of 2026-09-28, *"public site: yes, search engine index."* (recorded under the question by #1293, merged 2026-09-28). Live's `WWW_LIVE` stays `false` until the texts are final: with it `true` a deploy refuses before anything moves; (b) the site's second copy, #1275, merged separately (`4b93e061`), which the tag must hold; the conditions 🔨 **rendered 2026-09-28** by T3, which links them, at `/alpha.html` and `/nl/alpha.html` outside the nav, not merged; still 📋 **Proposed**: `subprocessors.md` only when the first business customer arrives (rec-subprocessors-url (a), 2026-09-28; privacy §7's table is the complete list until then); (c) `--no-drafts` not needed, by that answer — *was:* (a) ✅ done in #1270; still 📋 **Proposed**: rendering the conditions and `subprocessors.md`, publishing with `--public` where T0 fact 6 says, (b) the site's second copy (draft #1275, the owner's call) and (c) `--no-drafts` | §3 and open question 1. The production site at `www.ownpace.eu`, from the `--public` build that already refuses placeholders and draft version lines, served where T0 says, and one setting for every link the app makes to them. |
| T11 A family member's permission, recorded | 📋 **Proposed**; waits on T1. Privacy §12 now says a grant link for a child under 16 is completed by the parent together with the child (privacy-children-grant-link (a), 2026-09-28) | §3. Only if the lawyer confirms the household model the terms describe. |

## 1. What there is today

Each fact below was checked at the current checkout on 2026-09-24, unless it says otherwise.
The review's findings this plan carries are `wp-0086-legal-and-stale-status`,
`journey-legal-drafts-block-public`, `legal-drafts-unpublished`,
`codecfg-legal-placeholders-block-public-site`, `legal-no-notice-at-entry`,
`legal-test-terms-mismatch`, `legal-access-request-kept-forever`,
`legal-netbird-unlisted-subprocessor`, `legal-credential-retention-overclaim`,
`legal-no-breach-ropa-dpia`, `legal-drafts-disagree-internally`,
`legal-social-signin-not-disclosed`, `journey-no-account-closure-path`,
`legal-idp-identity-not-erased`, `ops-no-incident-response`, `rootdocs-security-md-hosted-scope`,
`wp-0110-support-disclosure` and `legal-household-permission-uncaptured`. The review confirmed all
of them. Where its verifier added a limit, the limit is stated below.

### The texts, and why none can be published

- **Six drafts.** `site/legal/` holds the privacy policy and the terms in English and Dutch,
  the data-processing agreement (`dpa.md`) and the sub-processor list (`subprocessors.md`). The
  privacy policy and the terms say *"Version: 1.1 (draft for legal review — not yet published"*.
  The other two say *"draft v0.1"*. The README's heading is *"These are DRAFTS. Do not publish
  them yet."*
- **Two lawyer briefings already exist.** They are HTML comments at the top of `privacy.md` and
  `terms.md`, with ten numbered questions each. The site build strips them.
- **What the build renders.** `site/build.mjs` renders the privacy policy and the terms in both
  languages (`SOURCE`). It does not render the data-processing agreement or the sub-processor
  list. Run with `--check` against `app.ota.ownpace.eu`, it printed *"14 pages across 2 locales,
  22 unfilled placeholder(s)"*.
- **The public build refuses.** `--public` throws while any placeholder is rendered
  (`if (PUBLIC && drafts > 0)`). It also throws unless `OWNPACE_APP_URL` is
  `https://app.ownpace.eu` (`PUBLIC_APP_URL` in `site/prices.mjs`). A build without `--public` is
  noindex, and shows each placeholder visibly without stopping. It also throws when
  `OWNPACE_APP_URL` is the production address (`!PUBLIC && APP_URL === PUBLIC_APP_URL`), so a
  noindex build cannot point at `app.ownpace.eu`. The alpha now runs at `app.ownpace.eu` (D5). So
  the build that refuses placeholders is the one whose buttons lead to the alpha. It is also the
  indexable one: no `noindex` tag, and a `robots.txt` that allows everything.
- **Where the site is served.** `deploy/compose/www.yml` serves `site/dist`. Its header builds it
  with `OWNPACE_APP_URL=https://app.ota.ownpace.eu`, which is a noindex test build, and names
  `www.ota.ownpace.eu` as the test site. It declares a fixed project name (`name: ownpace-www`)
  and a fixed `container_name: ownpace-www`. The review found that `www.ownpace.eu` does not serve
  this repository's site. That was not re-checked here. The production names 0132 T1e routes to
  live are `app.`, `id.` and `status.ownpace.eu`; `www.ownpace.eu` is not among them.
- **The placeholders still open** in the documents (the README's table has twelve rows, of which
  three are filled and two are retired): `«REGISTERED_ADDRESS»`, `«VAT_NUMBER»`,
  `«HOSTING_PROVIDER»`, `«HOSTING_REGION»`, `«EMAIL_PROVIDER»`, `«EMAIL_REGION»`,
  `«LOG_RETENTION»`, `«SUBPROCESSORS_URL»` and `«PRIVACY_HISTORY_URL»`.
  `scripts/legal-docs.unit.test.ts` fails when `privacy.md` or `terms.md` uses a placeholder the
  README does not list. Its list of documents (`DOCS`) names those two only, so it does not read
  the Dutch files, the data-processing agreement or the sub-processor list.

**0086.** T5 is *"🟡 Drafted, not published"* and says *"Wants a lawyer, not this plan."* The
Status block is dated 2026-08-18 and says *"Nothing here is built"*, and T4 is still *"⬜
Planned"*, although 0093 built the request door that T4 plans, on 2026-08-22. This plan does not
edit 0086. Correcting its Status block belongs to whoever next works on 0086.

### Where a tester meets the texts today

- **The request form** (`RequestAccess.tsx`) shows one line, `access.privacy`: *"We keep what you
  type only to answer you; asking creates no account."* It has no link. The form stores an
  address, a name, an organisation and a note in the person's own words (managed migration 0002).
- **The grant page** (`Grant.tsx`) is the only screen that links the privacy policy and the
  terms. It used to link `https://www.ownpace.eu/privacy` and `/terms`, which are not files the
  build writes, and the site's nginx (`www-nginx.conf`, `try_files $uri $uri/ =404`) adds no
  `.html`. Fixed in #1137, merged 2026-09-24: it now links the files the build writes, in the
  reader's language (`/privacy.html` and `/terms.html`, `/nl/privacy.html` and
  `/nl/voorwaarden.html`, in `LEGAL`), and the legal README's table names the same addresses. They
  are on `www.ownpace.eu`, the production site, which is where the texts belong now that testers
  use the production names (D5). The review found that name does not serve this site (not
  re-checked here). T10 makes the host a setting.
- **The Connect buttons** (`ProviderConsentPanel` in `ProviderConsent.tsx`, the one path for
  Google, Microsoft and Dropbox) link neither text.
  `docs/google-oauth-verification.md` §5 requires *"Links to the privacy policy and terms sit
  beside the button, not in a footer."*
- **The report form** (`ReportProblem.tsx`, 0130) collects a description and a screenshot with no
  privacy link. 0130 T4 is 📋 Proposed.
- **The mails** in `packages/shared/src/notifications.ts` link neither text.
- **Acceptance.** Terms §1 says that creating an account or using the service is acceptance.
  Terms §7 relies on a customer's *"express request"* when the first migration is created. No
  screen presents the terms, and nothing in `apps/` or `packages/` records an acceptance. A search
  for `termsAccepted`, `terms_version` and similar names finds nothing.

### Terms written for a paid service

Terms §6 to §8 cover prices, the right of withdrawal and monthly billing through a payment
provider. Nothing is charged: `POST /api/billing/invoices/generate` answers
`409 billing_model_retired` (`NO_TIER_BILLING_CODE`). Terms §11 promises 30 days' notice before
the terms end, and 90 days' notice and an export if the service is discontinued. The alpha runs
for a few weeks (D2). Terms §9 already says there is no contractual uptime guarantee. Nothing in
the drafts covers a free test: that it may be reset or ended, or what happens to stored
credentials at its end.

### Promises the code does not keep

- **Access requests are never deleted.** Managed migration 0002 grants `app_user` INSERT on
  `access_request` and revokes DELETE. 0093 states the rule: *"No DELETE on `access_request` for
  anybody, operator included."* Offboarding purges only the rows that name the erased organisation
  (`PURGED_TABLES` in `packages/managed/src/offboarding.ts`), which is the granted request. Nothing
  prunes declined or open requests: neither `packages/ledger/src/retention.ts` nor a worker job
  names the table. The privacy policy has no section on access requests, in §4 or in §9. The
  review's *"nobody can delete them"* is slightly strong: the database owner can, and migration
  0020 did so for duplicates. There is no product path, runbook step or stated period.
- **Credentials outlive what §9 says.** Privacy §9 and the data-processing agreement's Annex A say
  credentials are destroyed when the migration ends or is deleted. The code differs in two places:
  - Finishing a migration (`POST /:mappingId/finish` in `operating-routes.ts`) keeps them on
    purpose. The answer says *"Set the mapping's status back to 'active' to resume"*.
  - Deleting a migration (`DELETE /:mappingId` in `apps/api/src/routes/migrations/index.ts`)
    deletes the row and revokes nothing. That row can hold a credential of its own
    (`mailbox_mapping.source_secret_ref`, written by `grant-ending.ts`).

  Deleting a connection does revoke (`revokeCredentialRow` in `connections.ts`, whose comment
  quotes the privacy promise). So does erasure (`revokeStoredCredentials`). A connection cannot
  be deleted while a migration uses it (`409 in_use`), so its credential lives until the
  connection goes, not until the migration ends.
- **Preflight counts.** Annex A says *"30 days if no customer relationship follows"*, and so does
  the privacy briefing's question 5. Privacy §4.3 and §9 say the counts go with their migration.
  The code agrees with §4.3: `migration_discovery` has `ON DELETE CASCADE` on its mapping (ledger
  baseline), and nothing prunes it after 30 days.
- **Account and sign-in data.** Privacy §9 says *"While your account exists, then 30 days"*.
  The close windows are 0, 7, 30 or 90 days, chosen by the customer (`CLOSE_WINDOWS_DAYS`). The
  identity provider's account is not erased at all: `offboarding.ts` never refers to it, the
  runbook's *Tenant offboarding* never mentions it, and ADR-0042 rules out an issuer-specific API
  in shipped code. 0135 T8 proposes the operator step.
- **Closing.** Terms §11 says *"You may close your account at any time."*
  `POST /api/tenants/:tenantId/close` exists with `requireRole('owner')`. Nothing in the web app
  calls it. `deploy/compose/operator.sh` has no close or erase command (its sub-commands are
  `list`, `add`, `remove`, `memberships`, `leave`, `check`, `clean` and `secrets`). The runbook's
  example calls the route with `$OWNER_TOKEN`, and an operator belongs to no organisation. So
  neither a tester nor the owner can close an organisation without raw API or database access.
- **Operators see service metadata.** 0110 turned support access on by default and disclosed it
  in privacy §4.5. That disclosure is in the unpublished draft only.
- **Social sign-in.** `managed.env.example` has `IDP_GOOGLE_CLIENT_ID`,
  `IDP_MICROSOFT_CLIENT_ID`, `IDP_GITHUB_CLIENT_ID` and `IDP_APPLE_CLIENT_ID` for sign-in
  buttons at the identity provider. The privacy policy mentions none of them, and §8 says there is
  no transfer to a third country *"by us"*. The keys are blank by default. Whether live's `.env`
  will set any of them is not visible from the repository (T0). 0140 T10 proposes email and
  password only, and 0135 open question 10 asks this for GitHub.
- **Isolation in the database.** Privacy §11, its Dutch mirror and the data-processing
  agreement's Annex B say tenant isolation is enforced *"in the database itself through
  row-level security"*, and Annex B adds that database roles hold least privilege. 0138 found
  that the eight per-tenant jobs in `apps/worker/src/jobs/` open their pool from
  `DATABASE_URL`, which `set-task-env.sh` composes from the owner role. Checked here: all eight
  `run-*.ts` jobs read `process.env.DATABASE_URL`. So the sentence holds for the application's
  requests and not yet for the background tasks. 0138 hands the wording to this plan. *Since
  2026-09-28:* #1323 (`d0138607`, 0138 T1 step 2), on this branch since `c1413b53`, has the
  eight per-tenant tasks and the standalone worker connect as `app_user` on `APP_DATABASE_URL`
  (`openTaskPools`, `apps/worker/src/jobs/task-pools.ts`), so the sentence holds for the app's
  requests and the per-tenant background tasks. The six scheduled jobs that span organisations
  (the sync tick, retention, the purge of closed organisations, the digest, the drift detector,
  group discovery) still connect as the owner on `DATABASE_URL`; 0138 T2 and T3 step 2 move
  them, on a branch of their own, not merged. Privacy §11 says exactly that, in both languages;
  `dpa.md`'s Annex B keeps its unqualified sentence for the one pass before the first business
  customer, and its briefing says what that pass must write.
- **A separately held key.** Privacy §11 says credentials are encrypted *"under a separately held
  key"*. 0134 §1 notes that the key is held apart from the database, in `.env`, but on the same
  machine, and hands the wording to this plan.
- **Who in an organisation sees what.** 0137 found that the privacy policy does not say this, and
  that §4.2 leaves out display names and stored error text. The finding was only partly confirmed.
- **A family member's permission.** Terms §3 requires it before another person's account is
  connected. `grant-ending.ts` enforces it on the grant-link path (*"The account that signed in
  must be the one the migration names"*). The password paths (app passwords, IMAP, an Apple
  app-specific password) record nothing.

### Who else handles the data

Privacy §7 and `subprocessors.md` list two current rows, both placeholders: the hosting and the
mail relay. `subprocessors.md` also has one planned row, for invoicing. None mentions an ingress.
The repository says that TLS for the OTA names is terminated by NetBird. `managed.yml` says so in
its comment on `ZITADEL_EXTERNALPORT` (*"netbird terminating TLS on 443"*), 0091 says *"Routing
and TLS are netbird's, not this repository's."*, and the troubleshooting table in
`docs/managed-bring-up.md` says that behind netbird the identity provider's port is 443,
*"terminated by something that is not Zitadel"*. The repository does not say whether that
terminator runs on the reference machine or is a service the mesh provider operates. The review's
DNS lookup found the OTA names resolving to the mesh provider's hosted ingress. That was not
re-checked here, and the region and legal entity were not confirmed.
`docs/google-oauth-verification.md` still says that anyone off the mesh gets a timeout.

Testers now reach live at the production names (D5): `app.ownpace.eu`, `id.ownpace.eu` and
`status.ownpace.eu`. 0132 T1e routes them in NetBird to live's ports, and has not been done. If
they are routed the way the OTA names were found to be, the mesh provider's hosted ingress sits in
front of every tester's request. Whether they are is T0's fact 1. 0132 T3 records the path a
tester's request takes, for the production names and the OTA names. No file in `site/legal/`
mentions NetBird.

### Procedures

- **No breach procedure.** The data-processing agreement's §7 promises to notify a controller
  *"without undue delay after becoming aware"* of a breach. No runbook in `docs/` describes what
  happens then. A search of `docs/`, `site/` and `SECURITY.md` for a breach procedure, a record of
  processing activities or an impact assessment finds only that promise.
- **Two vulnerability channels.** `SECURITY.md` says GitHub Security Advisories is *"the only
  reporting channel"*. Privacy §11 says to write to support@ownpace.eu.
- **The security policy's scope.** `SECURITY.md` has a reporting section and principles. It has
  no scope for the hosted service, no supported versions and no response target. The site has no
  `security.txt`.

## 2. The owner's decisions (2026-09-24)

Each decision gives the question in plain words, then the answer as given, typos included. Where
an answer needed a reading, the reading is stated.

**D1 — a lawyer first, and the owner writes.** *A lawyer's pass before the first invitation, or a
labelled beta notice? And can you supply the registered address, the btw-id and the hosting
details?* — *"Yes before, Alpha, and i can supply."* On the legal blocker (the drafts are
unpublished and full of placeholders, nothing is shown where data is collected, and no tester
accepts anything): *"I will update"*.

So the lawyer's pass happens before the first invitation, the test is labelled "Alpha", the owner
supplies the facts, and the owner updates the texts. This plan prepares what the owner and the
lawyer need. It does not write the texts.

**D2 — what the alpha is.** *Is the test free or paid, for how many people, for how long, and in
which language?* — *"Free and invite only. 10 to 20 people max. Dutch."* On the posture of the
test: *"Free. A few weeks. No obligations both sides."* On the missing database backup: *"No
obligations during controlled test"*.

"No obligations both sides" is read as the contract: no service level, no payment, no minimum
term, and either side may stop. It cannot switch off the duties the GDPR places on whoever
controls personal data: telling people what happens to it, keeping it secure, notifying a breach,
and answering rights. The alpha processes whole mailboxes from the first tester on. So T4 to T8
stay necessary in a free alpha, and they are sized for 20 people.

**D3 — no backups.** *How much loss is acceptable, how fast must service come back, and where are
backups kept?* — *"None during the test"*. 0134 carries it. T2 includes 0134 T2's paragraph.

**D4 — the owner is the gate, and supports each tester.** *What may a member and a viewer do, and
should only owners and admins invite?* — *"I am the gate for letting people in the test."* On a
tester stack apart from CI and the nightly gate, reachable from the internet: *"Yes, but its a
controlled rest. I Let people in and support them. Max 10/20 people"* ("rest" is read as
"test"). *Should the Google client move to
production, or stay in Testing with each tester registered in advance?* — *"Ill add people by
hand"*. On its tokens, which expire after about seven days in Testing: *"I add people,
controlled small test Group."*

So every tester is someone the owner granted, and the owner is their contact. The conditions (T2)
say how to reach the owner. The tester stack apart from CI and the nightly gate is `ownpace-live`
(D5).

**D5 — where it runs, and who can reach the machine.** *Where do testers run, and under which host
names?* — *"This machine, ci states. The OTA address. It's all controlled by me and invite only."*
("ci states" is read as "CI stays".) *Are ports 5432, 3001, 3090, 3443 and 3126 reachable from
outside, were the database passwords changed, and does the live identity provider hold other
organisations?* — *"No, these ports are not reachable outside of private network/NetBird.
Usernamea changed. No other organisations are hosted."* ("Usernamea" is read as "usernames".)
On rotating the demo secrets if the current stack is reused: *"Who would need/het credentials? I
aupporrthe test. No one will be added to NetBird network. Devs need to setup own private test/dev
environments. GitHub PRs and git is the bridge."* ("het" is read as "get", and "aupporrthe" as
"support the".)

The first answer placed the alpha at the OTA address. Later the same day the owner asked:
*"check, can't i just (as a start) host a 'ownpace-live' as production, next to the current
'ownpace-managed' on OTA-domain? What would i need to do to keep alle seperate from each other?"*
The proposal back was to make that the decision in 0132, with testers on `ownpace-live`. The
owner's answer: *"Yes! The spark has a lot free memory and disk, it will fit."* (0132 D-new.)

So the alpha runs on the reference machine, in a second compose project, `ownpace-live` (live),
at the production names of 0091: `app.ownpace.eu`, `id.ownpace.eu` and `status.ownpace.eu`. The
OTA stack, `ownpace-managed` at `app.ota.ownpace.eu` and `id.ota.ownpace.eu`, stays the nightly
gate's target and the demo, and no tester is let in there. CI never touches live. The two stacks
share one Docker daemon, so their separation is logical, not a security boundary (0132 D-new).
Only the owner administers either. The hosting placeholders (T0), the record of processing and
the assessment (T8) must describe that truthfully.

**D6 — mail.** *Which EU mail relay and sending domain, and does a person read support@?* —
*"I'll register a ownpace ampt, a todo"*. This is read as: the owner will register a
mail-sending (SMTP) account for Ownpace, as a to-do. On mail leaving the machine: *"I will
practically forward / help"*. So `«EMAIL_PROVIDER»` and `«EMAIL_REGION»` wait for 0133 T0, and
until then the owner forwards by hand (T5 covers what that means for the texts).

**D7 — unproven sources are labelled.** *For sources nobody has run against a real account:
prove them first, hide them, or label them experimental?* — *"Label"*. 0131 T2 builds the label,
and T2's conditions say what it means.

## 3. What each task does

### T0 — the owner's facts (owner)

**The placeholders.** The owner supplies a value for each of these, or says where it comes from.
Values go into the legal files, never into this plan.

| Placeholder | Where it comes from |
|---|---|
| `«REGISTERED_ADDRESS»` | The owner, in the printed form the owner chooses (the README leaves the form open). |
| `«VAT_NUMBER»` | The owner (D1). |
| `«HOSTING_PROVIDER»`, `«HOSTING_REGION»` | The owner. The README warns against naming a host the service is not on. During the alpha the service runs on the reference machine, in `ownpace-live` (D5), and the value must describe that. The lawyer checks the wording. |
| `«EMAIL_PROVIDER»`, `«EMAIL_REGION»` | The relay from 0133 T0, with its data-processing agreement. Until it exists, see T5. |
| `«LOG_RETENTION»` | 0129 D2 already gives the numbers: one month for the application's errors and warnings and for container output, two months for a pass's lines, and the audit log until the customer is erased. The owner confirms which of these the row states. T6 says where the alpha differs. |
| `«SUBPROCESSORS_URL»` | Follows from T10: the address where the sub-processor list is published. |
| `«PRIVACY_HISTORY_URL»` | The owner chooses where earlier versions are kept. One option is the file's history in this public repository. The lawyer says whether that meets privacy §13's promise. |

The data-processing agreement also carries `«REGISTERED_ADDRESS»` and `«SUBPROCESSORS_URL»`. It
is not rendered by the build, and 0086 T5 owns it.

**The facts that have no placeholder yet.**

1. **Where TLS ends for the production names** (T5): `app.ownpace.eu`, `id.ownpace.eu` and
   `status.ownpace.eu`, once 0132 T1e routes them, and `www.ownpace.eu` if fact 6 puts it behind
   the same ingress. Is it on the reference machine, or at a service the mesh provider operates?
   If the latter, which legal entity, and in which region? 0132 T3 records the path, and this
   answer decides whether the ingress is a sub-processor. **Supplied 2026-09-28:** *"app/site
   hosting is in The Netherlands, through NetBird (Germany) delivers the forward proxy"*: TLS
   ends at NetBird's hosted proxy, a sub-processor; NetBird GmbH is in Germany. Privacy 1.2
   names NetBird GmbH. **Read 2026-09-28** in NetBird's own sources: the entity (its imprint),
   TLS ending at the proxy for HTTP services, the WireGuard tunnel and the log's 7 days (its
   documentation). **Answered 2026-09-28** (the owner's NetBird answers, Status): the terms and
   the data-processing agreement were accepted on 2026-08-01 (the owner: *"01-08-2026"*, in Dutch
   date order); the agreement covers the proxy, the traffic it decrypts and its log (*"It's
   covered"*); the proxy and its log stay *Germany (EU)*, the owner's choice (*"Take Germany,
   I'll ask later on"*); NetBird's sign-in: no PIN, and SSO on for the hosts NetBird serves
   (*"No pin, but SSO on"*), then off on `app.`, `id.`, `status.` and `www.ownpace.eu` before the
   first invitation, the owner's choice (*"Off everywhere at launch"*), checked from outside the
   NetBird network. **Still open, none of it before the first invitation:** the owner's question to
   NetBird on the country and provider of the proxy cluster and its log, and whether NetBird's own
   sub-processors receive either; the owner's question to NetBird in writing on terms §3.1's
   *"commercially exploit"* (*"I need to ask commercial usage."*), whether the free Alpha counts
   included, answered before the first paid tier at the latest; and the lawyer's reading of the
   agreement for its sub-processors, how a new one is announced, the right to object and the 7 days
   (`site/legal/README.md`).
2. **The support mailbox.** Which provider hosts `support@ownpace.eu`, and does a person read it
   during the alpha (0133 open question 3)? Privacy §1 says *"A person reads that address."*
   **Answered:** the owner reads it (0133 open question 3, 2026-09-27), and Proton hosts it (0133
   Status, 2026-09-28). Privacy 1.2 names Proton AG in §7 (draft, 2026-09-28).
3. **Zammad.** Is the report form (0130) configured on live, and where does that Zammad run?
   **Supplied 2026-09-28:** *"yes, we need that. I haven't seen it funcitonal yet."* The form is
   on at `ownpace-live` for the whole Alpha. Later that day, where it sends: *"b"*, by mail, not
   to a Zammad. Each report is a mail to `support@ownpace.eu` through the Proton relay (0133), with
   the screenshot attached. No Zammad runs during the alpha; it stays the long-term plan. So no
   helpdesk route is added behind fact 1's ingress, and no sub-processor is added: Proton already
   is one (0133). The report does land in the support mailbox, which 0130 T4's paragraph must say
   (0130 T5, merged 2026-09-28 as #1318).
   Privacy 1.2 §4.5 says so (draft, 2026-09-28).
4. **Social sign-in.** Which of the four `IDP_*_CLIENT_ID` keys will live's `.env` set?
5. **Organisations in the alpha.** Is any tester a business rather than a household (open
   question 6)? **Supplied 2026-09-28:** *"tester: households only for now."*
6. **The production site.** Where `www.ownpace.eu` is served from during the alpha (T10). The
   grant page and the legal README point there, 0132 T1e does not route it, and the review found
   it does not serve this repository's site. **Supplied 2026-09-28:** *"site will first be hosted
   on this machine during alpha"*: the reference machine serves `www.ownpace.eu` for the alpha.

The dates on which each fact was supplied go in the Status block.

### T1 — the lawyer's pass before the first invitation (owner; decided, D1)

The lawyer reads the privacy policy and the terms in both languages, T2's conditions, the
sub-processor list, and T8's breach procedure, record and assessment. The two briefings at the top
of `privacy.md` and `terms.md` stay the brief. Their questions are still open. This plan adds the
following, which the owner can paste under them:

1. **The contract for a free alpha.** Are T2's conditions an addendum to terms v1.1 that says
   which sections do not apply (§6 to §8 on money, the notice periods in §11), or stand-alone
   conditions? And does *"No obligations both sides"* hold against Dutch consumer law, given terms
   §10's liability cap of what was paid in twelve months, which is nothing?
2. **Dutch first.** The alpha is Dutch (D2). The terms briefing's question 6, whether English can
   prevail over the Dutch text for a Dutch consumer, is now the live case.
3. **The retention truths** of T6, as decided by the owner.
4. **What the identity provider holds**, from 0135 T5: name, address, user name, a password hash,
   links to social sign-ins, and sessions. Plus whether removing an account also removes the
   personal data in its earlier events, which 0135 T8 did not check.
5. **Social sign-in**, if T0 says it is on: one sentence in §4.4 and §7, and whether §8's *"no
   transfer … by us"* still reads correctly. With it, 0140's sentence on who holds a Microsoft
   credential: the client secret is the deployment's, and the refresh token sits in the
   service's encrypted store, as it does for Google.
6. **Support.** 0130 T4's paragraph on problem reports, and privacy §4.5 (operators see service
   metadata, 0110) now reaching a tester for the first time.
7. **Who in an organisation sees what**, and §4.2's display names and stored error text (0137,
   partly confirmed).
8. **The lists the owner keeps for the alpha**: the testers' names and addresses off the machine
   (0134 T4), and each tester's Google address entered as a test user at Google (0140).
9. **Internal disagreements to settle in the same pass.** Annex A's preflight retention against
   privacy §4.3 and the code. The privacy briefing's *"counts kept 30 days"*. The terms briefing's
   item 10, which describes a revision that privacy v1.1 has already made. Privacy §11's
   vulnerability channel against `SECURITY.md` (T9).
10. **The household model**, terms §3 and the privacy briefing's questions 1, 2 and 6, which
    decide T11.
11. **What the security sections promise.** Isolation *"in the database itself"* (privacy §11,
    Annex B) holds for the application's requests and not yet for the background tasks (§1,
    0138). Either 0138 T1 to T3 land before the texts are published, or the texts say where row
    security applies and where it does not yet. And *"a separately held key"*: held apart from
    the database, but on the same machine (0134).

The owner records the date of the pass and the version numbers it approved in the Status block.
The first invitation waits for it (0131 T5).

### T2 — the alpha conditions, in Dutch and English (decided, D1 and D2)

**Where.** `site/legal/alpha.nl.md` and `site/legal/alpha.md`, rendered by the site build beside
the privacy policy and the terms, with a *Version* line like theirs. Dutch first, because testers
read Dutch (D2). Which language governs is T1's question 2.

**What they must say.** The owner writes the text. *(2026-09-28: the owner let an agent draft
it, as version 0.1; see the Status block.)* Each point has its source:

- **What the alpha is.** A trial of the managed service by a small group the owner invited, for a
  few weeks (D2, D4). The end date or the notice of the end is open question 7 *(answered
  2026-09-28: 7 days' notice)*.
- **Free.** Nothing is charged, and the sections of the terms about money do not apply (T1 point
  1). 0131 T3 says the same on the Billing page.
- **No obligations either side.** No service level. The tester may leave at any time, and T7 says
  how. The owner may stop the alpha.
- **No availability promise.** The alpha may be paused (the operator hold, managed migration
  0023), reset or ended. Terms §9 already says there is no uptime guarantee.
- **No backups.** 0134 T2's paragraph, which the lawyer's pass decides.
- **Experimental sources.** What the label from 0131 T2 means, and that the tester should keep
  the old account until they have checked what arrived. Terms §10 already says that.
- **The end.** What the end does to organisations, credentials, sign-in accounts and access
  requests, as 0131 T4 decides. What was copied to the target stays.
- **The account is the tester's own.** It is not to be shared (0136). Inviting others follows
  0137 T0's sentence.
- **Google asks again.** While the Google client live uses is in Testing, a tester must reconnect
  after about seven days (0140).
- **How to reach a person.** The report form (0130) or the support address (0133 open question 3).

0131 T1's short note and the grant mail's sentence must match these conditions, and they link to
them once they exist.

**Guard.** `scripts/legal-docs.unit.test.ts` gains a case that fails today: both files exist,
each carries a *Version* line, and the site build renders them in both locales. `alpha.md` joins
that file's `DOCS` list, so its placeholders must be in the README's table. The case in
`site.unit.test.ts` that *"ships a Dutch translation of each legal document"* names `privacy`
and `terms` only; `alpha` joins its list. *(2026-09-28: both done, and a case checks a version
line in every document, the same number in both languages. The half that the build renders them
waits for T10.)*

### T3 — acceptance recorded, with version and time, at first sign-in (decided 2026-09-28; built, not merged)

*(Built 2026-09-28 as this section says; the Status block's entry of that day says how, and what
is not built.)*

**What the tester sees.** After the first sign-in, and before any other page, there is one screen:
the alpha conditions, the privacy policy and the terms, each linked in the reader's language, and
one button to accept. It appears again when any of the three changes version. An invited member
(0099) sees it too, at their own first sign-in.

**What is recorded.** A new table in the managed migration chain (`packages/managed/migrations`,
never the shared chain), with the working name `legal_acceptance`: organisation, subject,
document (`alpha`, `privacy` or `terms`), version, language and time. `app_user` may insert and
read its own organisation's rows under row security. It may not update or delete them, so an
acceptance cannot be rewritten. A new version is a new row.

**Where it is checked.** `GET /api/me` reports whether acceptance is due, beside the membership
it already binds at first sign-in (`claimRequestedMembership`). `POST /api/me/acceptance` takes the
version and the language, and refuses any version but the current one, so a stale tab cannot
accept an old text. On the server, creating a connection or a migration answers
`409 conditions_not_accepted` until the current versions are accepted. The screen is the notice.
The refusal makes sure no credential is stored before it.

**The version.** The current versions are constants in `packages/managed`, because the app may not
import `site/legal/` (the README forbids it). A guard compares them with the texts.

**When it is on.** Off unless the deployment sets it, like 0131 T1's alpha setting, which can be
the same switch. Live sets it. The appliance never has it: the table, the constants and
the check live in `packages/managed` and the managed API, and the web app shows the screen only
when `GET /api/me` says acceptance is due. `no-managed-leakage.unit.test.ts` already refuses
`@openmig/managed` anywhere in the appliance's import graph, so a module there is kept out
without a change to the guard. Whether the paid service later turns it on for everyone is 0086's
question.

**Erasure.** The new table must be named in `PURGED_TABLES` or `RETAINED_TABLES`. It is purged
with the organisation: the proposal, and the owner's answer to open question 4 on 2026-09-29
(*"Ok"*). A member who leaves keeps their rows until then, as the organisation's record (review
of 2026-09-29).

**Drafts.** Nobody is asked while any of the three texts is a draft (review of 2026-09-29): a
draft's number is the one its final text carries, so an acceptance of the draft would be
recorded as one of the final text. `LEGAL_DRAFTS` says which, held to the *Version* lines, and a
final text's words are pinned to its number.

**Guards.** Each fails today:

- `apps/api/src/routes/an-acceptance-with-its-version.integration.test.ts`. With the setting on,
  `GET /api/me` reports acceptance due, and creating a connection or a migration answers 409.
  Accepting the current version writes one row per document with version, language and time, and
  the same calls then succeed. An old version answers 409. With the setting off, nothing changes.
- `apps/web/src/pages/an-acceptance-before-the-first-connection.unit.test.tsx`. The screen shows
  the three links in both languages when acceptance is due, and does not appear once it is given.
- `scripts/a-version-the-tester-accepted.unit.test.ts`. The constants equal the *Version* lines of
  `alpha.md`, `privacy.md` and `terms.md` and their Dutch files.
- The erasure guard in `offboarding.unit.test.ts` (*"every tenant-scoped table has a DECIDED
  fate — purged, or retained with a reason"*) fails until the table is named.
  `force-rls-managed.unit.test.ts` then finds its row security forced, and a
  `legal-acceptance-under-rls` test beside the other `*-under-rls` tests shows that an
  organisation reads only its own rows and that nobody can update or delete one.

### T4 — a notice wherever a tester's data is collected (proposed)

| Where | What changes |
|---|---|
| The request form (`RequestAccess.tsx`) | The privacy policy and the alpha conditions linked under the form, in the reader's language. `access.privacy` states the period T6 decides, instead of saying nothing about how long. |
| The identity provider's registration and sign-in pages | 0135 T5: the instance privacy policy's links, set from `.env` and read back. They point at T10's addresses. |
| The Connect buttons (`ProviderConsentPanel`) | The privacy policy and the terms beside the button, as `docs/google-oauth-verification.md` §5 requires. |
| The report form (`ReportProblem.tsx`) | The privacy policy linked beside what the form says it will send. 0130 T4's paragraph is the policy's half. |
| The grant page (`Grant.tsx`) | Already links both texts, at the files the build writes on the production site, per language: fixed in #1137, merged 2026-09-24. T10 moves them into one module. |
| The access-granted mail | The link to the alpha conditions, with 0131 T1's sentence. |

**Guard.** `apps/web/src/components/a-notice-where-data-is-collected.unit.test.tsx` fails today.
It renders the request form, the Connect panel and the report form in both languages, and finds
the privacy link in the reader's language, taken from T10's module.

### T5 — the sub-processors named (owner for the names; proposed for the text)

The owner supplies each name (T0), and the lawyer checks the rows (T1). Privacy §7, its Dutch
mirror and `subprocessors.md` carry the same rows.

- **The ingress in front of the production names**: the application (`app.ownpace.eu`), the
  identity provider (`id.ownpace.eu`) and the status page (`status.ownpace.eu`), which 0132 T1e
  routes to live, and the production site (`www.ownpace.eu`) if T0's fact 6 puts it behind the
  same ingress. The owner confirms it this way (T0 fact 1). If TLS ends at a service the mesh
  provider operates, that service sees every request in plain text: sign-ins, OAuth codes, app
  passwords typed into the wizard, and every page of metadata. It is then a sub-processor, named
  with its region under a data-processing agreement. If TLS ends on the reference machine and
  the provider carries only encrypted traffic, the texts need no row for it. The alternative to
  a new row is to move TLS termination onto the machine. No plan carries that yet; 0132 T3's
  record of the path is where it would start. The OTA names are not where testers are let in
  (D5), so the texts for the production site need no row for them. Whether they still answer
  from the internet is 0132's open question 7.
- **The mail relay**: 0133 T5 fills `«EMAIL_PROVIDER»` and `«EMAIL_REGION»`. Until the relay
  exists, the owner forwards mail by hand (D6). That mail then leaves through the account the owner
  forwards from, and its provider is the one the texts name for that period.
- **The support channel.** Whoever hosts `support@ownpace.eu` handles every rights request and
  support mail. The same goes for the Zammad that holds problem reports (0130), unless it runs on
  the machine the hosting row already covers. During the alpha there is no Zammad: reports go by
  mail through the Proton relay and sit in the support mailbox (T0 fact 3, 0130 T5), so this row
  and the relay's cover them.

No code changes, so there is no guard. T10 renders `subprocessors.md`, which gives
`«SUBPROCESSORS_URL»` an address.

### T6 — what is kept, and for how long, made true (proposed)

For each promise in §1, either the code changes or the text does. The owner decides which (open
questions 2 and 3), and the lawyer checks the words.

- **Access requests.** Proposed: a declined request is deleted 30 days after the decision. A
  granted one goes with its organisation, as today. An open one stays while it is open, because
  the owner answers every request (D4). The delete runs in the managed retention job
  (`apps/worker/src/jobs/managed-retention.ts`) over the owner's connection, so `app_user` and the
  operator still cannot delete a decision. 0093's rule becomes: a decision is not erased by a
  person, and it ages out on a stated date. Privacy §4 and §9 gain a row for access requests. The
  alternative is in open question 2.
  **Guard:** `packages/managed/src/a-request-nobody-keeps-forever.integration.test.ts` fails
  today. It checks that a declined request older than 30 days is gone, and that a younger one, an
  open one and a granted one stay.
- **Credentials on delete.** Deleting a migration revokes the credential its own row holds, after
  the delete, with `revokeCredentialRow`, as deleting a connection does. This matches the text
  whichever way open question 3 goes.
  **Guard:** `apps/api/src/routes/migrations/a-deleted-migration-revokes-its-grant.unit.test.ts`
  fails today. With a stub revoker, deleting a migration whose row holds `source_secret_ref`
  revokes once, after the row is gone. A 404 revokes nothing.
- **Credentials on finish.** Finishing keeps access on purpose: the finish answer says to set
  the status back to `active` to resume, and today the continuous lane is a second step after
  finishing (0128 §3, T3). Both need the credential. So the proposal changes the text, not the
  code: credentials are kept until the connection or migration is deleted, or the account is
  closed (open question 3).
- **Preflight counts.** Annex A follows privacy §4.3 and the code (T1 point 9).
- **Account and sign-in data.** §9 names the close window the tester chooses (0, 7, 30 or 90
  days), that there are no backups during the alpha (0134 T1), and the identity provider's step
  (T7, 0135 T8). It also names how long an account at the identity provider that nobody let in
  is kept: 0135 T8 proposes 30 days, and 0135 open question 6 asks the owner.
- **A removed member's sign-in account** (0135 open question 13, 2026-09-29): kept until the
  organisation is erased, or removed after N days. The owner decides, and privacy §9 then names
  it. Until then 0135 T8's daily run keeps it, because the removal is recorded in `audit_log`.
- **The task runner's stores.** 0134 T1 reads what each task returns and what a failed run's
  error can carry. The task events (ClickHouse) and large payloads (MinIO) that `managed.yml`
  describes are not backups, but they can outlive an erasure, and 0134 hands that finding to this
  task. If they can hold a tester's personal data, the text says how long they are kept, or they
  are pruned to match. Neither 0134 nor this plan has checked their retention.
- **Logs** (`«LOG_RETENTION»`, T0). One month for the application's errors and warnings is built
  (0129 T3). Whether container output on the reference machine keeps one month depends on the host
  setting 0129 T3's guide describes. That is not visible from the repository, and the owner checks
  it.
- **Run history.** The texts do not name it. 0129 D2 keeps a pass's lines and runs for two
  months. But managed retention prunes a tenant's runs only as far back as its newest invoice,
  and a free tenant has none (0131 §1). So in the alpha, run rows stay until the alpha ends or the
  organisation is erased. The text says so, or 0143 (W13 in 0131 §5) changes the rule.

### T7 — a tester can end their account (proposed)

The self-serve close screen belongs to 0144 (W14 in 0131 §5). The smaller build that makes
terms §11 true in the alpha is an operator command.

- **`operator.sh close <tenant-id> <window>`**, through a new `close` sub-command of
  `apps/api/src/scripts/operator.ts`. The route does four things: it reads the grants only the
  customer can withdraw, calls `closeTenant` from `@openmig/managed`, asks the orchestrator to
  stop passes in flight (`stopPassesInFlight`), and answers the dates and the sentence in both
  languages. Those four move into one function that the route and the command both call, so the
  two cannot drift. The command passes the operator's subject as `closedBy`, takes a reference to
  the tester's request, and records both in the audit log. The window must be one of
  `CLOSE_WINDOWS_DAYS`.
- **The identity provider's account.** The runbook's *Tenant offboarding* gains 0135 T8's step
  after the purge. Until 0135 T8's script exists, the owner removes the account in the console.
- **The path a tester takes.** T2 says it: ask the owner through the report form or the support
  address, and choose a window. The owner closes within a stated number of days.
- **The end of the alpha** (0131 T4, option a) uses the same command for every organisation.

**Guard.** `apps/api/src/scripts/an-account-a-tester-can-end.integration.test.ts` fails today,
because the sub-command does not exist. For the same tenant and window, the command's result
equals the route's: the dates, the sentence and the standing grants. The command refuses a window
outside the list, and the audit row names the operator and the reference.

### T8 — a breach procedure, a record of processing, a light impact assessment (proposed)

**The breach procedure: one page in `docs/`**, working name `docs/breach-procedure.md`. A
procedure holds no secrets, so it belongs in the public repository. It covers:

1. **Contain.** The operator hold (managed migration 0023) stops the sync tick from starting new
   passes (`readOpenPause` in `managed-sync-tick.ts`). Since 0132 T6 (b) (2026-09-27) a pass a
   tester starts by hand is refused while it is open too (0131 §1). A pass already running
   finishes, so the page also says how to stop those. The nightly gate
   rebuilds only the OTA stack and never touches live (0132 D-new, T1g), so it destroys no
   evidence on live. If a breach reaches the OTA stack too, pause the gate first, because a
   rebuild there destroys evidence.
2. **Keep the evidence.** Copy the application's events (`app_event`, pruned at 30 days) and the
   container output (kept a month where 0129 T3's guide is followed) off the machine before they
   age out, with the audit log beside them. 0129 T4's export covers the audit log once it is
   built. Until then, and for the rest, it is a query and a copy of the journal.
3. **Assess.** What data, which testers, and how likely a risk to them is. The two stacks share
   one Docker daemon, and their separation is not a security boundary (0132 D-new), so the
   assessment starts from both.
4. **Notify the Autoriteit Persoonsgegevens** without undue delay, and where feasible within 72
   hours of becoming aware (Art. 33), unless the breach is unlikely to result in a risk.
5. **Tell the testers**, in Dutch, when the risk to them is high (Art. 34). For a business tester
   under the data-processing agreement, tell the controller (its §7).
6. **Register every breach**, notified or not (Art. 33(5)).

It includes the tester message as a template in Dutch and English, and one line on key rotation.
`SECURITY.md` says stored credentials have *"no rotation"*, so a leaked `SECRET_ENCRYPTION_KEY`
means every tester reconnects.

**The record of processing (Art. 30) and the light impact assessment.** Both are kept by the
owner and not in this repository. They record facts the repository deliberately does not hold,
such as the hosting details of T0 and the list of testers of 0134 T4. The record lists each
activity with its purpose, data, people, recipients, retention and measures: access requests,
sign-in accounts, stored credentials, the ledger's metadata, preflight counts, run history, logs,
the audit and support-read logs, problem reports, mail, the owner's list of testers, and the Google
test-user list. The review's reading is that the Art. 30(5) exemption does not apply, because the
processing is not occasional. The lawyer confirms it.

The assessment covers the household role (privacy §3), the correspondents in a mailbox who never
contracted with anyone, children's mail (privacy §12), where the service runs and who can reach it
(D5, 0132), the two stacks on one Docker daemon (0132 D-new), and the ingress (T5). Whether a
full assessment is required is T1's question. The light one is done either way.

No code, so there is no guard. The Status block records the dates.

### T9 — SECURITY.md covers the hosted service, with one channel (proposed; owner's channel)

- **Scope.** The code in this repository, both editions, and the hosted service: live at the
  production names during the alpha, and the OTA stack at the OTA names. Also a sentence that
  testing against the hosted service needs the owner's permission first, because it holds
  testers' credentials. Anyone can bring up their own stack instead
  (`docs/selfhost-quickstart.md`, `docs/managed-bring-up.md`), and D5 says the same for
  developers.
- **Supported versions.** Stated by the owner. Before there is a release line, that is `main`.
  *Stated 2026-09-27: `main`, and the release live runs.*
- **A response target.** A number of working days to acknowledge a report, named by the owner.
  *Named 2026-09-27: five working days to acknowledge, with no promise of when a fix lands.*
- **One channel, stated the same way everywhere.** *Decided 2026-09-27, as recommended:* the
  GitHub advisory form, which `SECURITY.md` already names, with `support@ownpace.eu` as the
  fallback for someone without a GitHub account. Privacy §11 then says the same in the
  lawyer's pass.
- **`security.txt`** at `/.well-known/security.txt` on the site, written by the site build, with
  `Contact`, `Expires`, `Preferred-Languages` and `Canonical`.

**Guard.** `scripts/one-way-to-report-a-vulnerability.unit.test.ts` fails today. It checks that
`SECURITY.md` has a scope section naming the hosted service, and that privacy §11 in both
languages and the built `security.txt` name the channel `SECURITY.md` names, in the same order.
It also checks that `security.txt`'s `Expires` is in the future and less than a year away.

### T10 — the texts published where a tester can read them, with no placeholder left (proposed)

- **The production site, built with `--public`.** Testers use the production names (D5), so the
  texts they read are the production site's, at `www.ownpace.eu`, where the grant page and the
  legal README already point (#1137). The `--public` build already does what the alpha needs: it
  throws while any placeholder is rendered, and it requires
  `OWNPACE_APP_URL=https://app.ownpace.eu`, which is now the alpha's address. So publishing needs
  no new switch (open question 1 (a)). The site it writes is indexable. *(2026-09-28: it also
  refuses, as `--public --check` does, while a legal page it renders says on its version line
  that it is a draft (T2). So T10 publishes once T1's lawyer pass has given every rendered legal
  page a final version line, as well as once T0's facts are in.)*
- **If the owner wants it unindexed during the alpha** (open question 1 (b)): a new switch, working
  name `--no-drafts`, that throws on a placeholder as `--public` does, stays noindex, and accepts
  the production app address. Today a build without `--public` refuses that address on purpose,
  because a noindex test site once sent its visitors to the real app (the comment above that check
  in `site/build.mjs`). The switch would be the one exception, named on the command line.
- **Where it is served** is T0's fact 6. 0132 T1e routes `app.`, `id.` and `status.ownpace.eu`, and,
  for the site step, `www.ownpace.eu` to live's `WWW_PORT`. If it is served from the reference
  machine beside the OTA test site, `www.yml` has the shape `managed.yml` has before 0132 T1: a
  fixed project name and a fixed `container_name`, both `ownpace-www`. Each checkout has its own
  `site/dist`, and `WWW_PORT` is a variable, so the fixed names are what stop a second copy from
  live's checkout starting. The fix is 0132 T1's pattern: `ownpace-www` stays the default, and a
  second project sets its own name. The route from `www.ownpace.eu` to that copy's port is then the
  owner's, as in 0132 T1e.
- **What it renders.** The privacy policy and the terms, as today, plus T2's conditions and
  `subprocessors.md`, so `«SUBPROCESSORS_URL»` has an address. The data-processing agreement stays
  0086 T5's.
- **One setting for every link the app makes.** Where the legal pages live is a build argument for
  the web app, which `managed.yml` passes as it passes `VITE_OIDC_ISSUER`. Live's value is the
  production site, and the OTA stack's is its test site. One module in the web app turns it into
  an address per page and per language. The grant page, the request form, the Connect panel, the
  report form and T3's screen all read that module. 0135 T5's `IDP_PRIVACY_URL` and `IDP_TOS_URL`
  are set to the same addresses.

**Guards.** Each fails today, where it applies:

- If open question 1 chooses (b), in `site/site.unit.test.ts`: a `--no-drafts` build with a
  placeholder left throws, and without one it writes noindex pages. Under (a) nothing is added
  here: the `--public` refusal already exists.
- If the site is served from the reference machine, `scripts/two-stacks-on-one-box.unit.test.ts`
  (0132 T1) also reads `www.yml`, and fails today on its fixed `container_name`.
- `scripts/a-policy-link-that-answers.unit.test.ts`: every address the module produces is a file
  the site build writes for that language, including the conditions and the sub-processor list.
  `managed.yml` passes the setting to the web build. This is the check that would have caught the
  grant page's old addresses. `Grant.unit.test.tsx` has pinned the corrected ones since #1137, as
  literals; it does not read what the site build writes.

Beside them, `scripts/legal-docs.unit.test.ts`'s `DOCS` list gains every file the build renders,
including `subprocessors.md`. That passes today, and keeps a new placeholder in any of them from
going unlisted.

### T11 — a family member's permission, recorded (proposed; waits on T1)

Only if the lawyer confirms the household model of terms §3. When a password-type connection (an
app password, IMAP, an Apple app-specific password) is created for an address that is not the
signed-in person's verified address, the form asks for one acknowledgement: this is my account,
or I have this person's permission, or I am their parent or guardian. The acknowledgement is
written to the audit log. The grant-link path needs nothing, because it already checks whose
account signed in.

**Guard.** `apps/api/src/routes/a-permission-that-was-given.integration.test.ts` fails today. It
checks that such a connection without the acknowledgement answers 400 naming the field, that one
with it writes the audit row, and that a connection for the person's own address asks nothing.

## 4. Order

**Before the first invitation.** 0131 T5's row for this plan names a minimum: the lawyer's pass
and the owner's facts, the conditions published in Dutch and English, the privacy policy and the
conditions linked from the request page and the grant page, and each acceptance recorded. That
is T0 to T3, T10, and T4's request and grant rows. This plan recommends the rest of T4, and T5 to
T9, before the first invitation as well, for the reasons given with each (open question 8):

1. T0, then T1. The owner's facts go to the lawyer with the drafts. Fact 6, where
   `www.ownpace.eu` is served, is needed before T10 can publish.
2. T2 and T5, written by the owner, in the same pass.
3. T10's link module (and its switch, if open question 1 chooses (b)), T4 and T3. These are
   code, and can be built while the lawyer reads. T3 goes on with the versions the lawyer
   approves. The production site is published with the approved texts once `www.ownpace.eu` is
   served (T10).
4. T6: the migration-delete revocation (code), and the wording or the purge for everything else.
5. T7's operator command. Terms §11 promises a close *"at any time"*, and today nobody can carry
   one out.
6. T8's breach page and the owner's two documents. The duty to notify starts with the first
   tester's data.
7. T9, which is small, in the same docs PR as T8.

**After the lawyer's answer:** T11.

Each code task is its own PR with its guard. The legal files change only in the owner's PR after
the lawyer's pass.

## Cross-references

- **0086 T5**: the legal surface for taking money, the data-processing agreement and the paid
  journey. This plan extends it and does not replace it.
- **0131**: T1's note and T3's Billing sentence must match T2, T4 decides the end that T2
  describes, and T5 holds this plan's go/no-go row.
- **0132**: D-new puts testers on live at the production names (D5), which T1e routes; T3 records
  the path a tester's request takes, which decides T5's ingress row. T1g keeps CI off live, so
  T8's procedure no longer starts by pausing the gate. T1's pattern is what a second copy of
  `www.yml` would need (T10).
- **0133**: T0's relay and T5's rows. Open question 3 (support@) feeds T0.
- **0134**: T1's erasure sentence and T2's paragraph feed T2 and T6, and T1's finding on the task
  runner's stores feeds T6. T4's list of testers is in T8's record. The wording on the key held
  apart from the database is T1's point 11.
- **0135**: T5's links at the identity provider (T4, T10), and T8's step for the identity
  provider's account (T6, T7). Open question 6 there sets the period for accounts nobody let in
  (T6).
- **0136** and **0137**: the sentences on sharing an account and inviting others (T2), and who in
  an organisation sees what (T1).
- **0138**: the sentence on isolation in the database (T1's point 11).
- **0128**: today the continuous lane is a step after finishing, which T3 turns into a choice at
  the end. It is one reason finishing keeps credentials (T6).
- **0129**: D2's log periods (T0's `«LOG_RETENTION»`, T6), and T4's audit export for T8's
  evidence.
- **0130**: T4's paragraph on support requests (T1), and the report form as a way to reach a person.
- **0140**: the Google test-user list (T8), the reconnect every seven days or so (T2), the sentence
  on who holds a Microsoft credential (T1), and the entity facts publisher verification needs
  (T0).
- **0144** (W14 in 0131 §5): the close-account screen that T7's command stands in for.

## Open questions

1. **Where the texts are published during the alpha (T10).** On the production site,
   `www.ownpace.eu`, since testers use the production names (D5). The OTA test site is no longer
   an option: its buttons lead to the OTA stack, where no tester is let in. The question left is
   whether the production site is indexable during the alpha.
   - **(a)** Built with `--public`, so indexable. *Recommended.* It needs no new code: the build
     already refuses a placeholder and requires `app.ownpace.eu`, which is now the alpha's
     address. The grant page's links and the legal README already name it (#1137).
   - **(b)** Kept noindex for the alpha, with a new `--no-drafts` switch. It costs a switch and an
     exception to the refusal that stops a noindex build pointing at production (T10).

   **Answered 2026-09-28: (a)**, *"public site: yes, search engine index."* So T10 publishes with
   `--public`, and its (c), the `--no-drafts` switch, is not needed.
2. **Access requests (T6).**
   - **(a)** A declined request is deleted 30 days after the decision. *Recommended.*
   - **(b)** The texts say requests are kept until the alpha ends, and the owner deletes them by
     hand as the database owner at the end, with a runbook step.

   **Answered 2026-09-27: (a)**, *"2a"*.
3. **Credentials when a migration is finished (T6).**
   - **(a)** Keep them, and the texts say so: until you delete the connection or migration, or
     close your account. *Recommended*, because resuming a finished migration, and today's step
     into the continuous lane after finishing (0128 T3), need them.
   - **(b)** Destroy them at finish, and the tester reconnects to resume.

   **Answered 2026-09-28: (a)**, *"stored access after finished migration: keep until deleted or
   closes."* The alpha conditions' §10 say so; privacy §9's row follows in the lawyer's pass (T1).
4. **The acceptance record after erasure (T3).** Purged with the organisation, which is
   recommended, or retained with a stated reason?
   *(2026-09-28: T3 is built with the recommendation, `legal_acceptance` in `PURGED_TABLES`,
   which is also what privacy §4.4 and §9 say today. Still the owner's to answer; keeping it
   would move it to `RETAINED_TABLES` with the reason, and change §9.)*
   *(2026-09-29, the review: and a member who leaves the organisation? Built as the proposal:
   their rows stay with the organisation until its data is erased, like the audit log, and a
   member invited back is not asked again for a version they accepted there. Privacy §9's new
   row says so in both languages, for the owner's review. The other way, deleting them through
   the owner's connection when the member is removed, is one statement in the removal and a
   change to that row.)*

   **Answered 2026-09-29: purged with the organisation**, as built. Asked *"The acceptance record
   after an erasure: it is currently erased with the organisation (open question 4)"*, the owner:
   *"Ok"*. So `legal_acceptance` stays in `PURGED_TABLES`, and privacy §4.4 and §9 stand as they
   are. A member who leaves keeps their rows with the organisation until then, as built; that was
   not put to the owner on its own, and privacy §9's row for it stays for the owner's review with
   the rest of the draft. The removed member's sign-in account at the identity provider is a
   different record, 0135 open question 13.
5. **The vulnerability channel (T9).** The advisory form with support@ as fallback, as
   recommended, the advisory form alone, or an address alone? And the response target?
   **Answered 2026-09-27**, *"yes all three"*: the advisory form with `support@ownpace.eu` as
   fallback, five working days to acknowledge, and `main` with live's release supported.
6. **Businesses in the alpha.** Households only, or may a tester be an organisation? If one is,
   privacy §3 makes the data-processing agreement part of its contract, and its draft is 0086
   T5's.
   **Answered 2026-09-28: households only**, *"tester: households only for now."* No
   organisation or business is admitted during the alpha, so the data-processing agreement is not
   part of the alpha. The alpha conditions' §1 say so.
7. **The end of the alpha.** How much notice do testers get before it ends or is reset? Terms §11
   says 30 days' notice before the terms end, and 90 days' notice and an export if the service is
   discontinued. The conditions state the alpha's own notice period.
   **Answered 2026-09-28: 7 days**, by the owner's own edit of the alpha conditions (PR #1293).
   Testers are told by email at least 7 days before a reset or the end, and before the new
   conditions after it (the alpha conditions' §5 and §11).
8. **What waits for the first invitation (§4).** 0131 T5's row asks for T0 to T3, T10, and T4's
   request and grant rows. This plan recommends the rest of T4, and T5 to T9, as well: notices on
   the Connect buttons and the report form, the sub-processors named, retention made true, a way
   to close an account, a breach procedure, and one vulnerability channel. Which of these must be
   in place first? 0131 T5's row is then updated to match.
