// Copyright 2026 The Ownpace authors (Apache-2.0)

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
import { and, desc, eq } from 'drizzle-orm';
import * as schema from '@openmig/ledger';
import { PgLedger, PgCursorStore, PgMigrationStatusStore } from '@openmig/ledger';
import {
  DELETIONS_MEANING,
  DELETION_GUIDANCE,
  FAILURE_GUIDANCE,
  MOVES_MEANING,
  MOVE_GUIDANCE,
  REPORTING_CLOSED,
  MAPPING_LIFECYCLES,
  buildCompletionReport,
  buildDomainStatusReports,
  renderCompletionReportMarkdown,
  finishTransition,
  log,
} from '@openmig/shared';
import type {
  ApplyDeletionsFlag,
  ApplyQueuedResponse,
  ApplyReceipt,
  VerificationRunReport,
  VerifyResponse,
  VerifyStartResponse,
  DeletionsResponse,
  FailuresResponse,
  FinishAccepted,
  MappingLifecycle,
  MovesResponse,
  DecisionAccepted,
  MappingId,
  TenantId,
} from '@openmig/shared';
import { authenticate, getDbPool, requireRole, withTenantDb } from '../../middleware/auth.ts';
import { getTriggerClient } from '@openmig/scheduler';
import {
  applyAllOpenShareGrants,
  applyShareGrant,
  evaluateApplyDeletion,
  evaluateApplyRelocation,
  markShareGrant,
  refreshShareGrants,
  summariseShareGrants,
} from '@openmig/core';
import { SecretStore } from '@openmig/core/secret-store';
import { createNextcloudShare } from '@openmig/connectors';
import type { ShareGrantRow } from '@openmig/shared';
import { resolveMappingMailbox, tenantInventoryScans } from '../permissions.ts';
import type { AuthenticatedRequest } from '../../types/api.ts';
import { serverFault } from '../../server-fault.ts';

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

/** The sharing checklist's closing counts, for the completion report (0052 T6b). */
function summariseSharing(rows: ReadonlyArray<ShareGrantRow>) {
  const summary = summariseShareGrants(rows);
  return {
    applied: summary.applied,
    doneManual: summary.doneManual,
    skipped: summary.skipped,
    open: summary.open,
    openManual: summary.openManual,
  };
}

/** A finished migration keeps its history but stops presenting it as work to do. */
function closed(lifecycle: MappingLifecycle) {
  return lifecycle === 'done' ? { reportingClosed: REPORTING_CLOSED } : {};
}

/**
 * A fault on one of the §11.2 queues, named by the queue it happened on.
 *
 * `code` is per-route rather than one shared `operating_failed` (owner
 * decision, workplan 0081 T6): these nineteen routes serve six different
 * queues, and a caller that cannot tell "the deletions queue would not load"
 * from "the verification report would not assemble" is back to the state this
 * workplan set out to leave. Naming them also surfaced that three routes
 * answered the byte-identical sentence *recording the decision* — the
 * deletions keep, the moves keep and the failures action — so `what` is now
 * distinct per route too, which is the half a person actually reads.
 */
function serverError(res: Response, code: string, what: string, error: unknown): void {
  serverFault(res, code, what, error);
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
    serverError(res, 'deletions_failed', 'reading the deletions queue', error);
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
    serverError(res, 'moves_failed', 'reading the moves queue', error);
  }
});

/**
 * The migration completion report (workplan 0047): one document saying what
 * moved, what is waiting on a decision, and what was removed on whose
 * decision — assembled by the SHARED builder both editions call (rule 5),
 * from data every screen already shows. `markdown` is the deliverable an
 * owner downloads and hands over.
 */
