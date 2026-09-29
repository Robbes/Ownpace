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

## Cutting over from the pre-rename stack (one time, ADR-0040)

The product was renamed, and with it the compose project, container, network and
volume names (`open-migrate-*` → `ownpace-*`). **Docker does not follow a rename.**
Bringing the new stack up next to an old one gives you a second, empty set of
volumes while the old data sits there dangling — the stack looks freshly broken
rather than un-migrated, which is the confusing failure this section exists to
prevent.

Deleting the checkout is **not** what does it: the state lives in Docker, not in
the working tree.

```bash
# 1. Tear the OLD project down WITH its volumes. This destroys its data — that is
#    the point, and it is only correct because nothing live is running.
docker compose -p open-migrate-managed down -v --remove-orphans
docker compose -p open-migrate-selfhost down -v --remove-orphans   # if present

# 2. `container_name:` is a fixed string, so `-p` never namespaced these. Any that
#    survived step 1 would collide with the new stack by name.
docker rm -f open-migrate-db open-migrate-pgbouncer open-migrate-api \
             open-migrate-web open-migrate-nextcloud \
             open-migrate-selfhost-db open-migrate-selfhost-app 2>/dev/null || true

# 3. The demo Stalwart is created by `docker run` (setup-stalwart.sh — it cannot
#    be a compose service, see that script's header), so it is NOT in the compose
#    project and `down -v` structurally cannot see it. It is also what keeps the
#    old network alive: step 1 reports "Resource is still in use" because this
#    container is still attached to it.
docker ps -a --filter network=open-migrate-managed_open-migrate-network --format '{{.Names}}'
docker rm -f open-migrate-stalwart 2>/dev/null || true
docker network rm open-migrate-managed_open-migrate-network 2>/dev/null || true

# 4. Its volumes are outside compose for the same reason. Three naming generations
#    exist on a long-lived box, as those defaults drifted:
docker volume rm $(docker volume ls -q --filter name=open-migrate-stalwart) 2>/dev/null || true

# 5. Confirm nothing is left holding the old name before you bring the new one up.
docker ps -a      --filter name=open-migrate --format '{{.Names}}'
docker volume ls  --filter name=open-migrate
docker network ls --filter name=open-migrate
```

**Do not delete `ownpace-dev-stalwart*`.** That is the dev/e2e Stalwart instance —
a different stack from the one this page brings up, not part of the
`open-migrate*` family being removed above, and still in use.

It was called `openmig-dev-stalwart*` until 2026-08-31, <!-- PRE-RENAME SWEEP --> so a long-lived box may
show both generations for a while. `e2e.yml` removes the older one itself (the
lines marked `PRE-RENAME SWEEP`); you do not need to, and should not reach for
a wildcard that would take the current one with it.

**Do NOT delete `~/.persistent/open-migrate-managed`.** It holds the stack's `.env`
— including `SECRET_ENCRYPTION_KEY`, the key that decrypts every stored credential
in the database — and `pgbouncer/userlist.txt`. It lives outside the checkout
precisely so `actions/checkout`'s clean cannot reach it, which also means nothing
else will recreate it. **Move it:**

```bash
mv ~/.persistent/open-migrate-managed ~/.persistent/ownpace-managed
```

If the repository variable **`MANAGED_ENV_PERSIST_DIR`** is set explicitly, it
overrides the workflow default and still points at the old path — update it in
GitHub → Settings → Variables, or the nightly e2e restores `.env` from a directory
that is no longer there.

The Trigger.dev platform containers (`trigger-db`, `trigger-api`, `trigger-tls`, …)
are **not** product-named and keep their names; nothing above touches them.


## Before you start

**Host**

- Linux with **Docker** and **Docker Compose v2** (`docker compose version`).
- **Node 24+** and **pnpm** (the seed, the deploy CLI and the smoke run on the
  host, not in a container).
- `openssl`, `curl`, `git`.
- **~15 GB free disk.** ClickHouse, MinIO, the Trigger.dev images, the task
  registry and the built API/web images add up; running out midway leaves a
  stack that is partly built and wholly confusing.
- The repository cloned, and `pnpm install --frozen-lockfile` done.
- **Container output kept for a month, and no longer** (workplan 0129 T3). No
  compose file here sets `logging`, so every container, the compose services and
  the task runs Trigger.dev starts alike, writes with Docker's default, which
  keeps everything for ever. Give it to the host's journal, and let the journal
  keep 30 days:

  ```bash
  # /etc/docker/daemon.json
  { "log-driver": "journald" }

  # /etc/systemd/journald.conf, under [Journal]
  MaxRetentionSec=1month
  ```

  Then `sudo systemctl restart systemd-journald docker`. Only containers created
  after that use the journal, so do it before the bring-up. `docker compose logs`
  keeps working, and `journalctl CONTAINER_NAME=<name>` reads the same lines.

**Architecture.** `DEPLOY_IMAGE_PLATFORM` decides what the task images are
built for, **server-side** — there is no CLI flag. Get it wrong and every task
run dies at `exec` in under a second with `AutoRemove` deleting the evidence.
`managed.env.example` ships `linux/amd64`, so on an **arm64 box the shipped
default is wrong**. The script fixes this for you from `uname -m`; it is
mentioned here because it is the single setting whose failure looks like
nothing at all.

**Ports** published on the host, all overridable in `.env`. Every one of them
answers on `127.0.0.1`. The last column is the setting that adds an address
(see *Which address a port answers on*, below):

| Port | Service | Notes | Adds an address |
| --- | --- | --- | --- |
| 3001 | API | `API_PORT` | `API_BIND`, leave it empty |
| 3123 | web | `WEB_PORT` — **routed**: the app's public name leads here | `WEB_BIND` |
| 5432 | Postgres | `POSTGRES_PORT` — the host-run seed and migrations need it | `POSTGRES_BIND`, leave it empty |
| 3090 | Trigger.dev API (http) | `TRIGGER_PORT` — what the **deploy CLI** talks to | `TRIGGER_BIND`, leave it empty |
| 3443 | Trigger.dev dashboard (https) | `TRIGGER_TLS_PORT` — what your **browser** talks to | `TRIGGER_TLS_BIND` |
| 5000 | task image registry | `REGISTRY_PORT` | none: loopback only |
| 3124 | status page (Gatus) | `STATUS_PORT` — **routed** where a status name leads here | `STATUS_BIND` |
| 3126 | identity provider (Zitadel) | `ZITADEL_PORT` — the same number inside and out; **routed**: its public name leads here | `ZITADEL_BIND` |
| 3127 | Mailpit (web UI) | `MAILPIT_PORT` | `MAILPIT_BIND` **replaces** loopback, and the smoke follows it |
| 8083 | Nextcloud | `NEXTCLOUD_PORT`; demo backend only | `NEXTCLOUD_BIND` **replaces** loopback, and its callers follow it |

The public site's `www.yml` does the same with `WWW_PORT` (3125, **routed**)
and `WWW_BIND`. The demo's Stalwart (`setup-stalwart.sh`) publishes on
`STALWART_BIND`, loopback by default.

PgBouncer is deliberately **not** published: it is reached over the compose
network by name. That is why anything running on the host (the seed, the
migrations) connects to `postgres:5432`'s published port directly.

**`GET /metrics` on the API port is unauthenticated**, by decision (0026 T3
row 19): it carries counts and durations only, but the aggregate volume it
reveals is not for the public internet. The web image proxies only `/api/*`,
so `/metrics` is reachable only on port 3001 itself. Keep 3001 off any public
interface, and if a reverse proxy does front 3001 directly, do not forward
`/metrics`. Scrape it over the compose network or loopback.

**Addressing the dashboard.** `TRIGGER_TLS_HOST=localhost` (the default) means
the dashboard is usable **only from the machine itself**. The dashboard's
session cookie is `Secure` in production mode, so plain http works from
localhost and nowhere else — which is why the `trigger-tls` service exists.
To reach it from your laptop, before the `trigger` phase set:

```bash
./deploy/compose/env-upsert.sh deploy/compose/.env \
  TRIGGER_TLS_HOST=10.0.0.5 \
  TRIGGER_TLS_BIND=10.0.0.5 \
  TRIGGER_APP_ORIGIN=https://10.0.0.5:3443 \
  TRIGGER_LOGIN_ORIGIN=https://10.0.0.5:3443
```

`TRIGGER_TLS_BIND` publishes the port on that address; without it the
dashboard answers on the machine only, whatever `TRIGGER_TLS_HOST` says. It is
the IP address the host names, never a name, even where `TRIGGER_TLS_HOST` is
one (*Which address a port answers on*, below).

The API origin the server advertises is fixed in `managed.yml` to
`http://127.0.0.1:<TRIGGER_PORT>`, and `.env` does not change it. The deploy CLI
follows that origin after it logs in, so it must not meet a self-signed
certificate on the way: when it did, deploys died with a bare `Connection
error`. Its image build reaches it on loopback, because `deploy-tasks.sh` builds
on the host's network (`--network host`). So `TRIGGER_BIND` stays empty.
`localhost` would not do: the CLI rewrites that to `host.docker.internal` for the
build, the machine's first non-loopback address, where the port does not answer.
`TRIGGER_API_ORIGIN` in `.env` is only the address the scripts log the CLI in
with: `http://127.0.0.1:3090`.

### Which address a port answers on

Before workplan 0132 T3 seven of these ports, and the site's, had no host address, so
Docker published them on **every interface** (`0.0.0.0`). Docker writes its own
firewall rules for a published port, so a host firewall's input rules do not
close it. And a container reaches every port its host publishes through its
network's gateway, so on a machine with two stacks each stack's containers
could reach the other's database (workplan 0132 T1f).

Now each port has two entries in `managed.yml`: `127.0.0.1`, fixed, and
`${<NAME>_BIND:-127.0.0.1}`. Empty, the bind renders the same as the first
entry and Compose keeps one. Set, it adds that address, and loopback stays,
because the bring-up, the smoke, the deploy CLI and the seed ask these ports on
localhost. `scripts/a-port-published-on-purpose.unit.test.ts` holds every
`ports:` entry to that shape.

**A bind is one IPv4 address of this machine.** Never a name: Compose refuses
the whole file with `invalid IP address`, so every compose command fails, the
gate's bring-up and teardown included. Never `0.0.0.0` or `::`: that is every
interface again, and beside the fixed loopback publish of the same port the
container cannot bind at all. `bootstrap-managed.sh` refuses both before
Compose reads the file, and names the key, not the value.

- **A routed port needs its bind.** A public name reaches the machine through a
  front (on the reference machine, a mesh provider's ingress), and the front
  connects to the port on one of the machine's addresses. Set `WEB_BIND`,
  `ZITADEL_BIND` and, where a status name is routed, `STATUS_BIND` to that
  address in the stack's `.env`, and `WWW_BIND` in the `.env` the site is
  brought up with. Without it, the name stops answering. The API reaches its
  issuer by the provider's public name too, so sign-in stops with it, and the
  status page's lamps go red.
- **The front's own request-body limit must allow 8 MB on the app's name, and
  on the helpdesk's.** A problem report (8f) carries a screenshot of up to
  5 MB, sent as base64 in a request of up to about 7 MB; the API takes 8 MB
  (`PROBLEM_REPORT_BODY_LIMIT`), and the web image's nginx lets that much
  through to `/api/`. The ingress in front of the machine (NetBird's, on the
  reference machine) may have a limit of its own, and this repository cannot
  set it: check that it allows at least 8 MB. The API then sends the same
  screenshot on to Zammad, as base64 inside the ticket, so that request is
  about 7 MB too. Whatever answers on `ZAMMAD_URL`'s name (Zammad's own
  nginx, a proxy in front of it, or this same ingress if the name is routed
  through it) must also take about 8 MB. 8f's test report with a screenshot
  near 5 MB is what proves both. A front on the app's name that refuses with a
  413 makes the form tell the person to choose a smaller screenshot, and
  nothing is recorded; one that drops the connection instead leaves the form
  saying only *Network Error*. A front on Zammad's name that refuses it is
  answered with a reference and recorded as `report.not-delivered`, and the
  API's log line for that reference says `Zammad answered 413`.
- **A page you open from a laptop over the mesh** takes the machine's mesh
  address the same way: `TRIGGER_TLS_BIND` for the dashboard (*Addressing the
  dashboard*, above), and `STATUS_BIND` for a status page reached over the mesh
  even where no name is routed to it. The OTA stack's status page is reached
  that way (workplan 0142).
- **Leave `POSTGRES_BIND`, `API_BIND` and `TRIGGER_BIND` empty.** Nothing off the
  machine needs the database, the API with its unauthenticated `/metrics`, or
  the Trigger.dev API.

**The gate's log is public, and a bind is this machine's address.** The nightly
gate runs here, anybody can read its log, and any signed-in account can
download its evidence. None of these values is a secret, so GitHub hides none
of them, and until 2026-09-27 every run printed the mesh address: the PORTS
column of `docker compose ps`, the bring-up's `dashboard:` note, "External DAV
ready at", the deploy CLI's links. So what the gate runs names a bind,
`TRIGGER_TLS_HOST`, the dashboard's origins and Nextcloud's trusted domains by
their KEYS: `ps` without its PORTS column, an origin printed only when its
host is loopback, the deploy CLI without its links. Behind that, the gate
masks each of these values for the rest of the job as soon as it restores the
`.env` (`deploy/compose/own-addresses.sh --mask`), and the smoke's own stream,
the container logs a failed bring-up dumps, and the uploaded evidence are
filtered: a value becomes the key that holds it (`<MAILPIT_BIND>`), and any
address in the mesh's range, `100.64.0.0/10`, becomes `<mesh-ip>`. A mask
covers the gate's log and nothing else, so a new line that prints one of these
names the key instead. `scripts/a-public-log-that-named-the-machine-it-ran-on.unit.test.ts`
holds all of it. Runs published before that date keep what they printed; their
logs can be deleted from the run's page on GitHub.

```bash
# deploy/compose/.env — 100.64.0.1 is the SHAPE of a mesh address, not yours
WEB_BIND=100.64.0.1
ZITADEL_BIND=100.64.0.1
```

Then recreate the services whose binds you set, for example
`docker compose -f deploy/compose/managed.yml up -d web zitadel` (the status
page's service is `gatus`, the dashboard's `trigger-tls`). `docker ps --format
'{{.Names}} {{.Ports}}'` names every address each container answers on.

**Checking every publish on the machine at once.** From a stack's checkout,
`./deploy/compose/exposure-check.sh` reads `docker ps` for every running
container, both stacks, the site and the demo's Stalwart included. It fails for
each port published on every interface, or on an address that is not loopback
and not listed in `EXPOSURE_ALLOW` in that checkout's `.env`. Because it reads
the whole machine, that list is every address any container on it is published
on on purpose, not only the checkout's own: both stacks' `*_BIND` values, the
site's `WWW_BIND` and the demo's `STALWART_BIND`, separated by commas with no
space (`EXPOSURE_ALLOW=192.0.2.10,100.64.0.1`; a bare space is a line bash
cannot source, and the bring-up refuses it). Each stack's `.env` carries the
same list. It names the container and the port, never the address, so what it
prints can go into a public log. `deploy-live.sh` (workplan 0132 T6) runs it
after each deploy of live, and a deploy it fails did not take; T7 will run it
daily. Until live stands it is run by hand (T0 step 5). The same question from
outside is the dispatch-only workflow *Exposure probe*
(`.github/workflows/exposure-probe.yml`), on a GitHub-hosted runner. It needs
the repository variable `EXPOSURE_PROBE_LIVE_PORTS`, live's `*_PORT` values, and
takes the machine's own public address from the optional secret
`EXPOSURE_PROBE_HOST`.

