// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHAT A PERSON'S GRANT LINK ASKS FOR (ADR-0035, amended 2026-09-29; workplan
 * 0153 T5 (b), slice 2).
 *
 * A migration's link asks one account for one migration's data types
 * (`grant-subject.ts`, `grantLinkAsk`). A person's link asks each Google
 * account their migrations read, once, for everything those migrations need.
 * This file reads a person's migrations and groups them that way. Both the
 * owner's issue route and the grant route use it, so the link issued is the
 * link that works, as `grant-subject.ts` does for a migration's.
 *
 * ## Each migration is asked exactly what its own link would ask
 *
 * Every migration goes through `readGrantRows`, `grantReadiness` and
 * `grantLinkAsk`, unchanged: the same refusals, the same client decision, the
 * same scopes. A migration its own link could not serve (a Microsoft source, a
 * migration with no destination, a scope the deployment has not declared) is
 * left off the person's page rather than refused on it: the person grants what
 * can be granted this way, and the owner is told the rest when issuing.
 *
 * ## One account, one consent
 *
 * Migrations are grouped by the account they name, compared as Google compares
 * them (`googleAccountKey`, the key the ending binds a sign-in with). An
 * account's consent asks for every scope its migrations need, the union of
 * what each migration's own link would ask, through one Google client. Two
 * migrations of one account that run through different clients cannot share a
 * consent, and that account is refused by name rather than asked twice.
 *
 * ## Granted is what Start reads
 *
 * A migration is granted when its source has a way in: a refresh token or a
 * service-account key, on the connection or on the migration (the rule
 * `awaitingGrantRefusal` holds Start to). An account is granted when all of its
 * migrations are, and the page then has nothing to ask it.
 */

import { and, eq } from 'drizzle-orm';
import * as schema from '@openmig/ledger';
import type { PgDatabase } from '@openmig/ledger';
import { personLink, personMigration, tenantMember } from '@openmig/managed/schema-managed';
import type { Bilingual } from '@openmig/shared';
import {
  credential,
  grantReadiness,
  readGrantRows,
  storedCredentials,
  whereFromAndTo,
  type GrantEnv,
  type WhereFromAndTo,
} from './grant-subject.ts';
import { awaitingGrantRefusal, grantLinkAsk, type GrantLinkAsk } from './grant-link-readiness.ts';
import { googleAccountKey } from './signed-in-account.ts';

/** One migration of a person's, as their grant page shows it. */
export interface PersonGrantMigration {
  readonly mappingId: string;
  /** What this migration copies from the account, in the scope table's order. */
  readonly domains: GrantLinkAsk['domains'];
  /** Where it goes: the server and the account on it. */
  readonly to: WhereFromAndTo['to'];
  /** Whether its source has a way in already. */
  readonly granted: boolean;
}

/** How one account's consent would run, or why it cannot. */
export type PersonAccountAsk =
  | {
      readonly ok: true;
      /** Whose Google application asks. */
      readonly client: GrantLinkAsk['client'];
      /**
       * The connection whose own pair asks, when `client` is `connection`: its
       * stored secret, decrypted only when a consent URL is built.
       */
      readonly connectionSecretRef: string | null;
      /** Every scope its migrations need, and the two that say who signed in. */
      readonly scope: string;
      /** Every data type its migrations copy. */
      readonly domains: GrantLinkAsk['domains'];
      /** Whether every data scope asked for is one Google holds to reading. */
      readonly readOnlyAtProvider: boolean;
    }
  | { readonly ok: false; readonly reason: Bilingual };

/** One Google account of a person's, and the migrations that read it. */
export interface PersonGrantAccount {
  /** The address as the first of its migrations names it. */
  readonly account: string;
  readonly migrations: readonly PersonGrantMigration[];
  /** Whether every one of its migrations is granted. */
  readonly granted: boolean;
  readonly ask: PersonAccountAsk;
}

export interface PersonGrantSubject {
  readonly organisation: string;
  readonly organisationPhone: string | null;
  /** In the order their first migration was added to the person. */
  readonly accounts: readonly PersonGrantAccount[];
}

/**
 * The refusal for an account whose migrations run through different Google
 * clients. Written for the person holding the link, to forward, as the other
 * not-ready sentences are.
 */
export const TWO_CLIENTS: Bilingual = {
  en:
    'Your migrations from this account are set up with two different Google applications, so ' +
    'one sign-in cannot serve them both. Ask the person who sent you this link to set them up alike.',
  nl:
    'Uw migraties vanuit dit account zijn ingesteld met twee verschillende Google-applicaties, dus ' +
    'één aanmelding kan ze niet allebei bedienen. Vraag degene die u deze link stuurde om ze gelijk in te stellen.',
};

