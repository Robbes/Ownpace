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
 * ## Accounts, not sources (workplan 0174 §3, §4.1, T1)
 *
 * Since alpha.21 a card is one account with a ROLE (`source` or `target`)
 * and a WAY (`sign-in` or `password`), and a stable `ref`, a hash of the
 * role, the provider or kind, the connection and the account, which the page
 * and the password route name it by and the try count is kept under.
 *
 *  - A sign-in source is grouped as before: one consent per account.
 *  - A password source (`PASSWORD_SOURCE_KINDS`) is a card when it has no
 *    password yet, or when the person gave it one through a link, which is
 *    stored on the migration (`source_secret_ref`). A password the owner
 *    typed on the connection is the owner's, and no card.
 *  - A destination is a card when `targetGrantAsk` asks something of it, or
 *    when the person connected it themselves (`person_granted_connection`,
 *    D1 (a)). A destination the owner connected with their own password is
 *    not the person's to grant, and no card. Two migrations into one
 *    destination account are one card.
 *  - A destination's sign-in (Cirrux Drive, T5) is a card of its own, beside
 *    the password card, and only once the account's password is stored: the
 *    grant is bound through that account (§4.4). Once the person connected
 *    it, it stays on their page, connected.
 *
 * ## Granted is what Start reads
 *
 * A migration is granted when its source has a way in: a refresh token or a
 * service-account key, on the connection or on the migration (the rule
 * `awaitingGrantRefusal` holds Start to). An account is granted when all of its
 * migrations are, and the page then has nothing to ask it.
 */

import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import * as schema from '@openmig/ledger';
import type { PgDatabase } from '@openmig/ledger';
import {
  personGrantedConnection,
  personLink,
  personLinkTry,
  personMigration,
  tenantMember,
} from '@openmig/managed/schema-managed';
import {
  DISCOVERY_DOMAINS,
  GRANTED_TARGET_FACES,
  secretFieldKeys,
  twoClientsAt,
  type Bilingual,
  type DiscoveryDomain,
  type WizardTargetType,
} from '@openmig/shared';
import {
  credential,
  grantReadiness,
  readGrantRows,
  storedCredentials,
  whereFromAndTo,
  type GrantEnv,
  type GrantRows,
  type WhereFromAndTo,
} from './grant-subject.ts';
import {
  awaitingGrantRefusal,
  sourceGrantAsk,
  targetGrantAsk,
  targetPasswordKeysNeeded,
  type GrantLinkAsk,
} from './grant-link-readiness.ts';
import { accountOfMapping } from './account-on-connection.ts';
import { namedAccountKey } from './signed-in-account.ts';
import {
  grantProviderOfKind,
  passwordGrantOf,
  passwordServerOf,
  type GrantProviderId,
  type GrantRole,
  type GrantServer,
  type GrantWay,
  type PasswordKind,
  type PersonField,
} from '../grant-providers.ts';

export type { GrantRole, GrantServer, GrantWay, PersonField } from '../grant-providers.ts';

/** Refused logins that lock a password card on one link (workplan 0174 §5.5, D4). */
export const PASSWORD_TRIES_PER_LINK = 5;

/** One migration of a person's, as their grant page shows it. */
export interface PersonGrantMigration {
  readonly mappingId: string;
  /** What this migration copies, in the scope table's order. */
  readonly domains: GrantLinkAsk['domains'];
  /** Where it goes: the server and the account on it. */
  readonly to: WhereFromAndTo['to'];
  /** Where it comes from (0174 §4.1): what a destination's card names. */
  readonly from: { readonly provider: string; readonly account: string | null };
  /** Whether this card's side of it has a way in already. */
  readonly granted: boolean;
}

/** How one account's way in would be given, or why it cannot. */
export type PersonAccountAsk =
  | {
      readonly ok: true;
      readonly way: 'sign-in';
      /** Whose sign-in it asks for (workplan 0171 §3.2). */
      readonly provider: GrantProviderId;
      /** Whose application asks. */
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
      /** A destination's sign-in (Cirrux Drive, 0174 T5): the connection its grant is stored on. */
      readonly connectionId?: string;
    }
  | {
      readonly ok: true;
      readonly way: 'password';
      readonly kind: PasswordKind;
      /** The connection the password is tested against and, for a destination, stored on. */
      readonly connectionId: string;
      /** Every data type its migrations copy: the faces the test measures (0174 §5.4). */
      readonly domains: GrantLinkAsk['domains'];
    }
  | { readonly ok: false; readonly reason: Bilingual };

