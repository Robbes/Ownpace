// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The progress page's one route (workplan 0122 T3, ADR-0035's second lifetime).
 *
 * Beside `grant.ts` rather than inside `migrations/`, and for the identical
 * reason: `authenticateMappingLink` attaches a mapping and a tenant and **no
 * identity at all**. A route under `migrations/` sits behind `authenticate` and
 * can read a `userId`; a route here cannot, because there is no user and never
 * will be.
 *
 * ## Why this route exists separately from the grant one
 *
 * They authenticate the same table with different purposes, and the difference
 * is the whole design. `verifyMappingLink` refuses a `grant` token here and a
 * `view` token there, so the two pages cannot be reached through each other's
 * address — which matters because their lifetimes differ by a factor of
 * twenty-five, and a credential link that could be opened at a progress URL
 * would inherit the longer window by accident.
 *
 * ## What a holder may learn, and the sentence that decides it
 *
 * ADR-0035 buys the longer window with one restriction:
 *
 * > *"the progress page is longer-lived but revocable, and **carries counts and
 * > states rather than content**, which is what makes the longer window
 * > acceptable."*
 *
 * `viewRowFor` in `@openmig/shared` is where that is enforced, field by field,
 * with a guard that fails when the shared status contract grows one
 * (`scripts/a-stranger-sees-counts-and-states.unit.test.ts`). This file does the
 * reading; it does not get to decide what crosses.
 *
 * It answers: who is asking, where the migration is in its life, whether
 * anything has run at all, one row per domain, and when the link stops working.
 * It does not answer with the mapping id, the tenant id, the mapping's name,
 * the owner's email, any address, any folder, any file, any other migration, or
 * the provider's own error prose.
 *
 * ## A GET that changes nothing, and here that is not a nicety
 *
 * The grant route needed it so a chat preview could not burn a single-use link.
 * This page is *meant* to be opened again — `mapping-link-store.ts:203` exempts
 * `view` from single-use for exactly this reason — so "changes nothing" is the
 * ordinary case rather than the edge one.
 */

import { Router } from 'express';
import type { RequestHandler, Response } from 'express';
import { and, eq } from 'drizzle-orm';
import * as schema from '@openmig/ledger';
import { PgLedger, PgMigrationStatusStore } from '@openmig/ledger';
import {
  MAPPING_LIFECYCLES,
  buildDomainStatusReports,
  viewRowFor,
  type MappingLifecycle,
  type MappingId,
  type MigrationView,
  type TenantId,
} from '@openmig/shared';
import { authenticateMappingLink, getDbPool, withTenantDb } from '../middleware/auth.ts';
import type { MappingLinkRequest } from '../types/api.ts';
import { serverFault } from '../server-fault.ts';

const router = Router();

let _dbPool: ReturnType<typeof getDbPool> | null = null;
function pool() {
  if (!_dbPool) _dbPool = getDbPool();
  return _dbPool;
}

/**
 * Link authentication, with the database resolved on the FIRST REQUEST.
 *
 * The same deferral `grant.ts` needed and for the same reason: taking the pool
 * eagerly would call `getDbPool()` at import, which throws when `DATABASE_URL`
 * is unset and makes merely importing the router depend on a configured
 * database.
 */
const linkAuth: RequestHandler = (req, res, next) =>
  authenticateMappingLink('view', pool())(req, res, next);

/**
 * GET /api/view/:link — counts and states for the person being migrated.
 *
 * The refusal for a mapping that no longer exists is written to be FORWARDED,
 * like every other sentence a link holder reads (`grant.ts`'s `notReady`): they
 * cannot fix it from here, and telling them what to say to the person who sent
 * them the link is the only useful thing this page can do.
 */
router.get(
  '/:link',
  linkAuth,
  async (req: MappingLinkRequest, res: Response) => {
    try {
      const { tenantId, mappingId, expiresAt } = req.mappingLink!;

      const read = await withTenantDb(tenantId, pool(), async (db) => {
        const rows = await db
          .select({
            organisation: schema.tenant.name,
            status: schema.mailboxMapping.status,
          })
          .from(schema.mailboxMapping)
          .innerJoin(schema.tenant, eq(schema.tenant.id, schema.mailboxMapping.tenantId))
          .where(
            and(
              eq(schema.mailboxMapping.id, mappingId),
              eq(schema.mailboxMapping.tenantId, tenantId),
            ),
          );
        const mapping = rows[0];
        if (!mapping) return null;

        const [domainStatus, failures] = await Promise.all([
          new PgMigrationStatusStore(db).getStatus(tenantId as TenantId, mappingId as MappingId),
          // The same two counts the owner's board derives, from the same queue
          // — `buildDomainStatusReports` is the ONE place that derivation lives
          // (0033 T5), so this page cannot come to disagree with the owner's
          // about how many items are waiting.
          new PgLedger(db).listFailures(tenantId as TenantId, mappingId as MappingId),
        ]);
        return { mapping, domainStatus, failures };
      });

      if (!read) {
        return void res.status(409).json({
          error: 'not_found',
          reason:
            'This migration no longer exists, so there is nothing to show. Nothing you can do ' +
            'from here will fix that; please tell the person who sent you the link.',
        });
      }

      const { mapping, domainStatus, failures } = read;
      if (!MAPPING_LIFECYCLES.includes(mapping.status as MappingLifecycle)) {
        // Throw rather than coerce, the same as `operating-routes.ts` and the
        // appliance's `/status` (hard rule 9). A state the CHECK constraint
        // admits and the contract has never heard of is a bug that must be
        // loud, not a page that guesses a word for it.
        throw new Error(
          `mailbox_mapping.status is '${mapping.status}', which is not one of ` +
            `${MAPPING_LIFECYCLES.join(', ')}. The database CHECK constraint should make this ` +
            `impossible; refusing to guess what the migration's state is.`,
        );
      }

      const body: MigrationView = {
        organisation: mapping.organisation,
        state: mapping.status as MappingLifecycle,
        // Absence, not zero. No status row means no pass has ever touched this
        // mapping — the common case in the hour after somebody grants — and
        // five domains reading `0` would tell them it finished and moved
        // nothing. See `MigrationView.started`.
        started: domainStatus.length > 0,
        domains: buildDomainStatusReports(domainStatus, failures).map(viewRowFor),
        expiresAt: expiresAt.toISOString(),
      };
      res.json(body);
    } catch (error) {
      serverFault(res, 'view_read_failed', 'reading this migration', error);
    }
  },
);

export default router;
