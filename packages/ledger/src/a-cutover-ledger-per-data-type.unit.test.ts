// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A CUTOVER LEDGER PER DATA TYPE (workplan 0128 T5, slice 4; ledger migration
 * 0067).
 *
 * Mail will be cut over on its own while files keep running (slice 5), so each
 * data type gets a cutover ledger of its own: its row in `cutover_state`, its
 * events in `cutover_event`, and its own grace window. Nothing writes one yet.
 * This pins what one means before anything can write it:
 *
 * - **the key**: one row for the whole migration, and one per data type beside
 *   it, under the key's real name;
 * - **the store**: without a data type, the whole migration's ledger, exactly
 *   as before, whatever rows the data types have; with one, its own ledger, or
 *   the whole migration's where it has none; a write always to its own row;
 * - **the window**: each data type's own, or the whole migration's where it has
 *   none, as every gate reads it (`readPathPhases`).
 *
 * PGlite as `app_user`, under row security, on the real migration chain. The
 * rows placed by hand are placed as the database's owner, as slice 5's doors
 * would leave them.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { pathRunsNow, type MappingId, type TenantId } from '@openmig/shared';
import { pgliteDriver } from './pglite-driver.ts';
import { runMigrations } from './migrate.ts';
import { withTenant } from './db.ts';
import type { LedgerDriver } from './driver.ts';
import { tenantCutoverStore } from './cutover-store.ts';
import { cutoverStillCopies, readCutoverWindows } from './cutover-grace.ts';
import { readPathPhases } from './path-phases.ts';

// UUID family 0128f700-…, unused elsewhere in the repo.
const TENANT = '0128f700-e29b-41d4-a716-446655440001' as TenantId;
const CONNECTION = '0128f700-e29b-41d4-a716-446655440002';
const MAILBOX = '0128f700-e29b-41d4-a716-446655440003';
const MAPPING = '0128f700-e29b-41d4-a716-446655440005' as MappingId;

let driver: LedgerDriver;

async function query<R = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<R[]> {
  const conn = await driver.acquire();
  try {
    return (await conn.query<R>(text, params)).rows;
  } finally {
    conn.release();
  }
}

/** The error a statement fails with, or undefined when it does not fail. */
async function refusal(text: string, params: unknown[] = []): Promise<string | undefined> {
  try {
    await query(text, params);
    return undefined;
  } catch (e) {
    return (e as Error).message;
  }
}

const store = () => tenantCutoverStore(driver, TENANT);

/**
 * A ledger row placed by hand: whose (null for the whole migration's), its
 * state, and whether its grace period still copies (started an hour ago, 72
 * hours long) or is over (started four days ago).
 */
async function placeLedger(domain: string | null, state: string, open = false): Promise<void> {
  await query(
    `INSERT INTO cutover_state (tenant_id, mapping_id, domain, state, grace_period_hours, copies_through_grace,
                                grace_period_started_at)
     VALUES ($1, $2, $3, $4, 72, $5, now() - CASE WHEN $5 THEN interval '1 hour' ELSE interval '4 days' END)`,
    [TENANT, MAPPING, domain, state, open],
  );
}

/** Each ledger row of the migration, by whose it is. */
async function ledgerRows(): Promise<Array<{ domain: string | null; state: string }>> {
  return query(`SELECT domain, state FROM cutover_state WHERE mapping_id = $1 ORDER BY domain NULLS FIRST`, [MAPPING]);
}

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await query(`INSERT INTO tenant (id, name, status) VALUES ($1, 'ledgers', 'active')`, [TENANT]);
  await query(
    `INSERT INTO connection (id, tenant_id, role, kind, display_name, status, config)
     VALUES ($1, $2, 'source', 'imap', 'fixture', 'connected', '{}'::jsonb)`,
    [CONNECTION, TENANT],
  );
  await query(
    `INSERT INTO mailbox (id, tenant_id, connection_id, external_id, primary_address)
     VALUES ($1, $2, $3, 'src', 'a@example.test')`,
    [MAILBOX, TENANT, CONNECTION],
  );
  await query(`INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status) VALUES ($1, $2, $3, 'cutover')`, [
    MAPPING,
    TENANT,
    MAILBOX,
  ]);
}, 120_000);

