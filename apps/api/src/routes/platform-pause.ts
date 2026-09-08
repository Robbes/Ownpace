// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The operator hold: read by anyone, written by an operator (migration 0023).
 *
 * ## Why this is a customer-facing route and not part of the support surface
 *
 * The reading half is FOR the customer. Of the three things that can stop a
 * migration, a hold is the only one they cannot derive from their own screen
 * and cannot wait out predictably — so the sentence that explains it has to
 * reach them, and everything under `/api/support` is deliberately unreachable
 * by anyone but an operator.
 *
 * The writing half lives here rather than there because it is the same
 * resource. Splitting a read and a write over two prefixes to satisfy a
 * naming instinct is how the two drift.
 *
 * ## Nobody is authorised here either
 *
 * The support doctrine, unchanged (`support.ts`): `authenticateSubject`
 * establishes WHO is asking and nothing more; the DATABASE decides what that
 * subject may do. `platform_pause` policies admit the open hold to every
 * signed-in reader and everything else to operators, and the writes carry
 * their own `WHERE EXISTS (platform_operator …)`. A non-operator's POST
 * changes nothing and is answered 404 — an absence, because to the database
 * that is exactly what it is.
 */

import { Router } from 'express';
import type { Response } from 'express';
import type { Pool } from 'pg';
import { withSubject } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import {
  readOpenPause,
  startPlatformPause,
  endPlatformPause,
  listPlatformPauses,
} from '@openmig/managed';
import { authenticateSubject, getDbPool } from '../middleware/auth.ts';
import type { AuthenticatedRequest } from '../types/api.ts';
import { serverFault } from '../server-fault.ts';

const router = Router();

/** The same lazily-resolved handle `support.ts` holds, for the same reason. */
let _dbPool: Pool | LedgerDriver | null = null;
function pool(): Pool | LedgerDriver {
  if (!_dbPool) _dbPool = getDbPool();
  return _dbPool;
}

const noSubject = (res: Response): void => {
  res.status(401).json({ error: 'Unauthorized', message: 'No subject on this request' });
};

/**
 * Is the platform holding, and what did we say about it?
 *
 * `{ held: false }` when it is not — a shape rather than a 404, because "we
 * asked and the answer is no" and "we could not ask" must not look the same
 * to the screen rendering it.
 */
router.get('/', authenticateSubject, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return noSubject(res);
    const hold = await withSubject(pool(), userId, async (db) => readOpenPause(db));
    if (!hold) {
      res.json({ held: false });
      return;
    }
    res.json({
      held: true,
      since: hold.startedAt,
      // VERBATIM, and absent when the operator typed none — the screen
      // supplies its own default sentence, in the reader's own language.
      ...(hold.message ? { message: hold.message } : {}),
    });
  } catch (error) {
    serverFault(res, 'read_failed', 'reading the platform hold', error);
  }
});

/**
 * Every hold, newest first. An operator's screen; to anybody else the
 * database serves the open one and nothing more, which is the correct answer
 * rather than a refusal.
 */
router.get('/history', authenticateSubject, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return noSubject(res);
    const holds = await withSubject(pool(), userId, async (db) => listPlatformPauses(db));
    res.json({ holds });
  } catch (error) {
    serverFault(res, 'read_failed', 'reading the platform hold history', error);
  }
});

/**
 * Start a hold. The tick stops enqueueing on its next firing (within a
 * minute); passes already running finish normally, which is what makes this a
 * drain rather than a kill.
 */
router.post('/', authenticateSubject, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return noSubject(res);
    const body = (req.body ?? {}) as { message?: unknown };
    if (body.message !== undefined && typeof body.message !== 'string') {
      res.status(400).json({
        error: 'Bad request',
        message: 'message must be a string when it is given',
      });
      return;
    }
    const started = await withSubject(pool(), userId, async (db) =>
      startPlatformPause(db, {
        operatorUserId: userId,
        ...(typeof body.message === 'string' ? { message: body.message } : {}),
      }),
    );
    if (!started) {
      // Not an operator. The same answer the support views give: no rows, so
      // nothing to report — and no hint that there was anything to be refused.
      res.status(404).json({ error: 'Not found', message: 'No such resource' });
      return;
    }
    res.status(201).json({
      held: true,
      since: started.startedAt,
      ...(started.message ? { message: started.message } : {}),
    });
  } catch (error) {
    serverFault(res, 'write_failed', 'starting a platform hold', error);
  }
});

/** Lift the hold. The next tick starts passes again. */
router.delete('/', authenticateSubject, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return noSubject(res);
    const ended = await withSubject(pool(), userId, async (db) =>
      endPlatformPause(db, { operatorUserId: userId }),
    );
    if (!ended) {
      // Nothing open, or not an operator — the same answer on purpose (see
      // endPlatformPause).
      res.status(404).json({ error: 'Not found', message: 'No hold is open' });
      return;
    }
    res.json({ held: false });
  } catch (error) {
    serverFault(res, 'write_failed', 'ending a platform hold', error);
  }
});

export default router;
