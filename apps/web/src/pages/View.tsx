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
import { useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isPauseReason, type FailureCategory, type MappingLifecycle, type ViewTime } from '@openmig/shared';
import {
  viewApi,
  type MigrationViewPayload,
  type PersonViewPayload,
  type ViewRow,
} from '../services/view-service.ts';
import { serverMessage } from '../services/api.ts';
import { linkRefusal } from '../services/link-refusal.ts';
import { useT, useFormatters, useLocale } from '../i18n/index.tsx';
import type { StringKey } from '../i18n/index.tsx';
import { DOMAIN_STRING_KEY } from '../i18n/domain-words.ts';
import { VIEW_FAILURE_KEY, VIEW_SIDE_KEY } from '../i18n/view-failure-key.ts';
import { formatBytes } from '../i18n/bytes.ts';
import { Hint } from '../components/Hint.tsx';
import PausedBecause from '../components/PausedBecause.tsx';
import BuildStamp from '../components/BuildStamp.tsx';
import LanguageSwitch from '../components/LanguageSwitch.tsx';
import ReportThisLink from '../components/ReportThisLink.tsx';
import { providerName } from '../components/ProviderTile.tsx';
import StateChip from '../components/StateChip.tsx';
import { useLineSentence } from '../components/MigrationLines.tsx';
import { TimeBeforeStartLine } from '../components/TimeBeforeStartLine.tsx';
import { TimeWhileCopyingLine } from '../components/TimeWhileCopyingLine.tsx';

/** The grant a page may take back: a migration's, or one account's on a person's page. */
type PageGrant = MigrationViewPayload['grant'];

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
  const frame = forAccount ? 'mt-4 rounded-lg bg-gray-50 p-4' : 'mt-8 border-t border-gray-200 pt-6';

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
        // it was being taken back. Both are written for this reader; a
        // person's page is answered in both languages, and shows its own.
        <p className="mt-2 text-sm text-amber-800">
          {forAccount ? linkRefusal(withdraw.error, locale, t) : serverMessage(withdraw.error)}
        </p>
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
  if (!time) return null;
  return time.kind === 'beforeStart' ? (
    <TimeBeforeStartLine className="mt-3 text-sm text-gray-700" time={time.estimate} />
  ) : (
    <TimeWhileCopyingLine
      className="mt-3 text-sm text-gray-700"
      time={time.estimate}
      provider={providerName(from ?? '', 'source')}
    />
  );
};

/** One migration on a person's page: where it goes, where it is, and its rows. */
const PersonMigration: React.FC<{ migration: PersonViewPayload['migrations'][number]; grant: PageGrant }> = ({
  migration,
  grant,
}) => {
  const t = useT();
  const { dateTime } = useFormatters();
  const from = providerName(migration.from, 'source');
  return (
    <div className="mt-4">
      <h3 className="font-medium text-gray-900">
        {migration.to ? t('view.person.route', { from, to: providerName(migration.to, 'target') }) : from}
      </h3>
      {/* A withdrawn grant is the whole story, as on a migration's page. */}
      <p className="mt-1 text-gray-900">
        {grant.state === 'withdrawn'
          ? t('view.state.withdrawn', { date: dateTime(grant.withdrawnAt) })
          : t(STATE_SENTENCE[migration.state])}
      </p>
      {!migration.started ? (
        <p className="mt-1 text-sm text-gray-600">{t('view.notStarted')}</p>
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
      {/* A withdrawn grant reads nothing, so there is nothing to wait for. */}
      {grant.state !== 'withdrawn' && <HowLong time={migration.time} from={migration.from} />}
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
  const others = view.migrations.filter((m) => m.account === null);
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
            .map((m, j) => (
              <PersonMigration key={j} migration={m} grant={account.grant} />
            ))}
          <TheAccessTheyGave
            link={link}
            grant={account.grant}
            organisation={view.organisation}
            account={account.ref}
          />
        </section>
      ))}
      {others.length > 0 && (
        <section aria-labelledby="other-migrations" className="mt-8 border-t border-gray-200 pt-6">
          <h2 id="other-migrations" className="text-base font-semibold text-gray-900">
            {t('view.person.others')}
          </h2>
          {others.map((m, j) => (
            <PersonMigration key={j} migration={m} grant={{ state: 'none' }} />
          ))}
        </section>
      )}
      {/* Report this link (0108 T8 (d)), as on a migration's page. Withdrawing
          is what stops the copying, so the answer points at it while any
          account's access can be withdrawn. */}
      <ReportThisLink
        kind="view"
        link={link}
        organisation={view.organisation}
        {...(view.accounts.some((a) => a.grant.state === 'granted')
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
  const moved = one?.domains.reduce((sum, d) => sum + d.bytesTransferred, 0) ?? 0;

  return (
    <main className="max-w-xl mx-auto px-6 py-12">
      <LanguageSwitch className="justify-end mb-4" />
      <h1 className="text-xl font-semibold text-gray-900">{t(person ? 'view.person.title' : 'view.title')}</h1>

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
      {person && (
        <>
          <p className="mt-8 text-sm text-gray-500">{t('view.until', { date: dateTime(person.expiresAt) })}</p>
          <p className="mt-1 text-sm text-gray-500">{t('view.readOnly')}</p>
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
          <p className="mt-3 text-lg text-gray-900">
            {one.grant.state === 'withdrawn'
              ? t('view.state.withdrawn', { date: dateTime(one.grant.withdrawnAt) })
              : t(STATE_SENTENCE[one.state])}
          </p>

          {!one.started ? (
            <Hint
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
                  {t('view.moved', { bytes: formatBytes(moved) })}
                </p>
              )}
            </>
          )}
          {one.grant.state !== 'withdrawn' && <HowLong time={one.time} from={one.from} />}

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

      <div className="mt-10 text-center">
        <BuildStamp />
      </div>
    </main>
  );
};

export default View;
