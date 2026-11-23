# Managed edition: bringing it up on a new machine

The managed edition is a **multi-tenant service**: Postgres behind PgBouncer,
the API, the web app, and the **worker**, the compose service that runs the
background jobs on pg-boss in the same Postgres (ADR-0054). Until alpha.18 a
self-hosted Trigger.dev plane was kept installed and stopped beside it as the
way back; alpha.18 removed it (workplan 0167 T9, and
[*Trigger.dev's plane, removed*](#triggerdevs-plane-removed) for a stack
that still holds what it left). This document is how to stand the stack up,
kept next to the script that executes it.

- **The script:** [`deploy/compose/bootstrap-managed.sh`](../deploy/compose/bootstrap-managed.sh)
- **This document:** the same steps in prose, with every dashboard screen
  written out, what "it worked" looks like at each step, and a failure table.

Read the two together. The script refuses rather than guesses, and every
refusal it prints names the section here that explains it.

---

## The one thing that cannot be automated

The decisions in `deploy/compose/.env`: which names the stack answers on, who
may sign in, where mail goes. The script writes the file with every secret
generated and stops once, so that a person reads it; nothing else needs a
human.

| Step | Who |
| --- | --- |
| Generate every secret | script |
| **Read `.env` and make the decisions in it** | **you** |
| Bring up Postgres, set `app_user` and the owner to `.env`, create the pooler's lookup role, bring up PgBouncer | script |
| Remove what is left of Trigger.dev's plane's containers, on a stack that ran it | script |
| Build and start the API, the web app and the worker | script |
| Prove an enqueue becomes a run on this machine | script (`smoke-managed.sh`) |

Until alpha.18 there were two more stops, for the Trigger.dev plane's account
and its deploy CLI's login; the plane is gone, and so are they.

---

## Cutting over from the pre-rename stack (one time)

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

Its older name is `openmig-dev-stalwart*`, <!-- PRE-RENAME SWEEP --> so a long-lived box may
show both generations. `e2e.yml` removes the older one itself (the
lines marked `PRE-RENAME SWEEP`); you do not need to, and should not reach for
a wildcard that would take the current one with it.

**Do NOT delete `~/.persistent/open-migrate-managed`.** It holds the stack's `.env`
— including `SECRET_ENCRYPTION_KEY`, the key that decrypts every stored credential
in the database — and `userlist.txt`, PgBouncer's, which the
OTA stack's `pgbouncer` mounts from the persisted directory under its new name
(*PgBouncer's userlist lives in the persisted directory*, below). It lives
outside the checkout precisely so `actions/checkout`'s clean cannot reach it,
which also means nothing else will recreate it. **Move it:**

```bash
mv ~/.persistent/open-migrate-managed ~/.persistent/ownpace-managed
```

If the repository variable **`MANAGED_ENV_PERSIST_DIR`** is set explicitly, it
overrides the workflow default and still points at the old path — update it in
GitHub → Settings → Variables, or the nightly e2e restores `.env` from a directory
that is no longer there.


## Before you start

**Host**

- Linux with **Docker** and **Docker Compose v2** (`docker compose version`).
- **Node 26+** first on your shell's `PATH`, with **`libatomic1`**, and **pnpm**
  (the seed, the site build and the smoke run on the host, not
  in a container). `engines` asks for `>=26`, and every
  gate runs the host steps on 26. The official Linux binaries of Node 25 and
  later are linked against `libatomic.so.1`, which a host may not have, and
  Node 25 and later ship **no corepack**, so any `pnpm` that runs the version
  `package.json`'s `packageManager` names will do, whatever installed it: a
  standalone pnpm, or `npm install -g` of that version into a Node 26 of your
  own, without `sudo` (step 4 of the section below), never a bare `pnpm@11`,
  which takes whatever was published last, inside the repository's three-day
  floor or not. What has to be 26 is the `node` first on
  the `PATH` of the shell you run the scripts from (`command -v node`, `node
  -v`); a system Node another service on the host runs on stays as it is. See
  [*The Node in the shell you deploy from*](#the-node-in-the-shell-you-deploy-from).
- `openssl`, `curl`, `git`.
- **~15 GB free disk.** The built API, web and worker images, the pulled ones
  and the database add up; running out midway leaves a stack that is partly
  built and wholly confusing.
- **Memory: about 7 GB for one stack, and 20 GB for live beside the OTA stack.**
  A stack's resident services take about 4 GB. Every
  copying pass runs on the `small-1x` preset, which is enforced: half a CPU and
  0.5 GB. So one stack at its default of 3 passes in flight needs about
  4 + 1.5 GB, plus 20% headroom. Live at 6 beside the OTA stack at 3, with the
  appliance's nightly run (`e2e.yml`, about 2 GB), needs about 18 GB; the
  machine gives the stacks 20 GB. To size `MAX_PASSES_IN_FLIGHT` for another
  machine, use the formula beside it in `managed.env.example`:
  (the memory the stacks may use ÷ 1.2 − both stacks' resident services − the
  other stack's cap × 0.5 GB − the nightly's 2 GB) ÷ 0.5 GB.
  **These figures were worked out for Trigger.dev's plane, before alpha.18,
  and the passes' share holds on pg-boss too.** Every run is a process of the
  worker, which runs at most `MAX_PASSES_IN_FLIGHT` + 2 runs at once across
  all its queues; a run past that waits in its queue. Its memory limit is
  (`MAX_PASSES_IN_FLIGHT` + 2) × 512 MB + 256 MB, the same half GB a run and
  256 MB for the worker itself: 2,816 MB at 3 and 4,352 MB at 6 (*The
  worker's size*, below). It is a ceiling, not a
  reservation (about 120 MB idle). The 4 GB of resident services above
  included the plane's, which alpha.18 removed; the figure without them has
  not been measured, so the sizing above errs high.
- **CPU: half a CPU per pass in flight**, beside the resident services: at 6 and
  3, that is 4.5 CPUs for passes. The resident services' own figure is still to
  be measured on the machine; until then these numbers are estimates, not
  measurements.
- The repository cloned, and `pnpm install --frozen-lockfile` done.
- **Container output: Docker's default log driver, kept until the container
  is removed, and the stack's capped by size.** Docker's
  default, `json-file`, keeps a container's output with the container, with
  no limit of age or size, until the container is removed, and removes it
  with the container. A service whose image and settings do not change keeps
  its container for months, so every service in `managed.yml` sets `json-file`
  itself, with a cap: five files of 20 MB, at most 100 MB a
  service and 1.8 GB a stack, the oldest lines going first. Two kinds of
  container keep the daemon's driver: the website's (`www.yml` sets no cap,
  because `site-visits.sh` counts visits from the whole of its log) and any
  container a script starts with `docker run`. Leave the daemon at Docker's default,
  `json-file`. `local` will do too: it keeps the output with the container in
  the same way, but rotates it by size (about 100 MB per container by
  default, by Docker's documentation: five files of 20 MB, compressed), so the
  oldest lines can go sooner, never later, as they do under the stack's cap.
  That is what the privacy policy says of server logs (§9): kept until the
  part of the service that wrote them is replaced, with no fixed period.
  But on `local` the site's log is capped too, and the visit count then covers
  only what is left of it, which is why `json-file` is the one to keep.
  The host's journal would keep them after the container is gone, for as long
  as the journal keeps anything, so do not hand them to it. Check the machine
  (`stand-up-live.sh` asks too, and refuses any other answer):

  ```bash
  docker info --format '{{.LoggingDriver}}'    # json-file, or local
  ```

  If it prints `journald`, `/etc/docker/daemon.json` sets it: take the
  `"log-driver"` line out (the file may hold nothing else, `{}`), then
  `sudo systemctl restart docker` and ask again. A container keeps the driver
  it was created with, so one created before the change writes to the journal
  until it is recreated; do this before a stack's bring-up and there is none.
  What went to the journal stays there until the journal's own retention
  removes it. `docker compose logs` reads the output either way. The appliance
  keeps its month (`docs/selfhost-quickstart.md`); this is the managed machine.

**Ports** published on the host, all overridable in `.env`. Every one of them
answers on `127.0.0.1`. The last column is the setting that adds an address
(see *Which address a port answers on*, below):

| Port | Service | Notes | Adds an address |
| --- | --- | --- | --- |
| 3001 | API | `API_PORT` | `API_BIND`, leave it empty |
| 3123 | web | `WEB_PORT` — **routed**: the app's public name leads here | `WEB_BIND` |
| 5432 | Postgres | `POSTGRES_PORT` — the host-run seed and migrations need it | `POSTGRES_BIND`, leave it empty |
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

**`GET /metrics` on the API port is unauthenticated**, deliberately: it carries
counts and durations only, but the aggregate volume it
reveals is not for the public internet. The web image proxies only `/api/*`,
so `/metrics` is reachable only on port 3001 itself. Keep 3001 off any public
interface, and if a reverse proxy does front 3001 directly, do not forward
`/metrics`. Scrape it over the compose network or loopback.

### Which address a port answers on

A port published with no host address answers on **every interface**
(`0.0.0.0`). Docker writes its own firewall rules for a published port, so a
host firewall's input rules do not close it. And a container reaches every port
its host publishes through its network's gateway, so on a machine with two
stacks each stack's containers could reach the other's database.

So each port has two entries in `managed.yml`: `127.0.0.1`, fixed, and
`${<NAME>_BIND:-127.0.0.1}`. Empty, the bind renders the same as the first
entry and Compose keeps one. Set, it adds that address, and loopback stays,
because the bring-up, the smoke and the seed ask these ports on
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
  address the same way: `STATUS_BIND` for a status page reached over the mesh
  even where no name is routed to it. The OTA stack's status page is reached
  that way.
- **Leave `POSTGRES_BIND` and `API_BIND` empty.** Nothing off the
  machine needs the database, or the API with its unauthenticated `/metrics`.

**The gate's log is public, and a bind is this machine's address.** The nightly
gate runs here, anybody can read its log, and any signed-in account can
download its evidence. None of these values is a secret, so GitHub hides none
of them. So what the gate runs names a bind and Nextcloud's trusted domains by
their KEYS: `ps` without its PORTS column, an origin printed only when its
host is loopback. Behind that, the gate
masks each of these values for the rest of the job as soon as it restores the
`.env` (`deploy/compose/own-addresses.sh --mask`), and the smoke's own stream,
the container logs a failed bring-up dumps, and the uploaded evidence are
filtered: a value becomes the key that holds it (`<MAILPIT_BIND>`), and any
address in the mesh's range, `100.64.0.0/10`, becomes `<mesh-ip>`. A mask
covers the gate's log and nothing else, so a new line that prints one of these
names the key instead. `scripts/a-public-log-that-named-the-machine-it-ran-on.unit.test.ts`
holds all of it. Runs published before 2026-09-27 printed the mesh address;
their logs can be deleted from the run's page on GitHub.

```bash
# deploy/compose/.env — 100.64.0.1 is the SHAPE of a mesh address, not yours
WEB_BIND=100.64.0.1
ZITADEL_BIND=100.64.0.1
```

Then recreate the services whose binds you set, for example
`docker compose -f deploy/compose/managed.yml up -d web zitadel` (the status
page's service is `gatus`). `docker ps --format
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
prints can go into a public log.

**Containers on the machine that are not Ownpace's.** The machine also runs
services of the owner's that have nothing to do with Ownpace, and some of them
publish on every interface. `EXPOSURE_NOT_OURS` in the same `.env` lists those
containers by the names `docker ps` prints, matched exactly,
separated by commas with no space (`EXPOSURE_NOT_OURS=someones-app,notes-db`),
and each stack's `.env` carries the same list. For a container named there, a
port on every interface or on an address `EXPOSURE_ALLOW` does not list is a
note (*"note: someones-app publishes 5555/tcp on every interface; not Ownpace's,
accepted in EXPOSURE_NOT_OURS"*), not a failure, and the closing `ok:` line
counts them. So the check does not hold every publish on the machine to
loopback and `EXPOSURE_ALLOW`: those containers' are the owner's to judge. **The
check refuses an Ownpace container it recognises** (exit 2): a name beginning
with `ownpace` (every container Ownpace starts here but `dev.yml`'s Postgres is
named so), or a running container Docker labels as Ownpace's Compose stack: its
project `ownpace…`, its files under `deploy/compose/` or `deploy/selfhost/`
whatever the project, or its project `compose` with no files said. `compose` is
what `dev.yml`'s stack runs as without a `name:` of its own, and what any
compose file in a directory called `compose` runs as, so one of the owner's own
there is told apart by its files. An entry that is not a container name is
refused too. **Not every Ownpace container is recognised:** one started without
Compose and without an `ownpace` name, by hand or by tests (a `docker run` of an
Ownpace image, the Postgres `scripts/squash-migrations.sh` starts, the CI jobs'
testcontainers), is not, so list only the owner's own
services. A listed name that is not running is a note naming the entry by its
place in the list, never repeating it. Live's `.env` needs the key too.

`deploy-live.sh` runs `exposure-check.sh` after each deploy of live, and a
deploy it fails did not take; live's daily duties run it too (*Live's daily
duties*, below). The same question from outside is the dispatch-only workflow *Exposure probe*
(`.github/workflows/exposure-probe.yml`), on a GitHub-hosted runner. It needs
the repository variable `EXPOSURE_PROBE_LIVE_PORTS`, live's `*_PORT` values, and
takes the machine's own public address from the optional secret
`EXPOSURE_PROBE_HOST`, kept in the job's environment, `exposure-probe`
(workplan 0163 T1). It also asks `app.`, `id.`, `status.` and
`www.ownpace.eu` for the page a visitor asks first, and fails while NetBird's
sign-in answers one of them instead of the service (*After the script: the
owner's steps*, step 5). And it asks live's form that founds an organisation,
`/ui/login/register/org` at `id.ownpace.eu`, and fails unless it answers 404, a
redirect included: the smoke asks that page on the OTA stack, and never runs on
live. And it reads the headers of `https://app.ownpace.eu/` as a tester's
browser gets them, and fails unless the policy, HSTS and the three beside them
arrive once each as the app's template states them at the commit live's own
`/version.json` names. A port the front answers by itself, which never reaches
the machine, goes in the optional repository variable
`EXPOSURE_PROBE_FRONT_PORTS`, and only after a capture on the machine during a
probe run has shown that nothing arrives. On a production name's address such a
port answering is then a note, unless it answers as PostgreSQL, or presents a
certificate from Caddy's own local CA (as the Trigger.dev dashboard's TLS front
did, until alpha.18), and either fails; on the machine's own
address, and on an address only the OTA names resolve to, it fails.

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
>    opened from a laptop over the mesh** (the OTA stack's is).
> 2. **The site, before it is next recreated.** No gate run touches the site,
>    so it keeps its old publish, on every interface, until somebody runs
>    `docker compose -f deploy/compose/www.yml up -d` from an updated checkout.
>    Set `WWW_BIND` in the `.env` beside `www.yml` in that checkout, then run
>    it, then check that `docker ps --format '{{.Names}} {{.Ports}}'` shows
>    `ownpace-www` on `127.0.0.1` and the front's address, and that the site's
>    name answers.

---

## The short version

```bash
git clone … ownpace-managed && cd ownpace-managed
pnpm install --frozen-lockfile

./deploy/compose/bootstrap-managed.sh          # creates .env, then stops
#   … read deploy/compose/.env and make the decisions in it …
./deploy/compose/bootstrap-managed.sh --from data
```

One stop on a brand-new machine, and it goes away with `--accept-defaults` on
a throwaway demo box. The phases are `preflight env data demo plane app
smoke`; the `trigger`, `account`, `login` and `tasks` phases of alpha.17 and
before are gone with Trigger.dev, and `--from` or `--only` one of them is
refused in a sentence that says so.

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
`ownpace-live`, in a checkout of its own. Two stacks on one
Docker daemon are kept apart by names, so every name follows the project:

| What | Named | On the OTA stack |
|---|---|---|
| Containers | `<project>-db`, `<project>-api`, `<project>-idp`, `<project>-worker`, … | `ownpace-managed-db` |
| Volumes | `<project>_<volume>` | `ownpace-managed_zitadel_machinekey` |
| Networks | `<project>_ownpace-network`, `<project>_status-probe` | `ownpace-managed_ownpace-network` |
| The persisted `.env` | `~/.persistent/<project>/` | `~/.persistent/ownpace-managed/` |

So a command reaches a stack in one of two ways, and never by a fixed name:

- **Through Compose, from that stack's checkout.** `docker compose -f
  deploy/compose/managed.yml exec postgres …`, `… logs worker`, `… ps`.
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
  and no value. Live's `.env` sets `COMPOSE_PROJECT_NAME=ownpace-live`; without
  that line every script in live's checkout would drive the OTA stack with
  live's `.env`. A `docker compose` you type yourself does not
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
`docker compose` command you type yourself does not refuse. The same goes for
`PGBOUNCER_USERLIST`, which only the OTA stack's `.env` sets:
exported from it, a `docker compose up` in live's checkout would recreate live's
pooler on the OTA stack's userlist. `bootstrap-managed.sh` and
`ensure-env-secrets.sh` refuse that shell; a command you type does not. A new
shell clears both (*PgBouncer's userlist lives in the persisted directory*).

Names keep two stacks apart by configuration. They are not a boundary: the
host's Docker socket can start a container on any network, and whoever holds
it holds both stacks. Since alpha.18 no container of either stack holds it
(Trigger.dev's `trigger-docker-proxy` did).

### Reading what the api container was started with

The API image is distroless: Node and the few libraries it
needs, with no shell, no `printenv` and no package manager, and Node at
`/nodejs/bin/node`, which is not on its `PATH`. A shell, `printenv` or a bare
`node` exec'd into the api container finds nothing there. So what the API was
started with is read from Docker, from the stack's checkout, which answers the
same for the Node image of `v0.2.0-alpha.2` and earlier:

```bash
docker container inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$(docker compose -f deploy/compose/managed.yml ps -q api)" | grep '^NODE_ENV='
```

That is the image's `ENV` with Compose's `environment:` over it, one line per
name: what the process started with, whichever image a stack runs, rolled
back to an older tag or not. The list holds the stack's secrets, so `grep` for the name you want and nothing wider. Write
`docker container inspect`, not `docker inspect`: given a name that is no
container, the latter falls through to the image Compose built under the same
name, and answers with the image's `ENV` alone.

To ask something from inside the stack's network, as the smoke does, run Node
by its path: `docker compose -f deploy/compose/managed.yml exec -T api
/nodejs/bin/node -e '…'` (`/usr/local/bin/node` on the Node image of
`v0.2.0-alpha.2` and earlier).
The scripts do both this way (`api_env` and `api_node` in
`deploy/compose/smoke-managed.sh`, `api_env` in `deploy-live.sh` and
`stand-up-live.sh`), and `scripts/an-api-image-with-nothing-to-exec.unit.test.ts`
refuses a shell, `printenv` or a bare `node` exec'd into the api container in
`deploy/`, the workflows and `docs/`.

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
generates every missing secret — `JWT_SECRET`, `SECRET_ENCRYPTION_KEY`,
`PGBOUNCER_AUTH_PASSWORD`, the identity provider's, and the system and jobs
roles' passwords — and writes
`pgbouncer/userlist.txt`, or the file `PGBOUNCER_USERLIST` names, which on the
OTA stack is in its persisted directory (*PgBouncer's userlist lives in the
persisted directory*). It is idempotent: a value you already set is never
rotated. Then it pins `DEPLOY_IMAGE_PLATFORM` to this host's architecture.

**The provisioning token's first date.** It also writes `ZITADEL_PAT_EXPIRY`,
`ZITADEL_PAT_LIFETIME_DAYS` (7) days out, which `managed.yml` requires: the
identity provider reads it once, at its first start, as the expiry of the token
`setup-zitadel.sh` works with, and refuses to start on a date already past. A
date still ahead is kept; an empty, past or unreadable one is replaced, and a
replaced date is printed. Every later phase writes it the same way before its
first compose command, so a `--from` run that skips this phase is covered too.
After the first start, `setup-zitadel.sh` keeps the line on the live token's
own date.

**The two database passwords**: `POSTGRES_PASSWORD` and `APP_DB_PASSWORD`.
(Until alpha.18 there were five: Trigger.dev's database, event store and
object store had one each.) The example ships them empty, and
`ensure-env-secrets.sh` generates each one while its volume, `postgres_data`,
does not exist yet. While that volume does not exist, it also replaces a value
this repository publishes. Once the volume exists it writes nothing for that
key, and says so. Postgres keeps the password its volume was made with, so a
new value here would not reach the roles. On a stack whose volume exists, they
go through `rotate-db-passwords.sh --rotate`. A value you set yourself is
never touched.

Empty, a `change-me…` value, or one of compose's or the migration's defaults is
a value anybody can read in this repository
([`shipped-passwords.sh`](../deploy/compose/shipped-passwords.sh) lists them).
On a **real address** (`WEB_URL` is https and not localhost) every phase from
`data` on refuses them, naming each key and never a value. On localhost it is a
note: a developer's own stack is where they are fine (`--accept-defaults`).
On a stack whose volumes exist, change them together with the database:
[Changing the database passwords](#changing-the-database-passwords) below.
`managed.yml` keeps a compose default for each of the two (`${KEY:-…}`): the
refusal is the bring-up's, not compose's, so an empty key on localhost is a
note and not a compose error. `stand-up-live.sh` generates the two for live's
new volume with a list of its own, the same two.

**What it will not decide for you.** It *reports* these and moves on:

- `NEXTCLOUD_ADMIN_PASSWORD` still at its shipped default, and either of the two
  above still shipped because its volume exists. Fine for a demo box on
  localhost; not fine for anything a customer reaches.
- `CORS_ORIGIN` / `WEB_URL` / `API_URL`. On a real deployment these are the
  public https addresses. `API_URL` is where **Mollie's servers** deliver
  payment webhooks: with `MOLLIE_API_KEY` set, the API refuses to boot in
  production on a localhost `API_URL`, because the alternative is payments
  that complete while invoices never leave `sent`. Every consent's redirect
  is built from it too, without Mollie (§8e, step 4). On `ownpace-live`,
  `deploy-live.sh` refuses any of the three that is not live's own https
  address (*`ownpace-live`: a release tag, with `deploy-live.sh`*).
- `PRICING_*` — integer **cents**, never euros. They are a template for *new*
  tenants; each tenant's agreed prices are pinned in the `tenant_pricing` table
  the first time their money is computed and never follow this file again. That
  table is created by the MANAGED migration chain, which the API
  applies after the shared one — an appliance applies only the shared chain and
  has no such table.
- `SMTP_*` / `NOTIFY_*` — set them all or none. Half-set, the channel stays off
  and names what is missing.
- `OAUTH2_*` — only for a stack with a Microsoft Graph source or the drift
  detector. An IMAP-only stack needs none of it.
- `*_BIND` — the address a port answers on besides `127.0.0.1`. Empty is
  loopback only, which is right for a machine nothing is routed to. A public
  name routed here needs `WEB_BIND` and `ZITADEL_BIND` (and `STATUS_BIND`): see
  *Which address a port answers on*. Every phase that runs Compose refuses a bind that is a name,
  `0.0.0.0` or a comment, naming the key.
- `OWNPACE_REACHABLE_HOSTS` — empty, and on live it stays empty: `stand-up-live.sh`
  and `deploy-live.sh` refuse live's `.env` when it names a host. The API and
  every job's run refuse to connect to a host a tester typed when it resolves
  inside this service's own network, except for the exact names this lists.
  An entry admits that name for every organisation on
  the deployment. The `demo` phase adds the demo's two; nothing else belongs
  here.

Edit `.env` by hand, or use
[`env-upsert.sh`](../deploy/compose/env-upsert.sh), which replaces a key where
it already sits instead of appending a second copy of it:

```bash
./deploy/compose/env-upsert.sh deploy/compose/.env WEB_URL=https://…
```

A secret goes on its standard input instead (`printf 'KEY=%s\n' "$v" |
./deploy/compose/env-upsert.sh --stdin deploy/compose/.env`): an argument is on
the command line, which `ps` shows every account on the machine.

It refuses a value containing whitespace, a quote, `$`, a backtick or a
backslash. That is not fussiness: every consumer of this file reads it with
`set -a; . .env`, so such a value is re-interpreted by a shell, and compose's
own parser would disagree about what happened.

**It stops here the first time.** The file has just been created, so none of
those decisions has been made. Read the file, then resume with `--from data`.
On a throwaway demo box where the shipped values are the right answer,
`--accept-defaults` removes the pause.

**Verify:** `grep -c '=.' deploy/compose/.env`, and that
`deploy/compose/pgbouncer/userlist.txt` exists (on the OTA stack, the file
`PGBOUNCER_USERLIST` names).

**Never commit `.env`.**

### 3. `data` — Postgres, the two roles, the pooler's lookup role, PgBouncer

```bash
docker compose -f deploy/compose/managed.yml up -d --wait postgres
#   … app_user and the owner set to .env's values (below) …
PGOPTIONS="-c my.pw=$PGBOUNCER_AUTH_PASSWORD" \
  docker compose -f deploy/compose/managed.yml exec -T -e PGOPTIONS postgres \
  psql -U openmigrate -d openmigrate -f - < deploy/compose/pgbouncer/setup-auth.sql
docker compose -f deploy/compose/managed.yml up -d --wait pgbouncer
#   … both roles asked over the stack's network and through the pooler …
```

**The two roles match `.env` on every run.** A role keeps
the password it was made with: Postgres reads `POSTGRES_PASSWORD` once, when the
volume is made, and migration `0001_baseline.sql` creates `app_user` with a
published password whenever no such role exists. So once Postgres is healthy,
and before anything migrates, the phase creates `app_user` from
`APP_DB_PASSWORD` when it does not exist, sets its password when it does, and
sets the owner's. It is one transaction over the database's socket, as the
owner, with the same function `rotate-db-passwords.sh --sync` uses
(`db-roles.sh`). Once the pooler is up it asks both roles, the way the stack's
containers do: over the stack's network and through PgBouncer. A role that does
not open stops the phase. On a stack whose roles already hold `.env`'s values,
each is set to the value it has.

**No value on a command line.** Each password reaches its container by name,
from the environment of the one `docker` call that needs it (`-e PGOPTIONS`,
never `-e PGOPTIONS=…`), and the SQL a container is given names a variable,
not a value. `ps` shows every account on the machine a command line.
`setup-auth.sql` takes `pgbouncer_auth`'s password as the session setting
`my.pw`.

**The order is the whole point.** PgBouncer's healthcheck authenticates as
`pgbouncer_auth`, and that role is created by `setup-auth.sql`, which needs
Postgres up. Bring both up together on a fresh box and it hangs at the
healthcheck complaining about a password, when the cause is a role that does
not exist yet.

**Verify:**

```bash
PGPASSWORD="$PGBOUNCER_AUTH_PASSWORD" \
  docker compose -f deploy/compose/managed.yml exec -T -e PGPASSWORD pgbouncer \
  psql -h 127.0.0.1 -p 6432 -U pgbouncer_auth -d pgbouncer -tAc "SHOW POOLS"
```

The password goes to the container by name, as the phase passes its own.

Anything back, containing `transaction`, is the pooler serving in the right
mode.

**With `--with-demo`, the demo Nextcloud's database comes first.** Its first
install reads `POSTGRES_*` from `managed.yml` and connects as the role `nextcloud` to the database
`nextcloud` in this Postgres, so the phase makes both before Nextcloud starts
(`deploy/compose/nextcloud-db.sh`). A role it makes gets `.env`'s `NEXTCLOUD_DB_PASSWORD`, which
`ensure-env-secrets.sh` generates. A role that exists keeps its password while a Nextcloud is
installed: that Nextcloud connects with the value in its own `config.php`, and changing the role
under it gives 500s until the two agree again. After Nextcloud answers, the phase says which
database it uses, and the one step that makes the three agree:

- **Still on SQLite**, an older install: `./deploy/compose/nextcloud-to-postgres.sh --convert`.
- **On Postgres, with another password in `config.php`**, like the OTA stack, which was moved by
  hand: `./deploy/compose/nextcloud-to-postgres.sh --sync-password`. Nothing reads `.env`'s value
  until a fresh install, so this can wait for a quiet moment.

Both stop Nextcloud while they run, so pause the migrations that write into it first, and both
start it again whatever happens. When a step of `--convert` fails, Nextcloud comes back on SQLite
as it was. When `--sync-password` fails after writing `config.php`, it says so; running it again
sets only the role. The script alone, or with `--check`, changes nothing and says where it stands. A database that still holds the tables of a Nextcloud whose volume is gone stops
the phase, and prints the command that drops it; nothing here drops a database.

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
could be a slip of it (`STACK_KIND`, `stack_may_be_live` in `stack-kind.sh`).
The OTA stack's `.env` carries no such line, so the nightly
gate's `--with-demo` goes on. The seed:

```bash
DATABASE_URL=postgresql://…@localhost:5432/openmigrate \
DIRECT_DATABASE_URL=… JWT_SECRET=… SECRET_ENCRYPTION_KEY=… \
  ./deploy/compose/seed-managed.sh
```

Those exports matter. The seed runs **on the host** and inherits nothing;
nothing in `apps/api` loads a dotenv file. It also runs the migrations itself —
**both chains**, shared then managed, each advisory-locked under its
own key, so racing an API boot is safe — which is why the schema exists before
the API has ever started. The order is not a preference: every table in the
managed chain references `public.tenant`.

**Verify:** the seed prints two demo owner tokens. Re-running it is a no-op.

### The job runner: `OWNPACE_JOB_RUNNER`

The managed edition runs its 17 background jobs on pg-boss, the `worker`
service, on our own Postgres (workplan 0167, ADR-0054). alpha.16 and alpha.17
could also run them on a self-hosted Trigger.dev plane, kept installed and
stopped as the way back (`OWNPACE_JOB_RUNNER=trigger`); alpha.18 removed that
plane, and `pg-boss` is the only value left. The key keeps its reader so that
an old `.env` fails loudly instead of being ignored:
`deploy/compose/job-runner.sh`, which every script here uses, reads it as
Compose hands it to the containers (this shell's `OWNPACE_JOB_RUNNER`, else
`.env`'s, else `managed.yml`'s default, `pg-boss`). Unset or empty means
`pg-boss`. `trigger` stops every script, the API and the worker in one
sentence: Trigger.dev was removed in alpha.18, so remove the key from the
`.env` or set it to `pg-boss`. Any other value stops them too, before anything
runs.

**The worker.** One container, `<project>-worker`, built from
`apps/worker/Dockerfile` on the API's images; its process is
`apps/worker/src/runner/main.ts`. It is in no profile. It connects as the jobs
role, `ownpace_jobs`, with `JOBS_DATABASE_URL`, through PgBouncer, to the
schema `pgboss` (*The jobs role*, below), and the jobs themselves read the
environment `managed.yml` hands the worker (`SYSTEM_DATABASE_URL`,
`APP_DATABASE_URL`, `SECRET_ENCRYPTION_KEY` and the rest), never the database
owner's. Each job's run is a child process of
the worker. The app phase builds it together with `api` and
`web`, from the same `GIT_SHA`, and starts it after the api is healthy (the
api applies the migrations the jobs read); when the run replaced the api's
container, it recreates the worker too. Its health is `GET
http://127.0.0.1:3002/health` inside its container, which answers 200 once the
runner runs; `managed.yml`'s healthcheck asks it every 30 s, and the app phase
waits on it. A stop gives the runs going 45 s to finish, then kills what is
left and fails it to be retried, all inside the service's 60 s; a run cut off
past that is picked up again by its heartbeat.

**The worker's size.** `.env`'s `WORKER_CPUS` and `WORKER_MEMORY` when it sets
them; otherwise the bring-up works them out from this stack's
`MAX_PASSES_IN_FLIGHT` and hands them to Compose for that run, without writing
`.env`: 0.5 × (`MAX_PASSES_IN_FLIGHT` + 2) CPUs and
(`MAX_PASSES_IN_FLIGHT` + 2) × 512 MB + 256 MB: half a CPU and 512 MB for each
of the runs the worker runs at once, at most `MAX_PASSES_IN_FLIGHT` + 2, and
256 MB for the worker itself. At that limit, with every run at its budget, the
memory holds: every run at the 512 MB budget `small-1x` gives every queue
alike, a pass or not (V8's heap is capped at 410 MB of it on every queue; a pass
measured 307 MB, another run 203 MB), and the worker's own process (120 MB
measured), with 136 MB to spare. That is 2.5 and `2816m` at the default cap of
3, and 4 and `4352m` at 6. A value `.env` sets is the one used, as in Compose.
One above the rule (alpha.16's rule was (`MAX_PASSES_IN_FLIGHT` + 1) × 512 MB +
2,816 MB, `6400m` at 6) is kept, and the bring-up says so in one line, once a
bring-up:

```text
WORKER_MEMORY 6400m, from .env, is above the rule's 4352m for MAX_PASSES_IN_FLIGHT 6 (the worker runs at most 8 runs at once), and is kept as set. To take the rule: ./deploy/compose/env-upsert.sh <the .env> WORKER_MEMORY=4352m
```

One below the rule is kept too, and said as a warning: a run at its budget
may not fit. Docker refuses a `cpus` above the host's CPU count, and a
memory limit above the host's memory is one no host can give, so the bring-up
refuses either, in one sentence, before the worker starts. A line that passes names no number of the host's (the gate's log is
public); a refusal does. Where a worked-out size differs from `managed.yml`'s
default, the bring-up says that a compose call outside it (a hand
`docker compose up -d`) would recreate the worker at the default, and prints
the one `env-upsert.sh … WORKER_CPUS=… WORKER_MEMORY=…` that keeps the size in
`.env`; it writes nothing there itself.

**A stack whose `MAX_PASSES_IN_FLIGHT` is not 3 sets `WORKER_CPUS` and
`WORKER_MEMORY` in its `.env`**, from the rule above, so that every compose call
agrees, the bring-up's and a hand `docker compose` alike: the values the
bring-up works out hold only for its own calls. A stack at 6 sets
`WORKER_CPUS=4` and `WORKER_MEMORY=4352m`; one whose `.env` still holds
alpha.16's `6400m` at 6 works as it is, and takes the rule with
`./deploy/compose/env-upsert.sh deploy/compose/.env WORKER_MEMORY=4352m`.

**A comment where the worker reads a value.** A `.env` line such as
`LEDGER_RETENTION_DAYS=  # days` (spaces or a tab, then `#`) is empty to bash,
and Compose hands the container the comment itself as the value, even over a
`${KEY:-default}`. Older examples (alpha.1 to alpha.15) shipped
`LEDGER_RETENTION_DAYS`, `LEDGER_RUN_RETENTION_DAYS` and `LOG_LEVEL` that
way. The bring-up refuses
when any key the worker receives has such a line, naming each; put the comment
on a line of its own above the key. It never rewrites `.env`.

**Seeing the jobs.** pg-boss has no dashboard. `./deploy/compose/operator.sh
jobs` lists the queues with their runs queued, active and failed, and its
subcommands `failures`, `show`, `cancel` and `run` do the rest
([operator runbook](./operator-runbook.md#the-jobs-on-pg-boss-seeing-and-steering-them)).

### 5. `plane` — what is left of Trigger.dev's plane

On a stack that ran alpha.17 or earlier, the plane's eleven containers
(`trigger-db`, `trigger-redis`, `trigger-api`, `clickhouse`,
`trigger-registry`, `trigger-docker-proxy`, `trigger-supervisor`, `minio`,
`minio-init`, `trigger-tls`, `trigger-tls-init`) are still there, stopped,
though `managed.yml` no longer names them. This phase finds them by their
Compose labels (`com.docker.compose.project` and
`com.docker.compose.service`), never by `--remove-orphans`, which would remove
anything the file does not name; stops any that still runs, the supervisor
first; and removes them with `docker rm`. It never removes a volume. When the
plane's volumes are still there, it says so and names the one command that
lists them, `./deploy/compose/remove-trigger-plane.sh --list`; removing them is
the owner's step, by name, once
([*Trigger.dev's plane, removed*](#triggerdevs-plane-removed)). On a new stack
there is nothing to remove, and it says that.

**Verify:** `docker ps -a --filter label=com.docker.compose.project=<project>
--format '{{.Names}}'` names no `trigger-*`, `clickhouse`, `minio` or
`minio-init` container. The smoke asks the same at its start and its end.

### 6. `app` — API, web and the worker

*Its sections below keep the labels 8b to 8i they had when this was phase 8:
the code, the ADRs and the workplans name them so.*

`docker compose build api web worker`, with `GIT_SHA` passed so `GET /version`
reports a commit rather than `unknown`, then `up -d --wait` without `--build`.
The phase starts the worker after the api, as *The job runner* says, once it
has asked the system role's question (below).
By name, because `up --build` builds every service in its scope that has a
`build:`, dependencies included, and the two databases have one (*Both
PostgreSQL databases run a build of the official image*, below). The API runs
both migration chains at boot, shared first.

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

**A host inside this network is refused.** The API and every job's run refuse to
connect to a host a tester typed when it resolves inside this service's own
network: loopback, the private ranges, link-local, CGNAT, unique-local, and a
compose name. A redirect is checked the same way. The Test
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
usable without it, and skipping it leaves the paste-box sign-in
([ADR-0042](./adr/0042-who-holds-the-passwords.md)): the owner mints a token
with the seed script and whoever needs one pastes it into `/login`.

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
`JWT_AUDIENCE` is the sign-in project's id, written in the same call as the
issuer. **Never set the issuer without it:** the API refuses to start with
`JWT_ISSUER` set and `JWT_AUDIENCE` empty, on every `NODE_ENV`, because it
would accept a token the issuer minted for any project.

**Two doors it keeps shut.** Nobody can found an
organisation of their own at the provider: the form at
`/ui/login/register/org` answers 404. And the project admits its own
organisation only, so an account in any other organisation gets no token for
the app. Every run sets both, reads both back, and stops if either did not
take; a fresh instance has the first from `managed.yml`. Self-registration
stays on: it registers people in the project's own organisation, and they
confirm their address by mail.

**Its languages.** The sign-in page offers Dutch and English
and no other. `ZITADEL_DEFAULT_LANGUAGE` in `.env`, `nl` or `en`, is its default:
set `nl` on live, where the testers are. Empty keeps the instance's own. Every run
sets both and reads them back, and prints them in its summary.

**The notice on its registration and sign-in pages.** The page where a tester
types a name, an address and a password links
the privacy policy and the terms: the instance privacy policy's `privacyLink`
and `tosLink`, which the page's footer shows and its registration form asks to
accept. Both are made from `VITE_LEGAL_SITE_URL` in `.env`, the key the web
app's links come from, by the same rule: empty is `https://www.ownpace.eu`, the
OTA stack's is its test site, and a value the web build refuses stops the run
before anything is written. They are the Dutch pages, `nl/privacy.html` and
`nl/voorwaarden.html`: Zitadel keeps one link per instance, and the testers are
Dutch; those pages switch to English. Every run writes the policy when a link
differs, copies its other five fields back as they were, and reads it back on
the instance and on the project's organisation, whose own policy would stand in
front of the instance's. It prints both addresses in its summary. A fresh
instance has them from `managed.yml`. They are always shown, also before the
texts are published there.

**A second factor offered, and a lock after ten wrong passwords.** The
login policy forces no second factor (`forceMfa` and `forceMfaLocalOnly` both
false) and allows two, an authenticator app (TOTP) and a security key (U2F):
anybody may add one from the provider's console, under their own account, and
nobody has to. Ten wrong passwords in a row lock an account, until an operator
unlocks it (`docs/operator-runbook.md`, *A sign-in account locked by wrong
passwords*); the count starts again after a correct password. The number is
one constant in `setup-zitadel.sh`, `SIGN_IN_LOCKOUT_PASSWORDS`, and the same
in `managed.yml` for a fresh instance. Every run writes what differs (a forced
factor back to not forced, a missing factor added, the number, with the
policy's limit for codes kept as it was), reads all of it back, also when it
wrote nothing, and stops if it did not take. Its summary says both under
`sign-in`. **Enrol yours:** the first human and every operator account can
make an address the API trusts, so each of them adds a second factor in the
console (`/ui/console`, the account's own page, its multi-factor section) and
signs in once with it to see it asked. That is the owner's step, live
first.

**The organisation's name.** The
console and the sign-in page show the first organisation's name, upstream's
`ZITADEL` unless `ZITADEL_ORG_NAME` in `.env` says otherwise. Live's is
`Ownpace`: `stand-up-live.sh` writes it there before the provider's first start,
and on live an empty key means `Ownpace`, so a live organisation that already
stands under another name is renamed on the next run. Elsewhere an empty key
keeps the name it has. A rename keeps the organisation's id, and moves its
generated domain with the name, so the first user's login name changes from
`owner@zitadel.<host>` to `owner@ownpace.<host>`; the summary prints the one
that holds. Testers sign in with their email address, which does not change.

**The mails it sends.** The five mails a tester can get
from the provider are in Ownpace's words, in Dutch and English: the one after
registering (Zitadel's *init* mail, which confirms the address), the one after
changing an address (*verifyemail*), the password reset (*passwordreset*), the
notice that a password was changed (*password_change*, which says to write at
once if the tester did not do it), and the link to add a passkey on another
device that a tester can send themselves from the provider's console
(*passwordless_registration*). The other five texts the provider has stay
upstream's, because nothing on this stack sends them; the script's comment
says why for each (no SMS, no email or SMS code as a second factor, no domain
claims, no invite codes). Each names Ownpace, says the account is for signing
in to Ownpace, and names the address to write to: `VITE_SUPPORT_EMAIL` in `.env`, the
one the web's pages show, and `support@ownpace.eu` when it is empty. A value
that is not one address stops the run before anything is written. The texts
live in `deploy/compose/sign-in-mails.json`; change them there, never only in
the console, because every run writes back any mail that differs from the file
and reads it back. A mail the provider refuses or does not take keeps
upstream's words: the run says so and goes on, and its summary names it under
`mails`. Run the script again once the cause is fixed. A mail goes out in the
person's own language, which the registration page takes from the page's.

**Then restart the API and REBUILD the web app, or nothing changes.** The API
only needs the new environment; the web app bakes `VITE_*` in at build time, so
a container built before the script ran has no issuer in its bundle and still
renders the paste box. The script prints these lines when it finishes (the web
image built by name: `up --build` would rebuild the databases' image too):

```bash
docker compose -f deploy/compose/managed.yml up -d --force-recreate api
docker compose -f deploy/compose/managed.yml build web
docker compose -f deploy/compose/managed.yml up -d web
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

#### One issuer or two?

**One per stack.** The OTA stack's provider lives at `id.ota.ownpace.eu`, and
live's at `id.ownpace.eu`: a **separate provider**, not a second name for the
OTA one.

Why not share one across both: the address is inside every token (see the note
above), so pointing a production stack at the test stack's issuer makes the
test stack a dependency of production sign-in and a single blast radius for
both.

What that means in practice:

- Every upstream OAuth client registered below gets a redirect URI on
  `id.ota.ownpace.eu`. It gets a **second** one on `id.ownpace.eu` only if
  production ever offers that provider: `ownpace-live` offers email and password
  only (*Not on `ownpace-live`*, below). The same client may carry both, or you
  may register a separate client per environment, which
  [ADR-0041](./adr/0041-who-owns-the-oauth-client.md) prefers for the
  *migration* client and which applies equally here.
- Accounts do not travel. Somebody who signed in to the test stack has no
  account on production, which is correct: they are different deployments with
  different data, and a shared identity provider would have made that look
  otherwise.

#### Offering Google, Microsoft, GitHub or Apple as a second way in

Optional, and configuration only — nothing in the product knows a provider's
name (`no-issuer-lock-in.unit.test.ts` fails the build on one). The
upstream goes into Zitadel, Zitadel still mints the token, and `tenant_member`
never learns anybody used Google.

**Not on `ownpace-live`.** Live's sign-in page offers email and password only,
as privacy §4.4, §7 and §8 say, so
`stand-up-live.sh` and `deploy-live.sh` refuse live's `.env` while any of the
keys below holds a value (`LIVE_REFUSED_SIGN_IN_KEYS`, `stack-kind.sh`). So
does `setup-zitadel.sh` itself, run by hand or by `bootstrap-managed.sh`,
before it generates a secret or starts anything; its `--print`,
`--token-only` and `--count-organisations` add no provider and still run. A
provider added there before stays configured at the identity provider; with
every key empty, the next stand-up or deploy turns "External IDP allowed" off,
which hides its button (*Emptying a pair removes less than it looks like*,
below). This section is for the OTA stack and other managed deployments.

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
must not know it.

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
closed. That is set once for every provider: a provider sign-in that minted a
second subject would orphan a membership, and the person would be locked out of
an organisation they are still in.

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
it — the same shape as `www-nginx.conf`.

`smoke-managed.sh` asserts this: it reads the cookie's domain off the
authorization response and names the rewrite rather than letting it surface as
an unexplained error page.

### 8c. Somebody who can answer the door *(needed before anybody can be let in)*

Also not a `bootstrap-managed.sh` phase. `access_request` is written by
strangers and readable by nobody until an **operator** exists — so a deployment
with no operators has a queue nobody can read and a
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

**`.env` carries no `DATABASE_URL` line.** `managed.yml` COMPOSES it from
`POSTGRES_*` and `DB_HOST` (in the `api` service's `environment:`), so a recipe
that reads it out of the file gets an empty value, and the script then refuses
for a requirement the reader seems to have met. `operator.sh` is the same
answer `seed-managed.sh` is for the seed: a wrapper that composes what a
host-run script cannot inherit, and that asks compose for the published port
rather than assuming 5432 — on the reference box this stack's Postgres is on
55432.

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
`Cannot remove yourself from the tenant`. Nobody else in the organisation can
remove a sole owner either: only an owner may remove an owner, so anyone else
gets `Only an owner can remove an owner`, and
`Cannot remove the last owner` still stands behind that.
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
existed and holding a token where an address belongs.

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
allow, and the product does not grant them. Run it on `ownpace-live` before the
first invitation, from live's own checkout, because `operator.sh` drives
whichever stack the checkout's `.env` names:

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

**An organisation nobody uses.** Under Support, the list of organisations counts
each one's active members, connections and migrations, says when its latest pass
began, and marks an open one nobody signed in to or nothing is connected to;
*Not in use* shows only those. Each organisation's page ends with *Close this
organisation*, the close `operator.sh close` makes, audited under your name with
the request you name (workplan 0139 T7 (b)). It is how to end an organisation a
granted request made, which `clean empty-tenant` refuses. From the close on, the
organisation takes nobody in: its unanswered invitation is neither taken up at a
sign-in nor offered, so somebody who signs up with that address afterwards is
told they belong to no organisation and is offered *Ask for access*. A Reopen
before the erasure gives it back, and it binds at their next sign-in. Somebody
already in it when you close it stays in it.

**How many grant links an organisation may hold at once.** As many live grant
links as its tier runs migrations at the same time:
Free 1, Small 4, Medium 20, Large 50, Extra large 200, and the largest past the
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

**What Google answers to `sync-collection`** (workplan 0164 T1), once, at the machine, on the
stack whose `.env` the checkout names:

```bash
./deploy/compose/operator.sh measure-google-sync
```

The one verb here that is the worker's CLI rather than the API's script, on the same owner
connection. It chooses the newest migration whose calendars come from Google over CalDAV and
prints that migration's id and creation date, reads each calendar of the account with one
`sync-collection` REPORT, asks you to change one event and delete another at Google and waits
for Enter, reads each calendar again with the first reading's token, and ends with the verdict
workplan 0164 §3.1 asks for. It sends Google's calendars PROPFIND and REPORT only, reads the
database in a transaction opened `READ ONLY`, writes nothing, and prints counts and status codes
only, so what it prints can be pasted anywhere. The steps for the OTA stack are in that plan,
*How to run T1*.

**The books** (`operator.sh moneybird`) are a step of their own:
*8i. The books and payments*, below.

**Verify** — the queue answers, and answers only for them:

```bash
curl -fsS -H "Authorization: Bearer <token>" http://localhost:3001/api/access-requests
```

Once appointed, signing in again lands the operator on **Access requests** in
the web app, which is the same queue with buttons on it.

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
| Change who may act on an organisation, or their role | **Team**, and it belongs to that organisation's owner | Membership *is* authorization. An operator does not hold it, and the roles are theirs to set |
| Reset a password, clear a lost second factor, unlock an account locked by ten wrong passwords, disable an account | **The identity provider's console** | Ownpace stores no passwords and never calls the provider's user-management API — ADR-0042's second and third operative rules, and what keeps the issuer swappable |

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

**The log.** Support links to **The log**: the audit log and the
application's own errors and warnings, one timeline, newest first, a hundred
rows a page. A row is metadata only: time, level, organisation, migration,
event, error category, reference number and, on an audit row, who acted (the
member's address, or the process's own name). Narrow it by level, the start of
an event name, category, reference or dates; an organisation's page and a
migration's page open it narrowed to them. When somebody quotes the reference
an error showed them, type it into **Reference**: the row says when, where and
what kind of error, and the error's text is in the API's or the worker's
output, on the line carrying the same `[ref …]`. A page that could not read one
of the API's answers records itself here too, as `web.answer_unreadable` under
the reference it showed (`incident-runbook.md`).

**Who deleted it.** Four acts leave an audit row with the
member who did them: deleting a migration (`mapping.deleted`), deleting a
connection (`connection.deleted`), replacing a connection's account
(`connection.credentials_replaced`, written when the probe refused the new
account too) and preparing a cutover (`cutover.preparation_requested`). Type
the name in **Event starts with**. A deleted migration's row still carries its
id in the **Migration** column, without a name, because its own row is gone;
the id narrows the log to the audit rows that migration left (its errors and
warnings lost their migration when it was deleted, because
`app_event.mapping_id` is set to null). A row's `audit_log.detail`, which the
page does not show (read it with the query below), holds the status a deleted
migration had (`statusBefore`), whether a replaced account was stored
(`accountStored`), and a preparation's run and whether the ledger, as the door
read it, held an approval the preparation revokes (`runId`,
`revokesApproval`; the job re-reads the ledger and remains the authority). Of
two deletes of the same migration or connection that overlap, the second
deleted nothing: it answers 404 and leaves no row. A preparation whose record
could not be written is still under way, and the page shows it as
`cutover.preparation_not_recorded` under a reference.

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

**The audit log in your own log store**. Every audit event
is also one JSON line on the output of the process that recorded it, in
OpenTelemetry's log format: `Body` is the event, `ownpace.audit.actor` who
acted, `ownpace.audit.id` its row in `audit_log`, and `Resource` says which
process (`ownpace-api`, or `ownpace-worker` for the jobs). Addresses and
file and folder names are pseudonyms (`pseudo:` and sixteen hex characters,
the same person always the same one), a URL keeps only its scheme and host,
and a detail field nobody has classified is left out. Docker keeps each
container's output with the container, not in the host's journal (`json-file`,
*Before you start*), so a collector reads it from Docker: `docker compose logs`,
or the file `json-file` writes for each container, which the stack's services
rotate at 20 MB and keep five of. A job's run on pg-boss is a child process of
the worker, and its lines are the worker container's output, capped the same
way; they go with the worker's container, which the bring-up replaces at each
update of the service, as it does the api's. A collector that is to forward the worker's lines reads
them as they are written; what it missed is still in `audit_log` (below). The audit lines are the ones carrying
`ownpace.audit.id`; the API's, from the stack's checkout:

```bash
docker compose -f deploy/compose/managed.yml logs --no-log-prefix --since 24h api | grep '"ownpace.audit.id"'
```

Ownpace sends these lines nowhere itself. The pseudonyms are made with a key in
`deployment_key`, which only the database owner can read and which every
backup of the database carries, so keep backups as private as the database.
Four commands typed at a terminal print no line: the worker's cutover CLI,
`operator.sh leave`, `operator.sh links` and `operator.sh close`. Their events
are in `audit_log` like any other, and the download below serves them.

**Lines your log store missed**. A collector that was down, or output
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
sign-in and nothing else: a log store cannot fetch it by itself. Its rows come
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
that outlives one person. The API refuses to leave an organisation with none:
the last active owner can be neither demoted nor removed. An invitation as
owner, or a declined one, does not count as an owner, and the count and the
change are one locked transaction, so two owners demoting each other at once
cannot both succeed. Only an owner may make somebody an
owner, or demote or remove one. An **admin** can do everything an owner can
except arm a deletion, close the account, make another owner, and demote or
remove an owner.

### 8d. The status page *(comes up with the stack)*

`gatus` starts with everything else in the `app` phase. It
listens on `STATUS_PORT` (default `3124`); put it behind the reverse proxy at
`status.<your domain>` alongside the app.

```bash
curl -fsS "http://localhost:${STATUS_PORT:-3124}/health"
```

`scripts/every-service-somebody-starts.unit.test.ts` compares `managed.yml`'s
service list against the bring-up's, so a service defined and never started
fails a test instead of quietly not existing.

**Read [`status-page.md`](./status-page.md) before you trust a green light.**
This page runs INSIDE the stack it watches, so it cannot tell you the stack is
down — when the box is off, the page is off. It answers three narrower questions
honestly: is a provider down (the usual cause of a stalled migration), is part
of Ownpace unwell while the rest serves, and was there an outage recently. The
page says this itself, in the button beside its heading.

What it watches is `deploy/compose/gatus.yaml` — in git, reviewed, and edited
with a restart rather than through a web console.

**Who it tells.** With `ALERT_ENABLED=true`, a row of the
Ownpace group that stays red for three minutes sends the owner one e-mail, and a
second when it is green again. It goes through the product's own relay, from
`NOTIFY_FROM` to `NOTIFY_TO`, unless `ALERT_SMTP_HOST`, `ALERT_SMTP_PORT`,
`ALERT_SMTP_USER`, `ALERT_SMTP_PASSWORD`, `ALERT_FROM` or `ALERT_TO` say
otherwise. Live's `.env` carries `ALERT_ENABLED=true`: testers are on live, so
`stand-up-live.sh` and `deploy-live.sh` refuse a live `.env` without it. Leave
it off on the OTA stack, whose
web app and API the nightly gate recreates on schedule. Apply a change with
`docker compose -f deploy/compose/managed.yml up -d gatus`.
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

The same two exist for Microsoft, and the confusion is the same shape:
`IDP_MICROSOFT_CLIENT_ID` signs people in, `MICROSOFT_OAUTH_CLIENT_ID`
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
`tasks.readonly` is believed to be (the console confirms it). Gmail's
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
§8b, *Start a migration* and the Accounts page ask the API what this deployment
serves (`GET /api/provider-accounts`) rather than having it compiled in, so how
many Google sign-ins the flow asks for, and the Google account card's tick
boxes on the Accounts page, follow the setting on the next page load.
There is deliberately no `VITE_` twin: two separately settable copies of one
fact is how a screen comes to offer what the server then refuses.

**The public site reads the same line, at its build.** Its Leaving Google page
says how many Google sign-ins to expect, so the site's build reads this one
setting from the same `.env`, and a site built before you changed it still says
the old number: rebuild it as
[the public site's section](#the-public-site-is-a-separate-stack-and-it-must-be-told-which-one-it-is)
shows. `deploy-live.sh` does that for live on every deploy.

#### Nobody has to paste a client secret

Registering the client is one job; typing it into a form once per connection
is another, and the second one is transcription work with a secret in it. Set
the pair once and the forms stop asking:

```bash
# in deploy/compose/.env
GOOGLE_OAUTH_CLIENT_ID=…apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=…
```

**The connection then stores neither.** It keeps
only the refresh token — the per-account half, the one that says whose data
this is — and the client is read at the moment a token is minted. Rotating the
secret at Google is therefore this one edit and a restart, not an edit per
connection.

**And the forms know.** `GET /api/provider-clients` answers `google: deployment`
once both halves are set (and `GET /api/provider-accounts` answers
`client: deployment`), so the account form — on *Start a migration* and on the
Accounts page — folds the Client ID, the client secret and the refresh token
away behind *Use your own Google client*, and enables *Connect with Google*
without them. Open
the fold and enter both to use your own client; enter one and it asks for the
other rather than pairing it with the deployment's. The shared-drive browse
behind a Drive source follows the same rule: the token alone is enough.

**A connection that carries its own pair still wins.** A customer who
registered their own Google application keeps using it; this is a fallback,
never an override ([ADR-0041](./adr/0041-who-owns-the-oauth-client.md)).

**Both or neither.** A client id with no secret cannot exchange an
authorization code, so half of it is refused with the missing name rather than
failing at Google's token endpoint hours later. The same rule holds for a
connection's *own* pair, at every door — the account form (*Start a migration*
and the Accounts page), the API, a rotation and the consent itself alike: half
of one is refused where it is
sent, never completed with the deployment's other half. The rotation panel
therefore offers the Client ID beside the secret, so a rotated pair is a pair.

**Two containers, and the second is the one that bites.** `managed.yml` hands
them to the API **and to the worker**. A worker still running on the old
values makes everything visible work — the consent is built, Google approves
it, the connection tests green — while every sync pass fails to mint a token
in a log nobody is watching. So after changing either value, recreate both:

```bash
./deploy/compose/bootstrap-managed.sh --only app
```

(Until alpha.18 the second place was the Trigger.dev tasks' environment, which
inherited nothing from compose and was uploaded by `set-task-env.sh`.)

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
   the API and the page.
2. **APIs & Services → OAuth consent screen.** Add
   `https://mail.google.com/` and `https://www.googleapis.com/auth/drive.readonly`
   to the scopes, beside the calendar, CardDAV and `tasks.readonly` ones.
3. **Credentials → your OAuth client → Authorised redirect URIs.** It must
   carry `https://<your API host>/api/migrations/google/callback` — the exact
   string, which `POST /api/migrations/google/authorize` also returns and the
   app's *Redirect URIs* page lists (`GET /api/redirect-uris`).
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
   front, naming the exact string to register — but the fix is here.
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

- *Start a migration* asks one Google sign-in for everything ticked under
  Google, rather than a sign-in of their own for mail and files; on the Accounts
  page, the **Google account** card's consent offers five data types instead of
  three.
- The consent button asks for exactly the ticked faces — never more, and never
  fewer without saying so.
- The connection's **qualification badges** report each face separately, read
  from the grant Google actually issued rather than from what was asked. A
  face you ticked and Google did not grant shows as a measured no, with the
  remedy: asking is granting, so adding it means re-consenting.

#### The deployment's own Dropbox app

The same idea, for Dropbox: set the pair once and *Connect with Dropbox* appears
on *Start a migration* and on the Accounts page, with the App key and secret
folded away behind *Use your own Dropbox app*.

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
   ```

   The app phase recreates the worker too, the same second place that bites
   for Google: a pair the worker cannot see is a consent that succeeds and a
   migration that cannot mint a token.

Every rule of the Google pair holds: the connection stores neither half; a
connection's own pair wins; both or neither, refused as half a pair at the
consent, the create door, the mapping door and the rotation panel alike; and
the pair is handed only to a Dropbox row — `clientId`/`clientSecret` are shared
key names, and a Google connection is never given Dropbox's app. `GET
/api/provider-clients` answers `dropbox: deployment` once both halves are set,
which is what the account form reads, on *Start a migration* and the Accounts
page, before it offers the button.

#### The deployment's own Entra registration

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
   ```

   **Leave `MICROSOFT_OAUTH_TENANT` empty** unless the registration is
   deliberately single-tenant; empty means `common`, which is what a
   deployment serving other organisations needs. Entra shows a client secret's
   **Value** once — copy it then, not its Secret ID — and its **Expires**
   beside it, which you write down (*The secret expires*, below).

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
set, which is what the account form reads, on *Start a migration* and the
Accounts page, before it offers the button.

**The secret expires, and both stacks stop at once.** A client secret made in
the portal lasts 24 months at most (the portal suggests 6), and Entra shows the
date as **Expires** beside it under *Certificates & secrets*. Nothing reads
that date for you, and when it passes every Microsoft connection on the
deployment fails its next token refresh, while the nightly smoke, which builds
the consent URL and never exchanges a token, stays green. So write the date
down, never the value, and renew 30 days ahead. Set the repository variable
`CLOCK_WATCH_ENTRA_EXPIRES` to it (`YYYY-MM-DD`; Settings, Secrets and
variables, Actions, Variables), and the daily *Clock watch*
(`.github/workflows/clock-watch.yml`) keeps an issue open from 30 days before.
It is a date, never the secret: a variable is printed in the log of every run.
A connection on this registration stores neither half of the pair, so its
refresh token survives a renewal and nobody has to connect again.

The OTA stack and live share one registration and one secret. Where the OTA's
`MICROSOFT_OAUTH_CLIENT_ID` is still the gate's placeholder,
`gate-microsoft-app-registration`, the OTA has no registration of its own, and
step 2 is skipped. This prints it, an identifier and not a secret:

```bash
. ~/ownpace-managed/deploy/compose/env-read.sh && env_value ~/.persistent/ownpace-managed/.env MICROSOFT_OAUTH_CLIENT_ID
```

Renew while no E2E (managed) run is in progress: the gate copies the persisted
`.env` in at its start and back out partway through, so an edit made in between
is lost.

1. In Entra, **New client secret**. 24 months is the longest the portal
   allows, and the fewest renewals; Microsoft recommends under 12. Copy its
   **Value**, and keep the old secret for now.
2. The OTA stack, whose next nightly applies it: the gate reads the persisted
   `.env`, which the second line writes. The first line says what this
   checkout's own `deploy/compose/.env` is, which a hand-run compose call
   reads:

   ```bash
   cd ~/ownpace-managed && { [ "$(readlink -f deploy/compose/.env)" = "$(readlink -f ~/.persistent/ownpace-managed/.env)" ] && echo 'a link' || echo 'a copy'; }
   read -rs -p 'New Entra client secret (Value): ' t && printf 'MICROSOFT_OAUTH_CLIENT_SECRET=%s\n' "$t" | ./deploy/compose/env-upsert.sh --stdin ~/.persistent/ownpace-managed/.env; unset t; echo
   ```

   `a link` needs nothing more. `a copy` is a copy of its own, which *The OTA
   stack: the nightly gate, or a pull* allows, and it still holds the old
   secret: run the second line again with `deploy/compose/.env` in place of the
   persisted path, or a hand-run compose call brings the old secret back. To
   have it at once rather than after the night:
   `./deploy/compose/bootstrap-managed.sh --only app`.
3. Live, the same way. The second line must print `live .env`:

   ```bash
   cd ~/ownpace-live && unset COMPOSE_PROJECT_NAME COMPOSE_FILE COMPOSE_ENV_FILES
   [ "$(readlink -f deploy/compose/.env)" = "$(readlink -f ~/.persistent/ownpace-live/.env)" ] && echo 'live .env' || echo STOP
   read -rs -p 'New Entra client secret (Value): ' t && printf 'MICROSOFT_OAUTH_CLIENT_SECRET=%s\n' "$t" | ./deploy/compose/env-upsert.sh --stdin ~/.persistent/ownpace-live/.env; unset t; echo
   docker compose -f deploy/compose/managed.yml up -d --no-deps --no-build api worker
   ```

4. On each stack, *Test* on a Microsoft connection that uses this registration
   (it proves the API), and one Microsoft sync pass that succeeds, or *Sync
   now* (it proves the worker's environment). A green nightly proves
   neither. Only then delete the old secret in Entra.
5. Set `CLOCK_WATCH_ENTRA_EXPIRES` to the new date, and refresh any copy of the
   two `.env` files kept off the machine.

**What a customer sees when their tenant says no.** Two refusals are a tenant
policy rather than anything you configured: `AADSTS65001` (an administrator
must approve the application first) and `AADSTS90094` (the tenant forbids user
consent entirely). Both render as sentences, so the person knows to ask
somebody rather than press the button again. `docs/microsoft-setup.md` is the
customer-facing version of all of this.

#### The deployment's own Cirrux client

For Cirrux Drive as a destination for files (workplan 0160 T5; ADR-0052). Not a
pair: Cirrux issues a **public client** (PKCE `S256`, no secret), and it is not
self-service.

1. **Ask Cirrux for one**, at help@cirrux.co, giving the name people see, the
   exact callback `GET /api/redirect-uris` lists as `cirrux.migration`
   (`https://<your API host>/api/migrations/cirrux/callback`), and the scopes
   `user.profile workspace.read drive.read drive.create drive.update
   drive.delete`. `drive.delete` only ever moves a file to Cirrux's trash, after
   a person approved removing it. One client per deployment: the OTA stack and
   live each have their own callback, and so their own client.
2. **The client ID, in `deploy/compose/.env`**, where the gate reads it on the
   OTA stack as for any key:

   ```bash
   ./deploy/compose/env-upsert.sh deploy/compose/.env CIRRUX_OAUTH_CLIENT_ID=<the client ID>
   ./deploy/compose/bootstrap-managed.sh --only app
   ```

   The worker needs it more than any other client: a pass refreshes each Cirrux
   account's Drive sign-in and writes the successor back, so without it every
   pass into a Drive the API connected fails.

Until it is set, a Cirrux account's files are a measured no that says this
deployment has no Cirrux client, and no screen offers *Connect Cirrux Drive*.
`GET /api/provider-accounts` answers `cirrux.client: deployment` once it is.

### 8f. Problem reports — by mail, or your own Zammad

"Report a problem", beside Sign out, sends a customer's report to a person:
what they wrote, the page they were on (without any link
secret), the reference and kind of error on their screen, and a screenshot if
they add one: a PNG or JPEG of up to 5 MB, chosen as a file, dropped on the
field or pasted anywhere on the page (Ctrl+V or Command+V), with a fold under
the field that says how to make one on each kind of device. It goes one of two
ways. While neither is set up, the link is not shown at all.

**By mail, to your support mailbox** (live's way during the alpha). This needs
nothing but the mail settings the API already sends
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
finds), `Organisation`, `Build`, then what the API reads from its own records
in the customer's organisation: `Role`, `Organisation
status`, the migration on the page with `Grant`, `Grant link`, a `Data type …`
line for each data type and the two accounts' providers, `Reference match`,
`Service hold`, `Scheduler` and `Browser`; then what the customer's browser
said of itself, each line only when it was said in its own
shape: `Screen language`, `Time zone` (to turn their "at 14:02" into the log's
UTC), `Window width`, `App build in the browser` (only when it is not the
server's build: an old page in front of a newer server), `Failure line` (the
data type, side and migration of the failure line they came from) and a
`Recent error` line, reference and code, for each "Something went wrong" the
page met in the five minutes before they opened the form, which the log page
finds by that reference; then `Reply to` (the customer's sign-in address) and
`Report reference`, the report's own. The form showed the customer the fact
lines, `Page` to the last of the browser's, under *What we send with this*
before they sent it, unless that preview could not be read; `Reply to` and
`Report reference` are added on sending. When the database could not be read,
the report still arrives, with `Facts: could not be read [ref …]` in place of
the records' lines; the log page finds that reference as `report.facts-unread`.
Its **Reply-To** is that sign-in address too, so pressing Reply should answer
them. With `NOTIFY_FROM` and `REPORT_MAIL_TO` both `support@ownpace.eu`, as on
live, the mail goes from the mailbox to itself, and a mail client may answer
such a mail to its own address;
check the To field before you send, and if it shows the support address, write
to the body's `Reply to` address instead. The screenshot is attached, after the
same check of its first bytes a Zammad ticket gets. There is no ticket number,
so the customer is told the *report reference* instead, and that the reply
comes by email; search the mailbox for it when they quote it (the log page
does not know it). An empty `REPORT_MAIL_TO` sends reports to `NOTIFY_TO`, so
on a stack still pointed at Mailpit the form works and Mailpit catches them.
The form then says only *Goes to the Ownpace support team.*, without an
address: `NOTIFY_TO` is your own list, and every signed-in member can open the
form. Only an address `REPORT_MAIL_TO` names is shown to them.

**The relay is shared.** On live, the API's relay login is the one the identity
provider sends its sign-in codes with. So at most 50 report
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
pages. Somebody who doubts a link they were sent tells
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

During the Alpha, every tester is told so: a
note at the top of every signed-in page and under the title of the sign-in and
request pages, and a paragraph at the end of the access-granted mail and of
the invitation mail, in English and Dutch. The note is the owner's welcome;
each mail's paragraph opens with the same welcome and then says what the Alpha
means. The note ends with two links, the
Alpha conditions and the tester guide, in the reader's language; each mail's
paragraph ends with the same two addresses, in the mail's language. It is off
unless you set it, and you set it only on the stack testers
use:

```
OWNPACE_STAGE=alpha
BACKUP_RETENTION_DAYS=7
```

The web bundle bakes the stage in at build time and the API reads both at
start, so rebuild and recreate both:

```bash
GIT_SHA=$(git rev-parse --short HEAD) \
  docker compose -f deploy/compose/managed.yml build api web
docker compose -f deploy/compose/managed.yml up -d --wait api web
```

Open the sign-in page: the note is under the title. Empty, or any value but
`alpha`, is no note and no paragraph. The appliance never shows it.

The same setting decides whether the public site carries the tester guide
(`/nl/alpha-handleiding.html` and `/alpha-guide.html`):
`deploy-live.sh` hands live's value to every site build, so with
`WWW_LIVE=true` the guide is published with the next deploy. Built by hand,
the site takes the stack's own value from its `.env`, as the site section
below shows; without it the note's and the mails' guide links are 404s.

**The same setting asks for acceptance, once no text is still a draft.** With
`alpha`, every tester who signs in meets one screen before
any other page: the Alpha conditions, the privacy policy and the terms, each
linked in their language with its version, and one button. The API records the
version of each text they accepted, the language and the time, and until they
have, it refuses to store any access they give (adding a connection, a new key,
a new migration, a grant link: 409 `conditions_not_accepted`). The screen comes
back whenever a text's version changes, at the next load or the next door
pressed. Both halves take the setting: the API's refusals and records, and the
web bundle, which asks `GET /api/me` on load only when built with it, so
rebuild `web` as well as recreating `api`.

While any text is a draft (`LEGAL_DRAFTS` in
`packages/managed/src/legal-versions.ts`), nobody is asked, nothing is refused
and nothing is recorded, as with the setting off: a draft's number is the one
its final text will carry, so an acceptance of the draft would be recorded as
one of the final text. The API's start log says which (`[api] OWNPACE_STAGE=alpha, but … are drafts:
nobody is asked …`). The
links point at the site `VITE_LEGAL_SITE_URL` names, so the texts must be
served there before the first invitation. Who accepted what is under
*Acceptance* in the
[operator runbook](./operator-runbook.md#acceptance-who-accepted-which-version).

The second line is the alpha's other half: the days the erasure sentence says a
copy may still hold a closing organisation's data. The alpha takes no backups,
apart from one copy of live's databases made right before each update and kept
until that update is proven, never longer than seven days, so live sets `7`.
`deploy-live.sh` takes the copy
(`copy-before-update.sh take`, *`ownpace-live`: a release tag, with
`deploy-live.sh`*), the box checks delete it once the update is proven (an
hour after the hold was last lifted at the earliest,
`copy-before-update.sh delete-if-proven`), or you do
(`./deploy/compose/copy-before-update.sh delete`), and the daily duties delete
it once it is older than six days less an hour whatever happens (*Live's daily
duties*), so it is never kept past its seventh day. A stack that keeps no copy
at all sets `0`, and the sentence then names none; a blank reads as seven days
whether or not a copy exists. With `OWNPACE_STAGE=alpha` the API refuses to
start while it is blank, and the refusal names it. `stand-up-live.sh` refuses
live's `.env` with anything but a whole number above 0. Read it back from the
api container's own environment (Docker reads it, for either API image: the
distroless one has no shell or `printenv` to ask, see *Reading what the api
container was started with*); on live this prints `BACKUP_RETENTION_DAYS=7`:

```bash
docker container inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$(docker compose -f deploy/compose/managed.yml ps -q api)" | grep '^BACKUP_RETENTION_DAYS='
```

A stack that moves from `0` to a number of days later, because it starts
keeping a copy, does so before the first invitation, or only while no
organisation closed under `0` still waits for its purge: its erasure record
keeps the `0` it was given, and a copy taken before that purge would hold its
rows while the tester was told the erasure is complete.

### 8h. A person to write to *(only on the stack testers use)*

A tester who is stuck before signing in cannot reach the report form (8f): it
needs a session. So the stack testers use names an address a person reads.
With it set, the sign-in, request, callback and
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
  docker compose -f deploy/compose/managed.yml build web
docker compose -f deploy/compose/managed.yml up -d --wait web
```

Open the sign-in page: the line is above the status link.

### 8i. The books and payments *(before the first invoice, and on the OTA stack to prove them)*

Invoices go through two services, each with its keys in `.env`:

- **Moneybird**, the books: it numbers each invoice, keeps it
  for the retention period, and, on live, e-mails it.
- **Mollie**, the payments: a customer pays an invoice through it, and what a
  credit note gives back goes back through it.

**None of this is needed for the alpha**, which invoices nobody. With none of
these keys set, nothing is asked of either service and everything else runs.
Live sets them before the alpha ends ([ending-the-alpha.md](./ending-the-alpha.md),
*Before*, step 2), all but Mollie's key, which goes in with the switch that
ends it (*The switch*, step 4): while live's stage is `alpha`, `deploy-live.sh`
refuses its `.env` with `MOLLIE_API_KEY` set. The OTA stack uses a Moneybird
**sandbox** administration
and Mollie's **test mode**, and is where the proofs in step 6 run.

Run each command below from the stack's own checkout: `./deploy/compose/.env`
is that stack's. Steps 1 to 5 are the same on both stacks; only the values
differ.

**1. The administration and its token.** Each stack has its own Moneybird
administration: live a real one, the OTA stack a sandbox. An id from one is no
use in the other, so nothing is copied between their `.env` files. The token
is a personal API token (Moneybird, *Instellingen > Ontwikkelaars*). The
administration's id is the long number in Moneybird's address bar while it is
open. The token is a secret, so it goes in on standard input:

```bash
read -rs -p 'Moneybird token: ' v; echo
printf 'MONEYBIRD_API_TOKEN=%s\n' "$v" | ./deploy/compose/env-upsert.sh --stdin deploy/compose/.env; unset v
./deploy/compose/env-upsert.sh deploy/compose/.env MONEYBIRD_ADMINISTRATION_ID=500000000000000000   # yours, from the address bar
./deploy/compose/operator.sh moneybird check
```

The check makes three reads and nothing else: no contact, no invoice and no
e-mail. It lists the administration's sales tax rates, its workflows and its
financial accounts, each with its id, and says what each VAT treatment
resolves to and which workflow invoices would go through, with whether its
prices include VAT. The token is in no line it prints. It exits 1 while its
report names something to do; the outside-EU rate is optional, so its refusal
is printed and does not count. With only these two keys set, its list is what
the next steps pick from. Half a set also gets a warning when the API starts,
and the hourly push refuses it by key name.

**2. The ids, from the check's list.** Digits only, copied exactly. The
numbers in the commands here are examples; use the ones the check lists.

- `MONEYBIRD_WORKFLOW_ID`: the invoice workflow.
- `MONEYBIRD_TAX_RATE_ID_DOMESTIC`: the Dutch VAT rate.
- `MONEYBIRD_TAX_RATE_ID_REVERSE_CHARGE`: VAT reverse-charged, for a business
  elsewhere in the EU.
- `MONEYBIRD_TAX_RATE_ID_OUTSIDE_EU`: optional. Empty refuses a buyer outside
  the EU by name. Which rate it is, is the accountant's answer.
- `MONEYBIRD_DELIVERY`: empty off live, which is manual: Moneybird numbers each
  invoice and e-mails nothing, because a sandbox really sends what it is asked
  to, ten a month. `email` on live only.

```bash
./deploy/compose/env-upsert.sh deploy/compose/.env \
  MONEYBIRD_WORKFLOW_ID=500000000000000001 \
  MONEYBIRD_TAX_RATE_ID_DOMESTIC=500000000000000002 \
  MONEYBIRD_TAX_RATE_ID_REVERSE_CHARGE=500000000000000003
./deploy/compose/operator.sh moneybird check
```

**3. Mollie's key.** `MOLLIE_API_KEY` is in Mollie's dashboard, under its API
keys: the `test_` key on the OTA stack, the `live_` key on live. Mollie gives
the live key once it has finished checking the business (its onboarding).
The API takes payments with it, and the tasks refund with it and follow each
refund until Mollie says it ended. There is no webhook secret: the webhook
trusts nothing in its body and asks Mollie about the payment with this key.

```bash
read -rs -p 'Mollie API key: ' v; echo
printf 'MOLLIE_API_KEY=%s\n' "$v" | ./deploy/compose/env-upsert.sh --stdin deploy/compose/.env; unset v
```

Mollie's servers confirm each payment at `API_URL`, so it must be a public
https address they can reach (*What cannot work on a mesh-only host*, below),
and Mollie sends the customer back to `WEB_URL` after paying. With
`MOLLIE_API_KEY` set, the API refuses to start in production on a localhost
`API_URL` (phase 2).

**4. The account Mollie pays out from.** Each payment through Mollie is booked
on its invoice in Moneybird, under Mollie's payment id, so Moneybird reminds
nobody who paid, and each refund is booked on its credit note,
negative, under the refund's id. Both are booked on one financial
account in the administration, the one Mollie pays out from. A new
administration holds none, and the check prints `Financial accounts (0)`
until one is made in Moneybird. Once it is there, the check lists it with its
id:

```bash
./deploy/compose/env-upsert.sh deploy/compose/.env MONEYBIRD_FINANCIAL_ACCOUNT_ID_MOLLIE=500000000000000004
./deploy/compose/operator.sh moneybird check
```

The check says `Payments through Mollie are booked on …` with the account's
name, and ends `RESULT: ready`. Empty, nothing is booked and the hourly push
says so: a refund is still made, and waits to be booked. If Moneybird's own link to Mollie also
brings Mollie's transactions into that account, ask the accountant how they
match the payments and refunds Ownpace books there, so that nothing is
counted twice.

**5. Hand the keys to what reads them.** The API and the worker read them
when they start:

```bash
docker compose -f deploy/compose/managed.yml up -d --force-recreate api worker
```

Run it again after any of these keys changes; an emptied key is empty in both
from the next start.

**6. The proofs, on the OTA stack only.** Each one refuses before asking
Moneybird or Mollie anything when the checkout's `.env` says
`NODE_ENV=production` or names no `NODE_ENV`, as live's does: live's books are
real.

```bash
./deploy/compose/operator.sh moneybird proof
```

It makes one invoice the way the hourly push does, under the reference
`ownpace-proof-{YYYY-MM}`, to Ownpace's own proof contact (no e-mail address),
sent by hand, and prints the number, date and total Moneybird gave it. Run
again in the same month, it answers that the invoice exists and makes
nothing, so a repeated command spends nothing of the sandbox's 50 invoices a
month. It also refuses unless `MONEYBIRD_DELIVERY` is `manual`: the sandbox
allows ten e-mails a month.

```bash
./deploy/compose/moneybird-money-back-proof.sh
./deploy/compose/moneybird-money-back-proof.sh refund
```

The money back of a credit note, called as the hourly push calls it. Without
an argument, the two Moneybird calls: a credit note set against an open
invoice, and a refund booked negative on a credit note, on the account of
step 4. With `refund`, Mollie's refund itself: a test payment you pay on
Mollie's test checkout, then the refund, made twice under one idempotency key
so that only one exists, then booked. It needs a `test_` key and refuses any
other. Each prints what Moneybird and Mollie answered.

Each proof calls one thing. **The chain as a customer meets it**, from a tier
ordered in the app to a withdrawal that credits and refunds a year, is walked
once by hand on the OTA stack, out of the alpha for the length of the walk:
[billing-rehearsal-on-ota.md](./billing-rehearsal-on-ota.md).

The managed nightly gate proves the books every night with the same keys:
`smoke-managed.sh` runs `./deploy/compose/operator.sh moneybird nightly`, which
makes the night's invoice (`ownpace-nightly-{YYYY-MM-DD}`), sends it by hand,
registers a payment for it and reads it back as paid. It counts the month's
invoices first and, from 40 of the sandbox's 50, makes none and says so. When
Moneybird answers *try later* (no answer, an unexpected status such as a 404 or
a 5xx, or a 429), the night asks once more, after 30 seconds, or after the 429's
`Retry-After` when it is two minutes or less; a 429 that asks for longer fails
the night at once rather than asking early. Making the invoice again finds it
by its reference and sends nothing twice, and a payment whose answer did not
come is read, never posted again. A second *try later* fails the night, with
both answers in its lines. With no
`MONEYBIRD_*` key in the nightly stack's `.env` it makes nothing, and the verdict
lists the books as not proven; give that stack the sandbox's keys, with
`MONEYBIRD_DELIVERY=manual`, for the gate to prove them.

**7. When invoicing starts.** What is invoiced, and from when, is a second
switch: `OWNPACE_BILLING_FROM`, the first month invoiced, written `YYYY-MM`.
Empty, nobody is invoiced. Set, the hourly `managed-month-invoices` task makes
each organisation's invoice for a month in advance, as a draft: on its first
day at the tier it starts on, and after a move up for the difference, and the
hourly `managed-invoice-push` has Moneybird number each draft, books what
Mollie was paid, makes each credit note's money
back, and reads paid and late back from Moneybird. Neither runs while
`OWNPACE_STAGE` is `alpha`. [ending-the-alpha.md](./ending-the-alpha.md) is
when to set the month, and the
[operator runbook](./operator-runbook.md#email-notifications-workplan-0030)
says what each hourly run says, and what to do when it names money to give
back by hand. It mails each of those to `NOTIFY_TO`, through the same SMTP
settings the digests use, and the support screen lists them under *Money to
give back* until they are marked given back.

#### The system role, asked before the worker starts

The jobs that span organisations (the sync tick, retention, the purge of
closed organisations), the split jobs' list of organisations and every job's
audit key connect as `ownpace_system`, which managed migration 0033 creates
(the api applies it when it starts) with no password, no superuser bit, no
right to create a role or a database, and `BYPASSRLS`. Before the worker
starts, the phase asks Postgres what the role is now, and **refuses to go on**
if it is a superuser, may create roles or databases, replicates, belongs to
any role, has any role belonging to it, or lacks `BYPASSRLS` or `LOGIN`: every
run of every job receives its URL. Then it sets `.env`'s `SYSTEM_DB_PASSWORD`
(which `ensure-env-secrets.sh` generated in phase 2; on an older `.env`,
brought up from a later phase, as `deploy-live.sh` does with `--from data`,
the phase runs `ensure-env-secrets.sh` itself, which fills in a missing secret
and never replaces one) on the role, over the database's socket, without the
value on a command line or in a log, clears every setting left on the role in
the same transaction, and proves it opens over the stack's network and through
the pooler. It does this on every run, so `.env` is the one place the password
lives. See [The system role](#the-system-role) for a refusal and for changing
the password.

**The worker's environment comes from `managed.yml`.** Its addresses are
in-network (`pgbouncer:6432`): `SYSTEM_DATABASE_URL`, `APP_DATABASE_URL`,
`JOBS_DATABASE_URL`, `SECRET_ENCRYPTION_KEY`, the optional `OAUTH2_*`,
`SMTP_*` and `NOTIFY_*`, `OWNPACE_REACHABLE_HOSTS` (so the jobs admit exactly
the names the API does) and `OWNPACE_STAGE`. The eight per-tenant jobs read
and write tenant data through `APP_DATABASE_URL`, as `app_user`, and a run
without it refuses to start, naming it. Nothing of the database owner's is
handed to it. Until alpha.18 the Trigger.dev tasks got these from an upload,
`set-task-env.sh`; that script is gone with the plane.

### 7. `smoke` — the only proof that counts

```bash
./deploy/compose/smoke-managed.sh
```

Mints a seeded-member token, runs a verify to a terminal state and an apply to
`applied` or `refused` (a refusal is a legitimate pass — the gates said no and
said why), and checks that a job ran on pg-boss and every job since the start
completed, that the worker runs the API's image as uid 65532 with no shell,
and that no container of Trigger.dev's plane is on the stack, at its start and
at its end. The worker's log from the smoke's start is kept beside the
evidence file for the same redaction.

Only runs with `--with-demo`: it drives the demo tenants. A green CI says
nothing about whether an enqueue becomes a run **on this machine** — this is
the step that answers it.

> The smoke's evidence file can carry what a job's run logged.
> `deploy/compose/redact-evidence.sh` cleans it before anything is uploaded
> anywhere.

---

## The public site is a separate stack, and it must be told which one it is

`bootstrap-managed.sh` does not bring the site up — `deploy/compose/www.yml` is
its own stack, deliberately, so that taking the app down does not take the site
with it. To publish or re-publish:

```bash
. deploy/compose/env-read.sh
OWNPACE_APP_URL=https://app.ota.ownpace.eu \
GOOGLE_ACCOUNT_SCOPE_CLASS="$(env_value deploy/compose/.env GOOGLE_ACCOUNT_SCOPE_CLASS)" \
OWNPACE_STAGE="$(env_value deploy/compose/.env OWNPACE_STAGE)" node site/build.mjs   # test (OTA)
# production (live): deploy-live.sh builds it, with --public and live's own OWNPACE_STAGE
# and GOOGLE_ACCOUNT_SCOPE_CLASS (below)
docker compose -f deploy/compose/www.yml up -d
```

**The test site takes its stack's own `OWNPACE_STAGE`.** With `alpha` in that
`.env`, the site carries the tester guide, which the app on the same stack
links from its note and both mails. Empty is no
guide, and no links to one. Live's site gets live's own value from
`deploy-live.sh`, below.

**And its own `GOOGLE_ACCOUNT_SCOPE_CLASS`.** With `restricted` in that `.env`,
the app asks for one Google sign-in, and the site's Leaving Google page says
one sign-in instead of three. Anything else leaves the
page as it is. Rebuild the site when the value changes: the API follows it on a
restart, the site on its next build.

**A second copy beside it names its own project, with `-p`.** `ownpace-www`,
`www.yml`'s project, is a default, and the container is named after the
project. A copy from another checkout is brought up with
`docker compose -p <name> -f deploy/compose/www.yml up -d`, takes the same `-p`
on its `ps`, `logs` and `down`, and has a `WWW_PORT` and a `WWW_BIND` of its
own in that checkout's `.env`. Not `COMPOSE_PROJECT_NAME`: `www.yml` reads the
same `.env` as `managed.yml`, where that key names the stack, so a bare command
in live's checkout would put the site in live's own project. Nothing refuses
that: it succeeds once live's `.env` has its own `WWW_PORT`.

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
not. A `--public` build with unfilled legal placeholders is refused too, and
so is one while a legal page it renders says on its *Version* line that it is a
draft or not yet published, naming the file. None of them does, so
`--public --check` prints `0 legal page(s) marked draft` and exits 0.
`--public --check` refuses a draft as well: it prints how many
legal pages are marked draft and exits 1, so a check run before a deploy stops
what the build would stop. Its last line is still the placeholder count.

**`OWNPACE_APP_URL` has no default and the build refuses without it.** It is
where every *Request access* button points, and the environment is a domain
level. With production as a default, a test site built without it would point
every button at `https://app.ownpace.eu/request-access`, and a click on the
*test* site would file a real access request against the real tenant. The build
that forgets is by definition the one whose value is not the default, so a
default can only ever be wrong silently. Neither side is the safe side; being
told is.

If you are ever unsure which environment a served `dist` was built for, read the
host out of a *Request access* link in the page source.

### `www.ownpace.eu`: live's copy

The commands above are the OTA site's (`www.ota.ownpace.eu`, the container
`ownpace-www`, from `~/ownpace-managed`), and they stay as they are. During the
alpha the reference machine also serves the production site, `www.ownpace.eu`.
**That copy is served from live's own checkout, at
the release tag, and once `WWW_LIVE=true` switches it on, `deploy-live.sh`
builds and starts it with every deploy of live.** The texts a tester accepts
are then the release's, and the footer names that release. A fix to a
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
the app's release with it. It refuses a text with an unfilled placeholder, or
whose version line says it is a draft (*draft for legal review*, *concept voor
juridische toetsing*); `--public --check` counts the placeholders and exits 1
on a draft. So with
`WWW_LIVE=true` and such texts, `deploy-live.sh` refuses before the checkout,
and live does not move at all. Switch it on with the first tag whose texts are
final.

**Switching it on,** once the texts are final and live stands. It publishes an
**indexable** site (`--public`: no `noindex`, and `robots.txt` says
`Allow: /`).

1. The tag. Cut it from a `main` whose `www.yml` names the container after its
   project and whose legal texts are final: no unfilled
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
   (`OWNPACE_APP_URL=https://app.ownpace.eu OWNPACE_STAGE=<live's> GOOGLE_ACCOUNT_SCOPE_CLASS=<live's> GIT_SHA=<commit> node site/build.mjs --public`,
   where both settings are the values in live's `.env`, never the shell's; with
   `alpha` the site carries the tester guide, and with
   `restricted` Leaving Google says one Google sign-in),
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
4. Route `www.ownpace.eu` to live's `WWW_PORT` in NetBird, as for live's other
   names (*Before the script: the owner's steps*, step 3).
   Then dispatch *Exposure probe* with `site_name` set to `required`. Until
   then leave it at `report`, its default: the name points at another host
   before the route, and the probe tries no port on an address of it that is
   not live's front (an address a production name or `EXPOSURE_PROBE_HOST`
   resolves to), and does not ask 443 for it. Set the repository variable
   `CLOCK_WATCH_SITE` to `required` at the same time (Settings, Secrets and
   variables, Actions, Variables), so that the daily *Clock watch*
   (`.github/workflows/clock-watch.yml`) reads the name's certificate and its
   `security.txt` `Expires` too; it leaves both alone until then, for the same
   reason.

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

**Taking it down for good**, when we stop running the website and not only
live's copy for a while: switch it off as above, take it down with
`docker compose -p ownpace-live-www -f deploy/compose/www.yml --env-file deploy/compose/.env down`,
and delete its visit reports with it,
`rm -rf ~/.persistent/ownpace-live/site-visits`. Privacy §9 keeps the visit
totals *"as long as we run this website"* (privacy 1.2), and
nothing else ends them. With `WWW_LIVE` no longer true, the duty `visits` reads
nothing from then on.

**Counting its visits** (privacy §4.5). The visits to `www.ownpace.eu` are
counted from the site's own
access log, by GoAccess, as totals that identify nobody. Nothing is added to the
pages, nothing leaves the machine, `app.`, `id.` and `status.ownpace.eu` are not
counted, and NetBird's own log is not read (no NetBird API token).
[`site-visits.sh`](../deploy/compose/site-visits.sh) does it once a day, as the
duty `visits` (*Live's daily duties*), and by hand whenever you want a fresh
report, from `~/ownpace-live`:

```bash
./deploy/compose/site-visits.sh
```

- **Only once the site says so.** It refuses, reading nothing, while the
  checkout's `site/legal/privacy.md` or `privacy.nl.md`, the texts the site
  publishes, lack privacy 1.2's §4.5 sentence (*"From these logs we also count
  visits to this website ..."*) or §5's purpose (*"and counting visits in
  totals"*), outside a comment, and the duty `visits` then fails, naming the
  file.
- **What it reads:** the output of `ownpace-live-www`'s container, where Docker
  keeps it, the whole of it on every run, so running it twice changes nothing
  (with the `local` log driver, which rotates by size, a report covers what the
  log still holds). It counts only the requests that came through the public
  name, the ones NetBird gave an `X-Forwarded-For`. The healthcheck every 30
  seconds and the deploy's own checks on loopback have none. The status page's
  *Website* row, once `STATUS_SITE_ENABLED=true`, asks through the public name
  every 60 seconds as `Gatus/1.0`, and is left out by that name. The run says
  how many of each it left out. nginx's error lines are never read.
- **What GoAccess is given: no address, and no text a visitor or a link
  chose.** GoAccess copies such text into its report word for word, so:
  - each visitor's address becomes a number that exists only while the run
    lasts, so GoAccess still tells visitors apart; NetBird's own address is
    dropped;
  - no query string, so no campaign (`utm_content`, `utm_term` and the rest
    can carry a name or an email address);
  - a page's path only when the site answered it 2xx or 3xx and it is a plain
    path of the site; every other request, a 404 among them, is counted as
    `/(not shown)`, since nginx answers any path;
  - the page a visitor came from cut to its site, or `(an address)` when the
    site is an IP address;
  - every version in the browser string cut to its digits and dots, and every
    word of it that holds a character no browser's own string holds (an `@`,
    a `%`) left out whole.
  It streams from Docker through that filter into GoAccess: no copy of the log
  is ever written. GoAccess 1.12 runs from an image the script builds from
  this checkout (`deploy/compose/goaccess/Dockerfile`, *The image*, below),
  never pulled, with
  `--network none`, on a read-only disk, as an unprivileged user with no
  capability, no port and nothing of ours mounted (the image's own empty
  volume, which that user cannot write to, goes with `--rm`), and keeps **no
  database**: its `--persist` would keep, for every day, a fingerprint of each
  visitor's address and browser and the pages each one asked for, and its
  `--anonymize-ip` hides the address only in the report it draws.
- **What is kept:** one HTML report per container of the site, in
  `~/.persistent/ownpace-live/site-visits/`, named after the day and time that
  container was made, readable by this account only, and never on a port, until
  the website is taken down for good (*Taking it down for good*, above). A
  deploy recreates the container and its log, so each report covers one
  release's time on the site; the earlier reports stay, and together they are
  the totals. What no run counted before a deploy is not counted: with the
  daily duty, at most the hours since its last run. **Run it by hand right
  before `deploy-live.sh` to lose none.**
- **What the report shows:** requests per page, per day and per hour, with
  `/(not shown)` for those that found no page of ours; the sites visitors came
  from; browsers and systems, by name and version; statuses; and visitors as
  GoAccess counts them, one address and one browser per day. No address, no
  place, no campaign, and no whole address of the page a visitor came from.
  What it cannot stop: a word a visitor writes into their own browser's
  User-Agent, joined to a browser's or a system's name, shows as they wrote it;
  and a Referer's host, which the visitor sets too, shows as it was sent when it
  is letters, digits, dots and hyphens (`https://jan.devries.example.nl`).
- **While `WWW_LIVE` is not true** it reads nothing, says so, and exits 0.

**Reading the report,** from the mesh only: it is a file on the machine, and
nothing serves it. On your laptop, which is on the mesh:

```bash
mkdir -p ~/ownpace-visits
scp 'you@the-box:.persistent/ownpace-live/site-visits/*.html' ~/ownpace-visits/
```

and open the newest file in a browser. It loads nothing from anywhere: its
scripts, styles and map are inside the file. The run's own lines (how many
requests came through the public name, and from how many addresses) are in the
journal with the other duties' (`journalctl --user -u ownpace-box-duties`).

**The image.** Upstream's `allinurl/goaccess:1.12`, and `latest` with it, is
built on Alpine 3.20, which Alpine no longer supports, and no upstream release
had moved off it by 2026-10-25. So the script builds GoAccess itself,
from `deploy/compose/goaccess/Dockerfile`: upstream's own Dockerfile at the tag
`v1.12`, on a supported Alpine (by tag and digest, its `FROM` lines), with the
source fetched by the commit the tag names and only the libraries GoAccess
loads in the image. It
builds it as `localhost/goaccess:1.12`, a name no registry serves, at the start
of every run, before any log is read, and runs it with `--pull never`. Docker's
cache makes that seconds when nothing changed. The first build, and the first
after Dependabot moved the Alpine pin and a deploy brought it, takes a few
minutes and needs Docker Hub, Alpine's package mirrors and `github.com`
(Dependabot's pull request for that pin is built first, by
`.github/workflows/script-images.yml`, as every pull request that changes the
Dockerfile is); a
build that fails reads no log, and the duty fails with Docker's last lines. To
build it by hand, from `~/ownpace-live`, before the first daily run:

```bash
docker build --tag localhost/goaccess:1.12 deploy/compose/goaccess
docker run --rm --pull never --network none localhost/goaccess:1.12 --version
```

The second line should print `GoAccess - 1.12.`. The image built here is
scanned every week (*Nothing phones home* says what it sends: nothing).

**The first run on the machine is Docker's own test.** Upstream's image's
GoAccess, and GoAccess built from the commit the Dockerfile fetches with its
own commands (on glibc, not the image's musl), were run through the script as
an unprivileged user with no network; the image the Dockerfile builds, and
Docker's own `--read-only`, `--network none` and `--cap-drop ALL`, were not.

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

### The OTA names on the mesh only

**From the first invitation, not before.** Once testers are on the production
names, which is from the first invitation, `app.ota.ownpace.eu`,
`id.ota.ownpace.eu` and the test site's `www.ota.ownpace.eu` answer on the mesh
only, not from the internet. Until then they keep answering from the internet,
and the steps below wait. The outside probe's pass condition for it is built:
`gh workflow run exposure-probe.yml -f ota_names=mesh-only` fails while any of
the three answers on 443 from a GitHub-hosted runner, whatever answers, and
passes a name that no longer resolves. Until the step below is done, dispatch
it with `ota_names` left at `report`, which records what the three answered
and fails on none of it.

**NetBird's dashboard has no switch for it, as the names are served today.**
All of the names, production and OTA, reach the machine through one front,
NetBird's hosted proxy (the probe's runs found the same two addresses behind
every name). NetBird-Only Access, the setting that serves a
name to the peers of the mesh alone, is offered only on a proxy cluster with
the `Private` capability, and NetBird Cloud's shared clusters do not have it
(NetBird's documentation, *Reverse Proxy Authentication and Access
Restrictions* and *Bring Your Own Proxy*). Deleting the three services there
takes the names off the mesh as well, since nothing else serves them over TLS.
And the machine itself reaches the OTA names through that front, from the
internet: the OTA stack's API finds its sign-in keys through
`https://id.ota.ownpace.eu` while `JWT_JWKS_URI` is empty (the alias note on
the `zitadel` service in `managed.yml`), and
`setup-zitadel.sh`, `idp-strays.sh`, the nightly gate's smoke and the OTA
status page ask that name or `app.ota.ownpace.eu` too. Whatever takes the
names off the internet has to leave the machine reaching them.

**What it takes, two ways**, each the owner's to do:

1. **A NetBird proxy of the owner's own, on the mesh.** In NetBird's dashboard,
   *Reverse Proxy*, *Clusters*: a cluster of the account's own (the *Bring Your
   Own Proxy* wizard, in beta), its proxy started with `NB_PROXY_PRIVATE=true`
   and a certificate for the three names issued over DNS-01, so that no port of
   it is open to the internet (NetBird's *Private Proxy Without Public Inbound
   Ports*). Its row then shows *Private*. Then in *Reverse Proxy*, *Services*:
   `app.ota.ownpace.eu`, `id.ota.ownpace.eu` and `www.ota.ownpace.eu`, each on
   that cluster, with *Authentication*, *NetBird-Only Access*, and an access
   group that holds your own devices and the machine. Then in the DNS zone of
   `ownpace.eu`: the records that point the three names at NetBird's shared
   cluster go (or the `*.ota` wildcard, if that is how they are made), and the
   `_acme-challenge` records the DNS-01 issuance writes stay. NetBird then
   gives the peers of that group a private record for each name. Check that
   the machine reaches the names that way, from the host and from inside the
   OTA stack's containers, which ask Docker's own resolver: the API's
   `/api/ready` says `signIn` is up only when the API reaches its sign-in's
   key source, and the next night's gate brings the stack up and signs its
   people in through `id.ota.ownpace.eu`.
2. **TLS for the three names on the machine itself**, on its mesh address,
   with the names pointing there and NetBird's three OTA services deleted. The
   repository has no such front today, so this is a build of its own first.

NetBird's shared front can also refuse everybody but listed source addresses
(a service's *Access Control*, *Allowed CIDRs*). That is not the mesh: the
list holds public addresses, the machine's among them, so a device on the mesh
that reaches the front from another address is refused, and the names still
answer over TLS, with NetBird's 403. The probe's `mesh-only` does not pass it,
and no mode of the probe is built for it.

**Either way, Google's test client keeps working for you** on the mesh,
because Google sends your browser to the callback and never fetches it. What a
third party's server would have to reach on the
OTA names stops, as the section above says.

## How the containers run

Every service of `managed.yml`, the site's `www.yml` and the appliance's
`compose.yml` sets
`no-new-privileges`: nothing in the container gains a privilege by running a
setuid binary or one with a file capability. No service here needs that. Those
that change user do it as root with a system call (nginx's and Apache's
workers, Nextcloud's `su`), and the rest never change user. All but one drop
every capability and add back
only what their own start does as root; a service that runs as another user
from its first process adds none. Four that write nothing outside their volumes
start with a read-only root, with `/tmp` (and `/run`) in memory where they
write there. `managed.yml` gives each service's reason beside it, and
`scripts/a-privilege-no-service-uses.unit.test.ts` holds every service to this
table: a capability added, one no longer used, a new service, or a read-only
root, each fails it until the table and the reason move with it. It also reads
every `exec` and `run` into a service with a dropped set that a script, a
workflow or a document here makes, and fails one nobody has reviewed, or one
whose program needs a capability its service does not keep.

| Service | Runs as | Capabilities kept | Read-only root | How it was decided |
|---|---|---|---|---|
| `postgres` | uid 70 | none | no | measured: its image as uid 70, a new volume and a restart |
| `pgbouncer` | uid 70 | none | yes, `/tmp` in memory | measured |
| `zitadel` | its image's user | none | no | read: an image of one binary, run as its non-root user |
| `zitadel-machinekey` | root | CHOWN, DAC_OVERRIDE, FOWNER | yes | measured, its init and every other command it runs: without CHOWN the chown fails, without FOWNER the chmod after it; without DAC_OVERRIDE `setup-zitadel.sh` cannot read the token (`cat: can't open '/machinekey/pat.txt': Permission denied`) nor write the rotated one, in a directory the identity provider owns at mode 700 (DAC_READ_SEARCH alone reads it and still cannot write) |
| `api` | uid 65532 | none | no | read: its image's user, and its base carries no setuid binary and no file capability |
| `worker` | uid 65532 | none | yes, `/tmp` in memory | read (2026-11-22, workplan 0167 T7): the API's two images and its user (`apps/worker/Dockerfile`); it writes no file outside `/tmp`. In no profile: it runs the jobs on every stack since alpha.18. E2E (managed) is the proof |
| `web` | uid 101 (nginx) | none | no | read (2026-11-19): its image runs nginx as its own user from its first process (`apps/web/Dockerfile`), with the template's output directory and nginx's cache its own and its pid file in `/tmp`, and binds port 80 by the service's `net.ipv4.ip_unprivileged_port_start=0`; until then measured as root, then nginx, keeping CHOWN, NET_BIND_SERVICE, SETGID and SETUID. E2E (managed) is the proof |
| `gatus` | root | none | no | read: an image of one binary, writing only its own volume |
| `mailpit` | root | none | yes, `/tmp` in memory | measured: a message in, and a restart |
| `nextcloud` | root, then www-data | Docker's default | no | read: its entrypoint rsyncs and chowns as root and runs occ through `su`, a set not measured |
| `www` (www.yml) | root, then nginx | CHOWN, NET_BIND_SERVICE, SETGID, SETUID | no | measured: the same nginx image as `web`, with `www-nginx.conf` |
| `postgres` (appliance) | uid 70 | none | no | measured: the same image as `postgres` above; its rootless `chown` is a `run` with its own `--cap-add` |
| `app` (appliance) | uid 10001 | none | no | measured (2026-11-06): distroless, with nothing to run but `/nodejs/bin/node`, as uid 10001 from its first process; on PGlite on a new volume and on one the image before it wrote, and on Postgres |

*Measured* means the service's own image, its own command and environment
with placeholder values, started with that set until it was ready, on a new
volume and again on the volume it wrote, and started again with one capability
fewer where that was cheap; all of them but the web app also
came up healthy, and answered as the scripts ask them, through `managed.yml`
itself. *Read* means its Dockerfile and
entrypoint at the pinned version, where the image could not be pulled. E2E
(managed) is the proof for both: it brings up every service of this file.
(Until alpha.18 the table had eleven more rows, Trigger.dev's plane.)
NET_BIND_SERVICE stays with the site's nginx although Docker's own
`net.ipv4.ip_unprivileged_port_start=0` makes it redundant today, so that
port 80 does not rest on a daemon default. `web` runs nginx as uid 101 with
no capability since 2026-11-19, and sets that sysctl itself for the same
reason.

**What it changes for an operator.** A `docker compose exec` has the
capabilities of its service: `exec -u 0` into `postgres` is root with no
capability, which cannot chown. Every `exec` and `run` the scripts, the
workflows and these documents make into a service with a dropped set is
listed in `a-privilege-no-service-uses` with what it needs. Most need
nothing: `psql`, `pg_dump`, `pg_restore` and `node`. Reading and rotating the
identity provider's token (`run zitadel-machinekey cat /machinekey/pat.txt`,
and the rotation's write) is why that one-off keeps DAC_OVERRIDE. The demo's
file work in `nextcloud` goes to the one service that keeps the default set. The appliance's rootless chown is a
`run` with its own `--cap-add` (`docs/selfhost-quickstart.md`). A repair
that does need root's powers elsewhere is `docker compose -f
deploy/compose/managed.yml exec --privileged -u 0 <service> …`, for that one
command.

**When it reaches a stack.** A changed service is recreated at its next `up`:
the OTA stack at the next E2E (managed) or gate, live at the deploy of the
release that carries it, inside `deploy-live.sh`'s hold and drain. A job's run
is a child process of the worker and runs with the worker's settings above.

**Not set, and why.** No `pids_limit`, and no `mem_limit` but the worker's,
which is sized by the owner's rule (*The job runner*): for the other services
there is no measurement of a peak, Postgres and Node size their buffers and
heap from the machine, and a limit set without one turns a busy hour into a
killed database. The `dev.yml` stack, which only a developer runs, sets none
of this.

## Nothing phones home

The privacy policy names every party that receives anything (§7, §8), so what
an image sends its makers is switched off everywhere. Three images in
`managed.yml` report to, or ask, their makers by default. Two are switched off
here; the
demo's Nextcloud is not yet (*What is left on, and where*, below). Each switch
is written in the compose file itself, never read from `.env`, so it is the
same on the OTA stack and on live, and no machine's `.env` can empty it. Live
runs `managed.yml` and `www.yml` and no other compose file: `stand-up-live.sh`
refuses a `COMPOSE_FILE` in the shell.

**Since alpha.18 there is no plane.** Trigger.dev's `trigger-api`,
`clickhouse` and `minio` reported to their makers by default and were switched
off here, with their rows in this table, until alpha.18 removed them (workplan
0167 T9). The worker that runs the jobs is built on the API's images from this
repository's code; pg-boss in it speaks only to the stack's Postgres, through
PgBouncer.

| Service | What it sent by default | The switch | Read at |
|---|---|---|---|
| `zitadel` | A "service ping" once a day to `zitadel.com`: the version, each instance's id, creation date and domains, and its count of users, organisations and projects | `ZITADEL_SERVICEPING_ENABLED: "false"`; `ZITADEL_TELEMETRY_ENABLED: "false"` too, which ships off | `cmd/defaults.yaml` at v4.19.2 (*"It's enabled by default"*) |
| `mailpit` (the test stack's catcher; live runs none) | A release check to GitHub whenever its page asks for the server's info | `MP_DISABLE_VERSION_CHECK: "true"` | `internal/stats/stats.go`, `cmd/root.go` at v1.31.6, and again at v1.32.0, v1.33.0, v1.33.1 and v1.34.0, where the lookup changed and the switch still stops it first |
| `nextcloud` (the demo's DAV target, on the OTA stack every night; and `dev.yml`'s) | Its version, PHP version and install time to `updates.nextcloud.com`, the app store at `apps.nextcloud.com`, the announcements feed at `pushfeed.nextcloud.com`, and a connectivity check to four public sites | **None yet.** `updatechecker`, `appstoreenabled` and `has_internet_connection` stay on, Nextcloud's defaults; see *What is left on, and where*, below | `config/config.sample.php` and `apps/settings/lib/SetupChecks/InternetConnectivity.php` at `stable34`, and again at `v35.0.2`; `lib/Cron/Crawler.php` in nextcloud_announcements at `stable34` and `stable35` |

The rest need no switch: PostgreSQL, PgBouncer, busybox, nginx, the status
page (its requests are the probes `gatus.yaml` lists), and our own API, web
app, worker and appliance.

**What is left on, and where.** The demo's Nextcloud, in `managed.yml`, and
the development one in `dev.yml`: their three settings are **not** switched
off. A hook that set them false before Apache started, at every start, made the
demo's first CalDAV write answer 500 in E2E (managed); the same container,
recreated without the hook, passed. What broke the write, one of the three
settings or the hook's run itself, is not known: the values the hook wrote are
most likely still in `config.php` on the demo's volume, which the gate keeps
between runs, and nothing here takes them out or has looked. This Nextcloud
holds fixtures, never a tester's data, and it is not on live: the bring-up
starts it only with `--with-demo`, which both live scripts refuse. Switching
the three off needs a check that the demo's DAV writes still work. Not by a
`*.config.php` mounted into `config/`: that makes the directory non-empty
before the first install, and the image's entrypoint then skips copying its own
config files, `smtp.config.php` among them, which is what points the demo's
Nextcloud at the catcher. And as booleans: `--value=false` alone stores the
string `"false"`, which PHP reads as
true.

The demo's Stalwart (v1.2.0's Alpine build), which
`setup-stalwart.sh` starts with `docker run`, outside every compose file, on
the OTA stack every night, in the self-host end-to-end run, and on a
developer's machine beside `deploy/compose/dev.yml`. It downloads its WebUI
from `github.com/stalwartlabs/webui/releases/download/v2` on first start and
again when its cached copy expires, 90 days on, in recovery mode too; `v2` is
a tag upstream moves within its 2.x releases (on 2026-11-20 it named the
commit of v2.1.0, and on 2026-11-23 v2.1.1's). It downloads its spam-filter rules from
`github.com/stalwartlabs/spam-filter/releases/latest`, and an ASN and country
database daily from `github.com/sapics/ip-location-db`
(`crates/common/src/manager/defaults.rs` and `application.rs`, and
`Application` and `SpamSettings` in
`crates/registry/src/schema/structs_impl.rs`, at v1.1.1, and again at v1.2.0,
the same). v0.16.27 asked for
its WebUI from the release `v1.0.11`, every 30 days, and an older database
kept `cdn.jsdelivr.net` for its ASN lists (the OTA demo's, made at v0.16.10).
v1 opens no database an earlier line made, so that address is gone with it:
the OTA demo's goes once, by hand, at the switch to v1.1.1, with the demo mail
migration's rows (`deploy/compose/reset-demo-mail.sh`;
`docs/stalwart-integration-fix.md`, "Moving the pin"), and the next bring-up
makes it again at v1.1.1 under the same name.
They are downloads rather than reports about anybody. They are
objects in its database, not in `config.json`, so switching them off is new
objects in the provisioning plan, a change that has to be run and watched on
the machine (`docs/stalwart-integration-fix.md`). **Left on.** The Stalwart
itself is needed: it is the demo's mail source and target, which the nightly
gate migrates between. Its three downloads are not: nothing here uses its
WebUI, spam-filter rules or ASN database (accounts are provisioned with
`stalwart-cli`, and no SMTP port is published). They happen only in the places
above, which hold fixtures only, and not on live. The scripted bring-up
starts it only in its demo phase and only with `--with-demo`, which
`deploy-live.sh` and `stand-up-live.sh` refuse, and `bootstrap-managed.sh`
refuses on live's `.env` (`scripts/a-demo-on-a-real-address.unit.test.ts`).
Run by hand, `setup-managed-demo.sh` is not refused on live's `.env` yet.

The site's visit count (*Counting its visits*, above) runs GoAccess with
`docker run`, outside every compose file, from live's checkout once a day.
GoAccess 1.12 (`github.com/allinurl/goaccess`, its source read at the tag
`v1.12`, `ef3c4f3c`, and built from that commit by
`deploy/compose/goaccess/Dockerfile`) has no telemetry,
update check or error report. What in it can reach a
network is its lookup of hosts' names (`src/gdns.c`, for the hosts panel, which
`site-visits.sh` ignores) and its WebSocket server (`src/websocket.c`, only with
`--real-time-html`, which it never passes). It runs with `--network none` all
the same, so nothing could leave if a later version added a report. Its image
is never pulled (`--pull never`); building it fetches Alpine and its packages
and GoAccess's source, and nothing else.

**The image is built on a supported base.** Upstream's
`allinurl/goaccess:1.12`, and `latest` with it, is built on Alpine 3.20.10,
which Alpine no longer supports, and upstream's Dockerfile at `master` still
starts from 3.20, so no upstream release could be waited for. Alpine's own
package is 1.10.2 on 3.24. So `deploy/compose/goaccess/Dockerfile` builds 1.12
on a supported Alpine (3.24 when this was written, supported until 2028-06-01
by the table of the Trivy the scan runs), and `site-visits.sh` builds it
(*Counting its visits*, *The image*). Dependabot moves its Alpine pin in a pull
request of its own, which builds it, the pin watch (`scripts/idp-pin-watch.mjs`)
compares the GoAccess release it builds with upstream's tags, and the weekly
image scan (the image jobs of `.github/workflows/security-scan.yml`) builds it
on an arm64 runner and scans what it built, under the name it always had,
`goaccess`.

The integration tests' throwaway Nextcloud and Stalwart, which Testcontainers
starts on a CI runner, are not switched.

`scripts/a-service-that-phones-home.unit.test.ts` puts every service of every
compose file under `deploy/` in one of three lists (switched, no switch, or left
on, each with its reason) and fails on a service in none. A switched or
left-on row names the image its default was read at, and fails when the file
pins another. It holds the left-on Nextcloud to the demo's bring-up, which
neither live script starts, and pins the Stalwart named above. So **a new pin
of Zitadel, Mailpit or Nextcloud starts with re-reading what the new version
sends by default** (Zitadel's ping arrived with v4), then moving the row.

**When it takes effect.** A switch is read when its container starts, so a
stack has it once Compose has recreated those containers: the OTA stack at its
next nightly bring-up, and live at its stand-up and every deploy, since both
run `bootstrap-managed.sh`, which brings each of them
up by name. The pull sequence in *Updating a running deployment* does **not**
do all of it: it brings up `api`, `web` and the worker, but not the identity
provider or the catcher, which keep their old environment until the next
bring-up. By hand, on a stack that is already
up, from its checkout:

```bash
docker compose -f deploy/compose/managed.yml up -d zitadel
# Only where it already runs: the catcher.
docker compose -f deploy/compose/managed.yml up -d mailpit
```

To see it on a running stack, from its checkout:

```bash
# The environment each container was started with, one variable a line.
env_of() { docker container inspect --format '{{range .Config.Env}}{{println .}}{{end}}' \
  "$(docker compose -f deploy/compose/managed.yml ps -q "$1")"; }

env_of zitadel | grep -E '^ZITADEL_(SERVICEPING|TELEMETRY)_ENABLED='
#   both =false
env_of mailpit | grep -E '^MP_DISABLE_VERSION_CHECK='     # where the catcher runs
#   MP_DISABLE_VERSION_CHECK=true
```

## Mail: caught, not delivered

Every mail this stack sends goes to **Mailpit**, a catcher on the compose
network.

**Two different things send mail, and they are configured separately.** The API
sends its notifications — an access request, a grant, a decline — and, without
a Zammad, problem reports (8f), and reads
`SMTP_HOST` and friends from `.env` via `managed.yml`; the worker's jobs send
the digest with the same settings, which `managed.yml` hands the worker too. The
**identity provider sends its own**: the verification link on a new account, an
email-change confirmation, a password reset, the invitation to set a first
password. None of that goes through the API. `setup-zitadel.sh` configures it
from the same `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` and
`NOTIFY_FROM`, so there is one relay setting rather than two that can drift —
but only during the `app` phase: until that phase has run, the issuer has **no
email provider at all**, and silently drops every one of those.

Its TLS does not follow `SMTP_SECURE`, which sets the API's transport alone. It
is on for any relay and off only for the catcher (`SMTP_HOST=mailpit`), because
the identity provider with TLS off never tries STARTTLS: on 587 it would send the
relay's login in the clear, or be refused. With TLS on it tries implicit TLS and
falls back to STARTTLS, which covers 465 and 587 alike.

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

What the containers actually got, which is the only thing that matters (the
first line reads the api container's environment from Docker, see *Reading what
the api container was started with*):

```bash
docker container inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$(docker compose -f deploy/compose/managed.yml ps -q api)" | grep -E '^(SMTP_HOST|SMTP_PORT|NOTIFY_FROM)='
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
Nextcloud sends to it, or while `SMTP_HOST` is `mailpit`. A
catcher still running from before the relay was set is named, with the command
that stops it, and never stopped by the bring-up: read and delete what it caught
first.

**A catcher rather than a relay, on purpose.** Every mail the product sends is
visible in a browser; the gate exercises grant, decline and request on every
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
  provider's mail provider to it, and recreates the API and the worker with
  it; a worker left on the old values is a digest that never sees the relay.

`bootstrap-managed.sh` says so out loud when `SMTP_HOST` is still the catcher
and `WEB_URL` is an https origin that is not localhost: every send would report
`sent`, because it *was* sent — to a server whose job is to keep it.

**Somebody knocking reaches you.** `POST /api/access-requests` sends
`access_requested` to `NOTIFY_TO`, carrying
the address, organisation and tier — **not** the applicant's note, which stays
in the database behind authentication where the queue shows it. When no channel
is configured the API logs, per request, that nobody was told.

### Before a relay: passing mail on by hand

Until the stack testers use sends through a real relay, you read each tester's
mail in that stack's Mailpit and
pass on what they need. This is a procedure, not a setting.

**Not used on `ownpace-live`.** Live sends through a real relay from day one.
Nobody is invited to live until its `.env` names the relay and one outside
mailbox has been walked end to end, so no tester's
mail is caught there and nothing below is passed on. `stand-up-live.sh` refuses
live's `.env` with `SMTP_HOST` empty or `mailpit` (step 6 of *Standing up
ownpace-live*), so live is never brought up on the catcher. The procedure is
kept in case that changes.

**Where it would apply.** Only on `ownpace-live`, the stack testers use, and
only while its `.env` names no relay. That is never: the relay goes in live's
`.env` from the start. The OTA stack's Mailpit never holds a tester's mail: it
is the nightly gate's, and the smoke reads it every night. Were live ever to run
a catcher, it would be its own: every container, volume and network is named
after its compose project,
so live's catcher would run in live's project beside the OTA stack's, on the
`MAILPIT_PORT` live's `.env` gives it.

**Where each mail lands.** With `SMTP_HOST=mailpit`, every mail below lands in
that stack's Mailpit, whoever it is addressed to, and none reaches an inbox:

- the API's, over the compose network to `mailpit:1025`;
- the worker's jobs', over the same network: the worker is on the stack's own
  `<project>_ownpace-network`, where `mailpit` resolves;
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
| *Ownpace — your access is ready* (`access_granted`; Dutch *uw toegang staat klaar*) | The API, when you grant their request, in the language they asked in | No. It says it is safe to forward. Its link ends in `#register=` and the address it was sent to, so the sign-in page offers *Create your account* with that address filled in; the address is the one the mail prints, not a code. | Forward it to the address it was sent to. Or write them the same three facts yourself (the app's address, the address to register with, and that they must confirm the confirmation mail), and on live copy the Alpha paragraph from the caught mail word for word, in the language it was sent in, with its two lines after it: the Alpha conditions' address and the tester guide's. |
| *Ownpace — about your request* (`access_declined`; Dutch *over uw aanvraag*) | The API, when you decline with *Email them if you decline* ticked, which is the default | No | Forward it, or untick the box and write them yourself. |
| *Ownpace — you are invited to join an organisation* (`member_invited`; Dutch *u bent uitgenodigd voor een organisatie*) | The API, when an owner or admin invites them on the Team page, or presses *Send again* on that row, in the organisation's summary language. During the Alpha it carries the same Alpha paragraph, with the conditions' and the guide's addresses in that language, before the privacy line. At most 20 a day per organisation, and one invitation at most once in ten minutes | No. It says it is safe to forward. | Forward it to the address it was sent to. |
| Verify your address | The identity provider, when they register, and at a first sign-in with Microsoft (above) | **Yes** | Pass the code on within the hour, by the rule below. |
| Password reset | The identity provider, when they ask for one | **Yes** | The same. |
| Password changed | The identity provider, after a reset or any other change of password | No | Nothing to pass on. |
| Email-change confirmation | The identity provider, to the new address | **Yes** | The same, to the new address. |
| Add a passkey | The identity provider, when they ask its console for a link to add a passkey on another device | **Yes**, in the button's link | Forward the mail as it is within the hour, by the rule below. |
| The digest, *what needs your attention* | The jobs, at 08:00 UTC, daily or weekly as the organisation chooses, to its active owners and admins, and only when something waits | No | Nothing. The tester sees the same on screen. |
| *Ownpace — everything is in step, so we look less often* (`looking_less_often`; Dutch *alles is bijgewerkt, dus we kijken minder vaak*) | The jobs, at 07:30 UTC, to the organisation's active owners and admins, when a migration on *Automatic* stepped down to every 6 hours or once a day since they were last told | No | Nothing. Opening the migration brings back the hour, and its page says so. |

Each of the four codes lives one hour. In Zitadel v4.17.3's defaults,
`EmailVerificationCode` and `PasswordVerificationCode` expire after `1h`, and an
email change uses the first; at v4.19.4 `PasswordlessInitCode`, the passkey
link's, does too. `managed.yml` overrides neither; a change made in
the console would not show here. An account somebody creates for a person in
the console gets a mail to set a first password instead, and its code lives 72
hours. Testers register themselves, as the grant mail tells them to.

**Mail addressed to you.** These go to `NOTIFY_TO`, the operator's list, with
or without a relay:

- *Ownpace — somebody asked for access* (`access_requested`), from the API
  when somebody sends the request form. Nothing to pass on: the request is in
  the access queue.
- *Ownpace — a change needs your decision* (`decision_raised`), from the jobs'
  daily checks of a source's directory, even when the decision is in a tester's
  organisation. Nothing to pass on: the tester sees it in the app and in their
  digest.
- *Ownpace — the migration was rolled back* (`rollback_finished`), from the
  `run-rollback` task when you start it with `notifyUsers`. Despite the name, it
  goes to `NOTIFY_TO`. If the migration is a tester's, tell them yourself.

**Never mailed, relay or not.** A grant link: *"You send the link. We never
do."* ([grant-links.md](grant-links.md)). An invitation to an organisation is
mailed (the table above), and the Team page says when the mail was not sent, so
the inviter knows to tell them.

**Not sent from any screen.** The fallback announcement for shares carried
by hand. `POST /api/migrations/:mappingId/sharing/announce` mails each
grantee if it is called, and no screen in `apps/web` calls it. (A share applied
on the *Sharing checklist* is announced by the target's own invite, not by
Ownpace.)

**The one rule: a code goes by mail, and only to the address it was sent to.**
A granted organisation and an invitation both bind to an address the identity
provider verified, in any case and without the spaces around it
(`claimRequestedMembership` and `pendingInvitations` in
`apps/api/src/middleware/auth.ts`, managed migration 0059). Sent on to that
same address, your mail still proves the tester reads that mailbox. Sent
anywhere else, by chat or by text message, it lets whoever receives it verify
an address that may not be theirs, and take what was meant for its owner.

**Only codes you are expecting.** Pass on a code only for an address you
granted and are waiting for. Leave any other code in Mailpit.

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

**When it ends.** Once live's `.env` names the relay, and a code has been
shown arriving in an outside inbox, the mail reaches testers without you. Then
empty live's Mailpit and stop it:
the codes have expired by then, but it still holds testers' addresses and
grant mails. From live's checkout, with `port` set as in the recipe above:

```bash
curl -fsS -X DELETE "http://localhost:${port:?no MAILPIT_PORT in this .env}/api/v1/messages"
docker compose -p ownpace-live -f deploy/compose/managed.yml stop mailpit
```

`-p ownpace-live` names live's project out loud. From live's checkout Compose
takes it from live's `.env` anyway; `-p` also wins over a shell that exported
the other stack's name, which would otherwise stop the catcher the nightly gate
reads. Once live's `SMTP_HOST` names the relay, the bring-up does not start
Mailpit (only with `--with-demo` or `SMTP_HOST=mailpit`), and while one still
runs it says so on every run. It
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
not survive the *next* run. `e2e-managed.yml` works around this by
persisting the one-time setup **outside** any checkout — at
`$MANAGED_ENV_PERSIST_DIR` (default `~/.persistent/<project>`, which for the
gate is `~/.persistent/ownpace-managed`, overridable as a repository variable) — and restoring it into
the checkout at the start of every run, before the refuse-early check.
Before it copies anything out of that directory, the restore asks
[`refuse-live-env.sh`](../deploy/compose/refuse-live-env.sh) whose `.env` it is,
and stops when it carries live's marker, `STACK_KIND=production`, or anything
that could be a slip of it. So a variable pointed at live's
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
```

PgBouncer's userlist is not copied. The gate writes it there itself, and the
stack mounts it from there: see the next section.

### PgBouncer's userlist lives in the persisted directory

**`pgbouncer` mounts `${PGBOUNCER_USERLIST:-./pgbouncer/userlist.txt}`**
(`managed.yml`). Live's `.env` does not set the key, so live's pooler mounts
`deploy/compose/pgbouncer/userlist.txt` in live's own checkout, which nothing
cleans, as it always has. The OTA stack's `.env` sets it to
`~/.persistent/ownpace-managed/userlist.txt`, written out from `/` (a relative
path is refused):

- the gate's *Fill* step writes `PGBOUNCER_USERLIST=<persisted directory>/userlist.txt`
  into the `.env` on every run, before `ensure-env-secrets.sh`, and persists
  the `.env` back with it, so your checkout, which links that `.env`, mounts the
  same file as the gate does;
- `ensure-env-secrets.sh` writes the file the key names, in place, from the
  `.env`'s `PGBOUNCER_AUTH_PASSWORD`, mode 644, every time it runs. It prints the
  path, never the password. There is one file, the one mounted; nothing copies it;
- `bootstrap-managed.sh` refuses to start anything while the key names a path
  that is not a file, and `ensure-env-secrets.sh` refuses a directory there.
  A shell that exports another `PGBOUNCER_USERLIST` than the checkout's `.env`
  is refused by both (Compose would follow the shell): open a new shell.

**Why not the gate checkout's `deploy/compose/pgbouncer/userlist.txt`.** Every
workflow of this repository that runs on the runner checks out into that same
folder, and a checkout deletes the file under the running pooler. Nothing shows
until the Docker daemon restarts or the host reboots: the container's bind
source is missing, Docker makes a **directory** there, and `pgbouncer` stops:
`error mounting ".../pgbouncer/userlist.txt" to rootfs at "/etc/pgbouncer/userlist.txt": ... not a directory`,
exit 127, with every API call that needs the database behind it. A copy kept
here and copied in goes stale besides: `ensure-env-secrets.sh` rewrites the
checkout's file from the `.env`, the `.env` is persisted back, and the copy is
not, so writing the file from it gives
`password authentication failed for user "pgbouncer_auth"`.

To see which file the running pooler mounts, without printing it:

```bash
cd ~/ownpace-managed && docker inspect --format '{{range .Mounts}}{{if eq .Destination "/etc/pgbouncer/userlist.txt"}}{{.Source}}{{end}}{{end}}' "$(docker compose -f deploy/compose/managed.yml ps -q pgbouncer)"
```

**Do not move or delete the persisted directory while the stack runs**: the
pooler's next start (a Docker restart, a reboot) needs the file. If
`MANAGED_ENV_PERSIST_DIR` is changed, the next gate run points the key at the
new directory and recreates `pgbouncer`.

### One stack, one `.env`

Each stack has one `.env`. The operator's checkout of the OTA stack and the
gate's share one file, which is this section. `ownpace-live` has its own, in
`~/.persistent/ownpace-live/`, and the gate never restores it: pointed there, it
refuses before it copies anything.

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

**What it costs when they drift.** When the `zitadel` Postgres role's password
matches one copy and a bring-up presents the other, Zitadel — which finds an
existing role, logs `user already exists, skipping creation`, and does **not**
reset its password — crash-loops. A crash-looping container is
indistinguishable from a slow one until the readiness deadline passes, so the
answer arrives after 300 seconds of silence, and it names a password nobody
changed. The same divergence leaves `ZITADEL_PAT_EXPIRY` in one file describing
a token the database does not have.

Three things make that loud instead of silent:

- `bootstrap-managed.sh` lists any diverging keys **by name** at the top of
  every phase, including the `--from …` resumes that skip preflight. Names
  only — the values are secrets.
- It asks the `zitadel` role for its password **before** starting the
  container, so the answer takes a second rather than five minutes — and it
  asks over the container's **network address**, not the socket, where the
  check could not fail (below).

**The check that could not fail.** `psql -U zitadel` run inside the database
container connects over the **Unix socket**, and the official Postgres image's
generated `pg_hba.conf` answers the socket and `127.0.0.1` with `trust`:
`PGPASSWORD` is never sent and never looked at, so the query succeeds with
*any* password, and a check asked that way reports

> the zitadel role accepts the password in .env — nothing to do

while Zitadel, connecting from its own container, matches the appended
`host all all all scram-sha-256` line instead and is refused with
`SQLSTATE 28P01`, five minutes later. The vacuous pass also short-circuits the
repair: `--sync` exits at the check, so the one command that fixes this
declines to run. As `managed.yml`'s header says about the `openmigrate` role,
"only a connection from another container's real IP exercises the
scram-sha-256 rule". So every query in `zitadel-db-password.sh` goes to the
container's real address, refuses to run at all if it cannot resolve one, and
**says which address it asked over** in the passing message. There is one copy
of the question, and `bootstrap-managed.sh` calls it.
- `env-upsert.sh` **follows the link instead of replacing it**. Its write is
  write-temp-then-rename, and `mv -f tmp link` would silently turn the link
  back into a regular file — re-forking the two on the first key it writes,
  with nothing said.

If the role and your `.env` have already parted company:

```bash
./deploy/compose/zitadel-db-password.sh          # check, change nothing
./deploy/compose/zitadel-db-password.sh --sync   # point the ROLE at .env
```

Check the divergence list first. If a second `.env` exists, the role may be
matching *that* one, and syncing would break the other consumer instead of
fixing yours.

**What could break the link.** `env-upsert.sh` is the *only* thing that writes
`.env`. A `sed -i` replaces a symlink with a regular file and leaves the
canonical copy **stale**, and in a script that writes only when a key is
absent, empty or a placeholder it would survive every ordinary bring-up and
break the link on the first feature that adds a new required secret.
`scripts/one-stack-one-env.unit.test.ts` refuses `sed -i` and `mv` aimed at the
live `.env` anywhere under `deploy/compose/`, and runs `sed -i` against a real
symlink to show why.

The bring-up also reports two files **when they still agree**, not only once
they have drifted — quiet under CI, where `git clean -ffdx` makes a symlink
impossible and the advice would be untakeable.

**Do not run a fresh `bootstrap-managed.sh` or `ensure-env-secrets.sh` in the
CI checkout to "set it up independently.**" It would generate different
random secrets for the *same* containers your manual checkout is already
using — the same class of outage as rotating `SECRET_ENCRYPTION_KEY` without
a plan, self-inflicted on a stack that was just proven working. Reuse what already works; only generate fresh secrets
when there is no working stack yet at all.

## Standing up ownpace-live

`ownpace-live`, the stack testers use, is stood up once and deployed ever after.
[`deploy-live.sh`](../deploy/compose/deploy-live.sh)
does every deploy after the first and cannot do the first: it reads the hold
from live's own database, which does not exist yet. The first bring-up is
[`stand-up-live.sh`](../deploy/compose/stand-up-live.sh): the phases of this
guide in order, with the steps only live has around them, each one refusing
what would be hard to undo. When a step stops or fails, you run it again with
`--resume`.

It runs from the release tag live runs, so that tag has to carry it; every
release tag does. It has stood live up once, and its guard,
`scripts/a-first-bring-up-of-live.unit.test.ts`, runs it against stubs.

### Before the script: the owner's steps

No script can do these. The script checks each one before it changes anything.

1. **The machine** (*Before you start*): at least 15 GB free, Docker's default
   log driver (`docker info --format '{{.LoggingDriver}}'` prints `json-file`
   or `local`; any other answer comes from `/etc/docker/daemon.json`, and
   *Before you start* says how to undo it, before the bring-up creates live's
   containers; the script asks the same and refuses any other answer), and
   the setting that lets a container publish on the front's address before
   the mesh has brought it up. Create
   `/etc/sysctl.d/90-bind-before-the-mesh.conf` holding
   `net.ipv4.ip_nonlocal_bind = 1`, then run `sudo sysctl --system` (*Which
   address a port answers on*). Live's web, sign-in and status ports are
   published on the front's address, so without it they may not start after a
   reboot.
2. **Six ports of live's own**: `POSTGRES_PORT`, `ZITADEL_PORT`, `API_PORT`,
   `WEB_PORT`, `STATUS_PORT` and `MAILPIT_PORT` (alpha.17 and before had three
   more, for Trigger.dev's API, its dashboard and its task registry). Each must be one the OTA stack does not
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
   publishes (the six, and any other `*_PORT` a `ports:` entry of
   `managed.yml` names but the demo's `NEXTCLOUD_PORT`) that lies in the range
   and is not reserved, on a resume too, names it with its number, and prints
   the line that fixes it. `deploy-live.sh` serves live's copy of
   `www.ownpace.eu` on `WWW_PORT` while live's `.env` says `WWW_LIVE=true`, and
   the script asks `WWW_PORT` then too. With live's ports at, say, 40101 to
   40106 (example numbers):

   ```bash
   cat /proc/sys/net/ipv4/ip_local_reserved_ports    # reserved now: keep it
   echo 'net.ipv4.ip_local_reserved_ports = 40101-40106' | sudo tee /etc/sysctl.d/90-ownpace-reserved-ports.conf
   sudo sysctl --system
   cat /proc/sys/net/ipv4/ip_local_reserved_ports    # now with 40101-40106
   ```

   If the first line printed something, it goes in front, separated by a
   comma (`= 8080,40101-40106`); the kernel takes single ports and ranges. If
   another file in `/etc/sysctl.d` sets the key already, put the line in that
   file instead: `sysctl --system` reads them in name order, and the last to
   set a key wins. Ports below the range need nothing.
3. **The routes, before the bring-up.** In NetBird, on the front's
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
     POSTGRES_PORT=<p> ZITADEL_PORT=<p> \
     API_PORT=<p> WEB_PORT=<p> STATUS_PORT=<p> MAILPIT_PORT=<p> \
     WEB_BIND=<front-address> ZITADEL_BIND=<front-address> STATUS_BIND=<front-address> \
     EXPOSURE_ALLOW=<address,address> EXPOSURE_NOT_OURS=<name,name> \
     WEB_URL=https://app.ownpace.eu CORS_ORIGIN=https://app.ownpace.eu \
     API_URL=https://app.ownpace.eu \
     ZITADEL_EXTERNALDOMAIN=id.ownpace.eu ZITADEL_EXTERNALPORT=443 \
     ZITADEL_EXTERNALSECURE=true ZITADEL_TLS_MODE=external \
     NODE_ENV=production OWNPACE_STAGE=alpha BACKUP_RETENTION_DAYS=7 TRUST_PROXY=2 \
     ALERT_ENABLED=true MAX_PASSES_IN_FLIGHT=6 \
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
   refuses. `EXPOSURE_NOT_OURS` is the OTA stack's, copied: the containers on
   the machine that are not Ownpace's, by name (*Containers on the machine that
   are not Ownpace's*, under *Which address a port answers on*); leave it empty
   when there are none. The same check refuses an Ownpace container in it. Leave `POSTGRES_BIND`, `API_BIND` and
   `OWNPACE_REACHABLE_HOSTS` empty, and keep `APP_DB_USER=app_user`. Leave
   every sign-in provider's key empty, the `IDP_*` keys of Google, Microsoft,
   GitHub and Apple (§8b, *Offering Google, Microsoft, GitHub or Apple as a
   second way in*): live's sign-in page offers email and password only, as
   privacy §4.4, §7 and §8 say, and the script refuses a key that holds a
   value. `GOOGLE_OAUTH_*`, the consent's pair from the OTA stack's client, are
   other keys and stay. Write
   every line `KEY=value` at its start: Compose also reads a key indented, with
   a space before `=`, or with `:`, the script's checks do not, and it refuses
   such a line. `NODE_ENV=production` is live's mode: `managed.yml` takes no
   default, and the script refuses anything else. `API_URL` is the app's
   address too: from outside, live's API is reached at the app's origin
   alone, and it builds every consent's redirect from it (§8e, step 4). Left
   at the example's localhost, Google answers live's first connect with
   `redirect_uri_mismatch`, as it did on 2026-11-20, so the script refuses
   anything but `https://app.ownpace.eu` for it, as for `WEB_URL` and
   `CORS_ORIGIN`, and `deploy-live.sh` refuses, at every deploy after, any of
   the three that is not live's own https address.
   `ALERT_ENABLED=true` turns on the mail a red status row sends you, and the
   script refuses live without it, since testers are on live. With it on, a row
   that stays red for three minutes during the bring-up
   mails you: that is expected, and shows mail arrives.
   `BACKUP_RETENTION_DAYS=7` is the most days a dump of live's
   databases taken before a deploy is kept, which the erasure sentence names;
   the script refuses it empty, `0`, or
   anything but a whole number above 0. `deploy-live.sh` takes that copy before
   each update, and it is deleted once the update is proven, or after six days
   less an hour by the daily duties (§8g).

   **`TRUST_PROXY=2`** is the number of proxies in front of live's API, and it
   decides whose address the API's log and its request limit take for the
   caller (privacy §4.5). Two stand there: NetBird's reverse proxy, which ends TLS,
   connects to the machine from its own address on the mesh, and sets
   `X-Forwarded-For` to the address the visitor connected from, dropping
   whatever the visitor sent; and the web container's nginx, which appends
   NetBird's address. With 2 the API names the visitor; with 1 it names
   NetBird for everybody, empty the web container. A count above the proxies
   that are there is as bad as `true`: Express then takes the leftmost entry,
   which the caller wrote. The script refuses anything but 2 or 3, 3 being for
   a NetBird cluster that adds a hop of its own. Both nginx logs record the
   header NetBird sets as their last field, whatever this says. Whether
   NetBird's own cluster adds a hop is not in its source; the check in *After
   the script*, step 6, settles it.

   **`MAX_PASSES_IN_FLIGHT=6`** is live's cap on passes running at once. The
   worker is sized from it (*The job runner*): a stack at 6 sets
   `WORKER_CPUS=4` and `WORKER_MEMORY=4352m` in its `.env` beside it. The OTA
   stack runs with 6 as well while it is the only stack on the machine. Once
   live is stood up, put the OTA stack back to 3, from its own checkout, in a
   shell with no `COMPOSE_PROJECT_NAME` exported (*One shell, one stack*), with
   the worker's size back to `managed.yml`'s defaults, the rule at 3:

   ```bash
   ./deploy/compose/env-upsert.sh deploy/compose/.env MAX_PASSES_IN_FLIGHT=3 WORKER_CPUS= WORKER_MEMORY=
   ./deploy/compose/bootstrap-managed.sh --only app
   ```

   **Mail goes through a real relay from the first day**: live
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
`exposure-check.sh`, `box-duties.sh` and `stack-kind.sh`; a `node` on the
shell's `PATH` below the tag's `engines.node`, or none, in `deploy-live.sh`'s
words (*The Node in the shell you deploy from*); a working tree that is
not clean; a deploy log with a line in it (live stands: use `deploy-live.sh`);
live's database volume already there without `--resume`; and, all listed at
once, a line of live's `.env` that sets a key in a form Compose reads and the
checks do not (indented, a space before `=`, or `:`), every setting from steps
2, 3 and 6 above that is wrong for live (`NODE_ENV` not `production` and
`ALERT_ENABLED` not exactly `true` among them, on a `--resume` too, and a
sign-in provider's `IDP_*` key that holds a value), a port that is any of the OTA stack's
under whatever key (read from its persisted `.env`, or the compose files'
default) or, on a first run, already in use, a port live publishes that lies in
the kernel's ephemeral range and is not reserved (step 2; that refusal names the
port, because its fix lists it), and a production name that does not resolve.

**What it does, in order:**

1. Generates `POSTGRES_PASSWORD` and `APP_DB_PASSWORD` (and `JOBS_DB_PASSWORD`
   whenever it is empty or published) with `openssl rand -hex 24`, each one that is empty or a value this
   repository publishes and whose volume does not exist yet, through
   `env-upsert.sh --stdin`: on no command line, and never printed. In the same
   write, `ZITADEL_ORG_NAME=Ownpace` when that key is empty, so the identity
   provider names its organisation `Ownpace` from its first start; a name you
   set is kept.
2. `bootstrap-managed.sh --only preflight`, `--only env` and `--only data`.
3. Makes sure `app_user` exists with `APP_DB_PASSWORD` before anything
   migrates: the baseline migration creates it with a published password only
   when it does not exist. The `data` phase of step 2 creates it, and this
   step finds it there.
4. Asks live's database over live's own network, as every container does:
   the two controls must open, and the three published values
   must not.
5. `bootstrap-managed.sh --from plane`. It stops for nothing: the plane
   phase removes what is left of Trigger.dev's containers (none, on a new
   stack), and the app phase asks the system role's question and starts the
   worker. (Until alpha.18 it stopped twice, for live's own Trigger.dev
   account and the deploy CLI's login.) After a stop or a failure, run
   `./deploy/compose/stand-up-live.sh --resume`, not the resume line the
   bring-up printed. On a resume every step asks whether it is done first: no
   password is generated twice, `app_user` is not created twice, and each
   bring-up phase skips what it finds done. There is no state file.
6. The checks: `/api/version` at `app.ownpace.eu` names the tag's commit and
   version, `/api/ready` answers 200, `/api/auth/mode` answers `managed`,
   `NODE_ENV` is `production` in the api container, `id.ownpace.eu` names
   itself as the issuer, live's two networks exist and share no container with
   the OTA stack's, and `exposure-check.sh` passes. Run it in daytime: the
   appliance nightly's dev Nextcloud publishes on every interface while it
   runs.
7. Appends the first line of `~/.persistent/ownpace-live/deploys.log`, in
   `deploy-live.sh`'s format: the date, the tag, the commit, `took`, `one-way`.
8. Copies the five units of *Live's daily duties* to `~/.config/systemd/user`
   (the duties' pair, the box checks' pair and the mail on a failed run) and
   runs `systemctl --user daemon-reload`.
9. Prints what is left, below.

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
   eight duties pass. Then the box checks and the test mail (*Who is told*,
   below): `systemctl --user enable --now ownpace-box-checks.timer` and
   `systemctl --user start ownpace-tell-owner@test.service`, which mails one
   *Test mail* to `ALERT_TO`.
4. **Rehearse the next deploy.** Open a hold on the support screen with a Dutch
   sentence, wait five minutes, then `./deploy/compose/deploy-live.sh --dry-run <tag>`:
   every refusal passes, it says reversible (the same tag), and nothing moves.
   Lift the hold. Every deploy from here on is `deploy-live.sh`.
5. **The outside probe.** Set the repository variable
   `EXPOSURE_PROBE_LIVE_PORTS` to live's published ports, and dispatch the
   *Exposure probe* workflow. Among its checks it asks `app.`, `id.`,
   `status.` and `www.ownpace.eu` for a page as a visitor would (`www.` once
   it is routed to live's front), and fails while NetBird's sign-in answers
   any of them instead: a redirect to NetBird's identity provider, or NetBird's
   own page. **NetBird's sign-in is off on all four before the first
   invitation**: in NetBird's dashboard, no SSO, password, PIN or header
   authentication, and no NetBird-Only Access, on any of the four services.
   Only a request from outside the NetBird network shows it. From a peer of
   the account, your laptop on the mesh or the machine, NetBird may let a
   request through its SSO without a sign-in page, so a browser there proves
   nothing, and the probe runs on a GitHub-hosted runner.
   It also fails while `https://id.ownpace.eu/ui/login/register/org`, the form
   that founds an organisation, answers anything but 404: read
   `disallowPublicOrgRegistration` back on live, and set it if it reads
   false, with workplan 0135 §4, T0 step 1. And it fails while the app's page
   arrives without the headers its template states: a
   policy or HSTS missing, sent twice or changed on the way names the header,
   never what arrived; `curl -sI https://app.ownpace.eu/` from your own
   machine shows what arrived.
   If a port answers on the production names' addresses that nothing of yours
   publishes, find out first whether the front sends it anywhere. In NetBird's
   dashboard, look for a TCP, TLS or UDP service whose public port is that
   port: such a service relays to any host and port, so it is an exposure
   whatever the capture says. Then, on the machine, capture every new
   connection that arrives over the mesh, to ANY port, while you dispatch the
   probe. The front reaches the machine only over the mesh (NetBird's
   interface is `wt0` by default), and the probe's tries on the machine's own
   address are judged by the probe itself:
   `sudo timeout 900 tcpdump -lni wt0 -q 'tcp[tcpflags] & (tcp-syn|tcp-ack) == tcp-syn and not dst port <WEB_PORT> and not dst port <ZITADEL_PORT> and not dst port <STATUS_PORT> and not dst port <WWW_PORT>'`.
   A connection from the front at the probe's time, whatever the port, means
   the front forwards something, so close it; your own mesh devices' show up
   too, from their own addresses. Nothing from the front: the front holds the
   port itself, and
   `gh variable set EXPOSURE_PROBE_FRONT_PORTS --body '<every listed port>'`
   (the whole list in one value, since it replaces the old one) makes it a note,
   behind two tripwires: PostgreSQL's handshake, and a TLS hello with no
   server name, which fails on a certificate from Caddy's own local CA, the
   one the Trigger.dev dashboard's TLS front presented until alpha.18. They know only those
   two: anything else that answers on a listed port is a note, which is why
   the capture comes first. And the hello names no server, so a service that
   routes by a name it was given (a TLS service) answers it nothing, which is
   why NetBird's dashboard comes before both.
6. **Live's logs name the visitor** (privacy §4.5).
   From outside the NetBird network, send one request to the app and one to
   the site, each with a forged header, `192.0.2.1` being a documentation
   address and nobody's:

   ```bash
   curl -s -o /dev/null -H 'X-Forwarded-For: 192.0.2.1' https://app.ownpace.eu/api/version
   curl -s -o /dev/null -H 'X-Forwarded-For: 192.0.2.1' https://www.ownpace.eu/      # once live serves the site
   ```

   Then, on the machine, from `~/ownpace-live`, one line of each log:

   ```bash
   docker compose -f deploy/compose/managed.yml logs --no-log-prefix --tail 50 api | grep 'GET /api/version'
   docker compose -f deploy/compose/managed.yml logs --no-log-prefix --tail 50 web | grep 'GET /api/version'
   docker compose -p ownpace-live-www -f deploy/compose/www.yml --env-file deploy/compose/.env logs --no-log-prefix --tail 50 www
   ```

   Read the API's line and the two nginx lines apart, because they answer
   different questions. Each nginx line starts with NetBird's address on the
   mesh and ends, in quotes, with what NetBird passed on:

   - **Only the address you sent from**: NetBird replaces a visitor's header,
     as its source says.
   - **`192.0.2.1, ` and then the address you sent from**: NetBird appends to
     it instead. That is not wrong in itself: the rightmost entry is the one
     NetBird saw, and the API, which counts from the right, still names you.
     Write it in 0132's Status block, because this field then also holds what
     a visitor claimed.

   The API's line starts with the address the API takes for the caller:

   - **The address you sent from**: `TRUST_PROXY` is right.
   - **Another address of NetBird's**: its cluster puts a proxy of its own in
     front. `TRUST_PROXY=3` in live's `.env`, then
     `docker compose -f deploy/compose/managed.yml up -d --force-recreate api`,
     and ask again.
   - **`192.0.2.1`**: the API believes what a visitor wrote: the count is
     more than the proxies in front, or NetBird passed the forged header on
     as though it were the address it saw. Stop, and write it in 0132's Status
     block before the first invitation.

   These lines hold your address and NetBird's: paste them nowhere public.
7. **The test alert.** Live runs with
   `ALERT_ENABLED=true`. From `~/ownpace-live`:

   ```bash
   docker compose -f deploy/compose/managed.yml stop web
   ```

   Wait four minutes, then:

   ```bash
   docker compose -f deploy/compose/managed.yml start web
   ```

   The rows that read the public address each mail you an alert, then a
   recovery. The Identity provider row stays quiet. Write the date and the
   outcome in workplan 0142's Status block.
8. **The record.** The date, the tag and each check's outcome, never a value, in
   workplan 0132's Status block.

**Not part of the stand-up: the books and payments.** Live runs the alpha,
which invoices nobody, so the script sets no `MONEYBIRD_*` key and no
`MOLLIE_API_KEY`, and live runs without them. They come before the alpha ends,
all but Mollie's live key: *8i. The books and payments* above, with live's own
Moneybird administration, and [ending-the-alpha.md](./ending-the-alpha.md) for
when. Mollie's live key goes in with the switch that ends the alpha (*The
switch*, step 4), since `deploy-live.sh` refuses live's `.env` with
`MOLLIE_API_KEY` set while its stage is `alpha`.

## Live's daily duties

The nightly gate keeps the OTA stack alive as a side effect of testing it. Two
of `e2e-managed.yml`'s steps are maintenance: `setup-zitadel.sh` runs the
identity provider's provisioning token's clock (the token lives seven days, a
run replaces it in its last three, and past its deadline no successor can be
minted), and `dump-idp.sh --drill` dumps the identity provider's database,
restores the dump into a database of its own beside it and compares their
tables' counts. CI never touches live, so live has
[`box-duties.sh`](../deploy/compose/box-duties.sh), run once a day from
`~/ownpace-live` by a systemd timer. **The drill is not one of them:** it runs
on the test stack only, in the gate, and `dump-idp.sh` refuses `--drill` on
live, which keeps one copy of its databases, made right before an update. It
does eight duties, each one whatever the one before it did:

| Duty | What it runs | What it does |
|---|---|---|
| `token` | `setup-zitadel.sh --token-only` | The token's clock and nothing else: no secrets generated, the provider not started or reconfigured. It writes `ZITADEL_PAT_EXPIRY`, as every run does. |
| `copies` | `copy-before-update.sh expire` | The backstop of the copy made before an update, in `~/.persistent/ownpace-live/copy-before-update`: deleted once it is older than six days less an hour, whether or not its update was proven, so it is never kept past day 7, even when this run starts late; a dump made there by hand goes by its own age. The run before the one that deletes it keeps it and fails the duty, saying to roll back from it today or to delete it (the operator runbook's *The copy before an update*). It reads no database. The copy is **secret-bearing** (testers' data, the provider's password hashes); the scripts make it readable by this account only. |
| `exposure` | `exposure-check.sh` | Every port any container on the machine publishes, both stacks. Needs `EXPOSURE_ALLOW` in live's `.env`, and `EXPOSURE_NOT_OURS` where the machine runs containers that are not Ownpace's. |
| `organisations` | `setup-zitadel.sh --count-organisations` | The count of organisations on live's identity provider, read-only. A count that is not one fails the duty. |
| `site` | `www-live.sh check` | Read-only. Fails when a container of live's project has the compose service `www`, where a `www.yml` command without `-p` puts the site; and, when live's `.env` says `WWW_LIVE=true`, when `ownpace-live-www` is not running and healthy (*`www.ownpace.eu`: live's copy*). |
| `strays` | `idp-strays.sh --remove --at-most 20` | Removes the sign-in accounts nobody let in, older than 30 days, and those of members removed from an organisation 7 or more days ago, as privacy §9 says (the runbook's *Sign-in accounts nobody let in*). A removed member's account stays while the removal is younger than 7 days, or while they are a member again, an operator, or hold an open request or invitation; so does an account of another organisation at the provider or with a role there. More than 20 at once removes none and fails the duty: run `./deploy/compose/idp-strays.sh` from `~/ownpace-live` to see them, then `--remove` by hand if they are right. A database with no operator row (*Become the operator*, above) removes none and fails the duty too. One that has its operator row back and not its members, after a reset or restore that kept the provider's accounts, is not seen: turn the duties off before such a reset and on again once the members are back (the runbook says how). Its lines name an account's id, never its address. |
| `searches` | `support-read-prune.sh --delete` | Deletes the support screens' reads recorded with no organisation (a search by address, a download of the audit log, the organisation list, the invoices kept after an erasure, a log page not filtered to one organisation) 12 months after they were recorded, as privacy §4.5 and §9 say (the runbook's *Searches and downloads on the support screens*). As the database's owner: `app_user` cannot delete from that log, and the tasks' system role can, for the purge of an erased organisation, but its grant (`SELECT` on `tenant_id`, and `DELETE`) lets it pick rows by organisation, never by age. It stops, deleting nothing, and fails the duty when that connection does not pass row security. It prints a count. |
| `visits` | `site-visits.sh` | The visits in the log of live's copy of the site, counted by GoAccess as totals that identify nobody (privacy §4.5), into one HTML report per container of the site under `~/.persistent/ownpace-live/site-visits/` (*Counting its visits*). Daily because a deploy replaces the container and its log, and what no run counted before then is never counted. GoAccess is given no address and no text a visitor or a link chose, and keeps no database. With `WWW_LIVE` not true it reads nothing and passes; while the checkout's privacy text does not say visits are counted (privacy 1.2, §4.5 and §5) it refuses, and the duty fails. It prints counts, never an address. |

It exits 0 when all eight pass, 1 naming every duty that failed, and 2 when it
refused before any duty: a `.env` without live's marker (the OTA stack's duties
are the gate's), a project the reader refuses, or an argument. A duty that runs
past 20 minutes (`BOX_DUTY_TIMEOUT`, in seconds) is a failed duty. Ctrl-C in a
run by hand, or a SIGTERM, stops the running duty, says which, starts no other
and exits 130 or 143. It prints no value from the `.env`, and this machine's
addresses in a duty's output, stdout and stderr alike, are replaced by the key
that holds them. When a run fails, systemd mails you, and when no run
happens, the box checks do (*Who is told*, below); the
journal has what each duty said.

**Until the timer is installed,** run `./deploy/compose/setup-zitadel.sh
--token-only` from `~/ownpace-live` at least every three days. It replaces the
token only when fewer than three of its seven days remain, so a gap of four
days can miss that window.

**The units.** Five user units, run as the account that owns live's checkout
and reaches Docker: the duties' service and timer, the box checks' service
and timer, and the template unit that mails you when a run fails (*Who is
told*, below). All five are in
[`deploy/compose/systemd/`](../deploy/compose/systemd/):

```ini
# ownpace-box-duties.service — live's daily duties (workplan 0132 T7): the
# provisioning token's clock, the backstop of the copy before an update
# (0139), the exposure check, the organisation count, the site's (0139 T10),
# the accounts nobody let in (0135 T8), the support screens' searches kept
# a year (0139 T6) and the site's visits, counted as totals (privacy §4.5). A
# user unit, started by ownpace-box-duties.timer; the install steps are in
# docs/managed-bring-up.md, "Live's daily duties". A run that fails, by its
# exit or by TimeoutStartSec, starts ownpace-tell-owner@ for this unit, which
# mails the owner (workplan 0142 T3). OnFailure= belongs here, in [Unit].
[Unit]
Description=ownpace-live: the duties the nightly gate does for the OTA stack
OnFailure=ownpace-tell-owner@%n.service

[Service]
Type=oneshot
WorkingDirectory=%h/ownpace-live
ExecStart=%h/ownpace-live/deploy/compose/box-duties.sh
SyslogIdentifier=ownpace-box-duties
# Eight duties of at most 20 minutes each (BOX_DUTY_TIMEOUT), and room to say
# which failed.
TimeoutStartSec=170min
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

```ini
# ownpace-tell-owner@.service — one mail to the owner when a unit fails
# (workplan 0142 T3). Started by systemd for the unit whose OnFailure= names
# it, ownpace-box-duties.service, with that unit's name as the instance; and
# by hand as ownpace-tell-owner@test.service, which sends the test mail.
# tell-owner.sh sends it through live's alert relay. Never enabled, and with
# no OnFailure= of its own: a mail that failed cannot mail that it failed,
# and the journal has why (journalctl --user -u 'ownpace-tell-owner@*').
[Unit]
Description=ownpace-live: tell the owner that %i failed

[Service]
Type=oneshot
WorkingDirectory=%h/ownpace-live
ExecStart=%h/ownpace-live/deploy/compose/tell-owner.sh --unit %i
SyslogIdentifier=ownpace-tell-owner
TimeoutStartSec=3min
```

```ini
# ownpace-box-checks.service — live's machine watched for the owner (workplan
# 0142 T3): the free space on Docker's filesystem and on live's persisted
# directory, the age of the daily duties' last pass, and once a day a summary
# of numbers, each sent by mail through tell-owner.sh. A user unit, started by
# ownpace-box-checks.timer; the install steps are in docs/managed-bring-up.md,
# "Live's daily duties". No OnFailure=: a check that failed every ten minutes
# would mail every ten minutes. A morning without the summary says it stopped.
[Unit]
Description=ownpace-live: the disk, the duties' last pass, and a summary a day

[Service]
Type=oneshot
WorkingDirectory=%h/ownpace-live
ExecStart=%h/ownpace-live/deploy/compose/box-checks.sh
SyslogIdentifier=ownpace-box-checks
# Ends before the next run starts; the summary's docker system df -v is the
# slowest part.
TimeoutStartSec=9min
```

```ini
# ownpace-box-checks.timer — every ten minutes, on the minute that ends in 0.
# A run missed while the machine was off is not made up: the next one looks.
[Unit]
Description=ownpace-live: the box checks, every ten minutes

[Timer]
OnCalendar=*:0/10

[Install]
WantedBy=timers.target
```

**Installing them,** once live stands, on the machine, as that
account:

```bash
# Once, as root: this account's timers run when nobody is signed in.
sudo loginctl enable-linger "$USER"

# Copied, not linked: a checkout of another tag must not change the timer.
mkdir -p ~/.config/systemd/user
cp ~/ownpace-live/deploy/compose/systemd/ownpace-box-duties.service \
   ~/ownpace-live/deploy/compose/systemd/ownpace-box-duties.timer \
   ~/ownpace-live/deploy/compose/systemd/ownpace-tell-owner@.service \
   ~/ownpace-live/deploy/compose/systemd/ownpace-box-checks.service \
   ~/ownpace-live/deploy/compose/systemd/ownpace-box-checks.timer \
   ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now ownpace-box-duties.timer
systemctl --user enable --now ownpace-box-checks.timer

# When it fires next, then one run now, and what it said.
systemctl --user list-timers ownpace-box-duties.timer
systemctl --user start ownpace-box-duties.service
journalctl --user -u ownpace-box-duties -n 200 --no-pager

# One test mail to ALERT_TO, through the unit a failed run starts.
systemctl --user start ownpace-tell-owner@test.service
journalctl --user -u 'ownpace-tell-owner@*' -n 20 --no-pager
```

- **The journal.** A failure line is logged at the error priority, so
  `journalctl --user -u ownpace-box-duties -p err` shows only those. Where the
  user journal is not kept apart (a volatile journal), `sudo journalctl -t
  ownpace-box-duties` reads the same lines.
- **What it runs with.** The user manager's `PATH`, which holds `/usr/bin`:
  `docker`, `curl` and `jq` must be there, and the account must reach Docker
  (the `docker` group). `systemctl --user edit ownpace-box-duties.service`
  adds an `Environment=` line if not. The mail needs a `curl` that speaks
  SMTP: `curl --version` lists `smtp` and `smtps` among its protocols.
- **After a deploy that changed the units,** copy them again and run
  `systemctl --user daemon-reload`. The first tag with the duty `visits`
  does: `TimeoutStartSec` goes from 150 to 170 minutes, eight duties of 20.
  A unit copied before it still runs all eight, and cuts a run short only
  when nearly every duty runs to its 20 minutes. The first tag with the box
  checks does too: `ownpace-box-duties.service` gains its
  `OnFailure=` line, and three units are new, so copy all five, then
  `systemctl --user enable --now ownpace-box-checks.timer` and the test mail.
  `deploy-live.sh` names, after a deploy that took, each unit the tag carries
  that is installed otherwise or not at all, with the `cp` to run; it copies
  nothing. That note is in the script that starts the deploy, from before the
  checkout moves, so it first appears on the deploy after the one to a tag
  that carries it.
- **A run after a stop.** `Persistent=true` runs a missed day at the next
  start, which may fall inside the appliance nightly's hours; its dev
  Nextcloud then fails `exposure`, by name.
- **A copy that holds Trigger.dev's database.** A copy taken before alpha.18
  for an update that moved the Trigger.dev pin holds a
  `triggerdb-<stamp>-before-<tag>.sql.gz` beside the rest. The duty counts it,
  keeps it and deletes it with its copy, as any; nothing restores it, since
  there is no plane to restore it into (*Trigger.dev's plane, removed*).
- **Turning it off:** `systemctl --user disable --now ownpace-box-duties.timer`.
  Then nothing deletes the copy before an update, so `copy-before-update.sh
  take` refuses and no deploy moves live until the timer is active again. A
  copy already there stays until you delete it or the timer runs again:
  delete it by its seventh day yourself. The box checks
  mail *Daily duties late* 26 hours after the last pass, which is the
  reminder to turn it on again.

### Who is told: a failed run, a run that never came, and the disk

Five things reach you by mail, through the relay and the
addresses the status page's alerts use (*8d*: `ALERT_SMTP_*`, `ALERT_FROM` and
`ALERT_TO`, falling back to `SMTP_*`, `NOTIFY_FROM` and `NOTIFY_TO`), sent by
[`tell-owner.sh`](../deploy/compose/tell-owner.sh). It passes curl the relay
and the login in a config on a file descriptor, never on a command line, uses
STARTTLS, required, on 587 and implicit TLS on 465 (or with `SMTP_SECURE=true`
on `SMTP_PORT`), and refuses a `.env` that is not live's. A body holds
numbers, the names of duties, databases and volumes, release tags, mount points
and dates: no address, and no value from the `.env` but the floor and
`ZITADEL_PAT_EXPIRY`'s date.
Each message has a row under its name in the
[incident runbook](./incident-runbook.md#one-row-per-alert).

- **A failed run.** `OnFailure=` in `ownpace-box-duties.service` starts
  `ownpace-tell-owner@ownpace-box-duties.service.service` when a run exits
  non-zero or is cut short by `TimeoutStartSec`. It mails *Daily duties
  failed*, naming the duties that failed from the record the run left in
  `~/.persistent/ownpace-live/box-duties/last-run` (or saying the run left
  none: refused, stopped, timed out), with the token's date.
- **A run that never came.** `OnFailure=` never fires for a run that does not
  happen: a timer disabled or never enabled, removed unit copies, a machine
  that was off. [`box-checks.sh`](../deploy/compose/box-checks.sh), every ten
  minutes on `ownpace-box-checks.timer`, reads the last pass
  (`.../box-duties/last-pass`, written only when all eight passed) and mails
  *Daily duties late* once it is more than 26 hours old, or when none is
  recorded 26 hours after it started watching. A pass leaves the token more
  than three days, so that mail still leaves more than 46 hours to run
  `./deploy/compose/setup-zitadel.sh --token-only` by hand.
- **The disk.** The same run checks the free space on the filesystem of
  Docker's data root and on that of `~/.persistent/ownpace-live`: one
  filesystem holding both is one check. Under `ALERT_DISK_FREE_GB` (live's
  `.env`, 15 without it, the figure the preflight warns at) it mails *Disk
  below the floor* once, *Disk recovered* once it is back, and *Disk not read*
  when `df` or `docker info` cannot say two runs in a row (one run alone is a
  Docker daemon restarting, and only in the journal). Never one every ten
  minutes: it remembers each state in `~/.persistent/ownpace-live/box-checks/`,
  and a message that could not be sent is sent again by the next run.
- **The update proven.** The same run asks
  `copy-before-update.sh delete-if-proven` whether the update the copy before
  it was taken for is proven, and that script deletes the copy when it is
  (the rule is under step 6 of *`ownpace-live`: a release
  tag, with `deploy-live.sh`*, below). A copy it deleted is one mail, *Update
  proven*, naming the tag, the times, the passes and the number of files; the
  files' names are in the journal. The line it answered is kept in
  `~/.persistent/ownpace-live/box-checks/copy-proven` before the mail is
  tried, so a mail that could not be sent is sent by the next run, and no
  other copy is deleted until it is. A kept copy is no mail: the summary says
  why. An answer it cannot read is in the journal and a failed run, never a
  mail.
- **One summary a day,** at its first run from 07:00 UTC: *Daily summary*,
  numbers only. Free space; the duties' last run and pass, their timer and
  the token's date; every database of each stack's `postgres`, live's and the
  OTA stack's, by size; the five largest volumes
  of the two stacks; live's rows of `run`, `run_event`, `item` and
  `app_event`, the age of the sync tick's beat, and where the copy before an
  update stands (none here, kept and why, deleted, or not read). It reads
  each database with `docker exec` into the container its compose labels
  name, psql over the container's own socket, SELECTs only. A morning
  without it means the machine, the box checks' timer or the relay is
  broken. One that could not be sent is tried again an hour later, not at
  every run, and its send error is in
  `journalctl --user -u ownpace-box-checks`.
  `./deploy/compose/box-checks.sh --summary` sends one now.

`box-checks.sh` exits 0 when everything was checked and every message due was
sent, 1 when something could not be checked or sent (each named in the journal,
`journalctl --user -u ownpace-box-checks`), and 2 when it refused. Its service
has no `OnFailure=`, or a check that failed every ten minutes would mail every
ten minutes. `tell-owner.sh` exits 0 sent, 1 not sent (curl's words in the
journal of whatever ran it), 2 refused.

## When it goes wrong

| What you see | What it is | What to do |
| --- | --- | --- |
| `pgbouncer` exits 127 at a start: `error mounting ".../userlist.txt" to rootfs at "/etc/pgbouncer/userlist.txt": ... not a directory` | The file the pooler mounts was missing when the container started (a Docker restart, a reboot, a recreate), and Docker made an empty **directory** at that path. On the OTA stack the file lives in the persisted directory, where no checkout deletes it (*PgBouncer's userlist lives in the persisted directory*) | In `~/ownpace-managed`, with the `.env` linked: `rmdir` the path the error names, then `./deploy/compose/ensure-env-secrets.sh` (it writes the file from the `.env`'s `PGBOUNCER_AUTH_PASSWORD`, and prints the path, never the password), then `docker compose -f deploy/compose/managed.yml up -d --force-recreate pgbouncer`. `bootstrap-managed.sh` refuses before this can happen to a file `PGBOUNCER_USERLIST` names |
| `pgbouncer` logs `could not open auth_file … Permission denied`, then `no such user: pgbouncer_auth` | `userlist.txt` was written 0600 by the host user; PgBouncer reads it as a different user inside the container, finds no users, and rejects every login | `chmod 644` on the file (`deploy/compose/pgbouncer/userlist.txt`, or the one `PGBOUNCER_USERLIST` names), then force-recreate. `ensure-env-secrets.sh` writes 644 and `--only data` repairs the mode |
| The seed or a host-run script talks to the wrong Postgres | On a shared host, `localhost:5432` may belong to something else entirely — this stack's Postgres is published wherever `POSTGRES_PORT` says | The `demo` phase asks `docker compose port postgres 5432` rather than trusting a default. For your own commands, do the same |
| A config fix to `pgbouncer.ini` seems to change nothing — same error after pulling | `pgbouncer.ini` is a bind mount read once at start-up, and `up -d` does not recreate a container whose spec has not changed, so the old process keeps running the old file | `docker compose -f deploy/compose/managed.yml up -d --force-recreate pgbouncer`. `--only data` does this automatically when the container is unhealthy |
| `pgbouncer` log says `cannot use the reserved "pgbouncer" database as an auth_dbname` | `auth_user` set in the **global** `[pgbouncer]` section governs the admin console too, and the console's database name is reserved — so `auth_query` cannot run and every connection is refused. A per-database `auth_dbname` does not help: the console is not matched by `*` | `auth_user` is set on the `*` entry, where it applies to real databases only. `auth_dbname` there must equal `POSTGRES_DB`; `--only data` refuses if they disagree |
| `pgbouncer` reports `unhealthy` after ~80s, and its own log says the user is not allowed | The healthcheck reads `SHOW POOLS` from the admin console, which PgBouncer refuses to anyone not in `stats_users`/`admin_users` | Fixed in `pgbouncer/pgbouncer.ini` (`stats_users = pgbouncer_auth`). On an older checkout, pull and `--only data` |
| Any `docker compose` command fails with `required variable X is missing a value` | Compose interpolates the **whole** file before running anything, so one unset variable breaks every command — including ones that never touch the service named in the error. An `.env` that predates the pooler hits this on `PGBOUNCER_AUTH_PASSWORD` | `./deploy/compose/ensure-env-secrets.sh`, then `--only data` to create the matching Postgres role and start the pooler |
| `pgbouncer` never becomes healthy, complains about a password | `setup-auth.sql` has not run, or ran without `my.pw` set | `--only data`. The SQL refuses an unset `my.pw` rather than creating a role with no password |
| Every app connection: `password authentication failed`, though `.env` and the container agree | A volume from a *different* project — compose's project name derived from the directory basename | `managed.yml` pins its project (`name: ownpace-managed`, which `COMPOSE_PROJECT_NAME` in the `.env` beside it overrides). Check `docker volume ls` for a stray `compose_postgres_data` |
| **The product's sign-in never completes.** The right password comes back to the same sign-in page with no error on it; a **wrong** password still says so. Every user, every browser, and Zitadel's own log shows `POST /password` answering **200 with no redirect** — no token, no callback, nothing to see | An older `setup-zitadel.sh` turned self-registration on by writing the ORGANISATION's login policy with `POST /management/v1/policies/login`. That is Zitadel's `AddCustomLoginPolicy`: it mints a policy from the body it is handed and leaves the thirteen fields it was not handed at their proto3 defaults — which for the five `Duration` fields is **zero**. `passwordCheckLifetime: 0` means a password check is valid for no time at all, so Zitadel verifies the password, finds the verification already stale, and computes the password step again. The wrong-password path returns before the lifetime is ever consulted, which is why only the CORRECT password loops. The same custom policy shadows the instance policy wholesale, so it also hid the providers `configure_idp` had just put buttons on | Pull, then re-run `./deploy/compose/setup-zitadel.sh`. It resets the organisation to the instance default and writes the three settings on the INSTANCE policy, echoing every lifetime the instance answered with — and it refuses, naming the field, if any of them is still zero. To repair a box without a checkout: read the token with `docker compose -f deploy/compose/managed.yml run --rm -T zitadel-machinekey cat /machinekey/pat.txt`, then `curl -sS -X DELETE $JWT_ISSUER/management/v1/policies/login -H "Authorization: Bearer $PAT"` — the organisation falls back to the instance default and sign-in works again immediately. **Do not re-run an OLD `setup-zitadel.sh` afterwards**: it would mint the same policy again |
| `Seed failed: DATABASE_URL, JWT_SECRET, SECRET_ENCRYPTION_KEY are not set` | The seed runs on the host and inherits nothing; nothing in `apps/api` loads a dotenv file | The refusal names it: `./deploy/compose/seed-managed.sh`, which reads `.env` and asks compose for the published port |
| Demo owner tokens are rejected by the API | They expire after seven days | Re-run `./deploy/compose/seed-managed.sh` — it is idempotent and mints fresh ones |
| A secret in `.env` is a `change-me-…` value and was never generated | An older `ensure-env-secrets.sh` treated any non-empty value as set, so an `.env` copied from an older template kept its shipped placeholders | Re-run `./deploy/compose/ensure-env-secrets.sh` — it replaces placeholders and prints what to recreate afterwards |
| **`<project>-nextcloud` is `Up` but `(unhealthy)`**, `curl` says `Empty reply from server` in under a second, and `nextcloud.log` has written nothing for hours | PHP is SEGFAULTING on every web request. `docker compose -f deploy/compose/managed.yml logs nextcloud` shows `AH00051: child pid … exit signal Segmentation fault (11)` on a metronomic 15-second beat — the healthcheck interval — because the only request arriving is `/status.php` and every one of them kills its worker. Apache writes the access line *after* a response completes, so a crashed child logs nothing at all, which is why `nextcloud.log` looks idle rather than broken. The cause: **PHP's tracing JIT**, which the image's own `opcache-recommended.ini` enables (`opcache.jit=1255`, `jit_buffer_size=8M`). A bulk delete drove a shared bootstrap path hot, it compiled to something that faults, and every request through it afterwards died. It survives `docker restart` because the same trace recompiles | Fixed in the repo: `deploy/compose/nextcloud-php.ini` is mounted as `zz-ownpace-no-jit.ini` and turns the JIT off while leaving opcache on. Pull and force-recreate the service. **To confirm this is what you are looking at**, use the one asymmetry that identifies it: `docker compose -f deploy/compose/managed.yml exec nextcloud php /var/www/html/status.php` returns clean JSON on the CLI (where `opcache.enable_cli=Off`) while the identical file segfaults under Apache. Do NOT reach for the database, the data directory or `integrity:check-core` first — all three were ruled out before the JIT was found |
| Seed fails on `DATABASE_URL … is required` | It is running on the host and inherits nothing | Use the `demo` phase, which exports them from `.env` |
| `<project>-idp` is `Up N minutes (unhealthy)` — RUNNING, not restarting — and its log is clean right down to `server is listening` | **The container is fine and the probe is not.** The checkout predates the removal of the provider's healthcheck: that probe asked for readiness from inside the container, where nothing listens on the address it built (see the row below). A current checkout cannot produce this, because the service has no healthcheck | Pull, then `./deploy/compose/bootstrap-managed.sh --only app`, which recreates the provider without the probe and asks readiness from the host. What the old probe said is in `docker inspect <project>-idp --format '{{json .State.Health}}' \| jq`; the bring-up prints the same as its `what the HEALTHCHECK said` window for any service that has one |
| `[setup-zitadel] FATAL: it did not become healthy within five minutes`, on a run where the provider is plainly up and serving | **A second waiter, on a health signal that no longer arrives.** `setup-zitadel.sh` polled `"Health":"healthy"` from `docker compose ps`; the identity provider has no healthcheck (see the rows above), so that field is never set and the wait always runs its full five minutes | Fixed: it asks `/debug/ready` on the published port, the same address the bring-up uses. `nothing-waits-on-a-health-that-cannot-arrive.unit.test.ts` fails the build if any script waits on the health of a service that declares no healthcheck |
| The bring-up prints `the identity provider never became ready at http://localhost:3126/debug/ready` | **The readiness check is asked from the host, not from inside the container**, because `zitadel ready` builds its URL from `ExternalPort` — the address the OUTSIDE reaches Zitadel on — and nothing listens there inside. Here that is a published port; behind netbird it is 443, terminated by something that is not Zitadel | Read the code the message names. `000` means nothing answered at all — check the container is up and the port published. Any other code means Zitadel answered and said no, which is a real not-ready and its log is the next place to look. The timeout is `IDP_READY_TIMEOUT` (default 300s); a first init applies every migration from scratch and a slow disk can need longer |
| `[setup-zitadel] FATAL: could not read /machinekey/pat.txt (exit 127)` naming `"cat": executable file not found in $PATH` | **The provider's image has no shell and no coreutils.** `docker compose exec -T zitadel cat …` cannot work, and Docker reports that on STDOUT with exit 127 — so a command substitution captures the error message as if it were the file's contents. Before this refusal existed, that sentence was sent to Zitadel as a Bearer token, which answered `illegal base64 data at input byte 3` (byte 3 is the space after `OCI`) and then `Errors.Token.Invalid` | Nothing to do on a current checkout: the token is read off the VOLUME with busybox, via the `zitadel-machinekey` service that already mounts it. If you are reading the file by hand, do the same — `docker run --rm -v <project>_zitadel_machinekey:/m:ro busybox:1.38 cat /m/pat.txt` — and never `exec` into the provider's container, which has no binaries to run |
| `[setup-zitadel] FATAL: GET /auth/v1/users/me answered HTTP 401` with `Errors.Token.Invalid (AUTH-7fs1e)` | **The token and the database disagree about which instance this is.** `/machinekey/pat.txt` is written at FIRST INIT and belongs to the instance created then. Clearing the zitadel DATABASE while keeping the machinekey VOLUME leaves a token for an instance that no longer exists; clearing the volume while keeping the database leaves no token at all, since init never runs again to write one. It can equally mean the token **expired**: each one lives `ZITADEL_PAT_LIFETIME_DAYS` (7) days and `setup-zitadel.sh` rotates it inside the last `ZITADEL_PAT_ROTATE_BELOW_DAYS` (3), so an expired token is what a gate that slept past the gap wakes up to — the refusal itself says which cause is in front of you | **The database and the volume go together.** Either keep the instance — sign in at `http://localhost:3126/ui/console` as the first user, read the client id from the Ownpace project's application, and `env-upsert.sh` `JWT_ISSUER` / `JWT_AUDIENCE` (the project's id; never the issuer alone, or the API refuses to start) / `VITE_OIDC_CLIENT_ID` by hand — or start over, which destroys every account it holds: `docker compose -f deploy/compose/managed.yml rm -sf zitadel`, then `docker compose -f deploy/compose/managed.yml exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d postgres -c "DROP DATABASE IF EXISTS zitadel WITH (FORCE)"'`, then `docker volume rm <project>_zitadel_machinekey`, then re-run. The `zitadel` ROLE can stay. Both halves, every time |
| `[setup-zitadel] FATAL:` a call to the identity provider's API refused, naming an HTTP status | **Read the status, they mean different things.** `401` — the provisioning token was not accepted: it **expired** (`setup-zitadel.sh` rotates it before that on every run, so this means the gate slept past the rotation window — mint a new personal access token on the `ownpace-setup` service user in the console and write it over `/machinekey/pat.txt`), or it belongs to an instance that no longer exists, because the zitadel DATABASE was cleared while the machinekey VOLUME was kept (`/machinekey/pat.txt` is written on FIRST INIT). `403` — the token is fine and `ownpace-setup` lacks the grant the call needs, which is a role to add, not a credential to replace. Anything else prints the provider's own words | Follow the remedy the refusal names — 401 sends you to REPROVISIONING at the bottom of `setup-zitadel.sh`, 403 to the console's org roles |
| `<project>-idp` restarts for ever; the OLDEST line in the failure window is `migration failed … name=34_add_cache_schema error="ERROR: partitioned tables cannot be unlogged (SQLSTATE 0A000)"` | **The identity provider is older than the database it is pointed at.** Zitadel's cache schema created an UNLOGGED PARTITIONED table and PostgreSQL removed support for that, so setup step 34 fails on every attempt and the provider can never finish starting. Not a misconfiguration, and no setting avoids it (zitadel/zitadel#10712) | Nothing to do on a current checkout: the pinned image is above the fix (zitadel/zitadel#11484), and `zitadel-image-matches-postgres.unit.test.ts` fails the build if the two pins are ever moved into a pairing that cannot initialise. If you hit this on an older checkout, raise the Zitadel pin — do not lower Postgres — and then clear the half-written database as the row below describes |
| `<project>-idp` restarts for ever; the OLDEST line in the bring-up's failure window is `migration failed … name=03_default_instance error="open /machinekey/pat.txt: permission denied"` | **The machinekey volume is not writable by the identity provider.** Docker creates a new named volume's mount point owned by root, and the Zitadel image runs as a non-root user — which the error proves, since root could have written anywhere. `03_default_instance` creates the first human BEFORE the machine account, so a rejected admin password hides this failure until it is fixed | Nothing to do by hand on a current checkout: the bring-up reads the image's own `Config.User` and prepares the volume before starting the provider. `v4.6.2` reports a NAME (`zitadel`), not a uid — so where that happens the bring-up reads the number out of the image's own `/etc/passwd`, the same file Docker resolves the name against, via `docker create` + `docker cp` (no shell in the image is assumed, and nothing is started). It REFUSES only a name that passwd does not explain, and that refusal prints the one-line `docker run` that prepares the volume by hand. Either way the half-written database from the failed attempts still has to be cleared — see the row below |
| `<project>-idp` restarts for ever; its log ends `migration failed … name=03_default_instance` with `Errors.Instance.Domain.AlreadyExists` and `Key (instance_id, unique_type, unique_field)=(, instance_domain, localhost) already exists` | **Partial state from an earlier failed init.** `03_default_instance` registers the instance domain and THEN creates the first human. If that second half fails — a password the complexity policy rejects, say — Zitadel logs `setup failed, skipping cleanup` and means it: the domain row stays. Every retry re-runs the migration from the top, hits its own leftover row, and dies on a duplicate key that says nothing about the original cause | The `zitadel` database has to go. Nothing depends on it while init has never completed — no users, no clients, no tokens: `docker compose -f deploy/compose/managed.yml rm -sf zitadel`, then `docker compose -f deploy/compose/managed.yml exec -T postgres sh -lc 'psql -U "$POSTGRES_USER" -d postgres -c "DROP DATABASE IF EXISTS zitadel WITH (FORCE)"'`, then `docker volume rm <project>_zitadel_machinekey`, then re-run the bring-up. The `zitadel` ROLE can stay — `verify user` reuses it with the unchanged `ZITADEL_DB_PASSWORD`. **Clearing it is the second half of the fix, never the whole one.** The duplicate key is what the FIRST failure left behind; if the thing that caused that failure is still in place, the very next bring-up re-poisons the database and reports the same duplicate key. The bring-up prints a third log window, every line that reports a failure, oldest first: the OLDEST is the cause and the rest are its echoes. Fix that, then clear |
| Every authenticated request answers `HTTP 500 {"error":"auth_failed"}`, while `/api/ready` answers 200 and `docker compose ps` shows everything healthy | **The API cannot reach its own issuer, so verification never gets as far as a token.** With `ZITADEL_EXTERNALDOMAIN=localhost` the issuer is `http://localhost:3126` — an address the HOST reaches through the published port and the API container cannot, because inside that container `localhost` is the API. Discovery throws `connect ECONNREFUSED 127.0.0.1:3126`, which is not a JWT error, so it lands in `serverFault` as a 500 rather than a 401 | Nothing to do on a current checkout: the default is `ownpace-idp`, a network alias on the provider's own container, and the provider listens on the number it publishes so the origin matches from both sides. On a stack initialised under the old value the provider will refuse the new origin — see the `Instance not found` row below. A browser on the same machine needs `127.0.0.1  ownpace-idp` in `/etc/hosts`; a real deployment sets a real hostname and DNS answers for both sides |
| `[setup-zitadel] FATAL:` a call answered `HTTP 404` with `unable to set instance using origin` / `Instance not found` | **The provider does not serve the origin being presented.** Zitadel resolves which instance a request is for from the request's origin — host AND **port** — and refuses any other. **Check the port before assuming the host is wrong:** `ownpace-idp:8080` and `ownpace-idp:3126` are different origins, so a provider listening on one port and stamping another into its issuer looks like trusted domains not working | Nothing to do on a current checkout in the ordinary case: `setup-zitadel.sh` registers `ZITADEL_EXTERNALDOMAIN` as an instance **trusted domain** on every run, which is enough to make an instance answer for an origin it was not initialised with, even one initialised as `localhost` and never re-initialised. It can only do that once it can reach the instance, so if NOTHING the instance knows still resolves, the last resort is to initialise it again; the refusal prints those commands. A provisioning token cannot add an instance *domain*: `POST /admin/v1/domains` answers `404 Not Found` and the System API answers `401 Errors.Token.Invalid` |
| Sign-in fails at the very first step with `{"error":"invalid_request","error_description":"This client's redirect_uri is http and is not allowed."}` | **The application was provisioned with `devMode:false` against an `http://` WEB_URL.** Zitadel refuses a plaintext redirect URI outright, at `/oauth/v2/authorize`, before any login screen — so the sign-in button could never work, while provisioning reported complete success: project created, application created, client id written to `.env` | Nothing to do on a current checkout: `devMode` is derived from the scheme of `WEB_URL`, and `setup-zitadel.sh` RECONCILES an application it finds rather than only reading its client id, so an existing stack is put right on the next bring-up |
| Sign-in completes and then every request is refused with `Missing required claims in token payload` | **The access token carries no email address, and the API requires one.** The required claims are `sub` + `email` because invitations are addressed to an email address and a first-time signer-in has no row to look one up in. Zitadel puts user info claims in the ID token and NOT in the access token — measured with `idTokenUserinfoAssertion` both off and on | Nothing to do on a current checkout: the application is provisioned with `idTokenUserinfoAssertion` on, and `apps/web/src/services/oidc.ts` sends the ID token. Its audience is `[client id, project id]` and `JWT_AUDIENCE` is that project id, so the API validates issuer, audience, signature and expiry exactly as it would for an access token |
| The smoke says `the API cannot reach the issuer at all` on a stack whose issuer is plainly fine | **The check asked with a client the image has not got.** The API's image has no curl, no wget and no shell, so an older smoke's `docker exec … curl …` printed `curl: not found`, `\|\| true` swallowed the 127, and the empty string was reported as a verdict about the issuer. The container's own HEALTHCHECK uses `node -e "fetch(...)"` | Nothing to do on a current checkout: the smoke asks with node, by its path in the image (`/nodejs/bin/node`, or `/usr/local/bin/node` on the Node image of `v0.2.0-alpha.2` and earlier), and keeps "the probe could not run", "the issuer could not be reached" and "the issuer answered X" apart — three facts about three different things (hard rule 10) |
| The sign-in screen shows the same provider button several times — nine Google buttons after a week of re-runs | An older `configure_idp` looked for an existing provider on the deprecated `/admin/v1/idps/_search` list, which does not list the template kind it creates, so every re-run of the app phase added one more. The current one reads `/admin/v1/idps/templates/_search`, keeps the oldest, and reports duplicates by count | `./deploy/compose/setup-zitadel.sh --offer-one Google` keeps the **oldest** button (the one your first sign-ins were linked to) and takes the others off the screen by removing their login-policy links — every provider stays, and so does everyone's link to it. The console's **instance** page does the same (Default settings → Login Behaviour and Security → Identity Providers, the 'available' toggle); an organisation-page toggle is undone by the next bring-up, which resets an organisation's own login policy on purpose. The script never deletes a provider. If a Google sign-in then asks to link the account, accept once |
| The bring-up stops before the API with `N of M Docker networks lie outside the ranges the rule refuses` and `A Docker network on this machine lies outside the ranges a tester's host is refused in` | A network on this machine, this stack's or another stack's, has a subnet or a gateway outside the ranges the rule for a tester's host refuses. A host that resolves there would reach this machine through that network's gateway, and the rule would let it through | The `OUTSIDE` lines above the refusal name each network, its compose project, and the subnet or gateway outside. Set the daemon's `default-address-pools` inside `10.0.0.0/8`, `172.16.0.0/12` or `192.168.0.0/16` and recreate the network, or remove it if nothing uses it. Then `--from app` |
| `ownpace-api` restarts at start-up, and the worker's runs fail before they connect anywhere, with `OWNPACE_REACHABLE_HOSTS: "<entry>" is not a host name` | The list takes exact host names only: no wildcards, ranges, addresses or ports. A process that cannot read it stops, rather than admit more than the list says | Fix the entry in `.env`, then `docker compose -f deploy/compose/managed.yml up -d api worker` |
| On the gate's stack, the Test button says the demo Nextcloud or Stalwart is inside our network, the smoke's `test-connection` step fails, or a demo migration's pass fails with `host_inside_our_network` | `OWNPACE_REACHABLE_HOSTS` does not list the name, so the rule refuses it like any other host inside this network | On a demo box, `--from demo` adds the demo's names; or add `nextcloud,stalwart` to `.env` by hand. Then `up -d api worker`. On live, add nothing: this is the rule doing its job, and an entry admits that name for every organisation |

---

## Updating a running deployment

> **The pull that brings `WEB_BIND` into `managed.yml` moves every port to
> loopback.** On a stack whose names are routed through a
> front, set `WEB_BIND` and `ZITADEL_BIND` to the address the front connects
> to, in `.env`, **before** the pull. `STATUS_BIND` too where a status name is
> routed **or the status page is opened from a laptop over the mesh**. Each is
> an IPv4 address, never a name. **The site is
> not part of this pull**: it keeps its old publish until you set `WWW_BIND` in
> the `.env` beside `www.yml` and run `docker compose -f deploy/compose/www.yml
> up -d` from the updated checkout. See *Which address a port answers on*, under
> the ports table in *Before you start*.

**What an update rebuilds.** The api, web and worker images, from the same
`GIT_SHA`, and the three containers. There is no task bundle to deploy: until
alpha.18 the Trigger.dev plane had one, with notes here on each of its
services; an update from alpha.17 to alpha.18 removes what is left of its
containers in the `plane` phase (*Trigger.dev's plane, removed*).

**The stores' and the fronts' images move with the checkout, never with a
`docker pull`.** The database, the pooler, the demo's Nextcloud, the site's nginx and the web image's base are
pinned by exact version and digest. A move is a pull request, proven by E2E
(managed) on its branch; `up` pulls a digest the machine does not have and
recreates the service whose image changed. So the OTA stack takes it at its next
nightly gate (each database restarts once), live at the next `deploy-live.sh` of
a tag that carries it, and the OTA site only when somebody runs `docker compose
-f deploy/compose/www.yml up -d` in `~/ownpace-managed`, since nothing else
recreates it. The pin watch's summary issue says when a newer tag is listed, and
the weekly image scan counts the findings a rebuild under the same tag would
fix.

> **Nextcloud's pin moves one way on the OTA stack.** Its image upgrades the
> demo's `nextcloud_data` volume on start (`occ upgrade`), and refuses to start
> on a volume newer than itself: "Can't start Nextcloud because the version of
> the data (…) is higher than the docker image version (…) and downgrading is
> not supported". E2E (managed) on a branch runs against this same project, so
> a branch that moves Nextcloud forward leaves every nightly of `main`, and
> every other branch's E2E, red at `up_wait nextcloud` until it merges. So such
> a branch's E2E is dispatched when it is ready to merge, and it merges before
> the next 03:30 UTC nightly. A bad move is fixed forward, or, for a major,
> put back from the copies taken before it (*A Nextcloud major on the OTA
> stack*, below). The PostgreSQL databases take a minor back and forth (a
> minor never changes the storage format), but the same order keeps them from
> having to.

**The PostgreSQL database runs a build of the official image, without gosu,
as uid 70.** `postgres` runs
`localhost/postgres:<base tag>-<12 hex>`, which compose builds from
`deploy/compose/postgres/Dockerfile`: the pinned `postgres:18.7-alpine` digest
with `/usr/local/bin/gosu` removed and `USER 70:70`. gosu was the image's one
critical finding and 25 of its 26 highs (Go 1.24.6's standard library), and the
entrypoint runs it only when the container starts as root; started as uid 70,
the user gosu dropped to, it never does. What that means for you:

- **The first `up` builds it, and the database restarts once.** The bring-up's
  data phase (`up_wait postgres`) finds no image of that name and builds it,
  then recreates the container because its image changed (until alpha.18 so
  did Trigger.dev's `trigger-db`, on the same build): the OTA stack at the E2E (managed) run of the branch or
  the next nightly gate, live inside `deploy-live.sh`'s hold and drain, from the
  tag. The build pulls the pinned base when the machine does not have it (as
  `up` pulled the image before), runs one `rm`, and takes libxml2 2.13.9-r3
  from Alpine's mirror (`dl-cdn.alpinelinux.org`), Alpine's fix for
  CVE-2026-86144 (workplan 0166 T3), which the base does not carry yet. On
  `v0.2.0-alpha.4` to `v0.2.0-alpha.7` it also took four of Alpine's security
  updates from that mirror, which PostgreSQL 18.7's image, from alpha.8 to
  alpha.13, carried itself, so those releases needed no package mirror. The
  services say `pull_policy: never`, since no registry serves the name:
  `docker compose pull` passes them by, and `up` builds without asking one.
- **After that it is built again only when the Dockerfile changes**, which
  changes the name, **as long as nothing asks for a build.** `up --build`
  builds every service in its scope that has a `build:`, dependencies
  included, and api and web depend on the database; a `build` that names
  no service builds every one. From a pruned build cache that is a
  new image under the same name, and the next `up` that reaches a database
  recreates it; live and the OTA stack share one Docker daemon, and this name
  while their Dockerfiles' instructions agree, so one stack's rebuild makes
  the other's next such `up` restart its database, outside any hold. (A stack
  on another Dockerfile has another name: the OTA stack's build of `main`'s
  never becomes the image live runs.) So the bring-up
  builds `api web worker` by name and runs `up` without `--build`, every command in
  this document does the same, and so should yours:
  `docker compose -f deploy/compose/managed.yml build web`, then
  `up -d web`. `scripts/a-database-started-as-root.unit.test.ts` refuses a
  script or document that says otherwise.
- **The data stays where it is, and is already uid 70's.** The root entrypoint
  chowned every file in PGDATA to uid 70 on every start, so the volumes need
  nothing. To see it before the deploy, on the old containers (their `exec` is
  root's), each of these prints nothing:
  `docker compose -f deploy/compose/managed.yml exec -T postgres find /var/lib/postgresql/18/docker ! -user postgres`.
  A new volume takes the image's
  `/var/lib/postgresql`, uid 70's and mode 1777, and initialises as uid 70.
  The base is the same Alpine and musl, so the databases' collation is
  untouched.
- **An exec into the `postgres` service runs as uid 70, not
  root.** Every command this repository runs there is `psql -U <role>`,
  `pg_dump`, `pg_dumpall` or `pg_restore`, over the socket the image's
  `pg_hba.conf` trusts, and answers the same: `copy-before-update.sh`,
  `dump-idp.sh` (its restore drill too), `db-roles.sh` and
  `rotate-db-passwords.sh`, the bring-up, `deploy-live.sh`, the smoke and the
  rows of this document. The container keeps no capability
  (*How the containers run*), so `-u 0` alone is root without root's powers:
  a repair that needs them is `exec --privileged -u 0`. An interactive `psql` or shell keeps its history in the
  container's `/tmp`, as root's was kept in `/root`, never on the data volume
  (uid 70's home).
- **The network questions ask with the build.** `db-roles.sh` and
  `stand-up-live.sh` ask with managed.yml's first postgres image, the build
  the stack's own `up` made. A checkout pulled ahead of its stack, before
  any `up`, has no such image yet: the question then ends in docker's own
  error, which reads as "cannot tell", never as a verdict. Run the bring-up
  first.
- **Rolling back to a tag before this runs the official image again, as
  root.** Its entrypoint finds the volumes uid 70's, as it left them, and
  starts on PostgreSQL 18.6, which reads what 18.7 wrote: a minor never
  changes the data format.
- **Two failures, and what they mean.** A container that exits with
  `exec: gosu: not found` was started as root (a `user:` or `-u 0` on the
  service itself): remove it. One that exits with
  `mkdir: can't create directory '/var/lib/postgresql/18/': Permission denied`
  has a bind mount of a host directory instead of the named volume: the stacks
  here use named volumes only.
- **Moving the pin** is the Dockerfile's FROM, by tag and digest, and the
  two `image:` lines that name the build (`managed.yml` and `dev.yml`),
  whose last twelve hex digits are
  `grep -Ev '^[[:space:]]*(#|$)' deploy/compose/postgres/Dockerfile | sha256sum | cut -c1-12`
  (the SHA-256 of its instruction lines; a comment moves no name). Dependabot
  opens the pull request that moves the FROM (its own entry in
  `.github/dependabot.yml`, never a major), and that pull request fails
  `scripts/a-database-started-as-root.unit.test.ts` until the two lines
  move too: the failure lists them and prints the `sed` that moves them, to
  run on the pull request's branch and push. Its E2E (managed) is then
  dispatched like any pin's. Nothing outside those instruction lines may
  change what is built, so the same guard refuses a parser directive, a COPY,
  ADD or `--mount`, and a `build:` with args or a target. The integration
  tests start the same FROM. The pin watch reports a newer tag of the FROM,
  and the weekly image scan builds the Dockerfile and scans what it built.
  Before it merges, read the new minor's release notes for REINDEX advice
  against the indexes the database holds: 18.7's named none of its.

The appliance (`deploy/selfhost/compose.yml`) runs a build of its own,
`deploy/selfhost/postgres/Dockerfile`: these
instructions on the appliance's own base digest, which its own Dependabot
entry moves. The guard holds the two Dockerfiles to the same instructions but
for the FROM, so a change to `deploy/compose/postgres/Dockerfile` is made to
both, and moves both names. While the two FROMs differ, the two names do too.
When they meet, so do the names: E2E (self-hosted), which runs on this
machine's Docker, then starts the appliance on the image the stacks built, or
the stacks on the one it built, which is the same content. That is one more
reason nothing asks for a build of a name the machine has: E2E (self-hosted)
builds its `app` by name and runs `up` without `--build`. What the change
means for an appliance's own data, a bind mount of a host directory included,
is in [selfhost-quickstart.md](./selfhost-quickstart.md).

Until alpha.18 three more of the plane's services were builds here too, Trigger.dev's
socket proxy, its dashboard's TLS front and its Redis, on the same rules;
they went with the plane (workplan 0167 T9).

**The pooler is a build here too, until upstream rebuilds its image**, from
`v0.2.0-alpha.8`. `pgbouncer` runs
`localhost/pgbouncer:<base tag>-<12 hex>`, which compose builds from
`deploy/compose/pgbouncer`: `edoburu/pgbouncer:v1.26.1-p0` at the digest its
Dockerfile pins, with five Alpine packages at the versions that carry their
fixes: libpq and postgresql18-client 18.7-r0, musl and musl-utils 1.2.6-r3,
and zlib 1.4-r0. As pulled, the image held 79 high findings in those five (the
image scan of 2026-11-13), and upstream had not rebuilt it since 2026-10-19.
PgBouncer itself, its `pgbouncer.ini`, its userlist, its user (uid 70), its
entrypoint and its healthcheck are as they were.

- **The first `up` builds it, and the pooler restarts once.** The bring-up's
  data phase finds no image of that name at its first `up` of the pooler (the
  forced recreate after a replaced `postgres`, else `up_wait pgbouncer`) and
  builds it, pulling the pinned base from Docker Hub when the machine does not
  have it and the five packages from Alpine's mirror
  (`dl-cdn.alpinelinux.org`), then recreates `pgbouncer` because its image
  changed: the OTA stack at the E2E (managed) run of the branch or the next
  nightly gate, live inside `deploy-live.sh`'s hold and drain, from the tag.
  Every client connection drops for the seconds of the restart, and the app's
  pools open new ones. A deploy that also replaces `postgres` recreates the
  pooler anyway (the data phase, a pooler that outlived its database), so on
  such a deploy this adds no restart. `pull_policy: never`, as for the
  databases.
- **When the build cannot take the packages.** Alpine keeps only its newest
  build of a package in a stable branch. Once it moves one of the five again,
  a machine that does not have the image cannot build it: `up` stops at the
  build, before it recreates the pooler, with the Dockerfile's own message
  (*the mirror no longer serves those versions*). On a deploy that also
  replaces `postgres`, the database has been replaced by then (the data phase
  brings `postgres` up first), so that deploy did not take. A machine that has
  the image is not touched, and live and the OTA stack share one Docker
  daemon, so the name the OTA stack built is there for live's deploy of the
  same Dockerfile. So neither stack is where it shows first. That is where the
  image is built afresh: the weekly image scan's `pgbouncer` leg (Mondays at
  06:00 UTC, on `main`), which then has nothing to scan, leaves no report and
  fails its run, and `build (pgbouncer, amd64)` and `build (pgbouncer, arm64)`
  on a pull request that touches `deploy/`. The remedy is a pull request that
  moves the version the Dockerfile names, or takes the build out.
- **Moving it, and taking it out.** Upstream's next image comes one of two
  ways. A newer PgBouncer, tagged `v<x.y.z>-p0`, or the pinned tag under a new
  digest is Dependabot's pull request (the directory's own entry, never a
  major). A rebuild of the same PgBouncer is tagged `-p<n+1>`, as `v1.24.1-p1`
  and `v1.23.1-p1` to `-p3` were, and Dependabot opens no pull request for it:
  it proposes only tags that end as the pinned one does, `-p0`. Only the pin
  watch's summary issue lists that tag, and says it is moved by hand, in a
  pull request of its own that moves the Dockerfile's FROM by tag and digest.
  Either build stops where the new base already carries one of the five, and
  names it: take that package out of the Dockerfile's RUN, and out of `PINS`
  in the guard, which otherwise asks for it back. Once the RUN names none,
  `pgbouncer` goes back to `edoburu/pgbouncer:<tag>@<digest>` in
  `managed.yml`, and the Dockerfile, its job, its Dependabot entry and its
  guard go (the Dockerfile's header, THE WAY OUT). Until then
  `scripts/a-rebuild-upstream-has-not-made.unit.test.ts` prints the `sed`
  that moves `managed.yml`'s image line when an instruction changed;
  `build (pgbouncer, amd64)` and `build (pgbouncer, arm64)` (`images.yml`)
  build it, hold its configuration to upstream's, start it as `managed.yml`
  does and ask it with the healthcheck's command; and its E2E (managed) is
  dispatched like any pin's.
- **Rolling back to a tag before this runs upstream's image again**,
  `edoburu/pgbouncer:v1.26.1-p0`; `up` pulls it when the machine no longer has
  it.

### A Nextcloud major on the OTA stack

On this stack a move of Nextcloud's pin is one way, a patch as much as a
major. Only the OTA stack's demo has a Nextcloud whose data lasts. Live has none (both live scripts refuse
`--with-demo`), the self-host E2E removes `dev.yml`'s container before every
run and installs afresh, and the integration tests start a new one each time.
A developer's `dev.yml` keeps the image's anonymous volume, so its next `up`
upgrades that one too.

**What moves, and when.** The demo keeps its state in two places that move
together: the `nextcloud_data` volume (the code, `config.php` and the files)
and the `nextcloud` database in this stack's Postgres (workplan 0150). The
first start of a newer image copies its code into the volume and runs
`occ upgrade` against the database before Apache starts (the entrypoint
compares the whole version), and the older image refuses the volume from then
on. One major at a time: 35 upgrades from 34 and nothing older. On this stack that first start is **E2E (managed) on
the branch that moves the pin**: the gate brings the branch's `managed.yml` up
in this project (`bootstrap-managed.sh --from data --with-demo`, then
`up_wait nextcloud`), so that run is the upgrade, not a test before it. Every
nightly of `main`, and every other branch's E2E, is red at `up_wait nextcloud`
from then until the branch merges. The blocks below were written for 34 to 35;
a patch takes them with the version it leaves in place of 34: for 35.0.2 to
35.0.3, the copies `${project}_nextcloud_data_35_0_2`,
`~/nextcloud-35.0.2.dump` and `~/nextcloud-35.0.2-apps.txt`, and *Back to 34*
goes back to 35.0.2.

**The apps it upgrades.** The repository enables none: the demo uses apps that
ship with Nextcloud and are on by default (dav, files, files_sharing,
sharebymail, provisioning_api), and 35 ships and enables every one of them.
The app store is left on here, though, so an app somebody installed by hand
(calendar, contacts, tasks and deck do not ship with the server) is the
upgrade's to keep: it takes a release for 35 from the app store, or disables
the app, and the entrypoint prints it under "The following apps have been
disabled:". So the list of those apps is taken before the run and read again
after it.

**In this order.**

1. The owner's OK.
2. Not before the release tag the move is not part of, and never between two
   counted nights: once the volume is on 35, `main`'s nightly cannot start the
   demo until the branch has merged.
3. Pause the migrations that write into the demo Nextcloud, a few minutes
   before the way back below is taken, with the list of the apps that do not
   ship with it. Without the way back, the only way back is a fresh demo. A
   pass stops starting new items within `PASS_REREAD_EVERY_MS` (15 s) of a
   Pause but finishes the ones it has begun, and a large upload can take
   longer. Keep them paused until the branch has merged: once they write
   again, going back to 34 throws away what they wrote since the copies, while
   the app still counts those items as copied, so they are not copied again.
4. Dispatch E2E (managed) on the branch when it is otherwise ready to merge,
   and merge before the next nightly is created. Its schedule is 03:30 UTC,
   and GitHub has often started it hours late, but that delay is not to be
   counted on; a nightly created before the merge keeps the commit `main` had
   then, even when it starts after the merge.
5. Ask whether it took. A healthy container does not say so: `status.php`
   answers 200 in maintenance mode and with an upgrade still owed. The
   bring-up asks `occ status` after `up_wait nextcloud` and stops on either
   (its log says `nextcloud healthy (demo DAV backend): 35.0.3, out of
   maintenance, no upgrade owed` when neither), and these say it again, with
   the apps:

   ```bash
   cd ~/ownpace-managed
   docker compose -f deploy/compose/managed.yml exec -u www-data nextcloud php occ status --output=json
   docker compose -f deploy/compose/managed.yml logs nextcloud | grep -A 20 'The following apps have been disabled'
   docker compose -f deploy/compose/managed.yml exec -T -u www-data nextcloud php occ app:list --shipped=false \
     | diff ~/nextcloud-34-apps.txt -
   ```

   It took when the first says `"versionstring":"35.0.3"`, `"maintenance":false`
   and `"needsDbUpgrade":false`, the log names no app, and the list differs
   only in versions. An app gone from `Enabled:` was disabled: take its
   release for 35 from the app store, or do without it.

**The way back, taken before the run.** A copy of the volume beside it and a
dump of the database, with the demo stopped so that the two agree, and the
list of the apps that do not ship with Nextcloud, taken while it still runs.
The dump holds the demo accounts' password hashes, so it is the owner's alone.
Each block below runs as one: it stops at the first command that fails, so a
project it could not read never reaches the database.

The volume holds the files the owner's migrations wrote, so first check the
disk has room for a second copy (this changes nothing):

```bash
cd ~/ownpace-managed && (
  set -eu
  project="$(docker compose -f deploy/compose/managed.yml config --no-interpolate | sed -n 's/^name: //p')"
  : "${project:?the compose project could not be read}"
  docker run --rm -v "${project}_nextcloud_data":/v:ro busybox:1.38 du -sh /v   # the size of one copy
  df -h "$(docker info -f '{{.DockerRootDir}}')" ~                               # Docker's data root, then the home the dump goes to
)
```

There is room when Docker's data root keeps more than live's disk floor after
one more copy, with a few GB to spare: live runs on the same disk, and
`box-checks.sh` mails "Disk below the floor" under `ALERT_DISK_FREE_GB` in
live's `.env` (15 GB without it). The run then pulls Nextcloud 35 and builds
the api and web images there, and its bring-up runs `--from data`, so
preflight's own disk check does not run. The home needs room for the dump.
Where either falls short, free space first, and prune nothing of live's.

Then the copies. The block does nothing when a copy from an earlier try is
still there, and its last line says it is done:

```bash
cd ~/ownpace-managed && (
  set -eu
  project="$(docker compose -f deploy/compose/managed.yml config --no-interpolate | sed -n 's/^name: //p')"
  : "${project:?the compose project could not be read}"
  if docker volume inspect "${project}_nextcloud_data_34" >/dev/null 2>&1 || [ -e ~/nextcloud-34.dump ]; then
    echo "STOP: a copy from an earlier try is still there" >&2; exit 1
  fi
  umask 077
  docker compose -f deploy/compose/managed.yml exec -T -u www-data nextcloud php occ app:list --shipped=false \
    > ~/nextcloud-34-apps.txt
  docker compose -f deploy/compose/managed.yml stop nextcloud
  docker volume create "${project}_nextcloud_data_34"
  docker run --rm -v "${project}_nextcloud_data":/from:ro -v "${project}_nextcloud_data_34":/to \
    busybox:1.38 sh -c 'cd /from && cp -a . /to'
  docker compose -f deploy/compose/managed.yml exec -T postgres \
    sh -c 'pg_dump -U "$POSTGRES_USER" -Fc nextcloud' > ~/nextcloud-34.dump
  echo "the way back is taken"
)
ls -la ~/nextcloud-34.dump ~/nextcloud-34-apps.txt
```

It is taken when the block's last line is `the way back is taken` and both
files are `-rw-------`, the dump not empty. Only then is the run dispatched.

If the block stops before that line (an error, or `STOP`), it is not run again
as it is: a second run can empty `~/nextcloud-34-apps.txt` and then fail,
because Nextcloud is stopped. A `pg_dump` that died partway has also left a
dump that is not empty. While the demo is still on 34, this puts it back as it
was; then the cause is put right (for a full disk, space freed and the room
checked again) and the copies are taken again. After the run has started, a
`STOP` means the copies are there, and they are the way back: leave them.

```bash
cd ~/ownpace-managed && (
  set -eu
  project="$(docker compose -f deploy/compose/managed.yml config --no-interpolate | sed -n 's/^name: //p')"
  : "${project:?the compose project could not be read}"
  if docker volume inspect "${project}_nextcloud_data_34" >/dev/null 2>&1; then
    docker volume rm "${project}_nextcloud_data_34"
  fi
  rm -f ~/nextcloud-34.dump ~/nextcloud-34-apps.txt
  docker compose -f deploy/compose/managed.yml start nextcloud
  docker compose -f deploy/compose/managed.yml ps nextcloud
)
```

**When the run goes wrong.**

- **`up_wait nextcloud` gave up while the log still shows the upgrade.** The
  healthcheck allows about five and a half minutes (a 180 s start period, then
  ten checks 15 s apart), and the upgrade carries on in the container after
  the wait has given up. When `docker compose -f deploy/compose/managed.yml
  logs nextcloud` says `Initializing finished`, dispatch the run again.
- **`occ upgrade` failed.** The entrypoint stops, the container restarts, and
  since the volume already holds 35's code it does not try again: Nextcloud
  answers in maintenance mode ("Maintenance mode is kept active"), and the
  bring-up stops after `up_wait nextcloud` saying so. Read the log and put the
  cause right. Then turn maintenance mode off **first**: Nextcloud's updater
  turns it off after a good upgrade only when it was off as that upgrade
  started, so with it on a good `occ upgrade` leaves the demo in maintenance
  mode, and when nothing is owed any more `occ upgrade` does not run at all
  ("Nextcloud is in maintenance mode … call this script again", exit 2;
  `lib/private/Updater.php` and `core/Command/Upgrade.php` at `v35.0.2`). The
  upgrade then turns it on and off itself, and `occ status` says whether it
  took:

  ```bash
  cd ~/ownpace-managed
  docker compose -f deploy/compose/managed.yml exec -u www-data nextcloud php occ maintenance:mode --off
  docker compose -f deploy/compose/managed.yml exec -u www-data nextcloud php occ upgrade
  docker compose -f deploy/compose/managed.yml exec -u www-data nextcloud php occ status --output=json
  ```

  When the last says `"maintenance":false` and `"needsDbUpgrade":false`,
  dispatch the run again.

- **Back to 34**, when the branch is not going to merge. Both copies,
  together: a 34 volume over a 35 database, or the reverse, does not start.
  Then `main`'s next nightly, or `bootstrap-managed.sh --from data
  --with-demo` from `main`, starts `main`'s 34 on them: 34.0.5 by digest
  (#1678), the 34 the OTA demo ran when they were taken.

  ```bash
  cd ~/ownpace-managed && (
    set -eu
    project="$(docker compose -f deploy/compose/managed.yml config --no-interpolate | sed -n 's/^name: //p')"
    : "${project:?the compose project could not be read}"
    docker volume inspect "${project}_nextcloud_data_34" >/dev/null
    [ -s ~/nextcloud-34.dump ]
    docker compose -f deploy/compose/managed.yml rm -sf nextcloud
    docker volume rm "${project}_nextcloud_data"
    docker volume create "${project}_nextcloud_data"
    docker run --rm -v "${project}_nextcloud_data_34":/from:ro -v "${project}_nextcloud_data":/to \
      busybox:1.38 sh -c 'cd /from && cp -a . /to'
    docker compose -f deploy/compose/managed.yml exec -T postgres \
      sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --create' < ~/nextcloud-34.dump
  )
  ```

- **No copies: a fresh demo Nextcloud.** Remove its container and volume and
  drop its database; the next bring-up with `--with-demo` (the nightly does
  one) installs whichever major its checkout pins, gives the role `.env`'s
  `NEXTCLOUD_DB_PASSWORD` since nothing is installed, and its `demo` phase
  makes the four demo accounts and seeds their content again
  (`setup-managed-demo.sh`). Everything else in it is lost: the files,
  calendars and contacts the owner's own migrations wrote there, and any app
  installed by hand.

  ```bash
  cd ~/ownpace-managed && (
    set -eu
    project="$(docker compose -f deploy/compose/managed.yml config --no-interpolate | sed -n 's/^name: //p')"
    : "${project:?the compose project could not be read}"
    docker compose -f deploy/compose/managed.yml rm -sf nextcloud
    docker volume rm "${project}_nextcloud_data"
    docker compose -f deploy/compose/managed.yml exec -T postgres \
      sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "DROP DATABASE IF EXISTS nextcloud"'
  )
  ```

Once the move has held for a night or two, remove the copies:

```bash
cd ~/ownpace-managed && (
  set -eu
  project="$(docker compose -f deploy/compose/managed.yml config --no-interpolate | sed -n 's/^name: //p')"
  : "${project:?the compose project could not be read}"
  docker volume rm "${project}_nextcloud_data_34"
  rm ~/nextcloud-34.dump ~/nextcloud-34-apps.txt
)
```

### `ownpace-live`: a release tag, with `deploy-live.sh`

**The first time is not this:** *Standing up ownpace-live*, above, with
`stand-up-live.sh`. **On `ownpace-live`, the stack testers use, the pull under
*The OTA stack* below is never run, and `git pull` never is.** Live runs a release tag and nothing
else, so the build a tester sees, a problem
report's build line, the deploy log and the GitHub release all name the same
thing. One script moves it:

1. **Name the tag.** An annotated `v*` tag on origin, cut as
   [release.md](./release.md) §2 says: by the Release workflow, which refuses a
   commit the nightly gate has not run green on the OTA stack, and checks what
   the tag published. Record the tag, its
   commit, and the Release run its message names. A tag pushed by hand is the
   break-glass path, and the deploy log says why.
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
4. From `~/ownpace-live`, **inside `tmux` (or `screen`)**:

   ```bash
   tmux new -s deploy                         # after a drop: tmux attach -t deploy
   ./deploy/compose/deploy-live.sh <tag>
   ```

   Always so from a phone, or over any connection that may drop. A dropped
   connection hangs up the shell, and the
   script with it, wherever it is; and a deploy whose identity-provider pin
   moves is one-way (step 3), so a run stopped halfway has the copy as its way
   back. Inside `tmux` the run goes on, and `tmux attach -t deploy` shows it.

   Right before its checkout it takes **the copy before the update**, into
   `~/.persistent/ownpace-live/copy-before-update`: the app's database, the
   sign-in service's database and the roles, each read back. (Until alpha.18
   it also took Trigger.dev's database when the tag moved its pin;
   `copy-before-update.sh take --trigger` is refused since.) A
   copy whose update is not proven yet (a deploy that did not take, run
   again) is kept instead, since it is of what ran before. No copy, no deploy:
   without the daily duties' timer active, or with a kept copy the next daily
   run deletes, it refuses before anything moves. A tag without
   `deploy-live.sh`, `exposure-check.sh`, `box-duties.sh`, `stack-kind.sh` and
   `copy-before-update.sh` is refused too, as `stand-up-live.sh` refuses it: live
   would lose its daily duties and the copy's backstop.
5. **Read what it printed, then lift the hold yourself.** Lifting it is your
   last look: the first pass that succeeds after it proves the update, and an
   hour later the copy goes (step 6). The tick's next summary shows passes
   started. To see one now, start one pass on a small migration of your own,
   as *Sync now* starts it, and follow it for up to 15 minutes. From
   `~/ownpace-live`:

   ```bash
   ./deploy/compose/live-pass-check.sh
   ```

   It refuses while a hold is on, while the passes in flight are at the tick's
   caps (`MAX_PASSES_IN_FLIGHT`, `MAX_PASSES_PER_ORGANISATION`) or that
   migration has one running, and a migration that is not running, selects no
   data type, or is not in an organisation where a platform operator is an
   active owner. It writes no row and cancels nothing: Ctrl-C stops the
   watching, and the pass goes on. Its last line says how it ended, and so
   does its exit: 0 `succeeded`, every data type the migration selects
   finished in that pass; 1 `failed` after its retries, or `cancelled`; 2
   `refused, nothing was started`; 3 `refused, the hold is on`;
   4 `refused, capacity is full`; 5 `timed out`, and the pass goes on;
   6 `ended unfinished`; 7 `could not tell`. The migration is the one
   `LIVE_PASS_CHECK_MIGRATION` in live's `.env` names, by its id (the last
   part of its page's address, `/mappings/<id>`). Name it once:

   ```bash
   ./deploy/compose/env-upsert.sh deploy/compose/.env LIVE_PASS_CHECK_MIGRATION=<the migration's id>
   ```

6. **The copy goes by itself once the update is proven.** Every ten minutes
   live's box checks run `copy-before-update.sh delete-if-proven`. It keeps
   `delete`'s rule: the last line `deploys.log` has since
   the copy was taken says the deploy took (one that did not take after it
   leaves nothing proven), the hold that covered it is lifted, and a pass that
   started after it succeeded, each read from live's database. And it is
   stricter: no hold is on at all, live's checkout is at the commit that took,
   a data type of a proving pass's migration completed at or after that pass
   began, the hold was last lifted (or the deploy took, if that is later) at
   least an hour ago, and nothing in the copy's directory is outside its note
   (a dump made by hand after it, or a rollback's since file, keeps the whole
   copy for you). It then deletes the copy as `delete` does, and the box
   checks mail *Update proven* once (*Who is told*, above). Starting the hold
   again within that hour keeps the copy. To keep every copy until you delete
   it yourself, set `COPY_DELETE_WHEN_PROVEN=false` in live's `.env`, with
   `env-upsert.sh` as in step 5. Or delete it yourself now, by `delete`'s rule
   alone, from `~/ownpace-live`:

   ```bash
   ./deploy/compose/copy-before-update.sh delete
   ```

   **Not proven by day 6: roll back from the copy that day** (the operator
   runbook's *The copy before an update*, which starts with
   `copy-before-update.sh since`, so that what testers erased or deleted after
   the copy is erased and deleted again). The daily duties delete it once it
   is older than six days less an hour whatever happens, and fail the day
   before to remind you.

#### The deploy from alpha.2 to alpha.3 runs twice

*History: it applies only to a deploy started from a checkout of
`v0.2.0-alpha.2` or earlier, which ran Trigger.dev; its Trigger.dev steps are
no longer written out here (workplan 0167 T9).*

`v0.2.0-alpha.3` carries both the readers, which read the api container's
variables from Docker, and the distroless API image, which has no shell and no
`printenv`. `deploy-live.sh` runs the copy the checkout had before it moved to
the tag. So a deploy of `v0.2.0-alpha.3`, or a later tag, started from a
checkout of `v0.2.0-alpha.2` or an earlier tag (`git describe --tags` in
`~/ownpace-live` names it) runs that older script, and it asks the api
container its `NODE_ENV` by running `printenv` in it. Every other check
answers, `/api/version` and `/version.json` naming the new tag's commit and
version: the stack has moved. Then it prints these, its last lines, and exits
3 (`<home>` is your home directory, written out):

```text
[deploy-live] the deploy did not take: v0.2.0-alpha.3 is checked out, and
    NODE_ENV: the api container could not be asked (docker compose exec -T api printenv NODE_ENV).
[deploy-live] The hold stays on. Nothing was lifted. Fix the cause and run this again with v0.2.0-alpha.3, or name another tag; the next deploy is compared with v0.2.0-alpha.3 too.
[deploy-live] The copy before this update is kept (copy-before-update.sh): it is of what ran before, and the next deploy keeps it too, until its last day, when only the rollback, a deploy of the release it holds, may go. Not proven by day 6: roll back from it (docs/operator-runbook.md, The copy before an update, which starts with copy-before-update.sh since).
[deploy-live] Logged as did-not-take in <home>/.persistent/ownpace-live/deploys.log.
```

Start the first run with plain progress, from `~/ownpace-live`:
`COMPOSE_PROGRESS=plain ./deploy/compose/deploy-live.sh v0.2.0-alpha.3`.
alpha.2's script does not ask compose for it, and a compose step can then
wait without end (`docs/operator-runbook.md`, *Upgrade*, item 6); the
second run is the tag's own script, which does.

That run is expected, and it rolled nothing back: the checkout is at the tag
and the stack runs it, the hold is still on, the copy before the update is
kept, and `deploys.log` has a `did-not-take` line for the tag. When that
`NODE_ENV` line is the only one under *the deploy did not take*, run it a
second time, from `~/ownpace-live`, the hold still on, naming the tag the first
run named:

```bash
git status --short                          # apps/worker/package.json, if anything: the task deploy strips its last newline
git checkout -- apps/worker/package.json    # the second run refuses a tree that is not clean
./deploy/compose/deploy-live.sh <tag>       # the same tag the first run named: v0.2.0-alpha.3 for the alpha.2 to alpha.3 deploy
```

The checkout is at the tag now, so the tag's own script runs, and it reads
`NODE_ENV` from Docker. It keeps the copy the first run took (*a copy is here
already … It is the copy of what ran before, so it is kept, and no second copy
is taken*), runs the bring-up again over a stack already at the tag, and says
`NODE_ENV in the api container: production` and `the deploy took:
v0.2.0-alpha.3 (<commit>) runs, and answered every check.`, then what it says
after every deploy that took, and exits 0, with a `took` line in
`deploys.log`. Then, before step 5 starts a pass, keep the copy:

```bash
./deploy/compose/env-upsert.sh deploy/compose/.env COPY_DELETE_WHEN_PROVEN=false
```

Without it the box checks delete the copy once a pass proves the update and
the hold has been lifted for an hour (*The copy goes by itself once the update
is proven*, above), and it is
live's only quick way back from the builds. Delete it by
hand with `./deploy/compose/copy-before-update.sh delete` once the jobs have
run real work for a few days, then set the key back (`true`, or remove the
line) before the next deploy: a proven copy that is kept makes the next take
refuse. Then step 5 as usual. With any other line under
*the deploy did not take*, the first run failed for that reason too: *If a
check fails*, below.

The same holds for any tag from `v0.2.0-alpha.3` on deployed from a checkout of
`v0.2.0-alpha.2` or earlier (`ending-the-alpha.md` step 5 allows a newer
release), and for the first deploy forward after live was rolled back to one. A
deploy started from a checkout of `v0.2.0-alpha.3` or later runs once, to any
tag, older ones included.

What `deploy-live.sh` does, in order. It refuses, before the checkout or the
stack changes, each with its own message: `--with-demo`; a `.env` without live's
marker (`STACK_KIND=production`, `stack-kind.sh`); a `.env` whose `WEB_URL`,
`API_URL` or `CORS_ORIGIN` is not set, not `https://`, or localhost or a
loopback address, or whose `API_URL` or `CORS_ORIGIN` is not the origin in
`WEB_URL` with nothing after it (from outside, live's API is reached at the
app's origin alone, and it builds every consent's redirect from `API_URL`:
§8e, step 4), named with the line that sets them, `app.example.eu` standing
for live's name (first asked by the deploy after the one that moves live onto
a release that carries it, since a deploy runs the script the checkout had
before it moved); a
`.env` whose `NODE_ENV` is not `production` or whose `ALERT_ENABLED` is not
exactly `true` (testers are on live, so nobody deploys it without alerts), or
that sets a sign-in provider's `IDP_*` key (live's sign-in page offers email and
password only: privacy §4.4, §7 and §8), or whose `OWNPACE_REACHABLE_HOSTS`
names a host (live's list stays empty, whatever the stage), or that sets
`MOLLIE_API_KEY` while its `OWNPACE_STAGE` is `alpha` (nothing is charged during
the Alpha, and live keeps the key empty until it ends; it goes in with the
switch, [ending-the-alpha.md](./ending-the-alpha.md) step 4),
those three read as Compose hands them to the app (`KEY=""` is empty,
`OWNPACE_STAGE="Alpha"` is the Alpha), all named at once, by key, before the
fetch and any docker call, with any line that sets a key in a form the script
does not read and the bring-up does (indented, a space before `=`, or `:`), by
line and key, as the stand-up refuses it;
`COMPOSE_ENV_FILES` or `COMPOSE_FILE` in the shell, or a project
`docker compose config` reports that is not the one the checkout chooses; a
working tree that is not clean; a ref that is not a tag, a tag not on origin, a
lightweight tag, a tag not named `v…`, and a tag whose commit's root
`package.json` version is not the tag without its `v` (it names both, and says
*"live runs releases: name a release tag"*); a tag without the five scripts
live is deployed, checked and kept by (`release-tag.sh`'s list); a `node` on
the shell's `PATH` below what the tag's `package.json` asks for (`engines.node`,
read from the tag after the fetch), no `node` at all, one whose `node -v` fails,
or an `engines.node` it cannot read (*The Node in the shell you deploy from*,
below; from the deploy after alpha.4, since the deploy runs the script the
checkout had before it moved); a database it
cannot read; no open hold; a pass still in flight; a hold less than five minutes old, since a pass
queued just before it is in no count until it starts; a deploy log it cannot
append to; and a copy before the update that `copy-before-update.sh take`
could not take or refused. Then it runs `git fetch --tags origin` and
`git checkout --detach <tag>`, `pnpm install --frozen-lockfile`, and
`bootstrap-managed.sh --from data`, never with `--with-demo`; the bring-up
builds the images with the tag's commit as `GIT_SHA`. Then the checks, at the
origin in `WEB_URL`: `/api/version` names the tag's commit **and** its version,
and so does `/version.json`, the web app's own build (a web image that did not
move beside the API is a deploy that did not take), the app's page `/` carries the policy, HSTS and
the three beside them once each, as the tag's `apps/web/nginx.conf.template`
states them with live's `VITE_OIDC_ISSUER` (on live this is the answer through
NetBird's proxy, over TLS, as a tester's browser gets it;
`scripts/app-headers.mjs` reads the template, and for a tag cut before it, a
way back to alpha.6, the copy of the release the deploy started from does; the
first deploy that checks it is one started from alpha.7, since a deploy runs
the script the checkout had before it moved), `/api/ready` answers 200,
`/api/auth/mode` answers `managed`,
`NODE_ENV` is `production` in the api container (read from Docker, the
container's `.Config.Env` through `docker container inspect`, which answers for
the Node image and for the distroless one, which has no shell or `printenv` to
ask), and
`exposure-check.sh` passes. With `WWW_LIVE=true` in live's
`.env` it also builds and serves `www.ownpace.eu` from the tag, before the
exposure check, and refuses what would stop that before anything moves
(*`www.ownpace.eu`: live's copy*, under *The public site*); without it, nothing
about the site runs. **Keep it `false` until the legal texts are final:** with
texts that are not, a deploy with it `true` refuses before the checkout, and the
app does not move either.

**The exposure check needs two things before live's first deploy.** The check
reads the whole machine: set `EXPOSURE_ALLOW` in
live's `.env` to every address any container on it is published on on purpose
(*Checking every publish on the machine at once*, under *Which address a port
answers on*), or it fails for each of them; where the machine runs containers
that are not Ownpace's and publish beyond loopback, set `EXPOSURE_NOT_OURS` to
their names too (*Containers on the machine that are not Ownpace's*, same
section). And the tag must be cut from a commit that has
`deploy/compose/exposure-check.sh`; the script runs the tag's own copy, and
refuses a tag without one before anything moves.

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
run it again with the same tag, or name another. One such run is expected: the
deploy from `v0.2.0-alpha.2` or earlier to `v0.2.0-alpha.3` or later (*The
deploy from alpha.2 to alpha.3 runs twice*, above).

**One-way or reversible.** Before the checkout moves, and again at the end, the
script says whether the deploy can be undone by deploying a tag this stack has
run again. It compares the new tag with the running tag, the one the last deploy
that took put there (read from the deploy log); with every deploy since that did
not take, since its bring-up may have run and its API migrates when it starts;
and with the checkout's `HEAD` when no line names it. It is **one-way** when,
against any of them, a file in either migration chain
(`packages/ledger/migrations`, `packages/managed/migrations`) was added, changed
or removed, or the identity-provider image pin in `managed.yml`
moved: the API refuses an older build on a migrated schema, and the provider
migrates its own schema one way. (Until alpha.18 a move of the Trigger.dev pin
was one-way too; a pair of releases where only one has the plane compares no
Trigger.dev pin and says so in a note.) Otherwise it is **reversible**. So going back
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
the owner accepting fewer green gate runs than the rule asks, is added to that
file by hand.

It has made every deploy of live from a tag; its guard,
`scripts/a-deploy-from-a-named-tag.unit.test.ts`, runs it against stubs.

#### The Node in the shell you deploy from

From `v0.2.0-alpha.4` on, the repository is on Node 26: the images, every
gate, and `engines` (`>=26`). The containers bring their own Node. Two steps of
`deploy-live.sh` run on the host instead: `pnpm install --frozen-lockfile`
and the site build (`node site/build.mjs`); `stand-up-live.sh` runs the first.
(Until alpha.18 a third did, the Trigger.dev task deploy.) Each runs
on **the `node` first on the `PATH` of the shell you run the script from**, and
that one is what has to be 26. Nothing else on the machine has to move for it:

- live's timers (the daily duties, the box checks and the mail on a failed run)
  run shell scripts that start no Node on the host;
- a **system Node**, the distribution's `nodejs` or NodeSource's, that another
  service on the host runs on **stays where it is**. Do not switch it for this:
  put a Node 26 of your own first on your own `PATH` (step 3);
- the OTA stack's nightly gate runs on the self-hosted runner's own Node, which
  setup-node installs (it needs `libatomic1` too, step 2); a command you run by
  hand in `~/ownpace-managed` runs on your shell's, as a deploy does.

**What stops a Node below 26.** pnpm does not: pnpm 11.28.9 does not stop an
install whose `engines` the running Node falls outside. It prints `WARN
Unsupported engine: wanted: {"node":">=26"}` and installs, exit 0 (measured on
a stand-in project; the repository sets no `engineStrict`, which is the owner's
to decide), and the deploy goes straight
on from that install to the bring-up, which redeploys the tasks and rebuilds the
images. **From the deploy after alpha.4, `deploy-live.sh` refuses it itself**,
before anything moves and in `--dry-run` too: after its fetch it reads
`engines.node` from the tag's own `package.json` (`>=N`, or `>=N.N.N`; a tag
without one is not checked, and one in any other form is refused as unread, as
is an `engines` it cannot read whole: two `"engines"` keys in the file, an
object inside it, or `node` named twice),
and refuses a `node` on the `PATH` below it, no `node` at all, or one whose
`node -v` fails (a Node 26 binary without `libatomic1` does), naming the path
`command -v node` gave, the version `node -v` said and what the tag asks for.
`stand-up-live.sh` refuses the same, in the same words (`release_tag_node` in
`release-tag.sh`). **The deploy to alpha.4 itself is not covered:** the whole
run of `deploy-live.sh` is one function that bash reads before the checkout
replaces the file with the tag's copy, so the deploy of alpha.4 runs alpha.3's
copy, which reads no Node. For that deploy, **your reading in step 1 and step
5, in the shell you deploy from, is the check.**

**1. Read what the shell you deploy from has.** As yourself (not under `sudo`),
in the shell you will run `deploy-live.sh` from, in `~/ownpace-live`. None of
these prints a secret or an address:

```bash
command -v node        # the node the deploy runs on: the first on this shell's PATH
node -v                # v26.x is what alpha.4 asks for
pnpm -v                # in ~/ownpace-live: the version pnpm runs here
node -p "require('./package.json').packageManager"   # what pnpm -v should say, pnpm@11.28.9 at alpha.4
dpkg-query -W -f='${Status} ${Version}\n' libatomic1   # install ok installed, then its version
uname -m               # aarch64 or x86_64, for the tarball in step 3
```

If `node -v` says `v26.x`, `pnpm -v` says the `packageManager` version and
`libatomic1` is installed, nothing needs to change: go to step 5. If `command -v
node` names the system's node (`/usr/bin/node`, `/usr/local/bin/node`) at
`v24.x`, leave that one and do step 3: a Node 26 of your own goes in front of it
on your `PATH`.

**2. `libatomic1`.** The official Linux binaries of Node 25 and later are
linked against `libatomic.so.1`, and setup-node's Node 26 on the self-hosted
runner is one of them. It stays installed whichever way your Node 26 comes, and
installing it changes no other service's Node:

```bash
sudo apt-get update && sudo apt-get install -y libatomic1   # only when dpkg-query does not say install ok installed
```

**3. A Node 26 first on your own `PATH`**, without touching the system's. Any
one of these; none needs `sudo`:

- **nvm:** `nvm install 26 && nvm alias default 26`. **fnm:** `fnm install 26
  && fnm default 26`. Then open a new shell; global packages are per version,
  so step 4 is done in it.
- **The official tarball, into a directory you own**, checked against
  nodejs.org's `SHASUMS256.txt`, for the architecture `uname -m` named (`arm64`
  for `aarch64`, `x64` for `x86_64`). The block runs in a subshell that stops at
  the first failure, so a download whose checksum does not match removes nothing
  and installs nothing; `node_26_installed` at the end is the only sign it ran
  through:

  ```bash
  ( set -euo pipefail
    PREFIX="$HOME/.local/node-26"   # a directory you own; replaced as a whole
    ARCH=arm64                      # or x64
    cd "$(mktemp -d)"
    curl -fsSLO "https://nodejs.org/dist/v26.13.1/node-v26.13.1-linux-${ARCH}.tar.xz"
    curl -fsSLO https://nodejs.org/dist/v26.13.1/SHASUMS256.txt
    grep " node-v26.13.1-linux-${ARCH}.tar.xz\$" SHASUMS256.txt | sha256sum -c -
    rm -rf "$PREFIX" && mkdir -p "$PREFIX"
    tar -xJf "node-v26.13.1-linux-${ARCH}.tar.xz" -C "$PREFIX" --strip-components=1
    echo node_26_installed )
  ```

  Then put it first on your `PATH`, in the file your shell reads at login
  (`~/.bashrc` or `~/.profile`), and open a new shell:

  ```bash
  export PATH="$HOME/.local/node-26/bin:$PATH"
  ```

  **On Ubuntu and Debian, put the line at the end of `~/.profile` too.** Their
  stock `~/.profile` reads `~/.bashrc` first and then puts `~/.local/bin` in
  front of `PATH`, so in a login shell (a tmux window, an ssh session) a line in
  `~/.bashrc` alone loses to any `node` in `~/.local/bin`: another tool's Node
  linked there stays the one you get. Read it in a new login shell, not the one
  you edited in: `command -v node` names `.local/node-26/bin/node` and
  `node -v` prints `v26.13.0` or a later 26.x.

- **Only on a host where nothing else runs on the system's Node**, it can move
  instead. With **NodeSource** (`apt-cache policy nodejs | grep -c
  deb.nodesource.com` counts above 0; a count, so no mirror's address is
  printed), move its repository line from 24 to 26 and upgrade; the file is
  `/etc/apt/sources.list.d/nodesource.list` or `nodesource.sources`:

  ```bash
  sudo sed -i 's/node_24\.x/node_26.x/' /etc/apt/sources.list.d/nodesource.*
  sudo apt-get update && sudo apt-get install -y nodejs
  ```

  `node_26.x` is the line NodeSource's own setup script for 26 writes:
  `scripts/deb/setup_26.x` in `nodesource/distributions` writes `URIs:
  https://deb.nodesource.com/node_26.x` with `Suites: nodistro` into
  `nodesource.sources` (read 2026-11-01). If `apt-get update` fails on that line
  all the same, put `node_24.x` back and take one of the three above. The
  **distribution's own `nodejs`** is an older major on current Debian and
  Ubuntu; on such a host, `sudo apt-get remove -y nodejs npm`, then NodeSource's
  script (read it before you run it: it installs `apt-transport-https`,
  `ca-certificates`, `curl` and `gnupg`, fetches NodeSource's signing key, writes
  `nodesource.sources` and pins `nodejs` to NodeSource):

  ```bash
  cd "$(mktemp -d)"
  curl -fsSLo setup_26.x https://deb.nodesource.com/setup_26.x
  less setup_26.x
  sudo bash setup_26.x && sudo apt-get install -y nodejs
  ```

  A system Node moved to 26 carries no corepack, so a `pnpm` that `corepack
  enable` made beside it no longer runs: `find "$(dirname "$(command -v node)")"
  -maxdepth 1 -lname '*corepack*'` lists those links, and `sudo find … -delete`
  with the same arguments removes them before step 4.

**4. pnpm at the `packageManager` version, in that shell.** Node 26 ships no
corepack. Any `pnpm` on that shell's `PATH` that runs the version
`package.json`'s `packageManager` names when you call it in `~/ownpace-live` is
enough, whatever installed it: `pnpm -v` there reads it (a pnpm that switches
itself to that version says so there too). Otherwise install that version, not
a bare `pnpm@11`, which takes whatever was published last, inside the
repository's three-day floor or not. Into a Node of your own (nvm, fnm, the
tarball above) this needs no `sudo`:

```bash
cd ~/ownpace-live
PNPM="$(node -p "require('./package.json').packageManager")" && echo "$PNPM"   # pnpm@11.28.9 at alpha.4
npm install -g "$PNPM"
```

Only a system-wide install, into a Node under `/usr` or `/usr/local`, needs
`sudo npm install -g "$PNPM"`; on a host where another service runs on the
system's Node, that is not one to make.

**5. Read it again, in the shell you deploy from,** in `~/ownpace-live`, as
yourself:

```bash
command -v node                           # your Node 26, not the system's
node -v                                   # v26.13.0, or a later 26.x
pnpm -v                                   # the packageManager version, 11.28.9 at alpha.4
ldd "$(command -v node)" | grep libatomic # resolves to a file, not "not found"
```

Then run `./deploy/compose/deploy-live.sh v0.2.0-alpha.4` **in this same shell,
as yourself, not under `sudo`**: `sudo` sets `PATH` to its `secure_path` (on
Ubuntu 24.04, `/etc/sudoers` says
`/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin`), so
under it the `node` found is the system's, not the one in your shell. For the
deploy to alpha.4 this reading is the whole check: alpha.3's script, and its
`--dry-run`, read no Node. From the next deploy on, alpha.4's own
`deploy-live.sh`, run from the checkout at alpha.4, says `Node: <path> is
v26.x, and <tag> asks for >=26` as it passes, and refuses a shell below what
the tag asks for.

**The job runner (workplan 0167 T7 and T9).** `deploy-live.sh` reads which
runner the tag's own bring-up will run the jobs on, from the tag's
`managed.yml` and live's `.env`, and refuses before anything moves when that is
not pg-boss: an `.env` that still says `OWNPACE_JOB_RUNNER=trigger`, or a tag
from before alpha.16, whose `managed.yml` has no switch and runs only
Trigger.dev. Its drain reads pg-boss's queue too: a job created, retrying or
active outside the schedule queues and pg-boss's own `__pgboss__*` queues is
refused as a pass in flight is. The copy before the update never holds
Trigger.dev's database. A tag whose `managed.yml` has no plane, deployed from
one that had it, is said in a note (*removes the Trigger.dev plane from
managed.yml; its volumes stay*), which is not one-way by itself, and the
other way round the same; a Trigger.dev pin is compared only when both have
the plane. A move of pg-boss's version in `pnpm-lock.yaml` or of its schema
version (`PG_BOSS_SCHEMA_VERSION`) between two tags that both carry it is
one-way: pg-boss migrates its schema forward. The deploy from alpha.17 to
alpha.18 is the owner's, once: *Trigger.dev's plane, removed*, below.

### The OTA stack: the nightly gate, or a pull

On the OTA stack (`~/ownpace-managed`) the nightly gate is the deploy: it
brings `main` up every night.

**Its `.env` carries `NODE_ENV=development`**, so its self-signed test mail
keeps working: in production the API turns notifications off while
`SMTP_ALLOW_SELF_SIGNED=true`. `managed.yml` takes no default, and every
`docker compose -f deploy/compose/managed.yml` call (`ps`, `logs`, `exec`,
`config`, not only `up`) stops on a `.env` without it, naming the fix. The gate
writes `NODE_ENV=development` into the persisted `.env` when the file gives it
no value (absent, blank, or a note alone), before it fills the rest from the
example, and never over a value that is there; its log names the value it found
or wrote, with a warning when that is not `development`. An OTA `.env` copied
from an older example may say `production`: the gate keeps it and warns.
Then set development in the persisted file:

```bash
./deploy/compose/env-upsert.sh ~/.persistent/ownpace-managed/.env NODE_ENV=development
```

A hand-run compose call in `~/ownpace-managed` needs the line too: when that
checkout's `.env` is a link to the persisted file, the gate's run adds it; when
it is a copy of its own, add it by hand:

```bash
./deploy/compose/env-upsert.sh deploy/compose/.env NODE_ENV=development
```

By hand, a stack that is already up takes a pull and a rebuild of the three
images that carry code, and nothing is deployed anywhere else: the jobs run from the worker's image, so the
rebuild is the whole update. The worker is recreated with the api, so its
output goes at each update as the api's does (privacy §9):

```bash
cd ~/ownpace-managed
git pull

GIT_SHA=$(git rev-parse --short HEAD) \
  docker compose -f deploy/compose/managed.yml build api web worker
docker compose -f deploy/compose/managed.yml up -d --wait api web
docker compose -f deploy/compose/managed.yml up -d --wait --force-recreate worker
```

Running the bring-up from `app` does the same, and checks the worker's CPU cap
and the system role first: `./deploy/compose/bootstrap-managed.sh --from app`.

### The system role

`ownpace_system` (managed migration 0033) is what the
jobs across organisations connect as: the one role besides the owner that row
security does not bind, and **not a superuser**. The bring-up's `app` phase
asks for it every run, before the worker starts (*The system role, asked
before the worker starts*, above). Two things can stop it:

- **`REFUSED, before its password is set or the worker starts with its URL: ownpace_system: …`**
  names every way the role is no
  longer what the migration made it. Somebody changed it with the owner's
  rights; put it back, over the database's socket, and run the phase again:

  ```bash
  docker compose -f deploy/compose/managed.yml exec -T postgres sh -c \
    'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -c "ALTER ROLE ownpace_system LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION BYPASSRLS"'
  ```

  Membership counts both ways. For *"it belongs to N role(s)"*,
  `REVOKE <that role> FROM ownpace_system` for each; for *"N role(s) belong to
  it"*, `REVOKE ownpace_system FROM <that role>` for each: a role that belongs
  to it takes its `BYPASSRLS` with `SET ROLE`, so `app_user` there would read
  every organisation's rows. `\du` shows only the first direction (the roles
  `ownpace_system` is a member of); this lists both:

  ```bash
  docker compose -f deploy/compose/managed.yml exec -T postgres sh -c \
    'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT m.roleid::regrole || '"'"' is lent to '"'"' || m.member::regrole FROM pg_auth_members m WHERE '"'"'ownpace_system'"'"'::regrole IN (m.roleid, m.member)"'
  ```

  Its table grants are not asked here; `a-system-role-that-is-not-the-owner`
  holds them against the migration's list on a throwaway database, a grant to
  PUBLIC counted as one of its own. **Never grant anything to PUBLIC in this
  database**: with `BYPASSRLS`, that is a grant to this role, past row security.
- **A setting left on the role.** Any role may change its own settings and its
  own password, and every run holds this role's URL: a run that had been taken
  over could leave `default_transaction_read_only = on` on it, after which the
  tick, retention, the purge and the audit key fail on every write. The phase
  clears every setting on the role (for every database, and for this one) in
  the same transaction as it sets the password, on every run, and the smoke
  fails when one is left. A setting found there is worth asking about: nothing
  of ours sets one.
- **`ownpace_system is not a role in this database`**: the migrations have not
  run. The api applies them when it starts; run the `app` phase again.

**Changing its password.** Put a new value in `.env` (`openssl rand -hex 24`;
only characters a URL carries as they are, which the phase checks), then
`./deploy/compose/bootstrap-managed.sh --only app`: it sets the value on the
role, then recreates the worker with the URL made from it. Runs started
between the two refuse to connect for those seconds. `rotate-db-passwords.sh` rotates the
owner and `app_user`, not this role. A run can change the role's password
itself, as any role can; the next bring-up sets `.env`'s again.

### The jobs role

`ownpace_jobs` (ADR-0054) owns the schema `pgboss`, where pg-boss keeps the
managed edition's jobs, and nothing else. The worker connects as it, through
the pooler, with `JOBS_DATABASE_URL`. It is made by the bring-up's `data` phase from
`deploy/compose/jobs-role.sql`, not by a migration, and the phase asks Postgres
what it may do on every run, before it sets `.env`'s `JOBS_DB_PASSWORD` on it.
The file creates the role and the schema when they are missing and changes
neither when they exist, so a role somebody changed is refused, never put
right without a word. What can stop the phase:

- **`REFUSED, before its password is set: ownpace_jobs: …`** names every way
  the role is no longer what the file makes. Nothing has been changed. Look at
  what it names before you undo it: nothing of ours grants this role anything.
  Then, over the database's socket, for each reason:

  ```bash
  # The attributes (superuser, CREATEROLE, CREATEDB, REPLICATION, BYPASSRLS, INHERIT, no LOGIN):
  docker compose -f deploy/compose/managed.yml exec -T postgres sh -c \
    'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -c "ALTER ROLE ownpace_jobs LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS"'
  # Every grant that names it, and the memberships both ways (what to REVOKE):
  docker compose -f deploy/compose/managed.yml exec -T postgres sh -c \
    'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT pg_describe_object(classid, objid, objsubid) FROM pg_shdepend WHERE refobjid = '"'"'ownpace_jobs'"'"'::regrole AND deptype = '"'"'a'"'"' AND dbid IN (0, (SELECT oid FROM pg_database WHERE datname = current_database()))" -c "SELECT m.roleid::regrole || '"'"' is lent to '"'"' || m.member::regrole FROM pg_auth_members m WHERE '"'"'ownpace_jobs'"'"'::regrole IN (m.roleid, m.member)"'
  ```

  - *"it belongs to N role(s)"* / *"N role(s) belong to it"*:
    `REVOKE <that role> FROM ownpace_jobs`, or `REVOKE ownpace_jobs FROM <that role>`.
  - *"N grant(s) name it"*: `REVOKE … FROM ownpace_jobs` for each line the
    second command printed; a default privilege is taken back with
    `ALTER DEFAULT PRIVILEGES … REVOKE … FROM ownpace_jobs`.
  - *"it holds a privilege on N relation(s) of public"*, *"it may create a
    schema in this database"* or *"it may create in the schema public"*, with
    no grant naming it: the grant is to PUBLIC, and so to every role.
    `REVOKE … FROM PUBLIC` it; an extension's own views (pg_stat_statements')
    are not counted.
  - *"it may call N function(s) of pgbouncer_auth"*: `REVOKE ALL ON FUNCTION
    pgbouncer_auth.user_lookup(text) FROM PUBLIC` (and `FROM ownpace_jobs`);
    the data phase's `setup-auth.sql` revokes PUBLIC's every run, `--sync` does not.
  - *"N privilege(s) on pgboss or in it are granted to another role or
    PUBLIC"*: `REVOKE ALL ON SCHEMA pgboss FROM <that role>` and, for a table,
    `REVOKE ALL ON pgboss.<table> FROM <that role>`. pg-boss's tables carry no
    row security, so nobody else may be granted them.
  - *"the schema pgboss belongs to another role"* or *"it owns N object(s)
    outside pgboss"*: `ALTER SCHEMA pgboss OWNER TO ownpace_jobs`, or move
    each object to its proper owner, after asking who made it.

  Then run the phase again: `./deploy/compose/bootstrap-managed.sh --only data`.
- **`ownpace_jobs over the pooler: REFUSED`** after the password was set: the
  pooler has not seen the role yet. It looks verifiers up in Postgres on every
  login (`auth_query`), so this is not a cached value; read PgBouncer's log.
- **`JOBS_DB_PASSWORD holds a character a URL does not carry`**: the worker
  will put it in `JOBS_DATABASE_URL` as it is. Use `openssl rand -hex 24`.

**Changing its password.** Put a new value in `.env`, then
`./deploy/compose/bootstrap-managed.sh --only data`, or
`./deploy/compose/rotate-db-passwords.sh --sync`, which sets the owner's and
`app_user`'s as well and leaves an unfit jobs role as it is, naming it.
`--rotate` does not change it. A missing value is filled in by the bring-up
itself (`ensure-env-secrets.sh --only JOBS_DB_PASSWORD`).

### Draining first, and telling customers why

A rebuild replaces the containers under whatever is running. For an api/web
rebuild that is a few seconds of unavailability; for the worker's it can
interrupt a sync pass mid-flight. A pass that is interrupted loses only its
own work — the cursors stay where the last completed folder left them, and the
next pass carries on — but a customer watching a large migration sees it stop,
and has no way to tell that from something broken.

So there is a hold (managed migration 0023). It stops the
sync tick starting **new** passes; passes already running finish normally,
which is what makes it a drain rather than a kill. It is on the operator's
first support screen, under **Hold new passes**, with a box for what customers
will read.

It also stops what a customer starts by hand. While it
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

The hold is platform-wide — there is no per-tenant hold. Every hold is kept,
with who started it, who lifted it and what it said, so *"when were we down and
what did we tell people"* has an answer afterwards.

---

### Trigger.dev's plane, removed

alpha.18 removes Trigger.dev from the managed edition (workplan 0167 T9,
ADR-0054). The owner, 2026-11-23: *"i will remove trigger.dev, but the machine
runs OTA and managed, so both have to be move out of triggerdev."* alpha.16 and
alpha.17 already ran every job on pg-boss and kept the plane installed and
stopped; alpha.18's `managed.yml` no longer names its eleven services, three
networks or volumes. Compose never removes a volume a file stops declaring, so
what the plane left on a stack goes in two steps: its stopped containers, by
the bring-up's `plane` phase (phase 5), and its volumes and networks, by name,
once, on the owner's word, with
[`remove-trigger-plane.sh`](../deploy/compose/remove-trigger-plane.sh).

What it removes, for a stack's project `<project>` (its
`COMPOSE_PROJECT_NAME`, `ownpace-live` on live):

| Kind | Name | What it held |
|---|---|---|
| volume | `<project>_trigger_db_data` | Trigger.dev's database, `triggerdb` |
| volume | `<project>_redis_data` | its Redis |
| volume | `<project>_trigger_shared` | the worker token it shared with its supervisor |
| volume | `<project>_registry_data` | the task images |
| volume | `<project>_minio_data_v2` | its object store |
| volume | `<project>_minio_data` | the Bitnami-era object store, undeclared since 0146 T7 |
| volume | `<project>_trigger_tls_data` | the dashboard's TLS front: its local CA and certificate |
| volume | `<project>_trigger_tls_config` | the same front's configuration |
| volume | `<project>_clickhouse_data` | the Bitnami-era event store |
| volume | `<project>_clickhouse_data_v2` | its event store |
| volume | `<project>_clickhouse_logs` | the event store's logs |
| network | `<project>_trigger-event-store`, `<project>_trigger-docker-socket`, `<project>_trigger-task-images` | the plane's own networks |

Each one that exists is removed with `docker volume rm` or `docker network rm`
by that name and no other; nothing else of the project is touched, and never
with `down -v`. The script refuses while a container of the plane is left
(the `plane` phase removes those first), while `OWNPACE_JOB_RUNNER` says
`trigger`, and in a checkout whose `managed.yml` still defines the plane (one
from before alpha.18). `scripts/a-plane-removed.unit.test.ts` runs it against a
Docker stand-in.

**The OTA stack: nothing for the owner.** The gate, E2E (managed), runs
`./deploy/compose/remove-trigger-plane.sh --yes` after its bring-up on every
run. The first run of alpha.18's `main` removes what the OTA stack held; every
run after it says there is nothing to remove.

**Live: the owner's deploy of alpha.18, block by block.** From `~/ownpace-live`,
in the same shell and the same `tmux` as every deploy (*`ownpace-live`: a
release tag, with `deploy-live.sh`*).

**Block 1, before: the switch says pg-boss, or nothing.**

```bash
grep -n '^OWNPACE_JOB_RUNNER=' deploy/compose/.env
```

Nothing printed, or `OWNPACE_JOB_RUNNER=pg-boss`, or the key empty: go on. If
it says `trigger`, set it to pg-boss (or delete the line) first:

```bash
./deploy/compose/env-upsert.sh deploy/compose/.env OWNPACE_JOB_RUNNER=pg-boss
```

alpha.18's bring-up refuses `trigger`, and alpha.17's `deploy-live.sh`, which
runs this deploy, would read the tag's runner as `trigger` from that line.

**Block 2, the deploy, as every release:** the hold on and the drain done,
then

```bash
./deploy/compose/deploy-live.sh --dry-run v0.2.0-alpha.18
./deploy/compose/deploy-live.sh v0.2.0-alpha.18
```

It is alpha.17's `deploy-live.sh` that runs, since a deploy runs the script
the checkout had before it moved. It takes the copy before the update
**without** `--trigger` and says so (the tag's bring-up runs pg-boss; nothing
migrates Trigger.dev's database); prints a note that the release *removes the
Trigger.dev plane from managed.yml (its volumes stay)*; compares the
identity provider's pin and no Trigger.dev pin, since only one of the two
releases has the plane; and calls the update **one-way**: no pin moves, but
alpha.18 carries ledger migration 0075 (#2080), and any migration makes a
deploy one-way, so the way back is the copy the take makes before the
checkout. Then it checks the tag out and runs alpha.18's own
bring-up from `data`: the `plane` phase stops nothing (the plane is stopped
already) and removes the plane's eleven containers by their labels, saying
that its volumes are still there; the `app` phase rebuilds the api, web and
worker. Without the demo the bring-up skips its smoke on live, so check by
hand that no container of the plane is left, as the deploy sheet does. Then
lift the hold and prove the update as every time.

**Block 3, after the deploy is proven:** the smoke and the checks green, and
the jobs running on pg-boss:

```bash
./deploy/compose/operator.sh jobs                 # the queues: runs completed, none failing
./deploy/compose/remove-trigger-plane.sh          # what --yes would remove; removes nothing
./deploy/compose/remove-trigger-plane.sh --yes    # removes it: ONE WAY
./deploy/compose/remove-trigger-plane.sh          # "Nothing to remove."
```

`--yes` is one way: Trigger.dev's database, its event store, its object store,
its task images and its TLS front's certificate are gone, and nothing brings
them back. Nothing of the product needs them: alpha.16, alpha.17 and alpha.18
run every job on pg-boss.

**Block 4, optional tidying, whenever suits:**

- **The Trigger.dev CLI's login on the host**, kept outside every container:
  `rm -rf ~/.config/trigger`, once no checkout on the machine deploys tasks
  any more (none does from alpha.18; the OTA checkout follows `main`).
- **The plane's images**, which the shared daemon keeps until somebody removes
  them. List them, read the list, and remove what is the plane's (the other
  stack's are the same images; remove them once neither stack is on alpha.17
  or earlier):

  ```bash
  docker image ls --format '{{.Repository}}:{{.Tag}} {{.ID}}' | grep -E 'trigger|clickhouse|minio|redis|registry|docker-socket-proxy|caddy'
  docker image rm <repository:tag> …
  ```

- **The repository secret `TRIGGER_ACCESS_TOKEN`** (GitHub → Settings →
  Environments → `e2e-managed`, or the repository's secrets), which nothing
  reads since alpha.18's gate: delete it there.
- **A kept copy that holds a `triggerdb-*.sql.gz`**, from a copy taken before
  an update that moved the Trigger.dev pin. It is kept, deleted and expired
  as any copy (`copy-before-update.sh delete`, `delete-if-proven`, the daily
  duties' `expire`); nothing restores the file, since there is no plane to
  restore it into.

**Rolling back.** alpha.17 → alpha.18 is one-way (ledger migration 0075), so
the way back is the copy the take made before the checkout, as for any
one-way deploy; alpha.17 refuses a database alpha.18 migrated. The plane
plays no part in it, before block 3 and after it: alpha.17 runs pg-boss and
keeps the plane stopped, so it needs none of the volumes. Going back to
Trigger.dev itself, the way back alpha.16 kept, is not offered from alpha.18
on.

## Redoing a rollout somewhere else

The whole configuration is `deploy/compose/.env`.
On a new machine:

```bash
git clone … ownpace-managed && cd ownpace-managed && pnpm install --frozen-lockfile
./deploy/compose/bootstrap-managed.sh
```

Do **not** copy an old `.env` across wholesale. Copy the *decisions* — prices,
SMTP, OAuth, the public URLs — and let `ensure-env-secrets.sh` mint fresh
secrets. A secret that exists on two machines is a secret that gets rotated on
neither.

**Rotating a secret**: change it in `.env`, `docker compose up -d` the affected
services (the worker too, where it reads the key), and re-mint any
JWTs signed with a rotated `JWT_SECRET`. Rotating `SECRET_ENCRYPTION_KEY`
**strands stored connection credentials** — they have to be re-entered.
**A database password is not enough
changed in `.env`**: `POSTGRES_PASSWORD` and `APP_DB_PASSWORD` belong to roles
that keep the password they were created with, so the role has to be told
too. The bring-up's `data` phase tells both on every run (phase 3 above), and
`./deploy/compose/rotate-db-passwords.sh --rotate` makes new values and tells
the roles at once, and never prints a value; the next section is the
procedure.

### Changing the database passwords

A stack's database roles may have been created with values this repository
contains: `app_user` with `app_password` (the first migration), the owner with
compose's default or the example's `change-me-openmigrate`. `.env` alone does
not reach a role that exists, so `deploy/compose/rotate-db-passwords.sh`
carries a new value to it with `ALTER ROLE`. It has three modes:

| mode | what it does | exit |
|---|---|---|
| `--check` (the default) | Changes nothing, and runs on any stack, live included. Lists the login roles (names and flags). Asks the controls, `.env`'s own values, over the stack's network and through PgBouncer. Tries the three shipped Postgres values against the owner **by its real name**, `app_user`, `openmigrate` and `APP_DB_USER`, where each is a login role. One line per pair, never a value. A role that opens and is neither the owner nor `APP_DB_USER` (the owner's old name, left with `LOGIN`) is not one `--rotate` changes, so for it the advice is, by hand, `ALTER ROLE <name> NOLOGIN`, never `DROP`. | 0 nothing shipped opens; 1 something does; 2 not established |
| `--sync` | Sets `app_user`'s and the owner's passwords to what `.env` holds, in one transaction over the socket, then proves both over the network and through the pooler. Idempotent. The remedy when `.env` and the roles disagree. Refuses a stack that may be live (`stack_may_be_live`), before it asks the stack anything. | 0 / 1 / 2 |
| `--rotate` | Makes new values on the machine and changes `.env` and the roles together. Refuses on live, in CI, under `set -x`, when `.env` is not the persisted file, while a CI job runs on the machine or E2E (managed) is queued or in progress (asked before it prompts, and again once the project name is typed, before anything is written), when postgres is not healthy, when `.env` and the roles already disagree, and while a shipped value opens a login role it does not change (it names the role and 0132 T2 step 5). It asks you to type the project name. On any failure, or an interrupt, it puts the old `.env` and the old role passwords back, and says which step failed; a second Ctrl-C does not stop that. If it cannot complete, it keeps the old `.env` beside the persisted one (mode 0600) and says what to run. | 0 / 1 |

`--with-trigger-stores`, which added Trigger.dev's three stores to `--sync` and
`--rotate` until alpha.18, is refused in a sentence that says they are gone.

Every question about a password goes over the stack's network or to
PgBouncer's port, never the database container's socket, which trusts every
connection and would open with any password
([the check Postgres never made](../scripts/the-check-postgres-never-made.unit.test.ts)).
No value is ever an argument: each travels in the environment of the one
process that needs it, by name.

**The procedure, on the OTA stack**, from `~/ownpace-managed`, with
`deploy/compose/.env` a link to the persisted file
([One stack, one `.env`](#one-stack-one-env)):

1. **Bring the checkout up to date, then check.** This checkout is pulled by
   hand; the gate deploys from its own. So first `git pull`. Then
   `./deploy/compose/rotate-db-passwords.sh --check`. Every control must open.
   Each `OPENS` line is a shipped value still in force. If a control
   is `REFUSED`, `.env` and the database already disagree: run `--sync` first.
   If an `OPENS` line names a role that is neither the owner nor `app_user`
   (the owner's old name, `openmigrate`, left with `LOGIN` after a rename),
   take its login away first with the command the check prints
   (`ALTER ROLE openmigrate NOLOGIN`, never `DROP`, because it owns the
   schema); `--rotate` refuses until then.
2. **Rotate, at a quiet time.** After that day's gate run has finished, and
   with nothing queued in Actions → E2E (managed):
   `./deploy/compose/rotate-db-passwords.sh --rotate`,
   and type the project name when it asks. From here until the next step ends,
   the OTA app cannot open new database connections (the demo is down; no
   tester uses this stack).
3. **Dispatch E2E (managed)** on `main` (the script does this itself when `gh`
   is signed in). That run restores the persisted `.env`, recreates every
   container whose settings changed (Postgres, the API, Zitadel, the worker;
   the system role's password is not rotated here: the bring-up sets `.env`'s
   on every run), and its smoke proves a job still connects.
4. **Check again**, once that run is green: `--check` exits 0.
5. **Record the date in workplan 0132 T0** (step 2), with "refused". Never a
   value.

`--sync` and `--rotate` refuse live: its values are made fresh when it is
stood up and are its own. `--check` runs on any stack, live included. The gate
never runs `--rotate`;
it may one day run `--check`. The bring-up's `data` phase runs the `--sync`
function (`deploy/compose/db-roles.sh`) on every run, and refuses a published
value on a real address. The OTA stack's `.env` holds the value its rotation
wrote.

## What this does not cover

- **TLS and a public hostname for the API and web app.** Everything above is
  addressed by IP or `localhost`. A real deployment needs a reverse proxy with
  real certificates in front of ports 3001 and 3123, and `CORS_ORIGIN` /
  `WEB_URL` / `API_URL` set to those addresses.
- **Backups of the APPLICATION database.** Nothing here backs up the
  `postgres` service's database — including the identity provider's tables,
  which after 8b hold the only copy of who can sign in. (The gate drills a
  restore of the identity provider's database on every run, `dump-idp.sh
  --drill`, into a database beside it; it keeps nothing.) A stack without backups sets
  `BACKUP_RETENTION_DAYS=0`, so the erasure sentence names none.
  `ownpace-live`, the stack testers use, takes none during the alpha and sets
  `7`: one copy of its databases is made right before each update, by
  `deploy-live.sh`, and deleted once the update is proven, or after six days
  less an hour by the daily duties (§8g).
  [Workplan 0134](./workplans/0134-no-backups-during-the-alpha-said-truthfully.md)
  has the reasoning, and parks building the backups until before the first
  paying customer, or the end of the alpha, whichever comes first.
- **Anybody's first account.** `setup-zitadel.sh` stands the provider up; it
  does not create people. People are let in through the access-request queue
  (§8c): once an operator is appointed as §8c
  describes, granting a request (`POST /api/access-requests/<id>/grant`)
  creates the organisation and its owner invitation in one transaction, and
  the asker becomes a member the first time they sign in with a verified
  email.
- **Bring-up from scratch, tested.** The nightly
  [`e2e-managed.yml`](../.github/workflows/e2e-managed.yml) runs this script
  from the `data` phase against a stack that already exists, so `preflight`
  and `env` on a new machine are exercised only by somebody doing this there. If you are that
  person and something here is wrong, fix this document in the same change.

## See also

- [`deployment.md`](./deployment.md) — the editions and what each one is for
- [`operator-runbook.md`](./operator-runbook.md) — running it once it is up
- [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md) — symptoms across both editions
- [`rls-guide.md`](./rls-guide.md) — why the app connects as `app_user`
- [`status-page.md`](./status-page.md) — what the status page can and cannot tell you
- [`performance.md`](./performance.md) — the PGlite ledger benchmark, bounded
  concurrency and the remaining throughput levers (the pooler is phase 3 above)
