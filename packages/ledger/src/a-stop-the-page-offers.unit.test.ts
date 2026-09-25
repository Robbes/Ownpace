// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE STOP THE PAGE OFFERS IS THE STOP THE DOOR ACCEPTS (workplan 0128 T4,
 * T5 slice 3c).
 *
 * The migration page shows a Stop or a Resume per data type, and the door
 * decides whether a press is accepted. Both ask one rule, `decidePathStop`,
 * over the same facts, `readPathStopFacts`: the page is offered what
 * `pathStopChoices` makes of them. So the rule is pinned here on its own, the
 * choices against it, and the facts on PGlite as `app_user`, together with
 * what the strip reads: whose stop a `stopped` row is.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { DiscoveryDomain, MappingId, TenantId } from '@openmig/shared';
import { pgliteDriver } from './pglite-driver.ts';
import { runMigrations } from './migrate.ts';
import { withTenant } from './db.ts';
import type { LedgerDriver } from './driver.ts';
import { PgMigrationStatusStore } from './migration-status-store.ts';
import {
  decidePathStop,
  pathStopChoices,
  readPathStopFacts,
  stopOrResumePath,
  type PathStopFacts,
} from './a-stop-per-data-type.ts';

const facts = (status: string, carried: PathStopFacts['carried']): PathStopFacts => ({ status, carried });

describe('the one rule', () => {
  const running = facts('active', [
    { domain: 'email', phase: 'active', stopped: false },
    { domain: 'calendar', phase: 'active', stopped: false },
  ]);

  it('accepts a stop of one of two copying, in its phase, and a second press changes nothing', () => {
    expect(decidePathStop(running, 'email', true)).toEqual({ changes: true, phase: 'active', hasRow: true });
    expect(decidePathStop(running, 'email', false)).toEqual({ changes: false });
  });

  it('refuses in the order the door answers: not running, not carried, past its cutover, the last one', () => {
    expect(decidePathStop(facts('paused', running.carried), 'email', true)).toEqual({
      refused: 'not_running',
      status: 'paused',
    });
    expect(decidePathStop(running, 'contact', true)).toEqual({ refused: 'not_a_path' });
    const lane = facts('continuous', [
      { domain: 'email', phase: 'cutover', stopped: false },
      { domain: 'calendar', phase: 'continuous', stopped: false },
    ]);
    expect(decidePathStop(lane, 'email', true)).toEqual({ refused: 'not_stoppable', phase: 'cutover' });
    // D5: in the lane, the kept one is the last one still copying.
    expect(decidePathStop(lane, 'calendar', true)).toEqual({ refused: 'last_one_copying' });
  });

  it('runs a data type with no row in the migration’s phase: stoppable, and counted as copying', () => {
    const rowless = facts('active', [
      { domain: 'email', stopped: false },
      { domain: 'calendar', phase: 'active', stopped: false },
    ]);
    expect(decidePathStop(rowless, 'email', true)).toEqual({ changes: true, phase: 'active', hasRow: false });
    expect(decidePathStop(rowless, 'calendar', true)).toEqual({ changes: true, phase: 'active', hasRow: true });
  });
});

describe('what the page is offered', () => {
  it('offers Stop for every data type the door would stop', () => {
    expect(
      pathStopChoices(
        facts('active', [
          { domain: 'email', phase: 'active', stopped: false },
          { domain: 'calendar', phase: 'active', stopped: false },
        ]),
      ),
    ).toEqual([
      { domain: 'email', stopped: false, offer: 'stop' },
      { domain: 'calendar', stopped: false, offer: 'stop' },
    ]);
  });

  it('offers Resume for a stopped one, and holds the last one still copying, saying why (D5)', () => {
    expect(
      pathStopChoices(
        facts('active', [
          { domain: 'email', phase: 'active', stopped: true },
          { domain: 'calendar', phase: 'active', stopped: false },
        ]),
      ),
    ).toEqual([
      { domain: 'email', stopped: true, offer: 'resume' },
      { domain: 'calendar', stopped: false, offer: null, held: 'last_one_copying' },
    ]);
  });

  it('says nothing of D5 where the migration carries one data type: there was never a choice', () => {
    expect(pathStopChoices(facts('active', [{ domain: 'email', phase: 'active', stopped: false }]))).toEqual([
      { domain: 'email', stopped: false, offer: null },
    ]);
  });

  it('while the migration does not run, offers nothing, and says so only of a stopped one', () => {
    expect(
      pathStopChoices(
        facts('paused', [
          { domain: 'email', phase: 'paused', stopped: true },
          { domain: 'calendar', phase: 'paused', stopped: false },
        ]),
      ),
    ).toEqual([
      { domain: 'email', stopped: true, offer: null, held: 'not_running' },
      { domain: 'calendar', stopped: false, offer: null },
    ]);
  });

  it('offers nothing, and says nothing, for a data type past its cutover', () => {
    expect(
      pathStopChoices(
        facts('continuous', [
          { domain: 'email', phase: 'done', stopped: true },
          { domain: 'calendar', phase: 'continuous', stopped: false },
          { domain: 'contact', phase: 'continuous', stopped: false },
        ]),
      ),
    ).toEqual([
      { domain: 'email', stopped: true, offer: null },
      { domain: 'calendar', stopped: false, offer: 'stop' },
      { domain: 'contact', stopped: false, offer: 'stop' },
    ]);
  });
});

