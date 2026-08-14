// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Items processed in parallel per collection when nothing says otherwise.
 *
 * **One number, in one place, on purpose.** It used to be four: a `const` in
 * `packages/core/src/reconcile.ts`, another in `packages/core/src/domain-sync.ts`,
 * a third in `packages/orchestration/src/build-deps.ts` — whose comment said "Matches
 * `DEFAULT_CONCURRENCY` in @openmig/core — kept in step deliberately, so the
 * managed and self-host paths do not quietly disagree about how hard they push
 * a customer's server" — and a bare `?? 4` in
 * `packages/orchestration/src/build-deps-from-mapping.ts`, which is the MANAGED path and
 * would not have moved with the others at all. Nothing checked the claim, and
 * hard rule 5 says the editions do not get to differ. A comment is not a
 * constraint; an import is.
 *
 * **Why 4.** This was briefly raised to 8 on the reasoning that the domains are
 * latency-bound rather than bandwidth-bound. A ~500-item run against Stalwart
 * disproved it as a *default*: the target began answering 429 to blob uploads
 * and to the `Email/query` existence lookup, and eight messages failed rather
 * than being migrated. Speed that the target refuses to accept is not speed.
 * 4 is the setting that has completed real runs.
 *
 * Raise it per mapping or per domain with `concurrency` in the config once you
 * know a specific target tolerates it — that is a decision about someone else's
 * server, so it belongs in their config and not in our default.
 */
export const DEFAULT_CONCURRENCY = 4;

/**
 * Run `worker` over `items` with at most `limit` in flight at once.
 *
 * Improves throughput on I/O-bound work (parallel fetch/write) while **bounding peak memory** —
 * at most `limit` items are processed concurrently, so at most `limit` payloads are held at once.
 * Completion order is not guaranteed. **Fail-fast:** on the first worker error it stops scheduling
 * new work, lets in-flight workers settle, then rejects with that first error.
 */
export async function mapWithConcurrency<T>(
  items: ReadonlyArray<T>,
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  const n = items.length;
  if (n === 0) return;
  const max = Math.max(1, Math.min(Math.floor(limit), n));

  let next = 0;
  let hasError = false;
  let firstError: unknown;
  const runner = async (): Promise<void> => {
    while (!hasError) {
      const i = next;
      next += 1;
      if (i >= n) return;
      const item = items[i];
      if (item === undefined) continue; // unreachable for i < n; satisfies noUncheckedIndexedAccess
      try {
        await worker(item, i);
      } catch (e) {
        if (!hasError) {
          hasError = true;
          firstError = e;
        }
        return; // fail-fast: stop pulling new work; in-flight workers settle, then we rethrow
      }
    }
  };

  await Promise.all(Array.from({ length: max }, () => runner()));
  if (hasError) throw firstError;
}
