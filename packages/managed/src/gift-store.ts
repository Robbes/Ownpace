// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A PLACE IN THE ALPHA, GIVEN AS A PRESENT (workplan 0172; the owner,
 * 2026-11-24, G1 and G3; managed migration 0064).
 *
 * A person in the alpha makes a gift code for one loved one. The recipient
 * types it at the request-access door, which turns it into an access request
 * marked as a gift from the giver; the owner approves it like any other. So a
 * gift lets nobody in by itself.
 *
 * ## What is a grant link's, by name
 *
 * The mechanics that make a bearer key survivable are `docs/grant-links.md`'s:
 * shown once and kept only as a fingerprint; ONE refusal for every kind of bad
 * key (`GIFT_REFUSAL`), so trying codes at random learns nothing about which
 * part was right; revocation; and *we never send it, you do*: making a gift
 * asks for nothing about the recipient, and the table has no column for it.
 *
 * ## What is not, and why
 *
 * **The code is typed by hand from a card**, so it is not a grant link's UUID
 * and 43 characters of base64url. It is 16 characters of Crockford's base 32,
 * in four groups (`K7QM-3XR2-PA9D-W4HN`): 80 random bits, read case-blind,
 * with the letters people confuse for digits read as those digits. Behind the
 * door's rate limit, 80 bits is far past guessing.
 *
 * **It is found by its fingerprint**, not by an id carried beside the secret:
 * a card should hold one thing to type. The fingerprint is sha256 of 80
 * random bits, so finding the row by it reveals nothing a timing could use,
 * and `app.current_gift` opens that row and no other (`withGiftCode`).
 */

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { isLedgerDriver, pgDriver, assertRoleName, type LedgerDriver } from '@openmig/ledger';
import type { PgDatabase } from '@openmig/ledger/db';
import { log, type Bilingual } from '@openmig/shared';
import type { Pool } from 'pg';
import { accessRequest, gift, giftAllowance, giftRule } from './schema-managed.ts';

// ---------------------------------------------------------------- the code --

/** Crockford's base 32: no I, L, O or U, so nothing on a card reads two ways. */
export const GIFT_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Characters in a code, without its dashes: 16 × 5 = 80 bits. */
export const GIFT_CODE_LENGTH = 16;

/** The fingerprint's scheme, on its front, as every stored hash here carries one. */
export const GIFT_FINGERPRINT_SCHEME = 'gift1';

/** How long a gift is valid, unless it is used or revoked first (G3). */
export const GIFT_VALID_YEARS = 2;

/** The most an operator may set, for everyone or for one person (the table's CHECK). */
export const GIFTS_PER_PERSON_MAX = 20;

/** `K7QM3XR2PA9DW4HN` as it is printed: `K7QM-3XR2-PA9D-W4HN`. */
export function formatGiftCode(plain: string): string {
  return plain.match(/.{1,4}/g)!.join('-');
}

/** A new code, printed form. Ten random bytes are exactly sixteen characters. */
export function mintGiftCode(): string {
  const bytes = randomBytes(10);
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += GIFT_CODE_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  return formatGiftCode(out);
}

/**
 * A code as somebody typed it, read the way it was meant: capitals or not,
 * with or without dashes and spaces, `O` for `0`, `I` and `L` for `1`. Null
 * when what is left is not sixteen characters of the alphabet, which the door
 * answers with the one refusal like any other bad code.
 */
