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

/** Every domain the product can carry, in the order a person reads them. */
export const ALL_SYNC_DOMAINS: readonly SyncDomain[] = ['email', 'calendar', 'contact', 'file'];

/**
 * What the run log should say about the domains that did NOT run.
 *
 * A run log listing only the domains that ran leaves the reader to guess why
 * the others are absent — the owner reading the first live run history asked
 * exactly that ("email: 0 created, 0 skipped. How about cals and contacts,
 * files?"). Silence reads as "we forgot", which is the one thing that was not
 * happening. The §20 verify report has said this for its domains all along
 * ("calendar was not verified: disabled in the config — this domain was NOT
 * checked"); the run log now says its half.
 *
 * TWO KINDS OF ABSENT, kept apart because they mean different things to
 * whoever is reading:
 *
 *  - **not selected** — no `scope_selection` row. The owner's own scoping
 *    decision; nothing is wrong and nothing will change on its own.
 *  - **not part of this run** — selected for the migration, but this
 *    particular job was asked for a narrower list. Temporary, and the next
 *    scheduled pass covers it. Calling that one "not selected" would report an
 *    owner decision that was never made.
 *
 * Pure so it can be tested without a database or a queue (the same reason
 * dav-endpoint.ts is pure). Returns the lines to log, in order; an empty array
 * means every domain the mapping carries ran, which needs no explanation.
 */
export function describeAbsentDomains(
  selected: ReadonlySet<SyncDomain>,
  running: readonly SyncDomain[],
): string[] {
  const ran = new Set(running);
  const lines: string[] = [];

  const notSelected = ALL_SYNC_DOMAINS.filter((d) => !selected.has(d));
  if (notSelected.length > 0) {
    lines.push(
      `${notSelected.join(', ')}: not selected for this migration — not synced, not checked`,
    );
  }

  const heldBack = ALL_SYNC_DOMAINS.filter((d) => selected.has(d) && !ran.has(d));
  if (heldBack.length > 0) {
    lines.push(
      `${heldBack.join(', ')}: selected for this migration but not part of this run`,
    );
  }

  return lines;
}
