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
import { closedOrganisation } from '../../closed-organisation.ts';
import type { AuthenticatedRequest } from '../../types/api.ts';
import {
  EXCHANGE_FOR_THE_LINK_HOLDER,
  NOTHING_CAME_BACK,
  NOT_KEPT,
  inLocale,
  localeOf,
  log,
  resolveGoogleClient,
  stoppedAtGoogle,
  type Bilingual,
} from '@openmig/shared';
import {
  GOOGLE_SOURCE_SCOPES,
  callbackPageHeaders,
  consentResultPage,
  consentUrl,
  exchangeCode,
  grantResultPage,
  noCodeFrom,
  providerReported,
  rawIpCallbackRefusal,
  recordedPermission,
  unreachableCallbackRefusal,
  type ExchangeRefusalCode,
  type GoogleConsentSourceType,
} from './google-consent.ts';
// The SHARED store: this file holds the owner's beginning and the one ending,
// and `grant-routes.ts` holds the migrator's beginning. All three must see the
// same in-flight states — see `consent-flows.ts`.
import { consentFlows as flows } from './consent-flows.ts';
import { mintProgressLink, storeGrantedToken } from './grant-ending.ts';
import { mintPersonProgressLink, storePersonGrant } from './person-grant-ending.ts';
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
    // OPTIONAL SINCE 2026-09-01 (ADR-0041, owner decision — option B). A
    // deployment that registered its own Google application configures it once
    // in `GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_CLIENT_SECRET`, and nobody
    // types a client secret into a wizard again. A caller that SENDS the pair
    // still wins: owning a client is a real choice and a deployment-wide
    // default that replaced somebody's own would take it away.
    //
    // `.min(1)` is kept on the optional values rather than dropped: an empty
    // string is a field somebody cleared, not a decision to fall back, and
    // letting it through would build a consent URL with `client_id=`.
    clientId: z.string().min(1).optional(),
    clientSecret: z.string().min(1).optional(),
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
        'Send { sourceType } and, unless this deployment has its own Google client ' +
        'configured, { clientId, clientSecret } as well — which source you are connecting ' +
        'decides the one scope asked for.',
    });
  }

  /**
   * WHOSE CLIENT THIS CONSENT RUNS AGAINST — shared's order, read rather than
   * restated (ADR-0041): the caller's WHOLE pair, else the deployment's, else
   * a refusal naming both ways forward; and half a pair refused before
   * either, as every other door refuses it. This route used to take a lone
   * client id as "none sent" and run the consent against the deployment's
   * application — a token minted for an application the caller did not name,
   * silently. A half-configured deployment answers with its own sentence.
   */
  const client = resolveGoogleClient(parsed.data);
  if (!client.ok) {
    return void res.status(400).json({ error: client.error, reason: client.reason });
  }
  const { clientId, clientSecret } = client;

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
  // AND THE CASE THE RAW-IP REFUSAL CANNOT SEE (2026-09-01): loopback is a
  // legitimate SHAPE and the wrong address for a deployment served at a real
  // name. The owner met it as Google's `redirect_uri_mismatch` with the correct
  // string nowhere on screen. Refused here, with that string in the sentence.
  const unreachable = unreachableCallbackRefusal(redirectUri, process.env.WEB_URL);
  if (unreachable) {
    return void res.status(400).json({ error: 'unreachable_callback', reason: unreachable });
  }
  // The language the page was in, so the ending is in it too (workplan 0145
  // T6): recorded on the pending consent, never sent through the redirect.
  const locale = localeOf((req.body as { locale?: unknown } | undefined)?.locale);
  const state = flows.begin({ clientId, clientSecret, scope, redirectUri, locale });
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
 * What a person on a grant link reads when Google's side of the consent did
 * not finish.
 *
 * The owner's sentences name the client, the secret and the redirect URI,
 * because the owner holds them and can act. This reader holds none of it, so
 * each sentence says what went wrong and, where they cannot fix it, whom to
 * tell (the rule `FOR_THE_LINK_HOLDER` in `grant.ts` follows). None of these
 * reached the link, and the page says so: until 2026-09-23 every one of them
 * told the person to ask for a fresh link, for a link that still worked.
 *
 * In both languages, beside each other in `@openmig/shared` (workplan 0145
 * T6); typed here by the exchange's codes, so a new code is a compile error
 * until it has both halves. Google's own word for a cancel or a stop is
 * `stoppedAtGoogle`, from the same file.
 */
