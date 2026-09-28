# Workplan 0132 — ownpace-live beside the nightly gate, on one box

> **In one line:** `ownpace-live`, a second compose stack at the production names beside the OTA `ownpace-managed` stack and nightly gate: project-derived container and network names, own `.env`, database passwords, Trigger.dev plane and Zitadel, loopback ports, tag deploys.

## Status — 2026-09-28 (update this block at the end of every session)

**2026-09-27: T1 built on branch `claude/ownpace-public-readiness-y7orc6-a-stack-named-by-its-project`, not merged.**
Every name in `deploy/compose/managed.yml` now follows the compose project.

- **The names.** The 17 `container_name` values are derived, not dropped:
  `${COMPOSE_PROJECT_NAME}-db`, `-pgbouncer`, `-idp`, `-api`, `-web`, `-status`, `-mailpit`,
  `-nextcloud`, and `-trigger-db` to `-trigger-tls` for the nine Trigger.dev services. So the OTA
  stack's database is `ownpace-managed-db` and live's is `ownpace-live-db`. `name: ownpace-managed`
  stays as the default. `DOCKER_RUNNER_NETWORKS` is `${COMPOSE_PROJECT_NAME}_ownpace-network`.
- **One reader for the project.** `compose_project` in `deploy/compose/env-read.sh` takes it the
  way Compose does: `COMPOSE_PROJECT_NAME` from the environment, then from the `.env` beside
  `managed.yml`, then `name:`. It refuses a name Compose refuses. It also refuses when the shell's
  `COMPOSE_PROJECT_NAME` and the checkout's `.env` disagree, because Compose follows the shell, even
  an empty value, and would then act on the other stack. That refusal is not in §3; it closes the
  trap of `set -a; . deploy/compose/.env` in one checkout followed by a script in the other.
- **The 13 `ownpace-managed_` lines in six files** are built from the project: the runner network
  and a comment in `managed.yml`, `reset-trigger.sh`'s volume, `setup-managed-demo.sh`'s network
  default and two comments, two printed recipes and a comment in `setup-zitadel.sh`, two in
  `bootstrap-managed.sh`, two in `smoke-managed.sh`. A recipe is printed with the project filled in; a comment says
  `<project>`, which nothing fills in and nobody can mistake for a real name.
- **The scripts.** Printed recipes reach the database with
  `docker compose -f …/managed.yml exec -T postgres`, never `docker exec ownpace-db`
  (`bootstrap-managed.sh`, `setup-zitadel.sh`, `seed-managed.sh`, `seed-demo-dav-content.sh`).
  Scripts that `docker exec` a container take its name from the project (`smoke-managed.sh`,
  `zitadel-db-password.sh`, `trigger-version.sh`, `seed-demo-dav-content.sh`,
  `setup-managed-demo.sh`). `trigger-magic-link.sh` reads `docker compose logs trigger-api`. The
  persisted `.env` and the dump directory default to `~/.persistent/<project>` in
  `bootstrap-managed.sh`, `trigger-credentials.sh`, `trigger-version.sh`, `setup-zitadel.sh`'s hint,
  `e2e-managed.yml` (three steps) and `e2e-live-target.yml`. For the gate this is still
  `~/.persistent/ownpace-managed`, because its checkout sets no `COMPOSE_PROJECT_NAME`. T1b step 2's
  interim `MANAGED_ENV_PERSIST_DIR` is not needed once this is merged. `setup-zitadel.sh` labels a
  new mail relay with the project instead of `ownpace-managed`; it finds an existing one by host, so
  the OTA stack's is kept.
- **Docs.** `docs/managed-bring-up.md` has a new section, *Which stack a command reaches*: the
  naming table, the two ways a command reaches a stack, how to ask Compose for the project, and
  *one shell, one stack*. Its commands use `docker compose … exec|logs`, or `<project>`. *One box,
  one stack, one `.env`* is now *One stack, one `.env`*. The runbook's five `psql` recipes,
  `docs/dav-sync.md`'s one, `AGENTS.md` and `managed.env.example` (a comment on
  `COMPOSE_PROJECT_NAME`, deliberately with no empty key line) follow.
- **The guards, and that they failed first.** `scripts/two-stacks-on-one-box.unit.test.ts`, both
  halves. The first half reads `managed.yml`, every shell script under `deploy/compose/` and every
  workflow. The second renders `managed.yml` under `ownpace-managed` and `ownpace-live` with a port
  set each, runs `compose_project` in twelve situations, and runs `reset-trigger.sh` with a stub
  `docker` in each stack's checkout. On `main` it failed 14 of its 23 cases: the 17
  `container_name` values, the 13 `ownpace-managed_` lines, 33 more lines naming
  `ownpace-managed`, 41 uses of an old container name in 13 files, 13 lines with
  `~/.persistent/ownpace-managed`, 17 shared container names, the shared runner network,
  live's task runs on the OTA stack's network, the missing reader, and `reset-trigger.sh` removing
  `ownpace-managed_trigger_db_data` from live's checkout. `scripts/idp-wiring.unit.test.ts` now
  expects `${COMPOSE_PROJECT}_zitadel_machinekey` and the reader's assignment in
  `bootstrap-managed.sh`, and failed first on the literal. `scripts/pasteable-hints.unit.test.ts`
  now checks every volume a script runs or prints, `${COMPOSE_PROJECT}_<volume>` in code and
  `<project>_<volume>` in a comment, and that `COMPOSE_PROJECT` comes from the reader; it failed
  first on 2 cases. Thirteen mutations each turned a guard red: a fixed `container_name`, the runner
  literal, a fixed host port, `reset-trigger.sh`'s literal volume, the reader treating an empty
  shell value as unset, the reader following a disagreeing shell, `trigger-version.sh`'s fixed
  container, a workflow naming `ownpace-live`, `bootstrap-managed.sh`'s literal recipe and a
  project not from the reader (idp-wiring), and a literal prefix, a project not from the reader and
  a variable in a comment (pasteable-hints). `a-jit-that-compiled-a-crash` and
  `seed-demo-dav-content` pinned the old names and were moved to the new ones.
- **Checked with Compose itself** (5.1.1, here, not on the machine), with a throwaway `.env` that
  fills every required key with a placeholder:
  `docker compose -p ownpace-live -f deploy/compose/managed.yml --env-file <that file> config`
  names the 17 containers `ownpace-live-*`, the runner network `ownpace-live_ownpace-network`, the
  networks `ownpace-live_ownpace-network` and `ownpace-live_status-probe`, and every volume
  `ownpace-live_…`. Under `-p ownpace-managed` it shares none of the 17 names. Without `-p` it gives
  `ownpace-managed-db` and `ownpace-managed_ownpace-network`. A `COMPOSE_PROJECT_NAME=ownpace-live`
  line in the `.env` beside a copy of the file gives the same as `-p`, and `compose_project` agrees.
- **Departures from §3.** The names are derived rather than dropped, so a script can build one
  without asking Docker. `reset-trigger.sh` takes the volume's name from the shared reader rather
  than from `docker compose config`; the guard runs it in both stacks' shoes. The guard renders the
  YAML itself (the unit tier has no Compose); the render with Compose is the check above. The
  reader's refusal of a disagreeing shell is new.
- **PR #1210 (0149 T3), open in another session,** also edits `smoke-managed.sh`, at other lines
  (around 1455 and 2136 to 2230). The edits here are six small hunks: five near the top, at the
  token reader and at the Nextcloud cron line, and the runner-log watcher's one line at 826 (the
  review fixes below). So the two merge cleanly in either order.
- **On the machine, when this merges.** The next nightly gate run, or
  `./deploy/compose/bootstrap-managed.sh --from data --with-demo` from `~/ownpace-managed`,
  recreates the OTA stack's containers under the new names (`ownpace-managed-db`,
  `ownpace-managed-trigger-api`, …). Compose finds the old containers by their labels and replaces
  them. The volumes and networks keep their names, because the project does not change, so no data
  moves. The demo Stalwart (`ownpace-stalwart`, started outside Compose) keeps its name and its
  network.
- **Open, and whose.** The owner's, as T0 says: step 1, check with `docker ps` that the OTA
  containers carry `ownpace-managed-*` names after the first run, and
  `docker volume ls --filter name=ownpace-managed_` that the volumes are the same ones; and step 5,
  run the D9 network checks on the machine, including that
  `docker compose -f deploy/compose/managed.yml config | grep DOCKER_RUNNER_NETWORKS` renders the
  project there (the machine's Compose version is not visible from here; one that does not supply
  `COMPOSE_PROJECT_NAME` fails on the container names rather than running with wrong ones). Also
  the owner's: any habit, note or job on the machine outside this repository that names an old
  container (`docker exec ownpace-db …`) changes to `docker compose … exec postgres …` or to
  `ownpace-managed-db`. T1b to T1g, T2 and T3 can start.


