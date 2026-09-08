// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * What discovery found, and the two things about it the customer must be told
 * before they press start (ADR-0026).
 *
 * This existed TWICE before: once as hand-rolled HTML in
 * `apps/selfhost/src/confirm-page.ts` and once as JSX in
 * `ConfirmMigration.tsx`. Same table, same two warnings, same reasoning,
 * maintained in two languages — and they had already drifted, because the
 * server-rendered copy learned about the adoption count and the React one was
 * typed against a stale local `DiscoveryRecord` that silently dropped it. One
 * component, both flows.
 *
 * The two warnings are not decoration. Each says we will change something the
 * customer did not ask us to change, and the confirm screen is the last moment
 * they can object.
 */

import React from 'react';
import { domainsCountedBeforeTheirError, type DiscoveryDomain, type DiscoveryRecord } from '@openmig/shared';
import { useT } from '../../i18n/index.tsx';
import { formatBytes } from '../../i18n/bytes.ts';
// The dictionary's own domain words — the old local map silently bypassed
// them, so the table said "Email" beside screens saying the translated word.
// Moved to `i18n/domain-words.ts` (workplan 0113 T5): it was one of four
// copies of the same map, and a fifth domain reached only whichever was
// remembered.
import { DOMAIN_STRING_KEY as DOMAIN_KEY } from '../../i18n/domain-words.ts';

// Moved to `i18n/bytes.ts` (2026-09-02) so the measured-volume line can share
// it; re-exported here for the importers this file already has.
export { formatBytes };

/**
 * WHAT IS STILL COMING IS PART OF THE ANSWER (2026-09-07).
 *
 * `scanning` was a single boolean, and it was false the moment the FIRST
 * domain landed. From then on this table showed whatever had arrived so far
 * as though it were the whole answer. The owner's preflight over a four-domain
 * migration therefore read as a finished three-row table — three counts, no
 * fourth row, and nothing anywhere saying a fourth was on its way. He refreshed
 * by hand to find it.
 *
 * Discovery lands one domain at a time, because each opens its own connector
 * and walks its own provider, and a mailbox takes longer than a to-do list. A
 * screen that can only say "started" or "finished" cannot describe that, and
 * the failure mode is the worst one available: a number that looks complete
 * and is not.
 *
 * So the component is told what to EXPECT — the domains the migration carries
 * — and says which of them have not answered yet. Rows appear as they land,
 * and the sentence under them names the ones still counting.
 *
 * `expected` is optional and the fall-back is the old behaviour: a caller that
 * cannot know the selection (nothing today) still gets a table, just without
 * the sentence. It is not defaulted to every domain — that would put a
 * permanent "still counting: Email" under a migration that carries no mail,
 * which is the screen-side twin of the defect `resolveDiscoveryJob` removed.
 */
