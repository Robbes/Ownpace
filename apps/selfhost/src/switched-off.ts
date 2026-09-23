// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The startup line for a data type the mapping file switched off (workplan
 * 0125 T7, the first of its three steps).
 *
 * The owner, 2026-09-23: *"don't refuse but do the 3 steps"*. The boot check
 * does not refuse a switched-off data type, because nothing is lost: its
 * copies and its ledger rows stay, and switching it back on continues where it
 * stopped. What was wrong is that nothing said so, and those copies stopped
 * following the source without a word.
 *
 * So each one with copies gets one line, and the line carries the three facts
 * the owner named: how many stay, that they no longer follow the source, and
 * that switching it back on continues where it stopped. It names the key in
 * the mapping file, because that is where the operator switches it back.
 */

import { DOMAIN_CONFIG_KEY, type DiscoveryDomain } from '@openmig/shared';

export function switchedOffLine(mappingId: string, domain: DiscoveryDomain, copies: number): string {
  const stay = copies === 1 ? '1 copy stays' : `${copies} copies stay`;
  const follow = copies === 1 ? 'no longer follows' : 'no longer follow';
  return (
    `${mappingId}: domains.${DOMAIN_CONFIG_KEY[domain]} is switched off. Its ${stay} on the ` +
    `target and ${follow} the source; switching it back on continues where it stopped.`
  );
}
