# Workplan 0020 — productionizing the managed stack

## Status — 2026-08-01 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 Tenant membership becomes an authorization gate | ✅ **Done — merged (PR #209), CI green incl. the 10 reseeded integration suites** | `authenticate`/`optionalAuth` confirm `(tenantId, sub)` is an ACTIVE `tenant_member` row (looked up inside `withTenant(claimedTenant)` — RLS itself scopes the probe, so a forged claim finds no row → 403) and take the ROLE from the row, never the token. Dev mode (no verifier; production-forbidden) is the one documented skip. Unit: 5 new gate tests (forged-tenant 403, row-role-wins, claimed-args-passed, lookup-failure→500 fail-closed, optionalAuth attaches nothing) + the promised churn: all 10 API integration suites now seed the memberships their minted tokens imply — `members`/`tenants` suites needed one sub per (tenant, role), which is the gate working. 59/59 API unit tests green locally; the integration suites run in the PR's CI. **Verified LIVE on the Spark stack (2026-08-01, post-merge, production mode)**: two tokens signed with the real `JWT_SECRET`, same tenant claim — seeded member `demo-owner-a` → **200**, non-member `smoke-operator` → **403**. Before this change both were served. |
| T2 Fail-closed secrets | ✅ **Done — merged (PR #209), CI green; rolled out live on the Spark stack 2026-08-01** (`ensure-env-secrets.sh` generated the three missing trigger secrets, `compose up` passed every `:?` check, API boots clean in production mode, seed re-run minted fresh member tokens). Smoke tokens must use a seeded member's sub (`demo-owner-a`/`demo-owner-b`) now that the gate is live. | `JWT_SECRET` and all five trigger secrets are `:?`-required in `managed.yml` (+ `managed-simple.yml` for JWT) — zero hardcoded fallbacks left; `assertProductionAuthConfig()` refuses API BOOT in production with a known-placeholder `JWT_SECRET` (4 unit tests); `managed.env.example` completed (the 10 missing vars: MinIO pair, 3 trigger secrets, 3 origins with the TLS-front story, IMAP/JMAP timeouts) + a rotation section naming runner logs as secret-bearing; root `.env.example` gains `APP_DB_*`, `SECRET_ENCRYPTION_KEY`, `JWT_ISSUER/AUDIENCE` and drops its placeholder `JWT_SECRET` value; new idempotent `deploy/compose/ensure-env-secrets.sh` generates missing secrets per-install so first bring-up stays one command. |
| T3 `trigger-tls` joins the compose stack | ✅ **Done — merged (PR #212, CI green) and LIVE on the Spark stack 2026-08-01**: hand-run sidecar removed, compose brought the service up clean with its cert volumes (config identical to the proven hand-run shape). **Residual CLOSED (2026-08-01): the browser check's white screen was a missing `TRIGGER_TLS_HOST` in `.env`** — Caddy fell back to the `localhost` default, so a browser arriving with `Host: 100.97.25.131` matched no site block and got an empty response (white screen, not an error). After adding the value and `--force-recreate`, **the dashboard renders and logs in through the compose-managed front** — T3 is fully proven, browser path included. | `trigger-tls` service in `managed.yml` (caddy:2-alpine, `restart: unless-stopped`, cert/config volumes) + `trigger-tls.Caddyfile` carrying both hard-won rules as comments: a concrete host as the site address (else no certificate to present — handshake death) and `default_sni` (IP browsers send no SNI). `TRIGGER_TLS_HOST`/`TRIGGER_TLS_PORT` in `managed.env.example` with the origin story: APP/LOGIN → the https front, API_ORIGIN stays `http://localhost:3090` for the deploy CLI. Rollout note: `docker rm -f trigger-tls` (the hand-run sidecar) before `compose up` — same container name, deliberately. |
| T4 The managed runbook exists | ✅ **Done — merged (PR #214, CI green)** | `operator-runbook.md`'s managed half rewritten around the real bring-up: whole-stack `up` (the execution plane is not optional — a stack without the supervisor dequeues nothing), the initdb-mount instruction REPLACED with the truth (API self-migrates; the mount crashes — managed.yml's comment now cited instead of contradicted), the TLS front + origin split + the recreate-not-restart gotcha (the white-screen lesson), the one-time trigger setup (magic link from logs, project ref, prod key from trigger-db), `set-task-env.sh`, `deploy-tasks.sh`, and `smoke-managed.sh` as acceptance. Membership-gate note on the seed tokens. Troubleshooting rewritten from the incident list (silent runner deaths → platform; empty Runs page → ClickHouse replication, cosmetic; white screen → stale origins). Appliance-half fixes stay with 0021. |
| T5 `smoke-managed.sh` — the live smoke becomes a script | ✅ **Done — merged (PR #212, CI green) and its FIRST LIVE RUN PASSED on the Spark stack 2026-08-01 16:59 UTC**: verify `done`/PASS in 2 s (disabled domains SKIPPED per #207), apply receipt `applied`/`deleted` on poll 2, runner logs captured before AutoRemove, guarded cleanup behaved (`UPDATE 0` retraction — evidence stands because the deletion WAS applied), `SMOKE PASS` exit 0. The acceptance test for every future stack change now runs as one command. | `deploy/compose/smoke-managed.sh`: preflights (API health, db exec, jsonwebtoken, secret read from the api container), seeded-member token mint (`demo-owner-a`/`b` — the 0020 T1 gate refuses arbitrary subs), verify start→poll→terminal, apply with guarded evidence fabrication AND guarded retraction (evidence stands if the deletion was applied — retracting under an applied receipt would falsify the record), receipt poll→terminal, runner-log capture before AutoRemove, stuck-row landing on timeout, evidence tee'd to a file (flagged secret-bearing — runner logs print the task env). Success = verify `done` + apply `applied`/`refused`; exits non-zero otherwise. `deploy-tasks.sh`'s hints now point at it. Failure path self-tested (unreachable API → FATAL, exit 1); the PASS path needs the live stack. |
| T6 Task env vars stop being a dashboard ritual | ✅ **Done — merged (PR #214, CI green) and RUN LIVE on the Spark stack 2026-08-01 17:18 UTC**: `upload OK — env now holds: APP_DATABASE_URL, DATABASE_URL, SECRET_ENCRYPTION_KEY`, followed by a `SMOKE PASS` (verify `done`/PASS through a real runner — i.e. the uploaded env is what runners actually receive). The smoke's apply half reported `skipped-no-item`, correctly: each earlier green apply TOMBSTONED its item (by design — applied deletions are never re-created), and the demo mapping has run out of eligible `copied` items with a target handle. Noted as a demo-stack property: a green apply smoke consumes one eligible item permanently. | `deploy/compose/set-task-env.sh`: reads the same `.env` the stack runs on, uploads `DATABASE_URL`/`APP_DATABASE_URL` (in-network `postgres:5432` addresses — runners join the compose network) + `SECRET_ENCRYPTION_KEY` via the SDK's `envvars.upload` with `override: true` (the .env file is the source of truth; a stale dashboard value silently winning is the failure mode this ends), then lists the env back as confirmation. Uses the SDK's own env contract (`TRIGGER_API_URL`/`TRIGGER_SECRET_KEY`) — no `configure()` call. Failure path self-tested (missing .env → FATAL, exit 1); the live upload needs the Spark stack. |
| T7 Small hardening sweep (each item small, none optional) | ✅ **Done — merged (PR #216, CI green, net −204 lines)** | All six items: (1) `deploy-tasks.sh` preflights `uname -m` against `.env`'s `DEPLOY_IMAGE_PLATFORM` and refuses the mismatch that produces log-less runner deaths (`SKIP_PLATFORM_CHECK=1` for deliberate cross-builds). (2) `trigger-webhook.ts` DELETED with its test and mount — an unauthenticated no-op sink expecting a payload shape the self-hosted v4 platform never sends; job state lands on `verification_run`/`apply_receipt` by the jobs themselves; a comment in `index.ts` records the absence as deliberate. (3) `managed-simple.yml` DELETED — it missed every 0018-era fix, hardcoded the in-container `TRIGGER_API_URL` bug 0018 T1 killed, and its comments invoked a service it didn't define; `managed.yml` is the one stack definition. (4) The last `@trigger.dev/sdk/v3` import (trigger-client.ts) moved to the root path — the SDK's `.` and `./v3` exports resolve to the same module. (5) `managed-scheduler.ts`'s header brought current: trigger.config.ts/deploy EXIST (0018 closed), this poller runs syncs, its future is T8's decision, and its zero-test status is stated. (6) ClickHouse run-replication: ACCEPTED as absent — the Runs page renders empty, cosmetically; the smoke and DB rows are the operational truth; recorded in the runbook with the revisit condition. |
| T8 Decide: the polling scheduler's future | ✅ **DECIDED 2026-08-01 — owner picked option A**: syncs move onto scheduled Trigger.dev tasks and the poller retires. One execution plane — which RESTORES ADR-0004's original architecture (the poller was always the self-declared interim), now that the task path is live-proven end to end. Trade-off accepted and recorded: syncs then depend on the trigger stack's health, which the rest of this workplan spent the day making boringly reliable. The build is feature-sized → **workplan 0022**, with a staged cutover that keeps the poller as the rollback lever until the tick has live evidence. | Decision recorded in [workplan 0022](./0022-syncs-on-trigger-tasks.md), which carries the design (one declarative tick, not per-mapping schedule rows), the overlap-safety story, and the T3 live-cutover sequence. |

## Why this exists

0018 made the managed job loop real on a live stack — and the way there was a
day of incidents whose fixes and workarounds partly live in the repo (compose
services, deploy script) and partly in chat history and hand-run containers.
This plan moves everything load-bearing into the repo, and closes the
security findings the 2026-08-01 whole-repo review confirmed with evidence.

## T1 — tenant membership becomes an authorization gate

`apps/api/src/middleware/auth.ts` in `local` mode verifies the JWT signature
and then trusts `payload.tenantId` and `payload.role` verbatim — there is no
query against `tenant_member` anywhere in the middleware. Anyone holding
`JWT_SECRET` mints `{tenantId: <any>, role: 'owner'}` and every route serves
that tenant; RLS then faithfully scopes to the *claimed* tenant, which is the
attack, not the defense. Managed/JWKS mode has the same shape (it delegates
tenant assignment to the IdP without a membership lookup).

Fix: after claim verification, `authenticate` confirms `(sub, tenantId)`
exists in `tenant_member` and takes the ROLE from that row, not from the
token. Integration suites that mint bare tokens must seed memberships — that
churn is the point: the tests then prove the gate. The demo seed already
creates members, so the Spark stack keeps working.

## T2 — fail-closed secrets

- `JWT_SECRET` defaults to `change-this-in-production` in `managed.yml` and
  `managed-simple.yml` — with T1's context, the default secret IS the tenancy
  boundary. Make it `:?`-required like `SECRET_ENCRYPTION_KEY`, and make the
  API refuse to boot in production mode with a known-placeholder value.
- The five trigger auth secrets have hardcoded fallbacks in `managed.yml`
  (`SESSION_SECRET: 0123…` etc.). Move them to `:?`/generated-in-.env; the
  committed `.env.managed` that duplicated them was deleted in the 2026-08-01
  review PR.
- `managed.env.example` is missing ~10 variables `managed.yml` consumes
  (`MINIO_ROOT_*`, `TRIGGER_SESSION/MAGIC_LINK/MANAGED_WORKER` secrets, the
  three `TRIGGER_*_ORIGIN`s, `IMAP/JMAP_TIMEOUT`) — every absence silently
  selects a weak default. Complete it; same for the root `.env.example`
  (no `SECRET_ENCRYPTION_KEY`, `APP_DB_*`, `JWT_ISSUER/AUDIENCE` at all).
- Demo-secret rotation guidance: the Spark stack's generated values (DB
  password, `SECRET_ENCRYPTION_KEY`, `tr_prod_` key) have appeared in pasted
  logs; when that stack stops being a demo, rotation is step zero — and
  trigger runner debug output prints the full task env, so treat runner logs
  as secret-bearing.

## T3 — `trigger-tls` joins the compose stack

The trigger dashboard runs production-mode Secure cookies, so it is unusable
over plain http from anything but localhost — the live fix was a HAND-RUN
Caddy sidecar (`tls internal`, plus `default_sni` so IP-connecting clients
that send no SNI get a certificate at all). Fold it into `managed.yml` as a
service with the origin story documented: `TRIGGER_APP_ORIGIN`/`LOGIN_ORIGIN`
point at the https front for browsers; `TRIGGER_API_ORIGIN` stays
`http://localhost:3090` because API clients (the deploy CLI) follow the
server-advertised origin and must not hit a self-signed cert.

## T4 — the managed runbook exists

The complete deploy/onboarding flow lives only in `deploy-tasks.sh`'s header:
dashboard org/project creation, magic-link-from-`docker logs`, the
`TRIGGER_PROJECT_REF`/`TRIGGER_SECRET_KEY` `.env` steps, CLI login, task env
vars. `docs/operator-runbook.md` — the designated home — not only omits all
of it, it still instructs the `docker-entrypoint-initdb.d` migration mount
whose removal has a crash-explaining comment in `managed.yml`, and a start
sequence that brings up neither registry nor supervisor (a stack where
enqueued tasks are dequeued by nobody). Rewrite the managed half of the
runbook around the real bring-up: `setup-managed-demo.sh`'s five steps, the
TLS front, `deploy-tasks.sh`, and the smoke as acceptance. (The appliance
half's fixes belong to workplan 0021.)

## T5 — `smoke-managed.sh`: the live smoke becomes a script

The verify + apply smoke that closed 0018 T5 exists only in chat history and
in `deploy-tasks.sh`'s printed hints. Make it
`deploy/compose/smoke-managed.sh`: mint a token (the seed's JWT recipe),
verify start → poll to terminal, apply on a mapping with eligible items
(evidence fabrication + retraction guarded exactly as the hand-run version),
receipt poll to terminal, runner-log capture before `AutoRemove`, stuck-row
landing helper, evidence tee'd to a file. It is the acceptance test for
every future stack change — 0018 proved a green CI says nothing about this.

## T6 — task env vars stop being a dashboard ritual

Task containers inherit nothing from compose; today `DATABASE_URL`,
`APP_DATABASE_URL` and `SECRET_ENCRYPTION_KEY` are hand-entered in the
dashboard (the form itself misbehaved over the TLS front — the working path
was the SDK's `envvars.upload`, currently a chat-only snippet). Script it:
`deploy/compose/set-task-env.sh` reads the same `.env`/container env the
stack runs on and uploads via the envvars API, so rotation is one command
and the dashboard is never load-bearing. (The `syncEnvVars` build extension
remains the alternative if a dependency on `@trigger.dev/build` ever earns
its place — 0018 T0 deferred it.)

## T7 — small hardening sweep

Each is small; none is optional; evidence in the 2026-08-01 review:

- `deploy-tasks.sh` preflights `uname -m` against `DEPLOY_IMAGE_PLATFORM`
  and refuses the amd64-on-arm64 mismatch that cost 0018 T5 a session.
- `apps/api/src/routes/trigger-webhook.ts` is a no-op sink (both TODOs) and
  unauthenticated in every shipped config (`TRIGGER_WEBHOOK_SECRET` set
  nowhere). Wire it to land run/receipt state, or delete the route — an
  endpoint that pretends to receive is worse than none.
- `managed-simple.yml`: decide fix-or-delete. It missed every 0018-era fix
  (no restart policies, no ClickHouse), hardcodes the exact
  `TRIGGER_API_URL: http://localhost:3090` in-container bug T1 of 0018
  killed, and its comments invoke a `worker --config` service it does not
  define. As-is it is a trap shaped like a shortcut.
- `packages/scheduler/src/trigger-client.ts` is the last `@trigger.dev/sdk/v3`
  import (flagged since the 0011-T7 handoff); move callers to the root-path
  SDK import and drop the `/v3` subpath.
- `managed-scheduler.ts`'s header still claims `trigger.config.ts` and the
  deploy step "do not exist yet" — stale since 0018; fix the comment when T8
  touches the file.
- ClickHouse run-replication: enable it (the dashboard Runs page is served
  from ClickHouse and currently renders empty) or record the emptiness as
  accepted in the runbook so nobody debugs it as an outage again.

## T8 — decide: the polling scheduler's future

0018's non-goal, now decidable on evidence: the deployed task path executes
real runs end to end, and the polling `managed-scheduler` (its own header:
"pragmatic interim", "NOT verified against a live stack", and it has zero
tests) still runs every managed sync. Options: (a) move syncs onto scheduled
Trigger.dev tasks and retire the poller; (b) keep the poller as the sync
engine and say so permanently (then it needs tests and its header rewritten).
Either answer is fine; not choosing leaves the managed edition's core loop on
a component that describes itself as temporary. Record the decision here.

## Hard rules that bite here

- **Rule 5:** everything in this plan is managed infrastructure; none of it
  may become an appliance dependency.
- **Rule 9:** T7's webhook decision exists because a silently-discarding
  endpoint masks errors by construction.
- **No secrets in the repo:** T2 is that rule, enforced by config shape
  instead of review vigilance.
