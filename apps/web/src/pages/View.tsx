// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The progress page (workplan 0122 T4, ADR-0035's second lifetime).
 *
 * `Grant.tsx`'s sibling and its opposite in one respect: that page asks a
 * person for something, this one owes them something. ADR-0035:
 *
 * > *"**Be their page afterwards** — their own progress, their own start and
 * > pause. This is what 'migrate at your own pace' actually requires; without
 * > it, pace belongs to whoever holds the admin login."*
 *
 * The owner described the reader exactly: *"a dad can migrate its elderly
 * parents one by one, remote, by sending them a link"*. So the reader here is
 * somebody's parent, who was sent a link and wants to know whether their mail
 * has arrived. Everything below follows from that.
 *
 * ## What that reader gets, and what they are spared
 *
 * **A sentence, not a chip.** `StateChip` renders `active` as "Active", which
 * is the right word for an operator scanning twenty migrations and the wrong
 * one for a person reading about their own. The five lifecycle states get whole
 * sentences here, and this is the one screen in the product that departs from
 * the shared state vocabulary on purpose.
 *
 * **Counts, in the words the rest of the app already uses.**
 * `DOMAIN_STRING_KEY` and `PausedBecause` are shared with the owner's screens
 * deliberately: somebody who phones the person who sent them the link should be
 * reading the same sentence they are.
 *
 * **Nothing has run yet is its own state.** Five domains of zero would say
 * *finished, and it moved nothing*, on the page of somebody who is waiting.
 * The server answers `started` for exactly this.
 *
 * **No failure prose.** A count and a category, never the provider's own words
 * — those name files. `viewRowFor` on the server is where that is enforced;
 * this page could not render one if it wanted to.
 *
 * ## Outside the chrome, like the grant page
 *
 * No sidebar, no navigation, no sign-out: there is no account behind any of it.
 * `BuildStamp` stays, because "the link my son sent me shows nothing" is a
 * support conversation that starts with which build they are on.
 *
 * The language switch stays too (workplan 0145 T6): outside `Layout` there
 * was none, and a Dutch parent whose phone is set to English could not change
 * it. A refusal of the link shows the half the server sent in the page's
 * language, and is announced (`role="alert"`); the waiting line is a status.
 *
 * ## A person's page, since step A (workplan 0176 T5, T6, T9)
 *
 * A person's progress page says three things, in this order: whether they
 * have to do anything (the first line, by rule: a connection to renew, a
 * stop, else nothing to do), how far it is, and how long it takes. It says
 * them in a person's words (D1, D14: *kopiëren*, through `persons-page.tsx`),
 * at a person's sizes (T9), and with each account under its own provider's
 * name. It reads itself again once a minute while something can still change,
 * with the focus left where it was and nothing read out; a refresh that cannot
 * reach the server keeps the numbers and says when they are from.
 *
 * The stop is a screen of its own (§9.1): *Stop copying*, then a question
 * with two answers of one size, then what the provider answered. Each is an
 * entry in the browser's history, so Back goes back to the page.
 *
 * A migration's own progress link, sent before 2026-10-03, is read by a
 * person too, and is drawn as one (§6): the same first line, refresh, words,
 * sizes and stop. It keeps only its own title and its sentence on who
 * migrates (`view.title`, `view.who`).
 */

import React from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { isPauseReason, type FailureCategory, type MappingLifecycle, type ViewTime } from '@openmig/shared';
import {
  viewApi,
  type MigrationViewPayload,
  type PersonViewPayload,
  type ViewRow,
  type WithdrawalPayload,
} from '../services/view-service.ts';
import { isUnreachable, linkRefusal } from '../services/link-refusal.ts';
import { InTheirVoice, useT, useFormatters, useLocale } from '../i18n/index.tsx';
import type { Locale, StringKey } from '../i18n/index.tsx';
import { DOMAIN_STRING_KEY } from '../i18n/domain-words.ts';
import { VIEW_FAILURE_KEY, VIEW_SIDE_KEY } from '../i18n/view-failure-key.ts';
import { formatBytes } from '../i18n/bytes.ts';
import { Hint } from '../components/Hint.tsx';
import PausedBecause from '../components/PausedBecause.tsx';
import AccessibilityLink from '../components/AccessibilityLink.tsx';
import BuildStamp from '../components/BuildStamp.tsx';
import { isSelfHost } from '../services/edition.ts';
import { legalUrl } from '../services/legal-links.ts';
import LanguageSwitch from '../components/LanguageSwitch.tsx';
import ReportThisLink from '../components/ReportThisLink.tsx';
import { providerName } from '../components/ProviderTile.tsx';
import StateChip from '../components/StateChip.tsx';
import { useLineSentence } from '../components/MigrationLines.tsx';
import { TimeBeforeStartLine } from '../components/TimeBeforeStartLine.tsx';
import { TimeWhileCopyingLine } from '../components/TimeWhileCopyingLine.tsx';
import { YourNewAddress } from '../components/YourNewAddress.tsx';
import { PersonsPageProvider, usePersonsPage } from '../components/persons-page.tsx';
import { NumberToCheck, SenderName, whoSent } from '../components/TheSender.tsx';

type T = ReturnType<typeof useT>;

/** The grant a page may take back: a migration's, or one account's on a person's page. */
type PageGrant = MigrationViewPayload['grant'];

/** What a withdrawal holding a migration took back, as the page reads it. */
type PageStopped = { readonly at: string; readonly what?: 'source' | 'destination' | undefined; readonly destination?: string | undefined };

/** A page's grant as what stopped, or null when nothing was taken back. */
const stoppedOf = (grant: PageGrant): PageStopped | null =>
  grant.state === 'withdrawn' ? { at: grant.withdrawnAt, what: grant.what, destination: grant.destination } : null;

/**
 * THE SENTENCE FOR A HELD MIGRATION (the owner's decisions of 2026-11-26,
 * change 1): the source's access withdrawn keeps its sentence; a
 * destination's password removed says so, names the destination, and says
 * the source was not touched. Null when nothing stopped.
 */
function useStoppedSentence(stopped: PageStopped | null, from: string | undefined, named?: string): string | null {
  const t = useT();
  const { locale } = useLocale();
  const { dateTime } = useFormatters();
  // Who can send a new link: the sender's name since step B (0176 T3, §6).
  // The page itself says it above its own provider, so it names them here.
  const fromPage = usePersonsPage()?.who;
  const who = named ?? fromPage ?? '';
  if (!stopped) return null;
  if (stopped.what === 'destination' && stopped.destination) {
    return t('view.state.destinationRemoved', {
      destination: providerName(stopped.destination, 'target', locale),
      date: dateTime(stopped.at),
      source: providerName(from ?? '', 'source', locale),
      who,
    });
  }
  return t('view.state.withdrawn', { date: dateTime(stopped.at) });
}