/** Whether a source's stored credentials, the connection's and the migration's, give it a way in. */
function hasAWayIn(sourceKind: string, connectionSecretRef: string | null, mappingSecretRef: string | null): boolean {
  const creds = { ...storedCredentials(connectionSecretRef), ...storedCredentials(mappingSecretRef) };
  return (
    awaitingGrantRefusal({
      sourceKind,
      hasRefreshToken: credential(creds, 'refreshToken') !== '',
      hasServiceAccountKey: credential(creds, 'serviceAccountKey') !== '',
    }) === null
  );
}

/** The union of space-joined scope strings, in the order first met. */
function scopeUnion(scopes: readonly string[]): string {
  const seen: string[] = [];
  for (const scope of scopes) {
    for (const s of scope.split(' ')) if (s && !seen.includes(s)) seen.push(s);
  }
  return seen.join(' ');
}

/** The union of data-type lists, in the order first met. */
function domainUnion(lists: ReadonlyArray<GrantLinkAsk['domains']>): GrantLinkAsk['domains'] {
  const seen: GrantLinkAsk['domains'][number][] = [];
  for (const list of lists) for (const d of list) if (!seen.includes(d)) seen.push(d);
  return seen;
}

/**
 * A person's migrations, grouped by the Google account each reads, inside the
 * caller's tenant transaction. Null when the person has no migration a link
 * can serve, or is not this organisation's.
 */
export async function readPersonGrantSubject(
  db: PgDatabase,
  tenantId: string,
  personId: string,
  env: GrantEnv = process.env,
): Promise<PersonGrantSubject | null> {
  const theirs = await db
    .select({
      mappingId: personMigration.mappingId,
      sourceSecretRef: schema.mailboxMapping.sourceSecretRef,
    })
    .from(personMigration)
    .innerJoin(schema.mailboxMapping, eq(schema.mailboxMapping.id, personMigration.mappingId))
    .where(and(eq(personMigration.personId, personId), eq(personMigration.tenantId, tenantId)))
    .orderBy(personMigration.addedAt, personMigration.mappingId);

  let organisation: string | null = null;
  let organisationPhone: string | null = null;
  const groups: Array<{
    key: string;
    account: string;
    entries: Array<{ migration: PersonGrantMigration; ask: GrantLinkAsk; connectionSecretRef: string | null }>;
  }> = [];

  for (const { mappingId, sourceSecretRef } of theirs) {
    const rows = await readGrantRows(db, tenantId, mappingId);
    if (!rows) continue;
    const decided = grantLinkAsk(grantReadiness(rows, env));
    if (!decided.ok) continue;
    const where = whereFromAndTo(rows);
    if (!where || where.from === null) continue;
    const key = googleAccountKey(where.from);
    if (key === null) continue;

    organisation ??= rows.organisation;
    organisationPhone ??= rows.organisationPhone;
    const migration: PersonGrantMigration = {
      mappingId,
      domains: decided.ask.domains,
      to: where.to,
      granted: hasAWayIn(rows.source.kind, rows.source.secretRef, sourceSecretRef),
    };
    const entry = { migration, ask: decided.ask, connectionSecretRef: rows.source.secretRef };
    const group = groups.find((g) => g.key === key);
    if (group) group.entries.push(entry);
    else groups.push({ key, account: where.from, entries: [entry] });
  }

  if (groups.length === 0 || organisation === null) return null;

  const accounts = groups.map((g): PersonGrantAccount => {
    const migrations = g.entries.map((e) => e.migration);
    const granted = migrations.every((m) => m.granted);
    const clients = new Set(
      g.entries.map((e) => (e.ask.client === 'deployment' ? 'deployment' : `connection:${e.connectionSecretRef ?? ''}`)),
    );
    if (clients.size > 1) return { account: g.account, migrations, granted, ask: { ok: false, reason: TWO_CLIENTS } };
    const first = g.entries[0]!;
    return {
      account: g.account,
      migrations,
      granted,
      ask: {
        ok: true,
        client: first.ask.client,
        connectionSecretRef: first.ask.client === 'connection' ? first.connectionSecretRef : null,
        scope: scopeUnion(g.entries.map((e) => e.ask.scope)),
        domains: domainUnion(g.entries.map((e) => e.ask.domains)),
        readOnlyAtProvider: g.entries.every((e) => e.ask.readOnlyAtProvider),
      },
    };
  });

  return { organisation, organisationPhone, accounts };
}

/**
 * Who asked: the address of the member who issued this person's link (0108
 * T8a, as `readAskedBy` reads a migration's). Null when that member has no
 * membership row any more.
 */
export async function readPersonLinkAskedBy(
  db: PgDatabase,
  tenantId: string,
  linkId: string,
): Promise<string | null> {
  const rows = await db
    .select({ email: tenantMember.email })
    .from(personLink)
    .innerJoin(
      tenantMember,
      and(eq(tenantMember.tenantId, personLink.tenantId), eq(tenantMember.userId, personLink.createdBy)),
    )
    .where(and(eq(personLink.id, linkId), eq(personLink.tenantId, tenantId)));
  const email = rows[0]?.email.trim();
  return email ? email : null;
}
