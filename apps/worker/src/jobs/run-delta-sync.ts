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
import { budgetPauseToReason } from '@openmig/shared';
import { mappingStillRuns, taskErrorFor } from './stopping-a-pass.ts';
import type { TenantId, MappingId, BudgetPause, DeadlinePause } from '@openmig/shared';
import { buildDepsFromMapping, buildDomainDepsFromMapping } from '@openmig/orchestration/build-deps-from-mapping';
import { enabledDomains, describeAbsentDomains } from '@openmig/orchestration/enabled-domains';
import {
  withTenant,
  PgMigrationStatusStore,
  RunStore,
} from '@openmig/ledger';
import { PgBytesMovedStore } from '@openmig/managed';
import * as schemaPg from '@openmig/ledger/schema-pg';
import { log, passDeadlineFrom } from '@openmig/shared';

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
const SYNC_DOMAINS = ['file', 'email', 'calendar', 'contact', 'task'] as const;

const DeltaSyncJobSchema = z.object({
  tenantId: z.string().uuid(),
  mappingId: z.string().uuid(),
  domains: z.array(z.enum(SYNC_DOMAINS)).optional(),
  /**
   * Scan from the beginning instead of from the stored cursor — `true` for
   * every domain this pass runs, or a LIST to pick which.
   *
   * ## Why this exists at all
   *
   * There used to be a second task, `run-full-sync`, whose whole difference
   * from this one was that it passed no cursor store. Everything else about
   * it was this file, minus every improvement made since: no per-domain
   * `migration_status` rows, no pause handling, no deadline, no failure
   * category — and, because it called `runShadowPass` directly rather than
   * looping the domains, **it synced MAIL AND NOTHING ELSE**. A customer who
   * pressed a full re-sync on a mapping carrying calendars, contacts, files
   * and tasks got their mail copied and a success report. That is the same
   * defect `resolveDiscoveryJob` records from 2026-09-07, one layer down: the
   * mail path mistaken for the whole product.
   *
   * One job, one option. The cursors were the only real difference.
   *
   * ## Why a LIST and not a flag
   *
   * The operational question is almost never "redo everything". It is "tasks
   * came out wrong, redo those" — and a whole-mapping rescan to fix one
   * domain re-reads a mailbox that was already right, against a source with a
   * daily byte ceiling (workplan 0090) that the re-read spends for nothing.
   *
   * ## What it does NOT do
   *
   * It does not reset the stored cursors (owner's decision, 2026-09-08: "that
   * is a different decision"). `cursors` is the STORE, so withholding it makes
   * the pass both read no cursor and write none — the saved position is left
   * exactly where it was, and the next ordinary pass resumes from it. A full
   * scan is a thing this pass does, not a thing it leaves behind.
   */
  forceFullScan: z.union([z.boolean(), z.array(z.enum(SYNC_DOMAINS))]).optional(),
});

type DeltaSyncJobPayload = z.infer<typeof DeltaSyncJobSchema>;

// Database connection from environment
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

// Create a persistent pool for jobs
const pool = new Pool({ connectionString: DATABASE_URL });

