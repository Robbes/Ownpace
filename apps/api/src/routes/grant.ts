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
 * scope** in Google's own words, **until when** the link works, and — since
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
 * ## The other direction of the same warning
 *
 * `routes/invitations.ts` carries the long version: an invitation is an offer
 * to JOIN, authorised by a verified email claim and carrying no token at all,
 * while this is a bearer credential for somebody who will never have an
 * account. They are opposite mechanisms that both look like "a stranger
 * arrives with something in a URL", and unifying them would give one of the
 * two the wrong half of the other's machinery.
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
import { googleDeploymentClient, type DiscoveryDomain } from '@openmig/shared';
import { authenticateMappingLink, getDbPool, withTenantDb } from '../middleware/auth.ts';
import type { MappingLinkRequest } from '../types/api.ts';
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
  readGrantRows,
  storedCredentials,
  whereFromAndTo,
  type WhereFromAndTo,
} from './migrations/grant-subject.ts';

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
  authenticateMappingLink('grant', pool())(req, res, next);

/**
 * What each data type reads, in the words a person would use about their own
 * account — beside the scope, never instead of it (ADR-0041's operative rule:
 * the scopes are shown AS scopes). Keyed by data type since a Google ACCOUNT
 * link can ask for several (0108 T7).
 */
const READS: Readonly<Record<DiscoveryDomain, string>> = {
  email: 'your email — messages, folders and labels',
  calendar: 'your calendars and their events',
  contact: 'your contacts',
  file: 'your files in Google Drive',
  task: 'your tasks',
};

/** `a`, `a and b`, `a, b and c`: a list as a sentence says it. */
function listed(items: ReadonlyArray<string>): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

interface GrantSubject extends WhereFromAndTo {
  readonly organisation: string;
  readonly reads: string;
  readonly scope: string;
  readonly clientId: string;
  readonly clientSecret: string;
}

/**
 * Each refusal `grantLinkAsk` can give, as the link holder should hear it. The
 * owner was told the remedy when issuing; this reader cannot act on any of
 * them, so each says only what is wrong, and `notReady` says whom to tell.
 */
const FOR_THE_LINK_HOLDER: Readonly<Record<GrantLinkAskRefusalCode, string>> = {
  no_source_connection: 'it no longer exists',
  source_not_google: 'it does not connect to a Google account',
  no_target: 'it has no destination to copy to',
  nothing_to_ask: 'it has nothing to copy at the moment',
  client_not_configured: 'its Google application is not set up yet',
  restricted_scope: 'its Google application may not ask for mail or files',
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
): Promise<{ ok: true; subject: GrantSubject } | { ok: false; reason: string }> {
  const rows = await withTenantDb(tenantId, pool(), (db) => readGrantRows(db, tenantId, mappingId));
  // Every one of these is somebody else's mistake, so the sentence is written
  // to be forwarded: it tells the reader what to say to the person who sent
  // them here, rather than what to fix themselves.
  const notReady = (what: string) => ({
    ok: false as const,
    reason:
      `This migration is not ready to be connected — ${what}. Nothing you can do from here ` +
      'will fix that; please tell the person who sent you the link.',
  });
  if (!rows) return notReady(FOR_THE_LINK_HOLDER.no_source_connection);

  const decided = grantLinkAsk(grantReadiness(rows));
  if (!decided.ok) return notReady(FOR_THE_LINK_HOLDER[decided.refusal.code]);
  const where = whereFromAndTo(rows);
  if (!where) return notReady(FOR_THE_LINK_HOLDER.no_target);

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
      reads: listed(decided.ask.domains.map((d) => READS[d])),
      scope: decided.ask.scope,
      from: where.from,
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
      const { linkId, tenantId, mappingId, expiresAt } = req.mappingLink!;
      const loaded = await loadSubject(tenantId, mappingId);
      if (!loaded.ok) return void res.status(409).json({ error: 'not_ready', reason: loaded.reason });
      const askedBy = await withTenantDb(tenantId, pool(), (db) => readAskedBy(db, tenantId, linkId));
      res.json({
        organisation: loaded.subject.organisation,
        // Who asked (0108 T8a): the issuing member's sign-in address.
        askedBy,
        reads: loaded.subject.reads,
        // The scope in Google's own words, beside the plain sentence rather
        // than behind it: a person consenting is entitled to the exact string
        // their account will record (ADR-0041).
        scope: loaded.subject.scope,
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
      const { linkId, tenantId, mappingId } = req.mappingLink!;
      const loaded = await loadSubject(tenantId, mappingId);
      if (!loaded.ok) return void res.status(409).json({ error: 'not_ready', reason: loaded.reason });

      const redirectUri = callbackUri(req);
      const ipRefusal = rawIpCallbackRefusal(redirectUri);
      if (ipRefusal) {
        // 0089 T6's refusal, reached by a person who cannot act on it — so it
        // is wrapped rather than repeated raw. The detail stays, because the
        // owner will need it when this gets forwarded to them.
        return void res.status(409).json({
          error: 'raw_ip_callback',
          reason:
            'This migration cannot use a Google sign-in yet, because of how the server is ' +
            `reached. Please forward this to the person who sent you the link: ${ipRefusal}`,
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
          reason:
            'This migration cannot use a Google sign-in yet, because of how the server is ' +
            `reached. Please forward this to the person who sent you the link: ${unreachable}`,
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
      });

      res.json({
        url: consentUrl({
          clientId: loaded.subject.clientId,
          scope: loaded.subject.scope,
          redirectUri,
          state,
        }),
      });
    } catch (error) {
      serverFault(res, 'grant_authorize_failed', 'starting the Google sign-in', error);
    }
  },
);

export default router;
