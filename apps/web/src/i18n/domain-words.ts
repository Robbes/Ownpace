// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The dictionary key for each sync domain — ONE map (workplan 0113 T5).
 *
 * There were four: the confirm screen's counts table, and the qualification
 * line, evidence list and measured line in `probe-text.ts`. Every one of them
 * spelled the same four domains and the same four `domain.*` keys, and when a
 * fifth domain reached the record none of them knew — which is the drift T1
 * removed from the domain list itself, reappearing one layer up in the words.
 *
 * Typed as a total `Record<DiscoveryDomain, StringKey>`, so a sixth domain is
 * a compile error here rather than a missing word on a screen.
 */

import type { DiscoveryDomain } from '@openmig/shared';
import type { StringKey } from './strings.ts';

export const DOMAIN_STRING_KEY: Readonly<Record<DiscoveryDomain, StringKey>> = {
  email: 'domain.email',
  calendar: 'domain.calendar',
  contact: 'domain.contact',
  file: 'domain.file',
  task: 'domain.task',
};
