# Testing

Canonical doc. Summarises the testing approach; full rationale in
`architecture/solution-architecture.md` §22 / §22.1. For everything Stalwart-specific
(two-phase startup, provisioning, TLS-only listeners, known traps) the authoritative reference is
`docs/stalwart-integration-fix.md` — read it before changing the integration setup.

## Test pyramid
- **Unit** (vitest): pure logic — reconcile decisions, idempotency keying, special-use/folder
  mapping, Pattern S/D resolution. No I/O.
- **Connector contract tests**: each source/target adapter against a recorded/standard contract.
- **Integration** (Testcontainers for Node): the global setup spins up the full stack
  programmatically — **Postgres**, **Stalwart v0.16.10 (official image, two-phase
  startup: recovery-mode provisioning, then normal serving)**, and **Nextcloud** (CalDAV/CardDAV/
  WebDAV target). No env vars or pre-running dev stack required; ports are dynamic. Tests exercise
  the ledger, the IMAP/JMAP/imap-dav mail path, and — since issue #114 — the CalDAV/CardDAV/WebDAV
  **target-write** path (see "Multi-domain target-write coverage" below), all with the
  idempotency + delta property (first pass creates N, second pass creates 0).
- **E2E** (docker compose, manual): the real SMB O365 source (read-only, least-privilege) into a
  disposable target; full slice.

## Running tests locally

### Unit tests (no dependencies)
```bash
pnpm test
```

### Integration tests (requires Docker only)
```bash
pnpm test:integration
```
Testcontainers manages everything: fresh Postgres, fresh Stalwart (two-phase: recovery-mode
provisioning of `dev.local` + `source@dev.local` / `target@dev.local` via `stalwart-cli apply`,
then a normal-mode container on the same data volume), schema migration, and teardown including
volume cleanup. Stalwart binds **TLS listeners only** (IMAPS 993, HTTPS 443, SMTPS 465, POP3S 995)
plus unencrypted management/JMAP HTTP on 8080; there is **no plaintext IMAP 143** — the IMAP
client connects to 993 with `rejectUnauthorized: false` for the self-signed test certificate.

The optional `deploy/compose/dev.yml` stack (Postgres + Nextcloud) remains available for manual
exploration, but the integration suite does not depend on it. `dev.yml` does **not** include
Stalwart — its two-phase startup can't be expressed as one `docker compose` service; bring it up
with `deploy/selfhost/setup-stalwart.sh` instead (joins `dev.yml`'s `openmig_dev-network`, so it's
reachable from anything else on that network too).

### E2E tests (manual, requires Docker and real O365 credentials)
```bash
# See docs/deployment.md for full setup
```

### Self-host restart-resume e2e (`.github/workflows/e2e.yml`, manual dispatch, self-hosted runner only)

Black-box gate against a real running appliance (`deploy/selfhost/compose.yml`): seed real
sources, start the appliance, run a pass, `docker compose restart app`, run again, assert the
per-domain ledger item count did **not** grow (zero duplicates). Originally mail-only (workplan
0010 T5); extended by the issue #114 follow-up to also cover **calendar** and **contacts**
against a real cross-account Nextcloud pair (`e2e-source` → `e2e-target`, provisioned by
`deploy/selfhost/setup-nextcloud-users.sh`, seeded by `test/e2e/seed-dav-source.mjs`) — proving
the restart-resume property for the DAV domains, not just that they *can* write (that's
`packages/core/src/dav-sync.integration.test.ts`, proven in CI). **WebDAV files are in this
gate too** (since 2026-07-27 — an earlier revision of this doc said "deferred" long after it
stopped being true): the fixture enables **all four domains**.
`test/e2e/selfhost-restart-resume.e2e.test.ts` iterates over whatever domains are enabled in
`test/e2e/fixtures/selfhost-restart-resume.mapping.json` (`E2E_DOMAINS` env overrides the
list).

