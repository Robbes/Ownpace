// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * GIFTS: a code that one member makes for one person they know (workplans
 * 0172 and 0177). During the Alpha it is a *recommendation* (0177 D1), and it
 * lets its person in at once (0177 D6). Three doors, one file:
 *
 *  - **The giver's** (`authenticate`): list their cards, their limit and
 *    whether the Alpha has room for a new one; make one; revoke an unused
 *    one. A giver is a member of an organisation, and during the Alpha one
 *    the owner let in: a member who came in by a recommendation may give one
 *    only after it (0177 D18). Making a card takes the card's language and
 *    nothing else: no recipient's address, name or message reaches this
 *    server (`a-gift-that-keeps-no-recipient`).
 *  - **The door's** (anonymous): `POST /check` reads a code and writes
 *    nothing; `POST /redeem` lets the code's person in, in one transaction
 *    (managed migration 0066), and mails them and the operator after the
 *    commit. The request form's protections, by name: a refusing rate limit,
 *    one for both, the same trap field, and every stored field capped. Every
 *    bad code gets the same refusal (`GIFT_REFUSAL`), as a grant link's does.
 *  - **The operator's** (`authenticateSubject`, English only): every gift and
 *    whose, revoking one, the rule (the number each person may give and the
 *    Alpha's two ceilings, 0177 §20), the number for one person, and the
 *    Alpha's counts. As with the access queue, nothing here re-checks
 *    "operator": migration 0065's policies are the rule, and a non-operator
 *    reads an empty list and changes nothing.
 */

import { Router } from 'express';
import { idsThatAreNoUuid } from '../an-id-that-is-no-uuid.ts';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { withSubject, withSubjectAndTenant } from '@openmig/ledger';
import {
  GIFT_ALREADY_IN,
  GIFT_FULL,
  GIFT_NO_ORGANISATION,
  GIFT_NO_ROOM,
  GIFT_NOT_THEIRS,
  GIFT_NOT_UNUSED,
  GIFT_ONLY_AFTER_ALPHA,
  GIFT_REFUSAL,
  GIFT_TOO_MANY_TRIES,
  GIFTS_PER_PERSON_MAX,
  alphaCounts,
  checkGift,
  giftAtLimit,
  giftLimitFor,
  giftState,
  giftsHeldBy,
  listOwnGifts,
  makeGift,
  redeemGift,
  revokeGift,
  roomForACard,
  theGiftRule,
} from '@openmig/managed';
import { log, reasonPair } from '@openmig/shared';
import { authenticate, authenticateSubject, getDbPool } from '../middleware/auth.ts';
import type { AuthenticatedRequest } from '../types/api.ts';
import { serverFault } from '../server-fault.ts';
import {
  accessGrantedEvent,
  alphaFrom,
  answersFrom,
  appUrl,
  channelIsOn,
  tell,
  tellOperator,
  type TellOutcome,
} from '../access-notify.ts';
import { createKnockLimiter, type KnockLimiter } from '../knock-limit.ts';

const router = idsThatAreNoUuid(Router());

type Pool = ReturnType<typeof getDbPool>;
let _pool: Pool | null = null;
const pool = (): Pool => (_pool ??= getDbPool());

/**
 * Forty tries an hour from one caller, for the check and the redeem together
 * (0177 §5): a person's journey is two calls where it was one, so the twenty
 * of 0172 became forty. Sized as the request form's is, as a SERVICE-WIDE cap
 * unless `TRUST_PROXY` makes it per caller (`knock-limit.ts`): a person with a
 * card types it once or twice, and a script trying codes gets forty a
 * deployment an hour against 80 bits.
 */
export const GIFT_REDEEM_LIMIT = { windowMs: 60 * 60 * 1000, max: 40 } as const;

let _limiter: KnockLimiter | null = null;
const limiter = (): KnockLimiter => (_limiter ??= createKnockLimiter(GIFT_REDEEM_LIMIT));

/** TEST SEAM ONLY: a fresh limiter, so one test's tries do not spend another's. */
export function __resetGiftLimiterForTests(): void {
  _limiter = null;
}

/** The request form's trap, by the same name (`access-requests.ts`, `TRAP_FIELD`). */
const TRAP_FIELD = 'website';

/** Where the recipient types the code: the door's own address, the same in both languages (0177 D9). */
const redeemAt = (): string | null => {
  const app = appUrl();
  return app ? `${app}/code` : null;
};

/** Whether a yes mail can go out at all: a channel, and an address to sign in at. */
const aMailCanGo = (): boolean => channelIsOn() && appUrl() !== null;

/**
 * Whether this deployment runs the Alpha, for D18's rule (0177 §20.7): read
 * where the server reads the stage for every other purpose, `alphaFrom`, at
 * the moment a giver asks, so the rule falls away by itself when the Alpha
 * ends. The rule itself is `giftLimitFor`'s.
 */
const theStage = (): { duringTheAlpha: boolean } => ({ duringTheAlpha: alphaFrom(process.env) });

const subjectOf = (req: AuthenticatedRequest, res: Response): string | null => {
  if (!req.userId) {
    res.status(401).json({ error: 'Unauthorized', message: 'No subject on this request' });
    return null;
  }
  return req.userId;
};

const pathId = (req: Request): string | null => {
  const raw = req.params.id;
  return typeof raw === 'string' && /^[0-9a-fA-F-]{36}$/.test(raw) ? raw : null;
};

// ================================ The giver ================================

/**
 * GET /api/gifts/mine: their cards, newest first, how many they may hold,
 * whether the Alpha has room for a new card (`room`, 0177 §20.3), a yes or a
 * no, never the count behind it; and `onlyAfterAlpha` (D18): during the Alpha,
 * a member whose own organisation a card's request made has a limit of
 * nought until it ends. Read in their organisation's scope, which is what
 * 0066's function answers about.
 */
router.get('/mine', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = subjectOf(req, res);
    if (!userId) return;
    const tenantId = req.tenantId;
    if (!tenantId) {
      res.status(400).json({ error: 'Bad request', message: GIFT_NO_ORGANISATION.en, ...reasonPair(GIFT_NO_ORGANISATION) });
      return;
    }
    const { gifts, limit, held, room } = await withSubjectAndTenant(pool(), userId, tenantId, async (db) => ({
      gifts: await listOwnGifts(db, userId),
      limit: await giftLimitFor(db, userId, theStage()),
      held: await giftsHeldBy(db, userId),
      room: await roomForACard(db),
    }));
    res.json({
      gifts,
      limit: limit.limit,
      held,
      room,
      onlyAfterAlpha: limit.from === 'onlyAfterAlpha',
      redeemAt: redeemAt(),
    });
  } catch (error) {
    serverFault(res, 'gift_list_failed', 'reading your gifts', error);
  }
});

