// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Where the issuer sends the browser back (ADR-0042).
 *
 * Three things happen here and the order matters: the code is exchanged (which
 * checks the state first — see `completeSignIn`), then `GET /api/me` answers
 * who this is and which organisation they may act on, and only then does a
 * session exist. A token alone is not a session: it proves who signed in, and
 * `tenant_member` decides what that means.
 *
 * It renders almost nothing on purpose. This is a redirect target somebody is
 * passing through, and the only states worth drawing are "working on it" and
 * "it did not work, here is what the service said".
 */
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { completeSignIn } from '../services/oidc.ts';
import { fetchMe } from '../services/session.ts';
import { useAuthStore } from '../stores/auth-store.ts';
import { useT } from '../i18n/index.tsx';

const AuthCallback: React.FC = () => {
  const t = useT();
  const navigate = useNavigate();
  const loginToStore = useAuthStore((s) => s.login);
  const [error, setError] = useState<string | null>(null);

  // React 18's StrictMode mounts effects twice in development, and an
  // authorization code is single-use — the second exchange would fail and show
  // an error over a sign-in that actually worked.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    void (async () => {
      try {
        const token = await completeSignIn(globalThis.location.search);
        const me = await fetchMe(token);

        // The sidebar shows `name` and `email`; `Login.tsx` derives the display
        // name from the local part, and this does the same so the two ways in
        // produce the same header. The subject is the fallback rather than the
        // default — it is an opaque id and reads as one.
        const email = me.email ?? me.userId;
        loginToStore(
          token,
          {
            id: me.userId,
            email,
            name: email.split('@')[0],
            role: me.role ?? 'member',
          },
          me.tenantId ?? '',
        );
        void navigate('/dashboard', { replace: true });
      } catch (err) {
        // The service's own sentence, verbatim where there is one. "Sign-in
        // failed" tells somebody nothing they can act on; `access_denied` or
        // "did not start in this browser tab" tells them what to do next.
        setError(err instanceof Error ? err.message : t('login.callback.failed'));
      }
    })();
  }, [loginToStore, navigate, t]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="max-w-md w-full text-center space-y-4">
        {error === null ? (
          <p className="text-sm text-gray-600">{t('login.callback.working')}</p>
        ) : (
          <>
            <h2 className="text-xl font-semibold text-gray-900">{t('login.callback.failed')}</h2>
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
            <button
              type="button"
              onClick={() => void navigate('/login', { replace: true })}
              className="text-sm text-blue-600 hover:text-blue-500"
            >
              {t('login.callback.again')}
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default AuthCallback;
