// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Running shared-address discovery (workplan 0027 T1, the wiring half).
 *
 * `classifySharedAddress` decides WHAT a discovered address is; this decides
 * what happens around it — reading the source's groups, recording them, and
 * counting what the run found. Behind a deps seam because the reader is a
 * connector, the writer is a ledger store, and the appliance and the managed
 * worker supply different ones, while the rules below must not differ.
 *
 * FOUR RULES, each of them a way this could go wrong in production:
 *
 *  1. **A source that cannot look says so, and writes nothing.** IMAP has no
 *     directory of groups; a delegated Graph connection cannot read
 *     `/groups`. Recording zero groups for those sources would put "no shared
 *     addresses" on the Review & confirm screen, which is a claim about the
 *     owner's organisation that nobody checked (hard rule 9).
 *  2. **Re-running converges.** Discovery runs before every migration and
 *     again during shadow. The store's upsert makes the second pass update the
 *     group it already knows; this loop must not invent a second row by, say,
 *     keying on the display name (hard rule 1).
 *  3. **An unread member list is recorded as unread.** Pattern D recreates a
 *     group from exactly that list, so `[]` from a failed read must not reach
 *     the target as an empty group. The group is still recorded — its
 *     existence was read successfully, and dropping it would hide a real
 *     shared address from the owner.
 *  4. **One group failing does not stop the others.** A write that throws is
 *     reported and the loop continues.
 */

import type {
  GroupListing,
  TenantId,
  SharedAddressPattern,
  RaiseDecisionInput,
} from '@openmig/shared';
import {
  classifySharedAddress,
  membersUsable,
  sharedAddressQuestion,
} from './classify-shared-address';

/** What discovery hands the ledger for one address. */
export interface RecordGroupInput {
  readonly sourceConnectionId: string;
  readonly address: string;
  readonly sourceGroupId?: string;
  readonly displayName?: string;
  readonly pattern?: SharedAddressPattern;
  readonly members: readonly string[];
  readonly membersKnown: boolean;
}

export interface GroupDiscoveryDeps {
  readonly tenantId: TenantId;
  /** Which source connection this pass is reading. Part of a group's identity. */
  readonly sourceConnectionId: string;
  /** Ask the source for its groups — or for the reason it cannot. */
  listGroups(): Promise<GroupListing>;
  /** Record one. `created` false means it was already known. */
  record(input: RecordGroupInput): Promise<{ readonly created: boolean }>;
  /**
   * Ask the S-or-D question for an address the source did not classify
   * (workplan 0028 T3). Idempotent at the database on (tenant, category,
   * subjectKey), so re-running converges on the same open question rather
   * than growing the queue. Omit the dep to discover without asking.
   */
  raise?(input: RaiseDecisionInput): Promise<{ readonly created: boolean; readonly id: string }>;
  /**
   * Tell somebody about a question that is NEW. Called once per created
   * decision, never for one that was already pending — an hourly detector
   * would otherwise email about the same address until it was answered.
   */
  onRaised?(input: RaiseDecisionInput): Promise<void>;
  warn(message: string): void;
  error(message: string, err: unknown): void;
}

export interface GroupDiscoverySummary {
  /** Shared addresses recorded for the first time. */
  readonly discovered: number;
  /** Already known; re-read and refreshed. */
  readonly known: number;
  /** Recorded without a pattern — the S-or-D question has to be asked. */
  readonly unclassified: number;
  /** Questions raised into the decision queue, and announced (0028 T3). */
  readonly asked: number;
  /** Unclassified addresses whose question was already open. Not re-announced. */
  readonly alreadyAsked: number;
  /** Recorded, but whose membership could not be read. Not recreatable yet. */
  readonly membersUnknown: number;
  /** Writes that threw. Reported, never silent. */
  readonly failed: number;
  /** Present when the source could not be asked at all, in its own words. */
  readonly blindSpot?: string;
}

const EMPTY: GroupDiscoverySummary = {
  discovered: 0,
  known: 0,
  unclassified: 0,
  asked: 0,
  alreadyAsked: 0,
  membersUnknown: 0,
  failed: 0,
};

