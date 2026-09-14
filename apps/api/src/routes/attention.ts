// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Everything waiting on a person, in one answer (workplan 0028 / 0030 T3).
 *
 * THE SCREEN CALLED "ATTENTION" SHOWED ONE QUEUE OUT OF FIVE. It renders
 * `/api/decisions` — the drift queue — and nothing else, so an owner whose
 * weekly digest said "34 items that could not be copied" opened the tab it
 * pointed at and found it empty (owner report, 2026-09-14). Nothing was
 * wrong with either half: the digest counted five queues, the page read one,
 * and neither knew about the other.
 *
 * This is the read the page was missing. It counts the way the DIGEST counts,
 * by calling the same `summariseQueues` — not a second implementation that
 * agrees today. That is the whole point: two counters for one question is the
 * defect, and a route that recomputed "what is waiting" in its own words
 * would be the same defect with a nicer URL.
 *
 * ## What it does NOT report, and why
 *
 * `autoApplied` — old copies of relocated items removed unattended — is news,
 * not a queue. It is bounded in the digest by the window since the last one;
 * a page has no such window, so the same number would sit there forever with
 * nothing for anybody to do about it. Reported as zero here and left to the
 * mail that can bound it.
 *
 * A `done` migration is skipped BEFORE its reads, the same rule the digest
 * applies (`reportsToDigest`): a finished migration keeps its history and
 * stops nagging.
 *
 * ## What is waiting on the ORGANISATION, not on a migration
 *
 * A pending drift decision — a newly-discovered mailbox — belongs to no
 * mapping yet, which is why it was always counted once. But it was only ever
 * ATTACHED to a mapping, so a tenant whose every migration is `done` carried
 * its decisions nowhere: the screen said "Nothing is waiting. Every migration
 * is running by itself" above a drift queue that was not empty, and neither
 * clause was true.
 *
 * That is the same hole 0043 T4 closed in the digest, in the same shape and
 * with the same rule: the decision queue is read ONCE, hoisted out of the
 * mapping loop so a tenant with nothing reporting still asks; when a mapping
 * reports it rides on the first one, and when none does it comes back as
 * `tenant` instead of being invented onto a row with a mapping id nobody can
 * open.
 *
 * ## A read that failed is not a zero
 *
 * Every queue is read under `guarded`, and a failure becomes a BLIND SPOT
 * carrying the server's own words (hard rule 9). "I found nothing" and "I
 * could not look" arriving as the same empty page is how somebody decides a
 * migration is finished when it is not.
 */

import { Router } from 'express';
import type { Response } from 'express';
import { eq } from 'drizzle-orm';
import * as schema from '@openmig/ledger';
import { PgLedger, PgDecisionStore } from '@openmig/ledger';
import {
  asTenantId,
  asMappingId,
  summariseQueues,
  reportsToDigest,
  wantsAttention,
  type DeletionRow,
  type MappingAttention,
  type MoveRow,
  type TenantAttention,
  type FailureRow,
} from '@openmig/shared';
import { authenticate, getDbPool, withTenantDb } from '../middleware/auth.ts';
import type { AuthenticatedRequest } from '../types/api.ts';
import { serverFault } from '../server-fault.ts';

const router = Router();

let _dbPool: ReturnType<typeof getDbPool> | null = null;
function getSharedPool() {
  if (!_dbPool) _dbPool = getDbPool();
  return _dbPool;
}

/**
 * The mappings this answer covers, and the one column that names them.
 *
 * `name` is selected DELIBERATELY and by name. The digest shipped with
 * `SELECT id, status` and printed a UUID at every owner for want of this
 * column (#946); the same omission here would empty the page's labels the
 * same way, so the query is pinned rather than trusted.
 */
export const ATTENTION_MAPPINGS_SQL = 'SELECT id, name, status FROM mailbox_mapping WHERE tenant_id = $1';

/** One mapping row, as the collector needs to see it. */
export interface AttentionMappingRow {
  readonly id: string;
  readonly name: string | null;
  readonly status: string | null;
}

/** The five reads, per mapping. Each may throw; each throw is a blind spot. */
export interface AttentionReaders {
  deletions(mappingId: string): Promise<readonly DeletionRow[]>;
  moves(mappingId: string): Promise<readonly MoveRow[]>;
  failures(mappingId: string): Promise<readonly FailureRow[]>;
  sharingOpen(mappingId: string): Promise<number>;
  /** Tenant-wide, and asked ONCE per answer whether or not a mapping reports. */
  pendingDecisions(): Promise<number>;
}

/** Everything waiting on this tenant: its migrations, and the tenant itself. */
export interface TenantWideAttention {
  readonly mappings: readonly MappingAttention[];
  /**
   * What is waiting on the ORGANISATION rather than on any one migration.
   *
   * Present only when NO mapping reported, mirroring the digest exactly: with
   * live mappings the decisions already ride on the first one, and reporting
   * them in both places would show one decision as two.
   */
  readonly tenant?: TenantAttention;
}

/**
 * What is waiting, per migration and for the tenant. Never throws for one
 * queue's sake.
 *
 * A SEAM, not wiring: the rules below — skip the finished, count the decision
 * once, a failed read is a blind spot and not a zero, and an organisation with
 * no live migration still gets asked — are the ones an owner feels, and a rule
 * buried inside an express handler is a rule with no test. The appliance's
 * `digest-collect.ts` was separated from its server for the same reason and
 * says so in the same words.
 */
