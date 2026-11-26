// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A PERSON'S LINK, ONE THING AT A TIME (workplan 0176 T1, §5; ADR-0035,
 * amended 2026-09-29).
 *
 * The reader has no account, did not ask for this, and is often older. A
 * bank, the police or a child taught them three things: never tap a link in a
 * message, never give a code to anybody, and stop at a warning. The page
 * cannot ask for their trust; it gives them something to check, one thing per
 * screen (R1 to R8 of the plan):
 *
 * 1. **Who asks, and for what**, with one question: *Did {who} tell you about
 *    this link themselves?* *No, not yet* is as good an answer as *yes*, and
 *    leads to a calm screen that says the page can wait (§5.1, §5.2). The
 *    answer is kept for the tab only, under the link's id and never its
 *    secret, and is sent nowhere: nothing on the server depends on it.
 * 2. **The accounts**, where there is more than one, or one connected
 *    already, or a new address to confirm (§5.3). With one waiting account
 *    and nothing else the page goes straight on.
 * 3. **What to have ready** (§5.4): the address, the password, the phone, and
 *    that a code is given to nobody. For an account connected with the
 *    person's own password this is its one screen, with the card.
 * 4. **What the provider will show**, told before it comes (R1, R3): the
 *    sign-in, during the Alpha Google's warning in our own words (D12 (a):
 *    nothing of Google's is quoted until the owner's hand test has it), what
 *    Google asks, and what to do when Google does not allow the connection.
 *    Then the texts a person accepts, and the provider's button.
 *
 * ## Steps, as a browser and a screen reader meet them (§5.6)
 *
 * Each step is an entry in the browser's history, so Back goes one step back
 * and never off the page. Each has one `h1`; on Next and Back the focus moves
 * to it and the page goes to its top, smoothly only where the reader has no
 * preference about motion; the first render moves nothing. The tab is named
 * after the step, and *Step n of total* is said in words, its last number the
 * provider's own page. A step is a place in the page, not an address: one
 * opened first, with no answer in the tab, shows the first screen.
 *
 * ## What it must never do, as the page before it
 *
 * Never show a token, never receive one, never postMessage (`Grant.tsx`). The
 * provider's button goes only to that provider's own page
 * (`consentToFollow`), and a page shown again from the browser's back cache
 * has no button left pressed.
 */

import React from 'react';
import { useLocation, useNavigate } from 'react-router';
import { CheckCircle2, ShieldCheck } from 'lucide-react';
import { DISCOVERY_DOMAINS } from '@openmig/shared';
import {
  grantApi,
  type GrantProvider,
  type PasswordAnswer,
  type PersonGrantCard,
  type PersonGrantSubject,
} from '../services/grant-service.ts';
import { consentToFollow } from '../services/address-to-follow.ts';
import { legalLinks } from '../services/legal-links.ts';
import { useT, useFormatters, useLocale } from '../i18n/index.tsx';
import type { StringKey } from '../i18n/strings.ts';
import { DOMAIN_STRING_KEY } from '../i18n/domain-words.ts';
import ReportThisLink from '../components/ReportThisLink.tsx';
import { isAlpha } from '../components/AlphaNote.tsx';
import AccessibilityLink from '../components/AccessibilityLink.tsx';
import { GrantPasswordCard } from '../components/GrantPasswordCard.tsx';
import { YourNewAddress } from '../components/YourNewAddress.tsx';
import { NumberToCheck, SenderName, numberToCheck, whoSent } from '../components/TheSender.tsx';
import {
  GrantScope,
  NotTheProvider,
  cardReadsKey,
  failureSentence,
  providerName,
  roleOf,
  sourceName,
  wayOf,
  wordsOf,
} from './grant-parts.tsx';

/** A card's state, as its chip says it (0174 §4.5): connected, waiting, or locked on this link. */
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

/**
 * The sizes of a person's own page (workplan 0176 T9, §13): sentences at 18
 * pixels and 7 to 1, a main button 60 pixels high and as wide as the column,
 * an outlined edge at 3 to 1, and every other target 44 by 44. Two answers to
 * one question share one box.
 */
