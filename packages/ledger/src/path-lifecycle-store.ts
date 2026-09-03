// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Reading and moving the lifecycle of one PATH (workplan 0109 T1).
 *
 * ## Absent means `ready`, and that asymmetry is the point
 *
 * A path with no row has been configured and never run. ADR-0014 makes `ready`
 * free and slot-less, so reading absence as `ready` cannot over-bill anybody —
 * it can only under-claim, which is the safe direction for a number somebody
 * pays. Every read here therefore answers for paths that have no row, and
 * `activate` is what creates one.
 *
 * ## What holds a slot, and why `paused` does
 *
 * A tier is a CAPACITY — how many paths run at the same time. `active` and
 * `paused` both hold a slot; `ready`, `cutover` and `done` do not. Pausing is
 * NOT a way to reduce a bill, deliberately: a paused path keeps its state and
 * resumes in a second, which is reserved capacity, and ADR-0014 requires that
 * to be said on the pricing page rather than discovered on an invoice.
 *
 * `holdsASlot` is exported because it is the one rule the tier calculator, the
 * honesty surface and any future invoice all have to agree on, and three
 * copies of it would eventually disagree about `paused`.
 *
 * ## Nothing calls this yet
 *
 * The routes still read and write `mailbox_mapping.status`. Making cutover and
 * start per-path is the next task — `cutover_state`'s unique index is per
 * mapping and the start route refuses at the mapping grain, and both have to
 * move before a path can end on its own. This store exists first so that
 * change is a wiring diff rather than a wiring-plus-semantics one.
 */

import { and, eq, inArray, sql } from 'drizzle-orm';
import type { PgDatabase } from './db.ts';
import * as schemaPg from './schema-pg.ts';
import type { MappingId, TenantId } from '@openmig/shared';
import type { DiscoveryDomain } from '@openmig/shared';

/** ADR-0014's five, in the order a path travels them. */
export const PATH_STATES = ['ready', 'active', 'paused', 'cutover', 'done'] as const;
export type PathState = (typeof PATH_STATES)[number];


export interface PathLifecycle {
  readonly domain: DiscoveryDomain;
  readonly state: PathState;
  /** Absent until the path has ever taken a slot. */
  readonly firstActivatedAt?: string;
  /** Absent while it still holds one. */
  readonly endedAt?: string;
}

/**
 * Does a path in this state hold one of the tier's slots?
 *
 * The single authority. `paused` is the entry that surprises people and it is
 * deliberate — see the module comment.
 */
export function holdsASlot(state: PathState): boolean {
  return state === 'active' || state === 'paused';
}

/** The states a path can be in without holding a slot — the complement, kept
 *  derived rather than listed, so the two can never disagree. */
export const SLOTLESS_STATES: ReadonlyArray<PathState> = PATH_STATES.filter((s) => !holdsASlot(s));

/**
 * The slot-holding states, derived — for the WHERE clause that counts them.
 *
 * Written out in SQL until a break test showed the flaw: changing `holdsASlot`
 * left the query counting the old set, so the function and the query could
 * disagree about `paused` and only one of them would be read at invoice time.
 * That is the same drift this codebase removed from the Google scope tables and
 * from the wizard's domain list; one authority, derived twice, is the fix.
 */
export const SLOT_HOLDING_STATES: ReadonlyArray<PathState> = PATH_STATES.filter(holdsASlot);

export class PgPathLifecycleStore {
  private readonly db: PgDatabase;

  constructor(db: PgDatabase) {
    this.db = db;
  }

