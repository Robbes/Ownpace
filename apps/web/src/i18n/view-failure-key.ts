// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The same six failure categories, in the migrated person's words (0122 T4).
 *
 * ## Why this is not `FAILURE_KEY`
 *
 * `failure-key.ts` exists so the customer and the operator they phone read the
 * SAME sentence, and that argument is right for those two. It does not extend
 * to a third reader, because those sentences are addressed to somebody who can
 * act: *"Reconnect it on the Connections page"*, *"The provider's own message
 * is below"*. The person holding a progress link has no Connections page, no
 * account to reach one with, and no message below — the prose never crosses to
 * them (`viewRowFor` in `@openmig/shared`).
 *
 * Handing them a remedy they cannot perform is worse than saying less: it reads
 * as an instruction, and the only thing it can produce is a phone call that
 * starts with the wrong question.
 *
 * So these say the same FACT and point at the right person. Exhaustive by type,
 * like the map they are not, so a seventh category cannot reach this page with
 * nothing to say.
 */

import type { FailureCategory, FailureSide } from '@openmig/shared';
import type { StringKey } from './strings.ts';

export const VIEW_FAILURE_KEY: Record<FailureCategory, StringKey> = {
  auth_expired: 'view.failure.authExpired',
  rate_limited: 'view.failure.rateLimited',
  quota_exceeded: 'view.failure.quotaExceeded',
  target_refused: 'view.failure.targetRefused',
  network: 'view.failure.network',
  unknown: 'view.failure.unknown',
};

/**
 * Which side, as this reader thinks of it: their old account and their new one.
 *
 * `failure.side.*` says "the source side" and "the destination side", which are
 * the product's words for a person who has been reading the product's screens.
 * Both accounts here belong to the reader, and telling them WHICH is the single
 * most useful thing on the line.
 */
export const VIEW_SIDE_KEY: Record<FailureSide, StringKey> = {
  source: 'view.failure.side.source',
  target: 'view.failure.side.target',
};
