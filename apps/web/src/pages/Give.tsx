// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * *Give Ownpace* (workplan 0172; the owner, 2026-11-24, G1 and G3).
 *
 * A person in the Alpha makes their gift: a code for one person they care
 * about, on a card to print or save as a PDF. The code is shown ONCE, here,
 * right after it is made: only a fingerprint is kept, so nothing can show it
 * again, as with a grant link.
 *
 * **What leaves the browser, and what does not.** Making a gift sends the
 * card's language and nothing else (`makeGift`). The giver's name on the card
 * (prefilled from their own account, editable), the recipient's first name and
 * the message are typed into this page and printed with the card, and never
 * sent: the API refuses any field but the language, and the gift table has no
 * column for them (`a-gift-that-keeps-no-recipient.unit.test.ts`).
 *
 * **The card is in the language the giver picks**, which may not be the app's:
 * a Dutch giver may give to an English reader. So the card's words are read
 * from the dictionary in that language, not through `useT`.
 *
 * Below the card, the giver's gifts and each one's state, with *Revoke* on an
 * unused one. A revoked gift no longer counts toward the limit (0172 §7, 1).
 */
import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Gift as GiftIcon, Printer } from 'lucide-react';
import { useT, useLocale, type StringKey } from '../i18n/index.tsx';
import { STRINGS, type Locale } from '../i18n/strings.ts';
import { fill, type TemplateVars } from '../i18n/fill.ts';
import { serverMessage } from '../services/api.ts';
import { useAuthStore } from '../stores/auth-store.ts';
import {
  listMyGifts,
  makeGift,
  revokeMyGift,
  type GiftState,
  type MadeGift,
} from '../services/gifts.ts';

const STATE_KEY = {
  unused: 'give.state.unused',
  redeemed: 'give.state.redeemed',
  revoked: 'give.state.revoked',
  expired: 'give.state.expired',
} as const satisfies Record<GiftState, StringKey>;

/** Where the code is typed: the deployment's own address, or this browser's. */
const whereToRedeem = (made: MadeGift): string => made.redeemAt ?? `${window.location.origin}/redeem`;