export async function collectTenantAttention(
  rows: readonly AttentionMappingRow[],
  read: AttentionReaders,
): Promise<TenantWideAttention> {
  const out: MappingAttention[] = [];

  // ONCE per tenant, and HOISTED so it is asked even when no mapping reports.
  // Inside the loop it could only ever be attached to a mapping, so the
  // tenant whose every migration is finished — precisely the one nobody is
  // watching — was never asked the question at all.
  let decisionsPending: number | undefined;
  let decisionsBlindSpot: string | undefined;
  try {
    decisionsPending = await read.pendingDecisions();
  } catch (err) {
    // The reason, verbatim (hard rule 9), whichever side it ends up on.
    decisionsBlindSpot = `the decision queue: ${
      err instanceof Error ? err.message : String(err)
    }`;
  }

  for (const row of rows) {
    // Before the reads, so a finished migration costs four queries less as
    // well as costing its owner no line on the screen.
    if (!reportsToDigest(row.status ?? undefined)) continue;

    const blindSpots: string[] = [];
    const guarded = async <T>(what: string, go: () => Promise<T>, fallback: T): Promise<T> => {
      try {
        return await go();
      } catch (err) {
        // The reason, verbatim. A queue that could not be read is a hole in
        // this screen and must be described as one, not rounded to zero.
        blindSpots.push(`${what}: ${err instanceof Error ? err.message : String(err)}`);
        return fallback;
      }
    };

    const deletions = await guarded('the deletions queue', () => read.deletions(row.id), []);
    const moves = await guarded('the moves queue', () => read.moves(row.id), []);
    const failures = await guarded('the failures queue', () => read.failures(row.id), []);
    const sharingOpen = await guarded('the sharing checklist', () => read.sharingOpen(row.id), 0);

    // A drift decision about a new mailbox belongs to no mapping yet, so every
    // mapping claiming it would multiply one decision by however many
    // migrations the tenant has. It rides on the FIRST that reports — the same
    // rule both digest collectors apply, for the same reason — and its own
    // failure rides there too, as a blind spot rather than a zero.
    const first = out.length === 0;
    const pendingDecisions = first ? (decisionsPending ?? 0) : 0;
    if (first && decisionsBlindSpot) blindSpots.push(decisionsBlindSpot);

    out.push(
      summariseQueues(
        { id: row.id, name: row.name },
        {
          deletions,
          moves,
          failures,
          pendingDecisions,
          status: row.status ?? undefined,
          // Not a queue — see this file's header.
          autoApplied: 0,
          sharingOpen,
          blindSpots,
        },
      ),
    );
  }

  // Nothing reported, so the decisions have nowhere to ride. They become the
  // organisation's own line rather than vanishing — 0043 T4's rule, now on
  // the screen as well as in the mail.
  const tenant: TenantAttention = {
    ...(decisionsPending ? { pendingDecisions: decisionsPending } : {}),
    ...(decisionsBlindSpot ? { blindSpots: [decisionsBlindSpot] } : {}),
  };
  const organisationWants =
    tenant.pendingDecisions !== undefined || tenant.blindSpots !== undefined;

  return {
    mappings: out,
    ...(out.length === 0 && organisationWants ? { tenant } : {}),
  };
}

/**
 * GET /api/attention — every queue, every migration, counted once, plus what
 * is waiting on the organisation itself.
 *
 * `?all=true` keeps the migrations that want nothing, so a screen can say
 * "these four are quiet" rather than implying they do not exist. The default
 * is the digest's rule: only what wants a person. It filters MAPPINGS only —
 * `tenant` is never filtered, because it is already the answer to "is anything
 * waiting that belongs to no migration", and dropping it under one query
 * parameter would reopen the hole this route exists to close.
 */
router.get('/', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Tenant ID not found in authentication context',
      });
      return;
    }
    const includeQuiet = req.query['all'] === 'true';

    const attention = await withTenantDb(tenantId, getSharedPool(), async (db) => {
      const ledger = new PgLedger(db);
      const decisions = new PgDecisionStore(db);
      const tenant = asTenantId(tenantId);

      const rows = await db
        .select({
          id: schema.mailboxMapping.id,
          name: schema.mailboxMapping.name,
          status: schema.mailboxMapping.status,
        })
        .from(schema.mailboxMapping)
        .where(eq(schema.mailboxMapping.tenantId, tenantId));

      return collectTenantAttention(rows, {
        deletions: (id) => ledger.listDeletions(tenant, asMappingId(id)),
        moves: (id) => ledger.listMoves(tenant, asMappingId(id)),
        failures: (id) => ledger.listFailures(tenant, asMappingId(id)),
        sharingOpen: async (id) =>
          (await ledger.listShareGrants(tenant, asMappingId(id))).filter((g) => g.state === 'open')
            .length,
        pendingDecisions: async () =>
          (await decisions.list(tenant, { status: 'pending' })).length,
      });
    });

    res.json({
      mappings: includeQuiet ? attention.mappings : attention.mappings.filter(wantsAttention),
      ...(attention.tenant ? { tenant: attention.tenant } : {}),
    });
  } catch (error) {
    serverFault(res, 'attention_failed', 'reading what is waiting', error);
  }
});

export default router;
