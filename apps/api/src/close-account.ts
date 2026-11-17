// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * ENDING AN ACCOUNT, THE ONE WAY IT IS DONE (workplan 0139 T7 (a); 0085 T2 to
 * T8).
 *
 * Three doors end an account. The owner presses Close (`POST
 * /api/tenants/:tenantId/close`). And a tester who asks the operator to close
 * it, as terms §11 lets them, is closed by the operator: at the machine
 * (`operator.sh close`), or on the organisation's support page (`POST
 * /api/support/tenants/:tenantId/close`, 0139 T7 (b)). All three are this
 * function, so they cannot drift: the same dates, the same sentences in both
 * languages, the same grants named, the same passes stopped.
 *
 * What it does, in order:
 *
 * 1. In one transaction, in the organisation's own context: it reads the kinds
 *    this organisation connected (for the grants only they can withdraw,
 *    0085 T4b), closes it (`closeTenant`), writes an audit row naming who
 *    closed it, how, and for an operator the tester's request, and reads the
 *    passes still in flight.
 * 2. After the commit, it asks the orchestrator to stop each of those passes
 *    (0085 T8). A network call never holds the organisation's transaction open,
 *    and an orchestrator that does not answer never fails the close: the
 *    purge's quiesce is the backstop, and it enforces the safety rule.
 * 3. It answers the dates and the sentences.
 *
 * From the commit on, nothing new starts (0085 T2; the owner's report of
 * 2026-09-28). The close does not touch the migrations; everything else reads
 * the organisation's status. The sync tick starts no pass for it, a pass under
 * way stops starting new items within about fifteen seconds and finishes the
 * ones it has begun (it re-reads between data types and, since 2026-09-29,
 * from inside one: `whyThisDataTypeStops`), the credential builders refuse it, and
 * every door that would start work or use the stored access answers 409
 * `account_closed` (`closed-organisation.ts`). A reopen sets the status back,
 * and all of it runs again.
 *
 * WHAT THE CANCEL SEES. Only runs whose rows say `running` or `queued`. A pass
 * has a row only once a runner starts it (`startRun` writes `running`, and
 * nothing writes `queued`), so a pass the tick queued in the minute before the
 * close, or a retry waiting for its next attempt, is not among them. Those
 * stop by themselves: the pass's own stop check reads the close before any
 * credential is built (`organisation_closed`), and a task that builds readers
 * is refused by the builders.
 *
 * AND WHAT IT DOES NOT SEE, WHICH STOPS ITSELF (workplan 0139 T7). Only a sync
 * pass records the orchestrator's reference on its row. A verification (its
 * row is `verification_run`), a confirmation (a `run` row with none) and a
 * discovery (no row at all) had built their readers before the close and read
 * on to their end. Each now asks whether the organisation is still open
 * between its steps (`organisationStillOpen`): a verification before each
 * listing of a target and each sample it downloads, a confirmation before each
 * item it reads, a discovery before each collection. The step in flight
 * finishes and no other begins; a file source's walk of its folder tree comes
 * before the discovery's first question and runs to its end. A sync pass the
 * cancel did not reach still reads to the end of the data type it is on, and
 * stops before the next.
 *
 * `closeTenant` MUST run in the organisation's context. `tenant` is under
 * FORCE ROW LEVEL SECURITY with an UPDATE policy on `app.current_tenant`, so
 * outside it the UPDATE matches nothing and the close reports an organisation
 * that does not exist. `erasure_record` outlives the organisation because it
 * has no foreign key, not because it is written outside the transaction.
 *
 * It never marks a run row cancelled. A cancellation is a request, and the pass
 * may still be writing when it is acknowledged. A row landed here would tell
 * the purge nothing is in flight while something is, which is how a leaving
 * customer's mail is copied twice into their own target. Whoever finishes the
 * pass lands its row: the worker, or the purge's quiesce.
 *
 * THE PASSES IN FLIGHT ARE READ IN THE ORGANISATION'S CONTEXT. The route used
 * to read them on the API's pool with no organisation set, and `run` is under
 * FORCE ROW LEVEL SECURITY: as `app_user` that read saw no rows, so a close in
 * managed never asked the orchestrator to stop anything.
 */

import type { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import { PgLedger, withTenant, type LedgerDriver } from '@openmig/ledger';
import * as schema from '@openmig/ledger/schema-pg';
import { closeTenant, reopenTenant, type CloseWindowDays } from '@openmig/managed';
import {
  accessThatOutlivesErasure,
  erasureNeverTouches,
  erasureScopeText,
  erasureTimeline,
  erasureTimelineText,
  log,
  standingGrantReminders,
  type TenantId,
} from '@openmig/shared';

/** The audit action a close is recorded under, at every door. */
export const ACCOUNT_CLOSED_ACTION = 'tenant.closed';

/** The audit action a reopen is recorded under, at either door. */
export const ACCOUNT_REOPENED_ACTION = 'tenant.reopened';

/** A close, as either door asks for it. */
export interface CloseAccountRequest {
  readonly tenantId: string;
  readonly windowDays: CloseWindowDays;
  /** Who closed it: the owner's subject at their screen, the operator's at theirs or the machine. */
  readonly closedBy: string;
  /**
   * Whose door: the owner's Close (`screen`), or an operator's (`operator`),
   * which is `operator.sh close` and the support page's Close alike. The audit
   * row's actor says who; the reference says because of what.
   */
  readonly via: 'screen' | 'operator';
  /** The tester's request the operator acts on (0139 T7 (a)): a ticket, a date. */
  readonly reference?: string;
  readonly closedAt: Date;
  /** This deployment's backup retention, as the close promises it (0085 T5). */
  readonly backupRetentionDays: number;
}

/** What a close needs from outside the database. */
export interface CloseAccountDeps {
  /** Ask the orchestrator to stop one run, by its orchestrator reference. */
  readonly cancelRun: (orchestratorRef: string) => Promise<void>;
}

/** What either door answers: the dates, the sentences, and what outlives us. */
export async function closeAccount(
  source: Pool | LedgerDriver,
  request: CloseAccountRequest,
  deps: CloseAccountDeps,
) {
  const { tenantId, windowDays, closedAt, backupRetentionDays } = request;

  const closed = await withTenant(source, tenantId, async (db) => {
    // The grants only THEY can remove (0085 T4b), read before closing, from
    // the kinds this organisation connected.
    const kinds = (await db.select({ kind: schema.connection.kind }).from(schema.connection)).map(
      (r) => r.kind,
    );
    const result = await closeTenant(db, tenantId, windowDays, request.closedBy, closedAt, backupRetentionDays);
    await new PgLedger(db).recordAuditEvent(tenantId as TenantId, {
      actor: request.closedBy,
      action: ACCOUNT_CLOSED_ACTION,
      entity: 'tenant',
      detail: {
        windowDays,
        via: request.via,
        ...(request.reference !== undefined ? { reference: request.reference } : {}),
      },
    });
    const inFlight = (await db.execute(sql`
      SELECT id, orchestrator_ref FROM run
       WHERE tenant_id = ${tenantId}::uuid AND status IN ('running', 'queued')
    `)) as unknown as { rows: Array<{ id: string; orchestrator_ref: string | null }> };
    return { kinds, result, inFlight: inFlight.rows };
  });

  // Stop what is already running, after the commit. Best effort, and never a
  // reason to fail the close.
  let passesStopped = 0;
  for (const run of closed.inFlight) {
    if (!run.orchestrator_ref) continue;
    try {
      await deps.cancelRun(run.orchestrator_ref);
      passesStopped++;
    } catch (error) {
      log.warn(
        `[close] could not ask the orchestrator to cancel run ${run.id} ` +
          `(${run.orchestrator_ref}): ${error instanceof Error ? error.message : String(error)}. ` +
          'The erasure quiesce will deal with it before any purge runs.',
      );
    }
  }

  const { kinds, result } = closed;
  // Both dates, and the sentence that explains them. `purgeAfter` alone would
  // be a true statement that reads as a false one: the live database stops
  // holding it that day, and the backups do not (0085 T5).
  const timeline = erasureTimeline({ closedAt, windowDays, backupRetentionDays });
  return {
    status: 'closed' as const,
    purgeAfter: result.purgeAfter.toISOString(),
    windowDays: result.windowDays,
    backupsExpireAt: result.backupsExpireAt.toISOString(),
    backupRetentionDays: result.backupRetentionDays,
    erasureCompletesText: {
      en: erasureTimelineText(timeline, 'en'),
      nl: erasureTimelineText(timeline, 'nl'),
    },
    canReopenUntil: result.windowDays > 0 ? result.purgeAfter.toISOString() : null,
    // How many in-flight passes we asked to stop. Not how many stopped: that is
    // the orchestrator's to confirm, and the purge checks it.
    passesStopped,
    // Kept for callers that already read it. `outlivingAccess` supersedes it
    // and is what new callers should render.
    standingGrants: standingGrantReminders(kinds, 'en'),
    // Everything that keeps working after we have forgotten them: the consents
    // in their providers' consoles AND the app passwords in their own accounts
    // (owner, 2026-08-18). Credentials first: a live app password is a working
    // way in.
    outlivingAccess: {
      en: accessThatOutlivesErasure(kinds, 'en'),
      nl: accessThatOutlivesErasure(kinds, 'nl'),
    },
    // What erasure will NOT do (0085 T6), said at close, which is the moment
    // the customer is deciding.
    neverTouched: {
      en: erasureScopeText('en'),
      nl: erasureScopeText('nl'),
      boundaries: erasureNeverTouches('en'),
    },
  };
}

/** What a close answers. */
export type ClosedAccount = Awaited<ReturnType<typeof closeAccount>>;

/** A reopen, as either door asks for it. */
export interface ReopenAccountRequest {
  readonly tenantId: string;
  /** Who reopened it: the owner's subject, or the operator's. */
  readonly reopenedBy: string;
  /** Whose door: the owner's Reopen (`screen`), or the support page's (`operator`). */
  readonly via: 'screen' | 'operator';
  /** Why an operator reopened it: the request, or the mistake, it answers. */
  readonly reference?: string;
  readonly reopenedAt: Date;
}

/**
 * Undo a close while its window is open, and record who did, at either door
 * (0085 T2; 0139 T7 (b)).
 *
 * `reopenTenant` decides whether it may happen: it refuses an organisation that
 * is not closed, and one whose window has run out, which a window of 0 has from
 * the start. The audit row is written in the same transaction, after it, so a
 * refused reopen records nothing and an allowed one cannot go unrecorded.
 *
 * Nothing is restored by hand: the close left every migration as it was, and
 * everything that starts work reads the organisation's status, which this sets
 * back to `active`.
 */
export async function reopenAccount(
  source: Pool | LedgerDriver,
  request: ReopenAccountRequest,
): Promise<void> {
  const { tenantId } = request;
  await withTenant(source, tenantId, async (db) => {
    await reopenTenant(db, tenantId, request.reopenedAt);
    await new PgLedger(db).recordAuditEvent(tenantId as TenantId, {
      actor: request.reopenedBy,
      action: ACCOUNT_REOPENED_ACTION,
      entity: 'tenant',
      detail: {
        via: request.via,
        ...(request.reference !== undefined ? { reference: request.reference } : {}),
      },
    });
  });
}
