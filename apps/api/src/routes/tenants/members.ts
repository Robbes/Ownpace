// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Tenant Members Routes
 * 
 * Manage users within a tenant (invite, remove, update roles).
 * All endpoints require authentication and enforce tenant isolation.
 * 
 * SECURITY: All tenant-data queries use withTenantDb for RLS enforcement.
 * tenant_id is ALWAYS from req.tenantId (authenticated context), never from client input.
 */

import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { authenticate, requireRole, getDbPool, withTenantDb } from '../../middleware/auth.ts';
import type { AuthenticatedRequest } from '../../types/api.ts';
import { eq, and, or, sql } from 'drizzle-orm';
import * as schema from '@openmig/managed/schema-managed';
import { PgLedger } from '@openmig/ledger';
import type { PgDatabase } from '@openmig/ledger';
import type { TenantId } from '@openmig/shared';
import {
  countActiveOwners,
  demotesLastOwner,
  removesLastOwner,
  changesOwnerWithoutPermission,
  grantsOwnerWithoutPermission,
  isActiveOwnerAmong,
  isSelfRemoval,
} from './member-guards.ts';
import { serverFault } from '../../server-fault.ts';
import { mailInvitation, SEND_AGAIN_AFTER, sendAgainAfterSeconds } from './invitation-mail.ts';

const router = Router();

/**
 * What a member's removal is recorded under in `audit_log`, as `operator.sh
 * leave` records its own (`MEMBERSHIP_REMOVED_ACTION`, `scripts/operator.ts`).
 *
 * The removal deletes the member row, so this record is what is left to say
 * the person was let in, and when. `deploy/compose/idp-strays.sh` reads it and
 * keeps their sign-in account until 7 days after the newest such record, then
 * removes it (workplan 0135 T8 and open question 13): privacy §9's 30 days
 * from creation are for an account "that we never let in".
 * `a-member-removed-is-recorded.unit.test.ts` holds the route, `operator.ts`
 * and the script to one spelling.
 */
export const MEMBER_REMOVED_ACTION = 'member.removed';

/** A refusal a membership change answers with, decided inside its transaction. */
type Refusal = { readonly status: 400 | 403 | 404; readonly body: { error: string; message: string } };

const MEMBER_NOT_FOUND: Refusal = { status: 404, body: { error: 'Not found', message: 'Member not found' } };
const forbidden = (message: string): Refusal => ({ status: 403, body: { error: 'Forbidden', message } });
const badRequest = (message: string): Refusal => ({ status: 400, body: { error: 'Bad Request', message } });

/**
 * THE OWNER ROWS AND THE TARGET, LOCKED (workplan 0137 T3 (b); the owner,
 * 2026-10-04: "two demotions at once cannot both pass").
 *
 * Read with `FOR UPDATE` inside the transaction that writes, so the count a
 * guard reads is the count when the write lands. Two owners demoting or
 * removing each other at once queue here, and the second reads the rows the
 * first has written: a demoted owner's row no longer matches, a removed one is
 * gone. Every owner row is locked, whatever its status, so an invitation as
 * owner is not accepted or declined halfway through either. The target comes
 * in the same statement when it is not an owner. Postgres says which row is
 * the target, since it compares uuids and not strings: an id written in
 * capitals is the same member here as in GET.
 *
 * Only active owners count (`countActiveOwners`), as `other_owners` in
 * `apps/api/src/scripts/operator.ts` counts them: an invitation as owner, or
 * a declined one, used to count as a second owner and let the only real one
 * go.
 *
 * Whether the requester is an owner comes from the same rows
 * (`requesterIsOwner`). An owner's own row is one of the owner rows, so no
 * other read is needed. `authenticate` read the role before the lock: an owner
 * demoted or removed while their request waited was still an owner there, and
 * could demote or remove another owner, or make themselves owner again.
 */
async function lockOwnersAndTarget(
  db: PgDatabase,
  tenantId: string,
  memberId: string,
  requesterUserId: string | undefined,
) {
  const rows = await db
    .select({
      id: schema.tenantMember.id,
      userId: schema.tenantMember.userId,
      role: schema.tenantMember.role,
      status: schema.tenantMember.status,
      isTarget: sql<boolean>`${schema.tenantMember.id} = ${memberId}`,
    })
    .from(schema.tenantMember)
    .where(
      and(
        eq(schema.tenantMember.tenantId, tenantId),
        or(eq(schema.tenantMember.role, 'owner'), eq(schema.tenantMember.id, memberId)),
      ),
    )
    .for('update');
  return {
    target: rows.find((row) => row.isTarget),
    activeOwners: countActiveOwners(rows),
    requesterIsOwner: isActiveOwnerAmong(rows, requesterUserId),
  };
}

