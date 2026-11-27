// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A MIGRATED PERSON'S OWN ADDRESS CHANGES, THROUGH THEIR LINK (workplan 0168
 * §4.4, D6; ADR-0035, ADR-0055).
 *
 * The door for a person who has a link and no account. Their grant page and
 * their progress page say *Your new address: ‹address›. Is that right?* for
 * each row of the organisation's address changes that is linked to them
 * (`address_change_person`), each named by an opaque `ref`, and these routes
 * take their answer:
 *
 *  - `PUT /api/grant/:link/address-changes/:ref`
 *  - `PUT /api/view/:link/address-changes/:ref`
 *
 * with `{ state: 'confirmed' }` (*Yes, that is right*) or `{ state:
 * 'proposed' }` (*Not right?*, a confirmed row sent back), and beside it the
 * `newAddress` the page showed. Mounted on each door's own router, behind that
 * door's own link check, so a link either page refuses (unknown, forged,
 * expired, revoked, a grant link used up, the other page's link) is refused
 * here by the same middleware, in the same words. The grant door also refuses
 * a closed organisation, as every grant route does; the progress door does
 * not, as no progress route does (reading and this, which starts nothing,
 * stay open), and nor do the organisation's own address-change routes.
 *
 * WHAT A LINK REACHES. The rows linked to the link's own person, and only
 * their state: the body is `{ state, newAddress }` and nothing else, refused
 * otherwise in both languages. A ref is looked for among that person's rows
 * only, so a row linked to anybody else, or to nobody, or one never made, is
 * the same 404 after the same work. A migration's own link names no person,
 * so it reaches no row. The write is `@openmig/managed`'s
 * `answerAddressChangeByLink`, through the ledger's one writer, under the
 * organisation's lock.
 *
 * WHAT A YES CONFIRMS. The new address the page showed, and nothing else: a
 * row whose new address changed since the page was opened (an owner typed
 * another) is refused 409 `changed`, and nothing is written, as *Take my grant
 * back* refuses a page that no longer says what is held (`person-progress.ts`,
 * `CHANGED_SINCE_OPENED`).
 *
 * WHO CONFIRMED IT. The person, stored as `person:<id>` (`confirmedByPerson`
 * in `@openmig/shared`): said to them as *Confirmed*, to everyone else as
 * *Confirmed by ‹person›*, never as a member's address and never as an id.
 * The audit log records each answer that changed the row under the door's
 * link holder (`grant-link`, `progress-link`), with the person's id, the
 * link's id and the row's pseudonym, as the organisation's own routes record
 * theirs.
 *
 * The answer is the row as the link shows it, the same shape the two pages
 * read (`LinkAddressChange`).
 */

import type { RequestHandler, Response } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import type { LedgerDriver } from '@openmig/ledger';
import { answerAddressChangeByLink } from '@openmig/managed';
import {
  ADDRESS_CHANGE_MAX,
  ADDRESS_CHANGE_NOT_FOUND,
  inLocale,
  invalidAddressChange,
  pseudonymizer,
  type AddressChangeRefusal,
  type Bilingual,
  type Register,
} from '@openmig/shared';
import { withTenantDb } from '../middleware/auth.ts';
import { refusedAsClosed } from '../closed-organisation.ts';
import { registerOfPerson } from '../person-register.ts';
import type { PersonLinkRequest } from '../types/api.ts';
import { serverFault } from '../server-fault.ts';
import { auditPseudonymKey } from '../audit-key.ts';
import { GRANT_ACTOR } from './migrations/grant-ending.ts';
import { WITHDRAWAL_ACTOR } from './withdraw-grant.ts';

/** What a link may say about its row: the answer, and the new address the page showed. */
const AnswerSchema = z
  .object({
    state: z.enum(['proposed', 'confirmed']),
    newAddress: z.string().min(1).max(ADDRESS_CHANGE_MAX + 50),
  })
  .strict();

/** A body that is anything but `{ state, newAddress }`. */
export const ONLY_THE_ANSWER: Bilingual = {
  en:
    'Send only { "state", "newAddress" }: "confirmed" or "proposed", and the new address this page showed. ' +
    'Through this link you can only say whether your new address is right; nothing about it can be changed here.',
  nl:
    'Stuur alleen { "state", "newAddress" }: "confirmed" of "proposed", en het nieuwe adres dat deze pagina ' +
    'toonde. Via deze link kunt u alleen zeggen of uw nieuwe adres klopt; er kan hier niets aan worden gewijzigd.',
  // With je, for a person whose pages say je (workplan 0176 T7, §11).
  nlJe:
    'Stuur alleen { "state", "newAddress" }: "confirmed" of "proposed", en het nieuwe adres dat deze pagina ' +
    'toonde. Via deze link kun je alleen zeggen of je nieuwe adres klopt; er kan hier niets aan worden gewijzigd.',
};