router.get(
  '/:mappingId/completion-report',
  authenticate,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const s = await scope(req, res);
      if (!s) return;
      const tenantId = s.tenantId as TenantId;
      const mappingId = s.mappingId as MappingId;

      const gathered = await withTenantDb(s.tenantId, pool(), async (db) => {
        const ledger = new PgLedger(db);
        const statuses = await new PgMigrationStatusStore(db).getStatus(tenantId, mappingId);
        const failures = await ledger.listFailures(tenantId, mappingId);
        const moves = await ledger.listMoves(tenantId, mappingId);
        const deletions = await ledger.listDeletions(tenantId, mappingId);
        const mappingRows = await db
          .select({
            name: schema.mailboxMapping.name,
            sourceMailboxId: schema.mailboxMapping.sourceMailboxId,
            targetMailboxId: schema.mailboxMapping.targetMailboxId,
          })
          .from(schema.mailboxMapping)
          .where(eq(schema.mailboxMapping.id, s.mappingId));
        const kindFor = async (mailboxId: string | null) => {
          if (!mailboxId) return 'unknown';
          const rows = await db
            .select({ kind: schema.connection.kind })
            .from(schema.connection)
            .innerJoin(schema.mailbox, eq(schema.mailbox.connectionId, schema.connection.id))
            .where(eq(schema.mailbox.id, mailboxId));
          return rows[0]?.kind ?? 'unknown';
        };
        const receipts = await db
          .select({ action: schema.applyReceipt.action, state: schema.applyReceipt.state })
          .from(schema.applyReceipt)
          .where(eq(schema.applyReceipt.mappingId, s.mappingId));
        return {
          statuses,
          failures,
          moves,
          deletions,
          name: mappingRows[0]?.name ?? undefined,
          sourceType: await kindFor(mappingRows[0]?.sourceMailboxId ?? null),
          targetType: await kindFor(mappingRows[0]?.targetMailboxId ?? null),
          receipts,
        };
      });

      const report = buildCompletionReport({
        mappingId: s.mappingId,
        ...(gathered.name ? { name: gathered.name } : {}),
        sourceType: gathered.sourceType,
        targetType: gathered.targetType,
        lifecycle: s.lifecycle,
        generatedAt: new Date().toISOString(),
        domains: buildDomainStatusReports(gathered.statuses, gathered.failures),
        moves: gathered.moves,
        deletions: gathered.deletions,
        failures: gathered.failures,
        // The receipts ARE this edition's answer to "what was removed": every
        // destructive outcome landed on one, human-pressed or auto-applied.
        applied: {
          deletionsApplied: gathered.receipts.filter(
            (r) => r.action === 'deletion' && r.state === 'applied',
          ).length,
          relocationsApplied: gathered.receipts.filter(
            (r) => r.action === 'relocation' && r.state === 'applied',
          ).length,
          refused: gathered.receipts.filter((r) => r.state === 'refused').length,
        },
        // The checklist's closing state (ADR-0032, 0052 T6b) — same rows the
        // Sharing screen shows, so the document and the page cannot disagree.
        sharing: summariseSharing(
          await withLedger(s.tenantId, (l) =>
            l.listShareGrants(s.tenantId as TenantId, s.mappingId as MappingId),
          ),
        ),
      });
      res.json({ report, markdown: renderCompletionReportMarkdown(report) });
    } catch (error) {
      serverError(res, 'completion_report_failed', 'assembling the completion report', error);
    }
  },
);

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
    serverError(res, 'failures_failed', 'reading the failure queue', error);
  }
});

// ------------------------------------------------------------- the decisions

// ------------------------------------------------- the sharing queue (ADR-0032)

/**
 * The target's share capability for this mapping, when its target has one.
 *
 * Nextcloud (behind the `webdav` target kind) speaks OCS; nothing else does
 * yet, and `undefined` here makes `applyShareGrant` refuse with the
 * protocol-gap sentence rather than this file inventing its own. The share is
 * created with the TARGET's credentials, at the path the copy actually lives
 * at (`targetFolderPrefix` included) — and the target then notifies the
 * grantee itself, which is the point (ADR-0032 §4).
 */
async function nextcloudCapabilityFor(
  s: Scoped,
  granteeOverride: string | undefined,
  note?: string,
): Promise<((row: ShareGrantRow) => Promise<{ ok: true } | { ok: false; reason: string }>) | undefined> {
  const rows = await withTenantDb(s.tenantId, pool(), (db) =>
    db
      .select({
        kind: schema.connection.kind,
        config: schema.connection.config,
        secretRef: schema.connection.secretRef,
        prefix: schema.mailboxMapping.targetFolderPrefix,
      })
      .from(schema.mailboxMapping)
      .innerJoin(schema.mailbox, eq(schema.mailbox.id, schema.mailboxMapping.targetMailboxId))
      .innerJoin(schema.connection, eq(schema.connection.id, schema.mailbox.connectionId))
      .where(
        and(
          eq(schema.mailboxMapping.id, s.mappingId),
          eq(schema.mailboxMapping.tenantId, s.tenantId),
        ),
      ),
  );
  const target = rows[0];
  if (!target || target.kind !== 'webdav') return undefined;

  const config = (target.config ?? {}) as {
    host?: string;
    port?: number;
    useSsl?: boolean;
    credentials?: Record<string, string>;
  };
  const creds = target.secretRef
    ? SecretStore.decryptCredentials(target.secretRef)
    : (config.credentials ?? {});
  const origin = `${config.useSsl === false ? 'http' : 'https'}://${config.host}${config.port ? `:${config.port}` : ''}`;

  return async (row) => {
    const shareWith = granteeOverride ?? row.grantee;
    if (!shareWith) {
      return {
        ok: false,
        reason:
          'This grant names no grantee address (a link or domain share) — there is nobody ' +
          'to share with. Handle it by hand and mark the row done.',
      };
    }
    return createNextcloudShare(
      {
        webdavUrl: origin,
        username: creds.username ?? '',
        password: creds.password ?? '',
        httpClient: { request: async ({ url, method, headers, body }) => {
          const r = await fetch(url, {
            method,
            headers,
            ...(typeof body === 'string' ? { body } : {}),
          });
          return { status: r.status, body: await r.text(), headers: {} };
        } },
      },
      {
        path: target.prefix ? `${target.prefix}/${row.onLabel}` : row.onLabel,
        shareWith,
        role: row.role,
        ...(note ? { note } : {}),
      },
    );
  };
}

