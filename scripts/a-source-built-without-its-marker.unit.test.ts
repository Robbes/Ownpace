// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A SOURCE BUILT WITHOUT ITS MARKER would copy a real account whole into a test target (workplan 0162 T2, §2 (d)).
 *
 * A test migration copies only the items whose own title carries its marker,
 * and the only thing that makes that true is the `MarkedOnly` wrapper around
 * its source. The wrapper is applied where a mapping's source is BUILT, never
 * where it is used, so that every reader sees the same marked set: a builder
 * path that forgot it would list, count and copy everything, the operator's
 * private mail and the guests of every event included, with nothing anywhere
 * saying so. `GmailFolderView` is the precedent, and it once lost a method the
 * same way (`measureMailbox`), on a path nobody had checked.
 *
 * So this takes one mapping WITH a marker and one WITHOUT, per source family
 * (an IMAP mail account, and a Nextcloud account for calendar, contacts,
 * files and tasks), through every reader that builds a mapping's source, on
 * PGlite with the ledger chain, and records every source the builders hand
 * out:
 *
 *  - managed: the preflight count (`apps/worker/src/jobs/run-discovery.ts`),
 *    the pass (`apps/worker/src/jobs/run-delta-sync.ts`), and the apply jobs
 *    (`apps/worker/src/jobs/run-apply-deletion.ts`,
 *    `apps/worker/src/jobs/run-apply-relocation.ts`), each through its own
 *    `run`, over the real builders in
 *    `packages/orchestration/src/build-deps-from-mapping.ts`;
 *  - the appliance: `runAllDomains`, `discoverAllDomains`,
 *    `applyMappingDeletion` and `applyMappingRelocation`
 *    (`packages/orchestration/src/orchestration.ts`), over the real builders
 *    in `packages/orchestration/src/build-deps.ts`, which only the ledger
 *    tells about a marker (`readPathPhases`).
 *
 * Each reader must build a source for every data type the mapping selects,
 * and each must be the marked one, carrying the mapping's own marker, when the
 * mapping has a marker, and the bare source when it has none. Only the
 * accounts are stood in for: the passes and the counts are recorded instead of
 * run, and each managed job's run is called as the pg-boss worker calls it
 * (`run<Job>Run`, with a stand-in runner; Trigger.dev's `schemaTask` was
 * stood in for until alpha.18 removed it, workplan 0167 T9).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { createPgliteDb, readPathPhases, runMigrations, type LedgerDriver, type PgDatabase } from '@openmig/ledger';
import { SecretStore } from '@openmig/core/secret-store';
import {
  DISCOVERY_DOMAINS,
  parseMappingConfig,
  phasesOfTheMigration,
  type DiscoveryDomain,
  type DiscoveryStore,
  type MappingConfig,
  type MigrationStatusStore,
  type SwitchedOffState,
} from '@openmig/shared';
import { isMarkedOnly } from '../packages/orchestration/src/marked-only.ts';
import type { RunContext } from '../apps/worker/src/jobs/run-context.ts';
import {
  applyMappingDeletion,
  applyMappingRelocation,
  discoverAllDomains,
  runAllDomains,
} from '../packages/orchestration/src/orchestration.ts';

/** What the stand-ins below see, shared with the hoisted mocks. */
const seen = vi.hoisted(() => ({
  /** The PGlite driver, handed to the managed jobs as their tenant pool. */
  driver: undefined as unknown,
  /** A drizzle handle on the same PGlite, for the managed builders' statements. */
  db: undefined as unknown,
  /** Every source a builder made, and for which data type. */
  built: [] as Array<{ domain: string; source: unknown }>,
}));

// THE ONE CONNECTION SEAM STOOD IN FOR. The managed builders send each
// statement through `tenantScopedDb`, which speaks node-postgres only and
// refuses a PGlite connection; here every such statement goes to the PGlite
// handle instead, unscoped. What the builders read and decide is their own;
// which tenant's rows a statement may see is `rls-in-force`'s question.
vi.mock('@openmig/ledger', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@openmig/ledger')>()),
  tenantScopedDb: () => seen.db,
}));

