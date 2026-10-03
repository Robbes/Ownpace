// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The owner's surface for a migration's own links: list and revoke (workplan
 * 0108 T3). Issuing one is over: a link is the person's (ADR-0035, amended
 * 2026-09-29; the owner, 2026-10-03: *"yes, replace the per-migration
 * links"*), made on their page for all of their migrations
 * (`person-link-routes.ts`).
 *
 * ## What is left here, and why
 *
 * A migration's link already sent is honoured until it expires (at most 30
 * days for a grant, 180 for a progress page): breaking a link somebody already
 * received would teach them that links from their organisation fail. So the
 * owner can still SEE those links here, with their states, and REVOKE them,
 * which is the kill switch every door needs. `mapping-link-store.ts` still
 * verifies them, unchanged.
 *
 * The issue door stays too, refusing in words, rather than going: a bookmark,
 * a script or a page from an older build that still presses it is told where
 * links are made now, instead of meeting a 404. It writes nothing.
 *
 * ## Shown once, never again
 *
 * `GET` answers with state and dates and never a URL: the table holds a
 * sha256, so it could not show one if it wanted to.
 */

import { Router } from 'express';
import type { Response } from 'express';
import { and, eq } from 'drizzle-orm';
import * as schema from '@openmig/ledger';
import { listMappingLinks, revokeMappingLink } from '@openmig/ledger';
import { readPersonOfMigration } from '@openmig/managed';
import { authenticate, getDbPool, requireRole, withTenantDb } from '../../middleware/auth.ts';
import type { AuthenticatedRequest } from '../../types/api.ts';
import { serverFault } from '../../server-fault.ts';

const router = Router({ mergeParams: true });

let _dbPool: ReturnType<typeof getDbPool> | null = null;
function pool() {
  if (!_dbPool) _dbPool = getDbPool();
  return _dbPool;
}

/**
 * Who may hand out access to a migration: the same two roles that may change
 * the migration itself. A grant link is a door into one mapping, and deciding
 * who walks through a door is an owner's decision, never a viewer's.
 */
const MAY_ISSUE = ['owner', 'admin'] as const;

/**
 * Resolve `:mappingId` for the authenticated tenant, or answer and return null.
 *
 * Deliberately narrower than `operating-routes.ts`'s `scope`: these routes need
 * the mapping to exist and to be this tenant's, and nothing about its
 * lifecycle.
 */
async function scopedMapping(
  req: AuthenticatedRequest,
  res: Response,
): Promise<{ tenantId: string; mappingId: string } | null> {
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
      .select({ id: schema.mailboxMapping.id })
      .from(schema.mailboxMapping)
      .where(
        and(eq(schema.mailboxMapping.id, mappingId), eq(schema.mailboxMapping.tenantId, tenantId)),
      ),
  );
  if (!rows[0]) {
    res.status(404).json({ error: 'Not found', message: 'Mapping not found' });
    return null;
  }
  return { tenantId, mappingId };
}

/** Where a link is made now, for this migration's person or for nobody yet. */
export const LINKS_ARE_PER_PERSON = 'links_are_per_person';

/**
 * POST /api/migrations/:mappingId/links — refused, in words (ADR-0035, amended
 * 2026-09-29; the owner, 2026-10-03: *"yes, replace the per-migration
 * links"*).
 *
 * A link is the person's: one for all of their migrations, made on their page.
 * 409 names that person, with their id for a page to link to, or says that the
 * migration belongs to nobody yet and is given a person first. The role is
 * still asked first, as for every door that used to issue: a viewer is told
 * 403, as before. Nothing is written.
 */
router.post(
  '/:mappingId/links',
  authenticate,
  requireRole(...MAY_ISSUE),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const s = await scopedMapping(req, res);
      if (!s) return;
      const person = await withTenantDb(s.tenantId, pool(), (db) =>
        readPersonOfMigration(db, s.tenantId, s.mappingId),
      );
      if (person) {
        return void res.status(409).json({
          error: LINKS_ARE_PER_PERSON,
          reason:
            `Links are made per person now: one for all of ${person.displayName}'s migrations. ` +
            'Make it on their page.',
          personId: person.id,
        });
      }
      res.status(409).json({
        error: LINKS_ARE_PER_PERSON,
        reason:
          'Links are made per person now, and this migration is not with a person yet. ' +
          'Say who it is for on its page, then make the link on theirs.',
      });
    } catch (error) {
      serverFault(res, 'link_issue_failed', 'answering for a migration’s link', error);
    }
  },
);

/**
 * GET /api/migrations/:mappingId/links — what doors exist, and their state.
 *
 * Never a URL and never a secret: the table holds a hash, so this could not
 * show one if it wanted to. Readable by anyone who may see the mapping — seeing
 * that a link exists is not being able to use it, and an owner's colleague
 * chasing a stalled migration needs exactly this answer.
 */
router.get(
  '/:mappingId/links',
  authenticate,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const s = await scopedMapping(req, res);
      if (!s) return;
      const links = await withTenantDb(s.tenantId, pool(), (db) =>
        listMappingLinks(db, { tenantId: s.tenantId, mappingId: s.mappingId }),
      );
      res.json({
        links: links.map((l) => ({
          id: l.id,
          purpose: l.purpose,
          state: l.state,
          createdAt: l.createdAt.toISOString(),
          createdBy: l.createdBy,
          expiresAt: l.expiresAt.toISOString(),
          usedAt: l.usedAt ? l.usedAt.toISOString() : null,
          revokedAt: l.revokedAt ? l.revokedAt.toISOString() : null,
        })),
      });
    } catch (error) {
      serverFault(res, 'link_list_failed', 'listing the grant links', error);
    }
  },
);

/**
 * DELETE /api/migrations/:mappingId/links/:linkId — the kill switch.
 *
 * Idempotent by design: revoking an already-revoked link answers 200, because
 * an owner pressing twice means the same thing both times and an error would
 * suggest the door is somehow still open. `revoked: false` distinguishes "was
 * already revoked" from "just revoked" for anything that cares; nothing has to.
 *
 * A link id that is not this tenant's answers 404 — the store's own `WHERE`
 * carries the tenant, so a wrong id cannot revoke somebody else's door even if
 * the mapping check were bypassed.
 */
router.delete(
  '/:mappingId/links/:linkId',
  authenticate,
  requireRole(...MAY_ISSUE),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const s = await scopedMapping(req, res);
      if (!s) return;
      const { linkId } = req.params;
      if (!linkId || Array.isArray(linkId)) {
        return void res.status(400).json({ error: 'linkId is required' });
      }

      const revoked = await withTenantDb(s.tenantId, pool(), (db) =>
        revokeMappingLink(db, { tenantId: s.tenantId, linkId }),
      );
      if (revoked) return void res.json({ revoked: true });

      // Not revoked: either already revoked, or not a link of this tenant's.
      // Tell those apart by looking, rather than by guessing — "we could not
      // find it" and "it was already off" are different things to an owner
      // checking whether they are safe.
      const existing = await withTenantDb(s.tenantId, pool(), (db) =>
        listMappingLinks(db, { tenantId: s.tenantId, mappingId: s.mappingId }),
      );
      if (existing.some((l) => l.id === linkId)) return void res.json({ revoked: false });
      res.status(404).json({ error: 'Not found', message: 'No such link on this migration' });
    } catch (error) {
      serverFault(res, 'link_revoke_failed', 'revoking a grant link', error);
    }
  },
);

export default router;
