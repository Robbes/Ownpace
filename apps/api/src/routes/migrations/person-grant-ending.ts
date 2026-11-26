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
import { DEFAULT_MAPPING_VIEW_LINK_EXPIRY_DAYS, PgLedger, expiryFromDays, type LedgerDriver, type PgDatabase } from '@openmig/ledger';
import {
  LINK_SPENT,
  log,
  organisationClosedRefusal,
  pinnedToPublished,
  pinsItsServer,
  reasonPair,
  withoutUnpublishedHosts,
  type Bilingual,
  type TenantId,
} from '@openmig/shared';
import { personGrantedConnection, personLink, personMigration } from '@openmig/managed/schema-managed';
import { SecretStore } from '@openmig/core/secret-store';
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
  grantedAddress,
  grantedSecret,
  mintProgressLink,
  type GrantedAccess,
  type GrantStoreResult,
  type GrantTarget,
} from './grant-ending.ts';
import { namedAccount, readGrantRows, storedCredentials, whereFromAndTo } from './grant-subject.ts';
import { progressPageUrl, type ProgressPageUrl } from './progress-page-url.ts';
import { readPersonGrantSubject } from './person-grant-subject.ts';
import { liftTheHold } from './withdrawal-hold.ts';
import {
  sameNamedAccount,
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
  /** The person's grant page, for the ending to go back to while accounts are left (`PendingConsent`). */
  readonly backUrl?: string;
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

/**
 * What landed: the migrations that took the token, whether the link is now
 * spent, and how many accounts on it are still to connect (the owner's
 * decisions of 2026-11-26: the ending said *this link will not work again*
 * to a person with a second account to connect). Zero once it is spent.
 */
export type PersonGrantStoreResult =
  | { readonly ok: true; readonly granted: readonly string[]; readonly linkSpent: boolean; readonly left: number }
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
  const encrypted = grantedSecret(granted);
  const provider = granted.provider ?? 'google';

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

      const refusal = signedInAccountRefusal(target.account, granted.signedInAs, provider, true);
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
        if (!rows || !named || !sameNamedAccount(provider, named, target.account)) continue;

        const updated = await db
          .update(schema.mailboxMapping)
          // A new grant ends a withdrawal once both sides have a way in
          // (`liftTheHold`, below), as `grant-ending.ts` records.
          .set({ sourceSecretRef: encrypted, updatedAt: now })
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
            account: grantedAddress(granted.signedInAs),
            to: whereFromAndTo(rows)?.to ?? null,
          },
        });
        written.push(mappingId);
      }
      if (written.length === 0) {
        return { ok: false as const, ...reasonPair(NOTHING_LEFT_TO_GRANT), linkStillWorks: true };
      }
      await liftTheHold(db, target.tenantId, written);

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
      const left = linkSpent || subject === null ? 0 : subject.accounts.filter((a) => !a.granted).length;
      return { ok: true as const, granted: written, linkSpent, left };
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

// ======================= A password typed on the link (workplan 0174 T3) =======================

/** The card a password was typed for, as the route found it on the link. */
export interface PersonPasswordTarget {
  readonly linkId: string;
  readonly tenantId: string;
  readonly personId: string;
  /** The card's `ref` (`person-grant-subject.ts`): a hash, never the address. */
  readonly ref: string;
}

/** What a stored password answers: the migrations it reached, and whether the link is now spent. */
export type PersonPasswordStoreResult =
  | { readonly ok: true; readonly granted: readonly string[]; readonly linkSpent: boolean }
  | {
      readonly ok: false;
      /** `link_spent`: revoked, expired or spent between the test and the write (§7.5). */
      readonly code: 'closed' | 'link_spent' | 'not_this_account' | 'already_connected' | 'another_person';
      readonly reason: Bilingual;
    };

