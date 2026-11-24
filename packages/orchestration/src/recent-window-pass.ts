// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE LAST 90 DAYS FIRST, AS A DATA TYPE'S PASSES RUN IT (workplan 0170 §3).
 *
 * One rule for both dispatchers, the appliance's `runAllDomains` and the
 * managed worker's `run-delta-sync`, so the editions cannot copy in different
 * orders (hard rule 5):
 *
 *  - **Phase A.** The first time a windowed data type is copied, its pass
 *    reads the last 90 days only. Its record (`windowRecordKey`) says
 *    `copying` when it starts, with the window's `since`, and `in` when the
 *    pass reached the end of every collection. A phase A that stopped halfway
 *    is run again by the next firing, from the same `since`; the ledger skips
 *    what it copied.
 *  - **Phase B.** In the same firing, once the window is in: the ordinary
 *    pass, which lists in full with no cursor, since phase A wrote none.
 *  - **A 90-day migration** (`recentOnly`) runs the window pass every time,
 *    anchored where its setting says, and never phase B, until it is broadened.
 *
 * A data type with no record whose first copy has already finished
 * (`copiedOnce`, `migration_status.completed_at`) is past the point a window
 * was for, and is never given one: every migration made before this, and
 * every 90-day migration broadened after its window was in.
 */

import {
  eventInWindow,
  fileInWindow,
  formatWindowRecord,
  mailInWindow,
  isWindowedDomain,
  parseWindowRecord,
  windowRecordKey,
  windowSince,
  type CursorStore,
  type DiscoveryDomain,
  type MailItem,
  type MappingId,
  type RawCalendarEvent,
  type RawFileItem,
  type PassWindow,
  type RecentOnlySetting,
  type TenantId,
} from '@openmig/shared';

export interface WindowPlanArgs {
  readonly tenantId: TenantId;
  readonly mappingId: MappingId;
  readonly domain: DiscoveryDomain;
  /** Where the record lives. Absent: no record can be kept, and no phase A is run. */
  readonly cursors?: CursorStore;
  /** The migration's 90-day setting, absent for a migration of everything. */
  readonly recentOnly?: RecentOnlySetting;
  /** Whether a pass over this data type ever reached the end. */
  readonly copiedOnce: () => Promise<boolean>;
  readonly now?: () => Date;
}

/**
 * The window this data type's next pass owes, or `undefined` for an ordinary
 * pass. Throws for a 90-day migration without an anchor: the appliance writes
 * one when it first records the mapping (§5.4), and a window that moved with
 * every restart would be no window at all.
 */
export async function planWindow(args: WindowPlanArgs): Promise<PassWindow | undefined> {
  const { tenantId, mappingId, domain, cursors, recentOnly } = args;
  if (!isWindowedDomain(domain)) return undefined;
  if (recentOnly) {
    if (recentOnly.anchor === undefined) {
      throw new Error(
        'this migration copies only the last 90 days, and has no anchor to count them from. ' +
          'The anchor is written when the migration is first recorded; record it again.',
      );
    }
    return { since: windowSince(new Date(recentOnly.anchor), recentOnly.days), only: true };
  }
  if (!cursors) return undefined;
  const record = parseWindowRecord((await cursors.get(tenantId, mappingId, windowRecordKey(domain)))?.value);
  if (record?.state === 'in') return undefined;
  if (record?.state === 'copying') return { since: new Date(record.since), only: false };
  if (await args.copiedOnce()) return undefined;
  // D7: a migration of everything is anchored when its phase A starts.
  return { since: windowSince((args.now ?? (() => new Date()))()), only: false };
}

/** The part of a pass's result this rule reads. */
export interface WindowedResult {
  readonly windowComplete?: boolean;
}

export interface WindowedRun<R> {
  /** What the firing reports: phase B's result with phase A's work added, or the one pass that ran. */
  readonly result: R;
  /**
   * The data type's first copy is not complete although its pass returned:
   * phase A ran and did not reach the end, so phase B did not run. The caller
   * must not mark it completed (§3.2 5).
   */
  readonly firstCopyOwed: boolean;
}

