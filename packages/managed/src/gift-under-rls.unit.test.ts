// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PLACE GIVEN AS A PRESENT (workplan 0172), and A RECOMMENDATION THAT LETS
 * ITS PERSON IN (workplan 0177 §5, D6): `gift-store.ts` and managed migrations
 * 0065 and 0066, under row security.
 *
 *  - a code is sixteen characters of the alphabet, printed in four groups, and
 *    read back however it is typed; only its fingerprint is kept;
 *  - the four states, in `linkState`'s order, and which of them hold a place;
 *  - two years by the calendar;
 *  - the giver sees and revokes their own gifts, another member sees none, an
 *    operator sees all, and the door sees exactly the row it names;
 *  - the limit: one each by the rule, the operator's number for one person,
 *    and a revoked gift giving its place back;
 *  - a code lets its person in (0177 D6): a session that holds an unused
 *    code writes, through migration 0066's one function, the request granted
 *    by nobody, the organisation, its owner's invitation and the spent code,
 *    once; a session with no code, a used one, a withdrawn one or somebody
 *    else's writes none of it and reads nobody's; no session of a code reads
 *    how many people are in, it learns a word;
 *  - an address with a request waiting has that one granted (D15 (a)); an
 *    address that already has access writes nothing (§5); a yes about Google
 *    is one fixed line in the note (D14 (a));
 *  - a member's own session learns two yes-or-nos and nobody else's: whether
 *    a new card has room, and whether a card's request made its own
 *    organisation (0177 D18); during the Alpha such a member's limit is nought;
 *  - a request made with a code before 0177, which the owner still answers,
 *    gives its gift back when declined (0172).
 *
 * PGlite as `app_user`, both chains. The names are invented.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { pgliteDriver, runMigrations, withSubject, withSubjectAndTenant } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import type { PgDatabase } from '@openmig/ledger/db';
import { runManagedMigrations } from './migrate-managed.ts';
import {
  GIFT_CODE_ALPHABET,
  GIFT_REFUSAL,
  GOOGLE_SAID_AT_THE_DOOR,
  checkGift,
  forACard,
  formatGiftCode,
  giftExpiry,
  giftFingerprint,
  giftLimitFor,
  giftState,
  giftsHeldBy,
  giveBackDeclinedGift,
  holdsAPlace,
  listOwnGifts,
  makeGift,
  mintGiftCode,
  readGiftCode,
  redeemGift,
  revokeGift,
  roomForACard,
  withGiftCode,
} from './gift-store.ts';
import { gift } from './schema-managed.ts';

// UUID family 01720000-…, unused elsewhere in the repo.
const P = '01720000-e29b-41d4-a716-4466554417';
const OURS = `${P}01`;
const THEIRS = `${P}02`;
const ANNA = 'subject-anna-0172';
const BRAM = 'subject-bram-0172';
const CATO = 'subject-cato-0177';
const OPERATOR = 'subject-operator-0172';

let driver: LedgerDriver;

async function owner(statement: string, params: unknown[] = []): Promise<Array<Record<string, unknown>>> {
  const conn = await driver.acquire();
  try {
    return (await conn.query(statement, params)).rows as Array<Record<string, unknown>>;
  } finally {
    await conn.release();
  }
}

const rowsOf = (result: unknown): Array<Record<string, unknown>> =>
  (result as { rows: Array<Record<string, unknown>> }).rows;

/** The database's own refusal, read under drizzle's wrapper, which keeps it as the cause. */
async function refusedFor(work: Promise<unknown>, why: RegExp, label = ''): Promise<void> {
  const error = await work.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, `${label}: it was not refused`).not.toBeNull();
  const cause = (error as { cause?: { message?: string } }).cause;
  expect(cause?.message ?? (error as Error).message, label).toMatch(why);
}

const give = (userId: string, tenantId: string, now?: Date, duringTheAlpha = false) =>
  withSubjectAndTenant(driver, userId, tenantId, (db) =>
    makeGift(db, { tenantId, giverUserId: userId, locale: 'nl', duringTheAlpha, ...(now ? { now } : {}) }),
  );

const made = async (userId: string, tenantId: string, now?: Date) => {
  const outcome = await give(userId, tenantId, now);
  if (outcome.kind !== 'made') throw new Error(`expected a gift, got ${outcome.kind}`);
  return outcome;
};

/** The fingerprint a session of this code holds. */
const fp = (code: string): string => giftFingerprint(readGiftCode(code)!);

/** Migration 0066's function, asked by hand in whatever session `db` is. */
const ask = async (db: PgDatabase, email: string | null = null): Promise<Record<string, unknown>> =>
  rowsOf(
    await db.execute(
      sql`SELECT * FROM public.let_in_by_a_recommendation(${email}, ${null}, ${'nl'}, ${false})`,
    ),
  )[0]!;

