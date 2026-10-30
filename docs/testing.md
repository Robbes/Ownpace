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

Stated here because it had drifted: until 2026-08-13, four of `apps/web`'s fifteen page tests sat
in `src/__tests__/` while eleven were colocated, and the split was still spreading — one of the
four was added the same day as a colocated sibling. A convention nobody has written down is a
convention that is already half-abandoned.

## Test pyramid
- **Unit** (vitest): pure logic — reconcile decisions, idempotency keying, special-use/folder
  mapping, Pattern S/D resolution. No I/O.
- **Connector contract tests**: each source/target adapter against a recorded/standard contract.
- **Integration** (Testcontainers for Node): the global setup spins up the full stack
  programmatically — **Postgres**, **Stalwart v0.16.27 (official image, two-phase
  startup: recovery-mode provisioning, then normal serving)**, and **Nextcloud** (CalDAV/CardDAV/
  WebDAV target). No env vars or pre-running dev stack required; ports are dynamic. Tests exercise
  the ledger, the IMAP/JMAP/imap-dav mail path, and — since issue #114 — the CalDAV/CardDAV/WebDAV
  **target-write** path (see "Multi-domain target-write coverage" below), all with the
  idempotency + delta property (first pass creates N, second pass creates 0).
- **UI** (vitest + real Chromium): a browser smoke over the **built** web bundle, served from an
  in-process http server with `/api` answered from fixtures. It exists for defects that are
  invisible to every tier above and ship silently — an uncompiled stylesheet, a bundle calling the
  wrong origin, a dead row — each of which has actually reached production here. It runs on
  **every pull request**, not nightly, because it is cheap and those defects are expensive.
  Kept out of `pnpm test` because it needs two things the unit gate must not require: a Chromium
  binary and a production `pnpm build` of the web app.
- **E2E** (on the self-hosted arm64 Spark): nightly black-box gates against a
  running self-host appliance (`e2e.yml`, both persistence backends) and the managed stack
  (`e2e-managed.yml`), a nightly soft lane against a target we do not host
  (`e2e-live-target.yml`), and a dispatch-only shadow read of the real SMB O365 source
  (`e2e-o365.yml`): read-only, least-privilege, a dry run that lists what Graph returns and
  writes to no target. See "CI mapping" below.

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
`deploy/compose/postgres/Dockerfile`, started as its postgres user, uid 70, as the stacks start it;
workplan 0146 T15), fresh Stalwart (two-phase: recovery-mode
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
gosu removed). `dev.yml` does **not** include
Stalwart — its two-phase startup can't be expressed as one `docker compose` service; bring it up
with `deploy/selfhost/setup-stalwart.sh` instead (joins `dev.yml`'s `ownpace_dev-network`, so it's
reachable from anything else on that network too).

### UI smoke (requires Chromium, no Docker)
```bash
pnpm test:ui
```
Builds the web app and drives the real bundle in Chromium. `PLAYWRIGHT_BROWSERS_PATH` must point
at a Chromium install; CI caches one by version. Because it builds first, a cold run is slower
than the whole unit suite — but it is the only tier that sees what a user sees.

### E2E tests (manual, requires Docker and real O365 credentials)
```bash
# See docs/test-tenant.md for the tenant and the secrets e2e-o365.yml needs
```

### Self-host restart-resume e2e (`.github/workflows/e2e.yml`, nightly and on dispatch, self-hosted runner only)

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