beforeEach(async () => {
  await query(`DELETE FROM cutover_event WHERE mapping_id = $1`, [MAPPING]);
  await query(`DELETE FROM cutover_state WHERE mapping_id = $1`, [MAPPING]);
});

afterAll(async () => {
  await driver?.end();
});

describe('the key (migration 0067)', () => {
  it('keeps one row for the whole migration, and one per data type beside it, under its real name', async () => {
    await placeLedger(null, 'PREPARING');
    await placeLedger('email', 'PREPARING');
    await placeLedger('file', 'PREPARING');
    expect(await refusal(`INSERT INTO cutover_state (tenant_id, mapping_id) VALUES ($1, $2)`, [TENANT, MAPPING])).toMatch(
      /cutover_state_tenant_id_mapping_id_domain_key/,
    );
    expect(
      await refusal(`INSERT INTO cutover_state (tenant_id, mapping_id, domain) VALUES ($1, $2, 'email')`, [
        TENANT,
        MAPPING,
      ]),
    ).toMatch(/cutover_state_tenant_id_mapping_id_domain_key/);
    expect(await ledgerRows()).toHaveLength(3);

    // The baseline's key is gone by its own name, not by the one the ORM gave it.
    const keys = await query<{ conname: string }>(
      `SELECT conname FROM pg_constraint WHERE conrelid = 'cutover_state'::regclass AND contype = 'u'`,
    );
    expect(keys.map((k) => k.conname)).toEqual(['cutover_state_tenant_id_mapping_id_domain_key']);
  });

  it('refuses a data type the product does not know, on the state and on the event', async () => {
    expect(
      await refusal(`INSERT INTO cutover_state (tenant_id, mapping_id, domain) VALUES ($1, $2, 'journal')`, [
        TENANT,
        MAPPING,
      ]),
    ).toMatch(/cutover_state_domain_check/);
    expect(
      await refusal(
        `INSERT INTO cutover_event (tenant_id, mapping_id, domain, to_state, triggered_by)
         VALUES ($1, $2, 'journal', 'PREPARING', 'test')`,
        [TENANT, MAPPING],
      ),
    ).toMatch(/cutover_event_domain_check/);
  });
});

describe('the store, for the whole migration', () => {
  it('is the whole migration’s ledger as before, whatever rows its data types have', async () => {
    const started = await store().initializeCutover({ tenantId: TENANT, mappingId: MAPPING, startedBy: 'test' });
    expect(started.state).toBe('PREPARING');
    expect('domain' in started).toBe(false);
    // Mail's own ledger, far ahead, with an event of its own.
    await placeLedger('email', 'GRACE_PERIOD', true);
    await query(
      `INSERT INTO cutover_event (tenant_id, mapping_id, domain, from_state, to_state, triggered_by)
       VALUES ($1, $2, 'email', 'CUTOVER_IN_PROGRESS', 'GRACE_PERIOD', 'test')`,
      [TENANT, MAPPING],
    );

    expect((await store().loadCutoverState(TENANT, MAPPING))!.state).toBe('PREPARING');
    const moved = await store().transitionState(TENANT, MAPPING, 'READY_FOR_CUTOVER', { verifiedBy: 'test' });
    expect(moved.state).toBe('READY_FOR_CUTOVER');
    expect('domain' in moved).toBe(false);
    // Saved again, it is updated in place: the key's NULLs are equal.
    await store().saveCutoverState(moved);

    expect(await ledgerRows()).toEqual([
      { domain: null, state: 'READY_FOR_CUTOVER' },
      { domain: 'email', state: 'GRACE_PERIOD' },
    ]);
    const trail = await store().getEventHistory(TENANT, MAPPING);
    expect(trail.map((e) => e.toState)).toEqual(['PREPARING', 'READY_FOR_CUTOVER']);
    expect(trail.every((e) => !('domain' in e))).toBe(true);
  });
});

