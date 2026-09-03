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

/** Build the per-domain discovery task: open the DB-backed source, count it, always close. */
function buildTask(
  scopePool: Pool,
  tenantId: TenantId,
  mappingId: MappingId,
  domain: DiscoveryDomain,
): DomainDiscoveryTask {
  return {
    domain,
    run: async () => {
      // Literal domain args pick the right buildDomainDepsFromMapping overload; email → 'mail'.
      if (domain === 'email') {
        const deps = await buildDomainDepsFromMapping(scopePool, tenantId, mappingId, 'mail');
        try {
          return await discoverSource(deps.source, { itemBytes: sizeOf });
        } finally {
          await deps.close();
        }
      }
      if (domain === 'calendar') {
        const deps = await buildDomainDepsFromMapping(scopePool, tenantId, mappingId, 'calendar');
        try {
          return await discoverSource(deps.source);
        } finally {
          await deps.close();
        }
      }
      if (domain === 'contact') {
        const deps = await buildDomainDepsFromMapping(scopePool, tenantId, mappingId, 'contact');
        try {
          return await discoverSource(deps.source);
        } finally {
          await deps.close();
        }
      }
      const deps = await buildDomainDepsFromMapping(scopePool, tenantId, mappingId, 'file');
      try {
        return await discoverSource(deps.source, { itemBytes: sizeOf });
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
