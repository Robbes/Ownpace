// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WORK ALREADY RUNNING WHEN THE ACCOUNT CLOSES STOPS BETWEEN ITS STEPS
 * (workplan 0139 T7; terms briefing, precondition B; `site/legal/README.md`,
 * *Nothing uses your access after closing*).
 *
 * Since #1320 nothing new starts for a closed organisation: the tick starts no
 * pass, a pass under way stops before its next data type, and the builders of
 * every reader refuse. A verification, a confirmation or a discovery that was
 * already running had built its readers before the close, so the builders'
 * refusal never reached it; the close asks the orchestrator to cancel only the
 * runs whose row names the orchestrator's run, and only a sync pass records
 * one. Each read on to its end with the stored access.
 *
 * So each asks, between its steps, whether its organisation is still open:
 * the verification before each read of a target (`runVerification`), the
 * confirmation before each data type and each item (`runConfirmationPass`),
 * the discovery before each collection (`discoverSource`). The read in flight
 * when the close lands finishes; nothing after it begins.
 *
 * The question is the CALLER's, because the answer lives in the ledger and
 * this package does not reach for one (`organisationStillOpen` in
 * `@openmig/ledger` is the managed worker's and the orchestration's answer).
 * Left out, nobody asks: the appliance's one organisation is always open.
 */

import { CredentialRefusalError, organisationClosedRefusal } from '@openmig/shared';

/** Is the organisation still open? A fresh read each time it is asked. */
export type OrganisationIsOpen = () => Promise<boolean>;

/**
 * Throw the close's own refusal once the organisation is no longer open.
 *
 * The same refusal the builders throw (`refuseAClosedOrganisation`), with the
 * same code, `account_closed`, and the same sentence in both languages, so a
 * run stopped by the close between its steps records what a run started after
 * the close records: no verdict, and the close as the reason. Without the
 * days, which are the managed edition's.
 */
export async function refuseOnceClosed(isOpen: OrganisationIsOpen | undefined): Promise<void> {
  if (isOpen === undefined) return;
  if (!(await isOpen())) {
    throw new CredentialRefusalError(organisationClosedRefusal({ closedAt: null, purgeAfter: null }));
  }
}