// The jobs take their pool when they are imported; here it is the ledger below.
vi.mock('../apps/worker/src/jobs/task-pools.ts', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  openTaskPools: () => ({ tenant: seen.driver, end: () => Promise.resolve() }),
}));

// The first-copy email reads managed tables this ledger does not carry.
vi.mock('../apps/worker/src/jobs/the-first-copy-email.ts', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  announceFirstCopy: () => Promise.resolve('not_yet'),
}));

// The passes and the counts would read the accounts; each does nothing here.
// What they were handed is recorded at the builders, below.
vi.mock('@openmig/core', async (importOriginal) => {
  const real = await importOriginal<typeof import('@openmig/core')>();
  const nothingDone = async () => ({
    collectionsListed: 0,
    scanned: 0,
    created: 0,
    skipped: 0,
    adopted: 0,
    failed: 0,
    updated: 0,
    firstCopyBytes: 0,
    heldAtCeiling: 0,
    changedButAdopted: 0,
    changedAfterCutover: 0,
    conflicted: 0,
    keptForGuests: 0,
    needsDecision: 0,
    leftBehind: 0,
    reappearedAfterRemoval: 0,
    superseded: 0,
    earlierExports: 0,
    failures: [],
    moved: 0,
    moves: [],
    deletions: [],
    drift: 0,
  });
  return {
    ...real,
    runShadowPass: nothingDone,
    runCalendarSync: nothingDone,
    runContactSync: nothingDone,
    runTaskSync: nothingDone,
    runFileSync: nothingDone,
    discoverSource: async () => ({ collections: 0, items: 0, perCollection: [] }),
    discoverTarget: async () => ({ targetExisting: 0, targetColliding: 0 }),
  };
});

// THE MANAGED BUILDERS, real, with every source they make recorded.
vi.mock('../packages/orchestration/src/build-deps-from-mapping.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../packages/orchestration/src/build-deps-from-mapping.ts')>();
  return {
    ...real,
    buildDepsFromMapping: async (...args: Parameters<typeof real.buildDepsFromMapping>) => {
      const deps = await real.buildDepsFromMapping(...args);
      seen.built.push({ domain: 'email', source: deps.source });
      return deps;
    },
    buildDomainDepsFromMapping: async (pool: Pool, tenantId: string, mappingId: string, domain: string) => {
      const deps = await (real.buildDomainDepsFromMapping as (...a: unknown[]) => Promise<{ source: unknown }>)(
        pool,
        tenantId,
        mappingId,
        domain,
      );
      seen.built.push({ domain: domain === 'mail' ? 'email' : domain, source: deps.source });
      return deps;
    },
  };
});

// THE APPLIANCE'S BUILDERS, real, with every source they make recorded.
vi.mock('../packages/orchestration/src/build-deps.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../packages/orchestration/src/build-deps.ts')>();
  return {
    ...real,
    buildDeps: async (...args: Parameters<typeof real.buildDeps>) => {
      const deps = await real.buildDeps(...args);
      seen.built.push({ domain: 'email', source: deps.source });
      return deps;
    },
    buildDomainDeps: (config: MappingConfig, domain: string, options: Parameters<typeof real.buildDomainDeps>[2]) => {
      const deps = (real.buildDomainDeps as (...a: unknown[]) => { source: unknown })(config, domain, options);
      seen.built.push({ domain, source: deps.source });
      return deps;
    },
  };
});

const MARKER = '[Ownpace-test]';
const PASSWORD_ENV = 'A_PASSWORD_FOR_THE_0162_GUARD';
const TENANT = randomUUID();

/**
 * The data types each source family's mappings select: the IMAP account's
 * mail, and every other data type from the Nextcloud account. Walked from
 * `DISCOVERY_DOMAINS`, so a data type added there is a data type this asks
 * about (`a-domain-union-typed-out-by-hand`).
 */
const MAIL: ReadonlyArray<DiscoveryDomain> = ['email'];
const DAV: ReadonlyArray<DiscoveryDomain> = DISCOVERY_DOMAINS.filter((d) => d !== 'email');