/** How many rows the three things a let-in writes have, and the codes spent, read as the owner. */
const counts = async (): Promise<{ requests: number; tenants: number; members: number; spent: number }> =>
  (
    await owner(`SELECT (SELECT count(*)::int FROM access_request) AS requests,
                        (SELECT count(*)::int FROM tenant) AS tenants,
                        (SELECT count(*)::int FROM tenant_member) AS members,
                        (SELECT count(*)::int FROM gift WHERE redeemed_at IS NOT NULL) AS spent`)
  )[0] as { requests: number; tenants: number; members: number; spent: number };

/**
 * A request made with a code before 0177, which the owner still answers
 * (0177 §8): an open request, and the gift spent pointing to it, as the door
 * of 0172 wrote them. Written as the owner, because no door writes it now.
 */
async function askedWithACodeBefore0177(giftId: string, email: string): Promise<string> {
  const [row] = await owner(`INSERT INTO access_request (email, locale) VALUES ($1, 'nl') RETURNING id`, [email]);
  await owner('UPDATE gift SET redeemed_at = now(), redeemed_request_id = $1 WHERE id = $2', [row!.id, giftId]);
  return String(row!.id);
}

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });
  await owner(`INSERT INTO tenant (id, name) VALUES ($1, 'Ours BV'), ($2, 'Theirs BV')`, [OURS, THEIRS]);
  await owner(
    `INSERT INTO tenant_member (tenant_id, user_id, email, role, status)
     VALUES ($1, $2, 'anna@example.com', 'owner', 'active'), ($3, $4, 'bram@example.com', 'owner', 'active')`,
    [OURS, ANNA, THEIRS, BRAM],
  );
  await owner(`INSERT INTO platform_operator (user_id, email) VALUES ($1, 'operator@example.com')`, [OPERATOR]);
}, 120_000);

beforeEach(async () => {
  await owner('DELETE FROM gift');
  await owner('DELETE FROM gift_allowance');
  await owner('UPDATE gift_rule SET gifts_per_person = 1, owner_ceiling = 50, recommendation_ceiling = 50');
  await owner('DELETE FROM access_request');
  // Every organisation a let-in made, and its invitation; Anna's and Bram's stay.
  await owner('DELETE FROM tenant_member WHERE tenant_id NOT IN ($1, $2)', [OURS, THEIRS]);
  await owner('DELETE FROM tenant WHERE id NOT IN ($1, $2)', [OURS, THEIRS]);
});

describe('the code', () => {
  it('is sixteen characters of the alphabet, in four groups of four', () => {
    for (let i = 0; i < 50; i++) {
      const code = mintGiftCode();
      expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/);
      expect(code.replace(/-/g, '').split('').every((c) => GIFT_CODE_ALPHABET.includes(c))).toBe(true);
    }
    expect(new Set(Array.from({ length: 200 }, mintGiftCode)).size).toBe(200);
  });

  it('is read however it is typed, and refused when it is not sixteen of the alphabet', () => {
    expect(readGiftCode('k7qm-3xr2-pa9d-w4hn')).toBe('K7QM3XR2PA9DW4HN');
    expect(readGiftCode(' K7QM 3XR2 PA9D W4HN ')).toBe('K7QM3XR2PA9DW4HN');
    expect(readGiftCode('OIL0-0000-0000-0000')).toBe('0110000000000000');
    expect(formatGiftCode('K7QM3XR2PA9DW4HN')).toBe('K7QM-3XR2-PA9D-W4HN');
    for (const bad of ['', 'K7QM-3XR2-PA9D', 'K7QM-3XR2-PA9D-W4HNX', 'K7QM-3XR2-PA9D-W4HU', 42, null, 'x'.repeat(100)]) {
      expect(readGiftCode(bad), String(bad)).toBeNull();
    }
  });

  it('is kept as a tagged fingerprint, never as itself', async () => {
    const { code } = await made(ANNA, OURS);
    const rows = await owner('SELECT code_hash FROM gift');
    expect(rows).toHaveLength(1);
    const stored = String(rows[0]!.code_hash);
    expect(stored).toBe(giftFingerprint(readGiftCode(code)!));
    expect(stored).toMatch(/^gift1:[0-9a-f]{64}$/);
    expect(stored).not.toContain(code.replace(/-/g, ''));
  });
});

describe('the states and the dates', () => {
  const at = new Date('2026-12-24T18:00:00Z');
  const row = (
    over: Partial<{ redeemedAt: Date | null; revokedAt: Date | null; expiresAt: Date; requestDeclinedAt: Date | null }>,
  ) => ({
    redeemedAt: null,
    revokedAt: null,
    expiresAt: giftExpiry(at),
    requestDeclinedAt: null,
    ...over,
  });

  it('is valid for two years by the calendar', () => {
    expect(giftExpiry(at).toISOString()).toBe('2028-12-24T18:00:00.000Z');
  });

  it('says unused, redeemed, revoked or expired, a redeemed gift staying redeemed past its date', () => {
    expect(giftState(row({}), at)).toBe('unused');
    expect(giftState(row({ redeemedAt: at }), at)).toBe('redeemed');
    expect(giftState(row({ redeemedAt: at }), giftExpiry(giftExpiry(at)))).toBe('redeemed');
    expect(giftState(row({ revokedAt: at }), at)).toBe('revoked');
    expect(giftState(row({}), giftExpiry(at))).toBe('expired');
  });

  it('holds a place while unused or redeemed, but not once its request was declined', () => {
    expect(holdsAPlace(row({}), at)).toBe(true);
    expect(holdsAPlace(row({ redeemedAt: at }), at)).toBe(true);
    expect(holdsAPlace(row({ redeemedAt: at, requestDeclinedAt: at }), at)).toBe(false);
    expect(holdsAPlace(row({ revokedAt: at }), at)).toBe(false);
    expect(holdsAPlace(row({}), giftExpiry(at))).toBe(false);
    // Declined, the gift still reads as used: the card was used.
    expect(giftState(row({ redeemedAt: at, requestDeclinedAt: at }), at)).toBe('redeemed');
  });
});