/**
 * A person's page, told apart by the `kind` the server sends. A local guard,
 * not one from the service: this page's tests mock the service whole.
 */
const isPersonView = (v: MigrationViewPayload | PersonViewPayload): v is PersonViewPayload =>
  'kind' in v && v.kind === 'person';

/**
 * Whether a link is a person's by its shape (`p.<id>.<secret>`): so the page
 * draws a person's sizes while it loads, and for a refusal (0176 T9).
 */
const isPersonsLink = (link: string | undefined): boolean => (link ?? '').startsWith('p.');

/**
 * One sentence per lifecycle state, for a reader with no context.
 *
 * A total `Record<MappingLifecycle, StringKey>`, so a sixth state is a compile
 * error here rather than a blank headline on the page whose reader is least
 * able to guess what is missing. That is the same shape `DOMAIN_STRING_KEY` and
 * `PAUSE_KEY` use, and the same lesson workplan 0117 T1 paid for.
 */
const STATE_SENTENCE: Record<MappingLifecycle, StringKey> = {
  active: 'view.state.active',
  paused: 'view.state.paused',
  cutover: 'view.state.cutover',
  done: 'view.state.done',
  continuous: 'view.state.continuous',
};

/** `{count} item` / `{count} items` — the dictionary's existing convention. */
const plural = (base: string, n: number): StringKey =>
  `${base}.${n === 1 ? 'one' : 'many'}` as StringKey;

/**
 * A PERSON'S SIZES (workplan 0176 T9, §13): both progress pages are read by a
 * person with no account, so a sentence is 18 pixels at 7 to 1 against the
 * paper, and nothing is under 16.
 */
const LOOK = {
  sentence: 'text-lg text-gray-900',
  quiet: 'text-lg text-gray-800',
  warn: 'text-lg text-amber-900',
  small: 'text-lg text-gray-800',
  title2: 'text-xl font-semibold text-gray-900',
  title3: 'text-lg font-semibold text-gray-900',
} as const;

/**
 * A MAIN BUTTON THAT IS NO TRAP (§9.1, §13): as wide as the column, 60
 * pixels high, outlined at 3 to 1 against the paper, and never red or filled.
 * Two answers to one question share it, so neither is the larger target.
 */
const MAIN_OUTLINED =
  'block w-full min-h-[60px] px-4 py-3 rounded-lg border-2 border-gray-700 bg-white text-gray-900 text-lg ' +
  'font-semibold text-center hover:bg-gray-50 disabled:opacity-60 break-words';

/**
 * One data type: its stage and the owner's line under it (0154 T8), then what
 * waits and why.
 *
 * The stage is the server's, worked out from the facts the owner's line reads,
 * and the sentence is the owner's, in the same words (`useLineSentence`):
 * *18,234 of ~19,000 · last pass 2 minutes ago*, *The check passed yesterday*.
 * Where the sentence does not say when, the page's own *Up to date as of* does,
 * with the date, as it did before. A row with no stage, from a server that
 * worked out none, reads as it always has. On a person's page each part says
 * a person's words (D14).
 */
const DomainRow: React.FC<{ row: ViewRow; checkPassedAt?: string }> = ({ row, checkPassedAt }) => {
  const t = useT();
  const { dateTime } = useFormatters();
  const sentenceOf = useLineSentence();
  // Who can mend a failure, named since step B (0176 T3, §6).
  const who = usePersonsPage()?.who ?? '';

  // A COMPLETION is the only honest source for "up to date as of"; when there
  // has never been one, the page says when a pass last did something instead,
  // which is a different and weaker claim and is worded as one. Neither is
  // invented: an absent field means the row has never reached that point.
  const when = row.lastSyncedAt
    ? t('view.upToDate', { date: dateTime(row.lastSyncedAt) })
    : row.lastActiveAt
      ? t('view.lastWorked', { date: dateTime(row.lastActiveAt) })
      : t('view.notYet');
  const line = row.stage
    ? sentenceOf(row.stage, {
        row,
        check: checkPassedAt ? { state: 'passed', at: checkPassedAt } : { state: 'not_run' },
      })
    : undefined;
  // When, once: not where the line already says it, and not where the stage
  // does. *Still copying* under *Paused* would contradict it, and *Not
  // started yet* under *Not started* would only repeat it.
  const saysWhen = !row.stage
    ? true
    : line?.says.includes('lastPass')
      ? false
      : row.lastSyncedAt
        ? true
        : row.stage === 'copying';

  return (
    <li className="py-3 border-b border-gray-200 last:border-b-0" data-domain={row.domain}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className={`font-medium ${LOOK.sentence}`}>{t(DOMAIN_STRING_KEY[row.domain])}</span>
        {row.stage ? (
          <StateChip entity="stage" state={row.stage} />
        ) : (
          <span className={LOOK.sentence}>
            {t(plural('view.copied', row.itemsSynced), { count: String(row.itemsSynced) })}
          </span>
        )}
      </div>
      {line && line.text !== '' && <p className={`mt-0.5 ${LOOK.sentence}`}>{line.text}</p>}
      {saysWhen && <p className={`mt-0.5 ${LOOK.quiet}`}>{when}</p>}

      {row.itemsNeedingDecision > 0 && (
        // Counted, never described. What is waiting is a decision by the person
        // running the migration, so the sentence points at them rather than
        // asking this reader to do something they cannot.
        <p className={`mt-1 ${LOOK.warn}`}>
          {t(plural('view.attention', row.itemsNeedingDecision), {
            count: String(row.itemsNeedingDecision),
          })}
        </p>
      )}
      {row.itemsRetrying > 0 && (
        <p className={`mt-1 ${LOOK.quiet}`}>
          {t(plural('view.retrying', row.itemsRetrying), { count: String(row.itemsRetrying) })}
        </p>
      )}

      {/* WHY, in this reader's words — never the provider's prose, which is not
          on this payload at all. `VIEW_FAILURE_KEY` rather than `FAILURE_KEY`:
          the owner's remedies tell somebody to open a Connections page that
          this reader has no account to reach. */}
      {row.lastErrorCategory && row.lastErrorCategory in VIEW_FAILURE_KEY && (
        <p className={`mt-1 ${LOOK.quiet}`}>
          {t(VIEW_FAILURE_KEY[row.lastErrorCategory as FailureCategory], { who })}
          {row.failedSide ? ` ${t(VIEW_SIDE_KEY[row.failedSide])}` : ''}
        </p>
      )}

      {/* A guard rather than a cast: the reason arrives as JSON from a jsonb
          column, and a row written by an older or newer build must not become
          a reason this page has no sentence for. */}
      {isPauseReason(row.pausedReason) && <PausedBecause reason={row.pausedReason} />}
    </li>
  );
};

