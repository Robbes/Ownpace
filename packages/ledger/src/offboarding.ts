// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Ending the service: close, wait, purge (workplan 0085).
 *
 * ## Two acts, not one
 *
 * Ending the service is commercial; erasing the data is legal. They must not be
 * the same button, because the first is reversible and routine and the second
 * is neither. So **closing** stops syncs and billing and makes the account
 * read-only, and the **purge** happens later, when the window the customer
 * chose has run out.
 *
 * ## What survives, and why that is not a loophole
 *
 * Invoices survive, detached from the tenant. That is the GDPR art. 17(3)(b)
 * carve-out and not a convenience: Dutch tax law wants invoices kept for years,
 * so a literal "erase everything" would trade one legal obligation for another.
 * Everything about what was migrated goes.
 *
 * ## What this NEVER touches
 *
 * **The source.** Nothing, ever — hard rule 2, and the reason the source is the
 * rollback path in the first place.
 *
 * **The target.** Also nothing, ever. The migrated mail is the customer's, in
 * the customer's own system. We forget our record of it; we do not reach into
 * their new mailbox. That deserves saying loudly, because *"delete my data"* is
 * exactly the phrase a person could reasonably expect to mean the opposite.
 */

import { sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { DEFAULT_BACKUP_RETENTION_DAYS, erasureTimeline } from '@openmig/shared';
import type { PgDatabase } from './db-types';

/** The windows a customer may choose (owner decision, 2026-08-18). */
export const CLOSE_WINDOWS_DAYS = [0, 7, 30, 90] as const;
export type CloseWindowDays = (typeof CLOSE_WINDOWS_DAYS)[number];

export function isCloseWindow(value: unknown): value is CloseWindowDays {
  return typeof value === 'number' && (CLOSE_WINDOWS_DAYS as readonly number[]).includes(value);
}

/**
 * The tables purged when a tenant is erased, in dependency order.
 *
 * **Written out rather than derived from the cascade**, which is the whole
 * point. Relying on `ON DELETE CASCADE` is how `invoice` and `audit_log` came
 * to be destroyed by a single `DELETE FROM tenant` — the cascade does whatever
 * the schema happens to say, and nobody reviews a schema for what it deletes.
 * A list is reviewable, and the test asserts against this exact list, so
 * adding a table to the schema without deciding its fate fails a test rather
 * than silently inheriting a decision.
 */
export const PURGED_TABLES = [
  'run_event',
  'run',
  'item',
  'sync_checkpoint',
  'cursor',
  'collection_mapping',
  'scope_selection',
  'verification',
  'cutover_event',
  'cutover_state',
  'cutover',
  'migration_status',
  'migration_discovery',
  'decision',
  'policy_preset',
  'group_def',
  'share_grant',
  'apply_receipt',
  'setup_step',
  'backup_target',
  'mailbox_mapping',
  'mailbox',
  'connection',
  'payment_method',
  'usage_metric',
  'tenant_member',
  'audit_log',
  'rate_budget',
] as const;

/**
 * Tables that deliberately SURVIVE an erasure, with the reason.
 *
 * Exported so the test can assert on it and so the reason travels with the
 * decision rather than living in a commit message.
 */
export const RETAINED_TABLES: Readonly<Record<string, string>> = {
  invoice:
    'Tax retention outlives the customer relationship. Detached from the tenant ' +
    '(tenant_id becomes NULL) and carrying billed_to_name captured at issue time.',
  erasure_record:
    'The proof the erasure happened. It holds a one-way hash of the tenant id, ' +
    'never the id, so it cannot be read back into a list of former customers.',
};

/** The stable reference an auditor can recompute; never the tenant id itself. */
export function tenantRef(tenantId: string): string {
  return createHash('sha256').update(tenantId).digest('hex');
}

export interface CloseResult {
  readonly purgeAfter: Date;
  readonly windowDays: CloseWindowDays;
  /**
   * When the last backup that could still contain this tenant's data ages out
   * — i.e. when erasure actually completes (T5). `purgeAfter` is when the LIVE
   * database stops holding it; these are not the same day, and telling a
   * customer only the first one is telling them something untrue.
   */
  readonly backupsExpireAt: Date;
  /** This deployment's backup retention window, as it stood at close time. */
  readonly backupRetentionDays: number;
}

/**
 * Close a tenant: stop the service now, schedule the purge for later.
 *
 * Immediate (window 0) sets `purgeAfter` to now rather than purging inline, so
 * **one code path serves every window**. A separate "delete straight away"
 * branch would be the one that runs least often and gets tested least, while
 * being the one with no window in which to catch a mistake.
 */
export async function closeTenant(
  db: PgDatabase,
  tenantId: string,
  windowDays: CloseWindowDays,
  closedBy: string,
  now: Date,
  /**
   * This deployment's backup retention, in days. Passed in rather than read
   * from the environment here so the promise made to one customer can be
   * recomputed from the record later, and so a test can state the number it
   * is testing instead of arranging for `process.env` to say it.
   */
  backupRetentionDays: number = DEFAULT_BACKUP_RETENTION_DAYS,
): Promise<CloseResult> {
  const timeline = erasureTimeline({ closedAt: now, windowDays, backupRetentionDays });
  const purgeAfter = timeline.purgeAfter;

  const rows = await db.execute(sql`
    UPDATE tenant
       SET status = 'closed', closed_at = ${now}, purge_after = ${purgeAfter}, closed_by = ${closedBy}
     WHERE id = ${tenantId}::uuid AND status <> 'deleting'
    RETURNING id
  `);
  if (resultRows(rows).length === 0) {
    throw new Error(
      `Cannot close tenant ${tenantId}: it does not exist, or its purge has already started.`,
    );
  }

  // The record is written at CLOSE, not at purge. A purge that never runs —
  // because the job is broken, or the process died — must still leave evidence
  // that somebody asked, and when. `purged_at` staying NULL is exactly the
  // signal that something owed did not happen.
  // The retention window is recorded as a NUMBER as well as a date. The number
  // can change when the backup schedule changes; the date the customer was
  // given cannot. Storing only the date would leave nobody able to say how it
  // was arrived at, and storing only the number would leave the date to be
  // recomputed under whatever retention happens to be current.
  await db.execute(sql`
    INSERT INTO erasure_record (
      tenant_ref, requested_at, window_days, backup_retention_days, backups_expire_at
    )
    VALUES (
      ${tenantRef(tenantId)}, ${now}, ${windowDays},
      ${timeline.backupRetentionDays}, ${timeline.backupsExpireAt}
    )
  `);

  return {
    purgeAfter,
    windowDays,
    backupsExpireAt: timeline.backupsExpireAt,
    backupRetentionDays: timeline.backupRetentionDays,
  };
}

/**
 * Undo a close, while the window is still open.
 *
 * The reason the staged flow exists at all: somebody closes by mistake, or a
 * card dispute resolves, or a bug in the purge is spotted. Once `deleting` has
 * begun there is nothing to come back to and this refuses.
 */
export async function reopenTenant(db: PgDatabase, tenantId: string, now: Date): Promise<void> {
  const rows = await db.execute(sql`
    UPDATE tenant
       SET status = 'active', closed_at = NULL, purge_after = NULL, closed_by = NULL
     WHERE id = ${tenantId}::uuid AND status = 'closed' AND purge_after > ${now}
    RETURNING id
  `);
  if (resultRows(rows).length === 0) {
    throw new Error(
      `Cannot reopen tenant ${tenantId}: it is not closed, or its purge window has already passed.`,
    );
  }
  await db.execute(sql`
    UPDATE erasure_record SET window_days = -1
     WHERE tenant_ref = ${tenantRef(tenantId)} AND purged_at IS NULL
  `);
}

export interface PurgeResult {
  readonly tenantRef: string;
  readonly counts: Readonly<Record<string, number>>;
  readonly retainedInvoiceIds: readonly string[];
}

/**
 * Erase one closed tenant whose window has run out.
 *
 * Ordered, explicit, and inside ONE transaction: a half-purged tenant is worse
 * than an un-purged one, because it is neither a customer nor gone and nothing
 * downstream expects it.
 *
 * The caller is responsible for having quiesced the tenant's passes first —
 * see `assertNoRunningPasses`. Purging `item` under a running pass would tell
 * the next one to copy everything again, **into the leaving customer's target**.
 */
export async function purgeTenant(
  db: PgDatabase,
  tenantId: string,
  now: Date,
): Promise<PurgeResult> {
  const ref = tenantRef(tenantId);
  const counts: Record<string, number> = {};

  // Detach the invoices BEFORE deleting the tenant, and stamp what they were
  // for. After the tenant row is gone there is nothing left to read the name
  // from, and an invoice that cannot say who it billed is not a record.
  const invoices = await db.execute(sql`
    UPDATE invoice
       SET billed_to_name = COALESCE(billed_to_name, (SELECT name FROM tenant WHERE id = ${tenantId}::uuid)),
           tenant_id = NULL
     WHERE tenant_id = ${tenantId}::uuid
    RETURNING id
  `);
  const retainedInvoiceIds = resultRows<{ id: string }>(invoices).map((r) => r.id);

  for (const table of PURGED_TABLES) {
    const res = await db.execute(
      sql`DELETE FROM ${sql.identifier(table)} WHERE tenant_id = ${tenantId}::uuid`,
    );
    counts[table] = rowCount(res);
  }

  const tenantRows = await db.execute(sql`DELETE FROM tenant WHERE id = ${tenantId}::uuid RETURNING id`);
  counts['tenant'] = resultRows(tenantRows).length;

  await db.execute(sql`
    UPDATE erasure_record
       SET purged_at = ${now},
           retained_invoice_ids = ${sql.raw(pgUuidArray(retainedInvoiceIds))},
           purged_counts = ${JSON.stringify(counts)}::jsonb
     WHERE tenant_ref = ${ref} AND purged_at IS NULL
  `);

  return { tenantRef: ref, counts, retainedInvoiceIds };
}

/** A literal `uuid[]`, because a parameterised array is driver-specific here. */
function pgUuidArray(ids: readonly string[]): string {
  for (const id of ids) {
    // Defence in depth: these come from a RETURNING on a uuid column, so they
    // cannot be anything else — but this string is interpolated, and an
    // interpolated string with no check is how that stops being true later.
    if (!/^[0-9a-fA-F-]{36}$/.test(id)) throw new Error(`Not a uuid: ${id}`);
  }
  return `ARRAY[${ids.map((i) => `'${i}'::uuid`).join(',')}]::uuid[]`;
}

function resultRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const rows = (result as { rows?: unknown } | null)?.rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}

function rowCount(result: unknown): number {
  const count = (result as { rowCount?: unknown } | null)?.rowCount;
  return typeof count === 'number' ? count : 0;
}
