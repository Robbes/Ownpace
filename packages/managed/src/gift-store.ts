// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A PLACE IN THE ALPHA, GIVEN AS A PRESENT (workplan 0172; the owner,
 * 2026-11-24, G1 and G3; managed migration 0065), and since workplan 0177 A
 * RECOMMENDATION THAT LETS ITS PERSON IN (the owner, 2026-11-26, D6; managed
 * migration 0066).
 *
 * A person in the Alpha makes a code for one person they know. The recipient
 * types it at the door, and is let in at once: a request granted by nobody,
 * an organisation of their own, its owner's invitation, and the code spent.
 * 0172's G1, that a gift lets nobody in by itself, no longer holds for a free
 * one. A request without a code still waits for the owner.
 *
 * The free thing is a *recommendation* / *aanbeveling* (0177 D1); *gift* is
 * kept for a code somebody paid for, after the Alpha (0177 §13). The names in
 * this file are 0172's, and the tables' are too: a rename is not a migration
 * this plan needs.
 *
 * ## The Alpha's two ceilings (0177 §20)
 *
 * People the owner let in (granted requests no card points to), and people
 * let in by a recommendation (requests a card points to, granted or still
 * waiting), each with its number on the rule's row. A card is made only while
 * the second count and the cards not used yet are under its number, and the
 * door lets nobody in at it. A code's session and a giver's learn a word,
 * never a number: migration 0066's one function answers them.
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

import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { isLedgerDriver, pgDriver, assertRoleName, type LedgerDriver } from '@openmig/ledger';
import type { PgDatabase } from '@openmig/ledger/db';
import { log, type Bilingual } from '@openmig/shared';
import type { Pool } from 'pg';
import { gift, giftAllowance, giftRule } from './schema-managed.ts';

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
 * so does a redeemed one, unless the operator declined the request it became.
 * A revoked or expired one does not (workplan 0172 §7, questions 1 and 2; the
 * owner, 2026-11-25).
 *
 * **Declined and used are told apart by `request_declined_at`**, stamped on
 * the gift by the decline itself (`giveBackDeclinedGift`), not read from the
 * request: the giver may not read `access_request`, and a declined request is
 * pruned 30 days after the decision, which would set the gift's link to it to
 * NULL and turn the gift back into a used one. The state the giver sees stays
 * `redeemed`: the card was used, and what became of it is the recipient's.
 */
export const holdsAPlace = (
  row: { redeemedAt: Date | null; revokedAt: Date | null; expiresAt: Date; requestDeclinedAt: Date | null },
  now: Date,
): boolean => {
  const state = giftState(row, now);
  return state === 'unused' || (state === 'redeemed' && row.requestDeclinedAt === null);
};

/** How many of their places a giver's gifts take up, under `giver_sees_own`. */
export async function giftsHeldBy(db: PgDatabase, userId: string, now: Date = new Date()): Promise<number> {
  const rows = await db
    .select({
      redeemedAt: gift.redeemedAt,
      revokedAt: gift.revokedAt,
      expiresAt: gift.expiresAt,
      requestDeclinedAt: gift.requestDeclinedAt,
    })
    .from(gift)
    .where(eq(gift.giverUserId, userId));
  return rows.filter((r) => holdsAPlace(r, now)).length;
}

/**
 * The operator declined the access request `requestId`: if a gift became it,
 * give the gift back to its giver (§7, question 2). Called by the decline
 * route, in its transaction, under the operator's policy on `gift`; a request
 * that came without a gift touches nothing. Returns how many gifts it gave
 * back, 0 or 1.
 */
export async function giveBackDeclinedGift(db: PgDatabase, requestId: string, now: Date = new Date()): Promise<number> {
  const given = await db
    .update(gift)
    .set({ requestDeclinedAt: now })
    .where(and(eq(gift.redeemedRequestId, requestId), isNull(gift.requestDeclinedAt)))
    .returning({ id: gift.id });
  return given.length;
}

/**
 * The ONE sentence for a code that is unknown, malformed, used, revoked or
 * expired. It names the remedy true in every case, and never the cause. The
 * owner's of 2026-11-25, with *cadeaucode* become *code* (0177 §7, D1).
 */
export const GIFT_REFUSAL: Bilingual = {
  en:
    'This code cannot be used. It may have been typed wrong, used already, withdrawn, or ' +
    'it may have expired. Check it against the card, or ask the person who gave it to you.',
  nl:
    'Deze code kan niet worden gebruikt. Misschien is hij verkeerd getypt, al gebruikt, ' +
    'ingetrokken of verlopen. Vergelijk hem met de kaart, of vraag het aan degene die u de kaart gaf.',
};

