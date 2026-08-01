/**
 * Apply-Deletion Job (workplan 0017 T4, managed edition)
 *
 * THE ONE DESTRUCTIVE JOB. The API route has already evaluated every
 * ledger-side gate synchronously and refused on the request if any said no —
 * an enqueue means "permitted, as of a moment ago". This job re-runs ALL the
 * gates freshly (`applyDeletion` is its own final authority; the route's
 * verdict was a prediction, and gate 7's conditional UPDATE stays the last
 * word under concurrency) and performs the one thing a request thread must
 * not: the removal, against the real target, holding real credentials.
 *
 * The outcome lands on the `apply_receipt` row the route created:
 *   - applied, with how final that was (`binned` targets may still hold a copy);
 *   - refused, with the gate that fired — from here that is usually one of the
 *     two only the target could answer (capability; the owner edited our copy),
 *     but a fresh ledger refusal is possible and lands the same way;
 *   - failed, with the reason, if the job itself crashed. Never left `queued`
 *     forever, and never silently dropped (hard rule 9).
 *
 * Trigger: manual (API-initiated), one item per invocation — §11.2's "one
 * item, one decision, one call" survives the queue hop.
 */

import { z } from 'zod';
import { schemaTask, logger } from '@trigger.dev/sdk';
import { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import { applyDeletion, type ApplyDeletionOutcome } from '@openmig/core';
import { withTenant } from '@openmig/ledger';
import * as schemaPg from '@openmig/ledger/schema-pg';
import type { MappingId, RemovalKind, TenantId } from '@openmig/shared';
import { buildDomainDepsFromMapping } from '../build-deps-from-mapping';
import { enabledDomains } from '../enabled-domains';

const ApplyJobSchema = z.object({
  tenantId: z.string().uuid(),
  mappingId: z.string().uuid(),
  naturalKeyHash: z.string().min(1),
  /** The `apply_receipt` row the API created; this job owns its outcome. */
  receiptId: z.string().uuid(),
});

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

const pool = new Pool({ connectionString: DATABASE_URL });

type ReceiptOutcome =
  | { state: 'applied'; kind: RemovalKind }
  | { state: 'refused'; code: string; reason: string }
  | { state: 'failed'; error: string };

/** Land the receipt. One place, so the three terminal shapes cannot diverge. */
async function landReceipt(
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
const DOMAINS = ['email', 'calendar', 'contact', 'file'] as const;

/**
 * Branched per literal rather than passing the union through: each overload of
 * `buildDomainDepsFromMapping` accepts exactly one literal, and the union is
 * not itself one of them as far as overload resolution is concerned — the same
 * shape the appliance's `openSyncDomainDeps` documents.
 */
async function openDeps(tenantId: string, mappingId: string, domain: (typeof DOMAINS)[number]) {
  switch (domain) {
    case 'email': {
      const d = await buildDomainDepsFromMapping(pool, tenantId, mappingId, 'mail');
      return { ledger: d.ledger, target: d.target as unknown, close: d.close };
    }
    case 'calendar': {
      const d = await buildDomainDepsFromMapping(pool, tenantId, mappingId, 'calendar');
      return { ledger: d.ledger, target: d.target as unknown, close: d.close };
    }
    case 'contact': {
      const d = await buildDomainDepsFromMapping(pool, tenantId, mappingId, 'contact');
      return { ledger: d.ledger, target: d.target as unknown, close: d.close };
    }
    case 'file': {
      const d = await buildDomainDepsFromMapping(pool, tenantId, mappingId, 'file');
      return { ledger: d.ledger, target: d.target as unknown, close: d.close };
    }
  }
}

export const runApplyDeletionTask = schemaTask({
  id: 'run-apply-deletion',
  schema: ApplyJobSchema,
  run: async (payload) => {
    const { tenantId, mappingId, naturalKeyHash, receiptId } = payload;
    logger.info(
      `[run-apply-deletion] ${mappingId}: item ${naturalKeyHash.slice(0, 12)} (receipt ${receiptId})`,
    );

    try {
      // The flag is read FRESH, from the mapping row, at execution time. The
      // route read it too, but a queue hop is a window, and the mapping being
      // switched off in that window must win.
      const allowRows = await withTenant(pool, tenantId, (db) =>
        db
          .select({ allow: schemaPg.mailboxMapping.allowApplyDeletions })
          .from(schemaPg.mailboxMapping)
          .where(eq(schemaPg.mailboxMapping.id, mappingId)),
      );
      const allowApplyDeletions = allowRows[0]?.allow === true;

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
        const deps = await openDeps(tenantId, mappingId, domain);
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

          outcome = await applyDeletion(
            {
              tenantId: tenantId as TenantId,
              mappingId: mappingId as MappingId,
              domain,
              ledger: deps.ledger,
              target: deps.target,
              allowApplyDeletions,
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
        await landReceipt(tenantId, receiptId, { state: 'applied', kind: outcome.kind });
        logger.info(
          `[run-apply-deletion] ${mappingId}: removed ${naturalKeyHash.slice(0, 12)} (${outcome.kind})`,
        );
        return { receiptId, applied: true, kind: outcome.kind };
      }

      await landReceipt(tenantId, receiptId, {
        state: 'refused',
        code: outcome.code,
        reason: outcome.reason,
      });
      logger.info(
        `[run-apply-deletion] ${mappingId}: refused ${naturalKeyHash.slice(0, 12)} (${outcome.code})`,
      );
      return { receiptId, applied: false, code: outcome.code };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`[run-apply-deletion] ${mappingId}: job failed: ${message}`);
      await landReceipt(tenantId, receiptId, { state: 'failed', error: message });
      throw err;
    }
  },
});
