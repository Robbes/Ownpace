// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The managed edition's operating surface (ADR-0026).
 *
 * §11.2's decision queues, and the decisions an owner can make about them. The
 * self-host appliance has served these since workplan 0010; the managed API had
 * **none of them**, which is the asymmetry ADR-0026 exists to close — the UI is
 * one React app served by both editions, so an endpoint missing here is a
 * screen that silently does nothing for every managed customer.
 *
 * The shapes are `@openmig/shared`'s, not this file's. That is the whole point:
 * these responses are byte-compatible with what the appliance sends, including
 * the operator-facing prose, so the same screens render against either edition
 * without knowing which one they are talking to.
 *
 * ## Two things are deliberately NOT here
 *
 * `apply` and `verify` both touch the TARGET — one removes a message, the other
 * counts and samples every domain — and in this edition target I/O belongs to
 * the worker behind Trigger.dev (ADR-0004), not to a request thread in the API.
 * Bolting a synchronous version into this process would put connector
 * credentials and minutes-long network work into the HTTP path, and would make
 * the two editions differ in exactly the operation that destroys data. They
 * want a job and an async result shape, which is a deliberate piece of work
 * rather than a line in this file. Everything here needs only the ledger, which
 * is why it can be honest today.
 *
 * ## Per-mapping, not per-tenant
 *
 * The appliance answers `/deletions` for every mapping in its config directory,
 * because there are a handful. A managed tenant can have many, and returning
 * all of their queues in one response would be a slow, unbounded answer to a
 * question nobody asked. So these are scoped to one mapping — and still return
 * the contract's `ByMapping<T>` shape, with a single key, so the UI's
 * `Object.entries()` works unchanged against both.
 */

import { Router } from 'express';
import type { Response } from 'express';
import { and, eq } from 'drizzle-orm';
import * as schema from '@openmig/ledger';
import { PgLedger, PgCursorStore } from '@openmig/ledger';
import {
  DELETIONS_MEANING,
  DELETION_GUIDANCE,
  FAILURE_GUIDANCE,
  MOVES_MEANING,
  MOVE_GUIDANCE,
  REPORTING_CLOSED,
  MAPPING_LIFECYCLES,
  finishTransition,
  log,
} from '@openmig/shared';
import type {
  DeletionsResponse,
  FailuresResponse,
  FinishAccepted,
  MappingLifecycle,
  MovesResponse,
  DecisionAccepted,
  MappingId,
  TenantId,
} from '@openmig/shared';
import { authenticate, getDbPool, withTenantDb } from '../../middleware/auth';
import type { AuthenticatedRequest } from '../../types/api';

const router = Router({ mergeParams: true });

let _dbPool: ReturnType<typeof getDbPool> | null = null;
function pool() {
  if (!_dbPool) _dbPool = getDbPool();
  return _dbPool;
}

interface Scoped {
  readonly tenantId: string;
  readonly mappingId: string;
  readonly lifecycle: MappingLifecycle;
}

/**
 * Resolve `:mappingId` for the authenticated tenant, or answer and return null.
 *
 * The lifecycle is read here because every queue reports it, and because the
 * database's own `mailbox_mapping_status_check` restricts it to four values —
 * so anything else means that constraint was bypassed, and hard rule 9 says
 * surface that rather than coerce it into something that happens to type-check.
 */
async function scope(req: AuthenticatedRequest, res: Response): Promise<Scoped | null> {
  const { mappingId } = req.params;
  const tenantId = req.tenantId;
  if (!mappingId || Array.isArray(mappingId)) {
    res.status(400).json({ error: 'mappingId is required' });
    return null;
  }
  if (!tenantId) {
    res.status(401).json({ error: 'Unauthorized', message: 'Tenant ID not found' });
    return null;
  }

  const rows = await withTenantDb(tenantId, pool(), (db) =>
    db
      .select({ status: schema.mailboxMapping.status })
      .from(schema.mailboxMapping)
      .where(
        and(
          eq(schema.mailboxMapping.id, mappingId),
          eq(schema.mailboxMapping.tenantId, tenantId),
        ),
      ),
  );
  const row = rows[0];
  if (!row) {
    res.status(404).json({ error: 'Not found', message: 'Mapping not found' });
    return null;
  }
  if (!MAPPING_LIFECYCLES.includes(row.status as MappingLifecycle)) {
    throw new Error(
      `mailbox_mapping.status is '${row.status}', which is not one of ` +
        `${MAPPING_LIFECYCLES.join(', ')}. The database CHECK constraint should make this ` +
        `impossible; refusing to guess what the migration's state is.`,
    );
  }
  return { tenantId, mappingId, lifecycle: row.status as MappingLifecycle };
}