/**
 * WHERE EACH PROVIDER LISTS THE APPS WITH ACCESS (0176 T5.2): where the person
 * finishes a stop the provider did not confirm, and checks one it did. A
 * place, not a sentence, so it is not translated. Microsoft's is where
 * `standing-grants.ts` sends a Microsoft account's own consent; Dropbox's, its
 * connected apps.
 */
type AppsFamily = 'google' | 'microsoft' | 'dropbox';
const APPS_WITH_ACCESS: Readonly<Record<AppsFamily, { readonly href: string; readonly text: string }>> = {
  google: {
    href: 'https://myaccount.google.com/connections',
    text: 'myaccount.google.com/connections', // i18n-exempt: a web address
  },
  microsoft: {
    href: 'https://myaccount.microsoft.com/',
    text: 'myaccount.microsoft.com', // i18n-exempt: a web address
  },
  dropbox: {
    href: 'https://www.dropbox.com/account/connected_apps',
    text: 'dropbox.com/account/connected_apps', // i18n-exempt: a web address
  },
};

/** A sign-in source's provider, by its kind; null for a kind that lists no apps a person gave access. */
function familyOf(kind: string): AppsFamily | null {
  if (kind === 'dropbox') return 'dropbox';
  if (kind === 'microsoft') return 'microsoft';
  if (kind === 'gmail' || kind.startsWith('google')) return 'google';
  return null;
}

/** The list, on a line of its own: a target a finger finds, not a word inside a sentence (§9.1). */
const AppsWithAccess: React.FC<{ family: AppsFamily }> = ({ family }) => (
  <p className="mt-1">
    <a
      href={APPS_WITH_ACCESS[family].href}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex min-h-[44px] items-center text-lg text-blue-700 underline underline-offset-4 break-all"
    >
      {APPS_WITH_ACCESS[family].text}
    </a>
  </p>
);

/**
 * AN ACCOUNT, BY ITS PROVIDER'S OWN NAME (0176 T2.4, §9.1). The page carries
 * no address (§3.2), so an account is *your Google account*, or *Microsoft 365
 * account 2* where one provider has more than one, read from its migrations'
 * `from`. Before 0171 every account was Google's, so one with no migration on
 * the page is too.
 */
interface AccountNames {
  /** Its heading: *Your Google account*, *Google account 2*. */
  readonly heading: string;
  /** In a sentence: *your Google account*, *Google account 2*. */
  readonly inSentence: string;
  /** The provider's own name: *Google*, *Microsoft 365*. */
  readonly provider: string;
  readonly family: AppsFamily | null;
  /** Where its migrations copy to, by name, each once. */
  readonly destinations: readonly string[];
}

function accountNamesOf(view: PersonViewPayload, t: T, locale: Locale): ReadonlyMap<string, AccountNames> {
  const kindOf = (ref: string) => view.migrations.find((m) => m.account === ref)?.from ?? 'google';
  const providers = view.accounts.map((a) => providerName(kindOf(a.ref), 'source', locale));
  const out = new Map<string, AccountNames>();
  view.accounts.forEach((a, i) => {
    const provider = providers[i]!;
    const one = providers.filter((p) => p === provider).length === 1;
    const n = String(providers.slice(0, i + 1).filter((p) => p === provider).length);
    out.set(a.ref, {
      heading: one ? t('view.person.account.only', { provider }) : t('view.person.account', { provider, n }),
      inSentence: one ? t('view.person.account.only.inSentence', { provider }) : t('view.person.account', { provider, n }),
      provider,
      family: familyOf(kindOf(a.ref)),
      destinations: [
        ...new Set(
          view.migrations
            .filter((m) => m.account === a.ref && m.to !== null)
            .map((m) => providerName(m.to!, 'target', locale)),
        ),
      ],
    });
  });
  return out;
}

/** A migration's own page: its one account, named alike (§9.1: *the part is shared*). */
function migrationNamesOf(one: MigrationViewPayload, t: T, locale: Locale): AccountNames {
  const kind = one.from ?? 'google';
  const provider = providerName(kind, 'source', locale);
  return {
    heading: t('view.person.account.only', { provider }),
    inSentence: t('view.person.account.only.inSentence', { provider }),
    provider,
    family: familyOf(kind),
    destinations: [],
  };
}

/**
 * THE ACCESS THEY GAVE (workplan 0108 T8 (c); 0176 T5, §9.1).
 *
 * Before 0108 the only way to stop a migration somebody had granted was
 * Google's own security settings, which most people never find. The owner's
 * decision: stop here, revoke at the provider where it will, delete it on our
 * side whatever the provider answers, and say which of the two happened.
 *
 * Here the page says what the permission is for, and offers *Stop copying*:
 * a button as wide as the column, which opens the question as a screen of its
 * own (`StopQuestion`). Once stopped, it says that nothing is read any more,
 * and where the provider lists the apps that still have access.
 */
const TheAccessTheyGave: React.FC<{
  grant: PageGrant;
  organisation: string;
  names: AccountNames;
  /** On a person's page (0153 T5 (b), slice 3), the section sits under its account's heading. */
  forAccount: boolean;
  onStop: () => void;
}> = ({ grant, organisation, names, forAccount, onStop }) => {
  const t = useT();
  // One section of a person's page sits under its account's heading.
  const Title: 'h2' | 'h3' = forAccount ? 'h3' : 'h2';
  // Under a rule, not in a box: a main button is as wide as the page's
  // column (0176 T9, §13), and a box's padding narrowed it.
  const frame = forAccount ? 'mt-6 border-t border-gray-200 pt-4' : 'mt-8 border-t border-gray-300 pt-6';
  const title = forAccount ? LOOK.title3 : LOOK.title2;

  // A destination's password removed (change 1 of the owner's decisions of
  // 2026-11-26): the source's access was not taken back, so this section
  // does not say it was, nor where to check it.
  if (grant.state === 'withdrawn' && grant.what === 'destination') return null;

  if (grant.state === 'withdrawn') {
    return (
      <section className={frame}>
        <Title className={title}>{t('view.grant.title')}</Title>
        <p className={`mt-2 ${LOOK.sentence}`}>{t('view.stopped.readsNothing', { account: names.inSentence })}</p>
        {names.family && (
          <>
            <p className={`mt-2 ${LOOK.sentence}`}>{t('view.withdrawn.check', { provider: names.provider })}</p>
            <AppsWithAccess family={names.family} />
          </>
        )}
      </section>
    );
  }

  if (grant.state !== 'granted') return null;

  return (
    <section className={frame}>
      <Title className={title}>{t('view.grant.title')}</Title>
      <p className={`mt-2 ${LOOK.sentence}`}>
        {forAccount
          ? t('view.person.grant.body', { organisation, provider: names.provider })
          : t('view.grant.body', { organisation })}
      </p>
      <p className={`mt-2 ${LOOK.sentence}`}>{t('view.grant.whatHappens')}</p>
      <button type="button" data-main onClick={onStop} className={`mt-4 ${MAIN_OUTLINED}`}>
        {t('view.grant.withdraw')}
      </button>
    </section>
  );
};

