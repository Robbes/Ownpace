# Workplan 0132 — The alpha and the nightly gate on one box

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

| Task | Status | Notes |
|---|---|---|
| T0 The steps on the reference machine, before the first invitation | ⏳ **Owner** | §3. In order: the gate off, the demo era out, the passwords changed, the checks run, the first deploy. The outcome is written in this block. |
| T1 The nightly gate stops deploying to the alpha | 📋 **Proposed** (D1, D6) | §3. Option A for the alpha: the gate is switched off and refuses a stack people use, and the alpha is deployed by hand from a named commit (T6). Option C, leaving it as it is, is not safe. |
| T2 Database passwords the repository does not contain | 📋 **Decided 2026-09-24** (D2, D3) on the machine; the code 📋 **Proposed** | §3. `ALTER ROLE`, because `.env` does not reach a role that already exists. The bring-up sets the roles from `.env`, and refuses shipped values on a real address. |
| T3 "Not reachable from the internet", checked | 📋 **Proposed** (D2, D4) | §3. A loopback default for the eight ports published on all interfaces (seven in `managed.yml`, the site's one), a check on the machine after every deploy, a probe from outside, and the path a tester's request takes, written down. |
| T4 A stack that does not say it is production does not start | 📋 **Proposed** | §3. `managed.yml`'s `development` default becomes a required value. |
| T5 No demo in the alpha, and the values that left the machine replaced | 📋 **Proposed** (D4) | §3 and §4. Fires 0026 row 24's trigger. `SECRET_ENCRYPTION_KEY` is replaced before the first tester connects, or not during the alpha. |
| T6 One way to deploy the alpha | 📋 **Proposed** (D1, D5) | §3. Hold, drain, a named commit, bring-up without the demo, checks, lift. Replaces three procedures that disagree. |
| T7 What rode on the gate keeps running | 📋 **Proposed**, with T1 | §3. The identity provider's provisioning token, the Trigger.dev database drill, T3's check and 0135's organisation count, on a timer on the machine. |
| T8 The gate gets a stack of its own on the same machine | 🅿️ **Parked (trigger: the alpha runs past its few weeks, or a change has to be proven on a managed stack before testers get it)** | §3, option B. |

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
The gate is scheduled for 03:30 UTC, and GitHub has started it hours late.

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
   the stack testers would use. Whether the live file holds any of these cannot be seen from here;
   T5 looks.
2. It runs `bootstrap-managed.sh --from data --with-demo --no-smoke`:
   - The `demo` phase starts the demo Stalwart and Nextcloud and seeds the two demo tenants. They
     have fixed ids, and their credentials are in this repository. The bring-up says of
     `--with-demo`: *"A real deployment must not use it"*.
   - The `trigger` phase brings Trigger.dev up at the checkout's tag.
   - The `app` phase runs `setup-zitadel.sh` against the live identity provider. It then runs
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
says.

**The repository's own rule.** The runbook says *"before the first non-demo tenant is onboarded,
CI and production must not share this machine"* (*This box also runs CI*), and
`docs/release.md` carries the same checklist item. A tester is a non-demo tenant. SECURITY.md says
of the runner: *"trusted workflows only (docker socket + root = RCE risk)"*. Pull requests run
on GitHub-hosted runners, and a push to `main` runs `ci.yml`'s jobs and `security-scan.yml`'s on
the self-hosted one. `ci.yml` does not reference `managed.yml`. `e2e.yml` brings up the
appliance's stack, whose own port defaults to loopback (`SELFHOST_BIND`). The dev Stalwart and
Nextcloud it starts beside the appliance are published on every interface, on free ports it
picks, until its cleanup step removes them.

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
rules. The bring-up's ports table at this checkout has seven rows and leaves out the identity
provider, the status page and Mailpit. The missing rows, and a note that `/metrics` must stay off
any public interface, are drafted in the pending consistency PR.

**Passwords the repository knows.**

- `packages/ledger/migrations/0001_baseline.sql` creates `app_user` with
  `PASSWORD 'app_password'` if the role does not exist. Nothing in `deploy/`, `scripts/` or
  `packages/` runs `ALTER ROLE app_user`. The runbook says to do it by hand: *"rotate it in the
  DB (`ALTER ROLE app_user PASSWORD …`) to match"*. Changing `APP_DB_PASSWORD` in `.env` changes
  what the API presents. It does not change what the role accepts.
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
`NODE_ENV` is not one of them. So a `.env` without it runs in development. What the live API has
cannot be seen from here; T0 asks it.

**Values that left the machine.** 0020 records that the stack's generated values (*"DB password,
`SECRET_ENCRYPTION_KEY`, `tr_prod_` key"*) *"have appeared in pasted logs"*. It also records that
runner debug output prints the whole task environment. This plan could not check which logs those
were, or whether any reached a public job log. 0026 row 24 keeps the rotation parked until the
stack stops being a demo, and records the procedure as *"re-running `ensure-env-secrets.sh`"*.
That procedure rotates nothing: the script fills a blank and replaces a shipped placeholder, and
its own header says *"values already set in .env are never touched, so re-running it never
rotates anything"*. Two more facts decide when to replace what:

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
- The architecture document and `docs/deployment.md` promise a staged or canary rollout with a
  backup before migrating. Neither exists. A correction to `docs/deployment.md` is drafted in the
  pending consistency PR; the architecture document's sentence is not touched there.

A managed deploy is a source build of whatever is checked out. `migrate.ts` refuses a build that
is older than the schema, so without a dump there is no way back.

**What rides on the gate.** Two duties run only because the gate runs. The first is the identity
provider's provisioning token. It lives `ZITADEL_PAT_LIFETIME_DAYS` (7) days, and `setup-zitadel.sh`
replaces it during the last `ZITADEL_PAT_ROTATE_BELOW_DAYS` (3). If a token expires without a
replacement, someone has to mint one by hand in the console (the bring-up's failure table). The
second is `trigger-version.sh drill`, which has no other schedule.

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
  the runbook's rule, and this plan records the conditions.
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
  answers the question in it.
- **D5, backups and obligations.** Asked how much may be lost, how fast it must come back, and
  where backups are kept: *"None during the test"*. Asked about the blocker that nothing backs up
  the application database: *"No obligations during controlled test"*. 0134 carries this. Here it
  means a deploy has no way back unless the owner adds one (T6, open question 4).
- **D6, the size and length of the alpha.** Asked whether it is free or paid, how many people, for
  how long and in which language: *"Free and invite only. 10 to 20 people max. Dutch."* On the
  test posture: *"Free. A few weeks. No obligations both sides."* The owner also asked that the
  test be called an alpha.

## 3. What each task does

### T0 — on the reference machine, before the first invitation (owner)

Do these in order, because each step assumes the one before.

1. **Switch the gate off (T1).** In GitHub: *Actions → E2E (managed) → Disable workflow*, or
   `gh workflow disable "E2E (managed)"`. From then on nothing replaces the provisioning token.
   Until T7's timer exists, run `./deploy/compose/setup-zitadel.sh` from `~/ownpace-managed` at
   least every three days. It replaces the token only when fewer than three of its seven days
   remain, so a gap of four days can miss that window.
2. **Take the demo era out (T5)**, by route (a) or (b) (open question 3).
3. **Change the passwords (T2)**, with the steps given there.
4. **Run the checks.**
   - `docker exec ownpace-api printenv NODE_ENV` prints `production` (T4).
   - `curl -s https://app.ota.ownpace.eu/api/auth/mode` answers `managed`.
   - `./deploy/compose/operator.sh list` names the owner and nobody else.
   - The exposure check and the outside probe pass (T3). Until T3 is built, the owner tries the
     seven ports, the site's 3125 and the demo's two from a machine that is not on the mesh or the
     private network.
5. **Deploy for the first time**, by T6's procedure.
6. **Write it down in this block:** the date of each step, the commit deployed, which route T5
   took, and the outcome of each check. Never a value.

### T1 — the gate and the alpha on one box

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

The recommendation is A now, and B (T8) when the alpha ends or grows. This answers 0131's open
question 2.

### T2 — database passwords the repository does not contain

D3 decides the change. The steps are T0's third step, and the code stops the change from being
undone later.

**On the machine**, under the hold (T6), from `~/ownpace-managed`:

1. Look at the database, not at `.env`:

   ```bash
   docker exec ownpace-db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc \
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
   network address), so a check through `docker exec psql` cannot fail. The first line is the
   control: if it does not open, the rest tells you nothing. The password travels in `PGPASSWORD`,
   passed through by name, so it is not on the `docker run` command line.

   ```bash
   set -a; . deploy/compose/.env; set +a
   ask() { PGPASSWORD="$2" docker run --rm -e PGPASSWORD --network ownpace-managed_ownpace-network \
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
     docker exec -i ownpace-db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1'
   printf "ALTER ROLE \"%s\" PASSWORD '%s';\n" "<owner-role>" "$POSTGRES_PASSWORD" |
     docker exec -i ownpace-db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1'
   ```

5. Sort out the names. Keep `app_user` as the application role's name. The migrations grant to
   that name, and the name protects nothing; the password does. If `APP_DB_USER` names another
   role, set it back to `app_user` and give the other role `NOLOGIN`. If the owner role was
   renamed, the old one must not keep `LOGIN` with a known password. Run
   `ALTER ROLE openmigrate NOLOGIN`, and never `DROP` it, because it owns the schema. If a second
   name for the application role is wanted anyway, the shape is `GRANT app_user TO <name>` plus
   `ALTER ROLE app_user NOLOGIN`, but no test in this repository exercises it.
6. Make everything that presents these values pick them up.
   `./deploy/compose/bootstrap-managed.sh --from data`, without `--with-demo`, recreates the
   containers whose environment changed: Postgres's (the volume stays), the API's and the identity
   provider's, which uses the owner role for its admin connection. It re-uploads the tasks'
   `DATABASE_URL` and `APP_DATABASE_URL`, and redeploys the tasks. T6 does this anyway.
7. Run step 2 again. The control opens and the three shipped pairs are refused. Write it in T0 as
   "refused", with the date.

**ClickHouse and MinIO.** Generate `CLICKHOUSE_PASSWORD` and `MINIO_ROOT_PASSWORD` the same way,
then run `docker compose -f deploy/compose/managed.yml up -d clickhouse minio trigger-api`.
`trigger-api` reads both pairs. The ClickHouse healthcheck logs in with the configured password,
so a container that did not take the new one shows as unhealthy. MinIO keeps the packets store.
If MinIO refuses the new pair on its old volume, the bring-up already says what the store costs to
lose: historical large run payloads, not deployments. `trigger-db`'s literal password waits for
the code below. T5's reset gives it a new volume, and a new volume is where a new password costs
nothing.

**The code (proposed).**

- **The `data` phase makes both roles match `.env` on every run.** It creates `app_user` from
  `APP_DB_PASSWORD` before the first migration can, since 0001 creates the role only when it does
  not exist. If the role exists, the phase sets its password, and it sets the owner role's
  password the same way. It connects over the socket, as the owner, and passes each value as a
  session setting, the way `setup-auth.sql` already receives `pgbouncer_auth`'s (`PGOPTIONS`), so
  the value is never part of the SQL text. Today that setting reaches `docker compose exec` as an
  argument (`-e PGOPTIONS="-c my.pw=…"`); the new code passes it by name from the environment, so
  it is on no command line either.
- **`load_env` refuses shipped values on a real address.** Every phase from `data` on passes
  through `load_env`, including the gate's `--from data`. A real address means `WEB_URL` is
  `https` and not localhost, the same test `note_mail_goes_nowhere_real` uses. On such an address, the phase
  refuses if `POSTGRES_PASSWORD`, `APP_DB_PASSWORD`, `CLICKHOUSE_PASSWORD`, `MINIO_ROOT_PASSWORD`
  or `TRIGGER_DB_PASSWORD` is empty (compose's default then applies), a `change-me…` value, or
  one of compose's defaults. On localhost it keeps today's note. A developer's own stack (D4) is
  where the shipped values are right, as `--accept-defaults` already says.
- **`ensure-env-secrets.sh` generates the five when they are absent.** The example ships them
  empty, as it already does `ZITADEL_ADMIN_PASSWORD`; today it ships `change-me-…` values and
  `APP_DB_PASSWORD=app_password`. If a stack whose volume already exists has a placeholder, the
  script refuses and points to these steps, the way it handles `TRIGGER_ENCRYPTION_KEY`, because
  Postgres keeps the password it was initialised with.
- **`trigger-db`'s password becomes `TRIGGER_DB_PASSWORD`**, and it is required.
- **The docs agree.** The bring-up's phase-2 advice and the runbook's section on the two roles
  say the same thing. The bring-up's sentence that a changed `APP_DB_PASSWORD` must also reach
  the role is drafted in the pending consistency PR; the rest follows the code.
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
on the mesh (D4), so the alpha's two names, and the site's, must answer from the internet and
nothing else may. This task has three parts, and one fact to write down.

**Binds with a loopback default.** Each of the seven ports gets a bind variable with a loopback
default, the shape `MAILPIT_BIND` and `NEXTCLOUD_BIND` already have: `POSTGRES_BIND`,
`API_BIND`, `TRIGGER_BIND`, `TRIGGER_TLS_BIND`, `ZITADEL_BIND`, `WEB_BIND` and `STATUS_BIND`.
`www.yml`'s port gets `WWW_BIND`.

- **Most ports need nothing more.** Nothing on the machine needs Postgres, the API or the
  Trigger.dev API from anywhere but the machine itself. The host scripts connect to Postgres's
  published port on localhost. The deploy CLI talks to `localhost:3090`. The web app reaches the
  API over the compose network. If the owner opens the Trigger.dev dashboard or the status page
  from a laptop over the mesh, `TRIGGER_TLS_BIND` or `STATUS_BIND` is set to the machine's mesh
  address in `.env`, as `MAILPIT_BIND` already allows.
- **Three ports need an extra publish.** The front that serves the names needs the web app's
  port, the identity provider's port and the site's port, from wherever it connects. The bring-up
  still reaches the identity provider on localhost (`wait_for_idp_ready`), so each of the three
  keeps its loopback publish and gets an optional second one, on the front's address. That address is set in `.env` on the reference
  machine and stays there; the address guard (`an-address-that-was-not-an-example`) keeps mesh
  addresses out of the repository. It has to be set before the change is deployed there, or the
  names stop answering.
- **The demo.** `setup-stalwart.sh`'s `-p` gets the same loopback default.
- **The guard.** `scripts/a-port-published-on-purpose.unit.test.ts` checks that every `ports:`
  entry in `managed.yml` and `www.yml` publishes through a bind variable with a loopback default,
  and that none defaults to all interfaces. It fails today on eight entries.

**A check on the machine.** `deploy/compose/exposure-check.sh` reads `docker ps` for every
container on the host, not only this project's. It fails for each port published on all
interfaces, or on an address not listed in `EXPOSURE_ALLOW` in `.env`, and it names the container
and the port. T6 runs it after every deploy and T7 runs it daily, outside the appliance
nightly's hours: that run's dev Stalwart and Nextcloud publish on every interface while it lasts
(§1), and would fail the check. The guard, `scripts/exposure-check.unit.test.ts`, feeds it
recorded `docker ps` lines. An all-interfaces
Postgres must fail, naming `ownpace-db`. Loopback and allowed binds must pass. The output must
carry names and ports, never an address.

**A probe from outside.** `.github/workflows/exposure-probe.yml` runs on a GitHub-hosted runner,
which sits on the internet and is on neither the mesh nor the private network.

- **What it tries.** It resolves `app.ota.ownpace.eu`, `id.ota.ownpace.eu` and
  `www.ota.ownpace.eu`. It then tries every port `managed.yml` and `www.yml` publish, plus the
  demo's two, on the addresses those names resolve to. It also tries them on the machine's own
  public address, if the owner stores that address as a repository secret.
- **When it passes.** Port 443 on the three names answers over TLS, and nothing else answers. The
  probe also checks whether `app.ownpace.eu` serves the alpha; 0091 T4 says the wildcard currently
  makes that possible. 0135 asks that it also fetch the identity provider's organisation
  registration page, which answers 404 once 0135 T1 is in place.
- **Its port list** is derived from `managed.yml`, `www.yml` and `setup-managed-demo.sh`, never
  typed by hand.
- **Dispatch only, not scheduled.** A public repository's job logs are public, and a failing probe
  names an open port. So it runs when the owner is there to act on the result (open question 6).
- **The guard.** `scripts/a-probe-that-knows-every-port.unit.test.ts` fails when `managed.yml` or
  `www.yml` publishes a port the probe does not try. It fails today because the probe does not
  exist.

**The path, written down.** 0131 records that the review's DNS lookup found the OTA names
resolving to the mesh provider's hosted ingress. `docs/google-oauth-verification.md`, however,
still says *"Anyone not on the mesh gets a timeout"*. The probe settles which is true. This plan
then records the path of a tester's request (the ingress, the web image's nginx, the API) and what
follows from it. The nginx appends to `X-Forwarded-For` (`$proxy_add_x_forwarded_for`). So
`TRUST_PROXY` (0093 T2c, 0131; handing it to the API is drafted in the pending consistency PR)
can only be a hop count if the ingress replaces a client's own `X-Forwarded-For` rather than
passing it on. One request with a forged header, read back in the
access log, answers the question. The sentence in the Google verification document is then
corrected to match.

### T4 — a stack that does not say it is production does not start

- **The change.** The API's entry in `managed.yml` gets `NODE_ENV: ${NODE_ENV:?…}`, with a message
  that names the fix.
  `managed-env-contract.unit.test.ts` then requires the example to carry a value; it carries
  `production`. Under B, the gate's backfill adds it on its next run.
- **The gate.** A gate run with production on is what testers get, and the smoke uses neither the
  Mollie test route nor `NODE_ENV`. One dispatched run should confirm this before the change
  reaches a stack.
- **The refusal.** T2's `load_env` refusal also refuses any `NODE_ENV` other than `production` on
  a real address.
- **The task containers.** Whether they see `production` is up to Trigger.dev.
  `set-task-env.sh` does not upload `NODE_ENV`, and this plan did not verify what the runner image
  sets.
- **The guard.** `scripts/a-stack-that-says-it-is-production.unit.test.ts` checks that no service
  in `managed.yml` defaults `NODE_ENV` to `development`. It fails today on the API.

### T5 — no demo in the alpha, and the values that left the machine replaced

0026 row 24 fires *"when that stack stops being a demo"*, and the alpha is that moment. The
procedure the row records does not rotate anything (§1), so this is the procedure. There are two
routes, and the owner chooses (open question 3).

**(a) A fresh application database.** *Recommended, unless the owner's own migrations on this
stack should survive.*

Before the first tester, the stack holds nothing but the owner's own organisation, the demo and
the gate's residue (D2: no other organisations). Starting empty makes "nothing left from the demo
era" true by construction, not by checklist. It also lets `POSTGRES_USER` and `POSTGRES_PASSWORD`
take effect the way they are meant to, at first initialisation. From `~/ownpace-managed`, with the
gate off:

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
   and writes nothing: that is the shape of the gate's small durable set. With the gate off, the
   file can be completed from `managed.env.example` in place, as the refusal itself says, and the
   phase run again.
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
  opens nothing after the reset. T8 mints the gate's own.
- **Check the operators.** `./deploy/compose/operator.sh list` names the owner and nobody else.
- **Replace `SECRET_ENCRYPTION_KEY` before the first tester connects, or not during the alpha.**
  After that point, a new key costs every tester a reconnect of every source and target. The only
  reason to pay that is a key that has leaked (§4).

**The code that keeps the demo out.** `bootstrap-managed.sh` refuses `--with-demo` when `WEB_URL`
is a real address. That turns the bring-up's sentence *"A real deployment must not use it"* into a
refusal. The guard is `scripts/a-demo-on-a-real-address.unit.test.ts`, and it fails today because
the flag is accepted everywhere.

### T6 — one way to deploy the alpha

This procedure replaces the three for the managed edition. The bring-up's *Updating a running
deployment* becomes this procedure. The runbook's *Upgrade* points to it and stops promising a
gated migration step. The architecture document and `docs/deployment.md` mark staged rollout and
a backup before migrating as not built (`docs/deployment.md`'s half is drafted in the pending
consistency PR).

1. Name the commit: a commit on `main` with CI green. For the first deploy, a commit the gate ran
   green before it was switched off (T1). Record its hash.
2. Start the hold, with a sentence in Dutch (D6). Testers read it word for word.
3. Wait for the drain. The tick's log says `N pass(es) still in flight`; wait until N is 0.
4. If the owner wants a way back, dump the application database now, and keep the dump until the
   next deploy (open question 4). The runbook's *Backup & restore* recipe dumps it; the lines
   that also dump the identity provider's database and the roles are drafted in the pending
   consistency PR. Without a dump, a deploy only goes forward, because `migrate.ts` refuses to run
   the previous build against a migrated schema.
5. In `~/ownpace-managed`, run `git fetch origin && git checkout --detach <commit>`. Not
   `git pull`: the alpha runs the commit that was named.
6. Run `./deploy/compose/bootstrap-managed.sh --from data`, without `--with-demo`. It checks the
   pooler and brings Trigger.dev up at the commit's tag. It runs `setup-zitadel.sh`, which also
   replaces the provisioning token when that is due. It builds the API and web app with
   `GIT_SHA`, uploads the task environment and deploys the tasks. Without the demo the smoke is
   skipped, so step 7 stands in for it.
7. Run the checks.
   - `https://app.ota.ownpace.eu/api/version` names the commit.
   - `/api/ready` answers 200.
   - `/api/auth/mode` answers `managed`.
   - T3's exposure check and T4's `NODE_ENV` check pass.
8. Lift the hold. The tick's next summary shows passes started, and one of the owner's own
   migrations completes a pass on the new tasks.
9. Record the date, the commit and the outcome in the deploy log (below).

**The code (proposed).**

- **A deploy script.** `deploy/compose/deploy-alpha.sh <commit>` runs steps 3 and 5 to 7, and
  appends step 9 to `~/.persistent/ownpace-managed/deploys.log`.
  - It refuses when no hold is open, when passes are still in flight, when the working tree is not
    clean, and when it is given `--with-demo`.
  - It reads `platform_pause` the way `operator.sh` reaches the database. If it composes an owner
    URL, it has to be listed in `docs/rls-guide.md` §2, which
    `a-connection-the-docs-did-not-know-about` enforces.
  - Its guard, `scripts/a-deploy-the-alpha-can-name.unit.test.ts`, drives each refusal with
    stubbed `docker`, `git` and `curl`. It fails without the script.
- **The hold covers every enqueue.** While a hold is open, the eight enqueue sites in the API
  answer 409 with the hold's sentence. They all go through one function, so a tester who presses
  *Sync now* during a deploy cannot start a pass after the drain count has already reached 0. The
  guard, `apps/api/src/a-hold-that-holds-every-door.unit.test.ts`, sweeps `apps/api/src` and
  fails on any `tasks.trigger(` call that does not go through that function. It fails today on
  all eight.

### T7 — what rode on the gate keeps running

A script, `deploy/compose/box-duties.sh`, runs daily from `~/ownpace-managed` on a systemd timer on
the machine. The unit files and install steps go in the bring-up. It does four things:

- **Keeps the provisioning token alive.** It runs `setup-zitadel.sh --token-only`, a new mode that
  runs the token's clock and nothing else. The full script also reconciles the identity
  provider's configuration, and a daily timer should not do that behind the owner's back, because
  0135 hardens that configuration. The token lives seven days and is replaced during its last
  three, so a daily run has days to spare.
- **Runs `trigger-version.sh drill`**, as the gate runs it, for as long as 0134 keeps it. It dumps
  the orchestration plane's own database (its account, project and API keys, deployments, run
  records and the encrypted task environment), not the application database. Its dumps stay under
  `trigger-backups` and are secret-bearing, as T5 says.
- **Runs T3's exposure check**, outside the appliance nightly's hours (T3).
- **Counts the identity provider's organisations**, the read-only count 0135 T3 describes, which
  counts on these duties to run it daily. It writes nothing, and a count above one fails the
  duty.

The script exits non-zero and names the duty that failed, and it writes to the journal. Nobody is
told when it fails; that is outside this plan.

The guard, `scripts/a-duty-the-gate-used-to-do.unit.test.ts`, checks that every step of
`e2e-managed.yml` that maintains the stack rather than testing it is also in `box-duties.sh`.
Today those steps are `setup-zitadel.sh` and `trigger-version.sh drill`. It fails today because
the script does not exist. Until it lands, T0's first step says how to keep the token alive by
hand.

### T8 — the gate gets a stack of its own (option B, parked)

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

- Testers sign in with their own account at `id.ota.ownpace.eu`. They never see a database
  password, a Trigger.dev key or the encryption key.
- Developers bring up their own stack, where the shipped values are the right ones.
  `--accept-defaults` exists for exactly that.
- Nobody joins the mesh (D4).

0131 §4 gives the short version. This is the long one, value by value.

A secret protects something only while nobody else knows it. Replacing one is not about who will
be given it. It is about who already has it. On this stack, three kinds of values are already known
beyond the machine:

1. **Values this repository publishes.** These include `app_password` (from the baseline
   migration), compose's defaults `openmigrate_password`, `password` and `very-safe-password`, and
   `trigger-db`'s literal `trigger_password`. They also include the example's `change-me-…` values, the demo tenants'
   credentials and the demo mail server's passwords. Anyone who reads the repository has them.
2. **Generated values that left in logs.** 0020 lists a database password,
   `SECRET_ENCRYPTION_KEY` and the `tr_prod_` key. Runner debug output also prints the whole task
   environment.
3. **Copies held by code, not by people.** The persisted `.env` sits on a machine where every push
   to `main` runs a job with access to the Docker socket (SECURITY.md), and where the nightlies run
   `main` on their schedules. That is not a person
   holding a credential. It is a path by which a merged change, or a dependency the change pulls
   in, could read one. The owner's merge is the gate for that path (0131 §4), and it is the reason
   for open question 1.

**Who could use these values today?** Only something that can reach the service that checks them.
By D2 the published ports cannot be reached from the internet. So the database password works in
only two places:

- from the private network and the mesh, which belong to the owner;
- from inside the machine's compose network, where every service of the stack shares one network.

The alpha changes the second. From the first invitation on, strangers type host names into the
product, and the API and the tasks connect to those hosts from inside that network (0136). A
request the service can be made to send to `postgres`, `trigger-db`, `clickhouse` or `minio`
meets a password from this repository.

Here is one example, reasoned but not demonstrated here. ClickHouse's HTTP interface accepts the
user and password in the URL and runs the query the request carries. With the password
`password`, one GET that the service is tricked into sending becomes a query. 0136 decides how the
service refuses such hosts. T2 makes the second lock a real one.

What each replacement buys, and what it costs:

| Value | What it protects | When to replace it | Cost |
|---|---|---|---|
| `APP_DB_PASSWORD`, and the owner role's password | Every tenant's rows. Row security keys on a setting the session sets itself, and the owner role bypasses it. | Before the first invitation (T2) | A redeploy under the hold |
| `CLICKHOUSE_PASSWORD`, `MINIO_ROOT_PASSWORD`, `trigger-db`'s password | Trigger.dev's event store, its large payloads and its database | With T5's reset | Nothing worth naming before the alpha |
| `SECRET_ENCRYPTION_KEY` | Every stored mailbox and drive credential that a tester enters | Before the first tester connects, or not during the alpha | Before: the owner re-enters their own. After: every tester reconnects every source and target. |
| `TRIGGER_ENCRYPTION_KEY` | The task environment store, which holds both database URLs and `SECRET_ENCRYPTION_KEY` | With the reset | The one human step on the dashboard |
| The other four Trigger.dev secrets, and the `tr_prod_` key | The dashboard's sessions and sign-in, the supervisor's link and task deploys | With the reset | A new CLI login |
| `JWT_SECRET` | Nothing while `JWT_ISSUER` is set. If `JWT_ISSUER` is ever emptied, the API accepts tokens signed with this value instead. | Now, because it is cheap | An API restart |

The last row is why the answer is still "replace it", even though the value is unused today. An
edit to `.env` that empties `JWT_ISSUER` would otherwise turn a demo-era value, in row 24's list,
into the key the API trusts.

## Not in this plan

- Mail that leaves the machine: 0133. Mailpit keeps running until then. The smoke needs Mailpit
  only on the gate's own stack (T8).
- Backups, and what a lost database costs a tester: 0134.
- The identity provider's registration, sign-in and console: 0135.
- Refusing internal hosts: 0136.
- Roles within a tenant: 0137. Tasks under row security: 0138. (The task environment store holds
  the owner role's URL, which is why T2's owner password matters there too.)

## Open questions

1. **CI's push jobs.** D1 keeps CI on the machine. The runbook's first route, GitHub's hosted
   arm64 runners (free for public repositories), could move just the push jobs of `ci.yml` and
   `security-scan.yml` off the machine for the alpha's weeks. That would remove the path by which
   every merge runs at once next to a Docker socket that sits beside testers' credentials. The
   appliance's nightly and the live-target lane would still run `main` on the machine on their
   schedules. Keep the push jobs on the machine, or move them?
2. **A now, B later?** Is A (the gate off) acceptable for the alpha's weeks, with B (T8) when the
   alpha ends or grows? And what date does *"A few weeks"* (D6) mean, so that T8's trigger has
   one?
3. **T5's route.** (a) a fresh application database and identity provider, or (b) in place?
   (a) is recommended, unless the owner's own migrations on this stack should be kept.
4. **A way back.** Should the owner dump the application database before each deploy and keep the
   dump until the next one, so that a bad deploy can be undone? D5 says no backups and no
   obligations. This dump would be a rollback aid for the owner, not a promise to testers. 0134
   should say either way.
5. **Values that are not on 0020's list.** 0020 does not name `ZITADEL_MASTERKEY` or the OAuth
   client secrets as leaked. If the owner knows that one of them appeared in a log, route (a)
   replaces the masterkey at no cost. In route (b), a new masterkey would strand every account in
   the identity provider. A client secret is replaced in the provider's own console.
6. **The outside probe's schedule.** Dispatch only (proposed), because a failing run in a public
   repository names the open port publicly? Or daily, with a result that says only pass or fail?
