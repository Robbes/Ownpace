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
 * `POST /api/grant/:link/google/authorize` reads the client id and secret out
 * of the mapping's own source connection and decrypts them here — or, where
 * the connection stores none, takes the deployment's (0108 T6). 0089 T1's
 * owner beginning takes them from the request body, because the owner is the
 * person typing them in; this beginning must not, because the link holder is
 * not that person and must never hold that secret. The consent URL carries the
 * client id (Google requires it and it is not a secret); the secret goes only
 * into the token-exchange POST body, in the callback, in this process.
 */

import { Router } from 'express';
import type { RequestHandler, Response } from 'express';
import {
  NOT_READY_BECAUSE,
  cannotSignInYet,
  googleDeploymentClient,
  localeOf,
  notReady as notReadyBecause,
  reasonPair,
  type Bilingual,
  type DiscoveryDomain,
} from '@openmig/shared';
import { authenticateGrantLink, getDbPool, withTenantDb } from '../middleware/auth.ts';
import { refusedAsClosed } from '../closed-organisation.ts';
import type { MappingLinkRequest, PersonLinkRequest } from '../types/api.ts';
import { serverFault } from '../server-fault.ts';
import {
  consentUrl,
  rawIpCallbackRefusal,
  unreachableCallbackRefusal,
} from './migrations/google-consent.ts';
import { consentFlows } from './migrations/consent-flows.ts';
import { grantLinkAsk, type GrantLinkAskRefusalCode } from './migrations/grant-link-readiness.ts';
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
  readPersonLinkAskedBy,
  type PersonGrantSubject,
} from './migrations/person-grant-subject.ts';
import { sameGoogleAccount } from './migrations/signed-in-account.ts';

const router = Router();

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
 * This reader can act on none of them, so it says whom to tell.
 */
const NOTHING_TO_GRANT: Bilingual = {
  en:
    'None of the migrations this link is for can be connected through it yet. Nothing you can do ' +
    'from here will fix that; please tell the person who sent you the link.',
  nl:
    'Geen van de migraties waarvoor deze link is, kan er al mee worden verbonden. U kunt dat vanaf ' +
    'hier niet oplossen; laat het de persoon weten die u de link stuurde.',
};

/** When the button named an account this person's link does not ask for. */
const NOT_THIS_ACCOUNT: Bilingual = {
  en: 'This link does not ask for that account. Open the link again and choose an account it lists.',
  nl: 'Deze link vraagt niet om dat account. Open de link opnieuw en kies een account dat erop staat.',
};

/** When the account the button named is already connected. */
const ALREADY_GRANTED: Bilingual = {
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
  readonly clientId: string;
  readonly clientSecret: string;
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
  if (!decided.ok) return notReady(FOR_THE_LINK_HOLDER[decided.refusal.code]);
  const where = whereFromAndTo(rows);
  if (!where) return notReady(FOR_THE_LINK_HOLDER.no_target);
  // The decision already refused a migration that names no account; this is
  // the same fact, read where the type can see it.
  if (where.from === null) return notReady(FOR_THE_LINK_HOLDER.no_named_account);
  const from = where.from;

  // WHOSE client, as decided — the values read only now, and only the pair
  // the decision named. The deployment's is read from the environment here
  // rather than handed over by the decision, which takes booleans and nothing
  // else (see `grant-link-readiness.ts`).
  let client: { clientId: string; clientSecret: string } | null;
  if (decided.ask.client === 'connection') {
    const creds = storedCredentials(rows.source.secretRef);
    client = { clientId: credential(creds, 'clientId'), clientSecret: credential(creds, 'clientSecret') };
  } else {
    client = googleDeploymentClient();
  }
  if (!client) return notReady(FOR_THE_LINK_HOLDER.client_not_configured);

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
      clientId: client.clientId,
      clientSecret: client.clientSecret,
    },
  };
}

