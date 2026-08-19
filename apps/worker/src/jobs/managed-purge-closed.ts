// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Erase the tenants whose window has run out (workplan 0085 T2/T8) — the
 * wiring half.
 *
 * The rules live in `@openmig/managed`'s `offboarding.ts`, which decides what is
 * purged, what survives and why, and tests that against a real database. THIS
 * FILE IS ONLY THE WIRING: the pool, the schedule, the quiesce check and the
 * log line.
 *
 * ## Why it refuses to purge a tenant with a run in flight
 *
 * `item` IS the idempotency ledger. Purging it while a pass is running tells
 * the next pass that nothing has been copied — and the next pass copies it all
 * again, **into the leaving customer's target**. Duplicating the mail of
 * somebody who just asked to be forgotten is the worst outcome this workplan
 * has, so the check is a precondition rather than a nicety, and a tenant that
 * cannot be quiesced is skipped and said out loud rather than forced.
 *
 * Closing already stops the sync tick picking the mapping up (status is no
 * longer `active`), so a run still in flight means one that was already
 * underway.
 *
 * ## Why waiting was not enough on its own (T8's second half)
 *
 * Waiting is right for a pass that is genuinely running. It was also the ONLY
 * thing this job did, and that is the gap: a row saying `running` is a claim by
 * a process that may no longer exist. A worker killed between its last write
 * and its `finishRun` leaves one behind for ever, and this job then skipped
 * that tenant on every hourly attempt, indefinitely, past the date the customer
 * was given (T5) — with a warning and nothing else.
 *
 * So the row is no longer taken at its word. `quiescePlan` in `@openmig/shared`
 * decides from what the ORCHESTRATOR says: finished rows are landed and the
 * purge proceeds, live ones are asked to stop and waited for, and anything we
 * could not ask about blocks — because not knowing is not permission, and
 * duplicating a leaving customer's mailbox is worse than an erasure running
 * late. That asymmetry is the whole design and it is tested in
 * `quiesce.unit.test.ts`.
 */

import { schedules, runs } from '@trigger.dev/sdk';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import * as schemaPg from '@openmig/ledger/schema-pg';
import type { PgDatabase } from '@openmig/ledger';
import { purgeTenant } from '@openmig/managed';
import {
  log,
  summariseRevocations,
  quiescePlan,
  type QuiescingRun,
} from '@openmig/shared';
import { HttpTokenRevoker } from '@openmig/connectors';
import { revokeStoredCredentials } from '@openmig/orchestration/revoke-stored-credentials';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}
const pool = new Pool({ connectionString: DATABASE_URL });
const revoker = new HttpTokenRevoker();

/**
 * T4a's revocation, now shared with the appliance (0085 T9) rather than
 * private to this job — and reading the column that is actually written. It
 * used to read `encrypted_credentials`, which nothing has written for a long
 * time, so every connection reported `no_credential` and Google's revocation
 * never ran. See revoke-stored-credentials.ts.
 */
const revokeCredentials = (tenantId: string) =>
  revokeStoredCredentials(pool, tenantId, revoker);


/** Tenants closed long enough ago that their window has expired. */
interface DueRow {
  readonly id: string;
}

interface LiveRunRow {
  readonly id: string;
  readonly orchestrator_ref: string | null;
  readonly status: 'queued' | 'running';
  readonly since: Date;
}

/**
 * Ask the orchestrator what it actually thinks about each live row.
 *
 * Never throws: an orchestrator we cannot reach is a `unknown` verdict, which
 * `quiescePlan` treats as "do not purge" rather than as "nothing is running".
 * Getting that backwards would turn an outage into a data incident.
 */
async function verdictsFor(rows: readonly LiveRunRow[]): Promise<QuiescingRun[]> {
  return Promise.all(
    rows.map(async (r): Promise<QuiescingRun> => {
      const base = {
        id: r.id,
        orchestratorRef: r.orchestrator_ref,
        status: r.status,
        since: r.since,
      };
      if (!r.orchestrator_ref) return { ...base, verdict: 'unknown' };
      try {
        const remote = await runs.retrieve(r.orchestrator_ref);
        // Both directions identified POSITIVELY, with anything unrecognised
        // falling through to `unknown` — which blocks. `isCompleted` looks like
        // the umbrella flag and reading it alone would be a guess; if it turned
        // out to mean "succeeded", a failed run would read as live and block
        // the erasure for ever, which is the exact bug being fixed here. A
        // status this code has never heard of should make it wait for a person,
        // not decide.
        const stillGoing = remote.isExecuting || remote.isQueued || remote.isWaiting;
        const terminal = remote.isCompleted || remote.isFailed || remote.isCancelled;
        return {
          ...base,
          verdict: stillGoing ? 'live' : terminal ? 'finished' : 'unknown',
        };
      } catch (error) {
        log.warn(
          `[purge] could not ask the orchestrator about run ${r.id} (${r.orchestrator_ref}): ` +
            `${error instanceof Error ? error.message : String(error)}. Treating as unknown, ` +
            'which blocks the purge rather than risking one under a live pass.',
        );
        return { ...base, verdict: 'unknown' };
      }
    }),
  );
}

