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
 */

import React from 'react';
import { useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { isPauseReason, type FailureCategory, type MappingLifecycle } from '@openmig/shared';
import { viewApi, type ViewRow } from '../services/view-service.ts';
import { serverMessage } from '../services/api.ts';
import { useT, useFormatters } from '../i18n/index.tsx';
import type { StringKey } from '../i18n/index.tsx';
import { DOMAIN_STRING_KEY } from '../i18n/domain-words.ts';
import { VIEW_FAILURE_KEY, VIEW_SIDE_KEY } from '../i18n/view-failure-key.ts';
import { formatBytes } from '../i18n/bytes.ts';
import { Hint } from '../components/Hint.tsx';
import PausedBecause from '../components/PausedBecause.tsx';
import BuildStamp from '../components/BuildStamp.tsx';

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

const DomainRow: React.FC<{ row: ViewRow }> = ({ row }) => {
  const t = useT();
  const { dateTime } = useFormatters();

  // A COMPLETION is the only honest source for "up to date as of"; when there
  // has never been one, the page says when a pass last did something instead,
  // which is a different and weaker claim and is worded as one. Neither is
  // invented: an absent field means the row has never reached that point.
  const when = row.lastSyncedAt
    ? t('view.upToDate', { date: dateTime(row.lastSyncedAt) })
    : row.lastActiveAt
      ? t('view.lastWorked', { date: dateTime(row.lastActiveAt) })
      : t('view.notYet');

  return (
    <li className="py-3 border-b border-gray-100 last:border-b-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <span className="font-medium text-gray-900">{t(DOMAIN_STRING_KEY[row.domain])}</span>
        <span className="text-gray-900">
          {t(plural('view.copied', row.itemsSynced), { count: String(row.itemsSynced) })}
        </span>
      </div>
      <p className="mt-0.5 text-sm text-gray-600">{when}</p>

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

const View: React.FC = () => {
  const { link } = useParams<{ link: string }>();
  const t = useT();
  const { dateTime } = useFormatters();

  const view = useQuery({
    queryKey: ['view', link],
    queryFn: () => viewApi.read(link!),
    enabled: Boolean(link),
    retry: false,
  });

  const moved = view.data?.domains.reduce((sum, d) => sum + d.bytesTransferred, 0) ?? 0;

  return (
    <main className="max-w-xl mx-auto px-6 py-12">
      <h1 className="text-xl font-semibold text-gray-900">{t('view.title')}</h1>

      {view.isPending && <p className="mt-4 text-sm text-gray-600">{t('view.loading')}</p>}

      {view.error != null && (
        // The server's own sentence, verbatim: a refused link and a migration
        // that no longer exists are both written to be forwarded to the person
        // who sent the link, and rewording either would lose that half.
        <p className="mt-4 text-sm text-amber-800">{serverMessage(view.error)}</p>
      )}

      {view.data && (
        <>
          <p className="mt-4 text-gray-900">
            {t('view.who', { organisation: view.data.organisation })}
          </p>
          <p className="mt-3 text-lg text-gray-900">{t(STATE_SENTENCE[view.data.state])}</p>

          {!view.data.started ? (
            <Hint
              className="mt-4"
              tone="body"
              text={t('view.notStarted')}
              why={t('view.notStarted.why')}
            />
          ) : (
            <>
              <ul className="mt-6">
                {view.data.domains.map((row) => (
                  <DomainRow key={row.domain} row={row} />
                ))}
              </ul>
              {moved > 0 && (
                <p className="mt-4 text-sm text-gray-600">
                  {t('view.moved', { bytes: formatBytes(moved) })}
                </p>
              )}
            </>
          )}

          <p className="mt-8 text-sm text-gray-500">
            {t('view.until', { date: dateTime(view.data.expiresAt) })}
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
