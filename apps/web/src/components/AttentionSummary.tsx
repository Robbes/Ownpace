// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * One line per migration, and a link to each thing waiting.
 *
 * THE SCREEN CALLED "ATTENTION" SHOWED ONE QUEUE OUT OF FIVE. It rendered the
 * drift decision queue and nothing else, so an owner whose weekly digest said
 * "34 items that could not be copied" clicked the tab it pointed at and found
 * it empty (owner report, 2026-09-14).
 *
 * This is the digest, on screen. Same counts, from `GET /api/attention`, which
 * calls the same `summariseQueues` the mail does — so the tab an owner opens
 * after reading an email says what the email said. Two counters for one
 * question was the defect; this is not a third.
 *
 * Every number is a LINK, because a count somebody cannot act on is a count
 * that trains them to ignore the screen. The one exception is the drift
 * decisions, which are answered on this page itself.
 *
 * A blind spot — a queue that could not be READ — keeps its migration on the
 * list and says so. "I found nothing" and "I could not look" arriving as the
 * same quiet row is how somebody decides a migration is finished when it is
 * not (hard rule 9).
 */

import React from 'react';
import { Link } from 'react-router';
import type { MappingAttention } from '@openmig/shared';
import { queueScreenPath } from '../services/edition.ts';
import { useT } from '../i18n/index.tsx';
import { Hint } from './Hint.tsx';

/**
 * Does this migration want a person?
 *
 * The web copy of `wantsAttention`, minus `autoApplied` — which the endpoint
 * reports as zero anyway, because it is news the digest bounds by its own
 * window rather than a queue. Kept here as well so a screen asked for `all`
 * can still tell the loud rows from the quiet ones.
 */
export function wantsSomeone(m: MappingAttention): boolean {
  return (
    m.pendingDecisions > 0 ||
    m.deletionsWaiting > 0 ||
    m.movesWaiting > 0 ||
    m.failuresWaiting > 0 ||
    m.readyForCutover ||
    m.sharingOpen > 0 ||
    (m.blindSpots?.length ?? 0) > 0
  );
}

const Count: React.FC<{ n: number; label: string; to?: string }> = ({ n, label, to }) => {
  const body = (
    <>
      <span className="font-medium text-gray-900">{n}</span> {label}
    </>
  );
  return (
    <li>
      {/* Not a link when there is nowhere to go: the drift decisions are
          answered on this page, a few centimetres below. A link to the screen
          somebody is already on is worse than none. */}
      {to ? (
        <Link to={to} className="text-blue-700 hover:underline">
          {body}
        </Link>
      ) : (
        body
      )}
    </li>
  );
};

export const AttentionSummary: React.FC<{
  mappings: readonly MappingAttention[];
  /** The read failed outright — say so rather than rendering an empty list. */
  failed?: boolean;
}> = ({ mappings, failed }) => {
  const t = useT();
  const loud = mappings.filter(wantsSomeone);
  const quiet = mappings.length - loud.length;

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-1">{t('attention.title')}</h2>
      <p className="text-gray-500 mb-3">{t('attention.intro')}</p>

      {failed ? (
        // The whole read failed. An empty list here would say "nothing is
        // waiting" about a question nobody managed to ask.
        <p className="text-amber-800">{t('attention.failed')}</p>
      ) : loud.length === 0 ? (
        <p className="text-gray-500">{t('attention.empty')}</p>
      ) : (
        <ul className="space-y-4">
          {loud.map((m) => (
            <li key={m.mappingId}>
              {/* The NAME, when the migration has one. An owner knows this
                  migration as "Gmail to Nextcloud"; the UUID is our handle for
                  the row, and it is what the digest used to print at them. */}
              <div className="text-gray-900 font-medium break-words">{m.name ?? m.mappingId}</div>
              <ul className="mt-1 ml-4 space-y-1 text-sm list-disc text-gray-700">
                {m.pendingDecisions > 0 && (
                  <Count n={m.pendingDecisions} label={t('attention.decisions')} />
                )}
                {m.failuresWaiting > 0 && (
                  <Count
                    n={m.failuresWaiting}
                    label={t('attention.failures')}
                    to={queueScreenPath('failures', m.mappingId)}
                  />
                )}
                {m.deletionsWaiting > 0 && (
                  <Count
                    n={m.deletionsWaiting}
                    label={t('attention.deletions')}
                    to={queueScreenPath('deletions', m.mappingId)}
                  />
                )}
                {m.movesWaiting > 0 && (
                  <Count
                    n={m.movesWaiting}
                    label={t('attention.moves')}
                    to={queueScreenPath('moves', m.mappingId)}
                  />
                )}
                {m.sharingOpen > 0 && (
                  <Count
                    n={m.sharingOpen}
                    label={t('attention.sharingOpen')}
                    to={queueScreenPath('sharing', m.mappingId)}
                  />
                )}
                {m.readyForCutover && (
                  <li>
                    <Link
                      to={`/mappings/${encodeURIComponent(m.mappingId)}`}
                      className="text-blue-700 hover:underline"
                    >
                      {t('attention.readyForCutover')}
                    </Link>
                  </li>
                )}
              </ul>
              {(m.blindSpots?.length ?? 0) > 0 && (
                <Hint
                  className="mt-2 ml-4"
                  tone="caution"
                  text={t('attention.couldNotRead')}
                  why={t('attention.couldNotRead.why')}
                />
              )}
              {/* The server's own words for each one, verbatim (rule 9): the
                  difference between a 507, a 403 and a closed connection is
                  the whole of their value. */}
              {m.blindSpots?.map((spot) => (
                <p key={spot} className="ml-4 text-xs text-amber-800 break-words">
                  {spot}
                </p>
              ))}
            </li>
          ))}
        </ul>
      )}

      {/* Said rather than left as an absence: a screen that lists two
          migrations out of six looks like it has lost four. */}
      {!failed && quiet > 0 && (
        <p className="mt-3 text-sm text-gray-500">
          {t('attention.quiet', { count: String(quiet) })}
        </p>
      )}
    </div>
  );
};
