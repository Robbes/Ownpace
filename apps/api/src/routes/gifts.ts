// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * GIFTS: a place in the alpha, given as a present (workplan 0172; the owner,
 * 2026-11-24, G1 and G3). Three doors, one file:
 *
 *  - **The giver's** (`authenticate`): list their gifts and their limit, make
 *    one, revoke an unused one. A giver is a member of an organisation, which
 *    during the alpha means somebody the owner let in. Making a gift takes the
 *    card's language and nothing else: no recipient's address, name or
 *    message reaches this server (`a-gift-that-keeps-no-recipient`).
 *  - **The door's** (anonymous, `POST /redeem`): a code becomes an access
 *    request marked as a gift, which the owner approves like any other. The
 *    request form's protections, by name: a refusing rate limit of its own,
 *    the same trap field, and every stored field capped. Every bad code gets
 *    the same refusal (`GIFT_REFUSAL`), as a grant link's does.
 *  - **The operator's** (`authenticateSubject`, English only): every gift and
 *    whose, revoking one, the limit for everyone and for one person, and how
 *    many people the alpha has let in. As with the access queue, nothing here
 *    re-checks "operator": migration 0065's policies are the rule, and a
 *    non-operator reads an empty list and changes nothing.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { withSubject, withSubjectAndTenant } from '@openmig/ledger';
import {
  GIFT_ALREADY_ASKED,
  GIFT_REFUSAL,
  GIFTS_PER_PERSON_MAX,
  giftLimitFor,
  giftState,
  giftsPerPerson,
  giftsHeldBy,
  listOwnGifts,
  makeGift,
  redeemGift,
  revokeGift,
} from '@openmig/managed';
import { log, reasonPair } from '@openmig/shared';
import { authenticate, authenticateSubject, getDbPool } from '../middleware/auth.ts';
import type { AuthenticatedRequest } from '../types/api.ts';
import { serverFault } from '../server-fault.ts';
import { appUrl, tellOperator } from '../access-notify.ts';
import { createKnockLimiter, type KnockLimiter } from '../knock-limit.ts';

const router = Router();

type Pool = ReturnType<typeof getDbPool>;
let _pool: Pool | null = null;
const pool = (): Pool => (_pool ??= getDbPool());

/**
 * Twenty tries an hour from one caller. Sized as the request form's is, as a
 * SERVICE-WIDE cap unless `TRUST_PROXY` makes it per caller (`knock-limit.ts`):
 * a person with a card types it once or twice, and a script trying codes gets
 * twenty a deployment an hour against 80 bits.
 */
export const GIFT_REDEEM_LIMIT = { windowMs: 60 * 60 * 1000, max: 20 } as const;

let _limiter: KnockLimiter | null = null;
const limiter = (): KnockLimiter => (_limiter ??= createKnockLimiter(GIFT_REDEEM_LIMIT));

/** TEST SEAM ONLY: a fresh limiter, so one test's tries do not spend another's. */
export function __resetGiftLimiterForTests(): void {
  _limiter = null;
}

/** The request form's trap, by the same name (`access-requests.ts`, `TRAP_FIELD`). */
const TRAP_FIELD = 'website';

/** The request form's answer, byte for byte: a gift request is a request. */
const RECEIVED = {
  received: true,
  message: 'Thank you — we have your request. You will hear back by email.',
} as const;

/** Where the recipient types the code: the app's door with the code field open. */
const redeemAt = (): string | null => {
  const app = appUrl();
  return app ? `${app}/redeem` : null;
};

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

/** GET /api/gifts/mine: their gifts, newest first, and how many they may hold. */
router.get('/mine', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = subjectOf(req, res);
    if (!userId) return;
    const { gifts, limit, held } = await withSubject(pool(), userId, async (db) => ({
      gifts: await listOwnGifts(db, userId),
      limit: await giftLimitFor(db, userId),
      held: await giftsHeldBy(db, userId),
    }));
    res.json({
      gifts,
      limit: limit.limit,
      held,
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
      res.status(400).json({ error: 'Bad request', message: 'A gift is given from an organisation.' });
      return;
    }
    const parsed = MakeSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation error', details: parsed.error.issues });
      return;
    }
    const outcome = await withSubjectAndTenant(pool(), userId, tenantId, (db) =>
      makeGift(db, { tenantId, giverUserId: userId, locale: parsed.data.locale }),
    );
    if (outcome.kind === 'atLimit') {
      res.status(409).json({
        error: 'gift_limit',
        message:
          outcome.limit === 1
            ? 'You have given your gift already. Revoke an unused one to make another.'
            : `You have given your ${outcome.limit} gifts already. Revoke an unused one to make another.`,
        limit: outcome.limit,
      });
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
      res.status(404).json({ error: 'Not Found', message: 'No such gift.' });
      return;
    }
    const outcome = await withSubject(pool(), userId, (db) => revokeGift(db, id, userId));
    answerRevoke(res, id, outcome);
  } catch (error) {
    serverFault(res, 'gift_revoke_failed', 'revoking this gift', error);
  }
});

function answerRevoke(res: Response, id: string, outcome: Awaited<ReturnType<typeof revokeGift>>): void {
  if (outcome === 'notFound') {
    res.status(404).json({ error: 'Not Found', message: 'No such gift.' });
  } else if (outcome === 'notUnused') {
    res.status(409).json({ error: 'Conflict', message: 'Only an unused gift can be revoked.' });
  } else {
    log.info(`[gift] gift ${id} revoked`);
    res.json({ revoked: true, id });
  }
}

// ================================= The door =================================

/**
 * What the recipient types: the code, and their own request. Capped as the
 * request form caps the same fields.
 */