const MAIN_FILLED =
  'block w-full min-h-[60px] px-4 py-3 rounded-lg bg-blue-700 text-white text-lg font-semibold text-center ' +
  'hover:bg-blue-800 disabled:opacity-60 break-words';
const MAIN_OUTLINED =
  'block w-full min-h-[60px] px-4 py-3 rounded-lg border-2 border-gray-700 bg-white text-gray-900 text-lg ' +
  'font-semibold text-center hover:bg-gray-50 disabled:opacity-60 break-words';
const QUIET = 'inline-flex min-h-[44px] min-w-[44px] items-center text-lg text-blue-700 underline underline-offset-4';

/** The kinds of screen, as each is kept in the browser's history. */
const STEP_KINDS = ['ask', 'notYet', 'accounts', 'ready', 'provider', 'ratherNot'] as const;
type StepKind = (typeof STEP_KINDS)[number];

interface Step {
  readonly kind: StepKind;
  /** The account a step is about, by `keyOf`. */
  readonly account?: string;
}

/** What a step leaves in the browser's history: the step, and whether the page put it there. */
interface StepState {
  readonly grantStep: StepKind;
  readonly account?: string;
  readonly back?: boolean;
}

function stepIn(state: unknown): Step | null {
  if (state === null || typeof state !== 'object') return null;
  const s = state as Partial<StepState>;
  const kind = STEP_KINDS.find((k) => k === s.grantStep);
  if (kind === undefined) return null;
  return typeof s.account === 'string' ? { kind, account: s.account } : { kind };
}

/** A card, as the page names it: its `ref`, or its role and account from before 0174. */
const keyOf = (a: PersonGrantCard): string => a.ref || `${roleOf(a)}:${a.account}`;

/** A sign-in account's provider, by the name its page uses. */
const signInName = (a: PersonGrantCard): string => (a.provider === 'cirrux' ? 'Cirrux' : wordsOf(a.provider).name);

/**
 * THE ANSWER, FOR THE TAB ONLY (§5.1, T1.7). The key names the link by its id
 * (`p.<id>.<secret>`, or a migration's `<id>.<secret>`) and never by its
 * secret; the value is one word. Storage can be refused (a browser that
 * blocks site data, a private window): then the page asks again on its next
 * opening, which is all the answer was for. Nothing is lost: it was never
 * sent anywhere.
 */
function linkIdOf(link: string): string | null {
  const parts = link.split('.');
  if (parts.length < 2) return null;
  return parts[0] === 'p' && parts.length >= 3 ? (parts[1] ?? null) : (parts[0] ?? null);
}
const toldKey = (id: string): string => `ownpace.grant.told.${id}`;

function readTold(link: string): boolean {
  const id = linkIdOf(link);
  if (id === null) return false;
  try {
    return window.sessionStorage.getItem(toldKey(id)) === 'yes';
  } catch {
    // Refused storage: unanswered, so the page asks again (see above).
    return false;
  }
}

function keepTold(link: string): void {
  const id = linkIdOf(link);
  if (id === null) return;
  try {
    window.sessionStorage.setItem(toldKey(id), 'yes');
  } catch {
    // Refused storage: kept on this visit only (`answeredHere`), asked again next time.
  }
}

/**
 * Whether the reader's browser says motion is fine: the step change scrolls
 * smoothly only then, as *Start a migration*'s does (0145 T3 (a)).
 */
const motionWelcome = (): boolean =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: no-preference)').matches;

