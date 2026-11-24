// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A 90-DAY MIGRATION'S ANCHOR ON THE APPLIANCE (workplan 0170 §5.4).
 *
 * The mapping file says `{ "recentOnly": { "days": 90 } }`, and the window it
 * means is the last 90 days before the migration was first recorded, never
 * before the latest restart: a window that moved with every boot would drop
 * the oldest of what it copied out of itself, and copy something new each
 * morning. So the appliance writes the anchor itself, the first time it
 * records the mapping, into the same `mailbox_mapping.source_config_override`
 * managed writes it into, and reads it back on every boot after. A file that
 * names an `anchor` is used as written.
 *
 * Broadening is removing the key from the file; the boot's revision check
 * allows it (`config-revision.ts`), and the stored setting goes with it, so
 * the row says what the file says.
 */

import { parseRecentOnly, RECENT_ONLY_FIELD, type RecentOnlySetting } from '@openmig/shared';

export interface AnchorDecision {
  /** The setting the appliance runs with: the file's, anchored; absent for a migration of everything. */
  readonly setting: RecentOnlySetting | undefined;
  /** The override to store, or `undefined` when the stored one is already right. */
  readonly write: Record<string, unknown> | null | undefined;
}

/**
 * What a boot runs with, and what it stores, from the file's setting and the
 * row's override. Pure, so both halves are proved without a database.
 */
export function anchorRecentOnly(
  fromFile: RecentOnlySetting | undefined,
  storedOverride: Record<string, unknown> | null | undefined,
  now: Date,
): AnchorDecision {
  // A stored value the parser refuses is somebody's hand edit: refused
  // aloud, never read as no anchor, which would move the window (hard rule 9).
  const stored = parseRecentOnly(storedOverride?.[RECENT_ONLY_FIELD]);
  if (fromFile === undefined) {
    if (stored === undefined) return { setting: undefined, write: undefined };
    const { [RECENT_ONLY_FIELD]: _broadened, ...rest } = storedOverride ?? {};
    return { setting: undefined, write: Object.keys(rest).length > 0 ? rest : null };
  }
  const anchor = fromFile.anchor ?? stored?.anchor ?? now.toISOString();
  const setting: RecentOnlySetting = { days: fromFile.days, anchor };
  const same = stored?.anchor === anchor && stored.days === setting.days;
  return {
    setting,
    write: same ? undefined : { ...(storedOverride ?? {}), [RECENT_ONLY_FIELD]: { days: setting.days, anchor } },
  };
}
