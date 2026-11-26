// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The migrator's two routes (workplan 0108 T4).
 *
 * Their own file, and not beside the owner's, because they authenticate a
 * different kind of caller: `authenticateMappingLink` attaches a mapping and a
 * tenant and **no identity at all**. Keeping them apart is what makes that
 * visible — a route in `migrations/` sits under `authenticate` and can read a
 * `userId`; a route here cannot, because there is no user.
 *
 * ## What a link holder may learn
 *
 * `GET /api/grant/:link` answers with the smallest set of facts a person needs
 * in order to decide: **who is asking** (the organisation's name — consenting
 * to an anonymous request is not consenting), **what will be read**, **which
 * scope** in Google's own words and whether every data scope it asks for is
 * one Google holds to reading (0144 T3 (c)), **until when** the link works,
 * and — since
 * 2026-09-23 (0108 T8a) — **who asked, from which account, and to which
 * destination**. Without those, a stranger who set up a migration from
 * somebody's account into a server of their own could send a link whose every
 * screen was genuine: this one and Google's. *Who asked* is the address of the
 * member who issued the link. T4 left it out, and the owner reversed that on
 * 2026-09-23: *"It has to be clear who is facilitating a migration of someone
 * else."* It does not answer with the mapping id, the tenant id, the client id,
 * anything about other mappings, or anything about the organisation beyond its
 * name.
 *
 * Since workplan 0176 step B (T3) a person's link also says **who that member
 * is to them**: `sender`, the name the member gave as the people they send a
 * link to know them, how the person knows them (a fixed list, D7), and their
 * own number (D11), each the member's own to give and each held to a shape
 * (`@openmig/shared`'s `sender.ts`). `askedBy` stays the address beside it, so
 * a page a release behind still reads it.
 *
 * ## From is a condition, not a label
 *
 * Since T8 (b) (the owner, 2026-09-23: *"bind to the account the page already
 * named"*), the consent also asks Google who signed in, and the callback stores
 * nothing unless it is the account the page names (`signed-in-account.ts`). So
 * a migration that names no account is not ready, and the consent URL tells
 * Google which account to offer first.
 *
 * ## The other direction of the same warning
 *
 * `routes/invitations.ts` carries the long version: an invitation is an offer
 * to JOIN, authorised by a verified email claim and carrying no token at all,
 * while this is a bearer credential for somebody who will never have an
 * account. They are opposite mechanisms that both look like "a stranger
 * arrives with something in a URL", and unifying them would give one of the
 * two the wrong half of the other's machinery.
 *
 * ## In the reader's language (workplan 0145 T6)
 *
 * The page chooses its language, and nothing here does. What will be read goes
 * out as data-type codes, which the page words from its own dictionary, and
 * every refusal carries its Dutch beside its English (`reason`, `reasonNl`),
 * from the pairs in `@openmig/shared`. The authorize call names the page's
 * language, and it is recorded on the pending consent so the ending after
 * Google is in it too.
 *
 * ## The owner's secret never leaves the server
 *
 * `POST /api/grant/:link/:provider/authorize` (Google's own address until
 * workplan 0171 made it one provider of several, `grant-providers.ts`) reads
 * the client id and secret out
 * of the mapping's own source connection and decrypts them here — or, where
 * the connection stores none, takes the deployment's (0108 T6). 0089 T1's
 * owner beginning takes them from the request body, because the owner is the
 * person typing them in; this beginning must not, because the link holder is
 * not that person and must never hold that secret. The consent URL carries the
 * client id (Google requires it and it is not a secret); the secret goes only
 * into the token-exchange POST body, in the callback, in this process.
 *
 * ## The person's own new address (workplan 0168 §4.4, D6)
 *
 * A person's page also carries `addressChanges`: the rows of the
 * organisation's address changes linked to this person, and nobody else's,
 * each named by an opaque `ref`, with its new address and its state and never
 * its old address, so the page can ask *Your new address: ‹address›. Is that
 * right?*. `PUT /api/grant/:link/address-changes/:ref` takes the answer,
 * behind this door's own link check and close (`link-address-changes.ts`). A
 * migration's own link names no person, so its page carries none.
 */

import { Router } from 'express';
import { idsThatAreNoUuid } from '../an-id-that-is-no-uuid.ts';
import type { RequestHandler, Response } from 'express';
import {
  CIRRUX_DRIVE_SCOPES,
  cirruxDeploymentClient,
  NOT_READY_BECAUSE,
  NOT_READY_BECAUSE_DROPBOX,
  NOT_READY_BECAUSE_MICROSOFT,
  accountNotReady,
  cannotSignInYet,
  cannotSignInYetOnAPersonsLink,
  dropboxDeploymentClient,
  googleDeploymentClient,
  languageOf,
  localeOf,
  microsoftDeploymentClient,
  microsoftTenant,
  notReady as notReadyBecause,
  reasonPair,
  registerOf,
  type Bilingual,
  type DiscoveryDomain,
  type Register,
  withoutTrailing,
} from '@openmig/shared';
import { readLinkAddressChanges, readPersonVoice } from '@openmig/managed';
import { authenticateGrantLink, getDbPool, withTenantDb } from '../middleware/auth.ts';
import { refusedAsClosed } from '../closed-organisation.ts';
import { registerOfPerson } from '../person-register.ts';
import { answerAddressChangeThroughLink } from './link-address-changes.ts';
import { passwordLimit, passwordLimiter, passwordThroughLink } from './grant-password.ts';
import { serverAgainstAddress } from './grant-server-domain.ts';
import type { MappingLinkRequest, PersonLinkRequest } from '../types/api.ts';
import { serverFault } from '../server-fault.ts';
import {
  rawIpCallbackRefusal,
  unreachableCallbackRefusal,
} from './migrations/google-consent.ts';
import { consentFlows } from './migrations/consent-flows.ts';
import { pkcePair } from './migrations/cirrux-consent.ts';
import { GRANT_ACTOR } from './migrations/grant-ending.ts';
import { grantLinkAsk, type GrantLinkAskRefusalCode } from './migrations/grant-link-readiness.ts';
import { grantProviderOfKind } from './grant-providers.ts';
import {
  credential,
  grantReadiness,
  readAskedBy,
  readCheckedCompany,
  readGrantRows,
  storedCredentials,
  whereFromAndTo,
  type WhereFromAndTo,
} from './migrations/grant-subject.ts';
import {
  readPersonGrantSubject,
  readPersonLinkSender,
  type PersonGrantSubject,
} from './migrations/person-grant-subject.ts';
import { sameNamedAccount } from './migrations/signed-in-account.ts';
import {
  GRANT_PROVIDERS,
  isGrantProviderId,
  type GrantClient,
  type GrantProviderId,
} from './grant-providers.ts';

const router = idsThatAreNoUuid(Router());

let _dbPool: ReturnType<typeof getDbPool> | null = null;
function pool() {
  if (!_dbPool) _dbPool = getDbPool();
  return _dbPool;
}

/**
 * Link authentication, with the database resolved on the FIRST REQUEST rather
 * than at import.
 *
 * `authenticateMappingLink(purpose, source)` takes its source eagerly, so
 * writing it straight into `router.get(...)` would call `getDbPool()` while
 * this module is being loaded — which throws when `DATABASE_URL` is unset, and
 * therefore makes merely importing the router depend on a configured database.
 * Every other database use in this file already defers through `pool()`; this
 * makes the middleware do the same.
 */
const linkAuth: RequestHandler = (req, res, next) =>
  // A migration's link or a person's (ADR-0035, amended 2026-09-29): the two
  // routes below answer both, each in its own shape.
  authenticateGrantLink('grant', pool())(req, res, next);

/**
 * When none of a person's migrations can be granted through their link (0153
 * T5 (b)): each migration's own reason was the owner's to hear when issuing.
 * This reader can act on none of them, so it says whom to tell. A person's
 * page says no form of *migreren* (workplan 0176 D1), and English follows its
 * Dutch; with *je* for a person whose pages say *je* (T7, §11).
 */
export const NOTHING_TO_GRANT: Bilingual = {
  en:
    'Nothing on this link can be connected yet. Nothing you can do from here will fix that; ' +
    'please tell the person who sent you the link.',
  nl:
    'Op deze link staat nog niets wat kan worden verbonden. U kunt dat vanaf hier niet oplossen; ' +
    'laat het de persoon weten die u de link stuurde.',
  nlJe:
    'Op deze link staat nog niets wat kan worden verbonden. Je kunt dat vanaf hier niet oplossen; ' +
    'laat het de persoon weten die je de link stuurde.',
};

/** When the button named an account this person's link does not ask for. */
export const NOT_THIS_ACCOUNT: Bilingual = {
  en: 'This link does not ask for that account. Open the link again and choose an account it lists.',
  nl: 'Deze link vraagt niet om dat account. Open de link opnieuw en kies een account dat erop staat.',
};

/**
 * Whether a person's link asks for this account again: it was made while
 * every account of theirs was connected, and one of this account's
 * migrations has not been connected through it since (managed migration
 * 0036). A connection can stop working while its token is still held.
 */
function asksAgainFor(link: PersonLink, account: PersonGrantSubject['accounts'][number]): boolean {
  return account.granted && account.migrations.some((m) => link.asksAgain?.includes(m.mappingId) ?? false);
}

/** When the account the button named is already connected, and not asked for again. */
export const ALREADY_GRANTED: Bilingual = {
  en: 'This account is already connected. Nothing more is needed for it.',
  nl: 'Dit account is al verbonden. Er is niets meer voor nodig.',
};

interface GrantSubject extends WhereFromAndTo {
  /** Never null here: a migration that names no account is not ready (T8 (b)). */
  readonly from: string;
  readonly organisation: string;
  readonly organisationPhone: string | null;
  /**
   * The data types this link reads, as codes (workplan 0145 T6). The page
   * says them in its own words, from its dictionary, in the reader's
   * language: until then this was a sentence built here in English only, and
   * a Dutch reader met it inside a Dutch frame. Keyed by data type since a
   * Google ACCOUNT link can ask for several (0108 T7).
   */
  readonly domains: ReadonlyArray<DiscoveryDomain>;
  readonly scope: string;
  /**
   * Whether every data scope this link asks for is one Google holds to reading
   * (0144 T3 (c)). About the ask: Google may add permissions this account
   * already gave the same app (`include_granted_scopes`), which the ending
   * judges from what Google recorded.
   */
  readonly readOnlyAtProvider: boolean;
  /** Whose sign-in the link asks for (workplan 0171 §3.2). */
  readonly provider: GrantProviderId;
  /** The application the consent runs against, and Microsoft's directory. */
  readonly client: GrantClient;
}

/**
 * Each refusal `grantLinkAsk` can give, as the link holder should hear it. The
 * owner was told the remedy when issuing; this reader cannot act on any of
 * them, so each says only what is wrong, and `notReady` says whom to tell.
 *
 * In both languages, beside each other in `@openmig/shared` (workplan 0145
 * T6). Typed by this file's codes, so a refusal `grantLinkAsk` learns to give
 * is a compile error here until it has both halves.
 */
const FOR_THE_LINK_HOLDER: Readonly<Record<GrantLinkAskRefusalCode, Bilingual>> = NOT_READY_BECAUSE;

/**
 * The same, for a migration whose source is a Microsoft account (workplan
 * 0171 §3.3): the reasons that name Google, said with Microsoft's name.
 */
const FOR_THE_MICROSOFT_LINK_HOLDER: Readonly<Record<GrantLinkAskRefusalCode, Bilingual>> = {
  ...NOT_READY_BECAUSE,
  ...NOT_READY_BECAUSE_MICROSOFT,
};

/** The same, for a Dropbox migration (workplan 0174 §6). */
const FOR_THE_DROPBOX_LINK_HOLDER: Readonly<Record<GrantLinkAskRefusalCode, Bilingual>> = {
  ...NOT_READY_BECAUSE,
  ...NOT_READY_BECAUSE_DROPBOX,
};

/** Which of them the link holder hears, by the source's provider when it is known. */
function forTheLinkHolder(provider: GrantProviderId | null): Readonly<Record<GrantLinkAskRefusalCode, Bilingual>> {
  if (provider === 'microsoft') return FOR_THE_MICROSOFT_LINK_HOLDER;
  if (provider === 'dropbox') return FOR_THE_DROPBOX_LINK_HOLDER;
  return FOR_THE_LINK_HOLDER;
}

/**
 * The application a link's consent runs against, as the readiness check
 * decided whose it is, with the values read only now; null when the decided
 * one has no whole pair after all. Google's rule is unchanged (0108 T6);
 * Microsoft's carries the directory: the connection's own `tenantId` when its
 * own pair asks, the deployment's authority otherwise (`common` unless set).
 * Dropbox's is the connection's whole pair or the deployment's app (0174 §6).
 */
export function linkClient(
  provider: GrantProviderId,
  whose: 'connection' | 'deployment',
  connectionSecretRef: string | null,
): GrantClient | null {
  if (whose === 'connection') {
    const creds = storedCredentials(connectionSecretRef);
    const clientId = credential(creds, 'clientId');
    const clientSecret = credential(creds, 'clientSecret');
    if (!clientId || !clientSecret) return null;
    if (provider !== 'microsoft') return { clientId, clientSecret };
    return { clientId, clientSecret, tenant: credential(creds, 'tenantId') || microsoftTenant() };
  }
  if (provider === 'microsoft') return microsoftDeploymentClient();
  if (provider === 'dropbox') return dropboxDeploymentClient();
  return googleDeploymentClient();
}

/** The address a provider must redirect to: the SAME one the owner registered for it. */
function callbackFor(req: MappingLinkRequest, provider: GrantProviderId): string {
  const base = withoutTrailing(process.env.API_URL ?? `${req.protocol}://${req.get('host')}`, '/');
  return `${base}/api/migrations/${provider}/callback`;
}

/** When the button named a provider this link does not ask for. */
export const NOT_THIS_PROVIDER: Bilingual = {
  en: 'This link asks for another kind of account. Open the link again and use the button it shows.',
  nl: 'Deze link vraagt om een ander soort account. Open de link opnieuw en gebruik de knop die erop staat.',
};

/**
 * Everything the grant flow needs about one mapping, read in one place.
 *
 * The refusals here are the SAME ones the owner met at issue time — the same
 * rows (`readGrantRows`), the same decision (`grantLinkAsk`) — because a link
 * can outlive the configuration that made it issuable: an owner can delete a
 * connection, rotate a client, or switch a data type off between sending a
 * link and somebody opening it. Re-checked at use, not trusted from issue.
 */
async function loadSubject(
  tenantId: string,
  mappingId: string,
): Promise<{ ok: true; subject: GrantSubject } | { ok: false; reason: Bilingual }> {
  const rows = await withTenantDb(tenantId, pool(), (db) => readGrantRows(db, tenantId, mappingId));
  // Every one of these is somebody else's mistake, so the sentence is written
  // to be forwarded: it tells the reader what to say to the person who sent
  // them here, rather than what to fix themselves.
  const notReady = (what: Bilingual) => ({ ok: false as const, reason: notReadyBecause(what) });
  if (!rows) return notReady(FOR_THE_LINK_HOLDER.no_source_connection);

  const decided = grantLinkAsk(grantReadiness(rows));
  if (!decided.ok) {
    const provider = grantProviderOfKind(rows.source.kind)?.id ?? null;
    return notReady(forTheLinkHolder(provider)[decided.refusal.code]);
  }
  const words = forTheLinkHolder(decided.ask.provider);
  const where = whereFromAndTo(rows);
  if (!where) return notReady(words.no_target);
  // The decision already refused a migration that names no account; this is
  // the same fact, read where the type can see it.
  if (where.from === null) return notReady(words.no_named_account);
  const from = where.from;

  // WHOSE client, as decided — the values read only now, and only the pair
  // the decision named. The deployment's is read from the environment here
  // rather than handed over by the decision, which takes booleans and nothing
  // else (see `grant-link-readiness.ts`).
  const client = linkClient(decided.ask.provider, decided.ask.client, rows.source.secretRef);
  if (!client) return notReady(words.client_not_configured);

  return {
    ok: true,
    subject: {
      organisation: rows.organisation,
      organisationPhone: rows.organisationPhone,
      domains: decided.ask.domains,
      scope: decided.ask.scope,
      readOnlyAtProvider: decided.ask.readOnlyAtProvider,
      from,
      to: where.to,
      provider: decided.ask.provider,
      client,
    },
  };
}


type PersonLink = NonNullable<PersonLinkRequest['personLink']>;

/** A person's migrations, grouped by account, read in their organisation's transaction. */
function readPersonSubject(link: PersonLink): Promise<PersonGrantSubject | null> {
  return withTenantDb(link.tenantId, pool(), (db) =>
    readPersonGrantSubject(db, link.tenantId, link.personId, process.env, { linkId: link.linkId }),
  );
}

/**
 * GET for a PERSON'S link (ADR-0035, amended 2026-09-29; 0153 T5 (b)): what a
 * migration's page says, per Google account. Who is asking, who asked, and
 * until when, once; then each account with what it will read, the scope in
 * Google's words, where each of its migrations goes, and whether it is
 * connected already. No migration id: the button names the account.
 */
async function answerForAPerson(res: Response, link: PersonLink): Promise<void> {
  if (await refusedAsClosed(res, link.tenantId, pool())) return;
  // How the person's pages speak to them (0176 T7): the page is told, and the
  // server says its own Dutch in that register.
  const voice = await withTenantDb(link.tenantId, pool(), (db) => readPersonVoice(db, link.tenantId, link.personId));
  const register = registerOf(voice);
  const subject = await readPersonSubject(link);
  if (!subject) return void res.status(409).json({ error: 'not_ready', ...reasonPair(NOTHING_TO_GRANT, register) });
  const { sent, checkedCompany, addressChanges } = await withTenantDb(link.tenantId, pool(), async (db) => ({
    // Who sent it (workplan 0176 §7, T3): the member's address, as before,
    // and the name and own number the page shows of them.
    sent: await readPersonLinkSender(db, link.tenantId, link.linkId),
    checkedCompany: await readCheckedCompany(db, link.tenantId),
    // Their own rows of the address changes, to confirm or send back here
    // (0168 §4.4, D6): the rows linked to this person, and nobody else's.
    addressChanges: await readLinkAddressChanges(db, link.tenantId, link.personId),
  }));
  // Where each password card's password goes, compared with the address's
  // own mail (0174 §5.8, D3): a warning for the page, never a refusal.
  const servers = await Promise.all(
    subject.accounts.map((a) => (a.way === 'password' && a.server ? serverAgainstAddress(a.account, a.server) : null)),
  );
  res.json({
    kind: 'person',
    organisation: subject.organisation,
    checkedCompany,
    askedBy: sent.askedBy,
    // The name the member gave, how the person knows them, and their own
    // number; the page shows the organisation's where they gave none (D11).
    sender: sent.sender,
    organisationPhone: subject.organisationPhone,
    accounts: subject.accounts.map((a, i) => ({
      // The card's name on the page and in the password route (workplan 0174
      // §4.1): a hash, never the address.
      ref: a.ref,
      // Which side it is, and how the person gives a way in (0174 §3).
      role: a.role,
      way: a.way,
      account: a.account,
      // Sign-in: whose sign-in this account's button opens (workplan 0171
      // §3.2). Password: the connection kind, for the page's words.
      provider: a.provider,
      granted: a.granted,
      // Connected, and asked for again all the same (`asksAgain`).
      again: asksAgainFor(link, a),
      // Password cards (0174 §5.2, §5.5, §5.8): where it is tried, what the
      // owner fixed and what the person fills, and the tries left on this
      // link. Never a secret's value: a secret field carries none.
      ...(a.way === 'password'
        ? { server: servers[i] ?? a.server ?? null, fields: a.fields ?? [], tries: a.tries ?? null }
        : {}),
      // What it will read and in which words, when it can be asked; otherwise
      // why not, in both languages, for the person to forward.
      ...(a.ask.ok
        ? a.ask.way === 'sign-in'
          ? { domains: a.ask.domains, scope: a.ask.scope, readOnlyAtProvider: a.ask.readOnlyAtProvider, notReady: null }
          : { domains: a.ask.domains, scope: null, readOnlyAtProvider: false, notReady: null }
        : { domains: [], scope: null, readOnlyAtProvider: false, notReady: reasonPair(a.ask.reason, register) }),
      // For a source, where each goes; for a destination, where each comes from.
      // And whether the organisation can open the copy too (change 3 of the owner's decisions of 2026-11-26).
      migrations: a.migrations.map((m) => ({
        domains: m.domains,
        to: m.to,
        from: m.from,
        granted: m.granted,
        theOrganisationOpensIt: m.destinationIsTheOrganisations,
      })),
    })),
    expiresAt: link.expiresAt.toISOString(),
    addressChanges,
    // The language and register the member chose for the person (0176 T7):
    // the page reads its informal layer for `informal`, and takes `language`
    // until the reader picks another. Null language is the browser's.
    language: languageOf(voice),
    register,
  });
}

/**
 * The person's grant page, for the ending to go back to when more accounts
 * are left to connect (the owner's decisions of 2026-11-26): the web address
 * this link opens, from the link the authorize call came through. None when
 * the deployment names no web address; the ending then offers no button.
 */
function grantPageBack(req: PersonLinkRequest): { backUrl?: string } {
  const base = process.env.WEB_URL === undefined ? undefined : withoutTrailing(process.env.WEB_URL, '/');
  const token = req.params.link;
  return base && typeof token === 'string' && token !== '' ? { backUrl: `${base}/grant/${encodeURIComponent(token)}` } : {};
}

/**
 * POST authorize for a PERSON'S link: the account the button named, asked for
 * everything its listed migrations need, through the one client they share.
 * The pending state records the account and those migrations, so the ending
 * grants exactly what the page showed and keeps only that account's sign-in.
 */
async function authorizeForAPerson(
  req: PersonLinkRequest,
  res: Response,
  link: PersonLink,
  provider: GrantProviderId,
): Promise<void> {
  if (await refusedAsClosed(res, link.tenantId, pool())) return;
  const asked = (req.body as { account?: unknown } | undefined)?.account;
  // The person's register (0176 T7): every refusal below says it, and the
  // pending consent keeps it, so the ending after the sign-in says it too.
  const register = await registerOfPerson(pool(), link.tenantId, link.personId);
  const subject = await readPersonSubject(link);
  if (!subject) return void res.status(409).json({ error: 'not_ready', ...reasonPair(NOTHING_TO_GRANT, register) });
  // A destination's sign-in (Cirrux Drive, workplan 0174 §4.4, T5): its own
  // beginning, the card named by its ref.
  if ((GRANT_PROVIDERS[provider]?.targetKinds.size ?? 0) > 0) {
    return void (await authorizeTargetForAPerson(req, res, link, provider, subject, register));
  }
  // The account the button named, at the provider the button named: the same
  // address at Google and at Microsoft is two accounts (workplan 0171).
  const account =
    typeof asked === 'string'
      ? subject.accounts.find(
          (a) =>
            a.role === 'source' &&
            a.way === 'sign-in' &&
            a.provider === provider &&
            sameNamedAccount(provider, a.account, asked),
        )
      : undefined;
  if (!account) return void res.status(409).json({ error: 'not_this_account', ...reasonPair(NOT_THIS_ACCOUNT, register) });
  if (account.granted && !asksAgainFor(link, account)) {
    return void res.status(409).json({ error: 'already_granted', ...reasonPair(ALREADY_GRANTED, register) });
  }
  if (!account.ask.ok) {
    return void res.status(409).json({ error: 'not_ready', ...reasonPair(account.ask.reason, register) });
  }
  // A sign-in source, found above; the type learns it here.
  if (account.ask.way !== 'sign-in') {
    return void res.status(409).json({ error: 'not_this_account', ...reasonPair(NOT_THIS_ACCOUNT, register) });
  }

  // WHOSE client, as decided, the values read only now.
  const client = linkClient(provider, account.ask.client, account.ask.connectionSecretRef);
  if (!client) {
    return void res.status(409).json({
      error: 'not_ready',
      // A person's link says the account, never a migration (workplan 0176 D1, §21.3).
      ...reasonPair(accountNotReady(forTheLinkHolder(provider).client_not_configured), register),
    });
  }

  const redirectUri = callbackFor(req, provider);
  const ipRefusal = rawIpCallbackRefusal(redirectUri);
  if (ipRefusal) {
    return void res.status(409).json({ error: 'raw_ip_callback', ...reasonPair(cannotSignInYetOnAPersonsLink(provider, ipRefusal), register) });
  }
  const unreachable = unreachableCallbackRefusal(redirectUri, process.env.WEB_URL);
  if (unreachable) {
    return void res.status(409).json({
      error: 'unreachable_callback',
      ...reasonPair(cannotSignInYetOnAPersonsLink(provider, unreachable), register),
    });
  }

  const locale = localeOf((req.body as { locale?: unknown } | undefined)?.locale);
  const state = consentFlows.begin({
    clientId: client.clientId,
    clientSecret: client.clientSecret,
    scope: account.ask.scope,
    redirectUri,
    // Absent is Google, as every state begun before the seam (0171).
    ...(provider === 'microsoft' || provider === 'dropbox' ? { provider } : {}),
    ...(client.tenant === undefined ? {} : { tenant: client.tenant }),
    personLink: {
      linkId: link.linkId,
      tenantId: link.tenantId,
      personId: link.personId,
      account: account.account,
      mappingIds: account.migrations.map((m) => m.mappingId),
      ...grantPageBack(req),
      register,
    },
    locale,
  });
  const begin = GRANT_PROVIDERS[provider]?.consentUrl;
  if (!begin) return void res.status(409).json({ error: 'not_this_provider', ...reasonPair(NOT_THIS_PROVIDER, register) });
  res.json({
    url: begin({
      account: account.account,
      state,
      redirectUri,
      locale,
      client,
      scope: account.ask.scope,
      domains: account.ask.domains,
    }),
  });
}

/**
 * A destination's sign-in on a person's link (workplan 0174 §4.4, T5): Cirrux
 * Drive, today the one. The card is named by its `ref` (an address names no
 * Cirrux sign-in: Cirrux vouches for none), and it is on the page only once
 * the account's app password is stored (`readPersonGrantSubject`). The
 * consent is the owner's Cirrux consent, PKCE and all, through the
 * deployment's public client; its pending state holds the person's link and
 * the account, so the one callback Cirrux registered ends it as the link's.
 */
async function authorizeTargetForAPerson(
  req: PersonLinkRequest,
  res: Response,
  link: PersonLink,
  provider: GrantProviderId,
  subject: PersonGrantSubject,
  register: Register,
): Promise<void> {
  const ref = (req.body as { ref?: unknown } | undefined)?.ref;
  const account =
    typeof ref === 'string'
      ? subject.accounts.find((a) => a.ref === ref && a.role === 'target' && a.way === 'sign-in' && a.provider === provider)
      : undefined;
  if (!account) return void res.status(409).json({ error: 'not_this_account', ...reasonPair(NOT_THIS_ACCOUNT, register) });
  if (account.granted && !asksAgainFor(link, account)) {
    return void res.status(409).json({ error: 'already_granted', ...reasonPair(ALREADY_GRANTED, register) });
  }
  if (!account.ask.ok) return void res.status(409).json({ error: 'not_ready', ...reasonPair(account.ask.reason, register) });
  const client = provider === 'cirrux' ? cirruxDeploymentClient() : null;
  const begin = GRANT_PROVIDERS[provider]?.consentUrl;
  const connectionId = account.ask.way === 'sign-in' ? account.ask.connectionId : undefined;
  if (!client || !begin || !connectionId) {
    return void res.status(409).json({
      error: 'not_ready',
      ...reasonPair(accountNotReady(FOR_THE_LINK_HOLDER.client_not_configured), register),
    });
  }
  const redirectUri = callbackFor(req, provider);
  const ipRefusal = rawIpCallbackRefusal(redirectUri);
  if (ipRefusal) {
    return void res.status(409).json({ error: 'raw_ip_callback', ...reasonPair(cannotSignInYetOnAPersonsLink(provider, ipRefusal), register) });
  }
  const unreachable = unreachableCallbackRefusal(redirectUri, process.env.WEB_URL);
  if (unreachable) {
    return void res.status(409).json({
      error: 'unreachable_callback',
      ...reasonPair(cannotSignInYetOnAPersonsLink(provider, unreachable), register),
    });
  }
  const locale = localeOf((req.body as { locale?: unknown } | undefined)?.locale);
  const { verifier, challenge } = pkcePair();
  const state = consentFlows.begin({
    clientId: client.clientId,
    // A public client: there is no secret, and nothing stands in for one.
    clientSecret: '',
    scope: CIRRUX_DRIVE_SCOPES.join(' '),
    redirectUri,
    provider: 'cirrux',
    locale,
    cirrux: { verifier, tenantId: link.tenantId, connectionId, actor: GRANT_ACTOR, ref: account.ref },
    personLink: {
      linkId: link.linkId,
      tenantId: link.tenantId,
      personId: link.personId,
      account: account.account,
      mappingIds: account.migrations.map((m) => m.mappingId),
      register,
    },
  });
  res.json({
    url: begin({
      account: account.account,
      state,
      redirectUri,
      locale,
      client: { clientId: client.clientId, clientSecret: '' },
      scope: CIRRUX_DRIVE_SCOPES.join(' '),
      domains: account.ask.domains,
      challenge,
    }),
  });
}

/**
 * GET /api/grant/:link — what this page must be able to say before the button.
 *
 * Deliberately a GET that changes nothing. Chat applications fetch URLs to draw
 * previews, and 0108 T1 made single-use spend at the GRANT rather than at the
 * open precisely so this cannot burn a link. Opening is repeatable right up
 * until somebody actually grants.
 */
router.get(
  '/:link',
  linkAuth,
  async (req: MappingLinkRequest, res: Response) => {
    try {
      const person = (req as PersonLinkRequest).personLink;
      if (person) return void (await answerForAPerson(res, person));
      const { linkId, tenantId, mappingId, expiresAt } = req.mappingLink!;
      // The organisation that sent the link was closed (0085 T2): nobody is
      // asked to grant it anything, and the page says why in its language.
      if (await refusedAsClosed(res, tenantId, pool())) return;
      const loaded = await loadSubject(tenantId, mappingId);
      if (!loaded.ok) return void res.status(409).json({ error: 'not_ready', ...reasonPair(loaded.reason) });
      const { askedBy, checkedCompany } = await withTenantDb(tenantId, pool(), async (db) => ({
        askedBy: await readAskedBy(db, tenantId, linkId),
        checkedCompany: await readCheckedCompany(db, tenantId),
      }));
      res.json({
        organisation: loaded.subject.organisation,
        // The name the EU VAT register gave, when the organisation's VAT number
        // was checked and found valid (0108 T8a, the owner's decision of
        // 2026-09-23). Unlike `organisation`, nobody chose it for this page.
        checkedCompany,
        // Who asked (0108 T8a): the issuing member's sign-in address, and a
        // number to call when the organisation gave one — optional, by the
        // owner's decision of 2026-09-23.
        askedBy,
        organisationPhone: loaded.subject.organisationPhone,
        // Which data types, never a sentence: the page says them in the
        // reader's language (workplan 0145 T6).
        domains: loaded.subject.domains,
        // The scope in Google's own words, beside the plain sentence rather
        // than behind it: a person consenting is entitled to the exact string
        // their account will record (ADR-0041).
        scope: loaded.subject.scope,
        // Whether every data scope this link asks for is read-only by
        // Google's own rule (0144 T3 (c)). The page says "read-only" only
        // then; otherwise it says Ownpace only reads, and that Google
        // describes the permission more broadly, which Google's screen will do
        // one click later. What Google finally records can be broader
        // (`include_granted_scopes`); the ending judges that.
        readOnlyAtProvider: loaded.subject.readOnlyAtProvider,
        // Whose sign-in the button opens (workplan 0171 §3.2): the page words
        // its button and checks the address it follows by it.
        provider: loaded.subject.provider,
        // Where from and where to (0108 T8a): the account this migration
        // reads, and the server and account it writes. What the person
        // needs in order to tell their own migration from somebody else's.
        from: loaded.subject.from,
        to: loaded.subject.to,
        expiresAt: expiresAt.toISOString(),
      });
    } catch (error) {
      serverFault(res, 'grant_read_failed', 'reading this migration', error);
    }
  },
);

/**
 * POST /api/grant/:link/:provider/authorize — where the button goes
 * (workplan 0171 §3.2: `/:link/google/authorize` until alpha.20, and still
 * answered at that address, now as one provider of several).
 *
 * Answers with a URL for the browser to follow rather than redirecting, so the
 * page can show what happened if this refuses — a 302 into a provider's error
 * is exactly the dead end this whole task exists to remove. The provider in
 * the address must be the one the link asks for: a page cannot send a
 * Microsoft migration's link to Google's screen, or the other way round.
 */
router.post(
  '/:link/:provider/authorize',
  linkAuth,
  async (req: MappingLinkRequest, res: Response) => {
    const provider = req.params.provider;
    // An address this router has no door at: as if it did not exist.
    if (!isGrantProviderId(provider) || GRANT_PROVIDERS[provider]?.consentUrl === undefined) {
      return void res.status(404).json({ error: 'not_found' });
    }
    try {
      const person = (req as PersonLinkRequest).personLink;
      if (person) return void (await authorizeForAPerson(req, res, person, provider));
      const { linkId, tenantId, mappingId } = req.mappingLink!;
      // No consent begins for a closed organisation (0085 T2): nothing would
      // be allowed to use what it granted.
      if (await refusedAsClosed(res, tenantId, pool())) return;
      const loaded = await loadSubject(tenantId, mappingId);
      if (!loaded.ok) return void res.status(409).json({ error: 'not_ready', ...reasonPair(loaded.reason) });
      if (loaded.subject.provider !== provider) {
        return void res.status(409).json({ error: 'not_this_provider', ...reasonPair(NOT_THIS_PROVIDER) });
      }

      const redirectUri = callbackFor(req, provider);
      const ipRefusal = rawIpCallbackRefusal(redirectUri);
      if (ipRefusal) {
        // 0089 T6's refusal, reached by a person who cannot act on it — so it
        // is wrapped rather than repeated raw. The detail stays, because the
        // owner will need it when this gets forwarded to them.
        return void res.status(409).json({
          error: 'raw_ip_callback',
          ...reasonPair(cannotSignInYet(ipRefusal)),
        });
      }
      // The same wrapping for the loopback split (2026-09-01). The migrator can
      // act on this even less than on the raw-IP one — it is an `.env` value on
      // somebody else's box — so it travels the same way: their sentence,
      // addressed to the person who can fix it.
      const unreachable = unreachableCallbackRefusal(redirectUri, process.env.WEB_URL);
      if (unreachable) {
        return void res.status(409).json({
          error: 'unreachable_callback',
          ...reasonPair(cannotSignInYet(unreachable)),
        });
      }

      const locale = localeOf((req.body as { locale?: unknown } | undefined)?.locale);
      const client = loaded.subject.client;
      const state = consentFlows.begin({
        clientId: client.clientId,
        clientSecret: client.clientSecret,
        scope: loaded.subject.scope,
        redirectUri,
        // Whose callback ends it; absent is Google, as before the seam (0171).
        ...(provider === 'microsoft' || provider === 'dropbox' ? { provider } : {}),
        // Microsoft's directory, so the code is exchanged where it was asked.
        ...(client.tenant === undefined ? {} : { tenant: client.tenant }),
        // What makes this the LINK ending at the callback. Recorded server-side
        // on the pending state, never round-tripped through the browser.
        link: { linkId, mappingId, tenantId },
        // The language the page was in, so the ending is in it too (workplan
        // 0145 T6). Beside the link and for the same reason: a redirect is the
        // browser's to change. Anything but `nl`, or nothing, is English.
        locale,
      });

      res.json({
        // The provider offers the named account first. Only a convenience:
        // the callback refuses any other account that signs in (T8 (b)).
        url: GRANT_PROVIDERS[provider]!.consentUrl!({
          account: loaded.subject.from,
          state,
          redirectUri,
          locale,
          client,
          scope: loaded.subject.scope,
          domains: loaded.subject.domains,
        }),
      });
    } catch (error) {
      serverFault(res, 'grant_authorize_failed', `starting the ${provider} sign-in`, error);
    }
  },
);

/**
 * PUT /api/grant/:link/address-changes/:ref — the person's answer to *Your new
 * address: ‹address›. Is that right?* (workplan 0168 §4.4, D6): `{ state,
 * newAddress }`, the answer and the address the page showed, and nothing else,
 * for a row linked to them. `link-address-changes.ts`.
 */
router.put('/:link/address-changes/:ref', linkAuth, answerAddressChangeThroughLink('grant', pool));

/**
 * PUT /api/grant/:link/password — a password the person types for one card
 * of their link, tested as the create door tests it and stored only when it
 * works (workplan 0174 §5.3, T3): `grant-password.ts`. The caller's limit
 * comes before the link is read.
 */
router.put('/:link/password', passwordLimit(passwordLimiter()), linkAuth, passwordThroughLink(pool));

export default router;
