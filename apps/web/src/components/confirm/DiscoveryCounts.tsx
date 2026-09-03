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
import type { DiscoveryRecord } from '@openmig/shared';
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

export const DiscoveryCounts: React.FC<{
  domains: ReadonlyArray<DiscoveryRecord>;
  /** Shown instead of the table while the first pass has not landed. */
  scanning?: boolean;
}> = ({ domains, scanning }) => {
  const t = useT();
  // A subset of `items`: these ARE migrated. Shown because we modify them.
  const generatedId = domains.reduce((sum, d) => sum + (d.generatedIdItems ?? 0), 0);
  // Items the destination already holds under a key matching something in the
  // source: we keep the destination's copy. Non-destructive and the right
  // default, but it decides what the customer ends up with, so it belongs here
  // and not in a verification report after the fact.
  const colliding = domains.reduce((sum, d) => sum + (d.targetColliding ?? 0), 0);

  if (scanning || domains.length === 0) {
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
