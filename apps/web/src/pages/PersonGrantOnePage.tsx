// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * EVERYTHING ON ONE PAGE (workplan 0176 D15 (a); the owner, 2026-11-26:
 * *"D15: a"*).
 *
 * A person's link asks one thing per screen (`PersonGrant.tsx`). The desk
 * review settled a disagreement about length with a second way to read: the
 * short screens, and from them the same sentences on one page, which prints.
 * The steps are gone once the person is at the provider; paper is still on
 * the table.
 *
 * ## The same sentences, written once
 *
 * Every sentence here is a step's own, from the steps' own dictionary keys,
 * in the steps' order: who asks and for what, with the question and what
 * *No, not yet* means; the accounts; then for each account still to connect,
 * what to have ready and what the provider will show, with the texts a person
 * accepts; and what *No, rather not* means. One sentence would not be true
 * here and says the same in other words: there is no *next screen*, so it
 * says *further down this page*. `everything-a-link-says-on-one-page` walks
 * every step of a link and finds each of their sentences on this page, so a
 * sentence added to a step and not here fails there.
 *
 * ## It reads; the steps act
 *
 * Nothing here leaves for a provider or sends a password: no provider's
 * button, no password box, and no answer to the question. A reader who wants
 * to go on goes back to the steps, by the link at the top and at the end. The
 * new address, where there is one, is the shared part as the accounts screen
 * draws it, and keeps its answer. The page asks the API for its link and that
 * link's report, as the steps do, and for nothing more: the link's secret goes
 * nowhere new. A link made for one migration is one page already, and goes
 * there.
 *
 * ## It prints
 *
 * One button asks the browser to print. On paper the controls are left off
 * (`print:hidden`): the language switch, the button itself, the links back and
 * *Report this link*. An account's part is kept on one sheet where it fits.
 *
 * ## The address, and the one link to it
 *
 * `/grant/<link>/all` (`ONE_PAGE_ROUTE`, `onePagePath`), under the link page's
 * own, so the web server's log writes the link as `:link` here too
 * (`apps/web/nginx.conf.template`), and the page keeps its policy of no
 * referrer. The link to it from the steps is `LinkToOnePage`, below, which the
 * steps draw (step B's main line places it, in `Grant.tsx`'s pages).
 */

import React from 'react';
import { Link, Navigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, ShieldCheck } from 'lucide-react';
import { DISCOVERY_DOMAINS } from '@openmig/shared';
import { grantApi, type GrantProvider, type GrantSubject, type PersonGrantCard, type PersonGrantSubject } from '../services/grant-service.ts';
import { linkRefusal } from '../services/link-refusal.ts';
import { legalLinks } from '../services/legal-links.ts';
import { InTheirVoice, useT, useFormatters, useLocale } from '../i18n/index.tsx';
import type { StringKey } from '../i18n/strings.ts';
import { DOMAIN_STRING_KEY } from '../i18n/domain-words.ts';
import BuildStamp from '../components/BuildStamp.tsx';
import LanguageSwitch from '../components/LanguageSwitch.tsx';
import ReportThisLink from '../components/ReportThisLink.tsx';
import { isAlpha } from '../components/AlphaNote.tsx';
import AccessibilityLink from '../components/AccessibilityLink.tsx';
import { PersonsPageProvider } from '../components/persons-page.tsx';
import { NumberToCheck, SenderName, numberToCheck, whoSent } from '../components/TheSender.tsx';
import { WhereItRuns } from '../components/WhereItRuns.tsx';
import { YourNewAddress } from '../components/YourNewAddress.tsx';
import { GrantScope, cardReadsKey, providerName, roleOf, sourceName, wayOf, wordsOf } from './grant-parts.tsx';

/** The route, beside the link page's own (`/grant/:link`). */
export const ONE_PAGE_ROUTE = '/grant/:link/all';

/** A link's one page, for the link to it from the steps. */
export const onePagePath = (link: string): string => `/grant/${link}/all`;

/** The sizes of a person's own page (0176 T9, §13), as the steps draw them. */
const MAIN_OUTLINED =
  'block w-full min-h-[60px] px-4 py-3 rounded-lg border-2 border-gray-700 bg-white text-gray-900 text-lg ' +
  'font-semibold text-center hover:bg-gray-50 break-words';
