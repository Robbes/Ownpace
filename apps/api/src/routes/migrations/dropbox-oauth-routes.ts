// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Connect with Dropbox (2026-09-02): the two routes of Google's consent, for
 * Dropbox. `POST /dropbox/authorize` is authenticated and resolves the app the
 * way every Google door resolves its client — the caller's whole pair, else
 * the deployment's, else a refusal naming both ways forward — and begins a
 * signed, single-use, ten-minute state in the ONE consent store. `GET
 * /dropbox/callback` is public by nature, trusted by nothing but that state,
 * exchanges the code and hands the refresh token to the wizard window under
 * the page's own headers (`callbackPageHeaders`: helmet's defaults would deny
 * the page its script and its opener, as they did Google's on the same day).
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.ts';
import type { AuthenticatedRequest } from '../../types/api.ts';
import { resolveDropboxClient } from '@openmig/shared';
import {
  callbackPageHeaders,
  consentResultPage,
  rawIpCallbackRefusal,
  unreachableCallbackRefusal,
} from './google-consent.ts';
import { consentFlows as flows } from './consent-flows.ts';
import { dropboxConsentUrl, exchangeDropboxCode } from './dropbox-consent.ts';

const router = Router();

const AuthorizeSchema = z.object({
  // Optional, as Google's became (ADR-0041): a deployment that configured its
  // own Dropbox app needs neither; a caller that sends the pair still wins.
  clientId: z.string().min(1).optional(),
  clientSecret: z.string().min(1).optional(),
});

function callbackUri(req: Request): string {
  const base = (process.env.API_URL ?? `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
  return `${base}/api/migrations/dropbox/callback`;
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

router.post('/dropbox/authorize', authenticate, (req: AuthenticatedRequest, res: Response) => {
  const parsed = AuthorizeSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return void res.status(400).json({
      error: 'invalid_body',
      reason:
        'Send { clientId, clientSecret } (the App key and App secret) as a pair, or nothing at ' +
        "all to use this deployment's own Dropbox app.",
    });
  }
  const client = resolveDropboxClient(parsed.data);
  if (!client.ok) {
    return void res.status(400).json({ error: client.error, reason: client.reason });
  }
  const redirectUri = callbackUri(req);
  const ipRefusal = rawIpCallbackRefusal(redirectUri);
  if (ipRefusal) {
    return void res.status(400).json({ error: 'raw_ip_callback', reason: ipRefusal });
  }
  const unreachable = unreachableCallbackRefusal(redirectUri, process.env.WEB_URL);
  if (unreachable) {
    return void res.status(400).json({ error: 'unreachable_callback', reason: unreachable });
  }
  const state = flows.begin({
    clientId: client.clientId,
    clientSecret: client.clientSecret,
    scope: '',
    redirectUri,
    provider: 'dropbox',
  });
  res.json({ url: dropboxConsentUrl({ clientId: client.clientId, redirectUri, state }), redirectUri });
});

router.get('/dropbox/callback', async (req: Request, res: Response) => {
  const page = (status: number, html: string) =>
    void res
      .status(status)
      .set({ 'Content-Type': 'text/html; charset=utf-8', ...callbackPageHeaders(html) })
      .send(html);
  const refuse = (status: number, reason: string) =>
    page(status, consentResultPage({ outcome: { ok: false, reason }, provider: 'dropbox' }));

  const state = typeof req.query.state === 'string' ? req.query.state : '';
  const taken = state ? flows.take(state) : undefined;
  const pending = taken && taken.provider === 'dropbox' ? taken : undefined;
  if (!pending) {
    return refuse(
      400,
      'This consent link is not one the wizard is waiting for — it was already used, ' +
        'it expired (they live ten minutes), or it was not started here.',
    );
  }
  if (typeof req.query.error === 'string' && req.query.error.length > 0) {
    const description =
      typeof req.query.error_description === 'string' ? ` ${req.query.error_description}` : '';
    return refuse(200, `Dropbox reported: ${req.query.error}.${description} Nothing was granted and nothing was stored.`);
  }
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  if (!code) return refuse(400, 'Dropbox sent no authorization code back.');
  const outcome = await exchangeDropboxCode({
    code,
    clientId: pending.clientId,
    clientSecret: pending.clientSecret,
    redirectUri: pending.redirectUri,
  });
  page(outcome.ok ? 200 : 400, consentResultPage({ webOrigin: webOrigin(), outcome, provider: 'dropbox' }));
});

export default router;
