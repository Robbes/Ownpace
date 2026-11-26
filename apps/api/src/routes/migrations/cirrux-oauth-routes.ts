// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * CONNECT CIRRUX DRIVE (workplan 0160 T5; ADR-0052): the two routes of the
 * Dropbox and Google consents, for Cirrux, ending in the database rather than
 * in a browser.
 *
 * `POST /cirrux/authorize` is authenticated. It names the Cirrux ACCOUNT the
 * Drive is for (a `cirrux` destination of this organisation), refuses a
 * deployment that has no Cirrux client with the sentence the Accounts page
 * shows, makes a PKCE pair, and begins a signed, single-use, ten-minute state
 * in the ONE consent store, holding the verifier and the account. The answer
 * is Cirrux's consent URL and the exact callback Cirrux must have registered.
 *
 * `GET /cirrux/callback` is public by nature and trusted by nothing but that
 * state. It refuses an `iss` that is not Cirrux's, exchanges the code with the
 * verifier, and STORES THE REFRESH TOKEN ON THE ACCOUNT under the row's lock
 * (`storeCirruxDriveGrant`), beside the app password: it rotates on every
 * refresh and is the account's, so it is never handed to the page. It then
 * measures the account again, so the Accounts page and *Where does it go?* see
 * the Drive connected, and tells the opening window only that.
 *
 * `POST /cirrux/disconnect` is authenticated, and ends what the callback
 * stored (workplan 0160): it removes the Drive grant from the account's
 * record under the row's lock and nothing else, so the app password keeps
 * serving mail, calendars, contacts and tasks. The record's file face reads
 * not connected and the audit line `connection.cirrux_drive_disconnected` is
 * written in the same transaction; this process's access tokens for the
 * account are dropped once it commits. Cirrux documents no revocation an app
 * can call, so nothing is asked of Cirrux, and the answer says so, with where
 * the person ends the sign-in at Cirrux. An account with no grant answers 200,
 * `removed: false`. A closed organisation is not refused: ending access stays
 * open after a close, as withdrawing a grant does (`withdraw-grant.ts`).
 */

import { Router } from 'express';
import { idsThatAreNoUuid } from '../../an-id-that-is-no-uuid.ts';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import * as schema from '@openmig/ledger';
import { PgLedger } from '@openmig/ledger';
import { readOrganisationClosure, rotationRefusal } from '@openmig/managed';
import { authenticate, getDbPool, withTenantDb } from '../../middleware/auth.ts';
import type { AuthenticatedRequest } from '../../types/api.ts';
import {
  CIRRUX_DRIVE_SCOPES,
  cirruxDeploymentClient,
  cirruxDriveDisconnectRevocation,
  inLocale,
  localeOf,
  log,
  organisationClosedRefusal,
  type Bilingual,
  type RevocationOutcome,
  type TenantId,
} from '@openmig/shared';
import { forgetCirruxAccess } from '@openmig/connectors';
import { qualifyCirruxDrive } from '@openmig/orchestration/account-qualification';
import {
  removeCirruxDriveGrant,
  storeCirruxDriveGrant,
  type CirruxGrantStored,
} from '@openmig/orchestration/cirrux-grant-store';
import {
  CONSENT_NOT_AWAITED,
  browserLocale,
  callbackPageHeaders,
  rawIpCallbackRefusal,
  unreachableCallbackRefusal,
} from './google-consent.ts';
import { consentFlows as flows } from './consent-flows.ts';
import { grantResultPage } from './google-consent.ts';
import { decideCirruxLinkEnding, storePersonDriveGrant } from './cirrux-link-ending.ts';
import { GRANT_ACTOR } from './grant-ending.ts';
import { startWhenGranted } from './start-when-granted.ts';
import { GRANT_PROVIDERS } from '../grant-providers.ts';
import {
  ANOTHER_CIRRUX_WORKSPACE,
  CIRRUX_CONSENT_FOR_THE_OWNER,
  CIRRUX_DRIVE_CONNECTED_ACTION,
  CIRRUX_DRIVE_DISCONNECTED_ACTION,
  cirruxConsentUrl,
  cirruxResultPage,
  cirruxSignedInAs,
  exchangeCirruxCode,
  issuerIsCirrux,
  pkcePair,
} from './cirrux-consent.ts';
import { closedOrganisation, refusedAsClosed } from '../../closed-organisation.ts';
import { refusedUntilAccepted } from '../../conditions-not-accepted.ts';
import { serverFault } from '../../server-fault.ts';
import { requalifyStoredConnection } from '../qualify-and-remember.ts';