/** One account of a person's, in one role, and the migrations it serves (workplan 0174 §4.1). */
export interface PersonGrantAccount {
  /** Stable on the page and in the PUT: a hash of (role, provider or kind, connection id, account). */
  readonly ref: string;
  readonly role: GrantRole;
  readonly way: GrantWay;
  /** Sign-in: the provider id. Password: the connection kind (`imap`, `nextcloud`, …). */
  readonly provider: GrantProviderId | PasswordKind;
  /** The account, as the owner named it. */
  readonly account: string;
  /** Password only: where it will be tried, as the owner set it (D2, D3). */
  readonly server?: GrantServer;
  /** Password only: the fields the person fills, from `credentialFieldsFor` (§5.2). */
  readonly fields?: ReadonlyArray<PersonField>;
  /** The migrations it serves: for a source, where each goes; for a target, where each comes from. */
  readonly migrations: readonly PersonGrantMigration[];
  /** Whether every one of its migrations has this side's way in. */
  readonly granted: boolean;
  /** Password only, and only when read for a link: tries left on it, or locked (§5.5). */
  readonly tries?: { readonly left: number; readonly locked: boolean };
  readonly ask: PersonAccountAsk;
}

export interface PersonGrantSubject {
  readonly organisation: string;
  readonly organisationPhone: string | null;
  /** In the order their first migration was added to the person; a migration's source before its destination. */
  readonly accounts: readonly PersonGrantAccount[];
}

/** Whether a sign-in source's stored credentials, the connection's and the migration's, give it a way in. */
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

/** The keys these credentials carry a non-empty value under: names, never values. */
export function credentialKeys(creds: Record<string, unknown>): string[] {
  return Object.keys(creds).filter((k) => credential(creds, k) !== '');
}

/** The keys that give a password source a way in (`awaitingGrantRefusal`'s). */
const SOURCE_PASSWORD_KEYS = ['password', 'appPassword'] as const;

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

/** The migration's included data types, in the discovery vocabulary. */
function domainsOf(included: ReadonlyArray<string>): DiscoveryDomain[] {
  return DISCOVERY_DOMAINS.filter((d) => included.includes(d));
}

/**
 * A card's ref (0174 §4.1): the role, the provider or kind, the connection
 * and the account, hashed. Stable while those are; never the address.
 */
export function accountRef(role: GrantRole, provider: string, connectionId: string, accountKey: string): string {
  return createHash('sha256')
    .update([role, provider, connectionId, accountKey].join('\u0000'))
    .digest('base64url')
    .slice(0, 22);
}

/**
 * What the owner set for a password card to show (0174 §5.2, D2): the
 * connection's config, the migration's own account over it, and the
 * NON-secret values of its stored credential record (the create door keeps
 * the user name there). A secret key is dropped here, before any field sees
 * it. `user`, the older spelling of the account, stands in for `username`.
 */
function shownValues(
  role: GrantRole,
  kind: PasswordKind,
  conn: { readonly config: unknown; readonly secretRef: string | null },
  override: unknown,
): Record<string, unknown> {
  const secrets = new Set(secretFieldKeys(role, kind));
  const record = Object.fromEntries(
    Object.entries(storedCredentials(conn.secretRef)).filter(([k]) => !secrets.has(k)),
  );
  const base = conn.config && typeof conn.config === 'object' ? (conn.config as Record<string, unknown>) : {};
  const own = override && typeof override === 'object' ? (override as Record<string, unknown>) : {};
  const out: Record<string, unknown> = { ...base, ...record, ...own };
  for (const k of secrets) delete out[k];
  if ((typeof out.username !== 'string' || out.username.trim() === '') && typeof out.user === 'string') {
    out.username = out.user;
  }
  return out;
}

interface Entry {
  readonly migration: PersonGrantMigration;
  /** Sign-in sources only: the migration's own ask, and the connection whose pair it may use. */
  readonly signIn?: { readonly ask: GrantLinkAsk; readonly connectionSecretRef: string | null };
}

interface Group {
  readonly key: string;
  readonly role: GrantRole;
  readonly way: GrantWay;
  readonly provider: GrantProviderId | PasswordKind;
  readonly account: string;
  readonly connectionId: string;
  readonly accountKey: string;
  /** Password cards: the owner's config, for the fields and the server. */
  readonly stored?: Record<string, unknown>;
  readonly entries: Entry[];
}

/**
 * A person's migrations, grouped by the account each side reads, inside the
 * caller's tenant transaction. Null when the person has no migration a link
 * can serve, or is not this organisation's. With `linkId`, each password
 * card says how many tries that link has left for it.
 */
