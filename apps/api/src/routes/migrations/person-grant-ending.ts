// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PERSON'S GRANT LANDS (ADR-0035, amended 2026-09-29; workplan 0153 T5 (b),
 * slice 2).
 *
 * `grant-ending.ts` stores one migration's token and nothing sees it. This is
 * the same ending for a person's link, where one consent serves every
 * migration that reads the account they signed in to. The rules are that
 * file's, and so is its order; what differs is what one consent writes.
 *
 * ## The order
 *
 * 1. **A closed organisation takes nothing** (0085 T2), asked in this
 *    transaction before anything is written.
 * 2. **The link must still be live**: not revoked, not expired, not spent.
 *    Read `FOR UPDATE`, so a revoke that lands while this runs waits for it or
 *    wins before it, and a revoked link stores nothing.
 * 3. **The account that signed in must be the one the page named** (0108
 *    T8 (b)), or nothing is written and the link still works for the right
 *    one. The refusal is recorded after the rollback, as a migration's is.
 * 4. **Only what the page showed is granted.** The consent was begun for the
 *    migrations listed when the button was pressed (the pending state carries
 *    them). Each is written only if it is still this person's and still reads
 *    this account: a migration added since asks again, because its destination
 *    is new to them, and one moved to another person or another account is not
 *    theirs to grant any more.
 * 5. **The token lands on each of them** in this one transaction, with a
 *    `mapping.granted` row each, naming the person's link.
 * 6. **The link is spent once every account on it is granted**, read in this
 *    same transaction after the writes. Until then it stays live, so a person
 *    with two accounts can grant one now and one later. A link that asks
 *    again (made while every account was connected, managed migration 0036)
 *    takes the migrations just written off its list, and is spent once none of
 *    those it still asks for is left: every account it asked for has then been
 *    connected through it, not only held a token.
 *
 * ## One token, several migrations
 *
 * Every listed migration receives the same `{ refreshToken }`, the only half
 * that is the person's (`grant-ending.ts` says why the client is not copied).
 * Taking the grant back revokes that token at Google once and clears it from
 * each of them (`person-progress.ts`).
 *
 * ## And then the person's progress link
 *
 * `mintPersonProgressLink`, after the grant has landed and never inside its
 * transaction, as `mintProgressLink` is for a migration's.
 */

import type { Pool } from 'pg';
import { and, eq, gt, isNull } from 'drizzle-orm';
import * as schema from '@openmig/ledger';
import { DEFAULT_MAPPING_VIEW_LINK_EXPIRY_DAYS, PgLedger, expiryFromDays, type LedgerDriver } from '@openmig/ledger';
import { SecretStore } from '@openmig/core/secret-store';
import { LINK_SPENT, log, organisationClosedRefusal, reasonPair, type Bilingual, type TenantId } from '@openmig/shared';
import { personLink, personMigration } from '@openmig/managed/schema-managed';
import {
  connectedThroughPersonLink,
  issuePersonLink,
  readOrganisationClosure,
  readPersonOfMigration,
  spendPersonLink,
} from '@openmig/managed';
import { withTenantDb } from '../../middleware/auth.ts';
import {
  GRANT_ACTION,
  GRANT_ACTOR,
  GRANT_REFUSED_ACTION,
  mintProgressLink,
  type GrantedAccess,
  type GrantStoreResult,
  type GrantTarget,
} from './grant-ending.ts';
import { namedAccount, readGrantRows, whereFromAndTo } from './grant-subject.ts';
import { progressPageUrl, type ProgressPageUrl } from './progress-page-url.ts';
import { readPersonGrantSubject } from './person-grant-subject.ts';
import {
  sameGoogleAccount,
  signedInAccountRefusal,
  type SignedInAccountRefusal,
  type SignedInAccountRefusalCode,
} from './signed-in-account.ts';

/** The person's consent, as the pending state recorded it when the button was pressed. */
export interface PersonGrantTarget {
  readonly linkId: string;
  readonly tenantId: string;
  readonly personId: string;
  /** The account the page named, and the only one whose sign-in is kept. */
  readonly account: string;
  /** The migrations the page listed under it. */
  readonly mappingIds: readonly string[];
}

