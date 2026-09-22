// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHAT A PASS CHANGED, IN THE LINE PEOPLE ACTUALLY READ.
 *
 * Every pass leaves one line per domain in the run log, and the migration
 * screen shows a total beside it. Both were built from two numbers:
 *
 *     calendar: 0 created, 6104 skipped          Items: 7,467
 *
 * An event the owner edited in Google and this pass rewrote on the target is
 * neither created nor skipped, so it appeared in neither. Nor did an item
 * found already on the target and adopted. The owner, looking at a pass that
 * had just carried two edits across, asked the right question — *"isn't it
 * weird it doesn't list the number of items it updated?"* — because the only
 * way to learn that anything had changed was to fetch the event and look.
 *
 * And a line that cannot say "updated" reads identically for a pass that
 * rewrote everything the source changed and a pass that silently rewrote
 * nothing. That second one was real, and it ran for days on Google calendars:
 * every pass `0 created, N skipped`, the source's edits never arriving, and
 * nothing in the line able to tell the two apart.
 *
 * `updated` and `adopted` are REQUIRED here. A caller whose result cannot
 * supply them does not compile, rather than printing a confident `0 updated`
 * about a pass it never asked.
 */

/** The counts a pass reports, as far as its summary line is concerned. */
export interface PassCounts {
  readonly created: number;
  /** Rewritten on the target because the source changed since it was copied. */
  readonly updated: number;
  /** Already on the target under our natural key, and recorded rather than written. */
  readonly adopted: number;
  readonly skipped: number;
}

/**
 * The counts, as the run log says them.
 *
 * `updated` always appears: a delta pass exists to carry changes, and "0
 * updated" is the answer to the question people ask of one. `adopted` appears
 * only when there is some — it is rare after a first pass, and a permanent
 * "0 adopted" on every line is noise that teaches people not to read the line.
 */
export function passCounts(c: PassCounts): string {
  const said = `${c.created} created, ${c.updated} updated, ${c.skipped} skipped`;
  return c.adopted > 0 ? `${said}, ${c.adopted} adopted` : said;
}

/**
 * The items a pass HANDLED — what the migration screen totals as "Items".
 *
 * Every outcome that is a finished answer about an item: copied, rewritten,
 * adopted, or seen and left because nothing changed. Failures are not in it;
 * they are counted and shown on their own, and an item that failed was not
 * handled.
 */
export function itemsHandled(c: PassCounts): number {
  return c.created + c.updated + c.adopted + c.skipped;
}