export const PersonGrant: React.FC<{ data: PersonGrantSubject; link: string }> = ({ data, link }) => {
  const t = useT();
  const { locale } = useLocale();
  const { dateTime, list } = useFormatters();
  const legal = legalLinks(locale);
  const location = useLocation();
  const navigate = useNavigate();
  const h1Id = React.useId();
  const questionId = React.useId();

  // Which account's button was pressed, and what refused it (by `keyOf`).
  const [starting, setStarting] = React.useState<string | null>(null);
  const [failure, setFailure] = React.useState<{ account: string; error: unknown } | null>(null);
  // Password cards connected on this visit, and the tries their last answer left (by `ref`).
  const [connectedHere, setConnectedHere] = React.useState<ReadonlySet<string>>(new Set());
  const [triesHere, setTriesHere] = React.useState<Readonly<Record<string, { left: number; locked: boolean }>>>({});
  // The person's progress page, minted by the password route after a write (0174 §5.3 step 8).
  const [progressUrl, setProgressUrl] = React.useState<string | null>(null);
  // The answer, on this visit, whether or not the tab could keep it.
  const [answeredHere, setAnsweredHere] = React.useState(false);
  // Whether the tab held it when the page opened: only then does the page open
  // past the first screen. Answered on this visit, Back still reaches it.
  const [answeredAtOpen] = React.useState(() => readTold(link));

  // SHOWN AGAIN FROM THE BACK CACHE (T1.8): a press left for the provider,
  // and the browser's Back brought the page back as it was, with its button
  // still pressed. The sign-in page clears its own the same way (`Login.tsx`).
  React.useEffect(() => {
    const shown = (e: Event) => {
      if ((e as PageTransitionEvent).persisted) setStarting(null);
    };
    window.addEventListener('pageshow', shown);
    return () => window.removeEventListener('pageshow', shown);
  }, []);

  // Who sent the link (0176 §7, T3): the name the member gave, else their
  // address, else the organisation. Every {who} on the page is this one.
  const who = whoSent(data);
  const number = numberToCheck(data);
  const date = dateTime(data.expiresAt);
  const triesOf = (a: PersonGrantCard) => triesHere[a.ref] ?? a.tries ?? null;
  const stateOf = (a: PersonGrantCard): CardState =>
    (a.granted && !a.again) || connectedHere.has(a.ref) ? 'connected' : triesOf(a)?.locked === true ? 'locked' : 'waiting';
  const pressable = (a: PersonGrantCard): boolean => stateOf(a) === 'waiting' && !a.notReady;

  // Sources first: "is the destination yours?" is easiest with the source named (0174 §4.5).
  const ordered = [...data.accounts.filter((a) => roleOf(a) === 'source'), ...data.accounts.filter((a) => roleOf(a) === 'target')];
  const byKey = (key: string | undefined) => ordered.find((a) => keyOf(a) === key);
  const first = ordered[0]!;

  // Shown while no account on the link is connected (§5.1): one asked again counts as waiting.
  const askApplies = ordered.every((a) => stateOf(a) !== 'connected');
  const answered = answeredHere || readTold(link);
  const hasAddress = (data.addressChanges?.length ?? 0) > 0;
  // More than one account, one connected already, a new address to confirm,
  // or one that cannot be pressed and says why: the accounts get a screen (§5.3).
  const accountsShown = ordered.length > 1 || !askApplies || hasAddress || !pressable(first);

  const initial = (): Step =>
    askApplies && !answeredAtOpen
      ? { kind: 'ask' }
      : accountsShown
        ? { kind: 'accounts' }
        : { kind: 'ready', account: keyOf(first) };
  const valid = (s: Step | null): Step | null => {
    if (s === null) return null;
    // A step opened first, with no answer in the tab, shows the first screen.
    if (askApplies && !answered && s.kind !== 'ask' && s.kind !== 'notYet') return null;
    const a = byKey(s.account);
    switch (s.kind) {
      case 'ask':
      case 'notYet':
        return askApplies ? s : null;
      case 'accounts':
        return accountsShown ? s : null;
      case 'ready':
        // Kept once connected or locked here: what the card answered stays on screen.
        return a && (pressable(a) || connectedHere.has(a.ref) || triesHere[a.ref]?.locked === true) ? s : null;
      case 'provider':
      case 'ratherNot':
        return a && pressable(a) && wayOf(a) === 'sign-in' ? s : null;
    }
  };
  const step = valid(stepIn(location.state)) ?? initial();
  const account = byKey(step.account);

  const go = (next: Step) =>
    void navigate(`${location.pathname}${location.search}`, {
      state: { grantStep: next.kind, ...(next.account ? { account: next.account } : {}), back: true } satisfies StepState,
    });
  const previousOf = (s: Step): Step | null => {
    switch (s.kind) {
      case 'ask':
        return null;
      case 'notYet':
        return { kind: 'ask' };
      case 'accounts':
        return askApplies ? { kind: 'ask' } : null;
      case 'ready':
        return accountsShown ? { kind: 'accounts' } : askApplies ? { kind: 'ask' } : null;
      case 'provider':
        return { kind: 'ready', ...(s.account ? { account: s.account } : {}) };
      case 'ratherNot':
        return { kind: 'provider', ...(s.account ? { account: s.account } : {}) };
    }
  };
  const previous = previousOf(step);
  const back = () => {
    if ((location.state as Partial<StepState> | null)?.back === true) void navigate(-1);
    else if (previous) {
      void navigate(`${location.pathname}${location.search}`, {
        state: { grantStep: previous.kind, ...(previous.account ? { account: previous.account } : {}) } satisfies StepState,
      });
    }
  };

  // STEP n OF total (§5.6): the last number is the provider's own page, so
  // the count does not end where the hard part starts. A password account has
  // no such page. Before an account is chosen, the first that waits counts.
  const counted = account ?? ordered.find(pressable);
  const path: StepKind[] = [
    ...(askApplies ? (['ask'] as const) : []),
    ...(accountsShown ? (['accounts'] as const) : []),
    ...(counted ? (wayOf(counted) === 'sign-in' ? (['ready', 'provider'] as const) : (['ready'] as const)) : []),
  ];
  const total = path.length + (counted && wayOf(counted) === 'sign-in' ? 1 : 0);
  const n = path.indexOf(step.kind) + 1;

  const title = ((): string => {
    switch (step.kind) {
      case 'ask':
        return t('grant.person.title', { who });
      case 'notYet':
        return t('grant.person.wait.title');
      case 'accounts':
        return t('grant.person.accounts.title');
      case 'ready':
        return t('grant.person.ready.title');
      case 'provider':
        return t('grant.person.see.title', { provider: account ? signInName(account) : '' });
      case 'ratherNot':
        return t('grant.person.ratherNot.title');
    }
  })();

  // A NEW SCREEN STARTS AT THE TOP, with focus on its heading (§5.6, 0145 T3
  // (a)). Not on the first render: opening the page moves nothing.
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  const stepId = `${step.kind}:${step.account ?? ''}`;
  const shownStep = React.useRef(stepId);
  React.useLayoutEffect(() => {
    if (shownStep.current === stepId) return;
    shownStep.current = stepId;
    headingRef.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, left: 0, behavior: motionWelcome() ? 'smooth' : 'instant' });
  }, [stepId]);
  // The tab named after the step (criterion 2.4.2); `Grant` gives it its old name back on leaving.
  React.useEffect(() => {
    document.title = `${title} — Ownpace`;
  }, [title]);

  const connect = async (a: PersonGrantCard) => {
    const key = keyOf(a);
    setStarting(key);
    setFailure(null);
    try {
      if (a.provider === 'cirrux') {
        // A destination's Cirrux Drive (0174 §4.4, T5): named by its `ref`,
        // since Cirrux vouches for no address; followed only to Cirrux's own host.
        const { url } = await grantApi.authorizeDrive(link, a.ref, locale);
        const consent = consentToFollow('cirrux', url);
        if (consent === null) {
          setFailure({ account: key, error: new NotTheProvider('Cirrux') });
          setStarting(null);
          return;
        }
        globalThis.location.assign(consent);
        return;
      }
      const provider = (a.provider ?? 'google') as GrantProvider;
      const { url } = await grantApi.authorize(link, locale, provider, a.account);
      // Only to the provider's own page (0163 T4), the host by provider (0171).
      const consent = consentToFollow(provider, url);
      if (consent === null) {
        setFailure({ account: key, error: new NotTheProvider(wordsOf(provider).name) });
        setStarting(null);
        return;
      }
      globalThis.location.assign(consent);
    } catch (error) {
      setFailure({ account: key, error });
      setStarting(null);
    }
  };

  const onPasswordAnswer = (ref: string, answer: PasswordAnswer) => {
    if (answer.kind === 'connected') {
      setConnectedHere((prev) => new Set(prev).add(ref));
      if (answer.progressUrl !== undefined) setProgressUrl(answer.progressUrl);
    } else if (answer.kind === 'locked') setTriesHere((prev) => ({ ...prev, [ref]: { left: 0, locked: true } }));
    else if (answer.kind === 'refused_login' && answer.left !== null) {
      setTriesHere((prev) => ({ ...prev, [ref]: { left: answer.left!, locked: false } }));
    }
  };

  // WHERE FROM AND WHERE TO (0108 T8a): the two facts only the reader can check.
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
  // Everything on the link copied from one account to one place: one sentence says it (§5.1).
  const oneRoute = sources.length === 1 && destinations.length === 1 && targets.length <= 1;
  const what = list(
    DISCOVERY_DOMAINS.filter((d) => ordered.some((a) => a.migrations.some((m) => m.domains.includes(d)))).map((d) =>
      t(DOMAIN_STRING_KEY[d]).toLocaleLowerCase(locale),
    ),
  );
  const theyOpenItFirst = oneRoute && sources[0]!.migrations.some((m) => m.theOrganisationOpensIt);
  const everyConnected = ordered.every((a) => stateOf(a) === 'connected');
  const askedAgain = ordered.filter((a) => a.again && stateOf(a) !== 'connected');

  /** The lines that say where each of an account's migrations goes, and what it copies. */
  const migrationLines = (a: PersonGrantCard, opts: { theyOpenIt: boolean }) => (
    <ul className="mt-2 space-y-1 text-lg text-gray-900">
      {a.migrations.map((m, j) => (
        <li key={j} className="break-words">
          {roleOf(a) === 'target' && m.from
            ? t('grant.person.migrationFrom', { where: whence(m.from), reads: list(m.domains.map((d) => t(cardReadsKey(a, d)))) })
            : t('grant.person.migration', { where: where(m.to), reads: list(m.domains.map((d) => t(cardReadsKey(a, d)))) })}
          {/* Who else can open the copy, said plainly and not in a fold (the
              owner's decisions of 2026-11-26, change 3), where the first
              screen did not say it already (§5.1). */}
          {opts.theyOpenIt && roleOf(a) !== 'target' && m.theOrganisationOpensIt && (
            <span className="block">{t('grant.person.theyOpenIt', { who, destination: providerName(m.to.provider) })}</span>
          )}
        </li>
      ))}
    </ul>
  );

  /** The texts a person accepts, with their two links: before any redirect, where they can still walk away. */
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

  const backButton = previous && (
    <p className="mt-6">
      <button type="button" className={QUIET} onClick={back}>
        {t('grant.step.back')}
      </button>
    </p>
  );

  const progressLink = progressUrl !== null && (
    <div className="mt-4 p-4 border border-gray-300 rounded-lg bg-white text-lg text-gray-900" data-progress-link>
      <p>{t('grant.person.yourPage')}</p>
      <p className="mt-2 break-all">
        <a className="text-blue-700 underline" href={progressUrl}>
          {progressUrl}
        </a>
      </p>
      <p className="mt-2">{t('grant.person.keepIt', { who })}</p>
    </div>
  );

  const allConnected = everyConnected && (
    <p role="status" className="mt-6 flex items-center gap-2 text-lg font-medium text-green-900">
      <CheckCircle2 className="w-6 h-6 flex-shrink-0" aria-hidden="true" />
      {t('grant.person.allConnected')}
    </p>
  );

  const body = ((): React.ReactNode => {
    switch (step.kind) {
      case 'ask':
        return (
          <>
            {askedAgain.length > 0 && (
              <p className="mt-4 text-lg text-gray-900">
                {t('grant.person.again', { who })}
                {isAlpha() && askedAgain.some((a) => (a.provider ?? 'google') === 'google') && ` ${t('grant.person.again.alpha')}`}
              </p>
            )}
            {/* The sender's facts, under the label Sender (T3, §7): the name
                the member gave and how the reader knows them, their address
                under it, and a number to check, never as proof (D11). */}
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
                <dd className="text-gray-900 break-words">
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
                : t('grant.person.whatMany', { who, what })}
            </p>
            <ul className="mt-3 space-y-2 list-disc pl-6 text-lg text-gray-900">
              {sources.length > 0 && (
                <li>{t('grant.person.fact.stays', { source: list([...new Set(sources.map(sourcePlace))]) })}</li>
              )}
              {sources.length > 0 && <li>{t('grant.person.fact.reads')}</li>}
              {theyOpenItFirst && (
                <li>{t('grant.person.theyOpenIt', { who, destination: providerName(destinations[0]!.provider) })}</li>
              )}
              <li>{t('grant.person.fact.noHurry', { date })}</li>
            </ul>
            <p id={questionId} className="mt-6 text-lg font-semibold text-gray-900">
              {t('grant.person.told', { who })}
            </p>
            {/* Two answers of one size, and neither louder (R6): not yet is as good an answer. */}
            <div role="group" aria-labelledby={questionId} data-answers className="mt-3 space-y-3">
              <button
                type="button"
                data-main
                className={MAIN_OUTLINED}
                onClick={() => {
                  keepTold(link);
                  setAnsweredHere(true);
                  go(accountsShown ? { kind: 'accounts' } : { kind: 'ready', account: keyOf(first) });
                }}
              >
                {t('grant.person.yes')}
              </button>
              <button type="button" data-main className={MAIN_OUTLINED} onClick={() => go({ kind: 'notYet' })}>
                {t('grant.person.notYet')}
              </button>
            </div>
          </>
        );

      case 'notYet':
        return (
          <>
            <p className="mt-4 text-lg text-gray-900">{t('grant.person.wait.ask', { who })}</p>
            <p className="mt-3 text-lg text-gray-900">{t('grant.person.wait.until', { date })}</p>
            <p className="mt-3 text-lg text-gray-900">{t('grant.person.wait.unknown', { who })}</p>
            {/* Here a button, where it answers something (§5.1). */}
            <div className="mt-4">
              <ReportThisLink kind="grant" link={link} organisation={data.organisation} next="linkReport.next.grant" look="button" />
            </div>
            {backButton}
          </>
        );

      case 'accounts': {
        const groups = (['source', 'target'] as const)
          .map((role) => ({ role, cards: ordered.filter((a) => roleOf(a) === role) }))
          .filter((g) => g.cards.length > 0);
        return (
          <>
            {groups.map((g) => (
              <section key={g.role} aria-labelledby={`grant-group-${g.role}`} className="mt-6" data-group={g.role}>
                <h2 id={`grant-group-${g.role}`} className="text-xl font-semibold text-gray-900">
                  {t(g.role === 'source' ? 'grant.group.from' : 'grant.group.to')}
                </h2>
                {g.cards.map((a) => {
                  const state = stateOf(a);
                  const cardId = `${h1Id}-${g.role}-${keyOf(a)}`;
                  return (
                    <section
                      key={keyOf(a)}
                      aria-labelledby={cardId}
                      className="mt-4 border-t border-gray-200 pt-4"
                      data-card-role={roleOf(a)}
                      data-card-way={wayOf(a)}
                      data-card-state={state}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <h3 id={cardId} className="text-lg font-semibold text-gray-900 break-all">
                          {a.account}
                        </h3>
                        <span className={`px-2.5 py-1 text-base font-medium rounded-full border ${STATE_TONE[state]}`}>
                          {t(STATE_WORDS[state])}
                        </span>
                      </div>
                      {migrationLines(a, { theyOpenIt: !theyOpenItFirst })}
                      {a.again && state !== 'connected' && (
                        <p className="mt-2 text-lg text-gray-900">
                          {t('grant.person.again', { who })}
                          {isAlpha() && (a.provider ?? 'google') === 'google' && ` ${t('grant.person.again.alpha')}`}
                        </p>
                      )}
                      {state === 'connected' ? (
                        <p className="mt-3 flex items-center gap-2 text-lg font-medium text-green-900">
                          <CheckCircle2 className="w-6 h-6 flex-shrink-0" aria-hidden="true" />
                          {t('grant.person.connected')}
                        </p>
                      ) : a.notReady ? (
                        <p className="mt-3 text-lg text-amber-900">{locale === 'nl' ? a.notReady.reasonNl : a.notReady.reason}</p>
                      ) : state === 'locked' ? (
                        <p className="mt-3 text-lg text-amber-900">{t('grant.password.locked', { askedBy: who })}</p>
                      ) : (
                        <button
                          type="button"
                          data-main
                          className={`mt-3 ${MAIN_FILLED}`}
                          onClick={() => go({ kind: 'ready', account: keyOf(a) })}
                        >
                          {t('grant.person.connectAccount', { account: a.account })}
                        </button>
                      )}
                    </section>
                  );
                })}
              </section>
            ))}
            {/* The person's new address, here and never on the first screen:
                its button says the first screen's words (§5.1). */}
            <YourNewAddress door="grant" link={link} changes={data.addressChanges} queryKey={['grant', link]} />
            {allConnected}
            {progressLink}
            {backButton}
          </>
        );
      }

      case 'ready': {
        const a = account!;
        const signIn = wayOf(a) === 'sign-in';
        const name = signIn ? signInName(a) : '';
        const othersWait = ordered.some((other) => other !== a && pressable(other));
        return (
          <>
            <ul className="mt-4 space-y-2 list-disc pl-6 text-lg text-gray-900">
              <li>{t('grant.person.ready.address', { account: a.account })}</li>
              <li>
                {signIn
                  ? t('grant.person.ready.password', { provider: name })
                  : t('grant.person.ready.passwordOf', { account: a.account })}
              </li>
              {signIn && <li>{t('grant.person.ready.typeIt', { provider: name, who })}</li>}
              {signIn && <li>{t('grant.person.ready.phone', { provider: name })}</li>}
              {signIn && <li>{t('grant.person.ready.code', { who })}</li>}
            </ul>
            <p className="mt-4 text-lg text-gray-900">{t('grant.person.ready.unknownPassword', { who })}</p>
            {/* During the Alpha, the step before Google is best done together
                ("Yes, preferably"; the owner's decisions of 2026-11-26). */}
            {signIn && (a.provider ?? 'google') === 'google' && isAlpha() && (
              <p className="mt-3 text-lg text-gray-900">{t('grant.person.ready.together', { who })}</p>
            )}
            {/* Here, where it can still be acted on: a link opened inside a
                chat or mail app is refused by Google (0140 T3 (a)). */}
            {signIn && <p className="mt-3 text-lg text-gray-900">{t('grant.inAppBrowser')}</p>}
            {signIn ? (
              <button
                type="button"
                data-main
                className={`mt-6 ${MAIN_FILLED}`}
                onClick={() => go({ kind: 'provider', account: keyOf(a) })}
              >
                {t('grant.step.next')}
              </button>
            ) : (
              <>
                {/* The account's card, named by its address, with its state
                    (0174 §4.5). Before the box: where from and where to, the
                    date, and the texts a person accepts (T1.9); and with no
                    number to call back on, to ask some other way first (§5.8). */}
                <section
                  aria-labelledby={`${h1Id}-card`}
                  className="mt-6 border-t border-gray-200 pt-4"
                  data-group={roleOf(a)}
                  data-card-role={roleOf(a)}
                  data-card-way={wayOf(a)}
                  data-card-state={stateOf(a)}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h2 id={`${h1Id}-card`} className="text-xl font-semibold text-gray-900 break-all">
                      {a.account}
                    </h2>
                    <span className={`px-2.5 py-1 text-base font-medium rounded-full border ${STATE_TONE[stateOf(a)]}`}>
                      {t(STATE_WORDS[stateOf(a)])}
                    </span>
                  </div>
                  {migrationLines(a, { theyOpenIt: !theyOpenItFirst })}
                  <p className="mt-3 text-lg text-gray-900">{t('grant.until', { date })}</p>
                  {textsAccepted}
                  {number === null && (
                    <p className="mt-3 text-lg text-amber-900" data-no-phone>
                      {t('grant.password.noPhone', { organisation: data.organisation, askedBy: who })}
                    </p>
                  )}
                  <GrantPasswordCard
                    link={link}
                    card={a}
                    askedBy={who}
                    organisation={data.organisation}
                    onAnswer={onPasswordAnswer}
                    connectedHere={connectedHere.has(a.ref)}
                    tries={triesOf(a)}
                  />
                </section>
                {allConnected}
                {progressLink}
                {connectedHere.has(a.ref) && othersWait && (
                  <button type="button" data-main className={`mt-6 ${MAIN_FILLED}`} onClick={() => go({ kind: 'accounts' })}>
                    {t('grant.step.next')}
                  </button>
                )}
              </>
            )}
            {backButton}
          </>
        );
      }

      case 'provider': {
        const a = account!;
        const provider = a.provider ?? 'google';
        const name = signInName(a);
        const google = provider === 'google';
        const cirrux = provider === 'cirrux';
        // Google's warning and *Access blocked*, during the Alpha only (§5.4, D12 (a)).
        const alpha = google && isAlpha();
        // Read-only where the provider holds it so (0144 T3 (c)): Microsoft and
        // Dropbox always, Google for Drive and Tasks alone.
        const heldToReading = !google || a.readOnlyAtProvider;
        const key = keyOf(a);
        return (
          <>
            {migrationLines(a, { theyOpenIt: false })}
            <ol aria-labelledby={h1Id} className="mt-4 space-y-4 list-decimal pl-6 text-lg text-gray-900">
              {/* The account is a condition, said before the button (0108 T8 (b)). */}
              <li>
                <span>{t('grant.person.see.signIn', { provider: name })}</span>{' '}
                <span>
                  {cirrux ? t('grant.cirrux.signInAs', { account: a.account }) : t(wordsOf(provider).signInAs, { account: a.account })}
                </span>
              </li>
              {alpha && (
                <li>
                  {[t('grant.person.see.warning'), t('grant.person.see.goOn'), t('grant.person.see.onlyHere', { who })].join(' ')}
                </li>
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
            <p className="mt-3 text-lg text-gray-900">{t('grant.until', { date })}</p>
            {textsAccepted}
            <div data-answers className="mt-6 space-y-3">
              <button
                type="button"
                data-main
                className={MAIN_FILLED}
                disabled={starting !== null}
                onClick={() => void connect(a)}
              >
                {starting === key
                  ? t(cirrux ? 'grant.connecting.cirrux' : wordsOf(provider).connecting)
                  : t('grant.person.signIn', { provider: name })}
              </button>
              <button
                type="button"
                data-main
                className={MAIN_OUTLINED}
                disabled={starting !== null}
                onClick={() => go({ kind: 'ratherNot', account: key })}
              >
                {t('grant.person.ratherNot')}
              </button>
            </div>
            <p className="mt-3 text-lg text-gray-900">{t('grant.person.see.next', { provider: name })}</p>
            {failure?.account === key && (
              <p role="alert" className="mt-3 text-lg text-amber-900">
                {failureSentence(failure.error, locale, t)}
              </p>
            )}
            {backButton}
          </>
        );
      }

      case 'ratherNot':
        return (
          <>
            <p className="mt-4 text-lg text-gray-900">{t('grant.person.ratherNot.body', { date })}</p>
            {backButton}
          </>
        );
    }
  })();

  return (
    <div data-step={step.kind}>
      {n > 0 && <p className="text-base text-gray-800">{t('grant.step', { n: String(n), total: String(total) })}</p>}
      {step.kind === 'ask' && <p className="mt-2 text-lg text-gray-900">{t('grant.person.ownpace')}</p>}
      <h1 ref={headingRef} tabIndex={-1} id={h1Id} className="mt-2 text-2xl font-semibold text-gray-900 break-words">
        {title}
      </h1>
      {body}
      {/* The foot of every screen (§5.1, 0145 T9 (b)): Report this link as a
          quiet link, in one place, but on *not yet*, which holds it as a
          button; and the accessibility statement. */}
      <div data-foot className="mt-10 border-t border-gray-300 pt-4 space-y-1">
        {step.kind !== 'notYet' && (
          <ReportThisLink kind="grant" link={link} organisation={data.organisation} next="linkReport.next.grant" look="link" />
        )}
        <p>
          <AccessibilityLink className={`${QUIET} text-gray-900`} />
        </p>
      </div>
    </div>
  );
};