/**
 * THE QUESTION, A SCREEN OF ITS OWN (0176 T5, §9.1). What stops, for that
 * account, with what stays where; for Google, that Google ends the whole
 * app's permission; and that in step A a stop is final at once, so continuing
 * later needs a new link. Then two answers of one size: *No, do not stop*
 * first, neither filled and neither red.
 */
const StopQuestion: React.FC<{
  names: AccountNames;
  who: string;
  pending: boolean;
  error: unknown;
  headingRef: React.Ref<HTMLHeadingElement>;
  onNo: () => void;
  onYes: () => void;
}> = ({ names, who, pending, error, headingRef, onNo, onYes }) => {
  const t = useT();
  const { locale } = useLocale();
  const { list } = useFormatters();
  return (
    <>
      <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-semibold text-gray-900 break-words">
        {t('view.stop.title', { account: names.inSentence })}
      </h1>
      <p className="mt-4 text-lg text-gray-900">
        {names.destinations.length > 0
          ? t('view.stop.body', { destination: list(names.destinations), provider: names.provider })
          : t('view.stop.body.anywhere', { provider: names.provider })}
      </p>
      {names.family === 'google' && <p className="mt-3 text-lg text-gray-900">{t('view.grant.wholeApp')}</p>}
      <p className="mt-3 text-lg text-gray-900">{t('view.stop.final', { who })}</p>
      {/* One size whatever wraps: each row of the grid is as tall as the taller answer. */}
      <div data-answers className="mt-6 grid auto-rows-fr gap-3">
        <button type="button" data-main className={MAIN_OUTLINED} disabled={pending} onClick={onNo}>
          {t('view.stop.no')}
        </button>
        <button type="button" data-main className={MAIN_OUTLINED} disabled={pending} onClick={onYes}>
          {pending ? t('view.grant.withdrawing') : t('view.stop.yes')}
        </button>
      </div>
      {error != null && (
        // The server's own sentence: nothing to take back, or it changed while
        // it was being taken back. Both are written for this reader, in both
        // languages, and the page shows its own (the owner's decisions of
        // 2026-11-26). Announced, as every refusal on these pages is.
        <p role="alert" className="mt-3 text-lg text-amber-900">
          {linkRefusal(error, locale, t)}
        </p>
      )}
    </>
  );
};

/**
 * AFTERWARDS, WITHOUT THE BLAME (0176 §9.1): *Copying has stopped*, then what
 * the provider answered. *You do not have to do anything* only where it
 * confirmed; where it did not, where to finish it by hand, on a line of its
 * own. Nothing was deleted, and the copy so far stays, said again here where
 * the reader looks for it. What the provider answered is only known at the
 * moment it answered, so a later visit shows the page, which says the stop
 * and where to check it.
 */
const StopAnswer: React.FC<{
  names: AccountNames;
  who: string;
  answer: WithdrawalPayload;
  headingRef: React.Ref<HTMLHeadingElement>;
  onBack: () => void;
}> = ({ names, who, answer, headingRef, onBack }) => {
  const t = useT();
  const { list } = useFormatters();
  const confirmed = answer.atGoogle === 'revoked';
  return (
    <>
      <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-semibold text-gray-900 break-words">
        {t('view.stopped.title')}
      </h1>
      {confirmed ? (
        <p className="mt-4 text-lg text-gray-900">{t('view.stopped.confirmed', { provider: names.provider })}</p>
      ) : (
        <>
          <p className="mt-4 text-lg text-amber-900">{t('view.stopped.notConfirmed', { provider: names.provider })}</p>
          {names.family && <AppsWithAccess family={names.family} />}
        </>
      )}
      <p className="mt-3 text-lg text-gray-900">
        {names.destinations.length > 0
          ? t('view.stopped.nothingDeleted', { provider: names.provider, destination: list(names.destinations) })
          : t('view.stopped.nothingDeleted.anywhere', { provider: names.provider })}
      </p>
      {confirmed && <p className="mt-3 text-lg text-gray-900">{t('view.stopped.nothingToDo')}</p>}
      <p className="mt-3 text-lg text-gray-900">{t('view.stopped.allowed')}</p>
      <p className="mt-3 text-lg text-gray-900">{t('view.stopped.later', { who })}</p>
      <button type="button" data-main className={`mt-6 ${MAIN_OUTLINED}`} onClick={onBack}>
        {t('grant.step.back')}
      </button>
    </>
  );
};

type PersonViewDestination = PersonViewPayload['destinations'][number];

/**
 * AN ACCOUNT THEY CONNECTED WITH THEIR OWN PASSWORD, AND TAKING IT BACK
 * (workplan 0174 §4.3, §5.9).
 *
 * A destination the person connected on their grant link holds their
 * password. Removing it deletes the password here and stops everything that
 * would write to the account, until they connect it again on a new link.
 * There is no provider to revoke a password at, so once removed the page says
 * to change it at the provider too; a Cirrux Drive sign-in goes with it, and
 * the page says where Cirrux lists it.
 *
 * Two presses, as for the access they gave: the second one is what cannot be
 * undone from this page. A stored password is deleted when its owner says so,
 * so there is no screen of its own (0176 §9.1), but the two answers are one
 * size, *Keep it* first, and neither is red.
 */
