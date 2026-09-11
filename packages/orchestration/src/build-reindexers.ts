// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The MANAGED edition's opener, and the reindexer map the verification gate
 * needs.
 *
 * `runVerification` reads the target through a reindexer per domain. Supplying
 * only mail (all any caller could do until the DAV writers grew `listEntries`)
 * meant calendar/contacts/files came back NOT_VERIFIABLE and blocked every
 * multi-domain cutover. This assembles all five.
 *
 * ## The loop moved out; what is left is the managed half
 *
 * The collect-and-release logic this file used to carry is now
 * `fanOutTargets` (`target-fan-out.ts`), because the appliance had its OWN copy
 * of it inside `verifyMapping` and a third was about to be written for the
 * confirmation pass. `build-reindexers.ts`'s own story is why: the task domain
 * got a source, a writer, a ledger row, a tick, a place in the report and named
 * assertions in both gates — and never a line in one of those loops, so E2E
 * #168 reported `tasks 0/4` about a target the tasks were sitting on.
 *
 * What genuinely belongs to the managed edition, and stays here, is **how a
 * domain's target is opened**: from connection ROWS, through a pg `Pool`. The
 * appliance opens the same five from its `MappingConfig` file, and now feeds
 * the same fan-out.
 *
 * A domain is included only when its target genuinely implements `listEntries`.
 * Leaving one out is the honest outcome — verification reports it as
 * unverifiable — whereas including a target that cannot enumerate would put us
 * back to measuring one domain against another's listing.
 */

import type { Pool } from 'pg';
import type { DiscoveryDomain, TargetReindexer } from '@openmig/shared';
import { DISCOVERY_DOMAINS } from '@openmig/shared';
import { buildDomainDepsFromMapping } from './build-deps-from-mapping.ts';
import {
  GATE_NAME,
  asReindexer,
  fanOutTargets,
  type OpenTarget,
  type VerificationDomain,
} from './target-fan-out.ts';

export { GATE_NAME, LEDGER_DOMAIN, type VerificationDomain } from './target-fan-out.ts';

export interface TargetReindexers {
  readonly reindexers: Partial<Record<VerificationDomain, TargetReindexer>>;
  /** Release every connection opened to build them. */
  close(): Promise<void>;
}

/**
 * THE MANAGED OPENER: one domain's target, built from its connection rows.
 *
 * Exported because it is what the managed edition hands to every fan-out —
 * verification here, and the confirmation pass in `build-confirmation-readers`
 * — so neither has to know that "managed" means a `Pool` and a mapping id.
 *
 * **The third spelling lives here and goes no further.**
 * `buildDomainDepsFromMapping` says `mail` where the ledger says `email`, and
 * the other four agree with the ledger. That is a fourth vocabulary in a
 * repository that has already paid for the gap between two of them, so it is
 * translated at this edge, through a TOTAL `Record` — a sixth domain fails to
 * compile rather than opening nothing.
 */
export function managedOpener(pool: Pool, tenantId: string, mappingId: string): OpenTarget {
  const DEPS_NAME: Readonly<Record<DiscoveryDomain, 'mail' | 'calendar' | 'contact' | 'file' | 'task'>> = {
    email: 'mail',
    calendar: 'calendar',
    contact: 'contact',
    file: 'file',
    task: 'task',
  };
  return async (domain) => {
    // Branched rather than passed through: each overload of
    // `buildDomainDepsFromMapping` accepts exactly one literal, and the union
    // is not itself one of those literals as far as overload resolution goes.
    const name = DEPS_NAME[domain];
    const deps =
      name === 'mail'
        ? await buildDomainDepsFromMapping(pool, tenantId, mappingId, 'mail')
        : name === 'calendar'
          ? await buildDomainDepsFromMapping(pool, tenantId, mappingId, 'calendar')
          : name === 'contact'
            ? await buildDomainDepsFromMapping(pool, tenantId, mappingId, 'contact')
            : name === 'file'
              ? await buildDomainDepsFromMapping(pool, tenantId, mappingId, 'file')
              : await buildDomainDepsFromMapping(pool, tenantId, mappingId, 'task');
    return { target: deps.target, close: () => deps.close() };
  };
}

/**
 * Build reindexers for every domain whose target can enumerate itself.
 *
 * Each domain's deps carry their own pool; `close()` releases all of them. A
 * domain that fails to build (no DAV connection configured for this mapping,
 * say) is omitted rather than throwing — verification then reports it
 * NOT_VERIFIABLE with the reason, which is more useful than failing the whole
 * gate before it measures the domains that DO work.
 *
 * Tries all five, unconditionally: the verification gate decides per domain
 * whether it WANTED one, and a domain it wanted but could not open has to be
 * reported NOT_VERIFIABLE rather than quietly skipped.
 *
 * The result is keyed by the GATE's spelling, because that is what
 * `runVerification` reads. The fan-out underneath speaks the ledger's, and
 * `GATE_NAME` is the only place the two meet.
 */
export async function buildTargetReindexers(
  pool: Pool,
  tenantId: string,
  mappingId: string,
): Promise<TargetReindexers> {
  const fanned = await fanOutTargets<TargetReindexer>({
    wanted: DISCOVERY_DOMAINS,
    open: managedOpener(pool, tenantId, mappingId),
    keep: (target) => asReindexer<TargetReindexer>(target),
    label: `[verification] mapping ${mappingId}:`,
  });

  const reindexers: Partial<Record<VerificationDomain, TargetReindexer>> = {};
  for (const domain of fanned.domains) {
    reindexers[GATE_NAME[domain]] = fanned.byDomain[domain];
  }
  return { reindexers, close: () => fanned.close() };
}
