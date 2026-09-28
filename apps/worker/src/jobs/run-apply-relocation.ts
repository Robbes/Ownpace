// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Apply-Relocation Job (ADR-0030, managed edition)
 *
 * THE SECOND DESTRUCTIVE JOB, and the shape of `run-apply-deletion` on
 * purpose: the API route has already evaluated every ledger-side gate
 * synchronously (`evaluateApplyRelocation`) and refused on the request if any
 * said no. This job re-runs ALL the gates freshly — `applyRelocation` is its
 * own final authority — and performs the parts a request thread must not: it
 * asks the TARGET whether the relocated copy is really there (ADR-0030's own
 * gate; the ledger's word is a claim, not proof), and only then removes the
 * OLD copy, holding real credentials.
 *
 * The outcome lands on the `apply_receipt` row the route created — the one
 * with `action = 'relocation'`, because the same item can have a deletion
 * receipt open at the same time and the two must never answer for each other.
 *
 * Trigger: manual (API-initiated), one item per invocation — §11.2's "one
 * item, one decision, one call" survives the queue hop.
 */

// The rule for a host a tenant gives us, on before this run connects anywhere (0136 T1).
import './refuse-internal-addresses.ts';
import { z } from 'zod';
import { schemaTask } from '@trigger.dev/sdk';
import { leavesAReference } from './what-a-run-leaves.ts';
import { eq } from 'drizzle-orm';
import { applyRelocation, type ApplyDeletionOutcome } from '@openmig/core';
import { withTenant } from '@openmig/ledger';
import * as schemaPg from '@openmig/ledger/schema-pg';
import { DISCOVERY_DOMAINS, log } from '@openmig/shared';
import { openTaskPools } from './task-pools.ts';
import type { MappingId, RemovalKind, TenantId } from '@openmig/shared';
import { buildDomainDepsFromMapping } from '@openmig/orchestration/build-deps-from-mapping';
import { enabledDomains } from '@openmig/orchestration/enabled-domains';

const ApplyJobSchema = z.object({
  tenantId: z.string().uuid(),
  mappingId: z.string().uuid(),
  naturalKeyHash: z.string().min(1),
  /** The `apply_receipt` row the API created; this job owns its outcome. */
  receiptId: z.string().uuid(),
});

// Its pools, from the one module that builds a per-tenant task's (0138 T1):
// the tenant pool on APP_DATABASE_URL, app_user, under row security, and the
// audit key's pool of one on the owner's URL. It points this process's sinks
// too: the operator's log page (0129 T1) at the tenant pool, the audit lines
// (0129 T4) at the key's pool, the one read app_user may not make.
const { tenant: pool } = openTaskPools();

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
const DOMAINS = DISCOVERY_DOMAINS;

/** Branched per literal, for the same overload-resolution reason as the deletion job. */
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
    case 'task': {
      const d = await buildDomainDepsFromMapping(pool, tenantId, mappingId, 'task');
      return { ledger: d.ledger, target: d.target as unknown, close: d.close };
    }
  }
}

export const runApplyRelocationTask = schemaTask({
  id: 'run-apply-relocation',
  schema: ApplyJobSchema,
  run: leavesAReference('run-apply-relocation', async (payload) => {
    const { tenantId, mappingId, naturalKeyHash, receiptId } = payload;
    log.info(
      `[run-apply-relocation] ${mappingId}: item ${naturalKeyHash.slice(0, 12)} (receipt ${receiptId})`,
    );

    try {
      // The flag is read FRESH, from the mapping row, at execution time — a
      // queue hop is a window, and the mapping being switched off in that
      // window must win.
      const allowRows = await withTenant(pool, tenantId, (db) =>
        db
          .select({
            allow: schemaPg.mailboxMapping.allowApplyDeletions,
            prefix: schemaPg.mailboxMapping.targetFolderPrefix,
          })
          .from(schemaPg.mailboxMapping)
          .where(eq(schemaPg.mailboxMapping.id, mappingId)),
      );
      const allowApplyDeletions = allowRows[0]?.allow === true;
      // Under a prefix the copy lives at prefix/collection while the ledger
      // records the SOURCE collection — the removal must open the mailbox the
      // copy is actually in. Same fresh read as the flag, same reason.
      const targetFolderPrefix = allowRows[0]?.prefix ?? undefined;

      // Only the domains the owner SELECTED are probed — a domain's deps
      // builder needs that domain's connector config, and on a mapping
      // without it, it throws (0018 T5).
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
          if (!row) continue;

          outcome = await applyRelocation(
            {
              tenantId: tenantId as TenantId,
              mappingId: mappingId as MappingId,
              domain,
              ledger: deps.ledger,
              target: deps.target,
              allowApplyDeletions,
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
        await landReceipt(tenantId, receiptId, { state: 'applied', kind: outcome.kind });
        log.info(
          `[run-apply-relocation] ${mappingId}: removed the OLD copy of ` +
            `${naturalKeyHash.slice(0, 12)} (${outcome.kind}) — the same bytes remain under ` +
            'the key the source moved it to.',
        );
        return { receiptId, applied: true, kind: outcome.kind };
      }

      await landReceipt(tenantId, receiptId, {
        state: 'refused',
        code: outcome.code,
        reason: outcome.reason,
      });
      log.info(
        `[run-apply-relocation] ${mappingId}: refused ${naturalKeyHash.slice(0, 12)} (${outcome.code})`,
      );
      return { receiptId, applied: false, code: outcome.code };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`[run-apply-relocation] ${mappingId}: job failed: ${message}`);
      await landReceipt(tenantId, receiptId, { state: 'failed', error: message });
      throw err;
    }
  }),
});
