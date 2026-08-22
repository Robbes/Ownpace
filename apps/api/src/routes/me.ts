// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * `GET /api/me` — who is signed in, and which organisations they may act on
 * (ADR-0042, workplan 0093 T5).
 *
 * **The one route that must work before a tenant is known.** Every other route
 * is tenant-scoped, and after ADR-0042 a token need not name a tenant at all —
 * so a client that has just signed in has a subject and nothing else. This is
 * how it finds out where it may go, and it is what makes the multi-organisation
 * case answerable: `resolveTenant` refuses to guess between several, and the
 * client needs the list to ask a person which one.
 *
 * **It REPORTS where somebody may go; it does not refuse them for being
 * nowhere.** This route used `authenticate` until workplan 0093 T7, and
 * inherited its refusals: a subject with no membership got 403, and one with
 * several got 400. Both are right for a tenant-scoped route and wrong for this
 * one, because "nowhere yet" and "two, and you have not said which" are
 * ANSWERS to the question it exists to ask, and a 403 is indistinguishable
 * from "your token is bad".
 *
 * It also made the product unusable for a **platform operator**, who by design
 * belongs to no organisation at all — so the web app could not hold a session
 * for the one person who is supposed to grant the others.
 *
 * So it runs on `authenticateSubject`: same verification, same JWKS path, same
 * 401s, no tenant required. Every OTHER route keeps `authenticate` and keeps
 * refusing — that is the boundary, and this is the one question asked from
 * outside it.
 *
 * WHAT IT DOES NOT CARRY: nothing about the organisations themselves beyond
 * their id and the caller's own role in each. A name would be somebody else's
 * data on a route whose whole point is that the tenant is not yet decided.
 */

import { Router } from 'express';
import type { Response } from 'express';
import {
  authenticateSubject,
  claimInvitationsForSubject,
  isPlatformOperator,
  membershipsForSubject,
} from '../middleware/auth.ts';
import type { AuthenticatedRequest } from '../types/api.ts';
import { serverFault } from '../server-fault.ts';

const router = Router();

router.get('/', authenticateSubject, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized', message: 'No subject on this request' });
      return;
    }

    let tenants = await membershipsForSubject(userId);

    // First sign-in after an access request was granted, or after somebody was
    // invited to an existing organisation: the row is addressed to their email
    // and still carries a `pending:` placeholder. Attempted only when there is
    // nothing to show, and only against an address the issuer said it verified
    // (workplan 0093 T6b).
    if (tenants.length === 0) {
      const claimed = await claimInvitationsForSubject(userId, req.userEmail, req.emailVerified);
      if (claimed > 0) tenants = await membershipsForSubject(userId);
    }

    // Which one this caller is acting as, in `resolveTenant`'s order — header
    // first, then a sole membership. It is NOT `resolveTenant`, deliberately:
    // that function REFUSES what it cannot decide, which is right for every
    // tenant-scoped route and wrong for the one route whose entire job is to
    // report where somebody may go. Two organisations and no choice made is an
    // answer here ("these two, currently neither"), not a 400.
    const named = req.requestedTenantId?.trim();
    const current =
      tenants.find((t) => t.tenantId === named) ??
      (tenants.length === 1 ? tenants[0] : undefined);

    res.json({
      userId,
      // From the verified `email` claim, not the database: it is what the
      // issuer asserts about the person who just signed in, and it is the only
      // human-readable thing on this response.
      email: req.userEmail,
      // The tenant this caller is currently acting as, or absent when that
      // cannot be decided — which a client handles by asking a person.
      ...(current ? { tenantId: current.tenantId, role: current.role } : {}),
      tenants,
      // Whether to offer the access queue at all. The queue itself is guarded
      // by policies on `access_request`; being wrong here shows or hides a
      // link and grants nothing (workplan 0093 T6).
      operator: await isPlatformOperator(userId),
    });
  } catch (error) {
    serverFault(res, 'me_failed', 'reading your account', error);
  }
});

export default router;
