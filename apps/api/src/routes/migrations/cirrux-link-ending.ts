// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * CIRRUX DRIVE, CONNECTED THROUGH A PERSON'S GRANT LINK (workplan 0174 §4.4,
 * T5; ADR-0035, ADR-0052).
 *
 * The owner's *Connect Cirrux Drive* (`cirrux-oauth-routes.ts`) stores a Drive
 * grant on an account of the organisation. This is the same consent begun on a
 * person's link, for a destination account that is theirs: the same callback
 * address (Cirrux registers one), told apart by the pending state, which holds
 * the person's link as well as the account.
 *
 * ## The order, as a source's link ending keeps it (`person-grant-ending.ts`)
 *
 * 1. A closed organisation takes nothing, asked before the code is exchanged
 *    and again in the store's transaction.
 * 2. The code is exchanged with the verifier, and Cirrux is asked who signed
 *    in and in which workspace (`GRANT_PROVIDERS.cirrux.finish`). A sign-in
 *    whose workspace Cirrux did not name is refused: nothing could be bound.
 * 3. One transaction: the link is live (`FOR UPDATE`, not revoked, expired or
 *    spent); the migrations the page listed are still this person's and
 *    still go into this account; **the account's app password is stored**,
 *    since the Drive card is offered only after it (§4.4); the grant is stored
 *    under the account row's lock, and **refused when it reached another
 *    workspace** than the one recorded on the account (`another_workspace`,
 *    nothing written, the link still live); the person is recorded as the
 *    one who connected the account (`person_granted_connection`); one
 *    `mapping.granted` row per migration, with `role: 'target'` and `via:
 *    'sign-in'`; the link spent once every account on it is connected.
 * 4. After the commit: what waited for it starts (`startWhenGranted`), and the
 *    account is measured again with the consent's own access token.
 *
 * A refused workspace is recorded as `mapping.grant_refused` with the
 * category, the link and the account's `ref`, and never the workspace's name
 * or the login (§4.7).
 *
 * The decisions are in `decideCirruxLinkEnding`, which takes its effects as
 * arguments, as the Microsoft ending does, so every branch is proven without a
 * server; the store is `storePersonDriveGrant`, proven over PGlite.
 */

import type { Pool } from 'pg';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { PgLedger, type LedgerDriver, type PgDatabase } from '@openmig/ledger';
import { personLink, personMigration } from '@openmig/managed/schema-managed';
import {
  connectedThroughPersonLink,
  onlyTheirMigrations,
  readOrganisationClosure,
  recordPersonGrantedConnection,
  spendPersonLink,
} from '@openmig/managed';
import {
  CIRRUX_DRIVE_GRANT_KEY,
  CIRRUX_DRIVE_WORKSPACE_KEY,
  LINK_SPENT,
  NOT_KEPT,
  log,
  organisationClosedRefusal,
  reasonPair,
  type Bilingual,
  type TenantId,
} from '@openmig/shared';
import { storeCirruxDriveGrantIn } from '@openmig/orchestration/cirrux-grant-store';
import { withTenantDb } from '../../middleware/auth.ts';
import type { GrantClient, GrantFinish } from '../grant-providers.ts';
import { GRANT_ACTION, GRANT_ACTOR, GRANT_REFUSED_ACTION } from './grant-ending.ts';
import { readGrantRows, storedCredentials } from './grant-subject.ts';
import { credentialKeys, readPersonGrantSubject } from './person-grant-subject.ts';
import { targetPasswordKeysNeeded } from './grant-link-readiness.ts';
import { liftTheHold } from './withdrawal-hold.ts';
import { NOTHING_LEFT_TO_GRANT, type PersonGrantTarget } from './person-grant-ending.ts';
import { ANOTHER_CIRRUX_WORKSPACE } from './cirrux-consent.ts';