export function readGiftCode(typed: unknown): string | null {
  if (typeof typed !== 'string' || typed.length > 64) return null;
  const plain = typed
    .toUpperCase()
    .replace(/[\s‐-―-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  if (plain.length !== GIFT_CODE_LENGTH) return null;
  for (const ch of plain) if (!GIFT_CODE_ALPHABET.includes(ch)) return null;
  return plain;
}

/** What the table keeps of a code: never the code. Takes a code as `readGiftCode` reads it. */
export function giftFingerprint(plain: string): string {
  return `${GIFT_FINGERPRINT_SCHEME}:${createHash('sha256').update(plain).digest('hex')}`;
}

/** Two years on, by the calendar: a gift made on 24 December is valid until 24 December. */
export function giftExpiry(from: Date): Date {
  const until = new Date(from.getTime());
  until.setUTCFullYear(until.getUTCFullYear() + GIFT_VALID_YEARS);
  return until;
}

// ------------------------------------------------------------- the states --

export type GiftState = 'unused' | 'redeemed' | 'revoked' | 'expired';

/**
 * One definition of the four, for every screen that shows them. A redeemed
 * gift did its job and stays redeemed after its date; a revoked one was the
 * giver's or the operator's decision and outranks a date; `linkState`'s order.
 */
export function giftState(
  row: { redeemedAt: Date | null; revokedAt: Date | null; expiresAt: Date },
  now: Date,
): GiftState {
  if (row.redeemedAt) return 'redeemed';
  if (row.revokedAt) return 'revoked';
  if (row.expiresAt.getTime() <= now.getTime()) return 'expired';
  return 'unused';
}

/**
 * Whether a gift takes up one of its giver's places. An unused one does, and
 * so does a redeemed one, whatever became of its request: the place was
 * given. A revoked or expired one does not (workplan 0172 §7, questions 1, 2).
 */
export const holdsAPlace = (state: GiftState): boolean => state === 'unused' || state === 'redeemed';

/**
 * The ONE sentence for a code that is unknown, malformed, used, revoked or
 * expired. It names the remedy true in every case, and never the cause.
 */
export const GIFT_REFUSAL: Bilingual = {
  en:
    'This gift code cannot be used. It may have been typed wrong, used already, withdrawn, or ' +
    'it may have expired. Check it against the card, or ask the person who gave it to you.',
  nl:
    'Deze cadeaucode kan niet worden gebruikt. Misschien is hij verkeerd getypt, al gebruikt, ' +
    'ingetrokken of verlopen. Vergelijk hem met de kaart, of vraag het aan wie hem u gaf.',
};

/** The address already has an open request: nothing is written, and the gift is not spent. */
export const GIFT_ALREADY_ASKED: Bilingual = {
  en:
    'There is already a request from this address waiting for an answer, so nothing was added ' +
    'and your gift code is not used. Keep it: you can use it once that request is answered.',
  nl:
    'Er wacht al een aanvraag van dit adres op antwoord. Er is niets toegevoegd en uw cadeaucode ' +
    'is niet gebruikt. Bewaar hem: u kunt hem gebruiken zodra die aanvraag is beantwoord.',
};

// -------------------------------------------------------------- the limit --

/** How many gifts one person may hold, and where the number came from. */
export interface GiftLimit {
  readonly limit: number;
  readonly from: 'person' | 'everyone';
}

/**
 * The person's number while the operator set one, the rule for everyone
 * otherwise. Read in the giver's own transaction: `own_allowance` shows them
 * their row, and the rule is readable by anybody.
 */
export async function giftLimitFor(db: PgDatabase, userId: string): Promise<GiftLimit> {
  const [own] = await db
    .select({ gifts: giftAllowance.gifts })
    .from(giftAllowance)
    .where(eq(giftAllowance.userId, userId));
  if (own) return { limit: own.gifts, from: 'person' };
  return { limit: await giftsPerPerson(db), from: 'everyone' };
}

/** The rule for everyone; 1 if the row were ever missing (G1). */
export async function giftsPerPerson(db: PgDatabase): Promise<number> {
  const [rule] = await db.select({ n: giftRule.giftsPerPerson }).from(giftRule);
  return rule?.n ?? 1;
}

// -------------------------------------------------------------- the giver --

/** What a giver, or the operator, sees of a gift: never its fingerprint. */
export interface GiftSummary {
  readonly id: string;
  readonly locale: 'en' | 'nl';
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly redeemedAt: Date | null;
  readonly revokedAt: Date | null;
  readonly state: GiftState;
}

const SUMMARY = {
  id: gift.id,
  locale: gift.locale,
  createdAt: gift.createdAt,
  expiresAt: gift.expiresAt,
  redeemedAt: gift.redeemedAt,
  revokedAt: gift.revokedAt,
};

/** The giver's own gifts, newest first, under `giver_sees_own`. */
export async function listOwnGifts(db: PgDatabase, userId: string, now: Date = new Date()): Promise<GiftSummary[]> {
  const rows = await db
    .select(SUMMARY)
    .from(gift)
    .where(eq(gift.giverUserId, userId))
    .orderBy(desc(gift.createdAt));
  return rows.map((r) => ({ ...r, state: giftState(r, now) }));
}

export type MakeGiftOutcome =
  | { readonly kind: 'made'; readonly id: string; readonly code: string; readonly expiresAt: Date }
  | { readonly kind: 'atLimit'; readonly limit: number };

/**
 * Make one gift, in the giver's subject-and-tenant transaction. Returns the
 * code EXACTLY ONCE. Counted and inserted behind a lock on the giver, so two
 * presses at once make one gift, not two past the limit.
 *
 * Takes the card's language and nothing else from the giver: no recipient.
 */
export async function makeGift(
  db: PgDatabase,
  input: { tenantId: string; giverUserId: string; locale: 'en' | 'nl'; now?: Date },
): Promise<MakeGiftOutcome> {
  const now = input.now ?? new Date();
  await db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`gift:${input.giverUserId}`}, 0))`);
  const { limit } = await giftLimitFor(db, input.giverUserId);
  const held = (await listOwnGifts(db, input.giverUserId, now)).filter((g) => holdsAPlace(g.state)).length;
  if (held >= limit) return { kind: 'atLimit', limit };

  const code = mintGiftCode();
  const id = (await db
    .insert(gift)
    .values({
      tenantId: input.tenantId,
      giverUserId: input.giverUserId,
      codeHash: giftFingerprint(readGiftCode(code)!),
      locale: input.locale,
      createdAt: now,
      expiresAt: giftExpiry(now),
    })
    .returning({ id: gift.id }))[0]!.id;
  return { kind: 'made', id, code, expiresAt: giftExpiry(now) };
}

export type RevokeGiftOutcome = 'revoked' | 'notFound' | 'notUnused';

/**
 * Revoke an unused gift. The giver's own, under `giver_revokes_own`, or any,
 * under the operator's policy: which of the two is the transaction's subject.
 * A gift that is not visible is not found, the same answer as one that does
 * not exist.
 */
export async function revokeGift(db: PgDatabase, id: string, by: string, now: Date = new Date()): Promise<RevokeGiftOutcome> {
  const [row] = await db
    .select({ redeemedAt: gift.redeemedAt, revokedAt: gift.revokedAt, expiresAt: gift.expiresAt })
    .from(gift)
    .where(eq(gift.id, id));
  if (!row) return 'notFound';
  if (giftState(row, now) !== 'unused') return 'notUnused';
  await db
    .update(gift)
    .set({ revokedAt: now, revokedBy: by })
    .where(and(eq(gift.id, id), isNull(gift.redeemedAt), isNull(gift.revokedAt)));
  return 'revoked';
}

// --------------------------------------------------------------- the door --

/**
 * The context the door reads a gift in. Same shape as `withMappingLink`: it
 * drops to the request path's role, sets `app.current_gift` to the fingerprint
 * presented, and `gift_sees_itself` opens that row and no other. Nothing else
 * is in scope, so a mistake in a WHERE clause cannot walk other gifts.
 */
export async function withGiftCode<T>(
  source: LedgerDriver | Pool,
  fingerprint: string,
  fn: (db: PgDatabase) => Promise<T>,
): Promise<T> {
  const driver = isLedgerDriver(source) ? source : pgDriver(source);
  const conn = await driver.acquire();
  let releaseError: Error | undefined;
  try {
    await conn.query('BEGIN');
    if (driver.role) await conn.query(`SET LOCAL ROLE "${assertRoleName(driver.role)}"`);
    await conn.query("SELECT set_config('app.current_gift', $1, true)", [fingerprint]);
    const result = await fn(conn.db);
    await conn.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await conn.query('ROLLBACK');
    } catch (rollbackError) {
      log.error('Rollback failed after error:', rollbackError);
      releaseError = rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError));
    }
    throw error;
  } finally {
    conn.release(releaseError);
  }
}

/** What the recipient typed at the door, about themselves. Nothing of the giver's. */
export interface GiftRequest {
  readonly email: string;
  readonly name?: string;
  readonly organisation?: string;
  readonly note?: string;
  readonly tier?: string;
  readonly locale: 'en' | 'nl';
}

export type RedeemOutcome =
  | { readonly kind: 'redeemed'; readonly requestId: string; readonly giftId: string }
  | { readonly kind: 'refused' }
  | { readonly kind: 'alreadyAsked' };

/** Thrown inside the transaction to undo the request when the gift was spent under us. */
class SpentMeanwhile extends Error {}

/**
 * Turn a code into an access request marked as a gift, or refuse it. Both
 * writes or neither: the request is inserted under `anyone_may_ask`, as the
 * door's own form inserts it, and the gift is spent under
 * `gift_spends_itself`, only while it is still unused. A code spent by a
 * second press at the same moment rolls the first's request back and is
 * refused like any used code.
 *
 * An address with an open request (`ux_access_request_one_open_per_email`)
 * writes nothing and leaves the gift unspent.
 */
export async function redeemGift(
  source: LedgerDriver | Pool,
  typedCode: unknown,
  request: GiftRequest,
  now: Date = new Date(),
): Promise<RedeemOutcome> {
  const plain = readGiftCode(typedCode);
  // Malformed answers what unknown answers, and touches nothing.
  if (!plain) return { kind: 'refused' };
  const fingerprint = giftFingerprint(plain);
  const requestId = randomUUID();
  try {
    return await withGiftCode(source, fingerprint, async (db) => {
      const [row] = await db
        .select({ id: gift.id, redeemedAt: gift.redeemedAt, revokedAt: gift.revokedAt, expiresAt: gift.expiresAt })
        .from(gift)
        .where(eq(gift.codeHash, fingerprint));
      if (!row || giftState(row, now) !== 'unused') return { kind: 'refused' } as const;

      await db.insert(accessRequest).values({
        id: requestId,
        email: request.email,
        ...(request.name ? { name: request.name } : {}),
        ...(request.organisation ? { organisation: request.organisation } : {}),
        ...(request.note ? { note: request.note } : {}),
        ...(request.tier ? { tier: request.tier } : {}),
        locale: request.locale,
      });
      const spent = await db
        .update(gift)
        .set({ redeemedAt: now, redeemedRequestId: requestId })
        .where(and(eq(gift.id, row.id), isNull(gift.redeemedAt), isNull(gift.revokedAt)))
        .returning({ id: gift.id });
      if (spent.length !== 1) throw new SpentMeanwhile();
      return { kind: 'redeemed', requestId, giftId: row.id } as const;
    });
  } catch (error) {
    if (error instanceof SpentMeanwhile) return { kind: 'refused' };
    // On the cause, as the door's own form reads it: drizzle wraps the driver's error.
    const cause = (error as { cause?: unknown }).cause;
    const pg = (cause ?? error) as { code?: string; constraint?: string };
    if (pg.code === '23505' && pg.constraint === 'ux_access_request_one_open_per_email') {
      return { kind: 'alreadyAsked' };
    }
    throw error;
  }
}
