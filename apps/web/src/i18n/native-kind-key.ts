// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * What to call each Google editor type, in the reader's language.
 *
 * ONE MAP, because there are now two screens that name these: the confirm
 * screen's refused-native line ("3 Google Slides will not be copied…") and the
 * wizard's export-policy chooser, which says which kinds a format leaves behind
 * BEFORE the choice is made. A second copy is how "Google Slides" on one screen
 * becomes "Google Presentations" on the other.
 *
 * Keyed by the MIME suffix Drive uses and `migration_discovery.refused_native`
 * stores — `document`, `spreadsheet`, `presentation`, `drawing` — which is the
 * same key `@openmig/shared`'s `GoogleEditorKind` carries, so nothing has to be
 * translated between the table and the sentence.
 *
 * `other` exists for a Google product nobody has met yet: a kind that turns up
 * in a stored count with no row here still produces a sentence rather than a
 * gap. The wizard never reaches it — it iterates `GOOGLE_EDITOR_KINDS`, which
 * are exactly the four — so the fallback belongs to the confirm screen's
 * reading of whatever the ledger holds.
 */

import type { StringKey } from './strings.ts';

const NATIVE_KIND_KEY: Readonly<Record<string, StringKey>> = {
  document: 'discovery.refusedNative.kind.document',
  spreadsheet: 'discovery.refusedNative.kind.spreadsheet',
  presentation: 'discovery.refusedNative.kind.presentation',
  drawing: 'discovery.refusedNative.kind.drawing',
};

/** The string key naming this editor kind, or the catch-all for an unknown one. */
export function nativeKindKey(kind: string): StringKey {
  return NATIVE_KIND_KEY[kind] ?? 'discovery.refusedNative.kind.other';
}