/** The person's Drive consent, as the pending state recorded it when the button was pressed. */
export interface PersonDriveTarget extends PersonGrantTarget {
  /** The Cirrux destination the Drive grant is for. */
  readonly connectionId: string;
  /** The card's ref, for the refusal's audit row; never the address. */
  readonly ref: string;
}

/** When the account has no app password yet: the Drive card is offered only after it (§4.4). */
export const DRIVE_AFTER_THE_PASSWORD: Bilingual = {
  en:
    'This Cirrux account has no app password yet, and Cirrux Drive is connected only after it, so ' +
    'nothing was stored. Open your link again, connect the account with its app password first, ' +
    'then connect Cirrux Drive.',
  nl:
    'Dit Cirrux-account heeft nog geen app-wachtwoord, en Cirrux Drive wordt pas daarna verbonden, ' +
    'dus er is niets opgeslagen. Open uw link opnieuw, verbind het account eerst met zijn ' +
    'app-wachtwoord en verbind daarna Cirrux Drive.',
};

/** What the store found. */
export type PersonDriveStoreResult =
  | { readonly ok: true; readonly granted: readonly string[]; readonly linkSpent: boolean }
  | {
      readonly ok: false;
      readonly reason: string;
      readonly reasonNl: string;
      /** Nothing was written and the link is live: the person can press again. */
      readonly linkStillWorks?: boolean;
      /** Refused before the link was read (a closed organisation). */
      readonly linkUnused?: boolean;
    };

/** Thrown inside the transaction to roll the grant back when the account is somebody else's. */
class HeldByAnother extends Error {
  readonly said: Bilingual;
  constructor(said: Bilingual) {
    super('the account was connected by another person');
    this.said = said;
  }
}

/** One `mapping.grant_refused` row per listed migration, by category; never the workspace or the login. */
async function recordRefused(db: PgDatabase, target: PersonDriveTarget, refused: string): Promise<void> {
  for (const mappingId of target.mappingIds) {
    await new PgLedger(db).recordAuditEvent(target.tenantId as TenantId, {
      actor: GRANT_ACTOR,
      action: GRANT_REFUSED_ACTION,
      entity: 'mapping',
      detail: { mappingId, personLinkId: target.linkId, ref: target.ref, role: 'target', via: 'sign-in', refused },
    });
  }
}

/**
 * Store a person's Drive grant on their Cirrux destination, or refuse having
 * stored nothing: the transaction of the header's step 3.
 */