router.get('/:mappingId/sharing', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const s = await scope(req, res);
    if (!s) return;
    const grants = await withLedger(s.tenantId, (l) =>
      l.listShareGrants(s.tenantId as TenantId, s.mappingId as MappingId),
    );
    res.json({
      migrationStatus: s.lifecycle,
      summary: summariseShareGrants(grants),
      grants,
      ...closed(s.lifecycle),
    });
  } catch (error) {
    serverError(res, 'sharing_failed', 'reading the sharing queue', error);
  }
});

router.post(
  '/:mappingId/sharing/rescan',
  authenticate,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const s = await scope(req, res);
      if (!s) return;
      const mailbox = await resolveMappingMailbox(s.tenantId, s.mappingId);
      if (!mailbox) {
        // The same sentence the permission report answers with — one fact
        // missing, named (rule 9).
        return void res.status(409).json({
          error: 'Conflict',
          reason:
            'This migration does not record which mailbox it reads, so its sharing cannot ' +
            'be inventoried.',
        });
      }
      const scans = await tenantInventoryScans(s.tenantId, mailbox);
      const result = await withLedger(s.tenantId, (l) =>
        refreshShareGrants({
          tenantId: s.tenantId as TenantId,
          mappingId: s.mappingId as MappingId,
          ledger: l,
          scans: [scans.scanCalendars, scans.scanDrive],
        }),
      );
      res.json(result);
    } catch (error) {
      serverError(res, 'sharing_rescan_failed', 'rescanning sharing', error);
    }
  },
);

router.post(
  '/:mappingId/sharing/:grantId/decision',
  authenticate,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const s = await scope(req, res);
      if (!s) return;
      const grantId = String(req.params.grantId);
      const body = (req.body ?? {}) as { action?: string; reason?: string; grantee?: string };
      if (body.action !== 'apply' && body.action !== 'done' && body.action !== 'skip') {
        return void res.status(400).json({
          error: 'unknown action',
          hint: "A sharing row can be applied ('apply'), ticked off as done by hand ('done'), or skipped ('skip').",
        });
      }
      // The checklist has no anonymous ticks: attribution names the decider.
      const decidedBy = req.userId ?? 'unknown';

      const outcome = await withLedger(s.tenantId, async (l) => {
        const deps = {
          tenantId: s.tenantId as TenantId,
          mappingId: s.mappingId as MappingId,
          ledger: l,
          decidedBy,
          onError: (m: string, err: unknown) => log.error(m, err),
        };
        if (body.action === 'apply') {
          const createShare = await nextcloudCapabilityFor(s, body.grantee?.trim() || undefined);
          return applyShareGrant(
            {
              ...deps,
              lifecycleDone: s.lifecycle === 'done',
              ...(createShare ? { createShare } : {}),
            },
            grantId,
          );
        }
        return markShareGrant(
          deps,
          grantId,
          body.action === 'done' ? 'done_manual' : 'skipped',
          body.reason,
        );
      });

      if (!outcome.ok) {
        return void res
          .status(outcome.code === 'not_found' ? 404 : 409)
          .json({ error: outcome.code, reason: outcome.reason });
      }
      res.json({ status: 'ok', grant: outcome.row });
    } catch (error) {
      serverError(res, 'sharing_decision_failed', 'recording this sharing decision', error);
    }
  },
);

