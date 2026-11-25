// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * FREE SPACE AT THE DESTINATION, BEFORE START (workplan 0171 §6.3, T9).
 *
 * One line per pool, under a migration's counts, read live once its count is
 * in (the need is the count's bytes). Shared by every screen that has a Start:
 * *Start a migration*'s check step, *Review and start*, and the appliance's
 * own confirm page.
 *
 * What Start does (the owner's decisions of 2026-11-24):
 * - known and enough: the line, nothing in the way;
 * - unknown: said, with what to check, and Start allowed (D3 (a));
 * - known and too little: said, and Start reads *Start anyway* (D4 (a)).
 *
 * Two kinds of answer draw no line. A pool of calendars, contacts or tasks
 * alone: their destinations are not asked (§6.2), being small beside mail and
 * files, and "does not tell us" would be a line about a question nobody put.
 * An `unlimited` answer: the destination says there is no limit, so nothing
 * is in the way, and "check it" would send a person to look for one.
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { spaceHoldsStart, spaceVerdict, type DiscoveryDomain } from '@openmig/shared';
import { fetchDestinationSpace, type DestinationSpacePool } from '../services/operating-service.ts';
import { serverMessage } from '../services/api.ts';
import { useLocale } from '../i18n/index.tsx';
import { formatBytes } from '../i18n/bytes.ts';

const NOT_ASKED: ReadonlySet<DiscoveryDomain> = new Set(['calendar', 'contact', 'task']);

/** The lines a person is shown: see the header for the two kinds left out. */
export function spaceLinesShown(pools: ReadonlyArray<DestinationSpacePool>): DestinationSpacePool[] {
  return pools.filter(
    (p) =>
      !p.dataTypes.every((d) => NOT_ASKED.has(d)) && !(p.capacity.known === false && p.capacity.why === 'unlimited'),
  );
}

/** Whether Start reads *Start anyway* for these lines (D4 (a)). */
export function spaceHolds(pools: ReadonlyArray<DestinationSpacePool> | undefined): boolean {
  return pools !== undefined && spaceHoldsStart(spaceLinesShown(pools));
}

/**
 * The lines for one migration. `enabled` waits for its count, which is the
 * need; read once, not polled: each read opens a connection to the
 * destination. `onHolds` tells the screen's Start what to say.
 */
export const DestinationSpaceLines: React.FC<{
  readonly mappingId: string;
  readonly enabled: boolean;
  readonly onHolds?: (mappingId: string, holds: boolean) => void;
}> = ({ mappingId, enabled, onHolds }) => {
  const { t, locale } = useLocale();
  const space = useQuery({
    queryKey: ['destination-space', mappingId],
    queryFn: () => fetchDestinationSpace(mappingId),
    enabled,
    retry: false,
    staleTime: 60_000,
  });
  const holds = spaceHolds(space.data);
  React.useEffect(() => onHolds?.(mappingId, holds), [mappingId, holds, onHolds]);

  if (!enabled) return null;
  // The question failed as a whole: said (hard rule 9), and Start allowed,
  // as for any destination that does not say (D3 (a)).
  if (space.isError) {
    return (
      <p className="mt-2 text-sm text-gray-600" data-space-line="not-read">
        {t('start.check.space.notRead')} {serverMessage(space.error)}
      </p>
    );
  }
  const lines = spaceLinesShown(space.data ?? []);
  if (lines.length === 0) return null;
  const size = (n: number) => formatBytes(n, locale);
  return (
    <ul className="mt-2 space-y-1 text-sm break-words" data-space-lines>
      {lines.map((line) => {
        const verdict = spaceVerdict(line);
        const words = {
          need: size(line.needBytes),
          free: line.capacity.known ? size(line.capacity.freeBytes) : '',
          destination: line.destination,
        };
        return (
          <li key={line.pool} data-space-line={verdict}>
            {verdict === 'fits' && <p className="text-gray-700">{t('start.check.space.fits', words)}</p>}
            {verdict === 'short' && (
              <div role="note" className="text-amber-800">
                <p className="font-medium">{t('start.check.space.short', words)}</p>
                <p>{t('start.check.space.short.why')}</p>
              </div>
            )}
            {verdict === 'unknown' && (
              <div className="text-gray-700">
                <p>{t('start.check.space.unknown', words)}</p>
                <p className="text-gray-600">{t('start.check.space.unknown.why', words)}</p>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
};
