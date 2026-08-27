// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The migrator's link, as an object rather than a convention (workplan 0108
 * T1, ADR-0035).
 *
 * This is the FIRST bearer credential in this repository, and the difference
 * between it and the thing it most resembles is worth stating where both are
 * in view:
 *
 * - An **invitation** (workplan 0095) deliberately carries **no token at all**.
 *   Identity belongs to the issuer (ADR-0042), so an invitee proves an address
 *   by signing in and RLS on the verified email claim does the authorising. An
 *   intercepted invitation grants nobody anything.
 * - A **migrator link** is a bearer credential on purpose, because its holder
 *   is exactly the person who must NOT need an account: ADR-0035's *"no
 *   `tenant_member` row, no password, no session, no seat — in any
 *   deployment"*. Whoever holds it can grant that one migration.
 *
 * Neither should ever be "improved" into the other. That is why the mechanics
 * that make a bearer credential survivable live here, in one file, rather than
 * spread across routes:
 *
 * - the secret is **hashed at rest** and compared in constant time;
 * - it is **shown once**, at issue, and is unrecoverable afterwards;
 * - it **expires**, on a date the owner chose;
 * - it is **revocable**, and revocation is re-checked at the moment of use;
 * - single-use is spent at the **grant**, not at the open.
 *
 * And one sentence answers every failure. Distinguishing "expired" from
 * "revoked" from "never existed" would tell a forger which half of a guess was
 * right; the person holding a genuine link needs only the remedy, which is the
 * same in all four cases.
 */

import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { mappingLink } from './schema-pg.ts';
import { withMappingLink } from './db.ts';
import type { PgDatabase } from './db-types.ts';
import type { LedgerDriver } from './driver.ts';
import type { Pool } from 'pg';

export const MAPPING_LINK_PURPOSES = ['grant', 'view'] as const;
export type MappingLinkPurpose = (typeof MAPPING_LINK_PURPOSES)[number];

/**
 * The expiries the owner may choose, in days (workplan 0108, the owner's steer
 * of 2026-08-26: control over comfort-by-default). Seven is what the dialog
 * pre-fills — long enough to hand a link across a weekend, short enough to
 * bound a forwarded or intercepted one.
 */
export const MAPPING_LINK_EXPIRY_DAYS = [1, 7, 30] as const;
export const DEFAULT_MAPPING_LINK_EXPIRY_DAYS = 7;

/**
 * The ONE sentence, for unknown, forged, expired, revoked and already-used
 * alike. It names the remedy that is true in every one of those cases, and it
 * never names the cause — see this file's header for why.
 */
export const MAPPING_LINK_REFUSAL =
  'This link cannot be used. It may have been used already, it may have expired, or the ' +
  'person who sent it may have withdrawn it. Ask them for a fresh link — issuing one takes ' +
  'them a moment.';

/** What a verified link is allowed to say about itself. Never the hash. */
export interface VerifiedMappingLink {
  readonly id: string;
  readonly tenantId: string;
  readonly mappingId: string;
  readonly purpose: MappingLinkPurpose;
  readonly expiresAt: Date;
}

export type MappingLinkVerdict =
  | { readonly ok: true; readonly link: VerifiedMappingLink }
  | { readonly ok: false; readonly reason: string };

/** One row of the owner's list. Carries state, never the secret. */
export interface MappingLinkSummary {
  readonly id: string;
  readonly purpose: MappingLinkPurpose;
  readonly createdAt: Date;
  readonly createdBy: string;
  readonly expiresAt: Date;
  readonly usedAt: Date | null;
  readonly revokedAt: Date | null;
  /**
   * Derived, not stored — the owner's list needs the state, and computing it
   * in one place stops two screens disagreeing about what "expired" means.
   *
   * `expired` is deliberately reported for an UNUSED link past its date and
   * not for a used one: a link that was used and then aged out did its job,
   * while one that expired unused means somebody was asked and never managed
   * to answer. That distinction is what the owner acts on (re-issue), so it
   * is made here rather than left to a template.
   */
  readonly state: 'live' | 'used' | 'revoked' | 'expired';
}

