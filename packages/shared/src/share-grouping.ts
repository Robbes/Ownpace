// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A folder is one row, not two hundred (workplan 0123 T4).
 *
 * ## The finding
 *
 * The owner's Sharing page showed 482 rows for a handful of shared folders.
 * Drive populates `permissions` on every CHILD of a shared folder as well as
 * on the folder, so one folder shared with one person yields a row for the
 * folder and a row per file beneath it. Every row is true; together they are
 * unreadable, and the share nobody knew about hides in the noise.
 *
 * ## Why this groups on the CONTAINER and not on reported inheritance
 *
 * §5 named two designs and said the choice had to be measured rather than
 * assumed. It was, on the owner's Drive, 2026-09-18:
 *
 *   inline: 0/10    permissions.list: 10/10    with inheritedFrom: 0/10
 *
 * Drive returns `permissionDetails` and will say a grant IS inherited. It will
 * not say what FROM — `inheritedFrom` never came back — and "group children
 * under the folder they inherit from" needs exactly that. The same run showed
 * the details are on `permissions.list` only, one request per item, where the
 * container rides along on the listing the scan already makes. So the
 * container is both the key the data allows and the cheap one.
 *
 * ## The rule, in one sentence
 *
 * **A group is a container plus a grant set.** Items under the same container
 * carrying EXACTLY the same grants fold into one row; anything else keeps its
 * own. That is the whole rule, and the two halves of §5 fall out of it rather
 * than being special-cased: the folder's contents collapse, and a file with a
 * grant its siblings do not have cannot collapse into them.
 *
 * ## EXACTLY, in both directions
 *
 * A child MISSING one of the folder's grants deviates as much as one carrying
 * an extra. "This file inside a shared folder is not actually shared with
 * everyone the folder is" is precisely the finding somebody needs before a
 * cutover, and a subset test would report it as inherited. The ROLE is part of
 * the grant for the same reason: a child the folder's reader can also WRITE to
 * is a deviation, and comparing grantees alone would fold it away.
 *
 * ## What is never folded
 *
 * A row whose source did not say where it sits (`parentKey` absent) stands
 * alone, always. Hard rule 9: not knowing where something lives is not the
 * same as knowing it lives with these others, and a grouping that guessed
 * would hide a share under a folder it may not even be in.
 *
 * ## ONE LEVEL, NOT TRANSITIVE — a limit, stated rather than discovered
 *
 * A folder inside a shared folder heads its OWN group; it is not rolled up
 * into its parent's count. So a shared `Photos` holding a shared `2023` shows
 * two rows, not one row of everything underneath.
 *
 * That is deliberate and it is also the smaller claim. Rolling up would mean
 * asserting that a grant on the outer folder reaches a file three levels down,
 * and the measurement that settled this design is precisely the one that found
 * Drive will NOT tell us what a grant is inherited from (§5, 2026-09-18). A
 * transitive count would therefore be our inference presented as the source's
 * answer. Two honest rows beat one confident one; if the owner wants the
 * roll-up later it needs its own evidence, not a deeper loop here.
 */

/** One grant, as little of a row as the rule needs. */
export interface GroupableGrant {
  /** This row's own identity, handed back untouched so a caller can act on it. */
  readonly id: string;
  /** The source's id for the thing granted on. Absent = the source did not say. */
  readonly itemKey?: string | undefined;
  /** The source's id for the container holding it. Absent = the source did not say. */
  readonly parentKey?: string | undefined;
  /** Whether the thing is itself a container. Absent = the source did not say. */
  readonly isContainer?: boolean | undefined;
  /** What to call it on screen. */
  readonly onLabel: string;
  /** Who holds the right. Absent for a link-style grant. */
  readonly grantee?: string | undefined;
  readonly role: string;
}

/**
 * One item's grants as the sorted strings the comparison is done on.
 *
 * A link grant has no grantee and becomes `(link):role` rather than `:role`,
 * so two different link grants on one item stay one entry and an empty
 * grantee can never collide with a person called nothing.
 */
export function grantSet(grants: readonly GroupableGrant[]): string[] {
  return [...new Set(grants.map((g) => `${g.grantee ?? '(link)'}:${g.role}`))].sort();
}

/**
 * Whether one grant set differs from another, and how.
 *
 * Both directions, for the reason in this file's header: `missing` is as much
 * a finding as `extra`, and the caller renders both.
 */
