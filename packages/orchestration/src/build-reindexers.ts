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
export type VerificationDomain = 'mail' | 'calendar' | 'contacts' | 'files';

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

  await collect('mail', () => buildDomainDepsFromMapping(pool, tenantId, mappingId, 'mail'));
  await collect('calendar', () => buildDomainDepsFromMapping(pool, tenantId, mappingId, 'calendar'));
  await collect('contacts', () => buildDomainDepsFromMapping(pool, tenantId, mappingId, 'contact'));
  await collect('files', () => buildDomainDepsFromMapping(pool, tenantId, mappingId, 'file'));

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
