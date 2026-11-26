// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * *Recommend someone* (workplans 0172 and 0177 T5, T10, T2; the owner's D1,
 * D2, D6, D7, D8, D16).
 *
 * A member recommends one person they know, on a card to print or save as a
 * PDF, or by a link they send in their own words. The code is shown ONCE,
 * here, right after it is made: only a fingerprint is kept, so nothing can
 * show it again, as with a grant link. In code it is still a gift.
 *
 * **What it says, in this order** (0177 §9, R10): what a recommendation does,
 * at reading size: you tell us you know somebody, that is enough, and they
 * are let in at once (D6); that they get an account of their own; how many
 * the member may recommend; that whoever has the code is let in, so the card
 * is given by hand; *tell them first*, as advice and never a tick box; and
 * what the giver will see afterwards (D8). Then one fold, *What they will
 * see*: the door's three steps, the mail and the account, because the
 * giver's name stands on the card as the person to ask. Nothing about what
 * the giver gets (D4): they get nothing, and the page does not say so.
 *
 * **When no card can be made it says so, and offers no button** (D7, D18,
 * §20.3): during the Alpha, to a member let in by a recommendation, that only
 * the people Ownpace let in itself recommend, and that they can after it
 * (`onlyAfterAlpha`, §20.7); *none for now* when the number each person may
 * give is nought; and *the Alpha is full* when the Alpha has no place for a
 * new card (`room`). A member at their own number is told to withdraw an
 * unused card first.
 *
 * **What leaves the browser, and what does not.** Making one sends the card's
 * language and nothing else (`makeGift`). The giver's name on the card
 * (prefilled from their own account, editable), the recipient's first name
 * and the message are typed into this page and printed with the card, and
 * never sent: the API refuses any field but the language, and the gift table
 * has no column for them (`a-gift-that-keeps-no-recipient.unit.test.ts`).
 *
 * **The card is in the language the giver picks**, which may not be the app's:
 * a Dutch giver may recommend an English reader. So the card's words are read
 * from the dictionary in that language, not through `useT`. It is drawn as it
 * prints, in 0177 §6's order, with the door's three steps, the code on one
 * line at every width in a box with a visible edge, and no square to scan: a
 * square is a link in another form, and the card's worth to a careful reader
 * is that it is not one. The print rule is `index.css`'s (`printing-gift`).
 *
 * **A link beside the card** (D2): the door's address with the code after a
 * `#`, so the code is in no request on its way in, and one line, *say in your
 * own words what it is*. The page writes no message for the giver to send
 * (R2).
 *
 * Below, the member's cards and each one's state in words, with the day one
 * was used: *used* means *let in* (T10). *Withdraw* stands on an unused one; a
 * withdrawn one no longer counts toward the number (0172 §7, 1), and it is how
 * a lost card is stopped.
 */
import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Handshake, Printer } from 'lucide-react';
import { useT, useLocale, type StringKey } from '../i18n/index.tsx';
import { STRINGS, type Locale } from '../i18n/strings.ts';
import { fill, type TemplateVars } from '../i18n/fill.ts';
import { serverMessage } from '../services/api.ts';
import { useAuthStore } from '../stores/auth-store.ts';
import { isAlpha } from '../components/AlphaNote.tsx';
import { supportAddress } from '../components/SupportLine.tsx';
import { recommendationPageUrl, siteAsTyped } from '../services/recommendation-page-link.ts';
import {
  listMyGifts,
  makeGift,
  revokeMyGift,
  type GiftState,
  type GiftSummary,
  type MadeGift,
} from '../services/gifts.ts';

/** The door's address: the deployment's own, or this browser's (D9: `/code` in both languages). */
const theDoor = (known: string | null | undefined): string => known ?? `${window.location.origin}/code`;

