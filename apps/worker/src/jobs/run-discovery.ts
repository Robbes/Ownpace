// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Discovery Job (workplan 0013 T3, managed edition)
 *
 * Read-only, body-free pre-sync counts per domain, persisted to migration_discovery so the wizard
 * can show them before the owner green-lights the migration. Enqueued on demand from the API
 * (POST /api/migrations/:id/discover). Builds each domain's source from the DB
 * (`buildDomainDepsFromMapping`, on this job's pool) and writes counts inside `withTenant`. Both run
 * as `app_user`, on the tenant pool `openTaskPools` builds from `APP_DATABASE_URL`, so row security
 * binds them as well as each query's own tenant filter (docs/rls-guide.md, "Where row security holds
 * today"; workplan 0138 T1).
 *
 * Trigger: manual (API-initiated).
 */

// The rule for a host a tenant gives us, on before this run connects anywhere (0136 T1).
import './refuse-internal-addresses.ts';
import { z } from 'zod';
import { schemaTask, queue } from '@trigger.dev/sdk';
import { leavesAReference, outcomesForThePlane } from './what-a-run-leaves.ts';
import type { Pool } from 'pg';
import { discoverSource } from '@openmig/core';
import type {
  DiscoveryStore,
  DiscoveryDomain,
  TenantId,
  MappingId,
} from '@openmig/shared';
import { withTenant, PgDiscoveryStore } from '@openmig/ledger';
import { buildDomainDepsFromMapping } from '@openmig/orchestration/build-deps-from-mapping';
import { discoverDomains, type DomainDiscoveryTask } from '@openmig/orchestration/discovery';
import { enabledDomains } from '@openmig/orchestration/enabled-domains';
import { DISCOVERY_DOMAINS, log } from '@openmig/shared';
import { openTaskPools } from './task-pools.ts';

/**
 * The sync domains, from the one list (workplan 0113 T5).
 *
 * Written out by hand until T2 landed: widening a validator ahead of the
 * ledger would have accepted a domain the database then refuses, which is a
 * pass that dies half-copied rather than a request that is refused. The
 * migration is in, and `scripts/a-fifth-domain-the-database-would-refuse.unit.test.ts`
 * fails the build if the shared list ever outruns the CHECKs again — so
 * deriving is now the safer of the two, not just the shorter.
 */
const DiscoveryJobSchema = z.object({
  tenantId: z.string().uuid(),
  mappingId: z.string().uuid(),
  domains: z.array(z.enum(DISCOVERY_DOMAINS)).optional(),
});

type DiscoveryJobPayload = z.infer<typeof DiscoveryJobSchema>;

// Its pools, from the one module that builds a per-tenant task's (0138 T1):
// the tenant pool on APP_DATABASE_URL, app_user, under row security, and the
// audit key's pool of one on the owner's URL. It points this process's sinks
// too: the operator's log page (0129 T1) at the tenant pool, the audit lines
// (0129 T4) at the key's pool, the one read app_user may not make.
const { tenant: pool } = openTaskPools();

/** Best-effort per-item byte size from a listing item (mail/file carry `.size`). */
function sizeOf(item: unknown): number | undefined {
  const o = item as { size?: number; item?: { size?: number } };
  return typeof o.size === 'number' ? o.size : o.item?.size;
}

/**
 * A DiscoveryStore whose every op runs inside `withTenant` (tenant context set). That is the shape
 * row security needs, and it binds, the pool being `app_user`'s since workplan 0138 T1. One
 * transaction per op mirrors the migration_status writes in run-delta-sync.
 */
function tenantScopedStore(scopePool: Pool): DiscoveryStore {
  return {
    upsertDiscovery: (tenantId, mappingId, domain, discovery) =>
      withTenant(scopePool, tenantId, (db) =>
        new PgDiscoveryStore(db).upsertDiscovery(tenantId, mappingId, domain, discovery),
      ),
    recordDiscoveryError: (tenantId, mappingId, domain, error) =>
      withTenant(scopePool, tenantId, (db) =>
        new PgDiscoveryStore(db).recordDiscoveryError(tenantId, mappingId, domain, error),
      ),
    getDiscovery: (tenantId, mappingId) =>
      withTenant(scopePool, tenantId, (db) =>
        new PgDiscoveryStore(db).getDiscovery(tenantId, mappingId),
      ),
  };
}

/**
 * WHICH SOURCE EACH DOMAIN IS COUNTED THROUGH — a row per domain, never a
 * fall-through.
 *
 * This was three `if`s and a bare `else`: email, calendar and contact were
 * named and EVERYTHING ELSE opened the FILE deps. `task` arrived in workplan
 * 0113 as the fifth domain and landed in that else, so a preflight over a
 * mapping carrying tasks counted the file store instead — silently on a DAV
 * account, whose task and file faces both resolve to `dav`, and loudly on a
 * Microsoft one, where the owner's Tasks row reported `graph-drive source:
 * clientId is not set`. A domain naming another domain's connector in its own
 * error is the tell.
 *
 * `Record<DiscoveryDomain, …>` is the mechanism: a sixth domain added to
 * `DISCOVERY_DOMAINS` fails to compile here until somebody says what it counts
 * through, rather than quietly being counted as files.
 *
 * The literal `'mail'`/`'file'` arguments are not decoration either — each
 * overload of `buildDomainDepsFromMapping` accepts exactly one literal, and
 * the union is not one of them, which is the same reason `run-apply-deletion`
 * branches per literal. `email` asks for `'mail'`; every other domain asks for
 * its own name.
 *
 * `itemBytes` is set for the two domains whose listings carry a size, and left
 * off the three that do not: a calendar object, a card and a to-do have no
 * `.size` on the wire, and asking for one would report zero bytes as a
 * measured fact rather than as an absent one.
 */
const DOMAIN_DISCOVERY: Readonly<
  Record<
    DiscoveryDomain,
    {
      open: (pool: Pool, tenantId: TenantId, mappingId: MappingId) => Promise<DomainDepsToCount>;
      readonly itemBytes: boolean;
    }
  >
> = {
  email: {
    open: (pool, t, m) => buildDomainDepsFromMapping(pool, t, m, 'mail'),
    itemBytes: true,
  },
  calendar: {
    open: (pool, t, m) => buildDomainDepsFromMapping(pool, t, m, 'calendar'),
    itemBytes: false,
  },
  contact: {
    open: (pool, t, m) => buildDomainDepsFromMapping(pool, t, m, 'contact'),
    itemBytes: false,
  },
  file: {
    open: (pool, t, m) => buildDomainDepsFromMapping(pool, t, m, 'file'),
    itemBytes: true,
  },
  task: {
    open: (pool, t, m) => buildDomainDepsFromMapping(pool, t, m, 'task'),
    itemBytes: false,
  },
};

/** What each row's `open` hands back: a source to count, and a pool to release. */
interface DomainDepsToCount {
  readonly source: Parameters<typeof discoverSource>[0];
  close(): Promise<void>;
}

/**
 * Build the per-domain discovery task: open the DB-backed source, count it,
 * always close. Exported for
 * `a-domain-counted-through-another-domains-source.unit.test.ts`.
 */
/**
 * A source's own count of what this migration's policy will refuse for measured
 * instability, when the source keeps one.
 *
 * `undefined` for every source that does not — which is all of them but Google
 * Drive and Dropbox, which counts its Paper docs (workplan 0150 T3 (d)) — and
 * `undefined` rather than `{}` on purpose: the preflight's field
 * distinguishes "did not look" from "looked and found none", the same way
 * `generatedIdItems` and `targetExisting` already do in that interface.
 *
 * An empty tally is still a LOOK and is reported as `{}`: a Drive with no
 * Slides under `export-office` has genuinely been counted, and telling the
 * owner "not measured" there would understate what is known.
 */
function refusalsFrom(source: unknown): Readonly<Record<string, number>> | undefined {
  const counting = source as { nativeRefusals?: () => Readonly<Record<string, number>> };
  return typeof counting.nativeRefusals === 'function' ? counting.nativeRefusals() : undefined;
}

export function buildTask(
  scopePool: Pool,
  tenantId: TenantId,
  mappingId: MappingId,
  domain: DiscoveryDomain,
): DomainDiscoveryTask {
  const counted = DOMAIN_DISCOVERY[domain];
  return {
    domain,
    run: async () => {
      const deps = await counted.open(scopePool, tenantId, mappingId);
      try {
        const out = await discoverSource(
          deps.source,
          counted.itemBytes ? { itemBytes: sizeOf } : {},
        );
        // AFTER the walk, not before — the tally is what the walk accumulated
        // (0042 T7, owner's decision 2026-09-16). An OPTIONAL capability in the
        // shape `listTrashedPaths` and `storageUsage` already use: only the
        // Drive source has it, every other source keeps the field absent, and
        // absent means "did not look" rather than "found none".
        //
        // Read here rather than inside `discoverSource` because that function
        // is generic over every domain and this is one connector's knowledge
        // about one provider's exports. Teaching the generic walker about
        // Google Slides would put Drive's business in five other domains' path.
        const counts = refusalsFrom(deps.source);
        return counts === undefined ? out : { ...out, refusedNative: counts };
      } finally {
        await deps.close();
      }
    },
  };
}

/**
 * WHICH DOMAINS THIS PREFLIGHT COUNTS.
 *
 * No explicit list means "the mapping's OWN selection", never "all five" —
 * the same rule `run-delta-sync` learned live (#207, 2026-08-11) and for the
 * same reason: the API's preflight enqueue passes no domains, so an all-five
 * default counted domains the owner had switched off, through connections
 * this mapping has not got.
 *
 * It is not merely a spare row on the screen. A migration carrying everything
 * BUT mail got an Email row reading
 *
 *     Unsupported target type: undefined
 *
 * — the mail arm resolving a target the owner never configured — sitting on
 * the preflight beside four real ones (2026-09-07). The owner reads that as
 * the product failing to see their mail; what it means is that nobody asked
 * for mail.
 *
 * An empty selection stays empty. No `scope_selection` row means "not
 * selected" here exactly as it does in the tick and in the sync job; filling
 * it back in with everything is the bug this replaces.
 *
 * An explicit list still wins, so a narrower manual re-count stays possible —
 * but it can only ever NARROW what the caller names, because the caller names
 * it on purpose.
 *
 * Exported for `a-preflight-that-counts-a-domain-nobody-asked-for.unit.test.ts`:
 * the choice is the behaviour worth pinning, and it needs a fake row set
 * rather than a database.
 */
export async function domainsToCount(
  scopePool: Pool,
  tenantId: TenantId,
  mappingId: MappingId,
  asked: readonly DiscoveryDomain[] | undefined,
): Promise<DiscoveryDomain[]> {
  if (asked) return [...asked];
  return [...(await enabledDomains(scopePool, tenantId, mappingId))];
}

/**
 * One count per migration at a time, partitioned by the `concurrencyKey` the
 * API sets (`discoveryTriggerOptions`) — the shape `run-delta-sync` uses for
 * passes. Every reload of the confirm screen used to start a count beside the
 * running one (2026-09-22).
 */
export const discoveryQueue = queue({ name: 'run-discovery', concurrencyLimit: 1 });

export const runDiscovery = schemaTask({
  id: 'run-discovery',
  description: 'Pre-sync discovery (read-only counts)',
  schema: DiscoveryJobSchema,
  queue: discoveryQueue,
  // THE MACHINE A COUNT RUNS ON (workplan 0143 T1 step 2): it lists
  // everything a migration holds, so it names its own, as a pass does. Its
  // peak is not measured yet; that is 0143 T9.
  machine: 'small-1x',
  run: leavesAReference('run-discovery', async (payload: unknown, _context) => {
    const typed = payload as DiscoveryJobPayload;
    if (!typed.tenantId) {
      throw new Error('tenantId is required in job payload');
    }
    const tenantId = typed.tenantId as TenantId;
    const mappingId = typed.mappingId as MappingId;
    const domains = await domainsToCount(pool, tenantId, mappingId, typed.domains);

    log.info('Starting discovery', { tenantId, mappingId, domains });

    const store = tenantScopedStore(pool);
    const tasks = domains.map((domain) => buildTask(pool, tenantId, mappingId, domain));
    // What the plane keeps of a data type this could not count: its category
    // and a reference, never the error's words (0134, open question 3 (a)).
    // The words are in discovery's own row, where the wizard reads them.
    const outcomes = await outcomesForThePlane(
      await discoverDomains(tasks, store, tenantId, mappingId),
      { task: 'run-discovery', tenantId, mappingId },
    );

    log.info('Discovery complete', { outcomes });
    return { outcomes };
  }),
});
