// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A MIGRATION'S DATA TYPES, AS ITS FIRST COPY READS THEM (workplan 0154 T7).
 *
 * The facts `firstCopyOf` (shared) decides on, for both editions: each data
 * type in the migration's scope, with its phase (its path's state, or the
 * migration's status where it has no path, as `readPathPhases` falls back),
 * whether its owner stopped it, and whether a pass over it reached the end
 * (`completed_at`). One statement by unique keys, at most five rows, and none
 * of the counts the status read takes over the item table.
 */
import { and, eq } from 'drizzle-orm';
import type { DiscoveryDomain, FirstCopyFacts } from '@openmig/shared';
import * as schemaPg from './schema-pg.ts';
import type { PgDatabase } from './db-types.ts';

export async function readFirstCopyFacts(
  db: PgDatabase,
  tenantId: string,
  mappingId: string,
): Promise<FirstCopyFacts> {
  const s = schemaPg.scopeSelection;
  const p = schemaPg.pathLifecycle;
  const ms = schemaPg.migrationStatus;
  const rows = await db
    .select({
      domain: s.domain,
      pathState: p.state,
      stoppedAt: p.stoppedAt,
      completedAt: ms.completedAt,
      status: schemaPg.mailboxMapping.status,
    })
    .from(s)
    .innerJoin(schemaPg.mailboxMapping, eq(schemaPg.mailboxMapping.id, s.mappingId))
    .leftJoin(p, and(eq(p.tenantId, s.tenantId), eq(p.mappingId, s.mappingId), eq(p.domain, s.domain)))
    .leftJoin(ms, and(eq(ms.tenantId, s.tenantId), eq(ms.mappingId, s.mappingId), eq(ms.domain, s.domain)))
    .where(and(eq(s.tenantId, tenantId), eq(s.mappingId, mappingId), eq(s.included, true)));
  return {
    dataTypes: rows.map((r) => ({
      domain: r.domain as DiscoveryDomain,
      phase: r.pathState ?? r.status,
      stopped: r.stoppedAt !== null,
      completed: r.completedAt !== null,
    })),
  };
}
