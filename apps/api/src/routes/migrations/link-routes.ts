// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The owner's surface for grant links: issue, list, revoke (workplan 0108 T3).
 *
 * Three routes, all of them the OWNER's — authenticated by the ordinary session,
 * scoped to one mapping, and answering with everything about a link except the
 * one thing that matters. `mapping-link-store.ts` holds every decision about
 * what a link IS; this file is the door the owner knocks on.
 *
 * ## The division of labour these routes exist to make real
 *
 * ADR-0035: *"the owner decides who gets a link to manage and grant their own
 * migration"* — and **the admin distributes the link, we never do.** So issuing
 * returns a URL to the owner's own screen and sends nothing: no email, no
 * notification, no address stored anywhere. That is deliberate and it is a
 * feature. Ownpace never learns the migrator's address, which means Ownpace
 * cannot leak it, and the person who decides who gets access is the person who
 * already knows who they are.
 *
 * ## Shown once
 *
 * `POST` is the ONLY response in this codebase that ever contains a link's
 * secret. The table holds a sha256; nothing can recover the token afterwards,
 * so `GET` answers with state and dates and never a URL. An owner who loses a
 * link re-issues, which costs them a click and costs an attacker a link that
 * has already been superseded.
 *
 * ## The refusal comes first
 *
 * Every reason a grant link could not possibly work is checked BEFORE the row
 * is written (`grant-link-readiness.ts`). Nothing is inserted on a refusal, so
 * a refused issue leaves no trace to clean up and no dead link to revoke.
 */

import { Router } from 'express';
import type { Response } from 'express';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import * as schema from '@openmig/ledger';
import {
  DEFAULT_MAPPING_LINK_EXPIRY_DAYS,
  MAPPING_LINK_EXPIRY_DAYS,
  expiryFromDays,
  issueMappingLink,
  listMappingLinks,
  revokeMappingLink,
} from '@openmig/ledger';
import { SecretStore } from '@openmig/core/secret-store';
import { authenticate, getDbPool, requireRole, withTenantDb } from '../../middleware/auth.ts';
import type { AuthenticatedRequest } from '../../types/api.ts';
import { serverFault } from '../../server-fault.ts';
import { grantLinkRefusal, type GrantLinkReadiness } from './grant-link-readiness.ts';

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

const IssueSchema = z.object({
  // 'grant' is the only purpose this route mints. 'view' is reserved in the
  // table (ADR-0035's second lifetime) and deliberately NOT offered here: a
  // purpose the API accepts but no page honours is a link that opens nothing.
  expiryDays: z
    .number()
    .int()
    .refine((d): d is (typeof MAPPING_LINK_EXPIRY_DAYS)[number] =>
      (MAPPING_LINK_EXPIRY_DAYS as readonly number[]).includes(d),
    )
    .optional(),
});

/** The browser-facing address, or null when this deployment cannot say. */
function webUrl(): string | null {
  const raw = process.env.WEB_URL;
  return raw ? raw.replace(/\/+$/, '') : null;
}

/**
 * Resolve `:mappingId` for the authenticated tenant, or answer and return null.
 *
 * Deliberately narrower than `operating-routes.ts`'s `scope`: these routes need
 * the mapping to exist and to be this tenant's, and nothing about its
 * lifecycle. A link may be issued for a mapping in any state — including one
 * that has never run, which is the common case, because the whole point is that
 * it cannot run until somebody grants it.
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

/**
 * Read what the readiness decision needs, and NOTHING ELSE.
 *
 * The credentials are decrypted here and immediately reduced to two booleans —
 * the values never leave this function. That is the point of
 * `grant-link-readiness.ts` taking booleans: the secret's lifetime is these
 * three lines.
 *
 * A source whose credentials cannot be decrypted reads as "not configured"
 * rather than throwing. That is not masking an error (hard rule 9): from the
 * owner's side an unreadable secret and an absent one are the same fact — the
 * consent has no client to run against — and the remedy the refusal names, "add
 * it on the source connection", is the right remedy for both. What must never
 * happen is issuing a link anyway.
 */