const TheAccountTheyConnected: React.FC<{ link: string; destination: PersonViewDestination }> = ({ link, destination }) => {
  const t = useT();
  const { locale } = useLocale();
  const who = usePersonsPage()?.who ?? '';
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = React.useState(false);
  const provider = providerName(destination.provider, 'target', locale);
  const headingId = `destination-${destination.ref}`;

  const remove = useMutation({
    mutationFn: () => viewApi.withdrawDestination(link, destination.ref),
    // Read the page again for its other sections; this one says what was done from the press.
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['view', link] }),
  });

  return (
    <section aria-labelledby={headingId} className="mt-8 border-t border-gray-300 pt-6" data-destination={destination.provider}>
      <h2 id={headingId} className={LOOK.title2}>
        {t('view.destination.title', { provider })}
      </h2>
      {remove.data ? (
        <div className="mt-4" role="status">
          <p className={LOOK.sentence}>{t('grant.password.withdrawn', { provider })}</p>
          {remove.data.drive && <p className={`mt-2 ${LOOK.sentence}`}>{t('view.destination.driveRemoved')}</p>}
          <p className={`mt-2 ${LOOK.sentence}`}>{t('view.destination.since')}</p>
        </div>
      ) : (
        <div className="mt-4">
          <p className={LOOK.sentence}>{t('view.destination.body')}</p>
          <p className={`mt-2 ${LOOK.sentence}`}>{t('view.destination.whatHappens')}</p>
          {destination.drive && <p className={`mt-2 ${LOOK.sentence}`}>{t('view.destination.drive')}</p>}
          {!confirming ? (
            <button type="button" data-main onClick={() => setConfirming(true)} className={`mt-4 ${MAIN_OUTLINED}`}>
              {t('view.destination.remove')}
            </button>
          ) : (
            <div className="mt-4">
              <p className={LOOK.sentence}>{t('view.destination.confirm', { who })}</p>
              {/* One size whatever wraps: each row of the grid is as tall as the taller answer. */}
              <div data-answers className="mt-3 grid auto-rows-fr gap-3">
                <button
                  type="button"
                  data-main
                  onClick={() => setConfirming(false)}
                  disabled={remove.isPending}
                  className={MAIN_OUTLINED}
                >
                  {t('view.destination.keep')}
                </button>
                <button
                  type="button"
                  data-main
                  onClick={() => remove.mutate()}
                  disabled={remove.isPending}
                  className={MAIN_OUTLINED}
                >
                  {remove.isPending ? t('view.destination.removing') : t('view.destination.confirmYes')}
                </button>
              </div>
            </div>
          )}
          {remove.error != null && (
            // The server's own sentence, in the page's language: it changed since the page was opened.
            <p role="alert" className={`mt-2 ${LOOK.warn}`}>{linkRefusal(remove.error, locale, t)}</p>
          )}
        </div>
      )}
    </section>
  );
};

/**
 * How long (0154 T3, T8), as the owner's migration page says it: before the
 * first pass from the count, during the copy from the passes. The server
 * decided whether anything is said; this only says it.
 */
const HowLong: React.FC<{ time: ViewTime | undefined; from: string | undefined }> = ({ time, from }) => {
  const { locale } = useLocale();
  if (!time) return null;
  return time.kind === 'beforeStart' ? (
    <TimeBeforeStartLine className={`mt-3 ${LOOK.quiet}`} time={time.estimate} />
  ) : (
    <TimeWhileCopyingLine
      className={`mt-3 ${LOOK.quiet}`}
      time={time.estimate}
      provider={providerName(from ?? '', 'source', locale)}
    />
  );
};

type PersonViewMigration = PersonViewPayload['migrations'][number];

/** A migration's route as its heading names it, to tell where two read the same. */
const routeLabel = (m: PersonViewMigration, locale: Locale): string =>
  `${providerName(m.from, 'source', locale)}>${providerName(m.to ?? '', 'target', locale)}`;

/**
 * Whether another migration of the same section has this one's route name:
 * `gmail` and `google` both read *Google*, so mail and calendar to Soverin are
 * two *Google to Soverin* (the UX sweep, 2026-10-17).
 */
const routeRepeats = (m: PersonViewMigration, section: readonly PersonViewMigration[], locale: Locale): boolean =>
  section.filter((other) => routeLabel(other, locale) === routeLabel(m, locale)).length > 1;

/**
 * One migration on a person's page: where it goes, where it is, and its rows.
 * `withWhat` where its route's name repeats in its section: the heading then
 * says what it migrates too, *Google to Soverin: calendar and contacts*.
 */
const PersonMigration: React.FC<{ migration: PersonViewMigration; grant: PageGrant; withWhat?: boolean }> = ({
  migration,
  grant,
  withWhat = false,
}) => {
  const t = useT();
  const { locale } = useLocale();
  const { list } = useFormatters();
  const who = usePersonsPage()?.who ?? '';
  const from = providerName(migration.from, 'source', locale);
  // Its own hold where the server says it (alpha.21), else its account's, as before.
  const stopped = useStoppedSentence(migration.stopped ?? stoppedOf(grant), migration.from);
  const route = migration.to ? t('view.person.route', { from, to: providerName(migration.to, 'target', locale) }) : from;
  return (
    <div className="mt-4">
      <h3 className={LOOK.title3}>
        {withWhat && migration.started && migration.domains.length > 0
          ? t('view.person.routeWhat', {
              route,
              what: list(migration.domains.map((r) => t(DOMAIN_STRING_KEY[r.domain]).toLocaleLowerCase(locale))),
            })
          : route}
      </h3>
      {/* A withdrawal is the whole story, as on a migration's page. */}
      <p className={`mt-1 ${LOOK.sentence}`}>{stopped ?? t(STATE_SENTENCE[migration.state])}</p>
      {/* Stopped is not "not started yet, nothing has gone wrong" (change 1). */}
      {!migration.started ? (
        stopped ? null : <p className={`mt-1 ${LOOK.quiet}`}>{t('view.notStarted')}</p>
      ) : (
        <ul className="mt-2">
          {migration.domains.map((row) => (
            <DomainRow
              key={row.domain}
              row={row}
              {...(migration.checkPassedAt ? { checkPassedAt: migration.checkPassedAt } : {})}
            />
          ))}
        </ul>
      )}
      {/* A held migration copies nothing, so there is nothing to wait for. */}
      {!stopped && <HowLong time={migration.time} from={migration.from} />}
      {/* Who else can open the copy (0176 §10, T6): where the destination is
          the organisation's, in the link page's own sentence. A state, not
          content; nothing where the person connected it themselves. */}
      {migration.theOrganisationOpensIt === true && migration.to && who !== '' && (
        <p className={`mt-2 ${LOOK.sentence}`}>
          {t('grant.person.theyOpenIt', { who, destination: providerName(migration.to, 'target', locale) })}
        </p>
      )}
    </div>
  );
};

