// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The consent flow's load-bearing constraints (workplan 0089 T1), each one
 * pinned because each one is the kind that rots silently: the state is
 * single-use and expiring, offline access cannot be forgotten off the URL,
 * a narrower grant refuses with the difference NAMED, and the result page
 * hands a token to exactly one origin — never `*`.
 */

import { describe, it, expect, vi } from 'vitest';
import { GOOGLE_SCOPES_ASKED_BY_DOMAIN } from '@openmig/orchestration/account-qualification';
import {
  CONSENT_STATE_TTL_MS,
  ConsentFlowStore,
  GOOGLE_SOURCE_DOMAIN,
  GOOGLE_SOURCE_SCOPES,
  consentResultPage,
  consentUrl,
  exchangeCode,
  rawIpCallbackRefusal,
} from './google-consent.ts';

const PENDING = {
  clientId: 'cid',
  clientSecret: 'shh',
  scope: GOOGLE_SOURCE_SCOPES['google-contacts'],
  redirectUri: 'https://api.example.nl/api/migrations/google/callback',
};

describe('the state: signed, single-use, expiring', () => {
  it('round-trips once and EXACTLY once — the second take finds nothing', () => {
    const store = new ConsentFlowStore();
    const state = store.begin(PENDING);
    expect(store.take(state)?.clientSecret).toBe('shh');
    expect(store.take(state)).toBeUndefined();
  });

  it('refuses a forged or reshaped state without revealing which check failed', () => {
    const store = new ConsentFlowStore();
    const state = store.begin(PENDING);
    const [id] = state.split('.');
    expect(store.take(`${id}.AAAA`)).toBeUndefined();
    expect(store.take(id!)).toBeUndefined();
    expect(store.take('')).toBeUndefined();
    expect(store.take('not-a-state')).toBeUndefined();
    // The tampering attempts must not have consumed the real one… but the
    // bare-id take shares the id, so single-use bookkeeping already removed
    // it — which is the SAFE failure: tampering burns the flow, never
    // completes it.
  });

  it('expires after its ten minutes, even when never used', () => {
    let now = 1_000_000;
    const store = new ConsentFlowStore(() => now);
    const state = store.begin(PENDING);
    now += CONSENT_STATE_TTL_MS + 1;
    expect(store.take(state)).toBeUndefined();
  });
});

describe('the consent URL: what must never be forgotten', () => {
  it('carries access_type=offline, prompt=consent, the one scope, and the state', () => {
    const url = new URL(
      consentUrl({ clientId: 'cid', scope: PENDING.scope, redirectUri: PENDING.redirectUri, state: 's.x' }),
    );
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('scope')).toBe(PENDING.scope);
    expect(url.searchParams.get('state')).toBe('s.x');
    expect(url.searchParams.get('response_type')).toBe('code');
  });

  it('never carries a client secret — the URL is the one place it must not be', () => {
    const url = consentUrl({
      clientId: 'cid',
      scope: PENDING.scope,
      redirectUri: PENDING.redirectUri,
      state: 's.x',
    });
    expect(url).not.toContain('secret');
  });

  it('asks ADDITIVELY, which a narrow ask cannot do without (0106 T1b)', () => {
    // Google replaces a grant with exactly what the newest consent asked for.
    // Without this parameter, somebody who has consented to mail and then
    // consents to calendar ends up holding calendar ONLY — a working mail
    // connection silently losing its scope at the moment a second domain was
    // added. Asking narrowly is only safe alongside asking additively, so
    // this belongs with `domainsToScopes`, not after it.
    const url = new URL(
      consentUrl({
        clientId: 'cid',
        scope: PENDING.scope,
        redirectUri: PENDING.redirectUri,
        state: 's.x',
      }),
    );
    expect(url.searchParams.get('include_granted_scopes')).toBe('true');
  });
});

describe('one scope table, not two (0106 T1b)', () => {
  it('every source type asks for ITS OWN domain, not a neighbour\'s', () => {
    // The collapse this replaced had four scope strings written out here and
    // four more written out in `account-qualification.ts`, which reads the
    // same scopes back out of a token response. Two copies disagree in
    // exactly one way — the product asks for one scope and then judges the
    // resulting grant against another — and the symptom is a connection that
    // consents successfully and then qualifies as `no`.
    //
    // So this asserts the mapping domain by domain, against the same
    // authority the qualification reads. A wrong wire here (gmail → the
    // calendar scope) is red, where a second literal table would just be
    // quietly different.
    for (const [source, domain] of Object.entries(GOOGLE_SOURCE_DOMAIN)) {
      expect(GOOGLE_SOURCE_SCOPES[source as keyof typeof GOOGLE_SOURCE_SCOPES]).toBe(
        GOOGLE_SCOPES_ASKED_BY_DOMAIN[domain],
      );
    }
  });

  it('asks Drive READ-ONLY, the whole reason the two fields are separate', () => {
    expect(GOOGLE_SOURCE_SCOPES['google-drive']).toBe(
      'https://www.googleapis.com/auth/drive.readonly',
    );
  });

  it('covers every source type — a fifth one cannot arrive unmapped', () => {
    expect(Object.keys(GOOGLE_SOURCE_DOMAIN).sort()).toEqual(
      Object.keys(GOOGLE_SOURCE_SCOPES).sort(),
    );
  });
});

