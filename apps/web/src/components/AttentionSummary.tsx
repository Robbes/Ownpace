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
 *
 * THE ORGANISATION IS NOT ONE OF ITS MIGRATIONS. A pending drift decision
 * belongs to the tenant, and a tenant whose every migration is `done` used to
 * read "Nothing is waiting. Every migration is running by itself" over a
 * drift queue that was not empty — neither clause true. It gets its own
 * heading here, under the same words the digest uses for it ("Your
 * organisation"), because the whole point of this screen is that it says what
 * the email said.
 */

import React from 'react';
import { Link } from 'react-router';
import type { MappingAttention, TenantAttention } from '@openmig/shared';
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

/** Has the ORGANISATION itself got something waiting, as opposed to a migration? */
export function organisationWants(tenant?: TenantAttention): boolean {
  return (tenant?.pendingDecisions ?? 0) > 0 || (tenant?.blindSpots?.length ?? 0) > 0;
}

export const AttentionSummary: React.FC<{
  mappings: readonly MappingAttention[];
  /** What is waiting on the organisation rather than on any one migration. */
  tenant?: TenantAttention;
  /** The read failed outright — say so rather than rendering an empty list. */
  failed?: boolean;
}> = ({ mappings, tenant, failed }) => {
  const t = useT();
  const loud = mappings.filter(wantsSomeone);
  const quiet = mappings.length - loud.length;
  const org = organisationWants(tenant);

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-1">{t('attention.title')}</h2>
      <p className="text-gray-500 mb-3">{t('attention.intro')}</p>

      {failed ? (
        // The whole read failed. An empty list here would say "nothing is
        // waiting" about a question nobody managed to ask.
        <p className="text-amber-800">{t('attention.failed')}</p>
      ) : loud.length === 0 && !org ? (
        // Two different silences. With migrations on the list, they are
        // running and nothing wants a person. With NONE, saying "every
        // migration is running by itself" is simply false — there are none,
        // or they have all finished — and that false sentence is what this
        // screen showed the tenant nobody is watching.
        <p className="text-gray-500">
          {mappings.length > 0 ? t('attention.empty') : t('attention.emptyNoneRunning')}
        </p>
      ) : (
        <ul className="space-y-4">
          {/* Above the migrations, and first, because it belongs to none of
              them. In practice the server sends this only when there are no
              migrations to list — but rendering both is the honest shape, and
              a screen that dropped one because the other arrived would be the
              defect this whole route exists to close. */}
          {org && (
            <li>
              <div className="text-gray-900 font-medium">{t('attention.organisation')}</div>
              <ul className="mt-1 ml-4 space-y-1 text-sm list-disc text-gray-700">
                {(tenant?.pendingDecisions ?? 0) > 0 && (
                  <Count n={tenant!.pendingDecisions!} label={t('attention.decisions')} />
                )}
              </ul>
              {(tenant?.blindSpots?.length ?? 0) > 0 && (
                <Hint
                  className="mt-2 ml-4"
                  tone="caution"
                  text={t('attention.couldNotRead')}
                  why={t('attention.couldNotRead.why')}
                />
              )}
              {tenant?.blindSpots?.map((spot) => (
                <p key={spot} className="ml-4 text-xs text-amber-800 break-words">
                  {spot}
                </p>
              ))}
            </li>
          )}
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
