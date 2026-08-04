// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Discovered shared addresses, against a real database (workplan 0027 T1).
 *
 * PGlite with the real migrations applied, like the decision and preset
 * suites: every property worth testing here is a database property. That a
 * second discovery pass UPDATES rather than shadows, that the unique key is
 * per source connection rather than per tenant, that an unclassifiable group
 * is storable as unclassified, and — the one that would cost real work to get
 * wrong — that re-running discovery cannot rewind a group T2 already created
 * on the target.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { asTenantId } from '@openmig/shared';
import { eq } from 'drizzle-orm';
import { createPgliteDb } from './pglite-driver';
import { runMigrations } from './migrate';
import { PgGroupDefStore } from './group-def-store';
import * as schemaPg from './schema-pg';
import type { PgDatabase } from './db';
import type { LedgerDriver } from './driver';

const TENANT = asTenantId('7c1d0000-e29b-41d4-a716-446655443001');
const OTHER = asTenantId('7c1d0000-e29b-41d4-a716-446655443002');
const CONN_A = '7c1d0000-e29b-41d4-a716-4466554430a1';
const CONN_B = '7c1d0000-e29b-41d4-a716-4466554430b2';

let db: PgDatabase;
let driver: LedgerDriver;
let close: () => Promise<void>;
let groups: PgGroupDefStore;

beforeAll(async () => {
  ({ db, driver, close } = await createPgliteDb());
  await runMigrations({ driver, logger: () => {} });
  const conn = await driver.acquire();
  try {
    await conn.query(`INSERT INTO tenant (id, name) VALUES ($1, 'groups')`, [TENANT]);
    await conn.query(`INSERT INTO tenant (id, name) VALUES ($1, 'other')`, [OTHER]);
    for (const [id, tenant] of [
      [CONN_A, TENANT],
      [CONN_B, TENANT],
    ] as const) {
      await conn.query(
        `INSERT INTO connection (id, tenant_id, kind, role, display_name, config)
           VALUES ($1, $2, 'o365', 'source', $3, '{}')`,
        [id, tenant, `source ${id.slice(-2)}`],
      );
    }
  } finally {
    conn.release();
  }
  groups = new PgGroupDefStore(db);
}, 120_000);

afterAll(async () => {
  await close?.();
});

describe('recording a discovered group', () => {
  it('stores it and says it is new', async () => {
    const { row, created } = await groups.upsert(TENANT, {
      sourceConnectionId: CONN_A,
      address: 'sales@acme.nl',
      sourceGroupId: 'graph-1',
      displayName: 'Sales',
      pattern: 'distribution_d',
      members: ['rob@acme.nl', 'jan@acme.nl'],
    });

    expect(created).toBe(true);
    expect(row).toMatchObject({
      address: 'sales@acme.nl',
      displayName: 'Sales',
      pattern: 'distribution_d',
      status: 'pending',
    });
    expect(row.members).toEqual(['rob@acme.nl', 'jan@acme.nl']);
  });

  it('stores one it could not classify', async () => {
    // A mail-enabled group whose type the directory did not state is a real
    // finding. Refusing to store it, or defaulting it to a pattern, would be
    // the two ways of pretending we know (rule 9).
    const { row } = await groups.upsert(TENANT, {
      sourceConnectionId: CONN_A,
      address: 'mystery@acme.nl',
      members: [],
    });
    expect(row.pattern).toBeUndefined();
    expect(row.members).toEqual([]);
  });

  it('tells an EMPTY member list apart from an UNREAD one', async () => {
    const empty = await groups.upsert(TENANT, {
      sourceConnectionId: CONN_A,
      address: 'empty@acme.nl',
      members: [],
    });
    const unread = await groups.upsert(TENANT, {
      sourceConnectionId: CONN_A,
      address: 'unread@acme.nl',
      members: [],
      membersKnown: false,
    });

    // Both hold `[]`. Pattern D recreates a group FROM this list, so a group
    // whose members could not be read must not be recreated as an empty one.
    expect(empty.row.members).toEqual([]);
    expect(empty.row.membersKnown).toBe(true);
    expect(unread.row.members).toEqual([]);
    expect(unread.row.membersKnown).toBe(false);
  });

  it('clears the unread flag once the members ARE read', async () => {
    await groups.upsert(TENANT, {
      sourceConnectionId: CONN_A,
      address: 'recovered@acme.nl',
      members: [],
      membersKnown: false,
    });
    const again = await groups.upsert(TENANT, {
      sourceConnectionId: CONN_A,
      address: 'recovered@acme.nl',
      members: ['rob@acme.nl'],
    });
    // A permission granted between two runs must leave the row usable.
    expect(again.row.membersKnown).toBe(true);
    expect(again.row.members).toEqual(['rob@acme.nl']);
  });

  it('normalises the address, so a case change is not a new group', async () => {
    const first = await groups.upsert(TENANT, {
      sourceConnectionId: CONN_A,
      address: 'Info@Acme.NL',
      members: [],
    });
    const second = await groups.upsert(TENANT, {
      sourceConnectionId: CONN_A,
      address: 'info@acme.nl',
      members: [],
    });
    expect(second.created).toBe(false);
    expect(second.row.id).toBe(first.row.id);
  });
});