/** No row of this person's has that ref: somebody else's, a deleted one, or one never made, alike. */
export const NOT_ONE_OF_YOURS: Bilingual = {
  en: 'This address change is not one of yours, or it no longer exists. Open this page again to see your own.',
  nl: 'Deze adreswijziging is niet van u, of bestaat niet meer. Open deze pagina opnieuw om de uwe te zien.',
  nlJe: 'Deze adreswijziging is niet van jou, of bestaat niet meer. Open deze pagina opnieuw om de jouwe te zien.',
};

/** The row's new address is not the one the page showed: nothing was written. */
export const CHANGED_SINCE_SHOWN: Bilingual = {
  en:
    'Your new address was changed since this page was opened, so nothing was saved. ' +
    'Open this page again to see it as it is now.',
  nl:
    'Uw nieuwe adres is gewijzigd sinds deze pagina werd geopend, dus er is niets opgeslagen. ' +
    'Open deze pagina opnieuw om het te zien zoals het nu is.',
  nlJe:
    'Je nieuwe adres is gewijzigd sinds deze pagina werd geopend, dus er is niets opgeslagen. ' +
    'Open deze pagina opnieuw om het te zien zoals het nu is.',
};

/** The code a stale page's answer is refused with, as a stale withdrawal is (`person-progress.ts`). */
export const LINK_ADDRESS_CHANGED = 'changed';

const notOneOfYours = (register?: Register): AddressChangeRefusal => ({
  error: ADDRESS_CHANGE_NOT_FOUND,
  message: NOT_ONE_OF_YOURS.en,
  messageNl: inLocale(NOT_ONE_OF_YOURS, 'nl', register),
});

/** A pair with its Dutch in the person's register (0176 T7), for a helper that takes a pair. */
const inTheirRegister = (text: Bilingual, register: Register | undefined): Bilingual => ({
  en: text.en,
  nl: inLocale(text, 'nl', register),
});

function refuse(res: Response, status: 400 | 404 | 409, refusal: AddressChangeRefusal): void {
  res.status(status).json(refusal);
}

/**
 * The handler for one door. `pool` is resolved on the first request, as each
 * door's own routes resolve theirs.
 */
export function answerAddressChangeThroughLink(
  door: 'grant' | 'view',
  pool: () => Pool | LedgerDriver,
): RequestHandler {
  return async (req, res) => {
    const link = req as PersonLinkRequest;
    try {
      const tenantId = link.personLink?.tenantId ?? link.mappingLink?.tenantId;
      // The grant door's routes refuse a closed organisation (0085 T2), so
      // this one does, by the same code and in the same words.
      if (door === 'grant' && tenantId !== undefined && (await refusedAsClosed(res, tenantId, pool()))) return;
      const person = link.personLink;
      // How the person's pages speak to them (0176 T7): each refusal below says its Dutch in it.
      const register = person ? await registerOfPerson(pool(), person.tenantId, person.personId) : undefined;
      const parsed = AnswerSchema.safeParse(req.body ?? {});
      if (!parsed.success) return void refuse(res, 400, invalidAddressChange(inTheirRegister(ONLY_THE_ANSWER, register)));
      // A migration's own link is nobody's: it reaches no row.
      if (!person) return void refuse(res, 404, notOneOfYours());
      // Read before the transaction opens: the key is the owner's alone and is
      // read on the owner's own connection (`audit-key.ts`).
      const audit = {
        actor: door === 'grant' ? GRANT_ACTOR : WITHDRAWAL_ACTOR,
        pseudonym: pseudonymizer(await auditPseudonymKey()),
        personLinkId: person.linkId,
      };
      const answer = { ref: String(req.params.ref ?? ''), ...parsed.data };
      const written = await withTenantDb(person.tenantId, pool(), (db) =>
        answerAddressChangeByLink(db, person.tenantId, person.personId, answer, audit),
      );
      if (written.ok) return void res.json(written.row);
      if (written.refused === 'changed') {
        return void refuse(res, 409, {
          error: LINK_ADDRESS_CHANGED,
          message: CHANGED_SINCE_SHOWN.en,
          messageNl: inLocale(CHANGED_SINCE_SHOWN, 'nl', register),
        });
      }
      refuse(res, 404, notOneOfYours(register));
    } catch (error) {
      serverFault(res, 'link_address_change_failed', 'saving your answer about your new address', error);
    }
  };
}