/**
 * THE ONE-GO PRESS (0104 T1): every open, clean, addressable grant applied
 * in one recorded action, at or after cutover. Creating the shares is what
 * makes the TARGET notify the grantees — so this press is the chosen
 * announcement moment, one wave of platform-native mail, not a mail sent by
 * this product. The optional `note` rides inside the platform's own
 * notification; links and manual verdicts stay on the checklist untouched
 * (they are the fallback digest's audience, 0104 T3).
 */
router.post(
  '/:mappingId/sharing/apply-all',
  authenticate,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const s = await scope(req, res);
      if (!s) return;
      const note = typeof (req.body as { note?: unknown } | undefined)?.note === 'string'
        ? (req.body as { note: string }).note.trim().slice(0, 500)
        : undefined;
      const decidedBy = req.userId ?? 'unknown';

      const outcome = await withLedger(s.tenantId, async (l) => {
        const createShare = await nextcloudCapabilityFor(s, undefined, note);
        return applyAllOpenShareGrants({
          tenantId: s.tenantId as TenantId,
          mappingId: s.mappingId as MappingId,
          ledger: l,
          decidedBy,
          onError: (m: string, err: unknown) => log.error(m, err),
          lifecycleDone: s.lifecycle === 'done',
          ...(createShare ? { createShare } : {}),
        });
      });

      if (!outcome.ok) {
        return void res.status(409).json({ error: outcome.code, reason: outcome.reason });
      }
      res.json({ status: 'ok', pressedBy: decidedBy, ...outcome });
    } catch (error) {
      serverError(res, 'sharing_apply_all_failed', 'applying the sharing queue in one go', error);
    }
  },
);

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
      serverError(res, 'deletion_keep_failed', 'recording the decision to keep this deletion', error);
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
      serverError(res, 'move_keep_failed', 'recording the decision to keep this move', error);
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
      serverError(res, 'failure_decision_failed', 'recording the decision on this failure', error);
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
      return void res.status(409).json({ error: transition.refuse, hint: transition.hint, code: transition.code });
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
    serverError(res, 'finish_failed', 'finishing the migration', error);
  }
});

/**
 * The §20 gate's start + poll pair (workplan 0017 T3) — the last deliberate
 * ADR-0026 gap, closed. Target I/O stays in the worker: `start` inserts a
 * `running` row in `verification_run` and enqueues `run-verification`, which
 * lands the outcome on that row; `report` reads the latest row and never
 * triggers anything, which is what keeps the Verify screen a page rather than
 * a trapdoor. Same wire shapes as the appliance (`VerificationRunReport`,
 * `VerifyStartResponse`), so the one UI polls both editions identically.
 */

/** The latest run row for a mapping, as the contract's report. */
async function latestRunReport(s: Scoped): Promise<VerificationRunReport> {
  const rows = await withTenantDb(s.tenantId, pool(), (db) =>
    db
      .select()
      .from(schema.verificationRun)
      .where(
        and(
          eq(schema.verificationRun.tenantId, s.tenantId),
          eq(schema.verificationRun.mappingId, s.mappingId),
        ),
      )
      .orderBy(desc(schema.verificationRun.startedAt))
      .limit(1),
  );
  const row = rows[0];
  if (!row) return { state: 'never-run' };
  const startedAt = row.startedAt.toISOString();
  if (row.state === 'running') return { state: 'running', startedAt };
  if (row.state === 'failed') {
    return { state: 'failed', startedAt, error: row.error ?? 'The scan failed with no recorded reason.' };
  }
  return {
    state: 'done',
    startedAt,
    // The CHECK constraint guarantees a terminal row has a finish time; a row
    // that violates that would mean the constraint was bypassed, and guessing
    // a timestamp here would paper over exactly that (hard rule 9).
    finishedAt: row.finishedAt!.toISOString(),
    report: (row.report ?? {}) as VerifyResponse,
  };
}