/**
 * The address already has access (0177 §5): nothing is written, and the code
 * is not used. Told only to the holder of an unused code, which is the one
 * thing such a holder can learn about an address (0177 §18). An address with
 * a request waiting is not told anything: that request is granted (D15 (a)).
 */
export const GIFT_ALREADY_IN: Bilingual = {
  en: 'This email address already has access to Ownpace. Your code is not used. Sign in with that email address.',
  nl: 'Dit e-mailadres heeft al toegang tot Ownpace. Uw code is niet gebruikt. Meld u aan met dat e-mailadres.',
};

/**
 * The Alpha is full (0177 §20.3): the people let in by a recommendation fill
 * the second number. Told only to the holder of a good code, at the check and
 * at the last step; the code is kept, and nothing is written.
 */
export const GIFT_FULL: Bilingual = {
  en: 'Nobody can be let in with a code right now. Your code is not used.',
  nl: 'Met een code kan nu niemand worden toegelaten. Uw code is niet gebruikt.',
};

/** Too many tries from one place, at the check or the redeem: one limit, in both languages (0177 §5). */
export const GIFT_TOO_MANY_TRIES: Bilingual = {
  en: 'That is more tries than we expected from one place. Try again later. Nothing is lost.',
  nl: 'Dat waren meer pogingen dan wij van één plek verwachten. Probeer het later opnieuw. Er gaat niets verloren.',
};

/**
 * What a yes to the door's question about Google keeps (0177 D14 (a)): one
 * fixed English line in the request's note, under a note the person wrote
 * earlier, for the owner, who then adds the address to Google's list of test
 * users. A no writes nothing. Migration 0066's function writes this line;
 * `gift-under-rls.unit.test.ts` holds that the two say the same.
 */
export const GOOGLE_SAID_AT_THE_DOOR = 'Said at the door: this address is a Google account to move.';

// -------------------------------------------------------------- the limit --

/**
 * How many gifts one person may hold, and where the number came from:
 * the operator's number for them, the rule for everyone, or, during the
 * Alpha, nought for a member who came in by a recommendation (0177 D18).
 */
export interface GiftLimit {
  readonly limit: number;
  readonly from: 'person' | 'everyone' | 'onlyAfterAlpha';
}

/**
 * What the giver's page says to a member let in by a recommendation, during
 * the Alpha (0177 §20.7): the first of its two sentences, which `POST
 * /api/gifts` answers as 409 `only_after_alpha`. The page's second sentence,
 * that they can after the Alpha, is the page's own.
 */
export const GIFT_ONLY_AFTER_ALPHA: Bilingual = {
  en: 'During the Alpha, only the people Ownpace let in itself can recommend someone.',
  nl: 'Tijdens de Alpha kunnen alleen de mensen die Ownpace zelf toeliet iemand aanbevelen.',
};

/**
 * THE GIVER'S OTHER REFUSALS, IN BOTH LANGUAGES (0177, after alpha.21): what
 * `POST /api/gifts`, `GET /api/gifts/mine` and `POST /api/gifts/:id/revoke`
 * answer besides D18's, said as the giver's page says it, with *u*. The
 * number each person may recommend reached (409 `gift_limit`), in the page's
 * own words for one card (`give.atLimit`) and with the number for more.
 */
export function giftAtLimit(limit: number): Bilingual {
  return limit === 1
    ? {
        en: 'You have recommended someone already. Withdraw an unused card to make another.',
        nl: 'U hebt al iemand aanbevolen. Trek een ongebruikte kaart in om een nieuwe te maken.',
      }
    : {
        en: `You have recommended ${limit} people already. Withdraw an unused card to make another.`,
        nl: `U hebt al ${limit} mensen aanbevolen. Trek een ongebruikte kaart in om een nieuwe te maken.`,
      };
}

/** The Alpha has no place for a new card (409 `no_room`, §20.3), as the page's `give.full` says it. */
export const GIFT_NO_ROOM: Bilingual = {
  en: 'The Alpha is full for now. No new recommendation can be made.',
  nl: 'De Alpha is nu vol. U kunt nu geen aanbeveling maken.',
};

/** A card to withdraw that is not the giver's, or no card at all (404): one sentence for both. */
export const GIFT_NOT_THEIRS: Bilingual = {
  en: 'This recommendation is not yours, or does not exist.',
  nl: 'Deze aanbeveling is niet van u, of bestaat niet.',
};