export const managedPurgeClosed = schedules.task({
  id: 'managed-purge-closed',
  // Hourly, not per-minute: nothing is waiting on this, and an immediate close
  // promises "as soon as the purge next runs" rather than "instantly" for
  // exactly this reason. Off the hour, away from the retention pass.
  cron: '23 * * * *',
  run: async () => {
    const db = drizzle(pool, { schema: schemaPg }) as unknown as PgDatabase;
    const now = new Date();

    const { rows } = await pool.query<DueRow>(
      `SELECT t.id
         FROM tenant t
        WHERE t.status = 'closed' AND t.purge_after IS NOT NULL AND t.purge_after <= $1`,
      [now],
    );

    let purged = 0;
    let skippedRunning = 0;
    let landed = 0;
    let needsAttention = 0;
    const failed: string[] = [];

    for (const row of rows) {
      // What the ledger still calls live, and what the orchestrator says about
      // each. `since` is when it actually started, falling back to when it was
      // created for a row that never did.
      const live = await pool.query<LiveRunRow>(
        `SELECT id, orchestrator_ref, status, COALESCE(started_at, created_at) AS since
           FROM run
          WHERE tenant_id = $1 AND status IN ('running', 'queued')`,
        [row.id],
      );

      const plan = quiescePlan(await verdictsFor(live.rows), now);

      // Ask the live ones to stop. This is the "active" in active quiescing —
      // waiting was all this job did before, and a pass nobody has asked to
      // stop has no reason to.
      for (const runId of plan.cancel) {
        const ref = live.rows.find((r) => r.id === runId)?.orchestrator_ref;
        if (!ref) continue;
        try {
          await runs.cancel(ref);
          log.info(`[purge] asked the orchestrator to cancel run ${runId} (${ref}) for ${row.id}.`);
        } catch (error) {
          log.warn(
            `[purge] could not cancel run ${runId} (${ref}): ` +
              `${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      // Land the rows that cannot be live, with the reason on the row rather
      // than only in this log — whoever reads that run next needs to know why
      // it says cancelled.
      for (const stale of plan.landStale) {
        await pool.query(
          `UPDATE run SET status = 'cancelled', finished_at = now(),
                  stats = COALESCE(stats, '{}'::jsonb) || jsonb_build_object('quiesceReason', $2::text)
            WHERE id = $1`,
          [stale.id, stale.reason],
        );
        landed++;
        log.info(`[purge] ${stale.reason} (run ${stale.id}, tenant ${row.id})`);
      }

      if (!plan.mayPurge) {
        skippedRunning++;
        if (plan.needsAttention) needsAttention++;
        // Loud, because a tenant that never quiesces would otherwise sit past
        // its promised window in silence — and the promise was to the person
        // who asked to be forgotten. `needsAttention` separates the two cases
        // that look identical in a log and are not: waiting for a pass that
        // will end, and blocking on an orchestrator we cannot reach.
        const how = plan.needsAttention
          ? 'BLOCKED WITHOUT KNOWING — the orchestrator could not be asked, so this will not ' +
            'resolve on its own and needs a person'
          : 'still in flight; cancellation requested, will retry next pass';
        log.warn(
          `[purge] tenant ${row.id} is past its erasure window: ${how}. ` +
            plan.blockedBy.join('; '),
        );
        continue;
      }

      try {
        // OUTSIDE the transaction, and BEFORE it: revocation needs the
        // connection rows the purge is about to delete, and it makes network
        // calls that must not hold a database transaction open while a
        // provider decides how long to take.
        const revocations = await revokeCredentials(row.id);

        // One transaction: a half-purged tenant is worse than an un-purged one,
        // because it is neither a customer nor gone and nothing expects it.
        await db.execute(sql`BEGIN`);
        await db.execute(sql`UPDATE tenant SET status = 'deleting' WHERE id = ${row.id}::uuid`);
        const result = await purgeTenant(db, row.id, now, revocations);
        await db.execute(sql`COMMIT`);
        purged++;
        const rev = summariseRevocations(result.revocations);
        // The tenant id is logged because at this point it identifies nothing —
        // the row it named is gone. The erasure record holds only its hash.
        log.info(
          `[purge] erased tenant ${row.id}: ${Object.values(result.counts).reduce((a, b) => a + b, 0)} rows removed, ` +
            `${result.retainedInvoiceIds.length} invoice(s) retained and detached, ` +
            `credentials revoked ${rev.revoked}/${result.revocations.length}.`,
        );
        if (rev.failed > 0) {
          // Warn, not info. A credential we deleted but could not revoke may
          // still be live at the provider, and the customer is the only one who
          // can finish the job — so this is the line that has to be visible
          // when somebody asks what actually happened.
          log.warn(
            `[purge] tenant ${row.id}: ${rev.failed} credential(s) could not be revoked at the provider. ` +
              'Our copy is deleted; the access may still be live until the customer withdraws it. ' +
              'Reasons are in the erasure record.',
          );
        }
      } catch (err) {
        await db.execute(sql`ROLLBACK`).catch(() => undefined);
        failed.push(row.id);
        log.error(`[purge] tenant ${row.id}: erasure failed and was rolled back:`, err);
      }
    }

    const summary = {
      due: rows.length,
      purged,
      skippedRunning,
      landedStale: landed,
      needsAttention,
      failed: failed.length,
    };
    log.info('[purge]', summary);
    return summary;
  },
});