/** When every migration the page listed has gone from this person or this account since. */
export const NOTHING_LEFT_TO_GRANT: Bilingual = {
  en:
    'The migrations this page listed for this account have changed since it was opened, so nothing was ' +
    'stored. Open your link again to see what it asks for now.',
  nl:
    'De migraties die deze pagina voor dit account toonde zijn gewijzigd sinds hij werd geopend, dus er is ' +
    'niets opgeslagen. Open uw link opnieuw om te zien waar hij nu om vraagt.',
};

/** Thrown to roll the transaction back when the wrong account signed in. */
class AnotherAccountSignedIn extends Error {
  readonly refusal: SignedInAccountRefusal;
  constructor(refusal: SignedInAccountRefusal) {
    super('the account that signed in is not the one the page named');
    this.refusal = refusal;
  }
}

/** Record a refused sign-in against each listed migration, after the rollback, as `grant-ending.ts` does. */
async function recordRefusedSignIn(
  source: Pool | LedgerDriver,
  target: PersonGrantTarget,
  code: SignedInAccountRefusalCode,
): Promise<void> {
  try {
    await withTenantDb(target.tenantId, source, async (db) => {
      for (const mappingId of target.mappingIds) {
        await new PgLedger(db).recordAuditEvent(target.tenantId as TenantId, {
          actor: GRANT_ACTOR,
          action: GRANT_REFUSED_ACTION,
          entity: 'mapping',
          detail: { mappingId, personLinkId: target.linkId, refused: code },
        });
      }
    });
  } catch (error) {
    log.error('[api] recording a refused grant sign-in on a person’s link failed:', error);
  }
}

/** What landed: the migrations that took the token, and whether the link is now spent. */
export type PersonGrantStoreResult =
  | { readonly ok: true; readonly granted: readonly string[]; readonly linkSpent: boolean }
  | Exclude<GrantStoreResult, { ok: true }>;

/**
 * Store a person's granted token on every migration the page listed for the
 * account, or refuse having stored nothing. The refusal for a link that can no
 * longer be used is the one sentence every link uses.
 */
export async function storePersonGrant(
  source: Pool | LedgerDriver,
  target: PersonGrantTarget,
  granted: GrantedAccess,
): Promise<PersonGrantStoreResult> {
  const encrypted = JSON.stringify(SecretStore.encryptCredentials({ refreshToken: granted.refreshToken }).encrypted);

  try {
    return await withTenantDb(target.tenantId, source, async (db) => {
      const closure = await readOrganisationClosure(db, target.tenantId);
      if (closure) {
        const refusal = organisationClosedRefusal(closure);
        return { ok: false as const, reason: refusal.en, reasonNl: refusal.nl, linkUnused: true };
      }

      const now = new Date();
      const live = await db
        .select({ id: personLink.id })
        .from(personLink)
        .where(
          and(
            eq(personLink.id, target.linkId),
            eq(personLink.tenantId, target.tenantId),
            eq(personLink.personId, target.personId),
            eq(personLink.purpose, 'grant'),
            isNull(personLink.usedAt),
            isNull(personLink.revokedAt),
            gt(personLink.expiresAt, now),
          ),
        )
        .for('update');
      if (live.length === 0) return { ok: false as const, ...reasonPair(LINK_SPENT) };

      const refusal = signedInAccountRefusal(target.account, granted.signedInAs);
      if (refusal) throw new AnotherAccountSignedIn(refusal);

      const written: string[] = [];
      for (const mappingId of target.mappingIds) {
        const stillTheirs = await db
          .select({ mappingId: personMigration.mappingId })
          .from(personMigration)
          .where(
            and(
              eq(personMigration.mappingId, mappingId),
              eq(personMigration.personId, target.personId),
              eq(personMigration.tenantId, target.tenantId),
            ),
          );
        if (stillTheirs.length === 0) continue;
        const rows = await readGrantRows(db, target.tenantId, mappingId);
        const named = rows ? namedAccount(rows) : null;
        if (!rows || !named || !sameGoogleAccount(named, target.account)) continue;

        const updated = await db
          .update(schema.mailboxMapping)
          // A new grant ends a withdrawal, as `grant-ending.ts` records.
          .set({ sourceSecretRef: encrypted, grantWithdrawnAt: null, updatedAt: now })
          .where(and(eq(schema.mailboxMapping.id, mappingId), eq(schema.mailboxMapping.tenantId, target.tenantId)))
          .returning({ id: schema.mailboxMapping.id });
        if (updated.length === 0) continue;

        await new PgLedger(db).recordAuditEvent(target.tenantId as TenantId, {
          actor: GRANT_ACTOR,
          action: GRANT_ACTION,
          entity: 'mapping',
          detail: {
            mappingId,
            personLinkId: target.linkId,
            account: granted.signedInAs,
            to: whereFromAndTo(rows)?.to ?? null,
          },
        });
        written.push(mappingId);
      }
      if (written.length === 0) {
        return { ok: false as const, ...reasonPair(NOTHING_LEFT_TO_GRANT), linkStillWorks: true };
      }

      // Spent once every account on it is granted, read after the writes
      // above, and, for a link that asks again, once each migration it asks
      // for that a sign-in can still serve has been connected through it.
      const asksAgain = await connectedThroughPersonLink(db, {
        tenantId: target.tenantId,
        linkId: target.linkId,
        mappingIds: written,
      });
      const subject = await readPersonGrantSubject(db, target.tenantId, target.personId);
      const everyAccount = subject === null || subject.accounts.every((a) => a.granted);
      const stillAsked =
        subject !== null &&
        asksAgain !== null &&
        subject.accounts.some((a) => a.ask.ok && a.migrations.some((m) => asksAgain.includes(m.mappingId)));
      const linkSpent =
        everyAccount && !stillAsked
          ? await spendPersonLink(db, { tenantId: target.tenantId, linkId: target.linkId, now })
          : false;
      return { ok: true as const, granted: written, linkSpent };
    });
  } catch (error) {
    if (error instanceof AnotherAccountSignedIn) {
      await recordRefusedSignIn(source, target, error.refusal.code);
      return { ok: false, reason: error.refusal.reason, reasonNl: error.refusal.reasonNl, linkStillWorks: true };
    }
    throw error;
  }
}

