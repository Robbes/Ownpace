// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * GET /api/migrations/:mappingId/destination-space (workplan 0171 §6.3, T9).
 *
 * Free space at each destination of a migration, read live for *Review and
 * start*: each destination writer is opened as a pass would open it, asked
 * `capacity()` with a ten-second limit, and closed. Read-only: nothing is
 * written at the destination and nothing is stored here (§8). The answer is
 * one entry per pool, `{ pool, destination, dataTypes, needBytes, capacity }`,
 * where `needBytes` adds up the discovery bytes of the data types landing in
 * that pool. The appliance answers the same shape (`apps/selfhost`).
 */
import { Router } from 'express';
import { idsThatAreNoUuid } from '../../an-id-that-is-no-uuid.ts';
import type { Response } from 'express';
import { and, eq } from 'drizzle-orm';
import * as schema from '@openmig/ledger';
import type { DiscoveryDomain, MappingId, TenantId } from '@openmig/shared';
import { buildDomainDepsFromMapping } from '@openmig/orchestration/build-deps-from-mapping';
import {
  destinationLabelOf,
  needFromDiscovery,
  readDestinationSpace,
  type DestinationOpener,
} from '@openmig/orchestration/destination-space';
import { authenticate, getDbPool, withTenantDb } from '../../middleware/auth.ts';
import type { AuthenticatedRequest } from '../../types/api.ts';
import { serverFault } from '../../server-fault.ts';

const router = idsThatAreNoUuid(Router({ mergeParams: true }));

let shared: ReturnType<typeof getDbPool> | null = null;
const pool = () => (shared ??= getDbPool());

/**
 * A writer of the migration, opened as its pass would open it, for this one
 * question. Only mail's and files' are ever opened: calendars, contacts and
 * tasks are not asked (§6.2), and `readDestinationSpace` answers them without
 * calling this.
 */
function openerFor(tenantId: string, mappingId: string, dataType: DiscoveryDomain, destination: string): DestinationOpener {
  const open = async () => {
    if (dataType !== 'email' && dataType !== 'file') throw new Error(`the ${dataType} destination is not asked its space`);
    const deps =
      dataType === 'email'
        ? await buildDomainDepsFromMapping(pool(), tenantId, mappingId, 'mail')
        : await buildDomainDepsFromMapping(pool(), tenantId, mappingId, 'file');
    return { target: deps.target as unknown, close: () => deps.close() };
  };
  return { dataType, destination, open };
}

router.get('/:mappingId/destination-space', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { mappingId } = req.params;
    const tenantId = req.tenantId;
    if (!mappingId || Array.isArray(mappingId)) return void res.status(400).json({ error: 'mappingId is required' });
    if (!tenantId) return void res.status(401).json({ error: 'Unauthorized', message: 'Tenant ID not found' });

    const facts = await withTenantDb(tenantId, pool(), async (db) => {
      const [mapping] = await db
        .select({ targetMailboxId: schema.mailboxMapping.targetMailboxId })
        .from(schema.mailboxMapping)
        .where(and(eq(schema.mailboxMapping.id, mappingId), eq(schema.mailboxMapping.tenantId, tenantId)));
      if (!mapping) return null;
      // One after another: these share the transaction's one client.
      const target = mapping.targetMailboxId
        ? (
            await db
              .select({ kind: schema.connection.kind, config: schema.connection.config })
              .from(schema.mailbox)
              .innerJoin(schema.connection, eq(schema.connection.id, schema.mailbox.connectionId))
              .where(and(eq(schema.mailbox.id, mapping.targetMailboxId), eq(schema.mailbox.tenantId, tenantId)))
          )[0]
        : undefined;
      const scope = await db
        .select({ domain: schema.scopeSelection.domain })
        .from(schema.scopeSelection)
        .where(
          and(
            eq(schema.scopeSelection.tenantId, tenantId),
            eq(schema.scopeSelection.mappingId, mappingId),
            eq(schema.scopeSelection.included, true),
          ),
        );
      const discovery = await new schema.PgDiscoveryStore(db).getDiscovery(tenantId as TenantId, mappingId as MappingId);
      return { target, dataTypes: scope.map((r) => r.domain as DiscoveryDomain), discovery };
    });
    if (!facts) return void res.status(404).json({ error: 'Not found', message: 'Mapping not found' });

    const destination = destinationLabelOf(facts.target?.kind ?? 'unknown', facts.target?.config);
    const pools = await readDestinationSpace(
      facts.dataTypes.map((d) => openerFor(tenantId, mappingId, d, destination)),
      needFromDiscovery(facts.discovery),
      { where: mappingId },
    );
    res.json({ mappingId, pools });
  } catch (error) {
    serverFault(res, 'destination_space_failed', 'reading the free space at the destination', error);
  }
});

export default router;