describe('the one refusal', () => {
  it("names the giver as the owner put it (2026-11-25)", () => {
    expect(GIFT_REFUSAL.nl).toMatch(/Vergelijk hem met de kaart, of vraag het aan degene die u de kaart gaf\.$/);
    expect(GIFT_REFUSAL.en).toMatch(/Check it against the card, or ask the person who gave it to you\.$/);
  });

  it('calls the thing a code, in both languages: the free one is no gift (0177 §7, D1)', () => {
    expect(GIFT_REFUSAL.en).toMatch(/^This code cannot be used\./);
    expect(GIFT_REFUSAL.nl).toMatch(/^Deze code kan niet worden gebruikt\./);
    expect(`${GIFT_REFUSAL.en} ${GIFT_REFUSAL.nl}`).not.toMatch(/gift|cadeau/i);
  });
});

describe('who sees a gift', () => {
  it('the giver sees their own; another member sees none; the operator sees all', async () => {
    await made(ANNA, OURS);
    await made(BRAM, THEIRS);
    expect(await withSubject(driver, ANNA, (db) => listOwnGifts(db, ANNA))).toHaveLength(1);
    // Bram asking for Anna's: the policy hides them, whatever the WHERE says.
    expect(await withSubject(driver, BRAM, (db) => listOwnGifts(db, ANNA))).toHaveLength(0);
    expect(await withSubject(driver, OPERATOR, (db) => db.select({ id: gift.id }).from(gift))).toHaveLength(2);
    expect(await withSubject(driver, 'nobody', (db) => db.select({ id: gift.id }).from(gift))).toHaveLength(0);
  });

  it('the door sees exactly the row whose fingerprint it was given, and no other', async () => {
    const { code } = await made(ANNA, OURS);
    await made(BRAM, THEIRS);
    const seen = await withGiftCode(driver, giftFingerprint(readGiftCode(code)!), (db) =>
      db.select({ id: gift.id }).from(gift),
    );
    expect(seen).toHaveLength(1);
    expect(
      await withGiftCode(driver, giftFingerprint('0000000000000000'), (db) => db.select({ id: gift.id }).from(gift)),
    ).toHaveLength(0);
  });

  it('a member cannot give in another organisation’s name', async () => {
    await expect(
      withSubjectAndTenant(driver, ANNA, OURS, (db) =>
        makeGift(db, { tenantId: THEIRS, giverUserId: ANNA, locale: 'en', duringTheAlpha: false }),
      ),
    ).rejects.toThrow();
  });
});

describe('the limit', () => {
  it('is one each by the rule, and a second is refused with the number', async () => {
    await made(ANNA, OURS);
    expect(await give(ANNA, OURS)).toEqual({ kind: 'atLimit', limit: 1 });
    // Bram's is his own, given from his own organisation, as the middleware
    // finds it (a session naming one it is no member of learns nothing: below).
    expect((await give(BRAM, THEIRS)).kind).toBe('made');
  });

  it('follows the operator: for everyone, and for one person over everyone', async () => {
    await withSubject(driver, OPERATOR, (db) => db.execute(sql`UPDATE gift_rule SET gifts_per_person = 2`));
    await made(ANNA, OURS);
    await made(ANNA, OURS);
    expect((await give(ANNA, OURS)).kind).toBe('atLimit');
    await withSubject(driver, OPERATOR, (db) =>
      db.execute(sql`INSERT INTO gift_allowance (user_id, gifts, set_by) VALUES (${ANNA}, 3, ${OPERATOR})`),
    );
    expect(await withSubjectAndTenant(driver, ANNA, OURS, (db) => giftLimitFor(db, ANNA, { duringTheAlpha: true }))).toEqual({
      limit: 3,
      from: 'person',
    });
    expect((await give(ANNA, OURS)).kind).toBe('made');
  });

  it('cannot be changed by a giver', async () => {
    await withSubject(driver, ANNA, (db) =>
      db.execute(sql`UPDATE gift_rule SET gifts_per_person = 9, owner_ceiling = 999, recommendation_ceiling = 999`),
    );
    expect(await owner('SELECT gifts_per_person, owner_ceiling, recommendation_ceiling FROM gift_rule')).toEqual([
      { gifts_per_person: 1, owner_ceiling: 50, recommendation_ceiling: 50 },
    ]);
    await expect(
      withSubject(driver, ANNA, (db) =>
        db.execute(sql`INSERT INTO gift_allowance (user_id, gifts, set_by) VALUES (${ANNA}, 9, ${ANNA})`),
      ),
    ).rejects.toThrow();
  });

  it('a revoked gift gives its place back; a used one keeps it', async () => {
    const first = await made(ANNA, OURS);
    expect(await withSubject(driver, ANNA, (db) => revokeGift(db, first.id, ANNA))).toBe('revoked');
    const second = await made(ANNA, OURS);
    expect((await redeemGift(driver, second.code, { email: 'cato@example.com', locale: 'nl' })).kind).toBe('letIn');
    expect((await give(ANNA, OURS)).kind).toBe('atLimit');
  });
});