// Lazy pool initialization - created on first use, not at module load
let _dbPool: ReturnType<typeof getDbPool> | null = null;
function getSharedPool() {
  if (!_dbPool) {
    _dbPool = getDbPool();
  }
  return _dbPool;
}

/**
 * OWNER OR ADMIN, AND NOTHING BELOW, until every write names its roles
 * (workplan 0137 T7; the owner chose it on 2026-09-28, T0 option (b)).
 *
 * `member` and `viewer` still exist in the database, and rows that hold one
 * still read and list. What stops is granting one: the Team page called a
 * viewer read-only, and 36 write routes check only that the caller belongs to
 * the organisation, so a viewer could delete a migration or repoint its target
 * (0137 §1, §4). A role whose name promises less than it allows is not offered.
 * T2's PR, which gates those routes, widens these two schemas again.
 *
 * The refusal is a code the Team page says in the reader's language, with the
 * English beside it for everything else, as `too_many_tests` does.
 */
const ALPHA_ROLES = ['owner', 'admin'] as const;

const OWNER_OR_ADMIN_ONLY = {
  error: 'owner_or_admin_only',
  message: 'During the Alpha, a person can only be an owner or an admin.',
} as const;

/**
 * True when the body named a role, as a string, and that role is the ONLY
 * thing wrong with it, so the answer is the alpha's sentence.
 *
 * Anything else keeps the validation answer with every issue in `details`: a
 * body with a bad address as well is told both at once rather than in two
 * round trips, and a body with no role at all is told the role is missing,
 * not about the alpha. (Zod 4 reports a missing or non-string enum as the same
 * `invalid_value` at `role` as a wrong one, so the body is asked, not the
 * issue.)
 */
function refusedOverRole(error: z.ZodError, body: unknown): boolean {
  const role = (body as { role?: unknown } | null | undefined)?.role;
  return (
    typeof role === 'string' &&
    error.issues.every(
      (issue) =>
        issue.path.length === 1 && issue.path[0] === 'role' && issue.code === 'invalid_value',
    )
  );
}

// Schema validation
const InviteMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(ALPHA_ROLES),
});

const UpdateMemberRoleSchema = z.object({
  role: z.enum(ALPHA_ROLES),
});

/**
 * GET /api/tenants/:tenantId/members
 * 
 * List all members of a tenant
 */
router.get(
  '/',
  authenticate,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { tenantId: _tenantId } = req.params;
      const tenantId = req.tenantId;
      
      if (!tenantId) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Tenant ID not found in authentication context',
        });
      }

      const members = await withTenantDb(tenantId, getSharedPool(), async (db) => {
        return await db.select({
          id: schema.tenantMember.id,
          tenantId: schema.tenantMember.tenantId,
          userId: schema.tenantMember.userId,
          email: schema.tenantMember.email,
          role: schema.tenantMember.role,
          status: schema.tenantMember.status,
          // So the page offers Send again only for an invitation it made
          // (0156 T3): a granted access request was mailed by its grant.
          origin: schema.tenantMember.origin,
          invitedAt: schema.tenantMember.invitedAt,
          joinedAt: schema.tenantMember.joinedAt,
          createdAt: schema.tenantMember.createdAt,
          updatedAt: schema.tenantMember.updatedAt,
        })
        .from(schema.tenantMember)
        .where(eq(schema.tenantMember.tenantId, tenantId));
      });

      res.json({ members });
    } catch (error) {
      serverFault(res, 'list_failed', 'listing the members', error);
    }
  }
);

/**
 * POST /api/tenants/:tenantId/members
 * 
 * Invite a new member to the tenant
 */
