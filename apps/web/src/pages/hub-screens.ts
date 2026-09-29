// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * THE HUB'S SEVEN STEPS, IN CUTOVER ORDER (0034; workplan 0153 T5, 0154 T4).
 *
 * A migration's page shows them as cards, and a person's page as one list
 * summed across their migrations. One list, so the two cannot put the steps
 * in different orders or call them different things.
 */
import { AlertTriangle, ClipboardCheck, Flag, ListChecks, MoveRight, Share2, Trash2 } from 'lucide-react';
import type { StringKey } from '../i18n/strings.ts';

export const SCREENS: ReadonlyArray<{
  nameKey: StringKey;
  path: string;
  icon: typeof Trash2;
  blurbKey: StringKey;
}> = [
  { nameKey: 'hub.deletions.name', path: 'deletions', icon: Trash2, blurbKey: 'hub.deletions.blurb' },
  { nameKey: 'hub.moves.name', path: 'moves', icon: MoveRight, blurbKey: 'hub.moves.blurb' },
  { nameKey: 'hub.failures.name', path: 'failures', icon: AlertTriangle, blurbKey: 'hub.failures.blurb' },
  { nameKey: 'hub.sharing.name', path: 'sharing', icon: Share2, blurbKey: 'hub.sharing.blurb' },
  { nameKey: 'hub.check.name', path: 'verify', icon: ListChecks, blurbKey: 'hub.check.blurb' },
  // The confirmed list sits beside Check and after it, deliberately: Check
  // asks whether the migration is complete, this one hands over the account
  // item by item. It is the last screen before somebody empties the old one.
  {
    nameKey: 'hub.confirmed.name',
    path: 'confirmed',
    icon: ClipboardCheck,
    blurbKey: 'hub.confirmed.blurb',
  },
  { nameKey: 'hub.finish.name', path: 'finish', icon: Flag, blurbKey: 'hub.finish.blurb' },
];
