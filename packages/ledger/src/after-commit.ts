// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * What waits for its transaction to commit (workplan 0129 T4).
 *
 * An audit event's line for a collector must say only what happened. The row
 * is written inside `withTenant`'s transaction, and work after it in the same
 * transaction can still fail and roll the row back. A line printed at the
 * insert would then report an event the audit log never kept, to a store that
 * keeps it for ever. So the line waits: `afterCommit` holds it until
 * `withTenant` has committed, and drops it when the transaction rolls back.
 * Outside a transaction it runs at once, because a statement outside one has
 * committed by the time it returns.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { log } from '@openmig/shared';

/** One transaction's waiting work. */
export interface HeldUntilCommit {
  /** Run `body` so that what it hands `afterCommit` waits for this transaction. */
  during<T>(body: () => Promise<T>): Promise<T>;
  /** The transaction is over: run what waited if it committed, drop it if not. */
  end(committed: boolean): void;
}

interface Store {
  open: boolean;
  readonly waiting: Array<() => void>;
}

const current = new AsyncLocalStorage<Store>();

/** Run `then` once the transaction this runs in has committed, and never if it rolls back. */
export function afterCommit(then: () => void): void {
  const store = current.getStore();
  if (store?.open) store.waiting.push(then);
  else then();
}

/** A transaction's hold: `withTenant` opens one per transaction. */
export function holdUntilCommit(): HeldUntilCommit {
  const store: Store = { open: true, waiting: [] };
  return {
    during: (body) => current.run(store, body),
    end(committed) {
      store.open = false;
      const waiting = store.waiting.splice(0);
      if (!committed) return;
      for (const then of waiting) {
        // The transaction has committed: nothing that runs after it may undo
        // that by throwing into the caller.
        try {
          then();
        } catch (err) {
          log.warn(
            `[after-commit] work after a commit failed (${err instanceof Error ? err.message : 'unknown error'}); ` +
              'the transaction itself committed.',
          );
        }
      }
    },
  };
}