/** The address as a person types it: no scheme. */
const typedAddress = (url: string): string => url.replace(/^https?:\/\//, '');

/** One of the card's words, in the card's language. */
const cardWord = (locale: Locale, key: StringKey, vars?: TemplateVars): string => fill(STRINGS[locale][key], vars);

/** A day as its reader names it, in their language: the card's, or the page's. */
const cardDay = (when: string, locale: Locale): string =>
  new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(new Date(when));

/** The card: what is printed. Everything on it but the code and the date is the giver's, and stays here. */
const GiftCard: React.FC<{
  made: MadeGift;
  locale: Locale;
  giver: string;
  recipient: string;
  message: string;
}> = ({ made, locale, giver, recipient, message }) => (
  <section
    className="gift-card mx-auto max-w-lg rounded-2xl border-2 border-site-teal bg-white p-8 shadow-sm space-y-4"
    lang={locale}
    aria-label={cardWord(locale, 'card.heading')}
  >
    <div className="flex items-center gap-3 text-site-teal">
      <GiftIcon className="h-8 w-8" aria-hidden="true" />
      <h2 className="text-2xl font-bold text-gray-900">
        {recipient.trim()
          ? cardWord(locale, 'card.headingFor', { name: recipient.trim() })
          : cardWord(locale, 'card.heading')}
      </h2>
    </div>
    {giver.trim() && <p className="text-gray-700">{cardWord(locale, 'card.from', { giver: giver.trim() })}</p>}
    {message.trim() && <p className="whitespace-pre-line italic text-gray-800">{message.trim()}</p>}
    <p className="text-sm text-gray-700">{cardWord(locale, 'card.what')}</p>
    <p className="text-sm text-gray-700">{cardWord(locale, 'card.alpha')}</p>
    <div className="rounded-lg bg-gray-50 p-4 text-center">
      <p className="text-xs uppercase tracking-wide text-gray-500">{cardWord(locale, 'card.code')}</p>
      <p className="mt-1 font-mono text-2xl font-bold tracking-widest text-gray-900" data-testid="gift-code">
        {made.code}
      </p>
      <p className="mt-2 text-sm text-gray-700">
        {cardWord(locale, 'card.where')}{' '}
        <span className="font-medium">{typedAddress(whereToRedeem(made))}</span>
      </p>
    </div>
    <p className="text-xs text-gray-500">{cardWord(locale, 'card.until', { date: cardDay(made.expiresAt, locale) })}</p>
  </section>
);

const Give: React.FC = () => {
  const t = useT();
  const { locale } = useLocale();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);

  const [cardLocale, setCardLocale] = useState<Locale>(locale);
  const [made, setMade] = useState<MadeGift | null>(null);
  const [giver, setGiver] = useState(user?.name ?? '');
  const [recipient, setRecipient] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    document.title = `${t('give.title')} — Ownpace`;
  }, [t]);

  // Only the card prints while there is one (`index.css`, `printing-gift`).
  useEffect(() => {
    if (!made) return;
    document.body.classList.add('printing-gift');
    return () => document.body.classList.remove('printing-gift');
  }, [made]);

  const mine = useQuery({ queryKey: ['gifts', 'mine'], queryFn: listMyGifts });

  const make = useMutation({
    mutationFn: () => makeGift(cardLocale),
    onSuccess: (gift) => {
      setMade(gift);
      void queryClient.invalidateQueries({ queryKey: ['gifts', 'mine'] });
    },
  });

  const revoke = useMutation({
    mutationFn: (id: string) => revokeMyGift(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['gifts', 'mine'] }),
  });

  const atLimit = mine.data !== undefined && mine.data.held >= mine.data.limit;
  const field =
    'block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-site-teal';
  const label = 'block text-sm font-medium text-gray-700 mb-1';

  return (
    <div className="max-w-3xl space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold text-gray-900">{t('give.title')}</h1>
        <p className="text-gray-700">{t('give.intro')}</p>
        <p className="text-sm text-gray-600">{t('give.how')}</p>
        <p className="text-sm text-gray-600">{t('give.privacy')}</p>
      </header>

      {!made && (
        <section className="space-y-4 rounded-lg border border-gray-200 bg-white p-6">
          {mine.data && (
            <p className="text-sm text-gray-700">
              {t('give.limit', { limit: mine.data.limit, held: mine.data.held })}
            </p>
          )}
          <div>
            <label htmlFor="card-locale" className={label}>
              {t('give.language')}
            </label>
            <select
              id="card-locale"
              value={cardLocale}
              onChange={(e) => setCardLocale(e.target.value === 'nl' ? 'nl' : 'en')}
              className={field}
            >
              <option value="en">English</option>
              <option value="nl">Nederlands</option>
            </select>
          </div>
          {atLimit ? (
            <p className="text-sm text-gray-700">{t('give.atLimit')}</p>
          ) : (
            <button
              type="button"
              onClick={() => make.mutate()}
              disabled={make.isPending || mine.isLoading}
              className="inline-flex items-center gap-2 rounded-md bg-site-teal px-4 py-2 text-sm font-medium text-white hover:bg-site-teal/90 disabled:opacity-50"
            >
              <GiftIcon className="h-4 w-4" aria-hidden="true" />
              {make.isPending ? t('give.making') : t('give.make')}
            </button>
          )}
          {make.isError && (
            <p role="alert" className="text-sm text-red-600">
              {t('give.failed')} {serverMessage(make.error)}
            </p>
          )}
        </section>
      )}

      {made && (
        <section className="space-y-6">
          <p role="status" className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
            {t('give.once')}
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="card-giver" className={label}>
                {t('give.giverName')}
              </label>
              <input id="card-giver" value={giver} onChange={(e) => setGiver(e.target.value)} className={field} />
            </div>
            <div>
              <label htmlFor="card-recipient" className={label}>
                {t('give.recipient')}
              </label>
              <input
                id="card-recipient"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                autoComplete="off"
                className={field}
              />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="card-message" className={label}>
                {t('give.message')}
              </label>
              <textarea
                id="card-message"
                rows={3}
                maxLength={400}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className={field}
              />
              <p className="mt-1 text-xs text-gray-500">{t('give.notStored')}</p>
            </div>
          </div>
          <GiftCard made={made} locale={cardLocale} giver={giver} recipient={recipient} message={message} />
          <div className="text-center">
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-2 rounded-md bg-site-teal px-4 py-2 text-sm font-medium text-white hover:bg-site-teal/90"
            >
              <Printer className="h-4 w-4" aria-hidden="true" />
              {t('give.print')}
            </button>
          </div>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-gray-900">{t('give.mine')}</h2>
        {mine.isError && (
          <p role="alert" className="text-sm text-red-600">
            {serverMessage(mine.error)}
          </p>
        )}
        {mine.data && mine.data.gifts.length === 0 && <p className="text-sm text-gray-600">{t('give.none')}</p>}
        <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
          {mine.data?.gifts.map((g) => (
            <li key={g.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <p className="text-sm font-medium text-gray-900">{t(STATE_KEY[g.state])}</p>
                <p className="text-xs text-gray-600">
                  {t('give.made', {
                    date: cardDay(g.createdAt, locale),
                    until: cardDay(g.expiresAt, locale),
                  })}
                </p>
              </div>
              {g.state === 'unused' && (
                <button
                  type="button"
                  onClick={() => revoke.mutate(g.id)}
                  disabled={revoke.isPending}
                  className="rounded-md border border-gray-300 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  {t('give.revoke')}
                </button>
              )}
            </li>
          ))}
        </ul>
        {revoke.isError && (
          <p role="alert" className="text-sm text-red-600">
            {t('give.revokeFailed')} {serverMessage(revoke.error)}
          </p>
        )}
      </section>
    </div>
  );
};

export default Give;
