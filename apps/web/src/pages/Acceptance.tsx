// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The texts, before anything else (workplan 0139 T3; the owner's decision of
 * 2026-09-28, terms-acceptance-route (b)).
 *
 * The owner: *"People that are accepted in the Alpha do need to create a login
 * for the app, accepting fits in there and should record what time/version the
 * accepted of what document."* So after the first sign-in, and before any
 * other page, this one: the Alpha conditions, the privacy policy and the
 * terms, each linked in the reader's language with its version, and one button
 * that accepts all three. The server records the version of each, the language
 * and the time (terms §1, Alpha conditions §2, privacy §4.4).
 *
 * It is shown by `AcceptanceGate`, in front of every signed-in page, whenever
 * `GET /api/me` says acceptance is due, so it appears again when a text gets a
 * new version, and an invited member (0099) meets it at their own first
 * sign-in, after joining. Outside `Layout`, like the invitation screen: the
 * sidebar would offer pages this person cannot use yet.
 *
 * The screen is the notice; the server's refusal of every door that stores a
 * credential (`conditions_not_accepted`) is what makes sure no access is kept
 * before it. Not accepting is allowed: *Not now* signs out, and nothing is
 * recorded.
 */

import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { FileText, Check } from 'lucide-react';
import { useLocale } from '../i18n/index.tsx';
import type { StringKey } from '../i18n/strings.ts';
import { legalUrl } from '../services/legal-links.ts';
import { serverMessage } from '../services/api.ts';
import {
  acceptTexts,
  isVersionNotCurrent,
  type Acceptance as AcceptanceState,
  type AcceptedDocument,
} from '../services/acceptance.ts';
import { useAuthStore } from '../stores/auth-store.ts';
import LanguageSwitch from '../components/LanguageSwitch.tsx';
import AlphaNote from '../components/AlphaNote.tsx';
import SupportLine from '../components/SupportLine.tsx';
import BuildStamp from '../components/BuildStamp.tsx';

/** Each text's name on the screen, in the reader's language. */
const NAME: Readonly<Record<AcceptedDocument, StringKey>> = {
  alpha: 'acceptance.doc.alpha',
  privacy: 'acceptance.doc.privacy',
  terms: 'acceptance.doc.terms',
};

const Acceptance: React.FC<{
  readonly acceptance: AcceptanceState;
  /** The state the server answered with, once recorded. */
  readonly onAccepted: (next: AcceptanceState) => void;
  /** The texts changed while the screen was open: read them again. */
  readonly onStale: () => void;
}> = ({ acceptance, onAccepted, onStale }) => {
  const { locale, t } = useLocale();
  const navigate = useNavigate();
  const logout = useAuthStore((s) => s.logout);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  // The page this person was going to is replaced by this one, so focus moves
  // to its heading and a screen reader announces where they are.
  useEffect(() => {
    heading.current?.focus();
  }, []);

  // Some texts accepted and some not: one of them has a new version since.
  const changed = acceptance.documents.some((d) => d.accepted);

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      onAccepted(await acceptTexts(acceptance.documents, locale));
    } catch (err) {
      if (isVersionNotCurrent(err)) {
        setError(t('acceptance.notCurrent'));
        onStale();
      } else {
        setError(serverMessage(err));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4 py-8">
      <div className="max-w-lg w-full space-y-6">
        <LanguageSwitch className="justify-end" />
        <div className="flex items-center gap-3">
          <FileText className="w-6 h-6 text-gray-500" aria-hidden="true" />
          <div>
            <h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold text-gray-900 focus:outline-none">
              {t('acceptance.title')}
            </h1>
            <p className="text-sm text-gray-600">{t('acceptance.lead')}</p>
          </div>
        </div>

        <AlphaNote />

        {changed && <p className="text-sm text-amber-800">{t('acceptance.changed')}</p>}

        <ul aria-label={t('acceptance.list')} className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-200">
          {acceptance.documents.map((d) => (
            <li key={d.document} className="p-4">
              <a
                href={legalUrl(d.document, locale)}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-blue-700 underline hover:text-blue-900 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded"
              >
                {t(NAME[d.document])}
                <span className="text-gray-600 font-normal">
                  {' · '}
                  {t('acceptance.version', { version: d.version })}
                </span>
                <span className="sr-only"> {t('acceptance.newTab')}</span>
              </a>
            </li>
          ))}
        </ul>

        <p className="text-sm text-gray-600">{t('acceptance.record')}</p>

        {error !== null && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void accept()}
            className="inline-flex items-center gap-1 px-4 py-2 text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
          >
            <Check className="w-4 h-4" aria-hidden="true" />
            {busy ? t('acceptance.accepting') : t('acceptance.accept')}
          </button>
          <button
            type="button"
            disabled={busy}
            // Nothing is recorded: the screen is here again at the next sign-in.
            onClick={() => {
              logout();
              void navigate('/login', { replace: true });
            }}
            className="inline-flex items-center px-3 py-2 text-sm text-gray-600 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-md disabled:opacity-50"
          >
            {t('acceptance.notNow')}
          </button>
        </div>

        <div className="text-center space-y-2">
          <SupportLine />
          <BuildStamp />
        </div>
      </div>
    </div>
  );
};

export default Acceptance;