router.post(
  '/',
  authenticate,
  requireRole('owner', 'admin'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { tenantId: _tenantId } = req.params;
      const tenantId = req.tenantId;
      const body = InviteMemberSchema.parse(req.body);

      if (!tenantId) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Tenant ID not found in authentication context',
        });
      }

      // Granting owner is owner-only on EVERY door (member-guards.ts): an
      // invitation as owner is a grant that lands on acceptance.
      if (grantsOwnerWithoutPermission(body.role, req.userRole === 'owner')) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Only an owner can grant the owner role',
        });
      }

      const result = await withTenantDb(tenantId, getSharedPool(), async (db) => {
        // Refuse a duplicate BEFORE inserting (0039 T5): the pending:UUID
        // placeholder below defeats the UNIQUE(tenant_id, user_id) constraint
        // by design, so without this check a second invite for the same email
        // silently created a second row — and which row's role wins on
        // acceptance was undefined. The refusal names the row that exists;
        // it renders verbatim through the screen's inviteError plumbing.
        const existing = await db
          .select({ status: schema.tenantMember.status, role: schema.tenantMember.role })
          .from(schema.tenantMember)
          .where(
            and(
              eq(schema.tenantMember.tenantId, tenantId),
              eq(schema.tenantMember.email, body.email),
            ),
          );
        const live = existing.find((m) => m.status === 'active' || m.status === 'invited');
        if (live) {
          return { duplicate: live } as const;
        }

        const inserted = await db.insert(schema.tenantMember).values({
          tenantId,
          // The invitee has no user id until they accept. user_id is NOT NULL and
          // UNIQUE(tenant_id, user_id), so use a unique placeholder (never the
          // inviter's id — that both misattributes identity and collides on a
          // second invite). It's replaced with the real user id on acceptance.
          userId: `pending:${randomUUID()}`,
          email: body.email,
          role: body.role,
          status: 'invited',
          invitedAt: new Date(),
        }).returning();
        return { inserted: inserted[0] } as const;
      });

      if ('duplicate' in result && result.duplicate) {
        res.status(409).json({
          error: 'Conflict',
          message:
            result.duplicate.status === 'invited'
              ? `${body.email} already has an open invitation (as ${result.duplicate.role}). ` +
                'Use Send again on that row, or remove it first if you want a new one.'
              : `${body.email} is already a member of this organization (as ${result.duplicate.role}).`,
        });
        return;
      }

      // THE INVITED PERSON IS TOLD (workplan 0156 T3; the owner, 2026-10-03).
      // After the commit and outside it, as the access grant's mail is: the
      // invitation exists whatever the mail server does, and the answer says
      // what became of the mail so the screen can say what is left to do.
      const inserted = result.inserted!;
      const notified = await mailInvitation(
        getSharedPool(),
        tenantId,
        { memberId: inserted.id, email: inserted.email },
        inviterOf(req),
      );
      res.status(201).json({ ...inserted, notified });
    } catch (error) {
      if (error instanceof z.ZodError && refusedOverRole(error, req.body)) {
        res.status(400).json(OWNER_OR_ADMIN_ONLY);
      } else if (error instanceof z.ZodError) {
        res.status(400).json({
          error: 'Validation error',
          details: error.issues,
        });
      } else {
        serverFault(res, 'invite_failed', 'inviting this member', error);
      }
    }
  }
);

/** Who an invitation mail says it is from: the inviter's address, when their token carried one. */
function inviterOf(req: AuthenticatedRequest): string | undefined {
  return req.userEmail?.trim() || undefined;
}

/**
 * POST /api/tenants/:tenantId/members/:memberId/resend
 *
 * Mail an open invitation again (workplan 0156 T3): the first mail went to
 * spam, or was never sent because this deployment had no mail then. Only an
 * invitation somebody made on this page (`origin = 'invited'`) and that is
 * still open; a person who joined or declined is not mailed about it again,
 * and a granted access request got its own mail. At most once in ten minutes
 * per invitation, and within the organisation's daily allowance.
 */