const router = idsThatAreNoUuid(Router());

/** The sentence for a deployment with no Cirrux client: the Drive face's own. */
export const NO_CIRRUX_CLIENT =
  'This deployment has no Cirrux client yet, so Cirrux Drive cannot be connected from it: Cirrux ' +
  'registers each client by hand, with the deployment’s exact callback address. Set ' +
  'CIRRUX_OAUTH_CLIENT_ID once Cirrux has sent it, and restart the API.';

const AuthorizeSchema = z.object({
  connectionId: z.string().uuid(),
  locale: z.unknown().optional(),
});

const DisconnectSchema = z.object({ connectionId: z.string().uuid() });

/** The answer to *Disconnect Cirrux Drive*: whether a sign-in was removed here, and what happened at Cirrux. */
export interface CirruxDriveDisconnected {
  readonly connectionId: string;
  readonly removed: boolean;
  readonly revocation: RevocationOutcome;
}

/** Built from `API_URL`, the way `redirectUris` lists it, so the two cannot differ. */
function callbackUri(req: Request): string {
  const base = (process.env.API_URL ?? `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
  return `${base}/api/migrations/cirrux/callback`;
}

function webOrigin(): string | undefined {
  const raw = process.env.WEB_URL;
  if (!raw) return undefined;
  try {
    return new URL(raw).origin;
  } catch {
    return undefined;
  }
}

let _pool: ReturnType<typeof getDbPool> | null = null;
function pool(): ReturnType<typeof getDbPool> {
  if (!_pool) _pool = getDbPool();
  return _pool;
}

router.post('/cirrux/authorize', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  if (!req.tenantId) return void res.status(401).json({ error: 'Unauthorized', message: 'Tenant ID not found' });
  const tenantId = req.tenantId;
  const parsed = AuthorizeSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return void res.status(400).json({ error: 'invalid_body', reason: 'Send { connectionId }: the Cirrux account to connect Drive on.' });
  }
  const client = cirruxDeploymentClient();
  if (!client) return void res.status(400).json({ error: 'no_cirrux_client', reason: NO_CIRRUX_CLIENT });
  const { connectionId } = parsed.data;
  const found = await withTenantDb(tenantId, pool(), (db) =>
    db
      .select({ kind: schema.connection.kind, role: schema.connection.role })
      .from(schema.connection)
      .where(and(eq(schema.connection.id, connectionId), eq(schema.connection.tenantId, tenantId))),
  );
  if (found[0]?.kind !== 'cirrux' || found[0].role !== 'target') {
    return void res.status(404).json({
      error: 'not_a_cirrux_account',
      reason: 'No Cirrux destination with that id is on your Accounts page, so no Drive can be connected on it.',
    });
  }
  // A Drive a person connected themselves, on an account they connected
  // through their grant link, is theirs to change (workplan 0174 §4.3, D6).
  const theirs = await withTenantDb(tenantId, pool(), (db) => rotationRefusal(db, tenantId, connectionId));
  if (theirs) {
    return void res.status(409).json({ error: 'connected_by_the_person', reason: theirs.en, reasonNl: theirs.nl });
  }
  // New access, so the doors every consent passes: a closed organisation takes
  // none (0085 T2), nor anybody who has not accepted the current texts (0139 T3).
  if (await refusedAsClosed(res, tenantId, pool())) return;
  if (await refusedUntilAccepted(res, tenantId, req.userId, pool())) return;
  const redirectUri = callbackUri(req);
  const ipRefusal = rawIpCallbackRefusal(redirectUri);
  if (ipRefusal) return void res.status(400).json({ error: 'raw_ip_callback', reason: ipRefusal });
  const unreachable = unreachableCallbackRefusal(redirectUri, process.env.WEB_URL);
  if (unreachable) return void res.status(400).json({ error: 'unreachable_callback', reason: unreachable });

  const { verifier, challenge } = pkcePair();
  const state = flows.begin({
    clientId: client.clientId,
    // A public client: there is no secret, and nothing stands in for one.
    clientSecret: '',
    scope: CIRRUX_DRIVE_SCOPES.join(' '),
    redirectUri,
    provider: 'cirrux',
    locale: localeOf((req.body as { locale?: unknown } | undefined)?.locale),
    cirrux: { verifier, tenantId, connectionId, actor: req.userId ?? 'unknown' },
  });
  res.json({ url: cirruxConsentUrl({ clientId: client.clientId, redirectUri, state, challenge }), redirectUri });
});

router.get('/cirrux/callback', async (req: Request, res: Response) => {
  const page = (status: number, html: string) =>
    void res.status(status).set({ 'Content-Type': 'text/html; charset=utf-8', ...callbackPageHeaders(html) }).send(html);
  let locale = browserLocale(req);
  const refuse = (status: number, reason: Bilingual) =>
    page(status, cirruxResultPage({ outcome: { ok: false, reason: inLocale(reason, locale) }, locale }));

  const state = typeof req.query.state === 'string' ? req.query.state : '';
  const taken = state ? flows.take(state) : undefined;
  const pending = taken && taken.provider === 'cirrux' && taken.cirrux ? taken : undefined;
  if (!pending?.cirrux) return refuse(400, CONSENT_NOT_AWAITED);
  locale = localeOf(pending.locale);
  const { verifier, tenantId, connectionId } = pending.cirrux;

  // A person's grant link began it (workplan 0174 §4.4, T5): their own
  // destination's Drive, bound by the workspace, in the link's own ending.
  if (pending.personLink) {
    // How the person's pages speak to them (workplan 0176 T7): their ending says it.
    const register = pending.personLink.register;
    const iss = typeof req.query.iss === 'string' ? req.query.iss : undefined;
    if (!issuerIsCirrux(iss)) {
      log.warn(`[api] a grant link's Cirrux callback named another issuer (${String(iss).slice(0, 120)}); nothing was exchanged`);
      return page(
        400,
        grantResultPage({ ok: false, reason: inLocale(CIRRUX_CONSENT_FOR_THE_OWNER.wrongIssuer, locale, register), link: 'unused' }, locale, register),
      );
    }
    const finish = GRANT_PROVIDERS.cirrux?.finish;
    const decided = await decideCirruxLinkEnding(
      {
        clientId: pending.clientId,
        redirectUri: pending.redirectUri,
        verifier,
        personLink: { ...pending.personLink, connectionId, ref: pending.cirrux.ref ?? '' },
      },
      { error: req.query.error, code: req.query.code },
      {
        closedOrganisation: (t) => closedOrganisation(t, pool()),
        finish: (code, redirectUri, client, v) => {
          if (!finish) throw new Error('the Cirrux grant provider has no ending');
          return finish(code, redirectUri, client, v);
        },
        store: (target, secret) => storePersonDriveGrant(pool(), target, secret),
        after: async (target, granted, access) => {
          await startWhenGranted(pool(), { tenantId: target.tenantId, mappingIds: granted });
          try {
            await requalifyStoredConnection(target.tenantId, target.connectionId, GRANT_ACTOR, access);
          } catch (err) {
            log.warn(
              `[api] Cirrux Drive is connected on ${target.connectionId} through a link, and measuring it failed ` +
                `(${err instanceof Error ? err.message : String(err)}); the next Test measures it`,
            );
          }
        },
      },
    );
    if (!decided.ok) {
      const reason = typeof decided.reason === 'string' ? decided.reason : inLocale(decided.reason, locale, register);
      return page(decided.status, grantResultPage({ ok: false, reason, ...(decided.link ? { link: decided.link } : {}) }, locale, register));
    }
    return page(
      200,
      cirruxResultPage({
        outcome: {
          ok: true,
          connectionId: decided.connectionId,
          ...(decided.username === undefined ? {} : { username: decided.username }),
          ...(decided.workspace === undefined ? {} : { workspace: decided.workspace }),
        },
        locale,
        ...(register ? { register } : {}),
      }),
    );
  }

  if (typeof req.query.error === 'string' && req.query.error.length > 0) {
    const description = typeof req.query.error_description === 'string' ? ` ${req.query.error_description}` : '';
    return refuse(200, {
      en: `Cirrux reported: ${req.query.error}.${description} Nothing was granted and nothing was stored.`,
      nl: `Cirrux meldde: ${req.query.error}.${description} Er is niets toegestaan en niets opgeslagen.`,
    });
  }
  const iss = typeof req.query.iss === 'string' ? req.query.iss : undefined;
  if (!issuerIsCirrux(iss)) {
    log.warn(`[api] a Connect Cirrux Drive callback named another issuer (${String(iss).slice(0, 120)}); nothing was exchanged`);
    return refuse(400, CIRRUX_CONSENT_FOR_THE_OWNER.wrongIssuer);
  }
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  if (!code) {
    return refuse(400, { en: 'Cirrux sent no authorization code back.', nl: 'Cirrux heeft geen autorisatiecode teruggestuurd.' });
  }
  // A consent begun before its organisation was closed (0085 T2): refused
  // before the code is exchanged, so nothing is stored. The store asks again,
  // in its own transaction, because a close can land in between.
  let closed;
  try {
    closed = await closedOrganisation(tenantId, pool());
  } catch (error) {
    // Not read is not open (hard rule 9): nothing is exchanged or stored.
    log.error('[api] reading whether a Connect Cirrux Drive organisation was closed failed:', error);
    return refuse(500, CIRRUX_CONSENT_FOR_THE_OWNER.notStored);
  }
  if (closed) return refuse(409, { en: closed.reason, nl: closed.reasonNl });

  const outcome = await exchangeCirruxCode({ code, verifier, clientId: pending.clientId, redirectUri: pending.redirectUri });
  if (!outcome.ok) {
    log.warn(`[api] a Connect Cirrux Drive code exchange failed: ${outcome.reason}`);
    return refuse(400, outcome.said);
  }
  const signedIn = await cirruxSignedInAs(outcome.accessToken);
  let stored: CirruxGrantStored<Bilingual>;
  try {
    stored = await storeCirruxDriveGrant({ pool: pool(), tenantId, connectionId }, outcome.refreshToken, {
      // The workspace this sign-in reached, recorded on the account the first
      // time and held to after (workplan 0174 §4.4, T5).
      ...(signedIn?.workspaceId === undefined ? {} : { workspace: signedIn.workspaceId }),
      refusal: async (db): Promise<Bilingual | null> => {
        const closure = await readOrganisationClosure(db, tenantId);
        if (closure) return organisationClosedRefusal(closure);
        // A person connected this account themselves (D6): their Drive is
        // theirs to change, through a new grant link.
        return rotationRefusal(db, tenantId, connectionId);
      },
      // The audit line, in the grant's own transaction: new access, by whom, on which account.
      recorded: (db) =>
        new PgLedger(db).recordAuditEvent(tenantId as TenantId, {
          actor: pending.cirrux!.actor,
          action: CIRRUX_DRIVE_CONNECTED_ACTION,
          entity: 'connection',
          detail: { connectionId, kind: 'cirrux' },
        }),
    });
  } catch (error) {
    log.error(`[api] storing a Cirrux Drive grant on ${connectionId} failed; nothing was kept:`, error);
    return refuse(500, CIRRUX_CONSENT_FOR_THE_OWNER.notStored);
  }
  if (stored === 'no_account') return refuse(400, CIRRUX_CONSENT_FOR_THE_OWNER.noAccount);
  if (stored === 'another_workspace') return refuse(409, ANOTHER_CIRRUX_WORKSPACE);
  if (stored !== 'stored') return refuse(409, stored.refused);
  log.info(`[api] Cirrux Drive connected on account ${connectionId}`);

  // Measured again, so every screen that reads the record sees the Drive, with
  // the access token this consent was just given, so measuring spends no
  // refresh. Never fails the consent: the grant is stored, and a Test
  // measures it.
  try {
    await requalifyStoredConnection(tenantId, connectionId, pending.cirrux.actor, {
      accessToken: outcome.accessToken,
      expiresAt: outcome.accessExpiresAt,
    });
  } catch (err) {
    log.warn(
      `[api] Cirrux Drive is connected on ${connectionId}, and measuring it failed ` +
        `(${err instanceof Error ? err.message : String(err)}); the next Test measures it`,
    );
  }
  const origin = webOrigin();
  page(
    200,
    cirruxResultPage({
      outcome: { ok: true, connectionId, ...signedIn },
      locale,
      ...(origin ? { webOrigin: origin } : {}),
    }),
  );
});