/** Run something with a tenant-scoped ledger. */
function withLedger<T>(tenantId: string, fn: (ledger: PgLedger) => Promise<T>): Promise<T> {
  return withTenantDb(tenantId, pool(), (db) => fn(new PgLedger(db)));
}

/** A finished migration keeps its history but stops presenting it as work to do. */
function closed(lifecycle: MappingLifecycle) {
  return lifecycle === 'done' ? { reportingClosed: REPORTING_CLOSED } : {};
}

function serverError(res: Response, what: string, error: unknown): void {
  log.error(`[api] ${what} failed:`, error);
  res.status(500).json({ error: 'Internal server error', message: `Failed to ${what}` });
}

// ---------------------------------------------------------------- the queues

router.get('/:mappingId/deletions', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const s = await scope(req, res);
    if (!s) return;
    const all = await withLedger(s.tenantId, (l) =>
      l.listDeletions(s.tenantId as TenantId, s.mappingId as MappingId),
    );
    const body: DeletionsResponse = {
      [s.mappingId]: {
        migrationStatus: s.lifecycle,
        ...closed(s.lifecycle),
        confirmed: all.filter((d) => d.confirmed && !d.acknowledgedAt),
        // Shown so the queue is not a black box; never actionable.
        watching: all.filter((d) => !d.confirmed && !d.acknowledgedAt),
        acknowledged: all.filter((d) => d.acknowledgedAt),
        whatThisMeans: DELETIONS_MEANING,
        howToResolve: DELETION_GUIDANCE,
      },
    };
    res.json(body);
  } catch (error) {
    serverError(res, 'read the deletions queue', error);
  }
});

router.get('/:mappingId/moves', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const s = await scope(req, res);
    if (!s) return;
    const all = await withLedger(s.tenantId, (l) =>
      l.listMoves(s.tenantId as TenantId, s.mappingId as MappingId),
    );
    const body: MovesResponse = {
      [s.mappingId]: {
        migrationStatus: s.lifecycle,
        ...closed(s.lifecycle),
        open: all.filter((m) => !m.acknowledgedAt),
        acknowledged: all.filter((m) => m.acknowledgedAt),
        whatThisMeans: MOVES_MEANING,
        howToResolve: MOVE_GUIDANCE,
      },
    };
    res.json(body);
  } catch (error) {
    serverError(res, 'read the moves queue', error);
  }
});

router.get('/:mappingId/failures', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const s = await scope(req, res);
    if (!s) return;
    const all = await withLedger(s.tenantId, (l) =>
      l.listFailures(s.tenantId as TenantId, s.mappingId as MappingId),
    );
    const body: FailuresResponse = {
      [s.mappingId]: {
        migrationStatus: s.lifecycle,
        ...closed(s.lifecycle),
        // Split rather than left for the reader to filter: one is still being
        // worked on, the other is waiting on a person and will otherwise never
        // move.
        needsDecision: all.filter((f) => f.needsDecision),
        retrying: all.filter((f) => !f.needsDecision),
        howToResolve: FAILURE_GUIDANCE,
      },
    };
    res.json(body);
  } catch (error) {
    serverError(res, 'read the failure queue', error);
  }
});

// ------------------------------------------------------------- the decisions

router.post(
  '/:mappingId/deletions/:hash/keep',
  authenticate,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const s = await scope(req, res);
      if (!s) return;
      const hash = String(req.params.hash);
      const applied = await withLedger(s.tenantId, (l) =>
        l.resolveDeletion(s.tenantId as TenantId, s.mappingId as MappingId, hash, 'keep'),
      );
      // False means nothing under that key is CONFIRMED and open — it came
      // back, it is still only being watched, or somebody already decided.
      if (!applied) {
        return void res.status(404).json({
          error: 'no confirmed, open disappearance under that natural key',
          hint:
            'It may have reappeared on the source, already been acknowledged, or — for an ' +
            'inferred deletion — not yet been missing for enough consecutive scans.',
        });
      }
      const body: DecisionAccepted = {
        status: 'ok',
        action: 'keep',
        naturalKeyHash: hash,
        effect:
          'Acknowledged. The target keeps its copy and this stops being reported unless the ' +
          'item reappears on the source and vanishes again.',
      };
      res.json(body);
    } catch (error) {
      serverError(res, 'record the decision', error);
    }
  },
);

router.post(
  '/:mappingId/moves/:hash/keep',
  authenticate,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const s = await scope(req, res);
      if (!s) return;
      const hash = String(req.params.hash);
      const applied = await withLedger(s.tenantId, (l) =>
        l.resolveMove(s.tenantId as TenantId, s.mappingId as MappingId, hash, 'keep'),
      );
      if (!applied) {
        return void res.status(404).json({
          error: 'no open move under that natural key',
          hint: 'It may have been moved back on the source, or already been acknowledged.',
        });
      }
      const body: DecisionAccepted = {
        status: 'ok',
        action: 'keep',
        naturalKeyHash: hash,
        effect:
          'Acknowledged. Nothing changed on the source or the target; this move stops being ' +
          'reported unless the item moves somewhere else again.',
      };
      res.json(body);
    } catch (error) {
      serverError(res, 'record the decision', error);
    }
  },
);