export function deviation(
  reference: readonly string[],
  candidate: readonly string[],
): { readonly deviates: boolean; readonly extra: string[]; readonly missing: string[] } {
  const ref = new Set(reference);
  const cand = new Set(candidate);
  const extra = [...cand].filter((g) => !ref.has(g)).sort();
  const missing = [...ref].filter((g) => !cand.has(g)).sort();
  return { deviates: extra.length > 0 || missing.length > 0, extra, missing };
}

/** One folder's worth of items that carry identical grants. */
export interface ShareGroup {
  /** The container's own id, in the source's terms. */
  readonly parentKey: string;
  /**
   * What to call the container. Present only when the container is ITSELF a
   * shared row in this set, because that is the only place its name is known —
   * a folder can hold shared files without being shared, and inventing a name
   * for one we never listed would be a claim about a folder nobody read.
   */
  readonly label?: string;
  /** The grants every item here carries, sorted. */
  readonly grants: readonly string[];
  /** How many distinct ITEMS fold in — the count the folder's row shows. */
  readonly items: number;
  /** Every grant row folded in, so one press can act on all of them. */
  readonly rowIds: readonly string[];
  /** Whether the container is itself one of the shared items counted above. */
  readonly containerShared: boolean;
}

/** A row that could not fold, and the reason it could not. */
export interface ShareStandalone {
  readonly rowIds: readonly string[];
  readonly itemKey?: string | undefined;
  readonly label: string;
  readonly grants: readonly string[];
  /**
   * `unplaced` — the source did not say where this sits, so nothing may be
   * assumed about it. `deviates` — it sits somewhere known and its grants
   * differ from what it is being compared with.
   */
  readonly reason: 'unplaced' | 'deviates';
  /** What it was compared WITH, so the screen never implies a basis it lacks. */
  readonly comparedWith?: 'folder' | 'siblings';
  readonly extra?: readonly string[];
  readonly missing?: readonly string[];
  readonly parentKey?: string | undefined;
}

export interface ShareGrouping {
  readonly groups: readonly ShareGroup[];
  readonly standalone: readonly ShareStandalone[];
}

/** Every grant on one item, keyed by the item. */
interface Item {
  readonly itemKey: string;
  readonly label: string;
  readonly parentKey: string | undefined;
  readonly isContainer: boolean | undefined;
  readonly rowIds: readonly string[];
  readonly grants: readonly string[];
}

/**
 * Fold a mapping's sharing rows into folder groups and the rows that resisted.
 *
 * Deterministic: groups come back ordered by what they cover (largest first,
 * then by container key), and every array inside one is sorted. A screen that
 * re-renders on a poll must not reshuffle under the reader's cursor, and a
 * test that asserted on insertion order would pass or fail by the query
 * planner's mood.
 */
