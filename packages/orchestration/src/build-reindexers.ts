// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Build the per-domain `TargetReindexer` map the verification gate needs.
 *
 * `runVerification` reads the target through a reindexer per domain. Supplying
 * only mail (all any caller could do until the DAV writers grew `listEntries`)
 * meant calendar/contacts/files came back NOT_VERIFIABLE and blocked every
 * multi-domain cutover. This assembles all four.
 *
 * A domain is included only when its target genuinely implements `listEntries`.
 * Leaving one out is the honest outcome — verification reports it as
 * unverifiable — whereas including a target that cannot enumerate would put us
 * back to measuring one domain against another's listing.
 */

import type { Pool } from 'pg';
import type { TargetReindexer } from '@openmig/shared';
import { buildDomainDepsFromMapping } from './build-deps-from-mapping.ts';
import { log } from '@openmig/shared';

/** Domains the verification gate knows about. */
export type VerificationDomain = 'mail' | 'calendar' | 'contacts' | 'files' | 'tasks';

export interface TargetReindexers {
  readonly reindexers: Partial<Record<VerificationDomain, TargetReindexer>>;
  /** Release every connection opened to build them. */
  close(): Promise<void>;
}

/** Does this target expose the reindex contract? */
function asReindexer(target: unknown): TargetReindexer | undefined {
  const candidate = target as { listEntries?: unknown } | null | undefined;
  return typeof candidate?.listEntries === 'function' ? (candidate as TargetReindexer) : undefined;
}

/**
 * Build reindexers for every domain whose target can enumerate itself.
 *
 * Each domain's deps carry their own pool; `close()` releases all of them. A
 * domain that fails to build (no DAV connection configured for this mapping,
 * say) is omitted rather than throwing — verification then reports it
 * NOT_VERIFIABLE with the reason, which is more useful than failing the whole
 * gate before it measures the domains that DO work.
 */
export async function buildTargetReindexers(
  pool: Pool,
  tenantId: string,
  mappingId: string,
): Promise<TargetReindexers> {
  const reindexers: Partial<Record<VerificationDomain, TargetReindexer>> = {};
  const closers: Array<() => Promise<void>> = [];

  /** Build one domain's deps, keeping it if its target can enumerate itself. */
  const collect = async (
    domain: VerificationDomain,
    build: () => Promise<{ target: unknown; close(): Promise<void> }>,
  ): Promise<void> => {
    let deps: { target: unknown; close(): Promise<void> };
    try {
      deps = await build();
    } catch (err) {
      log.warn(
        `[verification] no ${domain} target for mapping ${mappingId}: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }

    const reindexer = asReindexer(deps.target);
    if (!reindexer) {
      // Built fine but cannot enumerate — release it again rather than hold a
      // connection open for a domain we will report as unverifiable anyway.
      await deps.close();
      return;
    }
    reindexers[domain] = reindexer;
    closers.push(() => deps.close());
  };

  // ONE LINE PER VERIFICATION DOMAIN, and `tasks` was missing from this list
  // until 2026-09-09 — the SEVENTH place workplan 0113's fan-out had to reach,
  // and the last one anybody found. The task domain got a source (T3b), a
  // writer (T4), a ledger row and a tick (T5, T2), a place in the report's
  // domain list (#750) and a named assertion in both gates — and never a
  // target reindexer here. Nothing failed: `reindexerFor('tasks')` returned
  // undefined, `canVerifyTarget` said no, and verification reported the domain
  // NOT_VERIFIABLE with `targetCount: 0` — an ERROR nobody read, because the
  // managed gate's own floor check only landed on 2026-09-07 and the race it
  // then measured hid this behind a louder failure until 2026-09-09.
  //
  // E2E (managed) #168 is where it finally showed alone: calendar 2/85,
  // contacts 2/8, files 68/71 all measured, and `tasks 0/4` on a run whose own
  // log says "the task lane landed — 2 VTODO row(s) copied" four minutes
  // earlier. The tasks WERE on the target. Nothing was ever asked to look.
  //
  // The ledger spelling is `task` and the report's is `tasks`, which is the
  // trap the other three already carry (`contacts`/`contact`,
  // `files`/`file`) — four vocabularies, flagged on #746 and still four.
  await collect('mail', () => buildDomainDepsFromMapping(pool, tenantId, mappingId, 'mail'));
  await collect('calendar', () => buildDomainDepsFromMapping(pool, tenantId, mappingId, 'calendar'));
  await collect('contacts', () => buildDomainDepsFromMapping(pool, tenantId, mappingId, 'contact'));
  await collect('files', () => buildDomainDepsFromMapping(pool, tenantId, mappingId, 'file'));
  await collect('tasks', () => buildDomainDepsFromMapping(pool, tenantId, mappingId, 'task'));

  return {
    reindexers,
    async close() {
      // Close them all even if one throws; a failed release must not strand the rest.
      const results = await Promise.allSettled(closers.map((c) => c()));
      const failed = results.find((r) => r.status === 'rejected');
      if (failed && failed.status === 'rejected') throw failed.reason;
    },
  };
}