On the Postgres backend the appliance's database is the build of
`deploy/selfhost/postgres/Dockerfile`, started as uid 70 (workplan 0146 T15b). The workflow
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
what is under test (it masked bugs #112/#113; see below).

**The IMAP/DAV mail family has an integration-tier test again since
2026-09-22**, in a different shape from the DAV domains':
`packages/orchestration/src/imap-dav-target.integration.test.ts` drives
`buildDeps` to an `imap-dav` target, writes a message to a real Stalwart, and
checks BY COUNT on the server, with an independent IMAP client, that a second
`upsertEmail` adopts rather than appends. The same property is asserted one tier
down in `packages/connectors/src/imapflow-dav-target.unit.test.ts` ("adopts on a
second pass instead of appending a duplicate"), against a **fake imapflow
client**, and the e2e gate adds real-server evidence
(`test/e2e/selfhost-restart-resume.e2e.test.ts`,
`test/e2e/selfhost-apply-deletion-mail.e2e.test.ts`, both against a real
Stalwart). This list cited `apps/worker/src/imap-dav-target.integration.test.ts`
until 2026-08-13; that file was deleted by commit `4cac2bd` when imap-simple was
dropped, and its cases were carried into the unit suite above.

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
The IMAP/DAV mail equivalent (the second mail family, alongside JMAP) is at this tier too, since
2026-09-22: `packages/orchestration/src/imap-dav-target.integration.test.ts` parses a mapping
with an `imap-dav` mail target, lets `buildDeps` dispatch it, and writes through `ensureMailbox` +
`upsertEmail` to a real Stalwart. It checks with an INDEPENDENT IMAP client that the message
landed, and BY COUNT on the server that a second `upsertEmail` adopts rather than appends — one
message, not the N-item pass shape above. `packages/connectors/src/imapflow-dav-target.unit.test.ts`
still carries the same N / 0-on-rerun property one tier down — "adopts on a second pass instead of
appending a duplicate", asserting `created: false`, `adopted: true`, and a mailbox still holding one
message — against a **fake imapflow client**.

The gap had a history. `apps/worker/src/imap-dav-target.integration.test.ts` was deleted by commit
`4cac2bd` when imap-simple was dropped (workplan 0032); its commit message records that the
writer's cases were carried over "plus two more", which was true of the CASES and not of the TIER,
until the orchestration test above put a real server back under this target.

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
**No helper for that exists today.** The sample that stood here imported `generateTestAccounts`
and `startStalwartIsolated` from `@openmig/testing`, and neither has ever been in the repository.
What `@openmig/testing` does export is `startTestEnvironment` / `stopTestEnvironment`
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
  unit-tests (parallel) -> integration-tests` (unit-tests stopped waiting for lint on 2026-10-05);
  on a pull request `unit-tests` is split over four hosted runners (`vitest --shard=N/4`, about
  6 minutes instead of 11), and on a push it is one run on the Spark; docs-hygiene enforces the root `.md` allowlist and
  that the canonical docs exist; **`fixture-uuid-check`** enforces unique test-fixture UUIDs
  across the tree (the remediation from `docs/test-fixture-uuid-collision-audit.md` — a colliding
  tenant or mapping UUID pasted into a new test fails CI by name rather than causing cross-test
  bleed); **`migration-lint`** (ADR-0017, built 2026-08-02) replays BOTH migration chains —
  `packages/ledger/migrations`, then `packages/managed/migrations` renumbered above it, staged as
  one directory in the order a managed deployment applies them — with Atlas against a disposable
  dockerized Postgres and fails on destructive schema changes — runs only when either migration
  directory (or the workflow) changes;
  **`commit-convention`** (2026-09-21) reads the commit subjects a pull request ADDS and requires
  the Conventional Commits prefix CONTRIBUTING.md and the pull-request template both already
  mandated. Measured the day it was built: two of the last two hundred subjects on `main`
  followed it, and both were dependabot's — the rule was documented in two places and enforced by
  nothing. It runs on `pull_request` only and never re-judges history, so those hundred-odd prose
  subjects stay as they are and no branch is rewritten to go green; merge commits are exempt by
  parent count, because merging the base branch in is how a conflict is resolved here.
- `ui-tests` (ci.yml job; real Chromium over the built bundle; every code-changing pull request
  and on main) — `pnpm test:ui`, after `lint`, running while `unit-tests` does.
- `security-scan.yml` — pnpm audit + Trivy (SARIF) + CycloneDX SBOM; weekly + PR + push + manual;
  SBOM attached to release tags. On the weekly run (Mondays 06:00 UTC) and on dispatch only, and on
  GitHub-hosted runners, it also scans every container image the stacks run (workplan 0146 T8):
  the `image:` lines of `managed.yml`, `dev.yml`, `www.yml` and the appliance's compose file, the
  images the scripts name, the tasks' image, and Ownpace's three images at `:edge` and at the
  newest release tag, all as linux/arm64 (`scripts/image-scan.mjs list`). The tasks' image is
  built in its leg, not pulled (workplan 0146 T10): the leg installs the workspace, writes the
  `base` stage a task deploy builds (`image-scan.mjs containerfile`, which runs
  `apps/worker/trigger.config.ts`'s own build extensions) on the image `apps/api/Dockerfile`
  builds FROM, which the config builds the tasks on since workplan 0146 T14 (on the base image
  the pinned Trigger.dev CLI names when the config names none), builds it natively on
  `ubuntu-24.04-arm` under a local tag in that base's repository, and Trivy reads it from that
  runner's Docker alone. That checkout is under `src/`: Trivy reads a `.trivyignore` and a
  `trivy.yaml` from its working directory unless told otherwise, so on this leg too it reads none
  of the repository's, and a file at the root can never drop a finding from code scanning. Report only: each image's findings go to code scanning under
  `trivy-image-<name>` and fail nothing; an image whose operating system Trivy calls past its end
  of life gets a warning, a line in the run's summary and one issue, closed when that ends. A scan
  that left no report fails the run. An image is named after its repository's last part, with
  its stack (`managed` for `deploy/compose`, `selfhost` for `deploy/selfhost`) added where both
  stacks run that name, so a pin that moves, or two stacks' pins that meet on one reference, keep
  their names. An image that leaves the stacks, or is renamed, leaves its `trivy-image-<name>`
  configuration behind in code scanning with its alerts open; delete it on the code scanning tool
  status page (the Security tab, Code scanning, Tool status). An image a compose file builds here,
  `localhost/<name>` from `<name>/Dockerfile` beside it (the Postgres of `managed.yml` and
  `dev.yml`, workplan 0146 T15, the appliance's, T15b, and Trigger.dev's webapp and supervisor in
  `managed.yml`, T16), has no registry to be read from: its leg checks the commit out under
  `src/`, builds the directory natively on GitHub's arm64 runner and scans what it built, under
  the name the pulled image had (`postgres-managed`, `postgres-selfhost`, `trigger.dev`,
  `supervisor`).
- `e2e.yml` — nightly (23:30 UTC on the Postgres stack, 01:30 UTC on PGlite) and on dispatch, on
  `[self-hosted, linux, arm64]` (the Spark); brings up Stalwart via
  `deploy/selfhost/setup-stalwart.sh` (the two-phase recovery→normal bring-up — not a
  `docker compose` service, since compose can't express that transition for one service), seeds
  the source over IMAPS, builds + starts the self-host appliance, and runs the workplan 0010 T5
  restart-resume idempotency gate, then tears down. Installs `stalwart-cli` itself (same install
  step as `integration-tests`, see below) since it drives `setup-stalwart.sh`'s provisioning phase.
- `e2e-managed.yml` — nightly (03:30 UTC) and on dispatch, on the Spark: the managed-edition gate
  (workplan 0084), run against a long-lived configured stack, so it does not prove bring-up from
  scratch.
- **Before a release tag, and so before a deploy to live** (workplan 0141 T14, the owner's rule
  of 2026-09-27, read strictly since 2026-10-23): the newest two *scheduled* runs of
  `e2e-managed.yml` on `main` both ran the commit being tagged and are green on every attempt,
  with no night missing, and the four scheduled `e2e.yml` runs of those nights ran it and are
  green too. A dispatched run does not count, and a red scheduled run starts the count again.
  T14 is the one statement of it; `scripts/release-nights.mjs` reads it, and the Release
  workflow refuses to tag a commit it does not hold for. A tag pushed by hand is the owner's
  break-glass, with the acceptance written in the deploy log.
- `e2e-live-target.yml` — nightly (04:30 UTC) and on dispatch, on the Spark: the soft lane against
  a target we do not host (workplan 0105 T4). Red means investigate; it never runs on a pull
  request, so it blocks nothing.
- `e2e-o365.yml` — dispatch only, on the Spark: the secret-gated real-tenant O365 e2e (workplan
  0008 T7); the tenant and its secrets are in `docs/test-tenant.md`.
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
  from outside (workplan 0132 T3). It tries every port the two stacks, the site and the demo
  publish, derived from the files, on the addresses the production and OTA names resolve to, and
  passes when only 443 answers on the production names, over TLS, with live's issuer, and each of
  `app.`, `id.`, `status.` and `www.ownpace.eu` answers a visitor's first page itself, not
  NetBird's sign-in (workplan 0139, item 8). Its log names names and ports, never an address.
- `idp-pin-watch.yml` — weekly (Mondays 06:23 UTC) and on dispatch, on a GitHub-hosted runner:
  every pin Dependabot cannot see, each against its upstream (workplan 0135 T7 (b), 0146 T8). The
  identity provider's pin in `managed.yml` against upstream's newest release of the same major;
  Trigger.dev against the newest tag both its images carry (`trigger-version.sh probe`);
  ClickHouse against the one Trigger.dev's own compose file pins; the tasks' Node against Node's
  newest security release, until `trigger.config.ts` builds the tasks on the API image's own base
  (it took that image's Node from issue #1669 and builds on the image from 0146 T14, so that row
  reports current); `packageManager` against the newest pnpm of its major; and the
  TypeScript split's exit. Each of those keeps one issue open while it is behind, says a newer
  release in a comment, and closes the issue when the pin catches up. Every other image line of
  `managed.yml`, `dev.yml` and `www.yml` (Dependabot reads no file in `deploy/compose`), the
  busybox copies in its scripts, Stalwart's copies, GoAccess and the Trivy the scan runs share one
  summary issue; another image a script there runs is not compared (none today: `db-roles.sh`
  reads its client from `managed.yml`). Against a registry a tag is compared, never a digest: a
  rebuild under the same tag is the image scan's to report. The exception is `www.yml`'s nginx,
  which is compared with `apps/web/Dockerfile`'s FROM by tag and digest, so a digest-only move of
  the web image's base lists `www.yml` too. It moves nothing: each issue gives the route, and the
  move is the owner's call. A row that cannot read its upstream, or finds its pin ahead of every
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
  without gosu (workplan 0146 T15, T15b); it publishes nothing. The appliance's starts on the
  volume an existing appliance has, one the official image initialised as root, and must read
  back the row written there. And `build (trigger, amd64)` and `build (trigger, arm64)` build
  `deploy/compose/trigger.dev` and `deploy/compose/supervisor`, upstream's Trigger.dev images with
  files deleted that never run here, natively on each platform, after checking the base's user,
  command and entrypoint are the ones the Dockerfiles read, and check the result keeps upstream's
  user, command, entrypoint and working directory (workplan 0146 T16). Each removal fails the
  build by name when its path is not there, and each Dockerfile refuses another release than its
  `read_at`, so the pull request of a Trigger.dev move is red there until the Dockerfiles are
  read again.
- `script-images.yml` — the images a script builds for itself (today GoAccess, which
  `deploy/compose/site-visits.sh` builds from `deploy/compose/goaccess/Dockerfile`, #1675): an
  arm64 build-only check, `Build (<directory>)`, on a pull request that touches that directory or
  the workflow, Dependabot's move of its Alpine pin included. It pushes nothing.
- `windows-payload.yml` (dispatch, and on v* tags; builds the Windows appliance payload).
- `release.yml` — dispatch only, from `main`, on GitHub-hosted runners only; never a required
  check, since it has no pull-request trigger. It cuts a release tag and publishes it in order
  (`docs/release.md`): a preflight that reads the record, the owner's approval, Security Scan on
  exactly the commit, the tag, Security Scan, `images.yml` and `windows-payload.yml` dispatched on
  the tag, and a verify. It dispatches `security-scan.yml` with `image_scans: false`, so those runs
  are the repository scan alone; a hand dispatch keeps the image scans.
- `no-committed-artifacts.yml` — PR guard against committed `node_modules/`, build outputs, local
  DBs, and `.env`.

**Required status checks** on `main` are four: `ci-complete`, `security-scan`, `Trivy`, and
`Check for committed artifacts`. `ci-complete` aggregates every job in `ci.yml`, so require it
rather than the individual jobs — but it can only `needs:` jobs in its own file, which is why the
other three (from `security-scan.yml` and `no-committed-artifacts.yml`) have to be required
separately. Requiring `ci-complete` alone silently un-gates them.

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
summary, and so does a push, where `commit-convention` does not run. Until 2026-10-05 the rule
was a list of failure words — `failure` or `cancelled` — and during GitHub's incident "delays in
assigning GitHub-hosted runners" that evening a job no runner picked up reached `ci-complete` as
**`abandoned`**, a value GitHub's documentation for `needs.<job_id>.result` does not list; the
failing step was skipped and four runs, on three pull requests, showed green with gates that
should have run never run — lint and some or all of the unit-test shards in three of them,
`detect-changes` and `commit-convention` in the fourth. `ci-complete` carries no
`continue-on-error` and its deciding step no `if:`, and a guard refuses either. Changing a job's
`if:` or `needs:`, adding a job, or adding an output to `detect-changes` means changing
`ci-complete` in the same commit:
`scripts/a-run-that-was-cancelled-and-called-green.unit.test.ts` runs `ci-complete`'s steps
against the runs recorded that evening, recorded green runs, and every event and change, and goes
red when the two disagree.

Do **not** require `integration-tests (ubuntu-24.04)` / `(ubuntu-24.04-arm)`, nor
`build (api|web|selfhost)`, `build (postgres)` or `build (trigger, amd64|arm64)` from
`images.yml`, nor `DAV suites on the second Nextcloud major` from `nextcloud-second-major.yml`,
nor `Build (deploy/compose/goaccess)` from `script-images.yml`. None is reported at all on some
pull requests —
a skipped matrix job reports once under the literal `integration-tests (${{ matrix.runner }})`,
and the other three workflows have a `paths:` filter — so a docs-only PR blocks forever on "Expected — waiting
for status to be reported", with nothing queued in Actions to explain it. Full rationale is the
`SCOPE:` comment above `ci-complete` in `ci.yml`.

**No `pull_request` trigger filters by base branch**, and that is now a guard rather than a
convention — `every-pr-gets-checked.unit.test.ts`. The three PR workflows carried
`branches: [main]` until 2026-08-23, which meant a pull request opened against any other branch
produced *no checks at all*. That is the same "Expected — waiting for status to be reported" trap
as the paragraph above, reached from the other direction and harder to see: a stacked pull request
reports nothing, and when the branch beneath it merges GitHub retargets it to `main` with a
`pull_request.edited` event, which is not in the default activity set — so still nothing runs, and
only a fresh push escapes. A `paths:` filter stays allowed because a workflow it skips is one whose
subject the PR did not touch, and the honest response is to leave that check out of branch
protection. A `branches:` filter cannot be rescued that way: the check is required and unreportable.

Removing it does not widen what runs on the Spark. Every `runs-on` in `ci.yml` keys on
`github.event_name == 'push'`, never on the branch, so pull requests from anywhere still run on
GitHub-hosted runners — and `push` keeps its `branches: [main]` filter, which is what makes that
true.

Runners: on a pull request every `ci.yml` job is GitHub-hosted, with integration on both
`ubuntu-24.04` and `ubuntu-24.04-arm` for every code-changing pull request; after merge to `main`
the same jobs run on the self-hosted arm64 Spark. Image builds are GitHub-hosted, and e2e runs only
on the Spark. The Spark runner executes trusted workflows only. Both the `integration-tests` job
and `e2e.yml` install `stalwart-cli` as a host binary for their respective provisioning phases.

**The second Nextcloud major** (workplan 0119, Status of 2026-10-25 and of 2026-10-26). The
integration tier, the dev stack and the demo run Nextcloud 35 from the pull request that moved them
(T5, written 2026-10-26), and the leg runs 34, which a customer who has not upgraded still runs;
before it they ran 34 and the leg ran 35, so that the code was proven against 35 before the demo
moved. `nextcloud-second-major.yml`
runs the suites that read a `NEXTCLOUD_` variable (found by `scripts/nextcloud-suites.mjs`: WebDAV,
CalDAV, CardDAV, the DAV sync, the chunked upload and the share verb) against the image its
`NEXTCLOUD_IMAGE` names, pinned by tag and digest, without Stalwart, on a GitHub-hosted runner: on a
push to `main` that touches `packages/**`, `apps/**` or the test setup, weekly, on demand, and on a
pull request that changes the leg itself. A Nextcloud asked for by name that does not start fails
the run (the default only warns and lets the suites skip), the version `status.php` reports must be
the one the tag names, and a report with a skipped test fails it too. Locally, the same with
`NEXTCLOUD_IMAGE=<ref> SKIP_STALWART=true pnpm exec vitest run --project integration
--no-file-parallelism $(node scripts/nextcloud-suites.mjs)`.

## Appendix — untested seams (verified against the tree, 2026-08-02; re-verified 2026-09-24)

What has **no** dedicated test, stated here so it is a fact in the repo rather
than a rediscovery. This list is the honest complement to the coverage above;
each entry is a candidate for a workplan, not a promise.

- **The Trigger.dev task wrappers** (`apps/worker/src/jobs/*.ts`, fourteen
  task files at the 2026-09-24 re-check).
  The logic inside them is tested through extracted seams —
  `packages/orchestration/src/sync-due.unit.test.ts` proves the tick's
  due-evaluation, `cutover-preparation.integration.test.ts` drives
  `prepareCutover`'s body against a real ledger, the colocated suites in
  `jobs/` drive exported pieces such as `buildTask` and `runDigest`, and
  apply/verify logic lives in `@openmig/core` with its own suites — but the
  `schemaTask` wrappers themselves (payload schemas, `configure()` wiring,
  error paths) execute only in live smokes (`deploy/compose/smoke-managed.sh`,
  which `e2e-managed.yml` runs nightly). The 0022 cutover's in-runner API-URL
  bug lived exactly in that untested layer.
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

Removed from this list since the 2026-08-01 review: `managed-scheduler.ts`
(deleted outright, 0022 T4) and the Mollie webhook handler (its coverage was
found, not added — the review overcounted). Removed at the 2026-09-24
re-check: `build-deps-from-mapping.ts` and `enabled-domains.ts`, both now in
`packages/orchestration/src` with `build-deps-from-mapping.unit.test.ts` and
`enabled-domains.unit.test.ts`; the pages and services that gained suites
(`Billing`, `CreateMapping`, `Dashboard`, `Failures`, `Login`, `Mappings`,
`Moves`, `Tenants`; `billing-service`, `mapping-service`,
`operating-service`); and `OperatorDashboard`, `Settings` and
`mapping-store`, which no longer exist.