**2026-09-27, T1 after 0143 T9 (a) merged (#1235):** `rehearse-capacity.sh` arrived on `main` with
a `compose_project()` of its own, which shadowed the one reader once `env-read.sh` carries it. It
now takes the project from `compose_project "${SCRIPT_DIR}"`, like every other compose script, and
keeps its own check that Compose reports the same project (`compose_reports_project`). The two
guards that found it, `two-stacks-on-one-box` and `pasteable-hints`, and the rehearsal's own guard
pass. Left open: `--sample` counts `runner-*` containers from `docker stats`, which lists every
container on the daemon, so with live running beside the OTA stack its task-container figures
would include live's. A filter on the stack's runner network belongs with the sitting (0143 T9).

**2026-09-27, later: the review's fixes, on the same branch, not merged.** A review of the T1 build
found two ways a script could still reach the other stack, and three sentences that said more than
the code did.

- **The smoke's runner-log watcher listed every `runner-*` container on the daemon.** Trigger.dev
  names task-run containers `runner-…`, with no project in the name. Beside live, the OTA gate's
  smoke would have copied the first 4000 bytes of each of live's task-run logs into its job log
  and its uploaded evidence, and runner debug output prints the whole task environment (§4). A live runner would also have
  satisfied the smoke's "a runner container appeared" assertion for the OTA stack. The watcher now
  asks `docker ps --filter "network=${COMPOSE_PROJECT}_ownpace-network"`: the network the stack's
  own `DOCKER_RUNNER_NETWORKS` starts its task runs on. This had to land before live's first task
  run (T1c); it lands with T1.
- **Four scripts reached a stack through Compose without asking the reader first.** `operator.sh`,
  `seed-managed.sh` and `trigger-magic-link.sh` never asked it, and `trigger-credentials.sh` asked
  only inside `--write`, after it had read the other stack's `proj_` ref and `tr_prod_` key and
  written them into this checkout's `.env`: reproduced here with a stub, and that `.env` is the
  copy the gate restores. The OTA stack's `.env` names no project, so sourcing it with `set -a`
  does not override a name the shell exported. Each now calls `compose_project` before its first
  Compose command, and before it sources `.env`. `deploy-tasks.sh`, `set-task-env.sh` and
  `ensure-env-secrets.sh` only print Compose commands and need nothing.
- **Docs.** `docs/managed-bring-up.md` and `managed.env.example` now say that every script here that
  runs Compose refuses a disagreeing shell, and a `docker compose` typed by hand does not. The
  runbook's Prerequisites say that every command in it acts on the stack whose checkout it runs
  from, and name the two checkouts. `scripts/one-stack-one-env.unit.test.ts`'s header no longer
  says the container names are fixed. The T1 row now starts with its 🔨 marker, so the index counts
  it.
- **The guards, and that they failed first.** `scripts/two-stacks-on-one-box.unit.test.ts` grew
  from 23 cases to 39. New in the first half: every `docker ps` in a compose script or workflow
  filters by a name built from the project; every compose script that runs Compose calls the
  reader on an earlier line (a small reader of shell text tells a command from a printed recipe,
  and a case checks it reaches the end of every script); and nothing writes out a name that starts
  with live's project (`ownpace-live-…`, `ownpace-live_…`). New in the second half: the smoke's
  watcher, rendered for each stack, is that stack's runner network. New at the end: `operator.sh`,
  `seed-managed.sh`, `trigger-magic-link.sh`, `trigger-credentials.sh --write` and
  `reset-trigger.sh --yes` run in the OTA stack's checkout from a shell that exports live's name,
  with a `docker` stub that answers as live would. Each must refuse before its first `docker` call
  and leave `.env` unchanged; the same runs without that name must reach the stub. On the branch's
  first commit 8 of the 16 new cases failed: the `docker ps` rule, the reader rule, the watcher for
  both stacks, and the refusal of the first four scripts. The live-prefix case passed, as it should
  have. Nine mutations each turned it red: the watcher filtering by status, the watcher on the
  status-probe network, a script writing out `ownpace-live_ownpace-network`, the reader call
  dropped from `trigger-magic-link.sh` and from `operator.sh`, `trigger-credentials.sh`'s reader
  moved back inside `--write`, a workflow running `docker ps -a`, `deploy-tasks.sh` running Compose
  without the reader, and an unclosed heredoc in `setup-zitadel.sh`. The two tests that run
  `operator.sh` and `seed-managed.sh` in a bare directory now copy the reader and `managed.yml`
  beside them.
- **Still open, and whose.** Unchanged from the entry above: the owner's T0 steps 1 and 5 on the
  machine after the first nightly run.

**2026-09-27: T3 (a), with T1f, built on branch `claude/ownpace-public-readiness-y7orc6-ports-published-on-purpose`, not merged.**
It is stacked on T1's branch and carries T1's commit, so T1 merges first. Every port both stacks
and the site publish now answers on `127.0.0.1`, and anything more is a setting.

> **MERGE PRECONDITION, the owner's, in two parts.** Each bind is the front's address, the IPv4
> address of this machine that the ingress in front of the names connects to, or its mesh address
> for a page opened from a laptop. A bind takes an IP address, never a name.
>
> 1. **The OTA stack, before the merge.** The nightly gate deploys `main` to the OTA stack by
>    itself, so this change reaches that stack on the first run after the merge. In its `.env`
>    (`~/.persistent/ownpace-managed/.env`, which the gate restores and the operator's checkout
>    links to), set `WEB_BIND` and `ZITADEL_BIND`; `STATUS_BIND` too, because the OTA status page
>    is opened over the mesh (0142 records it as reachable only there), and it is needed wherever a
>    status name is routed as well; and `TRIGGER_TLS_BIND`, the machine's mesh IP address that
>    `TRIGGER_TLS_HOST` names, if the Trigger.dev dashboard is opened from a laptop over the mesh.
>    Without them, `app.ota.ownpace.eu` and `id.ota.ownpace.eu` stop answering at that first run,
>    the API cannot reach its issuer (it asks the provider by its public name), and the status
>    page goes dark on the mesh with its lamps red. A name or `0.0.0.0` in any `*_BIND` stops
>    the bring-up in `load_env`, naming the key.
> 2. **The site, before it is next recreated.** No workflow and no script runs `www.yml`, so the
>    gate never touches the site: `ownpace-www` keeps its old publish, on every interface, and
>    `www.ota.ownpace.eu` keeps answering, until somebody recreates it. Set `WWW_BIND` in the
>    `.env` the site is brought up with (`deploy/compose/.env` in that checkout, because Compose
>    reads the `.env` beside `www.yml`), then, from that checkout updated to the merge, run
>    `docker compose -f deploy/compose/www.yml up -d`. T0 step 1 has the check. Until that run,
>    the site's exposure this change closes stays open.
>
> The running `managed.yml` and `www.yml` read none of these keys, so setting them now changes
> nothing until the change arrives. Live sets its own at T1b step 3, before its first bring-up.
> The address is written only in those `.env` files, never here: the address guard keeps mesh
> addresses out of the repository. The examples in this change are the placeholder
> `100.64.0.1`, the dashboard section's existing `10.0.0.5`, and documentation addresses
> (`192.0.2.x`, `203.0.113.x`) in the renders and the guard. `docs/managed-bring-up.md` (*Which
> address a port answers on*, and a note at the top of *Updating a running deployment*) and the
> runbook's *Upgrade* say the same.

- **The shape.** Each of the eight ports has two entries: `127.0.0.1:${<NAME>_PORT:-n}:target`,
  fixed, and `${<NAME>_BIND:-127.0.0.1}:${<NAME>_PORT:-n}:target`. `managed.yml` has
  `POSTGRES_BIND`, `API_BIND`, `TRIGGER_BIND`, `TRIGGER_TLS_BIND`, `ZITADEL_BIND`, `WEB_BIND` and
  `STATUS_BIND`; `www.yml` has `WWW_BIND`. Empty, the bind renders the same as the fixed entry and
  Compose keeps one: compose-go's `EnforceUnicity` drops a port entry that repeats another's
  address, port, target and protocol (in compose-go since v2.0.0). Set, it adds that address and
  loopback stays. `managed.env.example` lists the eight keys bare, with the rule, which ones a
  routed name needs, and `100.64.0.1` as the shape. The registry stays on its literal loopback;
  Mailpit and Nextcloud keep their single bind, which their callers follow.
- **The demo's Stalwart.** `deploy/selfhost/setup-stalwart.sh` publishes both ports on
  `STALWART_BIND`, `127.0.0.1` by default, and asks that address itself: `stalwart-cli`'s default
  URL and the printed addresses follow the bind, and so does `setup-managed-demo.sh`'s seeder.
  Everything in CI already reached it on loopback from the host or by name on the network.
  `e2e.yml`'s header said the appliance reached it through `host.docker.internal`; its mapping
  step points the mail source and target at the name `stalwart`, and the header now says so.
- **The guard, and that it failed first.** `scripts/a-port-published-on-purpose.unit.test.ts`, 13
  cases. On the unchanged code (T1's branch) 7 failed: the rule named exactly the eight entries
  (`postgres`, `trigger-api`, `trigger-tls`, `zitadel`, `api`, `web`, `gatus` in `managed.yml`,
  `www` in `www.yml`, each "no host address, so Docker publishes it on every interface"), the
  eight named binds were missing from both files and seven of them from the example, and `setup-stalwart.sh`
  had no `STALWART_BIND`, a fixed `CLI_URL` and a seeder fixed on `127.0.0.1`. Ten mutations
  each turned a guard red: the web app without its loopback entry, `API_BIND` with `-` for `:-`,
  the site back on every interface, a bare `-p` for IMAPS, `CLI_URL` fixed on loopback, the demo
  seeder fixed on loopback, `TRIGGER_TLS_BIND` gone from the example, the status page's publish
  on `WEB_BIND`, `POSTGRES_BIND` defaulting to `0.0.0.0`, and (in `identity-in-the-gate`) one
  port on two addresses counted as a clash.
- **A guard that had to follow.** `scripts/identity-in-the-gate.unit.test.ts` read only a bare
  `${X_PORT:-n}:…` publish. With an address in front it found none, and its own vacuity case
  failed with 4 of 65 red. Its parser now takes `127.0.0.1:` or a bind in front, and a port on two
  addresses counts as one port, not a clash.
- **Checked with Compose itself** (5.1.1, here), with a throwaway `.env` that fills every required
  key with a placeholder. Defaults: every service renders one publish, on `127.0.0.1`. Under
  `-p ownpace-live` with `WEB_BIND`, `ZITADEL_BIND` and `STATUS_BIND` set to `192.0.2.10` and
  `TRIGGER_TLS_BIND` to `192.0.2.20`: those four render two publishes, loopback and the set
  address, and the rest one. `www.yml` renders one publish, and two with `WWW_BIND` set.
- **Departures from §3.** Every port keeps a fixed loopback entry, not only the routed ones, and a
  bind adds an address rather than replacing loopback. §3 gave the non-routed ports the single-bind
  shape Mailpit has. But the smoke asks the dashboard on `127.0.0.1`, the deploy CLI the Trigger.dev
  API on localhost, the seed and `operator.sh` Postgres on localhost, so a bind that replaced
  loopback would break them, the failure `a-publish-that-moved-and-a-caller-that-did-not` records.
  The routed ports' second publish is the port's own `*_BIND`, one key per port, rather than a
  separate front variable, so the owner sets it only where a name is routed. `setup-stalwart.sh`'s
  callers follow its bind, which §3 did not ask for, for the same reason.
- **§1, as of this change.** The eight ports §1 lists as published on every interface, and the demo
  Stalwart's two, are on loopback unless a bind says otherwise. The appliance nightly's Stalwart
  is on loopback too, so the exposure check's note about that run (T3) now concerns its dev
  Nextcloud only.
- **Open, and whose.** The owner's: the merge precondition above; then, after the first gate run,
  `docker ps --format '{{.Names}} {{.Ports}}'` on the machine shows each OTA container on
  `127.0.0.1` and, for the routed ones, the front's address, and `app.ota.ownpace.eu` and
  `id.ota.ownpace.eu` answer (T0 step 1). Separately, the site's recreate from an updated
  checkout, after which `ownpace-www` shows `127.0.0.1` and the front's address and
  `www.ota.ownpace.eu` answers (T0 step 1). Once, after the first reboot with a bind on a mesh
  address in place, the same `docker ps` shows those containers up (T0 step 5; *Which address a
  port answers on* has why and the remedy). The machine's Compose version is not visible from
  here; one without the dedup would pass Docker the loopback entry twice, and `docker compose -f
  deploy/compose/managed.yml config` on the machine shows whether it does. T3 (b) to (d), the
  exposure check, the outside probe and the path written down, are 0131 §6 R7 step 8.

**2026-09-27, later: the review's fixes to T3 (a), on the same branch, not merged.** A review of
the build found a precondition that promised what the gate does not do, three owner steps that
were missing, a new way for a routed container not to start, and three guards that let a
regression through. The entry above is corrected in place; this says what changed.

- **The precondition, in two parts.** No workflow or script runs `www.yml`, and the site is its
  own project, so the gate neither recreates nor removes it. After the merge `ownpace-www` keeps
  its all-interfaces publish, and `www.ota.ownpace.eu` keeps answering whatever `WWW_BIND` says,
  until somebody runs `docker compose -f deploy/compose/www.yml up -d` from an updated checkout.
  So part 1 is the OTA stack's binds before the merge, and part 2 is `WWW_BIND` and that recreate,
  with T0 step 1's check. `STATUS_BIND` is no longer "if a status name is routed": 0142 records the
  OTA status page as reached over the mesh, so it is part 1. `TRIGGER_TLS_BIND` is the IP address
  `TRIGGER_TLS_HOST` names, not "the same address": a host may be a name, and a name in any bind
  fails every compose command against the file (`invalid IP address`, checked with Compose 5.1.1).
- **Live's binds.** The Status said live sets its own at T1b, and no step said so. T1b step 3 now
  asks for `WEB_BIND`, `ZITADEL_BIND` and `STATUS_BIND` (and `TRIGGER_TLS_BIND` only for a
  dashboard opened over the mesh); T1e and T0 step 4 point to it, and T0 step 5 checks live's
  publishes with `docker ps`.
- **A bind on a mesh address ties the container's start to that address.** Docker binds the
  address when it starts the container. After a reboot where Docker starts before the mesh client
  has its address, `web`, `zitadel`, `gatus`, `trigger-tls` and `www` fail with `cannot assign
  requested address`, their loopback publish with them, and a start that failed while the daemon
  restored containers is not retried. An all-interfaces publish never had that dependency.
  `docs/managed-bring-up.md`, *Which address a port answers on*, the `managed.yml` and `www.yml`
  headers and `managed.env.example` say so and name the remedy, `net.ipv4.ip_nonlocal_bind=1` in
  `/etc/sysctl.d/`, or a `docker.service` drop-in ordered after the mesh client that waits for the
  address. T0 step 5 has a check after the first reboot. Not tried on the machine; the owner's.
- **The bring-up refuses a bind that is not an address.** `refuse_a_bind_that_is_not_an_address`
  in `bootstrap-managed.sh`'s `load_env`, before `config -q`, so the gate's `--from data` run
  reaches it too. It reads every `*_BIND` key in the file, `MAILPIT_BIND`, `NEXTCLOUD_BIND` and
  `STALWART_BIND` included, the line in force, and refuses `0.0.0.0`, `::`, anything that is not
  one IPv4 address (a name, three octets, a leading zero, an octet over 255), and `KEY=   # note`,
  which Compose reads as the address. It names the key and never repeats a value that is not an
  address, since the gate's log is public. `0.0.0.0` beside the fixed loopback publish does not
  widen anything: the container cannot bind at all, with Docker's words. The site's `WWW_BIND` is
  read by `www.yml` directly, so only the docs cover it there.
- **The dashboard hint.** `phase_env`'s advice for a laptop, and the decisions a new `.env` asks
  for, name `TRIGGER_TLS_BIND`. `note_dashboard_on_this_machine_only`, also in `load_env`, notes a
  `TRIGGER_TLS_HOST` that is not `localhost` or `127.0.0.1` with an empty bind, without printing
  the host. A note, not a refusal: an SSH tunnel is a way to work.
- **The gate's own seed step** still asks the demo Stalwart on `127.0.0.1` and does not read the
  `.env`. Rather than a second reader, its comment in `e2e-managed.yml` and `setup-managed-demo.sh`'s
  `STALWART_BIND` note say so, and that the OTA `.env` leaves `STALWART_BIND` unset.
- **The guards.** `a-port-published-on-purpose` has 33 cases, up from 13 (34 after the second
  review, below). The example must list `WWW_BIND` too. The demo Stalwart's publishes are read
  inside `docker run` commands only, so a `mkdir -p` is not one: `-p` with its value apart, after
  `=` or attached, alone or after boolean short flags (`-dp V`), and `--publish` apart or after
  `=`, each quoted or not. `-P`, `--publish-all` and a literal host network are refused outright. `CLI_URL`'s host and the seeder's `SEED_IMAP_HOST` must each be a variable taken from the
  bind, which a literal `localhost` or no assignment fails. The refusal and the note have 19
  cases, most of them running the function for real against a `.env` the test writes, and the
  publish reader one of its own. `identity-in-the-gate`'s clash check now reads the
  file with YAML and keys each host port by service: one port on two addresses of one service is
  one port, and the same port under a second service is a clash, with a vacuity case (66 cases).
- **That they failed first.** Against the branch's own `bootstrap-managed.sh` and example, 19 of
  the 33 failed: every refusal and note case. Four mutations passed the old guards and turned the
  new ones red: `WWW_BIND=` removed from the example, `SEED_IMAP_HOST=localhost` in the demo, an
  unquoted `-p ${JMAP_PORT}:8081` added to the demo Stalwart's `docker run`, and the web app's
  loopback publish copied into `gatus` (the old `identity-in-the-gate` 65 of 65 green, the new
  one red).
- **Docs.** In `docs/managed-bring-up.md` the section is `###` and follows the dashboard
  paragraph, which it used to swallow, and the bring-up's phase 2 names the binds.
  *Updating a running deployment* and the runbook's *Upgrade* and TLS-front notes follow the
  two-part precondition and the IP rule. `docs/windows-appliance-runbook.md` cites 0132 T3 once.
- **Still open, and whose.** The owner's: the precondition's two parts, T0 step 1's two checks,
  and the check after the first reboot. The rest is as the entry above says.

**2026-09-27, later still: a second review of those fixes, on the same branch, not merged.** It
found the Stalwart publish reader claiming more forms than it read, and the branch no longer
merging cleanly with `main`.

- **The reader.** It needed `=` or a space after `-p`, so the attached `-p${IMAPS_PORT}:993`,
  which Docker takes, passed; and `-P` (`--publish-all`) publishes every port the image exposes
  on every interface with no value to read at all. The reader now takes the attached form, a `-p`
  after boolean short flags in one cluster (`-dp V`, `-itpV`) and single quotes, and the Stalwart
  case refuses any `docker run` carrying `-P` alone or in a cluster, `--publish-all`, or a literal
  `--network host` / `--net=host`. The vacuity cases cover each form, and the refusal leaves
  `-ePATH=…`, `--network "$NETWORK"` and `--network-alias host` alone. The comments name the forms
  read rather than *every form*. **Failed first:** the new vacuity cases failed against the old
  reader, and four mutations of `setup-stalwart.sh` (an added `-p${IMAPS_PORT}:994`, an added `-P`,
  an added `-dp ${JMAP_PORT}:8081`, `--network host` in place of `$NETWORK`) passed the old guard
  (33 of 33) and turn the new one red. 34 cases.
- **Before the merge.** `main` has moved past this branch's base, and `docs/LESSONS.md` and
  `docs/workplans/README.md`, which both regenerate, conflict. Once T1's branch has merged, `main`
  is merged into this branch (not rebased), both files are regenerated with
  `node scripts/lessons.mjs --write` and `node scripts/workplan-index.mjs --write`, and the unit
  tests are run again after `pnpm install --frozen-lockfile`. A trial merge in a scratch tree
  cleared both conflicts that way, and nothing else conflicted.

**2026-09-27: T6 (b) built, the hold covers every enqueue (0131 §6 R7 step 4).** On branch
`claude/ownpace-public-readiness-y7orc6-a-hold-that-holds-every-door`, not merged. One function,
`enqueueUnlessHeld` in `apps/api/src/enqueue-unless-held.ts`, reads the open hold. While one is
open it answers 409 `platform_held`, with the operator's sentence word for word in `message` and
`reason`, and the hold's start in `since`. Otherwise it hands back the enqueue, which holds the
only `tasks.trigger(` in `apps/api/src`. The eight doors go through it: `/sync`, `/cutover`,
`/discover` and `/start` in `routes/migrations/index.ts`, and `/verify/start`, the two applies and
`/confirm` in `operating-routes.ts`. Each door asks after its own refusals, which still stand once
the hold is lifted. The four that write before they enqueue (*Start*'s activation, the
verification's row, each apply's receipt and its audit row) ask before the first write, so a held
press changes nothing. A press the route itself joins to work already under way enqueues nothing
and is not asked: a second *Start* on an active migration, a running verification, an apply whose
receipt is still queued, a running confirmation. Discovery's join is Trigger.dev's idempotency
key, decided inside the enqueue, so while a hold is open a discovery press is refused even when it
would only have joined a count begun in the last 15 minutes. A hold that cannot be read answers
500, never "no hold" (hard rule 9). When the operator typed no sentence, the door says an English
default, as this API's other refusals are in English; the banner keeps its own default in the
reader's language. The OpenAPI spec documents the 409 at all eight doors.

*The guard*, `apps/api/src/a-hold-that-holds-every-door.unit.test.ts`, 38 cases since the review
fixes below (30 at first). The sweep: the one enqueue call is in the function; no other file
reaches `getTriggerClient().tasks` or `.batch`, or imports the SDK; the function reads the hold
before it hands back the enqueue; the doors that call it are counted, four in each router, against
the table of doors. The doors, over PGlite with both
migration chains: with a Dutch sentence open, each of the eight answers 409 with that sentence,
enqueues nothing, and the four that write wrote nothing; a hold with no sentence answers the
default; a hold that cannot be read answers 500 and enqueues nothing; with no hold, each press
enqueues its task once. The spec: each door's 409 names `PlatformHeld` (and, since the review
fixes, the body each held door sends is valid against it). On `origin/main`, 14 of the
first 22 cases failed: the four sweep cases, the eight held doors, the default and the unreadable
hold. The eight presses with no hold passed, which shows the harness reaches every door. The eight
spec cases, added after, fail against `origin/main`'s spec. Mutations, each red: the confirmation
door calling `tasks.trigger(` itself (4 cases), the function never reading the hold (11), *Start*
asking after it has activated (1), the verification asking after it opened its row (1), an
unreadable hold taken for none (1), the operator's sentence replaced by the default (8), one door's
409 taken out of the spec (1).

Also in the change: four unit tests that press these doors over PGlite now apply the managed chain
too, because the hold is a managed table. Two source-reading guards follow the call's new name
(`the-press-that-answered-202-to-a-closed-ledger.unit.test.ts`,
`scripts/a-verify-that-measured-a-race.unit.test.ts`). The bring-up's *Draining first* says what
the hold now refuses. 0131 §1 and its option (a), 0139's containment step, 0142 §1 and its
incident step 3, and 0143's line on the enqueue sites said a pass started by hand is not held, and
now say it is refused.

*Departures from §3.* Two additions to *"the eight enqueue sites answer 409 with the hold's
sentence"*: a door's own refusals come first, and a door that writes asks before it writes. The
spec is held by the guard too.

*Open, and whose.*
- The appliance has its own enqueue path: `InProcessScheduler` (`schedule`, `runOnce`) in
  `apps/selfhost/src/index.ts`. It has no Trigger.dev, no operator and no `platform_pause`: the
  managed chain is not applied there, and `no-managed-leakage.unit.test.ts` forbids
  `@openmig/managed`. This plan says nothing about the appliance, and there is nothing to hold.
- Scheduled tasks other than the tick do not read the hold: `managed-group-discovery` (06:30
  UTC), `managed-drift-detect` (07:00), `managed-digest` (08:00), `managed-retention` (03:17) and
  `managed-purge-closed` (hourly at :23), by their crons, which name no time zone. A deploy in those minutes drains around them. Whether
  they should is T6's procedure to decide (this plan).
- A cutover that was already running when the hold began still enqueues its final pass
  (`triggerAndWait` in `run-cutover.ts`). That is work in flight, which a drain lets finish.
- The web. Every screen that presses a door shows the 409's sentence, the wizard's *Start*
  included since the review fixes below. The count the wizard's confirm screen starts by itself
  (`ConfirmMigration.tsx`) ignores a refused `discover` and says nothing; the banner above every
  screen carries the sentence. The banner's own line under it (`pause.hold.why`) says new copying
  starts again by itself, which is true of scheduled passes and not of a refused press, and the
  support screen's hint does not tell the operator that the sentence also answers the buttons.
  For whoever next works on those screens; no plan names them yet.

**2026-09-27, later: review fixes to T6 (b), on the same branch.** Five findings, all taken.
- *The spec.* `/start` and `/sync` documented the 409 as `oneOf: [Error, PlatformHeld]`. `Error`
  pins no value of `error`, so a held body matched both branches, and `oneOf`, which wants exactly
  one, refused the answer the door gives. Both are `anyOf` now. The guard's spec cases pressed
  nothing and only looked for the word `PlatformHeld`; each now presses its door with a hold open
  and checks the body against the door's 409, with a small checker of the spec's own words (`ajv`
  is not a dependency of `apps/api`) and two cases proving the checker keeps `oneOf` to one branch.
  Before the fix, 2 of the 8 failed, `/sync` and `/start`. Mutations, each red: `PlatformHeld`'s
  `error` pinned to another value (6 doors and both checker cases), the checker's `oneOf` taking any
  branch (1).
- *The joins.* The rule "a press that only joins work already under way is not asked" was untrue
  for discovery, whose join is Trigger.dev's, inside the enqueue. The module comment and the entry
  above now name the doors whose join the route decides, and say discovery is refused. Six new
  cases hold it: with a hold open, the five presses the route joins (a second *Start*, a running
  verification, a queued receipt for each apply, a running confirmation) answer 200 as before and
  enqueue nothing, and discovery answers 409. They passed on the branch as it was, since only the prose was wrong.
  Mutation, red: *Start* asking the hold on a migration already active (1).
- *The wizard's Start.* It showed axios's *Request failed with status code 409*. It now shows the
  body through `serverMessage`, as the other screens do, which also gives `awaiting_grant` and
  `grant_withdrawn` their sentences there. Guard: a new case in `ConfirmMigration.unit.test.tsx`,
  red before the fix (it read *Could not start it: Request failed with status code 409*).
- *What the operator writes.* The operator's sentence replaces the door's default, which said that
  nothing was started and to try again. A refused press is not remembered: a *Start* refused before
  activation leaves the migration unstarted, and a refused verification, confirmation or apply is
  never queued. So T6 step 2 and the bring-up's *Draining first* now ask for a sentence that says
  nothing starts until the hold is lifted and to press again after, with a Dutch example, and the
  bring-up no longer says nothing is owed a retry.
- *0142 §1* still said a pass started by hand is not held. It keeps that as history and adds that
  it is refused since T6 (b).


**2026-09-27, evening: the task deploy after T3 (a), repaired (M's session, at the owner's ask), on
branch `claude/mailbox-sync-errors-c2xsw2-a-build-that-reached-for-the-lan`, not merged.** E2E
(managed) #201, dispatched on a branch carrying #1236, stopped in the task image's build: the
indexer said *"Failed to fetch environment variables: Connection error"*.

- **Why.** The deploy CLI hands its image build the API origin the server advertises. Trigger.dev's
  CLI 4.5.16 rewrites an origin naming `localhost` to `host.docker.internal` and maps that name to
  the machine's first non-loopback IPv4 address (`normalizeApiUrlForBuild`, `getAddHost`). The
  API port answered there while it was published on every interface. Since T3 (a) it answers on
  loopback only, as the guide says it should.
- **The fix, which publishes nothing more.**
  - `managed.yml` advertises `http://127.0.0.1:<TRIGGER_PORT>`, which the CLI leaves alone. It is
    no longer read from `TRIGGER_API_ORIGIN`, so an existing `.env` naming `localhost` cannot put
    the failure back, and no `.env` needs editing.
  - `deploy-tasks.sh` builds with `--network host`, the CLI's own option for the network of a
    local build's RUN steps (hidden from its help in 4.5.16): the build shares the machine's
    network, where 127.0.0.1 is the API. The CLI recreates its `trigger` builder on the host
    network the first time.
  - `TRIGGER_BIND` stays empty. Setting it to the address the CLI picks would have worked, and
    would have put the API on the machine's LAN.
- **Guard:** `scripts/a-build-that-reached-for-the-lan.unit.test.ts`. It fails on `main`.
- **Docs:** the guide's origin paragraph and a failure-table row, the operator runbook's origin
  rule, and the env example.
- **Still to prove on the machine:** a task deploy with the builder on the host network. A run of
  E2E (managed) on this branch does it before the merge.

**2026-09-27, night: no address in the gate's log (T3's binds), on branch
`claude/ownpace-public-readiness-y7orc6-no-address-in-the-log`, not merged.** A read-only sweep,
each finding checked against a public run, found sixteen places where the gate's public log or its
evidence artifact carries this machine's mesh address, and one where the live-target lane would
print the `LIVE_*` credentials. T3's binds put the address in more publishes; the sweep found it
printed long before them too (E2E (managed) #77, #198, #199, #201). None of it is a secret, so
GitHub hid none of it.

- **Every run, fixed where it is printed.**
  - `e2e-managed.yml`'s last step ran `docker compose ps`, whose PORTS column names every bind. It
    prints name, image, service, age and status now (no PORTS, and no COMMAND, which carries
    zitadel's `--masterkey`); `e2e.yml`'s one `ps` too.
  - `deploy-tasks.sh`: the CLI printed its "View deployment" and "Test tasks" links on the
    dashboard's origin and appended both to `$GITHUB_ENV`, which the runner prints in the header of
    every later step (nine more copies a run). It now runs with `GITHUB_ENV` and `GITHUB_OUTPUT`
    unset, `TRIGGER_DEPLOYMENT_LINK_OUTPUT_DISABLED=1` and `--plain`, checked against 4.5.16's
    `commands/deploy.js`; `--network host` stays.
  - `bootstrap-managed.sh`'s `dashboard:` note and the account phase's "Open" line print an origin
    only when its host is loopback, and otherwise name its key (`shown_origin`).
    `setup-nextcloud-users.sh`'s "External DAV ready at" and its `000` note do the same.
- **On a failure.** `load_env`'s refusal of an unquoted value names the line and the key, never
  the value (#163's line held the address). `explain_failure` filters the container logs and the
  healthcheck's output before printing them, and `setup-zitadel.sh` its two 40-line log tails. The
  smoke filters its own stream before `tee`, so its job log and its evidence file are clean at the
  source, and waits for that filter before it returns, so its verdict is not printed after the
  caller's next line. `redact-evidence.sh` has a second pass for the artifact, which stands down to
  the range if the `.env`'s values make a program sed refuses, so the shape pass still runs. Its
  first pass now reads each value as `env-read.sh` does (a single-quoted secret, or one with a
  comment after it, was searched for as written and never found) and escapes every regex
  character. The filter is `deploy/compose/own-addresses.sh`: each `*_BIND`,
  `TRIGGER_TLS_HOST`, the hosts of `TRIGGER_APP_ORIGIN` and `TRIGGER_LOGIN_ORIGIN` and each entry of
  `NEXTCLOUD_TRUSTED_DOMAINS` becomes the key that holds it (`<MAILPIT_BIND>`), and any address in
  `100.64.0.0/10` becomes `<mesh-ip>`, which also covers another peer's address in an access log.
  Loopback, every interface, empty values and compose service names are left alone. A
  double-quoted value, the form `managed.env.example` gives `NEXTCLOUD_TRUSTED_DOMAINS`, is read
  without its quotes.
- **The mask.** A new step right after the `.env` is restored, before anything reads the stack,
  emits `::add-mask::` for the same values (`own-addresses.sh --mask`). It is the only cover for
  what no script filters: Docker's own error when an `up` cannot bind an address, and a line
  nobody has written yet. It does not reach the artifact or a log pasted from a shell by hand.
- **The credentials.** `e2e-live-target.yml` appended the persisted `LIVE_*` lines to
  `$GITHUB_ENV`, and the next step's header would have printed them, passwords included. The lane's
  one step now reads each key with `env_value`, masks the ones that look like a credential, and
  exports them to its own process. No run was armed yet (the latest said `0 LIVE_* line(s)`), so
  nothing needs rotating unless an older run's "armed from" line says otherwise. The lane still
  announces the catch-all's login and IMAP server, a provider's public host
  (`live-catchall.unit.test.ts` asks for it), and no mesh address.
- **Guards**, both failing on `origin/main` first:
  `scripts/a-public-log-that-named-the-machine-it-ran-on.unit.test.ts` (17 cases: the mask
  run against a fixture `.env`, a double-quoted one too, its place in the workflow parsed from the
  YAML (the step right after the restore), `ps` in every self-hosted job against the fields that
  name no address, the deploy invocation, `shown_origin`, `load_env`, `setup-nextcloud-users.sh`,
  `explain_failure` and `setup-zitadel.sh`'s log tail run with stubs and reaching the helper
  through each script's own source line, the smoke run from its first line through its `exec`, the
  artifact redaction with a name inside a longer one; the first 13 were red on `origin/main`, the
  four added after review red on this branch's first version, the old `ps` rule, or a script with
  its source line removed) and
  `scripts/a-credential-the-next-step-printed.unit.test.ts` (5 cases, 4 red; the fifth proves its
  own pattern is not vacuous, a path handed in through a step's `env:` included; the lane's step is
  run with a `pnpm` that reports what it was handed). `redact-evidence.unit.test.ts` has three more
  cases: a quoted secret with a comment beside another, one full of regex characters, and a `.env`
  whose addresses break the address pass.
  `smoke-managed-verdict.unit.test.ts` now accepts the smoke's `tee` behind the filter.
- **Docs:** `docs/managed-bring-up.md`, *Which address a port answers on*, says the gate's log is
  public and what keeps the binds out of it.
- **Not proved.** A gate run on this branch, its log and artifact searched for the mesh range, is
  the proof that the runner hides the values, that the CLI in `--plain` prints no link and writes
  neither file, and that `sed -u` streams. Runs already published keep the address: every run that
  reached the trigger phase printed it. The owner may delete their logs from each run's page. The
  address is also in commit messages on `main`, which only a history rewrite removes; that is the
  owner's to decide.

**2026-09-27, night: T1g's code half built, on branch
`claude/ownpace-public-readiness-y7orc6-a-gate-that-leaves-the-alpha-alone`, not merged.** The gate refuses live's `.env`, a live `.env` on the OTA
stack's project is refused, and the two documents that said CI and live never share the machine
now say what D7 decided.

- **The gate's refusal.** `deploy/compose/refuse-live-env.sh <env-file>` sources `stack-kind.sh`
  and refuses whatever `stack_may_be_live` takes for live: the marker, other quotes, case and
  spacing, a value nobody listed as not live, a line the reader cannot read. It names
  `STACK_KIND` and `MANAGED_ENV_PERSIST_DIR` and prints no value from the file. With the
  variable set, it says to point it back at the OTA stack's directory or delete it. Empty or
  unset (the workflow always exports it, empty when the repository variable is absent), the
  refused file is the workflow's own default, the OTA stack's, so it says that `.env` carries the
  line: take it out, or list the OTA stack's kind in `STACK_KINDS_NOT_LIVE` (`stack-kind.sh`).
  A missing file or no argument exits 2, not 0. `e2e-managed.yml`'s *Restore the one-time
  setup* runs it on `"${PERSIST_DIR}/.env"` under `set -e`, inside the `if` that finds the file
  and before its first `cp`. Four lines, and the comment above them no longer says the gate never
  reads live's file, in one hunk away from the masking step PR #1264 adds after the restore.
- **A departure from §3: before the copy, not after it.** §3 said *"straight after the restore"*.
  Refused before the copy, nothing of live's reaches the checkout: not the `.env`, not
  `userlist.txt`, and not the persisted CLI login, which the restore copies into the runner's own
  `~/.config/trigger`. It matters for the steps that run `if: always()`. *What state did we leave
  it in?* runs `docker compose ps` from the checkout, and with live's `.env` there (it names
  `COMPOSE_PROJECT_NAME`) that would list live's containers in the public log.
- **Live's `.env` on the OTA stack's project.** `compose_project` (`env-read.sh`) fell back to
  `managed.yml`'s `name:` when the `.env` named no project. It now refuses when the project comes
  out as that name and the `.env` carries exactly live's marker, `stack_is_live`'s rule, whether
  the name came from the fallback, from the file or from a shell that agrees. It names
  `STACK_KIND` and `COMPOSE_PROJECT_NAME=ownpace-live` (T1b), and no value. `stack-kind.sh`
  sources `env-read.sh`, so the reader reads `STACK_KIND_KEY` and `STACK_KIND_LIVE` out of
  `stack-kind.sh` with `env_value`, as data: the `stack-kind.sh` beside the reader's own real
  file (`readlink -f` of `BASH_SOURCE`), not beside the `.env`, so a directory that only links
  the reader in still tells. `stack_kind_clean` moved from `stack-kind.sh` into `env-read.sh`, so
  both compare the marker with one function; every caller of `stack-kind.sh` still has it. A
  reader with no `stack-kind.sh` beside it is refused on the OTA project rather than taking the
  project for it. Nothing else in the reader changed: a shell that disagrees is refused as
  before.
- **No workflow names `ownpace-live`.** That check was already in T1's guard
  (`two-stacks-on-one-box`, *no workflow names ownpace-live*), merged with T1 in #1233. Nothing to
  add; a mutation below shows it still bites.
- **Docs.** The runbook's CI section is now *This box also runs CI — beside live for the alpha,
  and not beyond it*: the rule stands, the alpha is the one exception by the owner's decision of
  2026-09-24, under three conditions (names per project on one Docker daemon, which is not a
  security boundary; the gate refuses live's `.env`; live moves only by hand, from a tag).
  `docs/release.md`'s checklist item says the same. `docs/managed-bring-up.md`: *Which stack a
  command reaches* names the reader's new refusal, the persisted-setup section the gate's, and
  *One stack, one `.env`* no longer says the gate never reads live's file (it reads it once, to
  refuse it). `stack-kind.sh`'s header lists both refusals as built.
- **The guards, and that they failed first.** `scripts/a-gate-that-leaves-the-alpha-alone.unit.test.ts`,
  27 cases: the script run against `.env` files the test writes (12 forms of live's marker
  refused with no value printed and nothing written, its advice with the variable set, empty and
  unset, the OTA `.env` and an empty key passed, a missing file or argument not a pass, no marker
  spelled in the script), and the gate read as YAML and run (the refusal in the restore before
  its first copy, under a `set -e` nothing switches off before the call, with no
  `continue-on-error`; the step's own `run:` block run in a temp checkout under
  `bash -eo pipefail`, which on live's `.env` and one slip of it exits non-zero and copies no
  `.env`, `userlist.txt` or CLI login, and on the OTA `.env` copies all three; no step before the
  restore writes `.env` or reads the persisted directory). Against `origin/main` 23 of the 27
  failed; the four that passed are the ones that find their landmarks or check an order `main`
  already has. `scripts/two-stacks-on-one-box.unit.test.ts` has five new reader cases (44 in
  all): live's marker on the OTA project refused in six situations, the marker with live's
  project is live, only the exact marker is refused (`prod`, empty, commented out pass), a
  missing `stack-kind.sh` is refused, and a reader linked into a directory without one reads the
  marker beside its real file. Against `origin/main` 3 of the 5 failed; the other two describe
  what `main` already did. Eleven mutations, each red: the refusal moved after the copy (1),
  `|| true` after it (1), `stack_is_live` for `stack_may_be_live` (4), the file's kind in the
  message (10), `ensure-env-secrets.sh` in a step before the restore (1), a workflow comment
  naming `ownpace-live` (T1's guard, 1), the reader's marker check removed (2), the reader
  refusing any kind (1), the reader printing the value (1), the reader taking a missing
  `stack-kind.sh` for the OTA stack (1), `set +e` before the refusal and `set -e` after it (3;
  the gate half only read the step's text before the review, and stayed green). The advice's
  two unset cases and the linked reader's case failed on the unreviewed code too. Two fixtures that run a script calling the reader in a
  bare directory (`seed-managed`, `a-recipe-the-env-file-could-not-answer`) and two in
  `two-stacks-on-one-box` copy `stack-kind.sh` beside it now.
- **Open, and whose.** The live-target lane (`e2e-live-target.yml`) reads `LIVE_*` lines from
  the same persisted directory and writes nothing; it has no refusal, and PR #1264 edits that
  step, so it is left for after that merge. T5's refusal of `--with-demo` and T6's
  `deploy-live.sh` are still 📋. On the machine: nothing to do for the OTA stack, whose `.env`
  carries no marker; live's `.env` needs `COMPOSE_PROJECT_NAME=ownpace-live` beside
  `STACK_KIND=production` from its first bring-up (T1b step 2), which the reader now enforces.
- **Beside PR #1264.** Its guard `a-public-log-that-named-the-machine-it-ran-on` runs the
  smoke's preamble in a directory that links `env-read.sh`, `own-addresses.sh` and
  `managed.yml`, and no `stack-kind.sh`. With the reader looking beside the `.env`, its case
  *the smoke filters its own stream…* was refused once both merged, though the text merged
  cleanly. The reader now looks beside its own real file, and on a trial merge of the two that
  case passes. This entry sits after the *evening* one, where #1264 also adds its entry, so the
  second of the two to merge keeps both, the first one's above.

**2026-09-28: T3 (b) and (c) built on branch `claude/ownpace-public-readiness-y7orc6-a-port-nobody-meant-to-open`, not merged.**
The exposure check on the machine, and the probe from outside, dispatch only. T3 (a), the binds,
is on `main` (#1236 and #1253, merged 2026-09-27). (d), the path a tester's request takes and the
forged `X-Forwarded-For`, waits for live to stand (T1b to T1e).

- **The check, (b).** `deploy/compose/exposure-check.sh` reads `docker ps` for every running
  container on the host, so one run covers both stacks, the site and the demo's Stalwart. It
  fails for each port published on every interface (`0.0.0.0`, `::`), whatever `EXPOSURE_ALLOW`
  says, and for each port on an address that is neither loopback (any 127.x address, `::1`) nor
  listed in `EXPOSURE_ALLOW`. It reads that list from the `.env` beside it, or `--env-file`, with
  `env_value`, never from the shell; single or double quotes around it are read too. An entry that
  is not an address, or is every interface, stops it (exit 2), naming the entry's place and not
  its value. A publish it cannot read is a finding. A container on the host's network is named as
  not checked. It prints the container and the port,
  never an address, loopback included; Docker's own error is printed with every address replaced.
  Exit 0, 1 on a finding, 2 on usage or no Docker. `--from <file>|-` reads recorded `docker ps`
  lines instead of asking Docker. `EXPOSURE_ALLOW=` is in `managed.env.example`. T6 and T7 will
  call it; nothing calls it yet.
- **The probe, (c).** `.github/workflows/exposure-probe.yml` runs on `workflow_dispatch` only (open
  question 6's proposed answer), on `ubuntu-24.04`, GitHub-hosted like the repository's other
  hosted jobs, never the self-hosted runner. Its one step runs `scripts/exposure-probe.mjs`. That
  resolves the three production names and the three OTA names, and tries every port on each
  address they resolve to, and on the machine's own address when the secret `EXPOSURE_PROBE_HOST`
  holds it. The ports come from `scripts/exposure-probe-ports.mjs`, which reads them from
  `managed.yml`, `www.yml` and `setup-managed-demo.sh` (13 today) and refuses a publish it cannot
  read, plus live's own from the repository variable `EXPOSURE_PROBE_LIVE_PORTS`, without which the
  probe does not run. It passes when 443 on each production name answers over TLS, the discovery
  document at `id.ownpace.eu` names `https://id.ownpace.eu`, and no tried port accepts a
  connection. The OTA names follow the dispatch input `ota_names` (open question 7, unanswered):
  `report`, the default, records what answered; `internet` requires TLS on 443; `mesh-only`
  requires no answer. Every address and the secret are masked before anything else is printed. A
  finding names the names and the port, the machine's own address by the secret's name, and an
  error by its code. An address the runner cannot reach (a hosted runner has no IPv6 route) is
  reported as not tried, never as closed.
- **The guards, and that they failed first.** `scripts/exposure-check.unit.test.ts`, 21 cases, all
  red on `main` (no script). `scripts/a-probe-that-knows-every-port.unit.test.ts`, 10 cases, and
  `scripts/exposure-probe.unit.test.ts`, 24 cases, did not load on `main` (neither module existed).
  The first fails when `managed.yml` or `www.yml` publishes a port the probe does not try; a
  synthetic extra port in each file proves it. Thirteen mutations each turned a guard red: a
  schedule trigger, a self-hosted runner, a port written in the workflow, the derivation without
  `www.yml`, the long syntax skipped, `::` read as an ordinary address, an address in a finding
  (in the check, and in the probe), an unreadable publish passed, `EXPOSURE_ALLOW` read from the
  shell, the masks removed, an unreachable address called closed, and the issuer ignored.
  `two-stacks-on-one-box`'s rule that every `docker ps` filters by the project now exempts
  `exposure-check.sh` by name, and fails if that file is gone.
- **Docs.** `docs/managed-bring-up.md`, *Which address a port answers on*, has a paragraph on both;
  `docs/testing.md` lists the workflow.
- **For the owner, before the first check and probe.** `EXPOSURE_ALLOW` in each stack's `.env`:
  every address any container on the machine is published on on purpose, not only that stack's,
  because the check reads the whole machine. That is both stacks' `*_BIND` values, the site's
  `WWW_BIND` and the demo's `STALWART_BIND`, separated by commas with no space; a bare space is a
  line the bring-up refuses. The repository variable `EXPOSURE_PROBE_LIVE_PORTS`: live's `*_PORT`
  values. The secret `EXPOSURE_PROBE_HOST`, if the machine has a public address of its own. Open
  questions 6 and 7 stay open: the workflow takes 6's proposed answer and leaves 7 to the input.
- **Not proved.** Neither has run on the machine or on GitHub. The probe's TLS and discovery calls
  have no test against a real server; its TCP connect is tested against a port on the test
  machine. 0135's check that the registration page answers 404 is not in the probe yet.

**2026-09-28: T6 (a), `deploy-live.sh`, built with 0146 T5 (a), on branch
`claude/ownpace-public-readiness-y7orc6-a-deploy-from-a-named-tag`, not merged.** Nothing has run
on live, which is not stood up (T1b); the script has run only against the stubs in its guard.

- **What it runs.** `deploy/compose/deploy-live.sh <tag>`, from live's checkout, runs steps 3 and 5
  to 7 of the procedure and writes step 9. It checks the drain; it does not wait for it. Then
  `git fetch --tags origin`, `git checkout --detach <tag>`, `pnpm install --frozen-lockfile`, and
  `bootstrap-managed.sh --from data`, never with `--with-demo`. The bring-up takes `GIT_SHA` from
  `git rev-parse HEAD`, which the script checks is the tag's commit before it calls it. Then the
  checks, at the origin in live's `WEB_URL` (the address browsers use for the web app, as
  `managed.env.example` says), never printed: `/api/version` names the tag's commit and its version,
  `/api/ready` answers 200, `/api/auth/mode` answers `managed`, and `exposure-check.sh --env-file
  <live's .env>` passes. It does not open the hold, take the dump of step 4, or lift the hold: step
  8 stays the owner's, after looking.
- **What it refuses**, before the checkout or the stack changes, each with its own message and
  exit 1: `--with-demo` anywhere in its arguments; a `.env` without live's marker (`stack_is_live`,
  so a slip of the marker is refused too, and its value is never printed) or without an http(s)
  `WEB_URL`; `COMPOSE_ENV_FILES` or `COMPOSE_FILE` in the shell; a project the reader refuses, or
  one Compose reports differently; a working tree that is not clean, untracked files included; a
  ref that is not a tag, a name that is no tag here or on origin, a tag not on origin
  (`git ls-remote --tags origin`), a tag here that is not origin's, a lightweight tag, a tag not
  named `v…`, and a tag whose commit's root `package.json` version is not the tag without its `v`
  (it names both); each of those says 0146's *"live runs releases: name a release tag"*. Then the
  database: an answer it cannot read, which is never taken for nothing in flight (hard rule 9); a
  role row security would bind; no open hold; a pass in flight; and a hold under five minutes old.
  Last, a deploy log it cannot append to (below).
- **The drain, read.** One `SELECT` over `docker compose exec postgres`, psql over the container's
  own socket as the owner the postgres image created, as `rehearse-capacity.sh` does. It composes
  no connection string, so `docs/rls-guide.md` §2's list, which is of scripts that do, has no row
  for it, and `a-connection-the-docs-did-not-know-about` stays as it was. The hold is the row of
  `platform_pause` with `ended_at IS NULL` (managed migration 0023); the in-flight count is the
  tick's own, `running` rows younger than `STALE_RUN_AFTER_MS`, written in the script as
  `STALE_RUN_AFTER_SECONDS=7200`, which the guard ties to the tick's constant. It also reads
  whether the role is a superuser: `run` is FORCEd, and a bound role would count 0.
- **One-way or reversible (0146 T5).** Before the checkout moves, and again at the end, it says
  whether the deploy can be undone by deploying a tag this stack has run again. It compares the
  new tag with the running tag, the one the log's last `took` line names; with every deploy since
  that did not take, whose bring-up may have run and whose API applied its migrations when it
  started; and with the checkout's `HEAD` when no line names it (with an empty log, the only one).
  One-way: against any of them, a file in `packages/ledger/migrations` or
  `packages/managed/migrations` added, changed or removed, or an `image:` line naming
  `triggerdotdev/` or `zitadel/zitadel` in `managed.yml` different at the two, or either of those
  that cannot be read. Otherwise reversible. With no deploy that took, what ran before the log's
  first line is named nowhere: when that first deploy was one-way over it, the next is one-way
  too; when it was reversible, its chains and pins were the same, and its own line stands in.
- **The log.** `${MANAGED_ENV_PERSIST_DIR:-~/.persistent/<project>}/deploys.log`, so
  `~/.persistent/ownpace-live/deploys.log` on live, T1's rule for the persisted directory. One
  tab-separated line per deploy that got as far as the checkout: the UTC date, the tag, the commit,
  `took` or `did-not-take`, `one-way` or `reversible`. A refusal is not logged. A failed
  installation, bring-up or check logs `did-not-take`, says the hold stays on, and exits 3. The
  log is checked for an append before the checkout moves. A line that still cannot be written at
  the end is printed for the owner to add by hand, after what the script says about the deploy,
  and the exit stays the deploy's, 0 or 3.
- **NODE_ENV (T4).** Not built: `managed.yml` still has `NODE_ENV: ${NODE_ENV:-development}` for
  the API, and no check reads it. The script does not invent one; it prints that NODE_ENV is not
  checked and why.
- **The guard, and that it failed first.** `scripts/a-deploy-from-a-named-tag.unit.test.ts`, 61
  cases as first built (83 since `--dry-run`, 84 with the one-line exit, below). Each builds a checkout of its own: a real git
  repository with a bare origin beside it, whose commits carry the script, `env-read.sh`,
  `stack-kind.sh`, the real `managed.yml`, a file in each chain, and two stand-ins committed beside
  the script, `bootstrap-managed.sh` (it records its arguments and the commit checked out when it
  ran) and `exposure-check.sh` (T3 (b), on `main` since #1271, merged 2026-09-28, with its own
  guard; the stand-in lets a case make it fail). `docker`, `psql`, `curl` and `pnpm` are stubs on
  the PATH; the `docker` stub runs the script's own psql command line against the `psql` stub, which
  answers a fixture, or, in the last block, hands the SQL to PGlite with both chains applied. It
  drives: seven ref refusals (a branch, a commit, no such tag, lightweight, not on origin, not `v…`,
  a `package.json` naming another version, both named); nineteen refusals of the stack, the checkout
  and the moment (four `.env`s without the marker, no `WEB_URL`, a changed and an untracked file,
  `--with-demo` in three places, `COMPOSE_ENV_FILES`, no hold, three in flight, a new hold, three
  unreadable answers, a bound role, a deploy log it cannot append to), each checking that the
  checkout did not move and that nothing was installed, brought up, asked, checked or logged; the
  deploy that took (detached at the tag, `pnpm` before the bring-up, `--from data` only, at the
  tag's commit, the three paths in order at `WEB_URL`'s origin, the exposure check with live's
  `.env`, only `SELECT`s sent, the hold still on, one log line of five fields, the origin never
  printed), the note when a deploy left the tree changed (and the next run's refusal of it), and a
  second deploy after the first; twelve deploys that did not take (right commit and wrong version,
  wrong commit, `unknown`, no answer, `/api/ready` 503, another auth mode, the exposure check
  failing or absent from the tag, the bring-up failing or stopping for the owner, `pnpm` failing),
  each keeping the hold, exiting non-zero and logging `did-not-take`; a log line that cannot be
  written at the end, after a deploy that took (exit 0) and one that did not (exit 3), each saying
  so and printing the line; one-way for a file in either chain and for either pin moved (on the real
  `managed.yml`), reversible for neither, the running tag taken from the log and not only from what
  a failed deploy left checked out, a deploy that did not take since compared too (A took, B with a
  migration did not, A again is one-way), every such deploy and not only the one checked out, the
  checkout's `HEAD` when no line names it, and with no deploy that took, a first deploy that was
  one-way keeping the next one-way and a first reversible one not, and that the script's chain list
  names the repository's two; and over PGlite, no hold, only a lifted hold, a lifted hold beside an
  open one two minutes old, a pass five minutes old, a `running` row three hours old not waited for
  (and the hold still open afterwards), and the staleness window. Without the script all 61 failed
  (`ENOENT` on the copy). Mutations, run against the first build's script: twenty-seven, each red:
  the lightweight check dropped (1 case), the not-on-origin refusal dropped (1), `package.json`'s
  version not compared (1), `/api/version`'s version not compared (1), an unreadable database taken
  for nothing in flight (1), an answer of another shape accepted (2), the in-flight count not
  checked (2), the hold's age not checked (1), a missing hold not checked (2), the role not checked
  (1), `--with-demo` passed through to the bring-up (3), the bring-up run with `--with-demo` (1),
  the script lifting the hold (2), one chain compared (2), the identity-provider pin not compared
  (1), the running tag taken from `HEAD` (1), `stack_may_be_live` for `stack_is_live` (2), a tree
  that is not clean accepted (3), untracked files not counted (1), the note after a deploy that
  changed the tree dropped (1), `did-not-take` logged as `took` (10), a deploy that did not take
  exiting 0 (12), the origin printed (8), a failed exposure check ignored (1), `/api/ready` not
  checked (1), the auth mode not compared (1), the staleness window mistyped (1).
- **Review, the same day: three findings, all applied.**
  - *A rollback after a deploy that did not take was called reversible.* Took A, then B with a
    migration did not take after its bring-up ran, then A: the script compared A with A alone and
    said reversible, though B's API had applied the migration and A's refuses that schema. It now
    compares with every deploy that did not take since the last that took and with the checkout's
    `HEAD`, and names each; with no deploy that took, the rule above for the log's first line.
  - *The hold's `ended_at IS NULL` was pinned by no case.* The PGlite block now has a table with
    only a lifted hold (refused: no hold is open) and one with a lifted hold beside an open one
    two minutes old (refused on its age), the state live is in after its first lift.
  - *A deploy log that could not be written made a deploy past the checkout exit 1*, which says
    refused and as it was, and hid that the deploy did not take and that the hold stays on. The
    log is checked before the checkout; the outcome is said before the line is written, and a
    line that cannot be written is printed, with the outcome's exit.
  - Mutations of the new code, eleven, ten red: deploys that did not take not compared (2
    cases), `HEAD` not compared when a deploy took (1), only the last `took` compared, the first
    build's rule (3), no rule for the log's first line (1), that rule after a reversible first
    line too (1), the awk counter left uninitialised (1), the log's check before the checkout
    dropped (1), a log that cannot be written ending the run (2), lifted holds counted as open (1),
    and in both subqueries (1). One survives: `ended_at IS NULL` dropped from the hold's age
    alone. No state the application can reach tells the two apart: 0023's partial unique index
    keeps one hold open, so every lifted hold began before it, and the newest `started_at` is the
    open one's either way.
- **Later the same day: `--dry-run`, two refusals pinned, and #1271 on `main`.** Still only
  against the guard's stubs; nothing has run on live.
  - *`--dry-run`.* `deploy-live.sh --dry-run <tag>` (the flag anywhere in the arguments, beside
    the tag) runs everything the deploy runs before the checkout: every refusal above, the
    `git fetch --tags origin` of step 5, and one-way or reversible, by the same
    `comparison_bases` and `compare_releases` over the same log and `HEAD`, comparing through
    git's objects. Then it prints `dry run: a deploy of <tag> now would be one-way|reversible.`,
    for one-way that a dump taken now, with the hold still on, is the way back that is not
    forward, and that it stopped before the checkout, and exits 0. It checks nothing out and runs
    no `pnpm install`, no bring-up and no check; it writes no line to `deploys.log` and does not
    create it or its directory: whether the log can be appended to it asks of the file, or of the
    nearest directory that exists (`log_appendable`; the deploy still makes both with an empty
    append, as before). A refusal exits 1, as in the deploy. The header, `--help` and the usage
    line say so. It is the owner's step 3 now (*Docs*, below).
  - *The one-line exit.* The script ends `main "$@"; exit $?` on one line. The checkout replaces
    `deploy-live.sh` with the tag's copy while it runs, and bash reads a script as it goes, so a
    line after `main` would be read from the tag's file. A case holds it; splitting the line fails it.
  - *Guard cases, 61 to 83.* Twenty for the dry run: on a tag that agrees, with the flag before
    and after the tag (exit 0, the verdict, the line that it stopped; `HEAD`, `git status` and the
    deploy log as they were, the log not created, and no `bootstrap`, `pnpm`, `curl` or exposure
    check called); after a deploy that took (compared with it from the log, the log byte for byte
    as it was, one bring-up in all); fourteen refusals the deploy makes, still made in a dry run,
    each exit 1 with its message and no verdict (no hold, a pass in flight, a hold under five
    minutes, an unreadable database, a bound role, a lightweight tag, a tag not on origin, another
    `package.json` version, no marker, an untracked file, `COMPOSE_FILE`, a project Compose
    reports differently, a log it cannot append to, `--with-demo`); and one-way for a tag adding a
    migration to either chain and reversible for one adding none, each followed by the real deploy,
    whose log line carries the same verdict. Two for refusals the script had and no case drove:
    `COMPOSE_FILE` in the shell, and `docker compose config` reporting `ownpace-managed` where the
    checkout chooses `ownpace-live` (refused after the one `config` call, before any `psql`).
  - *Failed first.* On the script without the flag, nineteen of the twenty-two failed (`unknown
    option '--dry-run'`, exit 2). Three passed, as they should: the two refusal cases, which pin
    refusals that were already there, and the dry run's `--with-demo`, refused before any option
    is read.
  - *Mutations, ten, each red.* A dry run that checks the tag out before it stops (6 cases), that
    skips the no-hold refusal (1), the in-flight refusal (1) or the lightweight-tag refusal (1),
    that appends a line to the log (6), that uses the deploy's log check, which creates the file
    (5), that calls the bring-up (6), that stops before the verdict (6); `COMPOSE_FILE` dropped
    from the shell refusal (2: the new case and its dry-run twin); the reported-project refusal
    dropped (2). Without either refusal the deploy went through, exit 0.
  - *#1271 merged* on 2026-09-28, so `exposure-check.sh` is on `main`; T3 (b)'s entry above says
    nothing calls it yet, and on this branch `deploy-live.sh` does, after every deploy. What is
    left before it can pass on live is the owner's (*Open*, below).
- **Departures from §3.**
  - `pnpm install --frozen-lockfile` before the bring-up. Step 6 does not name it, and
    `--from data` skips the preflight; the task deploy builds from the checkout's `node_modules`,
    and `deploy-tasks.sh` refuses only an SDK that differs from the pin.
  - A hold under five minutes old is refused (`DEPLOY_LIVE_QUIET_MINUTES`). The tick enqueues a
    pass without writing a row, so a pass queued just before the hold is in no count until it
    starts (the same finding as `rehearse-capacity.sh`'s).
  - It also refuses what §3 did not list: `COMPOSE_ENV_FILES` and `COMPOSE_FILE` in the shell, a
    tag here that is not origin's, a role row security would bind, and an answer it cannot read.
  - A changed or removed migration file counts as one-way, not only an added one, and so does a
    running commit or a pin that cannot be read: the error errs towards no way back.
  - git in the guard is real, against a temporary repository and a bare origin, not a stub, so
    tags, `ls-remote` and the diff behave as on the machine.
  - The whole run is one function, read before it starts: the checkout replaces the script's own
    file with the tag's copy.
  - The checks ask the origin in live's `WEB_URL`, not the name step 7 writes out; on live that
    is `https://app.ownpace.eu` (T1e).
  - `--dry-run` is not in §3: step 4's dump is the owner's call, and the verdict it depends on was
    otherwise printed only by the run that moves the checkout.
- **Docs.** `docs/managed-bring-up.md`, *Updating a running deployment*, opens with *`ownpace-live`:
  a release tag, with `deploy-live.sh`* (the owner's five steps, what the script refuses and
  checks, one-way or reversible, the log), and the pull that follows is now *The OTA stack: the
  nightly gate, or a pull*. `docs/release.md` has a §5, *Deploying a release to ownpace-live*. The
  runbook's *Upgrade* says which stack is deployed how, points to both, and no longer promises a
  gated migration step or a backup nobody takes. The architecture document's managed release
  controls say staged rollout and a backup before migrating are not built, as
  `docs/deployment.md` does (this task's first paragraph), and that the migrations run when the
  API starts. `stack-kind.sh`'s header lists the script as built. Since `--dry-run`: the live
  subsection's step 3 is the dry run, then a dump if it says one-way; *Draining first, and telling
  customers why* says its step 3 on live is `deploy-live.sh` with a release tag, never a pull; the
  live subsection says what the exposure check needs (`EXPOSURE_ALLOW`, a tag that has the
  script) and what `--dry-run` does; *Which address a port answers on* says `deploy-live.sh` runs
  the check; `docs/release.md` §5 has both as checklist items; the runbook's *Upgrade* names the
  dry run.
- **Open, and whose.** The owner's, before the first deploy: live stood up (T0, T1b to T1e), the
  first release tag (0146 T0, T2), and `EXPOSURE_ALLOW` in live's `.env`. The exposure check is on
  `main` since #1271 (merged 2026-09-28); it reads the whole machine, so the list is every address
  other than loopback that any container on it is published on on purpose, or the check fails
  for each. The tag must be cut from a commit that has `exposure-check.sh`: the script runs the
  tag's own copy, and a tag without one cannot pass. Then, per deploy: the hold, the drain,
  `--dry-run`, a dump if it says one-way and a way back is wanted, the script, the look, the
  lift. Deferred to 0146's open question 6: `--external-id <tag>`
  on the task deploy (0146's entry says why). T5's own refusal of `--with-demo` inside
  `bootstrap-managed.sh` is still 📋; this script refuses it only in its own arguments. A run of
  `deploy-tasks.sh` strips `apps/worker/package.json`'s last newline (its own NOTE), which would
  make the next deploy refuse a tree that is not clean; the script says so after a deploy that
  left the tree changed, and names the file in its refusal. Unchecked: that the machine reaches
  its own public name for the checks (they ask `https://app.ownpace.eu` from the machine, through
  the front T1e routes). If it does not, every check fails and the script says which.

**2026-09-28: T7 built on branch `claude/ownpace-public-readiness-y7orc6-a-duty-the-gate-used-to-do`, not merged.**
What the gate does for the OTA stack now has a script that does it for live, and a timer to run it.
Nothing has run on the machine, and live does not stand yet. Rebased onto `main` after #1271 (T3 (b)
and (c), the entry above) merged, with a review's five findings taken (the last bullet).

- **`setup-zitadel.sh --token-only`.** The provisioning token's clock and nothing else: it waits for
  the provider, reads the token, asks when it dies, replaces it in its last three of seven days
  (mint, prove, land, read back, delete, as before), writes `ZITADEL_PAT_EXPIRY`, and stops. It does
  not run `ensure-env-secrets.sh`, the network alias or `up -d zitadel`, and nothing after the
  clock. The clock was already one straight run in the script, so the change is three `if [ -z
  "$ONLY" ]` guards and one stop, not a new function.
- **`setup-zitadel.sh --count-organisations`.** 0135 T3 (a) (#1272) built the count as two functions
  inside the full run, not a mode, so this is that code exposed: the two functions moved above the
  clock, unchanged, and the mode stops there. Read-only: it asks who the token belongs to and `POST
  /admin/v1/orgs/_search`, writes nothing, not even the token's note, and exits non-zero unless the
  count is one. That is stricter than T7's "above one": zero (proto3 leaves a zero out) and a
  refused search fail too. The full run still warns and goes on.
- **The default run is unchanged.** Main's `setup-zitadel.sh` and this one, run side by side against
  the same stand-in provider in six situations (token within policy, token due, one, two and no
  organisations, and the organisation search refused; four of them to the end of the script),
  printed the same stdout and stderr, made the same API and Docker calls, and left the same `.env`
  and token, once dates and generated secrets are normalised. The only other change a caller can see
  is the unknown-argument message, which now lists the two modes. The existing guards on the script
  pass.
- **`deploy/compose/box-duties.sh`.** Four duties, each run whatever the one before did: `token`
  (`setup-zitadel.sh --token-only`), `drill` (`trigger-version.sh drill`), `exposure`
  (`exposure-check.sh`, T3 (b)) and `organisations` (`setup-zitadel.sh --count-organisations`). The
  token goes first so the count asks with a live token. A duty that fails, is missing from the
  checkout or runs past 20 minutes (`BOX_DUTY_TIMEOUT`) is recorded; the script exits 1 naming every
  failed duty, 0 when all pass, and 2 when it refused before any ran. It refuses a `.env` without
  live's exact marker (`stack_is_live`): the OTA stack's duties are the gate's, a second drill there
  would write a second set of secret-bearing dumps, and on the OTA instance 0135 T3 makes the count
  a warning, not a failure. It also refuses when `compose_project` does, and any argument. It unsets
  `MANAGED_BACKUP_DIR`, `MANAGED_ENV_PERSIST_DIR` and `TRIGGER_DB_CONTAINER`, so the dumps go to
  `~/.persistent/ownpace-live/trigger-backups` whatever a shell exported, and sets `umask 077`: the
  dumps carry the plane's API keys and the encrypted task environment, and it never prints them.
  Every duty's stdout and stderr go through `own_address_redact`, by a named pipe. It writes plain
  stdout and stderr, which the service hands to the journal (`SyslogIdentifier=ownpace-box-duties`),
  with a failure line at the error priority when stderr is the stream `JOURNAL_STREAM` names, rather
  than `logger`, so a run by hand prints the same lines. Ctrl-C or a SIGTERM stops the running duty
  (SIGTERM to the process group `timeout` puts it in, and SIGKILL ten seconds later), prints what it
  said to the end, names it, starts no other and exits 130 or 143.
- **The timer.** `deploy/compose/systemd/ownpace-box-duties.service` and `.timer`, a user unit pair
  (`systemctl --user`, `loginctl enable-linger` once), `WorkingDirectory=%h/ownpace-live`, daily at
  13:17 UTC with `Persistent=true`. The appliance nightly fires at 23:30 and 01:30 UTC (`e2e.yml`)
  and GitHub has dispatched it up to five hours late, so 13:17 leaves more than seven hours (five
  late, two for a run) after the latest it has started, and a run as long as `TimeoutStartSec` (90
  minutes) ends more than eight hours before the next firing. `docs/managed-bring-up.md`, *Live's
  daily duties*, carries both units word for word, the install steps, how to read the journal, and
  T7's interim, now `setup-zitadel.sh --token-only` at least every three days. `systemd-analyze
  verify` accepts both units here (system mode, with the path filled in; a user manager is not
  available here).
- **The guard, and that it failed first.** `scripts/a-duty-the-gate-used-to-do.unit.test.ts`, 44
  cases; on `main`'s code (after #1271) 37 fail and 7 pass (the rule's five, a baseline that the
  default run reaches the project, and the time-span reader). The rule reads every `run:` block of
  `e2e-managed.yml` for the scripts under `deploy/compose/` in command position, with the first bare
  word as a subcommand, and classifies each in a closed table. Maintenance is what a stack whose
  code never changed would still need: `setup-zitadel.sh` (its form for live, `--token-only`) and
  `trigger-version.sh drill`. Not maintenance: `env-read.sh`, `refuse-live-env.sh`,
  `own-addresses.sh`, `ensure-env-secrets.sh`, `env-upsert.sh`, `bootstrap-managed.sh`,
  `smoke-managed.sh` and `redact-evidence.sh`. An unclassified command and a stale entry both fail.
  It does not see a duty written inline in a `run:` block. Then `box-duties.sh` in a staged checkout
  with stubs beside it, both new modes against a stand-in provider (`curl` and `docker` on PATH),
  the count end to end through `box-duties.sh` with the real `setup-zitadel.sh`, and the units
  against the doc and `e2e.yml`'s crons. Twenty-three mutations each turned it red: stopping at the
  first failure, the full script for `token`, naming only the last failure, no marker refusal,
  `stack_may_be_live` for it, the drill taking the shell's directory, no address filter, no umask,
  no journal priority, the priority on `JOURNAL_STREAM` alone, a missing script passing, the count
  before the token, `--token-only` going past the clock, generating secrets or starting the
  provider, the count passing above one or on a refused search, the count after the clock, the timer
  at 03:17, the timer not persistent, a unit drifting from the doc, the gate gaining an unclassified
  command, and the gate losing the drill. After the review, twelve more: no signal trap, a filter a
  Ctrl-C kills, a handler that does not stop the duty or goes on to the next, a duty's stderr not
  filtered or dropped, `timeout --foreground`, the timer at 23:25, `TimeoutStartSec` of 12 hours or
  `infinity`, and, rerun on the reworked script, no address filter and stopping at the first
  failure.
- **Found, and left as it is.** In a full run, `count_organisations` reads the search through a
  here-string, so a refused search prints `FATAL` and the run goes on and exits 0 with an empty
  count: `THIS INSTANCE HOLDS  ORGANISATIONS`, and `organisations  (one is right…)` in the summary
  (seen on `main`'s script with the stand-in answering 403). The mode above fails on it; the full
  run is left as it is, because this change keeps the default run byte for byte. 0135 T3 has the
  note.
- **Waits for.** Live standing (T1b to T1e), deployed from 0146 T0's tag, and the owner installing
  the timer (the bring-up's steps), then one `systemctl --user start ownpace-box-duties.service`
  read back in the journal. `exposure-check.sh` is on `main` (#1271); `EXPOSURE_ALLOW` in live's
  `.env` is the owner's step, and without it `exposure` fails by name. Nobody is told when a duty
  fails; 0142 is where that changes. A run of `deploy-live.sh` (T6, not built) and a drill at the
  same moment are not kept apart.
- **The review's findings, all five taken.** (1) A Ctrl-C in a run by hand stopped nothing: the duty
  sat in `timeout`'s own process group, ran on, and the next duties started, the drill on live's
  database among them; now the script stops it, as above. (2) The guard could not see a duty's
  stderr skip the filter; the stub now says an address on each stream. (3) The timer check measured
  only the gap after each nightly firing; it now also requires a whole run (`TimeoutStartSec`, read
  from the unit) to end before the next one. (4) This rebase. (5) The daily drill changes what
  `trigger-version.sh restore --latest` restores after an upgrade: the first drill after it dumps
  the migrated schema, and pruning to seven removes a labelled `before-` backup after seven days.
  The bring-up now says, in *Live's daily duties* and beside the upgrade commands, to restore that
  backup by its file name and to copy it aside before the upgrade, and T6's step 4 says the same.
  `trigger-version.sh` is unchanged: the OTA stack's gate drills nightly already.

**2026-09-28: the web after T6 (b), built on branch
`claude/ownpace-public-readiness-y7orc6-a-hold-that-says-what-it-did`, not merged.** The T6 (b)
entry left three gaps on the screens "for whoever next works on those screens" (*Open, and
whose*, the web). The owner asked for them to be built.

- **The count the confirm screen starts.** `ConfirmMigration.tsx` started discovery on mount and
  dropped the answer. While a hold is open that answer is the 409 with the operator's sentence,
  and nothing is counting, but the screen went on saying *Scanning your source*. It now keeps a
  refusal and shows it through `serverMessage`, as its refused *Start* does, after *Counting did
  not start:* (`confirm.countError`, EN and NL). Any other refusal of the count shows its own words
  the same way. Under a refusal, with no rows landed, the scanning line is not shown. A count begun
  before the hold still lands, and its rows show above the refusal.
- **The banner's fold.** `pause.hold.why` said new copying starts again by itself once the update
  is done. That is true of the scheduled passes, not of a press the hold refused, which is not
  remembered. It now says scheduled copying starts again by itself, and that anything started
  while copying was paused did not start and must be started again after the update. EN and NL.
- **The operator's hint.** `support.hold.hint` now says the buttons are held too. Its fold,
  `support.hold.hint.why`, says the message is also the answer, word for word, to every button a
  customer presses while the hold is on, and that nothing started that way is remembered. So it
  asks for when copying resumes and to try again after, with step 2's example: the Dutch one in
  NL, the same in English in EN.
- **Comments.** `enqueue-unless-held.ts` said the confirm screen ignores the refusal. It now says
  the screen shows it. `PausedBecause.tsx` says why the hold's fold names a second press.
- **Guards**, in the existing web tests. `ConfirmMigration.unit.test.tsx`, three cases: the
  sentence shows when `discover` answers 409, the scanning line is gone when nothing landed, a
  count that lands still shows. `PausedBecause.unit.test.tsx`, two per language: *by itself* is
  said only of scheduled copying, and the fold says a press made during the hold did not start and
  must be made again. `Support.unit.test.tsx`, three per language: the visible hint names the
  buttons, the fold says the sentence answers them word for word, and it asks for when copying
  resumes and to try again. All 13 were red before the change. Mutations, each red: the count's
  refusal shown as axios's text (1), the refusal swallowed again (3), the scanning line kept over
  a refusal (1), rows hidden behind a refusal (1), the EN fold back to *new copying* (1), the NL
  fold without its second press (1), the NL operator fold without *woord voor woord* (1), the EN
  visible hint back to what it was (1).
- **Not changed.** The box's placeholder, *Back in about an hour.*, still names no retry. The
  bring-up's *Draining first* already asks for the sentence the fold now asks for.

**2026-09-28, later: review fixes to the web after T6 (b), on the same branch.** Four findings,
all taken.
- *The count, once the hold lifts.* The refused count's line stayed after the hold was lifted, and
  nothing on the screen could count again: the count has no button, and *Start* with no rows
  landed skips the refused-files tick (`needsAcknowledgement([])` is false). Only a reload counted
  again. While a count stands refused the screen now reads the hold the banner reads (the same
  `['platform-pause']` query and cache). When a hold it saw open is lifted, it clears the line,
  counts again and starts the polling's five minutes afresh. While the hold is still on, the line
  adds *This screen counts again by itself once copying resumes.* (`confirm.countAgain`, EN and
  NL). A refusal with no hold open (a server fault, a migration not found) is not asked again and
  makes no such promise.
- *Every button, which it was not.* The operator's fold said the message answers every button a
  customer presses while the hold is on. Pausing a migration (`PUT /:mappingId`) and adding a data
  type (`POST /:mappingId/domains`, which enqueues nothing) are not refused, and the count is
  started by the screen, not by a button. The fold now says every button that would start work,
  as step 2 does, and names *Trigger sync*, *Start migration* and a check (NL *Synchroniseer nu*,
  *Start migratie*, een controle), without the count. The banner's second sentence is narrowed the
  same way: *Any copying you tried to start during the pause did not start: start it again after
  the update.* (NL *Kopiëren dat u tijdens de pauze probeerde te starten, is niet gestart: start
  het na de update opnieuw.*).
- *Guards that passed the opposite.* The banner's guard checked fragments, so a line saying a
  refused press starts again by itself passed it. The operator hint's guard checked keywords, so a
  fold denying both claims passed it. Both now pin the sentences word for word in EN and NL: the
  banner's two sentences, and the hint, the sentence about the buttons and the example (in NL,
  step 2's verbatim). A third banner case keeps *by itself* to the scheduled sentence, and a
  third hint case checks the named buttons are the labels the hold refuses. Both opposite-meaning
  lines from the review are now red, as are *every button a customer presses* and the count back
  in the list. `ConfirmMigration.unit.test.tsx` gains two cases: the screen counts again when the
  hold it saw lifts and says so while it is on, and with no hold open it neither promises nor asks
  again. Mutations, each red: no count on the lift, the promise shown without a hold, the promise
  never shown, a count again on any *not held*.
- *Step 2* below said the count the confirm screen starts is refused without a word. It now says
  the screen shows the sentence and counts again when the hold lifts.
- **Still open.** The screen learns of the lift from the banner's read, once a minute, so a *Start*
  pressed in that minute can still go ahead with no rows counted. A count refused for any reason
  other than a hold still needs a reload.


| Task | Status | Notes |
|---|---|---|
| T0 The steps on the reference machine, before the first invitation | ⏳ **Owner** | §3. In order: T1 in place, the OTA stack's passwords changed, live stood up without the demo (its database passwords set by the owner, D8), the production names routed, the checks run (live's networks among them, D9), the exposure probe from off the mesh. The outcome is written in this block. |
| T1 Container names, networks and scripts take the stack from the project name | ✅ **done** in #1233, merged 2026-09-27 (`8272c483`) — *was:* 🔨 **Built on branch `claude/ownpace-public-readiness-y7orc6-a-stack-named-by-its-project`, not merged** (2026-09-27); 📋 Decided 2026-09-24 (D7, D9) | §3. **The first task; nothing below can start before it.** 17 fixed `container_name` values, one network literal in `managed.yml` (`DOCKER_RUNNER_NETWORKS`, the network task runs join), `ownpace-db` in 7 scripts, `trigger-api` in 8 and the project name in 9, and `ownpace-managed_` volume or network names on 13 lines in six files (that network literal and `reset-trigger.sh`'s volume among them). Compose's own two networks already follow the project (D9). A guard fails on a fixed stack name and on any hard-coded `ownpace-managed_` name. The old options A, B and C are ⛔ superseded and kept in §3. |
| T1b `ownpace-live`: its own checkout, `.env` and ports, and no demo | 📋 **Decided 2026-09-24** (D7, D8) | §3. `~/.persistent/ownpace-live/.env`, fresh secrets from its first bring-up, its own `*_PORT` values, never `--with-demo`. The owner sets the four database passwords in live's `.env` before the first bring-up (D8). `ensure-env-secrets.sh` still does not generate them, and `trigger-db`'s still waits for T2's code. |
| T1c Its own Trigger.dev plane | 📋 **Decided 2026-09-24** (D7) | §3. Its own account, organisation and project, CLI profile, access token and `REGISTRY_PORT`. Never the OTA plane, which the nightly gate restarts. |
| T1d Its own identity provider at `id.ownpace.eu` | 📋 **Decided 2026-09-24** (D7) | §3. Its own masterkey and mail relay (0133). The web image is built with live's issuer, which is a build-time value. |
| T1e The production names routed to live | ⏳ **Owner** (D7) | §3. NetBird routes from `app.ownpace.eu`, `id.ownpace.eu` and `status.ownpace.eu` to live's ports. This answers 0091 T4. |
| T1f Every port that need not be reachable bound to 127.0.0.1, in both stacks | ✅ **done** in #1236, merged 2026-09-27 (`528d1308`), with T3 (a); the task build's way to the API on loopback followed in #1253 (`5ee41045`) — *was:* 🔨 **Built on branch `claude/ownpace-public-readiness-y7orc6-ports-published-on-purpose`, not merged** (2026-09-27), with T3 (a); 📋 **Decided 2026-09-24** (D7) | §3, T3. Containers reach ports the host publishes through the Docker gateway, so each stack can reach the other's. **Merge precondition in the Status block: the OTA stack's binds are set first, and the site is recreated by hand after.** |
| T1g Live is deployed by hand from a tag; CI never touches it | The code half ✅ **done** in #1265, merged 2026-09-28 (`c292fffb`); live's own deploys are T6 (a) — *was:* 🔨 the code half built on branch `claude/ownpace-public-readiness-y7orc6-a-gate-that-leaves-the-alpha-alone`, not merged (2026-09-27); 📋 **Decided 2026-09-24** (D7); the code 📋 **Proposed** | §3. The OTA stack keeps following `main` nightly. The procedure is T6; tags are 0146's. The marker's name, `STACK_KIND=production`, is defined once in `deploy/compose/stack-kind.sh` (2026-09-27, with 0143 T9's script), and this task's refusals source it. Built: the gate's refusal (`refuse-live-env.sh`, in the restore, before its first copy), the reader's refusal of live's marker on the OTA project, and the runbook's and release checklist's wording; the Status block says how. |
| T2 Database passwords the repository does not contain | 📋 **Decided 2026-09-24** (D2, D3) on the machine; the code 📋 **Proposed** | §3. Now chiefly the OTA stack, whose roles hold the shipped values: `ALTER ROLE`, because `.env` does not reach a role that already exists. On live the owner sets them in its `.env` before its first bring-up (D8, T1b). The bring-up sets the roles from `.env`, and refuses shipped values on a real address. |
| T3 "Not reachable from the internet", checked | (b) the exposure check and (c) the outside probe ✅ **done** in #1271, merged 2026-09-28 (`6088f469`), not yet run on the machine or dispatched; (a) the binds ✅ **done** in #1236, merged 2026-09-27, with #1253; (d) the path a tester's request takes 📋 **Proposed**, waits for live to stand (T1b to T1e) — *was:* (b) and (c) 🔨 built on branch `claude/ownpace-public-readiness-y7orc6-a-port-nobody-meant-to-open`, not merged (2026-09-28); 📋 **Proposed** (D2, D4, D7); (a) the binds 🔨 **Built on branch `claude/ownpace-public-readiness-y7orc6-ports-published-on-purpose`, not merged** (2026-09-27) | §3. A loopback default for the eight ports published on all interfaces (seven in `managed.yml`, the site's one), in both stacks (T1f). A check on the machine after every deploy, a probe from outside that includes the production names, and the path a tester's request takes, written down. Before the first check and probe the owner sets `EXPOSURE_ALLOW` in each stack's `.env` to every address any container on the machine is published on (both stacks' `*_BIND` values, the site's `WWW_BIND`, the demo's `STALWART_BIND`; commas, no space), and the repository variable `EXPOSURE_PROBE_LIVE_PORTS`. |
| T4 A stack that does not say it is production does not start | 📋 **Proposed** | §3. `managed.yml`'s `development` default becomes a required value. Live sets `production` at T1b. |
| T5 No demo in the alpha, and the values that left the machine replaced | ✅ **Closed for live 2026-09-24** (D7); 🅿️ **Parked for the OTA stack (trigger: 0026 row 24's own, the OTA stack stops being a demo)** | §3 and §4. Live never had the demo or its values, so there is nothing to replace. The refusal of `--with-demo` on live stays 📋 **Proposed**. Routes (a) and (b) are kept for the OTA stack. |
| T6 One way to deploy live, from a tag | (a) `deploy-live.sh` ✅ **done** in #1277, merged 2026-09-28 (`2cfe7cd6`), with 0146 T5 (a), not yet run on live; (b) ✅ **done** in #1232, merged 2026-09-27: every enqueue in the API goes through one function that answers 409 with the hold's sentence; the three web gaps (b) left 🔨 built on branch `claude/ownpace-public-readiness-y7orc6-a-hold-that-says-what-it-did`, not merged (2026-09-28). The procedure's steps on the machine are the owner's, once live stands (T1b) and 0146 has cut a release tag — *was:* (a) 🔨 built on branch `claude/ownpace-public-readiness-y7orc6-a-deploy-from-a-named-tag`, not merged (2026-09-28); (b) ✅ **done** in #1232, merged 2026-09-27; the procedure and (a), `deploy-live.sh`, 📋 **Proposed** (D1, D5, D7) | §3. Hold, drain, a tag, bring-up without the demo, checks, lift. Replaces three procedures that disagree. With 0146. (a) is the deploy script, (b) the hold at every door. The Status block (2026-09-28) says how (a) was built. |
| T7 What the gate does for the OTA stack, done for live | ✅ **done** in #1276, merged 2026-09-28 (`b2e63ab0`): `box-duties.sh`, `setup-zitadel.sh --token-only` and `--count-organisations`, and a user timer in the bring-up; waits for live to stand (T1b to T1e, from 0146 T0's tag) and for the owner to install the timer — *was:* 🔨 built on branch `claude/ownpace-public-readiness-y7orc6-a-duty-the-gate-used-to-do`, not merged (2026-09-28); 📋 **Proposed**, with T1b | §3. The identity provider's provisioning token, the Trigger.dev database drill, T3's check and 0135's organisation count, on a timer on the machine, for live. |
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
`docs/release.md` carries the same checklist item. A tester is a non-demo tenant. (Since T1g's
code half, 2026-09-27, both name the alpha as the one exception, under D7's conditions.) The runbook
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
rotates anything"*. These are the OTA stack's values. Live's are its own: generated at its first
bring-up or, for the database passwords, set by the owner before it (D8). They have been in no
log (T5). Two more facts decide when to replace what:

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
`routes/migrations/index.ts` and `operating-routes.ts`, do not read it. *(2026-09-27: they do
now, through one function, T6 (b); see the Status block.)*

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
- **D8, live's database passwords (later on 2026-09-24).** The owner came back with
  *"Three things i needed to check"* on the machine. This is the second: *"2) database passwords:
  ill set them in .env for the ownpace-live before bringup."* ("ill" is read as "I'll".) So:
  - The owner sets `POSTGRES_PASSWORD`, `APP_DB_PASSWORD`, `CLICKHOUSE_PASSWORD` and
    `MINIO_ROOT_PASSWORD` in `~/.persistent/ownpace-live/.env` before live's first bring-up (T1b
    step 5). The owner's words name the passwords; T1b step 5 sets `POSTGRES_USER` in the same
    step, as D3 had it for the OTA stack (*"Ill change user and pass"*). T0 step 3 is where it is
    done, and T1b step 7 checks it.
  - This is the owner's step on the machine. It does not close the gap in the code, which stays
    documented: `ensure-env-secrets.sh` does not generate the four (§1), `managed.env.example`
    ships `change-me-…` values and `APP_DB_PASSWORD=app_password`, and `managed.yml` falls back to
    compose's defaults when a key is empty. `trigger-db`'s password is a literal in `managed.yml`,
    `POSTGRES_PASSWORD: trigger_password`, so no `.env` reaches it until T2's code makes it
    `TRIGGER_DB_PASSWORD`.
  - The first answer is about the Google client's redirect URIs, and ends *"I'll need to add one
    for app.ownpace.eu or create a new oauth-client"*. It is 0140's: its T11 answers it with a new
    client for live, carrying live's consent address, and live's sign-in address only if 0140 T10
    keeps a Google sign-in (T1e here). The third answer is D9.
- **D9, live's networks (later on 2026-09-24).** The third answer: *"3) all need to land in their
  own seperate docker network, with names corresponding with 'ownpace-live'."* ("seperate" is read
  as "separate". "all" is read as everything live runs, and "names" as the networks' names. The
  containers' and volumes' names follow the project too: volumes already do, and containers do
  once T1 lands.) So:
  - Every Docker network that live's containers join belongs to live, and its name starts with
    `ownpace-live`. That includes the network Trigger.dev starts live's task runs on. The
    supervisor sets that one on its own (`DOCKER_RUNNER_NETWORKS`, §1), not through Compose.
  - No container of live's joins a network of the OTA stack's. No container of the OTA stack's
    joins one of live's.
  - What this takes is in T1. Compose already names live's two networks after the project. The
    task-run network and the scripts' volume and network names do not follow the project yet.
  - D9 is still separation by name on one Docker daemon. Each stack's `trigger-docker-proxy` can
    still attach a container to any network on the machine (§1). D9 does not change what D7 says
    about that.

## 3. What each task does

### T0 — on the reference machine, before the first invitation (owner)

Do these in order, because each step assumes the one before. (Before D7, the first step was
switching the gate off. D7 drops it: the gate keeps running, on the OTA stack.)

1. **T1 in place.** Once T1 is merged, the next gate run, or
   `./deploy/compose/bootstrap-managed.sh --from data --with-demo` from `~/ownpace-managed`,
   brings the OTA stack up under T1's names. Its volumes keep their names, because they are named
   after the project and the project does not change. Check with `docker ps`.
   **Before T3 (a) merges**, set the OTA stack's binds (the merge precondition in the Status
   block, part 1), or `app.ota.ownpace.eu` and `id.ota.ownpace.eu` stop answering at the next gate
   run. After that run, `docker ps --format '{{.Names}} {{.Ports}}'` shows every OTA container on
   `127.0.0.1`, and the front's address on the routed ones.
   **The site is a separate step**, because no gate run recreates it (part 2). Set `WWW_BIND` in
   the `.env` beside `www.yml` in the site's checkout, update that checkout to the merge, and run
   `docker compose -f deploy/compose/www.yml up -d` there. Then the same `docker ps` shows
   `ownpace-www` on `127.0.0.1` and the front's address, and `www.ota.ownpace.eu` answers. Before
   that run the site still publishes on every interface, whatever `WWW_BIND` says.
2. **Change the OTA stack's passwords (T2)**, with the steps given there.
3. **Stand live up (T1b to T1d)**: its checkout at a tag, its `.env`, its ports, its database
   passwords set by the owner in that `.env` before the first bring-up (D8), the bring-up without
   the demo, the one human step on its own Trigger.dev dashboard, its identity provider at
   `id.ownpace.eu`, and the owner's own account on it, appointed operator with `operator.sh add`.
4. **Route the production names to it (T1e).** The routes connect to the front's address, so
   live's `.env` carries `WEB_BIND`, `ZITADEL_BIND` and `STATUS_BIND` first (T1b step 3).
5. **Run the checks.** From `~/ownpace-live`:
   - `docker ps --filter name=ownpace-live --format '{{.Names}} {{.Ports}}'` shows live's
     containers on `127.0.0.1`, and `web`, `zitadel` and `gatus` on the front's address as well.
     Nothing is on `0.0.0.0`.
   - **Once, after a reboot**, the same command shows every container with a bind on a mesh
     address up. Such a bind ties the container's start to that address existing, and a
     container that failed to start while Docker restored it is not retried
     (`docs/managed-bring-up.md`, *Which address a port answers on*, has the remedy). Do this on
     the first reboot after T3 (a) is on the machine, for both stacks and the site.
   - `docker compose -f deploy/compose/managed.yml exec -T api printenv NODE_ENV` prints
     `production` (T4). Run the same from `~/ownpace-managed` for the OTA stack.
   - `curl -s https://app.ownpace.eu/api/auth/mode` answers `managed`.
   - `curl -s https://id.ownpace.eu/.well-known/openid-configuration` names
     `https://id.ownpace.eu` as its `issuer`, and the sign-in button on `app.ownpace.eu` leads
     there, not to `id.ota.ownpace.eu`.
   - `./deploy/compose/operator.sh list` names the owner and nobody else.
   - Live's networks are its own (D9):
     - `docker network ls --filter name=ownpace-live` lists `ownpace-live_ownpace-network` and
       `ownpace-live_status-probe`.
     - `docker compose -f deploy/compose/managed.yml config | grep DOCKER_RUNNER_NETWORKS` names
       `ownpace-live_ownpace-network`. It prints that one line and no value from `.env`.
     - `docker network inspect ownpace-managed_ownpace-network --format '{{range .Containers}}{{.Name}} {{end}}'`
       names none of live's containers, and the same command on `ownpace-live_ownpace-network`
       names none of the OTA stack's. A task run's container exists only while it runs, so this
       sees the services; the rendered `DOCKER_RUNNER_NETWORKS` above covers the task runs.
   - T2's step 2, run against live, refuses the three shipped pairs.
   - The exposure check and the outside probe pass (T3). Until T3 is built, the owner tries every
     port both stacks publish, the site's 3125 and the demo's two, from a machine that is not on
     the mesh or the private network.
6. **Write it down in this block:** the date of each step, the tag live runs, and the outcome of
   each check. Never a value.

### T1 — container names, networks and scripts take the stack from the project name (decided, D7, D9)

**Nothing else in D7 can start before this.** A second project cannot start while the 17 fixed
container names exist (§1), and the scripts would reach the OTA stack from live's checkout.

- **The names.** `managed.yml`'s 17 `container_name` values stop being fixed strings. Each is
  either derived from the project name or dropped, so that Compose names the container after the
  project. `name: ownpace-managed` stays as the default, so the OTA stack keeps its project, its
  volumes and its networks. The supervisor's `DOCKER_RUNNER_NETWORKS` is derived from the project
  name in the same way (below).
- **The networks (D9).** Every network live's containers join, task runs included, is named
  after `ownpace-live`. Checked on this branch on 2026-09-24:
  - **What Compose already does.** `managed.yml` declares two networks, `ownpace-network` and
    `status-probe`. Neither has a `name:` or `external:`. Every service lists the networks it
    joins, so Compose creates no default network. Compose names both after the project.
    `docker compose -p ownpace-live -f deploy/compose/managed.yml config --no-interpolate`
    renders them as `ownpace-live_ownpace-network` and `ownpace-live_status-probe`, and live's
    volumes as `ownpace-live_…`. These two networks need no change.
  - **What does not follow.** The same rendering still gives the supervisor
    `DOCKER_RUNNER_NETWORKS: ownpace-managed_ownpace-network`, the literal in `managed.yml`'s
    `trigger-supervisor` block. The comment above it says why it is written out: *"The value is
    the REAL network name — compose prefixes the pinned project name."* That is the network every
    task run is started on. So live's task runs would join the OTA stack's network, where
    `postgres` is the OTA stack's database (§1). The value becomes
    `${COMPOSE_PROJECT_NAME}_ownpace-network`, which leaves the OTA stack's value as it is.
  - **Where the value comes from.** Compose makes the project name available for interpolation
    as `COMPOSE_PROJECT_NAME`. On a small test file on 2026-09-24, with Compose 5.1.1,
    `docker compose config` rendered `${COMPOSE_PROJECT_NAME}_ownpace-network` as
    `ownpace-managed_ownpace-network` from the pinned `name:`, and also with an empty
    `COMPOSE_PROJECT_NAME=` in the `.env`. It rendered it as `ownpace-live_ownpace-network` under
    `-p ownpace-live`, under the environment variable, and under a
    `COMPOSE_PROJECT_NAME=ownpace-live` line in the `.env` beside the file, read from another
    working directory too. The reference machine's Compose version was not checked from here, so
    T0 step 5 checks the rendered value there.
  - **The demo's network.** `setup-managed-demo.sh` defaults `MANAGED_NETWORK`, the network the
    demo Stalwart joins, to `ownpace-managed_ownpace-network`. Live runs no demo, but the default
    follows the project anyway. T2's step 2 already builds the network name from the project.
  - **What it does not change.** Each stack's `trigger-docker-proxy` still allows creating
    networks and attaching containers to any network on the daemon (§1). A network of live's own
    keeps live's task runs off the OTA stack's network by configuration, not by enforcement (D7).
- **The volume names.** `reset-trigger.sh` sets `VOLUME="ownpace-managed_trigger_db_data"`. It
  stops and removes `trigger-supervisor`, `trigger-api` and `trigger-db` through `docker compose`,
  which is scoped to the project, and then removes that volume by name. Left as it is, and run from
  live's checkout once live exists, it would stop and remove those three of live's and then try to remove the OTA stack's
  Trigger.dev database. Docker refuses to remove a volume that any container, running or stopped,
  still uses, so while the OTA stack's `trigger-db` container exists the removal fails, the script
  exits, and live's three are left down. If that container has been removed, the OTA stack's
  Trigger.dev database goes. With T1, the script takes the name from the project its own
  `docker compose` resolves. One way is `volumes.trigger_db_data.name` in
  `docker compose … config --format json`, which is `ownpace-live_trigger_db_data` under live's
  project (checked with `--no-interpolate`). The same applies to three more places:
  - `smoke-managed.sh`'s `idp_pat` reads the provisioning token off
    `ownpace-managed_zitadel_machinekey`.
  - Recipes printed for an operator to paste name `ownpace-managed_` volumes: two in
    `setup-zitadel.sh`, two in `bootstrap-managed.sh` and one in `smoke-managed.sh`. Printed on
    live, each would name the OTA stack's volume. With T1, they are printed with the stack's own
    project name filled in.
  - Two guards pin those literals. `scripts/idp-wiring.unit.test.ts` expects
    `docker run --rm -v ownpace-managed_zitadel_machinekey` in `bootstrap-managed.sh`'s refusal.
    `scripts/pasteable-hints.unit.test.ts` requires at least one literal `docker volume rm` line
    to check. Both are rewritten with T1 to check the derived name.
- **The scripts.** A script reaches a service through `docker compose exec <service>`, which
  Compose scopes to the project, or through a name derived from `COMPOSE_PROJECT_NAME`. It never
  uses a fixed name such as `docker exec ownpace-db`. The volume names in `reset-trigger.sh`,
  `setup-zitadel.sh`, `bootstrap-managed.sh` and `smoke-managed.sh`, and the network name in
  `setup-managed-demo.sh`, are derived from the project name (above). The persisted `.env` and
  the dump directory default to `~/.persistent/<project>`.
- **Where the name comes from.** Each stack's `.env` sets `COMPOSE_PROJECT_NAME`. Live's names
  `ownpace-live`; the OTA stack's is left empty or names `ownpace-managed`. The scripts run
  `docker compose -f deploy/compose/managed.yml`, so Compose reads the `.env` beside
  `managed.yml`, and the scripts already load the same file. One key then selects the stack for
  both.
- **The docs.** The bring-up, the runbook and `docs/dav-sync.md` name containers in `docker exec`,
  `docker logs` and `docker inspect` commands, and they follow the code. So do the
  `ownpace-managed_` volume names in the bring-up's `docker volume` and `docker run -v` commands
  (D9). The bring-up's *One box, one stack, one `.env`* becomes *One stack, one `.env`*. The
  operator's checkout of the OTA stack and the gate's still share one file; live has its own
  (T1b). The warning against a fresh bring-up in the gate's checkout stays, for the OTA stack.
- **The guard.** `scripts/two-stacks-on-one-box.unit.test.ts`, which was T8's guard, moves here.
  It has two halves.
  - **The first half** fails on a fixed stack name in `managed.yml`, in the shell scripts under
    `deploy/compose/`, and in `.github/workflows/`. That covers any of the 17 container names used
    as a container, and `ownpace-managed` anywhere except as the one default of the variable that
    selects the stack. It also fails if any workflow names `ownpace-live` (T1g).
  - **Hard-coded network and volume names (D9).** The first half fails on the string
    `ownpace-managed_` anywhere in those files: in code, in a printed recipe, and in a comment,
    because a comment's command gets pasted too. A network or volume name is always built from
    the project. On this branch that is 13 lines in six files: `managed.yml` (the
    `DOCKER_RUNNER_NETWORKS` value, and one commented `docker volume rm`), `reset-trigger.sh` (1),
    `setup-managed-demo.sh` (the `MANAGED_NETWORK` default and two comments), `setup-zitadel.sh`
    (two printed recipes and one comment), `bootstrap-managed.sh` (2) and `smoke-managed.sh` (2).
    No workflow names one today.
  - **The second half** sets two project names and two sets of port values, and checks that the
    two stacks share no container name, volume, network or host port. It also checks that every
    network a stack's services or task runs join, `DOCKER_RUNNER_NETWORKS` included, starts with
    that stack's project name.
  - It fails today on the 17 names, on the network literal, on the 13 `ownpace-managed_` lines,
    and on every script §1 counts.

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
   `COMPOSE_PROJECT_NAME=ownpace-live` (T1), and `STACK_KIND=production`, live's marker (T1g,
   named in `deploy/compose/stack-kind.sh`). The rehearsal script (0143 T9) refuses a `.env` that
   carries the marker, so the line has to be there from the first bring-up. Until T1 derives the
   default, also set `MANAGED_ENV_PERSIST_DIR` to the live directory. Otherwise `bootstrap-managed.sh`,
   `trigger-credentials.sh` and `trigger-version.sh` look in the OTA stack's.
3. **Ports of its own.** Every `*_PORT` variable gets a value the OTA stack does not use:
   `POSTGRES_PORT`, `TRIGGER_PORT`, `TRIGGER_TLS_PORT`, `ZITADEL_PORT`, `API_PORT`, `WEB_PORT`,
   `STATUS_PORT` and `REGISTRY_PORT` (T1c). **And the addresses the routed ones answer on.**
   Every port answers on `127.0.0.1` only unless its bind adds an address (T3 (a)), so live's
   `.env` also gets the front's address as `WEB_BIND`, `ZITADEL_BIND` and `STATUS_BIND`, and
   `TRIGGER_TLS_BIND` only if live's dashboard is opened over the mesh (T1c opens it on
   `localhost`). Without them the production names do not answer (T1e). Each is an IPv4 address,
   never a name; `POSTGRES_BIND`, `API_BIND` and `TRIGGER_BIND` stay empty.
4. **The production names.** The browser-visible addresses that 0091 T1 lists name
   `https://app.ownpace.eu`. The identity provider's `ZITADEL_EXTERNALDOMAIN` is `id.ownpace.eu`,
   with port 443, secure, and TLS terminated in front, in the shape `managed.env.example` shows
   for the OTA names (T1d). The status page's probes default to `WEB_URL` and to the provider's
   own domain, so they follow without a setting of their own. `NODE_ENV=production` (T4).
5. **Passwords before the first bring-up (D8).** `ensure-env-secrets.sh` is the right tool for a
   new stack: every secret it knows is blank or a shipped placeholder, and the `env` phase fills
   each one with a fresh value.
   The bring-up's own rule, *"only generate fresh secrets when there is no working stack yet at
   all"*, is live's case.
   - **The owner's step.** `ensure-env-secrets.sh` does not generate `POSTGRES_PASSWORD`,
     `APP_DB_PASSWORD`, `CLICKHOUSE_PASSWORD` or `MINIO_ROOT_PASSWORD` (§1). The owner sets those
     four, and `POSTGRES_USER`, in `~/.persistent/ownpace-live/.env` before the `data` phase. The
     owner's words: *"ill set them in .env for the ownpace-live before bringup"*.
   - **The step is not optional.** Seeded from the example (step 2), the file holds `change-me-…`
     values and `APP_DB_PASSWORD=app_password` until the owner replaces them. An empty key falls
     back to compose's default.
   - **How to set them.** The form T2's step 3 uses, `openssl rand -hex 24` written with
     `env-upsert.sh`, generates each value on the machine, so no value is typed, pasted or printed.
     It takes all four in one call.
   - **When they take effect.** A new volume takes them at first initialisation, and step 7
     checks that it did.
   - **The gap in the code stays.** Until T2's code lands, nothing generates the four and nothing
     refuses a shipped value on a real address. `trigger-db`'s password is a literal in
     `managed.yml`, not a key in `.env`, so D8 cannot reach it. That code should land before live's
     first bring-up, which is when a new password costs nothing.
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
  `tr_prod_` key into live's `.env`. Its supervisor starts live's task runs on
  `ownpace-live_ownpace-network`, once T1 derives `DOCKER_RUNNER_NETWORKS` (D9).
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
  0091 records, so the local port numbers appear nowhere a browser or Google sees. Those ports
  answer on the front's address only through live's `WEB_BIND`, `ZITADEL_BIND` and `STATUS_BIND`
  (T1b step 3); without them a route reaches nothing.
- **0091 T4 is answered.** `app.` now means production, so the production names lead to the
  machine on purpose. What remains of 0091's concern is the route: a production name must reach
  live's ports, never the OTA stack's. The check below confirms it.
- **Google.** 0091 §1 lists `https://app.ownpace.eu/oauth/google/callback` as the production
  redirect URI. That is the planned path; the shipped route is `/api/migrations/google/callback`
  (`docs/google-oauth-verification.md`), so live needs
  `https://app.ownpace.eu/api/migrations/google/callback` on the client it uses, and
  `https://id.ownpace.eu/ui/login/login/externalidp/callback` if live's identity provider offers
  sign-in with Google (0140 T10). The owner read the client on 2026-09-24: it holds the OTA
  stack's two addresses, and *"I'll need to add one for app.ownpace.eu or create a new
  oauth-client"*. Which client, and its registration, are 0140's: its T11 advises a new client
  for live with live's consent address, and the sign-in address only if 0140 T10 keeps a Google
  sign-in.
- **The check** is in T0 step 5: `id.ownpace.eu` names itself as the issuer, and the sign-in
  button on `app.ownpace.eu` leads there. T6 step 7 checks that `/api/version` on
  `app.ownpace.eu` names the commit of live's tag.

### T1f — every port that need not be reachable bound to 127.0.0.1, in both stacks

Carried by T3. §1 says why both: a container reaches ports the host publishes through its
network's gateway, so a port published on every interface by either stack can be reached from
the other stack's containers.

### T1g — live is deployed by hand from a tag; CI never touches it

- **The OTA stack keeps following `main`.** The nightly gate runs on it every night, with the
  demo, as §1 describes. That is what proves a commit before live gets it.
- **Live moves only by hand, from a tag.** T6 is the procedure, and 0146 decides how tags are
  cut. Nothing scheduled deploys live.
- **The marker is defined once (2026-09-27).** `deploy/compose/stack-kind.sh` holds
  `STACK_KIND_KEY=STACK_KIND` and `STACK_KIND_LIVE=production`. It was built with 0143 T9's
  script, `rehearse-capacity.sh`, which already refuses live's `.env` with it (0143, Status
  2026-09-27). The gate's refusal below, T5's refusal of `--with-demo` and T6's `deploy-live.sh`
  source that file rather than spelling the marker out. A shell step in a workflow sources it the
  same way, from the checkout. It holds two predicates. Both read the file with `env_value`, and
  surrounding whitespace, quotes and case make no difference.
  - `stack_may_be_live <env-file>` is for the refusals: the gate's and T5's. It is true for live's
    marker and for anything that could be a slip of it: any value not listed in
    `STACK_KINDS_NOT_LIVE` (empty today, because the OTA stack's `.env` does not carry the key),
    and a line naming the key that `env_value` cannot read. If the OTA stack is ever given a kind
    of its own, it goes in that list first.
  - `stack_is_live <env-file>` is exactly live's marker. It is for T6's `deploy-live.sh`, which
    refuses a `.env` that does NOT carry it.
- **The code half makes an accident harmless.** Live's `.env` carries a marker saying that the
  stack holds people's data (`STACK_KIND=production`, above). In the restore, before it copies
  anything out of the persisted directory, the gate refuses a `.env` that carries the marker, so
  `ensure-env-secrets.sh`, the backfill and the copy-back never see it. So a
  `MANAGED_ENV_PERSIST_DIR` pointed at live's directory by mistake stops at once. This is option
  A's code half, kept, and keyed on the marker instead of `WEB_URL`, because the OTA stack's
  `WEB_URL` is a real https address too. **Built 2026-09-27** (`deploy/compose/refuse-live-env.sh`,
  not merged); the Status block says how.
- **Live's `.env` on the OTA project is refused too (with T1b).** `compose_project` falls back to
  `managed.yml`'s `name:` when the `.env` names no project, so a live checkout whose `.env` forgot
  `COMPOSE_PROJECT_NAME=ownpace-live` would drive the OTA stack with live's `.env`. The reader now
  refuses live's exact marker on that project. **Built 2026-09-27**, not merged.
- **The guard.** `scripts/a-gate-that-leaves-the-alpha-alone.unit.test.ts` finds that refusal in
  `e2e-managed.yml`, ahead of the first write to `.env`. T1's guard fails if any workflow names
  `ownpace-live`.
- **The live-target lane.** `e2e-live-target.yml` reads the OTA stack's persisted `.env`, and it
  stays there. Proofs on live are 0141's.
- **The docs.** The runbook's CI section and the release checklist item say that live runs on the
  reference machine beside the OTA stack and CI, by the owner's decision of 2026-09-24, under this
  plan's conditions. They say that the rule still stands for anything beyond the alpha, and that
  the separation is by names on one Docker daemon (D7). **Done 2026-09-27**, with the code half.

### T2 — database passwords the repository does not contain

D3 decides the change. **Under D7 it is chiefly the OTA stack's.** That stack's roles were created
with the values this repository contains, and the steps below are T0's second step. On live the
owner sets the values in its `.env` before the first bring-up (D8), and the role is created with
them (T1b), so only step 2's check runs there. The code stops the change from being undone later,
on both stacks.

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
2. Start the hold on live, with a sentence in Dutch (D6). Testers read it word for word on the
   banner, and as the answer to every button that would start work, which the hold now refuses
   (T6 (b)). The count the wizard's confirm screen starts by itself shows the sentence too, and
   counts again when the hold lifts (the Status block, 2026-09-28). A refused press is not
   remembered, so the sentence says when copying resumes, that nothing starts until then, and to
   try again after, for example *"We werken het platform bij en kopiëren rond 15:00 weer. Tot die
   tijd start er niets. Probeer het daarna opnieuw."*
3. Wait for the drain. The tick's log says `N pass(es) still in flight`; wait until N is 0.
4. If the owner wants a way back, dump live's application database now, and keep the dump until
   the next deploy (open question 4). The runbook's *Backup & restore* recipe dumps it, and since
   #1137 (merged 2026-09-24) it also dumps the identity provider's database and the roles, and
   says neither dump is usable without the stack's `.env`. Without a dump, a deploy only goes
   forward, because `migrate.ts` refuses to run the previous build against a migrated schema.
   When the tag moves Trigger.dev, also `trigger-version.sh backup before-<version>`, copied out of
   `trigger-backups/`: once T7's timer runs, a rollback restores that file by name, never with
   `--latest`, which is the first drill after the upgrade (2026-09-28, the bring-up's *Live's
   daily duties*).
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
  - **Built 2026-09-28**, with 0146 T5 (a) (on branch
    `claude/ownpace-public-readiness-y7orc6-a-deploy-from-a-named-tag`, not merged); the Status
    block says how, and where it departs from this list.
- **The hold covers every enqueue.** While a hold is open, the eight enqueue sites in the API
  answer 409 with the hold's sentence. They all go through one function, so a tester who presses
  *Sync now* during a deploy cannot start a pass after the drain count has already reached 0. The
  guard, `apps/api/src/a-hold-that-holds-every-door.unit.test.ts`, sweeps `apps/api/src` and
  fails on any `tasks.trigger(` call that does not go through that function. It failed on all
  eight before the build. **Built 2026-09-27** (`enqueueUnlessHeld`, on branch
  `claude/ownpace-public-readiness-y7orc6-a-hold-that-holds-every-door`, not merged); the Status block says how.

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

Live's own values, generated or set by the owner (D8), are in none of the first two kinds, and
they stay out of them as long as its `.env` never reaches a runner (T1g), its runner logs are never
pasted, and its task environment is never printed into a public log. Only `trigger-db`'s literal
is in the first kind, until T2's code lands. The third kind applies to live as much as to the OTA
stack.

**Who could use these values today?** Only something that can reach the service that checks them.
By D2 the published ports cannot be reached from the internet. So the database password works in
only these places:

- from the private network and the mesh, which belong to the owner;
- from inside a stack's own compose network, where every service of that stack shares one network;
- from any container on the machine, through the Docker gateway, for any port published on every
  interface (§1).

The alpha changes the last two. From the first invitation on, strangers type host names into
live, and live's API and tasks connect to those hosts from inside live's network (0136). A request
the service can be made to send to `postgres`, `clickhouse` or `minio` meets the passwords the
owner set for live (D8). One sent to `trigger-db` meets the literal until T2's code lands. One sent
to the gateway meets whatever the machine publishes on every interface, including the OTA stack's
Postgres with the passwords this repository contains, until T2 and T3 are done there.

Here is one example, reasoned but not demonstrated here. ClickHouse's HTTP interface accepts the
user and password in the URL and runs the query the request carries. With the password
`password`, one GET that the service is tricked into sending becomes a query. 0136 decides how the
service refuses such hosts. T2, T1b and T3 make the second lock a real one.

What each replacement buys, and what it costs:

| Value | What it protects | On live | On the OTA stack | Cost |
|---|---|---|---|---|
| `APP_DB_PASSWORD`, and the owner role's password | Every tenant's rows. Row security keys on a setting the session sets itself, and the owner role bypasses it. | Set by the owner in live's `.env` before the first bring-up (D8); the role is created with it (T1b) | Changed before the first invitation (T2, D3) | On the OTA stack, one redeploy |
| `CLICKHOUSE_PASSWORD`, `MINIO_ROOT_PASSWORD`, `trigger-db`'s password | Trigger.dev's event store, its large payloads and its database | Set by the owner in live's `.env` before the first bring-up (D8); `trigger-db`'s needs T2's code first | ClickHouse and MinIO with T2; `trigger-db`'s with row 24 | Nothing worth naming |
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
