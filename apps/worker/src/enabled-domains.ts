// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Domains selected for a mapping — `scope_selection` rows with
 * `included = true`, the same query the managed sync tick uses, so the
 * jobs and the tick cannot disagree about what a mapping migrates.
 *
 * Exists because the first live apply run (0018 T5, 2026-08-01) proved what
 * happens without it: `run-apply-deletion` opened connector deps for ALL four
 * domains unconditionally, and on a DAV-only mapping the MAIL deps builder
 * threw (`buildDepsFromMapping currently only supports imap-oauth2`) before
 * the calendar item was ever reached. A job may only touch the domains the
 * owner selected — which is also what keeps a disabled domain reading as
 * SKIPPED ("your call, nobody checked") rather than as an error.
 *
 * Uses the owner pool without a tenant context on purpose: this is the same
 * trusted, system-level enumeration the sync tick performs (see
 * jobs/managed-sync-tick.ts for that trust boundary), filtered by tenant
 * explicitly.
 */

import type { Pool } from 'pg';

export type SyncDomain = 'email' | 'calendar' | 'contact' | 'file';

export async function enabledDomains(
  pool: Pool,
  tenantId: string,
  mappingId: string,
): Promise<Set<SyncDomain>> {
  const { rows } = await pool.query<{ domain: SyncDomain }>(
    `SELECT domain FROM scope_selection WHERE tenant_id = $1 AND mapping_id = $2 AND included = true`,
    [tenantId, mappingId],
  );
  return new Set(rows.map((r) => r.domain));
}
