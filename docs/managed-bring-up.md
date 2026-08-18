# Managed edition: bringing it up on a new machine

The managed edition is a **multi-tenant service**: Postgres behind PgBouncer, a
self-hosted **Trigger.dev** instance that is the one execution plane, the API,
the web app, and the tasks in `apps/worker` deployed onto Trigger.dev. It has
been stood up by hand more than once, each time from notes that were slightly
out of date. This document is those notes, kept next to the script that
executes them.

- **The script:** [`deploy/compose/bootstrap-managed.sh`](../deploy/compose/bootstrap-managed.sh)
- **This document:** the same steps in prose, with every dashboard screen
  written out, what "it worked" looks like at each step, and a failure table.

Read the two together. The script refuses rather than guesses, and every
refusal it prints names the section here that explains it.

---

## The one thing that cannot be automated

The self-hosted Trigger.dev webapp signs you in by **magic link** and exposes
**no admin API**. Creating the account, the organisation and the project is a
human at a browser, and no version of this script removes that.

What the script does instead is make it the *only* human step:

| Step | Who |
| --- | --- |
| Generate every secret, pin the image architecture | script |
| Bring up Postgres, create the pooler's lookup role, bring up PgBouncer | script |
| Bring up the whole Trigger.dev plane and wait for health | script |
| **Find the magic link in the logs** | script (`trigger-magic-link.sh`) |
| **Open it, name an organisation, name a project** | **you** |
| Read the project ref and production key back out of the instance | script (`trigger-credentials.sh`) |
| Log the deploy CLI in (opens a browser) | you, one command |
| Build and start the API and web app | script |
| Upload the task runtime environment, deploy the tasks | script |
| Prove an enqueue becomes a runner on this machine | script (`smoke-managed.sh`) |

Two of those are yours. Everything else is one command.

---

## Before you start

**Host**

- Linux with **Docker** and **Docker Compose v2** (`docker compose version`).
- **Node 22+** and **pnpm** (the seed, the deploy CLI and the smoke run on the
  host, not in a container).
- `openssl`, `curl`, `git`.
- **~15 GB free disk.** ClickHouse, MinIO, the Trigger.dev images, the task
  registry and the built API/web images add up; running out midway leaves a
  stack that is partly built and wholly confusing.
- The repository cloned, and `pnpm install --frozen-lockfile` done.

**Architecture.** `DEPLOY_IMAGE_PLATFORM` decides what the task images are
built for, **server-side** — there is no CLI flag. Get it wrong and every task
run dies at `exec` in under a second with `AutoRemove` deleting the evidence.
`managed.env.example` ships `linux/amd64`, so on an **arm64 box the shipped
default is wrong**. The script fixes this for you from `uname -m`; it is
mentioned here because it is the single setting whose failure looks like
nothing at all.

**Ports** published on the host, all overridable in `.env`:

| Port | Service | Notes |
| --- | --- | --- |
| 3001 | API | `API_PORT` |
| 3123 | web | `WEB_PORT` |
| 5432 | Postgres | `POSTGRES_PORT` — the host-run seed and migrations need it |
| 3090 | Trigger.dev API (http) | `TRIGGER_PORT` — what the **deploy CLI** talks to |
| 3443 | Trigger.dev dashboard (https) | `TRIGGER_TLS_PORT` — what your **browser** talks to |
| 5000 | task image registry | `REGISTRY_PORT`, bound to loopback |
| 8083 | Nextcloud | demo backend only |

PgBouncer is deliberately **not** published: it is reached over the compose
network by name. That is why anything running on the host (the seed, the
migrations) connects to `postgres:5432`'s published port directly.

**Addressing the dashboard.** `TRIGGER_TLS_HOST=localhost` (the default) means
the dashboard is usable **only from the machine itself**. The dashboard's
session cookie is `Secure` in production mode, so plain http works from
localhost and nowhere else — which is why the `trigger-tls` service exists.
To reach it from your laptop, before the `trigger` phase set:

```bash
./deploy/compose/env-upsert.sh deploy/compose/.env \
  TRIGGER_TLS_HOST=10.0.0.5 \
  TRIGGER_APP_ORIGIN=https://10.0.0.5:3443 \
  TRIGGER_LOGIN_ORIGIN=https://10.0.0.5:3443
```

