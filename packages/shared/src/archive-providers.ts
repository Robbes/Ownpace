// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHICH EXPORT AN ARCHIVE IS (workplan 0116 T1).
 *
 * An archive connection is one kind — `archive` — and the provider is a VALUE
 * on it, not a kind of its own. That is the whole shape of 0116 §2 expressed
 * as a vocabulary: *a third export is a new reader and nothing else*. Were
 * `google-takeout` and `apple-privacy` separate connection kinds, adding Meta
 * or Dropbox would mean a new card, a new icon, a new CHECK constraint, a new
 * branch in `sourceKindFor`, a new credential descriptor and a new refusal —
 * the eighteen-table fan-out this product knows by heart (#597). As a value it
 * is one entry here and one reader beside it.
 *
 * ## Why this lives in shared rather than beside the reader
 *
 * It was declared in `@openmig/core/archive-reader` when the seam was built
 * (T2), which was right while the only consumer was the reader. T1 gives it
 * three more: the wizard offers it, `SourceConfig` stores it, and the create
 * door refuses an unknown one. `packages/shared` has no dependencies at all
 * and everything else depends on it, so a vocabulary the web app and the
 * engine must agree on can only live here. The reader re-exports it, so
 * nothing that imported it from core has to move.
 *
 * ## The names are the EXPORT's, not the product's
 *
 * `google-takeout`, not `google-photos`; `apple-privacy`, not `apple-icloud`.
 * A Takeout archive is not a Photos archive — it is whatever the person ticked
 * on takeout.google.com, and the reader that opens it looks for the Photos
 * tree inside. Naming the value after one product inside the file would be a
 * promise the archive does not make.
 */

/** The exports this product can read. */
export const ARCHIVE_PROVIDERS = ['google-takeout', 'apple-privacy'] as const;
export type ArchiveProvider = (typeof ARCHIVE_PROVIDERS)[number];

export function isArchiveProvider(value: unknown): value is ArchiveProvider {
  return typeof value === 'string' && (ARCHIVE_PROVIDERS as ReadonlyArray<string>).includes(value);
}

/**
 * What each export is CALLED where the person went to ask for it.
 *
 * Verbatim in every language, like every other provider name in this product
 * (`PROVIDER_DISPLAY_NAMES`, the front door's card names): these are the words
 * on Google's and Apple's own pages, and a Dutch rendering of "Takeout" would
 * send somebody looking for a page that does not exist.
 */
export const ARCHIVE_PROVIDER_NAMES: Readonly<Record<ArchiveProvider, string>> = {
  'google-takeout': 'Google Takeout',
  'apple-privacy': 'Apple Data & Privacy',
};

/**
 * WHERE the person asks for each export, read from the provider's own page on
 * 2026-09-04 (0105's never-guess rule: a published value carries its source
 * and the day it was read).
 *
 * On screen beside the field, because the hardest part of an archive import is
 * not this product at all — it is the twenty minutes on somebody else's site
 * before there is anything to point us at.
 */
export const ARCHIVE_PROVIDER_ORIGINS: Readonly<Record<ArchiveProvider, string>> = {
  'google-takeout': 'https://takeout.google.com',
  'apple-privacy': 'https://privacy.apple.com',
};

export function archiveProviderName(provider: string): string {
  return isArchiveProvider(provider) ? ARCHIVE_PROVIDER_NAMES[provider] : provider;
}
