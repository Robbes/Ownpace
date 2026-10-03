// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Whose data a migration reads, for deciding what its owner's pages may show
 * (ADR-0035 decision 5, the owner's option C of 2026-10-03).
 *
 * A migration whose source a PERSON granted through their own link holds that
 * person's credential, never the organisation's (decision 4): its
 * `source_secret_ref` is set by the grant (`grant-ending.ts`,
 * `person-grant-ending.ts`) and only there. A grant taken back clears it and
 * stamps `grant_withdrawn_at`, and the failures recorded while it held are
 * still that person's, so a withdrawal keeps the migration theirs.
 *
 * For such a migration the provider's text and the items' names can name the
 * person's folders and files, so the owner's pages show the category, the side
 * and a reference instead. An account the organisation connected itself, the
 * owner's own included, shows everything, as before.
 */
export function readsAPersonsGrant(mapping: {
  readonly sourceSecretRef: string | null;
  readonly grantWithdrawnAt: Date | null;
}): boolean {
  return mapping.sourceSecretRef !== null || mapping.grantWithdrawnAt !== null;
}
