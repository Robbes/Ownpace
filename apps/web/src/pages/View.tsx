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
 */

import React from 'react';
import { YourNewAddress } from '../components/YourNewAddress.tsx';
import { useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isPauseReason, type FailureCategory, type MappingLifecycle, type ViewTime } from '@openmig/shared';
import {
  viewApi,
  type MigrationViewPayload,
  type PersonViewPayload,
  type ViewRow,
} from '../services/view-service.ts';
import { linkRefusal } from '../services/link-refusal.ts';
import { useT, useFormatters, useLocale } from '../i18n/index.tsx';
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
function useStoppedSentence(stopped: PageStopped | null, from: string | undefined): string | null {
  const t = useT();
  const { locale } = useLocale();
  const { dateTime } = useFormatters();
  if (!stopped) return null;
  if (stopped.what === 'destination' && stopped.destination) {
    return t('view.state.destinationRemoved', {
      destination: providerName(stopped.destination, 'target', locale),
      date: dateTime(stopped.at),
      source: providerName(from ?? '', 'source', locale),
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
 * One data type: its stage and the owner's line under it (0154 T8), then what
 * waits and why.
 *
 * The stage is the server's, worked out from the facts the owner's line reads,
 * and the sentence is the owner's, in the same words (`useLineSentence`):
 * *18,234 of ~19,000 · last pass 2 minutes ago*, *The check passed yesterday*.
 * Where the sentence does not say when, the page's own *Up to date as of* does,
 * with the date, as it did before. A row with no stage, from a server that
 * worked out none, reads as it always has.
 */
const DomainRow: React.FC<{ row: ViewRow; checkPassedAt?: string }> = ({ row, checkPassedAt }) => {
  const t = useT();
  const { dateTime } = useFormatters();
  const sentenceOf = useLineSentence();

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
    <li className="py-3 border-b border-gray-100 last:border-b-0" data-domain={row.domain}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <span className="font-medium text-gray-900">{t(DOMAIN_STRING_KEY[row.domain])}</span>
        {row.stage ? (
          <StateChip entity="stage" state={row.stage} />
        ) : (
          <span className="text-gray-900">
            {t(plural('view.copied', row.itemsSynced), { count: String(row.itemsSynced) })}
          </span>
        )}
      </div>
      {line && line.text !== '' && <p className="mt-0.5 text-gray-900">{line.text}</p>}
      {saysWhen && <p className="mt-0.5 text-sm text-gray-600">{when}</p>}

      {row.itemsNeedingDecision > 0 && (
        // Counted, never described. What is waiting is a decision by the person
        // running the migration, so the sentence points at them rather than
        // asking this reader to do something they cannot.
        <p className="mt-1 text-sm text-amber-800">
          {t(plural('view.attention', row.itemsNeedingDecision), {
            count: String(row.itemsNeedingDecision),
          })}
        </p>
      )}
      {row.itemsRetrying > 0 && (
        <p className="mt-1 text-sm text-gray-600">
          {t(plural('view.retrying', row.itemsRetrying), { count: String(row.itemsRetrying) })}
        </p>
      )}

      {/* WHY, in this reader's words — never the provider's prose, which is not
          on this payload at all. `VIEW_FAILURE_KEY` rather than `FAILURE_KEY`:
          the owner's remedies tell somebody to open a Connections page that
          this reader has no account to reach. */}
      {row.lastErrorCategory && row.lastErrorCategory in VIEW_FAILURE_KEY && (
        <p className="mt-1 text-sm text-gray-600">
          {t(VIEW_FAILURE_KEY[row.lastErrorCategory as FailureCategory])}
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
 * Where the person finishes a withdrawal Google did not confirm, and checks one
 * it did: the list of apps with access to their Google account. A place, not a
 * sentence, so it is not translated.
 */
const GOOGLE_APPS_WITH_ACCESS = 'https://myaccount.google.com/connections';
const GOOGLE_APPS_WITH_ACCESS_TEXT = 'myaccount.google.com/connections'; // i18n-exempt: a web address

const AppsWithAccess: React.FC = () => (
  <a
    href={GOOGLE_APPS_WITH_ACCESS}
    target="_blank"
    rel="noreferrer noopener"
    className="text-blue-700 underline"
  >
    {GOOGLE_APPS_WITH_ACCESS_TEXT}
  </a>
);

/**
 * THE ACCESS THEY GAVE, AND TAKING IT BACK (workplan 0108 T8 (c)).
 *
 * Before this, the only way to stop a migration somebody had granted was
 * Google's own security settings, which most people never find. The owner's
 * decision: withdraw here, revoke at Google where Google will, delete it on our
 * side whatever Google answers, and say which of the two happened.
 *
 * Two presses, because the second one is what cannot be undone from this page:
 * continuing afterwards needs a new link from whoever sent this one. And what
 * Google takes back is everything this person allowed the app, at once, which
 * is said before the first press rather than discovered after it.
 */
const TheAccessTheyGave: React.FC<{
  link: string;
  grant: PageGrant;
  organisation: string;
  /**
   * On a person's page (0153 T5 (b), slice 3), the account this takes back,
   * by the page's `ref`: its permission, from every migration that reads it.
   */
  account?: string;
}> = ({ link, grant, organisation, account }) => {
  const t = useT();
  const { locale } = useLocale();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = React.useState(false);
  const forAccount = account !== undefined;
  // One section of a person's page sits under its account's heading.
  const Title: 'h2' | 'h3' = forAccount ? 'h3' : 'h2';
  // A white card with an edge: gray-50 is the page's own paper since the
  // site's palette (0152 T9 (b)), so a gray-50 panel drew no box at all.
  const frame = forAccount ? 'mt-4 rounded-lg border border-gray-200 bg-white p-4' : 'mt-8 border-t border-gray-200 pt-6';

  const withdraw = useMutation({
    mutationFn: () => (forAccount ? viewApi.withdrawAccount(link, account) : viewApi.withdraw(link)),
    // Read the page again: its state line and this section now say withdrawn.
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['view', link] }),
  });

  // What Google answered is only known at the moment it answered, so it is
  // shown from the press itself; a later visit shows the withdrawal and where
  // to check.
  if (withdraw.data) {
    return (
      <section className={frame}>
        <Title className="text-base font-semibold text-gray-900">{t('view.grant.title')}</Title>
        {withdraw.data.atGoogle === 'revoked' ? (
          <p className="mt-2 text-sm text-gray-900">{t('view.withdrawn.revoked')}</p>
        ) : (
          <>
            <p className="mt-2 text-sm text-amber-800">
              {t(forAccount ? 'view.person.withdrawn.notConfirmed' : 'view.withdrawn.notConfirmed')}
            </p>
            <p className="mt-1 text-sm text-amber-800">
              {t('view.withdrawn.removeYourself')} <AppsWithAccess />
            </p>
          </>
        )}
        <p className="mt-2 text-sm text-gray-600">{t('view.withdrawn.since')}</p>
      </section>
    );
  }

  // A destination's password removed (change 1 of the owner's decisions of
  // 2026-11-26): the source's access was not taken back, so this section
  // does not say it was, nor where to check it.
  if (grant.state === 'withdrawn' && grant.what === 'destination') return null;

  if (grant.state === 'withdrawn') {
    return (
      <section className={frame}>
        <Title className="text-base font-semibold text-gray-900">{t('view.grant.title')}</Title>
        <p className="mt-2 text-sm text-gray-600">{t('view.withdrawn.since')}</p>
        <p className="mt-2 text-sm text-gray-600">
          {t('view.withdrawn.check')} <AppsWithAccess />
        </p>
      </section>
    );
  }

  if (grant.state !== 'granted') return null;

  return (
    <section className={frame}>
      <Title className="text-base font-semibold text-gray-900">{t('view.grant.title')}</Title>
      <p className="mt-2 text-sm text-gray-900">
        {t(forAccount ? 'view.person.grant.body' : 'view.grant.body', { organisation })}
      </p>
      <p className="mt-2 text-sm text-gray-600">{t('view.grant.whatHappens')}</p>
      <p className="mt-2 text-sm text-gray-600">{t('view.grant.wholeApp')}</p>

      {!confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="mt-4 px-3 py-1.5 text-sm font-medium rounded border border-red-300 text-red-800 hover:bg-red-50"
        >
          {t('view.grant.withdraw')}
        </button>
      ) : (
        <div className="mt-4">
          <p className="text-sm text-gray-900">{t('view.grant.confirm')}</p>
          <div className="mt-2 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => withdraw.mutate()}
              disabled={withdraw.isPending}
              className="px-3 py-1.5 text-sm font-medium rounded bg-red-700 text-white hover:bg-red-800 disabled:opacity-50"
            >
              {withdraw.isPending ? t('view.grant.withdrawing') : t('view.grant.confirmYes')}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={withdraw.isPending}
              className="px-3 py-1.5 text-sm font-medium rounded border border-gray-300 text-gray-800 hover:bg-gray-50 disabled:opacity-50"
            >
              {t('view.grant.keep')}
            </button>
          </div>
        </div>
      )}
      {withdraw.error != null && (
        // The server's own sentence: nothing to take back, or it changed while
        // it was being taken back. Both are written for this reader, in both
        // languages, and the page shows its own (the owner's decisions of
        // 2026-11-26: a migration's page showed the English half on a Dutch
        // page). Announced, as every refusal on these pages is.
        <p role="alert" className="mt-2 text-sm text-amber-800">
          {linkRefusal(withdraw.error, locale, t)}
        </p>
      )}
    </section>
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
 * undone from this page.
 */
const TheAccountTheyConnected: React.FC<{ link: string; destination: PersonViewDestination }> = ({ link, destination }) => {
  const t = useT();
  const { locale } = useLocale();
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
    <section aria-labelledby={headingId} className="mt-8 border-t border-gray-200 pt-6" data-destination={destination.provider}>
      <h2 id={headingId} className="text-base font-semibold text-gray-900">
        {t('view.destination.title', { provider })}
      </h2>
      {remove.data ? (
        <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4" role="status">
          <p className="text-sm text-gray-900">{t('grant.password.withdrawn', { provider })}</p>
          {remove.data.drive && <p className="mt-2 text-sm text-gray-900">{t('view.destination.driveRemoved')}</p>}
          <p className="mt-2 text-sm text-gray-600">{t('view.destination.since')}</p>
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-sm text-gray-900">{t('view.destination.body')}</p>
          <p className="mt-2 text-sm text-gray-600">{t('view.destination.whatHappens')}</p>
          {destination.drive && <p className="mt-2 text-sm text-gray-600">{t('view.destination.drive')}</p>}
          {!confirming ? (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="mt-4 px-3 py-1.5 text-sm font-medium rounded border border-red-300 text-red-800 hover:bg-red-50"
            >
              {t('view.destination.remove')}
            </button>
          ) : (
            <div className="mt-4">
              <p className="text-sm text-gray-900">{t('view.destination.confirm')}</p>
              <div className="mt-2 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => remove.mutate()}
                  disabled={remove.isPending}
                  className="px-3 py-1.5 text-sm font-medium rounded bg-red-700 text-white hover:bg-red-800 disabled:opacity-50"
                >
                  {remove.isPending ? t('view.destination.removing') : t('view.destination.confirmYes')}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  disabled={remove.isPending}
                  className="px-3 py-1.5 text-sm font-medium rounded border border-gray-300 text-gray-800 hover:bg-gray-50 disabled:opacity-50"
                >
                  {t('view.destination.keep')}
                </button>
              </div>
            </div>
          )}
          {remove.error != null && (
            // The server's own sentence, in the page's language: it changed since the page was opened.
            <p role="alert" className="mt-2 text-sm text-amber-800">{linkRefusal(remove.error, locale, t)}</p>
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
    <TimeBeforeStartLine className="mt-3 text-sm text-gray-700" time={time.estimate} />
  ) : (
    <TimeWhileCopyingLine
      className="mt-3 text-sm text-gray-700"
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
  const from = providerName(migration.from, 'source', locale);
  // Its own hold where the server says it (alpha.21), else its account's, as before.
  const stopped = useStoppedSentence(migration.stopped ?? stoppedOf(grant), migration.from);
  const route = migration.to ? t('view.person.route', { from, to: providerName(migration.to, 'target', locale) }) : from;
  return (
    <div className="mt-4">
      <h3 className="font-medium text-gray-900">
        {withWhat && migration.started && migration.domains.length > 0
          ? t('view.person.routeWhat', {
              route,
              what: list(migration.domains.map((r) => t(DOMAIN_STRING_KEY[r.domain]).toLocaleLowerCase(locale))),
            })
          : route}
      </h3>
      {/* A withdrawal is the whole story, as on a migration's page. */}
      <p className="mt-1 text-gray-900">{stopped ?? t(STATE_SENTENCE[migration.state])}</p>
      {/* Stopped is not "not started yet, nothing has gone wrong" (change 1). */}
      {!migration.started ? (
        stopped ? null : <p className="mt-1 text-sm text-gray-600">{t('view.notStarted')}</p>
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
    </div>
  );
};

/**
 * A PERSON'S PROGRESS PAGE (ADR-0035, amended 2026-09-29; 0153 T5 (b), slice
 * 3): their migrations under the Google account each reads, each as a
 * migration's own page shows it, and *The access you gave* once per account,
 * because one withdrawal takes that account's permission back from every
 * migration that reads it. A migration that reads no Google account follows
 * them. No account is named by its address: the page carries none.
 *
 * *Report this link* is offered as on a migration's page; the report names the
 * person and every migration of theirs.
 */
const PersonProgress: React.FC<{ link: string; view: PersonViewPayload }> = ({ link, view }) => {
  const t = useT();
  const { locale } = useLocale();
  const others = view.migrations.filter((m) => m.account === null);
  // Read as none from a payload that carries no list (a server before alpha.21).
  const destinations: readonly PersonViewDestination[] = view.destinations ?? [];
  return (
    <>
      <p className="mt-4 text-gray-900">{t('view.person.who', { organisation: view.organisation })}</p>
      {view.migrations.length === 0 && <p className="mt-4 text-sm text-gray-600">{t('view.person.none')}</p>}
      {view.accounts.map((account, i) => (
        <section
          key={account.ref}
          aria-labelledby={`account-${account.ref}`}
          className="mt-8 border-t border-gray-200 pt-6"
        >
          <h2 id={`account-${account.ref}`} className="text-base font-semibold text-gray-900">
            {view.accounts.length === 1
              ? t('view.person.account.only')
              : t('view.person.account', { n: String(i + 1) })}
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
            link={link}
            grant={account.grant}
            organisation={view.organisation}
            account={account.ref}
          />
        </section>
      ))}
      {destinations.map((d) => (
        <TheAccountTheyConnected key={d.ref} link={link} destination={d} />
      ))}
      {others.length > 0 && (
        <section aria-labelledby="other-migrations" className="mt-8 border-t border-gray-200 pt-6">
          <h2 id="other-migrations" className="text-base font-semibold text-gray-900">
            {t('view.person.others')}
          </h2>
          {others.map((m, j) => (
            <PersonMigration key={j} migration={m} grant={{ state: 'none' }} withWhat={routeRepeats(m, others, locale)} />
          ))}
        </section>
      )}
      {/* Report this link (0108 T8 (d)), as on a migration's page. Withdrawing
          is what stops the copying, so the answer points at it while any
          account's access can be withdrawn, or a destination's password removed. */}
      <ReportThisLink
        kind="view"
        link={link}
        organisation={view.organisation}
        {...(view.accounts.some((a) => a.grant.state === 'granted') || destinations.length > 0
          ? { next: 'linkReport.next.withdraw' as const }
          : {})}
      />
    </>
  );
};

const View: React.FC = () => {
  const { link } = useParams<{ link: string }>();
  const t = useT();
  const { locale } = useLocale();
  const { dateTime } = useFormatters();

  const view = useQuery({
    queryKey: ['view', link],
    queryFn: () => viewApi.read(link!),
    enabled: Boolean(link),
    retry: false,
  });

  const person = view.data && isPersonView(view.data) ? view.data : null;
  const one = view.data && !isPersonView(view.data) ? view.data : null;
  const stopped = useStoppedSentence(one ? stoppedOf(one.grant) : null, one?.from);
  const moved = one?.domains.reduce((sum, d) => sum + d.bytesTransferred, 0) ?? 0;

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
  const title = t(person ? 'view.person.title' : 'view.title');
  React.useEffect(() => {
    document.title = `${title} — Ownpace`;
  }, [title]);

  return (
    <main className="max-w-xl mx-auto px-6 py-12">
      <LanguageSwitch className="justify-end mb-4" />
      <h1 className="text-xl font-semibold text-gray-900">{title}</h1>

      {view.isPending && (
        <p role="status" className="mt-4 text-sm text-gray-600">
          {t('view.loading')}
        </p>
      )}

      {view.error != null && (
        // The server's own sentence, verbatim, in the half the page is in: a
        // refused link and a migration that no longer exists are both written
        // to be forwarded to the person who sent the link, and rewording
        // either would lose that half.
        <p role="alert" className="mt-4 text-sm text-amber-800">
          {linkRefusal(view.error, locale, t)}
        </p>
      )}

      {person && link && <PersonProgress link={link} view={person} />}
      {person && link && (
        <YourNewAddress door="view" link={link} changes={person.addressChanges} queryKey={['view', link]} />
      )}
      {person && (
        <>
          <p className="mt-8 text-sm text-gray-500">{t('view.until', { date: dateTime(person.expiresAt) })}</p>
          {/* Not "only numbers" when the page shows the person's new address
              (0168 §4.4): the one thing on it that is not a count or a state. */}
          <p className="mt-1 text-sm text-gray-500">
            {t((person.addressChanges?.length ?? 0) > 0 ? 'addresses.view.readOnly' : 'view.readOnly')}
          </p>
        </>
      )}

      {one && (
        <>
          <p className="mt-4 text-gray-900">
            {t('view.who', { organisation: one.organisation })}
          </p>
          {/* A withdrawn grant is the whole story until somebody grants again:
              the lifecycle may still say active, and "your things are being
              copied across now" would be untrue. */}
          <p className="mt-3 text-lg text-gray-900">{stopped ?? t(STATE_SENTENCE[one.state])}</p>

          {/* Stopped is not "not started yet, nothing has gone wrong" (change 1). */}
          {!one.started ? (
            stopped ? null : <Hint
              className="mt-4"
              tone="body"
              text={t('view.notStarted')}
              why={t('view.notStarted.why')}
            />
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
                <p className="mt-4 text-sm text-gray-600">
                  {t('view.moved', { bytes: formatBytes(moved, locale) })}
                </p>
              )}
            </>
          )}
          {!stopped && <HowLong time={one.time} from={one.from} />}

          {link && <TheAccessTheyGave link={link} grant={one.grant} organisation={one.organisation} />}
          {/* Report this link (0108 T8 (d)), for somebody who granted and then
              had doubts. Withdrawing is what stops the copying, so the answer
              points at it while there is access to withdraw. */}
          {link && (
            <ReportThisLink
              kind="view"
              link={link}
              organisation={one.organisation}
              {...(one.grant.state === 'granted' ? { next: 'linkReport.next.withdraw' as const } : {})}
            />
          )}

          <p className="mt-8 text-sm text-gray-500">
            {t('view.until', { date: dateTime(one.expiresAt) })}
          </p>
          <p className="mt-1 text-sm text-gray-500">{t('view.readOnly')}</p>
        </>
      )}

      {/* A person with only this link reaches the statement from here too (0145 T9 (b)), and, on
          the managed service, its privacy policy (the owner, 2026-11-23). An appliance is its
          owner's service under their own policy, not ours, so it links none (the share mail's
          rule, `privacy-policy-link.ts`). In the same tab, as the accessibility link: no form here. */}
      <p className="mt-10 text-center text-sm text-gray-500">
        {!isSelfHost() && (
          <>
            <a className="underline" href={legalUrl('privacy', locale)}>
              {t('acceptance.doc.privacy')}
            </a>
            {' · '}
          </>
        )}
        <AccessibilityLink className="underline" />
      </p>
      <div className="mt-4 text-center">
        <BuildStamp />
      </div>
    </main>
  );
};

export default View;
