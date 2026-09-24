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
import { HttpTokenRevoker } from '@openmig/connectors';
import {
  MAPPING_LIFECYCLES,
  buildDomainStatusReports,
  viewGrantFor,
  viewRowFor,
  type MappingLifecycle,
  type MappingId,
  type MigrationView,
  type TenantId,
  type TokenRevoker,
} from '@openmig/shared';
import { authenticateMappingLink, getDbPool, withTenantDb } from '../middleware/auth.ts';
import type { MappingLinkRequest } from '../types/api.ts';
import { serverFault } from '../server-fault.ts';
import { withdrawGrant } from './withdraw-grant.ts';

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
            // Whether there is a grant to take back, and whether one was: the
            // page's `grant`. Read as a presence, never decrypted here.
            sourceSecretRef: schema.mailboxMapping.sourceSecretRef,
            grantWithdrawnAt: schema.mailboxMapping.grantWithdrawnAt,
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

        const [domainStatus, failures, adopted] = await Promise.all([
          new PgMigrationStatusStore(db).getStatus(tenantId as TenantId, mappingId as MappingId),
          // The same two counts the owner's board derives, from the same queue
          // — `buildDomainStatusReports` is the ONE place that derivation lives
          // (0033 T5), so this page cannot come to disagree with the owner's
          // about how many items are waiting.
          new PgLedger(db).listFailures(tenantId as TenantId, mappingId as MappingId),
          // And what was left as it already was (0124 T2). This reader needs it
          // more than the owner does, not less: they cannot go and look
          // anywhere else, so a total that does not add up is the end of the
          // road rather than a question they can ask somebody.
          new PgLedger(db).countAdoptedByDomain(tenantId as TenantId, mappingId as MappingId),
        ]);
        return { mapping, domainStatus, failures, adopted };
      });

      if (!read) {
        return void res.status(409).json({
          error: 'not_found',
          reason:
            'This migration no longer exists, so there is nothing to show. Nothing you can do ' +
            'from here will fix that; please tell the person who sent you the link.',
        });
      }

      const { mapping, domainStatus, failures, adopted } = read;
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
        domains: buildDomainStatusReports(domainStatus, failures, adopted).map(viewRowFor),
        expiresAt: expiresAt.toISOString(),
        grant: viewGrantFor(mapping),
      };
      res.json(body);
    } catch (error) {
      serverFault(res, 'view_read_failed', 'reading this migration', error);
    }
  },
);

/**
 * The revocation Google offers, made once and on first use: it reads the
 * global `fetch` at call time, so a test that stubs Google's endpoint reaches
 * it (`connections.ts` makes its own the same way).
 */
let revoker: TokenRevoker | undefined;
const tokenRevoker = (): TokenRevoker => (revoker ??= new HttpTokenRevoker());

/**
 * POST /api/view/:link/withdraw — take back the grant this migration reads the
 * account on (workplan 0108 T8 (c), `withdraw-grant.ts`).
 *
 * A body-less POST, deliberately: it changes something, so it is never a GET a
 * chat preview could follow. Answered 200 with what happened at Google, or 409
 * with the reason there was nothing to take back, in a sentence written for the
 * person holding the link.
 */
router.post(
  '/:link/withdraw',
  linkAuth,
  async (req: MappingLinkRequest, res: Response) => {
    try {
      const { tenantId, mappingId, linkId } = req.mappingLink!;
      const result = await withdrawGrant(pool(), { tenantId, mappingId, linkId }, tokenRevoker());
      if (!result.ok) {
        return void res.status(409).json({ error: result.code, reason: result.reason });
      }
      res.json(result.withdrawal);
    } catch (error) {
      serverFault(res, 'grant_withdraw_failed', 'withdrawing your permission', error);
    }
  },
);

export default router;