/** The card's language. Nothing else: see the file's header. `.strict()` refuses a recipient. */
const MakeSchema = z.object({ locale: z.enum(['en', 'nl']).default('en') }).strict();

/** POST /api/gifts: make one, and answer its code once. */
router.post('/', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = subjectOf(req, res);
    if (!userId) return;
    const tenantId = req.tenantId;
    if (!tenantId) {
      res.status(400).json({ error: 'Bad request', message: GIFT_NO_ORGANISATION.en, ...reasonPair(GIFT_NO_ORGANISATION) });
      return;
    }
    const parsed = MakeSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation error', details: parsed.error.issues });
      return;
    }
    const outcome = await withSubjectAndTenant(pool(), userId, tenantId, (db) =>
      makeGift(db, { tenantId, giverUserId: userId, locale: parsed.data.locale, ...theStage() }),
    );
    if (outcome.kind === 'onlyAfterAlpha') {
      // D18 (0177 §20.7): the page says it too, with when they can.
      res.status(409).json({ error: 'only_after_alpha', message: GIFT_ONLY_AFTER_ALPHA.en, ...reasonPair(GIFT_ONLY_AFTER_ALPHA) });
      return;
    }
    if (outcome.kind === 'atLimit') {
      const said = giftAtLimit(outcome.limit);
      res.status(409).json({ error: 'gift_limit', message: said.en, ...reasonPair(said), limit: outcome.limit });
      return;
    }
    if (outcome.kind === 'noRoom') {
      // The second ceiling (0177 §20.3, rule 1): a card on paper says the
      // person is let in at once, so none is made that the Alpha could not keep.
      res.status(409).json({ error: 'no_room', message: GIFT_NO_ROOM.en, ...reasonPair(GIFT_NO_ROOM) });
      return;
    }
    // By the gift's id, never its code: the code is shown once, here, to them.
    log.info(`[gift] gift ${outcome.id} made`);
    res.status(201).json({ id: outcome.id, code: outcome.code, expiresAt: outcome.expiresAt, redeemAt: redeemAt() });
  } catch (error) {
    serverFault(res, 'gift_make_failed', 'making your gift', error);
  }
});