router.post(
  '/:memberId/resend',
  authenticate,
  requireRole('owner', 'admin'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const tenantId = req.tenantId;
      const { memberId } = req.params;
      if (!tenantId || !memberId || Array.isArray(memberId)) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Tenant ID and member ID required',
        });
      }

      const [member] = await withTenantDb(tenantId, getSharedPool(), (db) =>
        db
          .select({
            id: schema.tenantMember.id,
            email: schema.tenantMember.email,
            status: schema.tenantMember.status,
            origin: schema.tenantMember.origin,
          })
          .from(schema.tenantMember)
          .where(
            and(
              eq(schema.tenantMember.id, memberId),
              eq(schema.tenantMember.tenantId, tenantId),
            ),
          ),
      );
      if (!member) {
        return res.status(404).json({ error: 'Not found', message: 'Member not found' });
      }
      if (member.status !== 'invited' || member.origin !== 'invited') {
        return res.status(409).json({
          error: 'Conflict',
          message:
            member.status === 'invited'
              ? `${member.email} asked for access and was granted it, and was mailed then; there ` +
                'is no invitation of this page to send again.'
              : `${member.email} has no open invitation to send again (${member.status}).`,
        });
      }
      const wait = sendAgainAfterSeconds(member.id);
      if (wait > 0) {
        res.set('Retry-After', String(wait));
        return res.status(429).json({
          error: 'too_soon',
          message:
            `This invitation was emailed less than ${SEND_AGAIN_AFTER.windowMs / 60_000} minutes ` +
            `ago. Send it again in ${Math.ceil(wait / 60)} minute(s).`,
          retryAfterSeconds: wait,
        });
      }

      const notified = await mailInvitation(
        getSharedPool(),
        tenantId,
        { memberId: member.id, email: member.email },
        inviterOf(req),
      );
      res.json({ id: member.id, notified });
    } catch (error) {
      serverFault(res, 'resend_failed', 'sending this invitation again', error);
    }
  },
);

/**
 * GET /api/tenants/:tenantId/members/:memberId
 *
 * Get member details
 */
router.get(
  '/:memberId',
  authenticate,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { memberId } = req.params;
      const tenantId = req.tenantId;
      
      if (!tenantId || !memberId || Array.isArray(memberId)) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Tenant ID and member ID required',
        });
      }

      const members = await withTenantDb(tenantId, getSharedPool(), async (db) => {
        return await db.select({
          id: schema.tenantMember.id,
          tenantId: schema.tenantMember.tenantId,
          userId: schema.tenantMember.userId,
          email: schema.tenantMember.email,
          role: schema.tenantMember.role,
          status: schema.tenantMember.status,
          invitedAt: schema.tenantMember.invitedAt,
          joinedAt: schema.tenantMember.joinedAt,
          createdAt: schema.tenantMember.createdAt,
          updatedAt: schema.tenantMember.updatedAt,
        })
        .from(schema.tenantMember)
        .where(
          and(
            eq(schema.tenantMember.id, memberId),
            eq(schema.tenantMember.tenantId, tenantId),
          )
        );
      });

      if (members.length === 0) {
        res.status(404).json({
          error: 'Not found',
          message: 'Member not found',
        });
        return;
      }

      res.json(members[0]);
    } catch (error) {
      serverFault(res, 'read_failed', 'reading this member', error);
    }
  }
);

/**
 * PATCH /api/tenants/:tenantId/members/:memberId
 *
 * Update member role. Only an owner may make an owner or change an owner's
 * role, and the last active owner keeps theirs (0137 T3).
 */
router.patch(
  '/:memberId',
  authenticate,
  requireRole('owner', 'admin'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { memberId } = req.params;
      const tenantId = req.tenantId;
      const body = UpdateMemberRoleSchema.parse(req.body);

      if (!tenantId || !memberId || Array.isArray(memberId)) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Tenant ID and member ID required',
        });
      }

      // The guards and the write in ONE transaction, with the owner rows and
      // the target locked (0137 T3 (b)): the count a guard reads is the count
      // when the write lands, and so is whether the caller is an owner.
      const outcome = await withTenantDb(tenantId, getSharedPool(), async (db) => {
        const { target, activeOwners, requesterIsOwner } = await lockOwnersAndTarget(
          db,
          tenantId,
          memberId,
          req.userId,
        );
        if (!target) return { refused: MEMBER_NOT_FOUND };

        // Granting the owner role is owner-only — an admin must not self-escalate.
        if (grantsOwnerWithoutPermission(body.role, requesterIsOwner)) {
          return { refused: forbidden('Only an owner can grant the owner role') };
        }

        // Demoting an owner is owner-only too (0137 T3 (c)).
        if (changesOwnerWithoutPermission(target.role, requesterIsOwner)) {
          return { refused: forbidden("Only an owner can change an owner's role") };
        }

        // Never demote the tenant's last active owner (would leave it with no
        // owner). Only the one active owner demoting themselves gets here.
        if (demotesLastOwner(target, body.role, activeOwners)) {
          return { refused: badRequest('Cannot demote the last owner') };
        }

        const [updated] = await db.update(schema.tenantMember)
          .set({ role: body.role, updatedAt: new Date() })
          .where(
            and(
              eq(schema.tenantMember.id, memberId),
              eq(schema.tenantMember.tenantId, tenantId),
            )
          )
          .returning();
        return updated ? { updated } : { refused: MEMBER_NOT_FOUND };
      });

      if (outcome.refused) {
        res.status(outcome.refused.status).json(outcome.refused.body);
        return;
      }
      const updatedMember = outcome.updated;

      res.json({
        id: updatedMember.id,
        tenantId: updatedMember.tenantId,
        role: updatedMember.role,
        updatedAt: updatedMember.updatedAt,
      });
    } catch (error) {
      if (error instanceof z.ZodError && refusedOverRole(error, req.body)) {
        res.status(400).json(OWNER_OR_ADMIN_ONLY);
      } else if (error instanceof z.ZodError) {
        res.status(400).json({
          error: 'Validation error',
          details: error.issues,
        });
      } else {
        serverFault(res, 'update_failed', 'updating this member', error);
      }
    }
  }
);

