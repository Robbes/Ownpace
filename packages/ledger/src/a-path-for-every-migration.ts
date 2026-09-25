// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * PATH ROWS EVERYONE CAN TRUST (workplan 0128 T5, slice 2a).
 *
 * A migration's data types are its paths (ADR-0014), and `path_lifecycle`
 * holds each one's phase. Until now only the managed API's doors wrote them,
 * from 2026-08-30, so two kinds of migration had none:
 *
 * - every managed migration started before the wiring, or written by hand;
 * - every appliance migration, which had no scope rows either, so there was
 *   nothing for a path row to belong to.
 *
 * For billing, absent means `ready` and holds nothing. The gates that will
 * read a data type's phase from its row (slice 2b) fall back to the
 * migration's status when a row is absent, so absence is safe there too. But a
 * cutover per data type (slice 5) moves rows, and a row that is not there
 * cannot be moved. So every migration that has started gets its rows, from its
 * own status, by one rule:
 *
 * - `active` and `continuous`: always. The owner started it, and it holds its
 *   slots;
 * - `paused`: only once it has run a pass. A paused migration that never ran
 *   is a draft, and a draft's paths are `ready`: free, and absent;
 * - `cutover` and `done`: always, with `ended_at` at the migration's last
 *   change, since that is when its slots were released.
 *
 * `first_activated_at` is its first pass, or the migration's creation when no
 * pass was recorded. A row that exists is never touched: only the doors move
 * rows.
 *
 * Ledger migration 0065 applied this rule to every migration once. The
 * appliance applies it to its own at every start-up (`pathsFromTheMapping`),
 * after writing its scope rows from its configuration (`recordScope`), since
 * its migrations get their scope rows only then.
 */

import { sql } from 'drizzle-orm';
import type { DiscoveryDomain } from '@openmig/shared';
import type { PgDatabase } from './db-types.ts';

/**
 * Give one migration's paths their lifecycle rows, by 0065's rule, where they
 * have none. Answers the data types given a row now.
 */
export async function pathsFromTheMapping(
  db: PgDatabase,
  tenantId: string,
  mappingId: string,
): Promise<readonly string[]> {
  const written = await db.execute(sql`
    INSERT INTO path_lifecycle
      (tenant_id, mapping_id, domain, state, first_activated_at, ended_at, updated_at)
    SELECT s.tenant_id, s.mapping_id, s.domain, m.status,
           COALESCE((SELECT min(r.started_at) FROM run r
                      WHERE r.tenant_id = m.tenant_id AND r.mapping_id = m.id),
                    m.created_at),
           CASE WHEN m.status IN ('cutover', 'done') THEN m.updated_at END,
           now()
      FROM scope_selection s
      JOIN mailbox_mapping m ON m.id = s.mapping_id AND m.tenant_id = s.tenant_id
     WHERE s.included
       AND s.tenant_id = ${tenantId}
       AND s.mapping_id = ${mappingId}
       AND (m.status <> 'paused'
            OR EXISTS (SELECT 1 FROM run r WHERE r.tenant_id = m.tenant_id AND r.mapping_id = m.id))
    ON CONFLICT (mapping_id, domain) DO NOTHING
    RETURNING domain`);
  return (written.rows as Array<{ domain: string }>).map((r) => r.domain).sort();
}

/**
 * Write a migration's scope rows: which data types it carries (`included`),
 * and which it names but has switched off. The appliance's come from its
 * configuration file; the managed wizard writes its own at creation.
 */
export async function recordScope(
  db: PgDatabase,
  tenantId: string,
  mappingId: string,
  scope: ReadonlyArray<{ readonly domain: DiscoveryDomain; readonly included: boolean }>,
): Promise<void> {
  for (const { domain, included } of scope) {
    await db.execute(sql`
      INSERT INTO scope_selection (tenant_id, mapping_id, domain, included)
      VALUES (${tenantId}, ${mappingId}, ${domain}, ${included})
      ON CONFLICT (mapping_id, domain) DO UPDATE SET included = EXCLUDED.included`);
  }
}
