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
 * **Who asked, from where, and to where** (workplan 0108 T8a, 2026-09-23).
 * Who asked is the address of the member who issued the link, the one they
 * sign in with: the owner, *"It has to be clear who is facilitating a
 * migration of someone else."* Somebody with
 * a tenant of their own can set up a migration from another person's account
 * into a server they control and send the link with a plausible story. This
 * page and Google's consent screen would both be genuine. The account it reads
 * and the destination it writes are the two facts only the person granting can
 * check, so they come before the button, with one plain question beside them.
 *
 * **Which account to sign in with** (0108 T8 (b)). From is a condition, not a
 * label: the server refuses any other account that signs in, and stores
 * nothing. Said before the button, together with why Google will also ask to
 * share their address, which is how the account is checked.
 *
 * **What will be read, and what the permission allows.** In plain words AND
 * as the scope Google itself will record (ADR-0041's operative rule: the
 * scopes are shown as scopes). The plain sentence is what a person
 * understands; each scope is said as what it allows, in the reader's language
 * (the owner, 2026-10-14), and the exact string Google records sits in a
 * closed *Technical details* fold, for whoever wants to check it against
 * their account. Before that it was shown as it was, three addresses in
 * monospace under the sentence. The plain
 * words are this page's, from the dictionary (workplan 0145 T6): the server
 * names the data types, and the page says them in the reader's language and
 * joins them as that language joins a list. Until then the server sent an
 * English phrase, and a Dutch reader met it inside a Dutch sentence.
 *
 * "Read-only" only where Google enforces it (workplan 0144 T3 (c)). The box
 * above the scope said *"Read-only."* for every link, and for a Gmail link the
 * scope under it is `https://mail.google.com/`, which Google's screen, one
 * click later, describes as reading, sending and deleting all mail. Ownpace
 * only reads, whatever the permission allows; the permission is read-only only
 * for Drive and Tasks. So the server says which (`readOnlyAtProvider`, decided
 * from the scopes the link asks), and the box says "Read-only" only then, and
 * otherwise that Ownpace only reads and that Google describes more.
 *
 * **Until when.** The link's own validity, in a date. An expiry that lands
 * mid-intention — after somebody has cleared ten minutes to do this — is a
 * small betrayal that costs an afternoon.
 *
 * **Where to open it** (workplan 0140 T3 (a)). A link tapped in a chat or mail
 * app opens in that app's own browser, and Google is reported to refuse its
 * consent there. One line above the button says to open it in Safari or
 * Chrome instead, and that the link still works, which it does: opening it
 * spends nothing.
 *
 * **In one language, which the reader chooses** (workplan 0145 T6). The page
 * is outside `Layout`, so it carries its own switch, the same two buttons.
 * A refusal shows the half the server sent in the page's language; a failure
 * the server wrote no sentence for (no connection, a subject this page cannot
 * read) is the page's own sentence (`link-refusal.ts`), and the
 * button tells the server which language the ending after Google should be
 * in. A refusal is announced (`role="alert"`) and the waiting line is a
 * status, which 0145 T4 left to this change.
 *
 * **The privacy policy and terms, before any redirect.** This is the in-product
 * disclosure Google's verification requires, and it belongs where a person can
 * still walk away. The addresses, in the reader's language, come from
 * `services/legal-links.ts`, the one module every link to the texts reads
 * (workplan 0139 T10). They are named as everywhere else in the app
 * (`acceptance.doc.*`), and kept apart by a dot rather than one space.
 *
 * **Only to Google's own page** (workplan 0163 T4). Both buttons send the page
 * to the consent address the API answers, and until 2026-11-21 they followed
 * whatever came back. Now the address goes through `consentToFollow('google',
 * …)` (`services/address-to-follow.ts`), the check *Pay* and the consent
 * window use: `https:` on `accounts.google.com` exactly, or nothing is opened
 * and the page says the address is not Google's own page.
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
import { YourNewAddress } from '../components/YourNewAddress.tsx';
import { CheckCircle2, ShieldCheck } from 'lucide-react';
import type { DiscoveryDomain } from '@openmig/shared';
import {
  grantApi,
  type CardProvider,
  type GrantProvider,
  type GrantSubject,
  type PasswordAnswer,
  type PersonGrantCard,
  type PersonGrantSubject,
} from '../services/grant-service.ts';
import { GrantPasswordCard } from '../components/GrantPasswordCard.tsx';

/**
 * Whether the page opened a person's link. Here rather than imported, so a
 * test that stands in for the service with its two calls still draws the page.
 */
const isPersonSubject = (s: GrantSubject | PersonGrantSubject): s is PersonGrantSubject =>
  'kind' in s && s.kind === 'person';

/**
 * A failure that is no request: the address the API answered is not the
 * provider's own page (workplan 0163 T4; per provider since 0171).
 */
class NotTheProvider {
  constructor(readonly name: string) {}
}

