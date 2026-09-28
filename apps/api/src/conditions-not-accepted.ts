// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * NO CREDENTIAL STORED BEFORE THE CONDITIONS ARE ACCEPTED (workplan 0139 T3;
 * the owner's decision of 2026-09-28, terms-acceptance-route (b)).
 *
 * Terms §1, the Alpha conditions §2 and privacy §4.4 say that the app shows the
 * three texts with their versions when the account is created, asks for
 * acceptance, and records which version of each was accepted, and when. The
 * screen that asks is the web app's, in front of every signed-in page while
 * `GET /api/me` says acceptance is due. This is the server's half: while the
 * deployment asks, every door that would store a credential answers 409
 * `conditions_not_accepted` until the person pressing it has accepted the
 * current version of each text in this organisation. So no access anybody
 * gives is stored before the texts that say what happens to it were accepted.
 *
 * The doors that ask: adding a connection, giving one a new key, and creating
 * a migration. `no-credential-stored-before-the-conditions.unit.test.ts`
 * counts where the API seals a credential, so a door added later fails until
 * it asks here or says why it need not.
 *
 * ## The switch
 *
 * The alpha's own (0131 T1): `OWNPACE_STAGE=alpha`, read at each request by the
 * same rule as the note and the grant mail (`alphaFrom`). The texts a tester
 * accepts are the Alpha's, so the deployment that runs the Alpha is the one
 * that asks, and live sets it; every other deployment (the OTA stack, a
 * developer's, CI) asks nobody and nothing changes there. The appliance never
 * loads this file: it runs no `apps/api`, and `@openmig/managed` is outside its
 * import graph. When the Alpha ends, the new conditions replace the Alpha's in
 * `LEGAL_VERSIONS` (Alpha conditions §11 asks for them in the app too), and
 * that change decides what the switch becomes (0086).
 *
 * ## The answer
 *
 * 409 `conditions_not_accepted`, in the shape the close's answers with:
 * `message` and `reason` carry one English sentence, `messageNl` and `reasonNl`
 * its Dutch, and `documents` names each text still to accept with its current
 * version. A read that fails is not "accepted" (hard rule 9): the error goes to
 * the door's own catch, which answers 500.
 */

import type { Response } from 'express';
import type { Pool } from 'pg';
import type { LedgerDriver } from '@openmig/ledger';
import { readAcceptance, type AcceptanceState, type LegalDocument } from '@openmig/managed';
import { withTenantDb } from './middleware/auth.ts';
import { alphaFrom } from './access-notify.ts';

/** A door refused because the current texts are not accepted yet. */
export const CONDITIONS_NOT_ACCEPTED = 'conditions_not_accepted';
/** An acceptance of a version that is no longer the current one. */
export const VERSION_NOT_CURRENT = 'version_not_current';

/** Whether this deployment asks for acceptance: the alpha's switch, read now. */
export function acceptanceAsked(env: { readonly OWNPACE_STAGE?: string } = process.env): boolean {
  return alphaFrom(env);
}

const REFUSAL_EN =
  'Accept the Alpha conditions, the privacy policy and the terms first: nothing you connect is stored ' +
  'until you have accepted their current versions. The app asks for it when you open it.';
const REFUSAL_NL =
  'Accepteer eerst de voorwaarden voor de Alpha, de privacyverklaring en de servicevoorwaarden: niets wat u ' +
  'koppelt wordt opgeslagen voordat u hun huidige versies hebt geaccepteerd. De app vraagt het u zodra u hem opent.';

/** What a door answers while the current texts are not accepted. */
export interface ConditionsNotAcceptedAnswer {
  readonly error: typeof CONDITIONS_NOT_ACCEPTED;
  readonly message: string;
  readonly messageNl: string;
  readonly reason: string;
  readonly reasonNl: string;
  /** Each text still to accept, at its current version. */
  readonly documents: ReadonlyArray<{ readonly document: LegalDocument; readonly version: string }>;
}

export function conditionsNotAcceptedAnswer(state: AcceptanceState): ConditionsNotAcceptedAnswer {
  return {
    error: CONDITIONS_NOT_ACCEPTED,
    message: REFUSAL_EN,
    messageNl: REFUSAL_NL,
    reason: REFUSAL_EN,
    reasonNl: REFUSAL_NL,
    documents: state.documents.filter((d) => !d.accepted).map(({ document, version }) => ({ document, version })),
  };
}

/** What this person has accepted in this organisation, against the current versions. */
export function acceptanceOf(
  tenantId: string,
  subject: string,
  source: Pool | LedgerDriver,
): Promise<AcceptanceState> {
  return withTenantDb(tenantId, source, (db) => readAcceptance(db, tenantId, subject));
}

/**
 * Answer 409 and return true while the deployment asks and this person has not
 * accepted the current version of each text here; return false, having
 * answered nothing, otherwise. Asked before the door's first write and before
 * it probes anything with the access it was given.
 */
export async function refusedUntilAccepted(
  res: Response,
  tenantId: string,
  subject: string | undefined,
  source: Pool | LedgerDriver,
  env: { readonly OWNPACE_STAGE?: string } = process.env,
): Promise<boolean> {
  if (!acceptanceAsked(env)) return false;
  // No subject is nobody who accepted anything: refused, never waved through.
  const state = await acceptanceOf(tenantId, subject ?? '', source);
  if (!state.due) return false;
  res.status(409).json(conditionsNotAcceptedAnswer(state));
  return true;
}
