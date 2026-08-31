// Copyright 2026 The Ownpace authors (Apache-2.0)

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { LogIn } from 'lucide-react';
import { useAuthStore } from '../stores/auth-store.ts';
import { useT } from '../i18n/index.tsx';
import { beginSignIn, oidcConfig } from '../services/oidc.ts';
import { fetchAuthMode, type AuthMode } from '../services/auth-mode.ts';
import { fetchMe } from '../services/session.ts';
import { serverMessage } from '../services/api.ts';
import StatusLink from '../components/StatusLink.tsx';
import BuildStamp from '../components/BuildStamp.tsx';

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
  const [verifying, setVerifying] = useState(false);

  // Read once at render: this is a build-time value, and a page that could
  // change its mind about whether authentication exists would not be a
  // boundary (the reasoning `services/edition.ts` gives for the same choice).
  //
  // IT IS NO LONGER WHAT DECIDES WHAT IS OFFERED. It says what this BUILD can
  // start — an authorization-code flow needs an issuer and a client id, and
  // only the bundle has them. What the API will ACCEPT is a different question
  // with a different answer, asked below.
  const issuer = oidcConfig();

  /**
   * WHAT THIS DEPLOYMENT WILL ACCEPT, ASKED RATHER THAN ASSUMED (0102 T1).
   *
   * `null` while the answer is outstanding, and nothing is rendered in that
   * window on purpose: a page that shows the paste box and then removes it has
   * offered a way in that was never there, which is the flicker this whole task
   * is about.
   *
   * A FAILURE IS NOT A FALLBACK. If the API cannot be asked, the page says so
   * and offers neither — because on a managed stack the box is refused anyway,
   * so falling back to it would invent a way in rather than provide one. And
   * an API that cannot answer this is an API that cannot verify a token either.
   */
  const [authMode, setAuthMode] = useState<AuthMode | null>(null);
  const [modeError, setModeError] = useState<string | null>(null);

  useEffect(() => {
    // Guarded against a resolution after unmount: React 18's StrictMode mounts
    // this twice in development, and setting state on the dead one is a warning
    // in the console of the page somebody is debugging.
    let cancelled = false;
    void fetchAuthMode()
      .then((mode) => {
        if (!cancelled) setAuthMode(mode);
      })
      .catch((err: unknown) => {
        if (!cancelled) setModeError(serverMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

  /**
   * ASK THE SERVER BEFORE DECLARING A SESSION.
   *
   * The two checks below are worth keeping and were never enough. Decoding a
   * JWT says how it is SHAPED; only the API can say whether it will accept it,
   * and on a stack with an issuer configured the answer for a pasted seed token
   * is always no. `selectAuthMode` puts the API in managed mode the moment
   * `JWT_ISSUER` is set, and managed mode verifies against the provider's JWKS
   * and never falls back to `JWT_SECRET` — deliberately, so a lingering secret
   * cannot silently downgrade verification. A seed token is signed with that
   * secret. It is well-formed, unexpired, and unusable.
   *
   * This path used to log in on the strength of the decode alone, navigate to
   * the dashboard, and let the first real request discover the truth — where a
   * 401 sent the browser back here with nothing written on it. Reported from
   * the live test host on 2026-08-25: "with a valid seed, i see it fast
   * flashing and back at the login". The comment above the expiry check
   * describes that same bounce, for the one cause that CAN be seen client-side;
   * this is the rest of it.
   *
   * `fetchMe` also makes this path obey ADR-0042 like the other one: who
   * somebody is comes from `GET /api/me`, not from claims this decoder read.
   * Reading `tenantId` and `role` off the token was the pre-ADR-0042 design,
   * left behind here when the OIDC path replaced it.
   */
  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setTokenError(null);

    const pasted = token.trim();
    const claims = decodeTokenClaims(pasted);
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

    setVerifying(true);
    void (async () => {
      try {
        // `fetchMe` goes through `signInClient`, so a refusal REJECTS here
        // instead of redirecting to this very page — see api.ts.
        const me = await fetchMe(pasted);
        if (me.tenants.length === 0 && me.operator !== true) {
          // The same state AuthCallback names, reached the same way. Routing
          // for invitations is deliberately not duplicated here: an invitation
          // binds on a verified email from the provider, which is not something
          // a pasted seed token carries.
          setTokenError(t('login.noOrganisation'));
          return;
        }
        const email = me.email ?? me.userId;
        loginToStore(
          pasted,
          {
            id: me.userId,
            email,
            name: email.split('@')[0],
            role: me.role ?? 'member',
          },
          me.tenantId ?? '',
          me.operator === true,
          me.tenants.length,
        );
        // THE SAME LANDING AuthCallback CHOOSES, and for the same reason: a
        // platform operator belongs to no organisation by design, so the
        // dashboard's first request 403s. This door was left sending them
        // there — the refusal above only covers a NON-operator with no
        // organisation — so the one person who can answer the queue reached it
        // by being thrown out of a screen that was never theirs.
        void navigate(me.tenants.length === 0 ? '/access-requests' : '/dashboard');
      } catch (err: unknown) {
        // The API's own sentence — "Invalid token" and "Token expired" are
        // different problems with different remedies, and on a stack with an
        // issuer the answer names the real one.
        setTokenError(serverMessage(err));
      } finally {
        setVerifying(false);
      }
    })();
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
          disabled={verifying}
          className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
        >
          {verifying ? t('login.verifying') : t('login.submit')}
        </button>
      </div>

      <div className="text-center text-sm text-gray-600">
        <p>
          {t('login.help.pre')} (<code>./deploy/compose/seed-managed.sh</code>){' '}
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

        {modeError !== null ? (
          <p role="alert" className="mt-8 text-sm text-red-600">
            {t('login.modeUnavailable')} {modeError}
          </p>
        ) : authMode === null ? (
          <p className="mt-8 text-center text-sm text-gray-500">{t('login.checking')}</p>
        ) : (
          <>
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

            {/* THE STATE #562 LEFT BEHIND, NAMED. The API is in managed mode —
                so a seed token is refused — and this build was never given the
                issuer's address, so there is no button either. Falling back to
                the box here would offer a credential this API will not take;
                an empty screen would say nothing at all. */}
            {!authMode.acceptsSeedToken && !issuer && (
              <p role="alert" className="mt-8 text-sm text-red-600">
                {t('login.providerNotBuilt')}
              </p>
            )}

            {/* THE BOX APPEARS ONLY WHERE THE API WILL TAKE WHAT IT HOLDS. It
                used to appear whenever the BUNDLE had no issuer, which is a
                different question with a different answer — and on a stack
                where they disagreed it accepted a token, signed somebody in,
                and bounced them straight back here. */}
            {authMode.acceptsSeedToken &&
              (issuer ? (
                <details className="mt-6">
                  <summary className="cursor-pointer text-sm text-gray-500 hover:text-gray-700">
                    {t('login.pasteToggle')}
                  </summary>
                  <p className="mt-2 text-xs text-gray-500">{t('login.pasteFallback')}</p>
                  {tokenForm}
                </details>
              ) : (
                tokenForm
              ))}
          </>
        )}

        {/* Outside `Layout`, so the sidebar's stamp never reaches this page —
            and this is a page somebody sees BEFORE they are inside the app,
            which makes it where "what build is this?" gets asked most. See
            components/BuildStamp.tsx. */}
        {/* The status link belongs HERE above all: somebody who cannot sign
            in is the person asking "is it me or is it them". */}
        <div className="text-center space-y-2">
          <div>
            <StatusLink />
          </div>
          <BuildStamp />
        </div>
      </div>
    </div>
  );
};

export default Login;
