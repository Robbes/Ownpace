# Workplan 0018 — deploying the Trigger.dev tasks (making the managed job loop real)

## Status — 2026-07-31 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T0 Decide the deploy topology | ✅ **Decided** | Full deploy path against the reference layout (registry + supervisor + socket-proxy), not dev-CLI worker sessions — the demo stack exists to mirror the production shape. One `TRIGGER_IMAGE_TAG` for webapp AND supervisor, defaulted to the SDK's exact version (v4.5.7 — the old hardcoded v4.5.4 pin claimed to match an SDK that had moved); the deploy CLI is pinned to the SDK version by construction (read from `apps/worker/package.json` at run time). Decision text below. |
| T1 One env contract for the trigger client | ✅ **Built** | The SDK's own pair, nothing else: `TRIGGER_API_URL` + `TRIGGER_SECRET_KEY`. `trigger-client.ts` rewritten — the old wrapper passed `TRIGGER_DEV_ACCESS_TOKEN` (unset → fell through to an env nobody set) while its always-truthy `localhost:3000` fallback silently OVERRODE the stack's correct URL: three namings, two live bugs, now one pair. Throws at call time naming what is missing; NOT `:?`-required at compose level, deliberately — the key is minted by the very stack it gates, so a boot-time requirement would deadlock first bring-up. `TRIGGER_API_KEY` is gone from every file. |
| T2 `trigger.config.ts` + task registration | ✅ **Built** | `apps/worker/trigger.config.ts`: all seven `src/jobs/*` tasks, project ref from `TRIGGER_PROJECT_REF` (throws with the where-to-get-it if unset), retries safe-by-construction (every job re-checks gates; the apply job lands its receipt every attempt), workspace packages bundled with the wasm/native tail (`@electric-sql/pglite`, `pg`) external. Typechecked; the build list is a first cut T5 proves. |
| T3 The deploy registry (and the rest of the missing execution plane) | ✅ **Built** | Not just the registry — the stack had bootstrap env vars with NO consumer: `managed.yml` gains `trigger-registry` (loopback-bound on `127.0.0.1:${REGISTRY_PORT}`, which is what lets it run without auth — both consumers are on this host), `trigger-supervisor` (executes deployed runs; worker token from the shared volume the webapp already writes), `trigger-docker-proxy` (whitelisted socket access instead of handing the supervisor the raw socket), and `minio` (which `OBJECT_STORE_BASE_URL` had pointed at since the stack was written). Run containers join the compose network so tasks reach `postgres`/`stalwart`/`nextcloud` by name. |
| T4 A scripted, repeatable deploy | ✅ **Built** | `deploy/compose/deploy-tasks.sh`: idempotent; CLI version = SDK version by construction; preflights instance reachability, project ref, and login (printing the exact pinned login command); documents the one-time dashboard steps (org/project, `TRIGGER_PROJECT_REF`, `TRIGGER_SECRET_KEY`) and the task-runtime env vars that must live in the dashboard (`DATABASE_URL`/`APP_DATABASE_URL`/`SECRET_ENCRYPTION_KEY` — task containers inherit nothing from compose). `setup-managed-demo.sh`'s run order gains step 5. |
| T5 Live proof: the 0017 smoke curls, now green | 🟡 **In progress — deploy PROVEN, run execution not yet** | First live session (2026-08-01): after four real fixes found on the way (docker-socket-proxy tag that never existed → PR #203; `trigger.config.ts` throwing inside the build indexer → PR #204; the CLI's deploy-start following the server-advertised `API_ORIGIN` onto a self-signed HTTPS front — origins split: APP/LOGIN on the TLS proxy for browsers, API on localhost for clients; and production-mode Secure cookies requiring a real HTTPS front for the dashboard at all, currently a hand-run Caddy sidecar with `tls internal` + `default_sni`, to be folded into the stack), **`deploy-tasks.sh` deployed version 20260801.2 with all 7 tasks detected**, and the smoke's `verify/start` answered 202 with the run reaching `DEQUEUED` — the supervisor pulled the image from our registry and started real runner containers three times. Then two infra defects ended the session: the runner attempts failed (cause unknown — `AutoRemove` destroyed the containers and their logs before they could be read), and **the trigger webapp process died** from an unhandledRejection when the dashboard's env page queried the placeholder ClickHouse (`ECONNREFUSED 127.0.0.1:8123`) — v4.5.7 really queries it; the 2026-07-25 placeholder hack only ever survived boot. The supervisor, having no restart policy, stayed dead. Fixed in this change: real `clickhouse` service (reference wiring + their <16GB tuning file) and `restart: unless-stopped` across the stack. Still open for the next session: land the stuck `running` verification_run row, re-run the smoke, and read the runner attempt's actual error (dashboard run page, or live log capture before AutoRemove). **Root cause of the silent runner deaths, found in the second session**: the webapp's `DEPLOY_IMAGE_PLATFORM` defaults to `linux/amd64` and is handed to the CLI server-side (no CLI flag) — so the deploy built amd64 images for the arm64 Spark, and every runner died at exec (`exec format error`) before its first log line, `AutoRemove` erasing the evidence; `docker run --entrypoint sh <task image>` reproduced it in one line. Two more incident lessons from the same session, both now compose-fixed: an enqueue accepted while the freshly-recreated webapp was still booting produced a queue-invisible `PENDING` orphan (recovered with `runs.replay`, which dequeued instantly), and the runs LIST in the dashboard is served from ClickHouse — an empty Runs page with runs in postgres means replication isn't on, a cosmetic gap accepted for now. **Third session (2026-08-01, after `DEPLOY_IMAGE_PLATFORM=linux/arm64` and deployment 20260801.4): the VERIFY HALF IS CLOSED** — smoke #3 ran twice (12:25 and 12:39 UTC), both times `POST verify/start` → 202 → real arm64 runner → `state: done` in ~1.8 s with a per-domain report (`mail PASS 3/3`, full runner logs captured live before AutoRemove). The apply half failed both runs with `buildDepsFromMapping currently only supports imap-oauth2, got: undefined` — the runner metadata pins the deployed image to commit `f4eab66` (the #206 merge), i.e. **built before PR #207**, whose enabled-domains scoping is exactly the fix for this error. Last step: pull main past #207, `deploy-tasks.sh` again, re-run the smoke; expected terminal receipt `applied` or `refused`, either of which closes T5. (Also observed in those logs: the runner debug output prints the full task env including `DATABASE_URL`, `SECRET_ENCRYPTION_KEY` and the `tr_prod_` key — rotation before this stack stops being a demo is recorded as 0020 T2.) |

## Why this exists

Every piece of the managed edition's async architecture (ADR-0004) exists
except the one that makes it run. `apps/worker/src/jobs/` holds seven
`schemaTask` definitions — `run-discovery`, `run-delta-sync`, `run-full-sync`,
`run-cutover`, `run-rollback`, `run-verification`, `run-apply-deletion` — and
the API enqueues the last two from real routes (0017 T3/T4). But the repo has
**no `trigger.config.ts` and no deploy step**, so no Trigger.dev instance has
ever heard of any of them. The gap has been recorded since 0011 T7 in
`managed-scheduler.ts`'s header; 0017 turned it from a background fact into an
operator-visible one, because verify and apply are the first features whose
happy path has **no interim**: syncs run through the polling
`managed-scheduler`, but a verify/apply enqueue can only take the designed
failure branch — the run/receipt lands `failed` ("Could not enqueue …") and
the caller gets a 502.

The 2026-07-31 live smoke (0017's post-merge validation) proved that failure
branch end to end on a fresh Spark stack, and pinned down exactly what is
missing. This workplan is that list, so the work starts from evidence rather
than from re-diagnosis.

## What the live smoke established (do not re-derive)

- **The enqueue dies on auth config before anything else**: the v4 SDK throws
  `You need to set the TRIGGER_SECRET_KEY environment variable`. Three
  disagreeing env namings are in play: the SDK reads `TRIGGER_SECRET_KEY`;
  `deploy/compose/managed.yml` hands the api/worker `TRIGGER_API_KEY` +
  `TRIGGER_API_URL`; `packages/scheduler/src/trigger-client.ts` reads
  `TRIGGER_DEV_ACCESS_TOKEN` + `TRIGGER_DEV_BASE_URL` (defaulting the base URL
  to `http://localhost:3000`, which is not where the compose stack publishes
  trigger-api either). None of the three can currently reach the instance.
- **The registry does not exist**: trigger-api is configured with
  `DEPLOY_REGISTRY_HOST: localhost:5000`, and nothing in the compose stack
  runs a registry. v4 self-hosted deploys push task images; without a registry
  there is nowhere to push.
- **Versions have drifted**: trigger-api is pinned `v4.5.4` with a comment
  claiming it matches the SDK — the SDK is now `4.5.7`. Probably fine, but
  "probably" is not a deploy story; T0 decides alignment.
- **The failure landings work.** Runs land `failed` in ~3 ms with the reason;
  receipts are never left `queued`. Whatever this plan breaks mid-way, a
  poller never hangs — which is what makes the deploy safe to iterate on
  against a live stack.

## T0 — the deploy topology, decided

**The full deploy path, matching the upstream reference layout: CLI `deploy`
builds task images, pushes them to a registry this stack runs, and a
supervisor executes one container per run.** The alternative — a long-lived
`trigger dev` CLI session as the worker — was rejected for the same reason the
managed stack exists at all: it is a laptop-development shape (a terminal that
must stay open, code served from a checkout), and the demo stack's job is to
mirror what a production deployment looks like.

The pieces, and where each decision landed:

- **Supervisor** (`ghcr.io/triggerdotdev/supervisor`): the missing consumer of
  the bootstrap worker token the webapp has been writing to `trigger_shared`
  all along. It talks to docker through a `tecnativa/docker-socket-proxy`
  whitelisted to exactly what running task containers needs — the raw socket
  never enters it. Its run containers join the compose network
  (`DOCKER_RUNNER_NETWORKS`) so tasks reach `postgres`, `stalwart` and
  `nextcloud` by the same names the worker container uses.
- **Registry** (`registry:2`): loopback-bound (`127.0.0.1:${REGISTRY_PORT}`),
  which is simultaneously why it needs no auth (nothing off-host can reach
  it), why docker accepts it over plain HTTP (localhost registries are
  trusted), and why `localhost:<port>` is the correct address from BOTH
  consumers — the CLI pushes from the host, the supervisor pulls through the
  host's daemon. A production deployment brings its own authenticated
  registry; this one is the single-host shape.
- **Versions**: ONE `TRIGGER_IMAGE_TAG` for webapp and supervisor, defaulted
  to the exact `@trigger.dev/sdk` version in `apps/worker/package.json`
  (v4.5.7 at decision time), and the deploy CLI pinned to that same number by
  reading it from `package.json` at run time. The 4.5.x family is
  SDK-compatible per upstream (4.5.1+ only rejects v3-SDK tasks), but one
  number in one place beats "probably compatible".
- **Task runtime env vars live in the instance's dashboard**, per
  environment — task containers inherit nothing from compose. The deploy
  script names the required set. (A `syncEnvVars` build extension could push
  them at deploy time; deferred — it adds a dependency for something the
  dashboard already does.)

## T1 — one env contract

One name per fact, everywhere: the access token/secret the SDK actually reads
and the API URL of the instance, set once in `deploy/compose/.env`, threaded
through `managed.yml` to api and worker, consumed by ONE client construction
path. Fold `getTriggerClient` into whatever the v4 SDK's supported
configuration is rather than keeping a third naming alive. A missing value
must fail loudly at boot with the name it wants (hard rule 9), not at first
enqueue with a docs link. `managed.env.example` documents it; the stale
"matches the SDK" comment in managed.yml dies here too.

## T2 — `trigger.config.ts` + registration

The config lives in `apps/worker` (rule 5: nothing under `packages/` or
`apps/selfhost` may touch it; `no-managed-leakage.unit.test.ts` already
polices the import direction). It registers the seven task files under
`src/jobs/` — deploying ALL of them costs nothing extra and stops the
discovery/sync tasks from bit-rotting as undeployable code, even while the
polling scheduler remains the sync path. Build settings must cope with the
workspace packages the jobs import (`@openmig/core`, `@openmig/ledger`, ...).

## T3 — the registry

Whatever T0 picks: if deploys push images, the compose stack grows a registry
service (and `DEPLOY_REGISTRY_HOST` starts telling the truth); if the dev
worker route is chosen for the demo stack, record why the registry is not
needed there and what a production deployment does instead. Either way, the
current state — a config value pointing at a port nothing listens on — does
not survive this plan.

## T4 — a scripted, repeatable deploy

One script (`deploy/compose/deploy-tasks.sh` or equivalent), idempotent,
runnable after every `git pull`, that authenticates against the instance,
deploys the tasks, and verifies they are registered (list them back; do not
report success on a push that landed nowhere). `setup-managed-demo.sh`'s
header gains the step in its run order. No secrets in the repo — the script
reads the same `.env` as everything else.

## T5 — live proof

On the Spark, in order: `git pull`; `docker compose -f
deploy/compose/managed.yml up -d --build` (four new services — registry,
supervisor, socket-proxy, minio — and trigger-api moves to the pinned
`TRIGGER_IMAGE_TAG`); the one-time dashboard steps in `deploy-tasks.sh`'s
header (account → org/project → `TRIGGER_PROJECT_REF` + `TRIGGER_SECRET_KEY`
into `.env` → restart the api → task env vars into the dashboard → CLI
login); then `./deploy/compose/deploy-tasks.sh`.

Then the exact smoke from 0017's post-merge validation, now expecting the
other branch: `POST .../verify/start` → 202 → poll
`.../verify/report` to `done` with the per-domain report (the route → job →
row → poller loop, closed for the first time anywhere). Then the apply pair
on a migrated item with confirmed evidence and the flag opted in: 202 → poll
`.../receipt` to `applied` (or an honest target-side `refused`). Record the
outcome in 0017's post-merge section as the closure of its "designed 502"
caveat, and update ADR-0026's parity story if it still carries one.

## Non-goals, said out loud

- **Moving syncs off the polling `managed-scheduler`.** It works, it is
  proven on the Spark, and replacing it with scheduled Trigger.dev tasks is
  its own decision with its own risks. Deploying the sync task definitions
  (T2) does not switch anything over; the scheduler keeps running until a
  future plan retires it deliberately.
- **Trigger.dev Cloud.** This plan targets the self-hosted instance the
  compose stack already runs. Nothing here may make the managed edition
  depend on a third-party SaaS.
- **The appliance.** Rule 5 stands: no part of this touches `apps/selfhost`
  or `packages/*` beyond (possibly) retiring `packages/scheduler`'s
  `getTriggerClient` in favour of the SDK-native path — and that only if the
  no-leakage test stays green.

## Hard rules that bite here

- **Rule 5 — self-host must keep working.** The deploy machinery is managed
  infrastructure; none of it may become a dependency of the appliance.
- **Rule 9 — never mask errors.** The enqueue failure branches built in 0017
  stay exactly as loud as they are; a deployed-but-broken task must land
  `failed` with the real reason, not retry silently forever.
- **No secrets in the repo.** Access tokens live in `.env`/the host, like
  every other credential this stack uses.
