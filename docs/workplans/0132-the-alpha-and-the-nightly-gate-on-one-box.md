# Workplan 0132 — ownpace-live beside the nightly gate, on one box

## Status — 2026-09-24 (update this block at the end of every session)

**2026-09-24: opened from the owner's answers.** The readiness review of 2026-09-23 found three
things about the stack testers would use. The nightly managed gate rebuilds it from `main` and
seeds demo tenants into it. Its database is published with a password this repository contains.
And 0026 row 24, the rotation of the demo-era secrets, is parked until the moment 0020 names,
*"when that stack stops being a demo"*, which is what the alpha does. The owner keeps the alpha
on the reference machine, at the OTA address, with CI on the same machine (§2). This plan works
inside that decision: what has to change so that one machine can carry both, and the steps on the
machine. It also answers the owner's question *"Who would need/het credentials?"* (§4).

Nothing is built. The live `.env`, the database roles and what the machine's ports answer are not
visible from the repository, so §1 says what the code does, and T0 is where the reference
machine's own answers are written down: dates and outcomes, never values.

**2026-09-24, later: the owner chose ownpace-live beside ownpace-managed (0132 D-new), and #1137 merged.**
Testers now use a second compose project, `ownpace-live`, on the production names, while the OTA
stack (`ownpace-managed`) stays the nightly gate's target and the demo (D7, which most sibling
plans cite as 0132 D-new); T1's options A to C and T8 are superseded and kept in §3, and the table
is rebuilt around D7, with T1 (container names and scripts follow the project name) first and T2
and T5 now mostly about the OTA stack. The five fixes this plan was waiting on are fixed in #1137, merged
2026-09-24, as checked in the code on `main`, and nothing of this plan is built yet; 0131 T5's
minimum for this plan is T1, T1b to T1e, and T3.

Names used from here on: **live** is the `ownpace-live` stack; **the OTA stack** is
`ownpace-managed`. "The live `.env`" in the first entry above was written before D7 and means the
reference machine's one `.env`.