describe('discovery running again', () => {
  it('UPDATES the member list rather than shadowing it', async () => {
    await groups.upsert(TENANT, {
      sourceConnectionId: CONN_A,
      address: 'support@acme.nl',
      members: ['rob@acme.nl'],
    });
    const again = await groups.upsert(TENANT, {
      sourceConnectionId: CONN_A,
      address: 'support@acme.nl',
      members: ['rob@acme.nl', 'nieuw@acme.nl'],
    });

    expect(again.created).toBe(false);
    expect(again.row.members).toEqual(['rob@acme.nl', 'nieuw@acme.nl']);
    // One row: a second would make "which member list is current" depend on
    // read order, and Pattern D recreates from exactly this list.
    const all = (await groups.list(TENANT)).filter((g) => g.address === 'support@acme.nl');
    expect(all).toHaveLength(1);
  });

  it('picks up a classification that was not knowable the first time', async () => {
    await groups.upsert(TENANT, {
      sourceConnectionId: CONN_A,
      address: 'later@acme.nl',
      members: [],
    });
    const again = await groups.upsert(TENANT, {
      sourceConnectionId: CONN_A,
      address: 'later@acme.nl',
      pattern: 'shared_s',
      members: [],
    });
    // An M365 group that gained a store is Pattern S from then on (§14.1).
    expect(again.row.pattern).toBe('shared_s');
  });

  it('does NOT rewind a group the target already has', async () => {
    const { row } = await groups.upsert(TENANT, {
      sourceConnectionId: CONN_A,
      address: 'done@acme.nl',
      members: ['rob@acme.nl'],
    });
    // Stand in for what T2 does after recreating the group on the target.
    await db
      .update(schemaPg.groupDef)
      .set({ status: 'created', targetGroupRef: 'soverin:group-9' })
      .where(eq(schemaPg.groupDef.id, row.id));

    const again = await groups.upsert(TENANT, {
      sourceConnectionId: CONN_A,
      address: 'done@acme.nl',
      members: ['rob@acme.nl', 'jan@acme.nl'],
    });

    // Rule 2: a re-run never undoes an action. Resetting this to `pending`
    // would tell the appliance to create a group that already exists.
    expect(again.row.status).toBe('created');
    expect(again.row.targetGroupRef).toBe('soverin:group-9');
    expect(again.row.members).toEqual(['rob@acme.nl', 'jan@acme.nl']);
  });
});

describe('recording the pattern an owner chose (workplan 0028 T3)', () => {
  it('sets it on the discovered address', async () => {
    await groups.upsert(TENANT, {
      sourceConnectionId: CONN_A,
      address: 'answered@acme.nl',
      members: [],
    });

    expect(await groups.setPattern(TENANT, 'answered@acme.nl', 'shared_s')).toBe(1);
    const [row] = (await groups.list(TENANT)).filter((g) => g.address === 'answered@acme.nl');
    expect(row?.pattern).toBe('shared_s');
  });

  it('answers the ADDRESS across every source that has it', async () => {
    await groups.upsert(TENANT, {
      sourceConnectionId: CONN_A,
      address: 'both@acme.nl',
      members: [],
    });
    await groups.upsert(TENANT, {
      sourceConnectionId: CONN_B,
      address: 'both@acme.nl',
      members: [],
    });

    // "Do recipients jointly handle both@?" is a fact about how the
    // organisation uses the address, not about which directory we read it
    // from, so it is true of both rows.
    expect(await groups.setPattern(TENANT, 'both@acme.nl', 'distribution_d')).toBe(2);
  });

  it('normalises the address the same way the upsert does', async () => {
    await groups.upsert(TENANT, {
      sourceConnectionId: CONN_A,
      address: 'Case@Acme.NL',
      members: [],
    });
    expect(await groups.setPattern(TENANT, 'CASE@ACME.NL', 'shared_s')).toBe(1);
  });

  it('reports landing on NOTHING rather than claiming success', async () => {
    // An answer that matched no row means discovery has stopped seeing the
    // address — worth knowing, and indistinguishable from a real write if
    // this returned void (rule 9).
    expect(await groups.setPattern(TENANT, 'gone@acme.nl', 'shared_s')).toBe(0);
  });

  it('never answers another tenant’s address', async () => {
    await groups.upsert(TENANT, {
      sourceConnectionId: CONN_A,
      address: 'mine@acme.nl',
      members: [],
    });
    expect(await groups.setPattern(OTHER, 'mine@acme.nl', 'shared_s')).toBe(0);
  });
});

describe('what counts as the same group', () => {
  it('keeps connections independent', async () => {
    await groups.upsert(TENANT, {
      sourceConnectionId: CONN_A,
      address: 'shared@acme.nl',
      members: ['a@acme.nl'],
    });
    const other = await groups.upsert(TENANT, {
      sourceConnectionId: CONN_B,
      address: 'shared@acme.nl',
      members: ['b@acme.nl'],
    });
    // The same address found on a second source is a second finding — two
    // sources being migrated at once is exactly the consolidation case.
    expect(other.created).toBe(true);
    const both = (await groups.list(TENANT)).filter((g) => g.address === 'shared@acme.nl');
    expect(both).toHaveLength(2);
  });

  it('never returns another tenant’s groups', async () => {
    expect(await groups.list(OTHER)).toEqual([]);
  });
});
