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
//
// ## The bytes are the tenant's, not this pass's (D9)
//
// D7(a) re-reads every item's BYTES off the target, and D9 settled who pays:
// *"(a) it shares the tenant's budget. The limit belongs to the PROVIDER, not
// to us, so splitting it into two budgets is pretending we have twice the
// allowance we do."*
//
// Concretely, and this is the gap D9 names rather than a tidy-up:
// `buildTargetWriterFromCredentials` takes neither a throttle limiter nor a
// meter, so nothing that reads the TARGET has ever been budgeted — every
// existing caller only writes to it, one item at a time, behind a pass that is
// already gated on the source. A confirmation pass is the first thing to read a
// target at the scale of the whole account, so it is the first thing that has
// to carry the target's side of the tenant's budget.
//
// The split is 0090's, unchanged: the CONNECTOR spends and the PASS gates
// (`imapflow-source.ts` spends, `domain-sync.ts` reads the meter and stops).
// Here this file is the connector half — it spends what a body read cost and
// waits for a rate token — and `confirmation-run.ts` is the pass half, because
// only the loop can stop taking new work. One meter instance, two roles.

import {
  calendarNaturalKeyHash,
  contactNaturalKeyHash,
  fileNaturalKeyHash,
  naturalKeyHash,
  taskNaturalKeyHash,
  type ByteBudget,
  type DiscoveryDomain,
  type RateBudget,
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
 * THE TENANT'S BUDGET FOR THE TARGET'S PROVIDER — the key, then the two halves.
 *
 * Both budgets are keyed by `(tenant, provider)`, so the key is the carrier and
 * each budget is optional beside it. That ordering is not tidiness: it was
 * `{ meter, rate? }` first — the meter carrying the key, the way `DownloadMeter`
 * does — and building the caller found what that costs. **A target with no
 * published byte ceiling then gets no RATE limiting either**, because there is
 * no meter to hang the key on. That is every target this product writes to: a
 * ceiling is a number somebody published, and the only one we know is Gmail's
 * IMAP download limit, which belongs to a SOURCE. So the shape would have
 * switched off the half of D9 that actually bites — the half that makes a
 * confirmation queue behind a migration instead of racing it — on every
 * deployment, silently, while looking wired.
 *
 * The key is spelled out here rather than taken from a budget for the reason
 * 0082 T5 records: `PgRateBudget.acquire` read its tenant from whatever the
 * caller passed, and every caller passed a label of its own — `dav`, or Entra's
 * `common` — so one tenant's budget was every tenant's.
 *
 * Whatever is supplied is the SAME instance a migration against that provider
 * uses. That is the whole of D9: not a second allowance, the one allowance,
 * shared.
 */
export interface TargetBudget {
  /** The tenant whose allowance this is. */
  readonly tenantId: string;
  /** The target's provider — what a ceiling and a rate both belong to. */
  readonly provider: string;
  /**
   * Bytes off the target, when a published ceiling exists for this provider.
   *
   * Absent is the ordinary case and means *no ceiling is known*, never *no
   * counting needed* — the same answer `imapDownloadPlan` gives a self-hosted
   * server, and for the same reason: a cap invented for a server that has none
   * would be this file's own way of making a confirmation mysteriously slow.
   */
  readonly meter?: ByteBudget;
  /** Requests against the target. Absent when a deployment wires none. */
  readonly rate?: RateBudget;
}

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
  /**
   * The tenant's budget for THIS target's provider (D9). Absent means no
   * ceiling is known for it — not "no counting needed" but "nothing to count
   * against", which is the same answer `imapDownloadPlan` gives a self-hosted
   * server and for the same reason.
   */
  budget?: TargetBudget;
}): Promise<ConfirmationReader> {
  const keyOf = KEY_OF[args.domain];
  const byKey = new Map<string, TargetEntry>();

  // One token per request against the target, from the budget the migration
  // uses. `acquire` WAITS rather than refusing (`RateBudget`'s contract): a
  // confirmation that is slow because a migration is running is D9's accepted
  // cost, and a confirmation that FAILS because one is would not be.
  const budget = args.budget;
  const token = async (): Promise<void> => {
    if (budget?.rate) await budget.rate.acquire(budget.tenantId, budget.provider);
  };

  // Captured, not thrown here. Throwing from the build would fail the whole
  // pass on one unlistable domain; re-throwing per item makes every row of THAT
  // domain honestly `unchecked` and leaves the others alone.
  let enumerationFailed: unknown;
  try {
    // One token before the listing, not one per entry: `listEntries` pages
    // internally and this loop cannot see the page boundaries, so a token per
    // yielded entry would charge a hundred thousand requests for the handful
    // that were actually made. Under-counting the listing is the honest error
    // here — the bytes it costs are metadata, and the reads worth budgeting
    // are the bodies below.
    await token();
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
            // throwing keeps a direct caller honest too. Nothing is spent and
            // no token taken — no request is made.
            if (!entry) return undefined;
            await token();
            const hash = await hashOnTarget(entry);
            // Spent AFTER the read, and only what the target itself reported.
            // `sizeBytes` is *"what lets verification report totalBytesTarget
            // as a real measurement"* and its own rule is to leave it undefined
            // rather than guess; an estimate here would move a ceiling whose
            // penalty is a lockout of somebody's live account. So an unmeasured
            // item counts zero: the meter under-reads, which errs toward
            // finishing the pass rather than toward stopping a migration that
            // had budget left.
            if (budget?.meter) {
              await budget.meter.spend(budget.tenantId, budget.provider, entry.sizeBytes ?? 0);
            }
            return hash;
          },
        }
      : {}),
  };
}
