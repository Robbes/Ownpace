# Workplan 0018 — deploying the Trigger.dev tasks (making the managed job loop real)

## Status — 2026-07-31 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T0 Decide the deploy topology | ⬜ Not started | — |
| T1 One env contract for the trigger client | ⬜ Not started | — |
| T2 `trigger.config.ts` + task registration | ⬜ Not started | — |
| T3 The deploy registry | ⬜ Not started | — |
| T4 A scripted, repeatable deploy | ⬜ Not started | — |
| T5 Live proof: the 0017 smoke curls, now green | ⬜ Not started | — |

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

## T0 — decide the deploy topology

Self-hosted Trigger.dev v4 supports more than one way to get task code
running: a full `trigger deploy` (build an image, push to the registry, the
instance schedules it) or a long-lived dev/CLI worker session against the
instance. Decide which one this stack uses — and for the Spark demo vs. a real
managed deployment, whether that answer differs. Record the decision HERE with
the reasons, including the SDK/server version-alignment policy (pin both to
one version, and say where the pin lives). The bootstrap worker group
(`TRIGGER_BOOTSTRAP_WORKER_GROUP_NAME: bootstrap`, token on the
`trigger_shared` volume) is already provisioned by the compose stack and is
probably the hook the choice hangs on.

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

The exact smoke from 0017's post-merge validation, re-run on the Spark, now
expecting the other branch: `POST .../verify/start` → 202 → poll
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
