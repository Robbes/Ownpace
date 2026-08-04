// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * §14.1's question, as a pure function (workplan 0027 T1).
 *
 * A shared address (info@, sales@) works one of two ways, and they migrate
 * differently:
 *
 *  - **Pattern S — a shared MAILBOX.** People jointly handle one store. What
 *    migrates is the full folder tree, incl. Sent/Drafts/Archive, copied
 *    idempotently — the existing mail path, unchanged (0027 T3).
 *  - **Pattern D — a distribution LIST.** Several people each receive the
 *    mail; there is usually no store at all. What migrates is the group
 *    DEFINITION and its member list, recreated on the target (0027 T2). The
 *    messages themselves already live in members' own mailboxes and ride
 *    their own syncs.
 *
 * The signal is whether the address has a store, and §14.1 says so directly:
 * "If an M365 group has a store, treat it as Pattern S."
 *
 * THE THIRD ANSWER IS THE POINT OF THIS FILE. When the directory did not say,
 * this returns no pattern and a reason — because both wrong guesses cost real
 * work. Guessing D for something that has a store silently drops a mailbox
 * full of mail from the migration. Guessing S for a distribution list tries to
 * copy a store that does not exist and recreates nothing, so mail sent to the
 * address after cutover reaches nobody. §11.2 anticipated exactly this: the
 * `decision` table has carried a `shared_address_pattern` category since
 * ledger v1, because the S-or-D question is *designed* to be asked.
 *
 * The wizard asks it in these words (§14.1): "Do recipients jointly handle one
 * shared mailbox, or should it work as a distribution list (multiple
 * recipients each receive the mail)?" Source detection provides a default; the
 * admin may override — which is why a confident answer here is still only a
 * default, never a lock.
 */

import type { DiscoveredGroup, GroupStore, SharedAddressPattern } from '@openmig/shared';

export type { SharedAddressPattern };

export interface SharedAddressClassification {
  /** Absent when the source did not say enough to tell. Never guessed. */
  readonly pattern?: SharedAddressPattern;
  /** Why, in words fit for a decision summary an owner reads. */
  readonly reason: string;
}

/** Classify from the store signal alone. */
export function classifyStoreSignal(store: GroupStore): SharedAddressClassification {
  switch (store) {
    case 'has_store':
      return {
        pattern: 'shared_s',
        reason:
          'it has its own message store, so there is a folder tree to copy ' +
          '(§14.1: an M365 group with a store is Pattern S)',
      };
    case 'no_store':
      return {
        pattern: 'distribution_d',
        reason:
          'it has no message store — mail sent to it is delivered into the ' +
          'members’ own mailboxes, so what migrates is the group definition ' +
          'and its member list (§14.1 Pattern D)',
      };
    case 'unknown':
      return {
        reason:
          'the source did not say whether this address has its own message ' +
          'store, and the two answers migrate differently: guessing a ' +
          'distribution list would silently leave a mailbox full of mail ' +
          'behind, and guessing a shared mailbox would recreate no group, so ' +
          'mail sent to the address after cutover would reach nobody',
      };
  }
}

/**
 * Classify a discovered group, including what its membership implies.
 *
 * A member list that could NOT be read does not change the pattern — the
 * store signal is what §14.1 turns on — but it does change what may be done
 * with the answer, so it is reported rather than folded away. See
 * {@link membersUsable}.
 */
export function classifySharedAddress(group: DiscoveredGroup): SharedAddressClassification {
  return classifyStoreSignal(group.store);
}

/**
 * Whether this group's member list is safe to act on.
 *
 * Pattern D recreates a group FROM the member list. A list that was never
 * read is `[]`, and recreating that produces an empty group on the target
 * that looks finished — the failure mode hard rule 9 exists to prevent. So
 * the answer is stored as "not known" and T2 refuses it, rather than the
 * discovery step dropping the group entirely: the address is a real finding
 * and belongs on the Review & confirm screen either way.
 */
export function membersUsable(group: DiscoveredGroup): boolean {
  return group.members.kind === 'listed';
}

/**
 * The summary an owner reads when the pattern has to be asked.
 *
 * Written as a question about their organisation rather than about our data
 * model: the person answering knows how info@ is used, not what a `groupTypes`
 * array said.
 */
export function sharedAddressQuestion(group: DiscoveredGroup): string {
  const name = group.displayName ? `${group.displayName} (${group.address})` : group.address;
  return (
    `Do recipients jointly handle one shared mailbox at ${name}, or should it ` +
    `work as a distribution list where each recipient receives the mail? ` +
    `We could not tell from the source: ${classifySharedAddress(group).reason}.`
  );
}