/**
 * Mint the person's progress link, AFTER their grant has landed (slice 3):
 * `mintProgressLink` for a person. The same reasons hold, by that function's
 * own words: outside the consent's transaction, so a page that could not be
 * minted never undoes a consent; null when the deployment cannot say its
 * address, or the write failed, which is logged; and a fresh one each time,
 * because the table holds no secret to hand back. A person with two accounts
 * who grants both is given two, both on the owner's list and revocable there.
 */
export async function mintPersonProgressLink(
  source: Pool | LedgerDriver,
  target: Pick<PersonGrantTarget, 'tenantId' | 'personId'>,
): Promise<ProgressPageUrl | null> {
  const base = process.env.WEB_URL?.replace(/\/+$/, '');
  if (!base) return null;
  try {
    const issued = await withTenantDb(target.tenantId, source, (db) =>
      issuePersonLink(db, {
        tenantId: target.tenantId,
        personId: target.personId,
        purpose: 'view',
        // Not a user id: nobody was signed in, as for a migration's.
        createdBy: 'granted-by-link',
        expiresAt: expiryFromDays(DEFAULT_MAPPING_VIEW_LINK_EXPIRY_DAYS),
      }),
    );
    return progressPageUrl(base, issued.token);
  } catch (error) {
    log.error('[api] minting a person’s progress link after a grant failed:', error);
    return null;
  }
}

/**
 * The progress page a MIGRATION'S link hands over when its grant lands, now
 * that the link is the person's (ADR-0035, amended 2026-09-29; the owner,
 * 2026-10-03: *"yes, replace the per-migration links"*). A migration's link
 * sent before that is honoured until it expires, and the page it ends on is
 * the person's when the migration has one, since that is the page there is now
 * (`mintPersonProgressLink`). A migration that belongs to nobody hands over its
 * own, as before (`mintProgressLink`). Null on any failure, logged, as both
 * of those are: a page that could not be minted never undoes a consent.
 */
export async function mintProgressLinkForMigration(
  source: Pool | LedgerDriver,
  target: GrantTarget,
): Promise<ProgressPageUrl | null> {
  let personId: string | undefined;
  try {
    personId = (
      await withTenantDb(target.tenantId, source, (db) =>
        readPersonOfMigration(db, target.tenantId, target.mappingId),
      )
    )?.id;
  } catch (error) {
    log.error('[api] reading whose migration a granted link was for failed:', error);
    return null;
  }
  return personId
    ? mintPersonProgressLink(source, { tenantId: target.tenantId, personId })
    : mintProgressLink(source, target);
}
