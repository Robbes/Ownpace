// Copyright 2026 The Ownpace authors (Apache-2.0)

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
import { DISCOVERY_DOMAINS, type DiscoveryDomain } from '@openmig/shared';


export async function enabledDomains(
  pool: Pool,
  tenantId: string,
  mappingId: string,
): Promise<Set<DiscoveryDomain>> {
  const { rows } = await pool.query<{ domain: DiscoveryDomain }>(
    `SELECT domain FROM scope_selection WHERE tenant_id = $1 AND mapping_id = $2 AND included = true`,
    [tenantId, mappingId],
  );
  return new Set(rows.map((r) => r.domain));
}

/**
 * The same question for many mappings, in one round trip (workplan 0082 T3).
 *
 * The sync tick asked it inside its loop — one query per due mapping, every
 * minute. That is the textbook N+1, and it is worse than usual here because
 * the loop is on a one-minute cron: the cost is not "a slow page", it is tick
 * wall-time that eventually exceeds the interval it runs on, at which point
 * ticks start overlapping and the fan-out gets less predictable exactly when
 * there is most of it.
 *
 * Keyed by mapping id alone, which is safe because mapping ids are UUIDs and
 * unique across tenants — but the tenant is still carried through and checked
 * by the caller rather than assumed, because "globally unique" is a property
 * of the id generator and not something this query can enforce.
 *
 * A mapping with no included rows is absent from the map, not present with an
 * empty set — the caller must not be able to confuse "nothing selected" with
 * "I did not ask about that one".
 */
export async function enabledDomainsForMappings(
  pool: Pool,
  mappings: readonly { readonly id: string; readonly tenantId: string }[],
): Promise<Map<string, Set<DiscoveryDomain>>> {
  const byMapping = new Map<string, Set<DiscoveryDomain>>();
  if (mappings.length === 0) return byMapping;

  const { rows } = await pool.query<{ mapping_id: string; tenant_id: string; domain: DiscoveryDomain }>(
    `SELECT mapping_id, tenant_id, domain
       FROM scope_selection
      WHERE included = true AND mapping_id = ANY($1::uuid[])`,
    [mappings.map((m) => m.id)],
  );

  const tenantOf = new Map(mappings.map((m) => [m.id, m.tenantId]));
  for (const row of rows) {
    // Belt and braces: a row whose tenant does not match the mapping we asked
    // about would mean the id collision this comment says cannot happen, and
    // acting on it would run a job against another tenant's scope.
    if (tenantOf.get(row.mapping_id) !== row.tenant_id) continue;
    let set = byMapping.get(row.mapping_id);
    if (!set) {
      set = new Set<DiscoveryDomain>();
      byMapping.set(row.mapping_id, set);
    }
    set.add(row.domain);
  }
  return byMapping;
}

/**
 * Every domain the product can carry, in the order a person reads them.
 *
 * `DISCOVERY_DOMAINS` under a name this package's callers already type. The
 * list itself lives in `@openmig/shared`'s `discovery.ts` and is written once
 * (workplan 0113 T1) — a second copy here would be the one that forgot the
 * fifth domain.
 */
export const ALL_SYNC_DOMAINS: readonly DiscoveryDomain[] = DISCOVERY_DOMAINS;

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
  selected: ReadonlySet<DiscoveryDomain>,
  running: readonly DiscoveryDomain[],
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