/** Whether a stop holds a migration: its own, or its account's (0176 §10). */
function isHeld(m: PersonViewMigration, view: PersonViewPayload): boolean {
  if (m.stopped) return true;
  const grant = view.accounts.find((a) => a.ref === m.account)?.grant;
  return grant?.state === 'withdrawn';
}

/**
 * What the first line and the refresh read of each migration, on a person's
 * page and on a migration's own: a migration's own page is read by a person
 * too, and takes a person's page with it (0176 §6, T6).
 */
interface Reading {
  readonly state: MappingLifecycle;
  readonly from: string;
  readonly to: string | null;
  readonly domains: readonly ViewRow[];
  readonly held: boolean;
}

function readingsOf(view: MigrationViewPayload | PersonViewPayload): Reading[] {
  if (!isPersonView(view)) {
    return [
      { state: view.state, from: view.from ?? 'google', to: null, domains: view.domains, held: view.grant.state === 'withdrawn' },
    ];
  }
  return view.migrations.map((m) => ({ state: m.state, from: m.from, to: m.to, domains: m.domains, held: isHeld(m, view) }));
}

/**
 * Whether something on the page can still change, so the page reads itself
 * again (0176 T6.4): a migration neither done nor held. A person's page with
 * none yet can get one.
 */
function canChange(view: MigrationViewPayload | PersonViewPayload): boolean {
  const readings = readingsOf(view);
  return readings.length === 0 || readings.some((r) => r.state !== 'done' && !r.held);
}

/**
 * THE FIRST LINE, BY RULE (0176 §10): the first of these that holds.
 *
 * 1. A connection needs renewing, a row's last failure being `auth_expired`:
 *    the person's own account, or a destination they connected themselves.
 *    It does not say there is nothing to do.
 * 2. Every migration on the page is held by a stop.
 * 3. Otherwise nothing is needed, which is true while a migration waits for
 *    the member's Start too.
 */
function firstLineOf(view: MigrationViewPayload | PersonViewPayload, t: T, locale: Locale): string {
  const theirs = new Set((isPersonView(view) ? (view.destinations ?? []) : []).map((d) => d.provider));
  // Whoever sent the link (0176 T6): the member's name on a person's page.
  const who = isPersonView(view) ? whoSent(view) : view.organisation;
  const readings = readingsOf(view);
  for (const r of readings) {
    if (r.held) continue;
    for (const row of r.domains) {
      if (row.lastErrorCategory !== 'auth_expired') continue;
      if (row.failedSide === 'target') {
        if (r.to && theirs.has(r.to)) {
          return t('view.person.first.renew', { provider: providerName(r.to, 'target', locale), who });
        }
        continue;
      }
      return t('view.person.first.renew', { provider: providerName(r.from, 'source', locale), who });
    }
  }
  if (readings.length > 0 && readings.every((r) => r.held)) return t('view.person.first.stopped');
  return t('view.person.first.nothingToDo');
}

/**
 * A PERSON'S PROGRESS PAGE (ADR-0035, amended 2026-09-29; 0153 T5 (b), slice
 * 3): their migrations under the account each reads, each as a migration's
 * own page shows it, and *The access you gave* once per account, because one
 * stop takes that account's permission back from every migration that reads
 * it. A migration that reads no account of theirs follows them. No account is
 * named by its address: the page carries none.
 *
 * *Report this link* is offered as on a migration's page; the report names the
 * person and every migration of theirs.
 */
const PersonProgress: React.FC<{
  link: string;
  view: PersonViewPayload;
  names: ReadonlyMap<string, AccountNames>;
  onStop: (account: string) => void;
}> = ({ link, view, names, onStop }) => {
  const t = useT();
  const { locale } = useLocale();
  const others = view.migrations.filter((m) => m.account === null);
  // Read as none from a payload that carries no list (a server before alpha.21).
  const destinations: readonly PersonViewDestination[] = view.destinations ?? [];
  return (
    <>
      {view.migrations.length === 0 && <p className={`mt-4 ${LOOK.sentence}`}>{t('view.person.none')}</p>}
      {view.accounts.map((account) => (
        <section
          key={account.ref}
          aria-labelledby={`account-${account.ref}`}
          className="mt-8 border-t border-gray-300 pt-6"
        >
          <h2 id={`account-${account.ref}`} className={LOOK.title2}>
            {names.get(account.ref)?.heading}
          </h2>
          {view.migrations
            .filter((m) => m.account === account.ref)
            .map((m, j, mine) => (
              <PersonMigration
                key={j}
                migration={m}
                grant={account.grant}
                withWhat={routeRepeats(m, mine, locale)}
              />
            ))}
          <TheAccessTheyGave
            grant={account.grant}
            organisation={view.organisation}
            names={names.get(account.ref)!}
            forAccount
            onStop={() => onStop(account.ref)}
          />
        </section>
      ))}
      {destinations.map((d) => (
        <TheAccountTheyConnected key={d.ref} link={link} destination={d} />
      ))}
      {others.length > 0 && (
        <section aria-labelledby="other-migrations" className="mt-8 border-t border-gray-300 pt-6">
          <h2 id="other-migrations" className={LOOK.title2}>
            {t('view.person.others')}
          </h2>
          {others.map((m, j) => (
            <PersonMigration key={j} migration={m} grant={{ state: 'none' }} withWhat={routeRepeats(m, others, locale)} />
          ))}
        </section>
      )}
      {/* Report this link (0108 T8 (d)), as on a migration's page. Stopping
          is what stops the copying, so the answer points at it while any
          account's access can be taken back, or a destination's password removed. */}
      <div className="mt-6">
        <ReportThisLink
          kind="view"
          link={link}
          organisation={view.organisation}
          {...(view.accounts.some((a) => a.grant.state === 'granted') || destinations.length > 0
            ? { next: 'linkReport.next.withdraw' as const }
            : {})}
        />
      </div>
    </>
  );
};

/** The steps of a stop (0176 T5, §9.1), as each is kept in the browser's history. */
type ViewStep = 'stop' | 'stopped';
interface ViewStepState {
  readonly viewStep: ViewStep;
  /** The account a stop is about, by the page's `ref`; none on a migration's own page. */
  readonly account?: string;
  /** Whether the page put the entry there, so Back can go back to it. */
  readonly back?: boolean;
}

function viewStepIn(state: unknown): ViewStepState | null {
  if (state === null || typeof state !== 'object') return null;
  const s = state as Partial<ViewStepState>;
  if (s.viewStep !== 'stop' && s.viewStep !== 'stopped') return null;
  return {
    viewStep: s.viewStep,
    ...(typeof s.account === 'string' ? { account: s.account } : {}),
    ...(s.back === true ? { back: true } : {}),
  };
}