/** What a failure says: the refusal above, or the server's sentence in the page's language. */
function failureSentence(error: unknown, locale: Locale, t: ReturnType<typeof useT>): string {
  return error instanceof NotTheProvider
    ? t('account.consent.notTheProvider', { provider: error.name })
    : linkRefusal(error, locale, t);
}

/**
 * THE PAGE IN EACH PROVIDER'S WORDS (workplan 0171 §3.4). Google's are the
 * page as it was; a Microsoft account's link says Microsoft wherever they say
 * Google, and since alpha.21 a Dropbox link says Dropbox (workplan 0174 §6).
 * Apple adds its own with its task; the API offers it no link until then, and
 * the page would say Google's words for it, so `wordsOf` refuses to guess and
 * falls back only for Google.
 */
interface ProviderWords {
  readonly name: string;
  /** The box above the scope: read-only where the provider holds it so, else what Ownpace does. */
  readonly readOnly: (readOnlyAtProvider: boolean) => StringKey;
  readonly scopeIntro: StringKey;
  readonly technicalLine: StringKey;
  readonly signInAs: StringKey;
  readonly connecting: StringKey;
  readonly withdraw: StringKey;
  /** A person's card: the button, with the account. */
  readonly connectAs: StringKey;
  readonly connectAgainAs: StringKey;
  /** A migration's page: the button. */
  readonly connect: StringKey;
  /** Files, in the provider's own product's name. */
  readonly readsFile: StringKey;
}

/**
 * DO IT TOGETHER, DURING THE ALPHA (the owner's decisions of 2026-11-26,
 * change 4). While Google still shows its warning screen for the app it has
 * not verified, which is the Alpha (`isAlpha`, the rule `AlphaGoogleLine`
 * keeps for the same screen), one plain line before a Google button invites
 * the person to take the step together with whoever set it up, on the phone
 * or at the table. Named as the page already names them (`askedBy`, else
 * the organisation). Calm and short, and never a request for help by
 * message, which is the shape of a known scam.
 */
const DoItTogether: React.FC<{ who: string; className?: string }> = ({ who, className }) => {
  const t = useT();
  if (!isAlpha()) return null;
  return <p className={`${className ?? ''} text-sm text-gray-900`}>{t('grant.together', { who })}</p>;
};

const PROVIDER_WORDS: Readonly<Record<'google' | 'microsoft' | 'dropbox', ProviderWords>> = {
  google: {
    name: 'Google',
    readOnly: (held) => (held ? 'grant.readOnly' : 'grant.readsOnly'),
    scopeIntro: 'grant.scopeIntro',
    technicalLine: 'grant.scope.technical.line',
    signInAs: 'grant.signInAs',
    connecting: 'grant.connecting',
    withdraw: 'grant.withdraw',
    connectAs: 'grant.person.connect',
    connectAgainAs: 'grant.person.connectAgain',
    connect: 'grant.connect',
    readsFile: 'grant.reads.file',
  },
  microsoft: {
    name: 'Microsoft',
    // Every Graph scope a link asks for is a `.Read` one (`microsoftLinkAsk`).
    readOnly: () => 'grant.readOnly.microsoft',
    scopeIntro: 'grant.scopeIntro.microsoft',
    technicalLine: 'grant.scope.technical.line.microsoft',
    signInAs: 'grant.signInAs.microsoft',
    connecting: 'grant.connecting.microsoft',
    withdraw: 'grant.withdraw.microsoft',
    connectAs: 'grant.continue.microsoft',
    connectAgainAs: 'grant.connectAgain.microsoft',
    connect: 'grant.continue.microsoft',
    readsFile: 'grant.reads.file.microsoft',
  },
  dropbox: {
    name: 'Dropbox',
    // Every scope a Dropbox link asks for reads (`dropboxLinkAsk`), and the
    // exchange refuses a grant that carries more.
    readOnly: () => 'grant.readOnly.dropbox',
    scopeIntro: 'grant.scopeIntro.dropbox',
    technicalLine: 'grant.scope.technical.line.dropbox',
    signInAs: 'grant.signInAs.dropbox',
    connecting: 'grant.connecting.dropbox',
    withdraw: 'grant.withdraw.dropbox',
    connectAs: 'grant.continue.dropbox',
    connectAgainAs: 'grant.connectAgain.dropbox',
    connect: 'grant.continue.dropbox',
    readsFile: 'grant.reads.file.dropbox',
  },
};

function wordsOf(provider: GrantProvider | CardProvider | undefined): ProviderWords {
  // Absent is Google: an answer from before the seam (the service defaults it
  // when it parses one; a page handed data directly may not have).
  if (provider === undefined || provider === 'google' || provider === 'microsoft' || provider === 'dropbox') {
    return PROVIDER_WORDS[provider ?? 'google'];
  }
  throw new Error(`the grant page has no words for ${provider} yet`);
}