/** The four managed fixture mappings, and the two the appliance runs. */
const mapping = {
  mailMarked: randomUUID(),
  mailPlain: randomUUID(),
  davMarked: randomUUID(),
  davPlain: randomUUID(),
  applianceMarked: randomUUID(),
  appliancePlain: randomUUID(),
};

let driver: LedgerDriver;
let ledgerDb: PgDatabase;

async function query(text: string, params: unknown[] = []): Promise<void> {
  const conn = await driver.acquire();
  try {
    await conn.query(text, params);
  } finally {
    conn.release();
  }
}

/** A connection row, its credentials encrypted as the Accounts page stores them. */
async function aConnection(role: 'source' | 'target', kind: string, config: object, creds: Record<string, string>) {
  const id = randomUUID();
  await query(
    `INSERT INTO connection (id, tenant_id, role, kind, display_name, status, config, secret_ref)
     VALUES ($1, $2, $3, $4, 'fixture', 'connected', $5::jsonb, $6)`,
    [id, TENANT, role, kind, JSON.stringify(config), JSON.stringify(SecretStore.encryptCredentials(creds).encrypted)],
  );
  return id;
}

/** A mailbox on a connection, for one mapping's side. */
async function aMailbox(connection: string): Promise<string> {
  const id = randomUUID();
  await query(
    `INSERT INTO mailbox (id, tenant_id, connection_id, external_id, kind) VALUES ($1, $2, $3, $4, 'user')`,
    [id, TENANT, connection, `${id}@example.test`],
  );
  return id;
}

/** A mapping between two connections, selecting `domains`, with the marker given. */
async function aMapping(
  id: string,
  source: string,
  target: string,
  domains: ReadonlyArray<DiscoveryDomain>,
  marker: string | null,
): Promise<void> {
  await query(
    `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, status, mode, test_marker)
     VALUES ($1, $2, $3, $4, 'active', 'mirror', $5)`,
    [id, TENANT, await aMailbox(source), await aMailbox(target), marker],
  );
  for (const domain of domains) {
    await query(`INSERT INTO scope_selection (tenant_id, mapping_id, domain, included) VALUES ($1, $2, $3, true)`, [
      TENANT,
      id,
      domain,
    ]);
  }
}

/** The managed jobs, imported once the pool they take at import exists. */
let jobs: {
  count: (mappingId: string, domain: DiscoveryDomain) => Promise<unknown>;
  pass: (mappingId: string) => Promise<unknown>;
  applyDeletion: (mappingId: string) => Promise<unknown>;
  applyRelocation: (mappingId: string) => Promise<unknown>;
};