/**
 * Whether the reader's browser says motion is fine: a new screen scrolls to
 * its top smoothly only then, as *Start a migration*'s does (0145 T3 (a)).
 */
const motionWelcome = (): boolean =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: no-preference)').matches;

/** A refresh once a minute (0176 T6.4). */
const REFRESH_MS = 60_000;

/**
 * The page's answer, asked for once, and a person's page in the voice chosen
 * for them (0176 T7, `InTheirVoice`): everything `ViewPage` draws reads its
 * words in it. A migration's own page has no voice, and reads as it did.
 */
const View: React.FC = () => {
  const { link } = useParams<{ link: string }>();
  const view = useQuery({
    queryKey: ['view', link],
    queryFn: () => viewApi.read(link!),
    enabled: Boolean(link),
    retry: false,
    // THE NUMBERS REFRESH BY THEMSELVES (0176 T6.4) on a person's page, once
    // a minute while the page is visible and something on it can still
    // change, and not after a refusal: a refused link stays refused.
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data || !canChange(data)) return false;
      return query.state.error != null && !isUnreachable(query.state.error) ? false : REFRESH_MS;
    },
  });
  const person = view.data && isPersonView(view.data) ? view.data : null;
  return (
    <InTheirVoice language={person?.language} register={person?.register}>
      <ViewPage link={link} view={view} />
    </InTheirVoice>
  );
};

