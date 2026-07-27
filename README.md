# Open Migration Stack

Low-maintenance, open-source stack to migrate families and small/medium businesses off US cloud (Microsoft 365, Google, Dropbox) to EU sovereign platforms — starting with **O365 → Soverin / Nextcloud** (Proton later).

- **Idempotent** transfers (re-run safely; no duplicates).
- **Shadow-run** old and new in parallel for as long as you want, then cut over on your schedule.
- **You stay in control** — a clear UI shows what migrates, what doesn't, the status, and any choices to make.
- **Two editions, one core:** self-host it yourself (NAS / mini-PC / Raspberry Pi / Spark) or use it as a managed service.

## Quickstart

### Prerequisites
- Node.js 24+ (or use [Corepack](https://nodejs.org/api/corepack.html))
- pnpm (via `corepack enable pnpm`)
- Docker (for integration tests and dev stack)

### Installation
```bash
# Clone the repository
git clone https://github.com/your-org/open-migrate.git
cd open-migrate

# Install dependencies
corepack enable pnpm
pnpm install
```

### Running Tests
```bash
# Unit tests (root config boots a throwaway Postgres via Testcontainers → needs Docker)
pnpm test

# Integration tests (requires Docker)
pnpm test:integration

# All gates
pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration
```

### Running the Worker (Development)

> **Note:** The worker CLI and dependency injection (ledger, IMAP source, JMAP target) are implemented in `apps/worker/src/build-deps.ts`. Integration tests verify the full stack works end-to-end.

```bash
# Bring up the dev stack (Postgres + Stalwart + Nextcloud)
docker compose -f deploy/compose/dev.yml up -d

# Run worker (uses buildDeps to wire ledger, IMAP, JMAP)
node --loader ts-node/esm apps/worker/src/index.ts --config ./mapping.example.json --once
```

### Configuration
Create a mapping configuration file (see `mapping.example.json`):
```json
{
  "tenantId": "your-tenant-id",
  "mappingId": "inbox-mail",
  "source": {
    "type": "imap-oauth2",
    "host": "outlook.office365.com",
    "port": 993,
    "user": "user@example.onmicrosoft.com",
    "auth": { "kind": "xoauth2", "tokenFromEnv": "O365_ACCESS_TOKEN" }
  },
  "target": {
    "type": "jmap",
    "baseUrl": "https://your-jmap-provider.com/jmap",
    "user": "target@domain.com",
    "auth": { "kind": "basic", "passwordFromEnv": "TARGET_PASSWORD" }
  },
  "schedule": { "cron": "*/15 * * * *" }
}
```

Secrets should be stored in environment variables or a vault, never committed to the repository.

## Documentation
Everything lives in [`docs/`](./docs/). Start with the source of truth: [`docs/architecture/solution-architecture.md`](./docs/architecture/solution-architecture.md). Decisions are recorded in [`docs/adr/`](./docs/adr/).

### Key Documentation
- **Architecture**: [`docs/architecture/solution-architecture.md`](./docs/architecture/solution-architecture.md)
- **Testing Guide**: [`docs/testing.md`](./docs/testing.md)
- **Self-host Quickstart**: [`docs/selfhost-quickstart.md`](./docs/selfhost-quickstart.md)
- **Stalwart Integration**: [`docs/stalwart-integration-fix.md`](./docs/stalwart-integration-fix.md)
- **Workplans**: [`docs/workplans/`](./docs/workplans/)
- **Decision Records**: [`docs/adr/`](./docs/adr/)

## Status
Active development, pre-release. License: Apache-2.0 (see `LICENSE`).

The **migration core** is done and property-tested for idempotency: O365 → JMAP/IMAP-DAV mail,
plus calendar/contacts/files domains (worker `runAllDomains` orchestration) and the cutover
machine.

The **managed edition** control plane is complete through workplan 0011 T1–T7: tenant isolation
enforced at runtime (Postgres RLS with a non-owner role, proven cross-tenant at the SQL and HTTP
layers), real API persistence, Trigger.dev jobs running real syncs across all four domains,
usage metering from real runs, billing with a Mollie webhook end-to-end, the web UI on the real
API, and a live-verified `docker compose` operator stack.

The **self-host edition** (a single-tenant NAS/Pi appliance bundling Postgres) is complete through
workplan 0010 T1–T6, including the restart-resume idempotency gate — a real seeded run showing
zero item-count growth across a container restart for mail, calendar, contacts and files. See the
[quickstart](./docs/selfhost-quickstart.md) and `deploy/selfhost/`.

**Known gaps** (tracked in [`docs/workplans/README.md`](./docs/workplans/README.md)): DNS
**writes** are deliberately out of scope — cutover DNS is verify-only, with a generated manual
runbook (owner decision, 2026-07-16). Rollback therefore does not restore DNS or notify users; see
[`docs/rollback-mechanisms.md`](./docs/rollback-mechanisms.md). Run history (`run`/`run_event`) is
not yet populated. See [`docs/workplans/`](./docs/workplans/) for per-slice Status blocks.

## Contributing
See [`CONTRIBUTING.md`](./CONTRIBUTING.md) and [`AGENTS.md`](./AGENTS.md) (guidance for coding agents).