  /**
   * Every path's lifecycle for one mapping, including the ones with no row.
   *
   * `scope_selection` is the list of paths that EXIST; this table is the list
   * that have moved. Reading the first and filling from the second is what
   * makes "absent means ready" true at the edge rather than remembered by
   * every caller.
   */
  async forMapping(
    tenantId: TenantId,
    mappingId: MappingId,
  ): Promise<ReadonlyArray<PathLifecycle>> {
    const paths = await this.db
      .select({ domain: schemaPg.scopeSelection.domain })
      .from(schemaPg.scopeSelection)
      .where(
        and(
          eq(schemaPg.scopeSelection.tenantId, tenantId),
          eq(schemaPg.scopeSelection.mappingId, mappingId),
          // A domain the owner deselected is not a path at all.
          eq(schemaPg.scopeSelection.included, true),
        ),
      );

    const rows = await this.db
      .select({
        domain: schemaPg.pathLifecycle.domain,
        state: schemaPg.pathLifecycle.state,
        firstActivatedAt: schemaPg.pathLifecycle.firstActivatedAt,
        endedAt: schemaPg.pathLifecycle.endedAt,
      })
      .from(schemaPg.pathLifecycle)
      .where(
        and(
          eq(schemaPg.pathLifecycle.tenantId, tenantId),
          eq(schemaPg.pathLifecycle.mappingId, mappingId),
        ),
      );
    const moved = new Map(rows.map((r) => [r.domain, r]));

    return paths.map(({ domain }) => {
      const row = moved.get(domain);
      if (!row) return { domain: domain as DiscoveryDomain, state: 'ready' as const };
      return {
        domain: domain as DiscoveryDomain,
        state: row.state as PathState,
        ...(row.firstActivatedAt
          ? { firstActivatedAt: row.firstActivatedAt.toISOString() }
          : {}),
        ...(row.endedAt ? { endedAt: row.endedAt.toISOString() } : {}),
      };
    });
  }

  /**
   * How many of this tenant's paths hold a slot right now.
   *
   * The number a tier is read off. Counts rows only — a path with no row is
   * `ready` and holds nothing, so it cannot contribute, which is why this can
   * be one indexed scan rather than a join against `scope_selection`.
   */
  async slotsHeld(tenantId: TenantId): Promise<number> {
    const rows = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(schemaPg.pathLifecycle)
      .where(
        and(
          eq(schemaPg.pathLifecycle.tenantId, tenantId),
          // Derived from `holdsASlot`, never restated: see SLOT_HOLDING_STATES.
          inArray(schemaPg.pathLifecycle.state, [...SLOT_HOLDING_STATES]),
        ),
      );
    return rows[0]?.n ?? 0;
  }

  /**
   * Move a path to `active`, creating its row if this is the first time.
   *
   * `first_activated_at` is stamped ONCE and never overwritten — a path that
   * was paused and resumed has not started again, and an invoice reconstructed
   * months later needs the original date. `ended_at` is cleared, because a
   * path that is running has not ended.
   */
  async activate(
    tenantId: TenantId,
    mappingId: MappingId,
    domain: DiscoveryDomain,
  ): Promise<void> {
    await this.db.execute(
      sql`INSERT INTO path_lifecycle
            (tenant_id, mapping_id, domain, state, first_activated_at, updated_at)
          VALUES (${tenantId}, ${mappingId}, ${domain}, 'active', now(), now())
          ON CONFLICT (mapping_id, domain) DO UPDATE SET
            state = 'active',
            first_activated_at = COALESCE(path_lifecycle.first_activated_at, now()),
            ended_at = NULL,
            updated_at = now()`,
    );
  }

  /**
   * Move a path to any other state.
   *
   * `ended_at` is stamped when the state releases a slot and cleared when it
   * does not, so "when did this path stop costing anything" is answerable from
   * the row rather than reconstructed from an audit trail. Refuses `active`,
   * which has to go through `activate` — that is the one transition with a
   * stamp to preserve, and letting it in here would make forgetting the
   * COALESCE a one-character mistake.
   */
  async moveTo(
    tenantId: TenantId,
    mappingId: MappingId,
    domain: DiscoveryDomain,
    state: Exclude<PathState, 'active'>,
  ): Promise<void> {
    const releases = !holdsASlot(state);
    await this.db.execute(
      sql`INSERT INTO path_lifecycle
            (tenant_id, mapping_id, domain, state, ended_at, updated_at)
          VALUES (
            ${tenantId}, ${mappingId}, ${domain}, ${state},
            ${releases ? sql`now()` : sql`NULL`}, now()
          )
          ON CONFLICT (mapping_id, domain) DO UPDATE SET
            state = ${state},
            ended_at = ${releases ? sql`now()` : sql`NULL`},
            updated_at = now()`,
    );
  }
}
