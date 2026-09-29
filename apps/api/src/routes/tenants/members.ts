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
import { eq, and, count } from 'drizzle-orm';
import * as schema from '@openmig/managed/schema-managed';
import { PgLedger } from '@openmig/ledger';
import type { TenantId } from '@openmig/shared';
import {
  demotesLastOwner,
  removesLastOwner,
  grantsOwnerWithoutPermission,
  isSelfRemoval,
} from './member-guards.ts';
import { serverFault } from '../../server-fault.ts';

const router = Router();

/**
 * What a member's removal is recorded under in `audit_log`, as `operator.sh
 * leave` records its own (`MEMBERSHIP_REMOVED_ACTION`, `scripts/operator.ts`).
 *
 * The removal deletes the member row, so this record is what is left to say
 * the person was let in. `deploy/compose/idp-strays.sh` reads it and keeps
 * their sign-in account: privacy §9's 30 days are for an account "that we
 * never let in" (workplan 0135 T8). `a-member-removed-is-recorded.unit.test.ts`
 * holds the route, `operator.ts` and the script to one spelling.
 */
export const MEMBER_REMOVED_ACTION = 'member.removed';

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
  message: 'During the alpha, a person can only be an owner or an admin.',
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
      if (grantsOwnerWithoutPermission(body.role, req.userRole)) {
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
                'Remove that invitation first if you want to send a new one.'
              : `${body.email} is already a member of this organization (as ${result.duplicate.role}).`,
        });
        return;
      }

      res.status(201).json(result.inserted);
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
 * Update member role
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

      // Look up the target member's current role + the tenant's owner count
      // (both RLS-scoped) to evaluate the guards below.
      const { target, ownerCount } = await withTenantDb(tenantId, getSharedPool(), async (db) => {
        const targetRows = await db.select({ role: schema.tenantMember.role })
          .from(schema.tenantMember)
          .where(
            and(
              eq(schema.tenantMember.id, memberId),
              eq(schema.tenantMember.tenantId, tenantId),
            )
          );
        const ownerRows = await db.select({ count: count() })
          .from(schema.tenantMember)
          .where(
            and(
              eq(schema.tenantMember.tenantId, tenantId),
              eq(schema.tenantMember.role, 'owner'),
            )
          );
        return { target: targetRows[0], ownerCount: ownerRows[0]?.count ?? 0 };
      });

      if (!target) {
        res.status(404).json({ error: 'Not found', message: 'Member not found' });
        return;
      }

      // Granting the owner role is owner-only — an admin must not self-escalate.
      if (grantsOwnerWithoutPermission(body.role, req.userRole)) {
        res.status(403).json({
          error: 'Forbidden',
          message: 'Only an owner can grant the owner role',
        });
        return;
      }

      // Never demote the tenant's last owner (would leave it with no owner).
      if (demotesLastOwner(target.role, body.role, ownerCount)) {
        res.status(400).json({
          error: 'Bad Request',
          message: 'Cannot demote the last owner',
        });
        return;
      }

      const [updatedMember] = await withTenantDb(tenantId, getSharedPool(), async (db) => {
        return await db.update(schema.tenantMember)
          .set({ role: body.role, updatedAt: new Date() })
          .where(
            and(
              eq(schema.tenantMember.id, memberId),
              eq(schema.tenantMember.tenantId, tenantId),
            )
          )
          .returning();
      });

      if (!updatedMember) {
        res.status(404).json({
          error: 'Not found',
          message: 'Member not found',
        });
        return;
      }

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
 * Remove a member from the tenant
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

      // Get the member's role + user id first (RLS-scoped).
      const memberData = await withTenantDb(tenantId, getSharedPool(), async (db) => {
        return await db.select({ role: schema.tenantMember.role, userId: schema.tenantMember.userId })
          .from(schema.tenantMember)
          .where(
            and(
              eq(schema.tenantMember.id, memberId),
              eq(schema.tenantMember.tenantId, tenantId),
            )
          );
      });

      if (!memberData || memberData.length === 0) {
        res.status(404).json({
          error: 'Not found',
          message: 'Member not found',
        });
        return;
      }

      const target = memberData[0]!;

      // Prevent removing yourself — compare the member's USER id (not its row id,
      // which is what :memberId is) to the authenticated user's id.
      if (isSelfRemoval(req.userId, target.userId)) {
        res.status(400).json({
          error: 'Bad Request',
          message: 'Cannot remove yourself from the tenant',
        });
        return;
      }

      // Prevent removing the last owner.
      if (target.role === 'owner') {
        const ownerCount = await withTenantDb(tenantId, getSharedPool(), async (db) => {
          const result = await db.select({ count: count() })
            .from(schema.tenantMember)
            .where(
              and(
                eq(schema.tenantMember.tenantId, tenantId),
                eq(schema.tenantMember.role, 'owner'),
              )
            );
          return result[0]?.count ?? 0;
        });

        if (removesLastOwner(target.role, ownerCount)) {
          res.status(400).json({
            error: 'Bad Request',
            message: 'Cannot remove the last owner',
          });
          return;
        }
      }

      // The removal and its record, in one transaction: a record that cannot
      // be written rolls the removal back, never a removal left unrecorded.
      // The detail names the subject, which is what the record is for, and no
      // address (0137 T4). It names the row as the delete found it, not as the
      // read above did: an invitee's first sign-in (claimRequestedMembership,
      // auth.ts) turns the same row from a `pending:` placeholder into their
      // subject in between, and a record of the placeholder would leave the
      // strays duty taking their account for one nobody let in (0135 T8).
      await withTenantDb(tenantId, getSharedPool(), async (db) => {
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
        if (!gone) return;
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
      });

      res.status(204).send();
    } catch (error) {
      serverFault(res, 'remove_failed', 'removing this member', error);
    }
  }
);

export default router;
