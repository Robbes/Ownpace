// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * ONE fan-out over the five domains' targets, which both editions feed
 * (workplan 0117 T2; owner decision 2026-09-11, option (b)).
 *
 * ## What was here before, and what it cost
 *
 * Opening "every domain's target that can enumerate itself" was written TWICE,
 * once per edition, and neither copy knew about the other:
 *
 * | | managed | appliance |
 * |---|---|---|
 * | deps from | connection ROWS (`build-deps-from-mapping.ts`, a `Pool`) | the `MappingConfig` file (`build-deps.ts`, an injected ledger handle) |
 * | assembled by | `buildTargetReindexers` | `verifyMapping`'s own inline `collect` |
 *
 * Both loops did the same four things — open a domain, keep it only if its
 * target implements `listEntries`, release the ones not kept, and release them
 * all at the end — and each had to be updated by hand when a domain was added.
 *
 * **`build-reindexers.ts` records what happens when one of them is not.** The
 * task domain got a source, a writer, a ledger row, a tick, a place in the
 * report and named assertions in both gates, and never a line in one of these
 * loops. Nothing failed: a lookup answered `undefined`, every layer above read
 * it as an honest no, and E2E #168 reported `tasks 0/4` about a target the
 * tasks were sitting on.
 *
 * Adding the confirmation pass was about to make it three copies, on the one
 * document somebody deletes their originals from. Hence this.
 *
 * ## The shape: the editions differ in ONE function
 *
 * Everything that differs between them is "how do I open this domain's deps" —
 * a row-built target in the managed worker, a config-built one on the
 * appliance. That is an `OpenTarget`, supplied by the caller. Everything else
 * is here, once.
 *
 * ## It speaks the LEDGER's spelling, and translates at the edge
 *
 * There are three spellings of these five domains in this repository and they
 * are one letter apart in places:
 *
 *   - `email | calendar | contact | file | task` — the ledger (`DiscoveryDomain`)
 *   - `mail | calendar | contacts | files | tasks` — the verification gate
 *   - `mail | calendar | contact | file | task` — `buildDomainDepsFromMapping`
 *
 * The gap between the first two is the one that cost `tasks 0/4`. So this
 * module speaks `DiscoveryDomain` throughout — the ledger's, because that is
 * what the rows are keyed by — and every translation is a TOTAL `Record`, so a
 * sixth domain is a compile error rather than a domain that quietly confirms
 * nothing and reports it as an account with nothing in it.
 */

import { DISCOVERY_DOMAINS, log, type DiscoveryDomain } from '@openmig/shared';

/** Domains the verification gate knows about, in its own spelling. */
export type VerificationDomain = 'mail' | 'calendar' | 'contacts' | 'files' | 'tasks';

/**
 * The gate's name for each ledger domain. TOTAL, so a sixth fails to compile.
 *
 * The four that differ are written out rather than derived, and that is the
 * point: `contacts` and `contact` are one letter apart, so anything that
 * computed this from the thing it describes would agree with itself while the
 * product disagreed.
 */
export const GATE_NAME: Readonly<Record<DiscoveryDomain, VerificationDomain>> = {
  email: 'mail',
  calendar: 'calendar',
  contact: 'contacts',
  file: 'files',
  task: 'tasks',
};

/** The ledger's name for each gate domain — the same map, read the other way. */
export const LEDGER_DOMAIN: Readonly<Record<VerificationDomain, DiscoveryDomain>> = {
  mail: 'email',
  calendar: 'calendar',
  contacts: 'contact',
  files: 'file',
  tasks: 'task',
};

/** A target that has been opened, and the release that goes with it. */
export interface OpenedTarget {
  readonly target: unknown;
  close(): Promise<void>;
}

/**
 * How ONE edition opens ONE domain's target. The only thing that differs.
 *
 * Throwing is a normal answer: a mapping with no DAV connection configured has
 * no calendar target, and that domain is left out rather than failing the whole
 * fan-out. The reason is logged.
 */
export type OpenTarget = (domain: DiscoveryDomain) => Promise<OpenedTarget>;

