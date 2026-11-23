# Testing

Canonical doc. Summarises the testing approach; full rationale in
`architecture/solution-architecture.md` §22 / §22.1. For everything Stalwart-specific
(two-phase startup, provisioning, TLS-only listeners, known traps) the authoritative reference is
`docs/stalwart-integration-fix.md` — read it before changing the integration setup.

## Where tests live

**Tests colocate with their subject.** `billing-service.unit.test.ts` sits beside
`billing-service.ts`; `Billing.unit.test.tsx` beside `Billing.tsx`. This holds for unit AND
integration tests — `packages/ledger/src/rls.integration.test.ts` is next to the code it exercises.

Two exceptions, both because the subject is not a single file:

- **`test/`** at the repository root holds `e2e/` and `ui/` — the two tiers that belong to no
  package. Nothing else lives there.
- **A `__tests__/` directory is FIXTURES ONLY**, never tests. `apps/api/src/__tests__/` holds
  `seed-membership.ts`, a shared seed helper (see `docs/rls-guide.md`).

## Test pyramid
- **Unit** (vitest): pure logic — reconcile decisions, idempotency keying, special-use/folder
  mapping, Pattern S/D resolution. No I/O.
- **Connector contract tests**: each source/target adapter against a recorded/standard contract.
- **Integration** (Testcontainers for Node): the global setup spins up the full stack
  programmatically — **Postgres**, **Stalwart v1.1.1 (official image, two-phase
  startup: recovery-mode provisioning, then normal serving)**, and **Nextcloud** (CalDAV/CardDAV/
  WebDAV target). No env vars or pre-running dev stack required; ports are dynamic. Tests exercise
  the ledger, the IMAP/JMAP/imap-dav mail path, and the CalDAV/CardDAV/WebDAV
  **target-write** path (see "Multi-domain target-write coverage" below), all with the
  idempotency + delta property (first pass creates N, second pass creates 0).
- **UI** (vitest + real Chromium): a browser smoke over the **built** web bundle, served from an
  in-process http server with `/api` answered from fixtures. It exists for defects that are
  invisible to every tier above and ship silently — an uncompiled stylesheet, a bundle calling the
  wrong origin, a dead row — each of which has actually reached production here. It runs on
  **every pull request**, not nightly, because it is cheap and those defects are expensive.
  Kept out of `pnpm test` because it needs two things the unit gate must not require: a Chromium
  binary and a production `pnpm build` of the web app.
- **E2E** (on the self-hosted arm64 runner): nightly black-box gates against a
  running self-host appliance (`e2e.yml`, both persistence backends) and the managed stack
  (`e2e-managed.yml`), a nightly soft lane against a target we do not host
  (`e2e-live-target.yml`). The real SMB O365 source is read by hand only, never in CI
  (`test/e2e/o365-scenario.e2e.test.ts`): read-only, least-privilege, a dry run that lists what
  Graph returns and writes to no target; `docs/test-tenant.md` says how. See "CI mapping" below.

## Running tests locally

### Unit tests (no dependencies)
```bash
pnpm test
```

### Integration tests (requires Docker only)
```bash
pnpm test:integration
```
Testcontainers manages everything: fresh Postgres (the base of the stacks' build,
`deploy/compose/postgres/Dockerfile`, started as its postgres user, uid 70, as the stacks start
it), fresh Stalwart (two-phase: recovery-mode
provisioning of `dev.local` + `source@dev.local` / `target@dev.local` via `stalwart-cli apply`,
then a normal-mode container on the same data volume), schema migration, and teardown including
volume cleanup. In normal mode Stalwart binds IMAPS 993, HTTPS 443, SMTPS 465 and POP3S 995,
unencrypted management/JMAP HTTP on 8080, and plain SMTP on 25 and ManageSieve on 4190; it does
not bind IMAP 143, POP3 110 or submission 587, so there is **no plaintext IMAP**. The tests
publish only 8080, 993 and 465, and the IMAP client connects to 993 with
`rejectUnauthorized: false` for the self-signed test certificate.

