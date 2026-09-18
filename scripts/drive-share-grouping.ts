// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The pure half of `drive-share-inheritance.ts` (workplan 0123 T4).
 *
 * Factored out for the reason `drive-export-verdict.ts` is: the script itself
 * cannot be tested — Google Drive cannot be containerised — but the two things
 * it must not get wrong are decisions over data, and those can be.
 *
 *  1. **The three-way verdict.** Hard rule 9: "I could not look" and "there is
 *     nothing" must never look the same. Drive documents `permissionDetails`
 *     for shared-drive items, so on a My Drive file the field coming back empty
 *     and the request being refused for naming it mean opposite things — the
 *     first is an answer that picks §5's fallback design, the second is our own
 *     bug and picks nothing.
 *  2. **The pseudonyms.** The script prints its findings for a person to paste
 *     into a workplan, and the question it answers is "is this grant
 *     inherited", which no grantee's address helps with. So addresses are
 *     reduced to stable per-run pseudonyms: grant SETS stay comparable by eye
 *     and nobody's colleagues end up in an issue.
 */

/** One Drive permission, narrowed to what the grouping question needs. */
export interface SharePermission {
  readonly id?: string;
  readonly type?: string;
  readonly role?: string;
  readonly emailAddress?: string;
  readonly domain?: string;
  readonly permissionDetails?: ReadonlyArray<{
    readonly permissionType?: string;
    readonly inherited?: boolean;
    readonly inheritedFrom?: string;
    readonly role?: string;
  }>;
}

/**
 * A fresh pseudonymiser. NOT module-level state: two runs in one process must
 * not share a numbering, and a test that shared one with its neighbour would
 * pass or fail depending on the order vitest picked.
 *
 * `anyone` keeps its real name — it identifies nobody, and calling it
 * `person-3` would hide the one grant that means "the whole internet".
 */
export function pseudonymiser(): (p: SharePermission) => string {
  const seen = new Map<string, string>();
  const counts = { person: 0, domain: 0 };
  return (p) => {
    if (p.type === 'anyone') return 'anyone';
    const real = p.emailAddress ?? p.domain ?? p.id ?? 'unknown';
    const kind = p.type === 'domain' ? 'domain' : 'person';
    const existing = seen.get(real);
    if (existing) return existing;
    counts[kind] += 1;
    const name = `${kind}-${counts[kind]}`;
    seen.set(real, name);
    return name;
  };
}

/**
 * One item's grants, sorted, as the strings the comparison is done on.
 *
 * The ROLE is part of the grant: a child that the folder's reader can also
 * WRITE to is a deviation, and comparing grantees alone would fold it away —
 * which is precisely the finding §5 says must never be folded.
 */
export function grantSet(
  permissions: readonly SharePermission[],
  grantee: (p: SharePermission) => string,
): string[] {
  return permissions.map((p) => `${grantee(p)}:${p.role ?? '?'}`).sort();
}

/**
 * Whether a child's grants are exactly its folder's — the rule that decides
 * what gets its own row.
 *
 * RE-EXPORTED, NOT RE-IMPLEMENTED. This started life here because the
 * measurement needed it before the product did. The product now has it, in
 * `@openmig/shared`, where `groupShareGrants` folds a real sharing queue on
 * exactly this comparison — and two copies of a rule about what may be hidden
 * from somebody before a cutover is one copy too many. A measurement that
 * disagreed with the shipped grouping would be measuring the wrong thing.
 *
 * EXACTLY, in both directions, and role included: see the shared module's own
 * header for why a MISSING grant is as much a finding as an extra one.
 */
export { deviation } from '@openmig/shared';

export type InheritanceVerdict =
  | 'reported'
  | 'reported-without-source'
  | 'absent'
  | 'not-requestable';

/**
 * What this run learned, in the answers §5 needs told apart.
 *
 * A VERDICT THAT CHECKED THE WRONG FIELD. This returned `reported` — the
 * answer that picks §5's first design, "group children under the folder they
 * inherit FROM" — on nothing more than `permissionDetails` being present. That
 * is the wrong evidence for that design: `inherited` is a BOOLEAN, and the
 * field naming the folder is `inheritedFrom`. Drive can answer the first and
 * withhold the second, and on the owner's Drive (2026-09-18, 10 children of a
 * shared folder) it did exactly that — 10/10 carried `permissionDetails`, and
 * not one carried `inheritedFrom`, though the request named it. So the
 * measurement recommended a design whose grouping key it had just watched Drive
 * decline to supply, and said so in the same sentence it reported the fact in.
 *
 * Hence the split. Knowing a grant is inherited is worth having — it confirms a
 * grouping. It is not the same capability as knowing what it is inherited from,
 * which is the one that would let inheritance BE the grouping, and only the
 * second opens the first design.
 *
 * A REFUSAL STILL WINS over an absence, and the order still matters: a run
 * where the endpoint refused AND nothing came back inline has not established
 * that Drive has no answer — it has established that we asked wrongly. Reading
 * that as `absent` would pick a design on the strength of our own bug.
 */
export function inheritanceVerdict(observed: {
  readonly inlineDetails: number;
  readonly endpointDetails: number;
  /**
   * How many items carried a usable `inheritedFrom`. Counted SEPARATELY from
   * the details above, because that is the whole point: the two numbers
   * disagreeing is the finding, and one field standing in for the other is the
   * defect this parameter exists to make impossible.
   */
  readonly sourcedDetails: number;
  readonly endpointRefused: boolean;
}): InheritanceVerdict {
  if (observed.inlineDetails > 0 || observed.endpointDetails > 0) {
    return observed.sourcedDetails > 0 ? 'reported' : 'reported-without-source';
  }
  if (observed.endpointRefused) return 'not-requestable';
  return 'absent';
}