Leave `TRIGGER_API_ORIGIN=http://localhost:3090` alone. The deploy CLI follows
the server-advertised API origin and must not meet a self-signed certificate on
the way — when it did, deploys died with a bare `Connection error`.

---

## The short version

```bash
git clone … && cd open-migrate
pnpm install --frozen-lockfile

./deploy/compose/bootstrap-managed.sh          # creates .env, then stops
#   … read deploy/compose/.env and make the decisions in it …
./deploy/compose/bootstrap-managed.sh --from data
#   … create the organisation and project in the dashboard …
./deploy/compose/bootstrap-managed.sh --from account
#   … one `npx trigger.dev login` when it asks …
./deploy/compose/bootstrap-managed.sh --from login
```

Three stops on a brand-new machine, and the first of them goes away with
`--accept-defaults` on a throwaway demo box.

Add `--with-demo` on a demo box or a CI runner: it provisions the demo mail and
DAV backends, seeds two demo tenants, and runs the live smoke at the end. **A
real deployment must not use it** — it creates tenants with fixed credentials
that are published in this repository.

The script exits **2**, not 1, when it is waiting for you, and prints the exact
command to resume with. Re-running it from the top is always safe: every phase
checks whether it is already done.

---

## The long version, phase by phase

`./deploy/compose/bootstrap-managed.sh --list` prints them in order. Any phase
can be run alone with `--only <phase>`, or resumed from with `--from <phase>`.

### 1. `preflight` — the tools, and the one setting that cannot be fixed later

Checks Docker, Compose v2, Node, pnpm, `openssl`, `curl`, that the daemon is
reachable and that `node_modules` exists, and warns below 15 GB free.

**Verify:** it prints the versions it found. Nothing is started yet.

### 2. `env` — `deploy/compose/.env`

Creates `.env` from `managed.env.example` if it is missing (mode `600`), then
runs [`ensure-env-secrets.sh`](../deploy/compose/ensure-env-secrets.sh), which
generates every missing secret — `JWT_SECRET`, `SECRET_ENCRYPTION_KEY`, the
five Trigger.dev secrets, `PGBOUNCER_AUTH_PASSWORD` — and writes
`pgbouncer/userlist.txt`. It is idempotent: a value you already set is never
rotated. Then it pins `DEPLOY_IMAGE_PLATFORM` to this host's architecture.

**What it will not decide for you.** It *reports* these and moves on:

- `POSTGRES_PASSWORD`, `APP_DB_PASSWORD`, `CLICKHOUSE_PASSWORD`,
  `MINIO_ROOT_PASSWORD`, `NEXTCLOUD_ADMIN_PASSWORD` still at their shipped
  defaults. Fine for a demo box on localhost; not fine for anything a customer
  reaches. **Change them before the `data` phase** — changing
  `POSTGRES_PASSWORD` after the volume exists does not change the password
  inside it.
- `CORS_ORIGIN` / `WEB_URL` / `API_URL`. On a real deployment these are the
  public https addresses. `API_URL` is where **Mollie's servers** deliver
  payment webhooks: with `MOLLIE_API_KEY` set, the API refuses to boot in
  production on a localhost `API_URL`, because the alternative is payments
  that complete while invoices never leave `sent`.
- `PRICING_*` — integer **cents**, never euros. They are a template for *new*
  tenants; each tenant's agreed prices are pinned in `tenant.pricing` the first
  time their money is computed and never follow this file again.
- `SMTP_*` / `NOTIFY_*` — set them all or none. Half-set, the channel stays off
  and names what is missing.
- `OAUTH2_*` — only for a stack with a Microsoft Graph source or 0028's drift
  detector. An IMAP-only stack needs none of it.

Edit `.env` by hand, or use
[`env-upsert.sh`](../deploy/compose/env-upsert.sh), which replaces a key where
it already sits instead of appending a second copy of it:

```bash
./deploy/compose/env-upsert.sh deploy/compose/.env POSTGRES_PASSWORD=…
```

It refuses a value containing whitespace, a quote, `$`, a backtick or a
backslash. That is not fussiness: every consumer of this file reads it with
`set -a; . .env`, so such a value is re-interpreted by a shell, and compose's
own parser would disagree about what happened.