// UUID family 0128f500-…, unused elsewhere in the repo.
const TENANT = '0128f500-e29b-41d4-a716-446655440001';
const OTHER_TENANT = '0128f500-e29b-41d4-a716-446655440011';
const CONNECTION = '0128f500-e29b-41d4-a716-446655440002';
const MAILBOX = '0128f500-e29b-41d4-a716-446655440003';
const MAPPING = '0128f500-e29b-41d4-a716-446655440005';

let driver: LedgerDriver;

async function query(text: string, params: unknown[] = []): Promise<Array<Record<string, unknown>>> {
  const conn = await driver.acquire();
  try {
    return (await conn.query<Record<string, unknown>>(text, params)).rows;
  } finally {
    conn.release();
  }
}

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await query(`INSERT INTO tenant (id, name, status) VALUES ($1, 'offers', 'active'), ($2, 'other', 'active')`, [
    TENANT,
    OTHER_TENANT,
  ]);
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
  // Files, contacts and mail carried, calendars not; files have no path row.
  for (const [domain, included] of [
    ['file', true],
    ['contact', true],
    ['email', true],
    ['calendar', false],
  ] as const) {
    await query(`INSERT INTO scope_selection (tenant_id, mapping_id, domain, included) VALUES ($1, $2, $3, $4)`, [
      TENANT,
      MAPPING,
      domain,
      included,
    ]);
  }
  for (const domain of ['email', 'contact', 'calendar']) {
    await query(
      `INSERT INTO path_lifecycle (tenant_id, mapping_id, domain, state, first_activated_at)
       VALUES ($1, $2, $3, 'active', now())`,
      [TENANT, MAPPING, domain],
    );
  }
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

const read = (tenant = TENANT) => withTenant(driver, tenant, (db) => readPathStopFacts(db, tenant, MAPPING));

describe('the facts, as the door and the page read them', () => {
  it('lists each data type the migration carries, in the order a person ticks them, with its row', async () => {
    expect(await read()).toEqual({
      status: 'active',
      carried: [
        { domain: 'email', phase: 'active', stopped: false },
        { domain: 'contact', phase: 'active', stopped: false },
        // No row: it runs in the migration's phase, which the rule supplies.
        { domain: 'file', stopped: false },
      ],
    });
  });

  it('reads no migration of another organisation (row security)', async () => {
    expect(await read(OTHER_TENANT)).toBeUndefined();
  });

  it('reads a stop the door wrote, and the strip says whose it is', async () => {
    const press = (domain: DiscoveryDomain, stop: boolean) =>
      withTenant(driver, TENANT, (db) =>
        stopOrResumePath(db, TENANT, { mappingId: MAPPING, domain, stop, actor: 'someone' }),
      );
    expect(await press('email', true)).toEqual({ changed: true, slotsTaken: false });
    try {
      expect((await read())!.carried[0]).toEqual({ domain: 'email', phase: 'active', stopped: true });
      expect(pathStopChoices((await read())!)[0]).toEqual({ domain: 'email', stopped: true, offer: 'resume' });

      // A data type the mapping file switched off is `stopped` too, but not
      // its owner's: the strip says the two apart.
      await withTenant(driver, TENANT, async (db) => {
        const store = new PgMigrationStatusStore(db);
        await store.initDomainStatus(TENANT as TenantId, MAPPING as MappingId, 'contact');
        await store.markSwitchedOff(TENANT as TenantId, MAPPING as MappingId, 'contact');
      });
      const rows = await withTenant(driver, TENANT, (db) =>
        new PgMigrationStatusStore(db).getStatus(TENANT as TenantId, MAPPING as MappingId),
      );
      const email = rows.find((r) => r.domain === 'email')!;
      expect(email.state).toBe('stopped');
      expect(email.stoppedByOwner).toBe(true);
      const contact = rows.find((r) => r.domain === 'contact')!;
      expect('stoppedByOwner' in contact).toBe(false);
    } finally {
      await press('email', false);
    }
  });
});