The workflow takes two **dispatch inputs**: `seed_count` (items seeded per domain; default 5)
and `persistence` (`postgres` | `pglite` — the latter runs the whole gate on the appliance's
embedded-PGlite shape via `deploy/selfhost/compose.pglite.yml`; both backends are expected to
agree domain-for-domain, and did at the 0016 close).

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

> **Note (2026-08-02).** This section was previously written against
> `GenericSyncEngine`, which was deleted with `runUnifiedSync` in PR #38. The
> real sync implementation is `packages/core/src/domain-sync.ts` —
> `runDomainSync` plus the per-domain wrappers (`runCalendarSync`,
> `runContactSync`, `runFileSync`; design in `docs/design/domain-sync.md`) —
> and the canonical property test for it is
> `packages/core/src/dav-sync.integration.test.ts`.

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
what is under test (it masked bugs #112/#113; see below). The IMAP/DAV mail
equivalent is `apps/worker/src/imap-dav-target.integration.test.ts`'s
"Idempotency property" suite.

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

### Multi-domain target-write coverage (issue #114)

Chasing the 0010 T5 gate surfaced two production "target was never connected" bugs
(`JmapTargetWriter` #112, `ImapDavMailTarget` #113) that shipped undetected because the DAV
source-only tests above never exercised the **write** side (`upsertCalendarEvent`/`upsertContact`/
`upsertFile`) against a real target, and the only test that did (`o365-scenario.e2e.test.ts`) runs
`dryRun: true` and is secret-gated (never in CI). `packages/core/src/dav-sync.integration.test.ts`
closes that gap: a synthetic in-memory source (isolating the untested leg) feeds N seeded
calendar events / contacts / files through `runCalendarSync` / `runContactSync` / `runFileSync`
into a **real** `CalDAVTargetWriter` / `CardDAVTargetWriter` / `WebDAVTargetWriter` writing to
Nextcloud, with **no manual `connect()`** (there's no `connect()` on the `*TargetWriter`
interfaces — this is what masked #112/#113). Each domain asserts: first pass creates N (N>0),
second pass creates 0, and the items are read back from Nextcloud via the real source connector.
The IMAP/DAV mail equivalent (the second mail family, alongside JMAP) is
`apps/worker/src/imap-dav-target.integration.test.ts`'s "Idempotency property" suite, exercising
`ImapDavMailTarget` through the same lazy-connect path with the same N / 0-on-rerun assertion —
proven as part of the #113 fix.

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
async function cleanTargetMailboxes(): Promise<void> {
  const config: ImapSimpleOptions = { /* ... */ };
  const conn = await imap.connect(config);
  
  const mailboxes = await conn.getMailboxes();
  for (const mailbox of Object.values(mailboxes)) {
    await conn.openBox(mailbox.name);
    const all = await conn.search(['ALL'], { fields: ['UID'] });
    if (all.length > 0) {
      const uids = all.map(r => r.attributes.uid);
      await conn.addFlags(uids, '\\Deleted');
      await conn.expunge();
    }
  }
  conn.end();
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

For true isolation, each test file can start its own Stalwart container with unique accounts:

```typescript
import { generateTestAccounts, startStalwartIsolated } from '@openmig/testing';

const TEST_ACCOUNTS = generateTestAccounts('mytest');

beforeAll(async () => {
  const stalwart = await startStalwartIsolated([
    { name: TEST_ACCOUNTS.source.name, password: TEST_ACCOUNTS.source.password },
    { name: TEST_ACCOUNTS.target.name, password: TEST_ACCOUNTS.target.password },
  ]);
  // Use stalwart.imapHost, stalwart.imapPort, etc.
});
```

**Trade-offs:**
- ✅ Complete isolation: No shared state at all
- ❌ Complex: Each test file manages its own container lifecycle
- ❌ Slow: ~10-15 seconds overhead per test file for container startup
- ❌ Resource intensive: Multiple containers if tests run in parallel

Generally, **mailbox cleanup is preferred** unless you have a specific need for complete isolation.

## CI mapping (.github/workflows)
- `ci.yml` — `detect-changes -> docs-hygiene + fixture-uuid-check (parallel) -> lint ->
  unit-tests -> integration-tests`; docs-hygiene enforces the root `.md` allowlist and that the
  canonical docs exist; **`fixture-uuid-check`** enforces unique test-fixture UUIDs across the
  tree (the remediation from `docs/test-fixture-uuid-collision-audit.md` — a colliding tenant or
  mapping UUID pasted into a new test fails CI by name rather than causing cross-test bleed).
- `security-scan.yml` — pnpm audit + Trivy (SARIF) + CycloneDX SBOM; weekly + PR + push + manual;
  SBOM attached to release tags.
- `e2e.yml` — manual only, on `[self-hosted, linux, arm64]` (the Spark); brings up Stalwart via
  `deploy/selfhost/setup-stalwart.sh` (the two-phase recovery→normal bring-up — not a
  `docker compose` service, since compose can't express that transition for one service), seeds
  the source over IMAPS, builds + starts the self-host appliance, and runs the workplan 0010 T5
  restart-resume idempotency gate, then tears down. Installs `stalwart-cli` itself (same install
  step as `integration-tests`, see below) since it drives `setup-stalwart.sh`'s provisioning phase.
- `no-committed-artifacts.yml` — PR guard against committed `node_modules/`, build outputs, local
  DBs, and `.env`.

Runners: GitHub-hosted for lint/unit/build and multi-arch image builds; the self-hosted arm64
Spark runner for integration/e2e. The Spark runner executes trusted workflows only. Both the
`integration-tests` job and `e2e.yml` install `stalwart-cli` as a host binary for their respective
provisioning phases.

## Appendix — untested seams (verified against the tree, 2026-08-02)

What has **no** dedicated test, stated here so it is a fact in the repo rather
than a rediscovery. This list is the honest complement to the coverage above;
each entry is a candidate for a workplan, not a promise.

- **The Trigger.dev task wrappers** (`apps/worker/src/jobs/*.ts`, all eight).
  The logic inside them is tested through extracted seams —
  `sync-due.unit.test.ts` proves the tick's due-evaluation,
  `cutover-preparation.integration.test.ts` drives `prepareCutover`'s body
  against a real ledger, apply/verify logic lives in `@openmig/core` with its
  own suites — but the `schemaTask` wrappers themselves (payload schemas,
  `configure()` wiring, error paths) execute only in live smokes
  (`deploy/compose/smoke-managed.sh`). The 0022 cutover's in-runner API-URL
  bug lived exactly in that untested layer.
- **`apps/worker/src/build-deps-from-mapping.ts`** — the managed, DB-driven
  deps builder (its appliance-side sibling `build-deps.ts` has
  `build-deps.unit.test.ts`). Exercised only inside live task runs; the #207
  all-domain-deps bug lived here.
- **`apps/worker/src/enabled-domains.ts`** — the explicit enabled-domains
  rule (the #207 fix itself). No direct test; covered indirectly wherever
  callers are tested, and by the live smoke.
- **Web pages with no jsdom suite**: `Billing`, `CreateMapping`, `Dashboard`,
  `Failures`, `Login`, `Mappings`, `Moves`, `OperatorDashboard`, `Settings`,
  `Tenants`. (Covered: Confirm, Deletions, Finish, MappingDetail, Verify —
  plus the queue primitives/panel component suites.)
- **Web services/stores with no direct suite**: `billing-service`,
  `mapping-service`, `operating-service` (exercised heavily *through* the
  page suites, but has no test of its own), `auth-store`, `mapping-store`.
- **Mollie billing**: the webhook handler IS covered
  (`invoice-billing.integration.test.ts`, incl. double-delivery no-op) — but
  against a **mocked Mollie client**; no test speaks the real Mollie API.

Removed from this list since the 2026-08-01 review: `managed-scheduler.ts`
(deleted outright, 0022 T4) and the Mollie webhook handler (its coverage was
found, not added — the review overcounted).