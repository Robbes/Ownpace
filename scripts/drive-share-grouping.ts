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
 * Whether a child's grants are exactly its folder's — §5's fallback rule for
 * presumed inheritance, and the rule that decides what gets its own row.
 *
 * EXACTLY, in both directions. A child MISSING one of the folder's grants is as
 * much a deviation as one carrying an extra: "this file inside a shared folder
 * is not actually shared with everyone the folder is" is a thing somebody needs
 * before a cutover, and a subset test would report it as inherited.
 */
export function deviation(
  folderGrants: readonly string[],
  childGrants: readonly string[],
): { readonly deviates: boolean; readonly extra: string[]; readonly missing: string[] } {
  const folder = new Set(folderGrants);
  const child = new Set(childGrants);
  const extra = [...child].filter((g) => !folder.has(g)).sort();
  const missing = [...folder].filter((g) => !child.has(g)).sort();
  return { deviates: extra.length > 0 || missing.length > 0, extra, missing };
}

export type InheritanceVerdict = 'reported' | 'absent' | 'not-requestable';

/**
 * What this run learned, in the three answers §5 needs told apart.
 *
 * A REFUSAL WINS over an absence, and the order matters: a run where the
 * endpoint refused AND nothing came back inline has not established that Drive
 * has no answer — it has established that we asked wrongly. Reading that as
 * `absent` would pick §5's fallback design on the strength of our own bug.
 */
export function inheritanceVerdict(observed: {
  readonly inlineDetails: number;
  readonly endpointDetails: number;
  readonly endpointRefused: boolean;
}): InheritanceVerdict {
  if (observed.inlineDetails > 0 || observed.endpointDetails > 0) return 'reported';
  if (observed.endpointRefused) return 'not-requestable';
  return 'absent';
}