const QUIET = 'inline-flex min-h-[44px] min-w-[44px] items-center text-lg text-blue-700 underline underline-offset-4';

/** A card's state, as the steps' chip says it. */
type CardState = 'connected' | 'waiting' | 'locked';
const STATE_WORDS: Readonly<Record<CardState, StringKey>> = {
  connected: 'grant.state.connected',
  waiting: 'grant.state.waiting',
  locked: 'grant.state.locked',
};
const STATE_TONE: Readonly<Record<CardState, string>> = {
  connected: 'bg-green-50 text-green-900 border-green-300',
  waiting: 'bg-gray-50 text-gray-800 border-gray-400',
  locked: 'bg-amber-50 text-amber-900 border-amber-300',
};

/** As `Grant.tsx` tells them apart. */
const isPersonSubject = (s: GrantSubject | PersonGrantSubject): s is PersonGrantSubject =>
  'kind' in s && s.kind === 'person';

/** A card, as the steps name it. */
const keyOf = (a: PersonGrantCard): string => a.ref || `${roleOf(a)}:${a.account}`;
const signInName = (a: PersonGrantCard): string => (a.provider === 'cirrux' ? 'Cirrux' : wordsOf(a.provider).name);

/**
 * THE LINK TO THIS PAGE, from a person's link page (D15 (a): *"on each a link
 * to the same sentences on one page"*). The steps draw it; this page is where
 * its words are.
 */
export const LinkToOnePage: React.FC<{ link: string; className?: string }> = ({ link, className }) => {
  const t = useT();
  return (
    <Link className={className ?? QUIET} to={onePagePath(link)} data-one-page-link>
      {t('grant.onePage.link')}
    </Link>
  );
};