/** What each data type reads, in this provider's words. */
function readsKey(d: DiscoveryDomain, words: ProviderWords): StringKey {
  return d === 'file' ? words.readsFile : READS_KEY[d];
}
import { linkRefusal } from '../services/link-refusal.ts';
import { consentToFollow } from '../services/address-to-follow.ts';
import { legalLinks } from '../services/legal-links.ts';
import { useT, useFormatters, useLocale } from '../i18n/index.tsx';
import type { Locale, StringKey } from '../i18n/strings.ts';
import BuildStamp from '../components/BuildStamp.tsx';
import LanguageSwitch from '../components/LanguageSwitch.tsx';
import ReportThisLink from '../components/ReportThisLink.tsx';
import AlphaGoogleLine from '../components/AlphaGoogleLine.tsx';
import { isAlpha } from '../components/AlphaNote.tsx';
import AccessibilityLink from '../components/AccessibilityLink.tsx';
import { SOURCE_CARDS, TARGET_CARDS } from '../components/front-door-cards.ts';
import { scopeWordKeys } from '../i18n/google-scope-words.ts';

/**
 * What each data type reads, as the dictionary says it (workplan 0145 T6). A
 * total record, so a sixth data type is a compile error here rather than a
 * gap in what a person is told they are giving access to.
 */
const READS_KEY: Readonly<Record<DiscoveryDomain, StringKey>> = {
  email: 'grant.reads.email',
  calendar: 'grant.reads.calendar',
  contact: 'grant.reads.contact',
  file: 'grant.reads.file',
  task: 'grant.reads.task',
};

/**
 * THE PERMISSION, IN WORDS, AND THE SCOPE BEHIND A FOLD (the owner,
 * 2026-10-14). Each scope the link asks for is said as what it allows
 * (`google-scope-words.ts`), in the reader's language; the exact string Google
 * records stays on the page, inside a closed *Technical details*, for whoever
 * wants to compare it with their account (ADR-0041 *Decision* 4: the scopes
 * as scopes, not only a paraphrase).
 */
const GrantScope: React.FC<{ scope: string; className: string; provider?: GrantProvider }> = ({
  scope,
  className,
  provider = 'google',
}) => {
  const t = useT();
  const words = wordsOf(provider);
  return (
    <div className={className}>
      <p className="text-sm text-gray-600">{t(words.scopeIntro)}</p>
      <ul className="mt-1 list-disc pl-5 space-y-0.5 text-sm text-gray-900">
        {scopeWordKeys(scope, provider).map((key) => (
          <li key={key}>{t(key)}</li>
        ))}
      </ul>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer select-none text-gray-500">{t('grant.scope.technical')}</summary>
        <p className="mt-1 text-gray-600">{t(words.technicalLine)}</p>
        <p className="mt-1 font-mono break-all text-gray-900">{scope}</p>
      </details>
    </div>
  );
};

/** A destination's kind, by the name its card carries; the kind itself otherwise. */
function providerName(kind: string): string {
  return TARGET_CARDS.find((c) => c.id === kind)?.name ?? kind;
}

/** A source's kind, by the name its card carries; the kind itself otherwise (0174 §4.5). */
function sourceName(kind: string): string {
  const card = SOURCE_CARDS.find((c) => c.id === kind);
  return (card && 'name' in card ? card.name : undefined) ?? kind;
}

/**
 * What each data type is, on a card that is no Google or Microsoft sign-in
 * (0174 §4.5): a password card, or a destination. Files are *your files*,
 * not Google Drive's.
 */
function cardReadsKey(card: PersonGrantCard, d: DiscoveryDomain): StringKey {
  if (wayOf(card) === 'sign-in' && roleOf(card) === 'source') return readsKey(d, wordsOf(card.provider));
  return d === 'file' ? 'grant.reads.file.other' : READS_KEY[d];
}

/**
 * A card's role and way. Absent is a Google sign-in source: an answer from
 * before 0174, as the service's defaults read it, and as a page handed data
 * directly may hold it.
 */
const roleOf = (a: PersonGrantCard): 'source' | 'target' => a.role ?? 'source';
const wayOf = (a: PersonGrantCard): 'sign-in' | 'password' => a.way ?? 'sign-in';

/** A card's state, as its chip says it (0174 §4.5): connected, waiting, or locked on this link. */
type CardState = 'connected' | 'waiting' | 'locked';
const STATE_WORDS: Readonly<Record<CardState, StringKey>> = {
  connected: 'grant.state.connected',
  waiting: 'grant.state.waiting',
  locked: 'grant.state.locked',
};
const STATE_TONE: Readonly<Record<CardState, string>> = {
  connected: 'bg-green-50 text-green-800 border-green-200',
  waiting: 'bg-gray-50 text-gray-700 border-gray-200',
  locked: 'bg-amber-50 text-amber-900 border-amber-200',
};

