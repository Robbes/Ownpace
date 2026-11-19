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
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import * as schema from '@openmig/ledger';
import { PgLedger } from '@openmig/ledger';
import { readOrganisationClosure } from '@openmig/managed';
import { authenticate, getDbPool, withTenantDb } from '../../middleware/auth.ts';
import type { AuthenticatedRequest } from '../../types/api.ts';
import {
  CIRRUX_DRIVE_SCOPES,
  cirruxDeploymentClient,
  inLocale,
  localeOf,
  log,
  organisationClosedRefusal,
  type Bilingual,
  type TenantId,
} from '@openmig/shared';
import { storeCirruxDriveGrant } from '@openmig/orchestration/cirrux-grant-store';
import {
  CONSENT_NOT_AWAITED,
  browserLocale,
  callbackPageHeaders,
  rawIpCallbackRefusal,
  unreachableCallbackRefusal,
} from './google-consent.ts';
import { consentFlows as flows } from './consent-flows.ts';
import {
  CIRRUX_CONSENT_FOR_THE_OWNER,
  CIRRUX_DRIVE_CONNECTED_ACTION,
  cirruxConsentUrl,
  cirruxResultPage,
  cirruxSignedInAs,
  exchangeCirruxCode,
  issuerIsCirrux,
  pkcePair,
} from './cirrux-consent.ts';
import { closedOrganisation, refusedAsClosed } from '../../closed-organisation.ts';
import { refusedUntilAccepted } from '../../conditions-not-accepted.ts';

const router = Router();

/** The sentence for a deployment with no Cirrux client: the Drive face's own. */
export const NO_CIRRUX_CLIENT =
  'This deployment has no Cirrux client yet, so Cirrux Drive cannot be connected from it: Cirrux ' +
  'registers each client by hand, with the deployment’s exact callback address. Set ' +
  'CIRRUX_OAUTH_CLIENT_ID once Cirrux has sent it, and restart the API.';

const AuthorizeSchema = z.object({
  connectionId: z.string().uuid(),
  locale: z.unknown().optional(),
});

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
  let stored: 'stored' | 'no_account' | { readonly refused: Bilingual };
  try {
    stored = await storeCirruxDriveGrant({ pool: pool(), tenantId, connectionId }, outcome.refreshToken, {
      refusal: async (db): Promise<Bilingual | null> => {
        const closure = await readOrganisationClosure(db, tenantId);
        return closure ? organisationClosedRefusal(closure) : null;
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
  if (stored !== 'stored') return refuse(409, stored.refused);
  log.info(`[api] Cirrux Drive connected on account ${connectionId}`);

  // Measured again, so every screen that reads the record sees the Drive, with
  // the access token this consent was just given, so measuring spends no
  // refresh. Never fails the consent: the grant is stored, and a Test
  // measures it. Imported here, not at the top: the connection routes import
  // the migration routes, which mount this file.
  try {
    const { requalifyStoredConnection } = await import('../connections.ts');
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

export default router;