**It stops here the first time.** The file has just been created, so none of
those decisions has been made — and the next phase creates the Postgres volume,
after which changing `POSTGRES_PASSWORD` in this file changes nothing at all
while the stack looks configured and fails to authenticate. Read the file,
then resume with `--from data`. On a throwaway demo box where the shipped
values are the right answer, `--accept-defaults` removes the pause.

**Verify:** `grep -c '=.' deploy/compose/.env`, and that
`deploy/compose/pgbouncer/userlist.txt` exists.

**Never commit `.env`.**

### 3. `data` — Postgres, the pooler's lookup role, PgBouncer

```bash
docker compose -f deploy/compose/managed.yml up -d --wait postgres
PGOPTIONS="-c my.pw=$PGBOUNCER_AUTH_PASSWORD" \
  docker compose -f deploy/compose/managed.yml exec -T postgres \
  psql -U openmigrate -d openmigrate -f - < deploy/compose/pgbouncer/setup-auth.sql
docker compose -f deploy/compose/managed.yml up -d --wait pgbouncer
```

**The order is the whole point.** PgBouncer's healthcheck authenticates as
`pgbouncer_auth`, and that role is created by `setup-auth.sql`, which needs
Postgres up. Bring both up together on a fresh box and it hangs at the
healthcheck complaining about a password, when the cause is a role that does
not exist yet.

**Verify:**

```bash
docker compose -f deploy/compose/managed.yml exec -T pgbouncer \
  psql "postgresql://pgbouncer_auth:${PGBOUNCER_AUTH_PASSWORD}@127.0.0.1:6432/pgbouncer" -tAc "SHOW POOLS"
```

Anything back, containing `transaction`, is the pooler serving in the right
mode.

### 4. `demo` — the demo backends and the two demo tenants *(only with `--with-demo`)*

Runs [`setup-managed-demo.sh`](../deploy/compose/setup-managed-demo.sh) — real
Stalwart (IMAP source, JMAP target) and real Nextcloud (CalDAV/CardDAV/WebDAV)
— then the seed:

```bash
DATABASE_URL=postgresql://…@localhost:5432/openmigrate \
DIRECT_DATABASE_URL=… JWT_SECRET=… SECRET_ENCRYPTION_KEY=… \
  pnpm --filter @openmig/api seed:managed
```

Those exports matter. The seed runs **on the host** and inherits nothing;
nothing in `apps/api` loads a dotenv file. It also runs the migrations itself
(advisory-locked, so racing an API boot is safe), which is why the schema
exists before the API has ever started.

**Verify:** the seed prints two demo owner tokens. Re-running it is a no-op.

### 5. `trigger` — the Trigger.dev plane

Brings up `trigger-db`, `trigger-redis`, `clickhouse`, `minio`,
`trigger-registry`, `trigger-docker-proxy`, `trigger-api`, `trigger-tls`,
`trigger-supervisor` and waits for all of them to be **healthy**, not merely
started.

**Verify:** `curl -fsS http://localhost:3090 -o /dev/null && echo up`

### 6. `account` — **your turn**

If `.env` already has `TRIGGER_PROJECT_REF` and `TRIGGER_SECRET_KEY`, this
phase does nothing. If the project exists on the instance but `.env` is behind
(a re-clone, a rotated file), the script reads them back and carries on. Only
if the instance genuinely has no project does it stop, and then:

1. **Open the dashboard** — `TRIGGER_APP_ORIGIN` from `.env`, by default
   <https://localhost:3443>. It serves a **self-signed certificate**. Accept
   the browser warning; this is the `trigger-tls` front, and it exists because
   the dashboard's session cookie is `Secure` in production mode.

2. **Type the email address** the account should belong to and press
   **Continue**. No mail is sent — there is no mail server — so the sign-in
   link goes to the log instead.

3. **Fetch the link:**

   ```bash
   ./deploy/compose/trigger-magic-link.sh
   ```

   Open it **in the same browser**. Links are single-use and short-lived; if
   one is spent, ask the dashboard for another and run the command again — it
   always prints the newest. `--all` prints every link still in the log buffer.

   *If it finds nothing*, you have almost certainly not done step 2 yet: the
   link is only written when one is requested. That is not a broken stack.