router.post('/:mappingId/verify/start', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const s = await scope(req, res);
    if (!s) return;

    const current = await latestRunReport(s);
    if (current.state === 'running') {
      // Joined, not stacked — the same idempotent-action shape as POST
      // .../start's `activated: false`. Verification reads every enabled
      // domain's target; two concurrent scans double that load to answer a
      // question once.
      const body: VerifyStartResponse = { started: false, report: current };
      return void res.status(200).json(body);
    }

    const inserted = await withTenantDb(s.tenantId, pool(), (db) =>
      db
        .insert(schema.verificationRun)
        .values({ tenantId: s.tenantId, mappingId: s.mappingId, state: 'running' })
        .returning({ id: schema.verificationRun.id, startedAt: schema.verificationRun.startedAt }),
    );
    const run = inserted[0]!;

    try {
      await getTriggerClient().tasks.trigger(
        'run-verification',
        { tenantId: s.tenantId, mappingId: s.mappingId, runId: run.id },
        { tags: [`tenant:${s.tenantId}`, `mapping:${s.mappingId}`] },
      );
    } catch (err) {
      // The row must not sit 'running' forever pointing at a job that was
      // never enqueued — a poller would wait on nothing. Land it failed with
      // the reason, and tell the caller the start did not happen.
      const message = err instanceof Error ? err.message : String(err);
      await withTenantDb(s.tenantId, pool(), (db) =>
        db
          .update(schema.verificationRun)
          .set({ state: 'failed', finishedAt: new Date(), error: `Could not enqueue the scan: ${message}` })
          .where(eq(schema.verificationRun.id, run.id)),
      );
      log.error(`[api] ${s.mappingId}: could not enqueue run-verification:`, err);
      return void res
        .status(502)
        .json({ error: 'Could not start the scan', message });
    }

    const body: VerifyStartResponse = {
      started: true,
      report: { state: 'running', startedAt: run.startedAt.toISOString() },
    };
    res.status(202).json(body);
  } catch (error) {
    serverError(res, 'verify_start_failed', 'starting the verification', error);
  }
});

router.get('/:mappingId/verify/report', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const s = await scope(req, res);
    if (!s) return;
    res.json(await latestRunReport(s));
  } catch (error) {
    serverError(res, 'verify_report_failed', 'reading the verification report', error);
  }
});

/**
 * `apply` — the one destructive operation — as evaluate-then-enqueue
 * (workplan 0017 T4). The ledger-side gates are answered HERE, synchronously:
 * a refusal is an answer to the operator's question and comes back on the
 * request they made, as the same 403/404 + code + reason the appliance sends.
 * Only a removal every ledger gate permits gets a receipt and a job; the two
 * gates only the target can answer (capability, and whether the owner edited
 * our copy) land on the receipt, which `GET .../receipt` serves.
 */

function receiptFromRow(row: {
  state: string;
  requestedAt: Date;
  finishedAt: Date | null;
  kind: string | null;
  code: string | null;
  reason: string | null;
}): ApplyReceipt {
  const requestedAt = row.requestedAt.toISOString();
  if (row.state === 'queued') return { state: 'queued', requestedAt };
  // The CHECK constraint guarantees a terminal row has a finish time; guessing
  // one here would paper over the constraint being bypassed (hard rule 9).
  const finishedAt = row.finishedAt!.toISOString();
  if (row.state === 'applied') {
    // 'unknown', not 'deleted': a hand-written row missing its kind must not
    // be reported as MORE final than anyone knows it to be.
    return { state: 'applied', requestedAt, finishedAt, kind: row.kind ?? 'unknown' };
  }
  if (row.state === 'refused') {
    return {
      state: 'refused',
      requestedAt,
      finishedAt,
      code: row.code ?? 'unknown',
      reason: row.reason ?? 'Refused with no recorded reason.',
    };
  }
  return { state: 'failed', requestedAt, finishedAt, error: row.reason ?? 'The job failed with no recorded reason.' };
}

/**
 * The latest receipt FOR ONE ACTION. One item can be in both destructive
 * queues at once — renamed, then the new name deleted — and a poller asking
 * about the relocation must never be answered with the deletion's outcome
 * (migration 0010).
 */
async function latestReceipt(
  s: Scoped,
  hash: string,
  action: 'deletion' | 'relocation',
): Promise<ApplyReceipt> {
  const rows = await withTenantDb(s.tenantId, pool(), (db) =>
    db
      .select()
      .from(schema.applyReceipt)
      .where(
        and(
          eq(schema.applyReceipt.tenantId, s.tenantId),
          eq(schema.applyReceipt.mappingId, s.mappingId),
          eq(schema.applyReceipt.naturalKeyHash, hash),
          eq(schema.applyReceipt.action, action),
        ),
      )
      .orderBy(desc(schema.applyReceipt.requestedAt))
      .limit(1),
  );
  return rows[0] ? receiptFromRow(rows[0]) : { state: 'none' };
}

