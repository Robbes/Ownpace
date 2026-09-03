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
  /** ISO 8601 timestamp of the most recent discovery pass for this domain. */
  readonly discoveredAt: string;
  /** Verbatim error from the last pass, if it failed (§11.2 honest passthrough); else absent. */
  readonly lastError?: string;
}