export const DiscoveryCounts: React.FC<{
  domains: ReadonlyArray<DiscoveryRecord>;
  /**
   * Every domain this migration carries. The rows still to come are these
   * minus the ones that have landed — a domain that answered with an error
   * HAS landed: `lastError` is a final answer, and waiting on it for ever
   * would be the same silence in a different place.
   */
  expected?: ReadonlyArray<DiscoveryDomain>;
  /**
   * The caller has stopped waiting (its poll hit its ceiling), so say the
   * longer sentence. Not an error: a domain that has not answered in five
   * minutes has not failed, it is slow, and a large mailbox genuinely is.
   */
  slow?: boolean;
}> = ({ domains, expected, slow }) => {
  const t = useT();
  const landed = new Set(domains.map((d) => d.domain));
  const pending = (expected ?? []).filter((d) => !landed.has(d));
  // Rows carrying BOTH a count and an error: the count is the last successful
  // pass's, the error is the latest attempt's, and the table on its own gives
  // the reader no way to tell. See `domainsCountedBeforeTheirError`.
  const countedEarlier = domainsCountedBeforeTheirError(domains);
  // A subset of `items`: these ARE migrated. Shown because we modify them.
  const generatedId = domains.reduce((sum, d) => sum + (d.generatedIdItems ?? 0), 0);
  // Items the destination already holds under a key matching something in the
  // source: we keep the destination's copy. Non-destructive and the right
  // default, but it decides what the customer ends up with, so it belongs here
  // and not in a verification report after the fact.
  const colliding = domains.reduce((sum, d) => sum + (d.targetColliding ?? 0), 0);

  if (domains.length === 0) {
    return (
      <p className="text-sm text-gray-500" role="status">
        {t('discovery.scanning')}
      </p>
    );
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500">
              <th className="py-1 pr-4 font-medium">{t('discovery.th.type')}</th>
              <th className="py-1 pr-4 font-medium">{t('discovery.th.collections')}</th>
              <th className="py-1 pr-4 font-medium">{t('discovery.th.items')}</th>
              <th className="py-1 pr-4 font-medium">{t('discovery.th.size')}</th>
              <th className="py-1 pr-4 font-medium">{t('discovery.th.needsId')}</th>
              <th className="py-1 pr-4 font-medium">{t('discovery.th.existing')}</th>
              <th className="py-1 font-medium" />
            </tr>
          </thead>
          <tbody>
            {domains.map((d) => (
              <tr key={d.domain} className="border-t border-gray-100">
                <td className="py-1 pr-4 font-medium text-gray-900">{t(DOMAIN_KEY[d.domain])}</td>
                <td className="py-1 pr-4">{d.collections}</td>
                <td className="py-1 pr-4">{d.items}</td>
                <td className="py-1 pr-4">{formatBytes(d.bytes)}</td>
                <td className="py-1 pr-4">
                  {d.generatedIdItems ? (
                    <span className="text-amber-700">{d.generatedIdItems}</span>
                  ) : (
                    <span className="text-gray-400">0</span>
                  )}
                </td>
                <td className="py-1 pr-4">
                  {/*
                    Absent, not zero, when the destination could not be
                    enumerated. Printing "0" would tell the customer their
                    destination is empty when we simply did not look
                    (hard rule 9).
                  */}
                  {d.targetExisting == null ? (
                    <span className="text-gray-400">&mdash;</span>
                  ) : d.targetColliding ? (
                    <span className="text-amber-700">
                      {d.targetExisting} ({d.targetColliding} {t('discovery.keptAsIs')})
                    </span>
                  ) : (
                    <span>{d.targetExisting}</span>
                  )}
                </td>
                {/* Verbatim, never summarised — §11.2's honest passthrough. */}
                <td className="py-1 text-red-700">{d.lastError ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/*
        Named, not counted. "1 more to go" tells somebody to wait without
        telling them what for; "Still counting: Files" lets them judge whether
        the number they are looking at is the one they care about.

        `role="status"` for the same reason the scanning line has it: this
        appears without the reader doing anything, and a screen reader that
        never announces it leaves them with the same finished-looking table
        this whole change exists to prevent.
      */}
      {pending.length > 0 && (
        <p className="mt-2 text-sm text-gray-500" role="status">
          {t(slow ? 'discovery.stillCounting.slow' : 'discovery.stillCounting', {
            domains: pending.map((d) => t(DOMAIN_KEY[d])).join(', '),
          })}
        </p>
      )}

      {/*
        The numbers are real; they are just not this attempt's. Named for the
        same reason the pending line names its domains — "some of these are
        old" tells a reader to distrust the whole table, which is both more
        alarming and less true than saying which two rows it is.

        `role="note"` beside the two warnings below rather than `status` with
        the line above: this is a caveat about what the table means, not
        progress that is still moving.
      */}
      {countedEarlier.length > 0 && (
        <p className="mt-2 text-sm text-amber-700" role="note">
          {t('discovery.countedEarlier', {
            domains: countedEarlier.map((d) => t(DOMAIN_KEY[d])).join(', '),
          })}
        </p>
      )}

      {generatedId > 0 && (
        <p className="mt-2 text-sm text-amber-700" role="note">
          {generatedId}{' '}
          {t(generatedId === 1 ? 'discovery.generatedId.pre.one' : 'discovery.generatedId.pre.many')}{' '}
          <strong>{t('discovery.generatedId.strong')}</strong>{' '}
          {t('discovery.generatedId.post')}
        </p>
      )}

      {colliding > 0 && (
        <p className="mt-2 text-sm text-amber-700" role="note">
          {colliding}{' '}
          {t(colliding === 1 ? 'discovery.colliding.pre.one' : 'discovery.colliding.pre.many')}{' '}
          <strong>{t('discovery.colliding.strong')}</strong>{' '}
          {t('discovery.colliding.post')}
        </p>
      )}
    </div>
  );
};

export default DiscoveryCounts;