router.post(
  '/:mappingId/deletions/:hash/apply',
  authenticate,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const s = await scope(req, res);
      if (!s) return;
      const hash = String(req.params.hash ?? '');
      if (!hash) return void res.status(400).json({ error: 'hash is required' });

      // Joined, not stacked: an open receipt for this item means the job is
      // already on its way, and §11.2's "one item, one decision, one call"
      // does not multiply because somebody double-clicked.
      const existing = await latestReceipt(s, hash, 'deletion');
      if (existing.state === 'queued') {
        const body: ApplyQueuedResponse = { queued: false, receipt: existing };
        return void res.status(200).json(body);
      }

      // Every ledger-side gate, answered on this request. The flag comes from
      // the mapping row — the managed home of `allowApplyDeletions`, default
      // FALSE by migration 0004.
      const verdict = await withTenantDb(s.tenantId, pool(), async (db) => {
        const flagRows = await db
          .select({ allow: schema.mailboxMapping.allowApplyDeletions })
          .from(schema.mailboxMapping)
          .where(eq(schema.mailboxMapping.id, s.mappingId));
        const ledger = new PgLedger(db);
        // Domain by domain, the appliance's order: the evaluator needs the
        // domain to read the row, and the first domain holding the item wins.
        for (const domain of ['email', 'calendar', 'contact', 'file'] as const) {
          const outcome = await evaluateApplyDeletion(
            {
              tenantId: s.tenantId as TenantId,
              mappingId: s.mappingId as MappingId,
              domain,
              ledger,
              allowApplyDeletions: flagRows[0]?.allow === true,
            },
            hash,
          );
          // not_found in THIS domain may be found in the next; every other
          // verdict is final.
          if (outcome.ok || outcome.code !== 'not_found') return outcome;
        }
        return {
          ok: false as const,
          code: 'not_found' as const,
          reason:
            "No migrated item under that natural key in any of this mapping's enabled domains.",
        };
      });

      if (!verdict.ok) {
        // The appliance's status mapping, verbatim: 404 for "nothing here to
        // act on", 403 for "this exists but you may not remove it".
        const status =
          verdict.code === 'not_found' ||
          verdict.code === 'not_confirmed' ||
          verdict.code === 'already_applied'
            ? 404
            : 403;
        return void res.status(status).json({ error: verdict.code, reason: verdict.reason });
      }

      const inserted = await withTenantDb(s.tenantId, pool(), (db) =>
        db
          .insert(schema.applyReceipt)
          .values({
            tenantId: s.tenantId,
            mappingId: s.mappingId,
            naturalKeyHash: hash,
            action: 'deletion',
            state: 'queued',
          })
          .returning({ id: schema.applyReceipt.id, requestedAt: schema.applyReceipt.requestedAt }),
      );
      const receipt = inserted[0]!;

      try {
        await getTriggerClient().tasks.trigger(
          'run-apply-deletion',
          { tenantId: s.tenantId, mappingId: s.mappingId, naturalKeyHash: hash, receiptId: receipt.id },
          { tags: [`tenant:${s.tenantId}`, `mapping:${s.mappingId}`] },
        );
      } catch (err) {
        // Never leave a queued receipt pointing at a job that was never
        // enqueued — a poller would wait on nothing, about a REMOVAL.
        const message = err instanceof Error ? err.message : String(err);
        await withTenantDb(s.tenantId, pool(), (db) =>
          db
            .update(schema.applyReceipt)
            .set({ state: 'failed', finishedAt: new Date(), reason: `Could not enqueue the removal: ${message}` })
            .where(eq(schema.applyReceipt.id, receipt.id)),
        );
        log.error(`[api] ${s.mappingId}: could not enqueue run-apply-deletion:`, err);
        return void res.status(502).json({ error: 'Could not queue the removal', message });
      }

      log.warn(
        `[api] ${s.mappingId}: operator queued removal of item ${hash.slice(0, 12)} — every ` +
          'ledger gate permits; the target-side gates decide on the receipt.',
      );
      const body: ApplyQueuedResponse = {
        queued: true,
        receipt: { state: 'queued', requestedAt: receipt.requestedAt.toISOString() },
      };
      res.status(202).json(body);
    } catch (error) {
      serverError(res, 'deletion_apply_failed', "queuing this deletion's removal", error);
    }
  },
);

router.get(
  '/:mappingId/deletions/:hash/receipt',
  authenticate,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const s = await scope(req, res);
      if (!s) return;
      const hash = String(req.params.hash ?? '');
      if (!hash) return void res.status(400).json({ error: 'hash is required' });
      res.json(await latestReceipt(s, hash, 'deletion'));
    } catch (error) {
      serverError(res, 'deletion_receipt_failed', 'reading this deletion receipt', error);
    }
  },
);

