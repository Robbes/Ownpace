// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The run both apply jobs share: `run-apply-deletion` (workplan 0017 T4) and
 * `run-apply-relocation` (ADR-0030). The two were the same body, line for
 * line, apart from the core function each calls and the words each logs; they
 * now differ only in those, which each job passes in. Every gate still lives
 * in that core function (`applyDeletion`, `applyRelocation`), which is its own
 * final authority; this module only finds the item's domain, calls it once,
 * and lands the outcome on the receipt the route created.
 *
 * It builds no pool and ends none: each job opens its pools through
 * `openTaskPools` and hands this the tenant pool.
 */

import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import type { ApplyDeletionDeps, ApplyDeletionOutcome } from '@openmig/core';
import { withTenant } from '@openmig/ledger';
import * as schemaPg from '@openmig/ledger/schema-pg';
import { DISCOVERY_DOMAINS, log } from '@openmig/shared';
import type { MappingId, RemovalKind, TenantId } from '@openmig/shared';
import { buildDomainDepsFromMapping } from '@openmig/orchestration/build-deps-from-mapping';
import { enabledDomains } from '@openmig/orchestration/enabled-domains';

/** What an apply job is queued with: its `ApplyJobSchema`, which each job declares. */
export interface ApplyJobPayload {
  readonly tenantId: string;
  readonly mappingId: string;
  readonly naturalKeyHash: string;
  /** The `apply_receipt` row the API created; this job owns its outcome. */
  readonly receiptId: string;
}

type ReceiptOutcome =
  | { state: 'applied'; kind: RemovalKind }
  | { state: 'refused'; code: string; reason: string }
  | { state: 'failed'; error: string };

/** Land the receipt. One place, so the three terminal shapes cannot diverge. */
async function landReceipt(
  pool: Pool,
  tenantId: string,
  receiptId: string,
  outcome: ReceiptOutcome,
): Promise<void> {
  await withTenant(pool, tenantId, async (db) => {
    await db
      .update(schemaPg.applyReceipt)
      .set({
        state: outcome.state,
        finishedAt: new Date(),
        ...(outcome.state === 'applied' ? { kind: outcome.kind } : {}),
        ...(outcome.state === 'refused' ? { code: outcome.code, reason: outcome.reason } : {}),
        ...(outcome.state === 'failed' ? { reason: outcome.error } : {}),
      })
      .where(eq(schemaPg.applyReceipt.id, receiptId));
  });
}

/** The order domains are searched — identical to the appliance's, on purpose. */
const DOMAINS = DISCOVERY_DOMAINS;

/**
 * Branched per literal rather than passing the union through: each overload of
 * `buildDomainDepsFromMapping` accepts exactly one literal, and the union is
 * not itself one of them as far as overload resolution is concerned — the same
 * shape the appliance's `openSyncDomainDeps` documents.
 */
async function openDeps(pool: Pool, tenantId: string, mappingId: string, domain: (typeof DOMAINS)[number]) {
  switch (domain) {
    case 'email': {
      const d = await buildDomainDepsFromMapping(pool, tenantId, mappingId, 'mail');
      return { ledger: d.ledger, target: d.target as unknown, stillTheAuthority: d.stillTheAuthority, close: d.close };
    }
    case 'calendar': {
      const d = await buildDomainDepsFromMapping(pool, tenantId, mappingId, 'calendar');
      return { ledger: d.ledger, target: d.target as unknown, stillTheAuthority: d.stillTheAuthority, close: d.close };
    }
    case 'contact': {
      const d = await buildDomainDepsFromMapping(pool, tenantId, mappingId, 'contact');
      return { ledger: d.ledger, target: d.target as unknown, stillTheAuthority: d.stillTheAuthority, close: d.close };
    }
    case 'file': {
      const d = await buildDomainDepsFromMapping(pool, tenantId, mappingId, 'file');
      return { ledger: d.ledger, target: d.target as unknown, stillTheAuthority: d.stillTheAuthority, close: d.close };
    }
    case 'task': {
      const d = await buildDomainDepsFromMapping(pool, tenantId, mappingId, 'task');
      return { ledger: d.ledger, target: d.target as unknown, stillTheAuthority: d.stillTheAuthority, close: d.close };
    }
  }
}

