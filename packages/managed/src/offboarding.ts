// Copyright 2026 The Ownpace authors (Apache-2.0)

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
import {
  DEFAULT_BACKUP_RETENTION_DAYS,
  erasureTimeline,
  type RevocationOutcome,
} from '@openmig/shared';
import type { PgDatabase } from '@openmig/ledger';

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
  // The path lifecycle, beside the scope selection it is the sibling of
  // (workplan 0109 T1a). Both its foreign keys
  // CASCADE, so an erasure would remove these rows either way — and that is
  // precisely why the name belongs here. The comment above this list says it:
  // relying on the cascade is how `invoice` and `audit_log` came to be
  // destroyed by a single `DELETE FROM tenant`. Named explicitly, the rows are
  // deleted BEFORE the tenant row and counted, so `erasure_record.purged_counts`
  // says how many there were. Left to the cascade, the receipt would under-report
  // what the erasure actually removed, which is the one thing a receipt is for.
  'path_lifecycle',
  'scope_selection',
  // Before `verification` AND before `mailbox_mapping`: a run references both,
  // and its foreign key to the mapping has no ON DELETE clause — so it
  // RESTRICTS. Absent from this list, a tenant with a single verification run
  // could not be erased at all: `purgeTenant` threw
  // `verification_run_mapping_id_fkey` partway through, leaving a tenant
  // marked `deleting` and half emptied. Found 2026-08-27 by seeding the
  // fixture with the rows a real tenant actually has.
  'verification_run',
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
  // Before `mailbox_mapping`: a link references the mapping it opens.
  'mapping_link',
  'mailbox_mapping',
  'mailbox',
  'connection',
  // The buyer's identity (workplan 0111 T1): for a consumer, a person's name
  // and home address — exactly what an erasure erases. Deleted AFTER the
  // invoice detach above has stamped the buyer's name onto the invoices, which
  // is the only part of this row an invoice is allowed to keep needing; the
  // legal document itself lives in the bookkeeping system (ADR-0044).
  'billing_party',
  // The VIES consultation log (0111 T2). Purged with the buyer it is about,
  // consistent with T10's "purge the mirror, keep the pointer": the
  // consultation that justified a retained invoice's treatment belongs ON the
  // invoice document in the bookkeeping system (T4 carries the consultation
  // number there), not in a log outliving the customer here. The request path
  // could not delete these rows if it wanted to — INSERT and SELECT only —
  // so this list is the one deleter.
  'vat_consultation',
  'payment_method',
  'usage_metric',
  'tenant_member',
  'tenant_pricing',
  'tenant_closure',
  'audit_log',
  'rate_budget',
  'byte_budget',
  // The support read log (workplan 0110 T1). It exists so a customer can be
  // SHOWN what an operator looked at — that is the accountability standing
  // where a consent row would have been. Once the customer is erased there is
  // nobody left to show it to, and rows naming a tenant id that no longer
  // exists are precisely what an erasure removes; `erasure_record` goes to the
  // trouble of hashing the id for exactly this reason.
  //
  // Only the rows naming this tenant. A read of the tenant LIST carries a NULL
  // `tenant_id` and stays: it is not about any one customer, and deleting it
  // would erase the record of an operator having surveyed everybody.
  'support_read',
  // The request that created this tenant, and the SECOND thing that made an
  // erasure impossible.
  //
  // Migration 0007 gave `access_request.tenant_id` an ON DELETE **RESTRICT**
  // foreign key, deliberately, and said so in as many words: *"delete the
  // requests before you delete a tenant. Nothing in the product deletes
  // tenants — non-destructive by default (ADR-0024) — so this is for operators
  // clearing up by hand, and for tests."*
  //
  // That was true when 0007 was written and stopped being true when offboarding
  // shipped: `apps/worker/src/jobs/managed-purge-closed.ts` deletes tenants on
  // a schedule now. The service is invite-only, so EVERY managed customer has a
  // granted request pointing at their tenant — the erasure of any real customer
  // would have failed on this constraint. This line is 0007's own instruction,
  // finally carried out by the code that needs it.
  //
  // Purged rather than detached (the treatment `invoice` gets): an invoice is
  // kept for tax retention and can say who it billed without a tenant, while a
  // request kept after erasure is somebody's name, email and organisation held
  // for no reason anybody could give them.
  'access_request',
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

  // The STATUS is on `tenant`, in the shared chain; the DATES are in
  // `tenant_closure`, in the managed one (ADR-0036). What state a tenant is in
  // is a fact about the tenant; when we promised to delete it is a promise made
  // to a customer, and an appliance has no customers to promise anything to.
  //
  // The status update goes FIRST and is the one that decides whether this
  // close is allowed to happen: it carries the `status <> 'deleting'` guard, so
  // a close racing a purge that has already begun fails here, before any date
  // is written.
  const rows = await db.execute(sql`
    UPDATE tenant
       SET status = 'closed'
     WHERE id = ${tenantId}::uuid AND status <> 'deleting'
    RETURNING id
  `);
  if (resultRows(rows).length === 0) {
    throw new Error(
      `Cannot close tenant ${tenantId}: it does not exist, or its purge has already started.`,
    );
  }

  // Upsert, not insert: closing an already-closed tenant with a different
  // window is a real thing to do, and it must move the date rather than fail on
  // a primary key.
  await db.execute(sql`
    INSERT INTO tenant_closure (tenant_id, closed_at, purge_after, closed_by)
    VALUES (${tenantId}::uuid, ${now}, ${purgeAfter}, ${closedBy})
    ON CONFLICT (tenant_id) DO UPDATE
       SET closed_at = EXCLUDED.closed_at,
           purge_after = EXCLUDED.purge_after,
           closed_by = EXCLUDED.closed_by
  `);

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
  // Deleting the closure row IS the reopen, and it carries the whole condition:
  // there has to be a row (the tenant is closed) and its `purge_after` has to
  // be in the future (the window is still open). Doing it in this order means a
  // tenant can never be left `active` with a purge still scheduled against it —
  // the failure that would have the purge job delete a live account.
  const rows = await db.execute(sql`
    DELETE FROM tenant_closure
     WHERE tenant_id = ${tenantId}::uuid AND purge_after > ${now}
    RETURNING tenant_id
  `);
  if (resultRows(rows).length === 0) {
    throw new Error(
      `Cannot reopen tenant ${tenantId}: it is not closed, or its purge window has already passed.`,
    );
  }
  await db.execute(sql`
    UPDATE tenant SET status = 'active' WHERE id = ${tenantId}::uuid AND status = 'closed'
  `);
  await db.execute(sql`
    UPDATE erasure_record SET window_days = -1
     WHERE tenant_ref = ${tenantRef(tenantId)} AND purged_at IS NULL
  `);
}