// NOTHING ABOUT BILLING LIVES HERE ANY MORE (workplan 0121 T3).
//
// This file has shed three generations of it. First a `PRICING` literal, which
// duplicated the API's copy so two numbers in two packages had to agree. Then
// `resolveTenantPricing` plus two `usage_metric` upserts, which fixed that and
// left a billing write inside the per-domain `try` — where a constraint or an
// exhausted pool was reported to the customer as their mail failing to
// migrate. Now neither: compute DERIVES from the `run` row this task already
// opens and closes, so a pass records what it did and prices nothing.
//
// What it still owes billing is one field: `domainSeconds` in `run.stats`,
// which is where the per-domain grain went when the per-domain rows left.

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

    /**
     * Does THIS domain scan from the beginning this pass?
     *
     * Withholding `cursors` is the whole mechanism: the domain sync reads a
     * previous position only `if (cursors)` and saves one only `if (cursors)`,
     * so a full scan reads everything and leaves the saved position untouched.
     */
    const scansFromTheBeginning = (domain: string): boolean =>
      typedPayload.forceFullScan === true ||
      (Array.isArray(typedPayload.forceFullScan) && typedPayload.forceFullScan.includes(
        domain as (typeof SYNC_DOMAINS)[number],
      ));

    /**
     * WHEN THIS PASS STOPS TAKING NEW WORK.
     *
     * Computed once, here, and shared by every domain — not per domain. Five
     * domains each given the whole budget is five times the budget, and the
     * runner's kill does not care how the time was divided. What the deadline
     * bounds is THIS RUN.
     *
     * From now rather than from the run row's `started_at`: the difference is
     * a database round trip, and anchoring to the later of the two is the
     * direction that runs OVER the budget.
     */
    const deadline = passDeadlineFrom(Date.now());

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

    /**
     * Seconds per domain for THIS run, closed over by the domain loop and
     * handed to `finishRun` below.
     *
     * The per-domain grain compute used to have when it was upserted per
     * domain per pass. It rides in `run.stats` — a jsonb on a row that is
     * written regardless — so keeping it costs no rows, and
     * `deriveComputeForPeriod` can fold it in the database with
     * `jsonb_each_text` rather than reading a month of runs into a process.
     */
    const domainSeconds: Record<string, number> = {};

    /**
     * The run row closes EXACTLY ONCE, whichever way this task leaves.
     *
     * It used to close on the success path and in the catch, with no net
     * between them — and a `run` row left at `running` is not merely untidy:
     * `managed-sync-tick` skips any mapping that has one, so the mapping stops
     * being enqueued at all. Silently, and for ever, because nothing reaps a
     * stale row (retention deliberately excludes `running`).
     *
     * BE HONEST ABOUT WHAT THIS COVERS. A `finally` runs when the task returns
     * or throws — including an abort that unwinds as an exception. It does NOT
     * run when the process is killed outright, which is what a `maxDuration`
     * kill or an OOM does. That case is why the soft deadline exists (so the
     * kill is not reached) AND why `managed-sync-tick` now treats a long-stale
     * `running` row as not running. Three layers, because the cheap two do not
     * cover the case that actually wedged a mapping.
     */
    let runClosed = false;
    const closeRun = async (outcome: 'succeeded' | 'failed', errors: number): Promise<void> => {
      if (runClosed) return;
      runClosed = true;
      try {
        await withTenant(pool, tenantId, async (db) => {
          await new RunStore(db).finishRun(runId, outcome, { itemsProcessed, errors, domainSeconds });
        });
      } catch (finishErr) {
        // Best-effort — never mask the real error with a bookkeeping one.
        log.error(`Failed to close run row as ${outcome}:`, finishErr);
      }
    };

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
        // THE MAPPING MAY HAVE BEEN PAUSED SINCE THIS RUN WAS ENQUEUED.
        //
        // The tick never enqueues a paused mapping, but a run already in the
        // queue — or already copying — knows nothing of the PATCH that paused
        // it. Re-read between domains, so a pause pressed during the contact
        // pass is honoured before the file pass starts rather than an hour
        // later when this run's deadline arrives. Between domains and not
        // per item: each domain pass already stops itself at its own
        // deadline, and the tick will not start another.
        if (!(await mappingStillRuns(pool, tenantId, mappingId))) {
          const line = `pass stopped before ${domain}: this migration is no longer active (paused or finished) — nothing failed, the next pass continues from the cursors when it is resumed`;
          log.info(`[delta-sync] ${line}`);
          await withTenant(pool, tenantId, async (db) => {
            await new RunStore(db).logEvent(tenantId, runId, 'info', line, { domain });
          });
          break;
        }

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

          // What the metering below bills — see the comment there for why the
          // pass measures itself rather than reading a window back off the
          // status row. Taken after the row is opened so the two agree.
          const domainPassStartedAt = new Date();

          // Whether this domain rescans from scratch — per domain, so "redo the
          // tasks" does not re-read a mailbox that was already right.
          const fullScan = scansFromTheBeginning(domain);

          // Build + run + release the deps' pool per domain. Literal domain
          // args pick the right overload; the finally never leaks the pool.
          let result: {
            created: number;
            skipped: number;
            firstCopyBytes?: number;
            budgetPause?: BudgetPause;
            deadlinePause?: DeadlinePause;
          };
          if (domain === 'email') {
            // SECURITY: Build deps with tenant scoping (RLS enforced).
            const deps = await buildDepsFromMapping(pool, tenantId, mappingId);
            try {
              const pass = await runShadowPass({
                ...deps,
                deadline,
                ...(fullScan ? { cursors: undefined } : {}),
              });
              result = {
                created: pass.created,
                skipped: pass.skipped,
                ...(pass.budgetPause ? { budgetPause: pass.budgetPause } : {}),
                ...(pass.deadlinePause ? { deadlinePause: pass.deadlinePause } : {}),
                ...(pass.firstCopyBytes !== undefined
                  ? { firstCopyBytes: pass.firstCopyBytes }
                  : {}),
              };
            } finally {
              await deps.close();
            }
          } else if (domain === 'calendar') {
            const deps = await buildDomainDepsFromMapping(pool, tenantId, mappingId, 'calendar');
            try {
              result = await runCalendarSync({ ...deps, deadline, ...(fullScan ? { cursors: undefined } : {}) });
            } finally { await deps.close(); }
          } else if (domain === 'contact') {
            const deps = await buildDomainDepsFromMapping(pool, tenantId, mappingId, 'contact');
            try {
              result = await runContactSync({ ...deps, deadline, ...(fullScan ? { cursors: undefined } : {}) });
            } finally { await deps.close(); }
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
            try {
              result = await runTaskSync({ ...deps, deadline, ...(fullScan ? { cursors: undefined } : {}) });
            } finally { await deps.close(); }
          } else if (domain === 'file') {
            const deps = await buildDomainDepsFromMapping(pool, tenantId, mappingId, 'file');
            // Captured BEFORE the pass: ADR-0031's survived-a-pass gate keeps
            // a move this pass records from being auto-applied by this pass.
            const passStartedAt = new Date().toISOString();
            try {
              result = await runFileSync({ ...deps, deadline, ...(fullScan ? { cursors: undefined } : {}) });
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

          /**
           * A PAUSED DOMAIN IS NOT A COMPLETED ONE.
           *
           * `markCompleted` says so in its own comment — it is "the one state
           * that positively asserts the domain finished", which is why it
           * clears `lastError` on that basis. A domain that stopped at the
           * day's byte ceiling or at this pass's deadline has NOT finished:
           * its cursors are exactly where they were and the next pass carries
           * on from them, so calling it completed would put a "last synced"
           * time on the customer's screen for a migration still half-copied.
           *
           * It stays `in_progress`, which is literally true — the domain is in
           * progress ACROSS PASSES — and the next pass that does finish it
           * marks it completed then.
           *
           * The byte ceiling has been reaching this line since 0090 T4 with
           * nobody reading its pause: `budgetPause` is produced by the loop,
           * carried through the result, and consumed by nothing. So a mail
           * pass that stopped at Gmail's daily ceiling was marked completed
           * and logged "N created, M skipped" as though it had finished the
           * mailbox. Handling only the deadline here would have added a
           * second silence beside the first.
           */
          const pause = result.deadlinePause
            ? {
                why:
                  `stopped at this pass's own deadline after ${result.deadlinePause.ranForMs}ms` +
                  (result.deadlinePause.collectionsNotReached
                    ? `, with ${result.deadlinePause.collectionsNotReached} collection(s) not reached`
                    : ''),
                detail: { deadlinePause: result.deadlinePause },
              }
            : result.budgetPause
              ? {
                  why:
                    `stopped at the day's download budget for ${result.budgetPause.provider} ` +
                    `(${result.budgetPause.spentBytes} of ${result.budgetPause.ceilingBytes} bytes)` +
                    (result.budgetPause.windowResetsAt
                      ? `, which resets at ${result.budgetPause.windowResetsAt}`
                      : ''),
                  detail: { budgetPause: result.budgetPause },
                }
              : undefined;

          if (!pause) {
            await withTenant(pool, tenantId, async (db) => {
              await new PgMigrationStatusStore(db).markCompleted(tenantId, mappingId, domain);
            });
          } else {
            /**
             * The customer's half of the same fact — but only for the ceiling.
             *
             * A deadline pause happens on EVERY pass of a large migration by
             * design, so putting it on the customer's screen would train
             * people to scroll past a notice that is then in the way on the
             * day the ceiling or an operator hold fires. It is reported in
             * full in the run log below, where an engineer looks. The ceiling
             * is the opposite: hours long, invisible, and indistinguishable
             * from a dead migration.
             */
            if (result.budgetPause) {
              const reason = budgetPauseToReason(result.budgetPause);
              await withTenant(pool, tenantId, async (db) => {
                await new PgMigrationStatusStore(db).markPaused(
                  tenantId,
                  mappingId,
                  domain,
                  reason,
                );
              });
            }
            // And on the run, in the words the reader needs: WHICH clock ran
            // out, and that nothing failed. 'info' rather than 'warn' — a
            // scheduled pause is the system working, and colouring it as a
            // problem is how an owner comes to distrust a migration that is
            // fine (hard rule 9 cuts both ways).
            await withTenant(pool, tenantId, async (db) => {
              await new RunStore(db).logEvent(
                tenantId,
                runId,
                'info',
                `${domain}: ${pause.why}. Nothing failed and nothing is owed a retry; the ` +
                  'cursors stayed where they are and the next scheduled pass continues from them.',
                { domain, ...pause.detail },
              );
            });
          }
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
          // "completed" only when it did. The counts are the same either way —
          // the pass really copied them — but a line that says a paused domain
          // completed is the same untruth as the status row would have been,
          // just somewhere a customer cannot see it, which makes it worse to
          // debug rather than better.
          log.info(
            `${domain} sync ${pause ? 'paused' : 'completed'}: ` +
              `${result.created} created, ${result.skipped} skipped`,
          );
          await withTenant(pool, tenantId, async (db) => {
            await new RunStore(db).logEvent(tenantId, runId, 'info',
              `${domain}: ${result.created} created, ${result.skipped} skipped`,
              { domain, created: result.created, skipped: result.skipped });
          });

          /**
           * Where this domain's pass spent its wall time — recorded, not
           * metered (workplan 0121 T3).
           *
           * ## Nothing is written to `usage_metric` any more
           *
           * Two upserts used to happen HERE, inside this `try`, one line above
           * the `catch` below that logs `Domain <domain> sync failed` and
           * calls `markFailed`. So a billing write that threw — a constraint,
           * an exhausted pool, a lock — was reported to the customer as their
           * mail migration failing. A billing concern could break a migration.
           *
           * Compute now DERIVES from the `run` row this task already opens and
           * closes (`deriveComputeForPeriod`), the way storage and egress
           * already derive from the `item` ledger. There is no write, so there
           * is no failure mode, no row growth, and no second record of one
           * fact that could disagree with the first.
           *
           * What is kept is the GRAIN. A run covers every domain of a mapping,
           * so its duration alone cannot say where the time went — and the
           * owner asked for exactly that, to judge whether the pricing is
           * fair. These seconds ride into `run.stats` at `finishRun`, which is
           * one jsonb field on a row that exists regardless: the per-domain
           * split at ZERO extra rows.
           */
          domainSeconds[domain] =
            (domainSeconds[domain] ?? 0) +
            (Date.now() - domainPassStartedAt.getTime()) / 1000;
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

      await closeRun('succeeded', 0);

      return {
        success: true,
        tenantId: typedPayload.tenantId,
        mappingId: typedPayload.mappingId,
        runId,
      };
    } catch (error) {
      // Close the run row as failed so history shows the failure instead of a
      // row stuck in `running` forever.
      await closeRun('failed', 1);
      // A deliberate stop fails ONCE; everything else still retries. The rule
      // and the reason are on `taskErrorFor`.
      throw taskErrorFor(error);
    } finally {
      // The net. A no-op on both paths above, and the only thing standing
      // between an unexpected exit and a mapping that never syncs again.
      // Recorded as failed rather than succeeded: leaving by a route this
      // function does not know about is not a success, and a run wrongly
      // called failed costs a re-list the ledger makes free, while one
      // wrongly called successful costs the truth.
      await closeRun('failed', 1);
    }
  },
});