/** POST /api/gifts/:id/revoke: the giver's own, while it is unused. */
router.post('/:id/revoke', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = subjectOf(req, res);
    if (!userId) return;
    const id = pathId(req);
    if (!id) {
      res.status(404).json({ error: 'Not Found', message: GIFT_NOT_THEIRS.en, ...reasonPair(GIFT_NOT_THEIRS) });
      return;
    }
    const outcome = await withSubject(pool(), userId, (db) => revokeGift(db, id, userId));
    answerRevoke(res, id, outcome);
  } catch (error) {
    serverFault(res, 'gift_revoke_failed', 'revoking this gift', error);
  }
});

/**
 * A revoke's answer. The giver's carries both languages, as their page is
 * read in either; the operator's *Gifts* is English only, and keeps its own
 * words: *not yours* is no answer to the operator, who may revoke any.
 */
function answerRevoke(
  res: Response,
  id: string,
  outcome: Awaited<ReturnType<typeof revokeGift>>,
  who: 'giver' | 'operator' = 'giver',
): void {
  if (outcome === 'notFound') {
    res
      .status(404)
      .json(
        who === 'giver'
          ? { error: 'Not Found', message: GIFT_NOT_THEIRS.en, ...reasonPair(GIFT_NOT_THEIRS) }
          : { error: 'Not Found', message: 'No such gift.' },
      );
  } else if (outcome === 'notUnused') {
    res
      .status(409)
      .json(
        who === 'giver'
          ? { error: 'Conflict', message: GIFT_NOT_UNUSED.en, ...reasonPair(GIFT_NOT_UNUSED) }
          : { error: 'Conflict', message: 'Only an unused gift can be revoked.' },
      );
  } else {
    log.info(`[gift] gift ${id} revoked`);
    res.json({ revoked: true, id });
  }
}

// ================================= The door =================================

/** Past the one limit: in both languages, with when to come back (0177 §5). */
function tooManyTries(req: Request, res: Response): boolean {
  const caller = req.ip ?? 'unknown';
  if (limiter().take(caller)) return false;
  res.set('Retry-After', String(limiter().retryAfterSeconds(caller)));
  res.status(429).json({ error: 'Too many requests', message: GIFT_TOO_MANY_TRIES.en, ...reasonPair(GIFT_TOO_MANY_TRIES) });
  return true;
}

/** 410, as a spent grant link answers, and the same body for every cause. */
const refuse = (res: Response): void => {
  res.status(410).json({ error: 'gift_refused', ...reasonPair(GIFT_REFUSAL) });
};

/** 409: the Alpha has no room (0177 §20.3). The code is kept; the page says until when it works. */
const full = (res: Response, until: Date): void => {
  res.status(409).json({ error: 'full', ...reasonPair(GIFT_FULL), until: until.toISOString() });
};

const CheckSchema = z.object({ code: z.string().max(64) });

/**
 * POST /api/gifts/check (0177 §5, step 1 of 3): whether a code can be used.
 * Writes nothing and spends nothing; behind the redeem's limit, with its one
 * refusal. Its yes carries the code's last day, which the card prints anyway,
 * and the bare address the yes mail comes from, where one can go, so the page
 * names no address the mail does not come from.
 */
router.post('/check', async (req: Request, res: Response) => {
  try {
    if (tooManyTries(req, res)) return;
    const parsed = CheckSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation error', details: parsed.error.issues });
      return;
    }
    const outcome = await checkGift(pool(), parsed.data.code);
    if (outcome.kind === 'refused') {
      log.info('[gift] a code was refused at the check');
      refuse(res);
      return;
    }
    if (outcome.kind === 'full') {
      log.info('[gift] a good code met a full Alpha at the check; nothing written');
      full(res, outcome.until);
      return;
    }
    const from = aMailCanGo() ? answersFrom() : null;
    res.json({ ok: true, until: outcome.until.toISOString(), ...(from ? { answersFrom: from } : {}) });
  } catch (error) {
    serverFault(res, 'gift_check_failed', 'checking this code', error);
  }
});

