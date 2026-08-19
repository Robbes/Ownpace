// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Does a pass use the ledger it was GIVEN, or one it goes and finds?
 *
 * This is the question the PGlite e2e answered the hard way. `buildDeps` and
 * `buildDomainDeps` opened their own `pg.Pool` from `DATABASE_URL`, which is
 * correct for the managed worker — it is stateless, a pass is a job, the pool
 * dies with it — and wrong for the self-host appliance twice over:
 *
 *  - On the container path it silently opened a SECOND pool to the same server.
 *    Wasteful, invisible, and it looked like it worked.
 *  - On PGlite there is no server to open a pool to. It runs in-process and has
 *    no address. So every ledger query of every domain failed with
 *    `getaddrinfo ENOTFOUND postgres`, and `SELFHOST_PERSISTENCE=pglite` turned
 *    out to have wired only the half of the appliance that reads. The startup
 *    test never ran a pass, and the e2e always had Postgres present, so nothing
 *    was watching the half that copies.
 *
 * The tests below are deliberately about WIRING, not about syncing: they assert
 * that the handle a caller passes is the handle the builder uses, and that the
 * builder does not close what it does not own. No connectors, no network, no
 * database — the failure this guards against is one of plumbing, and plumbing
 * is what it inspects.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildDeps, buildDomainDeps } from './build-deps.ts';
import type { PgDatabase } from '@openmig/ledger';

/**
 * A mapping with mail and calendar enabled, pointing nowhere. The builders
 * construct connectors from config without contacting anything, which is what
 * makes this a unit test.
 */
const CONFIG = {
  tenantId: '00000000-0000-4000-8000-0000000000aa',
  mappingId: '11111111-1111-4111-8111-1111111111aa',
  source: {
    type: 'imap-oauth2',
    host: '127.0.0.1',
    port: 1,
    user: 'nobody@invalid',
    auth: { kind: 'login', passwordFromEnv: 'OPENMIG_TEST_NOPE' },
  },
  target: {
    type: 'jmap',
    baseUrl: 'http://127.0.0.1:1',
    user: 'nobody@invalid',
    auth: { kind: 'basic', passwordFromEnv: 'OPENMIG_TEST_NOPE' },
  },
  domains: {
    mail: { enabled: true },
    calendar: {
      enabled: true,
      source: { type: 'caldav', baseUrl: 'http://127.0.0.1:1', user: 'a', auth: { kind: 'basic', passwordFromEnv: 'OPENMIG_TEST_NOPE' } },
      target: { type: 'caldav', baseUrl: 'http://127.0.0.1:1', user: 'b', auth: { kind: 'basic', passwordFromEnv: 'OPENMIG_TEST_NOPE' } },
    },
  },
} as never;

/**
 * A stand-in for the appliance's drizzle handle. It is never queried here —
 * identity is the whole assertion — so it does not need to be a real one.
 */
const APPLIANCE_DB = { __appliance: true } as unknown as PgDatabase;

const savedUrl = process.env.DATABASE_URL;
const savedPersistence = process.env.SELFHOST_PERSISTENCE;

beforeEach(() => {
  process.env.OPENMIG_TEST_NOPE = 'x';
});

afterEach(() => {
  if (savedUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = savedUrl;
  if (savedPersistence === undefined) delete process.env.SELFHOST_PERSISTENCE;
  else process.env.SELFHOST_PERSISTENCE = savedPersistence;
});

describe('a pass uses the ledger it was given', () => {
  it('binds the ledger and cursor store to the injected handle, not to DATABASE_URL', async () => {
    // The environment names a database that must NOT be reached. Before the
    // fix this is precisely what got used, and on PGlite it does not exist.
    process.env.DATABASE_URL = 'postgresql://nobody:nope@this-host-must-not-be-used:5432/x';

    const deps = await buildDeps(CONFIG, { ledgerDb: APPLIANCE_DB });
    // `PgLedger`/`PgCursorStore` hold the handle privately, so reach through
    // rather than infer from behaviour — behaviour here would mean a query,
    // and a query is exactly what must not happen.
    expect((deps.ledger as unknown as { db: unknown }).db).toBe(APPLIANCE_DB);
    expect((deps.cursors as unknown as { db: unknown }).db).toBe(APPLIANCE_DB);
    await deps.close();
  });

  it('does the same for the DAV domains, which are built by a different function', async () => {
    process.env.DATABASE_URL = 'postgresql://nobody:nope@this-host-must-not-be-used:5432/x';
    const deps = buildDomainDeps(CONFIG, 'calendar', { ledgerDb: APPLIANCE_DB });
    expect((deps.ledger as unknown as { db: unknown }).db).toBe(APPLIANCE_DB);
    await deps.close();
  });

  it('does not close a handle it did not open', async () => {
    // The appliance has ONE database and hands out the same handle for every
    // pass. Closing it after a pass would take the whole appliance down — and
    // on PGlite there is no pool to reopen, so it would stay down.
    let closed = false;
    const db = { close: () => { closed = true; } } as unknown as PgDatabase;
    const deps = await buildDeps(CONFIG, { ledgerDb: db });
    await deps.close();
    expect(closed).toBe(false);
  });
});

describe('a pass with no ledger given', () => {
  it('still opens its own from DATABASE_URL — managed is unchanged', async () => {
    process.env.DATABASE_URL = 'postgresql://u:p@127.0.0.1:1/x';
    delete process.env.SELFHOST_PERSISTENCE;
    // A pool is lazy, so this constructs without connecting. The assertion is
    // that a handle exists at all and is NOT the injected one.
    const deps = await buildDeps(CONFIG);
    expect((deps.ledger as unknown as { db: unknown }).db).toBeDefined();
    expect((deps.ledger as unknown as { db: unknown }).db).not.toBe(APPLIANCE_DB);
    await deps.close();
  });

  it('refuses outright on the PGlite appliance rather than connecting to something else', async () => {
    // The bug this closes for good. `DATABASE_URL` is STILL SET on the PGlite
    // appliance — compose merges maps key by key, so an override cannot remove
    // what the base file declares — so a fallback does not fail, it succeeds
    // against the wrong database. On the e2e stack that host had gone away and
    // it crashed; on a stack where it had not, a pass would have written its
    // ledger somewhere the appliance never reads.
    process.env.DATABASE_URL = 'postgresql://u:p@postgres:5432/openmigrate';
    process.env.SELFHOST_PERSISTENCE = 'pglite';
    await expect(buildDeps(CONFIG)).rejects.toThrow(/PGlite.*ledger handle|wiring bug/s);
  });
});