/** A card to withdraw that was used, withdrawn or expired already (409). */
export const GIFT_NOT_UNUSED: Bilingual = {
  en: 'Only an unused recommendation can be withdrawn.',
  nl: 'Alleen een ongebruikte aanbeveling kan worden ingetrokken.',
};

/** A sign-in with no organisation of its own, on the giver's page (400). */
export const GIFT_NO_ORGANISATION: Bilingual = {
  en: 'A recommendation is made from an organisation, and this sign-in has none.',
  nl: 'Een aanbeveling maakt u vanuit een organisatie, en bij deze aanmelding hoort er geen.',
};

/**
 * A member's number, and D18's rule in its one place (workplan 0177 §20.7; the
 * owner, 2026-11-26: *"no, not in the alpha. Yes after the alpha."*).
 *
 * During the Alpha only the people the owner let in may recommend: a member
 * whose own organisation was made by a request a card points to has none, and
 * the answer is nought, `onlyAfterAlpha`. Their organisation is the session's
 * (`withSubjectAndTenant`), and migration 0066's function tells that session
 * the one yes or no, of its own organisation and nobody else's. After the
 * Alpha the rule falls away by itself, and every member has the person's
 * number while the operator set one, the rule for everyone otherwise.
 *
 * Which stage it is the caller says, read in one place (`alphaFrom` in
 * `apps/api/src/access-notify.ts`): this package knows no environment. Read
 * in the giver's own transaction: `own_allowance` shows them their row, and
 * the rule is readable by anybody.
 */
