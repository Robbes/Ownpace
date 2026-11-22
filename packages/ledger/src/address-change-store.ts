// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE TABLE OF ADDRESS CHANGES, READ AND WRITTEN (ADR-0055; workplan 0168 T2;
 * migration 0071).
 *
 * The one writer of `address_change`, for both editions: the managed routes
 * (`apps/api/src/routes/address-changes.ts`), the appliance's page and its
 * file (`apps/selfhost`). Each function takes a handle inside `withTenant`
 * and filters by the tenant itself as well, beside row security, because the
 * appliance's ledger can run outside `withTenant` (`namesOfKeys` in
 * `ledger.ts` gives the reasoning).
 *
 * EVERY WRITE TAKES THE ORGANISATION'S OWN LOCK FIRST. That a new address is
 * never an old one (`chained`) is a rule over two rows, which no constraint
 * holds: two presses at once, `a → b` and `b → c`, would each pass a check
 * made before the other wrote. So a write takes a transaction-scoped advisory
 * lock named for the organisation, reads the table, checks
 * (`checkAddressChange`, `@openmig/shared`) and writes, in that order, and the
 * second press checks against the first's row. The lock ends with the
 * transaction `withTenant` opened.
 *
 * Idempotent: the same change again writes nothing and says so (`changed:
 * false`), and a refusal writes nothing at all.
 */

import { sql } from 'drizzle-orm';
import {
  addressChangeNotFound,
  addressKey,
  checkAddressChange,
  type AddressChangeRefusal,
  type FileAddressChange,
  type StoredAddressChange,
} from '@openmig/shared';
import type { PgDatabase } from './db.ts';

type Row = Record<string, unknown>;
const rowsOf = (result: unknown): Row[] => ((result as { rows?: Row[] }).rows ?? []) as Row[];

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());

function stored(r: Row): StoredAddressChange {
  return {
    oldKey: String(r.old_key),
    oldAddress: String(r.old_address),
    newAddress: String(r.new_address),
    state: r.state === 'confirmed' ? 'confirmed' : 'proposed',
    setBy: String(r.set_by),
    confirmedBy: r.confirmed_by === null || r.confirmed_by === undefined ? null : String(r.confirmed_by),
    createdAt: iso(r.created_at),
    confirmedAt: r.confirmed_at === null || r.confirmed_at === undefined ? null : iso(r.confirmed_at),
  };
}

