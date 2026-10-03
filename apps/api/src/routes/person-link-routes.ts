// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE OWNER'S DOORS TO A PERSON'S LINK (ADR-0035, amended 2026-09-29; workplan
 * 0153 T5 (b), slice 2).
 *
 *  - `POST /api/people/:personId/links` mints one and says its URL once;
 *  - `GET /api/people/:personId/links` lists them, with their states, never a
 *    secret;
 *  - `DELETE /api/people/:personId/links/:linkId` is the kill switch.
 *
 * They are `link-routes.ts`'s, for a person instead of a migration: owner or
 * admin, the texts accepted before a grant link is made (0139 T3), the
 * deployment's web address known, the live-link limit held under the same lock
 * that holds a migration's links, and the owner's own expiry. A grant link is
 * refused while nothing of the person's can be granted through it, with each
 * migration's own reason, so a link that works at issue is one the grant page
 * can serve (`person-grant-subject.ts` is both halves' reading).
 *
 * **A progress link too** (slice 3), now that the person's progress page
 * exists (`person-progress.ts`): `link-routes.ts`'s rule was that a purpose no
 * page honours is a link that opens nothing. As for a migration's, a progress
 * link grants nothing, so the texts are not asked and the limit does not count
 * it; only the deployment's address is.
 */

import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';
import {
  MAPPING_LINK_LIFETIMES,
  MAPPING_LINK_PURPOSES,
  expiryFromDays,
  type MappingLinkPurpose,
} from '@openmig/ledger';
import { listPersonLinks, readPerson, revokePersonLink } from '@openmig/managed';
import { PERSON_NOT_FOUND } from '@openmig/shared';
import { authenticate, getDbPool, requireRole, withTenantDb } from '../middleware/auth.ts';
import type { AuthenticatedRequest } from '../types/api.ts';
import { serverFault } from '../server-fault.ts';
import { refusedUntilAccepted } from '../conditions-not-accepted.ts';
import { grantLinkAsk, viewLinkRefusal } from './migrations/grant-link-readiness.ts';
import { grantReadiness, readGrantRows } from './migrations/grant-subject.ts';
import { readPersonGrantSubject } from './migrations/person-grant-subject.ts';
import { atTheLimit, issuePersonLinkWithinTheLimit } from './migrations/live-link-limit.ts';

const router = Router({ mergeParams: true });

let _dbPool: ReturnType<typeof getDbPool> | null = null;
function pool() {
  if (!_dbPool) _dbPool = getDbPool();
  return _dbPool;
}

/** The two roles that may hand out a door, as for a migration's link. */
const MAY_ISSUE = ['owner', 'admin'] as const;

/** An id's shape, checked before it reaches a uuid column (`people.ts`'s). */
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Both purposes, and the expiry checked against the purpose, as `link-routes.ts` does. */
const IssueSchema = z
  .object({
    purpose: z.enum(MAPPING_LINK_PURPOSES).optional(),
    expiryDays: z.number().int().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.expiryDays === undefined) return;
    const allowed: readonly number[] = MAPPING_LINK_LIFETIMES[value.purpose ?? 'grant'].days;
    if (!allowed.includes(value.expiryDays)) {
      ctx.addIssue({ code: 'custom', path: ['expiryDays'], message: 'not an offered expiry' });
    }
  });

/** The browser-facing address, or null when this deployment cannot say. */
function webUrl(): string | null {
  const raw = process.env.WEB_URL;
  return raw ? raw.replace(/\/+$/, '') : null;
}

/** The tenant and the person the route names, or the answer already sent. */
async function scopedPerson(
  req: AuthenticatedRequest,
  res: Response,
): Promise<{ tenantId: string; personId: string; name: string; migrations: readonly string[] } | null> {
  const tenantId = req.tenantId;
  if (!tenantId) {
    res.status(401).json({ error: 'Unauthorized', message: 'Tenant ID not found' });
    return null;
  }
  const personId = req.params.personId;
  const notFound = () =>
    void res.status(404).json({ error: PERSON_NOT_FOUND, message: 'There is no such person in this organisation.' });
  if (typeof personId !== 'string' || !ID.test(personId)) {
    notFound();
    return null;
  }
  const person = await withTenantDb(tenantId, pool(), (db) => readPerson(db, tenantId, personId));
  if (!person) {
    notFound();
    return null;
  }
  return {
    tenantId,
    personId,
    name: person.displayName ?? 'This person',
    migrations: person.migrations.map((m) => m.id),
  };
}

/**
 * Why nothing of this person's can be granted through a link, in the owner's
 * words: each of their migrations' own reason from `grantLinkAsk`, once each.
 */