4. **Name an organisation**, then **name a project**. Both are yours to choose
   and nothing in this repository depends on either. (Suggestion:
   organisation `Open Migrate`, project `open-migrate`.)

5. **Do not hand-copy anything.** Resume:

   ```bash
   ./deploy/compose/bootstrap-managed.sh --from account
   ```

   [`trigger-credentials.sh`](../deploy/compose/trigger-credentials.sh) reads
   the `proj_…` ref and the **production** `tr_prod_…` key straight out of the
   instance, checks the shape of both, writes them with `env-upsert.sh`, and
   restarts the API so it picks the key up.

   It introspects the Trigger.dev schema before querying it and **refuses**
   rather than guessing if the shape is not the one it knows — that schema
   belongs to Trigger.dev and can change under a version bump. Every refusal
   prints the two dashboard pages to read instead: **Project → Settings** for
   the ref, **Project → API keys → the PROD environment** for the key. A `dev`
   key is refused on purpose: it is personal to a CLI session and would not
   work from a container.

   If the instance holds several projects it will not choose for you —
   re-run it with `--project <name>`.

> The `tr_prod_` key is a credential. Treat this script's output like the
> `.env` it is destined for; do not paste a run of it into an issue.

### 7. `login` — the deploy CLI, once per machine

The CLI version is read from `@trigger.dev/sdk` in `apps/worker/package.json`,
so there is one version number and it lives where it already lived.

```bash
npx -y trigger.dev@<version> login -a http://localhost:3090 --profile openmig
```

The script prints the exact line with the version filled in and stops, because
the command opens a browser and waits for you. Note the address is the plain
**http api origin**, not the https front.

**Verify:** `npx -y trigger.dev@<version> whoami --profile openmig`

### 8. `app` — API and web

`docker compose up -d --build --wait`, with `GIT_SHA` passed so `GET /version`
reports a commit rather than `unknown`. The API runs the migrations at boot.

Without `--with-demo` the services are **named explicitly** rather than swept
up, so a bare `up` does not start Nextcloud — whose admin password is
`change-me-nextcloud-admin` by default.

**Verify:**

```bash
curl -fsS http://localhost:3001/health && curl -fsS http://localhost:3001/version
```

### 9. `tasks` — the task environment, then the deploy

```bash
./deploy/compose/set-task-env.sh
./deploy/compose/deploy-tasks.sh
```

**Environment before deploy, deliberately.** Task containers inherit
**nothing** from compose: a run gets only what the Trigger.dev platform stores
for the project's environment. `set-task-env.sh` uploads `DATABASE_URL`,
`APP_DATABASE_URL`, `DIRECT_DATABASE_URL`, `SECRET_ENCRYPTION_KEY` and the
optional `OAUTH2_*` / `SMTP_*` / `NOTIFY_*` from `.env`, with `override: true`
so a stale dashboard value cannot win over a rotated file. The addresses it
uploads are **in-network** (`pgbouncer:6432`, `postgres:5432`), because runners
join the compose network — `localhost` there would point a task at itself.

`deploy-tasks.sh` re-checks the architecture and refuses on a mismatch, then
deploys. **Re-run it after every `git pull` that touches `apps/worker`.**

**Verify:** the dashboard's Deployments page lists the tasks. That is
registration, not execution — see the next phase for the difference.

### 10. `smoke` — the only proof that counts

```bash
./deploy/compose/smoke-managed.sh
```

Mints a seeded-member token, runs a verify to a terminal state and an apply to
`applied` or `refused` (a refusal is a legitimate pass — the gates said no and
said why), and captures runner logs live, because `AutoRemove` destroys them at
exit.

Only runs with `--with-demo`: it drives the demo tenants. A green CI says
nothing about whether an enqueue becomes a runner container **on this machine**
— that lesson cost a whole bring-up session, and this is the step that answers
it.

> Runner debug logs print the **full task environment** — `DATABASE_URL`,
> `SECRET_ENCRYPTION_KEY`, the `tr_prod_` key. The smoke's evidence file is
> secret-bearing by construction. `deploy/compose/redact-evidence.sh` cleans it
> before anything is uploaded anywhere.

