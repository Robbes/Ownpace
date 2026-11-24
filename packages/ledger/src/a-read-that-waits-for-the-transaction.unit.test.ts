// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A read on the appliance's shared handle, while a tenant's transaction opens.
 *
 * On PGlite there is one session. `withTenant` opens its transaction in three
 * statements: `BEGIN`, `SET LOCAL ROLE app_user`, then `set_config` for the
 * tenant. The handle `createPgliteDb()` hands out for use outside `withTenant`
 * (the appliance's status store and cursor store are built on it) used to send
 * its statements straight to that session, past the queue `acquire()` keeps.
 * One that landed between the role and the tenant ran as `app_user` with an
 * empty tenant, failed with `invalid input syntax for type uuid: ""`, and
 * aborted the tenant's transaction, whose next statement then failed too.
 *
 * Both reads below are expected to succeed, every time.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createPgliteDb } from './pglite-driver.ts';
import { runMigrations } from './migrate.ts';
import { withTenant } from './db.ts';
import { PgCursorStore } from './cursor-store.ts';
import type { LedgerDriver } from './driver.ts';
import type { PgDatabase } from './db-types.ts';
import { sql } from 'drizzle-orm';
import type { MappingId, TenantId } from '@openmig/shared';

const TENANT = '5c7a0000-e29b-41d4-a716-446655440001' as TenantId;
const MAPPING = '5c7a0000-e29b-41d4-a716-446655440002' as MappingId;

let db: PgDatabase;
let driver: LedgerDriver;
let close: () => Promise<void>;

beforeAll(async () => {
  // The appliance's own wiring: PGlite, serving tenant traffic as `app_user`.
  ({ db, driver, close } = await createPgliteDb({ role: 'app_user' }));
  await runMigrations({ driver, logger: () => {} });
}, 120_000);

afterAll(async () => {
  await close?.();
});

/**
 * Wait `n` microtasks, so a statement starts at a chosen point. Microtasks and
 * not timers: PGlite runs in-process, so `withTenant` can send its whole
 * opening between two turns of the event loop.
 */
async function ticks(n: number): Promise<void> {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

/** `ok`, or the SQLSTATE the statement failed with. */
function outcome(r: PromiseSettledResult<unknown>): string {
  if (r.status === 'fulfilled') return 'ok';
  const reason = r.reason as { code?: string; cause?: { code?: string } };
  return reason.cause?.code ?? reason.code ?? String(r.reason);
}

describe('the shared handle on PGlite', () => {
  it('waits for a tenant transaction to finish rather than running inside it', async () => {
    const cursors = new PgCursorStore(db);
    // Each round starts the store read a little later than the last, so across
    // the rounds it lands on every statement `withTenant` sends, the gap
    // between the role and the tenant included.
    for (let offset = 0; offset < 200; offset++) {
      const tenantWork = withTenant(driver, TENANT, async (tx) => {
        const inside = new PgCursorStore(tx);
        await inside.get(TENANT, MAPPING, 'INBOX');
        return inside.get(TENANT, MAPPING, 'Sent');
      });
      const outside = ticks(offset).then(() => cursors.get(TENANT, MAPPING, 'INBOX'));
      const [a, b] = await Promise.allSettled([tenantWork, outside]);
      // Before the fix, one offset gave `{ tenant: '25P02', outside: '22P02' }`.
      expect({ offset, tenant: outcome(a), outside: outcome(b) }).toEqual({ offset, tenant: 'ok', outside: 'ok' });
    }
  });

  it('runs a statement sent from inside a tenant transaction on that transaction, without waiting for itself', { timeout: 10_000 }, async () => {
    const cursors = new PgCursorStore(db);
    // A caller inside `withTenant` that reaches for the shared handle (a store
    // built on it) is already holding the one session; waiting for the queue
    // would wait for itself forever.
    // Bounded, so a regression fails here rather than hanging the file.
    let timer: NodeJS.Timeout | undefined;
    const waitedForItself = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('the shared handle waited for its own transaction')), 5_000);
    });
    const work = withTenant(driver, TENANT, async (tx) => {
      const viaShared = await cursors.get(TENANT, MAPPING, 'INBOX');
      const [scope] = (
        await tx.execute(sql`SELECT current_user AS who, current_setting('app.current_tenant', true) AS tenant`)
      ).rows as { who: string; tenant: string }[];
      return { viaShared, scope };
    });
    const result = await Promise.race([work, waitedForItself]).finally(() => clearTimeout(timer));
    expect(result).toEqual({ viaShared: undefined, scope: { who: 'app_user', tenant: TENANT } });
  });
});
