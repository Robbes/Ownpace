// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A SHARING PAGE THAT LISTS EVERY FILE IN A SHARED FOLDER HIDES THE ONE SHARE
 * NOBODY MEANT TO LEAVE OPEN.
 *
 * The owner's Sharing page showed 482 rows for a handful of shared folders,
 * because Drive populates `permissions` on every child of a shared folder as
 * well as on the folder. Every row was true; the wall of them was unreadable,
 * which is the failure — a list nobody can read is where a forgotten "anyone
 * with the link" survives a cutover.
 *
 * `groupShareGrants` collapses it. What is guarded here is the four ways that
 * collapsing could quietly LOSE something:
 *
 *  1. **A deviation folded into the folder.** A file carrying a grant its
 *     folder does not — or missing one the folder has — is exactly the finding
 *     §5 says must never be folded. Both directions, role included.
 *  2. **A row folded on a guess.** A source that did not say where an item
 *     sits gets no assumption made about it (hard rule 9).
 *  3. **The folder rendered twice.** Keying a heading container by its own
 *     parent puts it under the root beside its siblings AND names the group
 *     beneath it, so it appears as a loose share nobody has accounted for.
 *  4. **A comparison that cannot name its own basis.** A deviation measured
 *     against sibling files is a weaker claim than one measured against the
 *     folder's own grants, and the two must not read the same.
 */
import { describe, it, expect } from 'vitest';
import {
  deviation,
  grantSet,
  groupShareGrants,
  type GroupableGrant,
} from './share-grouping.ts';

/** One grant row, with the fields the rule reads and nothing else. */
const grant = (o: Partial<GroupableGrant> & { id: string }): GroupableGrant => ({
  onLabel: `item-${o.id}`,
  role: 'writer',
  ...o,
});

/** A folder and `n` children that all carry exactly the folder's grants. */
const folderWithChildren = (n: number): GroupableGrant[] => [
  grant({
    id: 'f-anna',
    itemKey: 'F',
    parentKey: 'root',
    isContainer: true,
    onLabel: 'Foto shoot Emma',
    grantee: 'anna@example.test',
  }),
  ...Array.from({ length: n }, (_, i) =>
    grant({
      id: `c${i}-anna`,
      itemKey: `c${i}`,
      parentKey: 'F',
      isContainer: false,
      onLabel: `IMG_${i}.jpg`,
      grantee: 'anna@example.test',
    }),
  ),
];

describe('a folder is one row', () => {
  it('folds a folder and its agreeing children into a single group', () => {
    const { groups, standalone } = groupShareGrants(folderWithChildren(10));
    expect(groups).toHaveLength(1);
    expect(standalone).toHaveLength(0);
    expect(groups[0]!.label).toBe('Foto shoot Emma');
    expect(groups[0]!.grants).toEqual(['anna@example.test:writer']);
    // Eleven: the folder is a member of the group it heads, which is why a
    // folder whose every child deviates still reads as one item and not zero.
    expect(groups[0]!.items).toBe(11);
    expect(groups[0]!.containerShared).toBe(true);
    expect(groups[0]!.rowIds).toHaveLength(11);
  });

  /**
   * THE DOUBLE-RENDER. The folder must not also appear as a loose item under
   * the root: on the owner's Drive that is a share presented as unaccounted
   * for while its own contents sit under it, which is worse than the wall.
   */
  it('never renders the heading folder a second time under its own parent', () => {
    const { groups, standalone } = groupShareGrants(folderWithChildren(3));
    const mentions = [
      ...groups.flatMap((g) => g.rowIds),
      ...standalone.flatMap((s) => s.rowIds),
    ];
    expect(mentions.filter((id) => id === 'f-anna')).toHaveLength(1);
    expect(groups.map((g) => g.parentKey)).toEqual(['F']);
  });

  it('counts ITEMS, not rows — two grantees on one file is one item', () => {
    const rows = [
      ...folderWithChildren(2),
      grant({
        id: 'c0-bob',
        itemKey: 'c0',
        parentKey: 'F',
        isContainer: false,
        onLabel: 'IMG_0.jpg',
        grantee: 'bob@example.test',
      }),
    ];
    const { groups, standalone } = groupShareGrants(rows);
    // c0 now carries anna AND bob, so it no longer agrees with the folder.
    const folded = groups.find((g) => g.parentKey === 'F');
    expect(folded!.items).toBe(2); // the folder and c1
    expect(standalone.map((s) => s.label)).toEqual(['IMG_0.jpg']);
    expect(standalone[0]!.rowIds).toEqual(['c0-anna', 'c0-bob']);
  });
});

