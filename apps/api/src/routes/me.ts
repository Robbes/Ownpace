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
 * It authenticates like everything else. `authenticate` resolves a tenant to
 * serve the request, which for the ordinary single-membership account is the
 * one they are in — so this is not a hole in the tenancy boundary, it is the
 * boundary answering a question about the person who already got through it.
 *
 * WHAT IT DOES NOT CARRY: nothing about the organisations themselves beyond
 * their id and the caller's own role in each. A name would be somebody else's
 * data on a route whose whole point is that the tenant is not yet decided.
 */

import { Router } from 'express';
import type { Response } from 'express';
import { authenticate, membershipsForSubject } from '../middleware/auth.ts';
import type { AuthenticatedRequest } from '../types/api.ts';
import { serverFault } from '../server-fault.ts';

const router = Router();

router.get('/', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized', message: 'No subject on this request' });
      return;
    }

    const tenants = await membershipsForSubject(userId);
    res.json({
      userId,
      // From the verified `email` claim, not the database: it is what the
      // issuer asserts about the person who just signed in, and it is the only
      // human-readable thing on this response.
      email: req.userEmail,
      // The tenant this particular request was resolved to — so a client can
      // tell which one it is currently acting as without guessing from the list.
      tenantId: req.tenantId,
      role: req.userRole,
      tenants,
    });
  } catch (error) {
    serverFault(res, 'me_failed', 'reading your account', error);
  }
});

export default router;