export async function readPersonGrantSubject(
  db: PgDatabase,
  tenantId: string,
  personId: string,
  env: GrantEnv = process.env,
  opts: { readonly linkId?: string } = {},
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

  // The destinations this person connected themselves (D1 (a)).
  const grantedByThem = new Set(
    (
      await db
        .select({ connectionId: personGrantedConnection.connectionId })
        .from(personGrantedConnection)
        .where(and(eq(personGrantedConnection.personId, personId), eq(personGrantedConnection.tenantId, tenantId)))
    ).map((r) => r.connectionId),
  );

  let organisation: string | null = null;
  let organisationPhone: string | null = null;
  const groups: Group[] = [];
  const add = (g: Omit<Group, 'entries'>, entry: Entry, rows: GrantRows) => {
    organisation ??= rows.organisation;
    organisationPhone ??= rows.organisationPhone;
    const group = groups.find((x) => x.key === g.key);
    if (group) group.entries.push(entry);
    else groups.push({ ...g, entries: [entry] });
  };

  for (const { mappingId, sourceSecretRef } of theirs) {
    const rows = await readGrantRows(db, tenantId, mappingId);
    if (!rows) continue;
    const readiness = grantReadiness(rows, env);
    const where = whereFromAndTo(rows);
    if (!where) continue;
    const from = { provider: rows.source.kind, account: where.from };
    const domains = domainsOf(readiness.includedDomains);

    // ---- The source.
    const src = sourceGrantAsk({ ...readiness, namesItsAccount: where.from !== null });
    if (src.ok && src.way === 'sign-in' && where.from !== null) {
      // One account per provider and address (workplan 0171): the same address
      // at Google and at Microsoft is two sign-ins, never one.
      const accountKey = namedAccountKey(src.ask.provider, where.from);
      if (accountKey !== null) {
        add(
          {
            key: `source:sign-in:${src.ask.provider}:${accountKey}`,
            role: 'source',
            way: 'sign-in',
            provider: src.ask.provider,
            account: where.from,
            connectionId: rows.source.id,
            accountKey,
          },
          {
            migration: {
              mappingId,
              domains: src.ask.domains,
              to: where.to,
              from,
              granted: hasAWayIn(rows.source.kind, rows.source.secretRef, sourceSecretRef),
            },
            signIn: { ask: src.ask, connectionSecretRef: rows.source.secretRef },
          },
          rows,
        );
      }
    } else if (src.ok && src.way === 'password' && where.from !== null) {
      const merged = { ...storedCredentials(rows.source.secretRef), ...storedCredentials(sourceSecretRef) };
      const has = SOURCE_PASSWORD_KEYS.some((k) => credential(merged, k) !== '');
      const theirOwn = SOURCE_PASSWORD_KEYS.some((k) => credential(storedCredentials(sourceSecretRef), k) !== '');
      // The owner's own password on the connection is no card (the header).
      if (!has || theirOwn) {
        const accountKey = where.from.trim().toLowerCase();
        add(
          {
            key: `source:password:${src.kind}:${rows.source.id}:${accountKey}`,
            role: 'source',
            way: 'password',
            provider: src.kind,
            account: where.from,
            connectionId: rows.source.id,
            accountKey,
            stored: shownValues('source', src.kind, rows.source, rows.sourceOverride),
          },
          { migration: { mappingId, domains, to: where.to, from, granted: has } },
          rows,
        );
      }
    }

    // ---- The destination.
    const target = rows.target;
    if (!target) continue;
    const tKeys = credentialKeys(storedCredentials(target.secretRef));
    const dst = targetGrantAsk({
      targetKind: target.kind,
      includedDomains: readiness.includedDomains,
      targetCredentialKeys: tKeys,
    });
    if (!dst.ok) continue;
    const account = accountOfMapping(target, rows.targetOverride) ?? where.to.account ?? '';
    const accountKey = account.trim().toLowerCase();
    const byThem = grantedByThem.has(target.id);
    const passwordAsked = dst.asks.find((a) => a.way === 'password');
    if (passwordAsked || byThem) {
      const kind = (passwordAsked?.kind ?? target.kind) as PasswordKind;
      if (passwordGrantOf('target', kind) !== null) {
        const has = targetPasswordKeysNeeded(target.kind, readiness.includedDomains).every((k) => tKeys.includes(k));
        add(
          {
            key: `target:password:${kind}:${target.id}`,
            role: 'target',
            way: 'password',
            provider: kind,
            account,
            connectionId: target.id,
            accountKey,
            stored: shownValues('target', kind, target, rows.targetOverride),
          },
          { migration: { mappingId, domains, to: where.to, from, granted: has } },
          rows,
        );
      }
    }
    // A destination's grant (Cirrux Drive, 0174 §4.4, T5), read per role from
    // `GRANTED_TARGET_FACES`: asked of the account through the deployment's
    // own client, and offered ONLY once the account's password is stored, by
    // the owner or on this page, since Cirrux names no address and the grant
    // is bound through the account the password signs in to. Once connected
    // by the person, the card stays, connected.
    const passwordStored = targetPasswordKeysNeeded(target.kind, readiness.includedDomains).every((k) => tKeys.includes(k));
    const grantFace = Object.hasOwn(GRANTED_TARGET_FACES, target.kind)
      ? GRANTED_TARGET_FACES[target.kind as WizardTargetType]
      : undefined;
    const grantWritten = grantFace !== undefined && grantFace.faces.some((f) => readiness.includedDomains.includes(f));
    const grantStored = grantFace !== undefined && tKeys.includes(grantFace.credentialKey);
    const signIns = dst.asks.flatMap((a) => (a.way === 'sign-in' ? [a.provider] : []));
    const signInProvider = grantProviderOfKind(target.kind, 'target')?.id;
    if (signIns.length === 0 && byThem && grantWritten && grantStored && signInProvider !== undefined) {
      signIns.push(signInProvider);
    }
    for (const provider of signIns) {
      if (!passwordStored) continue;
      add(
        {
          key: `target:sign-in:${provider}:${target.id}`,
          role: 'target',
          way: 'sign-in',
          provider,
          account,
          connectionId: target.id,
          accountKey,
        },
        { migration: { mappingId, domains, to: where.to, from, granted: grantStored } },
        rows,
      );
    }
  }

  if (groups.length === 0 || organisation === null) return null;

  const tries = new Map<string, { refused: number; locked: boolean }>();
  if (opts.linkId !== undefined) {
    const rows = await db
      .select({ ref: personLinkTry.accountRef, refused: personLinkTry.refused, lockedAt: personLinkTry.lockedAt })
      .from(personLinkTry)
      .where(and(eq(personLinkTry.linkId, opts.linkId), eq(personLinkTry.tenantId, tenantId)));
    for (const r of rows) tries.set(r.ref, { refused: r.refused, locked: r.lockedAt !== null });
  }

  // Sources first, then destinations (0174 §4.5), each in the order met.
  const ordered = [...groups.filter((g) => g.role === 'source'), ...groups.filter((g) => g.role === 'target')];
  const accounts = ordered.map((g): PersonGrantAccount => {
    const migrations = g.entries.map((e) => e.migration);
    const granted = migrations.every((m) => m.granted);
    const ref = accountRef(g.role, g.provider, g.connectionId, g.accountKey);
    const common = { ref, role: g.role, way: g.way, provider: g.provider, account: g.account, migrations, granted };

    if (g.way === 'password') {
      const kind = g.provider as PasswordKind;
      const stored = g.stored ?? {};
      const tried = tries.get(ref);
      const refused = tried?.refused ?? 0;
      return {
        ...common,
        server: passwordServerOf(kind, stored),
        fields: passwordGrantOf(g.role, kind)?.personFields(stored) ?? [],
        ...(opts.linkId === undefined
          ? {}
          : {
              tries: {
                left: Math.max(0, PASSWORD_TRIES_PER_LINK - refused),
                locked: tried?.locked === true || refused >= PASSWORD_TRIES_PER_LINK,
              },
            }),
        ask: {
          ok: true,
          way: 'password',
          kind,
          connectionId: g.connectionId,
          domains: domainUnion(migrations.map((m) => m.domains)),
        },
      };
    }

    const signIns = g.entries.flatMap((e) => (e.signIn ? [e.signIn] : []));
    if (signIns.length === 0) {
      // A destination's sign-in (T5): the deployment's client, the grant
      // stored on the connection the card names.
      return {
        ...common,
        ask: {
          ok: true,
          way: 'sign-in',
          provider: g.provider as GrantProviderId,
          client: 'deployment',
          connectionSecretRef: null,
          connectionId: g.connectionId,
          scope: '',
          domains: domainUnion(migrations.map((m) => m.domains)),
          readOnlyAtProvider: false,
        },
      };
    }
    const clients = new Set(
      signIns.map((e) => (e.ask.client === 'deployment' ? 'deployment' : `connection:${e.connectionSecretRef ?? ''}`)),
    );
    // Two clients of one provider: one sign-in cannot serve both, said in that provider's name.
    const provider = g.provider as GrantProviderId;
    if (clients.size > 1) return { ...common, ask: { ok: false, reason: twoClientsAt(provider) } };
    const first = signIns[0]!;
    return {
      ...common,
      ask: {
        ok: true,
        way: 'sign-in',
        provider,
        client: first.ask.client,
        connectionSecretRef: first.ask.client === 'connection' ? first.connectionSecretRef : null,
        scope: scopeUnion(signIns.map((e) => e.ask.scope)),
        domains: domainUnion(signIns.map((e) => e.ask.domains)),
        readOnlyAtProvider: signIns.every((e) => e.ask.readOnlyAtProvider),
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