---

## When it goes wrong

| What you see | What it is | What to do |
| --- | --- | --- |
| `pgbouncer` logs `could not open auth_file … Permission denied`, then `no such user: pgbouncer_auth` | `userlist.txt` was written 0600 by the host user; PgBouncer reads it as a different user inside the container, finds no users, and rejects every login | `chmod 644 deploy/compose/pgbouncer/userlist.txt`, then force-recreate. `ensure-env-secrets.sh` now writes 644 and `--only data` repairs the mode |
| The seed or a host-run script talks to the wrong Postgres | On a shared host, `localhost:5432` may belong to something else entirely — this stack's Postgres is published wherever `POSTGRES_PORT` says | The `demo` phase asks `docker compose port postgres 5432` rather than trusting a default. For your own commands, do the same |
| A config fix to `pgbouncer.ini` seems to change nothing — same error after pulling | `pgbouncer.ini` is a bind mount read once at start-up, and `up -d` does not recreate a container whose spec has not changed, so the old process keeps running the old file | `docker compose -f deploy/compose/managed.yml up -d --force-recreate pgbouncer`. `--only data` now does this automatically when the container is unhealthy |
| `pgbouncer` log says `cannot use the reserved "pgbouncer" database as an auth_dbname` | `auth_user` set in the **global** `[pgbouncer]` section governs the admin console too, and the console's database name is reserved — so `auth_query` cannot run and every connection is refused. A per-database `auth_dbname` does not help: the console is not matched by `*` | Fixed by moving `auth_user` onto the `*` entry, where it applies to real databases only. `auth_dbname` there must equal `POSTGRES_DB`; `--only data` refuses if they disagree |
| `pgbouncer` reports `unhealthy` after ~80s, and its own log says the user is not allowed | The healthcheck reads `SHOW POOLS` from the admin console, which PgBouncer refuses to anyone not in `stats_users`/`admin_users` | Fixed in `pgbouncer/pgbouncer.ini` (`stats_users = pgbouncer_auth`). On an older checkout, pull and `--only data` |
| Any `docker compose` command fails with `required variable X is missing a value` | Compose interpolates the **whole** file before running anything, so one unset variable breaks every command — including ones that never touch the service named in the error. An `.env` that predates the pooler hits this on `PGBOUNCER_AUTH_PASSWORD` | `./deploy/compose/ensure-env-secrets.sh`, then `--only data` to create the matching Postgres role and start the pooler |
| `pgbouncer` never becomes healthy, complains about a password | `setup-auth.sql` has not run, or ran without `my.pw` set | `--only data`. The SQL now refuses an unset `my.pw` rather than creating a role with no password |
| Every app connection: `password authentication failed`, though `.env` and the container agree | A volume from a *different* project — compose's project name derived from the directory basename | `managed.yml` pins `name: open-migrate-managed`. Check `docker volume ls` for a stray `compose_postgres_data` |
| `trigger-magic-link.sh` finds nothing | The link is only written when one is **requested** | Submit your email on the dashboard's login page first, then re-run |
| Dashboard loads but the login never completes | `TRIGGER_APP_ORIGIN` / `TRIGGER_LOGIN_ORIGIN` do not match the address the browser is using; the `Secure` cookie is dropped | Set both (and `TRIGGER_TLS_HOST`) to the real address, then `--from trigger` |
| `npx trigger.dev deploy` dies with a bare `Connection error` | The CLI was pointed at the https front | Log in against `http://localhost:3090` |
| A secret in `.env` is a `change-me-…` value and was never generated | `ensure-env-secrets.sh` used to treat any non-empty value as set, so an `.env` copied from an older template kept its shipped placeholders for ever | Re-run `./deploy/compose/ensure-env-secrets.sh` — it now replaces placeholders and prints what to recreate afterwards |
| `--from trigger` refuses with "Trigger.dev version drift" | `TRIGGER_IMAGE_TAG` and `@trigger.dev/sdk` disagree (0018 T0). Unset, the tag falls back to `managed.yml`'s default, which is easy to miss | Set `TRIGGER_IMAGE_TAG` to `v<sdk version>`, or pin the SDK back. The refusal prints both commands |
| The deploy asks "Would you like to apply those updates?" mid-script | `apps/worker/package.json` pins one SDK version and `node_modules` holds another, so the CLI offers to reconcile them — and waits. In CI there is no terminal to answer from | `pnpm install --frozen-lockfile`, then re-run. `deploy-tasks.sh` now refuses up front rather than letting the deploy become interactive |
| The CLI sits at its version banner for tens of minutes | `npx`'s "Ok to proceed?" install prompt, invisible because output is discarded | Every script here uses `npx -y`; if you are running it by hand, do too |
| Task runs die instantly, no logs, runner container gone | `DEPLOY_IMAGE_PLATFORM` does not match the host | Fix it in `.env`, `up -d --force-recreate trigger-api` (it is read server-side), then `--from tasks` |
| Enqueues fail by name; runs land `failed` immediately | `TRIGGER_SECRET_KEY` unset or not a `tr_prod_` key | `--only account`, then `up -d api` |
| Tasks run but cannot reach the database | The task environment was never uploaded, or holds `localhost` | `./deploy/compose/set-task-env.sh`. Values are read at run start; no redeploy needed |
| `trigger-credentials.sh` says the schema is not the one it knows | A Trigger.dev version bump renamed a column | Read the two values from the dashboard by hand; the refusal names both pages |
| Seed fails on `DATABASE_URL … is required` | It is running on the host and inherits nothing | Use the `demo` phase, which exports them from `.env` |