/** Everything a person's link says, in the steps' order and the steps' words. */
const Everything: React.FC<{ data: PersonGrantSubject; link: string }> = ({ data, link }) => {
  const t = useT();
  const { locale } = useLocale();
  const { dateTime, list } = useFormatters();
  const legal = legalLinks(locale);
  const id = React.useId();

  // Who sent it, as the steps name them (0176 T3, §7), and a number to check.
  const who = whoSent(data);
  const number = numberToCheck(data);
  const date = dateTime(data.expiresAt);
  const stateOf = (a: PersonGrantCard): CardState =>
    a.granted && !a.again ? 'connected' : a.tries?.locked === true ? 'locked' : 'waiting';
  const pressable = (a: PersonGrantCard): boolean => stateOf(a) === 'waiting' && !a.notReady;

  // Sources first, as the steps put them (0174 §4.5).
  const ordered = [...data.accounts.filter((a) => roleOf(a) === 'source'), ...data.accounts.filter((a) => roleOf(a) === 'target')];
  const askApplies = ordered.every((a) => stateOf(a) !== 'connected');
  const place = (name: string, address: string | null): string =>
    address ? t('grant.person.place', { place: name, account: address }) : name;
  const whereName = (to: PersonGrantCard['migrations'][number]['to']): string =>
    to.host ? t('grant.toWhere', { provider: providerName(to.provider), host: to.host }) : providerName(to.provider);
  const where = (to: PersonGrantCard['migrations'][number]['to']) =>
    to.account ? t('grant.person.where', { account: to.account, place: whereName(to) }) : whereName(to);
  const whence = (from: NonNullable<PersonGrantCard['migrations'][number]['from']>) =>
    from.account ? t('grant.person.where', { account: from.account, place: sourceName(from.provider) }) : sourceName(from.provider);
  const sourcePlace = (a: PersonGrantCard): string => (wayOf(a) === 'sign-in' ? signInName(a) : a.account);

  const sources = ordered.filter((a) => roleOf(a) === 'source');
  const targets = ordered.filter((a) => roleOf(a) === 'target');
  const destinations = [
    ...new Map(
      sources.flatMap((a) => a.migrations.map((m) => [`${m.to.provider}|${m.to.host ?? ''}|${m.to.account ?? ''}`, m.to] as const)),
    ).values(),
  ];
  const oneRoute = sources.length === 1 && destinations.length === 1 && targets.length <= 1;
  const what = list(
    DISCOVERY_DOMAINS.filter((d) => ordered.some((a) => a.migrations.some((m) => m.domains.includes(d)))).map((d) =>
      t(DOMAIN_STRING_KEY[d]).toLocaleLowerCase(locale),
    ),
  );
  const theyOpenItFirst = oneRoute && sources[0]!.migrations.some((m) => m.theOrganisationOpensIt);
  const everyConnected = ordered.every((a) => stateOf(a) === 'connected');
  const askedAgain = ordered.filter((a) => a.again && stateOf(a) !== 'connected');
  const waiting = ordered.filter(pressable);

  const again = (a: PersonGrantCard) => (
    <p className="mt-2 text-lg text-gray-900">
      {t('grant.person.again', { who })}
      {isAlpha() && (a.provider ?? 'google') === 'google' && ` ${t('grant.person.again.alpha')}`}
    </p>
  );

  /** Where each of an account's migrations goes, and what it copies, as the steps say it. */
  const migrationLines = (a: PersonGrantCard) => (
    <ul className="mt-2 space-y-1 text-lg text-gray-900">
      {a.migrations.map((m, j) => (
        <li key={j} className="break-words">
          {roleOf(a) === 'target' && m.from
            ? t('grant.person.migrationFrom', { where: whence(m.from), reads: list(m.domains.map((d) => t(cardReadsKey(a, d)))) })
            : t('grant.person.migration', { where: where(m.to), reads: list(m.domains.map((d) => t(cardReadsKey(a, d)))) })}
          {!theyOpenItFirst && roleOf(a) !== 'target' && m.theOrganisationOpensIt && (
            <span className="block">{t('grant.person.theyOpenIt', { who, destination: providerName(m.to.provider) })}</span>
          )}
        </li>
      ))}
    </ul>
  );

  /** The texts a person accepts, with their two links, as the steps put them before a provider's page. */
  const textsAccepted = (
    <p className="mt-3 text-lg text-gray-900">
      {t('grant.disclosure')}{' '}
      <a className={QUIET} href={legal.privacy}>
        {t('acceptance.doc.privacy')}
      </a>
      {' · '}
      <a className={QUIET} href={legal.terms}>
        {t('acceptance.doc.terms')}
      </a>
    </p>
  );

  const back = (
    <p className="mt-4 print:hidden">
      <Link className={QUIET} to={`/grant/${link}`} data-back>
        {t('grant.onePage.back')}
      </Link>
    </p>
  );

  /** What to have ready, and what the provider shows, for one account still to connect (§5.4). */
  const toConnect = (a: PersonGrantCard) => {
    const signIn = wayOf(a) === 'sign-in';
    const provider = a.provider ?? 'google';
    const name = signIn ? signInName(a) : '';
    const google = provider === 'google';
    const cirrux = provider === 'cirrux';
    const alpha = google && isAlpha();
    const heldToReading = !google || a.readOnlyAtProvider;
    const headingId = `${id}-connect-${keyOf(a)}`;
    return (
      <section key={keyOf(a)} aria-labelledby={headingId} className="mt-10 print:break-inside-avoid" data-to-connect={keyOf(a)}>
        <h2 id={headingId} className="text-xl font-semibold text-gray-900 break-all">
          {t('grant.person.connectAccount', { account: a.account })}
        </h2>
        <h3 className="mt-4 text-lg font-semibold text-gray-900">{t('grant.person.ready.title')}</h3>
        <ul className="mt-2 space-y-2 list-disc pl-6 text-lg text-gray-900">
          <li>{t('grant.person.ready.address', { account: a.account })}</li>
          <li>
            {signIn ? t('grant.person.ready.password', { provider: name }) : t('grant.person.ready.passwordOf', { account: a.account })}
          </li>
          {signIn && <li>{t('grant.person.ready.typeIt', { provider: name, who })}</li>}
          {signIn && <li>{t('grant.person.ready.phone', { provider: name })}</li>}
          {signIn && <li>{t('grant.person.ready.code', { who })}</li>}
        </ul>
        <p className="mt-4 text-lg text-gray-900">{t('grant.person.ready.unknownPassword', { who })}</p>
        {signIn && google && isAlpha() && <p className="mt-3 text-lg text-gray-900">{t('grant.person.ready.together', { who })}</p>}
        {signIn && <p className="mt-3 text-lg text-gray-900">{t('grant.inAppBrowser')}</p>}
        {signIn ? (
          <>
            <h3 className="mt-6 text-lg font-semibold text-gray-900">{t('grant.person.see.title', { provider: name })}</h3>
            <ol className="mt-2 space-y-4 list-decimal pl-6 text-lg text-gray-900">
              <li>
                <span>{t('grant.person.see.signIn', { provider: name })}</span>{' '}
                <span>
                  {cirrux ? t('grant.cirrux.signInAs', { account: a.account }) : t(wordsOf(provider).signInAs, { account: a.account })}
                </span>
              </li>
              {alpha && (
                <li>{[t('grant.person.see.warning'), t('grant.person.see.goOn'), t('grant.person.see.onlyHere', { who })].join(' ')}</li>
              )}
              <li>
                {cirrux ? (
                  <p className="flex items-start gap-2">
                    <ShieldCheck className="w-6 h-6 flex-shrink-0" aria-hidden="true" />
                    <span>{t('grant.cirrux.drive')}</span>
                  </p>
                ) : (
                  <>
                    {a.scope !== null && <GrantScope scope={a.scope} provider={provider as GrantProvider} className="" />}
                    {heldToReading ? (
                      <p className="mt-3 flex items-start gap-2">
                        <ShieldCheck className="w-6 h-6 flex-shrink-0" aria-hidden="true" />
                        <span>{t(wordsOf(provider).readOnly(true))}</span>
                      </p>
                    ) : (
                      <p className="mt-3">{t('grant.person.see.broader')}</p>
                    )}
                    {google && <p className="mt-3">{t('grant.person.see.ticks')}</p>}
                  </>
                )}
              </li>
              {alpha && <li>{t('grant.person.see.blocked', { who })}</li>}
            </ol>
            <p className="mt-6 text-lg text-gray-900">{t('grant.person.see.stop')}</p>
          </>
        ) : null}
        <p className="mt-3 text-lg text-gray-900">{t('grant.until', { date })}</p>
        {textsAccepted}
        {!signIn && number === null && (
          <p className="mt-3 text-lg text-amber-900">
            {t('grant.password.noPhone', { organisation: data.organisation, askedBy: who })}
          </p>
        )}
      </section>
    );
  };

  const groups = (['source', 'target'] as const)
    .map((role) => ({ role, cards: ordered.filter((a) => roleOf(a) === role) }))
    .filter((g) => g.cards.length > 0);

  return (
    <>
      <div className="mt-4 print:hidden">
        <button type="button" data-main className={MAIN_OUTLINED} onClick={() => window.print()}>
          {t('grant.onePage.print')}
        </button>
      </div>
      {back}

      {/* Who asks, and for what (§5.1): the first screen's, and its question. */}
      <section aria-labelledby={`${id}-ask`} className="mt-8">
        <p className="text-lg text-gray-900">{t('grant.person.ownpace')}</p>
        <WhereItRuns className="mt-1 text-lg text-gray-900" />
        <h2 id={`${id}-ask`} className="mt-4 text-xl font-semibold text-gray-900 break-words">
          {t('grant.person.title', { who })}
        </h2>
        {askedAgain.length > 0 && (
          <p className="mt-4 text-lg text-gray-900">
            {t('grant.person.again', { who })}
            {isAlpha() && askedAgain.some((a) => (a.provider ?? 'google') === 'google') && ` ${t('grant.person.again.alpha')}`}
          </p>
        )}
        {/* The sender's facts, as the first screen draws them (T3, §7): the
            name, else the address, with the address under a name, and a
            number to check (D11). The address breaks anywhere, as there. */}
        <div data-sender className="mt-4 p-4 border border-gray-300 rounded-lg bg-white">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-lg">
            {data.checkedCompany && (
              <>
                <dt className="text-gray-800">{t('grant.company')}</dt>
                <dd className="text-gray-900">
                  <span className="block">{data.checkedCompany}</span>
                  <span className="block text-base text-gray-800">{t('grant.companyChecked')}</span>
                </dd>
              </>
            )}
            <dt className="text-gray-800">{t('grant.person.sender')}</dt>
            <dd className="text-gray-900 wrap-anywhere">
              <span className="block">
                <SenderName facts={data} />
              </span>
              {data.sender?.name && data.askedBy && (
                <span className="block text-base text-gray-800 break-all">{data.askedBy}</span>
              )}
            </dd>
          </dl>
          <NumberToCheck facts={data} className="mt-3 text-lg text-gray-900" />
        </div>
        <p className="mt-4 text-lg text-gray-900">
          {oneRoute
            ? t('grant.person.whatOne', {
                who,
                what,
                source: place(sourcePlace(sources[0]!), wayOf(sources[0]!) === 'sign-in' ? sources[0]!.account : null),
                destination: place(whereName(destinations[0]!), destinations[0]!.account),
              })
            : t('grant.onePage.whatMany', { who, what })}
        </p>
        <ul className="mt-3 space-y-2 list-disc pl-6 text-lg text-gray-900">
          {sources.length > 0 && <li>{t('grant.person.fact.stays', { source: list([...new Set(sources.map(sourcePlace))]) })}</li>}
          {sources.length > 0 && <li>{t('grant.person.fact.reads')}</li>}
          {theyOpenItFirst && <li>{t('grant.person.theyOpenIt', { who, destination: providerName(destinations[0]!.provider) })}</li>}
          <li>{t('grant.person.fact.noHurry', { date })}</li>
        </ul>
        {askApplies && (
          <>
            <p className="mt-6 text-lg font-semibold text-gray-900">{t('grant.person.told', { who })}</p>
            {/* What *No, not yet* opens on the steps (§5.2). */}
            <h3 className="mt-4 text-lg font-semibold text-gray-900">{t('grant.person.notYet')}</h3>
            <h4 className="mt-2 text-lg font-semibold text-gray-900">{t('grant.person.wait.title')}</h4>
            <p className="mt-2 text-lg text-gray-900">{t('grant.person.wait.ask', { who })}</p>
            <p className="mt-3 text-lg text-gray-900">{t('grant.person.wait.until', { date })}</p>
            <p className="mt-3 text-lg text-gray-900">{t('grant.person.wait.unknown', { who })}</p>
          </>
        )}
      </section>

      {/* The accounts (§5.3). */}
      <section aria-labelledby={`${id}-accounts`} className="mt-10">
        <h2 id={`${id}-accounts`} className="text-xl font-semibold text-gray-900">
          {t('grant.person.accounts.title')}
        </h2>
        {groups.map((g) => (
          <section key={g.role} aria-labelledby={`${id}-group-${g.role}`} className="mt-6" data-group={g.role}>
            <h3 id={`${id}-group-${g.role}`} className="text-lg font-semibold text-gray-900">
              {t(g.role === 'source' ? 'grant.group.from' : 'grant.group.to')}
            </h3>
            {g.cards.map((a) => {
              const state = stateOf(a);
              const cardId = `${id}-${g.role}-${keyOf(a)}`;
              return (
                <section
                  key={keyOf(a)}
                  aria-labelledby={cardId}
                  className="mt-4 border-t border-gray-200 pt-4 print:break-inside-avoid"
                  data-card-role={roleOf(a)}
                  data-card-state={state}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h4 id={cardId} className="text-lg font-semibold text-gray-900 break-all">
                      {a.account}
                    </h4>
                    <span className={`px-2.5 py-1 text-base font-medium rounded-full border ${STATE_TONE[state]}`}>
                      {t(STATE_WORDS[state])}
                    </span>
                  </div>
                  {migrationLines(a)}
                  {a.again && state !== 'connected' && again(a)}
                  {state === 'connected' ? (
                    <p className="mt-3 flex items-center gap-2 text-lg font-medium text-green-900">
                      <CheckCircle2 className="w-6 h-6 flex-shrink-0" aria-hidden="true" />
                      {t('grant.person.connected')}
                    </p>
                  ) : a.notReady ? (
                    <p className="mt-3 text-lg text-amber-900">{locale === 'nl' ? a.notReady.reasonNl : a.notReady.reason}</p>
                  ) : state === 'locked' ? (
                    <p className="mt-3 text-lg text-amber-900">{t('grant.password.locked', { askedBy: who })}</p>
                  ) : null}
                </section>
              );
            })}
          </section>
        ))}
        <YourNewAddress door="grant" link={link} changes={data.addressChanges} queryKey={['grant', link]} />
        {everyConnected && (
          <p className="mt-6 flex items-center gap-2 text-lg font-medium text-green-900">
            <CheckCircle2 className="w-6 h-6 flex-shrink-0" aria-hidden="true" />
            {t('grant.person.allConnected')}
          </p>
        )}
      </section>

      {/* Each account still to connect: what to have ready, then what its provider shows (§5.4). */}
      {waiting.map(toConnect)}

      {/* What *No, rather not* says on the steps, before a provider's page. */}
      {waiting.some((a) => wayOf(a) === 'sign-in') && (
        <section aria-labelledby={`${id}-rather-not`} className="mt-10 print:break-inside-avoid">
          <h2 id={`${id}-rather-not`} className="text-xl font-semibold text-gray-900">
            {t('grant.person.ratherNot')}
          </h2>
          <h3 className="mt-2 text-lg font-semibold text-gray-900">{t('grant.person.ratherNot.title')}</h3>
          <p className="mt-2 text-lg text-gray-900">{t('grant.person.ratherNot.body', { date })}</p>
        </section>
      )}

      <div className="mt-10">{back}</div>
      {/* The foot, as on every screen of the steps (0145 T9 (b)). */}
      <div data-foot className="mt-10 border-t border-gray-300 pt-4 space-y-1">
        <div className="print:hidden">
          <ReportThisLink kind="grant" link={link} organisation={data.organisation} next="linkReport.next.grant" look="link" />
        </div>
        <p>
          <AccessibilityLink className={`${QUIET} text-gray-900`} />
        </p>
      </div>
    </>
  );
};