/**
 * What the door's last step sends (0177 §5): the code, the address, a name if
 * one was typed, the answer about Google, and the page's language. Capped as
 * the request form caps the same fields. No organisation, note or package:
 * a field the page never sends is not read, and not kept.
 */
const RedeemSchema = z.object({
  code: z.string().max(64),
  email: z.string().trim().email().max(320),
  name: z.string().trim().max(200).optional(),
  google: z.boolean().default(false),
  locale: z.enum(['en', 'nl']).default('en'),
  [TRAP_FIELD]: z.unknown().optional(),
});

const trapFilled = (value: unknown): boolean =>
  value === undefined || value === null ? false : typeof value === 'string' ? value.trim() !== '' : true;

/** POST /api/gifts/redeem: a code lets its person in at once (0177 D6), or says why not. */
router.post('/redeem', async (req: Request, res: Response) => {
  try {
    if (tooManyTries(req, res)) return;
    const parsed = RedeemSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation error', details: parsed.error.issues });
      return;
    }
    const body = parsed.data;
    if (trapFilled(body[TRAP_FIELD])) {
      // Answered as a real let-in would most often be, so the trap tells a
      // script nothing; nothing is written, spent or sent.
      log.info('[gift] a redemption filled the trap field; answered as let in, nothing kept');
      res.status(201).json({ letIn: true, mailed: aMailCanGo() });
      return;
    }

    const outcome = await redeemGift(pool(), body.code, {
      email: body.email,
      ...(body.name ? { name: body.name } : {}),
      google: body.google,
      locale: body.locale,
    });

    if (outcome.kind === 'refused') {
      log.info('[gift] a code was refused');
      refuse(res);
      return;
    }
    if (outcome.kind === 'full') {
      log.info('[gift] a good code met a full Alpha; nothing written, the code kept');
      full(res, outcome.until);
      return;
    }
    if (outcome.kind === 'alreadyIn') {
      log.info('[gift] a good code came with an address that already has access; nothing written, the code kept');
      res.status(409).json({ error: 'already_in', ...reasonPair(GIFT_ALREADY_IN) });
      return;
    }

    // By their ids, never the code or the address (§17).
    log.info(`[gift] gift ${outcome.giftId} let in request ${outcome.requestId}: tenant ${outcome.tenantId} (${body.locale})`);

    // AFTER the commit, and outside it, as the grant's (0095 T3): the person
    // is in whether or not the mail server answers, and each mail only ever
    // says what already happened. Neither changes the 201.
    const mailed = await mailTheYes(outcome, body.locale, body.google);
    const announced = await tellOperator({
      kind: 'access_requested',
      email: outcome.email,
      withCode: true,
      ...(body.google ? { google: true } : {}),
    });
    if (announced === 'off') {
      log.warn(`[gift] nobody was told about request ${outcome.requestId} — no SMTP configured.`);
    } else if (announced === 'failed') {
      log.error(`[gift] could not announce request ${outcome.requestId}; it is in the queue, let in.`);
    }
    res.status(201).json({ letIn: true, mailed: mailed === 'sent' });
  } catch (error) {
    serverFault(res, 'gift_redeem_failed', 'reading this code', error);
  }
});

/** The yes mail for a code (0177 §8), in the door's language, through `accessGrantedEvent`. */
async function mailTheYes(
  letIn: { requestId: string; organisation: string; email: string },
  locale: 'en' | 'nl',
  google: boolean,
): Promise<TellOutcome> {
  const where = appUrl();
  if (!where) {
    log.error(
      `[gift] WEB_URL is not set — let in request ${letIn.requestId} but sent no email, ` +
        'because it would have named no address to sign in at',
    );
    return 'off';
  }
  return tell(
    letIn.email,
    locale,
    accessGrantedEvent({
      organisation: letIn.organisation,
      appUrl: where,
      email: letIn.email,
      withCode: true,
      ...(google ? { google: true } : {}),
    }),
    `access request ${letIn.requestId}`,
  );
}

// ============================== The operator ===============================

type Row = Record<string, unknown>;
const rowsOf = (result: unknown): Row[] => (result as { rows: Row[] }).rows;
const dateOrNull = (v: unknown): Date | null => (v === null || v === undefined ? null : new Date(String(v)));

