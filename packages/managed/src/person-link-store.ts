// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A PERSON'S LINK (ADR-0035, amended 2026-09-29; workplan 0153 T5 (b); managed
 * migration 0034).
 *
 * The owner, asked after *Start a migration* sent one person two links for one
 * Google account: "yes, a per-person link instead of the per-migration links".
 * A person grants their own accounts, so the link is theirs: one grant link
 * and one progress link for all of a person's migrations.
 *
 * It is the ledger's `mapping-link-store.ts` again, with the person where the
 * migration was, and every mechanic that makes a bearer credential survivable
 * is that file's, by name, so the two cannot drift: the secret is made,
 * hashed at rest and compared in constant time there
 * (`mintLinkSecret`, `hashLinkSecret`, `linkSecretMatches`); it is shown once,
 * at issue; it expires on the owner's date; it is revocable, and revocation is
 * re-checked when it is spent; its four states are `linkState`'s; and every
 * failure answers the one sentence (`MAPPING_LINK_REFUSAL`).
 *
 * ## A person's link says so in its first two characters
 *
 * A token is `p.<id>.<secret>`, where a migration's is `<id>.<secret>`. The
 * grant and progress pages keep their addresses (`/grant/…`, `/view/…`), and
 * the middleware tells the two kinds apart by the prefix before it reads
 * anything: each store's own shape refuses the other's token without touching
 * the database. A person's link can never be taken for a migration's, whose
 * verification grants exactly one migration.
 *
 * Managed-only, because `person` is (ADR-0036): the appliance moves one
 * implicit person and issues no grant links.
 */

import { randomUUID } from 'node:crypto';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import {
  MAPPING_LINK_REFUSAL,
  hashLinkSecret,
  linkSecretMatches,
  linkState,
  mintLinkSecret,
  withMappingLink,
  type LedgerDriver,
  type MappingLinkPurpose,
  type MappingLinkSummary,
} from '@openmig/ledger';
import type { PgDatabase } from '@openmig/ledger/db';
import type { Pool } from 'pg';
import { personLink } from './schema-managed.ts';

/** `p.<id>.<secret>`: the only shape a person's link URL carries. */
const PERSON_TOKEN_SHAPE = /^p\.([0-9a-fA-F-]{36})\.([A-Za-z0-9_-]{16,})$/;

/** Whether a presented token is a person's link, by its shape alone. */
export function isPersonLinkToken(token: string | undefined): boolean {
  return PERSON_TOKEN_SHAPE.test(token ?? '');
}

/** What a verified person's link may say about itself. Never the hash. */
export interface VerifiedPersonLink {
  readonly id: string;
  readonly tenantId: string;
  readonly personId: string;
  readonly purpose: MappingLinkPurpose;
  readonly expiresAt: Date;
}

export type PersonLinkVerdict =
  | { readonly ok: true; readonly link: VerifiedPersonLink }
  | { readonly ok: false; readonly reason: string };

/** What the owner sees of a person's link: its state, never a secret. */
export type PersonLinkSummary = MappingLinkSummary;

/**
 * Mint a link for one person, in the owner's own tenant transaction, so the
 * tenant policies hold the insert. Returns the full token EXACTLY ONCE:
 * nothing stores it, and re-issue is the remedy for a lost one.
 */
export async function issuePersonLink(
  db: PgDatabase,
  input: {
    tenantId: string;
    personId: string;
    purpose: MappingLinkPurpose;
    createdBy: string;
    expiresAt: Date;
  },
): Promise<{ id: string; token: string; expiresAt: Date }> {
  const id = randomUUID();
  const secret = mintLinkSecret();
  await db.insert(personLink).values({
    id,
    tenantId: input.tenantId,
    personId: input.personId,
    purpose: input.purpose,
    secretHash: hashLinkSecret(secret),
    createdBy: input.createdBy,
    expiresAt: input.expiresAt,
  });
  return { id, token: `p.${id}.${secret}`, expiresAt: input.expiresAt };
}

/**
 * Verify a person's link presented by somebody with no session, in a
 * link-scoped transaction: `app.current_link` is the id presented, and the
 * table's own `link_sees_itself` finds that row and no other. A malformed
 * token is refused without touching the database, and the secret is checked
 * before the state, so every refusal costs the same work and reads the same.
 */
