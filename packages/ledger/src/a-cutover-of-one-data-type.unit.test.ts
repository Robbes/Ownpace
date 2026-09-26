// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE CUTOVER OF ONE DATA TYPE (workplan 0128 T5, slice 5b; the owner's D8).
 *
 * The core's own steps (`enterCutover`, `closeCutover`, `performRollback`),
 * driven over a data type's own ledger (`bindCutoverLedger`) and its own path
 * (`pathLifecyclePort`): mail is cut over, copies through its grace period and
 * closes, while calendars keep running as an ordinary sync; then calendars are
 * cut over too, and the migration's status follows its paths. And the two
 * rules that keep a data type's cutover apart from the whole migration's, at
 * the store, under the doors that say them first.
 *
 * PGlite as `app_user`, under row security, on the real migration chain.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { closeCutover, enterCutover, performRollback } from '@openmig/core';
import type { MappingId, TenantId } from '@openmig/shared';
import { pgliteDriver } from './pglite-driver.ts';
import { runMigrations } from './migrate.ts';
import { withTenant } from './db.ts';
import type { LedgerDriver } from './driver.ts';
import { bindCutoverLedger, tenantCutoverStore } from './cutover-store.ts';
import { pathLifecyclePort, PATH_PHASE_ACTION } from './a-cutover-of-one-data-type.ts';
import { MAPPING_STATUS_ACTION } from './mapping-status-audit.ts';
import { readPathPhases } from './path-phases.ts';

// UUID family 0128f800-…, unused elsewhere in the repo.
const TENANT = '0128f800-e29b-41d4-a716-446655440001' as TenantId;
const CONNECTION = '0128f800-e29b-41d4-a716-446655440002';
const MAILBOX = '0128f800-e29b-41d4-a716-446655440003';
const MAPPING = '0128f800-e29b-41d4-a716-446655440005' as MappingId;

let driver: LedgerDriver;

async function query<R = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<R[]> {
  const conn = await driver.acquire();
  try {
    return (await conn.query<R>(text, params)).rows;
  } finally {
    conn.release();
  }
}

const whole = () => tenantCutoverStore(driver, TENANT);
const ledgerOf = (domain: 'email' | 'calendar') => bindCutoverLedger(whole(), domain);
const pathOf = (domain: 'email' | 'calendar') => pathLifecyclePort(driver, TENANT, MAPPING, domain, 'cli');
const stepDeps = (domain: 'email' | 'calendar') => ({
  tenantId: TENANT,
  mappingId: MAPPING,
  cutoverStore: ledgerOf(domain),
  mapping: pathOf(domain),
  by: 'cli',
  log: () => {},
});

/** A data type's own cutover, from nothing to APPROVED, as the CLI's start, verify and approve move it. */
async function approve(domain: 'email' | 'calendar'): Promise<void> {
  const ledger = ledgerOf(domain);
  await ledger.initializeCutover({ tenantId: TENANT, mappingId: MAPPING, startedBy: 'test' });
  await ledger.transitionState(TENANT, MAPPING, 'READY_FOR_CUTOVER', { verifiedBy: 'test' });
  await ledger.transitionState(TENANT, MAPPING, 'APPROVED', { approvedBy: 'test' });
}

async function theMigration(): Promise<{ status: string; paths: Record<string, string> }> {
  const [row] = await query<{ status: string }>(`SELECT status FROM mailbox_mapping WHERE id = $1`, [MAPPING]);
  const paths = await query<{ domain: string; state: string }>(
    `SELECT domain, state FROM path_lifecycle WHERE mapping_id = $1`,
    [MAPPING],
  );
  return { status: row!.status, paths: Object.fromEntries(paths.map((p) => [p.domain, p.state])) };
}

async function records(action: string): Promise<Array<Record<string, unknown>>> {
  const rows = await query<{ detail: Record<string, unknown> }>(
    `SELECT detail FROM audit_log WHERE action = $1 ORDER BY at, id`,
    [action],
  );
  return rows.map((r) => r.detail);
}

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await query(`INSERT INTO tenant (id, name, status) VALUES ($1, 'one kind', 'active')`, [TENANT]);
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
  await query(`INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status) VALUES ($1, $2, $3, 'active')`, [
    MAPPING,
    TENANT,
    MAILBOX,
  ]);
  for (const domain of ['email', 'calendar']) {
    await query(`INSERT INTO scope_selection (tenant_id, mapping_id, domain, included) VALUES ($1, $2, $3, true)`, [
      TENANT,
      MAPPING,
      domain,
    ]);
  }
}, 120_000);

beforeEach(async () => {
  await query(`DELETE FROM cutover_event WHERE mapping_id = $1`, [MAPPING]);
  await query(`DELETE FROM cutover_state WHERE mapping_id = $1`, [MAPPING]);
  await query(`DELETE FROM audit_log WHERE tenant_id = $1`, [TENANT]);
  await query(`UPDATE mailbox_mapping SET status = 'active' WHERE id = $1`, [MAPPING]);
  await query(`DELETE FROM path_lifecycle WHERE mapping_id = $1`, [MAPPING]);
  for (const domain of ['email', 'calendar']) {
    await query(
      `INSERT INTO path_lifecycle (tenant_id, mapping_id, domain, state, first_activated_at)
       VALUES ($1, $2, $3, 'active', now() - interval '1 day')`,
      [TENANT, MAPPING, domain],
    );
  }
});

afterAll(async () => {
  await driver?.end();
});