async function whyNothingToGrant(tenantId: string, name: string, migrations: readonly string[]): Promise<string> {
  if (migrations.length === 0) return `${name} has no migrations yet. Add one before making a link.`;
  const reasons = await withTenantDb(tenantId, pool(), async (db) => {
    const found: string[] = [];
    for (const mappingId of migrations) {
      const decided = grantLinkAsk(grantReadiness(await readGrantRows(db, tenantId, mappingId)));
      const reason = decided.ok ? null : decided.refusal.reason;
      if (reason && !found.includes(reason)) found.push(reason);
    }
    return found;
  });
  return (
    `None of ${name}'s migrations can be granted through a link. ` +
    (reasons.length > 0 ? reasons.join(' ') : 'Each names a Google account that is connected already.')
  );
}

router.post(
  '/:personId/links',
  authenticate,
  requireRole(...MAY_ISSUE),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const s = await scopedPerson(req, res);
      if (!s) return;
      const parsed = IssueSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        const offered = MAPPING_LINK_PURPOSES.map((p) => `${p}: ${MAPPING_LINK_LIFETIMES[p].days.join(', ')}`).join('; ');
        return void res.status(400).json({
          error: 'invalid_body',
          reason: `Send { purpose, expiryDays }. The expiries offered, in days, are — ${offered}.`,
        });
      }
      const purpose: MappingLinkPurpose = parsed.data.purpose ?? 'grant';
      // A progress link grants nothing, and is not asked about (0139 T3).
      if (purpose === 'grant' && (await refusedUntilAccepted(res, s.tenantId, req.userId, pool()))) return;

      const base = webUrl();
      const noAddress = viewLinkRefusal({ hasWebUrl: base !== null });
      if (noAddress) return void res.status(409).json({ error: noAddress.code, reason: noAddress.reason });

      if (purpose === 'grant') {
        const subject = await withTenantDb(s.tenantId, pool(), (db) =>
          readPersonGrantSubject(db, s.tenantId, s.personId),
        );
        if (!subject || subject.accounts.every((a) => a.granted || !a.ask.ok)) {
          const reason =
            subject && subject.accounts.some((a) => a.granted)
              ? `Every Google account ${s.name}'s migrations read is connected already, so a link would ask for nothing.`
              : await whyNothingToGrant(s.tenantId, s.name, s.migrations);
          return void res.status(409).json({ error: 'nothing_to_grant', reason });
        }
      }

      const days = parsed.data.expiryDays ?? MAPPING_LINK_LIFETIMES[purpose].fallback;
      const outcome = await withTenantDb(s.tenantId, pool(), (db) =>
        issuePersonLinkWithinTheLimit(db, {
          tenantId: s.tenantId,
          personId: s.personId,
          purpose,
          createdBy: req.userId ?? 'unknown',
          expiresAt: expiryFromDays(days),
        }),
      );
      if (outcome.kind === 'at_the_limit') {
        return void res.status(409).json({
          error: 'grant_links_at_limit',
          reason: atTheLimit(outcome.live, outcome.allowed),
          live: outcome.live,
          limit: outcome.allowed.limit,
        });
      }
      const { issued } = outcome;
      res.status(201).json({
        id: issued.id,
        purpose,
        // The path is the purpose's own word, as for a migration's link.
        url: `${base}/${purpose}/${issued.token}`,
        expiresAt: issued.expiresAt.toISOString(),
        expiryDays: days,
        distribution:
          'Send this to the person yourself — Ownpace does not email it, and cannot show it ' +
          'to you again. If it goes astray, revoke it and issue another.',
      });
    } catch (error) {
      serverFault(res, 'person_link_issue_failed', "issuing this person's link", error);
    }
  },
);

router.get('/:personId/links', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const s = await scopedPerson(req, res);
    if (!s) return;
    const links = await withTenantDb(s.tenantId, pool(), (db) =>
      listPersonLinks(db, { tenantId: s.tenantId, personId: s.personId }),
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
    serverFault(res, 'person_link_list_failed', "listing this person's links", error);
  }
});

router.delete(
  '/:personId/links/:linkId',
  authenticate,
  requireRole(...MAY_ISSUE),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const s = await scopedPerson(req, res);
      if (!s) return;
      const { linkId } = req.params;
      if (typeof linkId !== 'string' || !ID.test(linkId)) {
        return void res.status(404).json({ error: 'Not found', message: 'No such link for this person' });
      }
      const revoked = await withTenantDb(s.tenantId, pool(), (db) =>
        revokePersonLink(db, { tenantId: s.tenantId, personId: s.personId, linkId }),
      );
      if (revoked) return void res.json({ revoked: true });
      const existing = await withTenantDb(s.tenantId, pool(), (db) =>
        listPersonLinks(db, { tenantId: s.tenantId, personId: s.personId }),
      );
      if (existing.some((l) => l.id === linkId)) return void res.json({ revoked: false });
      res.status(404).json({ error: 'Not found', message: 'No such link for this person' });
    } catch (error) {
      serverFault(res, 'person_link_revoke_failed', "revoking this person's link", error);
    }
  },
);

export default router;
