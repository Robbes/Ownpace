// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The two routes of workplan 0089 T1, thin on purpose — every decision
 * lives in `google-consent.ts`, which needs no server to prove.
 *
 * `POST /google/authorize` is authenticated and takes the customer's own
 * client (id + secret) plus which Google SOURCE the consent is for; the
 * secret waits in process memory keyed by the signed state and is never in
 * a URL. `GET /google/callback` is the address Google redirects the
 * person's browser to — public by nature, trusted by NOTHING except the
 * signed, single-use, expiring state. The response is a small page that
 * hands the refresh token back to the wizard window (postMessage, web
 * origin only), where it lands in the same field a pasted token does and
 * is stored through the same encrypted path (ADR-0037: one credential
 * store, no special case).
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { authenticate, getDbPool } from '../../middleware/auth.ts';
import type { AuthenticatedRequest } from '../../types/api.ts';
import { log } from '@openmig/shared';
import {
  GOOGLE_SOURCE_SCOPES,
  consentResultPage,
  consentUrl,
  exchangeCode,
  grantResultPage,
  rawIpCallbackRefusal,
  type GoogleConsentSourceType,
} from './google-consent.ts';
// The SHARED store: this file holds the owner's beginning and the one ending,
// and `grant-routes.ts` holds the migrator's beginning. All three must see the
// same in-flight states — see `consent-flows.ts`.
import { consentFlows as flows } from './consent-flows.ts';
import { storeGrantedToken } from './grant-ending.ts';
// The account-kind ask (workplan 0106 T3b): several faces from ONE Google
// account, and the scope string built from the ticks and nothing else.
import { googleAccountConsent, isRefusal } from './google-account-consent.ts';

const router = Router();

/**
 * Two shapes, and the older one is untouched (workplan 0106 T3b).
 *
 * `sourceType` is the single-purpose ask this route has always served: one
 * Google source, one scope. `domains` is the ACCOUNT ask — one Google
 * connection wearing several faces — and it carries the ticks rather than a
 * kind, because the tick set IS the ask.
 *
 * A union rather than a replacement, deliberately. The single-purpose sources
 * cohabit with the account kind (0106 T3b's own word), `gmail` and
 * `google-drive` are the only way to reach the restricted scopes at all, and
 * every wizard and client already sending `sourceType` keeps working
 * unchanged.
 */
const AuthorizeSchema = z.intersection(
  z.object({
    clientId: z.string().min(1),
    clientSecret: z.string().min(1),
  }),
  z.union([
    z.object({
      sourceType: z.enum(['gmail', 'google-calendar', 'google-contacts', 'google-drive']),
    }),
    z.object({
      // Not `.min(1)`: an empty array is a real thing a wizard can send, and
      // `googleAccountConsent` answers it with a sentence about ticking
      // something. A zod message here would be a second, worse wording of the
      // same refusal.
      domains: z.array(z.string()),
    }),
  ]),
);

/** The address Google must redirect to — configured, or derived from the
 *  request for a dev setup. Google matches it against the client's
 *  REGISTERED list, so a wrong derivation fails loudly at Google's screen
 *  with the exact string in hand, which is why the response also returns
 *  it: the wizard shows the value the customer has to register. */
