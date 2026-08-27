// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The page a migrated person lands on (workplan 0108 T4, ADR-0035).
 *
 * The only screen in this product whose reader has no account, no session and
 * no reason to trust us — somebody's colleague, doing a favour, following a
 * link a person they know sent them. So it is written for that reader and not
 * for an operator: no chrome, no navigation, no jargon, and every sentence in
 * the second person.
 *
 * ## What it must say before the button, and why
 *
 * **Who is asking.** Consenting to an anonymous request is not consenting. The
 * organisation's name comes from the server, so the page cannot be made to
 * claim somebody else asked.
 *
 * **What will be read, and that it is read-only.** In plain words AND as the
 * scope Google itself will record (ADR-0041's operative rule: the scopes are
 * shown as scopes). The plain sentence is what a person understands; the scope
 * string is what they can check afterwards in their own account, and one
 * without the other is either vague or unreadable.
 *
 * **Until when.** The link's own validity, in a date. An expiry that lands
 * mid-intention — after somebody has cleared ten minutes to do this — is a
 * small betrayal that costs an afternoon.
 *
 * **The privacy policy and terms, before any redirect.** This is the in-product
 * disclosure Google's verification requires, and it belongs where a person can
 * still walk away.
 *
 * ## What it must never do
 *
 * Never show a token, never receive one, never postMessage. The refresh token
 * is stored server-side and this page's success state is a boolean — see
 * `grantResultPage` in the API, which cannot render a token because its
 * signature has nowhere to put one.
 */

import React from 'react';
import { useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { grantApi } from '../services/grant-service.ts';
import { serverMessage } from '../services/api.ts';
import { useT, useFormatters } from '../i18n/index.tsx';
import BuildStamp from '../components/BuildStamp.tsx';

const Grant: React.FC = () => {
  const { link } = useParams<{ link: string }>();
  const t = useT();
  const { dateTime } = useFormatters();
  const [starting, setStarting] = React.useState(false);
  const [failure, setFailure] = React.useState('');

  const subject = useQuery({
    queryKey: ['grant', link],
    queryFn: () => grantApi.read(link!),
    enabled: Boolean(link),
    retry: false,
  });

  const connect = async () => {
    if (!link) return;
    setStarting(true);
    setFailure('');
    try {
      const { url } = await grantApi.authorize(link);
      // A full navigation, not a popup: there is no wizard window behind this
      // page to hand anything back to, and a popup blocked by the browser
      // would look exactly like a button that does nothing.
      globalThis.location.assign(url);
    } catch (err) {
      setFailure(serverMessage(err));
      setStarting(false);
    }
  };

  return (
    <main className="max-w-xl mx-auto px-6 py-12">
      <h1 className="text-xl font-semibold text-gray-900">{t('grant.title')}</h1>

      {subject.isPending && <p className="mt-4 text-sm text-gray-600">{t('grant.loading')}</p>}

      {subject.error != null && (
        // The server's own sentence, verbatim: every refusal here is written to
        // be forwarded to the person who sent the link, and rewording it would
        // lose the half that says what to tell them.
        <p className="mt-4 text-sm text-amber-800">{serverMessage(subject.error)}</p>
      )}

      {subject.data && (
        <>
          <p className="mt-4 text-gray-900">
            {t('grant.asking', { organisation: subject.data.organisation })}
          </p>
          <p className="mt-3 text-gray-900">{t('grant.reads', { reads: subject.data.reads })}</p>

          <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg">
            <p className="flex items-start gap-2 text-sm text-green-900">
              <ShieldCheck className="w-5 h-5 flex-shrink-0" />
              <span>{t('grant.readOnly')}</span>
            </p>
          </div>

          <p className="mt-4 text-sm text-gray-600">{t('grant.scopeIntro')}</p>
          <p className="mt-1 text-sm font-mono break-all text-gray-900">{subject.data.scope}</p>

          <p className="mt-4 text-sm text-gray-600">
            {t('grant.until', { date: dateTime(subject.data.expiresAt) })}
          </p>

          <button
            type="button"
            onClick={connect}
            disabled={starting}
            className="mt-6 px-4 py-2.5 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {starting ? t('grant.connecting') : t('grant.connect')}
          </button>

          {failure && <p className="mt-3 text-sm text-amber-800">{failure}</p>}

          <p className="mt-6 text-sm text-gray-500">
            {t('grant.disclosure')}{' '}
            <a className="underline" href="https://www.ownpace.eu/privacy">
              {t('grant.privacy')}
            </a>{' '}
            <a className="underline" href="https://www.ownpace.eu/terms">
              {t('grant.terms')}
            </a>
          </p>
          <p className="mt-3 text-sm text-gray-500">{t('grant.withdraw')}</p>
        </>
      )}

      {/* Outside `Layout`, so the sidebar's stamp never reaches here — and this
          is the page whose reader is LEAST able to describe what they are
          looking at. "The link my colleague sent me does not work" is a support
          conversation that starts with which build they are on. See
          components/BuildStamp.tsx. */}
      <div className="mt-10 text-center">
        <BuildStamp />
      </div>
    </main>
  );
};

export default Grant;