/** What one apply job brings to the shared run: its name, its core call, its words. */
export interface ApplyJob {
  /** The job's name, as its log lines are tagged: `run-apply-deletion`, `run-apply-relocation`. */
  readonly name: string;
  /** The core function that runs every gate and, if all say yes, removes the copy. */
  readonly apply: (deps: ApplyDeletionDeps, naturalKeyHash: string) => Promise<ApplyDeletionOutcome>;
  /** What the job logs once the copy is removed, after `<mapping>: `. */
  readonly removed: (item: string, kind: RemovalKind) => string;
}

/** One item, one decision, one call: the run of an apply job, on the tenant pool it was handed. */
export async function applyOneItem(job: ApplyJob, pool: Pool, payload: ApplyJobPayload) {
  const { tenantId, mappingId, naturalKeyHash, receiptId } = payload;
  log.info(
    `[${job.name}] ${mappingId}: item ${naturalKeyHash.slice(0, 12)} (receipt ${receiptId})`,
  );

  try {
    // Under a prefix the copy lives at prefix/collection while the ledger
    // records the SOURCE collection — the removal must open the mailbox the
    // copy is actually in. Read FRESH, from the mapping row, at execution
    // time: a queue hop is a window. (Deleting by hand, and a move applied by
    // hand, have no per-mapping switch since alpha.21, ADR-0024 2026-11-25:
    // there is no flag to read.)
    const mappingRows = await withTenant(pool, tenantId, (db) =>
      db
        .select({ prefix: schemaPg.mailboxMapping.targetFolderPrefix })
        .from(schemaPg.mailboxMapping)
        .where(eq(schemaPg.mailboxMapping.id, mappingId)),
    );
    const targetFolderPrefix = mappingRows[0]?.prefix ?? undefined;

    // Only the domains the owner SELECTED are probed. Opening deps for a
    // domain the mapping does not migrate is not a harmless no-op: the
    // domain's deps builder needs that domain's connector config, and on a
    // mapping without it, it throws — the first live run failed exactly
    // there, on the MAIL builder of a DAV-only mapping, before the item's
    // own domain was ever reached (0018 T5, 2026-08-01).
    const enabled = await enabledDomains(pool, tenantId, mappingId);

    let outcome: ApplyDeletionOutcome | undefined;
    for (const domain of DOMAINS) {
      if (!enabled.has(domain)) continue;
      const deps = await openDeps(pool, tenantId, mappingId, domain);
      try {
        const row = await deps.ledger.find(
          tenantId as TenantId,
          mappingId as MappingId,
          domain,
          naturalKeyHash,
        );
        // Not this domain's item — move on without touching anything or
        // reporting a reason that would only make sense for the wrong domain.
        if (!row) continue;

        outcome = await job.apply(
          {
            tenantId: tenantId as TenantId,
            mappingId: mappingId as MappingId,
            domain,
            ledger: deps.ledger,
            target: deps.target,
            // The data type's phase, asked at the removal through the
            // question the deps builder made from `readPathPhases`, read
            // fresh: a cutover executed since the press wins, and after it
            // nothing is removed (`after_cutover`, 2026-10-05).
            stillTheAuthority: deps.stillTheAuthority,
            ...(targetFolderPrefix ? { targetFolderPrefix } : {}),
          },
          naturalKeyHash,
        );
        break;
      } finally {
        await deps.close();
      }
    }

    if (!outcome) {
      outcome = {
        ok: false,
        code: 'not_found',
        reason:
          "No migrated item under that natural key in any of this mapping's enabled domains.",
      };
    }

    if (outcome.ok) {
      await landReceipt(pool, tenantId, receiptId, { state: 'applied', kind: outcome.kind });
      log.info(`[${job.name}] ${mappingId}: ${job.removed(naturalKeyHash.slice(0, 12), outcome.kind)}`);
      return { receiptId, applied: true, kind: outcome.kind };
    }

    await landReceipt(pool, tenantId, receiptId, {
      state: 'refused',
      code: outcome.code,
      reason: outcome.reason,
    });
    log.info(
      `[${job.name}] ${mappingId}: refused ${naturalKeyHash.slice(0, 12)} (${outcome.code})`,
    );
    return { receiptId, applied: false, code: outcome.code };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`[${job.name}] ${mappingId}: job failed: ${message}`);
    await landReceipt(pool, tenantId, receiptId, { state: 'failed', error: message });
    throw err;
  }
}