**The OTA site is recreated by hand, and only by hand.** No workflow runs
`www.yml`, and the bring-up does not start the site (*The public site*, below).
So a change to its publish, or to `WWW_BIND`, reaches the OTA site at the next
`docker compose -f deploy/compose/www.yml up -d` from an updated checkout, and
not before. Until then `docker ps` shows the site's old publish, and its name
keeps answering whatever `WWW_BIND` says. Live's copy, `ownpace-live-www`, is
the one exception: while `WWW_LIVE=true`, `deploy-live.sh` builds and recreates
it with each deploy of live. By hand it is only restarted as it is (the
incident runbook) or taken down after switching it off, each with its `-p`
(*`www.ownpace.eu`: live's copy*, below).

**A bind on a mesh address ties the container's start to that address.**
Docker binds the address when it starts the container, and the address has to
exist then. After a reboot where Docker starts before the mesh client has its
address, the container fails with `bind: cannot assign requested address`, and
its loopback publish goes with it, because it is the same container. A restart
policy does not reliably retry a start that failed while the daemon was
restoring containers. A publish on every interface never had this dependency.
The same holds for `MAILPIT_BIND`, `NEXTCLOUD_BIND` and `STALWART_BIND` on a
mesh address. Either let the machine bind an address it does not have yet:

```bash
# /etc/sysctl.d/90-bind-before-the-mesh.conf, then: sudo sysctl --system
net.ipv4.ip_nonlocal_bind = 1
```

or give `docker.service` a drop-in ordered `After=` the mesh client's unit, with
an `ExecStartPre=` that waits until the address is assigned: a mesh unit that
reports started has not always got its address yet. Either way, check it once
after a reboot: `docker ps --format '{{.Names}} {{.Ports}}'` lists every
container with a bind on the mesh address, up, on `127.0.0.1` and that address.

> **Before a stack that is already fronted takes this change** (the pull that
> brings `WEB_BIND` into `managed.yml`), its `.env` must carry the routed binds,
> or the change moves those ports to loopback and the public names stop
> answering. A key the running `managed.yml` does not read yet changes nothing,
> so setting them first is safe. On the reference machine, in two parts:
>
> 1. **The OTA stack, before the merge.** The nightly gate deploys `main` by
>    itself, so the first gate run after the merge brings the change. Its `.env`
>    is `~/.persistent/ownpace-managed/.env`, which the gate restores and the
>    operator's checkout links to. It carries `WEB_BIND` and `ZITADEL_BIND`;
>    `STATUS_BIND` where a status name is routed there **or the status page is
>    opened from a laptop over the mesh** (the OTA stack's is); and
>    `TRIGGER_TLS_BIND`, the IP address `TRIGGER_TLS_HOST` names, if the
>    dashboard is opened over the mesh.
> 2. **The site, before it is next recreated.** No gate run touches the site,
>    so it keeps its old publish, on every interface, until somebody runs
>    `docker compose -f deploy/compose/www.yml up -d` from an updated checkout.
>    Set `WWW_BIND` in the `.env` beside `www.yml` in that checkout, then run
>    it, then check that `docker ps --format '{{.Names}} {{.Ports}}'` shows
>    `ownpace-www` on `127.0.0.1` and the front's address, and that the site's
>    name answers.
>
> Workplan 0132's Status block records this as the change's merge
> precondition.

---

## The short version

```bash
git clone … ownpace-managed && cd ownpace-managed
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

## Which stack a command reaches

`managed.yml` says `name: ownpace-managed`, the OTA stack's compose project, and
that is only a default. `COMPOSE_PROJECT_NAME` in the `.env` beside it
overrides it, and the reference machine runs a second stack that way:
`ownpace-live`, in a checkout of its own (workplan 0132 D7). Two stacks on one
Docker daemon are kept apart by names, so every name follows the project:

| What | Named | On the OTA stack |
|---|---|---|
| Containers | `<project>-db`, `<project>-api`, `<project>-idp`, `<project>-trigger-api`, … | `ownpace-managed-db` |
| Volumes | `<project>_<volume>` | `ownpace-managed_zitadel_machinekey` |
| Networks, the task runs' included | `<project>_ownpace-network`, `<project>_status-probe` | `ownpace-managed_ownpace-network` |
| The persisted `.env` and the Trigger.dev dumps | `~/.persistent/<project>/` | `~/.persistent/ownpace-managed/` |

So a command reaches a stack in one of two ways, and never by a fixed name:

- **Through Compose, from that stack's checkout.** `docker compose -f
  deploy/compose/managed.yml exec postgres …`, `… logs trigger-api`, `… ps`.
  Compose reads the `.env` beside `managed.yml` and acts on that stack only.
  The commands in this document are written that way.
- **By a name built from the project.** Where a command needs a container,
  volume or network name, this document writes `<project>`. It is
  `COMPOSE_PROJECT_NAME` in that checkout's `deploy/compose/.env`, or
  `ownpace-managed` when that is unset. The scripts take it the same way
  (`compose_project` in `deploy/compose/env-read.sh`), and the recipes they
  print have it filled in. One difference: a `.env` that carries live's
  marker, `STACK_KIND=production` (`deploy/compose/stack-kind.sh`), and whose
  project still comes out as `ownpace-managed` is refused, naming the two keys
  and no value. Live's `.env` sets `COMPOSE_PROJECT_NAME=ownpace-live` (workplan
  0132 T1b); without that line every script in live's checkout would drive the
  OTA stack with live's `.env`. A `docker compose` you type yourself does not
  refuse. To ask Compose, from the checkout:

  ```bash
  docker compose -f deploy/compose/managed.yml config --no-interpolate | sed -n 's/^name: //p'
  ```

**One shell, one stack.** Compose prefers a `COMPOSE_PROJECT_NAME` exported in
the shell, even an empty one, over the checkout's `.env`. So after
`set -a; . deploy/compose/.env; set +a` in one checkout, a `docker compose`
command in the other checkout acts on the first stack. Open a new shell, or
`unset COMPOSE_PROJECT_NAME`, before you change checkouts. Every script in
`deploy/compose/` that runs Compose refuses to run when the shell and the
checkout's `.env` disagree, before its first Compose command
(`scripts/two-stacks-on-one-box.unit.test.ts` holds each one to that). A
`docker compose` command you type yourself does not refuse.

Before workplan 0132 T1 the 17 containers had fixed names (`ownpace-db`,
`trigger-api`, `ownpace-idp`, …). The first bring-up after that change
recreates the OTA stack's containers under the new names. The volumes keep
their names, because the project did not change, so no data moves. A habit such
as `docker exec ownpace-db …` becomes `docker compose -f
deploy/compose/managed.yml exec postgres …`.

Names keep two stacks apart by configuration. They are not a boundary: each
stack's `trigger-docker-proxy` holds the host's Docker socket and can start a
container on any network (workplan 0132 §1).

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
  inside it. `APP_DB_PASSWORD` has the same trap from the other side:
  migration `0001_baseline.sql` creates `app_user` with the password
  `app_password` whatever `.env` says, so a new value must also be applied to
  the role once the migrations have run — `./deploy/compose/rotate-db-passwords.sh --sync`
  sets both roles to `.env`'s values without printing either
  (see [operator-runbook.md, "The two database roles"](./operator-runbook.md#the-two-database-roles-why-there-are-two-db-urls),
  and [Changing the database passwords](#changing-the-database-passwords) below)
  — or the API cannot connect through `APP_DATABASE_URL`.
- `CORS_ORIGIN` / `WEB_URL` / `API_URL`. On a real deployment these are the
  public https addresses. `API_URL` is where **Mollie's servers** deliver
  payment webhooks: with `MOLLIE_API_KEY` set, the API refuses to boot in
  production on a localhost `API_URL`, because the alternative is payments
  that complete while invoices never leave `sent`.
- `PRICING_*` — integer **cents**, never euros. They are a template for *new*
  tenants; each tenant's agreed prices are pinned in the `tenant_pricing` table
  the first time their money is computed and never follow this file again. That
  table is created by the MANAGED migration chain (ADR-0036), which the API
  applies after the shared one — an appliance applies only the shared chain and
  has no such table.
- `SMTP_*` / `NOTIFY_*` — set them all or none. Half-set, the channel stays off
  and names what is missing.
- `OAUTH2_*` — only for a stack with a Microsoft Graph source or 0028's drift
  detector. An IMAP-only stack needs none of it.
- `*_BIND` — the address a port answers on besides `127.0.0.1`. Empty is
  loopback only, which is right for a machine nothing is routed to. A public
  name routed here needs `WEB_BIND` and `ZITADEL_BIND` (and `STATUS_BIND`), and
  a dashboard opened from a laptop `TRIGGER_TLS_BIND`: see *Which address a port
  answers on*. Every phase that runs Compose refuses a bind that is a name,
  `0.0.0.0` or a comment, naming the key.
- `OWNPACE_REACHABLE_HOSTS` — empty, and on live it stays empty. The API and
  every task run refuse to connect to a host a tester typed when it resolves
  inside this service's own network, except for the exact names this lists
  (workplan 0136 T1, T2). An entry admits that name for every organisation on
  the deployment. The `demo` phase adds the demo's two; nothing else belongs
  here.

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
— then the seed.

**First it admits the demo's two names.** The demo's connections reach its
backends by compose name, `nextcloud` and `stalwart`, and the API and the tasks
refuse both unless `OWNPACE_REACHABLE_HOSTS` lists them. So the phase adds
whichever is missing to `.env` and keeps anything else listed, before the API
starts and before the task variables are uploaded. Live never runs this phase,
so its list stays as its operator wrote it: the script refuses `--with-demo`,
before anything runs, on a `.env` that carries live's marker or anything that
could be a slip of it (`STACK_KIND`, `stack_may_be_live` in `stack-kind.sh`;
workplan 0132 T5). The OTA stack's `.env` carries no such line, so the nightly
gate's `--with-demo` goes on. The seed:

```bash
DATABASE_URL=postgresql://…@localhost:5432/openmigrate \
DIRECT_DATABASE_URL=… JWT_SECRET=… SECRET_ENCRYPTION_KEY=… \
  ./deploy/compose/seed-managed.sh
```

Those exports matter. The seed runs **on the host** and inherits nothing;
nothing in `apps/api` loads a dotenv file. It also runs the migrations itself —
**both chains**, shared then managed (ADR-0036), each advisory-locked under its
own key, so racing an API boot is safe — which is why the schema exists before
the API has ever started. The order is not a preference: every table in the
managed chain references `public.tenant`.

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
   organisation `Ownpace`, project `ownpace`.)

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
# If this machine has logged in before, log OUT first — see the box below.
npx -y trigger.dev@<version> logout --profile openmig
npx -y trigger.dev@<version> login -a http://localhost:3090 --profile openmig
```

**Once means once, because the token is remembered.** The next
`deploy-tasks.sh` run calls `trigger-remember-token.sh`, which copies the
token the CLI just minted into `.env` as `TRIGGER_ACCESS_TOKEN`. From then on
the CLI's `deploy` reads that variable before it looks at any profile file and
validates it against the server itself — no browser, no profile, and nothing
left on the host to go stale. It is the CLI's own documented path for CI, and
the E2E workflow has used it as a repository secret since #460; what was
missing was anybody putting one in a real stack's `.env`.

Run it by hand any time (`./deploy/compose/trigger-remember-token.sh`); it
declines to overwrite a token `.env` already holds unless you pass `--force`,
and it never prints the value.

> **Log out first when there is anything to log out of.** The profile lives at
> `~/.config/trigger/config.json`, on the HOST, and outlives the instance it
> was minted against — so after a wipe, a `down -v` or a rename it holds a
> token for an account that no longer exists. `login` finds that token and
> short-circuits with *"You are already logged in"* **without validating it**,
> so it reports success while `deploy-tasks.sh` still correctly refuses. Only
> `logout` clears it. If `logout` short-circuits too, delete the profile's
> entry from that file. (Met twice on the owner's own box; the second time,
> 2026-09-03, is why the token is now remembered at all.)

**`openmig` is the DEFAULT profile name, not a fixed one.** It is pre-rename
branding (ADR-0040) kept on purpose — a machine already logged in under it,
the gate's runner most likely, would be stranded by a default that moved.
`TRIGGER_CLI_PROFILE` in `.env` overrides it, and the phase then asks for
whatever you set.

**Setting that variable moves the SETTING, and cannot move a login.** A login
is a token stored per profile NAME in `~/.config/trigger/config.json` on the
host — outside the checkout, untouched by the rename, and invisible to
anything in this repository. So a stack whose `.env` says `ownpace` while that
file holds only `openmig` is correct in both halves and refuses anyway; it is
one browser round trip from agreeing (2026-08-31). The refusal prints the name
in use and the default as two separate lines for exactly this reason.

The script prints the exact line with the version filled in and stops, because
the command opens a browser and waits for you. Note the address is the plain
**http api origin**, not the https front.

**The URL it then asks you to open is on the https front**
(`TRIGGER_LOGIN_ORIGIN`, the `trigger-tls` service), which serves a
self-signed certificate — and one browser has been seen to fail there where
another succeeds. See the failure table.

**Verify:** `npx -y trigger.dev@<version> whoami --profile <name>` — and read
its OUTPUT, not its exit code, which is 0 either way (below).

### 8. `app` — API and web

`docker compose up -d --build --wait`, with `GIT_SHA` passed so `GET /version`
reports a commit rather than `unknown`. The API runs both migration chains at
boot (ADR-0036), shared first.

Without `--with-demo` the services are **named explicitly** rather than swept
up, so a bare `up` does not start Nextcloud — whose admin password is
`change-me-nextcloud-admin` by default. To start it on its own, without the
demo tenants and their published credentials:

```bash
docker compose -f deploy/compose/managed.yml up -d --wait nextcloud
```

First boot INSTALLS Nextcloud, so `--wait` can sit there for two to three
minutes before `status.php` answers. It publishes on `127.0.0.1:8083` and its
trusted domains are `localhost nextcloud`, so the UI answers on
`http://localhost:8083` from the host itself (`ssh -L 8083:localhost:8083
<host>` from elsewhere). Inside the stack its DAV root is
`http://nextcloud/remote.php/dav` — the base URL a `caldav`, `carddav` or
`webdav` connection takes, once `OWNPACE_REACHABLE_HOSTS` lists `nextcloud`.

**A host inside this network is refused.** The API and every task run refuse to
connect to a host a tester typed when it resolves inside this service's own
network: loopback, the private ranges, link-local, CGNAT, unique-local, and a
compose name (workplan 0136 T1). A redirect is checked the same way. The Test
button then says the address is inside our network, without the address. The
exact names in `OWNPACE_REACHABLE_HOSTS` are admitted, and this phase prints
what the list holds; on live, nothing. Before the API starts, the phase also
checks that every Docker network on the machine lies inside those ranges, and
stops when one does not (see [When it goes wrong](#when-it-goes-wrong)).

#### Reaching it over a private mesh (NetBird, Tailscale)

To browse what a migration actually landed, from a laptop on the mesh and with
no tunnel, publish it on the peer address and put that address on the
trusted-domain list. `100.64.0.1` below is the SHAPE of a mesh address, not a
reachable one — both meshes allocate out of `100.64.0.0/10`, and yours is
whatever this box was given; `ip -4 addr show` on the box names it. **Both**, or the second one bites: Nextcloud answers its
untrusted-domain page to any host header not on the list, and that refusal
reads like a broken deployment rather than a setting.

```bash
# deploy/compose/.env
NEXTCLOUD_BIND=100.64.0.1
NEXTCLOUD_TRUSTED_DOMAINS="localhost nextcloud 100.64.0.1"
```

Keep `localhost` and `nextcloud` on the list: the gate asks on the first, the
app network on the second. Then recreate the container, which is what makes
either setting take:

```bash
docker compose -f deploy/compose/managed.yml up -d --wait nextcloud
```

**On an instance already installed**, the image applies
`NEXTCLOUD_TRUSTED_DOMAINS` only at install time, so the recreate above will
not add the address by itself. Set it directly, then re-read it:

```bash
docker compose -f deploy/compose/managed.yml exec -u www-data nextcloud \
  php occ config:system:set trusted_domains 2 --value=100.64.0.1
docker compose -f deploy/compose/managed.yml exec -u www-data nextcloud php occ config:system:get trusted_domains
```

The mesh address is reachable only by devices holding a key for it, which is
an authentication boundary — but everyone on that mesh reaches the admin
account, so change `NEXTCLOUD_ADMIN_PASSWORD` from its shipped default before
using this. `NEXTCLOUD_BIND=0.0.0.0` is refused by a rule.

**If you started Nextcloud before 2026-09-06**, its data is in an anonymous
volume: the service declared none, and the image declares one. It now mounts
`nextcloud_data`, so the first recreate after this change starts an EMPTY
Nextcloud and leaves the old data behind under a hash. To carry it across
before recreating:

```bash
project="$(docker compose -f deploy/compose/managed.yml config --no-interpolate | sed -n 's/^name: //p')"
old=$(docker inspect "$(docker compose -f deploy/compose/managed.yml ps -q nextcloud)" \
  --format '{{ range .Mounts }}{{ if eq .Destination "/var/www/html" }}{{ .Name }}{{ end }}{{ end }}')
docker volume create "${project}_nextcloud_data"
docker run --rm -v "$old":/from -v "${project}_nextcloud_data":/to \
  busybox:1.38 sh -c 'cd /from && cp -a . /to'
```

Nothing is deleted by that: the old volume stays until you remove it.

**Verify:**

```bash
curl -fsS http://localhost:3001/health && curl -fsS http://localhost:3001/version
```

### 8b. Sign-in — the identity provider *(optional, but the paste box is the alternative)*

Not a `bootstrap-managed.sh` phase, and deliberately separate: a stack is
usable without it, and skipping it leaves exactly the sign-in that existed
before ([ADR-0042](./adr/0042-who-holds-the-passwords.md)) — the owner mints a
token with the seed script and whoever needs one pastes it into `/login`.

To have real accounts instead:

```bash
./deploy/compose/setup-zitadel.sh
```

It generates the provider's own secrets, starts it against the existing
Postgres, waits for it to be healthy, creates the project and a **public**
client (authorization-code + PKCE, no client secret — this is a browser app,
and a secret shipped to every visitor is not a secret), and writes
`JWT_ISSUER`, `JWT_AUDIENCE` and the two `VITE_OIDC_*` values back into
`deploy/compose/.env`. Re-running it is safe; it adopts what already exists.

**Two doors it keeps shut** (workplan 0135 T1 and T2). Nobody can found an
organisation of their own at the provider: the form at
`/ui/login/register/org` answers 404. And the project admits its own
organisation only, so an account in any other organisation gets no token for
the app. Every run sets both, reads both back, and stops if either did not
take; a fresh instance has the first from `managed.yml`. Self-registration
stays on: it registers people in the project's own organisation, and they
confirm their address by mail.

**Its languages** (workplan 0135 T6). The sign-in page offers Dutch and English
and no other. `ZITADEL_DEFAULT_LANGUAGE` in `.env`, `nl` or `en`, is its default:
set `nl` on live, where the testers are. Empty keeps the instance's own. Every run
sets both and reads them back, and prints them in its summary.

**Then restart the API and REBUILD the web app, or nothing changes.** The API
only needs the new environment; the web app bakes `VITE_*` in at build time, so
a container built before the script ran has no issuer in its bundle and still
renders the paste box. The script prints these two lines when it finishes:

```bash
docker compose -f deploy/compose/managed.yml up -d --force-recreate api
docker compose -f deploy/compose/managed.yml up -d --build web
```

**Verify** — `/login` shows a *Sign in* button rather than only a token box,
and the round trip ends on the dashboard:

```bash
curl -fsS "$(grep '^JWT_ISSUER=' deploy/compose/.env | cut -d= -f2-)/.well-known/openid-configuration" | head -c 200
```

The API reads the key-set URL from that document rather than composing one, and
the browser reads its endpoints from the same place — which is what makes the
provider a component rather than a foundation. Replacing it is `JWT_ISSUER` +
`JWT_AUDIENCE` + `VITE_OIDC_*` pointed somewhere else and a rebuild; two tests
fail if that stops being true.

> **The issuer's address ends up inside every token.** `ZITADEL_EXTERNALDOMAIN`
> is what the provider stamps as `iss`, and the API compares it byte for byte.
> Changing the address later invalidates every live session — it belongs with
> the other browser-visible addresses in `.env`, decided once.

#### One issuer or two? (owner decision, 2026-09-01)

**One, for now.** The reference stack's provider lives at
`id.ota.ownpace.eu`; production will later live at `id.ownpace.eu`, and that
will be a **separate provider on the production box**, not a second name for
this one.

Why not share it across both: the address is inside every token (see the note
above), so pointing a production stack at the test box's issuer makes the test
box a dependency of production sign-in and a single blast radius for both. Why
not stand the second one up today either: it is one `setup-zitadel.sh` run
whenever the production stack exists, and an issuer with no users on it is a
thing to keep patched for nothing.

What that means in practice:

- Every upstream OAuth client registered below gets a redirect URI on
  `id.ota.ownpace.eu` today, and a **second** one on `id.ownpace.eu` when
  production arrives — the same client may carry both, or you may register a
  separate client per environment, which
  [ADR-0041](./adr/0041-who-owns-the-oauth-client.md) prefers for the
  *migration* client and which applies equally here.
- Accounts do not travel. Somebody who signed in to the test stack has no
  account on production, which is correct: they are different deployments with
  different data, and a shared identity provider would have made that look
  otherwise.

#### Offering Google, Microsoft, GitHub or Apple as a second way in

Optional, and configuration only — nothing in the product knows a provider's
name (ADR-0042; `no-issuer-lock-in.unit.test.ts` fails the build on one). The
upstream goes into Zitadel, Zitadel still mints the token, and `tenant_member`
never learns anybody used Google.

**Your half** is registering an OAuth client at each provider's console. The
redirect URI is **not the same for all four** — Apple posts its answer back,
the others redirect:

| Provider | Where | Redirect / Return URI |
|---|---|---|
| Google | Cloud Console → Credentials → OAuth client ID (Web) | `$JWT_ISSUER/ui/login/login/externalidp/callback` |
| Microsoft | Entra ID → App registrations | `$JWT_ISSUER/ui/login/login/externalidp/callback` |
| GitHub | Settings → Developer settings → OAuth Apps | `$JWT_ISSUER/ui/login/login/externalidp/callback` |
| Apple | Developer → Services ID (**paid account**) | `$JWT_ISSUER/ui/login/login/externalidp/callback/form` |

`setup-zitadel.sh` writes the non-Apple value into `.env` as
`IDP_UPSTREAM_CALLBACK_URL`, and the app's **Redirect URIs** page (operator
nav) shows it beside every other address this deployment needs registered —
so you can copy it from a second tab while you are in the provider's console,
rather than from this table. It is a value rather than a path the product
composes, because the path is the identity provider's own and shipped source
must not know it (ADR-0042).

**Our half** is `.env` and a re-run. Fill in the pairs you want — a provider
with no credentials is simply not offered, and the script says so per provider
when it runs. **These are not the migration pairs**: `GOOGLE_OAUTH_CLIENT_ID`
and `MICROSOFT_OAUTH_CLIENT_ID` (§8e, `docs/microsoft-setup.md`) are the
registrations a consent runs against and make no sign-in button, which the
script's skip line names when one of them is set and the `IDP_` pair is not.
The keys, exactly as `.env` spells them:

```bash
IDP_GOOGLE_CLIENT_ID=       IDP_GOOGLE_CLIENT_SECRET=
IDP_MICROSOFT_CLIENT_ID=    IDP_MICROSOFT_CLIENT_SECRET=    IDP_MICROSOFT_TENANT=
IDP_GITHUB_CLIENT_ID=       IDP_GITHUB_CLIENT_SECRET=
IDP_APPLE_CLIENT_ID=        IDP_APPLE_TEAM_ID=
IDP_APPLE_KEY_ID=           IDP_APPLE_PRIVATE_KEY=
```

`IDP_MICROSOFT_TENANT` decides which Microsoft accounts may sign in — empty or
`common` for any, `organisations` / `consumers` to narrow it, or a tenant id to
pin one organisation. Then:

```bash
./deploy/compose/bootstrap-managed.sh --only app
```

Apple needs four values rather than two, and the key is sent as bytes:

```bash
base64 -w0 AuthKey_XXXXXXXXXX.p8     # -> IDP_APPLE_PRIVATE_KEY
```

**What happens when the address already has an account:** the person is prompted
to link, on a match of a *verified* email — never a silent merge. When several
accounts match, Zitadel shows no prompt at all, so the ambiguous case fails
closed. That decision is set once for every provider and is the reason this was
built after workplan 0102 T2 rather than alongside it: a provider sign-in that
minted a second subject would orphan a membership, and the person would be
locked out of an organisation they are still in.

**Microsoft addresses are not treated as verified**, deliberately. Entra does not
say whether it verified an address, and `email_verified` is what binds an
invitation and what moves a membership label — so Zitadel sends its own
verification mail. One click, and every claim downstream means what it says.

**Verify** — the buttons appear on `$JWT_ISSUER/ui/login`, and the bring-up says
what it configured:

```
[setup-zitadel] checking which sign-in providers this instance offers
[setup-zitadel]   Google: added
[setup-zitadel]   Google: now offered on the sign-in screen
[setup-zitadel] allowed (providers offered: true)
```

If a provider will not add, the refusal names the redirect URI to check.

**A re-run never re-sends credentials.** An existing provider is matched by
name and left exactly as it is — the script says so when it happens (*"a
provider of this name exists — left as it is"*). So fixing a mistyped secret
in `.env` and re-running changes nothing: remove the provider in the console
first (**Settings → Identity Providers**, at the instance), then re-run. The
button is gone for the seconds in between and anybody mid-sign-in through it
fails, so on a stack with real users do it deliberately, not casually.

**Emptying a pair removes less than it looks like.** The provider stays
configured and on the login policy. Emptying the *last* pair flips "External
IDP allowed" off on the next run, which hides *every* provider button; emptying
one of several leaves that provider's button showing and working, because the
run no longer carries credentials to compare and does not touch what exists.
Actual removal is the console, the same place as rotation.

**Where the Microsoft verification mail lands.** Entra addresses arrive
unverified on purpose (above), so the first Microsoft sign-in triggers the
issuer's own verification mail — which goes wherever this stack's mail goes.
On the OTA stack that is Mailpit, not an inbox: an operator offering Microsoft
there reads the code out of Mailpit ("Mail: caught, not delivered", below),
or the person waits on a mail that
never arrives anywhere they can see.

#### Whatever fronts the provider must pass the original `Host` header

If something terminates TLS in front of the identity provider — a reverse
proxy, a mesh ingress, a tunnel — it has to forward the request with the
original `Host:` intact. A proxy that rewrites it to its own address breaks
sign-in for every human on the deployment, and breaks it in a way that reads
like anything but a proxy problem.

**What it looks like.** Pressing *Sign in* reaches
`…/ui/login/login?authRequestID=…` and the page says:

```
User Agent komt niet overeen (EVENT-adk13)
```

**Why.** Zitadel builds the domain of its user-agent cookie from the raw `Host`
header (`domain := strings.Split(host, ":")[0]`, `internal/api/http/cookie.go`).
Rewritten Host, cookie scoped to the proxy's address. A browser may accept a
cookie only for its own domain or a parent, so it drops the cookie entirely —
and every subsequent request therefore arrives with a *fresh* user-agent id,
which never matches the one recorded on the authorization request.

**Why nothing else notices.** Instance resolution reads the FORWARDED name, so
the provider's own log reports the right host while the cookie says otherwise.
Token verification, the sessions API and every machine-driven path never touch
that cookie. The only thing that breaks is the path a person walks.

**How to check.** Ask the same endpoint twice — once through the ingress, once
straight at the container with the right `Host` — and compare the cookie:

```bash
cd ~/ownpace-managed && set -a; . deploy/compose/.env; set +a
AUTHZ="oauth/v2/authorize?client_id=${VITE_OIDC_CLIENT_ID}&redirect_uri=${WEB_URL}/auth/callback\
&response_type=code&scope=openid%20email&state=probe\
&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256"

# through whatever fronts it
curl -sS -o /dev/null -D - "${JWT_ISSUER}/${AUTHZ}"                       | grep -i '^set-cookie'
# straight at the container, with the Host it should have been given
curl -sS -o /dev/null -D - -H "Host: ${ZITADEL_EXTERNALDOMAIN}" \
     "http://localhost:${ZITADEL_PORT:-3126}/${AUTHZ}"                    | grep -i '^set-cookie'
```

Two different `Domain=` values means the ingress is rewriting `Host`. One value,
matching `ZITADEL_EXTERNALDOMAIN`, means it is not — and neither is `Domain=`
being absent altogether, which is the healthy shape for a `__Host-` prefixed
cookie.

**The fix is in the ingress**, not here: nginx `proxy_set_header Host $host`,
Traefik `passHostHeader: true`, or the equivalent. Where the ingress genuinely
cannot be told, put a proxy on the box in front of the provider that restores
it — the same shape as `www-nginx.conf` and the Caddy in front of Trigger.

`smoke-managed.sh` asserts this: it reads the cookie's domain off the
authorization response and names the rewrite rather than letting it surface as
an unexplained error page.

### 8c. Somebody who can answer the door *(needed before anybody can be let in)*

Also not a `bootstrap-managed.sh` phase. `access_request` is written by
strangers and readable by nobody until an **operator** exists (workplan 0093
T6) — so a deployment with no operators has a queue nobody can read and a
front door that only records knocks.

An operator is identified by their OIDC **subject**, not their email, and there
is no way to know it before they have signed in once. So:

1. Sign in at `/login` (§8b) — this creates the account in the provider.
2. Ask the API who you are:

```bash
curl -fsS -H "Authorization: Bearer <token>" http://localhost:3001/api/me
```

   <a id="where-the-token-comes-from"></a>
   **Where `<token>` comes from.** The web app already holds one: after signing
   in it keeps the token under `auth_token` in `localStorage`, on its own
   origin. Open the app, then in the browser console:

   ```js
   copy(localStorage.getItem('auth_token'))   // Chrome/Firefox: straight to the clipboard
   localStorage.getItem('auth_token')         // or just read it
   ```

   It must be **that** value. It is the OIDC **ID token** — `completeSignIn`
   returns `id_token` and the app sends exactly it — and the API validates the
   ID token's claims. An access token minted for the same account, from the
   same provider, is a different token and is refused, which reads as a broken
   appointment rather than as the wrong credential.

   It is short-lived. If either curl here answers `401`, the token has expired:
   sign in again and take a fresh one. Nothing else needs redoing.

3. Take the `userId` from that answer and appoint it, over the **owner**
   connection — `app_user` cannot write this table, which is the point of it:

```bash
./deploy/compose/operator.sh add <userId> you@example.com "first operator"
```

`operator.sh list` shows who can currently answer; `operator.sh remove <userId>`
takes it away. Adding somebody twice updates their row rather than failing, so a
typo is fixed by re-running.

**This block used to read the connection out of `.env` with `grep
'^DATABASE_URL='`, and that could not work on any stack** — `managed.yml`
COMPOSES `DATABASE_URL` from `POSTGRES_*` and `DB_HOST` (in the `api` service's
`environment:`), so the file
has never carried such a line. The grep returned empty, the assignment
succeeded, and the script refused for a requirement the reader had just
apparently met. `operator.sh` is the same answer `seed-managed.sh` already was
for the seed: a wrapper that composes what a host-run script cannot inherit,
and that asks compose for the published port rather than assuming 5432 — on the
reference box this stack's Postgres is on 55432.

**Why not an email address, and why not a screen.** Keying the appointment on an
email would mean whoever can register that address becomes an operator. Making
it a route would mean an operator could appoint another one — and then the owner
is no longer the one deciding who decides. It is three steps because each of the
shorter versions gives something away.

**Being an operator and belonging to an organisation are two facts.**
`platform_operator` says who may answer the door; `tenant_member` says whose
organisation somebody is in. An operator who joins one to look at something —
or who presses the enrolment button on their own deployment — acquires a
membership the product will not let them drop, and correctly so: it refuses
`Cannot remove yourself from the tenant`, then `Cannot remove the last owner`.
Three more sub-commands answer that at the machine, where the removal is a
platform act rather than a customer one:

```bash
./deploy/compose/operator.sh memberships <userId>            # what am I in, and could I leave it
./deploy/compose/operator.sh leave <userId> <tenant-id>      # one organisation
./deploy/compose/operator.sh leave <userId> --all            # stay operator, belong to nothing
```

`leave` refuses on the two things a departure can strand, and names which: an
organisation with **other people in it** and no other owner, and an organisation
with an **unfinished migration** — whose schedule keeps firing whether or not
anybody is left to read the failures. It removes each membership and writes
`audit_log` in the same transaction, so a removal made over the owner connection
cannot happen quietly. It **never touches `platform_operator`**: after
`leave --all` you are still an operator and belong to nothing, which is the
whole point. And it works only on somebody who **is** an operator — a customer's
membership is their organisation owner's to end, through
`DELETE /api/tenants/:tenantId/members/:memberId`.

An organisation left with no members at all is allowed (nobody is stranded) and
is **not** reachable through the product afterwards, because every route
resolves the tenant from a membership. The command prints the statement that
puts you back, so that is a decision rather than a discovery.

**What has drifted, and what to do about it.** A managed deployment accumulates
states nothing surfaces: an organisation whose only owner was removed, an
invitation nobody answered, an operator row written before `subjectRefusal`
existed and holding a token where an address belongs. Every one of those was
found by somebody eventually reading the right table by hand.

```bash
./deploy/compose/operator.sh check                       # every question at once
./deploy/compose/operator.sh check ownerless-tenant      # one, with why it matters
./deploy/compose/operator.sh clean <kind>                # what it WOULD do — writes nothing
./deploy/compose/operator.sh clean <kind> --confirm      # do it
```

One check is a precondition rather than a tidy-up: `check role-below-admin`
lists every membership whose role is `member` or `viewer` (organisation,
address, role, status), prints `none` when there is none, and exits non-zero
while there is one. A declined or removed row grants nothing and is not listed.
Until every write route names its roles, those two roles promise less than they
allow, and the product no longer grants them (workplan 0137 T7). Run it on
`ownpace-live` before the first invitation, from live's own checkout, because
`operator.sh` drives whichever stack the checkout's `.env` names (0132 D7):

```bash
cd ~/ownpace-live && ./deploy/compose/operator.sh check role-below-admin
```

Because it gates a step, the full `check` exits 1 too while `role-below-admin`
finds anything, and `pnpm` then prints its own failure after the report
(`ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL … Exit status 1` with the pinned pnpm 11).
The report above that line is still the whole answer, and it wrote nothing.

`check` writes nothing and each finding is printed with the statement or command
that resolves it. Most kinds are **report-only**: choosing who owns a customer's
organisation, or withdrawing somebody's invitation, is a decision the script must
not make, and `clean` refuses those by name. The kinds it will do — an
organisation holding nothing at all, an operator row matching no subject any
issuer can mint, a credential sitting in an email column — still write nothing
without `--confirm`, and print exactly which rows they would touch first.

Two things worth knowing before you run `clean`. It **cannot write `audit_log`**
(that table's `tenant_id` is NOT NULL, and these acts are about no tenant, or
about one that is going) — the terminal is the record, so keep the output. And
the two operator checks **never print the value they found**: the row is
identified and acted on by id, and the id is never displayed, because moving a
credential out of a table and into a scrollback is not a cleanup.

**How many grant links an organisation may hold at once** (workplan 0108 T8
(d)). As many live grant links as its tier runs migrations at the same time:
Tiny 1, Small 4, Medium 20, Large 50, Extra large 200, and the largest past the
end of the table. A customer who needs more for a while, to hand out a week's
links at once, gets a number of their own:

```bash
./deploy/compose/operator.sh links <tenant-id>                                # where it stands
./deploy/compose/operator.sh links <tenant-id> 30 --until 2026-10-01 onboarding  # 30, through that day (UTC)
./deploy/compose/operator.sh links <tenant-id> 30                             # 30, until cleared
./deploy/compose/operator.sh links <tenant-id> --tier                         # the tier's number again
```

The number replaces the tier's while it stands, higher or lower, and one set
through a day stops by itself, so a burst cannot outlive its reason by being
forgotten. It lives in `grant_link_allowance` (managed migration 0028), which the
request path can read and never write. Setting and clearing each write an audit
row, `grant_links.allowance_set` or `grant_links.allowance_cleared`, in the same
transaction.

`apps/api/src/scripts/operator-housekeeping.ts` carries a paragraph per check on
why it is a question worth asking; `operator-housekeeping.integration.test.ts`
runs all of them against a real database, because SQL nobody has executed is SQL
nobody has checked.

**Verify** — the queue answers, and answers only for them:

```bash
curl -fsS -H "Authorization: Bearer <token>" http://localhost:3001/api/access-requests
```

Once appointed, signing in again lands the operator on **Access requests** in
the web app (workplan 0093 T7), which is the same queue with buttons on it.

Granting is `POST /api/access-requests/<id>/grant`, which creates the
organisation and invites the asker as its owner; they become a real member the
first time they sign in, provided the identity provider asserts
`email_verified` for their address. Declining is the same shape and provisions
nothing. Neither can be undone by deleting the row: nobody has DELETE on that
table, so a decision stays on the record.

### 8c-bis. What an operator does here, and what they do at the provider

An operator belongs to **no organisation**, by design. That is not a gap to
fill: `/api/me` runs without a tenant precisely so the one person who lets the
others in can hold a session. Signing in lands them on **Access requests**, and
their nav offers that, **Support** and the setup guides — the tenant-scoped
screens are hidden, because each one's first request would be refused.

An **organisation** here is one customer — a team, a family, an SME — never one
for the whole deployment. It is created by granting an access request, and its
own owner runs it from **Team**.

Two different jobs, in two different places:

| You want to | Where | Why there |
| --- | --- | --- |
| See what a customer sees — connections, migrations, what is failing, this month's tier and the evidence for it | **Support**, in Ownpace | It is Ownpace's data. Every read is written to `support_read` against your name, and the screens say so |
| Change who may act on an organisation, or their role | **Team**, and it belongs to that organisation's owner | Membership *is* authorization (0020 T1). An operator does not hold it, and the roles are theirs to set |
| Reset a password, clear a lost second factor, disable an account | **The identity provider's console** | Ownpace stores no passwords and never calls the provider's user-management API — ADR-0042's second and third operative rules, and what keeps the issuer swappable |

**Finding somebody.** Support opens with a search box: type part of an email
address and you get matching people across every organisation, with which one
they are in, their role, and a link straight to that account at the provider.
That is the question a support day actually starts from — the organisation list
answers "show me the customers", which is not where anybody begins.

Both halves are recorded against your name (migration 0019): the search, with
what you looked for and how many people it found, and separately the moment you
follow a result through to the provider. A search reads every organisation, so
it leaves the widest trace on this surface, and the screen says so next to the
box rather than in a policy. Nobody but you can read those rows.

Per organisation, the **People** list on its own screen does the same for its
members, so the third row above is one click rather than a hunt. The link is
`VITE_IDP_CONSOLE_USER_URL`, which `setup-zitadel.sh` writes; leave it empty and
the addresses render as plain text rather than as links that go nowhere.

**The log.** Support links to **The log** (workplan 0129): the audit log and the
application's own errors and warnings, one timeline, newest first, a hundred
rows a page. A row is metadata only: time, level, organisation, migration,
event, error category, reference number and, on an audit row, who acted (the
member's address, or the process's own name). Narrow it by level, the start of
an event name, category, reference or dates; an organisation's page and a
migration's page open it narrowed to them. When somebody quotes the reference
an error showed them, type it into **Reference**: the row says when, where and
what kind of error, and the error's text is in the API's or the worker's
output, on the line carrying the same `[ref …]`.

What an audit event changed is not on the page. It stays in `audit_log.detail`
until the organisation is erased, and an investigation reads it as the database
owner:

```sql
SELECT at, actor, action, detail
  FROM audit_log
 WHERE tenant_id = '<the organisation id>'
 ORDER BY at DESC
 LIMIT 50;
```

Every page of the log you open is recorded in `support_read` with its filters,
under the organisation it was narrowed to.

**The audit log in your own log store** (workplan 0129 T4). Every audit event
is also one JSON line on the output of the process that recorded it, in
OpenTelemetry's log format: `Body` is the event, `ownpace.audit.actor` who
acted, `ownpace.audit.id` its row in `audit_log`, and `Resource` says which
process (`ownpace-api`, or `ownpace-worker` for the task runs). Addresses and
file and folder names are pseudonyms (`pseudo:` and sixteen hex characters,
the same person always the same one), a URL keeps only its scheme and host,
and a detail field nobody has classified is left out. The journal set up under
the prerequisites keeps the API's output and every task run's, so a collector
that reads the journal forwards them; the audit lines are the ones carrying
`ownpace.audit.id`:

```bash
journalctl -o cat --since today | grep '"ownpace.audit.id"'
```

Ownpace sends these lines nowhere itself. The pseudonyms are made with a key in
`deployment_key`, which only the database owner can read and which every
backup of the database carries, so keep backups as private as the database.
Four commands typed at a terminal print no line: the worker's cutover CLI,
`operator.sh leave`, `operator.sh links` and `operator.sh close`. Their events
are in `audit_log` like any other, and the download below serves them.

**Lines your log store missed** (0129 T4). A collector that was down, or output
rotated away before it was read, does not lose an event: it is still in
`audit_log`, and an operator downloads it again. Under Support, **The log**
ends with **Audit export**. Press **Download** with the field empty to fetch
every event from the first, or put the cursor of the newest line your log store
holds in the field to fetch only what came after it. The cursor is that line's
`Timestamp` and `ownpace.audit.id`, joined by a hyphen. The page fetches page
after page on your own session and saves one file of lines, oldest first, the
same lines the API prints: hand it to your log store, which can drop a line it
already holds by its `ownpace.audit.id`. Afterwards the field holds where the
next download starts. An event is served once it is five minutes old; the
newest ones are the stream's.

The page reads `GET /api/support/audit-export`, which answers an operator's
sign-in and nothing else (the owner, 2026-09-24: "an operator-only route using
your own session"): a log store cannot fetch it by itself. Its rows come
through `support_audit_export` (managed migration 0026), behind the same
`platform_operator` check as every support view, so a signed-in person who is
not an operator gets an empty page. `after` and `limit` (1 to 10,000 lines, a
thousand by default) work as on the appliance, and the `Ownpace-Next-After`
and `Ownpace-Caught-Up` headers say where the next page starts and when there
is no more. Every page served is recorded in `support_read` as one read of
every customer (`audit_export`), with where it started and how many lines it
served.

**The console needs its own grant, and its own sign-in.** An Ownpace operator is
not automatically anybody at the identity provider: `setup-zitadel.sh` creates
the machine user and gives no human a role, deliberately — it cannot know which
human before they have signed in once, the same chicken-and-egg as the operator
appointment. So the People links land on a console that refuses to load until
that account is an org owner there:

```bash
PAT="$(docker compose -f deploy/compose/managed.yml run --rm -T zitadel-machinekey cat /machinekey/pat.txt | tr -d '\r\n')"
curl -sS -X POST "$JWT_ISSUER/management/v1/orgs/me/members" \
  -H "Authorization: Bearer $PAT" -H "Content-Type: application/json" \
  -d '{"userId":"<the operator subject>","roles":["ORG_OWNER"]}'
```

The console session is also separate from the app's, so sign in at
`$JWT_ISSUER/ui/console` once before the deep links work.

**One open request per address.** Somebody may ask again after a decision —
that is information, and migration 0002 kept it deliberately — but a second
knock while the first is unanswered is not recorded twice. They are told exactly
what they were told the first time, because a different answer is a way to find
out which addresses have asked. Migration 0020's partial index is where that
rule lives: the knock is anonymous and cannot read the queue to check.

**Granting somebody who already owns an organisation is refused.** Granting is
an unconditional new organisation, so a double press would leave one person
owning two, and the app then has to ask them which they meant on every sign-in.
The refusal names what they already own; sending `alsoCreateSecondOrganisation`
goes ahead, for the case where a second one is genuinely wanted.

**Multiple owners are allowed**, and are the sensible arrangement for anything
that outlives one person. The database refuses to leave an organisation with
none: the last owner can be neither demoted nor removed, and only an owner may
promote somebody to owner. An **admin** can do everything an owner can except
arm a deletion, close the account, and make another owner.

### 8d. The status page *(comes up with the stack)*

`gatus` starts with everything else in the `app` phase (workplan 0094). It
listens on `STATUS_PORT` (default `3124`); put it behind the reverse proxy at
`status.<your domain>` alongside the app.

```bash
curl -fsS "http://localhost:${STATUS_PORT:-3124}/health"
```

**This section said "starts with everything else" from the day it was written,
and it was not true.** `gatus` was named nowhere in `bootstrap-managed.sh`, so
no bring-up had ever started it — the same thing that happened to `zitadel` for
three weeks, and found the same way, by reading `docker ps` on the Spark and
noticing what was not in it. `scripts/every-service-somebody-starts.unit.test.ts`
now compares `managed.yml`'s service list against the bring-up's, so a service
defined and never started fails a test instead of quietly not existing.

**Read [`status-page.md`](./status-page.md) before you trust a green light.**
This page runs INSIDE the stack it watches, so it cannot tell you the stack is
down — when the box is off, the page is off. It answers three narrower questions
honestly: is a provider down (the usual cause of a stalled migration), is part
of Ownpace unwell while the rest serves, and was there an outage recently. The
page says this itself, in the button beside its heading.

What it watches is `deploy/compose/gatus.yaml` — in git, reviewed, and edited
with a restart rather than through a web console.

**Who it tells** (workplan 0142 T1). With `ALERT_ENABLED=true`, a row of the
Ownpace group that stays red for three minutes sends the owner one e-mail, and a
second when it is green again. It goes through the product's own relay, from
`NOTIFY_FROM` to `NOTIFY_TO`, unless `ALERT_SMTP_HOST`, `ALERT_SMTP_PORT`,
`ALERT_SMTP_USER`, `ALERT_SMTP_PASSWORD`, `ALERT_FROM` or `ALERT_TO` say
otherwise. Turn it on for live, once its relay is set, and leave it off on the
OTA stack, whose web app and API the nightly gate recreates on schedule. Apply
a change with `docker compose -f deploy/compose/managed.yml up -d gatus`.
`ALERT_SMTP_PORT` must be a number: with a word there the page does not load.
[`status-page.md`](./status-page.md), *Who is told*, says what an alert cannot
tell you.

### 8e. Migrating **from** Google — what your own OAuth application carries

Two different Googles show up in this document and conflating them costs an
afternoon, so name them once:

| | Google as **identity** | Google as a **source** |
|---|---|---|
| What it does | somebody signs in to Ownpace with their Google account | Ownpace reads their mail, calendar, contacts, tasks or files |
| Where it is set up | §8b, `IDP_GOOGLE_CLIENT_ID` — a Zitadel identity provider | here, the OAuth client the migration consent runs against |
| What it proves | who this person is | what this account let us read |
| Boundary | [ADR-0042](./adr/0042-who-holds-the-passwords.md): the issuer owns identity, `tenant_member` owns tenancy | [ADR-0041](./adr/0041-who-owns-the-oauth-client.md): the deployment owns its own client |

The same two exist for Microsoft, and the confusion is the same shape (the
owner, 2026-09-06): `IDP_MICROSOFT_CLIENT_ID` signs people in, `MICROSOFT_OAUTH_CLIENT_ID`
reads their mailbox, and one Entra registration may serve both when both
redirect URIs are on it — the sign-in one from the table in §8b, the consent one
from the app's Redirect URIs page.

Signing in with Google puts nobody in an organisation, and a Google grant
signs nobody in. They are separate all the way down.

#### The one setting: `GOOGLE_ACCOUNT_SCOPE_CLASS`

A **Google account** source is one connection row wearing several faces — one
address, one credential, one consent, and the object types you tick. Which
faces it may wear here is a fact about **this deployment's own Google
application**, and the deployment declares it:

| value | one account consent may ask for |
|---|---|
| unset (the default), or `sensitive` | calendar, contacts, tasks |
| `restricted` | mail, calendar, contacts, files, tasks |

The split is Google's pricing of its own scopes, not a limit of this product.
Calendar and CardDAV are *sensitive* — brand review, free — and Tasks'
`tasks.readonly` is believed to be (workplan 0126; the console confirms it). Gmail's
`https://mail.google.com/` and `drive.readonly` are *restricted*, which needs
an annual third-party security assessment
([`google-oauth-verification.md`](./google-oauth-verification.md)). The client
Ownpace publishes to strangers offers three faces until that assessment is
actually paid for; a deployment whose owner registered their own application
and accepts the tier answers for itself.

**Mail and files are migratable either way.** With the narrow default they are
the `gmail` and `google-drive` sources, each asking its own one scope. What
`restricted` buys is *one* consent instead of three.

**Grant links follow the same setting.** A link for a Gmail or Drive source
that stores no Google client of its own runs its consent through this
deployment's application, so it is issued only where `restricted` is declared.
Calendars, contacts and tasks need nothing. A source with its own client uses
that client, whatever this says ([grant links](./grant-links.md)).

```bash
# in deploy/compose/.env
GOOGLE_ACCOUNT_SCOPE_CLASS=restricted
```

Restart the API afterwards. **No web rebuild** — unlike the `VITE_*` values in
§8b, the wizard asks the API what this deployment serves
(`GET /api/provider-accounts`) rather than having it compiled in, so the
account card and its tick boxes follow the setting on the next page load.
There is deliberately no `VITE_` twin: two separately settable copies of one
fact is how a screen comes to offer what the server then refuses.

#### Nobody has to paste a client secret

Registering the client is one job; typing it into a wizard once per connection
is another, and the second one is transcription work with a secret in it. Set
the pair once and the wizard stops asking:

```bash
# in deploy/compose/.env
GOOGLE_OAUTH_CLIENT_ID=…apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=…
```

**The connection then stores neither** (owner decision, 2026-09-01). It keeps
only the refresh token — the per-account half, the one that says whose data
this is — and the client is read at the moment a token is minted. Rotating the
secret at Google is therefore this one edit and a restart, not an edit per
connection.

**And the wizard knows.** `GET /api/provider-accounts` answers
`client: deployment` once both halves are set, so the wizard — and the
Connections page's add-form — fold the Client ID and client secret away behind
*Use your own Google application instead*, enable *Connect with Google* without
them, and leave the address, the token and the button as the whole form. Open
the fold and enter both to use your own client; enter one and it asks for the
other rather than pairing it with the deployment's. The shared-drive browse
behind a Drive source follows the same rule: the token alone is enough.

**A connection that carries its own pair still wins.** A customer who
registered their own Google application keeps using it; this is a fallback,
never an override ([ADR-0041](./adr/0041-who-owns-the-oauth-client.md)).

**Both or neither.** A client id with no secret cannot exchange an
authorization code, so half of it is refused with the missing name rather than
failing at Google's token endpoint hours later. The same rule holds for a
connection's *own* pair, at every door — the wizard, the API, the add-form, a
rotation and the consent itself alike: half of one is refused where it is
sent, never completed with the deployment's other half. The rotation panel
therefore offers the Client ID beside the secret, so a rotated pair is a pair.

**Two places, and the second is the one that bites.** `managed.yml` passes
them to the API; **`set-task-env.sh` uploads them to the worker**, because a
Trigger.dev task container inherits nothing from compose. Wire only the first
and everything visible works — the consent is built, Google approves it, the
connection tests green — while every sync pass fails to mint a token in a log
nobody is watching. So after changing either value:

```bash
./deploy/compose/set-task-env.sh
./deploy/compose/deploy-tasks.sh
```

#### A declaration is not a capability

Setting it does not make Google grant anything. If the application has not
**registered** those scopes, Google refuses at its own consent screen — with
the scope string in hand, which is a good failure. The bad one, which this
avoids, is a consent silently narrowed to two faces and a migration that turns
out weeks later never to have included mail.

So at Google, once, for the client this deployment uses:

1. **Google Cloud Console → APIs & Services → Library.** Enable the API behind
   each face: **CalDAV API** (calendar), **Google Contacts CardDAV API**
   (contacts), **Google Tasks API** (tasks), **Google Drive API** (files), and
   **Gmail API** — not for IMAP, which needs none, but so the
   `https://mail.google.com/` scope is listed in the consent screen's scope
   picker rather than pasted in. A consent goes through without
   any of these; the face whose switch is off refuses its first request with
   `accessNotConfigured`, and *Test connection* shows Google's sentence naming
   the API and the page (the owner met the CalDAV one on 2026-09-02, after a
   clean consent).
2. **APIs & Services → OAuth consent screen.** Add
   `https://mail.google.com/` and `https://www.googleapis.com/auth/drive.readonly`
   to the scopes, beside the calendar, CardDAV and `tasks.readonly` ones.
3. **Credentials → your OAuth client → Authorised redirect URIs.** It must
   carry `https://<your API host>/api/migrations/google/callback` — the exact
   string, which `POST /api/migrations/google/authorize` also returns so the
   wizard can show it.
4. **`API_URL` must be the address the API is reached at from OUTSIDE**, because the
   redirect is built from it. The example ships `API_URL=http://localhost:3001`,
   and with the default `VITE_API_URL=/api` the API is actually reached on the
   same origin as the app — so on a real deployment it is your app's address:

   ```bash
   ./deploy/compose/env-upsert.sh deploy/compose/.env API_URL=https://app.example.eu
   ./deploy/compose/bootstrap-managed.sh --only app
   ```

   Leave it at localhost and Google answers `redirect_uri_mismatch`. Registering
   the loopback address instead does not help: the redirect is followed by the
   **person's own browser**, so it would send them to port 3001 of whatever
   machine they are sitting at. The consent route refuses this combination up
   front now, naming the exact string to register — but the fix is here.
4. **Publishing status.** See the warning below before choosing.

#### The seven days, which is the one that bites later

In **External + Testing**, Google expires refresh tokens after **seven days**.
Nothing fails at consent time; the migration works, and then dies weeks later
with `invalid_grant` on a schedule nobody changed.
`google-token-provider.ts` names that cause first when it fails, and this is
the moment to avoid needing it: set the consent screen to **Production** for a
personal Google account, or **Internal** for a Workspace one, before any real
migration. Testing with up to 100 listed users is fine for *trying* the
button — it is not a publishing status to run a customer on.

#### What it looks like when it worked

- The **Google account** card on step 1 of the wizard offers five object types
  instead of three, and its hint stops mentioning a security review.
- The consent button asks for exactly the ticked faces — never more, and never
  fewer without saying so.
- The connection's **qualification badges** report each face separately, read
  from the grant Google actually issued rather than from what was asked. A
  face you ticked and Google did not grant shows as a measured no, with the
  remedy: asking is granting, so adding it means re-consenting.

#### The deployment's own Dropbox app (2026-09-02)

The same idea, for Dropbox: set the pair once and *Connect with Dropbox* appears
in the wizard and on the Connections page, with the App key and secret folded
away behind *Use your own Dropbox app instead*.

1. **[Dropbox App Console](https://www.dropbox.com/developers/apps) → Create app**
   → *Scoped access* → *Full Dropbox*. **Permissions**: `files.metadata.read`
   and `files.content.read`, nothing else — the app is read-only by
   construction, and a consent asked through it can grant no more.
2. **Settings → OAuth 2 → Redirect URIs.** Add
   `https://<your API host>/api/migrations/dropbox/callback` — the exact
   string `GET /api/redirect-uris` lists (the app's *Redirect URIs* page shows
   it), built from `API_URL` like Google's. Dropbox refuses a consent whose
   redirect is not registered, at its own screen.
3. **The pair, in `deploy/compose/.env`:**

   ```bash
   ./deploy/compose/env-upsert.sh deploy/compose/.env \
     DROPBOX_OAUTH_CLIENT_ID=<App key> \
     DROPBOX_OAUTH_CLIENT_SECRET=<App secret>
   ./deploy/compose/bootstrap-managed.sh --only app
   ./deploy/compose/set-task-env.sh
   ./deploy/compose/deploy-tasks.sh
   ```

   The last two are the same second place that bites for Google: a task
   container inherits nothing from compose, and a pair the worker cannot see
   is a consent that succeeds and a migration that cannot mint a token.

Every rule of the Google pair holds: the connection stores neither half; a
connection's own pair wins; both or neither, refused as half a pair at the
consent, the create door, the mapping door and the rotation panel alike; and
the pair is handed only to a Dropbox row — `clientId`/`clientSecret` are shared
key names, and a Google connection is never given Dropbox's app. `GET
/api/provider-clients` answers `dropbox: deployment` once both halves are set,
which is what the wizard reads before it offers the button.

#### The deployment's own Entra registration (workplan 0114)

The same idea a third time, for Microsoft — and with **one extra value nobody
else has**, which is where this one goes wrong.

1. **[Entra admin centre](https://entra.microsoft.com) → App registrations →
   New registration.**

   **Supported account types: *multitenant + personal Microsoft accounts*.**
   Read that again before clicking. A single-tenant registration works for
   you, works in your testing, works for everyone in your own directory, and
   fails for the first customer in another organisation with
   `AADSTS700016: Application with identifier '…' was not found in the
   directory '…'` — which reads like a typo in the client id and is not one.
   No value in `.env` can compensate: `MICROSOFT_OAUTH_TENANT` chooses the
   *authority*, and no authority finds an application the registration never
   offered to that directory.

2. **API permissions → Microsoft Graph → Delegated:** `Mail.Read`,
   `Calendars.Read`, `Contacts.Read`, `Files.Read`, `offline_access`. Nothing
   else, and specifically **not** the `.All` variants — `Files.Read.All` reads
   the whole tenant's OneDrive where `Files.Read` reads the signed-in user's
   own. Do **not** grant admin consent: these are delegated, and the person
   being migrated approves them for themselves, which is the point of the
   button.

3. **Authentication → Redirect URIs, platform *Web*.** Add
   `https://<your API host>/api/migrations/microsoft/callback` — the exact
   string `GET /api/redirect-uris` lists, built from `API_URL` like the other
   two.

4. **The pair, and the tenant, in `deploy/compose/.env`:**

   ```bash
   ./deploy/compose/env-upsert.sh deploy/compose/.env \
     MICROSOFT_OAUTH_CLIENT_ID=<Application (client) ID> \
     MICROSOFT_OAUTH_CLIENT_SECRET=<the secret VALUE, not its id>
   ./deploy/compose/bootstrap-managed.sh --only app
   ./deploy/compose/set-task-env.sh
   ./deploy/compose/deploy-tasks.sh
   ```

   **Leave `MICROSOFT_OAUTH_TENANT` empty** unless the registration is
   deliberately single-tenant; empty means `common`, which is what a
   deployment serving other organisations needs. Entra shows a client secret's
   **Value** once — copy it then, not its Secret ID.

   The last two commands are the same second place that bites for Google and
   Dropbox: a task container inherits nothing from compose, and a pair the
   worker cannot see is a consent that succeeds and a migration that cannot
   mint a token. The tenant travels with the pair for the same reason — the
   authorize and token halves must use one authority.

Every rule of the other two pairs holds: the connection stores neither half; a
connection's own pair wins, and its own `tenantId` travels with it rather than
being replaced by the deployment's; both or neither, refused as half a pair at
every door; and the pair is handed only to a `microsoft` row. `GET
/api/provider-clients` answers `microsoft: deployment` once both halves are
set, which is what the wizard reads before it offers the button.

**What a customer sees when their tenant says no.** Two refusals are a tenant
policy rather than anything you configured: `AADSTS65001` (an administrator
must approve the application first) and `AADSTS90094` (the tenant forbids user
consent entirely). Both render as sentences, so the person knows to ask
somebody rather than press the button again. `docs/microsoft-setup.md` is the
customer-facing version of all of this.

### 8f. Problem reports — by mail, or your own Zammad

"Report a problem", beside Sign out, sends a customer's report to a person
(workplan 0130): what they wrote, the page they were on (without any link
secret), the reference and kind of error on their screen, and a screenshot if
they add one. It goes one of two ways. While neither is set up, the link is not
shown at all.

**By mail, to your support mailbox** (the owner's choice for the alpha,
2026-09-28). This needs nothing but the mail settings the API already sends
with (`SMTP_*` and `NOTIFY_FROM`, see *Mail: caught, not delivered* below) and
one address:

```
REPORT_MAIL_TO=support@ownpace.eu
```

Each report is one plain-text mail through that same relay, with the same TLS
rules as every other mail the API sends: from `NOTIFY_FROM`, to
`REPORT_MAIL_TO`, titled *Ownpace: <the first line they wrote>*. The body is
what they wrote and then the facts, one per line: `Page`, `Reference` and
`Category` when there is one (the error on their screen, which the log page
finds), `Organisation`, `Build`, `Reply to` (the customer's sign-in address) and
`Report reference`, the report's own. Its **Reply-To** is that sign-in address
too, so pressing Reply should answer them. With `NOTIFY_FROM` and
`REPORT_MAIL_TO` both `support@ownpace.eu`, as on live, the mail goes from the
mailbox to itself, and a mail client may answer such a mail to its own address;
check the To field before you send, and if it shows the support address, write
to the body's `Reply to` address instead. The screenshot is attached, after the
same check of its first bytes a Zammad ticket gets. There is no ticket number,
so the customer is told the *report reference* instead, and that the reply
comes by email; search the mailbox for it when they quote it (the log page
does not know it). An empty `REPORT_MAIL_TO` sends reports to `NOTIFY_TO`, so
on a stack still pointed at Mailpit the form works and Mailpit catches them.

**The relay is shared.** On live, the API's relay login is the one the identity
provider sends its sign-in codes with (workplan 0133). So at most 50 report
mails a day go out, for the signed-in form and **Report this link** together;
past that, a report is refused with *try again tomorrow*, and the API's log
says `report mails a day are used up`. A send the relay does not answer is
given up on within about twenty seconds, and the customer gets a reference, as
for a refusal. Set `REPORT_MAIL_TO` while the mail is still off and the API's
log says `problem reports are switched off` with what is missing.

**On your own, self-hosted Zammad**, the long-term plan. When `ZAMMAD_URL` and
`ZAMMAD_TOKEN` are both set, every report becomes a ticket there instead, and
the mail is not used. The customer is the ticket's customer, so your reply from
Zammad reaches them by email. In Zammad:

1. As an admin, allow API tokens: **Settings → System → API → Token Access**.
2. As the agent the tickets should come from, create a personal token with the
   `ticket.agent` permission: **your profile → Token Access**. Give that agent
   access to the group in step 3.
3. Note the group new reports should land in (`Users` is the one a fresh Zammad
   starts with).

Then in `deploy/compose/.env`:

```
ZAMMAD_URL='https://help.example.eu'
ZAMMAD_TOKEN='<the token from step 2>'
ZAMMAD_GROUP='Users'
```

Only https is accepted (http only for `localhost`): the token travels with every
ticket. Set wrongly, the form is off, not sent by mail, and the API's log says
`problem reports are switched off` with the reason.

Either way, change the value in the checkout whose `.env` it is, in place rather
than appended, and recreate the API from there. `docker compose restart` does
not read `.env` again; this does:

```bash
docker compose -f deploy/compose/managed.yml up -d --wait api
```

Sign in, and the link appears; send yourself a test report with a screenshot. A
report the relay or Zammad refuses is answered with a reference, and recorded
for the log page as `report.not-delivered`. Send one through the public name
with a screenshot close to 5 MB too, the form's maximum, which makes a request
of about 7 MB, and a mail or a ticket of the same size from the API to the
relay or to Zammad. A smaller screenshot shows neither of the two ways it can
fail (*Which address a port answers on*, above):

- **Refused before the API sees it:** a 413 or a dropped connection from a
  front on the app's name. The form asks for a smaller screenshot, or says
  *Network Error*, and nothing is recorded.
- **Answered with a reference:** the API took the report and the relay or
  Zammad's side refused it. The log page shows `report.not-delivered`, and the
  API's log line with that reference says why: `Zammad answered 413` is a front
  on `ZAMMAD_URL`'s name with a limit below 8 MB, not the app's.

The form waits two minutes for the answer. From a line with less than about
0.6 Mbit/s of upstream, a report this large runs out of time first, and the
form says it cannot tell whether the report arrived: look in the support
mailbox, or on the helpdesk, before you send it again.

The same settings switch on **Report this link** on the grant and progress
pages (workplan 0108 T8 (d)). Somebody who doubts a link they were sent tells
you, not the organisation that sent it. It is titled *Ownpace: a grant link was
reported* (or *a progress link*). First the facts, one line each: the link's id
(never the link), the organisation and migration with their ids, who issued the
link, from, to, and whether access was given. Then, under *What they wrote*, the
reporter's own words. A reply address is optional; when given, it is typed, not
verified. In Zammad the ticket is an **internal note** in the same group: a
given address is its customer, so a reply you write reaches it, and without one
the ticket is filed under the user your `ZAMMAD_TOKEN` belongs to and the note
says nobody can be answered. By mail there is no internal note, so the mail
has **no Reply-To**, even when an address was given: Reply would quote the
facts to an address anybody could have typed. Its first line says so. To
answer, write a new mail to the address on its `Reply to` line, and leave the
facts out. Three reports a day per link, thirty an hour for every link
together, and by mail the day's 50 above.

### 8g. The alpha note *(only on the stack testers use)*

While the service is an alpha (workplan 0131 T1), every tester is told so: a
note at the top of every signed-in page and under the title of the sign-in and
request pages, and a paragraph at the end of the access-granted mail, in
English and Dutch. It is off unless you set it, and you set it only on the
stack testers use:

```
OWNPACE_STAGE=alpha
BACKUP_RETENTION_DAYS=7
```

The web bundle bakes the stage in at build time and the API reads both at
start, so rebuild and recreate both:

```bash
GIT_SHA=$(git rev-parse --short HEAD) \
  docker compose -f deploy/compose/managed.yml up -d --build --wait api web
```

Open the sign-in page: the note is under the title. Empty, or any value but
`alpha`, is no note and no paragraph. The appliance never shows it.

The second line is the alpha's other half: the days the erasure sentence says a
copy may still hold a closing organisation's data. The alpha takes no backups,
apart from one copy of live's databases made right before each update and kept
until that update is proven, never longer than seven days (workplan 0134 open
question 1 (b), and workplan 0139, the owner's answer rec-copies (a), both of
2026-09-28), so live sets `7`. `deploy-live.sh` takes the copy
(`copy-before-update.sh take`, *`ownpace-live`: a release tag, with
`deploy-live.sh`*), you delete it once the update is proven
(`./deploy/compose/copy-before-update.sh delete`), and the daily duties delete
it once it is older than six days less an hour whatever happens (*Live's daily
duties*), so it is never kept past its seventh day. A stack that keeps no copy
at all sets `0`, and the sentence then names none; a blank reads as seven days
whether or not a copy exists. With `OWNPACE_STAGE=alpha` the API refuses to
start while it is blank, and the refusal names it. `stand-up-live.sh` refuses
live's `.env` with anything but a whole number above 0. Read it back; on live
this prints `7`:

```bash
docker compose -f deploy/compose/managed.yml exec api printenv BACKUP_RETENTION_DAYS
```

A stack that moves from `0` to a number of days later, because it starts
keeping a copy, does so before the first invitation, or only while no
organisation closed under `0` still waits for its purge: its erasure record
keeps the `0` it was given, and a copy taken before that purge would hold its
rows while the tester was told the erasure is complete (workplan 0134 T0).

### 8h. A person to write to *(only on the stack testers use)*

A tester who is stuck before signing in cannot reach the report form (8f): it
needs a session. So the stack testers use names an address a person reads
(workplan 0144 T6 (a)). With it set, the sign-in, request, callback and
invitation pages carry one line, *"Stuck? Mail … and name the page you are on.
Never send a password."*, in English and Dutch, with the address as a mail
link. Signed in, the sidebar shows *Help: …* where *Report a problem* would be,
for as long as the form is off. Empty shows nothing new.

```
VITE_SUPPORT_EMAIL=support@example.eu
```

The web bundle bakes it in at build time, so rebuild the web image:

```bash
GIT_SHA=$(git rev-parse --short HEAD) \
  docker compose -f deploy/compose/managed.yml up -d --build --wait web
```

Open the sign-in page: the line is above the status link.

### 9. `tasks` — the task environment, then the deploy

```bash
./deploy/compose/set-task-env.sh
./deploy/compose/deploy-tasks.sh
```

**Deploying to a non-production environment.** One Trigger instance can serve a test stack and a
production stack side by side — a project has several environments, and each has its own secret
key, its own deployed task version and its own runs. To move a stack onto one of them:

1. **Take that environment's key** from the dashboard (project → API keys) and put it in
   `deploy/compose/.env` as `TRIGGER_SECRET_KEY`. This is the key the **api** enqueues with.
2. **Set `TRIGGER_ENV`** in the same file to that environment's name (`prod` is the default).
   **One name does all three** — the deploy target, the task variables, and the key
   `trigger-credentials.sh` reads. Until 2026-08-31 the other two read `TRIGGER_ENV_SLUG`,
   so this step moved the deploy alone and this list was the way to find that out; the old
   name is still honoured, once, out loud.
3. **Restart the api** so it picks up the new key:
   `docker compose -f deploy/compose/managed.yml up -d api`
4. **Re-upload the task environment variables**, which are stored per environment and do not
   follow the key: `./deploy/compose/set-task-env.sh`
5. **Re-deploy the tasks**: `./deploy/compose/deploy-tasks.sh`

Steps 1 and 2 must name the **same** environment. If they disagree, nothing errors — the deploy
succeeds, the enqueue succeeds, and the runs simply never meet a deployed task, leaving a queue
that grows beside a dashboard that looks idle. `deploy-tasks.sh` refuses the two combinations
that are unambiguously that mistake; it cannot catch every one, because only the `tr_prod_` key
prefix is known here.

Step 4 is the one most easily forgotten, and its failure is the one the script's own header
already warns about: *"a task that lands before its environment exists runs once against no
database and fails in a way that reads like a broken task."*


**Environment before deploy, deliberately.** Task containers inherit
**nothing** from compose: a run gets only what the Trigger.dev platform stores
for the project's environment. `set-task-env.sh` uploads `DATABASE_URL`,
`APP_DATABASE_URL`, `SECRET_ENCRYPTION_KEY` and the
optional `OAUTH2_*` / `SMTP_*` / `NOTIFY_*` from `.env`, with `override: true`
so a stale dashboard value cannot win over a rotated file. The addresses it
uploads are **in-network** (`pgbouncer:6432` by default), because runners
join the compose network — `localhost` there would point a task at itself.
The eight per-tenant tasks (a sync pass and the rest a migration asks for)
read and write tenant data through `APP_DATABASE_URL`, as `app_user`, and a run
without it refuses to start, naming it (workplan 0138 T1). So do the digest,
the drift detector and group discovery, which read each organisation there too
and read only their list of organisations with `DATABASE_URL` (workplan 0138
T2); the other three scheduled jobs connect with `DATABASE_URL`, and every task
that opens `openTaskPools` reads its audit key with it.
It also uploads `OWNPACE_REACHABLE_HOSTS`, and deletes it from the plane when
`.env` leaves it empty, so the tasks admit exactly the names the API does.
It does not upload `DIRECT_DATABASE_URL` (workplan 0138 T3 step 1): that is the
database owner straight to Postgres, and no task reads it. A plane that received
it before that change still holds it; see
[once, after the pull that stopped uploading it](#once-after-the-pull-that-stopped-uploading-direct_database_url).

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

## The public site is a separate stack, and it must be told which one it is

`bootstrap-managed.sh` does not bring the site up — `deploy/compose/www.yml` is
its own stack, deliberately, so that taking the app down does not take the site
with it. To publish or re-publish:

```bash
OWNPACE_APP_URL=https://app.ota.ownpace.eu node site/build.mjs   # test (OTA)
OWNPACE_APP_URL=https://app.ownpace.eu     node site/build.mjs   # production
docker compose -f deploy/compose/www.yml up -d
```

**A second copy beside it names its own project, with `-p`.** `ownpace-www`,
`www.yml`'s project, is a default, and the container is named after the
project. A copy from another checkout is brought up with
`docker compose -p <name> -f deploy/compose/www.yml up -d`, takes the same `-p`
on its `ps`, `logs` and `down`, and has a `WWW_PORT` and a `WWW_BIND` of its
own in that checkout's `.env`. Not `COMPOSE_PROJECT_NAME`: `www.yml` reads the
same `.env` as `managed.yml`, where that key names the stack, so a bare command
in live's checkout would put the site in live's own project (workplan 0139
T10). Nothing refuses that any more: it used to fail on the OTA site's fixed
container name, and now succeeds once live's `.env` has its own `WWW_PORT`.

`site/dist` is bind-mounted read-only, so a rebuild is live immediately and no
restart is needed — because the build **empties** `dist` rather than replacing
it. A bind mount resolves to an inode at container start, so a build that
removed and recreated the directory would leave nginx holding an unlinked one:
`total 0` inside the container, every file present outside, and a 403 on every
request that reads like a permissions problem. If that ever happens,
`docker compose -f deploy/compose/www.yml up -d --force-recreate` re-resolves
the mount (for a second copy, with its own `-p`).

`--public` and `OWNPACE_APP_URL` must agree, and the build refuses if they do
not: a public build must point at the production app, and a test build must
not. A `--public` build with unfilled legal placeholders is refused too — the
output used to claim "every placeholder must be filled" and then publish
anyway. So is one while a legal page it renders says on its *Version* line
that it is a draft or not yet published, naming the file (workplan 0139 T2).
Today every one of them does, until the owner's final text replaces it.
`--public --check` refuses it as well: it prints how many legal pages are
marked draft and exits 1, so a check run before a deploy stops what the build
would stop. Its last line is still the placeholder count.

**`OWNPACE_APP_URL` has no default and the build refuses without it.** It is
where every *Request access* button points, and the environment is a domain
level (workplan 0091). It used to default to production, on the argument that a
forgotten variable should land on the safe side. On 2026-08-24 the OTA site was
rebuilt without it, and every button on `www.ota.ownpace.eu` pointed at
`https://app.ownpace.eu/request-access` — a click on the *test* site filing a
real access request against the real tenant. The build that forgets is by
definition the one whose value is not the default, so a default can only ever
be wrong silently. Neither side is the safe side; being told is.

If you are ever unsure which environment a served `dist` was built for, read the
host out of a *Request access* link in the page source.

### `www.ownpace.eu`: live's copy

The commands above are the OTA site's (`www.ota.ownpace.eu`, the container
`ownpace-www`, from `~/ownpace-managed`), and they stay as they are. During the
alpha the reference machine also serves the production site, `www.ownpace.eu`
(workplan 0139 T0 fact 6). **That copy is served from live's own checkout, at
the release tag, and once `WWW_LIVE=true` switches it on, `deploy-live.sh`
builds and starts it with every deploy of live.** The texts a tester accepts
are then the release's (0139 T3), and the footer names that release. A fix to a
text rides a new tag and a deploy, with the hold, like any other change.

**Only `deploy-live.sh` builds it, and every `docker compose` command for it
carries `-p ownpace-live-www`.** Live's `.env` sets
`COMPOSE_PROJECT_NAME=ownpace-live`, and `www.yml` reads that `.env`, so
`docker compose -f deploy/compose/www.yml up -d` there, without `-p`, puts the
site in live's own project. There each file sees the other's containers as
orphans, and one `--remove-orphans` from either removes live or the site.
Nothing in a compose file can refuse that. So live's copy has one project,
`ownpace-live-www` (live's project with `-www`). `deploy-live.sh` and
`www-live.sh` build that name from live's project themselves. Each
`docker compose` command you type for the site carries that `-p` and live's
`--env-file`, and is typed exactly as given: the ones under *Looking at it*,
below, the incident runbook's restart, and the `down` after switching it off.
A build by hand in `~/ownpace-live` is not one of them: `site/dist` is
bind-mounted, so it would be served at once, without the deploy's checks.
`deploy-live.sh` refuses to deploy while a container of live's project has the
compose service `www`, and the daily duty `site` (*Live's daily duties*) fails
on it too.

**Keep `WWW_LIVE=false` until the legal texts are final.** With it `true`,
every deploy, and every dry run, test-builds the tag's site with `--public`
before anything moves, and a site that build refuses stops the whole deploy,
the app's release with it. Today's texts are refused: they still have unfilled
placeholders. And every legal text's version line says it is a draft (*draft
for legal review*, *concept voor juridische toetsing*): a tag whose
`site/build.mjs` has 0139 T2's draft check refuses that with `--public` by
itself, and its `--public --check` exits 1 on it too. So with `WWW_LIVE=true`
and today's texts, `deploy-live.sh` refuses before the checkout, and live does
not move at all. Switch it on with the first tag whose texts are final.

**Switching it on,** once the texts are final and live stands. It publishes an
**indexable** site (`--public`: no `noindex`, and `robots.txt` says
`Allow: /`). That follows the owner's answer to 0139 open question 1, (a), on
2026-09-28: *"public site: yes, search engine index."* So 0139 T10 (c)'s
`--no-drafts` is not needed.

1. The tag. Cut it from a `main` whose `www.yml` names the container after its
   project (0139 T10 (b)) and whose legal texts are final: no unfilled
   placeholder, and no version line that says draft. From any checkout, this
   writes nothing, must exit 0, and its last line must say
   `0 unfilled placeholder(s)`:

   ```bash
   OWNPACE_APP_URL=https://app.ownpace.eu node site/build.mjs --public --check
   ```

   `--check` is not the `--public` build itself, which may refuse what
   `--check` does not repeat. Step 3's dry run runs that full build too.

2. Live's `.env`, from `~/ownpace-live`:

   ```bash
   ./deploy/compose/env-upsert.sh ~/.persistent/ownpace-live/.env \
     WWW_LIVE=true WWW_PORT=<a port of its own> WWW_BIND=<the value WEB_BIND has>
   ```

   `WWW_PORT` must be a port nothing else on the machine publishes, and not the
   OTA site's (3125 unless its `.env` says otherwise). `WWW_BIND` is the address
   the front connects to, the value `WEB_BIND` has, so `EXPOSURE_ALLOW` needs
   nothing new. Add `WWW_PORT` to the repository variable
   `EXPOSURE_PROBE_LIVE_PORTS`, and for the status page's *Website* row set
   `STATUS_SITE_ENABLED=true` and `STATUS_SITE_URL=https://www.ownpace.eu`.
3. Deploy as usual (*`ownpace-live`: a release tag, with `deploy-live.sh`*,
   below). `--dry-run` runs the site's refusals too: a `WWW_LIVE` that is
   neither `true` nor `false`, no `WWW_PORT` or `WWW_BIND`, a `WWW_PORT` that
   is not one port from 1 to 65535, a `www` service in live's project, a tag
   whose `www.yml` gives the container a fixed name, a tag whose site still
   has unfilled placeholders, named by their count, and a tag whose `--public`
   build refuses for any other reason, with its last words.
   It learns the last two by test-building the tag's own site from git's
   objects (`git archive` of `site/` and `package.json`) in a directory of its
   own, which it removes, before anything moves: `--public --check` for the
   count, then the full `--public` build, the same one the deploy runs after
   the checkout, whose exit code decides. A dry run runs that test build too;
   it builds nothing in the checkout. After the bring-up the deploy
   builds the site in the checkout
   (`OWNPACE_APP_URL=https://app.ownpace.eu GIT_SHA=<commit> node site/build.mjs --public`),
   brings it up with
   `docker compose -p ownpace-live-www -f deploy/compose/www.yml --env-file deploy/compose/.env up -d --force-recreate`
   (a `WWW_PORT` another container publishes makes this `up` fail, and the
   site's step stops there), waits until it is healthy, and asks it on
   loopback at `WWW_PORT`: `/` answers 200 without `noindex`, has at least one
   request-access link, and every one leads to `https://app.ownpace.eu`; and
   `robots.txt` allows. Then the exposure check runs, over the site too. **A
   site that fails any of that is a deploy that did not take** (exit 3, the
   hold stays on), as any other check: an app on a new release beside the old
   release's texts is not a deploy that took.
4. Route `www.ownpace.eu` to live's `WWW_PORT` in NetBird, as in 0132 T1e.
   Then dispatch *Exposure probe* with `site_name` set to `required`. Until
   then leave it at `report`, its default: the name points at another host
   before the route, and the probe tries no port on an address of it that is
   not live's front (an address a production name or `EXPOSURE_PROBE_HOST`
   resolves to), and does not ask 443 for it.

`deploy-live.sh` runs the copy the checkout had before it moved, so the site
step runs from the first deploy started from a checkout that already has it. If
live runs a tag from before this step, deploy the new tag, then run
`./deploy/compose/deploy-live.sh <that same tag>` once more, the hold still on:
the checkout is already there, and this time the site comes up.

**Looking at it,** from `~/ownpace-live`, each `docker compose` command with
the `-p` (`www-live.sh` builds the name itself):

```bash
./deploy/compose/www-live.sh check
docker compose -p ownpace-live-www -f deploy/compose/www.yml --env-file deploy/compose/.env ps
docker compose -p ownpace-live-www -f deploy/compose/www.yml --env-file deploy/compose/.env logs --tail 100
```

`www-live.sh check` is the daily duty: read-only, it fails when live's project
holds a `www` service and, with `WWW_LIVE=true`, when `ownpace-live-www` is not
running and healthy. Restarting it as it is, when its container is gone or
stuck (after a reboot whose bind failed, say), is the incident runbook's
*Website* row, with the same `-p`. **Switching it off** (`WWW_LIVE=false`) makes the next
deploys leave the site alone, and leaves `ownpace-live-www` running what it
last served, the texts of an older release. Take it down then, with the same
`-p`: `docker compose -p ownpace-live-www -f deploy/compose/www.yml --env-file
deploy/compose/.env down`.

## What cannot work on a mesh-only host

A box that is reachable only over a private mesh (NetBird, Tailscale, a
WireGuard peer address) serves everything **your browser** asks of it, and
nothing that **somebody else's server** has to ask of it. That one rule
decides the following, and it is better read here than discovered:

- **Mollie's payment webhooks.** `API_URL` is the address Mollie's servers call
  to confirm a payment. A mesh address is not reachable by them, so payments
  complete on Mollie's side while invoices never leave `sent`. That is why the
  API refuses to boot in production with `MOLLIE_API_KEY` set and a
  localhost `API_URL` (phase 2 above). Billing end to end needs a publicly
  reachable host, and nobody has walked that journey on a mesh-only one.
- **Google's verification fetch.** The OAuth verification review reads the
  privacy policy and the home page from the public internet; a mesh-only
  `www` is invisible to it. **The redirect URI is the one exception**: Google
  302s *the browser* there and never resolves that host itself, so a consent
  round trip works on the mesh while the review does not. The exception does
  not extend to anything else on the domain.
- **Anything else that expects an inbound connection from a third party** —
  a provider's callback, a status checker somebody else runs, a mail server
  delivering to you. Same rule each time: our browser, fine; their server,
  not.

None of this is a defect to fix on the box. It is what a mesh is for. When
one of these has to work, the piece that needs it moves to a host with a
public address, and the mesh keeps everything that never needed one.

## Mail: caught, not delivered

Every mail this stack sends goes to **Mailpit**, a catcher on the compose
network.

**Two different things send mail, and they are configured separately.** The API
sends its notifications — an access request, a grant, a decline — and, without
a Zammad, problem reports (8f), and reads
`SMTP_HOST` and friends from `.env` via `managed.yml`; the tasks send the digest
with the same settings, once `set-task-env.sh` has uploaded them (below). The
**identity provider sends its own**: the verification link on a new account, an
email-change confirmation, a password reset, the invitation to set a first
password. None of that goes through the API. `setup-zitadel.sh` configures it
from the same `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` and
`NOTIFY_FROM`, so there is one relay setting rather than two that can drift —
but it only runs during the `app` phase, so a stack brought up before
2026-08-25 has an issuer with **no email provider at all**, silently dropping
every one of those.

Its TLS does not follow `SMTP_SECURE`, which sets the API's transport alone. It
is on for any relay and off only for the catcher (`SMTP_HOST=mailpit`), because
the identity provider with TLS off never tries STARTTLS: on 587 it would send the
relay's login in the clear, or be refused. With TLS on it tries implicit TLS and
falls back to STARTTLS, which covers 465 and 587 alike (workplan 0133 T2).

Until then the failure looks like a broken product rather than an unconfigured
one: the account is created, the screen says to check your mail, and Mailpit
stays empty.

`setup-zitadel.sh` finds the stack's provider by its description, the compose
project's name, and updates it on every `app` phase to what `.env` says: the
sender, the host, TLS, the user, and the password when one is set. An empty
`SMTP_PASSWORD` keeps the one stored. So a login added or changed later reaches
the issuer at the next `--only app`. Where an earlier `SMTP_HOST` change left
several providers with the stack's name, the active one is updated and the
others are named for you to remove in the console. A refused update is said,
and the bring-up goes on.

### Is it actually pointed at the catcher?

```bash
grep -E '^(SMTP_HOST|SMTP_PORT|SMTP_SECURE|NOTIFY_FROM|NOTIFY_TO)=' deploy/compose/.env
```

For the OTA/dev stack you want:

```
SMTP_HOST=mailpit
SMTP_PORT=1025
NOTIFY_FROM=ownpace@ownpace.invalid
NOTIFY_TO=operator@ownpace.invalid
```

An **absent or empty `SMTP_HOST` means the channel is off** — for both senders,
and by design: a deployment that has not chosen a relay is not misconfigured. It
is also indistinguishable from a broken one unless you look here. `.env` files
copied from an older `managed.env.example` predate these keys entirely, so an
empty result means "never configured", not "deliberately disabled".

What the containers actually got, which is the only thing that matters:

```bash
docker compose -f deploy/compose/managed.yml exec api printenv SMTP_HOST SMTP_PORT NOTIFY_FROM
./deploy/compose/setup-zitadel.sh --print
```

After changing any of them: `./deploy/compose/bootstrap-managed.sh --only app`
(the API reads them at boot, and the issuer's provider is written by
`setup-zitadel.sh` inside that phase).

### Reading what it caught

Mailpit is bound to **loopback only** (`127.0.0.1:3127`), which is not an
oversight and not something to "fix" by opening it up. It has no authentication
of any kind, and what it holds is every verification link and password reset the
stack sends — an unauthenticated reader of those, on a box with a public name,
is an account-takeover primitive. So it is reached from the box itself, or
through a tunnel:

```bash
# On the box
curl -s localhost:3127/api/v1/messages | head -c 400

# From your laptop — then open http://localhost:3127
ssh -N -L 3127:127.0.0.1:3127 you@the-box
```

`MAILPIT_PORT` moves the port. `MAILPIT_BIND` moves the interface, and its
default is loopback.

#### Reaching it over a private mesh, without a tunnel every time

A WireGuard peer address — NetBird, Tailscale — is **not** the same thing as
`0.0.0.0`. It is reachable only by devices holding a key for that network, which
is an authentication boundary Mailpit does not have to provide itself. So it is
a legitimate place to publish the catcher, and the shipped default stays
loopback for everyone who does not ask. Substitute this box's own mesh address
for `100.64.0.1`, which is an example of the shape and reaches nothing:

```bash
./deploy/compose/env-upsert.sh deploy/compose/.env MAILPIT_BIND=100.64.0.1
docker compose -f deploy/compose/managed.yml up -d mailpit
```

Then http://100.64.0.1:3127 from any device on the mesh.

That command **recreates the container**, and what it already caught survives
it: Mailpit writes to `mailpit_data` rather than to memory, so verification
links, email-change confirmations and password resets are still there
afterwards — as they are after a version bump, or after any other edit to
`managed.yml` that replaces the container. The store is capped at
`MP_MAX_MESSAGES` (500), which is what stops a volume nothing prunes from
becoming the next thing to fill the disk.

Two things that stay true after you do it:

- **It is still unauthenticated to everyone ON that mesh.** The question moves
  from "who can route to this box" to "who is on this network" — and a default
  peer-to-peer policy includes every device you enroll later. If the answer is
  more than one person, give Mailpit its own password as well
  (`MP_UI_AUTH_FILE`).
- **A public name is still the wrong answer.** `mail.example.com` with public
  DNS and a certificate publishes every password-reset link this stack sends to
  whoever finds it. `0.0.0.0` — and a bind variable with no default, which is
  the same mistake by omission — are refused by a rule in
  `scripts/the-mail-the-issuer-could-not-send.unit.test.ts` rather than by
  convention.

**Mailpit is for OTA and development only.** It is in `managed.yml` because
every environment that is not production wants its mail caught rather than
delivered. A production stack points `SMTP_HOST` at a real relay and never
starts this service: the bring-up starts it only with `--with-demo`, whose
Nextcloud sends to it, or while `SMTP_HOST` is `mailpit` (workplan 0133 T3). A
catcher still running from before the relay was set is named, with the command
that stops it, and never stopped by the bring-up: read and delete what it caught
first.

**A catcher rather than a relay, on purpose.** Every mail the product sends is
visible in a browser; the gate exercises grant, decline and now request on every
nightly run, and none of it can reach a real inbox. `NOTIFY_FROM` and
`NOTIFY_TO` default to `…@ownpace.invalid` — RFC 2606 reserved, so if these ever
reach a real relay the result is a bounce rather than mail to a stranger.

**For real delivery**, point `SMTP_HOST` at a relay, set `SMTP_PORT` /
`SMTP_SECURE` to match and `SMTP_USER` / `SMTP_PASSWORD` to its login, and set
`NOTIFY_TO` to an address a person reads. A relay refuses the example's
`.invalid` addresses, so the bring-up says so while `NOTIFY_FROM` or `NOTIFY_TO`
still ends in one. The identity provider takes the same
relay, login and sender, with TLS on whatever `SMTP_SECURE` says. Then apply it:

- `./deploy/compose/bootstrap-managed.sh --only app` updates the identity
  provider's mail provider to it, and recreates the API with it;
- `./deploy/compose/set-task-env.sh` hands it to the tasks — task containers
  inherit nothing from compose, so a value only in `.env` is a value the digest
  will never see.

`bootstrap-managed.sh` says so out loud when `SMTP_HOST` is still the catcher
and `WEB_URL` is an https origin that is not localhost: every send would report
`sent`, because it *was* sent — to a server whose job is to keep it.

**Somebody knocking now reaches you.** Until 2026-08-24,
`POST /api/access-requests` inserted a row, wrote one log line and told nobody:
the queue was the intended channel, which works exactly as well as somebody's
habit of opening it. It now sends `access_requested` to `NOTIFY_TO`, carrying
the address, organisation and tier — **not** the applicant's note, which stays
in the database behind authentication where the queue shows it. When no channel
is configured the API logs, per request, that nobody was told.

### Before a relay: passing mail on by hand

Decided 2026-09-24 (workplan 0133 D2): until the stack testers use sends
through a real relay, you read each tester's mail in that stack's Mailpit and
pass on what they need. This is a procedure, not a setting.

**Not used on `ownpace-live`.** On 2026-09-28 the owner chose a relay from
day one (workplan 0133 open question 5: *"mail at the start: real mail relay
day one."*). Nobody is invited to live until its `.env` names the relay (0133 T3)
and one outside mailbox has been walked end to end (0133 T4), so no tester's
mail is caught there and nothing below is passed on. `stand-up-live.sh` refuses
live's `.env` with `SMTP_HOST` empty or `mailpit` (step 6 of *Standing up
ownpace-live*), so live is never brought up on the catcher. The procedure is
kept in case that changes.

**Where it would apply.** Only on `ownpace-live`, the stack testers use (0132
D7), and only while its `.env` names no relay (0133 T3). Since the owner's
answer, that is never: the relay goes in live's `.env` from the start, so the
tag live is brought up from must carry 0133 T2 (TLS for the identity provider)
and 0135 T1 and T2 (so live's identity provider never offers public
organisation registration, and its project admits its own organisation only).
Without 0133 T2 the identity provider takes its `tls` from `SMTP_SECURE`, which
stays empty for a relay on 587: it connects in plain text, a relay that takes a
login only over TLS refuses it, and the identity provider's codes reach neither
an inbox nor a catcher while the API's mail arrives. Starting live on the
catcher and switching at 0133 T3 was the other way, and 0133's open question 5
recommended it; the owner chose the relay instead. The OTA stack's Mailpit
never holds a tester's mail: it is the nightly gate's, and the smoke reads it
every night. Were live ever to run a catcher, it would be its own: since 0132 T1
(#1233) every container, volume and network is named after its compose project,
so live's catcher would run in live's project beside the OTA stack's, on the
`MAILPIT_PORT` live's `.env` gives it.

**Where each mail lands.** With `SMTP_HOST=mailpit`, every mail below lands in
that stack's Mailpit, whoever it is addressed to, and none reaches an inbox:

- the API's, over the compose network to `mailpit:1025`;
- the tasks', once `set-task-env.sh` has uploaded the SMTP settings. Task runs
  join the network `DOCKER_RUNNER_NETWORKS` names, where `mailpit` resolves:
  the stack's own `<project>_ownpace-network` since 0132 T1.
  Without the upload the tasks send nothing, and say so in their log;
- the identity provider's, through the provider `setup-zitadel.sh` made for
  `mailpit:1025`.

Mailpit keeps what it caught in `mailpit_data`, up to 500 messages. Every send
reports `sent`, so the access queue says *"We emailed {email}."* although
nobody outside the box has it. `managed.yml` gives Mailpit no relay, so it
cannot send anything on: you copy what is needed into a mail from your own
mailbox.

**Mail addressed to a tester.**

| Mail | Sent by, and when | Carries a code | What you do |
|---|---|---|---|
| *Ownpace — your access is ready* (`access_granted`; Dutch *uw toegang staat klaar*) | The API, when you grant their request, in the language they asked in | No. It says it is safe to forward. | Forward it to the address it was sent to. Or write them the same three facts yourself (the app's address, the address to register with, and that they must confirm the confirmation mail), and on live copy the alpha paragraph from the caught mail word for word, in the language it was sent in. |
| *Ownpace — about your request* (`access_declined`; Dutch *over uw aanvraag*) | The API, when you decline with *Email them if you decline* ticked, which is the default | No | Forward it, or untick the box and write them yourself. |
| Verify your address | The identity provider, when they register, and at a first sign-in with Microsoft (above) | **Yes** | Pass the code on within the hour, by the rule below. |
| Password reset | The identity provider, when they ask for one | **Yes** | The same. |
| Password changed | The identity provider, after a reset or any other change of password | No | Nothing to pass on. |
| Email-change confirmation | The identity provider, to the new address | **Yes** | The same, to the new address. |
| The digest, *what needs your attention* | The tasks, at 08:00 UTC, daily or weekly as the organisation chooses, to its active owners and admins, and only when something waits | No | Nothing. The tester sees the same on screen. |

Each of the three codes lives one hour. In Zitadel v4.17.3's defaults,
`EmailVerificationCode` and `PasswordVerificationCode` expire after `1h`, and an
email change uses the first. `managed.yml` overrides neither; a change made in
the console would not show here. An account somebody creates for a person in
the console gets a mail to set a first password instead, and its code lives 72
hours. Testers register themselves, as the grant mail tells them to.

**Mail addressed to you.** These go to `NOTIFY_TO`, the operator's list, with
or without a relay:

- *Ownpace — somebody asked for access* (`access_requested`), from the API
  when somebody sends the request form. Nothing to pass on: the request is in
  the access queue.
- *Ownpace — a change needs your decision* (`decision_raised`), from the tasks'
  daily checks of a source's directory, even when the decision is in a tester's
  organisation. Nothing to pass on: the tester sees it in the app and in their
  digest.
- *Ownpace — the migration was rolled back* (`rollback_finished`), from the
  `run-rollback` task when you start it with `notifyUsers`. Despite the name, it
  goes to `NOTIFY_TO`. If the migration is a tester's, tell them yourself.

**Never mailed, relay or not.** An invitation to an organisation that exists:
`apps/api/src/routes/tenants/members.ts` records it and sends nothing. The
person finds it on the Invitations page when they sign in with that address,
verified, so whoever invited them tells them. A grant link: *"You send the
link. We never do."* ([grant-links.md](grant-links.md)).

**Not sent from any screen today.** The fallback announcement for shares carried
by hand (0104 T3). `POST /api/migrations/:mappingId/sharing/announce` mails each
grantee if it is called, and no screen in `apps/web` calls it. (A share applied
on the *Sharing checklist* is announced by the target's own invite, not by
Ownpace.)

**The one rule: a code goes by mail, and only to the address it was sent to.**
A granted organisation and an invitation both bind to an address the identity
provider verified (`claimRequestedMembership` and `pendingInvitations` in
`apps/api/src/middleware/auth.ts`). Sent on to that same address, your mail
still proves the tester reads that mailbox. Sent anywhere else, by chat or by
text message, it lets whoever receives it verify an address that may not be
theirs, and take what was meant for its owner.

**Only codes you are expecting.** Pass on a code only for an address you
granted and are waiting for. Leave any other code in Mailpit. Until public
organisation registration is closed at live's identity provider (0135 T0, T1),
such a code may belong to somebody founding an organisation of their own, and
passing it on completes the step that 0135 §4 says holds that chain back.

**Be there when they register.** Agree a moment with each tester, watch
Mailpit while they register, and pass the code on within the hour. If it
lapses, they ask for a new one, and you pass that one on. Do not lengthen the
lifetimes for this: a longer-lived code is a longer window for anybody who can
read the catcher.

**Tell them first.** The code will come from your own address, not from
Ownpace. Say so when you invite them, before they register. A code from an
unexpected sender looks like phishing, and a careful tester is right to
distrust it.

**Finding one tester's mail.** Live's `MAILPIT_PORT` is its own, not the OTA
stack's 3127. A search on an address also finds the `access_requested` notice
that names it, so keep only the mail addressed to it:

```bash
# On the box, in live's checkout (loopback, the default bind)
port="$(grep '^MAILPIT_PORT=' deploy/compose/.env | cut -d= -f2 | cut -d' ' -f1)"
addr=tester@example.org
curl -fsS --get "http://localhost:${port:?no MAILPIT_PORT in this .env}/api/v1/search" \
  --data-urlencode "query=${addr}" \
  | jq -r --arg a "$addr" '.messages[]? | select([.To[]?.Address] | index($a)) | "\(.Created)  \(.Subject)"'
```

Read the code itself on Mailpit's web page, through the tunnel above with
live's port, or at the mesh address if live's `MAILPIT_BIND` names one.

**When it ends.** Once 0133 T3 is done (it waits on T2's TLS for the identity
provider and on 0135 T0), and T4 has shown a code arriving in an outside inbox,
the mail reaches testers without you. Then empty live's Mailpit and stop it:
the codes have expired by then, but it still holds testers' addresses and
grant mails. From live's checkout, with `port` set as in the recipe above:

```bash
curl -fsS -X DELETE "http://localhost:${port:?no MAILPIT_PORT in this .env}/api/v1/messages"
docker compose -p ownpace-live -f deploy/compose/managed.yml stop mailpit
```

`-p ownpace-live` names live's project out loud. From live's checkout Compose
takes it from live's `.env` anyway (0132 T1); `-p` also wins over a shell that
exported the other stack's name, which would otherwise stop the catcher the
nightly gate reads. Once live's `SMTP_HOST` names the relay, the bring-up no
longer starts Mailpit (0133 T3 (b): only with `--with-demo` or
`SMTP_HOST=mailpit`), and while one still runs it says so on every run. It
does not stop it: that is this command, once.

## The CI runner is a different checkout from wherever you did this by hand

If you brought the stack up manually — following this document, on this same
machine — **that checkout and the CI runner's checkout are not the same
directory**, even on a self-hosted runner. `actions/checkout` clones into its
own workspace (typically `<runner>/_work/<repo>/<repo>`), and `deploy/compose/.env`
in your manual clone does nothing for a workflow running from there.

Worse: `actions/checkout` defaults to `clean: true`, which runs `git clean
-ffdx` before every checkout — the `-x` reaches gitignored files, `.env`
among them. So even hand-placing `.env` in the runner's checkout once does
not survive the *next* run. `e2e-managed.yml` now works around this by
persisting the one-time setup **outside** any checkout — at
`$MANAGED_ENV_PERSIST_DIR` (default `~/.persistent/<project>`, which for the
gate is `~/.persistent/ownpace-managed`, overridable as a repository variable) — and restoring it into
the checkout at the start of every run, before the refuse-early check.
Before it copies anything out of that directory, the restore asks
[`refuse-live-env.sh`](../deploy/compose/refuse-live-env.sh) whose `.env` it is,
and stops when it carries live's marker, `STACK_KIND=production`, or anything
that could be a slip of it (workplan 0132 T1g). So a variable pointed at live's
directory by mistake ends the run there, with nothing copied, written or brought
up, and the log names the key and the variable, never a value.

**Because neither checkout of the OTA stack sets `COMPOSE_PROJECT_NAME`, both
use `managed.yml`'s own project, and the containers are the same regardless of
which checkout ran the command that created them.** So if you already have a working manual stack,
the one-time setup for CI is not a second bring-up — it is copying your
already-correct `.env` into the persist directory:

```bash
mkdir -p ~/.persistent/ownpace-managed
cp deploy/compose/.env ~/.persistent/ownpace-managed/.env
cp deploy/compose/pgbouncer/userlist.txt ~/.persistent/ownpace-managed/userlist.txt
```

### One stack, one `.env`

Each stack has one `.env`. The operator's checkout of the OTA stack and the
gate's share one file, which is this section. `ownpace-live` has its own, in
`~/.persistent/ownpace-live/`, and the gate never restores it: pointed there, it
refuses before it copies anything (workplan 0132 T1b, T1g).

**Then replace your copy with a link, and do not skip this.** The `cp` above is
a one-time seed. Left as two files it becomes two *configurations* for one
stack, and they drift the moment either side writes — which both sides do:
`setup-zitadel.sh` writes the issuer and the rotated PAT expiry, and you write
whatever you tune by hand.

```bash
ln -sfn ~/.persistent/ownpace-managed/.env deploy/compose/.env
```

Only *your* checkout gets the link. The runner's cannot have one — `git clean
-ffdx` deletes it like any other ignored file — which is exactly why the
workflow restores a copy at the start of every run and persists it back at the
end.

**What it costs when they drift** (2026-08-24, workplan 0099). The `zitadel`
Postgres role's password matched the *runner's* copy. A hand-run bring-up
presented the other one, and Zitadel — which finds an existing role, logs
`user already exists, skipping creation`, and does **not** reset its password —
crash-looped. A crash-looping container is indistinguishable from a slow one
until the readiness deadline passes, so the answer arrived after 300 seconds of
silence, and it named a password nobody had changed. The same divergence had
`ZITADEL_PAT_EXPIRY` in one file describing a token the database did not have.

Three things now make that loud instead of silent:

- `bootstrap-managed.sh` lists any diverging keys **by name** at the top of
  every phase, including the `--from …` resumes that skip preflight. Names
  only — the values are secrets.
- It asks the `zitadel` role for its password **before** starting the
  container, so the answer takes a second rather than five minutes — and it
  asks over the container's **network address**, not the socket. See below:
  the first version of this check could not fail.

**The check that could not fail** (2026-08-24, same day, one bring-up later).
Both the preflight and `zitadel-db-password.sh` asked with
`psql -U zitadel` run inside the database container. That connects over the
**Unix socket**, and the official Postgres image's generated `pg_hba.conf` answers the
socket and `127.0.0.1` with `trust`: `PGPASSWORD` is never sent and never
looked at, so the query succeeds with *any* password. Both reported

> the zitadel role accepts the password in .env — nothing to do

three times across two runs — and Zitadel, connecting from its own container,
matched the appended `host all all all scram-sha-256` line instead and was
refused with `SQLSTATE 28P01`, five minutes later. The vacuous pass also
short-circuited the repair: `--sync` exits at the check, so the one command
that fixes this declined to run on the grounds that there was nothing to fix.

`managed.yml`'s own header had said so since 2026-07-25, about the
`openmigrate` role — "only a connection from another container's real IP
exercises the scram-sha-256 rule". Nobody carried it thirty lines down the same
file. Every query in `zitadel-db-password.sh` now goes to the container's real
address, refuses to run at all if it cannot resolve one, and **says which
address it asked over** in the passing message. There is one copy of the
question, and `bootstrap-managed.sh` calls it.
- `env-upsert.sh` **follows the link instead of replacing it**. Its write is
  write-temp-then-rename, and `mv -f tmp link` would silently turn the link
  back into a regular file — re-forking the two on the first `TRIGGER_CLI_PROFILE`
  or rotated PAT expiry, with nothing said.

If the role and your `.env` have already parted company:

```bash
./deploy/compose/zitadel-db-password.sh          # check, change nothing
./deploy/compose/zitadel-db-password.sh --sync   # point the ROLE at .env
```

Check the divergence list first. If a second `.env` exists, the role may be
matching *that* one, and syncing would break the other consumer instead of
fixing yours.

**What still could not break the link, and what could.** `env-upsert.sh` is now
the *only* thing that writes `.env`. `ensure-env-secrets.sh` used to write with
`sed -i`, which replaces a symlink with a regular file and leaves the canonical
copy **stale** — the 2026-08-24 divergence exactly, reintroduced by the script
that generates the credentials. It only ran when a key was absent, empty or a
placeholder, so an established `.env` never tripped it: the link would have
survived every ordinary bring-up and died on the first feature that added a new
required secret. `scripts/one-stack-one-env.unit.test.ts` now refuses `sed -i`
and `mv` aimed at the live `.env` anywhere under `deploy/compose/`, and runs
`sed -i` against a real symlink to show why.

The bring-up also reports two files **when they still agree**, not only once
they have drifted — quiet under CI, where `git clean -ffdx` makes a symlink
impossible and the advice would be untakeable.

**Do not run a fresh `bootstrap-managed.sh` or `ensure-env-secrets.sh` in the
CI checkout to "set it up independently.**" It would generate different
random secrets for the *same* containers your manual checkout is already
using — the same class of outage as rotating
`TRIGGER_ENCRYPTION_KEY` without a plan, self-inflicted on a stack that was
just proven working. Reuse what already works; only generate fresh secrets
when there is no working stack yet at all.

**The deploy CLI's login is the same gap, one phase later — and it has a
better answer than restoring a session file.** `deploy` reads
`TRIGGER_ACCESS_TOKEN` directly, before ever touching a profile file, and
this is the CLI's *own* documented answer for CI: unable to run the
interactive flow, it throws

> Authentication required in CI environment. Please set the
> TRIGGER_ACCESS_TOKEN environment variable with a Personal Access Token.

**Preferred**, one-time, in the GitHub UI: mint a token at the self-hosted
instance's own dashboard — *Account → Personal Access Tokens* — or reuse an
existing `tr_pat_…` from `${XDG_CONFIG_HOME:-$HOME/.config}/trigger/config.json`
if you already have one. Then, in the repository: **Settings → Secrets and
variables → Actions → New repository secret**, named `TRIGGER_ACCESS_TOKEN`.
`e2e-managed.yml` also sets `TRIGGER_API_URL` alongside it — required,
because unset, the CLI's env-var login path defaults to the SAAS cloud
(`api.trigger.dev`), not this instance.

**Fallback, if you would rather not mint a token:** the session file still
gets restored the same way `.env` does —

```bash
mkdir -p ~/.persistent/ownpace-managed
cp "${XDG_CONFIG_HOME:-$HOME/.config}/trigger/config.json" \
   ~/.persistent/ownpace-managed/trigger-cli-config.json
```

— though note `whoami` structurally cannot see `TRIGGER_ACCESS_TOKEN` (it
never reads that variable, only `deploy` does), so a manual bring-up that
sets the token will still print "not logged in" from `whoami` even though
`deploy` works fine. That asymmetry is the CLI's, not this repo's.

Neither path makes the login *itself* automatable — creating the account
and project is still the one step that opens a browser (0084 T6). Both only
let a credential obtained once survive to the next run.

## Standing up ownpace-live

`ownpace-live`, the stack testers use, is stood up once and deployed ever after
(workplan 0132 T1b to T1e). [`deploy-live.sh`](../deploy/compose/deploy-live.sh)
does every deploy after the first and cannot do the first: it reads the hold
from live's own database, which does not exist yet, and it takes the bring-up's
two stops for a deploy that did not take. The first bring-up is
[`stand-up-live.sh`](../deploy/compose/stand-up-live.sh): the phases of this
guide in order, with the steps only live has around them, each one refusing
what would be hard to undo. It stops twice for you, as the bring-up does, and
you run it again with `--resume`.

**Not yet run.** Live is not stood up, and the script has run only against the
stubs in its guard, `scripts/a-first-bring-up-of-live.unit.test.ts`. It runs
from the release tag live runs, so that tag has to carry it: cut the release
(0146 T0) from a commit of `main` that has this script, once the nightly gate
has run that commit green.

### Before the script: the owner's steps

No script can do these. The script checks each one before it changes anything.

1. **The machine** (*Before you start*): at least 15 GB free, the journald log
   driver, and the setting that lets a container publish on the front's address
   before the mesh has brought it up. Create
   `/etc/sysctl.d/90-bind-before-the-mesh.conf` holding
   `net.ipv4.ip_nonlocal_bind = 1`, then run `sudo sysctl --system` (*Which
   address a port answers on*). Live's web, sign-in and status ports are
   published on the front's address, so without it they may not start after a
   reboot.
2. **Nine ports of live's own**: `POSTGRES_PORT`, `TRIGGER_PORT`,
   `TRIGGER_TLS_PORT`, `ZITADEL_PORT`, `API_PORT`, `WEB_PORT`, `STATUS_PORT`,
   `REGISTRY_PORT` and `MAILPIT_PORT`. Each must be one the OTA stack does not
   use under any key (the script refuses any of its ports, its `NEXTCLOUD_PORT`
   and the site's `WWW_PORT` among them, whether or not the OTA stack is up),
   and one nothing on the machine listens on. `MAILPIT_PORT` too: live runs no
   catcher (its mail goes to a relay, step 6), but the bring-up starts one
   whenever `SMTP_HOST` is `mailpit`. The script refuses that, `deploy-live.sh`
   does not check it, and its default, 3127, is the OTA stack's. The one rule
   is that a port is live's when the bring-up starts its service for a setting
   live's `.env` can hold. The demo's `NEXTCLOUD_PORT` is not: Nextcloud starts
   only with `--with-demo`, which both scripts refuse. See what the OTA stack
   publishes from its checkout with
   `docker compose -f deploy/compose/managed.yml ps --format '{{.Service}} {{.Ports}}'`,
   and paste that output nowhere public.

   **A port in the kernel's ephemeral range is reserved first.** Linux gives an
   outgoing connection that does not choose its own source port one from
   `net.ipv4.ip_local_port_range` (`cat /proc/sys/net/ipv4/ip_local_port_range`;
   32768 to 60999 unless changed): an image pull, a lookup, a mail to the relay.
   A port live publishes inside that range can be held that way at the moment
   Docker binds it, after a reboot or at a recreate, and the container that
   publishes it then fails to start with *address already in use*. Nothing
   listens there beforehand, so no check of what listens sees it coming.
   `net.ipv4.ip_local_reserved_ports` takes ports out of that pool and still
   lets a program bind them on purpose. The script refuses every port live
   publishes (the nine, and any other `*_PORT` a `ports:` entry of
   `managed.yml` names but the demo's `NEXTCLOUD_PORT`) that lies in the range
   and is not reserved, on a resume too, names it with its number, and prints
   the line that fixes it. Once workplan 0139 T10 lands (on its own branch on
   2026-09-28), `deploy-live.sh` serves live's copy of `www.ownpace.eu` on
   `WWW_PORT` while live's `.env` says `WWW_LIVE=true`, and the script asks
   `WWW_PORT` then too; until then nothing reads `WWW_LIVE`. With live's ports
   at, say, 40101 to 40109 (example numbers):

   ```bash
   cat /proc/sys/net/ipv4/ip_local_reserved_ports    # reserved now: keep it
   echo 'net.ipv4.ip_local_reserved_ports = 40101-40109' | sudo tee /etc/sysctl.d/90-ownpace-reserved-ports.conf
   sudo sysctl --system
   cat /proc/sys/net/ipv4/ip_local_reserved_ports    # now with 40101-40109
   ```

   If the first line printed something, it goes in front, separated by a
   comma (`= 8080,40101-40109`); the kernel takes single ports and ranges. If
   another file in `/etc/sysctl.d` sets the key already, put the line in that
   file instead: `sysctl --system` reads them in name order, and the last to
   set a key wins. Ports below the range need nothing.
3. **The routes, before the bring-up** (0132 T1e). In NetBird, on the front's
   address and external port 443: `app.ownpace.eu` to live's `WEB_PORT`,
   `id.ownpace.eu` to live's `ZITADEL_PORT`, `status.ownpace.eu` to live's
   `STATUS_PORT`. Before, not after: the bring-up's sign-in setup
   (`setup-zitadel.sh`) reaches `id.ownpace.eu` by that name, the sign-in button
   and the API's token checks need it, and the script's last checks ask both
   names. The script refuses while any of the three does not resolve from the
   machine.
4. **The checkout**, from a fresh shell, at `~/ownpace-live` exactly (the daily
   duties' timer runs from there), parked on the release tag:

   ```bash
   unset COMPOSE_PROJECT_NAME
   git clone <repo-url> ~/ownpace-live && cd ~/ownpace-live
   git fetch --tags origin && git checkout --detach <tag>
   pnpm install --frozen-lockfile
   ```

5. **Live's `.env`**, copied first and linked after: the bring-up creates a
   `.env` only where there is none, and GNU `cp` does not write through a link
   to a missing file. Then the two lines the example leaves out on purpose, and
   a check that Compose takes live's project from it:

   ```bash
   mkdir -p ~/.persistent/ownpace-live
   cp deploy/compose/managed.env.example ~/.persistent/ownpace-live/.env
   chmod 600 ~/.persistent/ownpace-live/.env
   ln -sfn ~/.persistent/ownpace-live/.env deploy/compose/.env
   ./deploy/compose/env-upsert.sh deploy/compose/.env COMPOSE_PROJECT_NAME=ownpace-live STACK_KIND=production
   docker compose -f deploy/compose/managed.yml config --no-interpolate | sed -n 's/^name: //p'
   ```

   The last line prints `ownpace-live`.
6. **Live's settings**, in one call, with your own values in the angle
   brackets:

   ```bash
   ./deploy/compose/env-upsert.sh deploy/compose/.env \
     POSTGRES_PORT=<p> TRIGGER_PORT=<p> TRIGGER_TLS_PORT=<p> ZITADEL_PORT=<p> \
     API_PORT=<p> WEB_PORT=<p> STATUS_PORT=<p> REGISTRY_PORT=<p> MAILPIT_PORT=<p> \
     TRIGGER_API_ORIGIN=http://127.0.0.1:<TRIGGER_PORT> \
     TRIGGER_APP_ORIGIN=https://localhost:<TRIGGER_TLS_PORT> \
     TRIGGER_LOGIN_ORIGIN=https://localhost:<TRIGGER_TLS_PORT> \
     TRIGGER_CLI_PROFILE=ownpace-live \
     WEB_BIND=<front-address> ZITADEL_BIND=<front-address> STATUS_BIND=<front-address> \
     EXPOSURE_ALLOW=<address,address> \
     WEB_URL=https://app.ownpace.eu CORS_ORIGIN=https://app.ownpace.eu \
     ZITADEL_EXTERNALDOMAIN=id.ownpace.eu ZITADEL_EXTERNALPORT=443 \
     ZITADEL_EXTERNALSECURE=true ZITADEL_TLS_MODE=external \
     NODE_ENV=production OWNPACE_STAGE=alpha BACKUP_RETENTION_DAYS=7 \
     SMTP_HOST=<the relay's submission host> SMTP_PORT=587 SMTP_SECURE= \
     SMTP_USER=<the sending address> NOTIFY_FROM=<the sending address> \
     NOTIFY_TO=<an address you read> \
     VITE_SUPPORT_EMAIL=<an address you read>
   read -rs -p 'The relay token: ' t && printf 'SMTP_PASSWORD=%s\n' "$t" |
     ./deploy/compose/env-upsert.sh --stdin deploy/compose/.env; unset t
   ```

   `EXPOSURE_ALLOW` is every address any container on the machine is published
   on: both stacks' `*_BIND` values and the site's `WWW_BIND`, commas, no space,
   and no loopback address, which never needs listing. The script hands the
   list to `exposure-check.sh` itself, the check its last step and the daily
   duties run, so it takes the lists that check takes and refuses the ones it
   refuses. Leave `POSTGRES_BIND`, `API_BIND`, `TRIGGER_BIND`, `TRIGGER_ACCESS_TOKEN` and
   `OWNPACE_REACHABLE_HOSTS` empty, and keep `APP_DB_USER=app_user`. Write
   every line `KEY=value` at its start: Compose also reads a key indented, with
   a space before `=`, or with `:`, the script's checks do not, and it refuses
   such a line. `BACKUP_RETENTION_DAYS=7` is the most days a dump of live's
   databases taken before a deploy is kept, which the erasure sentence names
   (workplan 0134 open question 1 (b)); the script refuses it empty, `0`, or
   anything but a whole number above 0. `deploy-live.sh` takes that copy before
   each update, and it is deleted once the update is proven, or after six days
   less an hour by the daily duties (§8g; workplan 0139).

   **Mail goes through a real relay from the first day** (workplan 0133): live
   runs no catcher, and the sign-up's verification code is the first mail it
   sends, so *Before a relay: passing mail on by hand* is not for live.
   `SMTP_HOST` is the relay's submission host (Proton Mail's, for one, is
   `smtp.protonmail.ch`) and `SMTP_PORT` its submission port, 587, with
   `SMTP_SECURE` empty: the connection starts plain and STARTTLS turns it to
   TLS before the login. `SMTP_USER` is the relay's login, usually the sending
   address, and `SMTP_PASSWORD` a token the relay issues for that address,
   never the mailbox's own password; the `read` line puts it in on stdin, so
   it is on no command line. `NOTIFY_FROM` is the sending address, and
   `NOTIFY_TO` an address you read. The script refuses an `SMTP_HOST` that is
   empty or `mailpit`, an empty `SMTP_PORT` (the identity provider's setup
   would take the catcher's 1025), and a `NOTIFY_FROM` or `NOTIFY_TO` that is
   empty or ends in `.invalid`. Write these four bare, or in single quotes (a
   sender with a name, `'Ownpace <address>'`). The script refuses one in double
   quotes: Compose takes them off, and `env_value`, the reader of the script
   and of `setup-zitadel.sh`, keeps them, so `NOTIFY_TO=""` would pass the
   checks and reach the API as no address at all, and a relay's host in double
   quotes would reach the identity provider with them.

   `ZITADEL_EXTERNALDOMAIN` cannot be changed after the
   provider's first start. The database passwords are the script's (below). If
   you set your own first, it keeps them; use hex, because they go into URLs. A
   new owner role name (`POSTGRES_USER`) costs nothing on a new volume.

### The script

From `~/ownpace-live`:

```bash
./deploy/compose/stand-up-live.sh
```

**It refuses before it changes anything**, and names the key or the name, never
a value: `--with-demo`; a shell started with tracing on, or with `COMPOSE_FILE`,
`COMPOSE_ENV_FILES`, a `COMPOSE_PROJECT_NAME` the checkout does not choose, or
`MANAGED_ENV_PERSIST_DIR` pointing elsewhere; a checkout that is not
`~/ownpace-live`; a `.env` that is not a link to live's persisted file, or that
lacks `STACK_KIND=production` or `COMPOSE_PROJECT_NAME=ownpace-live`; a `HEAD` on
a branch, at no `v…` tag, or at a tag that is not a release by the rule
`deploy-live.sh` applies (`release-tag.sh`); a tag without `deploy-live.sh`,
`exposure-check.sh`, `box-duties.sh` and `stack-kind.sh`; a working tree that is
not clean; a deploy log with a line in it (live stands: use `deploy-live.sh`);
live's database volume already there without `--resume`; and, all listed at
once, a line of live's `.env` that sets a key in a form Compose reads and the
checks do not (indented, a space before `=`, or `:`), every setting from steps
2, 3 and 6 above that is wrong for live, a port that is any of the OTA stack's
under whatever key (read from its persisted `.env`, or the compose files'
default) or, on a first run, already in use, a port live publishes that lies in
the kernel's ephemeral range and is not reserved (step 2; that refusal names the
port, because its fix lists it), and a production name that does not resolve.

**What it does, in order:**

1. Generates `POSTGRES_PASSWORD`, `APP_DB_PASSWORD`, `CLICKHOUSE_PASSWORD`,
   `MINIO_ROOT_PASSWORD` and `TRIGGER_DB_PASSWORD` (Trigger.dev's own database,
   0132 T2) with `openssl rand -hex 24`, each one that is empty or a value this
   repository publishes and whose volume does not exist yet, through
   `env-upsert.sh --stdin`: on no command line, and never printed (D8).
2. `bootstrap-managed.sh --only preflight`, `--only env`, a check that the
   rendered `DOCKER_RUNNER_NETWORKS` is `ownpace-live_ownpace-network` (D9), and
   `--only data`.
3. Creates `app_user` from `APP_DB_PASSWORD` before anything migrates, the
   statement on psql's stdin: the baseline migration creates it with a
   published password only when it does not exist.
4. Asks live's database over live's own network, as every container does
   (0132 T2 step 2): the two controls must open, and the three published values
   must not.
5. `bootstrap-managed.sh --from trigger`. That stops twice, and the script exits
   2 each time, saying what to do:
   - **live's own Trigger.dev account**, organisation and project, on its
     dashboard at `https://localhost:<TRIGGER_TLS_PORT>` on the machine, or
     through `ssh -N -L <TRIGGER_TLS_PORT>:127.0.0.1:<TRIGGER_TLS_PORT> <you>@<machine>`
     from a laptop (not tried yet), with `./deploy/compose/trigger-magic-link.sh`
     for the link;
   - **the deploy CLI's login** under live's own profile: the `npx … login`
     line the bring-up prints (Chromium worked where Firefox did not).

   After each, run `./deploy/compose/stand-up-live.sh --resume`, not the resume
   line the bring-up printed. On a resume every step asks whether it is done
   first: no password is generated twice, `app_user` is not created twice, and
   each bring-up phase skips what it finds done. There is no state file.
6. Puts `apps/worker/package.json` back when the task deploy stripped only its
   last newline.
7. The checks: `/api/version` at `app.ownpace.eu` names the tag's commit and
   version, `/api/ready` answers 200, `/api/auth/mode` answers `managed`,
   `NODE_ENV` is `production` in the api container, `id.ownpace.eu` names
   itself as the issuer, live's two networks exist and share no container with
   the OTA stack's, and `exposure-check.sh` passes. Run it in daytime: the
   appliance nightly's dev Nextcloud publishes on every interface while it
   runs.
8. Appends the first line of `~/.persistent/ownpace-live/deploys.log`, in
   `deploy-live.sh`'s format: the date, the tag, the commit, `took`, `one-way`.
9. Copies the two units of *Live's daily duties* to `~/.config/systemd/user`
   and runs `systemctl --user daemon-reload`.
10. Prints what is left, below.

It exits 0 when live stands, 1 when it refused (nothing changed), 2 at a stop
(do what it says, then `--resume`), and 3 when a step after the start failed:
it says which and logs nothing; fix it and run it again with `--resume`.

### After the script: the owner's steps

1. **Sign up** at `https://app.ownpace.eu`, with an address you read. The
   identity provider sends the verification code through live's relay, the
   first mail live sends. Live runs no catcher: if the code does not arrive,
   the `zitadel` service's log and the relay's say why.
2. **Become the operator.** Your `userId` from `/api/me` (8c), then
   `./deploy/compose/operator.sh add <userId> <your email> "owner"` and
   `./deploy/compose/operator.sh list`, which names you and nobody else.
3. **The daily duties** (*Live's daily duties*, below): the units are in place,
   so `sudo loginctl enable-linger "$USER"`, then
   `systemctl --user enable --now ownpace-box-duties.timer`, one
   `systemctl --user start ownpace-box-duties.service`, and the journal: all
   five duties pass.
4. **Rehearse the next deploy.** Open a hold on the support screen with a Dutch
   sentence, wait five minutes, then `./deploy/compose/deploy-live.sh --dry-run <tag>`:
   every refusal passes, it says reversible (the same tag), and nothing moves.
   Lift the hold. Every deploy from here on is `deploy-live.sh`.
5. **The outside probe.** Set the repository variable
   `EXPOSURE_PROBE_LIVE_PORTS` to live's published ports, and dispatch the
   *Exposure probe* workflow.
6. **The record.** The date, the tag and each check's outcome, never a value, in
   workplan 0132's Status block (T0 step 6).

## Live's daily duties

The nightly gate keeps the OTA stack alive as a side effect of testing it. Two
of `e2e-managed.yml`'s steps are maintenance: `setup-zitadel.sh` runs the
identity provider's provisioning token's clock (the token lives seven days, a
run replaces it in its last three, and past its deadline no successor can be
minted), and `trigger-version.sh drill` dumps the Trigger.dev database and
proves the dump loads. CI never touches live (workplan 0132 T1g), so live has
[`box-duties.sh`](../deploy/compose/box-duties.sh), run once a day from
`~/ownpace-live` by a systemd timer (0132 T7). **The drill is not one of
them:** it runs on the test stack only, in the gate (workplan 0139, the
owner's answer rec-drill (a) of 2026-09-28). On live it kept a daily dump of
the task runner's database, and live keeps one copy of its databases, made
right before an update; `trigger-version.sh` refuses `drill` there. It does
five duties, each one whatever the one before it did:

| Duty | What it runs | What it does |
|---|---|---|
| `token` | `setup-zitadel.sh --token-only` | The token's clock and nothing else: no secrets generated, the provider not started or reconfigured. It writes `ZITADEL_PAT_EXPIRY`, as every run does. |
| `copies` | `copy-before-update.sh expire` | The backstop of the copy made before an update (workplan 0139), in `~/.persistent/ownpace-live/copy-before-update`: deleted once it is older than six days less an hour, whether or not its update was proven, so it is never kept past day 7, even when this run starts late; a dump made there by hand goes by its own age. The run before the one that deletes it keeps it and fails the duty, saying to roll back from it today or to delete it (the operator runbook's *The copy before an update*). It reads no database. The copy is **secret-bearing** (testers' data, the provider's password hashes); the scripts make it readable by this account only. |
| `exposure` | `exposure-check.sh` | Every port any container on the machine publishes, both stacks (0132 T3). Needs `EXPOSURE_ALLOW` in live's `.env`. |
| `organisations` | `setup-zitadel.sh --count-organisations` | 0135 T3's count on live's identity provider, read-only. A count that is not one fails the duty. |
| `site` | `www-live.sh check` | Read-only (0139 T10). Fails when a container of live's project has the compose service `www`, where a `www.yml` command without `-p` puts the site; and, when live's `.env` says `WWW_LIVE=true`, when `ownpace-live-www` is not running and healthy (*`www.ownpace.eu`: live's copy*). |

It exits 0 when all five pass, 1 naming every duty that failed, and 2 when it
refused before any duty: a `.env` without live's marker (the OTA stack's duties
are the gate's), a project the reader refuses, or an argument. A duty that runs
past 20 minutes (`BOX_DUTY_TIMEOUT`, in seconds) is a failed duty. Ctrl-C in a
run by hand, or a SIGTERM, stops the running duty, says which, starts no other
and exits 130 or 143. It prints no value from the `.env`, and this machine's
addresses in a duty's output, stdout and stderr alike, are replaced by the key
that holds them. Nobody is told when it fails (0142 is where that changes):
read the journal.

**Until the timer is installed,** run `./deploy/compose/setup-zitadel.sh
--token-only` from `~/ownpace-live` at least every three days. It replaces the
token only when fewer than three of its seven days remain, so a gap of four
days can miss that window.

**The units.** A user unit pair, run as the account that owns live's checkout
and reaches Docker. Both are in
[`deploy/compose/systemd/`](../deploy/compose/systemd/):

```ini
# ownpace-box-duties.service — live's daily duties (workplan 0132 T7): the
# provisioning token's clock, the backstop of the copy before an update
# (0139), the exposure check, the organisation count and the site's (0139
# T10). A user unit, started by
# ownpace-box-duties.timer; the install steps are in docs/managed-bring-up.md,
# "Live's daily duties".
[Unit]
Description=ownpace-live: the duties the nightly gate does for the OTA stack

[Service]
Type=oneshot
WorkingDirectory=%h/ownpace-live
ExecStart=%h/ownpace-live/deploy/compose/box-duties.sh
SyslogIdentifier=ownpace-box-duties
# Five duties of at most 20 minutes each (BOX_DUTY_TIMEOUT), and room to say
# which failed.
TimeoutStartSec=110min
```

```ini
# ownpace-box-duties.timer — once a day at 13:17 UTC, away from the appliance
# nightly (e2e.yml, 23:30 and 01:30 UTC, dispatched up to five hours late),
# whose dev Nextcloud publishes on every interface while it runs. A run missed
# while the machine was off runs at the next start (Persistent=true).
[Unit]
Description=ownpace-live: the daily duties, once a day

[Timer]
OnCalendar=*-*-* 13:17:00 UTC
Persistent=true

[Install]
WantedBy=timers.target
```

**Installing them,** once live stands (T1b to T1e), on the machine, as that
account:

```bash
# Once, as root: this account's timers run when nobody is signed in.
sudo loginctl enable-linger "$USER"

# Copied, not linked: a checkout of another tag must not change the timer.
mkdir -p ~/.config/systemd/user
cp ~/ownpace-live/deploy/compose/systemd/ownpace-box-duties.service \
   ~/ownpace-live/deploy/compose/systemd/ownpace-box-duties.timer \
   ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now ownpace-box-duties.timer

# When it fires next, then one run now, and what it said.
systemctl --user list-timers ownpace-box-duties.timer
systemctl --user start ownpace-box-duties.service
journalctl --user -u ownpace-box-duties -n 200 --no-pager
```

- **The journal.** A failure line is logged at the error priority, so
  `journalctl --user -u ownpace-box-duties -p err` shows only those. Where the
  user journal is not kept apart (a volatile journal), `sudo journalctl -t
  ownpace-box-duties` reads the same lines.
- **What it runs with.** The user manager's `PATH`, which holds `/usr/bin`:
  `docker`, `curl` and `jq` must be there, and the account must reach Docker
  (the `docker` group). `systemctl --user edit ownpace-box-duties.service`
  adds an `Environment=` line if not.
- **After a deploy that changed the units,** copy them again and run
  `systemctl --user daemon-reload`.
- **A run after a stop.** `Persistent=true` runs a missed day at the next
  start, which may fall inside the appliance nightly's hours; its dev
  Nextcloud then fails `exposure`, by name.
- **A rollback after a Trigger.dev upgrade.** `deploy-live.sh` takes the
  task runner's database into the copy before an update whose tag moves the
  Trigger.dev pin (`copy-before-update.sh take --trigger`). Restore it from
  there by its file name, as the operator runbook's *The copy before an
  update* says:
  `trigger-version.sh restore ~/.persistent/ownpace-live/copy-before-update/triggerdb-<stamp>-before-<tag>.sql.gz --yes`.
  On live `trigger-version.sh` writes and reads that directory only, and the
  copy's rules delete what is there.
- **Turning it off:** `systemctl --user disable --now ownpace-box-duties.timer`.
  Then nothing deletes the copy before an update, so `copy-before-update.sh
  take` refuses and no deploy moves live until the timer is active again. A
  copy already there stays until you delete it or the timer runs again:
  delete it by its seventh day yourself (workplan 0134 T0).

## When it goes wrong

| What you see | What it is | What to do |
| --- | --- | --- |
| `pgbouncer` logs `could not open auth_file … Permission denied`, then `no such user: pgbouncer_auth` | `userlist.txt` was written 0600 by the host user; PgBouncer reads it as a different user inside the container, finds no users, and rejects every login | `chmod 644 deploy/compose/pgbouncer/userlist.txt`, then force-recreate. `ensure-env-secrets.sh` now writes 644 and `--only data` repairs the mode |
| The seed or a host-run script talks to the wrong Postgres | On a shared host, `localhost:5432` may belong to something else entirely — this stack's Postgres is published wherever `POSTGRES_PORT` says | The `demo` phase asks `docker compose port postgres 5432` rather than trusting a default. For your own commands, do the same |
| `deploy-tasks.sh` proceeds past its own login check and then fails with `Unable to validate existing personal access token` / `Invalid or Missing Access Token` | `whoami` exits 0 whether or not you are actually logged in — confirmed from the CLI's own source, an auth failure returns data rather than throwing. A stale profile (e.g. left over after `reset-trigger.sh`) passes the check and only fails once `deploy` tries to use it | `npx -y trigger.dev@<version> login -a http://localhost:${TRIGGER_PORT:-3090} --profile <profile>`, then re-run. Fixed at the source in `trigger-cli-lib.sh`, which both scripts now use instead of trusting the exit code |
| `deploy-tasks.sh` says **`Not logged in`** while `trigger.dev login` answers **`You are already logged in`** | The instance's database was destroyed (a wipe, `down -v`, a rename cutover) but the CLI profile at `~/.config/trigger/config.json` is on the HOST and survived it. `login` sees a token in the profile and short-circuits without validating it against the instance, so it reports success for a token whose account no longer exists; `trigger_cli_logged_in()` reads `whoami`'s output properly and correctly says no. **`login` alone cannot fix this** — it never gets far enough to replace the token | `npx -y trigger.dev@<version> logout --profile <profile>` **first**, then `login` as above. If `logout` also short-circuits, delete the profile's entry from `~/.config/trigger/config.json`. **Until 2026-08-31 this symptom had a SECOND cause with the same appearance**: the detector piped `whoami`'s output into `grep -q`, which exits at the first match, so under `set -o pipefail` a long-enough answer killed the producer with SIGPIPE and the pipeline returned 141 for a match that had SUCCEEDED. Verified and fixed — it now reads from a here-string — so on a current checkout this row's cause is the only one left |
| `trigger-supervisor` is `Restarting`, its log says **`Unable to read worker token from file: EACCES … /home/node/shared/worker_token`**, and `up` aborts with `container <project>-trigger-supervisor is unhealthy` | trigger-api bootstraps the worker token into the shared volume as **root, mode 0600**; the supervisor reads it as **node**. On a FRESH `trigger_shared` volume — first install, or after a `down -v` — it cannot open its own credential. Everything else reports healthy, so the stack looks fine while dequeuing nothing | `docker compose -f deploy/compose/managed.yml exec -u 0 trigger-api chown node:node /home/node/shared/worker_token`, then `docker compose -f deploy/compose/managed.yml restart trigger-supervisor`. **chown, not `chmod 644`** — the token is a credential and root bypasses permissions anyway. `bootstrap-managed.sh`'s `trigger` phase now does this between trigger-api and the supervisor, so a fresh volume no longer needs the manual step |
| `set-task-env.sh` fails **`Invalid or Missing API key`** against a `proj_…` ref that looks right | Same cause, other credential: `TRIGGER_PROJECT_REF` and `TRIGGER_SECRET_KEY` in `.env` belong to the destroyed instance. `bootstrap-managed.sh`'s `account` phase **short-circuits when both are already set** (it cannot tell a stale value from a good one), so re-running bring-up never replaces them | `./deploy/compose/trigger-credentials.sh --write` — it reads the ref and the prod key out of the INSTANCE and upserts both, overwriting whatever `.env` held. Then re-run `set-task-env.sh` |
| A config fix to `pgbouncer.ini` seems to change nothing — same error after pulling | `pgbouncer.ini` is a bind mount read once at start-up, and `up -d` does not recreate a container whose spec has not changed, so the old process keeps running the old file | `docker compose -f deploy/compose/managed.yml up -d --force-recreate pgbouncer`. `--only data` now does this automatically when the container is unhealthy |
| `pgbouncer` log says `cannot use the reserved "pgbouncer" database as an auth_dbname` | `auth_user` set in the **global** `[pgbouncer]` section governs the admin console too, and the console's database name is reserved — so `auth_query` cannot run and every connection is refused. A per-database `auth_dbname` does not help: the console is not matched by `*` | Fixed by moving `auth_user` onto the `*` entry, where it applies to real databases only. `auth_dbname` there must equal `POSTGRES_DB`; `--only data` refuses if they disagree |
| `pgbouncer` reports `unhealthy` after ~80s, and its own log says the user is not allowed | The healthcheck reads `SHOW POOLS` from the admin console, which PgBouncer refuses to anyone not in `stats_users`/`admin_users` | Fixed in `pgbouncer/pgbouncer.ini` (`stats_users = pgbouncer_auth`). On an older checkout, pull and `--only data` |
| Any `docker compose` command fails with `required variable X is missing a value` | Compose interpolates the **whole** file before running anything, so one unset variable breaks every command — including ones that never touch the service named in the error. An `.env` that predates the pooler hits this on `PGBOUNCER_AUTH_PASSWORD` | `./deploy/compose/ensure-env-secrets.sh`, then `--only data` to create the matching Postgres role and start the pooler |
| `pgbouncer` never becomes healthy, complains about a password | `setup-auth.sql` has not run, or ran without `my.pw` set | `--only data`. The SQL now refuses an unset `my.pw` rather than creating a role with no password |
| Every app connection: `password authentication failed`, though `.env` and the container agree | A volume from a *different* project — compose's project name derived from the directory basename | `managed.yml` pins its project (`name: ownpace-managed`, which `COMPOSE_PROJECT_NAME` in the `.env` beside it overrides). Check `docker volume ls` for a stray `compose_postgres_data` |
| `trigger.dev login` prints an authorization URL on the https front, and **Firefox** answers *"De pagina verwijst niet op een juiste manier door"* / cannot connect to `<host>:3443`, while **Chromium completes the same URL** — both after clicking through the self-signed-certificate warning | **Observed 2026-08-31 on the Spark, and NOT root-caused — do not repeat the following as though it were the cause.** What is known: `trigger-tls` serves a self-signed certificate, the dashboard's session is a `Secure` cookie, and a session cookie that never sticks renders precisely as "isn't redirecting properly". Chromium and Firefox do not agree about what a connection whose certificate was manually overridden may do with cookies. Whether that is what happened here was not established, because the workaround cost nothing | Do the one-time login in Chromium. The token lands in the host's CLI profile and no browser is needed again, so this is one browser choice per machine and blocks nothing. **It says nothing about the PRODUCT's sign-in**, which is Zitadel on a real hostname with a real certificate — if that ever fails in one browser only, it is a different fault and this row is not it |
| **The product's sign-in never completes.** The right password comes back to the same sign-in page with no error on it; a **wrong** password still says so. Every user, every browser, and Zitadel's own log shows `POST /password` answering **200 with no redirect** — no token, no callback, nothing to see | Until 2026-08-31 `setup-zitadel.sh` turned self-registration on by writing the ORGANISATION's login policy with `POST /management/v1/policies/login`. That is Zitadel's `AddCustomLoginPolicy`: it mints a policy from the body it is handed and leaves the thirteen fields it was not handed at their proto3 defaults — which for the five `Duration` fields is **zero**. `passwordCheckLifetime: 0` means a password check is valid for no time at all, so Zitadel verifies the password, finds the verification already stale, and computes the password step again. The wrong-password path returns before the lifetime is ever consulted, which is why only the CORRECT password loops. The same custom policy shadows the instance policy wholesale, so it also hid the providers `configure_idp` had just put buttons on | Pull, then re-run `./deploy/compose/setup-zitadel.sh`. It now resets the organisation to the instance default and writes the three settings on the INSTANCE policy, echoing every lifetime the instance answered with — and it refuses, naming the field, if any of them is still zero. To repair a box without a checkout: read the token with `docker compose -f deploy/compose/managed.yml run --rm -T zitadel-machinekey cat /machinekey/pat.txt`, then `curl -sS -X DELETE $JWT_ISSUER/management/v1/policies/login -H "Authorization: Bearer $PAT"` — the organisation falls back to the instance default and sign-in works again immediately. **Do not re-run an OLD `setup-zitadel.sh` afterwards**: it would mint the same policy again |
| The `login` phase refuses, you run the printed command, it succeeds, and the phase refuses again | Two different things, both true: `TRIGGER_CLI_PROFILE` names the profile the phase asks for, and the CLI stores logins per profile NAME in `~/.config/trigger/config.json` on the host. Setting the variable does not create the login; logging in under the old name does not satisfy the new setting | Read the two lines the refusal prints — `in use` and `default`. Either log in under the name in use, or point the setting at a name the machine already has: `./deploy/compose/env-upsert.sh deploy/compose/.env TRIGGER_CLI_PROFILE=<name>`. Do not delete the other profile to tidy up; the gate's runner may be using it |
| `trigger-magic-link.sh` finds nothing | The link is only written when one is **requested** | Submit your email on the dashboard's login page first, then re-run |
| Dashboard loads but the login never completes | `TRIGGER_APP_ORIGIN` / `TRIGGER_LOGIN_ORIGIN` do not match the address the browser is using; the `Secure` cookie is dropped | Set both (and `TRIGGER_TLS_HOST`) to the real address, then `--from trigger` |
| `npx trigger.dev deploy` dies with a bare `Connection error` | The CLI was pointed at the https front | Log in against `http://localhost:3090` |
| `deploy` stops in the image build: `[indexer 2/2]` says *Failed to index deployment* and *Failed to fetch environment variables: Connection error* | The build cannot reach the Trigger.dev API. The CLI hands the build the origin the server advertises; it rewrites a `localhost` origin to `host.docker.internal`, the machine's first non-loopback IPv4 address, and the API answers on loopback only (workplan 0132 T3). E2E (managed) #201 stopped here | Fixed on `main` (2026-09-27): `managed.yml` advertises `http://127.0.0.1:<TRIGGER_PORT>`, and `deploy-tasks.sh` builds with `--network host`. On an older checkout, pull, then `docker compose -f deploy/compose/managed.yml up -d trigger-api` and deploy again. Never set `TRIGGER_BIND` for this: it would put the API on that address for everyone who can reach it |
| `deploy` says `Invalid or Missing Access Token` right after a successful login | `TRIGGER_ACCESS_TOKEN` was set without `TRIGGER_API_URL`, so the CLI validated a self-hosted token against the SaaS cloud | Fixed in `deploy-tasks.sh` (2026-09-03) — it now sets the URL from `TRIGGER_API_ORIGIN` on the deploy itself. On an older checkout: `TRIGGER_API_URL=http://localhost:3090 ./deploy/compose/deploy-tasks.sh` |
| `git status` shows `apps/worker/package.json` modified after a deploy | The Trigger.dev CLI rewrites the file — usually only stripping its trailing newline | `git diff` it; discard unless it is a real SDK bump. `deploy-tasks.sh` now says so rather than leaving you to find it |
| `Seed failed: DATABASE_URL, JWT_SECRET, SECRET_ENCRYPTION_KEY are not set` | The seed runs on the host and inherits nothing; nothing in `apps/api` loads a dotenv file | The refusal now names it: `./deploy/compose/seed-managed.sh`, which reads `.env` and asks compose for the published port. This row is the historical spelling — until 2026-08-25 the message named one variable and no remedy, which is how it reached this table instead of the operator |
| Demo owner tokens are rejected by the API | They expire after seven days | Re-run `./deploy/compose/seed-managed.sh` — it is idempotent and mints fresh ones |
| Supervisor loops on `Snapshot changed inside startRunAttempt`, runs pile up `EXECUTING`, runner containers accumulate | Almost certainly **not** about snapshots. Check `docker compose logs trigger-api` for `Unsupported state or unable to authenticate data` at `PrismaSecretStore.getSecrets` — that is `TRIGGER_ENCRYPTION_KEY` no longer matching the stored secrets | See "Rotating `TRIGGER_ENCRYPTION_KEY`" above. `set-task-env.sh` alone does not fix it |
| `set-task-env.sh` fails with a bare `Connection error`, and works when re-run | It was run straight after `trigger-api` was recreated, before the webapp was accepting requests | Nothing — it now waits for the webapp before uploading, and says so |
| A secret in `.env` is a `change-me-…` value and was never generated | `ensure-env-secrets.sh` used to treat any non-empty value as set, so an `.env` copied from an older template kept its shipped placeholders for ever | Re-run `./deploy/compose/ensure-env-secrets.sh` — it now replaces placeholders and prints what to recreate afterwards |
| `--from trigger` refuses with "Trigger.dev version drift" | `TRIGGER_IMAGE_TAG` and `@trigger.dev/sdk` disagree (0018 T0). Unset, the tag falls back to `managed.yml`'s default, which is easy to miss | Set `TRIGGER_IMAGE_TAG` to `v<sdk version>`, or pin the SDK back. The refusal prints both commands |
| The deploy asks "Would you like to apply those updates?" mid-script | `apps/worker/package.json` pins one SDK version and `node_modules` holds another, so the CLI offers to reconcile them — and waits. In CI there is no terminal to answer from | `pnpm install --frozen-lockfile`, then re-run. `deploy-tasks.sh` now refuses up front rather than letting the deploy become interactive |
| The CLI sits at its version banner for tens of minutes | `npx`'s "Ok to proceed?" install prompt, invisible because output is discarded | Every script here uses `npx -y`; if you are running it by hand, do too |
| **`<project>-nextcloud` is `Up` but `(unhealthy)`**, `curl` says `Empty reply from server` in under a second, and `nextcloud.log` has written nothing for hours | PHP is SEGFAULTING on every web request. `docker compose -f deploy/compose/managed.yml logs nextcloud` shows `AH00051: child pid … exit signal Segmentation fault (11)` on a metronomic 15-second beat — the healthcheck interval — because the only request arriving is `/status.php` and every one of them kills its worker. Apache writes the access line *after* a response completes, so a crashed child logs nothing at all, which is why `nextcloud.log` looks idle rather than broken. The cause, isolated on the Spark 2026-09-13: **PHP's tracing JIT**, which the image's own `opcache-recommended.ini` enables (`opcache.jit=1255`, `jit_buffer_size=8M`). A bulk delete drove a shared bootstrap path hot, it compiled to something that faults, and every request through it afterwards died. It survives `docker restart` because the same trace recompiles | Fixed in the repo: `deploy/compose/nextcloud-php.ini` is mounted as `zz-ownpace-no-jit.ini` and turns the JIT off while leaving opcache on. Pull and force-recreate the service. **To confirm this is what you are looking at**, use the one asymmetry that identifies it: `docker compose -f deploy/compose/managed.yml exec nextcloud php /var/www/html/status.php` returns clean JSON on the CLI (where `opcache.enable_cli=Off`) while the identical file segfaults under Apache. Do NOT reach for the database, the data directory or `integrity:check-core` first — all three were ruled out before the JIT was found |
| Task runs die instantly, no logs, runner container gone | `DEPLOY_IMAGE_PLATFORM` does not match the host | Fix it in `.env`, `up -d --force-recreate trigger-api` (it is read server-side), then `--from tasks` |
| Enqueues fail by name; runs land `failed` immediately | `TRIGGER_SECRET_KEY` unset or not a `tr_prod_` key | `--only account`, then `up -d api` |
| Tasks run but cannot reach the database | The task environment was never uploaded, or holds `localhost` | `./deploy/compose/set-task-env.sh`. Values are read at run start; no redeploy needed |
| `trigger-credentials.sh` says the schema is not the one it knows | **Two causes, and the second one is not about Trigger.dev at all.** Either a version bump renamed a column — or the check was asked through a pipeline its own consumer could kill. `printf … | grep -qxF "$col"` under `set -o pipefail` returns 141 when grep SUCCEEDS: `grep -q` exits at the first match without draining, the producer dies of SIGPIPE, and pipefail hands back the signal. `PIPESTATUS` is `(141 0)` — the answer was yes | If the refusal names a column you can see in the database, it is the second cause and the checkout predates the fix: every such pipeline now reads from a here-string, and `no-pipeline-its-own-consumer-can-kill.unit.test.ts` fails the build if one comes back. If the column really is gone, it is the first: read the two values from the dashboard by hand — the refusal names both pages |
| Seed fails on `DATABASE_URL … is required` | It is running on the host and inherits nothing | Use the `demo` phase, which exports them from `.env` |
| `<project>-idp` is `Up N minutes (unhealthy)` — RUNNING, not restarting — and its log is clean right down to `server is listening` | **The container is fine and the probe is not.** The checkout predates the removal of the provider's healthcheck: that probe asked for readiness from inside the container, where nothing listens on the address it built (see the row below). A current checkout cannot produce this, because the service has no healthcheck any more | Pull, then `./deploy/compose/bootstrap-managed.sh --only app`, which recreates the provider without the probe and asks readiness from the host. What the old probe said is in `docker inspect <project>-idp --format '{{json .State.Health}}' \| jq`; the bring-up prints the same as its `what the HEALTHCHECK said` window for any service that has one |
| `[setup-zitadel] FATAL: it did not become healthy within five minutes`, on a run where the provider is plainly up and serving | **A second waiter, on a health signal that no longer arrives.** `setup-zitadel.sh` polled `"Health":"healthy"` from `docker compose ps`; the identity provider has no healthcheck (see the rows above), so that field is never set and the wait always runs its full five minutes | Fixed: it now asks `/debug/ready` on the published port, the same address the bring-up uses. `nothing-waits-on-a-health-that-cannot-arrive.unit.test.ts` fails the build if any script waits on the health of a service that declares no healthcheck |
| The bring-up prints `the identity provider never became ready at http://localhost:3126/debug/ready` | **The readiness check is asked from the host, not from inside the container**, because `zitadel ready` builds its URL from `ExternalPort` — the address the OUTSIDE reaches Zitadel on — and nothing listens there inside. Here that is a published port; behind netbird it is 443, terminated by something that is not Zitadel | Read the code the message names. `000` means nothing answered at all — check the container is up and the port published. Any other code means Zitadel answered and said no, which is a real not-ready and its log is the next place to look. The timeout is `IDP_READY_TIMEOUT` (default 300s); a first init applies every migration from scratch and a slow disk can need longer |
| `[setup-zitadel] FATAL: could not read /machinekey/pat.txt (exit 127)` naming `"cat": executable file not found in $PATH` | **The provider's image has no shell and no coreutils.** `docker compose exec -T zitadel cat …` cannot work, and Docker reports that on STDOUT with exit 127 — so a command substitution captures the error message as if it were the file's contents. Before this refusal existed, that sentence was sent to Zitadel as a Bearer token, which answered `illegal base64 data at input byte 3` (byte 3 is the space after `OCI`) and then `Errors.Token.Invalid` | Nothing to do on a current checkout: the token is read off the VOLUME with busybox, via the `zitadel-machinekey` service that already mounts it. If you are reading the file by hand, do the same — `docker run --rm -v <project>_zitadel_machinekey:/m:ro busybox:1.38 cat /m/pat.txt` — and never `exec` into the provider's container, which has no binaries to run |
| `[setup-zitadel] FATAL: GET /auth/v1/users/me answered HTTP 401` with `Errors.Token.Invalid (AUTH-7fs1e)` | **The token and the database disagree about which instance this is.** `/machinekey/pat.txt` is written at FIRST INIT and belongs to the instance created then. Clearing the zitadel DATABASE while keeping the machinekey VOLUME leaves a token for an instance that no longer exists; clearing the volume while keeping the database leaves no token at all, since init never runs again to write one. E2E (managed) #50 is the first of these. It can equally mean the token **expired**: each one lives `ZITADEL_PAT_LIFETIME_DAYS` (7) days and `setup-zitadel.sh` rotates it inside the last `ZITADEL_PAT_ROTATE_BELOW_DAYS` (3), so an expired token is what a gate that slept past the gap wakes up to — the refusal itself says which cause is in front of you | **The database and the volume go together.** Either keep the instance — sign in at `http://localhost:3126/ui/console` as the first user, read the client id from the Ownpace project's application, and `env-upsert.sh` `JWT_ISSUER` / `JWT_AUDIENCE` / `VITE_OIDC_CLIENT_ID` by hand — or start over, which destroys every account it holds: `docker compose -f deploy/compose/managed.yml rm -sf zitadel`, then `docker compose -f deploy/compose/managed.yml exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d postgres -c "DROP DATABASE IF EXISTS zitadel WITH (FORCE)"'`, then `docker volume rm <project>_zitadel_machinekey`, then re-run. The `zitadel` ROLE can stay. Both halves, every time |
| `[setup-zitadel] FATAL:` a call to the identity provider's API refused, naming an HTTP status | **Read the status, they mean different things.** `401` — the provisioning token was not accepted: it **expired** (`setup-zitadel.sh` rotates it before that on every run, so this means the gate slept past the rotation window — mint a new personal access token on the `ownpace-setup` service user in the console and write it over `/machinekey/pat.txt`), or it belongs to an instance that no longer exists, because the zitadel DATABASE was cleared while the machinekey VOLUME was kept (`/machinekey/pat.txt` is written on FIRST INIT). `403` — the token is fine and `ownpace-setup` lacks the grant the call needs, which is a role to add, not a credential to replace. Anything else prints the provider's own words | Follow the remedy the refusal names — 401 sends you to REPROVISIONING at the bottom of `setup-zitadel.sh`, 403 to the console's org roles. Before E2E (managed) #49 all of these printed `could not create the project` and nothing else, because the response body went into `jq -r '.id'` and was discarded; the search above it could not fail at all, since `.result[]?` turns an error into the same empty output a real "no such project" gives |
| `<project>-idp` restarts for ever; the OLDEST line in the failure window is `migration failed … name=34_add_cache_schema error="ERROR: partitioned tables cannot be unlogged (SQLSTATE 0A000)"` | **The identity provider is older than the database it is pointed at.** Zitadel's cache schema created an UNLOGGED PARTITIONED table and PostgreSQL removed support for that, so setup step 34 fails on every attempt and the provider can never finish starting. Not a misconfiguration, and no setting avoids it (zitadel/zitadel#10712) | Nothing to do on a current checkout: the pinned image is above the fix (zitadel/zitadel#11484), and `zitadel-image-matches-postgres.unit.test.ts` fails the build if the two pins are ever moved into a pairing that cannot initialise. If you hit this on an older checkout, raise the Zitadel pin — do not lower Postgres — and then clear the half-written database as the row below describes |
| `<project>-idp` restarts for ever; the OLDEST line in the bring-up's failure window is `migration failed … name=03_default_instance error="open /machinekey/pat.txt: permission denied"` | **The machinekey volume is not writable by the identity provider.** Docker creates a new named volume's mount point owned by root, and the Zitadel image runs as a non-root user — which the error proves, since root could have written anywhere. `03_default_instance` creates the first human BEFORE the machine account, so while the admin password was being rejected this was never reached; fixing the password is what exposed it | Nothing to do by hand on a current checkout: the bring-up reads the image's own `Config.User` and prepares the volume before starting the provider. `v4.6.2` reports a NAME (`zitadel`), not a uid — so where that happens the bring-up reads the number out of the image's own `/etc/passwd`, the same file Docker resolves the name against, via `docker create` + `docker cp` (no shell in the image is assumed, and nothing is started). It REFUSES only a name that passwd does not explain, and that refusal prints the one-line `docker run` that prepares the volume by hand. Either way the half-written database from the failed attempts still has to be cleared — see the row below |
| `<project>-idp` restarts for ever; its log ends `migration failed … name=03_default_instance` with `Errors.Instance.Domain.AlreadyExists` and `Key (instance_id, unique_type, unique_field)=(, instance_domain, localhost) already exists` | **Partial state from an earlier failed init.** `03_default_instance` registers the instance domain and THEN creates the first human. If that second half fails — a password the complexity policy rejects, say — Zitadel logs `setup failed, skipping cleanup` and means it: the domain row stays. Every retry re-runs the migration from the top, hits its own leftover row, and dies on a duplicate key that says nothing about the original cause | The `zitadel` database has to go. Nothing depends on it while init has never completed — no users, no clients, no tokens: `docker compose -f deploy/compose/managed.yml rm -sf zitadel`, then `docker compose -f deploy/compose/managed.yml exec -T postgres sh -lc 'psql -U "$POSTGRES_USER" -d postgres -c "DROP DATABASE IF EXISTS zitadel WITH (FORCE)"'`, then `docker volume rm <project>_zitadel_machinekey`, then re-run the bring-up. The `zitadel` ROLE can stay — `verify user` reuses it with the unchanged `ZITADEL_DB_PASSWORD`. **Clearing it is the second half of the fix, never the whole one.** The duplicate key is what the FIRST failure left behind; if the thing that caused that failure is still in place, the very next bring-up re-poisons the database and reports the same duplicate key — four E2E (managed) runs went that way on 2026-08-23. The bring-up now prints a third log window, every line that reports a failure, oldest first: the OLDEST is the cause and the rest are its echoes. Fix that, then clear |
| Every authenticated request answers `HTTP 500 {"error":"auth_failed"}`, while `/api/ready` answers 200 and `docker compose ps` shows everything healthy | **The API cannot reach its own issuer, so verification never gets as far as a token.** With `ZITADEL_EXTERNALDOMAIN=localhost` the issuer is `http://localhost:3126` — an address the HOST reaches through the published port and the API container cannot, because inside that container `localhost` is the API. Discovery throws `connect ECONNREFUSED 127.0.0.1:3126`, which is not a JWT error, so it lands in `serverFault` as a 500 rather than a 401. E2E (managed) #52 | Nothing to do on a current checkout: the default is `ownpace-idp`, a network alias on the provider's own container, and the provider listens on the number it publishes so the origin matches from both sides. On a stack initialised under the old value the provider will refuse the new origin — see the `Instance not found` row below. A browser on the same machine needs `127.0.0.1  ownpace-idp` in `/etc/hosts`; a real deployment sets a real hostname and DNS answers for both sides |
| `[setup-zitadel] FATAL:` a call answered `HTTP 404` with `unable to set instance using origin` / `Instance not found` | **The provider does not serve the origin being presented.** Zitadel resolves which instance a request is for from the request's origin — host AND **port** — and refuses any other. **Check the port before assuming the host is wrong:** `ownpace-idp:8080` and `ownpace-idp:3126` are different origins, and an evening went into concluding that trusted domains cannot work when the real fault was a provider listening on one port and stamping another into its issuer | Nothing to do on a current checkout in the ordinary case: `setup-zitadel.sh` registers `ZITADEL_EXTERNALDOMAIN` as an instance **trusted domain** on every run, which is enough to make an instance answer for an origin it was not initialised with — proved on E2E (managed) #61, on an instance initialised as `localhost` and never re-initialised. It can only do that once it can reach the instance, so if NOTHING the instance knows still resolves, the last resort is to initialise it again; the refusal prints those commands. A provisioning token cannot add an instance *domain*: `POST /admin/v1/domains` answers `404 Not Found` and the System API answers `401 Errors.Token.Invalid` |
| Sign-in fails at the very first step with `{"error":"invalid_request","error_description":"This client's redirect_uri is http and is not allowed."}` | **The application was provisioned with `devMode:false` against an `http://` WEB_URL.** Zitadel refuses a plaintext redirect URI outright, at `/oauth/v2/authorize`, before any login screen — so the sign-in button could never work, while provisioning reported complete success: project created, application created, client id written to `.env` | Nothing to do on a current checkout: `devMode` is derived from the scheme of `WEB_URL`, and `setup-zitadel.sh` now RECONCILES an application it finds rather than only reading its client id, so an existing stack is put right on the next bring-up |
| Sign-in completes and then every request is refused with `Missing required claims in token payload` | **The access token carries no email address, and the API requires one.** ADR-0042 narrowed the required claims to `sub` + `email` because invitations are addressed to an email address and a first-time signer-in has no row to look one up in. Zitadel puts user info claims in the ID token and NOT in the access token — measured with `idTokenUserinfoAssertion` both off and on | Nothing to do on a current checkout: the application is provisioned with `idTokenUserinfoAssertion` on, and `apps/web/src/services/oidc.ts` sends the ID token. Its audience is `[client id, project id]` and `JWT_AUDIENCE` is that project id, so the API validates issuer, audience, signature and expiry exactly as it would for an access token |
| The smoke says `the API cannot reach the issuer at all` on a stack whose issuer is plainly fine | **The check asked with a client the image has not got.** the API's image is `node:24-slim` — no curl, no wget — so `docker exec … curl …` printed `curl: not found`, `\|\| true` swallowed the 127, and the empty string was reported as a verdict about the issuer. The container's own HEALTHCHECK has used `node -e "fetch(...)"` all along | Nothing to do on a current checkout: the smoke asks with node, and keeps "the probe could not run", "the issuer could not be reached" and "the issuer answered X" apart — three facts about three different things (hard rule 10) |
| The sign-in screen shows the same provider button several times — nine Google buttons after a week of re-runs | Until 2026-09-02 `configure_idp` looked for an existing provider on the deprecated `/admin/v1/idps/_search` list, which does not list the template kind it creates, so every re-run of the app phase added one more. It now reads `/admin/v1/idps/templates/_search`, keeps the oldest, and reports duplicates by count | `./deploy/compose/setup-zitadel.sh --offer-one Google` keeps the **oldest** button (the one your first sign-ins were linked to) and takes the others off the screen by removing their login-policy links — every provider stays, and so does everyone's link to it. The console's **instance** page does the same (Default settings → Login Behaviour and Security → Identity Providers, the 'available' toggle); an organisation-page toggle is undone by the next bring-up, which resets an organisation's own login policy on purpose. The script never deletes a provider. If a Google sign-in then asks to link the account, accept once |
| The bring-up stops before the API with `N of M Docker networks lie outside the ranges the rule refuses` and `A Docker network on this machine lies outside the ranges a tester's host is refused in` | A network on this machine, this stack's or another stack's, has a subnet or a gateway outside the ranges the rule for a tester's host refuses (workplan 0136 T1 (b)). A host that resolves there would reach this machine through that network's gateway, and the rule would let it through | The `OUTSIDE` lines above the refusal name each network, its compose project, and the subnet or gateway outside. Set the daemon's `default-address-pools` inside `10.0.0.0/8`, `172.16.0.0/12` or `192.168.0.0/16` and recreate the network, or remove it if nothing uses it. Then `--from app` |
| `ownpace-api` restarts at start-up, and task runs fail before they connect anywhere, with `OWNPACE_REACHABLE_HOSTS: "<entry>" is not a host name` | The list takes exact host names only: no wildcards, ranges, addresses or ports. A process that cannot read it stops, rather than admit more than the list says | Fix the entry in `.env`, then `docker compose -f deploy/compose/managed.yml up -d api` and `./deploy/compose/set-task-env.sh`. Task variables are read at run start; no redeploy is needed |
| On the gate's stack, the Test button says the demo Nextcloud or Stalwart is inside our network, the smoke's `test-connection` step fails, or a demo migration's pass fails with `host_inside_our_network` | `OWNPACE_REACHABLE_HOSTS` does not list the name, so the rule refuses it like any other host inside this network | On a demo box, `--from demo` adds the demo's names; or add `nextcloud,stalwart` to `.env` by hand. Then `up -d api` and `./deploy/compose/set-task-env.sh`. On live, add nothing: this is the rule doing its job, and an entry admits that name for every organisation |

---

## Updating a running deployment

> **The pull that brings `WEB_BIND` into `managed.yml` moves every port to
> loopback** (workplan 0132 T3). On a stack whose names are routed through a
> front, set `WEB_BIND` and `ZITADEL_BIND` to the address the front connects
> to, in `.env`, **before** the pull. `STATUS_BIND` too where a status name is
> routed **or the status page is opened from a laptop over the mesh**, and
> `TRIGGER_TLS_BIND`, the IP address `TRIGGER_TLS_HOST` names, for a dashboard
> opened over the mesh. Each is an IPv4 address, never a name. **The site is
> not part of this pull**: it keeps its old publish until you set `WWW_BIND` in
> the `.env` beside `www.yml` and run `docker compose -f deploy/compose/www.yml
> up -d` from the updated checkout. See *Which address a port answers on*, under
> the ports table in *Before you start*.

### `ownpace-live`: a release tag, with `deploy-live.sh`

**The first time is not this:** *Standing up ownpace-live*, above, with
`stand-up-live.sh`. **On `ownpace-live`, the stack testers use, the pull under
*The OTA stack* below is never run, and `git pull` never is.** Live runs a release tag and nothing
else (workplan 0132 T6, 0146 T5), so the build a tester sees, a problem
report's build line, the deploy log and the GitHub release all name the same
thing. One script moves it:

1. **Name the tag.** An annotated `v*` tag on origin, cut as
   [release.md](./release.md) §2 says, whose commit the nightly gate ran green
   on the OTA stack. Record the tag and its commit.
2. **Start the hold**, with a sentence in Dutch, and **wait for the drain**:
   *Draining first, and telling customers why*, below. The tick's log says
   `0 pass(es) still in flight` when it is done.
3. **Ask first whether it can be undone.** From `~/ownpace-live`:

   ```bash
   ./deploy/compose/deploy-live.sh --dry-run <tag>
   ```

   It runs every refusal the deploy runs and prints *one-way* or *reversible*,
   then stops: nothing is checked out, installed or deployed, nothing is built
   in the checkout, and nothing is logged. With `WWW_LIVE=true` it does build
   one thing: the tag's site, from git's objects, in a directory of its own
   that it removes, to learn whether the deploy's own build would refuse it
   (*`www.ownpace.eu`: live's copy*). It also asks `copy-before-update.sh take
   --dry-run`, and refuses when the copy of an earlier update that is proven
   is still there (delete that first, step 6), when a kept copy is on its last
   day (the next daily run deletes it: prove its update and delete it, or roll
   back from it), and when the daily duties' timer is not active (nothing
   would delete the copy). **If it says one-way,** the way back that is not a
   fix and a new tag is the copy the deploy takes.
4. From `~/ownpace-live`:

   ```bash
   ./deploy/compose/deploy-live.sh <tag>
   ```

   Right before its checkout it takes **the copy before the update**, into
   `~/.persistent/ownpace-live/copy-before-update`: the app's database, the
   sign-in service's database and the roles, and the task runner's database
   when the tag moves the Trigger.dev pin, each read back (workplan 0139). A
   copy whose update is not proven yet (a deploy that did not take, run
   again) is kept instead, since it is of what ran before. No copy, no deploy:
   without the daily duties' timer active, or with a kept copy the next daily
   run deletes, it refuses before anything moves. A tag without
   `deploy-live.sh`, `exposure-check.sh`, `box-duties.sh`, `stack-kind.sh` and
   `copy-before-update.sh` is refused too, as `stand-up-live.sh` refuses it: live
   would lose its daily duties and the copy's backstop.
5. **Read what it printed, then lift the hold yourself.** The tick's next
   summary shows passes started, and one of your own migrations should complete
   a pass on the new tasks.
6. **Delete the copy once the update is proven.** From `~/ownpace-live`:

   ```bash
   ./deploy/compose/copy-before-update.sh delete
   ```

   It refuses unless the last line `deploys.log` has since the copy was taken
   says the deploy took (one that did not take after it leaves nothing
   proven), the hold that covered it is lifted, and a pass that started after
   it succeeded, each read from live's database. **Not proven by day 6: roll
   back from the copy that day** (the operator runbook's *The copy before an
   update*, which starts with `copy-before-update.sh since`, so that what
   testers erased or deleted after the copy is erased and deleted again). The
   daily duties delete it once it is older than six days less an hour
   whatever happens, and fail the day before to remind you.

What `deploy-live.sh` does, in order. It refuses, before the checkout or the
stack changes, each with its own message: `--with-demo`; a `.env` without live's
marker (`STACK_KIND=production`, `stack-kind.sh`) or without `WEB_URL`;
`COMPOSE_ENV_FILES` or `COMPOSE_FILE` in the shell, or a project
`docker compose config` reports that is not the one the checkout chooses; a
working tree that is not clean; a ref that is not a tag, a tag not on origin, a
lightweight tag, a tag not named `v…`, and a tag whose commit's root
`package.json` version is not the tag without its `v` (it names both, and says
*"live runs releases: name a release tag"*); a tag without the five scripts
live is deployed, checked and kept by (`release-tag.sh`'s list); a database it
cannot read; no open hold; a pass still in flight; a hold less than five minutes old, since a pass
queued just before it is in no count until it starts; a deploy log it cannot
append to; and a copy before the update that `copy-before-update.sh take`
could not take or refused. Then it runs `git fetch --tags origin` and
`git checkout --detach <tag>`, `pnpm install --frozen-lockfile`, and
`bootstrap-managed.sh --from data`, never with `--with-demo`; the bring-up
builds the images with the tag's commit as `GIT_SHA`. Then the checks, at the
origin in `WEB_URL`: `/api/version` names the tag's commit **and** its version,
`/api/ready` answers 200, `/api/auth/mode` answers `managed`, and
`exposure-check.sh` passes. `NODE_ENV` is not checked yet: workplan 0132 T4's
check is not built, and the script says so. With `WWW_LIVE=true` in live's
`.env` it also builds and serves `www.ownpace.eu` from the tag, before the
exposure check, and refuses what would stop that before anything moves
(*`www.ownpace.eu`: live's copy*, under *The public site*); without it, nothing
about the site runs. **Keep it `false` until the legal texts are final:** with
today's texts a deploy with it `true` refuses before the checkout, and the app
does not move either.

**The exposure check needs two things before live's first deploy.** The check is
on `main` since #1271, and it reads the whole machine: set `EXPOSURE_ALLOW` in
live's `.env` to every address any container on it is published on on purpose
(*Checking every publish on the machine at once*, under *Which address a port
answers on*), or it fails for each of them. And the tag must be cut from a
commit that has `deploy/compose/exposure-check.sh`; the script runs the tag's
own copy, and refuses a tag without one before anything moves.

**`--dry-run`** runs everything up to the checkout (every refusal above, the tag
fetch, one-way or reversible, by the same comparison, and `copy-before-update.sh
take --dry-run`, which writes nothing) and then stops, exit 0: no checkout, no
copy, no install, no bring-up, none of the checks after it, and no line in the
deploy log, which it does not even create. With `WWW_LIVE=true`
the site's refusals are among those it runs, and so is their test build of the
tag's site, in a directory of its own that it removes; nothing is built in the
checkout. A refusal exits 1, as in the deploy. Step 3 above is what it is for.

**If a check fails, the deploy did not take.** The script says which check, the
hold stays on, and it exits 3. The checkout is at the new tag: fix the cause and
run it again with the same tag, or name another.

**One-way or reversible.** Before the checkout moves, and again at the end, the
script says whether the deploy can be undone by deploying a tag this stack has
run again. It compares the new tag with the running tag, the one the last deploy
that took put there (read from the deploy log); with every deploy since that did
not take, since its bring-up may have run and its API migrates when it starts;
and with the checkout's `HEAD` when no line names it. It is **one-way** when,
against any of them, a file in either migration chain
(`packages/ledger/migrations`, `packages/managed/migrations`) was added, changed
or removed, or the Trigger.dev or identity-provider image pin in `managed.yml`
moved: the API refuses an older build on a migrated schema, and both planes
migrate their own schemas one way. Otherwise it is **reversible**. So going back
to the running tag after a deploy with a migration that did not take is one-way:
that migration may already have run.
During the alpha a bad deploy is fixed forward: a fix, a new `alpha.N` tag, this
script. A reversible one can also be undone by deploying the previous tag.

**The deploy log.** Every deploy that got as far as the checkout appends one
line, tab-separated, to `~/.persistent/ownpace-live/deploys.log`: the UTC date,
the tag, the commit, `took` or `did-not-take`, and `one-way` or `reversible`. A
refusal is not a deploy and is not logged. The script checks that it can append
to the file before the checkout moves; should the line still fail at the end, it
prints the line for you to add by hand, and its exit still says how the deploy
went. Anything else worth keeping, such as
the owner accepting fewer green gate runs than the rule asks (workplan 0141),
is added to that file by hand.

**Not yet run on live.** Live is not stood up (workplan 0132 T1b), so the
script has run only against the stubs in its guard,
`scripts/a-deploy-from-a-named-tag.unit.test.ts`.

### The OTA stack: the nightly gate, or a pull

On the OTA stack (`~/ownpace-managed`) the nightly gate is the deploy: it
brings `main` up every night. By hand, a stack that is already up takes a pull,
a rebuild of the two images that carry code, and — **sometimes** — a re-deploy
of the tasks:

```bash
cd ~/ownpace-managed
git pull

GIT_SHA=$(git rev-parse --short HEAD) \
  docker compose -f deploy/compose/managed.yml up -d --build --wait api web

./deploy/compose/deploy-tasks.sh          # see below: not always needed
```

**The third line is the one that gets skipped, and skipping it is invisible.**
The api and web containers are rebuilt from the working tree; the **tasks are
not** — they are a bundle uploaded to the Trigger.dev instance, and it keeps
serving the last one deployed until you replace it. So a fix that lands in
`packages/` reaches the connection Test (which runs in the api) while every
sync pass carries on running the old code. Nothing errors. The screen says the
fix is in.

Re-deploy the tasks when the pull touched `apps/worker` **or anything the
worker bundles** — in practice `packages/connectors`, `packages/engines`,
`packages/orchestration`, `packages/shared`, which is most changes that are not
purely web. When in doubt, run it: it is idempotent and costs a minute.

**`deploy-tasks.sh` installs this checkout's packages first**
(`pnpm install --frozen-lockfile`, since 2026-09-28). The images install their
own inside their builds, but the tasks are bundled on this machine from its own
`node_modules`. Before this step, a pull that changed a dependency rebuilt the
images and then stopped here: `Could not resolve "undici/…"`, with the api and
web on the new code and every pass on the old bundle. So `pnpm` must be on this
machine's PATH; the script refuses by name when it is not.

`set-task-env.sh` is a **different** question and a rarer one. Task containers
inherit nothing from compose, so the environment is uploaded separately — run
it only when a value in `.env` that the worker reads has changed (see phase 9).
A code-only pull does not need it.

### Once, after the pull that stopped uploading `DIRECT_DATABASE_URL`

Workplan 0138 T3 step 1 took `DIRECT_DATABASE_URL` out of what `set-task-env.sh`
uploads. It is the database owner, a superuser, straight to Postgres past the
pooler, and no task reads it. Leaving it out of the upload does not take it out
of the store: `upload` sends only the variables it is given, and nothing shows
the platform removing the others. So a plane that received it before keeps
handing it to every run until it is deleted once.

It also matters for a later key rotation. `SET_TASK_ENV_FORCE_REWRITE=1`
deletes and rewrites only the variables the script uploads, so a leftover
`DIRECT_DATABASE_URL` stays on the old key after a
[`TRIGGER_ENCRYPTION_KEY` rotation](#rotating-trigger_encryption_key), and one
unreadable secret is enough to stop every run.

On each stack whose plane received it (the OTA stack in `~/ownpace-managed`,
and `ownpace-live` if its tasks were set up before this change), from that
stack's checkout:

```bash
(
  set -euo pipefail
  set -a; . deploy/compose/.env; set +a
  . deploy/compose/trigger-cli-lib.sh
  TRIGGER_ENV="$(trigger_env deploy/compose/.env)"
  cd apps/worker
  TRIGGER_API_URL="${TRIGGER_API_ORIGIN:-http://localhost:3090}" TRIGGER_ENV="$TRIGGER_ENV" \
    node -e 'require("@trigger.dev/sdk").envvars.del(process.env.TRIGGER_PROJECT_REF, process.env.TRIGGER_ENV, "DIRECT_DATABASE_URL").then(() => console.log("deleted DIRECT_DATABASE_URL"), (e) => console.log("delete said:", e && e.message ? e.message : e))'
)
./deploy/compose/set-task-env.sh
```

The parentheses keep a refusal inside them. `trigger_env` is the resolver
`set-task-env.sh` itself uses, so the delete goes to the same environment the
upload does, including on a `.env` that still carries the old
`TRIGGER_ENV_SLUG`; when the two names disagree it refuses, and only the
subshell exits, not your terminal.

What the delete says is not the check. This repository has seen `envvars.del`
report a variable missing while its row existed (`deploy/compose/reset-trigger.sh`,
under a discarded key). The check is the line `set-task-env.sh` prints next,
`upload OK — env now holds:` and the names in the store: `DIRECT_DATABASE_URL`
must not be among them. If it is still listed, look for its row in the
platform's own database (on live, under live's project name):

```bash
docker compose -f deploy/compose/managed.yml exec -T trigger-db \
  psql -U trigger -d triggerdb -tA -c "SELECT key FROM \"SecretStore\" WHERE key LIKE '%DIRECT_DATABASE_URL%'"
```

A row there that the delete cannot remove is a secret the current key cannot
read. `deploy/compose/reset-trigger.sh` says why a reset is then the way out
and what it destroys, and
[Rotating `TRIGGER_ENCRYPTION_KEY`](#rotating-trigger_encryption_key) when the
wipe beats the surgery.

### Draining first, and telling customers why

A rebuild replaces the containers under whatever is running. For an api/web
rebuild that is a few seconds of unavailability; for a task deploy it can
interrupt a sync pass mid-flight. A pass that is interrupted loses only its
own work — the cursors stay where the last completed folder left them, and the
next pass carries on — but a customer watching a large migration sees it stop,
and has no way to tell that from something broken.

So there is a hold (workplan 0022 T2, managed migration 0023). It stops the
sync tick starting **new** passes; passes already running finish normally,
which is what makes it a drain rather than a kill. It is on the operator's
first support screen, under **Hold new passes**, with a box for what customers
will read.

It also stops what a customer starts by hand (workplan 0132 T6 (b)). While it
is on, every API request that would start work answers `409 platform_held`
with your sentence and starts nothing: *Sync now*, *Start*, a cutover's
preparation, a discovery count, a verification, a confirmation pass, and
following a deletion or a move through. So nothing a customer presses after
the hold began adds to the in-flight count. The other scheduled tasks (drift
detection, group discovery, the digest, retention and the hourly purge) do not
read the hold.

The sequence:

1. Start the hold, with a sentence. Say when copying resumes: only you know
   whether this is ten minutes or overnight. The same sentence is also the
   whole answer to every button the hold refuses, in place of the default's
   *"Nothing was started. Try again when copying resumes."*, and a refused
   press is not remembered. So say that too: nothing starts until then, and
   to try again after. For the alpha, in Dutch: *"We werken het platform bij
   en kopiëren rond 15:00 weer. Tot die tijd start er niets. Probeer het
   daarna opnieuw."* Leave it empty and customers get a generic sentence — a
   hold is never wordless, but it is also never as useful. The banner's
   generic sentence is in the reader's language; a refused button's is in
   English.
2. Watch the tick's log until the drain is done. Every minute it logs
   `[sync-tick] holding: … N pass(es) still in flight; the drain is done when
   that reaches 0.` A pass ends on its own clock well inside an hour, so this
   normally clears in minutes.
3. Pull, rebuild, re-deploy the tasks. **On `ownpace-live`, never a pull:**
   this step is `./deploy/compose/deploy-live.sh <tag>` with a release tag,
   after its `--dry-run` (*`ownpace-live`: a release tag, with
   `deploy-live.sh`*, above). The pull is the OTA stack's.
4. Lift the hold. The next tick starts passes again.

While the hold is on, every signed-in customer sees a note at the top of every
screen with your sentence on it and the time it began. Nothing else about their
migration changes: no cursor moves, nothing is marked failed, and scheduled
passes start again by themselves. A button a customer pressed while the hold
was on is the exception, and has to be pressed again: a *Start* refused before
it began leaves the migration unstarted, and a refused verification or
confirmation, or a deletion or move to follow through, was never queued.

The hold is platform-wide — there is no per-tenant hold, matching the owner's
answer of 2026-08-27 on the same question one level up. Every hold is kept,
with who started it, who lifted it and what it said, so *"when were we down and
what did we tell people"* has an answer afterwards.

---

## Redoing a rollout somewhere else

The whole configuration is `deploy/compose/.env` plus the two human steps.
On a new machine:

```bash
git clone … ownpace-managed && cd ownpace-managed && pnpm install --frozen-lockfile
./deploy/compose/bootstrap-managed.sh
```

Do **not** copy an old `.env` across wholesale. Copy the *decisions* — prices,
SMTP, OAuth, the public URLs — and let `ensure-env-secrets.sh` mint fresh
secrets. A secret that exists on two machines is a secret that gets rotated on
neither. `TRIGGER_PROJECT_REF` and `TRIGGER_SECRET_KEY` in particular belong to
the *old* instance and are meaningless on the new one; the script will read the
new instance's own.

**Upgrading Trigger.dev** is one number in every place that names it, and they
must agree: the two `${TRIGGER_IMAGE_TAG:-…}` defaults in `managed.yml`,
`TRIGGER_IMAGE_TAG` in `managed.env.example`, and every `@trigger.dev/*`
dependency in the root, `apps/worker` and `packages/scheduler` manifests
(`.env`'s `TRIGGER_IMAGE_TAG`, when set, overrides the compose default on that
machine). `--from trigger` refuses at bring-up when they disagree, and
`bootstrap-managed.unit.test.ts` refuses in CI — added after dependabot moved
the SDK alone, passed all seventeen checks and broke the managed gate.

`trigger-version.sh` does the whole thing rather than leaving it to `sed`:

```
./deploy/compose/trigger-version.sh list              # running / pinned / what you can move to
./deploy/compose/trigger-version.sh backup pre-4.5.12 # verified dump of triggerdb
./deploy/compose/trigger-version.sh pin --latest      # moves every place
./deploy/compose/trigger-version.sh backups           # what dumps exist
./deploy/compose/trigger-version.sh restore --latest --yes   # DESTRUCTIVE rollback
```

On the OTA stack, whose drill runs every night, `--latest` is the last drill's
dump, taken after the upgrade migrated the schema: restore the `before-` backup
by its file name. On live there is no drill (workplan 0139): `backup`,
`backups` and `restore` use the directory of the copy before an update, and the
copy `deploy-live.sh` takes before a tag that moves the pin holds that dump
(*Live's daily duties*).

`list` probes the registry by manifest rather than reading its tag list: ghcr's
`/tags/list` is neither newest-first nor complete in one page — with `n=1000`
the newest `v4.5.x` it returns is `v4.5.4`, while `v4.5.9` and `v4.5.12` both
exist. Asking whether a specific tag exists is the question it answers
reliably, so that is the question asked, upward from the version already
pinned.

> **Back the database up first, because the upgrade is one way.** The webapp
> applies its own schema migrations on boot and Prisma has no down-migrations,
> so putting the old tag back restores the IMAGES and not the schema they
> migrated. `triggerdb` holds the account, the project, its API keys, the
> worker group and the deployed-task records — the things whose loss needs a
> person, a browser and a magic link to repair. The managed gate runs
> `trigger-version.sh drill` on every pass, which dumps that database,
> restores it into a throwaway and compares, so the backup is never only a
> claim.

> ⚠️ **Do not upgrade with runs in flight.** Recreating the webapp and
> supervisor under load left the reference deployment looping on
> `Failed to start run … "Snapshot changed inside startRunAttempt"` for every
> run: nothing reached a task body, and the schedule kept adding one run a
> minute on top (2026-08-18). Cancelling the backlog through the API did not
> help — new runs failed identically — so it was the version, not the state.
>
> The order that avoids it:
>
> 1. Stop the schedule producing work, or accept a backlog you will cancel.
> 2. Wait for `TaskRun` to have nothing in `EXECUTING`.
> 3. Change the tag AND the SDK together, `pnpm install`.
> 4. `--from trigger`, then **redeploy the tasks** — an image built by one CLI
>    version and run by another platform version is the same drift by a
>    different route.
> 5. Watch the first few runs reach `COMPLETED_SUCCESSFULLY` before walking
>    away.
>
> Rolling back is the same procedure in reverse, and is the right first move
> when an upgrade goes wrong: the older version has run history behind it and
> the newer one does not.

> ⚠️ **The four places are not the only thing an upgrade depends on.** The
> v4.5.12 attempt did all of the above — verified backup, drained queue, all
> four numbers moved with the tool — and `trigger-api` crash-looped anyway on
> a dependency none of it looked at:
>
> ```
> Code: 80. DB::Exception: Only literals can be skip index arguments. (version 25.5.2.47)
> ```
>
> `clickhouse` was `bitnamilegacy/clickhouse:latest`. Nothing in the repository
> said which ClickHouse the stack ran, so nothing could notice it ran one whose
> SQL dialect rejects a migration the new webapp ships. `bitnamilegacy` is
> archived and tops out at 25.7.5, so there was no newer tag there to move to.
> The migration failed closed and the rollback to v4.5.9 was clean — no restore
> needed — which is the one part that went right.
>
> ClickHouse is now `clickhouse/clickhouse-server:26.2.19.43`, pinned **by
> digest**, which is what upstream's own compose file runs for this release and
> therefore the only ClickHouse the migration has been proved against.
> `bootstrap-managed.unit.test.ts` refuses any `latest` in `managed.yml` from
> here on, so this cannot happen quietly a second time.
>
> **The first bring-up after that change starts ClickHouse EMPTY, on purpose.**
> Bitnami kept its data under `/bitnami/clickhouse` and the official image reads
> `/var/lib/clickhouse`; handing one vendor's directory layout to the other is
> not an upgrade. So the mount moves to a new volume, `clickhouse_data_v2`, and
> the old `clickhouse_data` is left on disk untouched. What is lost is
> **dashboard task-event history** — ClickHouse is the event store, derived from
> the run records in `triggerdb`, so nothing about running, deploying or
> recovering tasks depends on it. Remove the old volume only when you have
> decided you want the space:
>
> ```
> docker volume rm <project>_clickhouse_data
> ```

> **MinIO was floating too, and told a slightly worse lie.** It was
> `bitnamilegacy/minio:latest`, and that tag stopped moving on **2025-07-03** at
> `2025.5.24` — while the repository went on publishing until 2025-08-19 and ends
> at `2025.7.23-debian-12-r5`. So `latest` was not even bitnamilegacy's last
> word: it quietly stopped six weeks early, and nothing recorded which MinIO the
> stack ran.
>
> It is now pinned to **what was already running** —
> `bitnamilegacy/minio:2025.5.24-debian-12-r5` by digest. That changes the name
> of what runs and not the bytes, on a service holding Trigger.dev's packets and
> run artifacts, so it needs no volume move and no bring-up ceremony. Nothing in
> `managed.yml` floats any more, and `bootstrap-managed.unit.test.ts` refuses a
> new one.
>
> **Moving to upstream's `minio/minio` is a separate job**, and it is not a tag
> swap. Whoever does it needs all four of these:
>
> 1. `command: server /data --console-address ":9001"` — bitnami's entrypoint
>    supplies this; upstream's does not, and the container exits without it.
> 2. The data path changes from `/bitnami/minio/data` to `/data`, so a **new
>    volume** and an empty object store, exactly as ClickHouse did.
> 3. `MINIO_DEFAULT_BUCKETS` **does not exist** upstream. It is a bitnami
>    convenience, and it is what creates the `packets` bucket. Upstream uses a
>    separate `minio-init` service running `mc mb -p local/packets`; without it
>    MinIO comes up healthy and every packet write fails.
> 4. A healthcheck on `/minio/health/live`, which this service has never had.
>
> Losing the packets store costs historical large run payloads and outputs — not
> deployments, which live in the registry, and not the ability to run anything.

**Rotating a secret**: change it in `.env`, `docker compose up -d` the affected
services, re-run `set-task-env.sh` if a task variable changed, and re-mint any
JWTs signed with a rotated `JWT_SECRET`. Rotating `SECRET_ENCRYPTION_KEY`
**strands stored connection credentials** — they have to be re-entered.
Rotating `TRIGGER_LOGIN_SECRET` signs everyone out **including the deploy
CLI**, whose stored token then fails with `Unable to validate existing personal
access token — 500`; a `login` fixes it. **A database password is not enough
changed in `.env`**: `POSTGRES_PASSWORD` and `APP_DB_PASSWORD` belong to roles
that keep the password they were created with, so the role has to be told
too. `./deploy/compose/rotate-db-passwords.sh` does both, and never prints a
value; the next section is the procedure.

### Changing the database passwords

The OTA stack's database roles were created with values this repository
contains: `app_user` with `app_password` (the first migration), the owner with
compose's default or the example's `change-me-openmigrate`. `.env` alone does
not reach a role that exists, so `deploy/compose/rotate-db-passwords.sh`
carries a new value to it with `ALTER ROLE` (workplan 0132 T2). It has three
modes:

| mode | what it does | exit |
|---|---|---|
| `--check` (the default) | Changes nothing, and runs on any stack, live included. Lists the login roles (names and flags). Asks the controls, `.env`'s own values, over the stack's network and through PgBouncer. Tries the three shipped Postgres values against the owner **by its real name**, `app_user`, `openmigrate` and `APP_DB_USER`, where each is a login role. Tries ClickHouse's two and MinIO's two in their own containers. Reports `trigger-db`'s value, written into `managed.yml`, as waiting for T2's code, uncounted. One line per pair, never a value. A role that opens and is neither the owner nor `APP_DB_USER` (the owner's old name, left with `LOGIN`) is not one `--rotate` changes, so for it the advice is workplan 0132 T2 step 5 by hand: `ALTER ROLE <name> NOLOGIN`, never `DROP`. | 0 nothing shipped opens; 1 something does; 2 not established |
| `--sync` | Sets `app_user`'s and the owner's passwords to what `.env` holds, in one transaction over the socket, then proves both over the network and through the pooler. Idempotent. The remedy when `.env` and the roles disagree. Refuses a stack that may be live (`stack_may_be_live`), before it asks the stack anything. | 0 / 1 / 2 |
| `--rotate [--with-trigger-stores]` | Makes new values on the machine and changes `.env` and the roles together. With `--with-trigger-stores`, `CLICKHOUSE_PASSWORD` and `MINIO_ROOT_PASSWORD` too. Refuses on live, in CI, under `set -x`, when `.env` is not the persisted file, while a CI job runs on the machine or E2E (managed) is queued or in progress (asked before it prompts, and again once the project name is typed, before anything is written), when postgres is not healthy, when `.env` and the roles already disagree, and while a shipped value opens a login role it does not change (it names the role and 0132 T2 step 5). It asks you to type the project name. On any failure, or an interrupt, it puts the old `.env` and the old role passwords back, and says which step failed; a second Ctrl-C does not stop that. If it cannot complete, it keeps the old `.env` beside the persisted one (mode 0600) and says what to run. | 0 / 1 |

Every question about a password goes over the stack's network or to
PgBouncer's port, never the database container's socket, which trusts every
connection and would open with any password
([the check Postgres never made](../scripts/the-check-postgres-never-made.unit.test.ts)).
No value is ever an argument: each travels in the environment of the one
process that needs it, by name.

**The procedure, on the OTA stack**, from `~/ownpace-managed`, with
`deploy/compose/.env` a link to the persisted file
([One stack, one `.env`](#one-stack-one-env)):

1. **Check.** `./deploy/compose/rotate-db-passwords.sh --check`. Both controls
   must open. Each `OPENS` line is a shipped value still in force. If a control
   is `REFUSED`, `.env` and the database already disagree: run `--sync` first.
   If an `OPENS` line names a role that is neither the owner nor `app_user`
   (the owner's old name, `openmigrate`, left with `LOGIN` after a rename),
   take its login away first with the command the check prints (workplan 0132
   T2 step 5: `ALTER ROLE openmigrate NOLOGIN`, never `DROP`, because it owns
   the schema); `--rotate` refuses until then.
2. **Rotate, at a quiet time.** After that day's gate run has finished, and
   with nothing queued in Actions → E2E (managed):
   `./deploy/compose/rotate-db-passwords.sh --rotate --with-trigger-stores`,
   and type the project name when it asks. From here until the next step ends,
   the OTA app cannot open new database connections (the demo is down; no
   tester uses this stack).
3. **Dispatch E2E (managed)** on `main` (the script does this itself when `gh`
   is signed in). That run restores the persisted `.env`, recreates every
   container whose settings changed (Postgres, the API, Zitadel, ClickHouse,
   MinIO, trigger-api), uploads `DATABASE_URL` and `APP_DATABASE_URL` to
   Trigger.dev again, and its smoke proves a task still connects.
4. **Check again**, once that run is green: `--check` exits 0. ClickHouse must
   be healthy (its health check logs in with the new password). If MinIO
   refuses the new pair on its old volume, the cost is its packets store: old
   large run payloads.
5. **Record the date in workplan 0132 T0** (step 2), with "refused". Never a
   value.

`--sync` and `--rotate` refuse live: its values are made fresh when it is
stood up and are its own (0132 T1b, D8). `--check` runs on any stack, live
included; 0132 T0 step 5 runs it there. The gate never runs `--rotate`;
it may one day run `--check`, and T2 (b)'s bring-up is to run the `--sync`
functions (`deploy/compose/db-roles.sh`) on every run. `trigger-db`'s password
waits for T2's code, which makes it `TRIGGER_DB_PASSWORD`.

### `whoami` says nothing about whether you are logged in

`trigger.dev whoami --profile <name>` **exits 0 regardless of login state.**
Read from the installed CLI's own source (`dist/esm/commands/whoami.js` +
`cli/common.js`): an auth failure returns `{success:false}` as data rather than
throwing, and the CLI's command wrapper only marks the process failed on a
thrown exception. So a script that does

```bash
whoami --profile X >/dev/null 2>&1   # WRONG — 0 either way
```

cannot tell "logged in" from "never logged in" from "token was just revoked".
This bit the `login` phase and `deploy-tasks.sh`'s own preflight the same day,
on the same box: both reported "already logged in" against a profile left over
from before a `reset-trigger.sh`, and the deploy that followed died with

```
Error: Unable to validate existing personal access token
Invalid or Missing Access Token
```

which reads like a broken deployment rather than a login nobody actually did.
`trigger-cli-lib.sh`'s `trigger_cli_logged_in()` is the fix both scripts now
share: run `whoami` for real and look for the `User ID:` line a genuine
successful lookup prints, regardless of exit code. If you ever call the CLI
directly in a script, do the same rather than trusting `$?`.

### Rotating `TRIGGER_ENCRYPTION_KEY`

**Not a normal rotation, and `ensure-env-secrets.sh` refuses to do it for you.**

This key encrypts the Trigger.dev secret store. Changing it does not re-encrypt
anything — it strands every secret written under the old key. The failure is not
at boot; it is every run, at `startRunAttempt`:

```
Error: Unsupported state or unable to authenticate data
  at PrismaSecretStore.getSecrets
  at AuthenticatedWorkerInstance.getEnvVars
  at AuthenticatedWorkerInstance.startRunAttempt
```

which the supervisor reports as `Snapshot changed inside startRunAttempt` —
a message about snapshots with nothing in it about keys. Runs pile up
`EXECUTING`, retry containers accumulate, and nothing reaches a task body.

**Re-running `set-task-env.sh` alone does not cure it**, and the reason is
worth knowing: `envvars.upload(..., { override: true })` **skips a value whose
plaintext has not changed.** Re-encryption requires a re-write, so any variable
whose value happens to be identical is quietly left on the old key — while the
script reports success and lists it among the uploaded names.

On the reference box that was exactly one variable out of four:
`SECRET_ENCRYPTION_KEY`, whose value had not changed while the three database
URLs had. Three readable secrets, one unreadable, every run dead.

Use the force flag, which **deletes** each variable before writing it, so the
write is a creation and cannot be skipped:

```bash
SET_TASK_ENV_FORCE_REWRITE=1 ./deploy/compose/set-task-env.sh
```

**Delete, not overwrite** — and this is the part that costs a round if you get
it wrong. `envvars.upload` *reads* the existing value to decide whether the
write is a no-op, so on a variable it cannot decrypt, the repair fails on the
same error as the fault:

```
[set-task-env] FAILED: Unsupported state or unable to authenticate data
```

Deletion needs no plaintext. To repair a single variable by hand:

```bash
cd apps/worker
TRIGGER_API_URL=http://localhost:3090 TRIGGER_SECRET_KEY=… TRIGGER_PROJECT_REF=… \
  node -e 'require("@trigger.dev/sdk").envvars.del(process.env.TRIGGER_PROJECT_REF, "prod", "SECRET_ENCRYPTION_KEY").then(()=>console.log("deleted"))'
cd ../.. && ./deploy/compose/set-task-env.sh
```

The order that works:

1. **Before rotating**, list what is in the store:
   `SELECT key, "updatedAt" FROM "SecretStore"` — everything there has to be
   re-creatable, or you cannot rotate without losing it.
2. Drain the queue (nothing in `EXECUTING`) and stop the schedule.
3. Rotate the key, recreate `trigger-api` and `trigger-supervisor`.
4. Re-write every stored secret under the new key —
   `SET_TASK_ENV_FORCE_REWRITE=1 ./deploy/compose/set-task-env.sh` for the task
   environment, and by hand for anything else step 1 found. Then check
   `SELECT key, "updatedAt" FROM "SecretStore"`: **every** row must show a
   timestamp after the rotation. One that does not is one dead run away.
5. Redeploy the tasks and watch the first runs reach a terminal state.

**On a stack whose Trigger.dev data is disposable — which a reference or demo
box usually is — the wipe is faster and more certain than the surgery, and it is
a script because the sequence has two traps:**

```bash
./deploy/compose/reset-trigger.sh --yes
./deploy/compose/bootstrap-managed.sh --from trigger
```

The traps, in case you do it by hand anyway: the volume belongs to **`trigger-db`**,
so stopping only `trigger-api` and `trigger-supervisor` leaves `docker volume rm`
refusing with "volume is in use" — and the bring-up afterwards then quietly
reuses the old database and fails exactly as before. And the stale
`TRIGGER_PROJECT_REF` has to be cleared from `.env`, or the `account` phase sees
it populated, reports "nothing to do", and skips the human step that is now
mandatory.

The reset destroys the orchestration database only, and only its own stack's:
it removes `<project>_trigger_db_data` for the project its checkout drives. The
ledger, tenants, mappings, items and invoices live in the application database
(`postgres`), a different volume, and are untouched; the API and pooler keep
serving throughout. You are then back at the one human step, and
`trigger-credentials.sh` reads the new project's credentials.

**Turning the pooler off** is two values: `DB_HOST=postgres`, `DB_PORT=5432`,
then `up -d`. Every service reads them, so nothing in `managed.yml` is edited.

---

## What this does not cover

- **TLS and a public hostname for the API and web app.** Everything above is
  addressed by IP or `localhost`. A real deployment needs a reverse proxy with
  real certificates in front of ports 3001 and 3123, and `CORS_ORIGIN` /
  `WEB_URL` / `API_URL` set to those addresses.
- **Backups of the APPLICATION database.** Nothing here backs up the
  `postgres` service's database — including the identity provider's tables,
  which after 8b hold the only copy of who can sign in. (Trigger.dev's own
  `triggerdb` IS covered, by `trigger-version.sh backup`, and its restore is
  drilled on every managed gate run. The same treatment for the application
  database is not built.) A stack without backups sets
  `BACKUP_RETENTION_DAYS=0`, so the erasure sentence names none.
  `ownpace-live`, the stack testers use, takes none during the alpha and sets
  `7`: one copy of its databases is made right before each update, by
  `deploy-live.sh`, and deleted once the update is proven, or after six days
  less an hour by the daily duties (workplan 0134 open question 1 (b), workplan
  0139; §8g).
  [Workplan 0134](./workplans/0134-no-backups-during-the-alpha-said-truthfully.md)
  is that decision. It parks building the backups (its T5) until before the
  first paying customer, or the end of the alpha, whichever comes first.
- **Anybody's first account.** `setup-zitadel.sh` stands the provider up; it
  does not create people. People are let in through the access-request queue
  (§8c; workplan 0093 T6/T7, done): once an operator is appointed as §8c
  describes, granting a request (`POST /api/access-requests/<id>/grant`)
  creates the organisation and its owner invitation in one transaction, and
  the asker becomes a member the first time they sign in with a verified
  email.
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
- [`status-page.md`](./status-page.md) — what the status page can and cannot tell you
- [`performance.md`](./performance.md) — the PGlite ledger benchmark, bounded
  concurrency and the remaining throughput levers (the pooler is phase 3 above)