export async function verifyPersonLink(
  source: LedgerDriver | Pool,
  token: string,
  expected: { purpose: MappingLinkPurpose; now?: Date },
): Promise<PersonLinkVerdict> {
  const refused = { ok: false, reason: MAPPING_LINK_REFUSAL } as const;
  const parsed = PERSON_TOKEN_SHAPE.exec(token ?? '');
  if (!parsed) return refused;
  const [, id, secret] = parsed as unknown as [string, string, string];
  const now = expected.now ?? new Date();

  const row = await withMappingLink(source, id, async (db) => {
    const rows = await db
      .select({
        id: personLink.id,
        tenantId: personLink.tenantId,
        personId: personLink.personId,
        purpose: personLink.purpose,
        secretHash: personLink.secretHash,
        expiresAt: personLink.expiresAt,
        usedAt: personLink.usedAt,
        revokedAt: personLink.revokedAt,
      })
      .from(personLink)
      .where(eq(personLink.id, id))
      .limit(1);
    return rows[0];
  });

  if (!row) return refused;
  if (!linkSecretMatches(secret, row.secretHash)) return refused;
  if (row.purpose !== expected.purpose) return refused;
  if (row.revokedAt) return refused;
  if (row.expiresAt.getTime() <= now.getTime()) return refused;
  // A grant link is spent once every account on it is granted; a progress
  // link is opened again and again.
  if (row.purpose === 'grant' && row.usedAt) return refused;

  return {
    ok: true,
    link: {
      id: row.id,
      tenantId: row.tenantId,
      personId: row.personId,
      purpose: row.purpose,
      expiresAt: row.expiresAt,
    },
  };
}

/**
 * Spend a grant link, in the tenant transaction the verified row named, once
 * every account on it is granted. Revocation and expiry are re-checked in the
 * statement, so the owner's kill switch cannot lose a race against a consent
 * in flight, and `used_at IS NULL` makes a repeated call change nothing.
 */
export async function spendPersonLink(
  db: PgDatabase,
  input: { tenantId: string; linkId: string; now?: Date },
): Promise<boolean> {
  const now = input.now ?? new Date();
  const updated = await db
    .update(personLink)
    .set({ usedAt: now })
    .where(
      and(
        eq(personLink.id, input.linkId),
        eq(personLink.tenantId, input.tenantId),
        isNull(personLink.usedAt),
        isNull(personLink.revokedAt),
        gt(personLink.expiresAt, now),
      ),
    )
    .returning({ id: personLink.id });
  return updated.length > 0;
}

/**
 * The owner's kill switch, for one link of one person. Revoking a revoked link
 * changes nothing and answers false. The person is in the `WHERE`, so a link
 * id presented under another person of the same organisation revokes nothing.
 */
export async function revokePersonLink(
  db: PgDatabase,
  input: { tenantId: string; personId: string; linkId: string; now?: Date },
): Promise<boolean> {
  const now = input.now ?? new Date();
  const updated = await db
    .update(personLink)
    .set({ revokedAt: now })
    .where(
      and(
        eq(personLink.id, input.linkId),
        eq(personLink.tenantId, input.tenantId),
        eq(personLink.personId, input.personId),
        isNull(personLink.revokedAt),
      ),
    )
    .returning({ id: personLink.id });
  return updated.length > 0;
}

/** Every link of one person, newest first, with its state and no secret. */
export async function listPersonLinks(
  db: PgDatabase,
  input: { tenantId: string; personId: string; now?: Date },
): Promise<PersonLinkSummary[]> {
  const now = input.now ?? new Date();
  const rows = await db
    .select({
      id: personLink.id,
      purpose: personLink.purpose,
      createdAt: personLink.createdAt,
      createdBy: personLink.createdBy,
      expiresAt: personLink.expiresAt,
      usedAt: personLink.usedAt,
      revokedAt: personLink.revokedAt,
    })
    .from(personLink)
    .where(and(eq(personLink.tenantId, input.tenantId), eq(personLink.personId, input.personId)))
    .orderBy(desc(personLink.createdAt));
  return rows.map((r) => ({ ...r, state: linkState(r, now) }));
}

/**
 * How many of an organisation's person grant links can still be used. The
 * live-link limit (0108 T8 (d)) counts these beside the migrations' own, so a
 * person's link counts once, whatever number of migrations it covers.
 */
export async function countLivePersonGrantLinks(
  db: PgDatabase,
  tenantId: string,
  now: Date = new Date(),
): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(personLink)
    .where(
      and(
        eq(personLink.tenantId, tenantId),
        eq(personLink.purpose, 'grant'),
        isNull(personLink.usedAt),
        isNull(personLink.revokedAt),
        gt(personLink.expiresAt, now),
      ),
    );
  return Number(rows[0]?.n ?? 0);
}