/**
 * THE SECOND DESTRUCTIVE ROUTE (ADR-0030): remove the target's OLD copy of a
 * file the source moved or renamed, once the same bytes are on the target
 * under the new key.
 *
 * The same two-step shape as the deletion apply, deliberately: every
 * ledger-side gate is answered ON THIS REQUEST via `evaluateApplyRelocation`
 * (a refusal is an answer to the operator's question, not "check back later"),
 * and the target-side gates — capability, the ETag, and ADR-0030's own "ask
 * the target whether the new copy is really there" — belong to the worker and
 * land on the receipt. `evaluate` is a PREDICTION: the job re-runs every gate
 * freshly and gate 7's conditional UPDATE stays the last word.
 *
 * Shares `allowApplyDeletions` with the deletion route because it is the same
 * capability — removing our copy from the target — and a second switch would
 * imply one can be on without the other.
 */
router.post(
  '/:mappingId/moves/:hash/apply',
  authenticate,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const s = await scope(req, res);
      if (!s) return;
      const hash = String(req.params.hash ?? '');
      if (!hash) return void res.status(400).json({ error: 'hash is required' });

      // Joined, not stacked — scoped to THIS action: a queued DELETION on the
      // same item (renamed, then the new name deleted) is a different question
      // and must not be joined as if it answered this one.
      const existing = await latestReceipt(s, hash, 'relocation');
      if (existing.state === 'queued') {
        const body: ApplyQueuedResponse = { queued: false, receipt: existing };
        return void res.status(200).json(body);
      }

      const verdict = await withTenantDb(s.tenantId, pool(), async (db) => {
        const flagRows = await db
          .select({ allow: schema.mailboxMapping.allowApplyDeletions })
          .from(schema.mailboxMapping)
          .where(eq(schema.mailboxMapping.id, s.mappingId));
        const ledger = new PgLedger(db);
        for (const domain of ['email', 'calendar', 'contact', 'file'] as const) {
          const outcome = await evaluateApplyRelocation(
            {
              tenantId: s.tenantId as TenantId,
              mappingId: s.mappingId as MappingId,
              domain,
              ledger,
              allowApplyDeletions: flagRows[0]?.allow === true,
            },
            hash,
          );
          if (outcome.ok || outcome.code !== 'not_found') return outcome;
        }
        return {
          ok: false as const,
          code: 'not_found' as const,
          reason:
            "No migrated item under that natural key in any of this mapping's enabled domains.",
        };
      });

      if (!verdict.ok) {
        // The appliance's status mapping, verbatim — including `not_relocated`
        // as a 404, because an ordinary move genuinely has nothing for this
        // route to act on.
        const status =
          verdict.code === 'not_found' ||
          verdict.code === 'not_confirmed' ||
          verdict.code === 'already_applied' ||
          verdict.code === 'not_relocated'
            ? 404
            : 403;
        return void res.status(status).json({ error: verdict.code, reason: verdict.reason });
      }

      const inserted = await withTenantDb(s.tenantId, pool(), (db) =>
        db
          .insert(schema.applyReceipt)
          .values({
            tenantId: s.tenantId,
            mappingId: s.mappingId,
            naturalKeyHash: hash,
            action: 'relocation',
            state: 'queued',
          })
          .returning({ id: schema.applyReceipt.id, requestedAt: schema.applyReceipt.requestedAt }),
      );
      const receipt = inserted[0]!;

      try {
        await getTriggerClient().tasks.trigger(
          'run-apply-relocation',
          { tenantId: s.tenantId, mappingId: s.mappingId, naturalKeyHash: hash, receiptId: receipt.id },
          { tags: [`tenant:${s.tenantId}`, `mapping:${s.mappingId}`] },
        );
      } catch (err) {
        // Never leave a queued receipt pointing at a job that was never
        // enqueued — a poller would wait on nothing, about a REMOVAL.
        const message = err instanceof Error ? err.message : String(err);
        await withTenantDb(s.tenantId, pool(), (db) =>
          db
            .update(schema.applyReceipt)
            .set({ state: 'failed', finishedAt: new Date(), reason: `Could not enqueue the removal: ${message}` })
            .where(eq(schema.applyReceipt.id, receipt.id)),
        );
        log.error(`[api] ${s.mappingId}: could not enqueue run-apply-relocation:`, err);
        return void res.status(502).json({ error: 'Could not queue the removal', message });
      }

      log.warn(
        `[api] ${s.mappingId}: operator queued removal of relocated item ${hash.slice(0, 12)}'s ` +
          'old copy — every ledger gate permits; the target-side gates decide on the receipt.',
      );
      const body: ApplyQueuedResponse = {
        queued: true,
        receipt: { state: 'queued', requestedAt: receipt.requestedAt.toISOString() },
      };
      res.status(202).json(body);
    } catch (error) {
      serverError(res, 'relocation_apply_failed', "queuing the removal of this relocated item's old copy", error);
    }
  },
);

