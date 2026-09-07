// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Delta Sync Job
 *
 * Performs an incremental sync of changes since the last sync.
 * This job is typically run on a frequent schedule (e.g., every 5-15 minutes).
 *
 * Trigger: Scheduled (cron)
 */

import { z } from 'zod';
import { schemaTask, queue } from '@trigger.dev/sdk';
import { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import {
  autoApplyRelocations,
  runShadowPass,
  runCalendarSync,
  runContactSync,
  runFileSync,
  runTaskSync,
  type FileSyncDeps,
  failureSideOf,
} from '@openmig/core';
import type { TenantId, MappingId } from '@openmig/shared';
import { buildDepsFromMapping, buildDomainDepsFromMapping } from '@openmig/orchestration/build-deps-from-mapping';
import { enabledDomains, describeAbsentDomains } from '@openmig/orchestration/enabled-domains';
import {
  withTenant,
  PgMigrationStatusStore,
  RunStore,
} from '@openmig/ledger';
import { recordComputeForRun, recordApiCallForRun, resolveTenantPricing, PgBytesMovedStore } from '@openmig/managed';
import * as schemaPg from '@openmig/ledger/schema-pg';
import { log } from '@openmig/shared';

/**
 * ADR-0031 (accepted 2026-08-16): apply open relocations unattended, after a
 * completed file pass, on mappings that opted in.
 *
 * The flags are read FRESH from the mapping row at execution time — the pass
 * is a window, and the mapping being switched off during it must win. All of
 * the deciding happens in core's `autoApplyRelocations` (the four ADR gates in
 * front of the same `applyRelocation` a human's button presses); this function
 * is the managed edition's attribution half: every removal lands an
 * `apply_receipt` row (action `relocation`, so the Moves screen answers from
 * it like any other apply) and an `audit_log` row, both naming
 * `system:auto-apply` — never a human who did not act.
 */
async function autoApplyOpenRelocations(
  tenantId: string,
  mappingId: string,
  runId: string,
  deps: Pick<FileSyncDeps, 'ledger' | 'target'>,
  passStartedAt: string,
): Promise<void> {
  const rows = await withTenant(pool, tenantId, (db) =>
    db
      .select({
        auto: schemaPg.mailboxMapping.autoApplyRelocations,
        allow: schemaPg.mailboxMapping.allowApplyDeletions,
        prefix: schemaPg.mailboxMapping.targetFolderPrefix,
      })
      .from(schemaPg.mailboxMapping)
      .where(eq(schemaPg.mailboxMapping.id, mappingId)),
  );
  if (rows[0]?.auto !== true) return;

  const report = await autoApplyRelocations(
    {
      tenantId: tenantId as TenantId,
      mappingId: mappingId as MappingId,
      domain: 'file',
      ledger: deps.ledger,
      target: deps.target,
      allowApplyDeletions: rows[0]?.allow === true,
      autoApplyRelocations: true,
      ...(rows[0]?.prefix ? { targetFolderPrefix: rows[0].prefix } : {}),
      onApplied: async ({ naturalKeyHash, kind }) => {
        await withTenant(pool, tenantId, async (db) => {
          // The receipt only: the audit row is written by core itself now
          // (workplan 0048), one writer for both editions.
          await db.insert(schemaPg.applyReceipt).values({
            tenantId,
            mappingId,
            naturalKeyHash,
            action: 'relocation',
            state: 'applied',
            finishedAt: new Date(),
            kind,
            reason: 'auto-applied by system:auto-apply (ADR-0031; this mapping opted in)',
          });
        });
      },
    },
    passStartedAt,
  );

  // The run log is where an owner reads what a pass did; silence here would
  // be exactly the silent tidying ADR-0031 forbids.
  const line = report.stopped
    ? `relocation auto-apply: ${report.considered} open, 0 applied — stopped: ${report.stopped}`
    : `relocation auto-apply: ${report.applied.length} old copies removed automatically ` +
      `(system:auto-apply), ${report.leftForReview.length} left for review`;
  await withTenant(pool, tenantId, async (db) => {
    await new RunStore(db).logEvent(tenantId as TenantId, runId, 'info', line, {
      domain: 'file',
      autoApplied: report.applied.length,
      leftForReview: report.leftForReview.length,
    });
  });
}

// Job input schema
const DeltaSyncJobSchema = z.object({
  tenantId: z.string().uuid(),
  mappingId: z.string().uuid(),
  domains: z.array(z.enum(['file', 'email', 'calendar', 'contact', 'task'])).optional(),
});

type DeltaSyncJobPayload = z.infer<typeof DeltaSyncJobSchema>;

// Database connection from environment
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

// Create a persistent pool for jobs
const pool = new Pool({ connectionString: DATABASE_URL });

// No pricing literal here any more. This file used to carry
// `const PRICING = { computePricePerHour: 5 }` under a "should come from
// config/env in production" comment, while the API invoiced from its own
// separate copy — two numbers that must agree, in two packages, either of
// which could be changed alone. Metering now prices each pass at the tenant's
// own agreed rates via resolveTenantPricing (@openmig/managed), which is the
// same function the invoice uses.

/**
 * Get current billing period dates
 */
function getCurrentPeriod(): { periodStart: string; periodEnd: string } {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-11
  
  const periodStart = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month + 1, 0).getDate();
  const periodEnd = `${year}-${String(month + 1).padStart(2, '0')}-${lastDay}`;
  
  return { periodStart, periodEnd };
}

