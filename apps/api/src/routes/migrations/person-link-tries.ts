// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * FIVE TRIES, THEN LOCKED (workplan 0174 §5.5, the owner's D4 and D5 of
 * 2026-11-25, T3).
 *
 * Per link, per account: five refused logins lock that account's card on that
 * link; its other cards go on. Kept in managed migration 0064's
 * `person_link_try`, so a restart or a second replica hands out no more.
 *
 * ## A try is claimed before the login, and given back after
 *
 * Counting after the test would let two tabs racing at four refusals both
 * reach the provider: a sixth login, which is the one thing the count is for.
 * So a test first CLAIMS a try, in one statement that adds one only while the
 * count is under five and the card is not locked (`INSERT … ON CONFLICT DO
 * UPDATE … WHERE … RETURNING`): Postgres serialises the two tabs on the row,
 * and the second one past five gets no row back and makes no login. The test
 * then runs, and:
 *
 * - `refused_login` keeps the try, and the fifth locks the card (`locked_at`);
 * - anything else gives it back (D4: a down server or a refused face is not a
 *   guess at the password): `unreachable`, `face_missing`, and a success.
 *
 * A process that dies between the claim and the answer keeps that try
 * counted: the safe direction for somebody's password. A new link starts at
 * zero; that is the owner's remedy (§4.6).
 *
 * Personal data: none. The card's `ref` is a hash, never the address; no
 * password and no server text is ever written here.
 */

import type { Pool } from 'pg';
import { and, eq, sql } from 'drizzle-orm';
import type { LedgerDriver } from '@openmig/ledger';
import { personLinkTry } from '@openmig/managed/schema-managed';
import { withTenantDb } from '../../middleware/auth.ts';
import { PASSWORD_TRIES_PER_LINK } from './person-grant-subject.ts';

/** One card on one link. */
export interface TryKey {
  readonly tenantId: string;
  readonly linkId: string;
  /** The card's `ref`: a hash, never the address. */
  readonly ref: string;
}

/** A claim: the try this test may spend, or the card is locked. */
export type TryClaim = { readonly claimed: true; readonly refused: number } | { readonly claimed: false };

/**
 * Claim one try for a test, or answer that the card is locked. The claim
 * counts as a refusal until `keepTheTry` or `giveTheTryBack` says what the
 * test answered.
 */
export async function claimATry(source: Pool | LedgerDriver, key: TryKey, now = new Date()): Promise<TryClaim> {
  const rows = await withTenantDb(key.tenantId, source, (db) =>
    db
      .insert(personLinkTry)
      .values({ linkId: key.linkId, tenantId: key.tenantId, accountRef: key.ref, refused: 1, lastAt: now })
      .onConflictDoUpdate({
        target: [personLinkTry.linkId, personLinkTry.accountRef],
        set: { refused: sql`${personLinkTry.refused} + 1`, lastAt: now },
        setWhere: sql`${personLinkTry.refused} < ${PASSWORD_TRIES_PER_LINK} AND ${personLinkTry.lockedAt} IS NULL`,
      })
      .returning({ refused: personLinkTry.refused }),
  );
  const row = rows[0];
  return row ? { claimed: true, refused: row.refused } : { claimed: false };
}

/**
 * The server refused the login: the claimed try stays counted, and the card
 * locks at the fifth. Answers the tries left and whether it is now locked.
 */
export async function keepTheTry(
  source: Pool | LedgerDriver,
  key: TryKey,
  now = new Date(),
): Promise<{ readonly left: number; readonly locked: boolean }> {
  const rows = await withTenantDb(key.tenantId, source, (db) =>
    db
      .update(personLinkTry)
      .set({
        lastAt: now,
        lockedAt: sql`CASE WHEN ${personLinkTry.refused} >= ${PASSWORD_TRIES_PER_LINK} THEN COALESCE(${personLinkTry.lockedAt}, ${now.toISOString()}::timestamptz) ELSE ${personLinkTry.lockedAt} END`,
      })
      .where(
        and(
          eq(personLinkTry.linkId, key.linkId),
          eq(personLinkTry.accountRef, key.ref),
          eq(personLinkTry.tenantId, key.tenantId),
        ),
      )
      .returning({ refused: personLinkTry.refused, lockedAt: personLinkTry.lockedAt }),
  );
  const refused = rows[0]?.refused ?? PASSWORD_TRIES_PER_LINK;
  return { left: Math.max(0, PASSWORD_TRIES_PER_LINK - refused), locked: rows[0]?.lockedAt != null || refused >= PASSWORD_TRIES_PER_LINK };
}

/** The test was not a refused login (D4): the claimed try is given back. */
export async function giveTheTryBack(source: Pool | LedgerDriver, key: TryKey): Promise<void> {
  await withTenantDb(key.tenantId, source, (db) =>
    db
      .update(personLinkTry)
      .set({ refused: sql`GREATEST(${personLinkTry.refused} - 1, 0)` })
      .where(
        and(
          eq(personLinkTry.linkId, key.linkId),
          eq(personLinkTry.accountRef, key.ref),
          eq(personLinkTry.tenantId, key.tenantId),
          sql`${personLinkTry.lockedAt} IS NULL`,
        ),
      ),
  );
}