/** The address Google must redirect to — the SAME one the owner registered. */
function callbackUri(req: MappingLinkRequest): string {
  const base = (process.env.API_URL ?? `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
  return `${base}/api/migrations/google/callback`;
}

type PersonLink = NonNullable<PersonLinkRequest['personLink']>;

/** A person's migrations, grouped by account, read in their organisation's transaction. */
function readPersonSubject(link: PersonLink): Promise<PersonGrantSubject | null> {
  return withTenantDb(link.tenantId, pool(), (db) => readPersonGrantSubject(db, link.tenantId, link.personId));
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
  const subject = await readPersonSubject(link);
  if (!subject) return void res.status(409).json({ error: 'not_ready', ...reasonPair(NOTHING_TO_GRANT) });
  const { askedBy, checkedCompany } = await withTenantDb(link.tenantId, pool(), async (db) => ({
    askedBy: await readPersonLinkAskedBy(db, link.tenantId, link.linkId),
    checkedCompany: await readCheckedCompany(db, link.tenantId),
  }));
  res.json({
    kind: 'person',
    organisation: subject.organisation,
    checkedCompany,
    askedBy,
    organisationPhone: subject.organisationPhone,
    accounts: subject.accounts.map((a) => ({
      account: a.account,
      granted: a.granted,
      // What it will read and in which words, when one sign-in can serve it;
      // otherwise why not, in both languages, for the person to forward.
      ...(a.ask.ok
        ? { domains: a.ask.domains, scope: a.ask.scope, readOnlyAtProvider: a.ask.readOnlyAtProvider, notReady: null }
        : { domains: [], scope: null, readOnlyAtProvider: false, notReady: reasonPair(a.ask.reason) }),
      migrations: a.migrations.map((m) => ({ domains: m.domains, to: m.to, granted: m.granted })),
    })),
    expiresAt: link.expiresAt.toISOString(),
  });
}

/**
 * POST authorize for a PERSON'S link: the account the button named, asked for
 * everything its listed migrations need, through the one client they share.
 * The pending state records the account and those migrations, so the ending
 * grants exactly what the page showed and keeps only that account's sign-in.
 */
async function authorizeForAPerson(req: PersonLinkRequest, res: Response, link: PersonLink): Promise<void> {
  if (await refusedAsClosed(res, link.tenantId, pool())) return;
  const asked = (req.body as { account?: unknown } | undefined)?.account;
  const subject = await readPersonSubject(link);
  if (!subject) return void res.status(409).json({ error: 'not_ready', ...reasonPair(NOTHING_TO_GRANT) });
  const account =
    typeof asked === 'string' ? subject.accounts.find((a) => sameGoogleAccount(a.account, asked)) : undefined;
  if (!account) return void res.status(409).json({ error: 'not_this_account', ...reasonPair(NOT_THIS_ACCOUNT) });
  if (account.granted) return void res.status(409).json({ error: 'already_granted', ...reasonPair(ALREADY_GRANTED) });
  if (!account.ask.ok) {
    return void res.status(409).json({ error: 'not_ready', ...reasonPair(account.ask.reason) });
  }

  // WHOSE client, as decided, the values read only now.
  let client: { clientId: string; clientSecret: string } | null;
  if (account.ask.client === 'connection') {
    const creds = storedCredentials(account.ask.connectionSecretRef);
    const clientId = credential(creds, 'clientId');
    const clientSecret = credential(creds, 'clientSecret');
    client = clientId && clientSecret ? { clientId, clientSecret } : null;
  } else {
    client = googleDeploymentClient();
  }
  if (!client) {
    return void res
      .status(409)
      .json({ error: 'not_ready', ...reasonPair(notReadyBecause(FOR_THE_LINK_HOLDER.client_not_configured)) });
  }

  const redirectUri = callbackUri(req);
  const ipRefusal = rawIpCallbackRefusal(redirectUri);
  if (ipRefusal) return void res.status(409).json({ error: 'raw_ip_callback', ...reasonPair(cannotSignInYet(ipRefusal)) });
  const unreachable = unreachableCallbackRefusal(redirectUri, process.env.WEB_URL);
  if (unreachable) {
    return void res.status(409).json({ error: 'unreachable_callback', ...reasonPair(cannotSignInYet(unreachable)) });
  }

  const state = consentFlows.begin({
    clientId: client.clientId,
    clientSecret: client.clientSecret,
    scope: account.ask.scope,
    redirectUri,
    personLink: {
      linkId: link.linkId,
      tenantId: link.tenantId,
      personId: link.personId,
      account: account.account,
      mappingIds: account.migrations.map((m) => m.mappingId),
    },
    locale: localeOf((req.body as { locale?: unknown } | undefined)?.locale),
  });
  res.json({
    url: consentUrl({ clientId: client.clientId, scope: account.ask.scope, redirectUri, state, loginHint: account.account }),
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
 * POST /api/grant/:link/google/authorize — where the button goes.
 *
 * Answers with a URL for the browser to follow rather than redirecting, so the
 * page can show what happened if this refuses — a 302 into a Google error is
 * exactly the dead end this whole task exists to remove.
 */
router.post(
  '/:link/google/authorize',
  linkAuth,
  async (req: MappingLinkRequest, res: Response) => {
    try {
      const person = (req as PersonLinkRequest).personLink;
      if (person) return void (await authorizeForAPerson(req, res, person));
      const { linkId, tenantId, mappingId } = req.mappingLink!;
      // No consent begins for a closed organisation (0085 T2): nothing would
      // be allowed to use what it granted.
      if (await refusedAsClosed(res, tenantId, pool())) return;
      const loaded = await loadSubject(tenantId, mappingId);
      if (!loaded.ok) return void res.status(409).json({ error: 'not_ready', ...reasonPair(loaded.reason) });

      const redirectUri = callbackUri(req);
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

      const state = consentFlows.begin({
        clientId: loaded.subject.clientId,
        clientSecret: loaded.subject.clientSecret,
        scope: loaded.subject.scope,
        redirectUri,
        // What makes this the LINK ending at the callback. Recorded server-side
        // on the pending state, never round-tripped through the browser.
        link: { linkId, mappingId, tenantId },
        // The language the page was in, so the ending is in it too (workplan
        // 0145 T6). Beside the link and for the same reason: a redirect is the
        // browser's to change. Anything but `nl`, or nothing, is English.
        locale: localeOf((req.body as { locale?: unknown } | undefined)?.locale),
      });

      res.json({
        url: consentUrl({
          clientId: loaded.subject.clientId,
          scope: loaded.subject.scope,
          redirectUri,
          state,
          // Google offers the named account first. Only a convenience: the
          // callback refuses any other account that signs in (T8 (b)).
          loginHint: loaded.subject.from,
        }),
      });
    } catch (error) {
      serverFault(res, 'grant_authorize_failed', 'starting the Google sign-in', error);
    }
  },
);

export default router;