export async function storePersonDriveGrant(
  source: Pool | LedgerDriver,
  target: PersonDriveTarget,
  secret: Readonly<Record<string, string>>,
): Promise<PersonDriveStoreResult> {
  const refreshToken = secret[CIRRUX_DRIVE_GRANT_KEY];
  const workspace = secret[CIRRUX_DRIVE_WORKSPACE_KEY];
  if (!refreshToken || !workspace) throw new Error('a Drive grant reached the store without its token or its workspace');
  try {
    return await withTenantDb(target.tenantId, source, async (db): Promise<PersonDriveStoreResult> => {
      const closure = await readOrganisationClosure(db, target.tenantId);
      if (closure) {
        const refusal = organisationClosedRefusal(closure);
        return { ok: false, reason: refusal.en, reasonNl: refusal.nl, linkUnused: true };
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
      if (live.length === 0) return { ok: false, ...reasonPair(LINK_SPENT) };

      // Only what the page showed: still this person's, still into this account.
      const listed: { mappingId: string; domains: readonly string[] }[] = [];
      for (const mappingId of target.mappingIds) {
        const theirs = await db
          .select({ mappingId: personMigration.mappingId })
          .from(personMigration)
          .where(
            and(
              eq(personMigration.mappingId, mappingId),
              eq(personMigration.personId, target.personId),
              eq(personMigration.tenantId, target.tenantId),
            ),
          );
        if (theirs.length === 0) continue;
        const rows = await readGrantRows(db, target.tenantId, mappingId);
        if (!rows?.target || rows.target.id !== target.connectionId || rows.target.kind !== 'cirrux') continue;
        listed.push({ mappingId, domains: rows.includedDomains });
      }
      if (listed.length === 0) return { ok: false, ...reasonPair(NOTHING_LEFT_TO_GRANT), linkStillWorks: true };

      // The app password first (§4.4): the Drive card is offered only after it.
      const conn = await readGrantRows(db, target.tenantId, listed[0]!.mappingId);
      const keys = credentialKeys(storedCredentials(conn?.target?.secretRef ?? null));
      const needed = new Set(listed.flatMap((m) => targetPasswordKeysNeeded('cirrux', m.domains)));
      if (![...needed].every((k) => keys.includes(k))) {
        return { ok: false, ...reasonPair(DRIVE_AFTER_THE_PASSWORD), linkStillWorks: true };
      }

      const stored = await storeCirruxDriveGrantIn(
        db,
        { tenantId: target.tenantId, connectionId: target.connectionId },
        refreshToken,
        {
          workspace,
          refusal: async (tx) => {
            const closed = await readOrganisationClosure(tx, target.tenantId);
            return closed ? organisationClosedRefusal(closed) : null;
          },
        },
      );
      if (stored === 'no_account') return { ok: false, ...reasonPair(NOTHING_LEFT_TO_GRANT), linkStillWorks: true };
      if (stored === 'another_workspace') {
        await recordRefused(db, target, 'another_workspace');
        return { ok: false, ...reasonPair(ANOTHER_CIRRUX_WORKSPACE), linkStillWorks: true };
      }
      if (stored !== 'stored') return { ok: false, reason: stored.refused.en, reasonNl: stored.refused.nl, linkUnused: true };

      const held = await recordPersonGrantedConnection(db, {
        tenantId: target.tenantId,
        personId: target.personId,
        connectionId: target.connectionId,
        linkId: target.linkId,
      });
      if (held !== 'recorded') throw new HeldByAnother(onlyTheirMigrations(held.heldBy.displayName));

      const granted: string[] = [];
      for (const m of listed) {
        await new PgLedger(db).recordAuditEvent(target.tenantId as TenantId, {
          actor: GRANT_ACTOR,
          action: GRANT_ACTION,
          entity: 'mapping',
          detail: {
            mappingId: m.mappingId,
            personLinkId: target.linkId,
            ref: target.ref,
            role: 'target',
            via: 'sign-in',
            provider: 'cirrux',
            connectionId: target.connectionId,
          },
        });
        granted.push(m.mappingId);
      }
      // A withdrawal's hold ends once both sides have a way in again: the
      // app password and, where files are copied, this Drive grant (0174 §4.3).
      await liftTheHold(db, target.tenantId, granted);

      // Spent once every account on it is connected, read after the writes,
      // as a source's ending decides it (`storePersonGrant`).
      const asksAgain = await connectedThroughPersonLink(db, {
        tenantId: target.tenantId,
        linkId: target.linkId,
        mappingIds: granted,
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
      return { ok: true, granted, linkSpent };
    });
  } catch (error) {
    if (error instanceof HeldByAnother) return { ok: false, ...reasonPair(error.said), linkStillWorks: true };
    throw error;
  }
}

/** What the ending page shows. */
export type CirruxLinkPage =
  | { readonly status: number; readonly ok: false; readonly reason: Bilingual | string; readonly link?: 'works' | 'unused' }
  | {
      readonly status: 200;
      readonly ok: true;
      readonly connectionId: string;
      readonly username?: string;
      readonly workspace?: string;
    };

/** The effects the ending needs, injected. */
export interface CirruxLinkEffects {
  readonly closedOrganisation: (tenantId: string) => Promise<{ reason: string; reasonNl: string } | null>;
  readonly finish: (code: string, redirectUri: string, client: GrantClient, verifier: string) => Promise<GrantFinish>;
  readonly store: (target: PersonDriveTarget, secret: Readonly<Record<string, string>>) => Promise<PersonDriveStoreResult>;
  /** After the commit: what waited starts, and the account is measured. Never undoes the grant. */
  readonly after: (
    target: PersonDriveTarget,
    granted: readonly string[],
    access: { readonly accessToken: string; readonly expiresAt: number } | undefined,
  ) => Promise<void>;
}

/** What the pending state says about this consent, as far as the ending reads it. */
export interface CirruxLinkPending {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly verifier: string;
  readonly personLink: PersonDriveTarget;
}

/**
 * The whole ending, decided. `query` is the browser's (`error`, `code`, `iss`
 * already checked by the callback); whose link and which account come from
 * `pending`, the server's own record.
 */
export async function decideCirruxLinkEnding(
  pending: CirruxLinkPending,
  query: { readonly error?: unknown; readonly code?: unknown },
  effects: CirruxLinkEffects,
): Promise<CirruxLinkPage> {
  const target = pending.personLink;
  if (typeof query.error === 'string' && query.error.length > 0) {
    return {
      status: 200,
      ok: false,
      reason: {
        en: `Cirrux reported: ${query.error}. Nothing was granted and nothing was stored.`,
        nl: `Cirrux meldde: ${query.error}. Er is niets toegestaan en niets opgeslagen.`,
      },
      link: 'unused',
    };
  }
  const code = typeof query.code === 'string' ? query.code : '';
  if (!code) {
    return {
      status: 400,
      ok: false,
      reason: { en: 'Cirrux sent no authorization code back.', nl: 'Cirrux heeft geen autorisatiecode teruggestuurd.' },
      link: 'unused',
    };
  }
  let closed;
  try {
    closed = await effects.closedOrganisation(target.tenantId);
  } catch (error) {
    log.error('[api] reading whether a Cirrux grant link’s organisation was closed failed:', error);
    return { status: 500, ok: false, reason: NOT_KEPT, link: 'unused' };
  }
  if (closed) return { status: 409, ok: false, reason: { en: closed.reason, nl: closed.reasonNl }, link: 'unused' };

  let finished: GrantFinish;
  try {
    finished = await effects.finish(code, pending.redirectUri, { clientId: pending.clientId, clientSecret: '' }, pending.verifier);
  } catch (error) {
    log.error('[api] a Cirrux grant link could not be finished:', error);
    return { status: 502, ok: false, reason: NOT_KEPT, link: 'unused' };
  }
  if (!finished.ok) {
    log.warn(`[api] a Cirrux grant link's consent failed for person ${target.personId}: ${finished.reason}`);
    return { status: 400, ok: false, reason: finished.said, link: 'unused' };
  }

  let stored: PersonDriveStoreResult;
  try {
    stored = await effects.store(target, finished.secret);
  } catch (error) {
    log.error('[api] storing a Cirrux Drive grant from a person’s link failed:', error);
    return { status: 500, ok: false, reason: NOT_KEPT, link: 'unused' };
  }
  if (!stored.ok) {
    const reason = { en: stored.reason, nl: stored.reasonNl };
    if (stored.linkStillWorks) return { status: 403, ok: false, reason, link: 'works' };
    return { status: 409, ok: false, reason, ...(stored.linkUnused ? { link: 'unused' as const } : {}) };
  }
  log.info(`[api] Cirrux Drive connected through a person's link on account ${target.connectionId}`);
  try {
    await effects.after(target, stored.granted, finished.access);
  } catch (error) {
    log.warn(`[api] Cirrux Drive is connected on ${target.connectionId}; what follows it failed`, error);
  }
  return {
    status: 200,
    ok: true,
    connectionId: target.connectionId,
    ...(finished.shownAs?.username === undefined ? {} : { username: finished.shownAs.username }),
    ...(finished.shownAs?.workspace === undefined ? {} : { workspace: finished.shownAs.workspace }),
  };
}
