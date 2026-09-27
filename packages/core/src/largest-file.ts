// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A FILE NO PASS CAN CARRY (workplan 0143 T4 (a), the alpha minimum).
 *
 * A managed pass runs for at most an hour (`PASS_HARD_LIMIT_MS`), and a file
 * is copied in one go: there is no resume from an offset (0120). A file that
 * takes longer than a pass to move is killed with the pass, and the next pass
 * starts it again from its first byte, every pass. So a managed deployment
 * states the largest file it copies, and a listed file above it is refused
 * before a byte is read: no download starts, and no daily byte meter is spent
 * on it.
 *
 * The refusal is a decision, not an error: it is parked on first sight for a
 * person, and never retried, because trying again gives the same answer. Its
 * category is `too_large`, stated here, whose remedy says to copy the file by
 * hand (the owner's choice of 2026-09-27).
 *
 * The appliance passes no limit and refuses nothing: no runner kills its
 * passes.
 */

import { markNeedsDecision, withFailureCategory } from '@openmig/shared';

const MB = 1024 * 1024;
const GB = 1024 * MB;

/** A size as a file manager writes it: one decimal, in GB from one gigabyte up. */
export function sizeText(bytes: number): string {
  return bytes >= GB ? `${(bytes / GB).toFixed(1)} GB` : `${(bytes / MB).toFixed(1)} MB`;
}

/** The limit as it was set: whole gigabytes where it is some, else megabytes. */
function limitText(bytes: number): string {
  if (bytes % GB === 0) return `${bytes / GB} GB`;
  if (bytes % MB === 0) return `${bytes / MB} MB`;
  return sizeText(bytes);
}

/**
 * The refusal for one listed file: which file and how large, the limit and
 * why, that nothing happened, and what to do. The sentence is 0143 T4's draft,
 * for 0144 to match.
 */
export function fileTooLarge(path: string, sizeBytes: number, limitBytes: number): Error {
  const error = new Error(
    `${path} is ${sizeText(sizeBytes)}. During the alpha this service copies files up to ` +
      `${limitText(limitBytes)}, because a larger file can take longer than one pass may run. ` +
      'Nothing was copied and nothing was changed; every other file continues. Copy this one by hand.',
  );
  error.name = 'FileTooLarge';
  markNeedsDecision(error);
  return withFailureCategory('too_large', error);
}
