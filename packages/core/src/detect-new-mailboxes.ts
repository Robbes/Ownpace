// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The first drift detector: a mailbox exists that no mapping covers
 * (workplan 0028 T2).
 *
 * The decision queue has been plumbed end to end since 0028 T1 and nothing has
 * ever raised a decision into it — which is why the screen's empty state says
 * "not watched yet" rather than "no changes". This is what starts watching.
 *
 * THE RULE THAT MATTERS MOST IS THE REFUSAL. A source that cannot enumerate a
 * directory — every IMAP source, and a Graph source without application
 * permissions — must report that it could not look. An empty list from a
 * source that never looked is indistinguishable from a tenant where nothing
 * changed, and the difference is the entire value of this feature: one means
 * "you are covered", the other means "you are not watching". Hard rule 9, and
 * the reason `DirectoryListing` is a union rather than an array.
 *
 * Everything here is a pure function of its inputs. The Graph call, the ledger
 * write and the schedule live outside; what is testable without any of them is
 * the part with the judgement in it — what counts as covered, what a new
 * mailbox is worth saying, and what to do when the answer is "I don't know".
 */

import type { RaiseDecisionInput, TenantId, DirectoryListing } from '@openmig/shared';

export type { DirectoryListing };

/** A mailbox this migration already covers. */
export interface CoveredMailbox {
  /** The source address a mapping reads. Compared case-insensitively. */
  readonly address: string;
}

export interface DetectInput {
  readonly tenantId: TenantId;
  readonly listing: DirectoryListing;
  /** Every address already covered by a mapping in this tenant. */
  readonly covered: readonly CoveredMailbox[];
  /**
   * Addresses the owner has already answered about and does not want raised
   * again — dismissed subjects. Without this the queue re-asks a question the
   * owner has closed every time the detector runs.
   */
  readonly dismissed?: readonly string[];
  /**
   * Why `covered` is INCOMPLETE, when it is (see `mapping-coverage.ts`).
   *
   * Present means at least one mapping does not state which mailbox it
   * covers, so anything this function would call "uncovered" might in fact be
   * covered by that mapping. Raising in that state produces a decision about
   * a mailbox the owner already set up migrating — which teaches them the
   * queue is wrong, and a queue believed to be wrong is worse than no queue.
   * So it raises nothing and reports the reason instead.
   */
  readonly coverageIncomplete?: string;
}

export interface DetectResult {
  /** Decisions to raise. Empty when everything is covered — or when nothing was looked at. */
  readonly decisions: readonly RaiseDecisionInput[];
  /**
   * Present when the directory could not be read. The caller must surface it
   * (a log line at minimum) rather than treating an empty `decisions` as
   * "nothing to do" — that is the same lie in a different shape.
   */
  readonly blindSpot?: string;
}

/** Addresses are compared case-insensitively; mail addresses are not case-sensitive in practice. */
const norm = (address: string): string => address.trim().toLowerCase();

/**
 * Compare the directory against what is covered, and produce the decisions.
 *
 * Idempotent by construction: the subject key is the address, and the store's
 * partial unique index means raising the same pending subject twice returns
 * the existing row. A detector that runs every hour converges on the same
 * pending set rather than growing it (rule 1).
 */
export function detectNewMailboxes(input: DetectInput): DetectResult {
  if (input.listing.kind === 'not_enumerable') {
    // No decisions AND a stated reason. A caller that ignores the second half
    // has turned "I could not look" into "nothing needs attention".
    return { decisions: [], blindSpot: input.listing.reason };
  }

  // The second blind spot, and the subtler one: the directory READ fine, but
  // we cannot say what is already covered. Being wrong here is worse than
  // being silent — see the field's comment.
  if (input.coverageIncomplete) {
    return { decisions: [], blindSpot: input.coverageIncomplete };
  }

  const covered = new Set(input.covered.map((m) => norm(m.address)));
  const dismissed = new Set((input.dismissed ?? []).map(norm));
  const seen = new Set<string>();
  const decisions: RaiseDecisionInput[] = [];

  for (const raw of input.listing.addresses) {
    const address = norm(raw);
    // An empty entry is not a mailbox; a directory that returns one is
    // malformed, and raising a decision about "" helps nobody.
    if (address === '') continue;
    if (covered.has(address)) continue;
    if (dismissed.has(address)) continue;
    // A directory that lists the same address twice (an alias, a paging
    // overlap) must not produce two decisions about it.
    if (seen.has(address)) continue;
    seen.add(address);

    decisions.push({
      tenantId: input.tenantId,
      category: 'new_mailbox',
      // The address itself, so re-detection is idempotent at the database.
      subjectKey: address,
      // The owner's own words are not available here — this is the server's
      // sentence, and it is what the screen and the email will both show
      // verbatim. Say what was found and what it means, not what to click.
      summary:
        `${raw.trim()} exists on the source and no migration covers it. ` +
        'Nothing is being copied from it.',
      detail: { address: raw.trim() },
      proposedDefault: 'Create a mapping for this mailbox',
    });
  }

  return { decisions };
}
