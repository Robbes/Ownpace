// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * STOP AND RESUME ONE DATA TYPE (workplan 0128 T4, T5 slice 3b; the owner's
 * decisions of 2026-09-24, D2 (c), D4, D5 and D6).
 *
 * On a running migration each data type can be stopped and resumed. Its
 * copies stay, its record stays, it no longer follows the source, and resuming
 * continues where it stopped. Mail can be stopped on the day the old mailbox
 * closes while contacts keep flowing.
 *
 * This is the one door both editions press: the managed API and the appliance.
 * In one transaction it checks, stops or resumes, and records:
 *
 * - **Only while the migration runs** (`active` or `continuous`). A paused
 *   migration is held whole; a finished one has nothing left to stop.
 * - **Only a data type the migration carries** (`scope_selection.included`),
 *   and only one before its cutover or kept in the lane. One in its cutover
 *   or ended has its own way to stop.
 * - **Never the last data type still copying** (D5): the owner is pointed at
 *   ending the migration instead, since a migration with everything stopped
 *   would go on holding its slots for nothing.
 * - **The stop is kept beside the phase** (`path_lifecycle.stopped_at`,
 *   ledger migration 0066), never in it, and `ended_at` follows `holdsASlot`:
 *   a stop in the lane releases its slot, a resume there takes it back (D2 (c)).
 * - **The progress strip says it** (`migration_status.state = 'stopped'`, the
 *   word 0125 T7 made), even with nothing copied yet, and a resume clears it.
 *   The stop, not that word, is the truth: `getStatus` answers `stopped` for
 *   as long as the path carries one, whatever a pass already under way when
 *   it was pressed writes when it ends.
 * - **An audit record** (`path.status`), the path audit record slice 2a left
 *   for the first door that moves a path on its own.
 *
 * The answer says whether slots were taken, so the managed edition raises the
 * month's peak in the same transaction, as its other doors do (hard rule 5
 * keeps that table out of this package).
 *
 * ## One answer for the page and the door (slice 3c)
 *
 * The door decides from facts (`readPathStopFacts`) by one rule
 * (`decidePathStop`), and the migration page is offered what that rule
 * accepts (`pathStopChoices`), as `kindChoices` does for adding a data type.
 * The page cannot offer a press the door refuses, and the door cannot accept
 * one the page never offered, but for a race: then the door's refusal is
 * shown as it is.
 */

import { sql } from 'drizzle-orm';
import { DISCOVERY_DOMAINS } from '@openmig/shared';
import type { DiscoveryDomain, MappingId, PathStopChoice, TenantId } from '@openmig/shared';
import type { PgDatabase } from './db-types.ts';
import { PgLedger } from './ledger.ts';
import { holdsASlot, type PathState } from './path-lifecycle-store.ts';
import { PgMigrationStatusStore } from './migration-status-store.ts';

/** The audit action a stop or a resume is recorded under. */
export const PATH_STATUS_ACTION = 'path.status';

/** The audit action a data type added to a migration is recorded under (0125 T6). */
export const PATH_ADDED_ACTION = 'path.added';

/** The migration states a data type can be stopped or resumed in. */
export const STATES_A_DATA_TYPE_STOPS_IN = ['active', 'continuous'] as const;

export interface PathStopChange {
  readonly mappingId: string;
  readonly domain: DiscoveryDomain;
  /** True to stop it, false to resume it. */
  readonly stop: boolean;
  /** Who pressed it: the signed-in user, or `'operator'` on the appliance. */
  readonly actor: string;
}

/** Why a stop or a resume was refused. Nothing was written. */
export type PathStopRefusal =
  | { readonly refused: 'not_found' }
  | { readonly refused: 'not_running'; readonly status: string }
  | { readonly refused: 'not_a_path' }
  | { readonly refused: 'not_stoppable'; readonly phase: string }
  | { readonly refused: 'last_one_copying' };

export type PathStopOutcome =
  | {
      /** False when it already was as asked: nothing was written. */
      readonly changed: boolean;
      /** True when a resume took back a slot the stop had released (D2 (c)). */
      readonly slotsTaken: boolean;
    }
  | PathStopRefusal;