// Concurrency 1, partitioned by `concurrencyKey: mappingId` at trigger time
// (the sync tick sets it): one running delta sync per mapping, ever — a slow
// pass serializes the next one instead of overlapping it (0022 T2).
const deltaSyncQueue = queue({ name: 'delta-sync', concurrencyLimit: 1 });

// Register the job with Trigger.dev
export const runDeltaSync = schemaTask({
  id: 'run-delta-sync',
  description: 'Delta Sync',
  schema: DeltaSyncJobSchema,
  queue: deltaSyncQueue,
  run: async (payload: unknown, context) => {
    // Type assertion since schemaTask validates the payload
    const typedPayload = payload as DeltaSyncJobPayload;
    
    // SECURITY: Fail closed if tenantId missing
    if (!typedPayload.tenantId) {
      throw new Error('tenantId is required in job payload');
    }

    log.info('Starting delta sync', {
      tenantId: typedPayload.tenantId,
      mappingId: typedPayload.mappingId,
      domains: typedPayload.domains,
    });

    const tenantId = typedPayload.tenantId as TenantId;
    const mappingId = typedPayload.mappingId as MappingId;
    // No explicit domain list means "the mapping's OWN selection", never "all
    // four" — scope_selection is the owner's call, and enabledDomains is the
    // same query the sync tick uses, so a manual run and a scheduled one
    // cannot disagree (the #207 lesson, relearned live 2026-08-11: the API's
    // "run now" enqueue passes no domains, and the old all-four default built
    // calendar DAV deps from an email-only mapping's IMAP connection).
    // Resolved even when the caller named its own domains, because the run log
    // below has to tell "the owner did not select this" apart from "this run
    // was asked for less", and only scope_selection knows which is which.
    const selected = await enabledDomains(pool, tenantId, mappingId);
    const domains = typedPayload.domains ?? [...selected];
    const { periodStart, periodEnd } = getCurrentPeriod();

    // Open the run-ledger row up front so an in-flight run is visible in the UI
    // and a crash leaves a `running` row rather than no trace at all.
    // Absent rather than wrong if the shape ever changes again: an absent
    // handle degrades to the age-based path, a wrong one points the quiesce at
    // somebody else's run.
    const contextRunId = (context as { ctx?: { run?: { id?: unknown } } } | undefined)?.ctx?.run
      ?.id;
    const orchestratorRef = typeof contextRunId === 'string' ? contextRunId : undefined;
    const runId = await withTenant(pool, tenantId, async (db) =>
      new RunStore(db).startRun({
        tenantId,
        mappingId,
        kind: 'incremental',
        trigger: 'schedule',
        // The orchestrator's own id for this run. It used to be left unset —
        // "wire it when the v4 task model lands" — and v4 is what we run now
        // (`ctx.run.id`, read from @trigger.dev/core's TaskRunContext rather
        // than guessed).
        //
        // It is not bookkeeping. Without a handle, a row that says `running`
        // is an unfalsifiable claim: the erasure quiesce (0085 T8) cannot ask
        // whether the process behind it still exists, so it can only wait, and
        // a row left behind by a killed worker blocks a promised erasure for
        // ever. This is what makes the question answerable.
        ...(orchestratorRef ? { orchestratorRef } : {}),
      }),
    );

    let itemsProcessed = 0;

    try {
      if (domains.length === 0) {
        // Mirrors the tick's rule: no scope_selection rows means "not
        // selected", never "default to everything". Say so in the run log
        // rather than closing a silent empty success.
        await withTenant(pool, tenantId, async (db) => {
          await new RunStore(db).logEvent(tenantId, runId, 'info',
            'no domains are selected for this mapping (scope_selection is empty) — nothing to sync');
        });
      }

      // Account for the domains that are NOT about to run, before any of them
      // do. A run log that lists only what ran leaves the absences unexplained
      // (see describeAbsentDomains).
      for (const line of describeAbsentDomains(selected, domains)) {
        await withTenant(pool, tenantId, async (db) => {
          await new RunStore(db).logEvent(tenantId, runId, 'info', line);
        });
      }
      for (const domain of domains) {
        log.info(`Running delta sync for domain: ${domain}`);

        try {
          // EVERY domain opens and closes its own migration_status row, email
          // included. That row is what the mapping list's "last sync" column
          // reads and what the metering below prices, and until 2026-08-11 the
          // email branch wrote neither: a comment here claimed
          // buildDepsFromMapping managed the email status itself, which was
          // simply not true (nothing in @openmig/core or the ledger touches
          // that table). Live on the Spark, an email-only mapping syncing
          // cleanly every 15 minutes reported "last sync: 9 days ago" —
          // the run history and the mapping list disagreeing about the same
          // passes, with the stale one shown on the screen an owner checks
          // first. `initDomainStatus` is idempotent and makes the row exist
          // before markInProgress, whose UPDATE would otherwise hit nothing.
          await withTenant(pool, tenantId, async (db) => {
            const status = new PgMigrationStatusStore(db);
            await status.initDomainStatus(tenantId, mappingId, domain);
            await status.markInProgress(tenantId, mappingId, domain);
          });

          // Build + run + release the deps' pool per domain. Literal domain
          // args pick the right overload; the finally never leaks the pool.
          let result: { created: number; skipped: number; firstCopyBytes?: number };
          if (domain === 'email') {
            // SECURITY: Build deps with tenant scoping (RLS enforced).
            const deps = await buildDepsFromMapping(pool, tenantId, mappingId);
            try {
              const pass = await runShadowPass(deps);
              result = {
                created: pass.created,
                skipped: pass.skipped,
                ...(pass.firstCopyBytes !== undefined
                  ? { firstCopyBytes: pass.firstCopyBytes }
                  : {}),
              };
            } finally {
              await deps.close();
            }
          } else if (domain === 'calendar') {
            const deps = await buildDomainDepsFromMapping(pool, tenantId, mappingId, 'calendar');
            try { result = await runCalendarSync(deps); } finally { await deps.close(); }
          } else if (domain === 'contact') {
            const deps = await buildDomainDepsFromMapping(pool, tenantId, mappingId, 'contact');
            try { result = await runContactSync(deps); } finally { await deps.close(); }
          } else if (domain === 'task') {
            // The managed half of the seventh fan-out (workplan 0113). This
            // file had the same bare `else` as orchestration's runOneDomain,
            // and THIS is the one that ran on the owner's Spark: the task
            // domain built file deps, ran runFileSync, copied nothing, and was
            // marked completed. The two dispatchers are separate code with
            // identical shape, so a fix to one is not a fix to the other —
            // `a-domain-the-dispatchers-forgot.unit.test.ts` now holds them
            // together.
            const deps = await buildDomainDepsFromMapping(pool, tenantId, mappingId, 'task');
            try { result = await runTaskSync(deps); } finally { await deps.close(); }
          } else if (domain === 'file') {
            const deps = await buildDomainDepsFromMapping(pool, tenantId, mappingId, 'file');
            // Captured BEFORE the pass: ADR-0031's survived-a-pass gate keeps
            // a move this pass records from being auto-applied by this pass.
            const passStartedAt = new Date().toISOString();
            try {
              result = await runFileSync(deps);
              await autoApplyOpenRelocations(tenantId, mappingId, runId, deps, passStartedAt);
            } finally { await deps.close(); }
          } else {
            // NOT a fallback — a refusal, and the managed twin of the same
            // line in orchestration.runOneDomain. This chain used to END at
            // the file branch with no condition, which is how a task became a
            // file and still reached markCompleted below. A throw leaves the
            // domain in_progress and puts the reason in the run log.
            throw new Error(
              `no sync pass is implemented for the '${domain}' domain — it is in ` +
                'DISCOVERY_DOMAINS and selected for this mapping, but this dispatcher has no ' +
                "branch for it. Add one beside the others rather than letting it fall through " +
                "to another domain's pass.",
            );
          }

          await withTenant(pool, tenantId, async (db) => {
            await new PgMigrationStatusStore(db).markCompleted(tenantId, mappingId, domain);
          });
          // The data axis (0109 T3): this pass's first-copy bytes join the
          // tenant's lifetime meter. Managed-side by construction — the
          // engine's number is a neutral pass statistic; pricing it is this
          // runner's affair (hard rule 5). Zero adds nothing, and a crash
          // before this line under-counts, never double-counts: the ledger
          // makes the retried pass re-create nothing.
          const firstCopyBytes = result.firstCopyBytes ?? 0;
          if (firstCopyBytes > 0) {
            await withTenant(pool, tenantId, async (db) => {
              await new PgBytesMovedStore(db).add(tenantId, firstCopyBytes);
            });
          }
          itemsProcessed += result.created + result.skipped;
          log.info(`${domain} sync completed: ${result.created} created, ${result.skipped} skipped`);
          await withTenant(pool, tenantId, async (db) => {
            await new RunStore(db).logEvent(tenantId, runId, 'info',
              `${domain}: ${result.created} created, ${result.skipped} skipped`,
              { domain, created: result.created, skipped: result.skipped });
          });

          // Metering (all domains): record compute + one sync op from the run's
          // migration_status timing, priced at THIS TENANT's agreed rates
          // (pinned when the tenant was first billed — the operator's template
          // moves on, an existing customer's prices do not). Guarded — skips
          // cleanly if status is absent.
          await withTenant(pool, tenantId, async (db) => {
            const statusStore = new PgMigrationStatusStore(db);
            const statusList = await statusStore.getStatus(tenantId, mappingId);
            const domainStatus = statusList.find((s) => s.domain === domain);
            if (domainStatus && domainStatus.completedAt) {
              await recordComputeForRun(db, {
                tenantId,
                mappingId,
                domain,
                startedAt: new Date(domainStatus.startedAt),
                completedAt: new Date(domainStatus.completedAt),
                periodStart,
                periodEnd,
              }, await resolveTenantPricing(db, tenantId));
              await recordApiCallForRun(db, { tenantId, mappingId, domain, periodStart, periodEnd });
            }
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          log.error(`Domain ${domain} sync failed:`, errorMessage);
          // Record the failure verbatim in the run log (hard rule 9) before
          // surfacing it. Best-effort: a logging failure must not replace the
          // real error with a logging error.
          try {
            await withTenant(pool, tenantId, async (db) => {
              await new RunStore(db).logEvent(tenantId, runId, 'error',
                `${domain} sync failed: ${errorMessage}`, { domain });
            });
          } catch (logErr) {
            log.error('Failed to write run event:', logErr);
          }
          // Mark the domain failed (best-effort) before surfacing the error.
          // Email is no longer excluded: it now owns its status row like every
          // other domain, and a failed email pass that left the row reading
          // `in_progress` forever would be the same silence this job just
          // stopped telling about "last sync".
          try {
            await withTenant(pool, tenantId, async (db) => {
              // With the side the pass tagged (0094 T5, second slice) —
              // the same call orchestration's runOneDomain makes.
              await new PgMigrationStatusStore(db).markFailed(
                tenantId,
                mappingId,
                domain,
                errorMessage,
                failureSideOf(error),
              );
            });
          } catch (statusErr) {
            log.error('Failed to mark domain status failed:', statusErr);
          }
          // Re-throw so Trigger.dev records the failure (hard rule 9 — no masking).
          throw error;
        }
      }

      log.info('Delta sync completed successfully');

      await withTenant(pool, tenantId, async (db) => {
        await new RunStore(db).finishRun(runId, 'succeeded', { itemsProcessed, errors: 0 });
      });

      return {
        success: true,
        tenantId: typedPayload.tenantId,
        mappingId: typedPayload.mappingId,
        runId,
      };
    } catch (error) {
      // Close the run row as failed so history shows the failure instead of a
      // row stuck in `running` forever. Best-effort — never mask the real error.
      try {
        await withTenant(pool, tenantId, async (db) => {
          await new RunStore(db).finishRun(runId, 'failed', { itemsProcessed, errors: 1 });
        });
      } catch (finishErr) {
        log.error('Failed to close run row as failed:', finishErr);
      }
      throw error;
    }
  },
});