/** The address as a person types it: no scheme. */
const typedAddress = (url: string): string => url.replace(/^https?:\/\//, '');

/** One of the card's words, in the card's language. */
const cardWord = (locale: Locale, key: StringKey, vars?: TemplateVars): string => fill(STRINGS[locale][key], vars);

/** A day as its reader names it, in their language: the card's, or the page's. */
const cardDay = (when: string, locale: Locale): string =>
  new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(new Date(when));

/** A card's state, in words (T10): the day it was used, and *let in*. */
const stateWords = (g: GiftSummary, locale: Locale, t: (key: StringKey, vars?: TemplateVars) => string): string => {
  const KEY = {
    unused: 'give.state.unused',
    redeemed: 'give.state.redeemed',
    revoked: 'give.state.revoked',
    expired: 'give.state.expired',
  } as const satisfies Record<GiftState, StringKey>;
  return g.state === 'redeemed' && g.redeemedAt ? t(KEY.redeemed, { date: cardDay(g.redeemedAt, locale) }) : t(KEY[g.state]);
};

/** The card's title: for whom, if a name was typed, and from whom. */
function cardTitle(locale: Locale, giver: string, recipient: string): string {
  if (recipient && giver) return cardWord(locale, 'card.titleFor', { name: recipient, giver });
  if (recipient) return cardWord(locale, 'card.titleForNoGiver', { name: recipient });
  if (giver) return cardWord(locale, 'card.title', { giver });
  return cardWord(locale, 'card.titleNoGiver');
}

/** Sentences on the card: 18 pixels on the screen, and the print rule's points on paper. */
const CARD_SENTENCE = 'text-lg text-gray-900';

/** The card: what is printed. Everything on it but the code and the date is the giver's, and stays here. */
const GiftCard: React.FC<{
  made: MadeGift;
  locale: Locale;
  giver: string;
  recipient: string;
  message: string;
}> = ({ made, locale, giver, recipient, message }) => {
  const title = cardTitle(locale, giver.trim(), recipient.trim());
  const support = supportAddress();
  return (
    <section
      className="gift-card mx-auto w-full max-w-lg rounded-2xl border-2 border-site-teal bg-white p-5 sm:p-8 shadow-sm space-y-4"
      lang={locale}
      aria-label={title}
    >
      <div className="flex items-center gap-3 text-site-teal">
        <Handshake className="h-8 w-8 shrink-0" aria-hidden="true" />
        <h2 className="text-2xl font-bold text-gray-900 break-words">{title}</h2>
      </div>
      {/* The giver's own message, large: the one sentence a careful reader trusts (§6). */}
      {message.trim() && <p className="whitespace-pre-line text-xl italic text-gray-900">{message.trim()}</p>}
      <p className={CARD_SENTENCE}>{cardWord(locale, 'card.what')}</p>
      <p className={CARD_SENTENCE}>{cardWord(locale, 'card.alpha')}</p>
      <p className={CARD_SENTENCE}>{cardWord(locale, 'code.cost')}</p>
      <p className={CARD_SENTENCE}>{cardWord(locale, 'code.after')}</p>
      <p className={`${CARD_SENTENCE} break-words`}>
        {cardWord(locale, 'card.where', { address: typedAddress(theDoor(made.redeemAt)) })}
      </p>
      {/* The door's three steps, numbered as the door counts them (R9). */}
      <ol className={`${CARD_SENTENCE} list-decimal space-y-1 pl-7`}>
        <li>{cardWord(locale, 'card.step1')}</li>
        <li>{cardWord(locale, 'card.step2')}</li>
        <li>{cardWord(locale, 'card.step3')}</li>
      </ol>
      {/* The code in a box with a visible edge, on one line at every width.
          The door reads an O as a nought and an I or an L as a one
          (`readGiftCode`), so the card explains nothing about them. */}
      <div className="gift-code-box rounded-lg border-2 border-gray-700 p-3 text-center">
        <p className="text-base font-semibold text-gray-900">{cardWord(locale, 'code.field')}</p>
        <p
          className="mt-1 whitespace-nowrap font-mono text-[clamp(1rem,5.2vw,1.5rem)] font-bold tracking-normal sm:tracking-wide text-gray-900"
          data-testid="gift-code"
        >
          {made.code}
        </p>
      </div>
      <p className={`${CARD_SENTENCE} break-words`}>
        {giver.trim() ? cardWord(locale, 'card.help', { giver: giver.trim() }) : cardWord(locale, 'card.helpNoGiver')}
        {support !== null && ` ${cardWord(locale, 'card.support', { support })}`}
      </p>
      <p className={`${CARD_SENTENCE} break-words`}>{cardWord(locale, 'card.who', { site: siteAsTyped() })}</p>
      <p className={CARD_SENTENCE}>{cardWord(locale, 'card.until', { date: cardDay(made.expiresAt, locale) })}</p>
    </section>
  );
};

/** A person's sizes on this page too (0177 §10): sentences at 18 pixels, edges at 3 to 1, targets 44 by 44. */
const SENTENCE = 'text-lg text-gray-900';
const FIELD =
  'block w-full min-h-[44px] rounded-md border-2 border-gray-700 bg-white px-3 py-2 text-lg text-gray-900 ' +
  'focus:outline-none focus:ring-4 focus:ring-blue-300';
const LABEL = 'block text-lg font-medium text-gray-900 mb-1';
const MAIN =
  'inline-flex w-full sm:w-auto min-h-[60px] items-center justify-center gap-2 rounded-lg bg-blue-700 px-6 py-3 ' +
  'text-lg font-semibold text-white hover:bg-blue-800 disabled:opacity-60';
const SMALL =
  'inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md border-2 border-gray-700 bg-white ' +
  'px-3 py-2 text-base font-medium text-gray-900 hover:bg-gray-50 disabled:opacity-60';

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
  const [copied, setCopied] = useState(false);

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
      setCopied(false);
      void queryClient.invalidateQueries({ queryKey: ['gifts', 'mine'] });
    },
  });

  const revoke = useMutation({
    mutationFn: (id: string) => revokeMyGift(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['gifts', 'mine'] }),
  });

  /**
   * Why no card can be made now, or null when one can (D7, D18, §20.3): during
   * the Alpha a member let in by a recommendation reads that only the people
   * Ownpace let in itself recommend, and that they can after it (§20.7); a
   * number of nought is *none for now*; the member's own number reached says
   * to withdraw an unused one, which also frees its place; a full Alpha says
   * so. Never *already given* for the first, the second or the last.
   */
  const noCard = ((): StringKey | null => {
    const data = mine.data;
    if (!data) return null;
    // D18: let in by a recommendation, during the Alpha; the limit is then nought too.
    if (data.onlyAfterAlpha === true) return 'give.onlyAfterAlpha';
    if (data.limit === 0) return 'give.noneForNow';
    if (data.held >= data.limit) return 'give.atLimit';
    if (data.room === false) return 'give.full';
    return null;
  })();

  const door = theDoor(made?.redeemAt ?? mine.data?.redeemAt);
  const link = made ? `${theDoor(made.redeemAt)}#${made.code}` : '';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      // Refused by the browser (a permission, an insecure origin): the link is
      // on screen in a real field and can be selected, which is why it is one.
      setCopied(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-8">
      <header className="space-y-3">
        <h1 className="text-2xl font-bold text-gray-900">{t('give.title')}</h1>
        <p className={SENTENCE}>{t('give.intro')}</p>
        {/* What it does, first and at reading size (§9). */}
        <p className={`${SENTENCE} font-medium`}>{t('give.does')}</p>
        <p className={SENTENCE}>{t('give.fact')}</p>
      </header>

      <section className="space-y-3">
        {mine.data && <p className={SENTENCE}>{t('give.limit', { limit: mine.data.limit, held: mine.data.held })}</p>}
        <p className={SENTENCE}>{t('give.handOver')}</p>
        {/* Advice, one line, and no tick box: a box would force an untruth on a
            giver who tells the other person at the hand-over. */}
        <p className={SENTENCE}>{t('give.tellFirst')}</p>
        <p className={SENTENCE}>{t('give.willSee')}</p>
        {/* What is kept, and that the card's name and message are never received (§9). */}
        <p className={SENTENCE}>{t('give.privacy')}</p>
        <details className="rounded-lg border-2 border-gray-300 bg-white p-4">
          <summary className="cursor-pointer text-lg font-semibold text-gray-900 min-h-[44px] flex items-center">
            {t('give.theySee')}
          </summary>
          <ol className={`${SENTENCE} mt-2 list-decimal space-y-1 pl-7`}>
            <li className="break-words">{t('give.theySee.code', { address: typedAddress(door) })}</li>
            <li>{t('give.theySee.question')}</li>
            <li>{t('give.theySee.address')}</li>
          </ol>
          <p className={`${SENTENCE} mt-2`}>{t('give.theySee.mail')}</p>
          <p className={`${SENTENCE} mt-2`}>{t('give.theySee.you')}</p>
        </details>
        {isAlpha() && (
          <p>
            <a
              href={recommendationPageUrl(locale)}
              className="inline-flex min-h-[44px] items-center text-lg text-blue-700 underline underline-offset-4"
            >
              {t('code.readMore')}
            </a>
          </p>
        )}
      </section>

      {!made && (
        <section className="space-y-4 rounded-lg border-2 border-gray-300 bg-white p-6">
          {noCard !== null ? (
            <p className={SENTENCE}>{t(noCard)}</p>
          ) : (
            <>
              <div>
                <label htmlFor="card-locale" className={LABEL}>
                  {t('give.language')}
                </label>
                <select
                  id="card-locale"
                  value={cardLocale}
                  onChange={(e) => setCardLocale(e.target.value === 'nl' ? 'nl' : 'en')}
                  className={FIELD}
                >
                  <option value="en">English</option>
                  <option value="nl">Nederlands</option>
                </select>
              </div>
              <button type="button" onClick={() => make.mutate()} disabled={make.isPending || mine.isLoading} className={MAIN}>
                <Handshake className="h-5 w-5" aria-hidden="true" />
                {make.isPending ? t('give.making') : t('give.make')}
              </button>
            </>
          )}
          {make.isError && (
            <p role="alert" className="text-lg text-red-700">
              {t('give.failed')} {serverMessage(make.error)}
            </p>
          )}
        </section>
      )}

      {made && (
        <section className="space-y-6">
          <p role="status" className="rounded-md border-2 border-amber-700 bg-amber-50 p-4 text-lg text-amber-900">
            {t('give.once')}
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="card-giver" className={LABEL}>
                {t('give.giverName')}
              </label>
              <input id="card-giver" value={giver} onChange={(e) => setGiver(e.target.value)} className={FIELD} />
            </div>
            <div>
              <label htmlFor="card-recipient" className={LABEL}>
                {t('give.recipient')}
              </label>
              <input
                id="card-recipient"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                autoComplete="off"
                className={FIELD}
              />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="card-message" className={LABEL}>
                {t('give.message')}
              </label>
              <textarea
                id="card-message"
                rows={3}
                maxLength={400}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className={FIELD}
              />
              <p className="mt-1 text-base text-gray-800">{t('give.notStored')}</p>
            </div>
          </div>
          <GiftCard made={made} locale={cardLocale} giver={giver} recipient={recipient} message={message} />
          {/* The link, beside the card (D2): the code after a `#`, and one
              line. The page writes no message for the giver to send. */}
          <div data-link className="gift-link space-y-2">
            <label htmlFor="card-link" className={LABEL}>
              {t('give.link')}
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                id="card-link"
                readOnly
                value={link}
                onFocus={(e) => e.currentTarget.select()}
                className={`${FIELD} grow basis-64 font-mono text-base`}
              />
              <button type="button" onClick={() => void copy()} className={SMALL}>
                {copied ? t('grantLink.copied') : t('grantLink.copy')}
              </button>
            </div>
          </div>
          <div className="text-center">
            <button type="button" onClick={() => window.print()} className={MAIN}>
              <Printer className="h-5 w-5" aria-hidden="true" />
              {t('give.print')}
            </button>
          </div>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-gray-900">{t('give.mine')}</h2>
        {mine.isError && (
          <p role="alert" className="text-lg text-red-700">
            {serverMessage(mine.error)}
          </p>
        )}
        {mine.data && mine.data.gifts.length === 0 && <p className={SENTENCE}>{t('give.none')}</p>}
        <ul className="divide-y divide-gray-300 rounded-lg border-2 border-gray-300 bg-white">
          {mine.data?.gifts.map((g) => (
            <li key={g.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <p className="text-lg font-medium text-gray-900">{stateWords(g, locale, t)}</p>
                <p className="text-base text-gray-800">
                  {t('give.made', {
                    date: cardDay(g.createdAt, locale),
                    until: cardDay(g.expiresAt, locale),
                  })}
                </p>
              </div>
              {g.state === 'unused' && (
                <button type="button" onClick={() => revoke.mutate(g.id)} disabled={revoke.isPending} className={SMALL}>
                  {t('give.revoke')}
                </button>
              )}
            </li>
          ))}
        </ul>
        {revoke.isError && (
          <p role="alert" className="text-lg text-red-700">
            {t('give.revokeFailed')} {serverMessage(revoke.error)}
          </p>
        )}
      </section>
    </div>
  );
};

export default Give;