/** One discovery pass. Never throws for one group's sake. */
export async function runGroupDiscovery(
  deps: GroupDiscoveryDeps,
): Promise<GroupDiscoverySummary> {
  const listing = await deps.listGroups();

  if (listing.kind === 'not_enumerable') {
    // Rule 1. Said every run, not once: an operator reading today's log must
    // see that today's pass could not look, without digging back to the first
    // time it happened.
    deps.warn(`[groups] ${deps.tenantId}: ${listing.reason}`);
    return { ...EMPTY, blindSpot: listing.reason };
  }

  let discovered = 0;
  let known = 0;
  let unclassified = 0;
  let asked = 0;
  let alreadyAsked = 0;
  let membersUnknown = 0;
  let failed = 0;

  for (const group of listing.groups) {
    const { pattern } = classifySharedAddress(group);
    const usable = membersUsable(group);

    if (!usable) {
      // Rule 3. Loud, because a group nobody can recreate is a hole in the
      // migration that would otherwise only show up after cutover.
      deps.warn(
        `[groups] ${deps.tenantId}: recorded ${group.address} but could not read its ` +
          `members: ${group.members.kind === 'not_enumerable' ? group.members.reason : ''}`,
      );
    }

    try {
      const { created } = await deps.record({
        sourceConnectionId: deps.sourceConnectionId,
        address: group.address,
        ...(group.id ? { sourceGroupId: group.id } : {}),
        ...(group.displayName ? { displayName: group.displayName } : {}),
        ...(pattern ? { pattern } : {}),
        members: group.members.kind === 'listed' ? group.members.addresses : [],
        membersKnown: usable,
      });
      if (created) discovered++;
      else known++;
    } catch (err) {
      // Rule 4.
      deps.error(`[groups] ${deps.tenantId}: could not record ${group.address}`, err);
      failed++;
      continue;
    }

    // Counted after the write succeeded: an address nobody recorded is not an
    // open question, it is a lost one — and the same for a membership nobody
    // recorded as missing.
    if (!pattern) unclassified++;
    if (!usable) membersUnknown++;

    // The S-or-D question (workplan 0028 T3). Only for an address the source
    // did not classify — a group we CAN tell apart is not a question, and
    // asking about it would be the noise that teaches owners to ignore the
    // queue. Deliberately raised without a `proposedDefault`: this category
    // has no default, which is the whole reason it is being asked, and the
    // screen offers the two named answers instead of an accept button.
    if (pattern || !deps.raise) continue;

    const question: RaiseDecisionInput = {
      tenantId: deps.tenantId,
      category: 'shared_address_pattern',
      // The ADDRESS, not the group id: the question is about how info@ is
      // used, so a group renamed or recreated with the same address is the
      // same open question and must not be asked twice.
      subjectKey: group.address,
      summary: sharedAddressQuestion(group),
      detail: {
        address: group.address,
        ...(group.displayName ? { displayName: group.displayName } : {}),
        ...(group.id ? { sourceGroupId: group.id } : {}),
        sourceConnectionId: deps.sourceConnectionId,
      },
    };

    let created: boolean;
    try {
      ({ created } = await deps.raise(question));
    } catch (err) {
      // Rule 4 again: a question that could not be asked is reported, and the
      // group stays recorded — the next pass asks it.
      deps.error(
        `[groups] ${deps.tenantId}: recorded ${group.address} but could not ask which pattern it is`,
        err,
      );
      continue;
    }

    if (!created) {
      // Already pending, already announced. Counted so a run's output shows
      // the pass is working rather than looking idle.
      alreadyAsked++;
      continue;
    }
    asked++;

    try {
      await deps.onRaised?.(question);
    } catch (err) {
      // The decision is in the queue and the screen has it; the email was the
      // courtesy. Losing the courtesy must not lose the record.
      deps.error(
        `[groups] ${deps.tenantId}: asked about ${group.address} but could not announce it`,
        err,
      );
    }
  }

  return { discovered, known, unclassified, asked, alreadyAsked, membersUnknown, failed };
}
