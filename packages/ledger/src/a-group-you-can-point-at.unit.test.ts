// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A group decision can name the failure KIND, not only a substring.
 *
 * The owner, shown a box to type an error fragment into (2026-09-17): *"why now
 * detail groups that share sumilarities and offer those to pick from to do bulk
 * actions?"*
 *
 * Typing a needle is how a person describes a group they have already worked
 * out for themselves. A category is one the rows announce: every failed row has
 * carried one since migration 0049, and the Failures screen already prints its
 * sentence per row. Grouping by it names something the reader can see.
 *
 * ## Why this runs against a real database
 *
 * The whole change is one `WHERE` clause, and the thing that can go wrong with
 * it is SQL's, not TypeScript's: `=` never matches NULL, so an uncategorised
 * row is reached by no category press. That is not a quirk to work around, it
 * is what the screen's grouping relies on to keep its count honest, and a fake
 * would answer whatever the fake's author believed.
 *
 * UUID family 6b140000-…, unused elsewhere in the repo.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { pgliteDriver, runMigrations, withTenant, PgLedger } from './index.ts';
import type { LedgerDriver } from './index.ts';
import type { FailureCategory, MappingId, TenantId } from '@openmig/shared';

const TENANT = '6b140000-e29b-41d4-a716-446655442001' as TenantId;
const CONN = '6b140000-e29b-41d4-a716-446655442011';
const BOX = '6b140000-e29b-41d4-a716-446655442021';
const MAPPING = '6b140000-e29b-41d4-a716-446655442031' as MappingId;

let driver: LedgerDriver;

/** One failed row, with or without a recorded category. */
async function failed(
  hash: string,
  domain: 'contact' | 'file' | 'calendar',
  category: FailureCategory | null,
  lastError: string,
): Promise<void> {
  const conn = await driver.acquire();
  try {
    await conn.query(
      `INSERT INTO item
         (tenant_id, mapping_id, domain, item_type, collection, natural_key,
          natural_key_hash, status, attempt_count, last_error, last_error_category)
       VALUES ($1,$2,$3,$3,'',$4,$4,'failed',5,$5,$6)`,
      [TENANT, MAPPING, domain, hash, lastError, category],
    );
  } finally {
    await conn.release();
  }
}

/** The statuses the rows now carry, keyed by their hash. */
async function statuses(): Promise<Record<string, string>> {
  const conn = await driver.acquire();
  try {
    const r = await conn.query(
      'SELECT natural_key_hash, status FROM item WHERE mapping_id = $1 ORDER BY natural_key_hash',
      [MAPPING],
    );
    return Object.fromEntries(
      (r.rows as Array<{ natural_key_hash: string; status: string }>).map((row) => [
        row.natural_key_hash,
        row.status,
      ]),
    );
  } finally {
    await conn.release();
  }
}

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  const conn = await driver.acquire();
  try {
    const q = (sql: string, p: unknown[] = []) => conn.query(sql, p);
    await q('INSERT INTO tenant (id, name) VALUES ($1,$2)', [TENANT, 'named']);
    await q(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
       VALUES ($1,$2,'source','google','g','{}'::jsonb,'connected')`,
      [CONN, TENANT],
    );
    await q(
      `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address)
       VALUES ($1,$2,$3,'user','m@example.invalid')`,
      [BOX, TENANT, CONN],
    );
    await q(
      `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status)
       VALUES ($1,$2,$3,'active')`,
      [MAPPING, TENANT, BOX],
    );
  } finally {
    await conn.release();
  }
}, 120_000);

afterAll(async () => {
  await driver.end?.();
});

beforeEach(async () => {
  const conn = await driver.acquire();
  try {
    await conn.query('DELETE FROM item WHERE mapping_id = $1', [MAPPING]);
  } finally {
    await conn.release();
  }
  // Two contacts the destination refused, one file the SOURCE refused, and one
  // contact from before categories were recorded. The shape of the owner's own
  // queue on 2026-09-17.
  await failed('c-refused-1', 'contact', 'target_refused', 'PUT failed with status 500: TypeError');
  await failed('c-refused-2', 'contact', 'target_refused', 'PUT failed with status 500: TypeError');
  await failed('f-source-1', 'file', 'source_refused', 'cannotExportFile');
  await failed('c-nameless', 'contact', null, 'PUT failed with status 500: TypeError');
});

describe('a category names a group the rows announce', () => {
  it('changes only the rows carrying it', async () => {
    const matched = await withTenant(driver, TENANT, async (db) =>
      new PgLedger(db).resolveFailureGroup(TENANT, MAPPING, 'accept', {
        domain: 'contact',
        category: 'target_refused',
      }),
    );

    expect(matched).toBe(2);
    expect(await statuses()).toEqual({
      'c-nameless': 'failed',
      'c-refused-1': 'left_behind',
      'c-refused-2': 'left_behind',
      'f-source-1': 'failed',
    });
  });

  it('NEVER reaches a row with no category recorded', async () => {
    // SQL's `=` does not match NULL, and the screen's grouping relies on it:
    // the uncategorised group is offered with a count and no button precisely
    // because no category press can describe it.
    const matched = await withTenant(driver, TENANT, async (db) =>
      new PgLedger(db).resolveFailureGroup(TENANT, MAPPING, 'accept', {
        category: 'target_refused',
      }),
    );

    expect(matched).toBe(2);
    expect((await statuses())['c-nameless']).toBe('failed');
  });

  it('crosses the domain rather than replacing it', async () => {
    // `target_refused` alone would reach the two contacts and nothing else
    // here; with a domain that disagrees it reaches nothing. Both halves of the
    // AND have to be live, which a single-condition implementation passes only
    // by accident.
    const matched = await withTenant(driver, TENANT, async (db) =>
      new PgLedger(db).resolveFailureGroup(TENANT, MAPPING, 'accept', {
        domain: 'file',
        category: 'target_refused',
      }),
    );

    expect(matched).toBe(0);
    expect(await statuses()).toEqual({
      'c-nameless': 'failed',
      'c-refused-1': 'failed',
      'c-refused-2': 'failed',
      'f-source-1': 'failed',
    });
  });

  it('retries the group rather than accepting it, when asked to', async () => {
    // The same match, the other decision: attempts back to zero and the park
    // cleared, so the loop sees them again.
    const matched = await withTenant(driver, TENANT, async (db) =>
      new PgLedger(db).resolveFailureGroup(TENANT, MAPPING, 'retry', {
        category: 'source_refused',
      }),
    );

    expect(matched).toBe(1);
    const conn = await driver.acquire();
    try {
      const r = await conn.query(
        'SELECT attempt_count, status FROM item WHERE natural_key_hash = $1',
        ['f-source-1'],
      );
      expect(r.rows[0]).toMatchObject({ attempt_count: 0, status: 'failed' });
    } finally {
      await conn.release();
    }
  });

  it('still narrows on the error text, which the categories cannot separate', async () => {
    // One connector defect inside one category is the case this panel was
    // built for, and it is why the typed match survives beside the groups.
    const matched = await withTenant(driver, TENANT, async (db) =>
      new PgLedger(db).resolveFailureGroup(TENANT, MAPPING, 'accept', {
        category: 'target_refused',
        errorContains: 'TypeError',
      }),
    );
    expect(matched).toBe(2);
  });
});