function callbackUri(req: Request): string {
  const base = (process.env.API_URL ?? `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
  return `${base}/api/migrations/google/callback`;
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

router.post('/google/authorize', authenticate, (req: AuthenticatedRequest, res: Response) => {
  const parsed = AuthorizeSchema.safeParse(req.body);
  if (!parsed.success) {
    return void res.status(400).json({
      error: 'invalid_body',
      reason:
        'Send { sourceType, clientId, clientSecret } — the consent runs against your own ' +
        'Google client, and which source you are connecting decides the one scope asked for.',
    });
  }
  const { clientId, clientSecret } = parsed.data;

  // The account ask, when the caller sent ticks. Refusals are the decision
  // function's own words, verbatim: it is the one place that knows why mail
  // and files are not on this account, and a paraphrase here would be a
  // second claim to keep true.
  let scope: string;
  let asked: ReadonlyArray<string> | undefined;
  if ('domains' in parsed.data) {
    const consent = googleAccountConsent(parsed.data.domains);
    if (isRefusal(consent)) {
      return void res.status(400).json({ error: consent.error, reason: consent.reason });
    }
    scope = consent.scope;
    asked = consent.domains;
  } else {
    scope = GOOGLE_SOURCE_SCOPES[parsed.data.sourceType as GoogleConsentSourceType];
  }

  const redirectUri = callbackUri(req);
  // Refused HERE, with the two ways out named, rather than at Google's
  // screen with a bare invalid_request (0089 T6): an appliance reached at a
  // raw IP cannot be a redirect target, and nothing about starting the flow
  // would have said so.
  const ipRefusal = rawIpCallbackRefusal(redirectUri);
  if (ipRefusal) {
    return void res.status(400).json({ error: 'raw_ip_callback', reason: ipRefusal });
  }
  const state = flows.begin({ clientId, clientSecret, scope, redirectUri });
  res.json({
    url: consentUrl({ clientId, scope, redirectUri, state }),
    redirectUri,
    scope,
    // Echoed only for the account ask, so a wizard can show what it asked
    // for beside what Google will show. Absent for the single-purpose ask,
    // where the source type already said it.
    ...(asked ? { domains: asked } : {}),
  });
});

/**
 * ONE callback address for two flows, because Google is told one redirect URI
 * and a second would have to be registered by every customer (workplan 0108
 * T4). Which flow this is comes off the PENDING STATE — the server's own record
 * — never off the query string, which is the browser's to write.
 *
 * The branch decides who may see the refresh token, and that is the only
 * difference between the two endings: the owner's goes to the owner's wizard,
 * the migrator's goes into the database and stops there.
 */
router.get('/google/callback', async (req: Request, res: Response) => {
  const page = (status: number, html: string) =>
    void res.status(status).setHeader('Content-Type', 'text/html; charset=utf-8').send(html);

  const state = typeof req.query.state === 'string' ? req.query.state : '';
  const pending = state ? flows.take(state) : undefined;
  if (!pending) {
    // Absent, forged, expired or ALREADY USED — one honest sentence for all
    // four, because distinguishing them would teach a forger which part of
    // the state failed. No pending state means no link either, so this one
    // cannot be worded for the migrator; it is deliberately about the state
    // rather than about anybody's link.
    return page(
      400,
      consentResultPage({
        outcome: {
          ok: false,
          reason:
            'This consent link is not one the wizard is waiting for — it was already used, ' +
            'it expired (they live ten minutes), or it was not started here.',
        },
      }),
    );
  }
  // From here the flow is known, so every remaining answer is rendered in the
  // voice of whoever is actually looking at it.
  const link = pending.link;
  const refuse = (status: number, reason: string) =>
    page(status, link ? grantResultPage({ ok: false, reason }) : consentResultPage({ outcome: { ok: false, reason } }));

  if (typeof req.query.error === 'string' && req.query.error.length > 0) {
    return refuse(
      200,
      `Google reported: ${req.query.error}. Nothing was granted and nothing was stored.`,
    );
  }
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  if (!code) {
    return refuse(400, 'Google sent no authorization code back.');
  }
  const outcome = await exchangeCode({
    code,
    clientId: pending.clientId,
    clientSecret: pending.clientSecret,
    redirectUri: pending.redirectUri,
    askedScope: pending.scope,
  });

  if (!link) {
    // The owner's ending, exactly as it shipped in 0089 T1.
    return page(outcome.ok ? 200 : 400, consentResultPage({ webOrigin: webOrigin(), outcome }));
  }

  if (!outcome.ok) return refuse(400, outcome.reason);

  // The migrator's ending. Note what is NOT passed on from here: `outcome`
  // carries the refresh token, and only `storeGrantedToken` receives it. The
  // page below is rendered from a boolean.
  let stored;
  try {
    stored = await storeGrantedToken(getDbPool(), link, outcome.refreshToken);
  } catch (error) {
    log.error('[api] storing a granted credential failed:', error);
    return refuse(
      500,
      'Your permission was given, but something on our side went wrong storing it, so it ' +
        'was not kept. Nothing is connected yet. Please tell the person who sent you the ' +
        'link — this one is ours to fix, not yours.',
    );
  }
  if (!stored.ok) return refuse(409, stored.reason);
  page(200, grantResultPage({ ok: true }));
});

export default router;