export function groupShareGrants(rows: readonly GroupableGrant[]): ShareGrouping {
  // ── one entry per ITEM, because a row is one grant and an item has several
  //
  // The rows are bucketed FIRST and each item built from its whole set. The
  // grant set is a property of the item, not of whichever row happened to
  // arrive first, so there is nothing worth computing until every row for it is
  // in hand — and building it this way means no field of `Item` is ever
  // reassigned after it is made.
  const placed = new Map<string, GroupableGrant[]>();
  const unplaced: GroupableGrant[] = [];
  for (const row of rows) {
    // No item key or no container: nothing can be said about where this sits,
    // so it is never folded. Hard rule 9 — see the header.
    if (!row.itemKey || !row.parentKey) {
      unplaced.push(row);
      continue;
    }
    const list = placed.get(row.itemKey);
    if (list) list.push(row);
    else placed.set(row.itemKey, [row]);
  }
  const items = new Map<string, Item>();
  for (const [itemKey, list] of placed) {
    const first = list[0]!;
    items.set(itemKey, {
      itemKey,
      label: first.onLabel,
      parentKey: first.parentKey,
      isContainer: first.isContainer,
      rowIds: list.map((r) => r.id),
      grants: grantSet(list),
    });
  }

  // ── a container that something in this set sits INSIDE heads its own group
  //
  // THE BUG THIS LINE EXISTS TO PREVENT. Bucketing every item under its own
  // `parentKey` puts a shared folder under ITS parent, beside its siblings,
  // while its children sit in a group that merely borrows its name — so the
  // folder is rendered twice, once as a heading and once as a loose item under
  // the root, and the second one reads as a share nobody has accounted for.
  // A heading container is keyed by its OWN id instead, which lands it in the
  // same bucket as the children that agree with it. It is then a member of the
  // group it heads and is counted in it, which is also why `items` is never
  // zero for a folder whose every child deviates.
  const heads = new Set<string>();
  for (const item of items.values()) {
    if (item.parentKey) heads.add(item.parentKey);
  }
  const bucketKeyFor = (item: Item): string =>
    item.isContainer === true && heads.has(item.itemKey) ? item.itemKey : item.parentKey!;

  // ── bucket by (container, grant set)
  const buckets = new Map<
    string,
    { parentKey: string; grants: readonly string[]; items: Item[] }
  >();
  for (const item of items.values()) {
    const parentKey = bucketKeyFor(item);
    const key = `${parentKey}\u0000${item.grants.join('\u0001')}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.items.push(item);
    else buckets.set(key, { parentKey, grants: item.grants, items: [item] });
  }

  // ── the reference set per container: the container's OWN grants when the
  //    container is itself shared, else the largest sibling bucket. Which one
  //    was used travels with the finding — a deviation that cannot name what
  //    it deviates from is the shape of claim this codebase does not make.
  const containerItem = new Map<string, Item>();
  for (const item of items.values()) {
    if (item.isContainer === true) containerItem.set(item.itemKey, item);
  }
  const largestPerParent = new Map<string, { grants: readonly string[]; items: number }>();
  for (const bucket of buckets.values()) {
    const seen = largestPerParent.get(bucket.parentKey);
    if (!seen || bucket.items.length > seen.items) {
      largestPerParent.set(bucket.parentKey, {
        grants: bucket.grants,
        items: bucket.items.length,
      });
    }
  }

  const groups: ShareGroup[] = [];
  const standalone: ShareStandalone[] = [];

  for (const bucket of buckets.values()) {
    const folder = containerItem.get(bucket.parentKey);
    const reference = folder ? folder.grants : largestPerParent.get(bucket.parentKey)?.grants;
    const comparedWith: 'folder' | 'siblings' | undefined = folder
      ? 'folder'
      : reference
        ? 'siblings'
        : undefined;
    const diff = reference ? deviation(reference, bucket.grants) : undefined;

    // A bucket that agrees with its container's reference is a group. One that
    // differs is a deviation and keeps a row per item, however many items share
    // the deviation — "three files carry an extra grant" is three findings.
    if (!diff || !diff.deviates) {
      const rowIds = bucket.items.flatMap((i) => i.rowIds).sort();
      groups.push({
        parentKey: bucket.parentKey,
        ...(folder ? { label: folder.label } : {}),
        grants: bucket.grants,
        items: bucket.items.length,
        rowIds,
        containerShared: folder !== undefined,
      });
      continue;
    }
    for (const item of bucket.items) {
      standalone.push({
        rowIds: [...item.rowIds].sort(),
        itemKey: item.itemKey,
        label: item.label,
        grants: item.grants,
        reason: 'deviates',
        ...(comparedWith ? { comparedWith } : {}),
        extra: diff.extra,
        missing: diff.missing,
        parentKey: bucket.parentKey,
      });
    }
  }

  // ── the rows nothing could be said about, one entry per item where the
  //    source at least named the item, else one per row.
  const unplacedByItem = new Map<string, GroupableGrant[]>();
  for (const row of unplaced) {
    const key = row.itemKey ?? `\u0000row:${row.id}`;
    const list = unplacedByItem.get(key);
    if (list) list.push(row);
    else unplacedByItem.set(key, [row]);
  }
  for (const list of unplacedByItem.values()) {
    const first = list[0]!;
    standalone.push({
      rowIds: list.map((r) => r.id).sort(),
      ...(first.itemKey ? { itemKey: first.itemKey } : {}),
      label: first.onLabel,
      grants: grantSet(list),
      reason: 'unplaced',
    });
  }

  groups.sort((a, b) => b.items - a.items || a.parentKey.localeCompare(b.parentKey));
  standalone.sort((a, b) => a.label.localeCompare(b.label) || a.rowIds[0]!.localeCompare(b.rowIds[0]!));
  return { groups, standalone };
}
