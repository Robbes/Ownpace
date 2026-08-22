// Copyright 2026 The Ownpace authors (Apache-2.0)

import React, { useState } from 'react';
import { useNavigate } from 'react-router';
import { LogIn } from 'lucide-react';
import { useAuthStore } from '../stores/auth-store.ts';
import { useT } from '../i18n/index.tsx';
import { beginSignIn, oidcConfig } from '../services/oidc.ts';

interface TokenClaims {
  sub: string;
  email: string;
  tenantId: string;
  role: string;
  /** Seconds since epoch; optional — a token without exp never expires here. */
  exp?: number;
}

/**
 * Decode a JWT payload (no verification — the API verifies the signature on
 * every request). Returns the tenant/user claims the app needs, or null if the
 * token is malformed or missing required claims.
 */
export function decodeTokenClaims(token: string): TokenClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '='));
    const claims = JSON.parse(json) as Partial<TokenClaims>;
    if (!claims.sub || !claims.email || !claims.tenantId || !claims.role) return null;
    return claims as TokenClaims;
  } catch {
    return null;
  }
}

/**
 * Managed-edition sign-in (ADR-0042).
 *
 * **This was a textarea.** The whole of sign-in was: the owner runs
 * `seed-managed.sh`, emails somebody a JWT that expires in seven days, and they
 * paste it in here. That is now the fallback rather than the flow — when an
 * issuer is configured, this is a button that starts authorization-code + PKCE
 * against it.
 *
 * THE PASTE BOX STAYS, and is not vestigial. A deployment that has not run the
 * identity setup script yet has no issuer, and taking away the only way in
 * before the replacement is configured would strand it. So the page renders
 * whichever is actually available — an empty screen with no explanation is the
 * worst version of this.
 *
 * But it stays FOLDED AWAY once there is a provider, behind a disclosure and
 * under its own label. Two buttons both reading "Sign in", one starting the
 * real flow and one submitting a pasted token, is a coin toss rather than a
 * choice — and a token field on the front page of a product about custody is
 * the wrong first impression besides.
 *
 * Either way the token is stored and sent as `Authorization: Bearer` on every
 * API call, where it is signature-verified server-side.
 */
const Login: React.FC = () => {
  const t = useT();
  const navigate = useNavigate();
  const loginToStore = useAuthStore((s) => s.login);
  const [token, setToken] = useState('');
  // Two paths, two errors. One shared `error` put the same sentence under both
  // buttons — and two elements with role="alert" for one failure is a screen
  // reader saying it twice.
  const [oidcError, setOidcError] = useState<string | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);

  // Read once at render: this is a build-time value, and a page that could
  // change its mind about whether authentication exists would not be a
  // boundary (the reasoning `services/edition.ts` gives for the same choice).
  const issuer = oidcConfig();

  const startSignIn = () => {
    setOidcError(null);
    setRedirecting(true);
    void beginSignIn().catch((err: unknown) => {
      setRedirecting(false);
      // The service's own sentence — "could not sign in" is not actionable,
      // and the usual causes here (a wrong issuer URL, a provider that is still
      // starting) each say so plainly.
      setOidcError(err instanceof Error ? err.message : t('login.oidcFailed'));
    });
  };

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setTokenError(null);

    const claims = decodeTokenClaims(token.trim());
    if (!claims) {
      setTokenError(t('login.invalidToken'));
      return;
    }
    // Say "expired" at paste time (release-readiness, 2026-08-10): an expired
    // token used to "log in" here and then 401 on the first real call — the
    // user saw a dashboard flash and a bounce back to this screen, with no
    // sentence naming the actual problem. exp is seconds since epoch.
    if (typeof claims.exp === 'number' && claims.exp * 1000 <= Date.now()) {
      setTokenError(t('login.expiredToken'));
      return;
    }

    loginToStore(
      token.trim(),
      {
        id: claims.sub,
        email: claims.email,
        name: claims.email.split('@')[0],
        role: claims.role,
      },
      claims.tenantId,
    );
    void navigate('/dashboard');
  };

  // Held as an element rather than duplicated, because it renders in two
  // places: on its own when there is no provider, and inside the disclosure
  // when there is.
  const tokenForm = (
    <form className="mt-8 space-y-6" onSubmit={handleLogin}>
      <div>
        <label htmlFor="token" className="block text-sm font-medium text-gray-700 mb-1">
          {t('login.tokenLabel')}
        </label>
        <textarea
          id="token"
          name="token"
          required
          rows={4}
          value={token}
          onChange={(e) => setToken(e.target.value)}
          className="appearance-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm font-mono"
          placeholder="eyJhbGciOi..."
        />
      </div>

      {tokenError && (
        <p role="alert" className="text-sm text-red-600">
          {tokenError}
        </p>
      )}

      <div>
        <button
          type="submit"
          className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
        >
          {t('login.submit')}
        </button>
      </div>

      <div className="text-center text-sm text-gray-600">
        <p>
          {t('login.help.pre')} (<code>pnpm --filter @openmig/api seed:managed</code>){' '}
          {t('login.help.post')}
        </p>
      </div>
    </form>
  );

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <div className="flex justify-center">
            <div className="w-16 h-16 bg-blue-600 rounded-lg flex items-center justify-center">
              <LogIn className="w-10 h-10 text-white" />
            </div>
          </div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            {t('login.title')}
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">{t('login.tagline')}</p>
        </div>

        {issuer && (
          <div className="mt-8 space-y-3">
            <button
              type="button"
              onClick={startSignIn}
              disabled={redirecting}
              className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
            >
              {redirecting ? t('login.redirecting') : t('login.withProvider')}
            </button>
            {oidcError !== null && (
              <p role="alert" className="text-sm text-red-600">
                {oidcError}
              </p>
            )}
          </div>
        )}

        {issuer ? (
          <details className="mt-6">
            <summary className="cursor-pointer text-sm text-gray-500 hover:text-gray-700">
              {t('login.pasteToggle')}
            </summary>
            <p className="mt-2 text-xs text-gray-500">{t('login.pasteFallback')}</p>
            {tokenForm}
          </details>
        ) : (
          tokenForm
        )}
      </div>
    </div>
  );
};

export default Login;
