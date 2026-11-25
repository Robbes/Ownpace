// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PLACE GIVEN AS A PRESENT (workplan 0172): `gift-store.ts` and managed
 * migration 0064, under row security.
 *
 *  - a code is sixteen characters of the alphabet, printed in four groups, and
 *    read back however it is typed; only its fingerprint is kept;
 *  - the four states, in `linkState`'s order, and which of them hold a place;
 *  - two years by the calendar;
 *  - the giver sees and revokes their own gifts, another member sees none, an
 *    operator sees all, and the door sees exactly the row it names;
 *  - the limit: one each by the rule, the operator's number for one person,
 *    and a revoked gift giving its place back;
 *  - redeeming writes the request and spends the gift together, once; every
 *    bad code is the same refusal and writes nothing; an address with an
 *    open request writes nothing and leaves the gift unspent.
 *
 * PGlite as `app_user`, both chains. The names are invented.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { pgliteDriver, runMigrations, withSubject, withSubjectAndTenant } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from './migrate-managed.ts';
import {
  GIFT_CODE_ALPHABET,
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
  withGiftCode,
} from './gift-store.ts';
import { gift } from './schema-managed.ts';

// UUID family 01720000-…, unused elsewhere in the repo.
const P = '01720000-e29b-41d4-a716-4466554417';
const OURS = `${P}01`;
const THEIRS = `${P}02`;
const ANNA = 'subject-anna-0172';
const BRAM = 'subject-bram-0172';
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

const give = (userId: string, tenantId: string, now?: Date) =>
  withSubjectAndTenant(driver, userId, tenantId, (db) =>
    makeGift(db, { tenantId, giverUserId: userId, locale: 'nl', ...(now ? { now } : {}) }),
  );

const made = async (userId: string, tenantId: string, now?: Date) => {
  const outcome = await give(userId, tenantId, now);
  if (outcome.kind !== 'made') throw new Error(`expected a gift, got ${outcome.kind}`);
  return outcome;
};

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });
  await owner(`INSERT INTO tenant (id, name) VALUES ($1, 'Ours BV'), ($2, 'Theirs BV')`, [OURS, THEIRS]);
  await owner(`INSERT INTO platform_operator (user_id, email) VALUES ($1, 'operator@example.com')`, [OPERATOR]);
}, 120_000);

beforeEach(async () => {
  await owner('DELETE FROM gift');
  await owner('DELETE FROM gift_allowance');
  await owner('UPDATE gift_rule SET gifts_per_person = 1');
  await owner('DELETE FROM access_request');
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
        makeGift(db, { tenantId: THEIRS, giverUserId: ANNA, locale: 'en' }),
      ),
    ).rejects.toThrow();
  });
});

describe('the limit', () => {
  it('is one each by the rule, and a second is refused with the number', async () => {
    await made(ANNA, OURS);
    expect(await give(ANNA, OURS)).toEqual({ kind: 'atLimit', limit: 1 });
    // Bram's is his own.
    expect((await give(BRAM, OURS)).kind).toBe('made');
  });

  it('follows the operator: for everyone, and for one person over everyone', async () => {
    await withSubject(driver, OPERATOR, (db) => db.execute(sql`UPDATE gift_rule SET gifts_per_person = 2`));
    await made(ANNA, OURS);
    await made(ANNA, OURS);
    expect((await give(ANNA, OURS)).kind).toBe('atLimit');
    await withSubject(driver, OPERATOR, (db) =>
      db.execute(sql`INSERT INTO gift_allowance (user_id, gifts, set_by) VALUES (${ANNA}, 3, ${OPERATOR})`),
    );
    expect(await withSubject(driver, ANNA, (db) => giftLimitFor(db, ANNA))).toEqual({ limit: 3, from: 'person' });
    expect((await give(ANNA, OURS)).kind).toBe('made');
  });

  it('cannot be changed by a giver', async () => {
    await withSubject(driver, ANNA, (db) => db.execute(sql`UPDATE gift_rule SET gifts_per_person = 9`));
    expect((await owner('SELECT gifts_per_person FROM gift_rule'))[0]!.gifts_per_person).toBe(1);
    await expect(
      withSubject(driver, ANNA, (db) =>
        db.execute(sql`INSERT INTO gift_allowance (user_id, gifts, set_by) VALUES (${ANNA}, 9, ${ANNA})`),
      ),
    ).rejects.toThrow();
  });

  it('a revoked gift gives its place back; a redeemed one keeps it', async () => {
    const first = await made(ANNA, OURS);
    expect(await withSubject(driver, ANNA, (db) => revokeGift(db, first.id, ANNA))).toBe('revoked');
    const second = await made(ANNA, OURS);
    await redeemGift(driver, second.code, { email: 'cato@example.com', locale: 'nl' });
    expect((await give(ANNA, OURS)).kind).toBe('atLimit');
  });
});