type Row = Record<string, unknown>;
const rowsOf = (result: unknown): Row[] => ((result as { rows?: Row[] }).rows ?? []) as Row[];

/** What a stop or a resume is decided from: the migration, and each data type it carries. */
export interface PathStopFacts {
  /** The migration's lifecycle word (`mailbox_mapping.status`). */
  readonly status: string;
  /**
   * Each data type the migration carries (`scope_selection.included`), in the
   * order a person ticks them, with its path row's phase and stop. One with
   * no row has no `phase`: it runs in the migration's, unstopped.
   */
  readonly carried: ReadonlyArray<{
    readonly domain: DiscoveryDomain;
    readonly phase?: PathState;
    readonly stopped: boolean;
  }>;
}

/** What the door would do: refuse, change nothing, or change it in `phase`. */
export type PathStopDecision =
  | Exclude<PathStopRefusal, { readonly refused: 'not_found' }>
  | { readonly changes: false }
  | { readonly changes: true; readonly phase: PathState; readonly hasRow: boolean };

const runs = (state: string): boolean => (STATES_A_DATA_TYPE_STOPS_IN as readonly string[]).includes(state);

/**
 * The one rule: whether this press is accepted, from the facts alone. The
 * door asks it under its locks, and `pathStopChoices` asks it for the page.
 */
export function decidePathStop(facts: PathStopFacts, domain: DiscoveryDomain, stop: boolean): PathStopDecision {
  if (!runs(facts.status)) return { refused: 'not_running', status: facts.status };
  const path = facts.carried.find((p) => p.domain === domain);
  if (path === undefined) return { refused: 'not_a_path' };
  const phase = path.phase ?? (facts.status as PathState);
  if (!runs(phase)) return { refused: 'not_stoppable', phase };
  if (path.stopped === stop) return { changes: false };
  if (stop) {
    // D5. A data type with no row runs in the migration's phase, so it copies.
    const othersCopying = facts.carried.filter(
      (p) => p.domain !== domain && (p.phase === undefined || (runs(p.phase) && !p.stopped)),
    );
    if (othersCopying.length === 0) return { refused: 'last_one_copying' };
  }
  return { changes: true, phase, hasRow: path.phase !== undefined };
}

/**
 * Read the facts. Undefined when the migration is not there, or is another
 * organisation's (row security). With `lock`, the migration's row and its
 * data types' rows are held until the transaction ends, so two presses on
 * one migration are decided one after the other, each on what the other did.
 */
export async function readPathStopFacts(
  db: PgDatabase,
  tenantId: string,
  mappingId: string,
  { lock = false }: { readonly lock?: boolean } = {},
): Promise<PathStopFacts | undefined> {
  const forUpdate = lock ? sql`FOR UPDATE` : sql``;
  const [mapping] = rowsOf(
    await db.execute(sql`
      SELECT status FROM mailbox_mapping
       WHERE id = ${mappingId} AND tenant_id = ${tenantId}
       ${forUpdate}`),
  );
  if (mapping === undefined) return undefined;
  const included = new Set(
    rowsOf(
      await db.execute(sql`
        SELECT domain FROM scope_selection
         WHERE mapping_id = ${mappingId} AND tenant_id = ${tenantId} AND included`),
    ).map((r) => String(r.domain)),
  );
  const rows = new Map(
    rowsOf(
      await db.execute(sql`
        SELECT domain, state, stopped_at IS NOT NULL AS stopped FROM path_lifecycle
         WHERE mapping_id = ${mappingId} AND tenant_id = ${tenantId}
         ${forUpdate}`),
    ).map((r) => [String(r.domain), { phase: String(r.state) as PathState, stopped: r.stopped === true }]),
  );
  return {
    status: String(mapping.status),
    carried: DISCOVERY_DOMAINS.filter((domain) => included.has(domain)).map((domain) => {
      const row = rows.get(domain);
      return row === undefined ? { domain, stopped: false } : { domain, ...row };
    }),
  };
}

/**
 * Stop or resume one data type of a running migration. Call it inside the
 * caller's own tenant transaction; it writes nothing when it refuses.
 */
