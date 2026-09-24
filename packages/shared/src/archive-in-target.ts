// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN EXPORT READ FROM THE DESTINATION'S OWN FILES (workplan 0148 T9, D11).
 *
 * An archive's `where: 'target'` (0116 T4) says the export is in a folder of
 * the files this migration writes to, and the reader opens it there by asking
 * for byte ranges of each file: PROPFIND to see what is there, GET with
 * `Range` for the bytes. Which destinations can serve that is one rule, and it
 * lives here because two doors ask it: the wizard's target step, which says
 * so while the person is choosing, and the API's create door, which refuses
 * any other client in the same words. Both editions read it (hard rule 5).
 *
 * Three answers, from the engines rather than from a product list:
 *
 *  - a destination whose file face is WebDAV — `webdav`, and `nextcloud`,
 *    whose files are WebDAV under `files/{username}/` — can serve it. Nothing
 *    here asks which product answers the URL (owner, 2026-09-20: *"we do
 *    however have to anticipate people might have other targets then
 *    nextcloud for files or photo's"*);
 *  - a `jmap` destination carries files, but this product writes them over
 *    JMAP, which has no byte ranges. It is refused with the sentence the pass
 *    itself has always thrown (`archiveStoreInTarget`), moved here so that the
 *    door and the pass say one thing;
 *  - every other destination has no file face at all (`TARGET_TYPE_DOMAINS`
 *    gives it no `file`), so there is no folder of its files to name.
 *
 * The sentences are refusals, so they render as served and stay English
 * (`docs/i18n-prose-boundary.md`), like `targetDomainRefusal` beside them.
 */

import { TARGET_TYPE_DOMAINS, targetTypeName, type WizardTargetType } from './target-domains.ts';

/**
 * The destinations an export can be read from: those that carry files, less
 * the one whose files are written over JMAP. Derived from the table, so a
 * new file-carrying target is judged here the day it is declared there.
 */
export const ARCHIVE_READABLE_TARGETS: ReadonlyArray<WizardTargetType> = (
  Object.keys(TARGET_TYPE_DOMAINS) as WizardTargetType[]
).filter((type) => TARGET_TYPE_DOMAINS[type].includes('file') && type !== 'jmap');

/**
 * Why an export cannot be read from a JMAP destination's files.
 *
 * `targetKind` is the connection kind the pass has in hand (`jmap` in every
 * case today), named so the person can tell which account is meant. Moved
 * here from `archiveStoreInTarget` in 0148 T9, word for word.
 */
export function archiveInJmapTargetSentence(targetKind: string): string {
  return (
    `This migration's file target is a ${targetKind} account, which this product writes to over ` +
    'JMAP — and an archive is read by asking for byte ranges of a file, which JMAP does not ' +
    'offer. Nothing is wrong with the export: either point this archive at a path on the ' +
    'machine running the pass, or give the migration a file target that speaks WebDAV.'
  );
}

/**
 * The refusal for an export said to be in the files of a destination of this
 * type, or `null` when that destination can serve it.
 */
export function archiveInTargetRefusal(targetType: WizardTargetType): string | null {
  if (ARCHIVE_READABLE_TARGETS.includes(targetType)) return null;
  if (targetType === 'jmap') return archiveInJmapTargetSentence(targetType);
  const readable = ARCHIVE_READABLE_TARGETS.map(targetTypeName).join(' or a ');
  return (
    `This export is to be read from a folder in the destination's files, and a ` +
    `${targetTypeName(targetType)} destination has no files. A ${readable} destination has ` +
    'them: choose one of those as the destination, and put the export in a folder of its files.'
  );
}