---

## Redoing a rollout somewhere else

The whole configuration is `deploy/compose/.env` plus the two human steps.
On a new machine:

```bash
git clone … && cd open-migrate && pnpm install --frozen-lockfile
./deploy/compose/bootstrap-managed.sh
```

Do **not** copy an old `.env` across wholesale. Copy the *decisions* — prices,
SMTP, OAuth, the public URLs — and let `ensure-env-secrets.sh` mint fresh
secrets. A secret that exists on two machines is a secret that gets rotated on
neither. `TRIGGER_PROJECT_REF` and `TRIGGER_SECRET_KEY` in particular belong to
the *old* instance and are meaningless on the new one; the script will read the
new instance's own.

**Upgrading Trigger.dev** is one number in two places that must agree:
`TRIGGER_IMAGE_TAG` in `.env` and `@trigger.dev/sdk` in
`apps/worker/package.json`. Check both when bumping either. Then
`--from trigger`.

**Rotating a secret**: change it in `.env`, `docker compose up -d` the affected
services, re-run `set-task-env.sh` if a task variable changed, and re-mint any
JWTs signed with a rotated `JWT_SECRET`. Rotating `SECRET_ENCRYPTION_KEY`
**strands stored connection credentials** — they have to be re-entered.

**Turning the pooler off** is two values: `DB_HOST=postgres`, `DB_PORT=5432`,
then `up -d`. Every service reads them, so nothing in `managed.yml` is edited.

---

## What this does not cover

- **TLS and a public hostname for the API and web app.** Everything above is
  addressed by IP or `localhost`. A real deployment needs a reverse proxy with
  real certificates in front of ports 3001 and 3123, and `CORS_ORIGIN` /
  `WEB_URL` / `API_URL` set to those addresses.
- **Backups.** Nothing here backs up the Postgres volume.
- **The Trigger.dev instance's own upgrade path** between major versions.
- **Bring-up from scratch, tested.** The nightly
  [`e2e-managed.yml`](../.github/workflows/e2e-managed.yml) runs this script
  from the `data` phase against a stack whose Trigger.dev half already exists,
  because tearing that half down would need a person to rebuild it. So the
  phases up to `trigger` are exercised by that gate; `account` and `login` are
  exercised only by somebody doing this on a new machine. If you are that
  person and something here is wrong, fix this document in the same change.

## See also

- [`deployment.md`](./deployment.md) — the editions and what each one is for
- [`operator-runbook.md`](./operator-runbook.md) — running it once it is up
- [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md) — symptoms across both editions
- [`rls-guide.md`](./rls-guide.md) — why the app connects as `app_user`
- [`performance.md`](./performance.md) — the pooler, the rate budget, the tick