describe('mail cut over on its own, beside running calendars', () => {
  it('moves mail alone, copies it through its own grace period, and closes it', async () => {
    await approve('email');
    const entered = await enterCutover(stepDeps('email'));
    expect(entered.mapping).toEqual({ from: 'active', to: 'cutover', changed: true });
    expect(entered.copiesThroughGrace).toBe(true);

    // Mail's path in its cutover, calendars running: still an active migration.
    expect(await theMigration()).toEqual({ status: 'active', paths: { email: 'cutover', calendar: 'active' } });
    expect(await whole().loadLedgers(TENANT, MAPPING)).toEqual([{ domain: 'email', state: 'CUTOVER_IN_PROGRESS' }]);
    // Every gate reads it so: mail copies through its own window, calendars as before.
    const phases = (await withTenant(driver, TENANT, (db) => readPathPhases(db, TENANT, MAPPING)))!;
    expect(phases.phaseOf('email')).toEqual({ phase: 'cutover', stillCopies: true });
    expect(phases.phaseOf('calendar')).toEqual({ phase: 'active', stillCopies: false });

    // Recorded as mail's own move; the migration's status did not move.
    expect(await records(PATH_PHASE_ACTION)).toEqual([
      { mappingId: MAPPING, domain: 'email', from: 'active', to: 'cutover', via: 'cutover' },
    ]);
    expect(await records(MAPPING_STATUS_ACTION)).toEqual([]);

    await ledgerOf('email').transitionState(TENANT, MAPPING, 'GRACE_PERIOD', {
      gracePeriodStartedAt: new Date().toISOString(),
    });
    const closed = await closeCutover(stepDeps('email'));
    expect(closed.mapping.changed).toBe(false);
    expect(await whole().loadLedgers(TENANT, MAPPING)).toEqual([{ domain: 'email', state: 'COMPLETED' }]);
    const after = (await withTenant(driver, TENANT, (db) => readPathPhases(db, TENANT, MAPPING)))!;
    expect(after.phaseOf('email')).toEqual({ phase: 'cutover', stillCopies: false });
    expect(after.anyRuns).toBe(true);
  });

  it('and once calendars are cut over too, the migration is', async () => {
    await approve('email');
    await enterCutover(stepDeps('email'));
    await approve('calendar');
    await enterCutover(stepDeps('calendar'));

    expect(await theMigration()).toEqual({ status: 'cutover', paths: { email: 'cutover', calendar: 'cutover' } });
    expect(await records(MAPPING_STATUS_ACTION)).toEqual([
      { mappingId: MAPPING, from: 'active', to: 'cutover', via: 'cutover' },
    ]);
  });

  it('a rollback of mail takes mail back alone', async () => {
    await approve('email');
    await enterCutover(stepDeps('email'));
    await approve('calendar');
    await enterCutover(stepDeps('calendar'));

    const back = await performRollback({ ...stepDeps('email'), rolledBackBy: 'cli', reason: 'test' });
    expect(back.mapping).toEqual({ from: 'cutover', to: 'active', changed: true });
    expect(await theMigration()).toEqual({ status: 'active', paths: { email: 'active', calendar: 'cutover' } });
    expect(await whole().loadLedgers(TENANT, MAPPING)).toEqual(
      expect.arrayContaining([
        { domain: 'email', state: 'ROLLED_BACK' },
        { domain: 'calendar', state: 'CUTOVER_IN_PROGRESS' },
      ]),
    );
  });
});

describe('a data type’s cutover and the whole migration’s, kept apart', () => {
  it('the whole migration’s may not begin once a data type has its own', async () => {
    await approve('email');
    await expect(
      whole().initializeCutover({ tenantId: TENANT, mappingId: MAPPING, startedBy: 'test' }),
    ).rejects.toThrow(/one at a time: email/);
    expect(await whole().loadLedgers(TENANT, MAPPING)).toEqual([{ domain: 'email', state: 'APPROVED' }]);
  });

  it('a data type may not move on the whole migration’s while it is under way', async () => {
    await whole().initializeCutover({ tenantId: TENANT, mappingId: MAPPING, startedBy: 'test' });
    await whole().transitionState(TENANT, MAPPING, 'READY_FOR_CUTOVER', { verifiedBy: 'test' });
    await expect(
      ledgerOf('calendar').transitionState(TENANT, MAPPING, 'PREPARING', { retriedBy: 'test' }),
    ).rejects.toThrow(/under way/);
    expect(await whole().loadLedgers(TENANT, MAPPING)).toEqual([{ state: 'READY_FOR_CUTOVER' }]);
  });

  it('a data type leaves a whole migration’s that failed only by beginning its own, which the whole may not follow', async () => {
    await whole().initializeCutover({ tenantId: TENANT, mappingId: MAPPING, startedBy: 'test' });
    await whole().transitionState(TENANT, MAPPING, 'FAILED', { failureReason: 'test' });
    await expect(
      ledgerOf('email').transitionState(TENANT, MAPPING, 'ROLLED_BACK', { rollbackReason: 'test' }),
    ).rejects.toThrow(/start it first/);

    await ledgerOf('email').transitionState(TENANT, MAPPING, 'PREPARING', { retriedBy: 'test' });
    expect(await whole().loadLedgers(TENANT, MAPPING)).toEqual(
      expect.arrayContaining([{ state: 'FAILED' }, { domain: 'email', state: 'PREPARING' }]),
    );
    // And the whole migration's retry is refused now that mail has its own.
    await expect(whole().transitionState(TENANT, MAPPING, 'PREPARING', { retriedBy: 'test' })).rejects.toThrow(
      /one at a time: email/,
    );
  });
});