/**
 * What to keep from an opened target, or `undefined` to leave the domain out.
 *
 * The verification gate keeps it when it implements `listEntries`; the
 * confirmation pass wraps it in a `ConfirmationReader` first. A domain this
 * answers `undefined` for is released immediately rather than held open for
 * something we will report as unreadable anyway.
 */
export type KeepTarget<T> = (
  target: unknown,
  domain: DiscoveryDomain,
) => Promise<T | undefined> | T | undefined;

export interface FannedOut<T> {
  /** What was kept, keyed by the LEDGER's spelling. */
  readonly byDomain: Partial<Record<DiscoveryDomain, T>>;
  /** The domains that actually got one — what a caller should be asked to run. */
  readonly domains: readonly DiscoveryDomain[];
  /** Release every connection this opened, including on the way out of a throw. */
  close(): Promise<void>;
}

/**
 * Open each wanted domain's target and keep the ones the caller can use.
 *
 * ENUMERATES NOTHING ITSELF, but `keep` may: `readerOverTarget` walks the whole
 * account when it is built. So the expensive call is the caller's, and the
 * caller has already decided to pay for it.
 *
 * **Only the WANTED domains are opened.** The first version of the confirmation
 * builder opened all five and then discarded the ones not asked for, which is a
 * connection and a walk per domain nobody wanted.
 */
export async function fanOutTargets<T>(args: {
  /** Which domains to try. Anything outside this is not opened at all. */
  wanted: readonly DiscoveryDomain[];
  open: OpenTarget;
  keep: KeepTarget<T>;
  /** What to call this in the log — `[verify]`, `[confirm]`. */
  label: string;
}): Promise<FannedOut<T>> {
  const byDomain: Partial<Record<DiscoveryDomain, T>> = {};
  const closers: Array<() => Promise<void>> = [];

  /**
   * Release what is already open, then rethrow.
   *
   * A fan-out that dies halfway must not leave one connection per domain held
   * behind it — the caller never receives the `close()` it would have used.
   */
  const releaseAndRethrow = async (err: unknown): Promise<never> => {
    await Promise.allSettled(closers.map((c) => c()));
    throw err;
  };

  for (const domain of args.wanted) {
    let opened: OpenedTarget;
    try {
      opened = await args.open(domain);
    } catch (err) {
      // Not a failure of the fan-out. A mapping with no connection for this
      // domain has no target for it, and leaving the domain OUT is the honest
      // outcome: the gate reports it unverifiable, and a confirmation leaves
      // its rows `unchecked` rather than calling them missing.
      log.warn(
        `${args.label} no ${domain} target for this mapping: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }

    let kept: T | undefined;
    try {
      kept = await args.keep(opened.target, domain);
    } catch (err) {
      // `keep` can do real work — `readerOverTarget` enumerates the account —
      // so it can fail for its own reasons. Release THIS target before
      // unwinding the rest, since it never reached the closers list.
      await opened.close().catch(() => {});
      return releaseAndRethrow(err);
    }

    if (kept === undefined) {
      // Opened fine but unusable. Release it again rather than hold a
      // connection open for a domain we will report as unreadable anyway.
      await opened.close();
      continue;
    }
    byDomain[domain] = kept;
    closers.push(() => opened.close());
  }

  return {
    byDomain,
    domains: DISCOVERY_DOMAINS.filter((d) => byDomain[d] !== undefined),
    async close() {
      // Close them all even if one throws; a failed release must not strand
      // the rest. The first failure is reported, not swallowed.
      const results = await Promise.allSettled(closers.map((c) => c()));
      const failed = results.find((r) => r.status === 'rejected');
      if (failed && failed.status === 'rejected') throw failed.reason;
    },
  };
}

/**
 * Does this target expose the reindex contract?
 *
 * The verification gate's `keep`, and the confirmation pass's first step. A
 * target that cannot enumerate itself must never be included: that is how one
 * domain ends up measured against another domain's listing.
 */
export function asReindexer<T extends { listEntries: unknown }>(target: unknown): T | undefined {
  const candidate = target as { listEntries?: unknown } | null | undefined;
  return typeof candidate?.listEntries === 'function' ? (candidate as T) : undefined;
}