const ViewPage: React.FC<{
  readonly link: string | undefined;
  readonly view: UseQueryResult<Awaited<ReturnType<typeof viewApi.read>>>;
}> = ({ link, view }) => {
  const t = useT();
  const { locale } = useLocale();
  const { dateTime, time } = useFormatters();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // A refresh that cannot reach the server keeps what the page showed (T6.4);
  // any other failure, or one before anything was shown, is the page's refusal.
  const keptThrough = view.data !== undefined && view.error != null && isUnreachable(view.error);
  const refused = view.error != null && !keptThrough;
  const data = refused ? undefined : view.data;
  const person = data && isPersonView(data) ? data : null;
  const one = data && !isPersonView(data) ? data : null;
  // A migration's own page names its organisation, as its `who` below does.
  const stopped = useStoppedSentence(one ? stoppedOf(one.grant) : null, one?.from, one?.organisation);
  const moved = one?.domains.reduce((sum, d) => sum + d.bytesTransferred, 0) ?? 0;

  const names = React.useMemo(() => (person ? accountNamesOf(person, t, locale) : null), [person, t, locale]);
  const oneNames = React.useMemo(() => (one ? migrationNamesOf(one, t, locale) : null), [one, t, locale]);

  // THE STOP, STEP BY STEP (§9.1): a step is a place in the page, kept in the
  // browser's history; what the provider answered is kept here, by account,
  // since it is only known at the moment it answered.
  const [answers, setAnswers] = React.useState<Readonly<Record<string, WithdrawalPayload>>>({});
  const here = `${location.pathname}${location.search}`;
  const asked = viewStepIn(location.state);
  const target = ((): { account?: string; grant: PageGrant; names: AccountNames } | null => {
    if (!asked) return null;
    if (person && names && asked.account !== undefined) {
      const account = person.accounts.find((a) => a.ref === asked.account);
      const its = account ? names.get(account.ref) : undefined;
      return account && its ? { account: account.ref, grant: account.grant, names: its } : null;
    }
    if (one && oneNames && asked.account === undefined) return { grant: one.grant, names: oneNames };
    return null;
  })();
  const answer = target ? answers[target.account ?? ''] : undefined;
  const shown: 'page' | 'stop' | 'stopped' =
    !asked || !target
      ? 'page'
      : asked.viewStep === 'stopped'
        ? answer
          ? 'stopped'
          : 'page'
        : target.grant.state === 'granted'
          ? 'stop'
          : 'page';

  const stop = useMutation({
    mutationFn: (account: string | undefined) =>
      account === undefined ? viewApi.withdraw(link!) : viewApi.withdrawAccount(link!, account),
    onSuccess: (payload, account) => {
      setAnswers((prev) => ({ ...prev, [account ?? '']: payload }));
      void navigate(here, {
        replace: true,
        state: {
          viewStep: 'stopped',
          ...(account !== undefined ? { account } : {}),
          ...(asked?.back ? { back: true } : {}),
        } satisfies ViewStepState,
      });
      // Read the page again: its sections now say the stop.
      void queryClient.invalidateQueries({ queryKey: ['view', link] });
    },
  });
  const openStop = (account?: string) => {
    stop.reset();
    void navigate(here, {
      state: { viewStep: 'stop', ...(account !== undefined ? { account } : {}), back: true } satisfies ViewStepState,
    });
  };
  const backToPage = () => {
    if (asked?.back) void navigate(-1);
    else void navigate(here, { replace: true, state: null });
  };

  // The tab's name goes back to what it was when this page leaves, so the
  // next screen is not called after this one. Its own effect, run once: a
  // language switch renames the tab and must not bring the old name back.
  React.useEffect(() => {
    const before = document.title;
    return () => {
      document.title = before;
    };
  }, []);
  // The tab's name, as the screen's own title says it (the UX sweep,
  // 2026-10-17; 0176 §5.6 for the stop's screens).
  // A migration's own link keeps its title; a person's is named so while it
  // loads too, with no *migratie* in its `h1` (D1).
  const pageTitle = t(one || (!data && !isPersonsLink(link)) ? 'view.title' : 'view.person.title');
  const title =
    shown === 'stop' && target
      ? t('view.stop.title', { account: target.names.inSentence })
      : shown === 'stopped'
        ? t('view.stopped.title')
        : pageTitle;
  React.useEffect(() => {
    document.title = `${title} — Ownpace`;
  }, [title]);

  // A NEW SCREEN STARTS AT THE TOP, with focus on its heading (§5.6, §9.1).
  // Not on the first render, and not on a refresh: the focus stays put.
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  const shownId = `${shown}:${asked?.account ?? ''}`;
  const lastShown = React.useRef(shownId);
  React.useLayoutEffect(() => {
    if (lastShown.current === shownId) return;
    lastShown.current = shownId;
    headingRef.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, left: 0, behavior: motionWelcome() ? 'smooth' : 'instant' });
  }, [shownId]);

  // Whoever sent the link (0176 T6, §7): the name the member gave on a
  // person's page, else the organisation, as before; a migration's own page
  // names the organisation.
  const who = person ? whoSent(person) : (one?.organisation ?? '');
  // When the numbers are from, and that they refresh (T6.4): in no live
  // region, so nothing is read out again; none once nothing can change.
  const refreshLine = data && canChange(data) && (
    <p className="mt-2 text-lg text-gray-800">
      {t(keptThrough ? 'view.refresh.failed' : 'view.refresh.at', { time: time(new Date(view.dataUpdatedAt)) })}
    </p>
  );

  const body = (): React.ReactNode => {
    if (shown === 'stop' && target) {
      return (
        <StopQuestion
          names={target.names}
          who={who}
          pending={stop.isPending}
          error={stop.error}
          headingRef={headingRef}
          onNo={backToPage}
          onYes={() => stop.mutate(target.account)}
        />
      );
    }
    if (shown === 'stopped' && target && answer) {
      return <StopAnswer names={target.names} who={who} answer={answer} headingRef={headingRef} onBack={backToPage} />;
    }
    return (
      <>
        <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-semibold text-gray-900">
          {pageTitle}
        </h1>

        {/* First, whether anything is needed (§10): the line right under the title. */}
        {data && <p className="mt-4 text-lg font-medium text-gray-900">{firstLineOf(data, t, locale)}</p>}

        {view.isPending && (
          <p role="status" className={`mt-4 ${LOOK.quiet}`}>
            {t('view.loading')}
          </p>
        )}

        {refused && (
          // The server's own sentence, verbatim, in the half the page is in: a
          // refused link and a migration that no longer exists are both written
          // to be forwarded to the person who sent the link, and rewording
          // either would lose that half.
          <p role="alert" className={`mt-4 ${LOOK.warn}`}>
            {linkRefusal(view.error, locale, t)}
          </p>
        )}

        {person && link && names && (
          <>
            <p className="mt-3 text-lg text-gray-900">{t('view.person.who', { who })}</p>
            {refreshLine}
            <PersonProgress link={link} view={person} names={names} onStop={(account) => openStop(account)} />
            <YourNewAddress door="view" link={link} changes={person.addressChanges} queryKey={['view', link]} />
            {/* Who sent the link (0176 T6, §7): the name and how the reader
                knows them, and a number to check (D11). Never an address:
                this page carries none. */}
            {person.sender && (
              <div data-sender className="mt-8 border-t border-gray-300 pt-6">
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-lg">
                  <dt className="text-gray-800">{t('grant.person.sender')}</dt>
                  <dd className="text-gray-900 break-words">
                    <SenderName facts={person} />
                  </dd>
                </dl>
                <NumberToCheck facts={person} className={`mt-3 ${LOOK.sentence}`} />
              </div>
            )}
            <p className={`mt-8 ${LOOK.small}`}>{t('view.until', { date: dateTime(person.expiresAt) })}</p>
            {/* Not "only numbers" when the page shows the person's new address
                (0168 §4.4): the one thing on it that is not a count or a state. */}
            <p className={`mt-1 ${LOOK.small}`}>
              {t((person.addressChanges?.length ?? 0) > 0 ? 'addresses.view.readOnly' : 'view.readOnly')}
            </p>
          </>
        )}

        {one && oneNames && (
          <>
            <p className="mt-3 text-lg text-gray-900">{t('view.who', { organisation: one.organisation })}</p>
            {refreshLine}
            {/* A withdrawn grant is the whole story until somebody grants again:
                the lifecycle may still say active, and "your things are being
                copied across now" would be untrue. */}
            <p className="mt-3 text-lg text-gray-900">{stopped ?? t(STATE_SENTENCE[one.state])}</p>

            {/* Stopped is not "not started yet, nothing has gone wrong" (change 1). */}
            {!one.started ? (
              stopped ? null : <Hint className="mt-4" tone="body" text={t('view.notStarted')} why={t('view.notStarted.why')} />
            ) : (
              <>
                <ul className="mt-6">
                  {one.domains.map((row) => (
                    <DomainRow
                      key={row.domain}
                      row={row}
                      {...(one.checkPassedAt ? { checkPassedAt: one.checkPassedAt } : {})}
                    />
                  ))}
                </ul>
                {moved > 0 && (
                  <p className={`mt-4 ${LOOK.quiet}`}>{t('view.moved', { bytes: formatBytes(moved, locale) })}</p>
                )}
              </>
            )}
            {!stopped && <HowLong time={one.time} from={one.from} />}

            {link && (
              <TheAccessTheyGave
                grant={one.grant}
                organisation={one.organisation}
                names={oneNames}
                forAccount={false}
                onStop={() => openStop()}
              />
            )}
            {/* Report this link (0108 T8 (d)), for somebody who granted and then
                had doubts. Stopping is what stops the copying, so the answer
                points at it while there is access to take back. */}
            {link && (
              <div className="mt-6">
                <ReportThisLink
                  kind="view"
                  link={link}
                  organisation={one.organisation}
                  {...(one.grant.state === 'granted' ? { next: 'linkReport.next.withdraw' as const } : {})}
                />
              </div>
            )}

            <p className={`mt-8 ${LOOK.small}`}>{t('view.until', { date: dateTime(one.expiresAt) })}</p>
            <p className={`mt-1 ${LOOK.small}`}>{t('view.readOnly')}</p>
          </>
        )}
      </>
    );
  };

  const page = (
    <main data-persons-page className="max-w-xl mx-auto px-4 py-8 sm:py-12">
      <LanguageSwitch className="justify-end mb-4" />
      {body()}

      {/* A person with only this link reaches the statement from here too (0145 T9 (b)), and, on
          the managed service, its privacy policy (the owner, 2026-11-23). An appliance is its
          owner's service under their own policy, not ours, so it links none (the share mail's
          rule, `privacy-policy-link.ts`). In the same tab, as the accessibility link: no form here. */}
      <p className="mt-10 text-center text-base text-gray-800">
        {!isSelfHost() && (
          <>
            <a className="inline-flex min-h-[44px] items-center underline underline-offset-4" href={legalUrl('privacy', locale)}>
              {t('acceptance.doc.privacy')}
            </a>
            {' · '}
          </>
        )}
        <AccessibilityLink className="inline-flex min-h-[44px] items-center underline underline-offset-4" />
      </p>
      <div className="mt-4 text-center">
        <BuildStamp />
      </div>
    </main>
  );
  // Both progress pages are a person's own (0176 §6): whoever the page names
  // as having sent the link is the member's name since step B (T6, §10), and
  // the organisation where there is none.
  return <PersonsPageProvider value={{ who }}>{page}</PersonsPageProvider>;
};

export default View;
