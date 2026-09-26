// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE ENDING OF ONE DATA TYPE (workplan 0128 T3, T5 slice 7; the owner's D3
 * and D8: *"the ending is chosen per data type"*).
 *
 * Where a migration ends, each data type is ended or kept on its own:
 *
 * - **End** makes it `done`. Its passes stop, its slot is let go, and what is
 *   copied stays. Its own failures still waiting on a decision hold it back
 *   unless the press is forced, as they hold back the whole migration's Finish.
 * - **Keep copying** puts it in the continuous lane (`continuous`). It goes on
 *   copying under the after-cutover rules, and holds a slot. Its failures do
 *   not hold it back: the lane goes on retrying them (D3).
 *
 * From before its cutover (`active`), either press is its cutover too, on the
 * attestation the Finish checklist asks for mail: End is one move, as the whole
 * migration's Finish is, and Keep is recorded as the cutover and then the lane
 * (D3). A data type ended can be kept later, and one kept can be ended.
 *
 * The migration's status is then its paths' roll-up (`writeTheRollUp`), in the
 * same transaction, as a cutover of one data type writes it: with every data
 * type ended, the migration is `done`. Each move is recorded as the path's own
 * (`path.phase`), and as the migration's (`mapping.status`) when the roll-up
 * moved it; an End pressed over open failures is recorded as forced, as the
 * whole migration's Finish is.
 *
 * Rows that do not add up to the status are not believed (`phasesOfThePaths`):
 * the status was written alone, by an operator setting it back by hand to
 * resume. The door then brings every row to the status first, as the whole
 * migration's doors do (`movePathsWithMapping`), so that ending one data type
 * of a migration resumed by hand does not end the rest with it.
 *
 * Refused while the migration is paused or never started, for a data type it
 * does not carry, and for Keep while its owner has it stopped: resume it first,
 * or end it. Ending a stopped data type clears the stop, which the ending
 * supersedes, so that it can be kept later.
 */

import { sql } from 'drizzle-orm';
import { rollUpPhases, type DiscoveryDomain, type MappingId, type TenantId } from '@openmig/shared';
import type { PgDatabase } from './db.ts';
import { PgLedger } from './ledger.ts';
import { holdsASlot, PgPathLifecycleStore, type PathState } from './path-lifecycle-store.ts';
import { readPathStopFacts, type PathStopFacts } from './a-stop-per-data-type.ts';
import { PATH_PHASE_ACTION, writeTheRollUp } from './a-cutover-of-one-data-type.ts';
import type { MappingStatus, MappingStatusVia } from './mapping-status-audit.ts';

/** The two endings a data type is given at the Finish checklist's last step. */
export type PathEnding = 'end' | 'keep';

/** The phases a data type is ended or kept from: started, and not held by a pause. */
export const PHASES_A_DATA_TYPE_ENDS_FROM: readonly string[] = ['active', 'cutover', 'done', 'continuous'];

export interface PathEndingChange {
  readonly mappingId: string;
  readonly domain: DiscoveryDomain;
  readonly ending: PathEnding;
  /** Who pressed it: the signed-in user, or `'operator'` on the appliance. */
  readonly actor: string;
  /** This data type's failures still waiting on a decision: they hold End back. */
  readonly unresolvedFailures: number;
  /** End anyway, over them, knowingly. */
  readonly force?: boolean;
}

/** Why an ending was refused. Nothing was written. */
export type PathEndingRefusal =
  | { readonly refused: 'not_found' }
  | { readonly refused: 'not_running'; readonly status: string }
  | { readonly refused: 'not_a_path' }
  | { readonly refused: 'stopped' }
  | { readonly refused: 'unresolved_failures'; readonly count: number };

export type PathEndingOutcome =
  | {
      /** False when it already was as asked: nothing was written. */
      readonly changed: false;
      readonly phase: string;
    }
  | {
      readonly changed: true;
      readonly from: string;
      readonly to: 'done' | 'continuous';
      /** The migration's status, when the roll-up moved it. */
      readonly migration?: { readonly from: string; readonly to: MappingStatus };
      /** True when the data type took a slot it did not hold: the month's peak may rise. */
      readonly slotsTaken: boolean;
    }
  | PathEndingRefusal;

/** What the door would do: refuse, change nothing, or move the data type through `steps`. */
export type PathEndingDecision =
  | Exclude<PathEndingRefusal, { readonly refused: 'not_found' }>
  | { readonly changes: false; readonly phase: string }
  | {
      readonly changes: true;
      readonly phase: string;
      readonly stopped: boolean;
      /** Rows that do not add up to the status: every row is brought to it first. */
      readonly believeTheStatus: boolean;
      readonly steps: ReadonlyArray<'cutover' | 'done' | 'continuous'>;
      /** An End pressed over open failures: the record says so, as Finish's does. */
      readonly forced: boolean;
    };

/**
 * The one rule: whether this press is accepted, from the facts alone.
 */