/** `<id>.<secret>` — the only shape a link URL ever carries. */
const TOKEN_SHAPE = /^([0-9a-fA-F-]{36})\.([A-Za-z0-9_-]{16,})$/;

const sha256Hex = (value: string): string => createHash('sha256').update(value).digest('hex');

/**
 * Constant-time hash comparison.
 *
 * `timingSafeEqual` throws on a length mismatch, which would turn a malformed
 * stored hash into a 500 instead of a refusal — so the length is checked first
 * and answers false, the same as any other wrong value.
 */
function hashMatches(candidate: string, stored: string): boolean {
  const a = Buffer.from(candidate, 'utf8');
  const b = Buffer.from(stored, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Mint a link for one mapping. Runs inside the OWNER's tenant context, so the
 * ordinary tenant policies apply to the insert.
 *
 * Returns the full token EXACTLY ONCE. Nothing stores it, nothing can recover
 * it, and re-issue is the remedy for a lost one — which is what makes "the
 * table holds only a hash" true rather than aspirational.
 */
export async function issueMappingLink(
  db: PgDatabase,
  input: {
    tenantId: string;
    mappingId: string;
    purpose: MappingLinkPurpose;
    createdBy: string;
    expiresAt: Date;
  },
): Promise<{ id: string; token: string; expiresAt: Date }> {
  const id = randomUUID();
  // 32 bytes of randomness. base64url so the token survives a URL, an email
  // client and a copy-paste without an encoding step anywhere.
  const secret = randomBytes(32).toString('base64url');
  await db.insert(mappingLink).values({
    id,
    tenantId: input.tenantId,
    mappingId: input.mappingId,
    purpose: input.purpose,
    secretHash: sha256Hex(secret),
    createdBy: input.createdBy,
    expiresAt: input.expiresAt,
  });
  return { id, token: `${id}.${secret}`, expiresAt: input.expiresAt };
}

/**
 * Verify a token presented by somebody with no session.
 *
 * Opens its own link-scoped context (`withMappingLink`) because that is
 * intrinsic to the operation: the row is what says which tenant to assume, so
 * the read cannot run under a tenant context that does not exist yet.
 *
 * A malformed token is refused WITHOUT touching the database — `id = $1`
 * against a non-uuid raises rather than matching nothing, and a refusal that
 * arrives as a 500 is not a refusal.
 */
export async function verifyMappingLink(
  source: LedgerDriver | Pool,
  token: string,
  expected: { purpose: MappingLinkPurpose; now?: Date },
): Promise<MappingLinkVerdict> {
  const refused = { ok: false, reason: MAPPING_LINK_REFUSAL } as const;
  const parsed = TOKEN_SHAPE.exec(token ?? '');
  if (!parsed) return refused;
  const [, id, secret] = parsed as unknown as [string, string, string];
  const now = expected.now ?? new Date();

  const row = await withMappingLink(source, id, async (db) => {
    const rows = await db
      .select({
        id: mappingLink.id,
        tenantId: mappingLink.tenantId,
        mappingId: mappingLink.mappingId,
        purpose: mappingLink.purpose,
        secretHash: mappingLink.secretHash,
        expiresAt: mappingLink.expiresAt,
        usedAt: mappingLink.usedAt,
        revokedAt: mappingLink.revokedAt,
      })
      .from(mappingLink)
      .where(eq(mappingLink.id, id))
      .limit(1);
    return rows[0];
  });

  if (!row) return refused;
  // The secret is checked BEFORE the state, so a wrong secret and a revoked
  // link cost the same work and answer the same sentence.
  if (!hashMatches(sha256Hex(secret), row.secretHash)) return refused;
  if (row.purpose !== expected.purpose) return refused;
  if (row.revokedAt) return refused;
  if (row.expiresAt.getTime() <= now.getTime()) return refused;
  // Single-use belongs to the GRANT lifetime only. A 'view' link is the
  // longer-lived half of ADR-0035's pair and is meant to be opened again.
  if (row.purpose === 'grant' && row.usedAt) return refused;

  return {
    ok: true,
    link: {
      id: row.id,
      tenantId: row.tenantId,
      mappingId: row.mappingId,
      purpose: row.purpose,
      expiresAt: row.expiresAt,
    },
  };
}

/**
 * Spend the link, at the moment the grant actually lands.
 *
 * Runs in the tenant context the verified row named, and re-checks revocation
 * and expiry IN THE STATEMENT: the owner's kill switch must not lose a race
 * against a consent that was in flight when they pressed it. `usedAt IS NULL`
 * makes it idempotent — a duplicated callback marks nothing twice.
 *
 * Answers whether it spent the link, so the caller can refuse rather than
 * store a credential against a link that stopped being usable mid-flow.
 */
export async function spendMappingLink(
  db: PgDatabase,
  input: { tenantId: string; linkId: string; now?: Date },
): Promise<boolean> {
  const now = input.now ?? new Date();
  const updated = await db
    .update(mappingLink)
    .set({ usedAt: now })
    .where(
      and(
        eq(mappingLink.id, input.linkId),
        eq(mappingLink.tenantId, input.tenantId),
        isNull(mappingLink.usedAt),
        isNull(mappingLink.revokedAt),
        gt(mappingLink.expiresAt, now),
      ),
    )
    .returning({ id: mappingLink.id });
  return updated.length > 0;
}

/**
 * The owner's kill switch. Idempotent — revoking a revoked link is a no-op
 * rather than an error, because the owner pressing twice means the same thing
 * both times.
 */
export async function revokeMappingLink(
  db: PgDatabase,
  input: { tenantId: string; linkId: string; now?: Date },
): Promise<boolean> {
  const now = input.now ?? new Date();
  const updated = await db
    .update(mappingLink)
    .set({ revokedAt: now })
    .where(
      and(
        eq(mappingLink.id, input.linkId),
        eq(mappingLink.tenantId, input.tenantId),
        isNull(mappingLink.revokedAt),
      ),
    )
    .returning({ id: mappingLink.id });
  return updated.length > 0;
}

/** What the owner sees: every link for one mapping, newest first, no secrets. */
export async function listMappingLinks(
  db: PgDatabase,
  input: { tenantId: string; mappingId: string; now?: Date },
): Promise<MappingLinkSummary[]> {
  const now = input.now ?? new Date();
  const rows = await db
    .select({
      id: mappingLink.id,
      purpose: mappingLink.purpose,
      createdAt: mappingLink.createdAt,
      createdBy: mappingLink.createdBy,
      expiresAt: mappingLink.expiresAt,
      usedAt: mappingLink.usedAt,
      revokedAt: mappingLink.revokedAt,
    })
    .from(mappingLink)
    .where(and(eq(mappingLink.tenantId, input.tenantId), eq(mappingLink.mappingId, input.mappingId)))
    .orderBy(desc(mappingLink.createdAt));

  return rows.map((r) => ({
    ...r,
    state: linkState(r, now),
  }));
}

/**
 * One definition of the four states, shared by every surface that shows them.
 *
 * Order matters and encodes what the owner should act on: a link that was USED
 * did its job whatever happened to it afterwards, so it never reads as
 * expired; a REVOKED link is the owner's own decision and outranks a date.
 */
export function linkState(
  row: { usedAt: Date | null; revokedAt: Date | null; expiresAt: Date },
  now: Date,
): MappingLinkSummary['state'] {
  if (row.usedAt) return 'used';
  if (row.revokedAt) return 'revoked';
  if (row.expiresAt.getTime() <= now.getTime()) return 'expired';
  return 'live';
}

/** The expiry a chosen number of days lands on, from a given moment. */
export function expiryFromDays(days: number, from: Date = new Date()): Date {
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}