beforeAll(async () => {
  process.env.SECRET_ENCRYPTION_KEY ??= '0162016201620162016201620162016201620162016201620162016201620162';
  process.env[PASSWORD_ENV] = 'not-a-real-password';
  // No data ceiling to read: the alpha's stage, as the pass's own tests set it.
  process.env.OWNPACE_STAGE = 'alpha';

  const made = await createPgliteDb({});
  driver = made.driver;
  ledgerDb = made.db;
  await runMigrations({ driver, logger: () => {} });
  await query(`INSERT INTO tenant (id, name, status) VALUES ($1, 'marker guard', 'active')`, [TENANT]);

  const mailFrom = await aConnection(
    'source',
    'imap',
    { type: 'imap-oauth2', host: 'imap.example.test', port: 993, user: 'owner@example.test', auth: { kind: 'login', passwordFromEnv: PASSWORD_ENV } },
    { password: 'not-a-real-password' },
  );
  const mailTo = await aConnection(
    'target',
    'imap',
    { host: 'mail.example.test', port: 993, useSsl: true, user: 'owner@example.test' },
    { username: 'owner@example.test', password: 'not-a-real-password' },
  );
  const davFrom = await aConnection('source', 'nextcloud', { url: 'https://source.example.test/remote.php/dav' }, {
    username: 'owner',
    password: 'not-a-real-password',
  });
  const davTo = await aConnection('target', 'nextcloud', { url: 'https://target.example.test/remote.php/dav' }, {
    username: 'owner',
    password: 'not-a-real-password',
  });
  await aMapping(mapping.mailMarked, mailFrom, mailTo, MAIL, MARKER);
  await aMapping(mapping.mailPlain, mailFrom, mailTo, MAIL, null);
  await aMapping(mapping.davMarked, davFrom, davTo, DAV, MARKER);
  await aMapping(mapping.davPlain, davFrom, davTo, DAV, null);
  // The appliance reads its sources from its config file, and its marker from
  // the ledger: these two rows are that ledger's.
  await aMapping(mapping.applianceMarked, davFrom, davTo, [], MARKER);
  await aMapping(mapping.appliancePlain, davFrom, davTo, [], null);

  seen.driver = driver;
  seen.db = ledgerDb;
  const pool = driver as unknown as Pool;
  const { buildTask } = await import('../apps/worker/src/jobs/run-discovery.ts');
  const { runDeltaSyncRun } = await import('../apps/worker/src/jobs/run-delta-sync.ts');
  const { runApplyDeletionRun } = await import('../apps/worker/src/jobs/run-apply-deletion.ts');
  const { runApplyRelocationRun } = await import('../apps/worker/src/jobs/run-apply-relocation.ts');
  // A pass asks nothing of its runner here: each question fails the case.
  const asked = (what: string) => () => Promise.reject(new Error(`a job here asked its runner to ${what}`));
  const context: RunContext = {
    runId: randomUUID(),
    attempt: 1,
    runner: { name: 'pg-boss', enqueue: asked('enqueue'), enqueueAndWait: asked('wait'), verdict: asked('say'), cancel: asked('cancel') },
  };
  jobs = {
    count: (mappingId, domain) => buildTask(pool, TENANT as never, mappingId as never, domain).run(),
    pass: (mappingId) => runDeltaSyncRun({ tenantId: TENANT, mappingId }, context),
    applyDeletion: (mappingId) =>
      runApplyDeletionRun({ tenantId: TENANT, mappingId, naturalKeyHash: 'no-such-item', receiptId: randomUUID() }, context),
    applyRelocation: (mappingId) =>
      runApplyRelocationRun({ tenantId: TENANT, mappingId, naturalKeyHash: 'no-such-item', receiptId: randomUUID() }, context),
  };
}, 120_000);

afterAll(async () => {
  delete process.env[PASSWORD_ENV];
  delete process.env.OWNPACE_STAGE;
  await driver?.end();
});

/** What a reader built, by data type: whether each source was the marked one, and with which marker. */
async function builtBy(read: () => Promise<unknown>): Promise<Record<string, string | null>> {
  seen.built.length = 0;
  await read();
  const out: Record<string, string | null> = {};
  for (const { domain, source } of seen.built) {
    out[domain] = isMarkedOnly(source) ? source.marker : null;
  }
  return out;
}

const all = (domains: ReadonlyArray<DiscoveryDomain>, marker: string | null) =>
  Object.fromEntries(domains.map((d) => [d, marker]));

/** The managed readers, each through its own entry point. */
const MANAGED: ReadonlyArray<readonly [string, (mappingId: string, domains: ReadonlyArray<DiscoveryDomain>) => Promise<unknown>]> = [
  [
    'the preflight count (run-discovery)',
    async (mappingId, domains) => {
      for (const domain of domains) await jobs.count(mappingId, domain);
    },
  ],
  ['the pass (run-delta-sync)', (mappingId) => jobs.pass(mappingId)],
  ['an apply of a deletion (run-apply-deletion)', (mappingId) => jobs.applyDeletion(mappingId)],
  ['an apply of a relocation (run-apply-relocation)', (mappingId) => jobs.applyRelocation(mappingId)],
];

describe.each(MANAGED)('managed: %s', (_reader, read) => {
  it('builds the marked source for every data type of a mapping with a marker, mail and the other four', async () => {
    expect(await builtBy(() => read(mapping.mailMarked, MAIL))).toEqual(all(MAIL, MARKER));
    expect(await builtBy(() => read(mapping.davMarked, DAV))).toEqual(all(DAV, MARKER));
  });

  it('builds the bare source for a mapping without one', async () => {
    expect(await builtBy(() => read(mapping.mailPlain, MAIL))).toEqual(all(MAIL, null));
    expect(await builtBy(() => read(mapping.davPlain, DAV))).toEqual(all(DAV, null));
  });
});

