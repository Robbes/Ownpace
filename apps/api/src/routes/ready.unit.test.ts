// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Readiness (workplan 0094 T1).
 *
 * Two properties, and the second is the one that would be embarrassing:
 *
 *  1. **Degraded is not down.** The database failing means nothing can be
 *     served; the identity provider failing means new sign-ins fail while
 *     everybody already inside carries on. Collapsing those into one word
 *     either cries wolf or hides an outage, and which one it does depends on
 *     which way you collapse it.
 *  2. **It publishes states, never reasons.** This endpoint is reachable
 *     without a credential — a status page has to be able to read it — so an
 *     error string in the body is an internal hostname published to whoever
 *     asks. The reason goes to the log.
 */

import { describe, it, expect } from 'vitest';
import { rollUp, signInProbeUrl } from './ready.ts';

describe('rolling components up into one word', () => {
  it('is ok when everything is up', () => {
    expect(rollUp({ database: 'up', signIn: 'up' })).toBe('ok');
  });

  it('is DOWN when the database is, whatever else is fine', () => {
    // The one check that can say down: no request can be served without it.
    expect(rollUp({ database: 'down', signIn: 'up' })).toBe('down');
  });

  it('is DEGRADED when sign-in is down but the database is not', () => {
    // Orange, not red. Existing sessions keep working — telling the world the
    // service is down would be false, and false in the direction that costs
    // trust at a product whose whole promise is that somebody is looking after
    // your mail.
    expect(rollUp({ database: 'up', signIn: 'down' })).toBe('degraded');
  });

  it('treats "not configured" as neither up nor broken', () => {
    // Self-host has no issuer, and a managed deployment before the identity
    // setup script is in a documented state rather than a failure.
    expect(rollUp({ database: 'up', signIn: 'off' })).toBe('ok');
  });

  it('prefers down over degraded when both are true', () => {
    expect(rollUp({ database: 'down', signIn: 'down' })).toBe('down');
  });
});

describe('what the body may contain', () => {
  it('carries states and nothing that names our infrastructure', async () => {
    // Asserted against the SOURCE rather than a live response, because the
    // failure this guards against only appears when something is broken —
    // which is exactly when nobody is reading the test. A `detail`, `message`
    // or `error` field added later would sail through a green suite.
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const source = readFileSync(fileURLToPath(new URL('./ready.ts', import.meta.url)), 'utf8');

    const responded = source.slice(source.indexOf('const handler'));
    for (const leak of ['error.message', 'String(error)', 'detail:', 'reason:']) {
      expect(responded, `the readiness body must not carry ${leak}`).not.toContain(leak);
    }
    // And the reasons do go somewhere — just not to the caller.
    expect(source).toContain('log.error');
  });
});

describe('where the sign-in check asks', () => {
  /**
   * `middleware/auth.ts` resolves the key source as
   * `JWT_JWKS_URI || discoverJwksUri(JWT_ISSUER)`. Readiness has to ask in the
   * same order or it reports on an address no request uses.
   *
   * That is not hypothetical. On a stack where something fronts the provider,
   * `JWT_ISSUER` is a public https name that the API container CANNOT reach —
   * compose gives the provider a network alias of exactly that name, so it
   * resolves to the container and the probe asks for 443 where nothing listens.
   * `JWT_JWKS_URI` exists for that case, and a readiness check that ignored it
   * answered `signIn: down` for a sign-in that worked perfectly.
   */
  const withEnv = (env: Record<string, string | undefined>, fn: () => void): void => {
    const before = { ...process.env };
    try {
      for (const [k, v] of Object.entries(env)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      fn();
    } finally {
      process.env = before;
    }
  };

  it('uses the configured key source when there is one', () => {
    withEnv({ JWT_JWKS_URI: 'http://ownpace-idp:3126/oauth/v2/keys' }, () => {
      expect(signInProbeUrl('https://id.example.com')).toBe(
        'http://ownpace-idp:3126/oauth/v2/keys',
      );
    });
  });

  it('falls back to the issuer when there is not', () => {
    withEnv({ JWT_JWKS_URI: undefined }, () => {
      expect(signInProbeUrl('https://id.example.com')).toBe(
        'https://id.example.com/.well-known/openid-configuration',
      );
    });
  });

  it('treats whitespace as unset, because an env file will hand it whitespace', () => {
    // `JWT_JWKS_URI=` with a trailing space is not a URL, and probing '' would
    // be an immediate failure reported as the provider being down.
    withEnv({ JWT_JWKS_URI: '   ' }, () => {
      expect(signInProbeUrl('https://id.example.com')).toBe(
        'https://id.example.com/.well-known/openid-configuration',
      );
    });
  });

  it('does not double the slash on an issuer that carries one', () => {
    withEnv({ JWT_JWKS_URI: undefined }, () => {
      expect(signInProbeUrl('https://id.example.com/')).toBe(
        'https://id.example.com/.well-known/openid-configuration',
      );
    });
  });
});
