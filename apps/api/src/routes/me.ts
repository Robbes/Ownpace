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
import { z } from 'zod';
import {
  authenticate,
  authenticateSubject,
  claimRequestedMembership,
  getDbPool,
  pendingInvitations,
  isPlatformOperator,
  membershipsForSubject,
  reconcileMemberEmail,
  withTenantDb,
} from '../middleware/auth.ts';
import type { AuthenticatedRequest } from '../types/api.ts';
import { serverFault } from '../server-fault.ts';
import { log } from '@openmig/shared';
import {
  LEGAL_DOCUMENTS,
  LEGAL_LANGUAGES,
  recordAcceptance,
  type LegalDocument,
} from '@openmig/managed';
import {
  ACCEPTANCE_NOT_ASKED,
  VERSION_NOT_CURRENT,
  acceptanceAsked,
  acceptanceOf,
} from '../conditions-not-accepted.ts';

const router = Router();

/** One pool for the acceptance record, built on first use rather than per request. */
let _pool: ReturnType<typeof getDbPool> | null = null;
function pool(): ReturnType<typeof getDbPool> {
  if (!_pool) _pool = getDbPool();
  return _pool;
}

router.get('/', authenticateSubject, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized', message: 'No subject on this request' });
      return;
    }

    /**
     * TAKE UP THE ORGANISATION YOU ASKED FOR, before anything is reported
     * (migration 0021, owner decision 2026-09-01).
     *
     * Granting an access request creates an organisation with the asker as its
     * only owner and a `pending:` placeholder where their subject will go. This
     * is the moment the subject exists, and it is the first request they make.
     *
     * Binding here rather than showing them "You have been invited" is the
     * owner's own correction: he asked, granted it himself, signed in, and was
     * asked whether he wanted to join the thing he had asked for. An
     * `invited` row — somebody else adding an address to THEIR organisation —
     * is untouched by this and still asks (workplan 0099).
     *
     * BEFORE the memberships are read, so the answer already includes it and
     * the client lands where it should rather than on a screen about a state
     * that ended a moment ago.
     *
     * REPORTED, NOT MASKED, IF IT FAILS — the same rule the label reconcile
     * below follows, and the same reason: this is a side effect of answering
     * "who am I", and refusing to answer that because a binding failed would
     * trade one wrong screen for none at all.
     */
    try {
      await claimRequestedMembership(userId, req.userEmail, req.emailVerified);
    } catch (error) {
      log.error(`[me] could not take up the requested organisation for ${userId}:`, error);
    }

    const tenants = await membershipsForSubject(userId);

    /**
     * THE LABEL FOLLOWS THE VERIFIED CLAIM (workplan 0102 T3).
     *
     * `tenant_member.email` was written once and never updated, so somebody who
     * changed their address at the provider kept every membership — `sub` is
     * the identity — while the members table went on showing colleagues an
     * address they had moved off. This route is where it is put right, because
     * it is the one call made on every sign-in, and the moment the claim is
     * freshest.
     *
     * REPORTED, NOT MASKED, IF IT FAILS. It is a side effect of answering "who
     * am I", and refusing to answer that because a cosmetic label could not be
     * written would trade a stale address for no sign-in at all. So the error
     * goes to the log with the subject on it — never the address, which is the
     * kind of thing this endpoint exists not to publish — and the answer below
     * is served either way. Nothing is swallowed: a failure is visible where an
     * operator looks, which is the distinction hard rule 9 draws.
     */
    try {
      const moved = await reconcileMemberEmail(userId, req.userEmail, req.emailVerified);
      if (moved > 0) {
        log.info(`[me] ${moved} membership label(s) followed a verified address change for ${userId}`);
      }
    } catch (error) {
      log.error(`[me] could not reconcile the membership label for ${userId}:`, error);
    }

    // Invitations are REPORTED, never claimed here (workplan 0099). This route
    // used to bind every one of them addressed to a verified address, which
    // meant reading your own account joined you to things — and left no moment
    // at which anybody could say no.
    //
    // Always fetched, not only when `tenants` is empty: an invitation to a
    // SECOND organisation is exactly the case the old shortcut could not see,
    // and it is the one where being asked matters most.
    const invitations = await pendingInvitations(userId, req.userEmail, req.emailVerified);

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

    /**
     * WHETHER THE TEXTS STILL WAIT TO BE ACCEPTED (workplan 0139 T3), for the
     * organisation this caller is acting as, and only while the deployment
     * asks (`OWNPACE_STAGE=alpha`, and no text still a draft). The web app
     * shows its screen in front of every page while this says `due`, with
     * each text and its current version; the doors that store a credential
     * refuse on the same reading.
     *
     * Absent when the deployment does not ask, and when no organisation is
     * current: acceptance is recorded per organisation, and a caller choosing
     * between two is asked once they have chosen. A read that fails is not
     * "nothing due" (hard rule 9): it fails this answer, which the screen
     * reports.
     */
    const acceptance =
      current && acceptanceAsked() ? await acceptanceOf(current.tenantId, userId, pool()) : undefined;

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
      // Open invitations addressed to this caller's verified address. An empty
      // list is the ordinary case and says nothing is waiting; it is also what
      // an issuer that will not assert `email_verified` gets, because email is
      // not identity.
      invitations,
      // Whether to offer the access queue at all. The queue itself is guarded
      // by policies on `access_request`; being wrong here shows or hides a
      // link and grants nothing (workplan 0093 T6).
      operator: await isPlatformOperator(userId),
      ...(acceptance ? { acceptance } : {}),
    });
  } catch (error) {
    serverFault(res, 'me_failed', 'reading your account', error);
  }
});

