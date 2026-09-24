// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AS MANY LIVE GRANT LINKS AS THE TIER RUNS MIGRATIONS (workplan 0108 T8 (d);
 * the owner, 2026-09-24: "the Recommended"), where a link is issued.
 *
 * A grant link is a bearer credential that asks a stranger to give Google
 * access, and an organisation could mint them without end. It may now hold as
 * many that can still be used as its tier runs migrations at the same time, or
 * the operator's number for it (`grant-link-allowance.ts` in managed). A
 * progress link is never held to it: it grants nothing.
 *
 * Its own module, beside the routes rather than inside one, so the one thing
 * that has to be proved on a real database with two connections, the lock,
 * can be run there without an HTTP server around it
 * (`one-issue-at-a-time.integration.test.ts`).
 */

import { sql } from 'drizzle-orm';
import { countLiveGrantLinks, issueMappingLink } from '@openmig/ledger';
import type { PgDatabase } from '@openmig/ledger/db';
import { lastDayOf, liveGrantLinkLimit, type LiveLinkLimit } from '@openmig/managed';

/** What issuing came to: a link, or the organisation at its limit and nothing written. */
export type IssueOutcome =
  | { readonly kind: 'issued'; readonly issued: Awaited<ReturnType<typeof issueMappingLink>> }
  | { readonly kind: 'at_the_limit'; readonly live: number; readonly allowed: LiveLinkLimit };

/**
 * Mint a link in the organisation's own transaction: a grant link only while
 * the organisation holds fewer live ones than it may (0108 T8 (d)), a progress
 * link always.
 *
 * The limit is held in the transaction that writes, one issue at a time per
 * organisation: the lock is taken before the count, so a second issue waits
 * for the first to commit and then counts what it wrote. Without it, two
 * clicks at once would each count the same number and both be the last one
 * allowed. `pg_advisory_xact_lock` is released at COMMIT or ROLLBACK, which a
 * transaction pooler keeps to one connection.
 */
export async function issueWithinTheLimit(
  db: PgDatabase,
  input: Parameters<typeof issueMappingLink>[1],
): Promise<IssueOutcome> {
  if (input.purpose === 'grant') {
    await db.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`grant-links:${input.tenantId}`}, 0))`,
    );
    const live = await countLiveGrantLinks(db, input.tenantId);
    const allowed = await liveGrantLinkLimit(db, input.tenantId);
    if (live >= allowed.limit) return { kind: 'at_the_limit', live, allowed };
  }
  return { kind: 'issued', issued: await issueMappingLink(db, input) };
}

/**
 * The owner's sentence when an organisation holds as many live grant links as
 * it may (workplan 0108 T8 (d); the owner, 2026-09-24: "the Recommended"):
 * how many there are, how many it may hold and why, and what makes room. A
 * progress link is never refused by it: it grants nothing.
 */
export function atTheLimit(live: number, allowed: LiveLinkLimit): string {
  const why =
    allowed.from.kind === 'tier'
      ? `as many as its tier, ${allowed.from.tier.name}, runs migrations at the same time`
      : allowed.from.kind === 'past_the_table'
        ? 'the most any tier allows'
        : allowed.from.until
          ? `the number set for this organisation through ${lastDayOf(allowed.from.until)}`
          : 'the number set for this organisation';
  return (
    `This organisation has ${live} grant ${live === 1 ? 'link' : 'links'} that can still be used, ` +
    `and may hold ${allowed.limit} at once: ${why}. ` +
    'Revoke one that is no longer needed, or wait until one is used or expires.'
  );
}
