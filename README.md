# Ownpace

Low-maintenance, open-source stack to migrate families and small/medium businesses off US cloud (Microsoft 365, Google, Dropbox) to EU sovereign platforms — starting with **O365 → Soverin / Nextcloud** (Proton later).

- **Idempotent** transfers (re-run safely; no duplicates).
- **Shadow-run** old and new in parallel for as long as you want, then cut over on your schedule.
- **You stay in control** — a clear UI shows what migrates, what doesn't, the status, and any choices to make.
- **Two editions, one core:** self-host it yourself (NAS / mini-PC / Raspberry Pi / Spark) or use it as a managed service.

## Get it (released artifacts)

Published builds — no toolchain needed:

- **Self-host (Docker Compose):** signed multi-arch images on GHCR —
  `docker pull ghcr.io/robbes/open-migrate-selfhost:0.1.0-rc.1` — the old
  image name is deliberate: rc.1 was published before the rename (ADR-0040)
  and that tag exists only at that path. Releases from v0.1.0 on are
  `ghcr.io/robbes/ownpace-selfhost`. (also
  `-api` and `-web` for the managed stack; `edge` is the per-merge rolling
  build). Install guide: [`docs/selfhost-quickstart.md`](./docs/selfhost-quickstart.md);
  channels + signature verification: [`deploy/selfhost/README.md`](./deploy/selfhost/README.md).
- **Windows, no Docker:** the appliance payload zip on the
  [releases page](https://github.com/Robbes/Ownpace/releases) (from
  `v0.1.0` on; unsigned for now, so SmartScreen prompts once). Runbook:
  [`docs/windows-appliance-runbook.md`](./docs/windows-appliance-runbook.md).
- Every release carries a CycloneDX SBOM; images are cosign-signed by digest.
  Release procedure: [`docs/release.md`](./docs/release.md).

## Quickstart (from source)

### Prerequisites
- Node.js 24+ (or use [Corepack](https://nodejs.org/api/corepack.html))
- pnpm (via `corepack enable pnpm`)
- Docker (for integration tests and dev stack)

### Installation
```bash
# Clone the repository
git clone https://github.com/Robbes/Ownpace.git
cd Ownpace

# Install dependencies
corepack enable pnpm
pnpm install
```

### Running Tests
```bash
# Unit tests — NO Docker needed (container-free projects; PGlite makes even
# the real-appliance and RLS-enforcement suites run without a database server)
pnpm test

# Integration tests (requires Docker — testcontainers brings up Postgres,
# Stalwart and Nextcloud itself; no pre-running stack needed)
pnpm test:integration

# All gates
pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration
```

### Running a one-off sync from source (development)

```bash
# Optional dev stack (Postgres + Nextcloud; Stalwart is NOT in dev.yml — its
# two-phase startup can't be one compose service, use deploy/selfhost/setup-stalwart.sh)
docker compose -f deploy/compose/dev.yml up -d

# Run one pass against a mapping file (uses buildDeps to wire ledger + connectors)
pnpm exec tsx apps/worker/src/index.ts --config ./mapping.example.json --once
```

### Configuration
Copy [`mapping.example.json`](./mapping.example.json) and edit it. It is the single
worked example — mail plus the optional `domains` block for calendar, contacts and
files — and it carries inline `_note_*` keys explaining the fields that are easy to
get wrong. Self-host operators start from
[`deploy/selfhost/config/mapping.json.example`](./deploy/selfhost/config/mapping.json.example)
instead, which documents the same fields plus the appliance's loading rules.

This README deliberately does **not** restate the JSON. It used to, and the copy
drifted: its `target.baseUrl` read `https://your-jmap-provider.com/jmap`, which is
the one mistake the examples exist to prevent. **`baseUrl` is the server ROOT** —
scheme, host, port, no path — because the session URL is built as
`${baseUrl}/.well-known/jmap` (RFC 8620 §2.2), so a trailing `/jmap` asks for
`/jmap/.well-known/jmap` and 404s in a way that looks like the server is broken.

Secrets are referenced by **environment variable name** (`tokenFromEnv`,
`passwordFromEnv`), never inline, and never committed.

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
Active development, pre-release. License: Apache-2.0 (see `LICENSE`). "Ownpace" is a
trademark of Archico B.V. — the code is free, the name is not; see [`TRADEMARK.md`](./TRADEMARK.md).

The **migration core** is done and property-tested for idempotency: O365 → JMAP/IMAP-DAV mail,
plus calendar/contacts/files domains (worker `runAllDomains` orchestration) and the cutover
machine.

The **managed edition** runs on one execution plane (workplan 0022): every job — sync, verify,
apply, discovery — executes as a deployed Trigger.dev task, started by a scheduled tick; there is
no worker container. Tenant isolation is enforced at runtime (FORCE RLS through a non-owner role
+ a tenant-membership auth gate), `apply`/`verify` run asynchronously with receipts, billing has
a Mollie webhook end-to-end, and the compose operator stack is live-verified
(`docs/operator-runbook.md`, `smoke-managed.sh`).

The **self-host edition** (a single-tenant NAS/Pi appliance) is complete through workplan 0010,
including the restart-resume idempotency gate across all four domains — and since ADR-0028 it can
run with **no database server at all** (embedded PGlite, one container; the e2e gate is green on
both backends). See the [quickstart](./docs/selfhost-quickstart.md) and `deploy/selfhost/`.

**Known gaps** (tracked in [`docs/workplans/README.md`](./docs/workplans/README.md)): DNS
**writes** are deliberately out of scope — cutover DNS is verify-only, with a generated manual
runbook (owner decision, 2026-07-16). Rollback therefore does not restore DNS or notify users; see
[`docs/rollback-mechanisms.md`](./docs/rollback-mechanisms.md). See
[`docs/workplans/`](./docs/workplans/) for per-slice Status blocks.

## Contributing
See [`CONTRIBUTING.md`](./CONTRIBUTING.md) and [`AGENTS.md`](./AGENTS.md) (guidance for coding agents).