The optional `deploy/compose/dev.yml` stack (Postgres + Nextcloud) remains available for manual
exploration, but the integration suite does not depend on it. Its Postgres is `managed.yml`'s
build, so its first `up` builds `deploy/compose/postgres` (a few seconds: the official image with
gosu removed and libxml2 2.13.9-r3 taken from Alpine's mirror, from Docker Hub and that mirror).
`dev.yml` does **not** include Stalwart — its two-phase startup can't be expressed as one
`docker compose` service; bring it up with `deploy/selfhost/setup-stalwart.sh` instead (joins
`dev.yml`'s `ownpace_dev-network`, so it's reachable from anything else on that network too).

### UI smoke (requires Chromium, no Docker)
```bash
pnpm test:ui
```
Builds the web app and drives the real bundle in Chromium. `PLAYWRIGHT_BROWSERS_PATH` must point
at a Chromium install; CI caches one by version. Because it builds first, a cold run is slower
than the whole unit suite — but it is the only tier that sees what a user sees.

### E2E tests (manual, requires Docker and real O365 credentials)
```bash
# The tenant's rules and every variable the suite reads: docs/test-tenant.md
pnpm test:e2e test/e2e/o365-scenario.e2e.test.ts
```

### Self-host restart-resume e2e (`.github/workflows/e2e.yml`, nightly and on dispatch, self-hosted runner only)

Black-box gate against a real running appliance (`deploy/selfhost/compose.yml`): seed real
sources, start the appliance, run a pass, `docker compose restart app`, run again, assert the
per-domain ledger item count did **not** grow (zero duplicates). It covers mail, **calendar**,
**contacts** and **WebDAV files**: the fixture enables **all four domains**, the DAV ones against
a real cross-account Nextcloud pair (`e2e-source` → `e2e-target`, provisioned by
`deploy/selfhost/setup-nextcloud-users.sh`, seeded by `test/e2e/seed-dav-source.mjs`) — proving
the restart-resume property for the DAV domains, not just that they *can* write (that's
`packages/core/src/dav-sync.integration.test.ts`, proven in CI).
`test/e2e/selfhost-restart-resume.e2e.test.ts` iterates over whatever domains are enabled in
`test/e2e/fixtures/selfhost-restart-resume.mapping.json` (`E2E_DOMAINS` env overrides the
list).

The workflow takes two **dispatch inputs**: `seed_count` (items seeded per domain; default 5)
and `persistence` (`postgres` | `pglite` — the latter runs the whole gate on the appliance's
embedded-PGlite shape via `deploy/selfhost/compose.pglite.yml`; both backends are expected to
agree domain-for-domain).

On the Postgres backend the appliance's database is the build of
`deploy/selfhost/postgres/Dockerfile`, started as uid 70. The workflow
builds `app` by name and runs `up` without `--build`, so the database's image is built only when
the runner has no image of its name, which is the run after its Dockerfile changed; the backup and
restore drill then starts it on a new volume, which initialises as uid 70.

## Testcontainers invariants (enforced by the setup; see stalwart-integration-fix.md for rationale)
- Exactly **one Stalwart container per data volume at any moment** (RocksDB exclusive lock);
  phase 1 is fully stopped and confirmed gone before phase 2 starts.
- **Fresh, uniquely named volume per run**, removed in teardown — never reuse dirty volumes.
- Per-phase server logs are streamed to `test-logs/stalwart-phase{1,2}.log`; the log consumer is
  attached to the container instance actually started (retry-loop trap).
- **Test isolation via mailbox cleanup**: Integration tests that share Stalwart accounts must
  clean ALL target mailboxes and database state before each test. This prevents data leakage
  between tests without the overhead of unique accounts per test. See `apps/worker/src/jmap-reindex.integration.test.ts`
  for the canonical pattern: `cleanTargetMailboxes()` + `cleanDatabaseState()` in `beforeEach`.
- Ledger **cursors are isolated between tests**; no test may read another test's cursor.
- After every mirror run the tests **assert the source INBOX count is unchanged**
  (cross-account-pollution guard).

## Property Testing Patterns

The sync implementation is `packages/core/src/domain-sync.ts` — `runDomainSync`
plus the per-domain wrappers (`runCalendarSync`, `runContactSync`, `runFileSync`;
design in `docs/design/domain-sync.md`) — and the canonical property test for it
is `packages/core/src/dav-sync.integration.test.ts`.

### The idempotency property — the shape that is actually tested

Every domain proves the same three-part property, using the real sync loop
(never a bespoke engine):

1. **First pass creates N** (N > 0, from seeded source data).
2. **Second pass creates 0** — every item classifies as `skip`; re-running
   with no source change has no side effects.
3. **Read-back**: the items are read from the target via the real source
   connector, not inferred from the ledger.

The canonical pattern (`dav-sync.integration.test.ts`): a **synthetic
in-memory source** (isolating the leg under test) feeds seeded items through
`runCalendarSync` / `runContactSync` / `runFileSync` into a **real**
`CalDAVTargetWriter` / `CardDAVTargetWriter` / `WebDAVTargetWriter` writing
to Nextcloud, with no manual `connect()` — the lazy-connect path is part of
what is under test (it masked bugs #112/#113; see below).

**The IMAP/DAV mail family has an integration-tier test** in a different shape
from the DAV domains':
`packages/orchestration/src/imap-dav-target.integration.test.ts` drives
`buildDeps` to an `imap-dav` target, writes a message to a real Stalwart, and
checks BY COUNT on the server, with an independent IMAP client, that a second
`upsertEmail` adopts rather than appends. The same property is asserted one tier
down in `packages/connectors/src/imapflow-dav-target.unit.test.ts` ("adopts on a
second pass instead of appending a duplicate"), against a **fake imapflow
client**, and the e2e gate adds real-server evidence
(`test/e2e/selfhost-restart-resume.e2e.test.ts`,
`test/e2e/selfhost-apply-deletion-mail.e2e.test.ts`, both against a real
Stalwart).

Reindex/adoption (ADR-0020 — wiped ledger, target reindex, next pass adopts
instead of duplicating) is covered by `apps/worker/src/jmap-reindex.integration.test.ts`
and the reindex legs of the target-writer suites. The restart-resume flavor
of the same property — kill the process between passes — is the e2e gate
above.

### Domain-Specific Test Files

Use the `*.unit.test.ts` / `*.integration.test.ts` naming convention:

- `caldav-source.unit.test.ts` / `caldav-source.integration.test.ts` - CalDAV **source** connector
  (discovery, listSince, cursor round-trip) against Nextcloud.
- `carddav-source.unit.test.ts` / `carddav-source.integration.test.ts` - CardDAV **source**
  connector, same shape.
- `webdav-source.unit.test.ts` / `webdav-source.integration.test.ts` - WebDAV **source** connector,
  same shape.
- `packages/core/src/dav-sync.integration.test.ts` - **target-write** coverage for all three DAV
  domains (see "Multi-domain target-write coverage" below).

### Multi-domain target-write coverage

The DAV source-only tests above never exercise the **write** side (`upsertCalendarEvent`/
`upsertContact`/`upsertFile`) against a real target, and the only other test that does
(`o365-scenario.e2e.test.ts`) runs `dryRun: true` and is secret-gated (never in CI). Two
"target was never connected" bugs (`JmapTargetWriter` #112, `ImapDavMailTarget` #113) shipped
through that gap. `packages/core/src/dav-sync.integration.test.ts` closes it: a synthetic
in-memory source (isolating the untested leg) feeds N seeded
calendar events / contacts / files through `runCalendarSync` / `runContactSync` / `runFileSync`
into a **real** `CalDAVTargetWriter` / `CardDAVTargetWriter` / `WebDAVTargetWriter` writing to
Nextcloud, with **no manual `connect()`** (there's no `connect()` on the `*TargetWriter`
interfaces — this is what masked #112/#113). Each domain asserts: first pass creates N (N>0),
second pass creates 0, and the items are read back from Nextcloud via the real source connector.
The IMAP/DAV mail equivalent (the second mail family, alongside JMAP) is at this tier too:
`packages/orchestration/src/imap-dav-target.integration.test.ts` parses a mapping
with an `imap-dav` mail target, lets `buildDeps` dispatch it, and writes through `ensureMailbox` +
`upsertEmail` to a real Stalwart. It checks with an INDEPENDENT IMAP client that the message
landed, and BY COUNT on the server that a second `upsertEmail` adopts rather than appends — one
message, not the N-item pass shape above. `packages/connectors/src/imapflow-dav-target.unit.test.ts`
carries the same N / 0-on-rerun property one tier down — "adopts on a second pass instead of
appending a duplicate", asserting `created: false`, `adopted: true`, and a mailbox still holding one
message — against a **fake imapflow client**.

### Native Connector Property Tests

The native CalDAV, CardDAV, and WebDAV connectors support the following property tests:

#### CalDAV-Specific Tests

```typescript
describe('CalDAV Source Properties', () => {
  it('should normalize UIDs to lowercase (case-insensitive)', async () => {
    const source = new CalDAVSource({ /* config */ });
    const { items } = await source.listSince(folder);
    
    // All UIDs should be lowercase
    items.forEach(item => {
      expect(item.item.uid).toBe(item.item.uid.toLowerCase());
    });
  });

  it('should support sync-token and CTag fallback', async () => {
    const source = new CalDAVSource({ /* config */ });
    
    // First sync returns sync-token
    const { nextCursor: cursor1 } = await source.listSince(folder);
    expect(cursor1.value).toMatch(/^sync-token:/);
    
    // Simulate server that doesn't support sync-token
    // Should fall back to CTag format
  });
});
```

#### CardDAV-Specific Tests

```typescript
describe('CardDAV Source Properties', () => {
  it('should preserve UID case (case-sensitive)', async () => {
    const source = new CarddavSource({ /* config */ });
    const { items } = await source.listSince(folder);
    
    // UIDs should preserve their original case
    items.forEach(item => {
      // UID casing should match source exactly
      expect(item.item.uid).toBe(originalUid);
    });
  });

  it('should parse vCard 3.0 and 4.0 formats', async () => {
    const source = new CarddavSource({ /* config */ });
    const { items } = await source.listSince(folder);
    
    // Should handle both vCard versions
    items.forEach(item => {
      expect(item.vcard).toMatch(/^BEGIN:VCARD/);
      expect(item.vcard).toMatch(/VERSION:(3\.0|4\.0)/);
    });
  });
});
```

#### WebDAV-Specific Tests

```typescript
describe('WebDAV Source Properties', () => {
  it('should detect changes via ETag', async () => {
    const source = new WebdavFileSource({ /* config */ });
    
    const { items: items1, nextCursor: cursor1 } = await source.listSince(folder);
    const { items: items2 } = await source.listSince(folder, cursor1);
    
    // No changes should result in empty delta
    expect(items2).toHaveLength(0);
  });

  it('should fall back to size/mtime when ETag unavailable', async () => {
    const source = new WebdavFileSource({ /* config */ });
    
    // When ETag is missing, should use size and mtime for change detection
    const { items } = await source.listSince(folder);
    items.forEach(item => {
      expect(item.item.size).toBeDefined();
      expect(item.item.modifiedAt).toBeDefined();
    });
  });

  it('should normalize paths consistently', async () => {
    const source = new WebdavFileSource({ /* config */ });
    
    // Different path formats should normalize to the same value
    const path1 = source['normalizePath']('/Documents//Reports/');
    const path2 = source['normalizePath']('Documents\\Reports');
    expect(path1).toBe(path2);
  });
});
```

## Test Isolation Patterns

### Mailbox cleanup (recommended for shared accounts)

When multiple tests share the same Stalwart accounts, clean ALL target mailboxes and database
state before each test:

```typescript
// packages/testing/src/imap-test-client.ts (the package's `./imap-test-client` export);
// today's callers import it by relative path.
import { withImapTestClient, purgeAllMailboxes } from '../../../packages/testing/src/imap-test-client.ts';

async function cleanTargetMailboxes(): Promise<void> {
  const { failed } = await withImapTestClient(
    { host: STALWART_IMAP_HOST, port: STALWART_IMAP_PORT, user: TARGET_ACCOUNT, password: TARGET_PASSWORD },
    (client) => purgeAllMailboxes(client),
  );
  for (const [mailbox, reason] of Object.entries(failed)) {
    console.warn(`Could not clean mailbox ${mailbox}: ${reason}`);
  }
}

async function cleanDatabaseState(tenantId: string, mappingId: string): Promise<void> {
  await db.sql`DELETE FROM cursor WHERE mapping_id = ${mappingId}`;
  await db.sql`DELETE FROM item WHERE tenant_id = ${tenantId}`;
  await db.sql`DELETE FROM mailbox WHERE tenant_id = ${tenantId}`;
}

// In beforeEach:
beforeEach(async () => {
  await cleanTargetMailboxes();
  await cleanDatabaseState(TENANT_ID, MAPPING_ID);
  await seedTestData(); // Optional: seed fresh test data
});
```

**Why this approach?**
- ✅ Simple: No complex account provisioning or container management
- ✅ Fast: No container startup overhead (~10-15s saved per test file)
- ✅ Reusable: Works with the existing shared Stalwart infrastructure
- ✅ Standard: Follows the "clean slate" pattern common in integration testing

**When to use unique accounts instead:**
- Tests that need to run truly in parallel (same Stalwart instance)
- Tests that modify account-level settings (not just message data)
- Tests that verify account-specific behavior

### Unique accounts per test (advanced)

For true isolation, a test file would start its own Stalwart container with unique accounts.
**No helper for that exists today.** What `@openmig/testing` does export is `startTestEnvironment` / `stopTestEnvironment`
(`packages/testing/src/testcontainers-setup.ts`), which start the whole shared stack, not one
Stalwart per file.

**Trade-offs:**
- ✅ Complete isolation: No shared state at all
- ❌ Complex: Each test file manages its own container lifecycle
- ❌ Slow: ~10-15 seconds overhead per test file for container startup
- ❌ Resource intensive: Multiple containers if tests run in parallel

Generally, **mailbox cleanup is preferred** unless you have a specific need for complete isolation.

## CI mapping (.github/workflows)
- `ci.yml` — `detect-changes -> docs-hygiene + fixture-uuid-check + migration-lint + lint +
  unit-tests (parallel) -> integration-tests`;
  on a pull request `unit-tests` is split over four hosted runners (`vitest --shard=N/4`, about
  6 minutes instead of 11), and on a push it is one run, on arm64 like every push job (GitHub's
  `ubuntu-24.04-arm` during the alpha, the self-hosted runner otherwise; see Runners below);
  docs-hygiene enforces the root `.md` allowlist and
  that the canonical docs exist; **`fixture-uuid-check`** enforces unique test-fixture UUIDs
  across the tree (the remediation from `docs/test-fixture-uuid-collision-audit.md` — a colliding
  tenant or mapping UUID pasted into a new test fails CI by name rather than causing cross-test
  bleed); **`migration-lint`** replays BOTH migration chains —
  `packages/ledger/migrations`, then `packages/managed/migrations` renumbered above it, staged as
  one directory in the order a managed deployment applies them — with Atlas against a disposable
  dockerized Postgres (the base the stacks build on, `deploy/compose/postgres/Dockerfile`'s FROM
  by tag and digest) and fails on destructive schema changes — runs only when either migration
  directory (or the workflow) changes, on a pull request on hosted amd64 and arm64 (the Atlas
  each runs is its own download, pinned by its SHA-256) and on a push on arm64;
  **`commit-convention`** reads the commit subjects a pull request ADDS and requires the
  Conventional Commits prefix CONTRIBUTING.md and the pull-request template mandate. It runs on
  `pull_request` only and never re-judges history, so older prose subjects on `main` stay as
  they are and no branch is rewritten to go green; merge commits are exempt by parent count,
  because merging the base branch in is how a conflict is resolved here;
  **`gitleaks`** reads every line the commits of a pull request add (`base..head`) with gitleaks
  8.30.1, pinned by the SHA-256 of both architectures' archives, its default rules and
  `.gitleaks.toml`, whose one allowlist holds unit and integration test files and
  `docs/o365-setup.md` (workplan 0163 T6, the owner's decision D4 of 2026-11-20). A finding fails
  the pull request, its file, line, rule and commit named and its value never printed; a value a
  later commit removes is still found, since the history keeps it. A merge is read as git's
  remerge diff, so what a merge wrote itself, a conflict's resolution or a file added beside it,
  is judged, and the lines it brings from `main` are not judged again. No line excuses itself:
  `gitleaks:allow` comments are ignored, and the report refuses to run while a `.gitleaksignore`
  exists. Like `commit-convention` it runs on `pull_request` only and never judges `main`'s
  history. Held by `scripts/a-secret-a-pull-request-could-add.unit.test.ts`, which runs the report
  against a stubbed gitleaks and git.
- `ui-tests` (ci.yml job; real Chromium over the built bundle; every code-changing pull request
  and on main) — `pnpm test:ui`, after `lint`, running while `unit-tests` does.
- `security-scan.yml` — pnpm audit + osv-scanner (fails on a package OSV records as malicious, lists
  the rest) + Trivy (SARIF) + CycloneDX SBOM; weekly + PR + push + manual;
  SBOM attached to release tags. On the weekly run (Mondays 06:00 UTC) and on dispatch only, and on
  GitHub-hosted runners, it also scans every container image the stacks run:
  the `image:` lines of `managed.yml`, `dev.yml`, `www.yml` and the appliance's compose file, the
  images the scripts name, and Ownpace's images at `:edge` and at the
  newest release tag, all as linux/arm64 (`scripts/image-scan.mjs list`). (Until alpha.18 it
  also scanned the Trigger.dev tasks' image, `trigger-task-base`, and the plane's images.) A leg that builds an image a script or a compose file builds
  here checks out under `src/`: Trivy reads a `.trivyignore` and a `trivy.yaml` from its working
  directory unless told otherwise, so on that leg too it reads none of the repository's, and a file
  at the root can never drop a finding from code scanning. Report only: each image's findings go to code scanning under
  `trivy-image-<name>` and fail nothing; an image whose operating system Trivy calls past its end
  of life gets a warning, a line in the run's summary and one issue, closed when that ends. A scan
  that left no report fails the run. An image is named after its repository's last part, with
  its stack (`managed` for `deploy/compose`, `selfhost` for `deploy/selfhost`) added where both
  stacks run that name, so a pin that moves, or two stacks' pins that meet on one reference, keep
  their names. An image that leaves the stacks, or is renamed, leaves its `trivy-image-<name>`
  configuration behind in code scanning with its alerts open; delete it on the code scanning tool
  status page (the Security tab, Code scanning, Tool status). An image a compose file builds here,
  `localhost/<name>` from `<name>/Dockerfile` beside it (the Postgres of `managed.yml` and
  `dev.yml`, and the appliance's), has no
  registry to be read from: its leg checks the commit out under
  `src/`, builds the directory natively on GitHub's arm64 runner and scans what it built, under
  the name the pulled image had (`postgres-managed`, `postgres-selfhost`). The legs of the images
  alpha.18 removed (`trigger.dev`, `supervisor`, `trigger-task-base` and the plane's pulled ones)
  leave their `trivy-image-<name>` configurations, and their alerts, in code scanning until
  someone deletes them there.
- `e2e.yml` — nightly (23:30 UTC on the Postgres stack, 01:30 UTC on PGlite) and on dispatch, on
  `[self-hosted, linux, arm64]` (the machine); brings up Stalwart via
  `deploy/selfhost/setup-stalwart.sh` (the two-phase recovery→normal bring-up — not a
  `docker compose` service, since compose can't express that transition for one service), seeds
  the source over IMAPS, builds + starts the self-host appliance, and runs the restart-resume
  idempotency gate, then tears down. Installs `stalwart-cli` itself (same install
  step as `integration-tests`, see below) since it drives `setup-stalwart.sh`'s provisioning phase.
- `e2e-managed.yml` — nightly (03:30 UTC) and on dispatch, on the machine: the managed-edition
  gate, run against a long-lived configured stack, so it does not prove bring-up from scratch.
  The jobs run on pg-boss, in the `worker` service (ADR-0054); alpha.18 removed Trigger.dev's
  plane and the `job_runner` input that chose it (workplan 0167 T9). After the bring-up it runs
  **the restore drill on the identity provider's database**, `dump-idp.sh --drill`: a dump of
  the provider's database (`zitadel`), restored with `pg_restore --exit-on-error` into a database
  of its own beside it, `<db>_drill`, whose table counts must equal the live database's (at
  least ten tables) and whose event store, `eventstore.events2`, must hold rows and no more than
  the live one; the drill database and the dump are removed whatever happens, and on live the
  drill is refused. It replaces the drill that dumped and restored Trigger.dev's own database,
  the one database whose loss the gate used to prove survivable: the identity provider's is the
  database the stacks cannot rebuild from anything else (who can sign in). Then it runs
  `remove-trigger-plane.sh --yes`, which removes by name whatever Trigger.dev's plane left on the
  OTA stack (its volumes and networks), and on every run after the first says there is nothing
  to remove. `smoke-managed.sh` checks:
  - no container of Trigger.dev's plane is on the stack, by the Compose labels, at its start and
    again at its end;
  - every job in `pgboss.job` since the smoke's start completed, read by queue (the catalog's
    names), and at least one the run asked for. *No job ran* fails;
  - each `runId` it followed is a pg-boss job that completed;
  - `ownpace_jobs` is fit and owns `pgboss`;
  - the worker runs the API's Node as uid 65532, with no shell and its health 200, and holds
    no owner's URL;
  - the tick beat as `managed-sync-tick-pg-boss`.

  The worker's log from the start is kept as `smoke-managed-<run>-worker.log` and redacted with
  the rest of the evidence. `scripts/smoke-managed-verdict.unit.test.ts` runs each of these
  branches against stubs. **The stack's memory** is sampled from the smoke's start with
  `docker stats --no-stream`, every 15 s (`SMOKE_MEM_EVERY`), for the containers named after
  the compose project. Before the verdict the smoke prints each container's highest value and
  when it was sampled, and the sum. Only the used part of each reading is kept, never the limit,
  which for a container with no cap is the host's memory. The readout never decides the verdict.
- **Before a release tag, and so before a deploy to live** (workplan 0141 T14): the newest
  two *scheduled* runs of `e2e-managed.yml` on `main` both ran the commit being tagged and are green on every attempt,
  with no night missing, and the four scheduled `e2e.yml` runs of those nights ran it and are
  green too. A dispatched run does not count, and a red scheduled run starts the count again.
  T14 is the one statement of it; `scripts/release-nights.mjs` reads it, and the Release
  workflow refuses to tag a commit it does not hold for. A tag pushed by hand is the owner's
  break-glass, with the acceptance written in the deploy log.
- `e2e-live-target.yml` — nightly (04:30 UTC) and on dispatch, on the machine: the soft lane against
  a target we do not host. Red means investigate; it never runs on a pull request, so it blocks
  nothing.
- `clock-watch.yml` — daily (06:41 UTC) and on dispatch, on a GitHub-hosted runner: the clocks
  nothing else warns about. It reads the certificates `app.`, `id.` and `status.ownpace.eu`
  serve; `www.ownpace.eu`'s and its `security.txt` `Expires` once the repository variable
  `CLOCK_WATCH_SITE` is `required`; and the Entra client secret's date from
  `CLOCK_WATCH_ENTRA_EXPIRES`. It keeps one issue open while a certificate has fewer than 14
  days left or does not verify, while `security.txt` lacks exactly one `Expires`, or while
  either of the others has fewer than 30, and closes it when none of that holds. The OTA names
  are reported, never counted, and a clock it could not read fails the run and leaves an open
  issue as it is. Its log names names and dates, never an address.
- `exposure-probe.yml` — dispatch only, never scheduled, on a GitHub-hosted runner: the probe
  from outside. It tries every port the two stacks, the site and the demo publish, derived from
  the files, on the addresses the production and OTA names resolve to, and passes when only 443
  answers on the production names, over TLS, with live's issuer, and each of `app.`, `id.`,
  `status.` and `www.ownpace.eu` answers a visitor's first page itself, not a sign-in page in
  front of it, and live's form that founds an organisation, `/ui/login/register/org` at
  `id.ownpace.eu`, answers 404. A port the front answers by itself, listed in the repository
  variable `EXPOSURE_PROBE_FRONT_PORTS`, is a note behind two tripwires: PostgreSQL's handshake,
  and a TLS hello with no server name, which fails on a certificate from Caddy's own local CA,
  the one the Trigger.dev dashboard's TLS front presented until alpha.18. Its log names names and ports, never an address.
- `idp-pin-watch.yml` — weekly (Mondays 06:23 UTC) and on dispatch, on a GitHub-hosted runner:
  every pin Dependabot cannot see, each against its upstream. The
  identity provider's pin in `managed.yml` against upstream's newest release of the same major;
  `packageManager` against the newest pnpm of its major; and the TypeScript split's exit. (The
  rows for Trigger.dev, ClickHouse and the tasks' Node went with alpha.18: each now reports
  current once, with a sentence that says why, so its issue closes, and then nothing.) Each of those keeps one issue open while it is behind, says a newer
  release in a comment, and closes the issue when the pin catches up. Every other image line of
  `managed.yml`, `dev.yml` and `www.yml` (Dependabot reads no file in `deploy/compose`), the
  busybox copies in its scripts, Stalwart's copies, GoAccess, the Trivy and the osv-scanner the scan
  runs, the gitleaks `ci.yml`'s `gitleaks` job runs (against upstream's git tags), the Atlas
  release `ci.yml`'s migration-lint downloads by URL and checks by its SHA-256 (against the community
  image's tags on Docker Hub, since upstream's git tags miss most releases), the stalwart-cli
  release `ci.yml`, `e2e.yml` and `e2e-managed.yml` install the same way (against upstream's git
  tags), the binfmt and BuildKit images `images.yml` names in its actions' inputs (against the
  digest of the channel each action ran before, `latest` and `buildx-stable-1`), the hadolint
  image `hadolint.yml` runs (against Docker Hub's tags of its shape and major), the Semgrep image
  `semgrep.yml` runs (the same way), the zizmor image `zizmor.yml` runs (against ghcr.io's tags of
  its shape and major), and the squawk release `migration-locks.yml` installs (against upstream's
  git tags) share one summary issue (the MinIO row in it, and the tasks' prebuilt base's, went
  with alpha.18); another image a script there
  runs is not compared (none today: `db-roles.sh` reads its client from `managed.yml`). Against a registry a tag is compared, never a digest: a
  rebuild under the same tag is the image scan's to report. The exception is `www.yml`'s nginx,
  which is compared with `apps/web/Dockerfile`'s FROM by tag and digest, so a digest-only move of
  the web image's base lists `www.yml` too. It moves nothing: each issue gives the route for the
  move. A row that cannot read its upstream, or finds its pin ahead of every
  tag listed, fails the run and never closes an issue.
  The cosign `images.yml` signs with and `release.yml`'s verify job checks with is a routine row
  too, since both steps name it (`cosign-release:`) and Dependabot moves only the installer: the
  two copies are held together. Left to cosign-installer's default, it would be a status line
  in the summary issue and open nothing.
- `nextcloud-second-major.yml` — Mondays 05:17 UTC, on a push to `main` that touches the code
  the Nextcloud suites exercise, on a pull request that changes the leg, and on dispatch; on a
  GitHub-hosted runner, never a required check: the suites that talk to Nextcloud against the
  major the demo does not run (see "The second Nextcloud major" below).
- `images.yml` — the three application images: an amd64 build-only check on a pull request that
  touches a Dockerfile, `deploy/` or the workflow; a multi-arch build and publish on `main` and
  on `v*` tags. On such a pull request only, `build (postgres)` also brings up `dev.yml`'s
  postgres and then the appliance's on a runner without their images, so compose builds
  `deploy/compose/postgres` and `deploy/selfhost/postgres`, and checks each runs as uid 70
  without gosu; it publishes nothing. The appliance's starts on the
  volume an existing appliance has, one the official image initialised as root, and must read
  back the row written there. `pgbouncer` builds the pooler's image the same way. (Until alpha.18
  the workflow also built Trigger.dev's webapp and supervisor, the plane's socket proxy, TLS front
  and Redis, and the tasks' prebuilt base, with a job that checked its pin; they went with the
  plane, workplan 0167 T9.)
- `script-images.yml` — the images a script builds for itself (today GoAccess, which
  `deploy/compose/site-visits.sh` builds from `deploy/compose/goaccess/Dockerfile`): an
  arm64 build-only check, `Build (<directory>)`, on a pull request that touches that directory or
  the workflow, Dependabot's move of its Alpine pin included. It pushes nothing.
- `hadolint.yml` — on every pull request, on a push to `main` and on dispatch, on a GitHub-hosted
  runner, never a required check: hadolint 2.15.1, by the tag and index digest `HADOLINT_IMAGE`
  names, over every Dockerfile git lists (found as `a-dockerfile-that-ends-as-root` finds them),
  one run per file with no network and the checkout read-only, with `.hadolint.yaml`, which
  ignores DL3008 and DL3018 (no exact apk or apt versions, the owner's decision of 2026-11-19)
  and nothing else. `hadolint (report only)` writes each file's findings to its summary, a
  finding that guard's EXCEPTIONS or `KNOWN_FINDINGS` explain (both in
  `scripts/hadolint-report.mjs`) marked known with its reason. No finding fails it. A Dockerfile
  left unlinted is a warning on a pull request and fails the run on a push or a dispatch, where
  the run is the record. It was to become blocking after the two Trigger.dev Dockerfiles had had
  their pass; alpha.18 removed them, so that condition is met, and making it blocking is the
  owner's step.
  Held by `scripts/a-dockerfile-that-ends-as-root.unit.test.ts`, which runs the report against a
  stubbed docker.
- `semgrep.yml` — on every pull request, on a push to `main` and on dispatch, on a GitHub-hosted
  runner, to be a required check by its job's name, `Semgrep`, once the owner adds it to the
  repository ruleset that holds `main`'s required checks (workplan 0163 T3 and T5, the owner's
  decision D3 of 2026-11-20):
  Semgrep 1.186.0, by the tag and index digest `SEMGREP_IMAGE` names, over the checkout, mounted
  read-only, with eight rules fetched from Semgrep's registry by id (`RULES` in
  `scripts/semgrep-report.mjs`; no copy of a rule is kept here) for the classes an outside,
  read-only check of 2026-11-20 listed: a regular expression built at run time, a path joined from
  a value, the browser sent to an address a function returned, a React link to an address from a
  value, and three more that found a spot each when workplan 0163 measured Semgrep on this tree.
  `Semgrep` writes each rule's spots to its summary, a spot `KNOWN_FINDINGS` explains marked known
  with its reason. **One rule blocks** (T5): a spot of `run-shell-injection`, which reports nothing
  on `main` and, a YAML rule without taint mode, never reaches the taint analysis's time limit,
  fails it on every event, marked as an error on its line. Nothing in the tree can excuse or hide
  one: no `KNOWN_FINDINGS` entry, no inline `nosemgrep` comment (Semgrep runs with
  `--disable-nosem`), and no `.semgrepignore`, which the checkout may not track at any depth. Every
  workflow and action file the checkout tracks must be among what Semgrep scanned, so one its
  built-in ignore list leaves out (`build/`, `vendor/`, `test/` and the rest, at any depth), one
  over its size limit, a link or an upper-case extension is a scan that did not finish, by name.
  Semgrep's per-file time limit and a file it could not parse are notes in its report; a note on a
  workflow or action file, or on no file naming the rule that blocks, is a scan that did not
  finish, and a note on other YAML (the lock file, compose files) is a note. The other rules report
  only: a spot of one that may block, which no entry explains, is a warning on its line and fails
  nothing. `react-href-var` reports nothing on `main` either and does not block yet: it is a taint
  rule over JavaScript and TypeScript, and `main`'s runs read places only in part where it timed
  out. It runs Semgrep with `--time` and lists each place Semgrep's taint analysis timed out in,
  where a spot can be missing, marked on its line where a rule that may block can have timed out;
  a place counts against the rule Semgrep names when it names one alone, and otherwise against each
  rule whose languages include the file there. A scan that did not finish fails it on every event,
  since on a pull request it vouches for the rule that blocks: so does a place where a rule that
  blocks can have timed out, a report without the timing section, and a registry that does not
  answer when the rules are fetched, which fails a pull request until a re-run. The rules are
  fetched by id and not pinned, so a rule renamed or withdrawn upstream fails every pull request
  and a re-run does not help, and an upstream edit to `run-shell-injection` changes what blocks
  with no change in this repository. On a push to `main`
  the spots of the six rules that may block go to code scanning, also when the rule that blocks
  failed the job, and the two ReDoS rules' spots stay in the summary only; never from a pull
  request. Each other rule becomes blocking, one at a time, once it reports nothing on `main` and
  its time-outs leave `main`'s runs finished; the two ReDoS rules, `detect-non-literal-regexp` and
  `detect-redos`, never do. Held by `scripts/a-finding-only-an-outside-check-saw.unit.test.ts`,
  which runs the report against a stubbed docker.
- `migration-locks.yml` — on a pull request and a push to `main` that touch either migration chain,
  the workflow or its script, and on dispatch, on a GitHub-hosted runner, never a required check
  (workplan 0165): squawk 2.74.0, the static musl build from its GitHub release, checked by its
  sha256 for both architectures before it runs, over every file of both chains, one run per file,
  each read as one transaction (`--assume-in-transaction`, as `runMigrations` applies it) on
  Postgres 18. `squawk (report only)` lists in its summary every finding in a migration file the
  change adds or changes, with a warning on its line, and counts the rest per rule as history,
  since an applied migration never changes. The two CONCURRENTLY rules are marked as rules no
  migration here can meet. No finding fails it, nor a file squawk could not read, which is listed
  and warned about. Held by `scripts/a-lock-a-migration-takes.unit.test.ts`, which runs the report
  against a stand-in squawk, and `scripts/a-pin-that-knows-it-is-behind.unit.test.ts`, which runs
  the install step.
- `zizmor.yml` — on a pull request and a push to `main` that touch `.github/` or an action file,
  and on dispatch, on a GitHub-hosted runner, never a required check: zizmor 1.32.0 since
  2026-11-21, moved on purpose from 1.30.1, the version the outside check of GEN-26 runs, by the
  tag and index digest `ZIZMOR_IMAGE` names, over the whole checkout (every workflow, any action
  file, `dependabot.yml`), offline (`--offline`, no network, no token) and read-only, with
  `--config .github/zizmor.yml`, whose one setting holds `dependabot-cooldown` to Dependabot's
  three days, and `--no-ignores`, so nothing in the tree can turn a rule or a location off.
  `zizmor` is BLOCKING: any finding fails it, and it writes zizmor's report to its summary. Held
  by `scripts/a-workflow-zizmor-would-flag.unit.test.ts`, which also holds every cache-aware step
  in a workflow a tag starts to turning its cache off the way zizmor's `cache-poisoning` audit
  reads it. After the audit, and after a red one too, the same zizmor runs once more with
  `--persona auditor` and `--format json-v1`, REPORT ONLY (workplan 0163 T1, the owner's D2):
  `scripts/zizmor-secrets-report.mjs` lists each secret a job reads while it names no GitHub
  environment (`secrets-outside-env`, shown only under that persona since zizmor 1.24.0) in the
  summary and as a warning on its line. The persona's other findings are counted, not listed, and
  the step fails only when zizmor did not finish. Held by
  `scripts/a-secret-no-environment-holds.unit.test.ts`.
- `windows-payload.yml` (dispatch, and on v* tags; builds the Windows appliance payload).
- `release.yml` — dispatch only, from `main`, on GitHub-hosted runners only; never a required
  check, since it has no pull-request trigger. It cuts a release tag and publishes it in order
  (`docs/release.md`): a preflight that reads the record, the owner's approval, Security Scan on
  exactly the commit, the tag, Security Scan, `images.yml` and `windows-payload.yml` dispatched on
  the tag, and a verify. It dispatches `security-scan.yml` with `image_scans: false`, so those runs
  are the repository scan alone; a hand dispatch keeps the image scans.
- `no-committed-artifacts.yml` — PR guard against committed `node_modules/`, build outputs, local
  DBs, and `.env`.

**Required status checks** on `main`, as this repository intends them, are five: `ci-complete`,
`security-scan`, `Trivy`, `Check for committed artifacts`, and `Semgrep`. A repository ruleset on
`main` holds the first four today, not classic branch protection, whose required checks are off:
`ci-complete`, `security-scan` and `Check for committed artifacts` from GitHub Actions, `Trivy`
from GitHub Advanced Security, with branches up to date before merging. `Semgrep` joins them when
the owner adds it to that ruleset, with GitHub Actions as its source (workplan 0163 T5); until then
a red `Semgrep` shows on a pull request and does not stop its merge. `ci-complete` aggregates
every job in `ci.yml`, so require it rather than the individual jobs — but it can only `needs:`
jobs in its own file, which is why the other four (from `security-scan.yml`,
`no-committed-artifacts.yml` and `semgrep.yml`) have to be required separately. Requiring
`ci-complete` alone silently un-gates them.

**What `ci-complete` requires: every gate that should have run, run and passed.** For each job in
its `needs`, `SHOULD_RUN` in `ci.yml` states whether that job should have run for this event and
this change — the job's own `if:`, and for a job with none, the line of what it needs. A job that
should have run must end in `success`; a job that had no reason to run must end in `skipped` (or
`success`); anything else fails the run, whatever GitHub calls it. `detect-changes` is always
expected, because when it does not succeed everything it gates is skipped for the wrong reason;
and when it does succeed, each of its outputs (`any_changed`, `migrations_changed`) must say
exactly `true` or `false`, because a missing or empty one reads as "nothing changed" to
`SHOULD_RUN` and to every gated job's own `if:` alike. So a docs-only change, where
`detect-changes` succeeded and said `false`, passes with the test jobs skipped and named in the
summary, and so does a push, where `commit-convention` does not run. A list of failure words
would not do: GitHub has reported a job no runner picked up as **`abandoned`**, a value its
documentation for `needs.<job_id>.result` does not list. `ci-complete` carries no
`continue-on-error` and its deciding step no `if:`, and a guard refuses either. Changing a job's
`if:` or `needs:`, adding a job, or adding an output to `detect-changes` means changing
`ci-complete` in the same commit:
`scripts/a-run-that-was-cancelled-and-called-green.unit.test.ts` runs `ci-complete`'s steps
against recorded runs, that `abandoned` one among them, and every event and change, and goes
red when the two disagree.

Do **not** require `integration-tests (ubuntu-24.04)` / `(ubuntu-24.04-arm)`, nor
`build (api|web|selfhost|worker)`, `build (postgres)` or `build (pgbouncer, amd64|arm64)`
from `images.yml`, nor `DAV suites on the second Nextcloud major` from `nextcloud-second-major.yml`,
nor `Build (deploy/compose/goaccess)` from `script-images.yml`, nor `zizmor` from `zizmor.yml`.
None is reported at all on some
pull requests —
a skipped matrix job reports once under the literal `integration-tests (${{ matrix.runner }})`,
and the other four workflows have a `paths:` filter — so a docs-only PR blocks forever on "Expected — waiting
for status to be reported", with nothing queued in Actions to explain it. Full rationale is the
`SCOPE:` comment above `ci-complete` in `ci.yml`. Nor `hadolint (report only)` from
`hadolint.yml`, for another reason: it reports on every pull request, but it is report only and
passes whatever hadolint finds, so requiring it would gate nothing. It was to turn blocking, and
be required then, after the two Trigger.dev Dockerfiles had had their pass; alpha.18 removed
them, so the owner may turn it now. `Semgrep` from
`semgrep.yml` is to be required, by the same rule turned round: it reports on every pull request,
with no `paths:` filter, and since workplan 0163 T5 one of its rules blocks.

**No `pull_request` trigger filters by base branch**, and a guard holds that —
`every-pr-gets-checked.unit.test.ts`. A `branches: [main]` filter gives a pull request opened
against any other branch *no checks at all*. That is the same "Expected — waiting for status to be
reported" trap as the paragraph above, reached from the other direction and harder to see: a
stacked pull request reports nothing, and when the branch beneath it merges GitHub retargets it
to `main` with a `pull_request.edited` event, which is not in the default activity set — so still
nothing runs, and only a fresh push escapes. A `paths:` filter stays allowed because a workflow it skips is one whose
subject the PR did not touch, and the honest response is to leave that check out of branch
protection. A `branches:` filter cannot be rescued that way: the check is required and unreportable.

Removing it does not widen what runs on the self-hosted runner. Every `runs-on` in `ci.yml` sends
only a push there, never a pull request, whatever its branch, so pull requests from anywhere still
run on GitHub-hosted runners — and `push` keeps its `branches: [main]` filter, which is what makes
that true.

Runners: on a pull request every `ci.yml` job is GitHub-hosted, with integration on both
`ubuntu-24.04` and `ubuntu-24.04-arm` for every code-changing pull request; after merge to `main`
the same jobs run once, on arm64. During the alpha that is GitHub's hosted `ubuntu-24.04-arm`, for
`security-scan.yml`'s push scan too, and a
dispatch of either on a branch runs its push jobs there, to prove that path before a merge. The
repository variable `CI_PUSH_ON_SELF_HOSTED`, set to `true`, sends the push jobs back to the
self-hosted arm64 runner; `scripts/a-merge-that-ran-beside-the-socket.unit.test.ts` holds both
states. Image builds are
GitHub-hosted, and e2e runs only on the self-hosted runner, which executes trusted workflows only.
The `integration-tests` job,
`e2e.yml` and `e2e-managed.yml` install `stalwart-cli` as a host binary for their provisioning
phases, by one step word for word: a named release (v1.0.14), each architecture's archive checked
by its SHA-256 before anything is unpacked, and the version the binary prints.

**The second Nextcloud major.** The integration tier, the dev stack and the demo run Nextcloud
35, and the leg runs 34, which a customer who has not upgraded still runs.
`nextcloud-second-major.yml` runs the suites that read a `NEXTCLOUD_` variable (found by `scripts/nextcloud-suites.mjs`: WebDAV,
CalDAV, CardDAV, the DAV sync, the chunked upload and the share verb) against the image its
`NEXTCLOUD_IMAGE` names, pinned by tag and digest, without Stalwart, on a GitHub-hosted runner: on a
push to `main` that touches `packages/**`, `apps/**` or the test setup, weekly, on demand, and on a
pull request that changes the leg itself. A Nextcloud asked for by name that does not start fails
the run (the default only warns and lets the suites skip), the version `status.php` reports must be
the one the tag names, and a report with a skipped test fails it too. Locally, the same with
`NEXTCLOUD_IMAGE=<ref> SKIP_STALWART=true pnpm exec vitest run --project integration
--no-file-parallelism $(node scripts/nextcloud-suites.mjs)`.

## Appendix — untested seams (verified against the tree, 2026-09-24)

What has **no** dedicated test, stated here so it is a fact in the repo rather
than a rediscovery. This list is the honest complement to the coverage above;
each entry is a candidate for a workplan, not a promise.

- **The jobs' run entries end to end against real providers** (`apps/worker/src/jobs/*.ts`).
  The logic inside them is tested through extracted seams —
  `packages/orchestration/src/sync-due.unit.test.ts` proves the tick's
  due-evaluation, `cutover-preparation.integration.test.ts` drives
  `prepareCutover`'s body against a real ledger, the colocated suites in
  `jobs/` drive exported pieces such as `buildTask` and `runDigest`, and
  apply/verify logic lives in `@openmig/core` with its own suites — and the
  runs against real mail and DAV servers execute only in live smokes
  (`deploy/compose/smoke-managed.sh`, which `e2e-managed.yml` runs nightly).
  The runner that wraps them, `apps/worker/src/runner/` (workplan 0167 T6),
  is tested: `worker.integration.test.ts` runs the worker against a real
  Postgres, each job in its own process, and holds the payload schemas (a
  refused payload fails once), the run context (a pass enqueued by the tick's
  schedule, a cutover's wait, the purge's verdicts), the error paths (a
  process killed from outside failed once, a worker that died retried, a time limit, a cancel, a
  stop) and a real `run-discovery`;
  `worker.unit.test.ts` holds that every queue has its entry, and
  `the-catalog-is-the-jobs.unit.test.ts` that the catalog and the run entries
  are one for one. (Until alpha.18 the Trigger.dev task wrappers around the
  same entries were live-only; alpha.18 removed them, workplan 0167 T9.)
- **Web pages with no jsdom suite of their own**: `Invitations`, `NotFound`,
  `RedirectUris`. (`ReportProblem` is covered by
  `a-report-that-reaches-a-person.unit.test.tsx`; every other page has a
  colocated `*.unit.test.tsx`.)
- **Web services/stores with no suite of their own**: `grant-link-service`,
  `platform-service`, `view-service`, `mapping-cache`, and `auth-store` (the
  last exercised through the page and component suites, but with no test of
  its own).
- **Mollie billing**: the webhook handler IS covered
  (`invoice-billing.integration.test.ts`, incl. double-delivery no-op) — but
  against a **mocked Mollie client**; no test speaks the real Mollie API.