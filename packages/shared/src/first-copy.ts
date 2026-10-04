// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * WHEN A PERSON'S FIRST COPY IS IN (workplan 0154 T7).
 *
 * The owner, 2026-09-28, on the first-copy email: *"One per person"*. It is
 * sent once, when the last of a person's migrations finishes its first
 * complete pass, and names each data type. This is the rule for "finished",
 * for both editions: the managed worker asks it about a person, the appliance
 * about its one person, who is every migration it has.
 *
 * A DATA TYPE HAS ARRIVED when a pass over it reached the end: its
 * `migration_status.completed_at`, which `markCompleted` alone writes and
 * nothing clears. It is the stages' *copied once* (`completedOnce`,
 * `stage.ts`) and the managed tick's *first copy finished* (0156 T5).
 *
 * WHICH DATA TYPES COUNT: those in the migration's scope that will be copied.
 * Not one its owner stopped (0128 T4), and not one waiting to start (`ready`,
 * photos waiting for a Takeout export): either would hold the news of the
 * mail back for a copy nobody is making. One paused after it arrived has
 * still arrived.
 *
 * A MIGRATION IS IN when it has a data type that counts and every one that
 * counts has arrived. One with none, made and never started, is not: nothing
 * has arrived. A PERSON IS IN when every migration of theirs is.
 */
import { DISCOVERY_DOMAINS, type DiscoveryDomain } from './discovery.ts';

/** One data type of one migration, as its first copy reads it (`readFirstCopyFacts`, ledger). */
export interface FirstCopyDataType {
  readonly domain: DiscoveryDomain;
  /** Its phase: its path's state, or the migration's status where it has no path. */
  readonly phase: string;
  /** Stopped by its owner (0128 T4). */
  readonly stopped: boolean;
  /** A pass over it reached the end (`completed_at`). */
  readonly completed: boolean;
}

/** One migration's data types, as its first copy reads them. */
export interface FirstCopyFacts {
  readonly dataTypes: readonly FirstCopyDataType[];
}

export interface FirstCopy {
  /** Every migration's first copy is in. */
  readonly complete: boolean;
  /** The data types that count, across the migrations, each once, in the product's order. */
  readonly domains: readonly DiscoveryDomain[];
}

const counts = (d: FirstCopyDataType): boolean => !d.stopped && d.phase !== 'ready';

/** Whether a person's migrations have all finished their first copy (0154 T7). */
export function firstCopyOf(migrations: readonly FirstCopyFacts[]): FirstCopy {
  const counted = migrations.map((m) => m.dataTypes.filter(counts));
  const complete =
    counted.length > 0 && counted.every((types) => types.length > 0 && types.every((d) => d.completed));
  const named = new Set(counted.flat().map((d) => d.domain));
  return { complete, domains: DISCOVERY_DOMAINS.filter((d) => named.has(d)) };
}
