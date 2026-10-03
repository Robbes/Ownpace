// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE TARGET FOLDER IS NOT THERE (workplan 0156 T2).
 *
 * The owner deleted a migration's target folder on Nextcloud, `/Microsoft-Rhb`,
 * and ran a verification. The listing's first PROPFIND, on the folder itself,
 * answered 404, the listing threw a plain error that named `/` (its path is
 * relative to the folder), and the verification ended with *"De verificatie
 * is niet voltooid"* for every data type, mail and calendars included.
 *
 * A 404 on the folder a listing STARTS from is not a failure to read: it is a
 * definite answer, the same one a 404 gives everywhere else in the writer
 * (*"404 is a confident NO"*). Nothing is in a folder that does not exist. So
 * the listing says it as this error, which names the folder as the server
 * knows it, and a reader that understands it reports it as the finding it is.
 * It is still thrown, never turned into an empty listing: hard rule 9, and a
 * reader that does not know this error still fails loudly with the server's
 * own words in the message.
 *
 * Recognised by a tag rather than `instanceof`, like `withFailureCategory`:
 * the writer and the reader are in different packages, and a tag survives a
 * second copy of this module where a class identity does not.
 */

const TAG = Symbol.for('ownpace.target-folder-missing');

/** A listing's own folder answered 404: the folder does not exist on the target. */
export class TargetFolderMissingError extends Error {
  /** The folder as the server addresses it, with a leading slash: `/Microsoft-Rhb`. */
  readonly folder: string;

  constructor(folder: string, serverSaid: string) {
    super(`The folder ${folder} does not exist on the target (${serverSaid})`);
    this.name = 'TargetFolderMissingError';
    this.folder = folder;
    Object.defineProperty(this, TAG, { value: true, enumerable: false });
  }
}

/** True for a listing that found its own folder missing, whichever copy of this module threw it. */
export function isTargetFolderMissing(error: unknown): error is TargetFolderMissingError {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as Record<symbol, unknown>)[TAG] === true &&
    typeof (error as { folder?: unknown }).folder === 'string'
  );
}
