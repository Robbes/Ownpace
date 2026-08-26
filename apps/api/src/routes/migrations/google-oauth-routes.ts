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
import { authenticate } from '../../middleware/auth.ts';
import type { AuthenticatedRequest } from '../../types/api.ts';
import {
  ConsentFlowStore,
  GOOGLE_SOURCE_SCOPES,
  consentResultPage,
  consentUrl,
  exchangeCode,
  type GoogleConsentSourceType,
} from './google-consent.ts';

const router = Router();
const flows = new ConsentFlowStore();

const AuthorizeSchema = z.object({
  sourceType: z.enum(['gmail', 'google-calendar', 'google-contacts', 'google-drive']),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
});

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
  const { sourceType, clientId, clientSecret } = parsed.data;
  const scope = GOOGLE_SOURCE_SCOPES[sourceType as GoogleConsentSourceType];
  const redirectUri = callbackUri(req);
  const state = flows.begin({ clientId, clientSecret, scope, redirectUri });
  res.json({
    url: consentUrl({ clientId, scope, redirectUri, state }),
    redirectUri,
    scope,
  });
});

router.get('/google/callback', async (req: Request, res: Response) => {
  const page = (status: number, html: string) =>
    void res.status(status).setHeader('Content-Type', 'text/html; charset=utf-8').send(html);

  const state = typeof req.query.state === 'string' ? req.query.state : '';
  const pending = state ? flows.take(state) : undefined;
  if (!pending) {
    // Absent, forged, expired or ALREADY USED — one honest sentence for all
    // four, because distinguishing them would teach a forger which part of
    // the state failed.
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
  if (typeof req.query.error === 'string' && req.query.error.length > 0) {
    return page(
      200,
      consentResultPage({
        outcome: {
          ok: false,
          reason: `Google reported: ${req.query.error}. Nothing was granted and nothing was stored.`,
        },
      }),
    );
  }
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  if (!code) {
    return page(
      400,
      consentResultPage({
        outcome: { ok: false, reason: 'Google sent no authorization code back.' },
      }),
    );
  }
  const outcome = await exchangeCode({
    code,
    clientId: pending.clientId,
    clientSecret: pending.clientSecret,
    redirectUri: pending.redirectUri,
    askedScope: pending.scope,
  });
  page(outcome.ok ? 200 : 400, consentResultPage({ webOrigin: webOrigin(), outcome }));
});

export default router;