/**
 * DELETE /api/tenants/:tenantId/members/:memberId
 *
 * Remove a member from the tenant, or withdraw an invitation. Nobody removes
 * themselves, only an owner removes an owner, and the last active owner stays
 * (0137 T3).
 */
router.delete(
  '/:memberId',
  authenticate,
  requireRole('owner', 'admin'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { memberId } = req.params;
      const tenantId = req.tenantId;
      
      if (!tenantId || !memberId || Array.isArray(memberId)) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Tenant ID and member ID required',
        });
      }

      // The guards, the removal and its record in ONE transaction, with the
      // owner rows and the target locked (0137 T3 (b)): the count a guard
      // reads is the count when the removal lands, and a record that cannot
      // be written rolls the removal back, never a removal left unrecorded.
      const refused = await withTenantDb(tenantId, getSharedPool(), async (db) => {
        const { target, activeOwners, requesterIsOwner } = await lockOwnersAndTarget(
          db,
          tenantId,
          memberId,
          req.userId,
        );
        if (!target) return MEMBER_NOT_FOUND;

        // Prevent removing yourself — compare the member's USER id (not its row id,
        // which is what :memberId is) to the authenticated user's id.
        if (isSelfRemoval(req.userId, target.userId)) {
          return badRequest('Cannot remove yourself from the tenant');
        }

        // Removing an owner is owner-only (0137 T3 (c)).
        if (changesOwnerWithoutPermission(target.role, requesterIsOwner)) {
          return forbidden('Only an owner can remove an owner');
        }

        // Prevent removing the last active owner. No request reaches this
        // today: the caller is an active owner other than the target, so two
        // are left. It stays in case either guard above ever changes.
        if (removesLastOwner(target, activeOwners)) {
          return badRequest('Cannot remove the last owner');
        }

        // The detail names the subject, which is what the record is for, and
        // no address (0137 T4). It names the row as the delete found it. The
        // lock keeps an invitee's first sign-in (claimRequestedMembership,
        // auth.ts), which turns a `pending:` placeholder into their subject,
        // from landing in between; a record of the placeholder would leave the
        // strays duty taking their account for one nobody let in (0135 T8).
        const [gone] = await db.delete(schema.tenantMember)
          .where(
            and(
              eq(schema.tenantMember.id, memberId),
              eq(schema.tenantMember.tenantId, tenantId),
            )
          )
          .returning({
            id: schema.tenantMember.id,
            userId: schema.tenantMember.userId,
            role: schema.tenantMember.role,
            status: schema.tenantMember.status,
          });
        if (!gone) return MEMBER_NOT_FOUND;
        await new PgLedger(db).recordAuditEvent(tenantId as TenantId, {
          actor: req.userId ?? 'unknown',
          action: MEMBER_REMOVED_ACTION,
          entity: 'member',
          detail: {
            memberId: gone.id,
            userId: gone.userId,
            role: gone.role,
            status: gone.status,
            via: 'the Team page',
          },
        });
        return null;
      });

      if (refused) {
        res.status(refused.status).json(refused.body);
        return;
      }
      res.status(204).send();
    } catch (error) {
      serverFault(res, 'remove_failed', 'removing this member', error);
    }
  }
);

export default router;