/** The organisation's advisory lock for writing its table, held to the end of the transaction. */
async function lockTable(db: PgDatabase, tenantId: string): Promise<void> {
  await db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`address_change:${tenantId}`}, 0))`);
}

/** Every row of the organisation's table, oldest first. A failed read throws. */
export async function readAddressChanges(db: PgDatabase, tenantId: string): Promise<StoredAddressChange[]> {
  return rowsOf(
    await db.execute(sql`
      SELECT old_key, old_address, new_address, state, set_by, confirmed_by, created_at, confirmed_at
        FROM address_change
       WHERE tenant_id = ${tenantId}::uuid
       ORDER BY created_at, old_key`),
  ).map(stored);
}

/** One row, by its key, or undefined. */
export async function readAddressChange(
  db: PgDatabase,
  tenantId: string,
  oldKey: string,
): Promise<StoredAddressChange | undefined> {
  const [row] = rowsOf(
    await db.execute(sql`
      SELECT old_key, old_address, new_address, state, set_by, confirmed_by, created_at, confirmed_at
        FROM address_change
       WHERE tenant_id = ${tenantId}::uuid AND old_key = ${oldKey}`),
  );
  return row === undefined ? undefined : stored(row);
}

/** How a write went: the row as it is now, whether this write made it, and whether it changed anything. */
export type AddressChangeWrite =
  | { readonly ok: true; readonly row: StoredAddressChange; readonly created: boolean; readonly changed: boolean }
  | { readonly ok: false; readonly refusal: AddressChangeRefusal };

/**
 * Add a row: `proposed`, or `confirmed` by `by` when `confirm` is set.
 *
 * The same old address with the same new address again writes nothing
 * (`created: false`), except that `confirm` confirms a `proposed` one.
 */
export async function addAddressChange(
  db: PgDatabase,
  tenantId: string,
  change: { readonly oldAddress: string; readonly newAddress: string; readonly confirm: boolean; readonly by: string },
): Promise<AddressChangeWrite> {
  await lockTable(db, tenantId);
  const table = await readAddressChanges(db, tenantId);
  const checked = checkAddressChange(table, change);
  if (!checked.ok) return checked;
  if (checked.same) {
    if (change.confirm && checked.same.state === 'proposed') {
      return { ok: true, row: await confirm(db, tenantId, checked.same.oldKey, change.by), created: false, changed: true };
    }
    return { ok: true, row: checked.same, created: false, changed: false };
  }
  const [row] = rowsOf(
    await db.execute(sql`
      INSERT INTO address_change (tenant_id, old_key, old_address, new_address, state, set_by, confirmed_by, confirmed_at)
      VALUES (${tenantId}::uuid, ${checked.oldKey}, ${change.oldAddress.trim()}, ${change.newAddress.trim()},
              ${change.confirm ? 'confirmed' : 'proposed'}, ${change.by},
              ${change.confirm ? change.by : null}, ${change.confirm ? sql`now()` : null})
      RETURNING old_key, old_address, new_address, state, set_by, confirmed_by, created_at, confirmed_at`),
  );
  return { ok: true, row: stored(row!), created: true, changed: true };
}

async function confirm(db: PgDatabase, tenantId: string, oldKey: string, by: string): Promise<StoredAddressChange> {
  const [row] = rowsOf(
    await db.execute(sql`
      UPDATE address_change SET state = 'confirmed', confirmed_by = ${by}, confirmed_at = now()
       WHERE tenant_id = ${tenantId}::uuid AND old_key = ${oldKey}
      RETURNING old_key, old_address, new_address, state, set_by, confirmed_by, created_at, confirmed_at`),
  );
  return stored(row!);
}

/**
 * Change a row: its new address, its state, or both.
 *
 * A new `newAddress` without `state: 'confirmed'` leaves the row `proposed`:
 * a confirmation is of one new address, not of whatever the row says later.
 * `state: 'proposed'` sends a row back (*Not right?*) and clears who confirmed
 * it. Saying what the row already says writes nothing.
 */
export async function updateAddressChange(
  db: PgDatabase,
  tenantId: string,
  oldKey: string,
  change: { readonly newAddress?: string; readonly state?: 'proposed' | 'confirmed'; readonly by: string },
): Promise<AddressChangeWrite> {
  await lockTable(db, tenantId);
  const table = await readAddressChanges(db, tenantId);
  const current = table.find((r) => r.oldKey === oldKey);
  if (!current) return { ok: false, refusal: addressChangeNotFound(oldKey) };

  const newAddress = change.newAddress?.trim();
  const readdressed = newAddress !== undefined && newAddress !== current.newAddress;
  if (readdressed) {
    const checked = checkAddressChange(table, { oldAddress: current.oldAddress, newAddress }, oldKey);
    if (!checked.ok) return checked;
  }
  const state = change.state ?? (readdressed ? 'proposed' : current.state);
  const reconfirm = state === 'confirmed' && (readdressed || current.state === 'proposed');
  if (!readdressed && state === current.state) return { ok: true, row: current, created: false, changed: false };

  const [row] = rowsOf(
    await db.execute(sql`
      UPDATE address_change
         SET new_address  = ${newAddress ?? current.newAddress},
             state        = ${state},
             confirmed_by = ${state === 'proposed' ? null : reconfirm ? change.by : current.confirmedBy},
             confirmed_at = ${state === 'proposed' ? null : reconfirm ? sql`now()` : sql`confirmed_at`}
       WHERE tenant_id = ${tenantId}::uuid AND old_key = ${oldKey}
      RETURNING old_key, old_address, new_address, state, set_by, confirmed_by, created_at, confirmed_at`),
  );
  return { ok: true, row: stored(row!), created: false, changed: true };
}

/** Delete a row, answering it as it was, or undefined when there was none. */
export async function deleteAddressChange(
  db: PgDatabase,
  tenantId: string,
  oldKey: string,
): Promise<StoredAddressChange | undefined> {
  await lockTable(db, tenantId);
  const [row] = rowsOf(
    await db.execute(sql`
      DELETE FROM address_change WHERE tenant_id = ${tenantId}::uuid AND old_key = ${oldKey}
      RETURNING old_key, old_address, new_address, state, set_by, confirmed_by, created_at, confirmed_at`),
  );
  return row === undefined ? undefined : stored(row);
}

/**
 * Make the organisation's table the file's (the appliance's Organisation door,
 * 0168 §7): its rows confirmed by the file, every other row gone, and a row
 * that already says what the file says left as it is. Run at start-up, after
 * `parseAddressChangesFile` has refused a malformed file.
 *
 * The file is the only door there (ADR-0034), so a row it no longer lists is
 * deleted, and copies written under it converge back on the next pass.
 */
export async function replaceAddressChangesFromFile(
  db: PgDatabase,
  tenantId: string,
  rows: readonly FileAddressChange[],
  file: string,
): Promise<{ readonly added: number; readonly changed: number; readonly removed: number; readonly kept: number }> {
  await lockTable(db, tenantId);
  const table = await readAddressChanges(db, tenantId);
  const wanted = new Map(rows.map((r) => [r.oldKey, r]));
  let removed = 0;
  for (const r of table) {
    if (!wanted.has(r.oldKey)) {
      await db.execute(sql`DELETE FROM address_change WHERE tenant_id = ${tenantId}::uuid AND old_key = ${r.oldKey}`);
      removed++;
    }
  }
  let added = 0;
  let changed = 0;
  let kept = 0;
  for (const r of rows) {
    const have = table.find((t) => t.oldKey === r.oldKey);
    if (
      have &&
      have.oldAddress === r.oldAddress &&
      have.newAddress === r.newAddress &&
      have.state === 'confirmed' &&
      have.setBy === file &&
      have.confirmedBy === file
    ) {
      kept++;
      continue;
    }
    await db.execute(sql`
      INSERT INTO address_change (tenant_id, old_key, old_address, new_address, state, set_by, confirmed_by, confirmed_at)
      VALUES (${tenantId}::uuid, ${r.oldKey}, ${r.oldAddress}, ${r.newAddress}, 'confirmed', ${file}, ${file}, now())
      ON CONFLICT (tenant_id, old_key) DO UPDATE
         SET old_address = EXCLUDED.old_address, new_address = EXCLUDED.new_address,
             state = 'confirmed', set_by = EXCLUDED.set_by,
             confirmed_by = EXCLUDED.confirmed_by, confirmed_at = now()`);
    if (have) changed++;
    else added++;
  }
  return { added, changed, removed, kept };
}

/** The key a path segment names, decoded and folded, so `A.B@gmail.com` finds `ab@gmail.com`. */
export function oldKeyOf(segment: string): string {
  return addressKey(segment);
}