export interface PurgeResult {
  readonly tenantRef: string;
  readonly counts: Readonly<Record<string, number>>;
  readonly retainedInvoiceIds: readonly string[];
  /** What happened when each stored credential was revoked at its provider. */
  readonly revocations: readonly RevocationOutcome[];
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
  /**
   * The outcome of attempting provider-side revocation, done by the CALLER
   * before this runs (T4a).
   *
   * Passed in rather than performed here for two reasons. This module talks to
   * one database and nothing else, and a network call inside the purge
   * transaction would hold it open across an unbounded wait. And revocation
   * must happen while the `connection` rows still exist — it needs the
   * credentials this function is about to delete — so the ordering is the
   * caller's to get right, and making it a parameter is what forces them to.
   *
   * Defaults to empty, which the receipt reports honestly as "no attempt was
   * recorded" rather than as "nothing needed revoking".
   */
  revocations: readonly RevocationOutcome[] = [],
): Promise<PurgeResult> {
  const ref = tenantRef(tenantId);
  const counts: Record<string, number> = {};

  // Detach the invoices BEFORE deleting the tenant, and stamp what they were
  // for. After the tenant row is gone there is nothing left to read the name
  // from, and an invoice that cannot say who it billed is not a record.
  //
  // The BUYER's name over the tenant's display name (workplan 0111 T1): since
  // billing_party exists, the tenant name is a workspace label somebody typed
  // ("Jansen thuis"), while billing_party.name is who invoices are addressed
  // to. The label stays as the fallback for tenants that never provided
  // details — an approximate name beats an invoice that says nobody. Runs
  // before the PURGED_TABLES loop, so billing_party still exists to read.
  const invoices = await db.execute(sql`
    UPDATE invoice
       SET billed_to_name = COALESCE(
             billed_to_name,
             (SELECT name FROM billing_party WHERE tenant_id = ${tenantId}::uuid),
             (SELECT name FROM tenant WHERE id = ${tenantId}::uuid)),
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
           purged_counts = ${JSON.stringify(counts)}::jsonb,
           revocations = ${JSON.stringify(revocations)}::jsonb
     WHERE tenant_ref = ${ref} AND purged_at IS NULL
  `);

  return { tenantRef: ref, counts, retainedInvoiceIds, revocations };
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
