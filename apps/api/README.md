# Open Migration API

REST API for the Ownpace **managed edition** (Express 5,
TypeScript). The self-host appliance does not run this app — it serves the
same operating contract in-process (`apps/selfhost`, ADR-0026).

> Corrected 2026-08-02 (workplan 0021 T4): the previous version of this file
> named env vars the API has never read (`TRIGGER_DEV_API_KEY`,
> `TRIGGER_WEBHOOK_SECRET`), omitted the two it cannot boot without, taught a
> `pnpm migrate` script that does not exist, and documented a Trigger.dev
> webhook route that was deleted (0020 T7 — the platform never signed for it).

## Overview

- **Tenant management** — tenants and members (role checks are
  `tenant_member`-row facts, see Authentication).
- **Migration control** — mappings, discovery, scope, sync/verify/apply/finish;
  the operating contract's decision queues per mapping.
- **Billing** — usage metering from real runs, invoices, Mollie-backed
  payments (`POST /api/billing/webhooks/mollie` is the one webhook the API
  serves).
- Jobs execute as **deployed Trigger.dev tasks** (ADR-0004, workplan 0022);
  the API only enqueues, via `@openmig/scheduler`'s `trigger-client`.

## Quick start (from source, against the compose stack)

```bash
pnpm install
# Bring up the managed stack first — see docs/operator-runbook.md.
cd deploy/compose && cp managed.env.example .env && ./ensure-env-secrets.sh && cd ../..

export DATABASE_URL="postgres://openmigrate:<POSTGRES_PASSWORD>@localhost:5432/openmigrate"
export APP_DATABASE_URL="postgres://app_user:<APP_DB_PASSWORD>@localhost:5432/openmigrate"
export JWT_SECRET="<same value as in deploy/compose/.env>"
pnpm --filter @openmig/api dev        # API on :3001
```

There is **no `pnpm migrate`** — the API runs the ledger migrations itself at
boot (`packages/ledger` runner, advisory-locked, idempotent).

## Environment variables

Required — the API refuses to work without these:

```bash
APP_DATABASE_URL=postgresql://app_user:...@host:5432/openmigrate
  # The RLS-enforcing app_user role. ALL tenant data goes through this.
DATABASE_URL=postgresql://openmigrate:...@host:5432/openmigrate
  # The DB owner. Boot-time migrations and the demo seed ONLY.
SECRET_ENCRYPTION_KEY=<32+ chars>
  # Encrypts stored connection credentials at rest.
JWT_SECRET=<random>
  # HS256 verification (self-signed / demo tokens). In production the API
  # REFUSES TO BOOT on known placeholder values (0020 T2) — this secret is
  # the tenancy boundary.
```

Optional:

```bash
NODE_ENV=development|production
API_PORT=3001
CORS_ORIGIN=http://localhost:3123     # the web app's dev origin
JWT_ISSUER=https://auth.example.com   # switches verification to remote JWKS (jose);
JWT_AUDIENCE=...                      #   takes precedence over JWT_SECRET when set
MOLLIE_API_KEY=...                    # billing; mocked in tests
```

Enqueueing jobs (read by `@openmig/scheduler`, the SDK's own names — one env
contract shared with `deploy-tasks.sh`):

```bash
TRIGGER_API_URL=http://localhost:3090   # the self-hosted trigger instance
TRIGGER_SECRET_KEY=tr_prod_...          # the project environment's secret key
```

## Authentication

Bearer JWT on every route except `/health`. Two verification modes:
`JWT_ISSUER` set → remote **JWKS** via jose (never decodes without
verification); otherwise **HS256** with `JWT_SECRET`.

**A verified signature is not an authorization** (workplan 0020 T1): the
`(tenantId, sub)` claim must match an ACTIVE `tenant_member` row, probed
under RLS — a forged tenant claim finds no row and gets 403 — and the
caller's **role comes from that row, never from the token**. A `role` claim
in the JWT is ignored.

There is no password-login endpoint; the demo seed
(`./deploy/compose/seed-managed.sh`, which wraps `pnpm --filter @openmig/api
seed:managed` with the environment it needs) prints demo owner tokens. They
expire after seven days; re-run it to mint fresh ones.

## Endpoints (selection)

```bash
curl http://localhost:3001/health

# Tenants / members
GET|POST /api/tenants            GET|POST /api/tenants/:id/members

# Mappings + operating surface (per mapping, tenant-scoped)
GET|POST /api/migrations
POST     /api/migrations/:id/start          # confirm step: paused -> active
POST     /api/migrations/:id/sync           # {"type":"full"|"delta"} -> enqueued task
GET      /api/migrations/:id/deletions|moves|failures
POST     /api/migrations/:id/verify/start   # + GET .../verify/report (poll)
POST     /api/migrations/:id/deletions/:hash/apply   # 202 -> receipt lifecycle
GET      /api/migrations/:id/deletions/:hash/receipt
GET|PATCH /api/migrations/:id/apply-deletions        # the destructive-path flag
POST     /api/migrations/:id/finish

# Billing
POST /api/billing/invoices/generate
POST /api/billing/webhooks/mollie    # the only webhook the API serves
```

The full route inventory is pinned by
`src/routes/migrations/operating-routes.unit.test.ts` — a route added or
removed without updating the pin fails the suite.

## Tenant isolation

1. **Membership gate** — `(tenantId, sub)` must be an ACTIVE `tenant_member`
   row (role from the row).
2. **`withTenant`** — every data access runs in a transaction that drops to
   `app_user` and sets `app.current_tenant` (transaction-local).
3. **RLS** — 26 FORCEd tables; see `docs/rls-guide.md`.

## Testing

```bash
pnpm test                                   # workspace unit gate (repo root)
pnpm test:integration                       # real Postgres via testcontainers
```

Integration suites live next to the routes
(`src/routes/**/*.integration.test.ts`) and seed the memberships their
tokens imply (`src/__tests__/seed-membership.ts`).

## Project structure

```
apps/api/src/
├── index.ts                 # Express app setup + boot-time migrations
├── middleware/auth.ts       # JWT verification + membership gate + boot guard
├── scripts/seed-managed.ts  # demo seed (prints demo owner JWTs)
└── routes/
    ├── tenants/             # tenant + member CRUD
    ├── migrations/          # mappings + the operating contract
    └── billing/             # usage, invoices, Mollie webhook
```

## Deployment

The compose stack builds and runs this app — `deploy/compose/managed.yml`
(service `api`), documented end-to-end in `docs/operator-runbook.md`. There
are no Helm charts in this repo.

## References

- [`docs/operator-runbook.md`](../../docs/operator-runbook.md) — the real bring-up
- [`docs/rls-guide.md`](../../docs/rls-guide.md) — the enforcement model
- [ADR-0026](../../docs/adr/0026-one-operating-ui-one-contract.md) — one contract, both editions
- [OpenAPI spec](./docs/openapi.yaml) — a real OpenAPI 3.1 document (it was
  markdown prose in a `.yaml` file until 2026-08-11). Hand-written, not
  generated, but its SURFACE cannot drift: `openapi-spec.unit.test.ts` fails if
  a documented path has no route, if a route is undocumented, or if a method
  disagrees. Response bodies are pinned where verified and left as open objects
  where they are not — an open object means "not pinned yet", not "empty".