export function decidePathEnding(
  facts: PathStopFacts,
  domain: DiscoveryDomain,
  ending: PathEnding,
  { unresolvedFailures, force = false }: { readonly unresolvedFailures: number; readonly force?: boolean },
): PathEndingDecision {
  if (!PHASES_A_DATA_TYPE_ENDS_FROM.includes(facts.status)) return { refused: 'not_running', status: facts.status };
  const path = facts.carried.find((p) => p.domain === domain);
  if (path === undefined) return { refused: 'not_a_path' };
  const rows = facts.carried.flatMap((p) => (p.phase === undefined ? [] : [p.phase]));
  const believeTheStatus = rows.length > 0 && rollUpPhases(rows) !== facts.status;
  const phase = path.phase === undefined || believeTheStatus ? facts.status : path.phase;
  if (!PHASES_A_DATA_TYPE_ENDS_FROM.includes(phase)) return { refused: 'not_running', status: phase };

  if (ending === 'end') {
    if (phase === 'done') return { changes: false, phase };
    if (unresolvedFailures > 0 && !force) return { refused: 'unresolved_failures', count: unresolvedFailures };
    return { changes: true, phase, stopped: path.stopped, believeTheStatus, steps: ['done'], forced: unresolvedFailures > 0 };
  }
  if (phase === 'continuous') return { changes: false, phase };
  if (path.stopped) return { refused: 'stopped' };
  return {
    changes: true,
    phase,
    stopped: false,
    believeTheStatus,
    steps: phase === 'active' ? ['cutover', 'continuous'] : ['continuous'],
    forced: false,
  };
}

/** How each step is recorded: a cutover as one, End as a finish, Keep as the lane's update. */
const VIA: Record<'cutover' | 'done' | 'continuous', MappingStatusVia> = {
  cutover: 'cutover',
  done: 'finish',
  continuous: 'update',
};

/**
 * End or keep one data type. Call it inside the caller's own tenant
 * transaction; it writes nothing when it refuses.
 */
export async function endOrKeepPath(
  db: PgDatabase,
  tenantId: string,
  change: PathEndingChange,
): Promise<PathEndingOutcome> {
  const { mappingId, domain, ending } = change;
  const facts = await readPathStopFacts(db, tenantId, mappingId, { lock: true });
  if (facts === undefined) return { refused: 'not_found' };
  const decision = decidePathEnding(facts, domain, ending, change);
  if ('refused' in decision) return decision;
  if (!decision.changes) return { changed: false, phase: decision.phase };

  const t = tenantId as TenantId;
  const m = mappingId as MappingId;
  const store = new PgPathLifecycleStore(db);
  if (decision.believeTheStatus) {
    for (const path of facts.carried) {
      if (path.phase === undefined || path.phase === facts.status) continue;
      if (facts.status === 'active') await store.activate(t, m, path.domain);
      else await store.moveTo(t, m, path.domain, facts.status as Exclude<PathState, 'active'>);
    }
  }

  const ledger = new PgLedger(db);
  const forced = decision.forced ? { forced: true } : {};
  let from = decision.phase;
  for (const to of decision.steps) {
    await store.moveTo(t, m, domain, to);
    await ledger.recordAuditEvent(t, {
      actor: change.actor,
      action: PATH_PHASE_ACTION,
      entity: 'mapping',
      detail: { mappingId, domain, from, to, via: VIA[to], ...forced },
    });
    from = to;
  }
  if (decision.stopped) {
    await db.execute(sql`
      UPDATE path_lifecycle SET stopped_at = NULL, updated_at = now()
       WHERE mapping_id = ${mappingId} AND domain = ${domain}`);
  }

  const to = decision.steps[decision.steps.length - 1] as 'done' | 'continuous';
  const migration = await writeTheRollUp(db, tenantId, mappingId, { actor: change.actor, via: VIA[to], ...forced });
  return {
    changed: true,
    from: decision.phase,
    to,
    ...(migration === undefined ? {} : { migration }),
    slotsTaken: to === 'continuous' && !holdsASlot(decision.phase as PathState, false),
  };
}

/**
 * The refusal in words, the same on both editions. The page words its own,
 * from the code.
 */
export function pathEndingRefusalReason(refusal: PathEndingRefusal, domain: DiscoveryDomain): string {
  switch (refusal.refused) {
    case 'not_found':
      return 'Mapping not found';
    case 'not_running':
      return (
        `${domain} is ended or kept once its migration has started, and this one is ` +
        `'${refusal.status}'. Start it, or resume it, first.`
      );
    case 'not_a_path':
      return `This migration does not carry ${domain}.`;
    case 'stopped':
      return `${domain} is stopped. Resume it first to keep copying it, or end it.`;
    case 'unresolved_failures':
      return (
        `${refusal.count} item(s) of ${domain} could not be migrated and are awaiting a decision. ` +
        'Resolve them first (retry each item, or accept it to leave it behind), or end it anyway, ' +
        'which leaves them unmigrated, knowingly.'
      );
  }
}