describe('the store, for one data type', () => {
  it('reads a data type with no ledger of its own as the whole migration’s, and starts none for it', async () => {
    await store().initializeCutover({ tenantId: TENANT, mappingId: MAPPING, startedBy: 'test' });
    await store().transitionState(TENANT, MAPPING, 'READY_FOR_CUTOVER', { verifiedBy: 'test' });
    await store().transitionState(TENANT, MAPPING, 'APPROVED', { approvedBy: 'test' });

    const inherited = await store().loadCutoverState(TENANT, MAPPING, 'email');
    expect(inherited!.state).toBe('APPROVED');
    expect('domain' in inherited!).toBe(false);
    // Asked to start one, it returns the ledger that exists, unchanged.
    const again = await store().initializeCutover({
      tenantId: TENANT,
      mappingId: MAPPING,
      startedBy: 'test',
      domain: 'email',
    });
    expect(again.state).toBe('APPROVED');
    expect(await ledgerRows()).toEqual([{ domain: null, state: 'APPROVED' }]);
    // Its trail is the one it inherited.
    const trail = await store().getEventHistory(TENANT, MAPPING, undefined, 'email');
    expect(trail.map((e) => e.toState)).toEqual(['PREPARING', 'READY_FOR_CUTOVER', 'APPROVED']);
  });

  it('moves a data type on its own row, from the ledger it read, and never the whole migration’s', async () => {
    // A whole migration's cutover that failed: not under way, so a data type
    // may leave it by beginning its own (slice 5b).
    await store().initializeCutover({ tenantId: TENANT, mappingId: MAPPING, startedBy: 'test' });
    await store().transitionState(TENANT, MAPPING, 'FAILED', { failureReason: 'test' });

    const mail = await store().transitionState(TENANT, MAPPING, 'PREPARING', { retriedBy: 'someone' }, 'email');
    expect(mail).toMatchObject({ domain: 'email', state: 'PREPARING' });
    expect(await ledgerRows()).toEqual([
      { domain: null, state: 'FAILED' },
      { domain: 'email', state: 'PREPARING' },
    ]);
    expect(await store().loadCutoverState(TENANT, MAPPING, 'email')).toMatchObject({
      domain: 'email',
      state: 'PREPARING',
    });
    expect((await store().loadCutoverState(TENANT, MAPPING))!.state).toBe('FAILED');
    expect((await store().loadCutoverState(TENANT, MAPPING, 'calendar'))!.state).toBe('FAILED');

    // A second data type, on a row of its own again.
    await store().transitionState(TENANT, MAPPING, 'PREPARING', { retriedBy: 'someone' }, 'calendar');
    expect(await ledgerRows()).toEqual([
      { domain: null, state: 'FAILED' },
      { domain: 'calendar', state: 'PREPARING' },
      { domain: 'email', state: 'PREPARING' },
    ]);
    // And mail moves on from its own row, not from the one it once read.
    await store().transitionState(TENANT, MAPPING, 'READY_FOR_CUTOVER', { verifiedBy: 'someone' }, 'email');
    expect((await store().loadCutoverState(TENANT, MAPPING, 'email'))!.state).toBe('READY_FOR_CUTOVER');

    // Each trail: its own events after the whole migration's it inherited.
    const mailTrail = await store().getEventHistory(TENANT, MAPPING, undefined, 'email');
    expect(mailTrail.map((e) => [e.toState, e.domain ?? null])).toEqual([
      ['PREPARING', null],
      ['FAILED', null],
      ['PREPARING', 'email'],
      ['READY_FOR_CUTOVER', 'email'],
    ]);
    const wholeTrail = await store().getEventHistory(TENANT, MAPPING);
    expect(wholeTrail.map((e) => e.toState)).toEqual(['PREPARING', 'FAILED']);
  });

  it('starts a data type’s own ledger where the migration has none', async () => {
    const started = await store().initializeCutover({
      tenantId: TENANT,
      mappingId: MAPPING,
      startedBy: 'test',
      domain: 'file',
    });
    expect(started).toMatchObject({ domain: 'file', state: 'PREPARING' });
    expect(await ledgerRows()).toEqual([{ domain: 'file', state: 'PREPARING' }]);
    expect(await store().loadCutoverState(TENANT, MAPPING)).toBeUndefined();
    expect(await store().loadCutoverState(TENANT, MAPPING, 'email')).toBeUndefined();
    const trail = await store().getEventHistory(TENANT, MAPPING, undefined, 'file');
    expect(trail).toMatchObject([{ domain: 'file', eventType: 'CUTOVER_INITIALIZED', toState: 'PREPARING' }]);
    expect(await store().getEventHistory(TENANT, MAPPING)).toEqual([]);

    // Asked again once it has moved on, it returns its own ledger unchanged.
    await store().transitionState(TENANT, MAPPING, 'READY_FOR_CUTOVER', { verifiedBy: 'test' }, 'file');
    const again = await store().initializeCutover({
      tenantId: TENANT,
      mappingId: MAPPING,
      startedBy: 'test',
      domain: 'file',
    });
    expect(again).toMatchObject({ domain: 'file', state: 'READY_FOR_CUTOVER' });
    expect(await ledgerRows()).toEqual([{ domain: 'file', state: 'READY_FOR_CUTOVER' }]);
  });

  it('says whose ledger a transition moves itself, whatever its metadata carries', async () => {
    await store().initializeCutover({ tenantId: TENANT, mappingId: MAPPING, startedBy: 'test' });
    // A `domain` in the metadata (a mail domain, say) is not whose ledger it is.
    await store().transitionState(TENANT, MAPPING, 'FAILED', { domain: 'calendar' });
    await store().transitionState(TENANT, MAPPING, 'PREPARING', { domain: 'calendar' }, 'email');
    expect(await ledgerRows()).toEqual([
      { domain: null, state: 'FAILED' },
      { domain: 'email', state: 'PREPARING' },
    ]);
  });
});

