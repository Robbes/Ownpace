// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Discovery Job (workplan 0013 T3, managed edition)
 *
 * Read-only, body-free pre-sync counts per domain, persisted to migration_discovery so the wizard
 * can show them before the owner green-lights the migration. Enqueued on demand from the API
 * (POST /api/migrations/:id/discover). Builds each domain's source from the DB under RLS
 * (`buildDomainDepsFromMapping`) and writes counts inside `withTenant` as the non-owner app_user.
 *
 * Trigger: manual (API-initiated).
 */

import { z } from 'zod';
import { schemaTask } from '@trigger.dev/sdk';
import { Pool } from 'pg';
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
import { DISCOVERY_DOMAINS, log } from '@openmig/shared';

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

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

const pool = new Pool({ connectionString: DATABASE_URL });

/** Best-effort per-item byte size from a listing item (mail/file carry `.size`). */
function sizeOf(item: unknown): number | undefined {
  const o = item as { size?: number; item?: { size?: number } };
  return typeof o.size === 'number' ? o.size : o.item?.size;
}

/**
 * A DiscoveryStore whose every op runs inside `withTenant` (app_user + tenant context), the way
 * the managed edition enforces RLS. One transaction per op mirrors the migration_status writes in
 * run-delta-sync.
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
        return await discoverSource(deps.source, counted.itemBytes ? { itemBytes: sizeOf } : {});
      } finally {
        await deps.close();
      }
    },
  };
}

export const runDiscovery = schemaTask({
  id: 'run-discovery',
  description: 'Pre-sync discovery (read-only counts)',
  schema: DiscoveryJobSchema,
  run: async (payload: unknown, _context) => {
    const typed = payload as DiscoveryJobPayload;
    if (!typed.tenantId) {
      throw new Error('tenantId is required in job payload');
    }
    const tenantId = typed.tenantId as TenantId;
    const mappingId = typed.mappingId as MappingId;
    const domains: DiscoveryDomain[] = typed.domains ?? [...DISCOVERY_DOMAINS];

    log.info('Starting discovery', { tenantId, mappingId, domains });

    const store = tenantScopedStore(pool);
    const tasks = domains.map((domain) => buildTask(pool, tenantId, mappingId, domain));
    const outcomes = await discoverDomains(tasks, store, tenantId, mappingId);

    log.info('Discovery complete', { outcomes });
    return { outcomes };
  },
});