/** GET /api/gifts/operator: every gift, the rule, and the Alpha's counts and ceilings. */
router.get('/operator', authenticateSubject, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = subjectOf(req, res);
    if (!userId) return;
    const now = new Date();
    const answer = await withSubject(pool(), userId, async (db) => {
      const gifts = rowsOf(
        await db.execute(sql`
          SELECT g.id, g.locale, g.created_at, g.expires_at, g.redeemed_at, g.revoked_at,
                 g.redeemed_request_id,
                 (SELECT m.email FROM public.support_tenant_members m
                   WHERE m.user_id = g.giver_user_id AND m.tenant_id = g.tenant_id LIMIT 1) AS giver_email,
                 (SELECT t.tenant_name FROM public.support_tenants t WHERE t.tenant_id = g.tenant_id) AS organisation,
                 r.state AS request_state, r.email AS request_email
            FROM public.gift g
            LEFT JOIN public.access_request r ON r.id = g.redeemed_request_id
           ORDER BY g.created_at DESC`),
      ).map((r) => {
        const row = {
          redeemedAt: dateOrNull(r.redeemed_at),
          revokedAt: dateOrNull(r.revoked_at),
          expiresAt: new Date(String(r.expires_at)),
        };
        return {
          id: String(r.id),
          locale: String(r.locale),
          createdAt: new Date(String(r.created_at)),
          ...row,
          state: giftState(row, now),
          giverEmail: r.giver_email === null ? null : String(r.giver_email),
          organisation: r.organisation === null ? null : String(r.organisation),
          request:
            r.redeemed_request_id === null
              ? null
              : {
                  id: String(r.redeemed_request_id),
                  state: r.request_state === null ? null : String(r.request_state),
                  email: r.request_email === null ? null : String(r.request_email),
                },
        };
      });
      const allowances = rowsOf(
        await db.execute(sql`
          SELECT a.user_id, a.gifts, a.set_at, a.note,
                 (SELECT m.email FROM public.support_tenant_members m
                   WHERE m.user_id = a.user_id ORDER BY m.joined_at LIMIT 1) AS email
            FROM public.gift_allowance a
           ORDER BY a.set_at DESC`),
      ).map((r) => ({
        userId: String(r.user_id),
        email: r.email === null ? null : String(r.email),
        gifts: Number(r.gifts),
        setAt: new Date(String(r.set_at)),
        note: r.note === null ? null : String(r.note),
      }));
      return { gifts, allowances, counts: await alphaCounts(db), rule: await theGiftRule(db) };
    });
    res.json({
      gifts: answer.gifts,
      giftsPerPerson: answer.rule.giftsPerPerson,
      allowances: answer.allowances,
      alpha: {
        granted: answer.counts.granted,
        open: answer.counts.open,
        openFromGifts: answer.counts.openFromGifts,
        unusedGifts: answer.gifts.filter((g) => g.state === 'unused').length,
        // The two ceilings and their counts (0177 §20.6). The queue reads the
        // owner's line from here.
        byOwner: answer.counts.byOwner,
        byRecommendation: answer.counts.byRecommendation,
        ownerCeiling: answer.rule.ownerCeiling,
        recommendationCeiling: answer.rule.recommendationCeiling,
      },
    });
  } catch (error) {
    serverFault(res, 'gift_operator_list_failed', 'reading the gifts', error);
  }
});

/** POST /api/gifts/operator/:id/revoke: any unused gift. */
router.post('/operator/:id/revoke', authenticateSubject, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = subjectOf(req, res);
    if (!userId) return;
    const id = pathId(req);
    if (!id) {
      res.status(404).json({ error: 'Not Found', message: 'No such gift.' });
      return;
    }
    answerRevoke(res, id, await withSubject(pool(), userId, (db) => revokeGift(db, id, userId)), 'operator');
  } catch (error) {
    serverFault(res, 'gift_operator_revoke_failed', 'revoking this gift', error);
  }
});

/** A ceiling: a whole number, nought or more, within what the column holds (0177 §21.3 item 12). */
const CEILING = z.number().int().min(0).max(2_147_483_647);

const RuleSchema = z
  .object({
    giftsPerPerson: z.number().int().min(0).max(GIFTS_PER_PERSON_MAX).optional(),
    ownerCeiling: CEILING.optional(),
    recommendationCeiling: CEILING.optional(),
  })
  .strict()
  .refine(
    (rule) => rule.giftsPerPerson !== undefined || rule.ownerCeiling !== undefined || rule.recommendationCeiling !== undefined,
    { message: 'Name at least one of giftsPerPerson, ownerCeiling and recommendationCeiling.' },
  );