describe('the two ceilings on the rule’s one row (0177 §20.2)', () => {
  it('are 50 each, whole numbers, nought or more', async () => {
    expect(await owner('SELECT owner_ceiling, recommendation_ceiling FROM gift_rule')).toEqual([
      { owner_ceiling: 50, recommendation_ceiling: 50 },
    ]);
    await expect(owner('UPDATE gift_rule SET owner_ceiling = -1')).rejects.toThrow(/gift_rule_owner_ceiling_check/);
    await expect(owner('UPDATE gift_rule SET recommendation_ceiling = -1')).rejects.toThrow(
      /gift_rule_recommendation_ceiling_check/,
    );
    await owner('UPDATE gift_rule SET owner_ceiling = 0, recommendation_ceiling = 0');
  });

  it('the operator sets them, a member does not', async () => {
    await withSubject(driver, OPERATOR, (db) =>
      db.execute(sql`UPDATE gift_rule SET owner_ceiling = 40, recommendation_ceiling = 30`),
    );
    await withSubject(driver, ANNA, (db) => db.execute(sql`UPDATE gift_rule SET owner_ceiling = 1`));
    expect(await owner('SELECT owner_ceiling, recommendation_ceiling FROM gift_rule')).toEqual([
      { owner_ceiling: 40, recommendation_ceiling: 30 },
    ]);
  });
});

describe('a request made with a code before 0177 gives the gift back when declined (0172)', () => {
  it('the operator declining the request frees the giver to make another; a granted one does not', async () => {
    const first = await made(ANNA, OURS);
    const requestId = await askedWithACodeBefore0177(first.id, 'cato@example.com');
    expect((await give(ANNA, OURS)).kind).toBe('atLimit');

    // A request without a gift touches nothing.
    const [plain] = await owner(`INSERT INTO access_request (email, locale) VALUES ('dirk@example.com', 'en') RETURNING id`);
    expect(await withSubject(driver, OPERATOR, (db) => giveBackDeclinedGift(db, String(plain!.id)))).toBe(0);

    expect(await withSubject(driver, OPERATOR, (db) => giveBackDeclinedGift(db, requestId))).toBe(1);
    // Once: a second call gives nothing more back.
    expect(await withSubject(driver, OPERATOR, (db) => giveBackDeclinedGift(db, requestId))).toBe(0);
    expect(await withSubject(driver, ANNA, (db) => giftsHeldBy(db, ANNA))).toBe(0);
    const [mine] = await withSubject(driver, ANNA, (db) => listOwnGifts(db, ANNA));
    expect(mine!.state).toBe('redeemed');
    expect((await give(ANNA, OURS)).kind).toBe('made');
    expect((await give(ANNA, OURS)).kind).toBe('atLimit');
  });

  it('survives the declined request being pruned', async () => {
    const first = await made(ANNA, OURS);
    const requestId = await askedWithACodeBefore0177(first.id, 'cato@example.com');
    await withSubject(driver, OPERATOR, (db) => giveBackDeclinedGift(db, requestId));
    await owner('DELETE FROM access_request WHERE id = $1', [requestId]);
    expect((await owner('SELECT redeemed_request_id FROM gift WHERE id = $1', [first.id]))[0]!.redeemed_request_id).toBeNull();
    expect(await withSubject(driver, ANNA, (db) => giftsHeldBy(db, ANNA))).toBe(0);
  });

  it('a giver cannot mark their own gift declined', async () => {
    const first = await made(ANNA, OURS);
    const requestId = await askedWithACodeBefore0177(first.id, 'cato@example.com');
    await expect(withSubject(driver, ANNA, (db) => giveBackDeclinedGift(db, requestId))).rejects.toThrow();
    expect(await withSubject(driver, ANNA, (db) => giftsHeldBy(db, ANNA))).toBe(1);
  });

  it('only a redeemed gift can carry a declined request', async () => {
    const { id } = await made(ANNA, OURS);
    await expect(owner('UPDATE gift SET request_declined_at = now() WHERE id = $1', [id])).rejects.toThrow(
      /gift_request_declined_check/,
    );
  });
});

