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
 *
 * WHO WROTE WHAT IS RECORDED (0168 §5; the review's finding 4). A write's
 * caller records it with `recordAddressChangeWrite`, in the same transaction:
 * who, which row by reference, and the state it went from and to. The
 * reference is the row's old key as the audit export's pseudonym, so no
 * address is ever written into `audit_log`, which outlives the row.
 */

import { sql } from 'drizzle-orm';
import {
  addressChangeNotFound,
  addressKey,
  checkAddressChange,
  type AddressChangeRefusal,
  type FileAddressChange,
  type Pseudonymize,
  type StoredAddressChange,
  type TenantId,
} from '@openmig/shared';
import type { PgDatabase } from './db.ts';
import { PgLedger } from './ledger.ts';

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

/**
 * The organisation's advisory lock for writing its table, held to the end of
 * the transaction. Every write here takes it; a caller takes it first when
 * what it reads before the write must hold until the write (whose row it is,
 * on managed). Taken twice in one transaction, it is held once.
 */
export async function lockAddressChanges(db: PgDatabase, tenantId: string): Promise<void> {
  await db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`address_change:${tenantId}`}, 0))`);
}
const lockTable = lockAddressChanges;

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

/**
 * How a write went: the row as it is now and as it was before (null when this
 * write made it), whether this write made it, and whether it changed anything.
 */
export type AddressChangeWrite =
  | {
      readonly ok: true;
      readonly row: StoredAddressChange;
      readonly before: StoredAddressChange | null;
      readonly created: boolean;
      readonly changed: boolean;
    }
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
    const before = checked.same;
    if (change.confirm && before.state === 'proposed') {
      return { ok: true, row: await confirm(db, tenantId, before.oldKey, change.by), before, created: false, changed: true };
    }
    return { ok: true, row: before, before, created: false, changed: false };
  }
  const [row] = rowsOf(
    await db.execute(sql`
      INSERT INTO address_change (tenant_id, old_key, old_address, new_address, state, set_by, confirmed_by, confirmed_at)
      VALUES (${tenantId}::uuid, ${checked.oldKey}, ${change.oldAddress.trim()}, ${change.newAddress.trim()},
              ${change.confirm ? 'confirmed' : 'proposed'}, ${change.by},
              ${change.confirm ? change.by : null}, ${change.confirm ? sql`now()` : null})
      RETURNING old_key, old_address, new_address, state, set_by, confirmed_by, created_at, confirmed_at`),
  );
  return { ok: true, row: stored(row!), before: null, created: true, changed: true };
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
  if (!readdressed && state === current.state) {
    return { ok: true, row: current, before: current, created: false, changed: false };
  }

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
  return { ok: true, row: stored(row!), before: current, created: false, changed: true };
}

/**
 * Delete a row, answering it as it was, or undefined when there was none.
 *
 * The answer is the DELETE's own `RETURNING`, taken under the lock: of two
 * deletes at once, the second finds nothing and says so (0168's review,
 * finding 8). A caller answers from this, never from a read made before it.
 */
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

const sameRow = (a: StoredAddressChange, b: StoredAddressChange): boolean =>
  a.oldAddress === b.oldAddress &&
  a.newAddress === b.newAddress &&
  a.state === b.state &&
  a.setBy === b.setBy &&
  a.confirmedBy === b.confirmedBy &&
  a.createdAt === b.createdAt &&
  a.confirmedAt === b.confirmedAt;

/**
 * Make the organisation's table exactly these rows, each as it is, who set
 * and confirmed it and when included: every other row deleted, and a row that
 * already says the same left as it is.
 *
 * The appliance's Personal door (0168 §7) keeps one table for every tenant
 * its config directory names, as its file door does: at start-up every
 * tenant's table is made the first's, and after each write on its page the
 * table it was written in is copied to the others (0168's review, finding 5).
 */
export async function replaceAddressChanges(
  db: PgDatabase,
  tenantId: string,
  rows: readonly StoredAddressChange[],
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
    if (have && sameRow(have, r)) {
      kept++;
      continue;
    }
    await db.execute(sql`
      INSERT INTO address_change (tenant_id, old_key, old_address, new_address, state, set_by, confirmed_by, created_at, confirmed_at)
      VALUES (${tenantId}::uuid, ${r.oldKey}, ${r.oldAddress}, ${r.newAddress}, ${r.state}, ${r.setBy},
              ${r.confirmedBy}, ${r.createdAt}::timestamptz, ${r.confirmedAt}::timestamptz)
      ON CONFLICT (tenant_id, old_key) DO UPDATE
         SET old_address = EXCLUDED.old_address, new_address = EXCLUDED.new_address,
             state = EXCLUDED.state, set_by = EXCLUDED.set_by, confirmed_by = EXCLUDED.confirmed_by,
             created_at = EXCLUDED.created_at, confirmed_at = EXCLUDED.confirmed_at`);
    if (have) changed++;
    else added++;
  }
  return { added, changed, removed, kept };
}

/**
 * Delete every row one setter set, answering their keys: the appliance's
 * `address-changes.json` rows once the file is gone (0168's review, finding
 * 7), since a row nothing can change any more is not one anybody chose to
 * keep.
 */
export async function deleteAddressChangesSetBy(db: PgDatabase, tenantId: string, setBy: string): Promise<string[]> {
  await lockTable(db, tenantId);
  return rowsOf(
    await db.execute(sql`
      DELETE FROM address_change WHERE tenant_id = ${tenantId}::uuid AND set_by = ${setBy}
      RETURNING old_key`),
  ).map((r) => String(r.old_key));
}

/** The key a path segment names, decoded and folded, so `A.B@gmail.com` finds `ab@gmail.com`. */
export function oldKeyOf(segment: string): string {
  return addressKey(segment);
}

/**
 * What a write of the table is recorded under in `audit_log` (0168 §5: *"The
 * audit log records who confirmed which row by reference"*).
 */
export const ADDRESS_CHANGE_ADDED_ACTION = 'address_change.added';
export const ADDRESS_CHANGE_READDRESSED_ACTION = 'address_change.readdressed';
export const ADDRESS_CHANGE_CONFIRMED_ACTION = 'address_change.confirmed';
export const ADDRESS_CHANGE_SENT_BACK_ACTION = 'address_change.sent_back';
export const ADDRESS_CHANGE_LINKED_ACTION = 'address_change.linked';
export const ADDRESS_CHANGE_DELETED_ACTION = 'address_change.deleted';

/** One write of the table, as its audit record says it. */
export interface AddressChangeAudit {
  /**
   * Who wrote it: the sign-in's subject on managed, the door's link holder
   * (`grant-link`, `progress-link`) for a person's own link, `operator` on the
   * appliance's page.
   */
  readonly actor: string;
  /** The door it came through: `api` on managed, `link` for a person's own link, `page` on the appliance. */
  readonly via: string;
  /**
   * The audit export's pseudonym under this deployment's key
   * (`pseudonymizer`), applied to the row's old key: the row by reference,
   * the same reference in every record of it, and never its address.
   */
  readonly pseudonym: Pseudonymize;
  /** The row as it was, or null when this write added it. */
  readonly before: StoredAddressChange | null;
  /** The row as it is now, or null when this write deleted it. */
  readonly after: StoredAddressChange | null;
  /**
   * Managed only: whose row it is once written (null for nobody), and whether
   * this write moved that link. Absent on the appliance, which has no people.
   */
  readonly person?: { readonly id: string | null; readonly moved: boolean };
  /** Managed only: the person's link a write through it came by, as a withdrawal through one records it. */
  readonly personLinkId?: string;
}

/**
 * Which action a write is, or null when it changed nothing: a press that says
 * what the row already says is not an event, and is not recorded. A new
 * address outranks a state, and a state a person, in a write that did more
 * than one; the record says the states either way.
 */
export function addressChangeAction(write: Omit<AddressChangeAudit, 'actor' | 'via' | 'pseudonym'>): string | null {
  const { before, after } = write;
  if (before === null && after === null) return null;
  if (before === null) return ADDRESS_CHANGE_ADDED_ACTION;
  if (after === null) return ADDRESS_CHANGE_DELETED_ACTION;
  if (before.newAddress !== after.newAddress) return ADDRESS_CHANGE_READDRESSED_ACTION;
  if (before.state !== after.state) {
    return after.state === 'confirmed' ? ADDRESS_CHANGE_CONFIRMED_ACTION : ADDRESS_CHANGE_SENT_BACK_ACTION;
  }
  if (write.person?.moved) return ADDRESS_CHANGE_LINKED_ACTION;
  return null;
}

/**
 * Record one write of the table, in the write's own transaction (`db`), so
 * the row and its record commit together or not at all, as a migration's
 * status change and its record do (`mapping-status-audit.ts`). Answers whether
 * anything was recorded.
 *
 * The record names who (`actor`), the row by reference (`addressChange`), the
 * states it went `from` and `to` (null for a row added or deleted), the door
 * (`via`) and, on managed, whose row it is (`personId`). NEVER an address:
 * `audit_log` is never pruned and outlives the row, and the address of a
 * deleted row must go with it.
 */
export async function recordAddressChangeWrite(
  db: PgDatabase,
  tenantId: string,
  write: AddressChangeAudit,
): Promise<boolean> {
  const action = addressChangeAction(write);
  const row = write.after ?? write.before;
  if (action === null || row === null) return false;
  await new PgLedger(db).recordAuditEvent(tenantId as TenantId, {
    actor: write.actor,
    action,
    entity: 'address_change',
    detail: {
      addressChange: write.pseudonym(row.oldKey),
      from: write.before?.state ?? null,
      to: write.after?.state ?? null,
      via: write.via,
      ...(write.person ? { personId: write.person.id } : {}),
      ...(write.personLinkId === undefined ? {} : { personLinkId: write.personLinkId }),
    },
  });
  return true;
}
