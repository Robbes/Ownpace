// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The front door somebody can actually knock on (workplan 0093 T3).
 *
 * **Why this lives in the app and not on the website.** The obvious home for a
 * request form is `www.ownpace.eu`, and it cannot go there: the site is served
 * with `default-src 'none'; … form-action 'none'` (`www-nginx.conf`), which is
 * a deliberate hardening of a document that has no scripts and submits nowhere.
 * Putting a form on it would mean relaxing that CSP for every page. The app
 * already has JS, an API client and form plumbing, and the request page belongs
 * beside the sign-in page anyway — they are the same front door, one for people
 * who have an account and one for people who do not. So the site's call to
 * action becomes a LINK here, and its CSP does not move.
 *
 * Managed-only, like `/login`: an appliance has an owner who already has it.
 */
import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Mail } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import apiClient from '../services/api.ts';
import { useT, useLocale } from '../i18n/index.tsx';
import BuildStamp from '../components/BuildStamp.tsx';

/**
 * ADR-0014's five, by name only.
 *
 * Deliberately NOT imported from `@openmig/managed`'s pricing: this is a text
 * field a person fills in as a guess, the server stores it verbatim without
 * validating it, and a build-time coupling to the price table would make a
 * rename of a tier a code change on both sides for no gain. The tier that gets
 * BILLED is derived from what actually runs (ADR-0014) and never from this.
 */
const TIERS = ['Tiny', 'Small', 'Medium', 'Large', 'Extra large'] as const;

interface AccessRequestBody {
  email: string;
  name?: string;
  organisation?: string;
  note?: string;
  tier?: string;
  locale: string;
}

const RequestAccess: React.FC = () => {
  const t = useT();
  const { locale } = useLocale();
  const [search] = useSearchParams();
  /**
   * Pre-filled from `?email=` when somebody arrived from the dead end at the
   * end of a good sign-in — see `services/no-organisation.ts`.
   *
   * NOT matched against a list, the way `tier` below is, because there is no
   * list an address could be matched against. What makes that safe is that
   * this is a visible text field the person reads and edits before sending,
   * `type="email"` refuses an obvious non-address, and the server validates it
   * again on arrival. What it BUYS is more than a saved retype: it shows which
   * identity signed in, which a social button can get wrong silently.
   */
  const [email, setEmail] = useState(() => search.get('email')?.trim() ?? '');
  const [name, setName] = useState('');
  const [organisation, setOrganisation] = useState('');
  const [note, setNote] = useState('');
  /**
   * Pre-filled from `?tier=` when the visitor got here by clicking "Start with
   * Medium" on the pricing page — asking them the same question twice is how a
   * form loses somebody. Matched against the list rather than trusted: this
   * value is in a URL anybody can edit, and an unrecognised one simply leaves
   * the field on "not sure yet" rather than putting a stranger's text in a
   * select.
   */
  const [tier, setTier] = useState(() => {
    const asked = search.get('tier');
    return TIERS.find((name) => name.toLowerCase() === asked?.toLowerCase()) ?? '';
  });

  const send = useMutation({
    mutationFn: async () => {
      const body: AccessRequestBody = { email: email.trim(), locale };
      // Sent only when filled: an empty string is not the same as "left blank",
      // and the column is nullable precisely so the difference survives.
      if (name.trim()) body.name = name.trim();
      if (organisation.trim()) body.organisation = organisation.trim();
      if (note.trim()) body.note = note.trim();
      if (tier) body.tier = tier;
      return (await apiClient.post('/access-requests', body)).data;
    },
  });

  const field =
    'appearance-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 ' +
    'text-gray-900 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm';
  const label = 'block text-sm font-medium text-gray-700 mb-1';
  const hint = 'mt-1 text-xs text-gray-500';

  if (send.isSuccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4">
        <div className="max-w-md w-full text-center space-y-4">
          <h2 className="text-2xl font-extrabold text-gray-900">{t('access.sent')}</h2>
          <p className="text-sm text-gray-600">{t('access.sentDetail')}</p>
          <Link to="/login" className="inline-block text-sm text-blue-600 hover:text-blue-500">
            {t('access.backToSignIn')}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <div className="flex justify-center">
            <div className="w-16 h-16 bg-blue-600 rounded-lg flex items-center justify-center">
              <Mail className="w-10 h-10 text-white" />
            </div>
          </div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            {t('access.title')}
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">{t('access.intro')}</p>
        </div>

        <form
          className="mt-8 space-y-6"
          onSubmit={(e) => {
            e.preventDefault();
            send.mutate();
          }}
        >
          <div>
            <label htmlFor="email" className={label}>
              {t('access.email')}
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={field}
            />
            <p className={hint}>{t('access.emailHint')}</p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="name" className={label}>
                {t('access.name')}{' '}
                <span className="font-normal text-gray-400">({t('access.optional')})</span>
              </label>
              <input
                id="name"
                name="name"
                type="text"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={field}
              />
            </div>
            <div>
              <label htmlFor="organisation" className={label}>
                {t('access.organisation')}{' '}
                <span className="font-normal text-gray-400">({t('access.optional')})</span>
              </label>
              <input
                id="organisation"
                name="organisation"
                type="text"
                autoComplete="organization"
                value={organisation}
                onChange={(e) => setOrganisation(e.target.value)}
                className={field}
              />
            </div>
          </div>

          <div>
            <label htmlFor="note" className={label}>
              {t('access.note')}
            </label>
            <textarea
              id="note"
              name="note"
              rows={4}
              maxLength={2000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className={field}
            />
            <p className={hint}>{t('access.noteHint')}</p>
          </div>

          <div>
            <label htmlFor="tier" className={label}>
              {t('access.tier')}{' '}
              <span className="font-normal text-gray-400">({t('access.optional')})</span>
            </label>
            <select
              id="tier"
              name="tier"
              value={tier}
              onChange={(e) => setTier(e.target.value)}
              className={field}
            >
              <option value="">{t('access.tierUnsure')}</option>
              {TIERS.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <p className={hint}>{t('access.tierHint')}</p>
          </div>

          {send.isError && (
            <p role="alert" className="text-sm text-red-600">
              {t('access.failed')}{' '}
              {/* The server's own sentence, verbatim where there is one — a 429
                  says how long to wait, and paraphrasing it would lose that. */}
              {send.error instanceof Error ? send.error.message : t('access.failedFallback')}
            </p>
          )}

          <button
            type="submit"
            disabled={send.isPending || email.trim() === ''}
            className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
          >
            {send.isPending ? t('access.sending') : t('access.submit')}
          </button>

          <p className="text-xs text-gray-500">{t('access.privacy')}</p>
          <p className="text-center">
            <Link to="/login" className="text-sm text-blue-600 hover:text-blue-500">
              {t('access.backToSignIn')}
            </Link>
          </p>
        </form>

        {/* Outside `Layout`, so the sidebar's stamp never reaches this page —
            and this is a page somebody sees BEFORE they are inside the app,
            which makes it where "what build is this?" gets asked most. See
            components/BuildStamp.tsx. */}
        <div className="text-center">
          <BuildStamp />
        </div>
      </div>
    </div>
  );
};

export default RequestAccess;