/** When the destination is already a person's own, and that person is somebody else (D1 (a)). */
export const CONNECTED_BY_SOMEBODY_ELSE: Bilingual = {
  en: 'This account was connected by somebody else. It cannot be connected again through this link.',
  nl: 'Dit account is door iemand anders verbonden. Het kan niet opnieuw via deze link worden verbonden.',
};

/** The string values of a stored credential record: what `encryptCredentials` takes back. */
function stringValues(record: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(record).filter((e): e is [string, string] => typeof e[1] === 'string'));
}

/** Rolls the write back with the answer it gives. */
class PasswordNotStored extends Error {
  readonly answer: Extract<PersonPasswordStoreResult, { ok: false }>;
  constructor(answer: Extract<PersonPasswordStoreResult, { ok: false }>) {
    super(`a tested password was not stored: ${answer.code}`);
    this.answer = answer;
  }
}

/**
 * Store a password the person typed and the test accepted (0174 §5.3 step 7,
 * §4.3, D1 (a)), or refuse having stored nothing. One transaction:
 *
 * 1. a closed organisation takes nothing (0085 T2);
 * 2. the link is read `FOR UPDATE` and must still be live: a revoke that
 *    landed while the test ran wins, and nothing is written (§7.5);
 * 3. the card is read again by its `ref`: still the person's, still a
 *    password card, and not connected since (a second tab, §7.2);
 * 4. the secret is merged, key by key, over what is stored:
 *    - a SOURCE's on each of the card's migrations (`source_secret_ref`,
 *      ADR-0035 decision 4), because the source connection may be the owner's;
 *    - a DESTINATION's on the connection itself (`secret_ref`), because the
 *      destination is the person's own account, with `person_granted_connection`
 *      naming the person; a connection another person granted is refused;
 *    and a withdrawal's hold lifted where both sides now have a way in
 *    (`liftTheHold`);
 * 5. the qualification the test measured is remembered on the connection;
 * 6. one `mapping.granted` row per migration, with the via, the role, the
 *    ref and the link: never a value, never the address that tried;
 * 7. the link is spent once every account on it is connected, read after the
 *    writes, as a sign-in's ending does. After, not before: a Cirrux
 *    destination's Drive card (T5) exists only once its app password is
 *    stored, so a spend read before this write would close the link with the
 *    Drive never asked (`a-drive-a-person-connects-on-their-link`).
 *
 * `values` is the person's keys only; nothing here logs it, returns it or
 * writes it anywhere but the two encrypted columns.
 */
