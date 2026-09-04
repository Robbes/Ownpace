// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Connect with Microsoft (workplan 0114 T2b): the two routes `POST
 * /microsoft/authorize` and `GET /microsoft/callback`, the third instance of
 * the shape Google and Dropbox already have.
 *
 * The authorize half is authenticated and resolves the application the way
 * every other door does — the caller's WHOLE pair, else the deployment's, else
 * a refusal naming both ways forward — and begins a signed, single-use,
 * ten-minute state in the ONE consent store. The callback half is public by
 * nature, trusted by nothing but that state, exchanges the code and hands the
 * refresh token to the wizard window under the page's own headers
 * (`callbackPageHeaders`: helmet's defaults would deny the page its script and
 * its opener, as they did Google's — the #721 lesson).
 *
 * ## Two things here are Microsoft's alone
 *
 * **The TENANT rides the pending state.** Microsoft's authorize and token
 * endpoints are directory-scoped, so the callback must exchange the code at
 * the same authority the authorize call used. Recomputing it at the callback
 * would be correct almost always and wrong exactly when it matters: a
 * deployment whose `MICROSOFT_OAUTH_TENANT` changed between the two halves
 * would fail with a message about the application not being found in the
 * directory, which reads like a typo and is not one.
 *
 * **The DOMAINS decide the scopes**, as they do for the Google account kind:
 * the consent asks for exactly the faces that were ticked and nothing more, so
 * the screen and the ticks cannot disagree. An empty set is refused rather
 * than defaulted — a consent nobody chose the shape of is a consent nobody can
 * check.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.ts';
import type { AuthenticatedRequest } from '../../types/api.ts';
import { resolveMicrosoftClient, microsoftTenant } from '@openmig/shared';
import {
  callbackPageHeaders,
  consentResultPage,
  rawIpCallbackRefusal,
  unreachableCallbackRefusal,
} from './google-consent.ts';
import { consentFlows as flows } from './consent-flows.ts';
import {
  MICROSOFT_CONSENT_DOMAINS,
  microsoftConsentUrl,
  microsoftConsentRefusal,
  exchangeMicrosoftCode,
} from './microsoft-consent.ts';

const router = Router();

const AuthorizeSchema = z.object({
  // Optional, as Google's and Dropbox's are (ADR-0041): a deployment that
  // configured its own app registration needs neither; a caller that sends the
  // pair still wins, and half a pair is refused by `resolveMicrosoftClient`
  // rather than completed with the deployment's other half.
  clientId: z.string().min(1).optional(),
  clientSecret: z.string().min(1).optional(),
  // A caller's OWN registration carries its own directory, and it travels with
  // their pair rather than being replaced by the deployment's (0114 T1).
  tenantId: z.string().min(1).optional(),
  // Which faces to ask for. Constrained to the ones that HAVE a Graph scope,
  // so a domain nobody can consent to is a 400 here rather than a scope string
  // with an `undefined` in it.
  domains: z.array(z.enum(MICROSOFT_CONSENT_DOMAINS as [string, ...string[]])).min(1),
});

function callbackUri(req: Request): string {
  const base = (process.env.API_URL ?? `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
  return `${base}/api/migrations/microsoft/callback`;
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

router.post('/microsoft/authorize', authenticate, (req: AuthenticatedRequest, res: Response) => {
  const parsed = AuthorizeSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return void res.status(400).json({
      error: 'invalid_body',
      reason:
        'Send { domains } naming at least one of ' +
        `${MICROSOFT_CONSENT_DOMAINS.join(', ')}, and either { clientId, clientSecret } as a ` +
        "pair or nothing at all to use this deployment's own app registration.",
    });
  }
  const client = resolveMicrosoftClient(parsed.data);
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
  // `resolveMicrosoftClient` already decided WHOSE application this is and
  // answers with the directory that goes with it — a caller's own tenant when
  // they sent their own pair, the deployment's authority otherwise. Reading
  // the environment again here is exactly what would send a single-tenant
  // registration to `common` (0114 T1's second refusal).
  const tenant = client.tenant;
  const state = flows.begin({
    clientId: client.clientId,
    clientSecret: client.clientSecret,
    scope: '',
    redirectUri,
    provider: 'microsoft',
    tenant,
  });
  res.json({
    url: microsoftConsentUrl({
      clientId: client.clientId,
      tenant,
      redirectUri,
      state,
      domains: parsed.data.domains,
    }),
    redirectUri,
  });
});

router.get('/microsoft/callback', async (req: Request, res: Response) => {
  const page = (status: number, html: string) =>
    void res
      .status(status)
      .set({ 'Content-Type': 'text/html; charset=utf-8', ...callbackPageHeaders(html) })
      .send(html);
  const refuse = (status: number, reason: string) =>
    page(status, consentResultPage({ outcome: { ok: false, reason }, provider: 'microsoft' }));

  const state = typeof req.query.state === 'string' ? req.query.state : '';
  const taken = state ? flows.take(state) : undefined;
  const pending = taken && taken.provider === 'microsoft' ? taken : undefined;
  if (!pending) {
    return refuse(
      400,
      'This consent link is not one the wizard is waiting for — it was already used, ' +
        'it expired (they live ten minutes), or it was not started here.',
    );
  }
  if (typeof req.query.error === 'string' && req.query.error.length > 0) {
    const description =
      typeof req.query.error_description === 'string' ? req.query.error_description : '';
    // AADSTS codes arrive inside `error_description` and say something a
    // person can act on — an administrator must approve this, or the tenant
    // does not allow user consent at all. Rendering the raw code alone would
    // send them searching for it (0114 T6's treatment, and #722's for
    // Google's accessNotConfigured).
    const sentence = microsoftConsentRefusal(description);
    return refuse(
      200,
      sentence ??
        `Microsoft reported: ${req.query.error}.${description ? ` ${description}` : ''} ` +
          'Nothing was granted and nothing was stored.',
    );
  }
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  if (!code) return refuse(400, 'Microsoft sent no authorization code back.');
  const outcome = await exchangeMicrosoftCode({
    code,
    clientId: pending.clientId,
    clientSecret: pending.clientSecret,
    // The authority the authorize half used — see the header. Never recomputed.
    tenant: pending.tenant ?? microsoftTenant(),
    redirectUri: pending.redirectUri,
  });
  page(
    outcome.ok ? 200 : 400,
    consentResultPage({ webOrigin: webOrigin(), outcome, provider: 'microsoft' }),
  );
});

export default router;