/** `{ versions: { alpha, privacy, terms }, language }`, every text named, nothing else. */
const AcceptanceSchema = z
  .object({
    versions: z
      .object(
        Object.fromEntries(LEGAL_DOCUMENTS.map((d) => [d, z.string().min(1).max(20)])) as Record<
          LegalDocument,
          z.ZodString
        >,
      )
      .strict(),
    language: z.enum(LEGAL_LANGUAGES),
  })
  .strict();

const NOT_CURRENT_EN =
  'These texts changed while the page was open. Read the current versions, then accept those.';
const NOT_CURRENT_NL =
  'Deze teksten zijn gewijzigd terwijl de pagina openstond. Lees de huidige versies en aanvaard die.';

const NOT_ASKED_EN =
  'This service asks nobody to accept its texts at the moment, so nothing was recorded. Reload the page.';
const NOT_ASKED_NL =
  'Deze dienst vraagt op dit moment niemand zijn teksten te aanvaarden, dus er is niets vastgelegd. Laad de ' +
  'pagina opnieuw.';

/**
 * `POST /api/me/acceptance` — accept the current version of each text
 * (workplan 0139 T3).
 *
 * Takes the version of each text the screen showed, and the language it
 * showed them in. Every version must be the current one, or nothing is
 * written and the answer is 409 `version_not_current`, naming the texts that
 * changed and the current versions: a tab left open across an update must not
 * accept a text nobody shows any more. Accepted, it writes one row per text,
 * with the version, the language and the time, for this person in the
 * organisation they are acting as; pressed again, it writes nothing and keeps
 * the first time. The answer is what `GET /api/me` would now say.
 *
 * Tenant-scoped (`authenticate`), because the record is the organisation's.
 *
 * **Only while the deployment asks** (review of 2026-09-29). With the switch
 * off, or while any text is still a draft, nothing is recorded and the answer
 * is 409 `acceptance_not_asked`. A draft's number is the one its final text
 * will carry, so an acceptance of the draft would be recorded as one of the
 * final text, whose words may differ; the server records only what it asks
 * for.
 */
router.post('/acceptance', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { tenantId, userId } = req;
    if (!tenantId || !userId) {
      res.status(401).json({ error: 'Unauthorized', message: 'No organisation or subject on this request' });
      return;
    }
    const parsed = AcceptanceSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'invalid_body',
        message: `Send { versions: { ${LEGAL_DOCUMENTS.join(', ')} }, language: ${LEGAL_LANGUAGES.map((l) => `'${l}'`).join(' or ')} }.`,
      });
      return;
    }
    if (!acceptanceAsked()) {
      res.status(409).json({
        error: ACCEPTANCE_NOT_ASKED,
        message: NOT_ASKED_EN,
        messageNl: NOT_ASKED_NL,
        reason: NOT_ASKED_EN,
        reasonNl: NOT_ASKED_NL,
      });
      return;
    }
    const { versions, language } = parsed.data;
    const outcome = await withTenantDb(tenantId, pool(), (db) =>
      recordAcceptance(db, tenantId, userId, versions, language),
    );
    if (outcome.kind === 'not_current') {
      res.status(409).json({
        error: VERSION_NOT_CURRENT,
        message: NOT_CURRENT_EN,
        messageNl: NOT_CURRENT_NL,
        reason: NOT_CURRENT_EN,
        reasonNl: NOT_CURRENT_NL,
        stale: outcome.stale,
        current: outcome.current,
      });
      return;
    }
    if (outcome.written > 0) {
      log.info(
        `[me] ${userId} accepted ${LEGAL_DOCUMENTS.map((d) => `${d} ${versions[d]}`).join(', ')} (${language}) in ${tenantId}`,
      );
    }
    res.json({ written: outcome.written, acceptance: outcome.state });
  } catch (error) {
    serverFault(res, 'acceptance_failed', 'recording your acceptance', error);
  }
});

export default router;