router.post('/cirrux/disconnect', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.tenantId) return void res.status(401).json({ error: 'Unauthorized', message: 'Tenant ID not found' });
    const tenantId = req.tenantId;
    const parsed = DisconnectSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      const reason = 'Send { connectionId }: the Cirrux account to disconnect Drive from.';
      return void res.status(400).json({ error: 'invalid_body', message: reason, reason });
    }
    const { connectionId } = parsed.data;
    // No closed-organisation check, deliberately: disconnecting ends access,
    // and ending stays open after a close (`closed-organisation.ts`), as
    // withdrawing a grant does. Nothing here starts work or reaches Cirrux.
    //
    // The face the record keeps from now on: the measured no the Drive answers
    // without a grant (or without the deployment's client), which asks nothing
    // of anybody to be said.
    const face = await qualifyCirruxDrive({});
    const removal = await removeCirruxDriveGrant(
      { pool: pool(), tenantId, connectionId },
      {
        face: { ...face },
        // The audit line, in the removal's own transaction: who, on which
        // account, and what Cirrux was asked (nothing). Never a token.
        recorded: (db) =>
          new PgLedger(db).recordAuditEvent(tenantId as TenantId, {
            actor: req.userId ?? 'unknown',
            action: CIRRUX_DRIVE_DISCONNECTED_ACTION,
            entity: 'connection',
            detail: { connectionId, kind: 'cirrux', revocation: cirruxDriveDisconnectRevocation(true).status },
          }),
      },
    );
    if (removal === 'no_account') {
      const reason = 'No Cirrux destination with that id is on your Accounts page, so no Drive can be disconnected from it.';
      return void res.status(404).json({ error: 'not_a_cirrux_account', message: reason, reason });
    }
    // This process's access tokens for the account go now; a pass in another
    // process stops within a minute, when its store says no grant is stored.
    forgetCirruxAccess(connectionId);
    const removed = removal === 'removed';
    if (removed) log.info(`[api] Cirrux Drive disconnected on account ${connectionId}`);
    const answer: CirruxDriveDisconnected = {
      connectionId,
      removed,
      revocation: cirruxDriveDisconnectRevocation(removed),
    };
    res.json(answer);
  } catch (error) {
    serverFault(res, 'cirrux_disconnect_failed', 'disconnecting Cirrux Drive', error);
  }
});

export default router;
