// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Answering an invitation (workplan 0099).
 *
 * ## Three answers, and only two of them are routes
 *
 *   accept   `POST /:tenantId/accept`  — join, and bind this subject to the row.
 *   decline  `POST /:tenantId/decline` — say no, and stay unlinked to it.
 *   skip     **nothing.** No call, no state, no row changed.
 *
 * Skip having no endpoint is the design, not an omission. "I have not decided"
 * is the absence of a decision; writing it down would turn a deferral into a
 * record somebody has to reason about later, and would need its own answer to
 * "when does this expire". Leaving the row `invited` means the offer is simply
 * made again next time, which is what deferring means.
 *
 * ## `authenticateSubject`, like the access queue and `/api/me`
 *
 * A person answering an invitation has, by construction, no membership in the
 * organisation offering it — so resolving a tenant would refuse them at the
 * door. These routes take a subject and a verified email and nothing else.
 *
 * ## Nothing here authorises anything
 *
 * Migrations 0006 and 0008 do. Both statements are bounded from both sides by
 * policy: the row must be an OPEN invitation addressed to the address in
 * `app.current_email` — which `auth.ts` sets only when the issuer asserted
 * `email_verified: true` — and what it may BECOME is pinned too, so accepting
 * cannot write somebody else's subject and declining cannot write any real
 * subject at all.
 *
 * So a caller answering an invitation that is not theirs, or that does not
 * exist, gets the same `404` either way. That is deliberate: distinguishing
 * them would answer "does an invitation exist for this address at this
 * organisation" to anybody who asked.
 *
 * ## AN INVITATION IS NOT A GRANT LINK, AND MUST NEVER BECOME ONE
 *
 * `routes/grant.ts` looks superficially like this file — a stranger arrives
 * with something in a URL and gets access to one row. It is the opposite
 * mechanism, and the two must not be unified.
 *
 *   invitation   an offer to JOIN an organisation. The person ends up with an
 *                account, a session and a role. It carries **no token and no
 *                magic link**: identity belongs to the issuer (ADR-0042), and
 *                what authorises is a VERIFIED EMAIL CLAIM matched by RLS. It
 *                is not a bearer credential and possessing the URL grants
 *                nothing.
 *
 *   grant link   a way for somebody who will NEVER have an account to connect
 *                their own mailbox once (ADR-0035). It **is** a bearer
 *                credential — the secret is the URL — which is why it is
 *                hashed at rest, single-use, expiring, revocable, listable,
 *                and why it authorises exactly one mapping and no identity.
 *
 * The distinction is worth a paragraph because the cheap mistake runs in one
 * direction: adding a token to an invitation "so people do not have to sign
 * in" would turn an offer of membership into a bearer credential for a seat,
 * with none of the machinery a bearer credential needs. If that ever looks
 * attractive, it is a decision for an ADR, not a convenience.
 */

import { Router } from 'express';
import type { Response } from 'express';
import {
  authenticateSubject,
  acceptInvitation,
  declineInvitation,
  type InvitationAnswer,
} from '../middleware/auth.ts';
import type { AuthenticatedRequest } from '../types/api.ts';
import { serverFault } from '../server-fault.ts';

const router = Router();

/**
 * The `:tenantId` from the path, or null if it is not one id.
 *
 * Express types a path parameter as `string | string[]` — a repeated one
 * arrives as an array — so reading it straight is a lie that only surfaces at
 * the query. `access-requests.ts` and `tenants/index.ts` guard the same way.
 */
function pathTenantId(req: AuthenticatedRequest): string | null {
  const raw = req.params.tenantId;
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

/** Both routes are the same shape around one verb. */
const answer = (
  act: (
    userId: string,
    email: string | undefined,
    emailVerified: boolean | undefined,
    tenantId: string,
  ) => Promise<InvitationAnswer>,
  failure: string,
) =>
  async function handle(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const userId = req.userId;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized', message: 'No subject on this request' });
        return;
      }
      const tenantId = pathTenantId(req);
      if (!tenantId) {
        res.status(400).json({ error: 'Bad request', message: 'Name exactly one organisation.' });
        return;
      }

      const outcome = await act(userId, req.userEmail, req.emailVerified, tenantId);
      if (outcome === 'notFound') {
        // Invisible and absent are the same answer, deliberately — see the
        // header. It is also honest: to this caller, the row is not there.
        res.status(404).json({
          error: 'Not Found',
          message: 'No open invitation for you at that organisation.',
        });
        return;
      }
      res.json({ tenantId, outcome });
    } catch (error) {
      serverFault(res, failure, 'answering this invitation', error);
    }
  };

router.post(
  '/:tenantId/accept',
  authenticateSubject,
  answer(acceptInvitation, 'invitation_accept_failed'),
);

router.post(
  '/:tenantId/decline',
  authenticateSubject,
  answer(declineInvitation, 'invitation_decline_failed'),
);

export default router;