// `:action` is validated in the handler rather than in the path. Express 5
// removed regex path parameters — `:action(retry|accept)` throws at route
// REGISTRATION, i.e. the API would not start, and neither typecheck nor lint
// would say so.
router.post(
  '/:mappingId/failures/:hash/:action',
  authenticate,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const raw = String(req.params.action);
      if (raw !== 'retry' && raw !== 'accept') {
        return void res.status(404).json({
          error: `unknown action '${raw}'`,
          hint: 'A failed item can be retried or accepted.',
        });
      }
      const action: 'retry' | 'accept' = raw;

      const s = await scope(req, res);
      if (!s) return;
      const hash = String(req.params.hash);

      const applied = await withLedger(s.tenantId, (l) =>
        l.resolveFailure(s.tenantId as TenantId, s.mappingId as MappingId, hash, action),
      );
      if (!applied) {
        return void res.status(404).json({
          error: 'no unresolved failure under that natural key',
          hint: 'It may have succeeded on a later pass, or already been retried or accepted.',
        });
      }

      if (action === 'retry') {
        // A parked item does not hold the cursor back, so by now the source may
        // not list it as changed. Cursors are non-authoritative (ADR-0020):
        // dropping them costs one full, still-idempotent re-scan and guarantees
        // the item is put back in front of the loop. Same reasoning, same
        // behaviour, as the appliance — an edition where "retry" quietly did
        // less would be the same button meaning two different things.
        await withTenantDb(s.tenantId, pool(), (db) =>
          new PgCursorStore(db).clear(s.tenantId as TenantId, s.mappingId as MappingId),
        );
      }

      const body: DecisionAccepted = {
        status: 'ok',
        action,
        naturalKeyHash: hash,
        effect:
          action === 'retry'
            ? 'Attempts reset and cursors cleared; the next scheduled pass will try again.'
            : 'Left behind for good: no further retries, and excluded from the verification gate.',
      };
      res.json(body);
    } catch (error) {
      serverError(res, 'record the decision', error);
    }
  },
);

// ----------------------------------------------------------------- finishing

router.post('/:mappingId/finish', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const s = await scope(req, res);
    if (!s) return;
    const force = String(req.query.force) === 'true';

    const failures = await withLedger(s.tenantId, (l) =>
      l.listFailures(s.tenantId as TenantId, s.mappingId as MappingId),
    );
    const unresolved = failures.filter((f) => f.needsDecision).length;

    // The decision itself is `@openmig/shared`'s, so the two editions refuse
    // for the same reasons (ADR-0026). Only the ACTING differs, and barely:
    // there is no scheduler to stop here, because the managed poller selects
    // `status = 'active'` and simply stops seeing this row.
    const transition = finishTransition(s.lifecycle, unresolved, force);

    if ('refuse' in transition) {
      return void res.status(409).json({ error: transition.refuse, hint: transition.hint });
    }
    if (transition.finish === false) {
      const already: FinishAccepted = {
        status: 'ok',
        action: 'finish',
        alreadyDone: true,
        effect: 'This migration was already finished; nothing changed.',
      };
      return void res.json(already);
    }

    await withTenantDb(s.tenantId, pool(), (db) =>
      db
        .update(schema.mailboxMapping)
        .set({ status: 'done' })
        .where(
          and(
            eq(schema.mailboxMapping.id, s.mappingId),
            eq(schema.mailboxMapping.tenantId, s.tenantId),
          ),
        ),
    );

    log.warn(
      `[api] ${s.mappingId}: FINISHED by operator — no longer syncing` +
        (unresolved > 0 ? ` (forced over ${unresolved} unresolved failure(s))` : ''),
    );

    const body: FinishAccepted = {
      status: 'ok',
      action: 'finish',
      mappingId: s.mappingId,
      ...(unresolved > 0 ? { leftUnmigrated: unresolved } : {}),
      effect:
        'The migration is finished. This mapping no longer syncs, and drift, deletions and ' +
        'moves are no longer reported for it. Nothing was added to or removed from the ' +
        'target — what is there now is what stays.',
      ifYouNeedToResume:
        "Set the mapping's status back to 'active' to resume; the scheduler picks it up on its " +
        'next poll.',
    };
    res.json(body);
  } catch (error) {
    serverError(res, 'finish the migration', error);
  }
});

export default router;