describe('what must never be folded away', () => {
  it('an EXTRA grant on a child keeps its own row, and is named', () => {
    const rows = [
      ...folderWithChildren(4),
      grant({
        id: 'c0-link',
        itemKey: 'c0',
        parentKey: 'F',
        isContainer: false,
        onLabel: 'IMG_0.jpg',
        role: 'reader',
      }),
    ];
    const { standalone } = groupShareGrants(rows);
    expect(standalone).toHaveLength(1);
    expect(standalone[0]!.reason).toBe('deviates');
    expect(standalone[0]!.extra).toEqual(['(link):reader']);
    expect(standalone[0]!.missing).toEqual([]);
    expect(standalone[0]!.comparedWith).toBe('folder');
  });

  it('a MISSING grant is a deviation too — a subset test would hide it', () => {
    const rows = folderWithChildren(3);
    // Give the folder a second grantee the children do not have.
    rows.push(
      grant({
        id: 'f-bob',
        itemKey: 'F',
        parentKey: 'root',
        isContainer: true,
        onLabel: 'Foto shoot Emma',
        grantee: 'bob@example.test',
      }),
    );
    const { groups, standalone } = groupShareGrants(rows);
    expect(groups.find((g) => g.parentKey === 'F')!.items).toBe(1); // the folder alone
    expect(standalone).toHaveLength(3);
    for (const row of standalone) {
      expect(row.reason).toBe('deviates');
      expect(row.missing).toEqual(['bob@example.test:writer']);
      expect(row.extra).toEqual([]);
    }
  });

  it('the same grantee with a different role deviates', () => {
    const rows = [
      ...folderWithChildren(2),
      grant({
        id: 'c9-anna-owner',
        itemKey: 'c9',
        parentKey: 'F',
        isContainer: false,
        onLabel: 'IMG_9.jpg',
        grantee: 'anna@example.test',
        role: 'owner',
      }),
    ];
    const { standalone } = groupShareGrants(rows);
    expect(standalone.map((s) => s.label)).toEqual(['IMG_9.jpg']);
    expect(standalone[0]!.extra).toEqual(['anna@example.test:owner']);
  });

  /**
   * HARD RULE 9. Not knowing where something sits is not the same as knowing
   * it sits with these others. A row whose source said nothing is listed on
   * its own, whatever its grants happen to look like.
   */
  it('a row the source could not place is never folded, however well it matches', () => {
    const rows = [
      ...folderWithChildren(3),
      grant({
        id: 'loose',
        itemKey: 'x1',
        onLabel: 'Somewhere.pdf',
        grantee: 'anna@example.test',
      }),
    ];
    const { groups, standalone } = groupShareGrants(rows);
    expect(groups).toHaveLength(1);
    expect(standalone).toHaveLength(1);
    expect(standalone[0]!.reason).toBe('unplaced');
    expect(standalone[0]!.label).toBe('Somewhere.pdf');
    // It matches the folder's grants exactly, and that is not a reason to fold.
    expect(standalone[0]!.grants).toEqual(['anna@example.test:writer']);
  });

  it('an item with a container but no identity of its own is unplaced too', () => {
    const { standalone } = groupShareGrants([
      grant({ id: 'r1', parentKey: 'F', onLabel: 'Nameless', grantee: 'anna@example.test' }),
    ]);
    expect(standalone).toHaveLength(1);
    expect(standalone[0]!.reason).toBe('unplaced');
  });
});