describe('the exchange: granted is read, never assumed', () => {
  const exchange = (json: unknown, ok = true, status = 200) =>
    exchangeCode(
      {
        code: 'the-code',
        clientId: 'cid',
        clientSecret: 'shh',
        redirectUri: PENDING.redirectUri,
        askedScope: PENDING.scope,
      },
      vi.fn(async () =>
        new Response(JSON.stringify(json), { status: ok ? status : 400 }),
      ) as unknown as typeof fetch,
    );

  it('hands back the refresh token when the grant covers the ask', async () => {
    const r = await exchange({ refresh_token: 'rt', scope: PENDING.scope });
    expect(r).toEqual({ ok: true, refreshToken: 'rt', grantedScopes: [PENDING.scope] });
  });

  it('a NARROWER grant refuses with the missing scope named — never stores a token that fails later', async () => {
    const r = await exchange({ refresh_token: 'rt', scope: 'https://www.googleapis.com/auth/userinfo.email' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain(PENDING.scope);
      expect(r.reason).toContain('granted less than was asked');
    }
  });

  it('the broader Drive scope satisfies the read-only ask — over-receiving is reported, not refused', async () => {
    const r = await exchangeCode(
      {
        code: 'c',
        clientId: 'cid',
        clientSecret: 'shh',
        redirectUri: PENDING.redirectUri,
        askedScope: 'https://www.googleapis.com/auth/drive.readonly',
      },
      vi.fn(async () =>
        new Response(
          JSON.stringify({ refresh_token: 'rt', scope: 'https://www.googleapis.com/auth/drive' }),
        ),
      ) as unknown as typeof fetch,
    );
    expect(r.ok).toBe(true);
  });

  it('an answer without a refresh token is a refusal with the policy cause named', async () => {
    const r = await exchange({ scope: PENDING.scope });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('without a refresh token');
  });

  it("a refused exchange carries Google's status and words, and never the secret", async () => {
    const r = await exchange({ error: 'invalid_client' }, false);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain('400');
      expect(r.reason).toContain('invalid_client');
      expect(r.reason).not.toContain('shh');
    }
  });
});

describe('a raw-IP callback refuses with the two ways out named (0089 T6)', () => {
  const cb = (host: string) => `https://${host}:3123/api/migrations/google/callback`;

  it('refuses the appliance-at-a-bare-address case, naming the port-forward AND the hostname shape', () => {
    const refusal = rawIpCallbackRefusal(cb('100.97.25.131'));
    expect(refusal).toContain('raw IP address');
    expect(refusal).toContain('http://localhost:<port>');
    expect(refusal).toContain('hostname under a domain you own');
    expect(refusal).toContain('paste-a-token path keeps working');
  });

  it('refuses an IPv6 literal the same way', () => {
    expect(rawIpCallbackRefusal(cb('[fd7a::1234]'))).toContain('raw IP address');
  });

  it('permits loopback — Google does, and the port-forward remedy depends on it', () => {
    expect(rawIpCallbackRefusal('http://localhost:3124/api/migrations/google/callback')).toBeNull();
    expect(rawIpCallbackRefusal('http://127.0.0.1:3124/api/migrations/google/callback')).toBeNull();
    expect(rawIpCallbackRefusal('http://[::1]:3124/api/migrations/google/callback')).toBeNull();
  });

  it('permits a hostname — the objection is to the IP literal, not the network', () => {
    expect(rawIpCallbackRefusal(cb('app.example.nl'))).toBeNull();
  });
});

describe('the result page: one origin, no leaks', () => {
  const OK = { ok: true as const, refreshToken: 'rt-123', grantedScopes: [PENDING.scope] };

  it('posts the token to the configured web origin and NEVER to *', () => {
    const page = consentResultPage({ webOrigin: 'https://app.example.nl', outcome: OK });
    expect(page).toContain('postMessage');
    expect(page).toContain('app.example.nl');
    expect(page).not.toMatch(/postMessage\([^)]*['"]\*['"]/);
  });

  it('without a web origin it degrades to copy-paste — no postMessage at all', () => {
    const page = consentResultPage({ outcome: OK });
    expect(page).not.toContain('postMessage');
    expect(page).toContain('rt-123');
  });

  it('a token that tries to close the script block stays inert', () => {
    const sly = { ...OK, refreshToken: '</script><script>alert(1)</script>' };
    const page = consentResultPage({ webOrigin: 'https://app.example.nl', outcome: sly });
    expect(page).not.toContain('</script><script>alert(1)');
  });

  it('an error page carries the reason and no token machinery', () => {
    const page = consentResultPage({
      webOrigin: 'https://app.example.nl',
      outcome: { ok: false, reason: 'Google reported: access_denied.' },
    });
    expect(page).toContain('access_denied');
    expect(page).not.toContain('postMessage');
  });
});