const RedeemSchema = z.object({
  code: z.string().max(64),
  email: z.string().trim().email().max(320),
  name: z.string().trim().max(200).optional(),
  organisation: z.string().trim().max(200).optional(),
  note: z.string().trim().max(2000).optional(),
  tier: z.string().trim().max(40).optional(),
  locale: z.enum(['en', 'nl']).default('en'),
  [TRAP_FIELD]: z.unknown().optional(),
});

const trapFilled = (value: unknown): boolean =>
  value === undefined || value === null ? false : typeof value === 'string' ? value.trim() !== '' : true;

/** POST /api/gifts/redeem: a code becomes a request marked as a gift, or the one refusal. */
router.post('/redeem', async (req: Request, res: Response) => {
  try {
    const caller = req.ip ?? 'unknown';
    if (!limiter().take(caller)) {
      res.set('Retry-After', String(limiter().retryAfterSeconds(caller)));
      res.status(429).json({
        error: 'Too many requests',
        message: 'That is more tries than we expected from one place. Try again later — nothing is lost.',
      });
      return;
    }
    const parsed = RedeemSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation error', details: parsed.error.issues });
      return;
    }
    const body = parsed.data;
    if (trapFilled(body[TRAP_FIELD])) {
      log.info('[gift] a redemption filled the trap field; answered as received, nothing kept');
      res.status(201).json(RECEIVED);
      return;
    }

    const outcome = await redeemGift(pool(), body.code, {
      email: body.email,
      ...(body.name ? { name: body.name } : {}),
      ...(body.organisation ? { organisation: body.organisation } : {}),
      ...(body.note ? { note: body.note } : {}),
      ...(body.tier ? { tier: body.tier } : {}),
      locale: body.locale,
    });

    if (outcome.kind === 'refused') {
      // 410, as a spent grant link answers, and the same body for every cause.
      log.info('[gift] a code was refused');
      res.status(410).json({ error: 'gift_refused', ...reasonPair(GIFT_REFUSAL) });
      return;
    }
    if (outcome.kind === 'alreadyAsked') {
      log.info('[gift] an address with a request still open came with a gift; nothing written, gift unspent');
      res.status(409).json({ error: 'already_asked', ...reasonPair(GIFT_ALREADY_ASKED) });
      return;
    }

    log.info(`[gift] gift ${outcome.giftId} became request ${outcome.requestId} (${body.locale})`);
    const announced = await tellOperator({ kind: 'access_requested', email: body.email, fromGift: true });
    if (announced === 'off') {
      log.warn(`[gift] nobody was told about request ${outcome.requestId} — no SMTP configured.`);
    } else if (announced === 'failed') {
      log.error(`[gift] could not announce request ${outcome.requestId}; it is in the queue.`);
    }
    res.status(201).json(RECEIVED);
  } catch (error) {
    serverFault(res, 'gift_redeem_failed', 'reading this gift code', error);
  }
});

// ============================== The operator ===============================

type Row = Record<string, unknown>;
const rowsOf = (result: unknown): Row[] => (result as { rows: Row[] }).rows;
const dateOrNull = (v: unknown): Date | null => (v === null || v === undefined ? null : new Date(String(v)));

/** GET /api/gifts/operator: every gift, the limits, and the alpha's count. */
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
      const [counts] = rowsOf(
        await db.execute(sql`
          SELECT count(*) FILTER (WHERE r.state = 'granted')::int AS granted,
                 count(*) FILTER (WHERE r.state = 'open')::int AS open,
                 count(*) FILTER (WHERE r.state = 'open'
                   AND EXISTS (SELECT 1 FROM public.gift g WHERE g.redeemed_request_id = r.id))::int AS open_gifts
            FROM public.access_request r`),
      );
      return { gifts, allowances, counts, perPerson: await giftsPerPerson(db) };
    });
    res.json({
      gifts: answer.gifts,
      giftsPerPerson: answer.perPerson,
      allowances: answer.allowances,
      alpha: {
        granted: Number(answer.counts?.granted ?? 0),
        open: Number(answer.counts?.open ?? 0),
        openFromGifts: Number(answer.counts?.open_gifts ?? 0),
        unusedGifts: answer.gifts.filter((g) => g.state === 'unused').length,
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
    answerRevoke(res, id, await withSubject(pool(), userId, (db) => revokeGift(db, id, userId)));
  } catch (error) {
    serverFault(res, 'gift_operator_revoke_failed', 'revoking this gift', error);
  }
});

const RuleSchema = z.object({ giftsPerPerson: z.number().int().min(0).max(GIFTS_PER_PERSON_MAX) }).strict();

/** PUT /api/gifts/operator/rule: how many gifts each person may hold. */
router.put('/operator/rule', authenticateSubject, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = subjectOf(req, res);
    if (!userId) return;
    const parsed = RuleSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation error', details: parsed.error.issues });
      return;
    }
    const changed = rowsOf(
      await withSubject(pool(), userId, (db) =>
        db.execute(sql`
          UPDATE public.gift_rule
             SET gifts_per_person = ${parsed.data.giftsPerPerson}, set_by = ${userId}, set_at = now()
           RETURNING gifts_per_person`),
      ),
    );
    if (changed.length !== 1) {
      res.status(404).json({ error: 'Not Found', message: 'No rule you may change.' });
      return;
    }
    log.info(`[gift] gifts per person set to ${parsed.data.giftsPerPerson}`);
    res.json({ giftsPerPerson: parsed.data.giftsPerPerson });
  } catch (error) {
    serverFault(res, 'gift_rule_failed', 'setting the gifts per person', error);
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