describe('revoking', () => {
  it('the giver revokes their own unused gift, not a spent one and not somebody else’s', async () => {
    const mine = await made(ANNA, OURS);
    expect(await withSubject(driver, BRAM, (db) => revokeGift(db, mine.id, BRAM))).toBe('notFound');
    expect(await withSubject(driver, ANNA, (db) => revokeGift(db, mine.id, ANNA))).toBe('revoked');
    expect(await withSubject(driver, ANNA, (db) => revokeGift(db, mine.id, ANNA))).toBe('notUnused');
    const theirs = await made(BRAM, THEIRS);
    expect(await withSubject(driver, OPERATOR, (db) => revokeGift(db, theirs.id, OPERATOR))).toBe('revoked');
  });
});

describe('a code lets its person in, under row security (0177 §5, D6)', () => {
  const cato = { email: 'cato@example.com', name: 'Cato', locale: 'nl' as const };

  it('a session that holds an unused code writes the request granted by nobody, the organisation, its owner’s invitation and the spent code: once', async () => {
    const { code, id } = await made(ANNA, OURS);
    const outcome = await redeemGift(driver, code.toLowerCase(), cato);
    expect(outcome.kind).toBe('letIn');
    if (outcome.kind !== 'letIn') return;

    expect(
      await owner(
        `SELECT email, name, locale, state, decided_by, decided_at IS NOT NULL AS decided, tenant_id, note
           FROM access_request WHERE id = $1`,
        [outcome.requestId],
      ),
    ).toEqual([
      {
        email: 'cato@example.com',
        name: 'Cato',
        locale: 'nl',
        state: 'granted',
        decided_by: null,
        decided: true,
        tenant_id: outcome.tenantId,
        note: null,
      },
    ]);
    expect(await owner('SELECT name, status FROM tenant WHERE id = $1', [outcome.tenantId])).toEqual([
      { name: 'Cato', status: 'active' },
    ]);
    const members = await owner('SELECT email, role, status, origin, user_id FROM tenant_member WHERE tenant_id = $1', [
      outcome.tenantId,
    ]);
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({ email: 'cato@example.com', role: 'owner', status: 'invited', origin: 'requested' });
    expect(String(members[0]!.user_id)).toMatch(/^pending:/);
    expect(await owner('SELECT redeemed_request_id, redeemed_at IS NOT NULL AS spent FROM gift WHERE id = $1', [id])).toEqual([
      { redeemed_request_id: outcome.requestId, spent: true },
    ]);
    expect(outcome).toMatchObject({ giftId: id, organisation: 'Cato', email: 'cato@example.com' });

    // Once: the same code again is the one refusal, and writes nothing more.
    const before = await counts();
    expect(await redeemGift(driver, code, { ...cato, email: 'dirk@example.com' })).toEqual({ kind: 'refused' });
    expect(await counts()).toEqual(before);
  });

  it('names the organisation after the name typed, or else after the address', async () => {
    const { code } = await made(ANNA, OURS);
    const outcome = await redeemGift(driver, code, { email: 'eva@example.com', locale: 'en' });
    if (outcome.kind !== 'letIn') throw new Error(outcome.kind);
    expect(await owner('SELECT name FROM tenant WHERE id = $1', [outcome.tenantId])).toEqual([{ name: 'eva@example.com' }]);
    expect(outcome.organisation).toBe('eva@example.com');
  });

  it('a session with no code, a used one, a withdrawn one or somebody else’s can write none of it, and reads nobody’s', async () => {
    await owner('UPDATE gift_rule SET gifts_per_person = 3');
    const used = await made(ANNA, OURS);
    expect((await redeemGift(driver, used.code, cato)).kind).toBe('letIn');
    const withdrawn = await made(BRAM, THEIRS);
    await withSubject(driver, BRAM, (db) => revokeGift(db, withdrawn.id, BRAM));
    const brams = await made(BRAM, THEIRS);
    const annas = await made(ANNA, OURS);
    await owner(`INSERT INTO access_request (email, locale) VALUES ('waiting@example.com', 'en')`);
    const before = await counts();

    // Through the door's one function: refused, for every session but an unused code's.
    for (const fingerprint of ['', giftFingerprint('0000000000000000'), fp(used.code), fp(withdrawn.code)]) {
      expect((await withGiftCode(driver, fingerprint, (db) => ask(db, 'eve@example.com'))).answer, fingerprint).toBe(
        'refused',
      );
      expect((await withGiftCode(driver, fingerprint, (db) => ask(db))).answer, fingerprint).toBe('refused');
    }

    // And by hand, even holding an unused code: no granted request, no
    // organisation, no invitation, no waiting request granted, nobody else's
    // gift spent, and nobody's rows read.
    for (const fingerprint of ['', fp(used.code), fp(brams.code)]) {
      const who = fingerprint || 'no code';
      await refusedFor(
        withGiftCode(driver, fingerprint, (db) =>
          db.execute(sql`INSERT INTO access_request (email, state, tenant_id, decided_at)
                         VALUES ('eve@example.com', 'granted', ${OURS}, now())`),
        ),
        /row-level security/,
        `a granted request, as ${who}`,
      );
      await refusedFor(
        withGiftCode(driver, fingerprint, (db) => db.execute(sql`INSERT INTO tenant (id, name) VALUES (gen_random_uuid(), 'Eve')`)),
        /row-level security/,
        `an organisation, as ${who}`,
      );
      await refusedFor(
        withGiftCode(driver, fingerprint, (db) =>
          db.execute(sql`INSERT INTO tenant_member (tenant_id, user_id, email, role, status)
                         VALUES (${OURS}, 'pending:eve', 'eve@example.com', 'owner', 'invited')`),
        ),
        /row-level security/,
        `an invitation, as ${who}`,
      );
      const granted = await withGiftCode(driver, fingerprint, (db) =>
        db.execute(sql`UPDATE access_request SET state = 'granted', tenant_id = ${OURS}, decided_at = now()
                        WHERE state = 'open' RETURNING id`),
      );
      expect(rowsOf(granted)).toEqual([]);
      const spent = await withGiftCode(driver, fingerprint, (db) =>
        db.execute(sql`UPDATE gift SET redeemed_at = now() WHERE id = ${annas.id} RETURNING id`),
      );
      expect(rowsOf(spent)).toEqual([]);
      for (const table of ['access_request', 'tenant', 'tenant_member']) {
        const seen = await withGiftCode(driver, fingerprint, (db) => db.execute(sql.raw(`SELECT 1 FROM ${table}`)));
        expect(rowsOf(seen), `${table}, as ${fingerprint || 'no code'}`).toEqual([]);
      }
    }
    expect(await counts()).toEqual(before);
  });

  it('no session of a code reads how many people are in: it learns a word', async () => {
    await owner('UPDATE gift_rule SET gifts_per_person = 2');
    const first = await made(ANNA, OURS);
    expect((await redeemGift(driver, first.code, cato)).kind).toBe('letIn');
    await owner(
      `INSERT INTO access_request (email, locale, state, tenant_id, decided_by, decided_at)
       VALUES ('by-the-owner@example.com', 'en', 'granted', $1, $2, now())`,
      [OURS, OPERATOR],
    );
    const { code } = await made(ANNA, OURS);

    const look = await withGiftCode(driver, fp(code), (db) => ask(db));
    expect(look).toEqual({
      answer: 'room',
      request_id: null,
      tenant_id: null,
      organisation: null,
      email: null,
      by_recommendation: null,
    });
    for (const [table, n] of [
      ['access_request', 0],
      ['tenant_member', 0],
      ['tenant', 0],
      ['gift', 1],
    ] as const) {
      const seen = await withGiftCode(driver, fp(code), (db) => db.execute(sql.raw(`SELECT count(*)::int AS n FROM ${table}`)));
      expect(rowsOf(seen), table).toEqual([{ n }]);
    }
    // The number is not on the rule's row either: that holds the ceilings, never a count.
    const rule = await withGiftCode(driver, fp(code), (db) => db.execute(sql`SELECT * FROM gift_rule`));
    expect(Object.keys(rowsOf(rule)[0]!).sort()).toEqual(
      ['gifts_per_person', 'id', 'owner_ceiling', 'recommendation_ceiling', 'set_at', 'set_by'].sort(),
    );
  });

  it('the check reads the code and writes nothing', async () => {
    const { code, id, expiresAt } = await made(ANNA, OURS);
    const before = await counts();
    expect(await checkGift(driver, code)).toEqual({ kind: 'room', until: expiresAt });
    expect(await checkGift(driver, 'ZZZZ-ZZZZ-ZZZZ-ZZZZ')).toEqual({ kind: 'refused' });
    expect(await counts()).toEqual(before);
    expect((await owner('SELECT redeemed_at FROM gift WHERE id = $1', [id]))[0]!.redeemed_at).toBeNull();
  });

  it('refuses unknown, malformed, used, revoked and expired codes alike, writing nothing', async () => {
    await owner('UPDATE gift_rule SET gifts_per_person = 3');
    const used = await made(ANNA, OURS);
    expect((await redeemGift(driver, used.code, cato)).kind).toBe('letIn');
    const revoked = await made(ANNA, OURS);
    await withSubject(driver, ANNA, (db) => revokeGift(db, revoked.id, ANNA));
    const old = await made(BRAM, THEIRS, new Date('2020-01-01T00:00:00Z'));
    const before = await counts();
    for (const code of [used.code, revoked.code, old.code, mintGiftCode(), 'not a code', '']) {
      expect(await redeemGift(driver, code, { ...cato, email: 'dirk@example.com' }), code).toEqual({ kind: 'refused' });
      expect(await checkGift(driver, code), code).toEqual({ kind: 'refused' });
    }
    expect(await counts()).toEqual(before);
  });

  it('an address with a request waiting has that one granted, and no second one is written (D15 (a))', async () => {
    const [waiting] = await owner(
      `INSERT INTO access_request (email, name, organisation, note, tier, locale)
       VALUES ('Cato@Example.com ', 'Cato de Vries', 'Familie de Vries', 'Two mailboxes at Google', 'Small', 'en')
       RETURNING id`,
    );
    const { code, id } = await made(ANNA, OURS);
    const outcome = await redeemGift(driver, code, { email: 'cato@example.com', name: 'C.', locale: 'nl', google: true });
    if (outcome.kind !== 'letIn') throw new Error(outcome.kind);
    expect(outcome.requestId).toBe(String(waiting!.id));
    expect(await owner('SELECT count(*)::int AS n FROM access_request')).toEqual([{ n: 1 }]);
    // It keeps what the person wrote in it, and the Google line stands under their note.
    expect(
      await owner('SELECT email, name, organisation, tier, locale, state, decided_by, note FROM access_request WHERE id = $1', [
        waiting!.id,
      ]),
    ).toEqual([
      {
        email: 'Cato@Example.com ',
        name: 'Cato de Vries',
        organisation: 'Familie de Vries',
        tier: 'Small',
        locale: 'en',
        state: 'granted',
        decided_by: null,
        note: `Two mailboxes at Google\n\n${GOOGLE_SAID_AT_THE_DOOR}`,
      },
    ]);
    // Named as a grant names it: the organisation the person named first.
    expect(await owner('SELECT name FROM tenant WHERE id = $1', [outcome.tenantId])).toEqual([{ name: 'Familie de Vries' }]);
    expect(await owner('SELECT email FROM tenant_member WHERE tenant_id = $1', [outcome.tenantId])).toEqual([
      { email: 'Cato@Example.com ' },
    ]);
    expect((await owner('SELECT redeemed_request_id FROM gift WHERE id = $1', [id]))[0]!.redeemed_request_id).toBe(
      outcome.requestId,
    );
  });

  it('a yes about Google is one fixed English line in the note; a no writes none (D14 (a))', async () => {
    expect(GOOGLE_SAID_AT_THE_DOOR).toBe('Said at the door: this address is a Google account to move.');
    await owner('UPDATE gift_rule SET gifts_per_person = 2');
    const yes = await made(ANNA, OURS);
    const no = await made(ANNA, OURS);
    const a = await redeemGift(driver, yes.code, { email: 'gmail@example.com', locale: 'en', google: true });
    const b = await redeemGift(driver, no.code, { email: 'other@example.com', locale: 'en', google: false });
    if (a.kind !== 'letIn' || b.kind !== 'letIn') throw new Error(`${a.kind} ${b.kind}`);
    expect(await owner('SELECT note FROM access_request WHERE id = $1', [a.requestId])).toEqual([
      { note: GOOGLE_SAID_AT_THE_DOOR },
    ]);
    expect(await owner('SELECT note FROM access_request WHERE id = $1', [b.requestId])).toEqual([{ note: null }]);
  });

  it('an address that already has access writes nothing and keeps the code', async () => {
    const { code, id } = await made(ANNA, OURS);
    const before = await counts();
    // Anna's own address, in another case: she is an active owner already.
    expect(await redeemGift(driver, code, { email: ' ANNA@example.com', locale: 'en' })).toEqual({ kind: 'alreadyIn' });
    // An invitation waiting for its person is access too: signing in takes it up.
    await owner(
      `INSERT INTO tenant_member (tenant_id, user_id, email, role, status) VALUES ($1, 'pending:fenna', 'fenna@example.com', 'member', 'invited')`,
      [THEIRS],
    );
    expect(await redeemGift(driver, code, { email: 'fenna@example.com', locale: 'en' })).toEqual({ kind: 'alreadyIn' });
    // A removed member and a declined invitation are not.
    await owner(
      `INSERT INTO tenant_member (tenant_id, user_id, email, role, status)
       VALUES ($1, 'subject-gone', 'gone@example.com', 'member', 'removed'),
              ($1, 'pending:no', 'no@example.com', 'member', 'declined')`,
      [THEIRS],
    );
    expect((await owner('SELECT redeemed_at FROM gift WHERE id = $1', [id]))[0]!.redeemed_at).toBeNull();
    expect(await counts()).toEqual({ ...before, members: before.members + 3 });
    expect((await redeemGift(driver, code, { email: 'gone@example.com', locale: 'en' })).kind).toBe('letIn');
  });

  it('a giver learns whether there is room for a card, as a yes or a no; somebody who is no member learns nothing', async () => {
    expect(await withSubjectAndTenant(driver, ANNA, OURS, (db) => roomForACard(db))).toBe(true);
    for (const [who, tenant] of [
      ['subject-nobody', OURS],
      [ANNA, THEIRS],
    ] as const) {
      const nobody = await withSubjectAndTenant(driver, who, tenant, (db) => ask(db));
      expect(nobody, `${who} in ${tenant}`).toMatchObject({ answer: 'refused', by_recommendation: null });
    }
    // Without an organisation named, a member's session is no member's either.
    expect((await withSubject(driver, ANNA, (db) => ask(db))).answer).toBe('refused');
    await owner('UPDATE gift_rule SET recommendation_ceiling = 0');
    expect(await withSubjectAndTenant(driver, ANNA, OURS, (db) => roomForACard(db))).toBe(false);
  });

  it('a member’s own session learns whether a card’s request made its organisation, and nobody else’s (D18)', async () => {
    await owner('UPDATE gift_rule SET gifts_per_person = 2');
    const first = await made(ANNA, OURS);
    const letIn = await redeemGift(driver, first.code, cato);
    if (letIn.kind !== 'letIn') throw new Error(letIn.kind);
    // Cato signs in: her invitation becomes her membership.
    await owner(`UPDATE tenant_member SET user_id = $1, status = 'active', joined_at = now() WHERE tenant_id = $2`, [
      CATO,
      letIn.tenantId,
    ]);
    expect(await withSubjectAndTenant(driver, CATO, letIn.tenantId, (db) => forACard(db))).toEqual({
      room: true,
      cameByARecommendation: true,
    });
    expect(await withSubjectAndTenant(driver, ANNA, OURS, (db) => forACard(db))).toEqual({
      room: true,
      cameByARecommendation: false,
    });
    // Naming an organisation one is no member of answers nothing, either way round.
    for (const [who, tenant] of [
      [CATO, OURS],
      [ANNA, letIn.tenantId],
    ] as const) {
      expect(await withSubjectAndTenant(driver, who, tenant, (db) => ask(db)), `${who} in ${tenant}`).toMatchObject({
        answer: 'refused',
        by_recommendation: null,
      });
    }
    // A code's session learns no such thing, and no session reads it from the rows.
    const { code } = await made(ANNA, OURS);
    expect((await withGiftCode(driver, fp(code), (db) => ask(db))).by_recommendation).toBeNull();
    const seen = await withSubjectAndTenant(driver, CATO, letIn.tenantId, (db) =>
      db.execute(sql`SELECT (SELECT count(*)::int FROM access_request) AS requests, (SELECT count(*)::int FROM gift) AS gifts`),
    );
    expect(rowsOf(seen)).toEqual([{ requests: 0, gifts: 0 }]);
  });

  it('during the Alpha such a member’s limit is nought, and after it the rule’s (D18)', async () => {
    const first = await made(ANNA, OURS);
    const letIn = await redeemGift(driver, first.code, cato);
    if (letIn.kind !== 'letIn') throw new Error(letIn.kind);
    await owner(`UPDATE tenant_member SET user_id = $1, status = 'active', joined_at = now() WHERE tenant_id = $2`, [
      CATO,
      letIn.tenantId,
    ]);
    expect(
      await withSubjectAndTenant(driver, CATO, letIn.tenantId, (db) => giftLimitFor(db, CATO, { duringTheAlpha: true })),
    ).toEqual({ limit: 0, from: 'onlyAfterAlpha' });
    expect(await give(CATO, letIn.tenantId, undefined, true)).toEqual({ kind: 'onlyAfterAlpha' });
    expect(
      await withSubjectAndTenant(driver, CATO, letIn.tenantId, (db) => giftLimitFor(db, CATO, { duringTheAlpha: false })),
    ).toEqual({ limit: 1, from: 'everyone' });
    expect((await give(CATO, letIn.tenantId, undefined, false)).kind).toBe('made');
    // Anna, whom the owner's seed let in, has hers during the Alpha too.
    expect(
      await withSubjectAndTenant(driver, ANNA, OURS, (db) => giftLimitFor(db, ANNA, { duringTheAlpha: true })),
    ).toEqual({ limit: 1, from: 'everyone' });
  });

  it('a session with no code may still ask, as the plain form does, and only ask', async () => {
    await withGiftCode(driver, '', (db) => db.execute(sql`INSERT INTO access_request (email, locale) VALUES ('asks@example.com', 'en')`));
    expect(await owner(`SELECT state FROM access_request WHERE email = 'asks@example.com'`)).toEqual([{ state: 'open' }]);
    for (const late of [
      sql`INSERT INTO access_request (email, state, decided_by, decided_at) VALUES ('d@example.com', 'declined', 'me', now())`,
      sql`INSERT INTO access_request (email, decision_note) VALUES ('n@example.com', 'a note of my own')`,
      sql`INSERT INTO access_request (email, decided_by) VALUES ('b@example.com', 'me')`,
    ]) {
      await refusedFor(
        withGiftCode(driver, '', (db) => db.execute(late)),
        /row-level security|access_request_decided_check/,
        'a request that is not only asked',
      );
    }
  });

  it('the function runs as its owner for app_user alone: PUBLIC may not call it (0138 §2)', async () => {
    const rows = await owner(`
      SELECT p.prosecdef AS definer,
             has_function_privilege('app_user', p.oid, 'EXECUTE') AS app_user,
             has_function_privilege('ownpace_system', p.oid, 'EXECUTE') AS system_role,
             array_to_string(p.proconfig, ',') AS config
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'let_in_by_a_recommendation'`);
    expect(rows).toEqual([{ definer: true, app_user: true, system_role: false, config: 'search_path=pg_catalog, pg_temp' }]);
  });
});