/**
 * Run a data type's pass with the window `plan` owes: the window pass, then,
 * for phase A that is in, the ordinary pass. `run` builds and runs one pass,
 * with the window or without it.
 */
export async function runWithWindow<R extends WindowedResult>(args: {
  readonly tenantId: TenantId;
  readonly mappingId: MappingId;
  readonly domain: DiscoveryDomain;
  readonly cursors?: CursorStore;
  readonly plan: PassWindow | undefined;
  readonly run: (window: PassWindow | undefined) => Promise<R>;
}): Promise<WindowedRun<R>> {
  const { tenantId, mappingId, domain, cursors, plan, run } = args;
  if (!plan) return { result: await run(undefined), firstCopyOwed: false };
  const key = windowRecordKey(domain);
  const since = plan.since.toISOString();
  const recorded = parseWindowRecord((await cursors?.get(tenantId, mappingId, key))?.value);
  if (recorded?.state !== 'in' || recorded.since !== since) {
    await cursors?.set(tenantId, mappingId, key, { value: formatWindowRecord({ since, state: 'copying' }) });
  }
  const windowPass = await run(plan);
  const isIn = windowPass.windowComplete === true;
  if (isIn) await cursors?.set(tenantId, mappingId, key, { value: formatWindowRecord({ since, state: 'in' }) });
  // A 90-day migration is complete when its window is in: the caller treats
  // it as any pass, and its own pause, stop or unread collection decides.
  if (plan.only) return { result: windowPass, firstCopyOwed: false };
  if (!isIn) return { result: windowPass, firstCopyOwed: true };
  const rest = await run(undefined);
  return { result: mergePhases(windowPass, rest), firstCopyOwed: false };
}

/**
 * The counts of work each phase DID, added; everything else is phase B's,
 * which listed the whole source and is the state the data type is in now.
 * `scanned` and `skipped` are phase B's alone: it lists what phase A copied
 * again and skips it.
 */
const ADDED = [
  'created',
  'updated',
  'adopted',
  'firstCopyBytes',
  'heldAtCeiling',
  'moved',
  'conflicted',
  'keptForGuests',
  'changedButAdopted',
  'changedAfterCutover',
  'addressChanged',
  'reappearedAfterRemoval',
  'superseded',
  'earlierExports',
] as const;

/** Phase A's and phase B's results as the one pass a firing reports. */
export function mergePhases<R extends object>(windowPass: R, rest: R): R {
  const a = windowPass as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...(rest as Record<string, unknown>) };
  for (const field of ADDED) {
    if (typeof a[field] === 'number' && typeof merged[field] === 'number') {
      merged[field] = (a[field] as number) + (merged[field] as number);
    } else if (typeof a[field] === 'number' && merged[field] === undefined) {
      merged[field] = a[field];
    }
  }
  for (const field of ['moves', 'deletions'] as const) {
    if (Array.isArray(a[field]) && Array.isArray(merged[field])) {
      merged[field] = [...(a[field] as unknown[]), ...(merged[field] as unknown[])];
    }
  }
  delete merged.windowComplete;
  return merged as R;
}

/**
 * The window discovery counts for a 90-day migration (workplan 0170 §3.2), so
 * *Review and start* says what it will copy; `undefined` for a migration of
 * everything, or a data type with no window, whose discovery reads in full.
 * The predicate is the one the data type's pass asks of the same items.
 */
export function discoveryWindowFor(
  domain: DiscoveryDomain,
  recentOnly: RecentOnlySetting | undefined,
  now: () => Date = () => new Date(),
): { readonly since: Date; readonly holds: (item: unknown) => boolean } | undefined {
  if (!recentOnly || !isWindowedDomain(domain)) return undefined;
  // Before the appliance first records the mapping there is no anchor yet:
  // it will be now, give or take the minutes until the first pass.
  const since = windowSince(recentOnly.anchor ? new Date(recentOnly.anchor) : now(), recentOnly.days);
  const holds =
    domain === 'email'
      ? (item: unknown) => mailInWindow(item as MailItem, since)
      : domain === 'file'
        ? (item: unknown) => fileInWindow((item as RawFileItem).item, since)
        : (item: unknown) => eventInWindow(item as RawCalendarEvent, since);
  return { since, holds };
}