export async function giftLimitFor(
  db: PgDatabase,
  userId: string,
  stage: { readonly duringTheAlpha: boolean },
): Promise<GiftLimit> {
  if (stage.duringTheAlpha && (await forACard(db)).cameByARecommendation) {
    return { limit: 0, from: 'onlyAfterAlpha' };
  }
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
  | { readonly kind: 'atLimit'; readonly limit: number }
  | { readonly kind: 'noRoom' }
  | { readonly kind: 'onlyAfterAlpha' };

/**
 * Make one gift, in the giver's subject-and-tenant transaction. Returns the
 * code EXACTLY ONCE. Counted and inserted behind a lock on the giver, so two
 * presses at once make one gift, not two past the limit; and behind the
 * Alpha's one lock, so two givers at the last place make one card, not two
 * past the second ceiling (0177 §20.3, rule 1). The giver's own limit is
 * asked first: a giver who has given theirs is told so, full Alpha or not;
 * and before it, during the Alpha, whether they may give at all (D18).
 *
 * Takes the card's language and nothing else from the giver: no recipient.
 */
export async function makeGift(
  db: PgDatabase,
  input: { tenantId: string; giverUserId: string; locale: 'en' | 'nl'; duringTheAlpha: boolean; now?: Date },
): Promise<MakeGiftOutcome> {
  const now = input.now ?? new Date();
  await db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`gift:${input.giverUserId}`}, 0))`);
  const { limit, from } = await giftLimitFor(db, input.giverUserId, { duringTheAlpha: input.duringTheAlpha });
  if (from === 'onlyAfterAlpha') return { kind: 'onlyAfterAlpha' };
  const held = await giftsHeldBy(db, input.giverUserId, now);
  if (held >= limit) return { kind: 'atLimit', limit };
  await holdTheAlphasLock(db);
  if (!(await roomForACard(db))) return { kind: 'noRoom' };

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

/** What the recipient gives at the door's last step, about themselves (0177 §5). Nothing of the giver's. */
export interface GiftRequest {
  readonly email: string;
  /** May be left empty: the organisation is then named after the address. */
  readonly name?: string;
  /** Their answer to *Is this the email address of a Google account that you want to move?* (D14 (a)). */
  readonly google?: boolean;
  /** The door's language: the yes mail is written in it. */
  readonly locale: 'en' | 'nl';
}

export type CheckOutcome =
  | { readonly kind: 'room'; readonly until: Date }
  | { readonly kind: 'full'; readonly until: Date }
  | { readonly kind: 'refused' };

export type RedeemOutcome =
  | {
      readonly kind: 'letIn';
      readonly requestId: string;
      readonly tenantId: string;
      readonly giftId: string;
      /** What the organisation is called, for the yes mail. */
      readonly organisation: string;
      /** The address as the request holds it: the waiting one's, under D15 (a). */
      readonly email: string;
    }
  | { readonly kind: 'full'; readonly until: Date }
  | { readonly kind: 'alreadyIn' }
  | { readonly kind: 'refused' };

/**
 * What migration 0066's function answers: a word, for `let_in` what it wrote,
 * and for a member's own session whether a card's request made its
 * organisation (D18).
 */
interface DoorAnswer {
  readonly answer: 'room' | 'full' | 'refused' | 'already_in' | 'let_in';
  readonly request_id: string | null;
  readonly tenant_id: string | null;
  readonly organisation: string | null;
  readonly email: string | null;
  readonly by_recommendation: boolean | null;
}

/**
 * Ask migration 0066's one function, in whatever session `db` is: a code's
 * (`withGiftCode`), with or without an address, or a member's, without one.
 */
async function askTheDoor(
  db: PgDatabase,
  ask: { email: string | null; name: string | null; locale: 'en' | 'nl'; google: boolean },
): Promise<DoorAnswer> {
  const result = await db.execute(sql`
    SELECT answer, request_id, tenant_id, organisation, email, by_recommendation
      FROM public.let_in_by_a_recommendation(${ask.email}::text, ${ask.name}::text, ${ask.locale}::text, ${ask.google}::boolean)`);
  const [row] = (result as unknown as { rows: DoorAnswer[] }).rows;
  if (!row) throw new Error('let_in_by_a_recommendation answered nothing (managed migration 0066)');
  return row;
}

/** The gift a code's session sees, if it is unused (`gift_sees_itself`): its id and last day. */
async function unusedGiftOf(db: PgDatabase, fingerprint: string, now: Date): Promise<{ id: string; until: Date } | null> {
  const [row] = await db
    .select({ id: gift.id, redeemedAt: gift.redeemedAt, revokedAt: gift.revokedAt, expiresAt: gift.expiresAt })
    .from(gift)
    .where(eq(gift.codeHash, fingerprint));
  return row && giftState(row, now) === 'unused' ? { id: row.id, until: row.expiresAt } : null;
}

/**
 * THE CHECK (0177 §5, step 1 of 3): whether a code can be used, read in the
 * code's own transaction, as the redeem reads it. Writes nothing and spends
 * nothing. Every bad code is `refused`, the redeem's own answer; a good code
 * the Alpha has no room for is `full`, with the code's last day, which the
 * card prints anyway.
 */
export async function checkGift(source: LedgerDriver | Pool, typedCode: unknown, now: Date = new Date()): Promise<CheckOutcome> {
  const plain = readGiftCode(typedCode);
  if (!plain) return { kind: 'refused' };
  const fingerprint = giftFingerprint(plain);
  return withGiftCode(source, fingerprint, async (db) => {
    const unused = await unusedGiftOf(db, fingerprint, now);
    if (!unused) return { kind: 'refused' } as const;
    const { answer } = await askTheDoor(db, { email: null, name: null, locale: 'en', google: false });
    if (answer === 'room') return { kind: 'room', until: unused.until } as const;
    if (answer === 'full') return { kind: 'full', until: unused.until } as const;
    return { kind: 'refused' } as const;
  });
}

/**
 * Let the code's person in (0177 §5, D6), or say why not. In ONE transaction,
 * the code's own, through migration 0066's function: the request granted by
 * nobody (the address's waiting one under D15 (a), else a new one), the
 * organisation, its owner's invitation, and the code spent and pointing to
 * the request. All of it or none. A yes about Google is one fixed line in the
 * request's note (D14 (a)).
 *
 * `full` (the second ceiling, §20.3) and `alreadyIn` write nothing and keep
 * the code; every bad code, and a code spent since the check, is `refused`.
 * The mails are the caller's, after this returns: this commits first.
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
  return withGiftCode(source, fingerprint, async (db) => {
    const unused = await unusedGiftOf(db, fingerprint, now);
    if (!unused) return { kind: 'refused' } as const;
    const said = await askTheDoor(db, {
      email: request.email,
      name: request.name ?? null,
      locale: request.locale,
      google: request.google === true,
    });
    switch (said.answer) {
      case 'let_in':
        return {
          kind: 'letIn',
          requestId: String(said.request_id),
          tenantId: String(said.tenant_id),
          giftId: unused.id,
          organisation: String(said.organisation),
          email: String(said.email),
        } as const;
      case 'full':
        return { kind: 'full', until: unused.until } as const;
      case 'already_in':
        return { kind: 'alreadyIn' } as const;
      default:
        return { kind: 'refused' } as const;
    }
  });
}

// --------------------------------------------------------------- the Alpha --

/**
 * The Alpha's one lock (0177 §20.3, rule 3): taken before a count that a write
 * then relies on, by a card being made and by a code letting its person in
 * (migration 0066's function takes it by the same key), so that two at the
 * last place make one. Not a giver's key: `makeGift`'s is `gift:` and a subject.
 */
export const THE_ALPHAS_LOCK = 'alpha:recommendations';

export async function holdTheAlphasLock(db: PgDatabase): Promise<void> {
  await db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${THE_ALPHAS_LOCK}, 0))`);
}