/**
 * A PERSON'S link (ADR-0035, amended 2026-09-29; workplan 0153 T5 (b)): who is
 * asking and who asked, once, then one card per account. Each card says
 * where each of its migrations goes and what it copies, what the permission
 * allows and the scope in Google's words, which account to sign in with, and
 * its own button; or that it is connected already; or, in the reader's
 * language, why it cannot be asked. Everything else on the page is the
 * migration's page's, in the same words.
 *
 * TWO GROUPS, AND PASSWORDS (workplan 0174 §4.5, T4). The link asks for
 * accounts, each a source or a destination (`role`), each by a sign-in or the
 * person's own password (`way`). The cards are grouped: the accounts the data
 * is copied FROM, then the ones it is copied TO, a group only when it has a
 * card. Each card says its state: connected, waiting, or locked on this link
 * after five refused tries. A password card is `GrantPasswordCard`, with the
 * server line before any box; the page adds, once above the cards, what to do
 * when the organisation gave no phone number (§5.8).
 */
const PersonGrant: React.FC<{ data: PersonGrantSubject; link: string }> = ({ data, link }) => {
  const t = useT();
  const { locale } = useLocale();
  const { dateTime, list } = useFormatters();
  const legal = legalLinks(locale);
  // Which account's button was pressed, and what refused it.
  const [starting, setStarting] = React.useState<string | null>(null);
  const [failure, setFailure] = React.useState<{ account: string; error: unknown } | null>(null);
  // Password cards connected on this visit, and the tries their last answer left (by `ref`).
  const [connectedHere, setConnectedHere] = React.useState<ReadonlySet<string>>(new Set());
  const [triesHere, setTriesHere] = React.useState<Readonly<Record<string, { left: number; locked: boolean }>>>({});
  // The person's progress page, minted by the password route after a write
  // (0174 §5.3 step 8), as a sign-in's ending hands it over on its own page.
  const [progressUrl, setProgressUrl] = React.useState<string | null>(null);

  const connect = async (account: string, provider: GrantProvider) => {
    setStarting(account);
    setFailure(null);
    try {
      const { url } = await grantApi.authorize(link, locale, provider, account);
      // Only to the provider's own page (0163 T4), the host by provider (0171).
      const consent = consentToFollow(provider, url);
      if (consent === null) {
        setFailure({ account, error: new NotTheProvider(wordsOf(provider).name) });
        setStarting(null);
        return;
      }
      globalThis.location.assign(consent);
    } catch (error) {
      setFailure({ account, error });
      setStarting(null);
    }
  };

  // A destination's Cirrux Drive (0174 §4.4, T5): named by its `ref`, since
  // Cirrux vouches for no address; followed only to Cirrux's own host.
  const connectDrive = async (a: PersonGrantCard) => {
    setStarting(a.ref);
    setFailure(null);
    try {
      const { url } = await grantApi.authorizeDrive(link, a.ref, locale);
      const consent = consentToFollow('cirrux', url);
      if (consent === null) {
        setFailure({ account: a.ref, error: new NotTheProvider('Cirrux') });
        setStarting(null);
        return;
      }
      globalThis.location.assign(consent);
    } catch (error) {
      setFailure({ account: a.ref, error });
      setStarting(null);
    }
  };

  const onPasswordAnswer = (ref: string, answer: PasswordAnswer) => {
    if (answer.kind === 'connected') {
      setConnectedHere((prev) => new Set(prev).add(ref));
      if (answer.progressUrl !== undefined) setProgressUrl(answer.progressUrl);
    }
    else if (answer.kind === 'locked') setTriesHere((prev) => ({ ...prev, [ref]: { left: 0, locked: true } }));
    else if (answer.kind === 'refused_login' && answer.left !== null) {
      setTriesHere((prev) => ({ ...prev, [ref]: { left: answer.left!, locked: false } }));
    }
  };

  const where = (to: PersonGrantCard['migrations'][number]['to']) => {
    const place = to.host ? t('grant.toWhere', { provider: providerName(to.provider), host: to.host }) : providerName(to.provider);
    return to.account ? t('grant.person.where', { account: to.account, place }) : place;
  };
  const whence = (from: NonNullable<PersonGrantCard['migrations'][number]['from']>) =>
    from.account ? t('grant.person.where', { account: from.account, place: sourceName(from.provider) }) : sourceName(from.provider);

  const triesOf = (a: PersonGrantCard) => triesHere[a.ref] ?? a.tries ?? null;
  const stateOf = (a: PersonGrantCard): CardState =>
    (a.granted && !a.again) || connectedHere.has(a.ref) ? 'connected' : triesOf(a)?.locked === true ? 'locked' : 'waiting';
  const askedBy = data.askedBy ?? data.organisation;
  const hasPassword = data.accounts.some((a) => wayOf(a) === 'password');
  const everyConnected = connectedHere.size > 0 && data.accounts.every((a) => stateOf(a) === 'connected');

  // The first account that still shows a button to press: not connected (or
  // connected and asked for again), and ready. -1 when none does.
  const firstPressable = data.accounts.findIndex(
    (a) => wayOf(a) === 'sign-in' && !(a.granted && !a.again) && !a.notReady,
  );

  const card = (a: PersonGrantCard, i: number) => {
    const state = stateOf(a);
    const signIn = wayOf(a) === 'sign-in';
    return (
      <React.Fragment key={a.ref || `${a.role}:${a.account}`}>
        {/* During the Alpha, above the first Google button (the owner,
            2026-10-18): above the first account that still has a button,
            after any card already connected, and nowhere when none has. */}
        {i === firstPressable && (a.provider ?? 'google') === 'google' && <AlphaGoogleLine className="mt-6" />}
        <section
          aria-labelledby={`grant-account-${i}`}
          className="mt-4 p-4 border border-gray-200 rounded-lg"
          data-card-role={roleOf(a)}
          data-card-way={wayOf(a)}
          data-card-state={state}
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h3 id={`grant-account-${i}`} className="text-base font-semibold text-gray-900 break-words">
              {a.account}
            </h3>
            <span className={`px-2 py-0.5 text-xs font-medium rounded-full border ${STATE_TONE[state]}`}>
              {t(STATE_WORDS[state])}
            </span>
          </div>
          <ul className="mt-2 space-y-1 text-sm text-gray-700">
            {a.migrations.map((m, j) => (
              <li key={j} className="break-words">
                {roleOf(a) === 'target' && m.from
                  ? t('grant.person.migrationFrom', {
                      where: whence(m.from),
                      reads: list(m.domains.map((d) => t(cardReadsKey(a, d)))),
                    })
                  : t('grant.person.migration', {
                      where: where(m.to),
                      reads: list(m.domains.map((d) => t(cardReadsKey(a, d)))),
                    })}
                {/* Who else can open the copy, said plainly, not in a fold (the owner's
                    decisions of 2026-11-26, change 3): the destination is the
                    organisation's, not one the person connects on this link. */}
                {roleOf(a) !== 'target' && m.theOrganisationOpensIt && (
                  <span className="block text-gray-900">
                    {t('grant.person.theyOpenIt', { who: askedBy, destination: providerName(m.to.provider) })}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {a.granted && !a.again ? (
            <p className="mt-3 flex items-center gap-2 text-sm font-medium text-green-800">
              <CheckCircle2 className="w-5 h-5 flex-shrink-0" aria-hidden="true" />
              {t('grant.person.connected')}
            </p>
          ) : a.notReady ? (
            <p className="mt-3 text-sm text-amber-800">{locale === 'nl' ? a.notReady.reasonNl : a.notReady.reason}</p>
          ) : signIn && roleOf(a) === 'target' && a.provider === 'cirrux' ? (
            // Cirrux Drive, the destination's sign-in, offered once the
            // account's app password is stored (0174 §4.4). The refusals of
            // its ending are the server's own page, in the person's language.
            <div data-drive-card="cirrux">
              {a.again && <p className="mt-3 text-sm text-gray-900">{t('grant.person.again')}</p>}
              <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                <p className="flex items-start gap-2 text-sm text-green-900">
                  <ShieldCheck className="w-5 h-5 flex-shrink-0" aria-hidden="true" />
                  <span>{t('grant.cirrux.drive')}</span>
                </p>
              </div>
              <p className="mt-3 text-sm font-medium text-gray-900 break-words">
                {t('grant.cirrux.signInAs', { account: a.account })}
              </p>
              <button
                type="button"
                onClick={() => void connectDrive(a)}
                disabled={starting !== null}
                className="mt-3 min-h-[44px] px-4 py-2.5 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 break-words"
              >
                {starting === a.ref
                  ? t('grant.connecting.cirrux')
                  : t(a.again ? 'grant.connectAgain.cirrux' : 'grant.continue.cirrux')}
              </button>
              {failure?.account === a.ref && (
                <p role="alert" className="mt-3 text-sm text-amber-800">
                  {failureSentence(failure.error, locale, t)}
                </p>
              )}
            </div>
          ) : !signIn ? (
            <GrantPasswordCard
              link={link}
              card={a}
              askedBy={askedBy}
              organisation={data.organisation}
              onAnswer={onPasswordAnswer}
              connectedHere={connectedHere.has(a.ref)}
              tries={triesOf(a)}
            />
          ) : (
            <>
              {/* Connected, and asked for again: a link made while every
                  account was connected, because a connection can stop
                  working while its token is still held. */}
              {a.again && <p className="mt-3 text-sm text-gray-900">{t('grant.person.again')}</p>}
              <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                <p className="flex items-start gap-2 text-sm text-green-900">
                  <ShieldCheck className="w-5 h-5 flex-shrink-0" />
                  <span>{t(wordsOf(a.provider).readOnly(a.readOnlyAtProvider))}</span>
                </p>
              </div>
              {a.scope !== null && <GrantScope scope={a.scope} provider={(a.provider ?? 'google') as GrantProvider} className="mt-3" />}
              <p className="mt-3 text-sm font-medium text-gray-900 break-words">
                {t(wordsOf(a.provider).signInAs, { account: a.account })}
              </p>
              {(a.provider ?? 'google') === 'google' && <DoItTogether who={askedBy} className="mt-3" />}
              <button
                type="button"
                onClick={() => void connect(a.account, (a.provider ?? 'google') as GrantProvider)}
                disabled={starting !== null}
                className="mt-3 min-h-[44px] px-4 py-2.5 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 break-words"
              >
                {starting === a.account
                  ? t(wordsOf(a.provider).connecting)
                  : t(a.again ? wordsOf(a.provider).connectAgainAs : wordsOf(a.provider).connectAs, {
                      account: a.account,
                    })}
              </button>
              {failure?.account === a.account && (
                <p role="alert" className="mt-3 text-sm text-amber-800">
                  {failureSentence(failure.error, locale, t)}
                </p>
              )}
            </>
          )}
        </section>
      </React.Fragment>
    );
  };

  // Sources first: "is the destination yours?" is easiest with the source named (§4.5).
  const indexed = data.accounts.map((a, i) => ({ a, i }));
  const groups = (['source', 'target'] as const)
    .map((role) => ({ role, cards: indexed.filter(({ a }) => roleOf(a) === role) }))
    .filter((g) => g.cards.length > 0);

  return (
    <>
      <p className="mt-4 text-gray-900">{t('grant.person.asking', { organisation: data.organisation })}</p>
      {(data.checkedCompany || data.askedBy || data.organisationPhone) && (
        <dl className="mt-4 p-4 border border-gray-200 rounded-lg grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          {data.checkedCompany && (
            <>
              <dt className="text-gray-600">{t('grant.company')}</dt>
              <dd className="text-gray-900">
                <span className="block">{data.checkedCompany}</span>
                <span className="block text-xs text-gray-500">{t('grant.companyChecked')}</span>
              </dd>
            </>
          )}
          {data.askedBy && (
            <>
              <dt className="text-gray-600">{t('grant.askedBy')}</dt>
              <dd className="text-gray-900 break-all">{data.askedBy}</dd>
            </>
          )}
          {data.organisationPhone && (
            <>
              <dt className="text-gray-600">{t('grant.phone')}</dt>
              <dd className="text-gray-900">
                <a className="underline" href={`tel:${data.organisationPhone.replace(/[^0-9+]/g, '')}`}>
                  {data.organisationPhone}
                </a>
              </dd>
            </>
          )}
        </dl>
      )}
      {/* No phone to call back on, and a password asked (0174 §5.8): ask the
          one who sent it some other way, before typing anything. */}
      {hasPassword && !data.organisationPhone && (
        <p className="mt-2 text-sm text-amber-800" data-no-phone>
          {t('grant.password.noPhone', { organisation: data.organisation, askedBy })}
        </p>
      )}
      <p className="mt-2 text-sm font-medium text-gray-900">{t('grant.check')}</p>
      {/* The answer to that question when it is no (0108 T8 (d)), as a
          migration's page offers it: the report names the person and every
          migration of theirs. Offered only where a report can reach somebody. */}
      <ReportThisLink kind="grant" link={link} organisation={data.organisation} next="linkReport.next.grant" />
      {/* Before the first button, as on the migration's page: a link opened in
          a chat or mail app's own browser is refused by Google, so this has to
          be read before pressing (the owner's hand test, 2026-11-24). */}
      <p className="mt-3 text-sm text-gray-600">{t('grant.inAppBrowser')}</p>

      {groups.map((g) => (
        <section key={g.role} aria-labelledby={`grant-group-${g.role}`} className="mt-6" data-group={g.role}>
          <h2 id={`grant-group-${g.role}`} className="text-base font-semibold text-gray-900">
            {t(g.role === 'source' ? 'grant.group.from' : 'grant.group.to')}
          </h2>
          {g.cards.map(({ a, i }) => card(a, i))}
        </section>
      ))}

      {everyConnected && (
        <p role="status" className="mt-6 flex items-center gap-2 text-sm font-medium text-green-800">
          <CheckCircle2 className="w-5 h-5 flex-shrink-0" aria-hidden="true" />
          {t('grant.person.allConnected')}
        </p>
      )}
      {progressUrl !== null && (
        <div className="mt-4 p-3 border border-gray-200 rounded-lg text-sm text-gray-900" data-progress-link>
          <p>{t('grant.person.yourPage')}</p>
          <p className="mt-2 break-all">
            <a className="underline" href={progressUrl}>
              {progressUrl}
            </a>
          </p>
          <p className="mt-2 text-gray-700">{t('grant.person.keepIt')}</p>
        </div>
      )}

      <p className="mt-6 text-sm text-gray-600">{t('grant.until', { date: dateTime(data.expiresAt) })}</p>
      <p className="mt-6 text-sm text-gray-500">
        {t('grant.disclosure')}{' '}
        <a className="underline" href={legal.privacy}>
          {t('acceptance.doc.privacy')}
        </a>
        {' · '}
        <a className="underline" href={legal.terms}>
          {t('acceptance.doc.terms')}
        </a>
      </p>
      {/* Where each provider's access is withdrawn, once per sign-in provider on the page. */}
      {/* A destination's sign-in (Cirrux Drive) is withdrawn on the progress page (0174 §4.3). */}
      {[...new Set(data.accounts.filter((a) => wayOf(a) === 'sign-in' && roleOf(a) === 'source').map((a) => a.provider ?? 'google'))].map((p) => (
        <p key={p} className="mt-3 text-sm text-gray-500">
          {t(wordsOf(p).withdraw)}
        </p>
      ))}
      {/* Its own line: the one above lists what a person accepts (0145 T9 (b)). */}
      <p className="mt-3 text-sm text-gray-500">
        <AccessibilityLink className="underline" />
      </p>
    </>
  );
};

const Grant: React.FC = () => {
  const { link } = useParams<{ link: string }>();
  const t = useT();
  const { locale } = useLocale();
  const { dateTime, list } = useFormatters();
  // The policy and terms, in the reader's language. A value the module would
  // refuse never reaches here: the web build refuses it (`vite.config.ts`).
  const legal = legalLinks(locale);
  const [starting, setStarting] = React.useState(false);
  // The refusal itself rather than its sentence, so switching language after
  // it arrived shows the other half.
  const [failure, setFailure] = React.useState<unknown>(null);

  const subject = useQuery({
    queryKey: ['grant', link],
    queryFn: () => grantApi.read(link!),
    enabled: Boolean(link),
    retry: false,
  });

  // The tab's name goes back to what it was when this page leaves, so the
  // next screen is not called after this one. Its own effect, run once: a
  // language switch renames the tab and must not bring the old name back.
  React.useEffect(() => {
    const before = document.title;
    return () => {
      document.title = before;
    };
  }, []);
  // The tab's name, as the page's own title says it (the UX sweep, 2026-10-17).
  const title = t('grant.title');
  React.useEffect(() => {
    document.title = `${title} — Ownpace`;
  }, [title]);

  // A migration's own link: its one provider, once the page has read it.
  const single = {
    provider: (subject.data && !isPersonSubject(subject.data) ? subject.data.provider : undefined) ?? 'google',
  };

  const connect = async () => {
    if (!link) return;
    setStarting(true);
    setFailure(null);
    try {
      // The page's language, so the ending after Google is in it too.
      const provider = single.provider;
      const { url } = await grantApi.authorize(link, locale, provider);
      // Only to the provider's own page (0163 T4), the host by provider (0171).
      const consent = consentToFollow(provider, url);
      if (consent === null) {
        setFailure(new NotTheProvider(wordsOf(provider).name));
        setStarting(false);
        return;
      }
      // A full navigation, not a popup: there is no wizard window behind this
      // page to hand anything back to, and a popup blocked by the browser
      // would look exactly like a button that does nothing.
      globalThis.location.assign(consent);
    } catch (err) {
      setFailure(err);
      setStarting(false);
    }
  };

  return (
    <main className="max-w-xl mx-auto px-6 py-12">
      <LanguageSwitch className="justify-end mb-4" />
      <h1 className="text-xl font-semibold text-gray-900">{title}</h1>

      {subject.isPending && (
        <p role="status" className="mt-4 text-sm text-gray-600">
          {t('grant.loading')}
        </p>
      )}

      {subject.error != null && (
        // The server's own sentence, verbatim, in the half the page is in:
        // every refusal here is written to be forwarded to the person who sent
        // the link, and rewording it would lose the half that says what to
        // tell them. An alert, because it replaces the whole page.
        <p role="alert" className="mt-4 text-sm text-amber-800">
          {linkRefusal(subject.error, locale, t)}
        </p>
      )}

      {subject.data && isPersonSubject(subject.data) && link && (
        <PersonGrant data={subject.data} link={link} />
      )}
      {subject.data && isPersonSubject(subject.data) && link && (
        <YourNewAddress door="grant" link={link} changes={subject.data.addressChanges} queryKey={['grant', link]} />
      )}

      {subject.data && !isPersonSubject(subject.data) && (
        <>
          <p className="mt-4 text-gray-900">
            {t('grant.asking', { organisation: subject.data.organisation })}
          </p>

          <dl className="mt-4 p-4 border border-gray-200 rounded-lg grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            {/* The company as the EU VAT register names it (0108 T8a): shown
                only when the organisation's VAT number was checked and found
                valid, because it is the one name here nobody typed. */}
            {subject.data.checkedCompany && (
              <>
                <dt className="text-gray-600">{t('grant.company')}</dt>
                <dd className="text-gray-900">
                  <span className="block">{subject.data.checkedCompany}</span>
                  <span className="block text-xs text-gray-500">{t('grant.companyChecked')}</span>
                </dd>
              </>
            )}
            {subject.data.askedBy && (
              <>
                <dt className="text-gray-600">{t('grant.askedBy')}</dt>
                <dd className="text-gray-900 break-all">{subject.data.askedBy}</dd>
              </>
            )}
            {/* The organisation's number, when it gave one: optional, and the
                server shows nothing here that is not a phone number. */}
            {subject.data.organisationPhone && (
              <>
                <dt className="text-gray-600">{t('grant.phone')}</dt>
                <dd className="text-gray-900">
                  <a className="underline" href={`tel:${subject.data.organisationPhone.replace(/[^0-9+]/g, '')}`}>
                    {subject.data.organisationPhone}
                  </a>
                </dd>
              </>
            )}
            <dt className="text-gray-600">{t('grant.from')}</dt>
            <dd className="text-gray-900 break-all">{subject.data.from}</dd>
            <dt className="text-gray-600">{t('grant.to')}</dt>
            <dd className="text-gray-900 break-all">
              {subject.data.to.account && <span className="block">{subject.data.to.account}</span>}
              <span className="block text-gray-600">
                {subject.data.to.host
                  ? t('grant.toWhere', {
                      provider: providerName(subject.data.to.provider),
                      host: subject.data.to.host,
                    })
                  : providerName(subject.data.to.provider)}
              </span>
            </dd>
          </dl>
          <p className="mt-2 text-sm font-medium text-gray-900">{t('grant.check')}</p>
          {/* The answer to that question when it is no (0108 T8 (d)): tell
              the owner instead of continuing. Offered only where a report
              can reach somebody. */}
          {link && (
            <ReportThisLink
              kind="grant"
              link={link}
              organisation={subject.data.organisation}
              next="linkReport.next.grant"
            />
          )}
          <p className="mt-3 text-gray-900">
            {t('grant.reads', {
              reads: list(subject.data.domains.map((d) => t(readsKey(d, wordsOf(single.provider))))),
            })}
          </p>

          <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg">
            <p className="flex items-start gap-2 text-sm text-green-900">
              <ShieldCheck className="w-5 h-5 flex-shrink-0" />
              <span>{t(wordsOf(subject.data.provider).readOnly(subject.data.readOnlyAtProvider))}</span>
            </p>
          </div>

          <GrantScope scope={subject.data.scope} provider={single.provider} className="mt-4" />

          <p className="mt-4 text-sm text-gray-600">
            {t('grant.until', { date: dateTime(subject.data.expiresAt) })}
          </p>

          {/* The account is a condition, not a label (0108 T8 (b)): any other
              account that signs in is refused and nothing is kept. Said before
              the button, with why Google will also ask for their address. */}
          <p className="mt-4 text-sm font-medium text-gray-900 break-words">
            {t(wordsOf(subject.data.provider).signInAs, { account: subject.data.from })}
          </p>

          {/* A link sent by chat or mail opens inside that app's own browser,
              where Google is reported to refuse its consent (workplan 0140
              T3 (a); outside knowledge, 0140 §1). Always shown, with no
              sniffing for user agents, and before the button: opening the
              link again in the phone's own browser spends nothing (`grant.ts`), and
              the line says so. */}
          <p className="mt-3 text-sm text-gray-600">{t('grant.inAppBrowser')}</p>

          {/* During the Alpha, the guide's section on connecting Google,
              right above the button (the owner, 2026-10-18). */}
          {(subject.data.provider ?? 'google') === 'google' && <AlphaGoogleLine className="mt-3" />}
          {(subject.data.provider ?? 'google') === 'google' && (
            <DoItTogether who={subject.data.askedBy ?? subject.data.organisation} className="mt-3" />
          )}

          <button
            type="button"
            onClick={connect}
            disabled={starting}
            className="mt-6 px-4 py-2.5 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {starting
              ? t(wordsOf(subject.data.provider).connecting)
              : t(wordsOf(subject.data.provider).connect, { account: subject.data.from })}
          </button>

          {failure != null && (
            <p role="alert" className="mt-3 text-sm text-amber-800">
              {failureSentence(failure, locale, t)}
            </p>
          )}

          <p className="mt-6 text-sm text-gray-500">
            {t('grant.disclosure')}{' '}
            <a className="underline" href={legal.privacy}>
              {t('acceptance.doc.privacy')}
            </a>
            {' · '}
            <a className="underline" href={legal.terms}>
              {t('acceptance.doc.terms')}
            </a>
          </p>
          <p className="mt-3 text-sm text-gray-500">{t(wordsOf(subject.data.provider).withdraw)}</p>
          {/* Its own line: the one above lists what a person accepts (0145 T9 (b)). */}
          <p className="mt-3 text-sm text-gray-500">
            <AccessibilityLink className="underline" />
          </p>
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
