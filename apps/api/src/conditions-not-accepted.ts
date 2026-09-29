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
 * The doors that ask: adding a connection, giving one a new key, creating a
 * migration, and issuing a grant link, which is the member's door to the
 * access a family member then gives through it.
 * `no-credential-stored-before-the-conditions.unit.test.ts` counts where the
 * API seals a credential, so a door added later fails until it asks here or
 * says why it need not.
 *
 * ## The switch
 *
 * The alpha's own (0131 T1): `OWNPACE_STAGE=alpha`, read at each request by the
 * same rule as the note and the grant mail (`alphaFrom`). The texts a tester
 * accepts are the Alpha's, so the deployment that runs the Alpha is the one
 * that asks, and live sets it; every other deployment (the OTA stack, a
 * developer's, CI) asks nobody and nothing changes there.
 *
 * **And no text is a draft** (review of 2026-09-29). A draft's number is the
 * one the final text will carry, so an acceptance of draft 1.2 would be
 * recorded as an acceptance of final 1.2, whose words may differ, and the
 * tester would never be asked again. While any text in `LEGAL_DRAFTS` is a
 * draft, nobody is asked, no door refuses, and `POST /api/me/acceptance`
 * records nothing (409 `acceptance_not_asked`), exactly as with the switch
 * off. The drafts are a constant, so this is decided by the release, and the
 * API says which at start (`acceptanceAtStart`). The appliance never
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
import {
  LEGAL_DRAFTS,
  LEGAL_DOCUMENTS,
  LEGAL_VERSIONS,
  draftTexts,
  readAcceptance,
  type AcceptanceState,
  type LegalDocument,
} from '@openmig/managed';
import { withTenantDb } from './middleware/auth.ts';
import { alphaFrom } from './access-notify.ts';

/** A door refused because the current texts are not accepted yet. */
export const CONDITIONS_NOT_ACCEPTED = 'conditions_not_accepted';
/** An acceptance of a version that is no longer the current one. */
export const VERSION_NOT_CURRENT = 'version_not_current';
/** An acceptance offered while this deployment asks nobody: switched off, or a text is a draft. */
export const ACCEPTANCE_NOT_ASKED = 'acceptance_not_asked';

type Drafts = Readonly<Record<LegalDocument, boolean>>;

/**
 * Whether this deployment asks for acceptance: the alpha's switch, read now,
 * and no text still a draft.
 */
export function acceptanceAsked(
  env: { readonly OWNPACE_STAGE?: string } = process.env,
  drafts: Drafts = LEGAL_DRAFTS,
): boolean {
  return alphaFrom(env) && draftTexts(drafts).length === 0;
}

/**
 * The line the API logs at start while the switch is on: what it asks for,
 * or, while a text is a draft, that it asks nobody, and which texts hold it.
 * Null with the switch off, which is every deployment but live.
 */
export function acceptanceAtStart(
  env: { readonly OWNPACE_STAGE?: string } = process.env,
  drafts: Drafts = LEGAL_DRAFTS,
): string | null {
  if (!alphaFrom(env)) return null;
  const pending = draftTexts(drafts);
  if (pending.length > 0) {
    return (
      `[api] OWNPACE_STAGE=alpha, but ${pending.map((d) => `${d} ${LEGAL_VERSIONS[d]}`).join(' and ')} ` +
      `${pending.length === 1 ? 'is a draft' : 'are drafts'}: nobody is asked to accept the texts, and no door ` +
      'refuses for them, until every text is final (LEGAL_DRAFTS, workplan 0139 T3)'
    );
  }
  return (
    `[api] asking every member to accept ${LEGAL_DOCUMENTS.map((d) => `${d} ${LEGAL_VERSIONS[d]}`).join(', ')} ` +
    'before any access of theirs is stored (workplan 0139 T3)'
  );
}

// Said where the door was pressed, which may be long after the screen was
// shown, and read after the texts are accepted as well as before.
const REFUSAL_EN =
  'Nothing was stored: accept the Alpha conditions, the privacy policy and the terms first. The app shows ' +
  'them now; if it does not, reload the page. Then try again.';
const REFUSAL_NL =
  'Er is niets opgeslagen: aanvaard eerst de voorwaarden voor de Alpha, de privacyverklaring en de ' +
  'servicevoorwaarden. De app toont ze nu; gebeurt dat niet, laad de pagina dan opnieuw. Probeer het daarna ' +
  'nog eens.';

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
