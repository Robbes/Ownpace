// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A SHARED-MAILBOX PROMISE WITH ITS PROOF (workplan 0141 T10 (a)).
 *
 * The scope manifest listed *"Shared mailboxes — Copied like any other
 * mailbox, with the same checks."* under **Migrates**, for every Microsoft
 * source. Two things were wrong with that on the day the alpha was planned:
 *
 * - **Nobody had copied one.** 0027 built Pattern S by 2026-08-04, and its
 *   live proof, one real shared mailbox read end to end, has waited ever since
 *   on the owner's consent run (0027 T0). 0028 T2/T3 and 0029 T1 wait on the
 *   same step.
 * - **The usual Microsoft card cannot read one.** The *Microsoft 365 account*
 *   button's grant is delegated: the signed-in person's own data. A shared
 *   mailbox is read as `/users/{address}`, which needs application permissions
 *   and an administrator's consent on the tenant. So a Connect-with-Microsoft
 *   tester's confirm page promised something that card cannot do.
 *
 * The owner chose, on 2026-09-25, to move the row to **Partial** until one is
 * copied (0141 T10 (a); the consent run, T10 (b), comes later and is what
 * moves it back).
 *
 * ## One authority
 *
 * Whether a shared mailbox has been copied is a verdict in `SOURCE_PROOFS`
 * (`front-door.ts`), beside the source cards' verdicts (0131 T2), and not a
 * fact this manifest keeps on its own. The chain has two links:
 *
 * 1. **This file:** the manifest row sits under *Migrates* only while that
 *    verdict is proven, and under *Partial* while it is experimental.
 * 2. **`scripts/a-proof-that-was-written-down.unit.test.ts`:** a proven
 *    verdict names a row of the feature matrix's Live proofs table, with the
 *    kind `shared-mailbox` and the face `email`, and an experimental one has
 *    none.
 *
 * Together they are 0141 T10's guard: *"Shared mailboxes" may sit under
 * `migrates` only when T1's Live proofs table has a shared-mailbox row.*
 * Moving the row back is therefore three edits in one pull request: the row,
 * the verdict, and the matrix row that records the run.
 */

import { describe, it, expect } from 'vitest';
import { SCOPE_MANIFEST, type ScopeManifest, type ScopeManifestEntry } from './scope-manifest.ts';
import { SOURCE_PROOFS, type SourceProof } from './front-door.ts';

const ITEM = 'Shared mailboxes';

const COLUMNS = ['migrates', 'partial', 'doesNotMigrate'] as const;

const rowsIn = (manifest: ScopeManifest, column: (typeof COLUMNS)[number]): ScopeManifestEntry[] =>
  manifest[column].filter((e) => e.item === ITEM);

/**
 * What is wrong with where the row sits, given the verdict: an empty list
 * when nothing. Its own function so the cases below can show it failing both
 * ways, since the real verdict only ever exercises one of them at a time.
 */
function placementProblems(manifest: ScopeManifest, proof: SourceProof | undefined): string[] {
  const problems: string[] = [];
  const [migrates, partial, doesNot] = COLUMNS.map((c) => rowsIn(manifest, c));
  const total = migrates!.length + partial!.length + doesNot!.length;
  if (total !== 1) problems.push(`"${ITEM}" appears ${total} times, not once`);
  if (proof === undefined) problems.push('the verdict table has no verdict for shared mailboxes');
  const proven = proof?.verdict === 'proven';
  if (migrates!.length > 0 && !proven) {
    problems.push('under Migrates, and no shared mailbox has been copied (its verdict is not proven)');
  }
  if (partial!.length > 0 && proven) problems.push('under Partial, and its verdict says one has been copied');
  if (doesNot!.length > 0) problems.push('under Does not migrate, and Pattern S is built');
  return problems;
}

/** The manifest with the row moved to `column`, the rest untouched. */
function withRowIn(column: (typeof COLUMNS)[number]): ScopeManifest {
  const row: ScopeManifestEntry = { item: ITEM, detail: 'A line.', appliesTo: ['microsoft'] };
  const without = (c: (typeof COLUMNS)[number]): ScopeManifestEntry[] =>
    SCOPE_MANIFEST[c].filter((e) => e.item !== ITEM);
  return {
    version: SCOPE_MANIFEST.version,
    migrates: [...without('migrates'), ...(column === 'migrates' ? [row] : [])],
    partial: [...without('partial'), ...(column === 'partial' ? [row] : [])],
    doesNotMigrate: [...without('doesNotMigrate'), ...(column === 'doesNotMigrate' ? [row] : [])],
  };
}

const PROVEN: SourceProof = { verdict: 'proven', recorded: '2026-10-01' };
const EXPERIMENTAL: SourceProof = { verdict: 'experimental' };

describe('the verdict table speaks for shared mailboxes', () => {
  it('has a verdict of its own', () => {
    expect(SOURCE_PROOFS.sharedMailbox, 'SOURCE_PROOFS has no verdict for shared mailboxes').toBeDefined();
    expect(['proven', 'experimental']).toContain(SOURCE_PROOFS.sharedMailbox.verdict);
  });
});

describe('the manifest puts the row where the verdict says', () => {
  it('"Shared mailboxes" sits under Migrates only when proven, and under Partial while experimental', () => {
    expect(placementProblems(SCOPE_MANIFEST, SOURCE_PROOFS.sharedMailbox)).toEqual([]);
  });

  it.each([
    ['under Migrates while experimental', 'migrates', EXPERIMENTAL, 'under Migrates'],
    ['under Partial once proven', 'partial', PROVEN, 'under Partial'],
    ['under Does not migrate', 'doesNotMigrate', EXPERIMENTAL, 'under Does not migrate'],
  ] as const)('refuses the row %s', (_what, column, proof, problem) => {
    expect(placementProblems(withRowIn(column), proof).join('; ')).toContain(problem);
  });

  it.each([
    ['under Partial while experimental', 'partial', EXPERIMENTAL],
    ['under Migrates once proven', 'migrates', PROVEN],
  ] as const)('accepts the row %s', (_what, column, proof) => {
    expect(placementProblems(withRowIn(column), proof)).toEqual([]);
  });

  it('refuses a manifest with no row, or two', () => {
    const none: ScopeManifest = { ...withRowIn('partial'), partial: withRowIn('migrates').partial };
    expect(placementProblems(none, EXPERIMENTAL)).toContain(`"${ITEM}" appears 0 times, not once`);
    const two = withRowIn('partial');
    const twice: ScopeManifest = { ...two, partial: [...two.partial, ...rowsIn(two, 'partial')] };
    expect(placementProblems(twice, EXPERIMENTAL)).toContain(`"${ITEM}" appears 2 times, not once`);
  });
});

describe('while no shared mailbox has been copied, the row says why', () => {
  const row = (): ScopeManifestEntry | undefined =>
    [...SCOPE_MANIFEST.migrates, ...SCOPE_MANIFEST.partial].find((e) => e.item === ITEM);

  it('is shown to Microsoft sources only', () => {
    expect(row()?.appliesTo).toEqual(['microsoft']);
  });

  it('the line says none has been copied yet', () => {
    if (SOURCE_PROOFS.sharedMailbox?.verdict === 'proven') return;
    expect(row()?.detail ?? '').toMatch(/not yet copied/i);
  });

  it('the fold says the Microsoft 365 account button reads only its own mailbox', () => {
    if (SOURCE_PROOFS.sharedMailbox?.verdict === 'proven') return;
    const more = row()?.more ?? '';
    expect(more).toMatch(/Microsoft 365 account/);
    expect(more).toMatch(/own mailbox/i);
  });
});
