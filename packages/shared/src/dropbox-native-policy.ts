// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE FORMAT A DROPBOX PAPER DOC ARRIVES IN (workplan 0150 T3 (a); the owner,
 * 2026-09-28: "yes, paper export before the alpha").
 *
 * Dropbox hands a Paper doc over only through `files/export`, in one of the
 * formats it offers for the file. A migration chooses one for its Paper docs,
 * or leaves them refused by name (D1). The values are Dropbox's own
 * `export_format` strings, which rclone sends too. Markdown opens in
 * Nextcloud's Text app, and is the one the wizard suggests.
 *
 * The setting rides the key Drive's does, `nativeFilePolicies`, with a
 * `paper` kind (D7): one key, one panel, one revision rule. Drive's four kinds
 * and Dropbox's one never meet on a migration, since a migration has one
 * source.
 */

export const DROPBOX_PAPER_FORMATS = ['markdown', 'html'] as const;

/** A format a Paper doc can arrive in. */
export type DropboxPaperFormat = (typeof DROPBOX_PAPER_FORMATS)[number];

/** What a migration says about its Paper docs: a format, or `refuse`, the default (D1). */
export type DropboxPaperPolicy = DropboxPaperFormat | 'refuse';

/** Every policy, `refuse` first. */
export const DROPBOX_PAPER_POLICIES: ReadonlyArray<DropboxPaperPolicy> = ['refuse', ...DROPBOX_PAPER_FORMATS];

/** The kinds a Dropbox migration chooses a format for: Paper docs and templates alike. */
export const DROPBOX_NATIVE_KINDS = ['paper'] as const;

/** A Dropbox migration's formats per kind, under the key Drive's use (D7). */
export type DropboxNativeFilePolicies = Readonly<{ paper?: DropboxPaperPolicy }>;

export function isDropboxPaperPolicy(value: unknown): value is DropboxPaperPolicy {
  return typeof value === 'string' && (DROPBOX_PAPER_POLICIES as ReadonlyArray<string>).includes(value);
}
