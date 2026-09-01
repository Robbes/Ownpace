// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Every address this deployment needs registered somewhere else (2026-09-01).
 *
 * The owner registered the right Google callback, got `redirect_uri_mismatch`
 * anyway because `API_URL` disagreed with it, and asked for the surface:
 * *"we will probably have more other callbacks… make the surface
 * understandable."*
 *
 * Four consoles, near-identical strings, and each wrong one produces the same
 * unhelpful sentence from a different vendor. This is the page you keep open in
 * a second tab while you are in Google's console.
 *
 * **The strings are DERIVED, never written down** — `redirectUris()` builds
 * each from the same variable the code uses, so what is on screen is what will
 * actually be requested. That is the whole reason this is a page and not a
 * document.
 *
 * **The entries with no URI are the point as much as the others.** "Dropbox,
 * Box, O365 — no redirect URI, and here is why" is what stops somebody hunting
 * a setting that does not exist.
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link2, AlertTriangle } from 'lucide-react';
import { redirectUriApi } from '../services/mapping-service.ts';
import type { RedirectUriEntry } from '../services/mapping-service.ts';
import { useT } from '../i18n/index.tsx';
import type { StringKey } from '../i18n/index.tsx';

const GROUP_HEADING: Record<string, StringKey> = {
  migration: 'redirects.group.migration',
  signIn: 'redirects.group.signIn',
  socialSignIn: 'redirects.group.socialSignIn',
};

const ORDER = ['migration', 'signIn', 'socialSignIn'] as const;

const RedirectUris: React.FC = () => {
  const t = useT();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['redirect-uris'],
    queryFn: redirectUriApi.get,
    retry: false,
  });

  const entries = data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Link2 className="w-6 h-6 text-gray-400" />
          {t('redirects.title')}
        </h1>
        <p className="mt-1 text-sm text-gray-600">{t('redirects.intro')}</p>
      </div>

      {isLoading && <p className="text-sm text-gray-500">{t('redirects.loading')}</p>}
      {isError && <p className="text-sm text-red-600">{t('redirects.failed')}</p>}

      {ORDER.map((group) => {
        const inGroup = entries.filter((e: RedirectUriEntry) => e.group === group);
        if (inGroup.length === 0) return null;
        return (
          <section key={group} className="space-y-3">
            <h2 className="text-lg font-medium text-gray-900">{t(GROUP_HEADING[group]!)}</h2>
            {inGroup.map((entry: RedirectUriEntry) => (
              <div key={entry.id} className="border border-gray-200 rounded-lg p-4 bg-white">
                <p className="text-sm font-medium text-gray-900">{entry.provider}</p>
                {entry.uri === null ? (
                  <p className="mt-2 text-sm text-gray-500">{t('redirects.none')}</p>
                ) : (
                  <code className="mt-2 block break-all rounded bg-gray-50 border border-gray-200 px-3 py-2 font-mono text-xs text-gray-900">
                    {entry.uri}
                  </code>
                )}
                {/* NEVER HIDDEN. A string built from a value nobody set is a
                    plausible wrong address, and a plausible wrong address
                    registered at a provider is worse than a gap — it fails
                    later, at somebody else's screen, for a reason that looks
                    like ours. */}
                {entry.unconfigured && (
                  <p className="mt-2 text-sm text-amber-800 flex items-start gap-1.5">
                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                    {t('redirects.unconfigured')}
                  </p>
                )}
                <p className="mt-2 text-sm text-gray-600">{entry.why}</p>
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
};

export default RedirectUris;