// ---------------------------------------------------------------------------

/** One endpoint of the appliance's config file, by protocol. */
const endpoint = (type: 'caldav' | 'carddav' | 'webdav') => ({
  type,
  url: `https://${type}.example.test/remote.php/dav`,
  user: 'owner',
  auth: { kind: 'login', passwordFromEnv: PASSWORD_ENV },
});

/** The appliance's mail account and its target, by protocol. */
const imapSource = {
  type: 'imap-oauth2',
  host: 'imap.example.test',
  port: 993,
  user: 'owner@example.test',
  auth: { kind: 'login', passwordFromEnv: PASSWORD_ENV },
};
const jmapTarget = { type: 'jmap', baseUrl: 'https://jmap.example.test', user: 'owner', auth: { kind: 'basic', passwordFromEnv: PASSWORD_ENV } };

/** An appliance's mapping file for one ledger row, every data type switched on. */
const applianceConfig = (mappingId: string): MappingConfig =>
  parseMappingConfig({
    tenantId: TENANT,
    mappingId,
    source: imapSource,
    target: jmapTarget,
    domains: {
      mail: { enabled: true, source: imapSource, target: jmapTarget },
      calendar: { enabled: true, source: endpoint('caldav'), target: endpoint('caldav') },
      contacts: { enabled: true, source: endpoint('carddav'), target: endpoint('carddav') },
      files: { enabled: true, source: endpoint('webdav'), target: endpoint('webdav') },
      tasks: { enabled: true, source: endpoint('caldav'), target: endpoint('caldav') },
    },
  });

const store: MigrationStatusStore = {
  initDomainStatus: async () => {},
  markInProgress: async () => {},
  markCompleted: async () => {},
  markPaused: async () => {},
  markFailed: async () => {},
  markSwitchedOff: async (): Promise<SwitchedOffState> => ({ state: 'skipped' }),
  markSwitchedOn: async () => {},
  getStatus: async () => [],
};

const discoveries: DiscoveryStore = {
  upsertDiscovery: async () => {},
  recordDiscoveryError: async () => {},
  getDiscovery: async () => [],
};

/** The appliance's reader of its migration's phases, which carries the marker. */
const phasesNow = (mappingId: string) => () => readPathPhases(ledgerDb, TENANT, mappingId);

/** The appliance's mapping file switches every data type on. */
const EVERY: ReadonlyArray<DiscoveryDomain> = DISCOVERY_DOMAINS;

const APPLIANCE: ReadonlyArray<readonly [string, (config: MappingConfig) => Promise<unknown>]> = [
  [
    'the pass (runAllDomains)',
    (config) => runAllDomains(config, store, phasesOfTheMigration('active'), phasesNow(config.mappingId), { ledgerDb }),
  ],
  ['the count (discoverAllDomains)', (config) => discoverAllDomains(config, discoveries, TENANT as never, config.mappingId as never, { ledgerDb })],
  ['an apply of a deletion (applyMappingDeletion)', (config) => applyMappingDeletion(config, 'no-such-item', { ledgerDb }, phasesNow(config.mappingId))],
  ['an apply of a relocation (applyMappingRelocation)', (config) => applyMappingRelocation(config, 'no-such-item', { ledgerDb }, phasesNow(config.mappingId))],
];

describe.each(APPLIANCE)('the appliance: %s', (_reader, read) => {
  it('builds the marked source for every data type when its ledger row carries a marker', async () => {
    expect(await builtBy(() => read(applianceConfig(mapping.applianceMarked)))).toEqual(all(EVERY, MARKER));
  });

  it('builds the bare source when its ledger row carries none', async () => {
    expect(await builtBy(() => read(applianceConfig(mapping.appliancePlain)))).toEqual(all(EVERY, null));
  });
});
