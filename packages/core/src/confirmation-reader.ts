// Copyright 2026 The Ownpace authors (Apache-2.0)
//
// A real target, asked one item at a time (workplan 0117 T2, slice 5).
//
// `confirmation-pass.ts` says why this is a separate thing rather than
// `TargetReindexer` itself: *"that interface streams a whole account to rebuild
// idempotency state; this asks about one item at a time and has to survive one
// of them failing."* This is the bridge, and it is where the two shapes meet.
//
// ## One enumeration, then lookups — not one request per item
//
// `listEntries` is header/metadata only and pages, so walking it once and
// indexing by natural key is far cheaper than asking the target N times. The
// index holds short strings, not bodies: a hundred thousand of them is a few
// megabytes, and the thing D7(a) authorised paying for is the BODY fetch behind
// `hashOnTarget`, one item at a time, not the listing.
//
// **The index is a snapshot.** An item that appears on the target after the
// enumeration reads as absent. Nothing writes to the target during a
// confirmation pass, so this is true rather than merely convenient — but it is
// the assumption, and it is written down rather than left to be discovered.
//
// ## A target we could not list is not an empty target
//
// The rule this file exists to get right. If `listEntries` throws, every item
// must come back UNREACHABLE — *we could not tell* — and never absent. An
// enumeration failure read as absence would put `missing` on every row of
// somebody's account at once: *we placed it and it is gone*, about a whole
// library, on the document they delete their originals from.
//
// So the failure is captured and re-thrown per item, which is exactly what
// `answerFor` turns into `unreachable` (slice 2's first rule).

import {
  calendarNaturalKeyHash,
  contactNaturalKeyHash,
  fileNaturalKeyHash,
  naturalKeyHash,
  taskNaturalKeyHash,
  type DiscoveryDomain,
  type TargetEntry,
  type TargetReindexer,
} from '@openmig/shared';
import type { ConfirmableItem, ConfirmationReader } from './confirmation-pass.ts';

/**
 * How each domain turns a target's natural key into the ledger's key.
 *
 * A TOTAL `Record`, so a sixth domain is a compile error here rather than a
 * domain whose every item silently fails to match and reads as `missing`.
 * There is no single hashing function — mail normalises a Message-ID, files
 * take a path, the DAV domains take a UID — and pretending otherwise is how the
 * keys would drift apart.
 */
const KEY_OF: Readonly<Record<DiscoveryDomain, (naturalKey: string) => string>> = {
  email: naturalKeyHash,
  file: fileNaturalKeyHash,
  calendar: calendarNaturalKeyHash,
  contact: contactNaturalKeyHash,
  task: taskNaturalKeyHash,
};

/**
 * Build a reader over one domain's target.
 *
 * Enumerates immediately: the cost is paid once, up front, and a caller that
 * builds a reader has already decided to run a pass.
 *
 * `hashOnTarget` is present ONLY when the reindexer implements `contentHashFor`
 * — and its absence for CalDAV and CardDAV is deliberate and permanent
 * (`ports.ts`: those servers re-serialise what they store). The consequence
 * reaches all the way to the page: calendar, contacts and tasks come out
 * `present`, never `verified`. That is §7d's ceiling, and this is where it
 * actually bites.
 */
export async function readerOverTarget(args: {
  domain: DiscoveryDomain;
  reindexer: TargetReindexer;
  /** Scope the enumeration to one mailbox/collection, when the caller can. */
  mailboxId?: string;
}): Promise<ConfirmationReader> {
  const keyOf = KEY_OF[args.domain];
  const byKey = new Map<string, TargetEntry>();

  // Captured, not thrown here. Throwing from the build would fail the whole
  // pass on one unlistable domain; re-throwing per item makes every row of THAT
  // domain honestly `unchecked` and leaves the others alone.
  let enumerationFailed: unknown;
  try {
    for await (const entry of args.reindexer.listEntries(args.mailboxId)) {
      byKey.set(keyOf(entry.naturalKey), entry);
    }
  } catch (err) {
    enumerationFailed = err;
  }

  const refuse = (): never => {
    throw enumerationFailed instanceof Error
      ? enumerationFailed
      : new Error(`could not list the target: ${String(enumerationFailed)}`);
  };

  const hashOnTarget = args.reindexer.contentHashFor?.bind(args.reindexer);

  return {
    async isPresent(item: ConfirmableItem): Promise<boolean> {
      if (enumerationFailed !== undefined) refuse();
      return byKey.has(item.naturalKeyHash);
    },
    ...(hashOnTarget
      ? {
          async hashOnTarget(item: ConfirmableItem): Promise<string | undefined> {
            if (enumerationFailed !== undefined) refuse();
            const entry = byKey.get(item.naturalKeyHash);
            // Not on the target: there is nothing to hash, and `answerFor`
            // never asks in that case. Answering `undefined` rather than
            // throwing keeps a direct caller honest too.
            if (!entry) return undefined;
            return hashOnTarget(entry);
          },
        }
      : {}),
  };
}