export async function stopOrResumePath(
  db: PgDatabase,
  tenantId: string,
  change: PathStopChange,
): Promise<PathStopOutcome> {
  const { mappingId, domain, stop } = change;

  const facts = await readPathStopFacts(db, tenantId, mappingId, { lock: true });
  if (facts === undefined) return { refused: 'not_found' };
  const decision = decidePathStop(facts, domain, stop);
  if ('refused' in decision) return decision;
  if (!decision.changes) return { changed: false, slotsTaken: false };
  const { phase } = decision;

  // A data type with no row (written by hand, or never backfilled) is given
  // it only now, once nothing is refused: a refusal writes nothing.
  if (!decision.hasRow) {
    await db.execute(sql`
      INSERT INTO path_lifecycle (tenant_id, mapping_id, domain, state, first_activated_at, updated_at)
      VALUES (${tenantId}, ${mappingId}, ${domain}, ${phase}, now(), now())`);
  }
  const holdsAfter = holdsASlot(phase, stop);
  await db.execute(sql`
    UPDATE path_lifecycle
       SET stopped_at = ${stop ? sql`now()` : sql`NULL::timestamptz`},
           ended_at = ${holdsAfter ? sql`NULL::timestamptz` : sql`now()`},
           updated_at = now()
     WHERE mapping_id = ${mappingId} AND domain = ${domain}`);

  const statusStore = new PgMigrationStatusStore(db);
  if (stop) await statusStore.markStoppedByOwner(tenantId as TenantId, mappingId as MappingId, domain);
  else await statusStore.markSwitchedOn(tenantId as TenantId, mappingId as MappingId, domain);

  await new PgLedger(db).recordAuditEvent(tenantId as TenantId, {
    actor: change.actor,
    action: PATH_STATUS_ACTION,
    entity: 'path',
    detail: {
      mappingId,
      domain,
      phase,
      from: stop ? 'running' : 'stopped',
      to: stop ? 'stopped' : 'running',
    },
  });

  return { changed: true, slotsTaken: !stop && holdsAfter && !holdsASlot(phase, true) };
}

/**
 * What the migration page offers for each data type it carries: the press the
 * door accepts now, which is the one that turns it the other way, or none.
 *
 * Where there is none, `held` says why only when the page must say so (the
 * page words it, since it is a code: the i18n prose boundary):
 *
 * - `not_running`: a stopped data type on a migration that does not run.
 *   Its owner looks for Resume; it comes back with the migration.
 * - `last_one_copying`: D5, the last one still copying, where the migration
 *   carries more than one. With one data type there was never anything to
 *   stop, and saying so on every page load would be noise.
 *
 * Anything else, such as a migration past its cutover, offers nothing and
 * says nothing: the page's other lines say where the migration is.
 */
export function pathStopChoices(facts: PathStopFacts): PathStopChoice[] {
  return facts.carried.map(({ domain, stopped }) => {
    const decision = decidePathStop(facts, domain, !stopped);
    if (!('refused' in decision)) return { domain, stopped, offer: stopped ? 'resume' : 'stop' };
    const held =
      stopped && decision.refused === 'not_running'
        ? 'not_running'
        : !stopped && decision.refused === 'last_one_copying' && facts.carried.length > 1
          ? 'last_one_copying'
          : undefined;
    return { domain, stopped, offer: null, ...(held === undefined ? {} : { held }) };
  });
}

/**
 * The refusal in words, the same on both editions. The last one points at
 * ending the migration, as D5 decided.
 */
export function pathStopRefusalReason(refusal: PathStopRefusal, domain: DiscoveryDomain): string {
  switch (refusal.refused) {
    case 'not_found':
      return 'Mapping not found';
    case 'not_running':
      return `A data type is stopped or resumed while its migration runs. This one is '${refusal.status}'.`;
    case 'not_a_path':
      return `This migration does not carry ${domain}.`;
    case 'not_stoppable':
      return refusal.phase === 'cutover'
        ? `${domain} is past its cutover, so there is nothing of its own to stop.`
        : `${domain} has ended ('${refusal.phase}'), so there is nothing to stop or resume.`;
    case 'last_one_copying':
      return `${domain} is the last data type still copying. To stop it, end the migration instead.`;
  }
}
