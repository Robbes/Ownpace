// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A CLOSED ORGANISATION, AT EVERY DOOR THAT WOULD START WORK (workplan 0085
 * T2; the owner's report of 2026-09-28, and their answer "Every write door
 * (Recommended)").
 *
 * Closing an organisation stops everything that starts a pass, re-arms one,
 * or uses the access it gave, until a reopen or the erasure. For the API that
 * is every door that enqueues (they all ask `enqueueUnlessHeld`, which reads
 * the close first) and every door that re-arms the tick or uses the stored
 * access itself: creating a migration, moving one into the lane, adding,
 * resuming or keeping a data type, adding, testing or re-keying a connection,
 * the permission report, the sharing rescan and the share applies, and a grant
 * link's consent and ending. Each of those asks here.
 *
 * Reading, export, the close itself and the reopen are never refused, and a
 * door that stops or ends work is not either: stopping is not starting.
 * `authenticate` never asks, because the owner reopens through it.
 *
 * ## The answer
 *
 * 409 `account_closed`, in the shape the hold and a withdrawn grant answer
 * with: `message` and `reason` carry one English sentence, as this API's
 * refusals do, and `messageNl` and `reasonNl` its Dutch, for the pages a link
 * holder reads in their own language. The sentence names the day of the close
 * and the day the data is removed (`organisationClosedRefusal`), as UTC dates;
 * `closedAt` and `purgeAfter` carry the same two moments.
 *
 * A read that fails is not "open" (hard rule 9): the error goes to the door's
 * own catch, which answers 500.
 */

import type { Response } from 'express';
import type { Pool } from 'pg';
import type { LedgerDriver } from '@openmig/ledger';
import { readOrganisationClosure } from '@openmig/managed';
import { ACCOUNT_CLOSED, organisationClosedRefusal, type OrganisationClosure } from '@openmig/shared';
import { withTenantDb } from './middleware/auth.ts';

/** What a door answers for a closed organisation. */
export interface AccountClosedAnswer {
  readonly error: typeof ACCOUNT_CLOSED;
  readonly message: string;
  readonly messageNl: string;
  readonly reason: string;
  readonly reasonNl: string;
  /** ISO, or null when the close's own row could not say. */
  readonly closedAt: string | null;
  /** ISO, or null when the close's own row could not say. */
  readonly purgeAfter: string | null;
}

/** The answer for a close the caller has already read. */
export function accountClosedAnswer(closure: OrganisationClosure): AccountClosedAnswer {
  const refusal = organisationClosedRefusal(closure);
  return {
    error: ACCOUNT_CLOSED,
    message: refusal.en,
    messageNl: refusal.nl,
    reason: refusal.en,
    reasonNl: refusal.nl,
    closedAt: closure.closedAt?.toISOString() ?? null,
    purgeAfter: closure.purgeAfter?.toISOString() ?? null,
  };
}

/**
 * The answer a door gives when this organisation is closed, or null while it
 * is open. For a door that answers in a form of its own (the consent's
 * ending is a page, not JSON).
 */
export async function closedOrganisation(
  tenantId: string,
  source: Pool | LedgerDriver,
): Promise<AccountClosedAnswer | null> {
  const closure = await withTenantDb(tenantId, source, (db) => readOrganisationClosure(db, tenantId));
  return closure ? accountClosedAnswer(closure) : null;
}

/**
 * Answer 409 and return true when this organisation is closed; return false,
 * having answered nothing, while it is open. Asked before the door's first
 * write and before it opens any stored access.
 */
export async function refusedAsClosed(
  res: Response,
  tenantId: string,
  source: Pool | LedgerDriver,
): Promise<boolean> {
  const answer = await closedOrganisation(tenantId, source);
  if (!answer) return false;
  res.status(409).json(answer);
  return true;
}