describe('nesting is one level, and says so', () => {
  /**
   * A STATED LIMIT NEEDS A GUARD. The module says a folder inside a shared
   * folder heads its own group rather than rolling up into its parent's count,
   * because a transitive count would assert that a grant on the outer folder
   * reaches a file three levels down — and the measurement behind this whole
   * design is the one that found Drive will not say what a grant is inherited
   * FROM. Two honest rows beat one confident one; this pins that it stays two.
   */
  it('a shared folder inside a shared folder is its own row, not a roll-up', () => {
    const rows = [
      grant({
        id: 'outer',
        itemKey: 'Photos',
        parentKey: 'root',
        isContainer: true,
        onLabel: 'Photos',
        grantee: 'anna@example.test',
      }),
      grant({
        id: 'inner',
        itemKey: '2023',
        parentKey: 'Photos',
        isContainer: true,
        onLabel: '2023',
        grantee: 'anna@example.test',
      }),
      ...Array.from({ length: 4 }, (_, i) =>
        grant({
          id: `deep${i}`,
          itemKey: `d${i}`,
          parentKey: '2023',
          isContainer: false,
          onLabel: `IMG_${i}.jpg`,
          grantee: 'anna@example.test',
        }),
      ),
    ];
    const { groups, standalone } = groupShareGrants(rows);
    expect(standalone).toHaveLength(0);
    expect(groups.map((g) => [g.label, g.items])).toEqual([
      ['2023', 5], // the inner folder and its four files
      ['Photos', 1], // the outer folder, counted once and NOT 6
    ]);
  });
});

describe('a comparison names its own basis', () => {
  /**
   * A folder that is not itself shared still groups its contents — that is
   * useful — but a deviation there is measured against SIBLINGS, which is a
   * weaker claim than one measured against the folder's own grants. The two
   * must not read the same on screen.
   */
  it('says `siblings` when the container is not itself shared', () => {
    const rows = [
      ...Array.from({ length: 4 }, (_, i) =>
        grant({
          id: `c${i}-anna`,
          itemKey: `c${i}`,
          parentKey: 'F',
          isContainer: false,
          onLabel: `IMG_${i}.jpg`,
          grantee: 'anna@example.test',
        }),
      ),
      grant({
        id: 'odd',
        itemKey: 'c9',
        parentKey: 'F',
        isContainer: false,
        onLabel: 'Odd.jpg',
        grantee: 'bob@example.test',
      }),
    ];
    const { groups, standalone } = groupShareGrants(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.containerShared).toBe(false);
    expect(groups[0]!.label).toBeUndefined();
    expect(groups[0]!.items).toBe(4);
    expect(standalone[0]!.comparedWith).toBe('siblings');
  });

  it('never invents a name for a container it never listed', () => {
    const { groups } = groupShareGrants([
      grant({ id: 'a', itemKey: 'c0', parentKey: 'F-unknown', grantee: 'anna@example.test' }),
    ]);
    expect(groups[0]!.label).toBeUndefined();
    expect(groups[0]!.parentKey).toBe('F-unknown');
  });
});

describe('the shape a screen can rely on', () => {
  it('orders groups by what they cover, largest first', () => {
    const rows = [
      ...Array.from({ length: 5 }, (_, i) =>
        grant({ id: `big${i}`, itemKey: `b${i}`, parentKey: 'BIG', grantee: 'anna@example.test' }),
      ),
      ...Array.from({ length: 2 }, (_, i) =>
        grant({ id: `sml${i}`, itemKey: `s${i}`, parentKey: 'SMALL', grantee: 'anna@example.test' }),
      ),
    ];
    const { groups } = groupShareGrants(rows);
    expect(groups.map((g) => [g.parentKey, g.items])).toEqual([
      ['BIG', 5],
      ['SMALL', 2],
    ]);
  });

  it('is stable whatever order the rows arrive in', () => {
    const rows = folderWithChildren(6);
    const forward = groupShareGrants(rows);
    const backward = groupShareGrants([...rows].reverse());
    expect(backward).toEqual(forward);
  });

  it('answers empty for no rows rather than throwing', () => {
    expect(groupShareGrants([])).toEqual({ groups: [], standalone: [] });
  });
});

describe('the primitives the rule is built from', () => {
  it('a link grant is named, never an empty grantee', () => {
    expect(grantSet([grant({ id: 'x', role: 'reader' })])).toEqual(['(link):reader']);
  });

  it('one grantee twice at the same role is one entry', () => {
    const twice = [
      grant({ id: 'a', grantee: 'anna@example.test', role: 'writer' }),
      grant({ id: 'b', grantee: 'anna@example.test', role: 'writer' }),
    ];
    expect(grantSet(twice)).toEqual(['anna@example.test:writer']);
  });

  it('deviation reports both directions', () => {
    expect(deviation(['a:r', 'b:w'], ['a:r', 'c:w'])).toEqual({
      deviates: true,
      extra: ['c:w'],
      missing: ['b:w'],
    });
  });

  it('identical sets do not deviate', () => {
    expect(deviation(['a:r'], ['a:r']).deviates).toBe(false);
  });
});