router.get(
  '/:mappingId/moves/:hash/receipt',
  authenticate,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const s = await scope(req, res);
      if (!s) return;
      const hash = String(req.params.hash ?? '');
      if (!hash) return void res.status(400).json({ error: 'hash is required' });
      res.json(await latestReceipt(s, hash, 'relocation'));
    } catch (error) {
      serverError(res, 'relocation_receipt_failed', 'reading this relocation receipt', error);
    }
  },
);

/**
 * Gate 1 of the destructive path, as a readable fact (workplan 0019 T3).
 *
 * Any member may READ it — the Deletions screen shows the current value to
 * whoever can see the queue, because "the delete button will be refused" is
 * something an operator should learn before clicking, not from a 403.
 */
router.get(
  '/:mappingId/apply-deletions',
  authenticate,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const s = await scope(req, res);
      if (!s) return;
      const rows = await withTenantDb(s.tenantId, pool(), (db) =>
        db
          .select({
            allow: schema.mailboxMapping.allowApplyDeletions,
            auto: schema.mailboxMapping.autoApplyRelocations,
          })
          .from(schema.mailboxMapping)
          .where(eq(schema.mailboxMapping.id, s.mappingId)),
      );
      const body: ApplyDeletionsFlag = {
        allowApplyDeletions: rows[0]?.allow === true,
        autoApplyRelocations: rows[0]?.auto === true,
        source: 'mapping',
      };
      res.json(body);
    } catch (error) {
      serverError(res, 'apply_flag_failed', 'reading the apply-deletions flag', error);
    }
  },
);

/**
 * Flip gate 1 — OWNER only (workplan 0019 T3).
 *
 * This was the recorded interim's `UPDATE mailbox_mapping SET
 * allow_apply_deletions = true` (0017 T4), now an authorized API instead of a
 * psql session. The role comes from the tenant_member row (0020 T1), so
 * "owner" here is a database fact, not a token claim. Changing the flag
 * changes what MAY be asked for — every per-item gate still stands.
 */
router.patch(
  '/:mappingId/apply-deletions',
  authenticate,
  requireRole('owner'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const s = await scope(req, res);
      if (!s) return;
      const patch = req.body as
        | { allowApplyDeletions?: unknown; autoApplyRelocations?: unknown }
        | undefined;
      const allow = patch?.allowApplyDeletions;
      const auto = patch?.autoApplyRelocations;
      // Either flag alone, or both — but each must be an actual boolean, and
      // sending neither is a request to change nothing, which is refused
      // rather than answered with an unchanged echo that reads like success.
      if (
        (allow === undefined && auto === undefined) ||
        (allow !== undefined && typeof allow !== 'boolean') ||
        (auto !== undefined && typeof auto !== 'boolean')
      ) {
        return void res.status(400).json({
          error: 'invalid_body',
          reason:
            'Send { "allowApplyDeletions": true | false } and/or ' +
            '{ "autoApplyRelocations": true | false } — nothing else is accepted.',
        });
      }
      const updated = await withTenantDb(s.tenantId, pool(), (db) =>
        db
          .update(schema.mailboxMapping)
          .set({
            ...(typeof allow === 'boolean' ? { allowApplyDeletions: allow } : {}),
            ...(typeof auto === 'boolean' ? { autoApplyRelocations: auto } : {}),
          })
          .where(eq(schema.mailboxMapping.id, s.mappingId))
          .returning({
            allow: schema.mailboxMapping.allowApplyDeletions,
            auto: schema.mailboxMapping.autoApplyRelocations,
          }),
      );
      log.warn(
        `[api] ${s.mappingId}: apply flags set (allowApplyDeletions=${updated[0]?.allow}, ` +
          `autoApplyRelocations=${updated[0]?.auto}) by ${req.userId ?? 'unknown'}`,
      );
      const body: ApplyDeletionsFlag = {
        allowApplyDeletions: updated[0]?.allow === true,
        autoApplyRelocations: updated[0]?.auto === true,
        source: 'mapping',
      };
      res.json(body);
    } catch (error) {
      serverError(res, 'apply_flag_change_failed', 'changing the apply-deletions flag', error);
    }
  },
);

export default router;