export async function storePersonPassword(
  source: Pool | LedgerDriver,
  target: PersonPasswordTarget,
  values: Readonly<Record<string, string>>,
  qualification?: unknown,
): Promise<PersonPasswordStoreResult> {
  try {
    return await withTenantDb(target.tenantId, source, async (db) => {
      const closure = await readOrganisationClosure(db, target.tenantId);
      if (closure) throw new PasswordNotStored({ ok: false, code: 'closed', reason: organisationClosedRefusal(closure) });

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
      if (live.length === 0) throw new PasswordNotStored({ ok: false, code: 'link_spent', reason: LINK_SPENT });

      const subject = await readPersonGrantSubject(db, target.tenantId, target.personId);
      const account = subject?.accounts.find((a) => a.ref === target.ref);
      if (!account || account.way !== 'password' || !account.ask.ok || account.ask.way !== 'password') {
        throw new PasswordNotStored({ ok: false, code: 'not_this_account', reason: NOTHING_LEFT_TO_GRANT });
      }
      if (account.granted) {
        throw new PasswordNotStored({ ok: false, code: 'already_connected', reason: ALREADY_CONNECTED });
      }
      const connectionId = account.ask.connectionId;
      const ledger = new PgLedger(db);
      const written: string[] = [];

      if (account.role === 'source') {
        for (const m of account.migrations) {
          const [row] = await db
            .select({ ref: schema.mailboxMapping.sourceSecretRef })
            .from(schema.mailboxMapping)
            .where(and(eq(schema.mailboxMapping.id, m.mappingId), eq(schema.mailboxMapping.tenantId, target.tenantId)))
            .for('update');
          if (!row) continue;
          const merged = { ...stringValues(storedCredentials(row.ref)), ...values };
          await db
            .update(schema.mailboxMapping)
            .set({
              sourceSecretRef: JSON.stringify(SecretStore.encryptCredentials(merged).encrypted),
              updatedAt: now,
            })
            .where(and(eq(schema.mailboxMapping.id, m.mappingId), eq(schema.mailboxMapping.tenantId, target.tenantId)));
          written.push(m.mappingId);
        }
      } else {
        const [owner] = await db
          .select({ personId: personGrantedConnection.personId })
          .from(personGrantedConnection)
          .where(
            and(
              eq(personGrantedConnection.connectionId, connectionId),
              eq(personGrantedConnection.tenantId, target.tenantId),
            ),
          );
        if (owner && owner.personId !== target.personId) {
          throw new PasswordNotStored({ ok: false, code: 'another_person', reason: CONNECTED_BY_SOMEBODY_ELSE });
        }
        const [row] = await db
          .select({ ref: schema.connection.secretRef })
          .from(schema.connection)
          .where(and(eq(schema.connection.id, connectionId), eq(schema.connection.tenantId, target.tenantId)))
          .for('update');
        if (!row) throw new PasswordNotStored({ ok: false, code: 'not_this_account', reason: NOTHING_LEFT_TO_GRANT });
        const merged = { ...stringValues(storedCredentials(row.ref)), ...values };
        await db
          .update(schema.connection)
          .set({
            secretRef: JSON.stringify(SecretStore.encryptCredentials(merged).encrypted),
            status: 'connected',
            updatedAt: now,
          })
          .where(and(eq(schema.connection.id, connectionId), eq(schema.connection.tenantId, target.tenantId)));
        await db
          .insert(personGrantedConnection)
          .values({ connectionId, tenantId: target.tenantId, personId: target.personId, linkId: target.linkId, grantedAt: now })
          .onConflictDoUpdate({
            target: personGrantedConnection.connectionId,
            set: { linkId: target.linkId, grantedAt: now },
          });
        written.push(...account.migrations.map((m) => m.mappingId));
      }

      // A withdrawal's hold ends where both sides have a way in again: a
      // destination granted again after the person withdrew it, or a source
      // whose destination still has its password (`withdrawal-hold.ts`).
      await liftTheHold(db, target.tenantId, written);

      // WHERE THE TEST WENT, KEPT (§5.8, D3 (a)). For a kind whose provider
      // publishes its server, the test ran against that server whatever the
      // row said (`pinnedToPublished`), so the row and each migration's
      // override are written to say the same, in this transaction: the pass
      // then sends the password where the test did, and nowhere the owner typed.
      if (pinsItsServer(account.ask.kind)) {
        await pinTheRow(db, target.tenantId, connectionId, account.ask.kind, account.role, written, now);
      }

      // What the test measured, remembered where the Accounts page reads it.
      if (qualification !== undefined) {
        await db
          .update(schema.connection)
          .set({ qualification: qualification as never, updatedAt: now })
          .where(and(eq(schema.connection.id, connectionId), eq(schema.connection.tenantId, target.tenantId)));
      }

      for (const m of account.migrations) {
        if (!written.includes(m.mappingId)) continue;
        await ledger.recordAuditEvent(target.tenantId as TenantId, {
          actor: GRANT_ACTOR,
          action: GRANT_ACTION,
          entity: 'mapping',
          detail: { mappingId: m.mappingId, personLinkId: target.linkId, via: 'password', role: account.role, ref: target.ref },
        });
      }
      if (written.length === 0) {
        throw new PasswordNotStored({ ok: false, code: 'not_this_account', reason: NOTHING_LEFT_TO_GRANT });
      }

      const after = await readPersonGrantSubject(db, target.tenantId, target.personId);
      const everyAccount = after === null || after.accounts.every((a) => a.granted);
      const linkSpent = everyAccount
        ? await spendPersonLink(db, { tenantId: target.tenantId, linkId: target.linkId, now })
        : false;
      return { ok: true as const, granted: written, linkSpent };
    });
  } catch (error) {
    if (error instanceof PasswordNotStored) return error.answer;
    throw error;
  }
}