describe('the grace window, per data type', () => {
  const windows = () => withTenant(driver, TENANT, (db) => readCutoverWindows(db, TENANT, MAPPING));
  const stillCopies = (domain?: string) =>
    withTenant(driver, TENANT, (db) => cutoverStillCopies(db, TENANT, MAPPING, domain));

  it('is a data type’s own, or the whole migration’s where it has none', async () => {
    // The whole migration still copies; mail's own cutover is over.
    await placeLedger(null, 'GRACE_PERIOD', true);
    await placeLedger('email', 'COMPLETED');
    let found = await windows();
    expect([found.of('email'), found.of('file'), found.of(), found.any]).toEqual([false, true, true, true]);
    expect([await stillCopies('email'), await stillCopies('file'), await stillCopies()]).toEqual([false, true, true]);

    // The other way round: only mail's own still copies.
    await query(`DELETE FROM cutover_state WHERE mapping_id = $1`, [MAPPING]);
    await placeLedger(null, 'COMPLETED');
    await placeLedger('email', 'GRACE_PERIOD', true);
    found = await windows();
    expect([found.of('email'), found.of('file'), found.of(), found.any]).toEqual([true, false, false, true]);

    // A grace period that is over copies nothing, for anyone.
    await query(`DELETE FROM cutover_state WHERE mapping_id = $1`, [MAPPING]);
    await placeLedger(null, 'GRACE_PERIOD');
    await placeLedger('email', 'GRACE_PERIOD');
    found = await windows();
    expect([found.of('email'), found.of('file'), found.of(), found.any]).toEqual([false, false, false, false]);
  });

  it('is what every gate reads: each data type in its cutover asks its own', async () => {
    for (const domain of ['email', 'file']) {
      await query(`INSERT INTO scope_selection (tenant_id, mapping_id, domain, included) VALUES ($1, $2, $3, true)`, [
        TENANT,
        MAPPING,
        domain,
      ]);
      await query(
        `INSERT INTO path_lifecycle (tenant_id, mapping_id, domain, state, first_activated_at)
         VALUES ($1, $2, $3, 'cutover', now())`,
        [TENANT, MAPPING, domain],
      );
    }
    try {
      // Cut over whole, and mail's own grace period (a slice 5 cutover) still copying.
      await placeLedger(null, 'COMPLETED');
      await placeLedger('email', 'GRACE_PERIOD', true);
      const phases = (await withTenant(driver, TENANT, (db) => readPathPhases(db, TENANT, MAPPING)))!;
      expect(phases.phaseOf('email')).toEqual({ phase: 'cutover', stillCopies: true });
      expect(phases.phaseOf('file')).toEqual({ phase: 'cutover', stillCopies: false });
      expect(pathRunsNow(phases.phaseOf('email'))).toBe(true);
      expect(pathRunsNow(phases.phaseOf('file'))).toBe(false);
      // Some data type still copies, so the migration's pass runs, and moves past files.
      expect(phases.stillCopies).toBe(true);
      expect(phases.anyRuns).toBe(true);
    } finally {
      await query(`DELETE FROM path_lifecycle WHERE mapping_id = $1`, [MAPPING]);
      await query(`DELETE FROM scope_selection WHERE mapping_id = $1`, [MAPPING]);
    }
  });
});