/** What a member's own session learns of the Alpha, for a new card: two yes-or-nos and no number. */
export interface ForACard {
  /** The people let in by a recommendation and the cards not used yet are under the second number (§20.3, rule 1). */
  readonly room: boolean;
  /** A card's request made this session's own organisation (D18, §20.7). */
  readonly cameByARecommendation: boolean;
}

/**
 * Asked in a member's own session, scoped to their organisation
 * (`withSubjectAndTenant`), through migration 0066's function: the giver may
 * read neither count, nor any other organisation's answer. A session that is
 * no member of the organisation it names learns nothing, and reads as no room.
 */
export async function forACard(db: PgDatabase): Promise<ForACard> {
  const said = await askTheDoor(db, { email: null, name: null, locale: 'en', google: false });
  return { room: said.answer === 'room', cameByARecommendation: said.by_recommendation === true };
}

/**
 * Whether the Alpha has room for a new card (0177 §20.3, rule 1). `GET
 * /api/gifts/mine` answers it as `room`, and `makeGift` asks it behind the
 * Alpha's lock.
 */
export async function roomForACard(db: PgDatabase): Promise<boolean> {
  return (await forACard(db)).room;
}

/** The rule's one row: how many each person may give, and the Alpha's two ceilings (0177 §20.2). */
export interface GiftRule {
  readonly giftsPerPerson: number;
  readonly ownerCeiling: number;
  readonly recommendationCeiling: number;
}

/** The whole rule, readable by anybody; 1, 50 and 50 if the row were ever missing. */
export async function theGiftRule(db: PgDatabase): Promise<GiftRule> {
  const [rule] = await db
    .select({
      giftsPerPerson: giftRule.giftsPerPerson,
      ownerCeiling: giftRule.ownerCeiling,
      recommendationCeiling: giftRule.recommendationCeiling,
    })
    .from(giftRule);
  return rule ?? { giftsPerPerson: 1, ownerCeiling: 50, recommendationCeiling: 50 };
}

/** The Alpha's counts, as the operator reads them (0177 §20.1, §20.6). */
export interface AlphaCounts {
  /** Every granted request, however it came. */
  readonly granted: number;
  /** Every request still waiting for the owner. */
  readonly open: number;
  /** Of those, the ones a card made before 0177, which the owner still answers. */
  readonly openFromGifts: number;
  /** People the owner let in: granted requests that no card points to. */
  readonly byOwner: number;
  /** People let in by a recommendation: requests a card points to, granted or still waiting. */
  readonly byRecommendation: number;
}

/**
 * The counts, in the operator's own transaction: the operator reads every
 * request and every gift (0005, 0065), so they are read here rather than
 * through 0066's function, which tells nobody a number. The second count is
 * the one that function counts at the door, by the same definition, and
 * `an-alpha-with-two-ceilings.unit.test.ts` reads the one against the other.
 *
 * D17 (the owner, 2026-11-26: *"no, ik will count"*): nothing refuses the
 * owner's own yes, at the first number or past it. The owner keeps count, on
 * the Gifts screen, above the queue and in the overview on Support, which all
 * read this, through `GET /api/gifts/operator` (0177 §19, §20.4).
 */
export async function alphaCounts(db: PgDatabase): Promise<AlphaCounts> {
  const result = await db.execute(sql`
    SELECT count(*) FILTER (WHERE r.state = 'granted')::int AS granted,
           count(*) FILTER (WHERE r.state = 'open')::int AS open,
           count(*) FILTER (WHERE r.state = 'open' AND carded)::int AS open_from_gifts,
           count(*) FILTER (WHERE r.state = 'granted' AND NOT carded)::int AS by_owner,
           count(*) FILTER (WHERE r.state IN ('open', 'granted') AND carded)::int AS by_recommendation
      FROM (SELECT a.state,
                   EXISTS (SELECT 1 FROM public.gift g WHERE g.redeemed_request_id = a.id) AS carded
              FROM public.access_request a) r`);
  const [row] = (result as unknown as { rows: Array<Record<string, unknown>> }).rows;
  const n = (key: string): number => Number(row?.[key] ?? 0);
  return {
    granted: n('granted'),
    open: n('open'),
    openFromGifts: n('open_from_gifts'),
    byOwner: n('by_owner'),
    byRecommendation: n('by_recommendation'),
  };
}
