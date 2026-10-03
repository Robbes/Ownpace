// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The one way this API enqueues a task, and the platform hold and a closed
 * organisation at every door (workplan 0132 T6 (b); 0131 §6 R7 step 4; 0085
 * T2).
 *
 * An operator hold (managed migration 0023, `routes/platform-pause.ts`) is a
 * drain: start nothing new, wait until the tick's log says no pass is still
 * in flight, deploy, lift the hold. The sync tick read it. The eight places
 * here that enqueue on a person's request did not: *Sync now*, a cutover's
 * preparation, a discovery count, the first pass on *Start*, a verification,
 * a deletion or a relocation followed through, and a confirmation pass. So a
 * tester who pressed *Sync now* during a deploy started a pass after the
 * operator had watched the in-flight count reach 0, on tasks about to be
 * replaced.
 *
 * Every enqueue now goes through `enqueueUnlessHeld`. It reads the open hold.
 * While one is open it answers 409 with the hold's sentence and hands back
 * nothing, and the door returns having written and enqueued nothing.
 * Otherwise it hands back the enqueue, which holds the only `tasks.trigger(`
 * in `apps/api/src`. `a-hold-that-holds-every-door.unit.test.ts` sweeps the
 * source for any other.
 *
 * ## Asked before the first write
 *
 * Four doors write before they enqueue. *Start* activates the migration, a
 * verification opens its row, and each apply records a receipt and who
 * ordered it. A refusal after those writes would leave an active migration
 * with no first pass, a row saying `running` with nothing behind it, or a
 * removal recorded as ordered that never was. So those doors ask before their
 * first write, and use the enqueue they are handed afterwards. Every door asks
 * after its own refusals (a migration not found, a grant withdrawn, a gate the
 * ledger shuts), because those still stand once the hold is lifted.
 *
 * ## Joins
 *
 * A press the route itself joins to work already under way enqueues nothing
 * and is not asked: *Start* on a migration already active, a verification
 * already running, an apply whose receipt is still queued, a confirmation
 * already running. Discovery is different. Its join is Trigger.dev's (the
 * idempotency key in `discoveryTriggerOptions`), decided inside the enqueue,
 * so the door asks first, and while a hold is open a discovery press is
 * refused even when it would only have joined a count begun in the last
 * `DISCOVERY_JOIN_WINDOW`. That count still lands. The confirm screen that
 * starts it shows the refusal's sentence under whatever rows arrive, and
 * counts again once it reads the hold lifted (`ConfirmMigration.tsx`).
 *
 * ## The sentence
 *
 * The operator's own words, verbatim (ADR-0024's prose boundary). During the
 * alpha the operator writes them in Dutch when starting the hold (0132 D6, T6
 * step 2). When they typed none, the door says `HELD_DEFAULT`, in English, as
 * this API's other refusals are. The banner above every screen has its own
 * default in the reader's language (`pause.hold.default` in the web app).
 *
 * ## A closed organisation (0085 T2)
 *
 * Closing an organisation stops everything that would start a pass, and these
 * eight doors all would. So the close is read here too, in the same
 * transaction as the hold and before it: 409 `account_closed`, with the
 * sentence that names the close and the day the data is removed
 * (`closed-organisation.ts`), and nothing enqueued or written. The close
 * comes first because it outlasts a hold: once the hold is lifted, the
 * organisation is still closed. A reopen sets it open again, and the next
 * press goes through.
 *
 * ## A read that fails is not "no hold"
 *
 * Hard rule 9. The error goes to the door's own catch, which answers 500. A
 * hold or a close that could not be read must not start the pass it would
 * have stopped.
 *
 * ## A start nobody pressed
 *
 * One start has nobody to answer: a migration that starts by itself when its
 * person's grant lands (`start-when-granted.ts`; ADR-0035's amendment, the
 * owner's answer of 2026-10-03). `enqueueIfFree` asks the same two questions
 * and says which stopped it instead of answering 409, and the migration then
 * stays as it was, for the owner to start.
 */

import type { Response } from 'express';
import type { Pool } from 'pg';
import type { LedgerDriver } from '@openmig/ledger';
import { readOpenPause, readOrganisationClosure } from '@openmig/managed';
import { getTriggerClient } from '@openmig/scheduler';
import { withTenantDb } from './middleware/auth.ts';
import { accountClosedAnswer } from './closed-organisation.ts';

type Trigger = ReturnType<typeof getTriggerClient>['tasks']['trigger'];

/** The SDK's own `tasks.trigger`, handed out only while no hold is open. */
export type Enqueue = (...args: Parameters<Trigger>) => ReturnType<Trigger>;

/** What a held door says when the operator typed no sentence. */
export const HELD_DEFAULT =
  'We have paused copying while we update the platform. Nothing was started. Try again when copying resumes.';

/** The organisation's close and the platform hold, read in one transaction, the close first. */
async function whatStopsAStart(tenantId: string, source: Pool | LedgerDriver) {
  return withTenantDb(tenantId, source, async (db) => ({
    closure: await readOrganisationClosure(db, tenantId),
    hold: await readOpenPause(db),
  }));
}

/**
 * Ask whether the organisation is closed, then the platform hold; answer 409
 * and return null when either stops the press.
 *
 * Otherwise returns the enqueue. The client is built when the enqueue is
 * called, not here, so a deployment without `TRIGGER_SECRET_KEY` still fails
 * where each door already lands that failure on its own row.
 */
export async function enqueueUnlessHeld(
  res: Response,
  tenantId: string,
  source: Pool | LedgerDriver,
): Promise<Enqueue | null> {
  const { closure, hold } = await whatStopsAStart(tenantId, source);
  if (closure) {
    res.status(409).json(accountClosedAnswer(closure));
    return null;
  }
  if (hold) {
    const sentence = hold.message ?? HELD_DEFAULT;
    res.status(409).json({
      error: 'platform_held',
      message: sentence,
      reason: sentence,
      since: hold.startedAt,
    });
    return null;
  }
  return enqueue;
}

/**
 * `enqueueUnlessHeld` for a start nobody pressed: the same two questions, in
 * the same order, with nobody to answer. Hands back the enqueue, or says what
 * stopped it.
 */
export async function enqueueIfFree(
  tenantId: string,
  source: Pool | LedgerDriver,
): Promise<{ readonly enqueue: Enqueue } | { readonly stopped: 'closed' | 'held' }> {
  const { closure, hold } = await whatStopsAStart(tenantId, source);
  if (closure) return { stopped: 'closed' };
  if (hold) return { stopped: 'held' };
  return { enqueue };
}

/** The SDK's own `tasks.trigger`: the one enqueue in this API, handed out only by the two doors above. */
const enqueue: Enqueue = (...args) => getTriggerClient().tasks.trigger(...args);
