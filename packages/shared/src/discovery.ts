// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Pre-sync discovery snapshot for one domain (workplan 0013). A **read-only, body-free** count of
 * what a source holds — shown to the owner before they green-light the migration (SAD §11.2 "scope
 * manifest, shown before start"). Point-in-time only: the authoritative reconciliation stays the
 * cutover verification gate (§9/§14).
 */
export interface DomainDiscovery {
  /** Number of source collections (mail folders / calendars / address books / drives). */
  readonly collections: number;
  /** Total items across all collections (messages / events / contacts / files). */
  readonly items: number;
  /** Total bytes, when the listing carries per-item sizes cheaply (mail/files); omitted otherwise. */
  readonly bytes?: number;
  /** Optional per-collection breakdown, in listing order. */
  readonly perCollection?: ReadonlyArray<DiscoveryCollection>;
  /**
   * Items that arrive with no natural key of their own (mail with no
   * Message-ID) and will be copied with a GENERATED Message-ID written into
   * them. A subset of `items` — they are migrated, not left behind.
   *
   * Reported because we modify those messages. They were previously dropped
   * outright and, before #145, dropped silently: absent from this total, from
   * the ledger, and from the target listing, so both halves of the
   * verification gate agreed on nothing and reported PASS.
   */
  readonly generatedIdItems?: number;
  /**
   * Items in collections that will be SKIPPED, and are therefore not part of
   * `items`.
   *
   * Counted apart rather than folded in, because they are two different
   * promises: `items` is what will be on the target, this is what deliberately
   * will not. Nobody wants their new mailbox pre-loaded with mail they threw
   * away — but that is a choice the owner makes at the confirm screen, and it
   * can only be a choice if the number is in front of them.
   */
  readonly excludedItems?: number;
  /**
   * Items the DESTINATION already holds for this domain, before we copy
   * anything. Omitted when the target could not be enumerated.
   *
   * A destination account is very often not empty — the customer may already be
   * using it, and a freshly provisioned one ships with the provider's own
   * starter content. Nothing about that was visible before the run: discovery
   * counted the source only, so the confirm screen described a migration into
   * what looked like an empty account no matter what was actually there.
   */
  readonly targetExisting?: number;
  /**
   * How many of `targetExisting` share a natural key with a source item, and
   * will therefore be **adopted**: recorded as migrated, left exactly as the
   * destination has them, never overwritten (hard rule 2).
   *
   * This is the number that changes what the customer gets, so it is the one
   * they have to see before they press start. The rest of `targetExisting` is
   * their own unrelated data and is never touched.
   */
  readonly targetColliding?: number;
}

/** One collection's discovery counts. */
export interface DiscoveryCollection {
  /** Human label for the collection (folder name/path). */
  readonly name: string;
  /** Item count in this collection. */
  readonly items: number;
  /** Byte total for this collection, when available. */
  readonly bytes?: number;
  /** Items in this collection that will be given a generated Message-ID. */
  readonly generatedIdItems?: number;
  /**
   * Why this collection will NOT be migrated, when it will not be.
   *
   * Present with a human-readable reason — "Deleted Items", "Junk" — rather than
   * a boolean, because the confirm screen has to say WHY. "We are leaving 1,240
   * items behind" is alarming; "we are leaving 1,240 items in Deleted Items and
   * Junk behind, tell us if you want them" is a decision.
   */
  readonly excluded?: string;
}

/**
 * THE sync domains — the one list, in the order a person ticks them.
 *
 * A capability list belongs in one table, and a second copy disagrees with the
 * first exactly once (the rule `PROVIDER_ACCOUNT_DOMAINS` already carries).
 * This union used to be typed out by hand in eighty places across eighteen
 * files — the ledger stores, the orchestration seams, the core engines, the
 * managed metering, the web services — so a fifth domain was eighty edits and
 * a drift bug in whichever one was missed. That is #597's shape, which this
 * repository has paid for twice.
 *
 * A `const` array rather than a bare union because both halves are needed and
 * only one may be authored: the TYPE for what a value may be, and the LIST for
 * code that has to walk every domain. Deriving the first from the second is
 * what stops them disagreeing.
 *
 * `scripts/a-domain-union-typed-out-by-hand.unit.test.ts` fails the build on a
 * new copy of either, and names every place that legitimately keeps its own
 * (workplan 0113 T1).
 */
export const DISCOVERY_DOMAINS = ['email', 'calendar', 'contact', 'file', 'task'] as const;

/**
 * The sync domains discovery covers.
 *
 * `task` joined on 2026-09-03 (workplan 0113). It is the fifth, and the first
 * added since this list became one list — which is the whole point of T1: the
 * compiler now names every place that has to decide what a task means there,
 * instead of leaving one behind to fail in somebody's migration.
 */
export type DiscoveryDomain = (typeof DISCOVERY_DOMAINS)[number];

/** A stored discovery result for one domain (T2). Extends the counts with persistence metadata. */
export interface DiscoveryRecord extends DomainDiscovery {
  readonly domain: DiscoveryDomain;
  /**
   * ISO 8601 timestamp of when THE COUNTS IN THIS ROW were taken — not of the
   * most recent attempt.
   *
   * The two are the same until a pass fails, and a failing pass keeps whatever
   * a prior successful one recorded (`recordDiscoveryError`). Re-stamping this
   * at that moment dated an earlier pass's numbers to today, which is the one
   * reading a customer cannot check: the confirm screen prints it as "checked
   * at" above a table of counts nothing had just counted (2026-09-08).
   */
  readonly discoveredAt: string;
  /** Verbatim error from the last pass, if it failed (§11.2 honest passthrough); else absent. */
  readonly lastError?: string;
}

/**
 * THE ROWS THIS MIGRATION'S PREFLIGHT IS ENTITLED TO SHOW.
 *
 * `migration_discovery` is keyed by (tenant, mapping, domain) and nothing ever
 * deletes from it, so it accumulates every domain any pass has ever counted
 * for a mapping. What the mapping CARRIES is a different set, held in
 * `scope_selection`, and the two came apart the moment a pass counted a domain
 * the owner had not ticked.
 *
 * They did come apart. Before #854 the discovery job defaulted to all five
 * domains when the API asked for none, and `task` fell through to the FILE
 * deps — so a Google mapping carrying no tasks got a Tasks row holding the
 * Drive numbers, byte for byte. #854 stopped the job writing that row. It
 * could not unwrite the ones already stored, and the owner's next preflight
 * showed the same fossil: `Tasks 6 / 180 / 857.5 MB`, identical to Files, on a
 * migration whose Tasks tick has never been on (2026-09-08).
 *
 * So the read side asks the question too. A stored row is part of the answer
 * only while the mapping still carries its domain; anything else is history,
 * and history presented on the confirm screen reads as a promise about what is
 * about to be migrated.
 *
 * FILTERED, NOT DELETED, on purpose. Deleting would need a migration to reach
 * the rows already stored and would throw away the evidence of what an earlier
 * pass saw; filtering fixes the customer's screen on the next page load and
 * leaves the record intact for whoever has to explain it. It is also the
 * cheaper direction to be wrong in: a row wrongly hidden reappears the moment
 * the selection says so, a row wrongly deleted is gone.
 *
 * `selected` is the scope selection, never a default. An empty selection
 * yields an empty answer — the same rule the tick, the sync job and
 * `domainsToCount` all keep, and for the same reason: no `scope_selection` row
 * means "not selected", and filling it back in with everything is the defect
 * this exists to stop.
 *
 * Order is preserved from `rows`, which the store already sorts by domain.
 */
export function discoveryForSelection(
  rows: readonly DiscoveryRecord[],
  selected: Iterable<DiscoveryDomain>,
): DiscoveryRecord[] {
  const carried = new Set(selected);
  return rows.filter((row) => carried.has(row.domain));
}

/**
 * The domains whose counts predate their error.
 *
 * A failing pass keeps the counts a prior successful one recorded, which is
 * the right call — throwing away a good number because the next attempt could
 * not be made would lose more than it saves. But the row that comes back then
 * carries both, and a table showing `3,430 folders / 95,734 items / 21.6 GB`
 * beside a red error says nothing about which of the two is current. That is
 * the row the owner's Microsoft preflight showed him on 2026-09-08, and there
 * was nothing on the screen to tell him the count was a week old and the
 * failure was minutes old.
 *
 * Derived rather than stored: `recordDiscoveryError` writes zero counts when
 * there was nothing to keep, so a row holding an error AND a count is
 * precisely one whose count came from an earlier pass. No column, no
 * migration, and it cannot drift from the store's behaviour because it is
 * reading that behaviour's own footprint.
 */
export function domainsCountedBeforeTheirError(
  rows: readonly DiscoveryRecord[],
): DiscoveryDomain[] {
  return rows
    // Truthy rather than `!= null`: the store already reads an empty string as
    // no error at all (`row.lastError ? … : {}`), and a caveat raised by one
    // would contradict the blank error cell in the row it is about.
    .filter((row) => Boolean(row.lastError) && (row.collections > 0 || row.items > 0))
    .map((row) => row.domain);
}