describe('a declined request gives the gift back (the owner, 2026-11-25)', () => {
  it('the operator declining the request frees the giver to make another; a granted one does not', async () => {
    const first = await made(ANNA, OURS);
    const used = await redeemGift(driver, first.code, { email: 'cato@example.com', locale: 'nl' });
    if (used.kind !== 'redeemed') throw new Error(used.kind);
    expect((await give(ANNA, OURS)).kind).toBe('atLimit');

    // A request without a gift touches nothing.
    const [plain] = await owner(`INSERT INTO access_request (email, locale) VALUES ('dirk@example.com', 'en') RETURNING id`);
    expect(await withSubject(driver, OPERATOR, (db) => giveBackDeclinedGift(db, String(plain!.id)))).toBe(0);

    expect(await withSubject(driver, OPERATOR, (db) => giveBackDeclinedGift(db, used.requestId))).toBe(1);
    // Once: a second call gives nothing more back.
    expect(await withSubject(driver, OPERATOR, (db) => giveBackDeclinedGift(db, used.requestId))).toBe(0);
    expect(await withSubject(driver, ANNA, (db) => giftsHeldBy(db, ANNA))).toBe(0);
    const [mine] = await withSubject(driver, ANNA, (db) => listOwnGifts(db, ANNA));
    expect(mine!.state).toBe('redeemed');
    expect((await give(ANNA, OURS)).kind).toBe('made');
    expect((await give(ANNA, OURS)).kind).toBe('atLimit');
  });

  it('survives the declined request being pruned', async () => {
    const first = await made(ANNA, OURS);
    const used = await redeemGift(driver, first.code, { email: 'cato@example.com', locale: 'nl' });
    if (used.kind !== 'redeemed') throw new Error(used.kind);
    await withSubject(driver, OPERATOR, (db) => giveBackDeclinedGift(db, used.requestId));
    await owner('DELETE FROM access_request WHERE id = $1', [used.requestId]);
    expect((await owner('SELECT redeemed_request_id FROM gift WHERE id = $1', [first.id]))[0]!.redeemed_request_id).toBeNull();
    expect(await withSubject(driver, ANNA, (db) => giftsHeldBy(db, ANNA))).toBe(0);
  });

  it('a giver cannot mark their own gift declined', async () => {
    const first = await made(ANNA, OURS);
    const used = await redeemGift(driver, first.code, { email: 'cato@example.com', locale: 'nl' });
    if (used.kind !== 'redeemed') throw new Error(used.kind);
    await expect(withSubject(driver, ANNA, (db) => giveBackDeclinedGift(db, used.requestId))).rejects.toThrow();
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

describe('redeeming', () => {
  const asks = { email: 'cato@example.com', name: 'Cato', locale: 'nl' as const };

  it('writes the request and spends the gift, together, once', async () => {
    const { code, id } = await made(ANNA, OURS);
    const outcome = await redeemGift(driver, code.toLowerCase(), asks);
    expect(outcome.kind).toBe('redeemed');
    if (outcome.kind !== 'redeemed') return;
    const [row] = await owner('SELECT redeemed_request_id, redeemed_at FROM gift WHERE id = $1', [id]);
    expect(row!.redeemed_request_id).toBe(outcome.requestId);
    const [req] = await owner('SELECT email, name, locale, state FROM access_request WHERE id = $1', [outcome.requestId]);
    expect(req).toEqual({ email: 'cato@example.com', name: 'Cato', locale: 'nl', state: 'open' });
    // A second use is the one refusal, and writes nothing.
    expect(await redeemGift(driver, code, { ...asks, email: 'dirk@example.com' })).toEqual({ kind: 'refused' });
    expect(await owner('SELECT 1 FROM access_request')).toHaveLength(1);
  });

  it('refuses unknown, malformed, revoked and expired codes alike, writing nothing', async () => {
    const revoked = await made(ANNA, OURS);
    await withSubject(driver, ANNA, (db) => revokeGift(db, revoked.id, ANNA));
    const old = await made(BRAM, THEIRS, new Date('2020-01-01T00:00:00Z'));
    for (const code of [revoked.code, old.code, mintGiftCode(), 'not a code', '']) {
      expect(await redeemGift(driver, code, asks), code).toEqual({ kind: 'refused' });
    }
    expect(await owner('SELECT 1 FROM access_request')).toHaveLength(0);
  });

  it('an address with an open request writes nothing and leaves the gift unspent', async () => {
    await owner(`INSERT INTO access_request (email, locale) VALUES ('cato@example.com', 'nl')`);
    const { code, id } = await made(ANNA, OURS);
    expect(await redeemGift(driver, code, asks)).toEqual({ kind: 'alreadyAsked' });
    expect(await owner('SELECT 1 FROM access_request')).toHaveLength(1);
    expect((await owner('SELECT redeemed_at FROM gift WHERE id = $1', [id]))[0]!.redeemed_at).toBeNull();
  });
});