async function readReadiness(
  tenantId: string,
  mappingId: string,
): Promise<Omit<GrantLinkReadiness, 'hasWebUrl'>> {
  const rows = await withTenantDb(tenantId, pool(), (db) =>
    db
      .select({ kind: schema.connection.kind, secretRef: schema.connection.secretRef })
      .from(schema.mailboxMapping)
      .innerJoin(schema.mailbox, eq(schema.mailbox.id, schema.mailboxMapping.sourceMailboxId))
      .innerJoin(schema.connection, eq(schema.connection.id, schema.mailbox.connectionId))
      .where(
        and(eq(schema.mailboxMapping.id, mappingId), eq(schema.mailboxMapping.tenantId, tenantId)),
      ),
  );
  const source = rows[0];
  if (!source) return { sourceKind: null, hasClientId: false, hasClientSecret: false };

  let creds: Record<string, unknown> = {};
  try {
    if (source.secretRef) creds = SecretStore.decryptCredentials(source.secretRef);
  } catch {
    creds = {};
  }
  const present = (key: string) => typeof creds[key] === 'string' && creds[key].trim().length > 0;
  return {
    sourceKind: source.kind,
    hasClientId: present('clientId'),
    hasClientSecret: present('clientSecret'),
  };
}

/**
 * POST /api/migrations/:mappingId/links — mint one, and say the URL once.
 *
 * The expiry is the OWNER's choice (the owner's steer, 2026-08-26: control over
 * comfort-by-default), defaulting to seven days when the caller does not say.
 * The response repeats the chosen expiry as a date, because an owner about to
 * paste a link into a chat window should be able to say "this works until
 * Thursday" in the same message.
 */
router.post(
  '/:mappingId/links',
  authenticate,
  requireRole(...MAY_ISSUE),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const s = await scopedMapping(req, res);
      if (!s) return;

      const parsed = IssueSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return void res.status(400).json({
          error: 'invalid_body',
          reason:
            `An expiry of ${MAPPING_LINK_EXPIRY_DAYS.join(', ')} days is offered; ` +
            `send { expiryDays } as one of those, or nothing for ` +
            `${DEFAULT_MAPPING_LINK_EXPIRY_DAYS}.`,
        });
      }

      const readiness = await readReadiness(s.tenantId, s.mappingId);
      const base = webUrl();
      const refusal = grantLinkRefusal({ ...readiness, hasWebUrl: base !== null });
      if (refusal) {
        // 409, not 400: the request is well-formed and the caller is allowed to
        // make it — the deployment is not in a state where it can be honoured.
        // Nothing was written.
        return void res.status(409).json({ error: refusal.code, reason: refusal.reason });
      }

      const days = parsed.data.expiryDays ?? DEFAULT_MAPPING_LINK_EXPIRY_DAYS;
      const issued = await withTenantDb(s.tenantId, pool(), (db) =>
        issueMappingLink(db, {
          tenantId: s.tenantId,
          mappingId: s.mappingId,
          purpose: 'grant',
          createdBy: req.userId ?? 'unknown',
          expiresAt: expiryFromDays(days),
        }),
      );

      res.status(201).json({
        id: issued.id,
        // The one time this exists in a response. `base` is non-null here —
        // `web_url_unset` refused above.
        url: `${base}/grant/${issued.token}`,
        expiresAt: issued.expiresAt.toISOString(),
        expiryDays: days,
        // Said in the payload rather than only in the UI, so the fact survives
        // a screen redesign: ADR-0035's division of labour is the product's,
        // not the template's.
        distribution:
          'Send this to the person yourself — Ownpace does not email it, and cannot show it ' +
          'to you again. If it goes astray, revoke it and issue another.',
      });
    } catch (error) {
      serverFault(res, 'link_issue_failed', 'issuing a grant link', error);
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
