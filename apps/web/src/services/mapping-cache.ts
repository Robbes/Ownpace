// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * FORGETTING A MAPPING'S LIFECYCLE, IN ONE PLACE.
 *
 * THE DEFECT THIS EXISTS TO FIX (the owner's live run, 2026-09-17): *"in the
 * Migrations view it shows Status 'Active' in green. But when i click on it ...
 * i read 'Paused' in yellow and next to that a button 'Review and start'."*
 *
 * Both screens read the truth from the server and one of them was five minutes
 * old. `App.tsx` gives every query `staleTime: 5 * 60 * 1000`, which is right
 * for a list somebody browses and wrong the moment that list's subject
 * CHANGES: the confirm screen started the migration and invalidated nothing,
 * so `['mapping', id]` kept answering from the cache it had filled before the
 * press — `paused`, with the button to start it again, for the next five
 * minutes. The list was fetched after the navigation and said `active`.
 *
 * Nobody can act on two answers. And the danger is not the confusion: it is
 * that the stale page offers *Review and start* on a migration that is already
 * running, and the person presses it.
 *
 * So every write that moves a mapping's lifecycle calls this, and this knows
 * both keys. It used to be one screen's job, done correctly on the migration's
 * own page and not done at all on the two other places lifecycle changes —
 * which is the shape of defect a helper removes rather than a rule about
 * remembering.
 */
import type { QueryClient } from '@tanstack/react-query';

/** The detail query's key, as `MappingDetail` and the hub screens spell it. */
export const mappingDetailKey = (mappingId: string): readonly unknown[] => ['mapping', mappingId];

/** The list query's key, as `Mappings` and the dashboard spell it. */
export const mappingListKey: readonly unknown[] = ['mappings'];

/**
 * A mapping was started, paused, resumed or finished: drop what both screens
 * believe about it.
 *
 * Awaited by callers that want the fresh answer on screen before they navigate
 * or re-enable a button; fire-and-forget is fine where the screen is about to
 * unmount. Invalidation only ever REFETCHES, so calling it twice costs one
 * request and never shows a wrong number.
 */
export async function forgetMappingLifecycle(
  client: QueryClient,
  mappingId: string,
): Promise<void> {
  await Promise.all([
    client.invalidateQueries({ queryKey: mappingDetailKey(mappingId) }),
    client.invalidateQueries({ queryKey: mappingListKey }),
  ]);
}
