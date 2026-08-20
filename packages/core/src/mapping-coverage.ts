// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Which mailboxes a tenant's mappings already cover (workplan 0028 T2).
 *
 * The drift detector answers "is there a mailbox nobody is migrating?", and
 * that question is only as good as its idea of what IS being migrated. Get
 * this wrong in the generous direction and the detector stays quiet about a
 * genuinely unmigrated mailbox; get it wrong in the other direction and it
 * announces a mailbox somebody is already migrating, which is worse — the
 * owner opens the queue, sees a decision about a mailbox they set up
 * themselves, and stops trusting the queue.
 *
 * Two of the three source kinds state their address plainly:
 *
 *  - `imap-oauth2` carries `user`, which IS the mailbox address;
 *  - a Graph source with `mailbox` names the mailbox explicitly (0027 T0).
 *
 * The third does not. A Graph source WITHOUT `mailbox` reads `/me` — whoever
 * the stored credentials belong to — and the mapping file never records who
 * that is. We cannot resolve it without spending a Graph call on every
 * mapping, and a wrong guess produces exactly the false decision described
 * above.
 *
 * So it is reported as UNSTATED rather than assumed. The caller's job is to
 * refuse to draw conclusions while any mapping is unstated, and to say why —
 * the fix is one line in the mapping file, and naming it beats a queue that
 * quietly reports a mailbox the owner already handled.
 */

import type { MappingConfig } from '@openmig/shared';

export interface Coverage {
  /** Addresses this tenant demonstrably migrates already. Lower-cased. */
  readonly addresses: readonly string[];
  /**
   * Mapping ids that do not state which mailbox they cover. Non-empty means
   * `addresses` is INCOMPLETE and must not be treated as the whole truth.
   */
  readonly unstated: readonly string[];
}

/** What a mapping needs to expose for its coverage to be resolvable. */
export interface CoverableMapping {
  readonly mappingId: string;
  readonly source: MappingConfig['source'];
}

/** Resolve what a tenant's mappings cover, and what could not be resolved. */
export function resolveCoverage(mappings: readonly CoverableMapping[]): Coverage {
  const addresses: string[] = [];
  const unstated: string[] = [];

  for (const mapping of mappings) {
    const source = mapping.source;

    if (source.type === 'imap-oauth2') {
      // The IMAP user IS the mailbox — there is nothing else it could be.
      addresses.push(source.user.trim().toLowerCase());
      continue;
    }

    if (
      source.type === 'graph-mail' ||
      source.type === 'graph-calendar' ||
      source.type === 'graph-contacts'
    ) {
      const named = (source as { mailbox?: string }).mailbox?.trim();
      if (named) {
        addresses.push(named.toLowerCase());
      } else {
        // Delegated `/me`. Resolvable only by asking Graph who the token
        // belongs to, which this function deliberately does not do — it is
        // pure, and a per-mapping network call to answer a bookkeeping
        // question is the wrong shape.
        unstated.push(mapping.mappingId);
      }
      continue;
    }

    // A DAV or file source is not a mailbox and cannot be "a new mailbox"
    // either, so it neither covers an address nor leaves one unstated.
  }

  return { addresses: [...new Set(addresses)], unstated };
}

/**
 * The sentence to report when coverage is incomplete.
 *
 * Names the mappings and the one-line fix, because "detection is degraded"
 * without a remedy is a message an operator can only file away.
 */
export function coverageIncompleteReason(unstated: readonly string[]): string {
  const which = unstated.join(', ');
  return (
    `${unstated.length} mapping(s) do not state which mailbox they cover (${which}). ` +
    'They read the signed-in user (/me), and this migration cannot tell which address ' +
    'that is without asking Graph per mapping. New mailboxes are therefore NOT being ' +
    'reported for this tenant — reporting them anyway would risk raising a decision ' +
    'about a mailbox one of these mappings already migrates. Add `mailbox` to each ' +
    "mapping's source config to turn detection back on."
  );
}
