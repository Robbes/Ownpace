# Ownpace

Low-maintenance, open-source stack to migrate families and small/medium businesses off US cloud (Microsoft 365, Google, iCloud, Dropbox, Box, or another mail provider) to EU sovereign platforms: **Soverin**, **Nextcloud**, a **JMAP** server such as Stalwart, or any IMAP / CalDAV / CardDAV / WebDAV service. Proton is not supported yet.

- **Idempotent** transfers (re-run safely; no duplicates).
- **Shadow-run** old and new in parallel for as long as you want, then cut over on your schedule.
- **You stay in control** — a clear UI shows what migrates, what doesn't, the status, and any choices to make.
- **Two editions, one core:** self-host it yourself (NAS / mini-PC / Raspberry Pi / arm64 machine) or use it as a managed service.

## Get it (released artifacts)

Published builds — no toolchain needed:

- **Self-host (Docker Compose):** signed multi-arch images on GHCR, one per
  release: `docker pull ghcr.io/robbes/ownpace-selfhost:<version>`, where
  `<version>` is the release's tag without the `v`. The
  [releases page](https://github.com/Robbes/Ownpace/releases) lists every
  release; the managed stack's images are `-api` and `-web`, and `edge` is the
  rolling build of `main`. Install guide: [`docs/selfhost-quickstart.md`](./docs/selfhost-quickstart.md);
  channels and signature verification: [`deploy/selfhost/README.md`](./deploy/selfhost/README.md).
- **Windows, no Docker:** the appliance payload zip on the releases page,
  unsigned for now, so SmartScreen prompts once. Runbook:
  [`docs/windows-appliance-runbook.md`](./docs/windows-appliance-runbook.md).
- Releases carry a CycloneDX SBOM (`bom.json`), and their images are
  cosign-signed by digest. Release procedure: [`docs/release.md`](./docs/release.md).

## Quickstart (from source)

### Prerequisites
- Node.js 26 (the version CI and the images use; `engines` asks for `>=26`). On Linux the
  official Node 26 binaries need `libatomic1` (`sudo apt-get install libatomic1` on Debian
  and Ubuntu); the images carry it.
- pnpm 11, from npm: Node 25 and later ship no Corepack, so `npm install -g pnpm@11`; inside
  the repository it switches itself to the version `package.json`'s `packageManager` names
- GnuPG's `gpgv`, for `pnpm test` and for staging the Windows payload: it checks the signature
  on the Node.js release list the payload's `node.exe` is pinned to (`sudo apt-get install gpgv`
  on Debian and Ubuntu; Homebrew's `gnupg` on macOS)
- Docker (for integration tests and dev stack)

### Installation
```bash
# Clone the repository
git clone https://github.com/Robbes/Ownpace.git
cd Ownpace

# Install dependencies (pnpm from npm: Node 26 ships no corepack)
npm install -g pnpm@11
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

**`baseUrl` is the server root**: scheme, host and port, no path. The session URL
is built as `${baseUrl}/.well-known/jmap` (RFC 8620 §2.2), so a trailing `/jmap` asks
for `/jmap/.well-known/jmap` and fails with a 404 that looks like a broken server.

Secrets are referenced by **environment variable name** (`tokenFromEnv`,
`passwordFromEnv`), never inline, and never committed.

## Documentation
Everything lives in [`docs/`](./docs/). Start with the source of truth,
[`docs/architecture/solution-architecture.md`](./docs/architecture/solution-architecture.md).
Decisions are recorded in [`docs/adr/`](./docs/adr/), plans and their status in
[`docs/workplans/`](./docs/workplans/). Also: [testing](./docs/testing.md), the
[self-host quickstart](./docs/selfhost-quickstart.md) and the
[Stalwart integration](./docs/stalwart-integration-fix.md).

## Status
In alpha since `v0.2.0-alpha.1` (2026-10-06): a free test by invitation. A database migration
a release has shipped is never rewritten. License: Apache-2.0 (see `LICENSE`). "Ownpace" is a
trademark of Archico B.V. — the code is free, the name is not; see [`TRADEMARK.md`](./TRADEMARK.md).

The **migration core** is done and property-tested for idempotency: O365 → JMAP/IMAP-DAV mail,
plus calendar/contacts/files/tasks domains (`runAllDomains` in `packages/orchestration`) and the
cutover machine.

The **managed edition** runs every job (sync, verify, apply, discovery) as a deployed Trigger.dev
task, started by a scheduled tick; there is no worker container. Tenant isolation is enforced at
runtime: in the API (FORCE RLS through a non-owner role, and a tenant-membership auth gate), in
the per-tenant tasks, which connect as the same non-owner role, and in the digest, the drift
detector and group discovery, which read each organisation as itself. The three scheduled jobs
that span organisations connect as a system role that bypasses row security, is not a superuser
and holds only the grants their statements need, so there isolation rests on each query's tenant
filter. No task holds the database owner's credential;
[`docs/rls-guide.md`](./docs/rls-guide.md) says where row security holds and where it does not.
`apply` and `verify` run asynchronously with receipts, and the compose operator stack is verified
live (`docs/operator-runbook.md`, `smoke-managed.sh`). Billing is not live yet: the Mollie webhook
marks an invoice paid (tested with Mollie mocked), but no invoice is minted until invoices are
raised by tier, and the payment journey has not been walked end to end.

The **self-host edition** is a single-tenant appliance for a NAS, mini-PC or Raspberry Pi, with
the restart-resume idempotency gate across all five domains. It runs on Postgres or with **no
database server at all** (embedded PGlite, one container), and the end-to-end gate is green on
both. See the [quickstart](./docs/selfhost-quickstart.md) and `deploy/selfhost/`.

**Known gaps** are listed in
[the feature matrix's open gaps](./docs/feature-matrix.md#the-open-gaps-in-one-place). DNS
**writes** are out of scope: cutover DNS is verify-only, with a generated manual runbook, so
rollback does not restore DNS or notify users (see
[`docs/rollback-mechanisms.md`](./docs/rollback-mechanisms.md)).

## How this code is written

Ownpace is built by one person working with **generative AI coding assistants**,
and says so here because you should be able to judge the code knowing that.

**Where they are used**: application logic, tests, refactors, documentation and
commit messages — most of the repository has passed through one. **Where the
human stays accountable**: every design decision, every ADR, every trade-off
recorded in `docs/workplans/`, and the review that decides whether a change
lands at all.

The discipline that makes this safe to rely on is not the assistant, it is the
guards. **Every safety property is a test that has been proven by breaking it** —
written, then deliberately falsified to confirm it fails, then restored. Agents
draft; the guards decide. A change that cannot be shown to fail when the
behaviour it protects is removed does not count as tested here.

**Provenance is in the git history, not a claim in this file.** Commits produced
with assistance carry a `Co-Authored-By:` trailer naming the model. `git log` is
the authoritative record of what was assisted and what was not.

Contributors are welcome to use these tools on the same terms: disclose it in
the commit, and hold yourself to the same guard discipline — a test you have not
watched fail is not evidence.

## Contributing
See [`CONTRIBUTING.md`](./CONTRIBUTING.md) and [`AGENTS.md`](./AGENTS.md) (guidance for coding agents).