| Task | Status | Notes |
|---|---|---|
| T0 The steps on the reference machine, before the first invitation | ⏳ **Owner** | §3. In order: T1 in place, the OTA stack's passwords changed, live stood up without the demo, the production names routed, the checks run from off the mesh. The outcome is written in this block. |
| T1 Container names and scripts take the stack from the project name | 📋 **Decided 2026-09-24** (D7); the code 📋 **Proposed** | §3. **The first task; nothing below can start before it.** 17 fixed `container_name` values, one network literal in `managed.yml`, `ownpace-db` in 7 scripts, `trigger-api` in 8 and the project name in 9. A guard fails on a fixed stack name. The old options A, B and C are ⛔ superseded and kept in §3. |
| T1b `ownpace-live`: its own checkout, `.env` and ports, and no demo | 📋 **Decided 2026-09-24** (D7) | §3. `~/.persistent/ownpace-live/.env`, fresh secrets from its first bring-up, its own `*_PORT` values, never `--with-demo`. The database passwords are set before the first bring-up. |
| T1c Its own Trigger.dev plane | 📋 **Decided 2026-09-24** (D7) | §3. Its own account, organisation and project, CLI profile, access token and `REGISTRY_PORT`. Never the OTA plane, which the nightly gate restarts. |
| T1d Its own identity provider at `id.ownpace.eu` | 📋 **Decided 2026-09-24** (D7) | §3. Its own masterkey and mail relay (0133). The web image is built with live's issuer, which is a build-time value. |
| T1e The production names routed to live | ⏳ **Owner** (D7) | §3. NetBird routes from `app.ownpace.eu`, `id.ownpace.eu` and `status.ownpace.eu` to live's ports. This answers 0091 T4. |
| T1f Every port that need not be reachable bound to 127.0.0.1, in both stacks | 📋 **Decided 2026-09-24** (D7), carried by T3 | §3, T3. Containers reach ports the host publishes through the Docker gateway, so each stack can reach the other's. |
| T1g Live is deployed by hand from a tag; CI never touches it | 📋 **Decided 2026-09-24** (D7); the code 📋 **Proposed** | §3. The OTA stack keeps following `main` nightly. The procedure is T6; tags are 0146's. |
| T2 Database passwords the repository does not contain | 📋 **Decided 2026-09-24** (D2, D3) on the machine; the code 📋 **Proposed** | §3. Now chiefly the OTA stack, whose roles hold the shipped values: `ALTER ROLE`, because `.env` does not reach a role that already exists. Live generates its values before its first bring-up (T1b). The bring-up sets the roles from `.env`, and refuses shipped values on a real address. |
| T3 "Not reachable from the internet", checked | 📋 **Proposed** (D2, D4, D7) | §3. A loopback default for the eight ports published on all interfaces (seven in `managed.yml`, the site's one), in both stacks (T1f). A check on the machine after every deploy, a probe from outside that includes the production names, and the path a tester's request takes, written down. |
| T4 A stack that does not say it is production does not start | 📋 **Proposed** | §3. `managed.yml`'s `development` default becomes a required value. Live sets `production` at T1b. |
| T5 No demo in the alpha, and the values that left the machine replaced | ✅ **Closed for live 2026-09-24** (D7); 🅿️ **Parked for the OTA stack (trigger: 0026 row 24's own, the OTA stack stops being a demo)** | §3 and §4. Live never had the demo or its values, so there is nothing to replace. The refusal of `--with-demo` on live stays 📋 **Proposed**. Routes (a) and (b) are kept for the OTA stack. |
| T6 One way to deploy live, from a tag | 📋 **Proposed** (D1, D5, D7) | §3. Hold, drain, a tag, bring-up without the demo, checks, lift. Replaces three procedures that disagree. With 0146. |
| T7 What the gate does for the OTA stack, done for live | 📋 **Proposed**, with T1b | §3. The identity provider's provisioning token, the Trigger.dev database drill, T3's check and 0135's organisation count, on a timer on the machine, for live. |
| T8 The gate gets a stack of its own on the same machine | ⛔ **Superseded 2026-09-24** by D7 | §3. The second stack is live, not the gate's. Its parts moved to T1, T1b and 0143. |

## 1. What there is today

**One stack, two writers.** `deploy/compose/managed.yml` pins the project name
(`name: ownpace-managed`) and gives 17 services a fixed `container_name`. So the operator's
checkout (`~/ownpace-managed`, AGENTS.md) and the gate's checkout on the self-hosted runner drive
the same containers and volumes. The documented arrangement also gives them one `.env`: the gate
restores `~/.persistent/ownpace-managed/.env` into its checkout on every run and copies it back
once it has filled it in, before the bring-up, and the operator's checkout is a symlink to that
file (`docs/managed-bring-up.md`, *One box, one stack, one `.env`*). E2E (managed) #195 most
likely shows the two writers meeting. On 2026-09-23, at 08:56 UTC, something outside the run
recreated the API container mid-run, *"most likely a deploy on the same box"* (commit 7eeaeee).
The gate is scheduled for 03:30 UTC, and GitHub has started it hours late. D7 leaves this as it is
for the OTA stack, and keeps testers off that stack.

**What the nightly gate does to that stack.** `.github/workflows/e2e-managed.yml` runs on
`cron: '30 3 * * *'` and `runs-on: [self-hosted, linux, arm64]`. In order:

1. It restores the shared `.env` and runs `ensure-env-secrets.sh`. It then fills any key
   `managed.yml` marks required that the file still lacks, from `managed.env.example`. It adds a
   placeholder client pair for Google, Dropbox, Microsoft and the Google sign-in provider wherever
   the file has none (`env-upsert.sh --if-absent` fills a key that is missing *or empty*). Then it
   copies the file back. The product reads a pair with both halves set as a configured deployment client
   (`microsoftDeploymentClient` returns a client whenever both are non-empty), and
   `setup-zitadel.sh` adds a Google sign-in provider when `IDP_GOOGLE_CLIENT_ID` and its secret
   are set. So a provider the owner has not configured ends up carrying the gate's placeholder, in
   the stack the gate restores. Whether the OTA stack's file holds any of these cannot be seen
   from here. Live's `.env` is never restored by the gate (T1g), so it never gets them.
2. It runs `bootstrap-managed.sh --from data --with-demo --no-smoke`:
   - The `demo` phase starts the demo Stalwart and Nextcloud and seeds the two demo tenants. They
     have fixed ids, and their credentials are in this repository. The bring-up says of
     `--with-demo`: *"A real deployment must not use it"*.
   - The `trigger` phase brings Trigger.dev up at the checkout's tag.
   - The `app` phase runs `setup-zitadel.sh` against the stack's identity provider. It then runs
     `up -d --build --wait` for the API and web app from the checkout. The API runs both
     migration chains at boot.
   - The `tasks` phase re-uploads the task environment and deploys the checkout's task bundle.
3. It runs `setup-zitadel.sh` a second time, seeds the demo IMAP source and checks the pooler.
4. It runs `trigger-version.sh drill`, which dumps `triggerdb`, restores the dump into a throwaway
   database and compares the two. This is the only dump the run takes, and it comes after the
   redeploy.
5. It runs the acceptance smoke. The smoke creates four people and a throwaway sign-in
   application in the identity provider. It grants `IAM_LOGIN_CLIENT` to the provisioning user,
   which the smoke's own comment calls *"the right to impersonate"*. It appoints one of the four
   operator for part of the run, a row its own comment calls *"a standing reader of every
   tenant's metadata"* if it outlives the run. It files access requests and grants one, which
   creates an organisation and an owner invitation. It drives verify and apply on the demo
   tenants, then takes all of it back. If a run dies before the take-back, what it created stays
   until the next run's sweep.

The run has no hold, no drain and no dump of the application database. It does not `down -v`, so
tenant data is not wiped. So, stated exactly: yes, the gate rebuilds and redeploys the same
compose project from `main`, with `--with-demo`, and without a drain or a backup. Image bumps on
`main` reach the same planes. The identity provider *"migrates its schema on boot on the
persistent stack"* (0119), and a Trigger.dev version bump is one way, as the drill's own comment
says. Under D7 that is acceptable for a demo stack, and it is the reason testers are not on it.

**The repository's own rule.** The runbook says *"before the first non-demo tenant is onboarded,
CI and production must not share this machine"* (*This box also runs CI*), and
`docs/release.md` carries the same checklist item. A tester is a non-demo tenant. The runbook
names the class of problem as *"CI and production share a Docker daemon"*, and D7 keeps them on
one daemon: live, the OTA stack and the runner. SECURITY.md says of the runner: *"trusted
workflows only (docker socket + root = RCE risk)"*. Pull requests run on GitHub-hosted runners,
and a push to `main` runs `ci.yml`'s jobs and `security-scan.yml`'s on the self-hosted one.
`ci.yml` does not reference `managed.yml`. `e2e.yml` brings up the appliance's stack, whose own
port defaults to loopback (`SELFHOST_BIND`). The dev Stalwart and Nextcloud it starts beside the
appliance are published on every interface, on free ports it picks, until its cleanup step
removes them.

**What is published, and on which interfaces.** Seven ports in `managed.yml` have no host
address, so Docker publishes them on every interface:

- Postgres, on `POSTGRES_PORT` (5432 by default; the reference machine uses 55432, according to
  `seed-managed.sh`);
- the Trigger.dev API, on 3090, over plain HTTP;
- the Trigger.dev dashboard, on 3443;
- the identity provider, on 3126, over plain HTTP;
- the API, on 3001, which also serves an unauthenticated `/metrics`;
- the web app, on 3123;
- the status page, on 3124.

The public site is a separate stack on the same machine, and it does the same:
`deploy/compose/www.yml` publishes `WWW_PORT` (3125) on every interface, and serves
`www.ota.ownpace.eu`.

The registry, Mailpit and Nextcloud are bound to loopback. Mailpit and Nextcloud do it through
`MAILPIT_BIND` and `NEXTCLOUD_BIND`, and two guards refuse an all-interfaces default for them
(`the-mail-the-issuer-could-not-send`, `a-publish-that-moved-and-a-caller-that-did-not`). The demo
Stalwart sits outside `managed.yml`. It is started with `docker run -p` on 18081 (JMAP) and 1994
(IMAPS), on every interface, with the passwords `setup-stalwart.sh` prints. Docker writes its own
firewall rules for published ports, so a host firewall's ordinary input rules do not close them.
That is Docker's documented behaviour, and it is why T3 probes the ports instead of reading
rules. When this plan was opened, the bring-up's ports table had seven rows and left out the
identity provider, the status page and Mailpit. #1137 (merged 2026-09-24) added those rows, a
sentence that every port not marked loopback is published on every interface, and a note that
`/metrics` must stay off any public interface.

**A second stack beside it.** Checked in `managed.yml` and the scripts on `main` on 2026-09-24.

- **What the project name already separates.** `name: ownpace-managed` sits at the top of
  `managed.yml`. Compose's `-p` flag and `COMPOSE_PROJECT_NAME` both override a top-level `name:`,
  so the pin is a default, not a limit. Volumes and networks carry no `name:` of their own, so
  Compose prefixes them with the project name. The API and the web app are `build:` with no
  `image:`, so their images are named after the project too. Every published port is a variable:
  `POSTGRES_PORT`, `TRIGGER_PORT`, `TRIGGER_TLS_PORT`, `ZITADEL_PORT`, `API_PORT`, `WEB_PORT`,
  `STATUS_PORT` and `REGISTRY_PORT` (the registry is bound to 127.0.0.1), and Mailpit's and
  Nextcloud's, which are bound to loopback.
- **What it does not.** 17 services have a fixed `container_name`: `ownpace-db`,
  `ownpace-pgbouncer`, `trigger-db`, `trigger-redis`, `trigger-api`, `trigger-clickhouse`,
  `trigger-registry`, `trigger-docker-proxy`, `trigger-supervisor`, `trigger-minio`,
  `trigger-tls`, `ownpace-idp`, `ownpace-api`, `ownpace-web`, `ownpace-status`,
  `ownpace-mailpit` and `ownpace-nextcloud`. `docker compose -p` does not namespace
  `container_name`, so a second project cannot start while those containers exist. The runbook's
  first example is the appliance's upgrade drill, which nearly took a live appliance down this way.
- **One literal inside `managed.yml`.** The supervisor starts every task run on the network
  `DOCKER_RUNNER_NETWORKS: ownpace-managed_ownpace-network`, written out in full. Under another
  project name, that stack's task runs would join the OTA stack's network, where `postgres` is
  the OTA stack's database.
- **The scripts.** Among the shell scripts under `deploy/compose/`, `ownpace-db` appears in 7,
  `trigger-api` in 8 and the project name in 9. Guards under `scripts/` pin some of them. For
  example, `reset-trigger.sh` removes the volume `ownpace-managed_trigger_db_data` by name. Run
  from another stack's checkout, it would stop that stack's Trigger.dev containers and then try
  to remove the OTA stack's Trigger.dev database. The persisted `.env` and the Trigger.dev dump
  directory default to `~/.persistent/ownpace-managed` (`bootstrap-managed.sh`,
  `trigger-credentials.sh`, `trigger-version.sh`). So do `e2e-managed.yml` and
  `e2e-live-target.yml`, the two workflows that read a persisted `.env`.
- **What leaving out the demo leaves out.** Without `--with-demo`, the bring-up skips the demo
  tenants, the demo Stalwart and Nextcloud. The `app` phase starts Mailpit either way: it is in
  `phase_app`'s service list.
- **One Docker daemon.** Each stack's supervisor reaches Docker through its own
  `trigger-docker-proxy`, which holds the host's socket and allows creating and managing
  containers, networks and volumes (`CONTAINERS`, `NETWORKS`, `VOLUMES`, `POST`). The proxy is not
  limited to its own project. So either stack's orchestration plane can start a container on any
  network, or with any volume, on the machine, the other stack's included. Two stacks on one
  daemon are kept apart by names. That is not a boundary.
- **Ports seen from a container.** A container reaches ports the host publishes through its
  network's gateway address. A port published on every interface can therefore be reached from
  the other stack's containers. A port bound to 127.0.0.1 cannot.

**Passwords the repository knows.**

- `packages/ledger/migrations/0001_baseline.sql` creates `app_user` with
  `PASSWORD 'app_password'` if the role does not exist. Nothing in `deploy/`, `scripts/` or
  `packages/` runs `ALTER ROLE app_user`. The runbook says to do it by hand: *"rotate it in the
  DB (`ALTER ROLE app_user PASSWORD …`) to match"*. Changing `APP_DB_PASSWORD` in `.env` changes
  what the API presents. It does not change what the role accepts. This holds for every new
  stack, live included.
- `POSTGRES_USER` and `POSTGRES_PASSWORD` take effect only when the volume is first initialised.
  After that they change what clients present, not the role. `managed.yml` defaults them to
  `openmigrate` and `openmigrate_password`, and the example ships `change-me-openmigrate`.
- `APP_DB_USER` is a variable in the connection strings. The name `app_user`, however, is the one
  the migrations grant to: `TO app_user` appears in 8 ledger migration files and 15 managed ones.
  A role with another name gets none of those grants unless it is a member of `app_user`.
- `trigger-db`'s password is a literal in `managed.yml`: `POSTGRES_PASSWORD: trigger_password`,
  and the same value in both connection strings. ClickHouse defaults to `password` and MinIO to
  `very-safe-password`. None of the three is published on the host, but all three share one
  compose network with the API and the tasks.
- `ensure-env-secrets.sh` generates `JWT_SECRET`, `SECRET_ENCRYPTION_KEY`, the five Trigger.dev
  secrets, `PGBOUNCER_AUTH_PASSWORD` and the identity provider's three values. It does not
  generate `POSTGRES_PASSWORD`, `APP_DB_PASSWORD`, `CLICKHOUSE_PASSWORD` or
  `MINIO_ROOT_PASSWORD`.
- `bootstrap-managed.sh` notes shipped values but does not refuse them: *"Left as shipped they
  are not broken — a localhost-only demo box works — so this reports rather than refuses."* The
  note is in the `env` phase, which the gate's `--from data` skips.
- Row security keys on a setting the session sets itself (`current_setting('app.current_tenant')`).
  So anyone who logs in directly as `app_user` can read any tenant's rows by setting it. The owner
  role is a superuser and bypasses row security altogether.

**`NODE_ENV`.** `managed.yml` gives the API `NODE_ENV: ${NODE_ENV:-development}`, and the
example sets `production`. Several refusals apply only in production:

- the placeholder `JWT_SECRET` check (`assertProductionAuthConfig`);
- the localhost URL checks (`config-guards.ts`);
- the self-signed SMTP refusal (`notifications.ts`);
- hiding the development-only Mollie test route.

The gate's backfill from the example covers only the keys `managed.yml` marks required, and
`NODE_ENV` is not one of them. So a `.env` without it runs in development. What the OTA stack's
API has cannot be seen from here; T0 asks it.

**Values that left the machine.** 0020 records that the stack's generated values (*"DB password,
`SECRET_ENCRYPTION_KEY`, `tr_prod_` key"*) *"have appeared in pasted logs"*. It also records that
runner debug output prints the whole task environment. This plan could not check which logs those
were, or whether any reached a public job log. 0026 row 24 keeps the rotation parked until the
stack stops being a demo, and records the procedure as *"re-running `ensure-env-secrets.sh`"*.
That procedure rotates nothing: the script fills a blank and replaces a shipped placeholder, and
its own header says *"values already set in .env are never touched, so re-running it never
rotates anything"*. These are the OTA stack's values. Live's are generated at its first bring-up
and have been in no log (T5). Two more facts decide when to replace what:

- Stored mailbox credentials are encrypted under `SECRET_ENCRYPTION_KEY`, and
  `packages/core/src/secrets.ts` decrypts only its version 1. So a new key strands every stored
  credential, as the bring-up says.
- With `JWT_ISSUER` set, the API verifies sign-ins against the identity provider and does not use
  `JWT_SECRET` at all (`selectAuthMode`).

**Three deploy procedures.**

- The runbook's *Upgrade* backs up first and runs migrations *"as a **gated step**"*.
- The bring-up's *Updating a running deployment* is `git pull`, `up -d --build --wait api web`
  and `deploy-tasks.sh`, with no backup. The API migrates at boot, so there is no separate gated
  step. The next section, *Draining first*, adds the hold.
- The architecture document promises a staged or canary rollout with a backup before migrating.
  Neither exists. `docs/deployment.md` promised the same until #1137 (merged 2026-09-24), which
  now says both are not built. #1137 did not touch the architecture document's sentence.

A managed deploy is a source build of whatever is checked out. `migrate.ts` refuses a build that
is older than the schema, so without a dump there is no way back.

**What rides on the gate.** Two duties run only because the gate runs, and only for the OTA
stack. The first is the identity provider's provisioning token. It lives
`ZITADEL_PAT_LIFETIME_DAYS` (7) days, and `setup-zitadel.sh` replaces it during the last
`ZITADEL_PAT_ROTATE_BELOW_DAYS` (3). If a token expires without a replacement, someone has to
mint one by hand in the console (the bring-up's failure table). The second is
`trigger-version.sh drill`, which has no other schedule. Nothing does either for live yet (T7).

**The hold.** The operator's first support screen has *Hold new passes* (managed migration 0023,
`apps/api/src/routes/platform-pause.ts`). It stops the sync tick from starting new passes, and it
shows customers the operator's sentence word for word. Of the code that starts work, only the
tick reads it (`readOpenPause` in `managed-sync-tick.ts`); the API reads it only to show the note.
The eight places in the API that enqueue a task on a person's request, in
`routes/migrations/index.ts` and `operating-routes.ts`, do not read it.

## 2. The owner's decisions (2026-09-24)

- **D1, where the alpha runs.** Asked where testers run, and under which host names: *"This
  machine, ci states. The OTA address. It's all controlled by me and invite only."* ("ci states"
  is read as "CI stays", as 0131 reads it.) Asked about the blocker that called for a tester stack
  separate from CI and the nightly gate: *"Yes, but its a controlled rest. I Let people in and
  support them. Max 10/20 people"*. So the alpha runs on the reference machine, at
  `app.ota.ownpace.eu` and `id.ota.ownpace.eu`, and CI stays on that machine. That departs from
  the runbook's rule, and this plan records the conditions. **D7 changes the address:** testers
  use the production names, on `ownpace-live`. The machine, and CI on it, stand.
- **D2, what is reachable today.** Asked whether ports 5432, 3001, 3090, 3443 and 3126 are
  reachable from outside, whether the database passwords were changed, and whether the live
  identity provider holds other organisations: *"No, these ports are not reachable outside of
  private network/NetBird. Usernamea changed. No other organisations are hosted."*
- **D3, the database password the repository contains.** Asked about the blocker that Postgres is
  published with the `app_user` password the repository contains: *"Ill change user and pass. But
  not reached from internet."*
- **D4, the demo secrets.** Asked about the blocker to rotate the demo secrets if the current
  stack is reused: *"Who would need/het credentials? I aupporrthe test. No one will be added to
  NetBird network. Devs need to setup own private test/dev environments. GitHub PRs and git is the
  bridge."* ("het" is read as "get", and "aupporrthe" as "support the", as 0131 reads them.) §4
  answers the question in it. Under D7 the current stack is not reused for testers.
- **D5, backups and obligations.** Asked how much may be lost, how fast it must come back, and
  where backups are kept: *"None during the test"*. Asked about the blocker that nothing backs up
  the application database: *"No obligations during controlled test"*. 0134 carries this. Here it
  means a deploy has no way back unless the owner adds one (T6, open question 4).
- **D6, the size and length of the alpha.** Asked whether it is free or paid, how many people, for
  how long and in which language: *"Free and invite only. 10 to 20 people max. Dutch."* On the
  test posture: *"Free. A few weeks. No obligations both sides."* The owner also asked that the
  test be called an alpha.
- **D7, `ownpace-live` beside `ownpace-managed` (cited in the sibling plans as 0132 D-new).** The
  owner asked: *"check, can't i just (as a start) host a 'ownpace-live' as production, next to the
  current 'ownpace-managed' on OTA-domain? What would i need to do to keep alle seperate from each
  other?"* ("alle seperate" is read as "all separate".) The proposal put back to the owner: make
  "ownpace-live beside ownpace-managed" the decision in this plan, with the container-name
  parameterisation as its first task, and testers on `ownpace-live`. The owner's answer: *"Yes!
  The spark has a lot free memory and disk, it will fit."* So:
  - A second compose project, `ownpace-live`, runs on the reference machine beside
    `ownpace-managed`.
  - `ownpace-live` is production for the alpha. Testers use it, on the production names from
    0091: `app.ownpace.eu`, `id.ownpace.eu` and the status page's `status.ownpace.eu`. 0091 T4,
    *"`app` stays dark until it means production"*, is answered: it now means production.
  - `ownpace-managed` stays the OTA stack at `app.ota.ownpace.eu`: the nightly gate's target and
    the demo. CI never touches `ownpace-live`.
  - The separation is logical, on one Docker daemon. It is not a security boundary: both
    Trigger.dev planes hold rights on the Docker socket through their proxies (§1). That is
    accepted for a hand-picked alpha. If isolation has to be a boundary, the next step is a VM, or
    a rootless Docker daemon per stack.
  - The owner reports that the machine has the headroom. 0143's rehearsal records what both
    stacks use.
  - D7 supersedes T1's options A, B and C, and T8 with them. The nightly gate no longer threatens
    testers' data, because it never rebuilds, reseeds or restores the stack they use.
  - What "keep all separate" takes, in the order it has to happen: T1, then T1b to T1g, and T3
    (§3).

## 3. What each task does

### T0 — on the reference machine, before the first invitation (owner)

Do these in order, because each step assumes the one before. (Before D7, the first step was
switching the gate off. D7 drops it: the gate keeps running, on the OTA stack.)

1. **T1 in place.** Once T1 is merged, the next gate run, or
   `./deploy/compose/bootstrap-managed.sh --from data --with-demo` from `~/ownpace-managed`,
   brings the OTA stack up under T1's names. Its volumes keep their names, because they are named
   after the project and the project does not change. Check with `docker ps`.
2. **Change the OTA stack's passwords (T2)**, with the steps given there.
3. **Stand live up (T1b to T1d)**: its checkout at a tag, its `.env`, its ports, its passwords
   before the first bring-up, the bring-up without the demo, the one human step on its own
   Trigger.dev dashboard, its identity provider at `id.ownpace.eu`, and the owner's own account on
   it, appointed operator with `operator.sh add`.
4. **Route the production names to it (T1e).**
5. **Run the checks.** From `~/ownpace-live`:
   - `docker compose -f deploy/compose/managed.yml exec -T api printenv NODE_ENV` prints
     `production` (T4). Run the same from `~/ownpace-managed` for the OTA stack.
   - `curl -s https://app.ownpace.eu/api/auth/mode` answers `managed`.
   - `curl -s https://id.ownpace.eu/.well-known/openid-configuration` names
     `https://id.ownpace.eu` as its `issuer`, and the sign-in button on `app.ownpace.eu` leads
     there, not to `id.ota.ownpace.eu`.
   - `./deploy/compose/operator.sh list` names the owner and nobody else.
   - T2's step 2, run against live, refuses the three shipped pairs.
   - The exposure check and the outside probe pass (T3). Until T3 is built, the owner tries every
     port both stacks publish, the site's 3125 and the demo's two, from a machine that is not on
     the mesh or the private network.
6. **Write it down in this block:** the date of each step, the tag live runs, and the outcome of
   each check. Never a value.

### T1 — container names and scripts take the stack from the project name (decided, D7)

**Nothing else in D7 can start before this.** A second project cannot start while the 17 fixed
container names exist (§1), and the scripts would reach the OTA stack from live's checkout.

- **The names.** `managed.yml`'s 17 `container_name` values stop being fixed strings. Each is
  either derived from the project name or dropped, so that Compose names the container after the
  project. `name: ownpace-managed` stays as the default, so the OTA stack keeps its project, its
  volumes and its networks. The supervisor's `DOCKER_RUNNER_NETWORKS` is derived from the project
  name in the same way.
- **The scripts.** A script reaches a service through `docker compose exec <service>`, which
  Compose scopes to the project, or through a name derived from `COMPOSE_PROJECT_NAME`. It never
  uses a fixed name such as `docker exec ownpace-db`. The volume names in `reset-trigger.sh`,
  `setup-zitadel.sh`, `bootstrap-managed.sh` and `smoke-managed.sh`, and the network name in
  `setup-managed-demo.sh`, are derived from the project name. The persisted `.env` and the dump
  directory default to `~/.persistent/<project>`.
- **Where the name comes from.** Each stack's `.env` sets `COMPOSE_PROJECT_NAME`. Live's names
  `ownpace-live`; the OTA stack's is left empty or names `ownpace-managed`. The scripts run
  `docker compose -f deploy/compose/managed.yml`, so Compose reads the `.env` beside
  `managed.yml`, and the scripts already load the same file. One key then selects the stack for
  both.
- **The docs.** The bring-up, the runbook and `docs/dav-sync.md` name containers in `docker exec`,
  `docker logs` and `docker inspect` commands, and they follow the code. The bring-up's *One box,
  one stack, one `.env`* becomes *One stack, one `.env`*. The operator's checkout of the OTA stack
  and the gate's still share one file; live has its own (T1b). The warning against a fresh
  bring-up in the gate's checkout stays, for the OTA stack.
- **The guard.** `scripts/two-stacks-on-one-box.unit.test.ts`, which was T8's guard, moves here.
  It has two halves. The first half fails on a fixed stack name in `managed.yml`, in the shell
  scripts under `deploy/compose/`, and in `.github/workflows/`. That covers any of the 17
  container names used as a container, any `ownpace-managed_…` volume or network, and
  `ownpace-managed` anywhere except as the one default of the variable that selects the stack. It
  also fails if any workflow names `ownpace-live` (T1g). The second half sets two project names
  and two sets of port values, and checks that the two stacks share no container name, volume,
  network or host port. It fails today on the 17 names, on the network literal, and on every
  script §1 counts.

**What it costs the OTA stack.** If the container names change, the next bring-up recreates the
OTA containers under the new names. The volumes stay. Any command that says
`docker exec ownpace-db` changes with it, in the docs and in the owner's habits.

#### Before D7: the three options (⛔ superseded 2026-09-24)

Kept as the record of what was weighed. D7 answers the question differently: the gate keeps the
OTA stack, and testers get a stack of their own. What A would have cost, no managed proof of
`main` during the alpha, does not arise. What C found wrong stays true of the OTA stack, which is
why testers are not on it. B's shape is what D7 builds, with the roles swapped.

There are three options.

**(A) Switch the scheduled gate off for the alpha, and deploy the alpha by hand.** *Recommended
for the alpha's few weeks (D6).*

- **The switch.** The owner disables the workflow in GitHub. That stops the schedule and a hand
  dispatch alike, and `gh workflow enable` undoes it. From then on the alpha is deployed only by
  T6, from a commit the owner names.
- **The code half makes an accident harmless.** Straight after the restore, a new first step in
  the gate refuses when the restored `.env`'s `WEB_URL` is an `https` address that is not
  localhost: *"this is a stack people use; the gate needs one of its own (0132 T8)"*. It refuses
  before `ensure-env-secrets.sh`, the backfill or the copy-back can write anything. T5's
  bring-up refusal is a second layer.
- **The docs.** The runbook's CI section and the release checklist item say that the alpha runs
  on the reference machine by the owner's decision of 2026-09-24, under this plan's conditions,
  and that the rule still stands for anything beyond the alpha. The header of `e2e-managed.yml`
  says the gate is off and why.
- **The guard.** `scripts/a-gate-that-leaves-the-alpha-alone.unit.test.ts` finds that refusal in
  `e2e-managed.yml`, ahead of the first write to `.env`. It fails today: after the restore, the
  first steps are the early refusal for the two Trigger.dev values and then
  `ensure-env-secrets.sh`.

What A costs: for the alpha's weeks, nothing proves `main` on a managed stack. The first deploy
can still use a commit the gate ran green. 0131 asks for N green scheduled runs of the deployed
commit, so pick it from the last runs before the switch-off. The review of 2026-09-23 found the
three scheduled runs before it (#193 to #195) red, a dispatched run after them (#196) green, and
the last green scheduled run to be #191, on 2026-09-20; this plan did not re-check the run list.
A fix deployed later has CI behind it but not the managed gate. The appliance's nightly
(`e2e.yml`) keeps running, and so does the live-target lane. Neither rebuilds or seeds the
managed stack. The appliance's nightly does bring a full stack up beside the alpha twice a night
(23:30 and 01:30 UTC), which is load on the machine rather than a second writer. The live-target
lane, when it is armed (0105 T3's supervised sitting, which arms it, still waits for the owner),
asks the API named in the persisted `.env` for passes on the persistent tenant 0105 T1
configures.

**(B) Give the gate a stack of its own on the same machine.** It would have its own compose
project, volumes, ports and `.env`, a Trigger.dev project it does not share, localhost addresses,
and the demo tenants there and nowhere else. This is T8. It is the right shape after the alpha,
but it is more work than a few weeks justify:

- `managed.yml`'s 17 fixed container names collide under any project name. `docker compose -p`
  does not namespace `container_name`, which is how the appliance's upgrade drill nearly took a
  live appliance down (the runbook's first example).
- The scripts name containers directly.
- The bring-up tells operators *not* to run a fresh bring-up in the gate's checkout, because it
  would *"generate different random secrets for the same, pinned-name containers"*.
- Its Trigger.dev half needs the one human step again.

B keeps what `scripts/one-stack-one-env.unit.test.ts` and *One box, one stack, one `.env`*
protect: one canonical `.env` per stack, written through its link. Two stacks would have one
`.env` each. What B changes is the first clause of that heading.

**(C) Keep it as it is.** This is not safe, and §1 shows why:

- Every night, the stack testers use is rebuilt from a commit nobody chose for it, at an hour
  GitHub chooses, with no hold and no dump.
- Demo tenants, and demo mail servers with published passwords, are put back into it.
- The identity provider testers sign in to has four people, an application and an impersonation
  role added and removed again. The stack itself gets a temporary operator, and an organisation
  granted through the access queue and removed again.
- The shared `.env` gets placeholder client pairs for any provider left empty.
- Image bumps migrate the identity provider's and Trigger.dev's schemas one way.
- #195 most likely shows the gate and a hand deploy already meeting on the same containers.

The recommendation was A now, and B (T8) when the alpha ends or grows. This answered 0131's open
question 2. D7 answers it again: the gate is not paused; it keeps the OTA stack.

### T1b — `ownpace-live`: its own checkout, `.env` and ports, and no demo

1. **A checkout of its own.** Clone the repository to `~/ownpace-live` and check out a tag
   (T6, step 1).
2. **A `.env` of its own.** Seed `~/.persistent/ownpace-live/.env` from `managed.env.example` and
   link it: `ln -sfn ~/.persistent/ownpace-live/.env deploy/compose/.env`. Set
   `COMPOSE_PROJECT_NAME=ownpace-live` (T1). Until T1 derives the default, also set
   `MANAGED_ENV_PERSIST_DIR` to the live directory. Otherwise `bootstrap-managed.sh`,
   `trigger-credentials.sh` and `trigger-version.sh` look in the OTA stack's.
3. **Ports of its own.** Every `*_PORT` variable gets a value the OTA stack does not use:
   `POSTGRES_PORT`, `TRIGGER_PORT`, `TRIGGER_TLS_PORT`, `ZITADEL_PORT`, `API_PORT`, `WEB_PORT`,
   `STATUS_PORT` and `REGISTRY_PORT` (T1c).
4. **The production names.** The browser-visible addresses that 0091 T1 lists name
   `https://app.ownpace.eu`. The identity provider's `ZITADEL_EXTERNALDOMAIN` is `id.ownpace.eu`,
   with port 443, secure, and TLS terminated in front, in the shape `managed.env.example` shows
   for the OTA names (T1d). The status page's probes default to `WEB_URL` and to the provider's
   own domain, so they follow without a setting of their own. `NODE_ENV=production` (T4).
5. **Passwords before the first bring-up.** `ensure-env-secrets.sh` is the right tool for a new
   stack: every secret it knows is blank or a shipped placeholder, and the `env` phase fills each
   one with a fresh value.
   The bring-up's own rule, *"only generate fresh secrets when there is no working stack yet at
   all"*, is live's case. It does not generate `POSTGRES_PASSWORD`, `APP_DB_PASSWORD`,
   `CLICKHOUSE_PASSWORD` or `MINIO_ROOT_PASSWORD` (§1). Generate those four on the machine before
   the `data` phase, in the form T2's step 3 uses, and set `POSTGRES_USER` too. A new volume takes
   them at first initialisation. `trigger-db`'s password is a literal until T2's code lands. That
   code should land before live's first bring-up, which is when a new password costs nothing.
6. **The bring-up, without the demo.** `bootstrap-managed.sh --only preflight`, then `--only env`,
   then `--only data`. Then create `app_user` with `APP_DB_PASSWORD` before anything migrates,
   because the baseline creates it with `app_password` only when it does not exist. This is T2's
   step 4 with `CREATE ROLE app_user LOGIN PASSWORD …` instead of `ALTER`. Then run
   `--from trigger`, which stops at the one human step on live's own dashboard (T1c). Never pass
   `--with-demo`: there are no demo tenants, no demo Stalwart and no Nextcloud on live. Mailpit
   starts anyway (§1). Once `SMTP_HOST` names 0133's relay it catches nothing, and whether live
   runs it at all is 0133 T3's decision.
7. **Check the passwords.** Run T2's step 2 against live, on `ownpace-live_ownpace-network`. The
   control opens and the shipped pairs are refused.

### T1c — its own Trigger.dev plane

- **Its own instance.** Live's `trigger-*` services, with their own database, Redis, ClickHouse,
  MinIO, registry and supervisor, come up in live's project (T1). They get their own account,
  organisation and project through the one human step, on live's dashboard at
  `https://localhost:<TRIGGER_TLS_PORT>`. `trigger-credentials.sh` reads the `proj_` ref and the
  `tr_prod_` key into live's `.env`.
- **Its own CLI login.** Live's `.env` names a `TRIGGER_CLI_PROFILE` of its own, so a login to
  one plane is never used against the other when both checkouts run as the same user on the
  machine. If a `TRIGGER_ACCESS_TOKEN` is used, it is live's own, never the repository secret CI
  uses.
- **Its own registry port.** The supervisor pulls task images from
  `localhost:${REGISTRY_PORT}`, so the two planes need two registry ports.
- **Its own API origin.** `TRIGGER_API_ORIGIN` names live's own `TRIGGER_PORT`.
  `managed.env.example` gives `http://localhost:3090`, the default `TRIGGER_PORT`, and nothing
  derives one from the other. `set-task-env.sh` uploads the task environment to that origin and
  `deploy-tasks.sh` deploys to it, so a live `.env` that moved only the port would send live's
  settings and tasks to whichever plane answers on 3090, the OTA plane while it keeps the default
  (0133 T3 checks it before the upload).
- **Never the OTA plane.** The nightly gate restarts the OTA plane and brings it to `main`'s tag.
  0091 T4 weighed one Trigger.dev instance with two environments. Its own third point settles it:
  on one instance, a Trigger.dev upgrade cannot be proven on the OTA stack while live stays put.
  Two planes let the gate prove a version bump before a tag carries it to live.
- **The cost.** A second ClickHouse, Redis, MinIO, registry and supervisor on the machine. 0143
  sizes both stacks together, and the owner says the machine has room for it (D7).

### T1d — its own identity provider at `id.ownpace.eu`

- **Its own instance.** Live's `zitadel` service keeps its database in live's Postgres, and its
  provisioning token on live's own `zitadel_machinekey` volume. `ZITADEL_MASTERKEY` is generated
  at live's first bring-up. `ZITADEL_EXTERNALDOMAIN` must be `id.ownpace.eu` at first
  initialisation. `managed.yml` explains why: the address goes into every token's `iss`, and it
  cannot be corrected afterwards.
- **Its own mail.** Live's identity provider sends through the relay 0133 sets up, with a login.
- **A web image built for it.** `VITE_OIDC_ISSUER` and `VITE_OIDC_CLIENT_ID` are build arguments
  of the web image. `setup-zitadel.sh` writes them into the stack's `.env`, and the `app` phase
  builds after it. A web image built in the OTA checkout carries the OTA issuer, so live's image
  is built in live's checkout only. The images are named after the project, so the two cannot be
  swapped by accident.
- **What the bring-up already expected.** Its *One issuer or two?* says production gets *"a
  separate provider on the production box, not a second name for this one"*. The provider is
  separate as planned, and it runs on the same machine, in a second project. Accounts do not
  travel: the owner signs up on live, and testers only ever have accounts there.
- **The hardening.** 0135 applies to live's instance, and to the OTA stack's too.

### T1e — the production names routed to live (owner)

- **The routes.** In NetBird: `app.ownpace.eu` to live's `WEB_PORT`, `id.ownpace.eu` to live's
  `ZITADEL_PORT`, and `status.ownpace.eu` to live's `STATUS_PORT`. External names stay on 443, as
  0091 records, so the local port numbers appear nowhere a browser or Google sees.
- **0091 T4 is answered.** `app.` now means production, so the production names lead to the
  machine on purpose. What remains of 0091's concern is the route: a production name must reach
  live's ports, never the OTA stack's. The check below confirms it.
- **Google.** 0091 §1 lists `https://app.ownpace.eu/oauth/google/callback` as the production
  redirect URI. That is the planned path; the shipped route is `/api/migrations/google/callback`
  (`docs/google-oauth-verification.md`), so live needs
  `https://app.ownpace.eu/api/migrations/google/callback` on the client it uses. Which client that
  is, and its registration, are 0140's (T11).
- **The check** is in T0 step 5. `id.ownpace.eu` names itself as the issuer, the sign-in button
  on `app.ownpace.eu` leads there, and `/api/version` on `app.ownpace.eu` names the commit of
  live's tag.

### T1f — every port that need not be reachable bound to 127.0.0.1, in both stacks

Carried by T3. §1 says why both: a container reaches ports the host publishes through its
network's gateway, so a port published on every interface by either stack can be reached from
the other stack's containers.

### T1g — live is deployed by hand from a tag; CI never touches it

- **The OTA stack keeps following `main`.** The nightly gate runs on it every night, with the
  demo, as §1 describes. That is what proves a commit before live gets it.
- **Live moves only by hand, from a tag.** T6 is the procedure, and 0146 decides how tags are
  cut. Nothing scheduled deploys live.
- **The code half makes an accident harmless.** Live's `.env` carries a marker saying that the
  stack holds people's data (working name `STACK_KIND=production`). Straight after the restore,
  the gate refuses a `.env` that carries the marker, before `ensure-env-secrets.sh`, the backfill
  or the copy-back can write anything. So a `MANAGED_ENV_PERSIST_DIR` pointed at live's directory
  by mistake stops at once. This is option A's code half, kept, and keyed on the marker instead of
  `WEB_URL`, because the OTA stack's `WEB_URL` is a real https address too.
- **The guard.** `scripts/a-gate-that-leaves-the-alpha-alone.unit.test.ts` finds that refusal in
  `e2e-managed.yml`, ahead of the first write to `.env`. T1's guard fails if any workflow names
  `ownpace-live`.
- **The live-target lane.** `e2e-live-target.yml` reads the OTA stack's persisted `.env`, and it
  stays there. Proofs on live are 0141's.
- **The docs.** The runbook's CI section and the release checklist item say that live runs on the
  reference machine beside the OTA stack and CI, by the owner's decision of 2026-09-24, under this
  plan's conditions. They say that the rule still stands for anything beyond the alpha, and that
  the separation is by names on one Docker daemon (D7).

### T2 — database passwords the repository does not contain

D3 decides the change. **Under D7 it is chiefly the OTA stack's.** That stack's roles were created
with the values this repository contains, and the steps below are T0's second step. On live the
values are generated before the first bring-up and the role is created with them (T1b), so only
step 2's check runs there. The code stops the change from being undone later, on both stacks.

The commands reach Postgres through `docker compose exec`. Compose scopes that to the stack whose
`.env` sits beside `managed.yml`, so the commands work before and after T1, in either checkout.

**On the OTA stack**, from `~/ownpace-managed`, at a time the gate is not running (§1: it is
scheduled for 03:30 UTC, and GitHub has started it hours late). The stack has no testers, so no
hold is needed.

1. Look at the database, not at `.env`:

   ```bash
   dc() { docker compose -f deploy/compose/managed.yml "$@"; }
   dc exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc \
     "SELECT rolname, rolsuper, rolcanlogin FROM pg_roles WHERE rolcanlogin ORDER BY 1"'
   ```

   If this answers `role … does not exist`, the name in `.env` was changed after the volume was
   created, and it is not a role in this database: `POSTGRES_USER` only applies at first
   initialisation. Ask again with the old name (`-U openmigrate`). Use the owner role this step
   finds for `<owner-role>` in step 4, and connect as it there too (`-U <owner-role>` in place of
   `-U "$POSTGRES_USER"`).

2. Try the passwords this repository publishes, and try them over the network, the way the
   database checks every other container. Inside the container, the socket and loopback are
   trusted without a password (which is why `zitadel-db-password.sh` asks over the container's
   network address), so a check through `exec psql` cannot fail. The first line is the control:
   if it does not open, the rest tells you nothing. The password travels in `PGPASSWORD`, passed
   through by name, so it is not on the `docker run` command line. The network is the stack's own:
   `ownpace-managed_ownpace-network` for the OTA stack, `ownpace-live_ownpace-network` for live.

   ```bash
   project=ownpace-managed   # the stack you are checking: ownpace-live for live
   set -a; . deploy/compose/.env; set +a
   net="${project}_ownpace-network"
   ask() { PGPASSWORD="$2" docker run --rm -e PGPASSWORD --network "$net" \
     postgres:18-alpine psql -h postgres -U "$1" -d "${POSTGRES_DB:-openmigrate}" -tAc 'SELECT 1' >/dev/null 2>&1; }
   ask "${APP_DB_USER:-app_user}" "$APP_DB_PASSWORD" && echo "control: opens" || echo "CONTROL FAILED"
   ask app_user app_password && echo "OPENS: app_user, the migration's password" || echo "refused"
   ask openmigrate openmigrate_password && echo "OPENS: openmigrate, compose's default" || echo "refused"
   ask openmigrate change-me-openmigrate && echo "OPENS: openmigrate, the example's value" || echo "refused"
   ```

3. Put new values into `.env`. They are generated on the machine, and never typed, pasted or
   printed:

   ```bash
   ./deploy/compose/env-upsert.sh deploy/compose/.env \
     "APP_DB_PASSWORD=$(openssl rand -hex 24)" "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
   set -a; . deploy/compose/.env; set +a
   ```

4. Set the roles to those values. `printf` is a shell builtin, so the value appears on no command
   line. Replace `<owner-role>` with the name step 1 found:

   ```bash
   printf "ALTER ROLE app_user PASSWORD '%s';\n" "$APP_DB_PASSWORD" |
     dc exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1'
   printf "ALTER ROLE \"%s\" PASSWORD '%s';\n" "<owner-role>" "$POSTGRES_PASSWORD" |
     dc exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1'
   ```

5. Sort out the names. Keep `app_user` as the application role's name. The migrations grant to
   that name, and the name protects nothing; the password does. If `APP_DB_USER` names another
   role, set it back to `app_user` and give the other role `NOLOGIN`. If the owner role was
   renamed, the old one must not keep `LOGIN` with a known password. Run
   `ALTER ROLE openmigrate NOLOGIN`, and never `DROP` it, because it owns the schema. If a second
   name for the application role is wanted anyway, the shape is `GRANT app_user TO <name>` plus
   `ALTER ROLE app_user NOLOGIN`, but no test in this repository exercises it.
6. Make everything that presents these values pick them up. On the OTA stack that is
   `./deploy/compose/bootstrap-managed.sh --from data --with-demo` (the stack is the demo), or the
   next gate run, which does the same with the file the operator's checkout links to. It recreates
   the containers whose environment changed: Postgres's (the volume stays), the API's and the
   identity provider's, which uses the owner role for its admin connection. It re-uploads the
   tasks' `DATABASE_URL` and `APP_DATABASE_URL`, and redeploys the tasks. On live, T6 does this.
7. Run step 2 again. The control opens and the three shipped pairs are refused. Write it in T0 as
   "refused", with the date.

**ClickHouse and MinIO.** On the OTA stack, generate `CLICKHOUSE_PASSWORD` and
`MINIO_ROOT_PASSWORD` the same way, then run
`docker compose -f deploy/compose/managed.yml up -d clickhouse minio trigger-api`. `trigger-api`
reads both pairs. The ClickHouse healthcheck logs in with the configured password, so a container
that did not take the new one shows as unhealthy. MinIO keeps the packets store. If MinIO refuses
the new pair on its old volume, the bring-up already says what the store costs to lose: historical
large run payloads, not deployments. `trigger-db`'s literal password waits for the code below.
Live's first bring-up gives it a new volume, and a new volume is where a new password costs
nothing (T1b).

**The code (proposed).**

- **The `data` phase makes both roles match `.env` on every run.** It creates `app_user` from
  `APP_DB_PASSWORD` before the first migration can, since 0001 creates the role only when it does
  not exist. If the role exists, the phase sets its password, and it sets the owner role's
  password the same way. It connects over the socket, as the owner, and passes each value as a
  session setting, the way `setup-auth.sql` already receives `pgbouncer_auth`'s (`PGOPTIONS`), so
  the value is never part of the SQL text. Today that setting reaches `docker compose exec` as an
  argument (`-e PGOPTIONS="-c my.pw=…"`); the new code passes it by name from the environment, so
  it is on no command line either. With this in place, T1b's `CREATE ROLE` by hand is no longer
  needed.
- **`load_env` refuses shipped values on a real address.** Every phase from `data` on passes
  through `load_env`, including the gate's `--from data`. A real address means `WEB_URL` is
  `https` and not localhost, the same test `note_mail_goes_nowhere_real` uses. On such an address, the phase
  refuses if `POSTGRES_PASSWORD`, `APP_DB_PASSWORD`, `CLICKHOUSE_PASSWORD`, `MINIO_ROOT_PASSWORD`
  or `TRIGGER_DB_PASSWORD` is empty (compose's default then applies), a `change-me…` value, or
  one of compose's defaults. On localhost it keeps today's note. A developer's own stack (D4) is
  where the shipped values are right, as `--accept-defaults` already says. The OTA stack's
  `WEB_URL` is a real address, so this refusal would stop the nightly gate until the steps above
  are done there: the steps come first, then the code.
- **`ensure-env-secrets.sh` generates the five when they are absent.** The example ships them
  empty, as it already does `ZITADEL_ADMIN_PASSWORD`; today it ships `change-me-…` values and
  `APP_DB_PASSWORD=app_password`. If a stack whose volume already exists has a placeholder, the
  script refuses and points to these steps, the way it handles `TRIGGER_ENCRYPTION_KEY`, because
  Postgres keeps the password it was initialised with.
- **`trigger-db`'s password becomes `TRIGGER_DB_PASSWORD`**, and it is required.
- **The docs agree.** The bring-up's phase-2 advice and the runbook's section on the two roles
  say the same thing. The bring-up's sentence that a changed `APP_DB_PASSWORD` must also reach
  the role is on `main` since #1137 (merged 2026-09-24); the rest follows the code.
- **The guard.** `scripts/a-password-the-repository-knows.unit.test.ts` drives the scripts with a
  stubbed `docker`, as `the-mail-nobody-should-get` already does. It checks four things:
  - `WEB_URL=https://app.example.test` with `APP_DB_PASSWORD=app_password` exits 1, naming the
    key and no value;
  - the same values on `http://localhost:3123` exit 0 with the note;
  - the `data` phase issues the `app_user` statement with the value from `.env` and prints no
    value;
  - `managed.yml` contains no literal `trigger_password`.

  It fails today on the first, third and fourth.

### T3 — "not reachable from the internet", checked

D2 says the ports cannot be reached from outside the private network and the mesh. Testers are not
on the mesh (D4), so live's production names, and the site's, must answer from the internet, and
nothing else may. This task has three parts, and one fact to write down. It also carries T1f.

**Binds with a loopback default, in both stacks (T1f).** Each of the seven ports gets a bind
variable with a loopback default, the shape `MAILPIT_BIND` and `NEXTCLOUD_BIND` already have:
`POSTGRES_BIND`, `API_BIND`, `TRIGGER_BIND`, `TRIGGER_TLS_BIND`, `ZITADEL_BIND`, `WEB_BIND` and
`STATUS_BIND`. `www.yml`'s port gets `WWW_BIND`. Both stacks read the same `managed.yml`, so both
get the defaults, and each stack's `.env` holds its own exceptions.

- **Why both stacks.** A container reaches the ports its host publishes through its network's
  gateway (§1). Live's API and tasks connect to hosts that testers type (0136). Until this lands,
  a host that leads to the gateway reaches the OTA stack's Postgres, which keeps the passwords
  this repository contains until T2 is done there. Live's own ports are reachable the same way, and the
  OTA stack's containers reach live's. 0136's deny-list takes in the Docker bridge and gateway
  ranges for the same reason. Binding to 127.0.0.1 closes the path, whatever the deny-list
  misses.
- **Most ports need nothing more.** Nothing on the machine needs Postgres, the API or the
  Trigger.dev API from anywhere but the machine itself. The host scripts connect to Postgres's
  published port on localhost. The deploy CLI talks to `localhost:<TRIGGER_PORT>`. The web app
  reaches the API over the compose network. If the owner opens a Trigger.dev dashboard or a status
  page from a laptop over the mesh, `TRIGGER_TLS_BIND` or `STATUS_BIND` is set to the machine's
  mesh address in that stack's `.env`, as `MAILPIT_BIND` already allows.
- **The routed ports need an extra publish.** The front that serves the names needs, from wherever
  it connects, the ports the names are routed to. For live that is the web app's, the identity
  provider's and the status page's port (T1e). For the OTA stack it is the ones its names use, and
  for the site it is the site's port. The bring-up still reaches the identity provider on
  localhost (`wait_for_idp_ready`), so each of these keeps its loopback publish and gets an
  optional second one, on the front's address. That address is set in each stack's `.env` on the
  reference machine and stays there; the address guard (`an-address-that-was-not-an-example`)
  keeps mesh addresses out of the repository. It has to be set before the change is deployed
  there, or the names stop answering.
- **The demo.** `setup-stalwart.sh`'s `-p` gets the same loopback default.
- **The guard.** `scripts/a-port-published-on-purpose.unit.test.ts` checks that every `ports:`
  entry in `managed.yml` and `www.yml` publishes through a bind variable with a loopback default,
  and that none defaults to all interfaces. It fails today on eight entries.

**A check on the machine.** `deploy/compose/exposure-check.sh` reads `docker ps` for every
container on the host, not only one project's, so one run covers both stacks. It fails for each
port published on all interfaces, or on an address not listed in `EXPOSURE_ALLOW` in the `.env`
of the stack that runs it, and it names the container and the port. T6 runs it after every deploy
of live, and T7 runs it daily, outside the appliance nightly's hours: that run's dev Stalwart and
Nextcloud publish on every interface while it lasts (§1), and would fail the check. The guard,
`scripts/exposure-check.unit.test.ts`, feeds it recorded `docker ps` lines. An all-interfaces
Postgres must fail, naming its container. Loopback and allowed binds must pass. The output must
carry names and ports, never an address.

**A probe from outside.** `.github/workflows/exposure-probe.yml` runs on a GitHub-hosted runner,
which sits on the internet and is on neither the mesh nor the private network.

- **What it tries.** It resolves the production names (`app.ownpace.eu`, `id.ownpace.eu`,
  `status.ownpace.eu`) and the OTA names (`app.ota.ownpace.eu`, `id.ota.ownpace.eu`,
  `www.ota.ownpace.eu`). It then tries every port either stack publishes, the site's port and
  the demo's two, on the addresses those names resolve to. It also tries them on the machine's own
  public address, if the owner stores that address as a repository secret.
- **When it passes.** Port 443 on the production names answers over TLS. The OTA names answer as
  open question 7 decides. Nothing else answers. The probe also checks that the production names
  reach live and not the OTA stack: the discovery document at `id.ownpace.eu` names
  `https://id.ownpace.eu` as its issuer. 0135 asks that it also fetch the identity provider's
  organisation registration page, which answers 404 once 0135 T1 is in place.
- **Its port list** is derived from `managed.yml`, `www.yml` and `setup-managed-demo.sh`, never
  typed by hand. Live's port values live in its `.env`, which the probe cannot read, so the owner
  stores them as a repository variable. They are port numbers, not secrets.
- **Dispatch only, not scheduled.** A public repository's job logs are public, and a failing probe
  names an open port. So it runs when the owner is there to act on the result (open question 6).
- **The guard.** `scripts/a-probe-that-knows-every-port.unit.test.ts` fails when `managed.yml` or
  `www.yml` publishes a port the probe does not try. It fails today because the probe does not
  exist.

**The path, written down.** 0131 records that the review's DNS lookup found the OTA names
resolving to the mesh provider's hosted ingress. `docs/google-oauth-verification.md`, however,
still says *"Anyone not on the mesh gets a timeout"*. The probe settles which is true, for the OTA
names and for the production names T1e routes. This plan then records the path of a tester's
request to live (the ingress, the web image's nginx, the API) and what follows from it. The nginx
appends to `X-Forwarded-For` (`$proxy_add_x_forwarded_for`). So `TRUST_PROXY` (0093 T2c, 0131;
handed to the API by `managed.yml` since #1137, merged 2026-09-24) can only be a hop count if the
ingress replaces a client's own `X-Forwarded-For` rather than passing it on. One request with a
forged header, read back in live's access log, answers the question. The sentence in the Google
verification document is then corrected to match.

### T4 — a stack that does not say it is production does not start

- **The change.** The API's entry in `managed.yml` gets `NODE_ENV: ${NODE_ENV:?…}`, with a message
  that names the fix.
  `managed-env-contract.unit.test.ts` then requires the example to carry a value; it carries
  `production`. On the OTA stack, the gate's backfill adds it on its next run, because the key is
  now required. Live's `.env` sets it at T1b.
- **The gate.** Live runs with production on, so the gate should prove the same on the OTA stack.
  The smoke uses neither the Mollie test route nor `NODE_ENV`. One dispatched run should confirm
  this before the change reaches a stack.
- **The refusal.** T2's `load_env` refusal also refuses any `NODE_ENV` other than `production` on
  a real address.
- **The task containers.** Whether they see `production` is up to Trigger.dev.
  `set-task-env.sh` does not upload `NODE_ENV`, and this plan did not verify what the runner image
  sets.
- **The guard.** `scripts/a-stack-that-says-it-is-production.unit.test.ts` checks that no service
  in `managed.yml` defaults `NODE_ENV` to `development`. It fails today on the API.

### T5 — no demo in the alpha, and the values that left the machine replaced

**2026-09-24, D7: closed for live, parked for the OTA stack.** Live never had the demo or the
demo era. It starts with values generated at its first bring-up (T1b). Its `.env` is never
restored by the gate (T1g), so it never gets a placeholder client pair. It is brought up without
`--with-demo`. So 0026 row 24 does not fire for it, and there is nothing to replace. The OTA stack
stays a demo, so row 24 stays parked for it, with its own trigger: *"when that stack stops being a
demo"*. Routes (a) and (b) below are kept for that day. Two pieces still apply:

- **The code that keeps the demo off live.** `bootstrap-managed.sh` refuses `--with-demo` on a
  stack whose `.env` carries live's marker (T1g). That turns the bring-up's sentence *"A real
  deployment must not use it"* into a refusal. Before D7, this was keyed on `WEB_URL` being a real
  address. That key would now stop the gate on the OTA stack, which is brought up with the demo
  every night at a real address. The guard is `scripts/a-demo-on-a-real-address.unit.test.ts`,
  and it fails today because the flag is accepted everywhere.
- **Replace `SECRET_ENCRYPTION_KEY` on live only if it leaks.** After the first tester connects,
  a new key costs every tester a reconnect of every source and target (§4).

#### Before D7 (kept for the OTA stack, for when row 24's trigger fires)

0026 row 24 fires *"when that stack stops being a demo"*, and the alpha is that moment. The
procedure the row records does not rotate anything (§1), so this is the procedure. There are two
routes, and the owner chooses (open question 3).

**(a) A fresh application database.** *Recommended, unless the owner's own migrations on this
stack should survive.*

Before the first tester, the stack holds nothing but the owner's own organisation, the demo and
the gate's residue (D2: no other organisations). Starting empty makes "nothing left from the demo
era" true by construction, not by checklist. It also lets `POSTGRES_USER` and `POSTGRES_PASSWORD`
take effect the way they are meant to, at first initialisation. From `~/ownpace-managed`, with the
gate held off for the length of the reset:

```bash
./deploy/compose/reset-trigger.sh --yes            # Trigger.dev database, project ref, tr_prod_ key
docker rm -f ownpace-stalwart                      # first: it holds the compose network open
docker compose -f deploy/compose/managed.yml down  # no -v: the volumes go by name below
docker volume rm ownpace-managed_postgres_data ownpace-managed_zitadel_machinekey \
  ownpace-managed_mailpit_data ownpace-managed_nextcloud_data \
  ownpace-stalwart-data ownpace-stalwart-config
./deploy/compose/env-upsert.sh deploy/compose/.env JWT_SECRET= SECRET_ENCRYPTION_KEY= \
  TRIGGER_SESSION_SECRET= TRIGGER_MAGIC_LINK_SECRET= TRIGGER_ENCRYPTION_KEY= \
  TRIGGER_LOGIN_SECRET= TRIGGER_MANAGED_WORKER_SECRET= PGBOUNCER_AUTH_PASSWORD= \
  ZITADEL_MASTERKEY= ZITADEL_DB_PASSWORD= ZITADEL_ADMIN_PASSWORD= ZITADEL_PAT_EXPIRY=
```

After that:

1. Set the owner's user names and new passwords (T2 step 3, plus `POSTGRES_USER` if it changes).
2. Bring the stack up without the demo: `bootstrap-managed.sh --only preflight`, then
   `--only env` (which fills every blank with a new value), then `--only data`. If the file
   behind the link holds only a handful of keys, `--only env` refuses with *"is not a stack env"*
   and writes nothing: that is the shape of the gate's small durable set. With the gate held off,
   the file can be completed from `managed.env.example` in place, as the refusal itself says, and
   the phase run again.
3. Create `app_user` with `APP_DB_PASSWORD` before anything migrates. This is T2 step 4 with
   `CREATE ROLE app_user LOGIN PASSWORD …` instead of `ALTER`. 0001 then finds the role and leaves
   it alone.
4. Run `--from trigger`. It stops where a person is needed: at the Trigger.dev account step, and
   at the CLI login, because the stored login belongs to the plane the reset removed.

Why the volumes go:

- **Mailpit's volume**, because what it caught includes password-reset links.
- **The provisioning token's volume**, together with the identity provider's database. The
  bring-up's rule is that those two go together.

The cost of route (a): the owner signs up again, is appointed operator again (`operator.sh add`),
and re-creates their own migrations. The ledger can be rebuilt from the target (ADR-0020); the
configuration cannot. The live-target lane's mapping ids in the persisted `.env` also change.

**(b) In place.** This route keeps the owner's organisation and migrations. It needs one piece of
code: `seed-managed.sh --remove`. That command closes the two demo tenants with a window of 0 and
purges them through `packages/managed/src/offboarding.ts`, never through a `DELETE`; the runbook
explains why the cascade is wrong. The guard is an integration test that seeds, removes, and then
finds neither fixed tenant id in any table in `PURGED_TABLES`. It fails today because `--remove`
does not exist. Then:

1. Stop the demo Stalwart and Nextcloud, and remove their volumes.
2. Remove the gate's residue by hand. In the identity provider's console, that means people with
   an address at `smoke.local`, applications named *Ownpace Smoke …*, and `IAM_LOGIN_CLIENT` on
   the provisioning user. In the database, it means `tenant_member` and `platform_operator` rows
   at `smoke.local`, and any organisation named *Smoke Grant …* with its access request, removed
   in the order the smoke's own take-back uses (requests before organisations).
3. Reset the Trigger.dev plane as in (a).
4. Blank `JWT_SECRET`, `SECRET_ENCRYPTION_KEY` and the five Trigger.dev secrets, and run
   `./deploy/compose/ensure-env-secrets.sh`, which fills the blanks. T6's `--from data` skips the
   `env` phase, so nothing else would.
5. Deploy by T6, which recreates the API with the new values, uploads the task environment and
   deploys the tasks.
6. Run `./deploy/compose/operator.sh secrets`. It lists every stored credential the new key cannot
   decrypt, and the owner re-enters their own.

`ZITADEL_MASTERKEY` is not replaced in (b), because a new one would strand every account in the
identity provider (open question 5).

**In both routes.**

- **Take the placeholder client pairs out.** Empty any `GOOGLE_OAUTH_*`, `DROPBOX_OAUTH_*`,
  `MICROSOFT_OAUTH_*` or `IDP_GOOGLE_*` value that the gate wrote: those start with `gate-`, and
  the Dropbox one is `gatedropboxappkey`. Remove any Google sign-in provider in the identity
  provider whose client id is the gate's. Otherwise the product offers testers a provider whose
  client does not exist (0140).
- **Blanking `TRIGGER_ENCRYPTION_KEY` bypasses `ensure-env-secrets.sh`'s refusal**, which only
  recognises placeholders, not blanks. It is safe only together with the reset.
- **Delete the old dumps with the reset.** The dumps under
  `~/.persistent/ownpace-managed/trigger-backups` hold the old Trigger.dev store, which includes
  the old `SECRET_ENCRYPTION_KEY` encrypted under the old `TRIGGER_ENCRYPTION_KEY`.
- **The repository secret `TRIGGER_ACCESS_TOKEN`**, if it is set, belongs to the old plane and
  opens nothing after the reset. Under D7 the gate keeps the OTA plane, so it is minted again on
  that plane's new instance (before D7, T8 would have minted the gate's own).
- **Check the operators.** `./deploy/compose/operator.sh list` names the owner and nobody else.
- **Replace `SECRET_ENCRYPTION_KEY` before the first tester connects, or not during the alpha.**
  After that point, a new key costs every tester a reconnect of every source and target. The only
  reason to pay that is a key that has leaked (§4).

**The code that keeps the demo out**, as proposed before D7: `bootstrap-managed.sh` refuses
`--with-demo` when `WEB_URL` is a real address. D7 keys it on live's marker instead (above).

### T6 — one way to deploy live, from a tag

This procedure replaces the three for the managed edition. For live, the bring-up's *Updating a
running deployment* becomes this procedure. On the OTA stack the nightly gate is the deploy. The
runbook's *Upgrade* points to it and stops promising a gated migration step. The architecture
document is changed to mark staged rollout and a backup before migrating as not built, as
`docs/deployment.md` has done since #1137 (merged 2026-09-24).

1. Name the tag: a tag on `main` (0146) whose commit the nightly gate ran green on the OTA stack.
   0131 T5 asks for N green scheduled runs of the deployed commit. Record the tag and its hash.
2. Start the hold on live, with a sentence in Dutch (D6). Testers read it word for word.
3. Wait for the drain. The tick's log says `N pass(es) still in flight`; wait until N is 0.
4. If the owner wants a way back, dump live's application database now, and keep the dump until
   the next deploy (open question 4). The runbook's *Backup & restore* recipe dumps it, and since
   #1137 (merged 2026-09-24) it also dumps the identity provider's database and the roles, and
   says neither dump is usable without the stack's `.env`. Without a dump, a deploy only goes
   forward, because `migrate.ts` refuses to run the previous build against a migrated schema.
5. In `~/ownpace-live`, run `git fetch --tags origin && git checkout --detach <tag>`. Not
   `git pull`: live runs the tag that was named.
6. Run `./deploy/compose/bootstrap-managed.sh --from data`, without `--with-demo`. It checks the
   pooler and brings Trigger.dev up at the tag's version. It runs `setup-zitadel.sh`, which also
   replaces the provisioning token when that is due. It builds the API and web app with
   `GIT_SHA`, uploads the task environment and deploys the tasks. Without the demo the smoke is
   skipped, so step 7 stands in for it.
7. Run the checks.
   - `https://app.ownpace.eu/api/version` names the tag's commit.
   - `/api/ready` answers 200.
   - `/api/auth/mode` answers `managed`.
   - T3's exposure check and T4's `NODE_ENV` check pass.
8. Lift the hold. The tick's next summary shows passes started, and one of the owner's own
   migrations completes a pass on the new tasks.
9. Record the date, the tag and the outcome in the deploy log (below).

**The code (proposed).**

- **A deploy script.** `deploy/compose/deploy-live.sh <tag>` runs steps 3 and 5 to 7, and appends
  step 9 to `~/.persistent/ownpace-live/deploys.log`.
  - It refuses a ref that is not a tag, a `.env` without live's marker (T1g), no open hold,
    passes still in flight, a working tree that is not clean, and `--with-demo`.
  - It reads `platform_pause` the way `operator.sh` reaches the database. If it composes an owner
    URL, it has to be listed in `docs/rls-guide.md` §2, which
    `a-connection-the-docs-did-not-know-about` enforces.
  - Its guard, `scripts/a-deploy-from-a-named-tag.unit.test.ts`, drives each refusal with stubbed
    `docker`, `git` and `curl`. It fails without the script.
- **The hold covers every enqueue.** While a hold is open, the eight enqueue sites in the API
  answer 409 with the hold's sentence. They all go through one function, so a tester who presses
  *Sync now* during a deploy cannot start a pass after the drain count has already reached 0. The
  guard, `apps/api/src/a-hold-that-holds-every-door.unit.test.ts`, sweeps `apps/api/src` and
  fails on any `tasks.trigger(` call that does not go through that function. It fails today on
  all eight.

### T7 — what the gate does for the OTA stack, done for live

The gate keeps the OTA stack's provisioning token alive and runs its drill every night, and D7
keeps the gate running. Nothing does either for live. A script, `deploy/compose/box-duties.sh`,
runs daily from `~/ownpace-live` on a systemd timer on the machine. The unit files and install
steps go in the bring-up. It does four things:

- **Keeps live's provisioning token alive.** It runs `setup-zitadel.sh --token-only`, a new mode
  that runs the token's clock and nothing else. The full script also reconciles the identity
  provider's configuration, and a daily timer should not do that behind the owner's back, because
  0135 hardens that configuration. The token lives seven days and is replaced during its last
  three, so a daily run has days to spare.
- **Runs `trigger-version.sh drill` on live's plane**, as the gate runs it on the OTA plane, for
  as long as 0134 keeps it. It dumps the orchestration plane's own database (its account, project
  and API keys, deployments, run records and the encrypted task environment), not the application
  database. Its dumps go under `~/.persistent/ownpace-live/trigger-backups` once T1 derives the
  default, and they are secret-bearing.
- **Runs T3's exposure check**, which covers both stacks, outside the appliance nightly's hours
  (T3).
- **Counts the organisations on live's identity provider**, the read-only count 0135 T3
  describes, which counts on these duties to run it daily. It writes nothing, and a count above
  one fails the duty. The count is per instance. Whether the OTA instance is counted too, and
  from where, is 0135's to say.

The script exits non-zero and names the duty that failed, and it writes to the journal. Nobody is
told when it fails; 0142 is where that changes.

The guard, `scripts/a-duty-the-gate-used-to-do.unit.test.ts`, checks that every step of
`e2e-managed.yml` that maintains the stack rather than testing it is also in `box-duties.sh`.
Today those steps are `setup-zitadel.sh` and `trigger-version.sh drill`. It fails today because
the script does not exist. Until it lands, run `./deploy/compose/setup-zitadel.sh` from
`~/ownpace-live` at least every three days. It replaces the token only when fewer than three of its
seven days remain, so a gap of four days can miss that window.

### T8 — the gate gets a stack of its own (⛔ superseded 2026-09-24 by D7)

D7 swaps the roles. The second stack is live, and the gate keeps the OTA stack. Where each part
went:

- *One variable for the names* is T1.
- *The gate's own configuration* is not needed: the gate keeps the OTA stack's `.env`, ports and
  Trigger.dev project. Live gets its own (T1b, T1c).
- *The demo lives there only* holds under D7, on the OTA stack. Live refuses `--with-demo` (T5).
- *Measure first* is 0143. The owner reports the machine has the headroom (D7).
- *The bring-up docs* and *the guard* are T1.

The text below is kept as it was parked. Its counts were of scripts and guards together; §1 has
the checked counts of the scripts alone.

When the trigger fires:

- **One variable for the names.** `managed.yml`'s project name and container names come from one
  variable, with today's names as the default, and the scripts name containers through it.
  `ownpace-db` appears in 11 of the scripts and guards under `deploy/` and `scripts/`, and
  `trigger-api` in 10.
- **The gate's own configuration.**
  - Its own persisted `.env`: `MANAGED_ENV_PERSIST_DIR` is already a repository variable.
  - Its own ports, which are all variables already.
  - `WEB_URL` and the issuer on localhost.
  - Its own Trigger.dev project, minted once through the one human step.
- **The demo lives there only.** The demo, the smoke and the seed run on the gate's stack and
  nowhere else, so T1's refusal never fires on the gate.
- **Measure first.** Check whether the machine can carry two managed stacks (the gate's and the
  alpha) and the appliance's nightly at once before building this, not after.
- **The bring-up docs.** *One box, one stack, one `.env`* becomes *one stack, one `.env`*, and the
  warning against a fresh bring-up in the gate's checkout is rewritten for a gate with its own
  stack.
- **The guard.** `scripts/two-stacks-on-one-box.unit.test.ts` renders `managed.yml` under two
  project settings and checks that the two share no container name, volume, network or host port.
  It fails today on the 17 fixed container names.

## 4. Explaining the risk: who would need the credentials

The owner asked: *"Who would need/het credentials?"* Nobody. Nothing in this plan gives a
credential to anyone:

- Testers sign in with their own account at `id.ownpace.eu`, live's own identity provider. They
  never see a database password, a Trigger.dev key or the encryption key.
- Developers bring up their own stack, where the shipped values are the right ones.
  `--accept-defaults` exists for exactly that.
- Nobody joins the mesh (D4).

0131 §4 gives the short version. This is the long one, value by value.

A secret protects something only while nobody else knows it. Replacing one is not about who will
be given it. It is about who already has it. On the OTA stack, three kinds of values are already
known beyond the machine:

1. **Values this repository publishes.** These include `app_password` (from the baseline
   migration), compose's defaults `openmigrate_password`, `password` and `very-safe-password`, and
   `trigger-db`'s literal `trigger_password`. They also include the example's `change-me-…` values, the demo tenants'
   credentials and the demo mail server's passwords. Anyone who reads the repository has them.
2. **Generated values that left in logs.** 0020 lists a database password,
   `SECRET_ENCRYPTION_KEY` and the `tr_prod_` key. Runner debug output also prints the whole task
   environment.
3. **Copies held by code, not by people.** Both stacks' persisted `.env` files sit on a machine
   where every push to `main` runs a job with access to the Docker socket (SECURITY.md), and where
   the nightlies run `main` on their schedules. That is not a person
   holding a credential. It is a path by which a merged change, or a dependency the change pulls
   in, could read one. The owner's merge is the gate for that path (0131 §4), and it is the reason
   for open question 1.

Live's generated values are in none of the first two kinds, and they stay out of them as long as
its `.env` never reaches a runner (T1g), its runner logs are never pasted, and its task
environment is never printed into a public log. Only `trigger-db`'s literal is in the first kind,
until T2's code lands. The third kind applies to live as much as to the OTA stack.

**Who could use these values today?** Only something that can reach the service that checks them.
By D2 the published ports cannot be reached from the internet. So the database password works in
only these places:

- from the private network and the mesh, which belong to the owner;
- from inside a stack's own compose network, where every service of that stack shares one network;
- from any container on the machine, through the Docker gateway, for any port published on every
  interface (§1).

The alpha changes the last two. From the first invitation on, strangers type host names into
live, and live's API and tasks connect to those hosts from inside live's network (0136). A request
the service can be made to send to `postgres`, `clickhouse` or `minio` meets live's generated
passwords. One sent to `trigger-db` meets the literal until T2's code lands. One sent to the
gateway meets whatever the machine publishes on every interface, including the OTA stack's
Postgres with the passwords this repository contains, until T2 and T3 are done there.

Here is one example, reasoned but not demonstrated here. ClickHouse's HTTP interface accepts the
user and password in the URL and runs the query the request carries. With the password
`password`, one GET that the service is tricked into sending becomes a query. 0136 decides how the
service refuses such hosts. T2, T1b and T3 make the second lock a real one.

What each replacement buys, and what it costs:

| Value | What it protects | On live | On the OTA stack | Cost |
|---|---|---|---|---|
| `APP_DB_PASSWORD`, and the owner role's password | Every tenant's rows. Row security keys on a setting the session sets itself, and the owner role bypasses it. | Generated before the first bring-up; the role is created with it (T1b) | Changed before the first invitation (T2, D3) | On the OTA stack, one redeploy |
| `CLICKHOUSE_PASSWORD`, `MINIO_ROOT_PASSWORD`, `trigger-db`'s password | Trigger.dev's event store, its large payloads and its database | Generated before the first bring-up; `trigger-db`'s needs T2's code first | ClickHouse and MinIO with T2; `trigger-db`'s with row 24 | Nothing worth naming |
| `SECRET_ENCRYPTION_KEY` | Every stored mailbox and drive credential a person enters | Generated at the first bring-up. Replaced during the alpha only if it leaks | Parked with row 24; it guards the demo's and the owner's own credentials | On live after testers connect: every tester reconnects every source and target |
| `TRIGGER_ENCRYPTION_KEY` | The task environment store, which holds both database URLs and `SECRET_ENCRYPTION_KEY` | Generated at the first bring-up | Parked with row 24 (T5's reset) | The one human step on the dashboard |
| The other four Trigger.dev secrets, and the `tr_prod_` key | The dashboard's sessions and sign-in, the supervisor's link and task deploys | Generated, and minted on live's own plane (T1c) | Parked with row 24 | A new CLI login |
| `JWT_SECRET` | Nothing while `JWT_ISSUER` is set. If `JWT_ISSUER` is ever emptied, the API accepts tokens signed with this value instead. | Generated at the first bring-up | Parked with row 24, and cheap whenever it is done | An API restart |

The last row is why the old answer was "replace it now", even though the value is unused while
`JWT_ISSUER` is set: an edit to `.env` that empties `JWT_ISSUER` would turn a demo-era value, in
row 24's list, into the key the API trusts. On live the question does not arise, because its value
is generated and has been in no log. On the OTA stack it guards a demo.

## Not in this plan

- Mail that leaves the machine: 0133, on live. Mailpit keeps running on the OTA stack, where the
  gate's smoke needs it.
- Backups, and what a lost database costs a tester: 0134.
- The identity provider's registration, sign-in and console: 0135, on both instances.
- Refusing internal hosts, the Docker gateway included: 0136.
- Roles within a tenant: 0137. Tasks under row security: 0138. (The task environment store holds
  the owner role's URL, which is why T2's owner password matters there too.)
- Proofs on live: 0141. Alerts: 0142. The size of both stacks on one machine: 0143. Tags and
  releases: 0146.

## Open questions

1. **CI's push jobs.** D1 keeps CI on the machine, and D7 keeps it beside live on one Docker
   daemon. The runbook's first route, GitHub's hosted arm64 runners (free for public
   repositories), could move just the push jobs of `ci.yml` and `security-scan.yml` off the
   machine for the alpha's weeks. That would remove the path by which every merge runs at once
   next to a Docker socket that sits beside testers' credentials. The appliance's nightly, the
   managed gate on the OTA stack and the live-target lane would still run `main` on the machine
   on their schedules. Keep the push jobs on the machine, or move them?
2. **~~A now, B later?~~ Answered 2026-09-24 by D7: neither.** The gate keeps running, on the
   OTA stack, and testers are on live. The date that *"A few weeks"* (D6) means is 0131 T4's
   question now, not a trigger here. The question as it was asked: Is A (the gate off)
   acceptable for the alpha's weeks, with B (T8) when the alpha ends or grows? And what date does
   *"A few weeks"* (D6) mean, so that T8's trigger has one?
3. **T5's route.** Moot for live (D7). For the OTA stack it comes back when 0026 row 24's trigger
   fires. The question as it was asked: (a) a fresh application database and identity provider,
   or (b) in place? (a) is recommended, unless the owner's own migrations on this stack should be
   kept.
4. **A way back.** Should the owner dump live's application database before each deploy and keep
   the dump until the next one, so that a bad deploy can be undone? D5 says no backups and no
   obligations. This dump would be a rollback aid for the owner, not a promise to testers. 0134
   should say either way.
5. **Values that are not on 0020's list.** Moot for live, whose masterkey and client secrets are
   its own from the start (T1d, 0140). For the OTA stack, parked with row 24. The question as it
   was asked: 0020 does not name `ZITADEL_MASTERKEY` or the OAuth client secrets as leaked. If the
   owner knows that one of them appeared in a log, route (a) replaces the masterkey at no cost. In
   route (b), a new masterkey would strand every account in the identity provider. A client
   secret is replaced in the provider's own console.
6. **The outside probe's schedule.** Dispatch only (proposed), because a failing run in a public
   repository names the open port publicly? Or daily, with a result that says only pass or fail?
7. **The OTA names.** Once testers are on the production names, should `app.ota.ownpace.eu` and
   `id.ota.ownpace.eu` still answer from the internet, or only on the mesh? T3's probe needs the
   answer as its pass condition. Mesh-only is the smaller surface, and the owner already reaches
   the machine over the mesh (D2). Google's test client keeps working either way for the owner,
   because Google redirects the browser rather than fetching the callback (0091 T5).