const FOR_THE_LINK_HOLDER_AFTER_GOOGLE: Readonly<Record<ExchangeRefusalCode, Bilingual>> =
  EXCHANGE_FOR_THE_LINK_HOLDER;

/** One pool for the close's read, built on first use rather than per request. */
let _closurePool: ReturnType<typeof getDbPool> | null = null;
function closurePool(): ReturnType<typeof getDbPool> {
  if (!_closurePool) _closurePool = getDbPool();
  return _closurePool;
}

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
  // Under ITS OWN headers, set after helmet's and so replacing them: the
  // defaults deny this page its inline script and its opener, which is the
  // whole hand-back (`callbackPageHeaders`, 2026-09-02).
  const page = (status: number, html: string) =>
    void res
      .status(status)
      .set({ 'Content-Type': 'text/html; charset=utf-8', ...callbackPageHeaders(html) })
      .send(html);

  const state = typeof req.query.state === 'string' ? req.query.state : '';
  const taken = state ? flows.take(state) : undefined;
  // A consent begun at another provider is not this callback's to end: the
  // state is spent (single-use) and the sentence is the same as for a forged
  // one, on purpose.
  const pending = taken && (taken.provider ?? 'google') === 'google' ? taken : undefined;
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
  // voice of whoever is actually looking at it, and in the language the page
  // that began it was in (workplan 0145 T6): the pending state's, never the
  // query string's.
  const link = pending.link;
  // A person's link (ADR-0035, amended 2026-09-29; 0153 T5 (b)) ends the
  // same way a migration's does, up to the store: the same page, the same
  // refusals, in the same voice.
  const personLink = pending.personLink;
  const anyLink = link ?? personLink;
  const locale = localeOf(pending.locale);
  // `linkAfter` is what is true of a grant link after this refusal, when it
  // is not used up (see `grantResultPage`); the owner's ending has no link.
  // `reason` is a pair where we wrote both halves; a code exchange's refusal
  // to the owner quotes Google and names the client, and stays as written.
  const refuse = (status: number, reason: Bilingual | string, linkAfter?: 'works' | 'unused') => {
    const said = typeof reason === 'string' ? reason : inLocale(reason, locale);
    page(
      status,
      anyLink
        ? grantResultPage({ ok: false, reason: said, ...(linkAfter ? { link: linkAfter } : {}) }, locale)
        : consentResultPage({ outcome: { ok: false, reason: said }, locale }),
    );
  };

  if (typeof req.query.error === 'string' && req.query.error.length > 0) {
    const said = req.query.error;
    return refuse(200, anyLink ? stoppedAtGoogle(said) : providerReported('google', said), 'unused');
  }
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  if (!code) {
    return refuse(400, anyLink ? NOTHING_CAME_BACK : noCodeFrom('google'), 'unused');
  }
  // A grant link's consent begun before its organisation was closed (0085
  // T2): refused before the code is exchanged, so the organisation's client is
  // not used and nothing is stored. The link is not spent; a reopen can use
  // it. `storeGrantedToken` asks again, inside its own transaction.
  if (anyLink) {
    let closed;
    try {
      closed = await closedOrganisation(anyLink.tenantId, closurePool());
    } catch (error) {
      // Not read is not open (hard rule 9): nothing is exchanged or stored.
      log.error('[api] reading whether a grant link’s organisation was closed failed:', error);
      return refuse(500, NOT_KEPT, 'unused');
    }
    if (closed) return refuse(409, { en: closed.reason, nl: closed.reasonNl }, 'unused');
  }
  const outcome = await exchangeCode({
    code,
    clientId: pending.clientId,
    clientSecret: pending.clientSecret,
    redirectUri: pending.redirectUri,
    askedScope: pending.scope,
  });

  if (!anyLink) {
    // The owner's ending (0089 T1), in the language the consent began in (0145 T6).
    return page(outcome.ok ? 200 : 400, consentResultPage({ webOrigin: webOrigin(), outcome, locale }));
  }

  if (!outcome.ok) {
    // The owner's sentence names what to check, and nobody who can check it is
    // reading this page, so it goes where the one who runs this can find it.
    log.warn(
      `[api] a grant link's code exchange failed (${outcome.code}) for ` +
        `${link ? `mapping ${link.mappingId}` : `person ${personLink!.personId}`}: ${outcome.reason}`,
    );
    return refuse(400, FOR_THE_LINK_HOLDER_AFTER_GOOGLE[outcome.code], 'unused');
  }

  if (personLink) {
    // A person's ending: the one token onto every migration the page listed
    // for the account, and nothing to anyone (`person-grant-ending.ts`).
    let stored;
    try {
      stored = await storePersonGrant(getDbPool(), personLink, {
        refreshToken: outcome.refreshToken,
        signedInAs: outcome.signedInAs,
      });
    } catch (error) {
      log.error('[api] storing a granted credential for a person failed:', error);
      return refuse(500, NOT_KEPT, 'unused');
    }
    if (!stored.ok) {
      const reason = { en: stored.reason, nl: stored.reasonNl };
      return stored.linkStillWorks
        ? refuse(403, reason, 'works')
        : refuse(409, reason, stored.linkUnused ? 'unused' : undefined);
    }
    // The person's own progress page, handed over while they are here, and
    // after the consent's transaction, as a migration's is below.
    const personProgressUrl = await mintPersonProgressLink(getDbPool(), personLink);
    const permission = recordedPermission(pending.scope, outcome.grantedScopes);
    return page(
      200,
      grantResultPage(
        personProgressUrl ? { ok: true, progressUrl: personProgressUrl, permission } : { ok: true, permission },
        locale,
      ),
    );
  }
  // Past a person's ending only a migration's link is left; said, so the
  // type knows it too.
  if (!link) return refuse(500, NOT_KEPT, 'unused');

  // The migrator's ending. Note what is NOT passed on from here: `outcome`
  // carries the refresh token, and only `storeGrantedToken` receives it. The
  // page below is rendered from a boolean. It also receives the account Google
  // says signed in, and stores nothing unless it is the one the migration
  // names (0108 T8 (b)).
  let stored;
  try {
    stored = await storeGrantedToken(getDbPool(), link, {
      refreshToken: outcome.refreshToken,
      signedInAs: outcome.signedInAs,
    });
  } catch (error) {
    log.error('[api] storing a granted credential failed:', error);
    // The claim and the write are one transaction, so a throw here rolled the
    // claim back with it: the link was not used up.
    return refuse(500, NOT_KEPT, 'unused');
  }
  if (!stored.ok) {
    // 403 for the wrong account: the link is good, the person is not the one
    // it was for. 409 for a link that can no longer be used.
    const reason = { en: stored.reason, nl: stored.reasonNl };
    return stored.linkStillWorks
      ? refuse(403, reason, 'works')
      : refuse(409, reason, stored.linkUnused ? 'unused' : undefined);
  }

  // ADR-0035's second lifetime, handed over at the one moment this person is
  // reachable (0122 T7). AFTER the credential transaction, and never inside
  // it: a progress page that could not be minted must not undo a consent that
  // landed. `mintProgressLink` answers null rather than throwing, and the page
  // then reads exactly as it did before this existed.
  //
  // Nothing is emailed and no address is stored — ADR-0035's *"the admin
  // distributes the link, we never do"* is untouched. The link is put in front
  // of the person who is already here, in their own browser.
  const progressUrl = await mintProgressLink(getDbPool(), link);
  // "Read-only" at the ending only where Google holds what it RECORDED to
  // reading (0144 T3 (c)): with `include_granted_scopes` the grant can carry
  // more than the link asked for, and this is the first moment that is known.
  const permission = recordedPermission(pending.scope, outcome.grantedScopes);
  page(
    200,
    grantResultPage(progressUrl ? { ok: true, progressUrl, permission } : { ok: true, permission }, locale),
  );
});

export default router;
