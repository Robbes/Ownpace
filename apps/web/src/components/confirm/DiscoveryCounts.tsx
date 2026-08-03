// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
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
import type { DiscoveryDomain, DiscoveryRecord } from '@openmig/shared';

const DOMAIN_LABEL: Record<DiscoveryDomain, string> = {
  email: 'Email',
  calendar: 'Calendar',
  contact: 'Contacts',
  file: 'Files',
};

export function formatBytes(bytes?: number): string {
  if (bytes === undefined) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let n = bytes;
  let u = 0;
  while (n >= 1024 && u < units.length - 1) {
    n /= 1024;
    u += 1;
  }
  return `${n.toFixed(u === 0 ? 0 : 1)} ${units[u]}`;
}

export const DiscoveryCounts: React.FC<{
  domains: ReadonlyArray<DiscoveryRecord>;
  /** Shown instead of the table while the first pass has not landed. */
  scanning?: boolean;
}> = ({ domains, scanning }) => {
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
        Scanning your source (read-only)…
      </p>
    );
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500">
              <th className="py-1 pr-4 font-medium">Type</th>
              <th className="py-1 pr-4 font-medium">Collections</th>
              <th className="py-1 pr-4 font-medium">Items</th>
              <th className="py-1 pr-4 font-medium">Size</th>
              <th className="py-1 pr-4 font-medium">Needs an ID</th>
              <th className="py-1 pr-4 font-medium">Already on the destination</th>
              <th className="py-1 font-medium" />
            </tr>
          </thead>
          <tbody>
            {domains.map((d) => (
              <tr key={d.domain} className="border-t border-gray-100">
                <td className="py-1 pr-4 font-medium text-gray-900">{DOMAIN_LABEL[d.domain]}</td>
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
                      {d.targetExisting} ({d.targetColliding} kept as-is)
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
          {generatedId} message{generatedId === 1 ? '' : 's'} arrived without a Message-ID, which is
          what we use to copy each message exactly once. We will generate one and add it to{' '}
          <strong>the copy on your new server</strong> — the original on your old server is not
          changed. These messages <strong>are</strong> included in the counts above and will be
          migrated.
        </p>
      )}

      {colliding > 0 && (
        <p className="mt-2 text-sm text-amber-700" role="note">
          {colliding} item{colliding === 1 ? '' : 's'} already on your destination match
          {colliding === 1 ? 'es' : ''} something in your source. We will{' '}
          <strong>keep the destination&rsquo;s copy</strong> and not overwrite it. Anything else
          already there is left untouched.
        </p>
      )}
    </div>
  );
};

export default DiscoveryCounts;