/**
 * PUT /api/gifts/operator/rule: how many each person may give, and either of
 * the Alpha's two ceilings (0177 §20.2). What is not named stays as it is. A
 * ceiling set under its count takes nobody out; nobody new comes in until the
 * count is under it again.
 */
router.put('/operator/rule', authenticateSubject, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = subjectOf(req, res);
    if (!userId) return;
    const parsed = RuleSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation error', details: parsed.error.issues });
      return;
    }
    const { giftsPerPerson, ownerCeiling, recommendationCeiling } = parsed.data;
    const [changed, ...more] = rowsOf(
      await withSubject(pool(), userId, (db) =>
        db.execute(sql`
          UPDATE public.gift_rule
             SET gifts_per_person = COALESCE(${giftsPerPerson ?? null}::int, gifts_per_person),
                 owner_ceiling = COALESCE(${ownerCeiling ?? null}::int, owner_ceiling),
                 recommendation_ceiling = COALESCE(${recommendationCeiling ?? null}::int, recommendation_ceiling),
                 set_by = ${userId}, set_at = now()
           RETURNING gifts_per_person, owner_ceiling, recommendation_ceiling`),
      ),
    );
    if (!changed || more.length > 0) {
      res.status(404).json({ error: 'Not Found', message: 'No rule you may change.' });
      return;
    }
    const rule = {
      giftsPerPerson: Number(changed.gifts_per_person),
      ownerCeiling: Number(changed.owner_ceiling),
      recommendationCeiling: Number(changed.recommendation_ceiling),
    };
    log.info(
      `[gift] the rule set: ${rule.giftsPerPerson} per person, ${rule.ownerCeiling} let in by the owner, ` +
        `${rule.recommendationCeiling} by a recommendation`,
    );
    res.json(rule);
  } catch (error) {
    serverFault(res, 'gift_rule_failed', 'setting the rule', error);
  }
});

const AllowanceSchema = z
  .object({
    email: z.string().trim().email().max(320),
    /** A number for this person, or null to take theirs away and leave them on the rule. */
    gifts: z.number().int().min(0).max(GIFTS_PER_PERSON_MAX).nullable(),
    note: z.string().trim().max(500).optional(),
  })
  .strict();

/**
 * PUT /api/gifts/operator/allowance: one person's number, by the address they
 * sign in with. Keyed on their subject (an address is not an identity), so it
 * is set for every active membership with that address.
 */
router.put('/operator/allowance', authenticateSubject, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = subjectOf(req, res);
    if (!userId) return;
    const parsed = AllowanceSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation error', details: parsed.error.issues });
      return;
    }
    const { email, gifts, note } = parsed.data;
    const people = await withSubject(pool(), userId, async (db) => {
      const subjects = rowsOf(
        await db.execute(sql`
          SELECT DISTINCT m.user_id
            FROM public.support_tenant_members m
           WHERE lower(btrim(m.email)) = lower(btrim(${email}))
             AND m.status = 'active'
             AND m.user_id NOT LIKE 'pending:%'`),
      ).map((r) => String(r.user_id));
      for (const subject of subjects) {
        if (gifts === null) {
          await db.execute(sql`DELETE FROM public.gift_allowance WHERE user_id = ${subject}`);
        } else {
          await db.execute(sql`
            INSERT INTO public.gift_allowance (user_id, gifts, set_by, note)
            VALUES (${subject}, ${gifts}, ${userId}, ${note ?? null})
            ON CONFLICT (user_id) DO UPDATE
              SET gifts = EXCLUDED.gifts, set_by = EXCLUDED.set_by, set_at = now(), note = EXCLUDED.note`);
        }
      }
      return subjects.length;
    });
    if (people === 0) {
      res.status(404).json({ error: 'Not Found', message: 'No member who has signed in has that address.' });
      return;
    }
    log.info(`[gift] an allowance ${gifts === null ? 'cleared' : `set to ${gifts}`} for ${people} subject(s)`);
    res.json({ gifts, people });
  } catch (error) {
    serverFault(res, 'gift_allowance_failed', 'setting this person’s gifts', error);
  }
});

export default router;