/**
 * The row and the migrations' overrides, pinned to the published server
 * (`pinnedToPublished`, `withoutUnpublishedHosts`), in the caller's
 * transaction. Only what changes is written.
 */
async function pinTheRow(
  db: PgDatabase,
  tenantId: string,
  connectionId: string,
  kind: string,
  role: 'source' | 'target',
  mappingIds: ReadonlyArray<string>,
  now: Date,
): Promise<void> {
  const [row] = await db
    .select({ config: schema.connection.config })
    .from(schema.connection)
    .where(and(eq(schema.connection.id, connectionId), eq(schema.connection.tenantId, tenantId)));
  const before = objectOf(row?.config);
  const pinned = pinnedToPublished(kind, before);
  if (JSON.stringify(pinned) !== JSON.stringify(before)) {
    await db
      .update(schema.connection)
      .set({ config: pinned as never, updatedAt: now })
      .where(and(eq(schema.connection.id, connectionId), eq(schema.connection.tenantId, tenantId)));
  }
  const column = role === 'source' ? schema.mailboxMapping.sourceConfigOverride : schema.mailboxMapping.targetConfigOverride;
  for (const mappingId of mappingIds) {
    const [m] = await db
      .select({ override: column })
      .from(schema.mailboxMapping)
      .where(and(eq(schema.mailboxMapping.id, mappingId), eq(schema.mailboxMapping.tenantId, tenantId)));
    if (!m?.override || typeof m.override !== 'object') continue;
    const was = objectOf(m.override);
    const narrowed = withoutUnpublishedHosts(kind, was);
    if (JSON.stringify(narrowed) === JSON.stringify(was)) continue;
    await db
      .update(schema.mailboxMapping)
      .set(role === 'source' ? { sourceConfigOverride: narrowed as never, updatedAt: now } : { targetConfigOverride: narrowed as never, updatedAt: now })
      .where(and(eq(schema.mailboxMapping.id, mappingId), eq(schema.mailboxMapping.tenantId, tenantId)));
  }
}

/** A config object, or an empty one. */
function objectOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** When the card was connected while this test ran (a second tab), or before (§7.2). */
export const ALREADY_CONNECTED: Bilingual = {
  en: 'This account is already connected. Nothing more is needed for it.',
  nl: 'Dit account is al verbonden. Er is niets meer voor nodig.',
};

/**
 * A test that failed, recorded (0174 §4.7): one `mapping.grant_refused` row
 * per migration of the card, with the category, the link and the ref. Never
 * the password, the address that tried, or the server's words. Its own
 * transaction: nothing else is written for a failed test.
 */
export async function recordPasswordRefused(
  source: Pool | LedgerDriver,
  target: PersonPasswordTarget,
  mappingIds: readonly string[],
  category: 'refused_login' | 'unreachable' | 'face_missing' | 'locked',
): Promise<void> {
  try {
    await withTenantDb(target.tenantId, source, async (db) => {
      for (const mappingId of mappingIds) {
        await new PgLedger(db).recordAuditEvent(target.tenantId as TenantId, {
          actor: GRANT_ACTOR,
          action: GRANT_REFUSED_ACTION,
          entity: 'mapping',
          detail: { mappingId, personLinkId: target.linkId, via: 'password', ref: target.ref, refused: category },
        });
      }
    });
  } catch (error) {
    log.error('[api] recording a refused password on a person’s link failed:', error);
  }
}