const PersonGrantOnePage: React.FC = () => {
  const { link } = useParams<{ link: string }>();
  const t = useT();
  const { locale } = useLocale();
  // The link page's own query, so a visit from the steps asks nothing again.
  const subject = useQuery({
    queryKey: ['grant', link],
    queryFn: () => grantApi.read(link!),
    enabled: Boolean(link),
    retry: false,
  });

  const title = t('grant.onePage.title');
  // The tab's name goes back to what it was when this page leaves, as the link page's does.
  React.useEffect(() => {
    const before = document.title;
    return () => {
      document.title = before;
    };
  }, []);
  React.useEffect(() => {
    document.title = `${title} — Ownpace`;
  }, [title]);

  if (link && subject.data && !isPersonSubject(subject.data)) return <Navigate to={`/grant/${link}`} replace />;
  const data = subject.data && isPersonSubject(subject.data) ? subject.data : null;
  const who = data ? whoSent(data) : '';
  return (
    // In the voice chosen for them (0176 T7), as the steps are.
    <InTheirVoice language={data?.language} register={data?.register}>
      <PersonsPageProvider value={{ who }}>
        <main data-persons-page data-one-page className="max-w-xl mx-auto px-4 py-8 sm:py-12">
          <LanguageSwitch className="justify-end mb-4 print:hidden" />
          <h1 className="text-2xl font-semibold text-gray-900 break-words">{title}</h1>
          {subject.isPending && (
            <p role="status" className="mt-4 text-lg text-gray-900">
              {t('grant.loading')}
            </p>
          )}
          {subject.error != null && (
            <p role="alert" className="mt-4 text-lg text-amber-900">
              {linkRefusal(subject.error, locale, t)}
            </p>
          )}
          {data && link && <Everything data={data} link={link} />}
          <div className="mt-10 text-center">
            <BuildStamp />
          </div>
        </main>
      </PersonsPageProvider>
    </InTheirVoice>
  );
};

export default PersonGrantOnePage;
