// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Deps-lifecycle helper (bug fix — self-host pool leak).
 *
 * The deps-builders (`build-deps.ts`, `build-deps-from-mapping.ts`) used to
 * open a Postgres pool (`createPgDb`) to back the ledger/cursor stores for a
 * single pass. That pool had to be released when the pass finished, or a
 * long-running process (the self-host appliance's scheduler, a busy worker)
 * leaked a pool per pass until Postgres ran out of connections.
 *
 * The deps interfaces (`ReconcileDeps`, `CalendarSyncDeps`, …) are shared and
 * carry no disposal hook, so we augment the returned object with a `close()`.
 * Callers run the pass in `try { … } finally { await deps.close() }`.
 * `close()` is idempotent (we guard against a double call).
 *
 * Since workplan 0138 T1 part 2 no builder opens a pool: each is handed its
 * handle (the config-file builders a `ledgerDb`, the from-mapping builders
 * their caller's `pool`), and the caller ends it. So every builder passes
 * `HANDED_BY_THE_CALLER`, and `close()` releases nothing of the builder's. It
 * stays so that every caller's `finally` is unchanged, and so a builder that
 * one day opens something has one place to release it.
 */

/** Deps augmented with a handle that releases what the builder opened, if anything. */
export type WithClose<T> = T & { readonly close: () => Promise<void> };

/** What a builder closes when its handle is the caller's: nothing. */
export const HANDED_BY_THE_CALLER: { readonly close: () => Promise<void> } = Object.freeze({
  close: async (): Promise<void> => {},
});

/** Attach an idempotent `close()` (backed by `db.close()`) to a deps object. */
export function withClose<T extends object>(
  deps: T,
  db: { close: () => Promise<void> },
): WithClose<T> {
  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    await db.close();
  };
  return Object.assign(deps, { close }) as WithClose<T>;
}
