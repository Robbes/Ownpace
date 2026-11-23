// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A MIGRATED PERSON'S OWN ADDRESS CHANGES, THROUGH THEIR LINK (workplan 0168
 * §4.4, D6; ADR-0035, ADR-0055).
 *
 * The door for a person who has a link and no account. Their grant page and
 * their progress page say *Your new address: ‹address›. Is that right?* for
 * each row of the organisation's address changes that is linked to them
 * (`address_change_person`), and these routes take their answer:
 *
 *  - `PUT /api/grant/:link/address-changes/:oldKey`
 *  - `PUT /api/view/:link/address-changes/:oldKey`
 *
 * with `{ state: 'confirmed' }` (*Yes, that is right*) or `{ state:
 * 'proposed' }` (*Not right?*, a confirmed row sent back). Mounted on each
 * door's own router, behind that door's own link check, so a link either page
 * refuses (unknown, forged, expired, revoked, a grant link used up, the other
 * page's link) is refused here by the same middleware, in the same words.
 * The grant door also refuses a closed organisation, as every grant route
 * does; the progress door does not, as no progress route does (reading and
 * this, which starts nothing, stay open), and nor do the organisation's own
 * address-change routes.
 *
 * WHAT A LINK REACHES. The rows linked to the link's own person, and only
 * their state: the body is `{ state }` and nothing else, refused otherwise in
 * both languages. A row linked to anybody else, or to nobody, is answered as
 * one that does not exist. A migration's own link names no person, so it
 * reaches no row. The write is `@openmig/managed`'s `answerAddressChangeByLink`,
 * through the ledger's one writer, under the organisation's lock.
 *
 * WHO CONFIRMED IT. The person, stored as `person:<id>` (`confirmedByPerson`
 * in `@openmig/shared`): said to them as *Confirmed*, to everyone else as
 * *Confirmed by ‹person›*, never as a member's address and never as an id.
 *
 * The answer is the row as the link shows it, the same shape the two pages
 * read (`LinkAddressChange`).
 */

import type { RequestHandler, Response } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import { oldKeyOf, type LedgerDriver } from '@openmig/ledger';
import { answerAddressChangeByLink } from '@openmig/managed';
import {
  addressChangeNotFound,
  invalidAddressChange,
  refusalStatus,
  type AddressChangeRefusal,
  type Bilingual,
} from '@openmig/shared';
import { withTenantDb } from '../middleware/auth.ts';
import { refusedAsClosed } from '../closed-organisation.ts';
import type { PersonLinkRequest } from '../types/api.ts';
import { serverFault } from '../server-fault.ts';

/** The one thing a link may say about its row. */
const AnswerSchema = z.object({ state: z.enum(['proposed', 'confirmed']) }).strict();

/** A body that is anything but `{ state }`. */
export const ONLY_THE_STATE: Bilingual = {
  en:
    'Send only { "state": "confirmed" } or { "state": "proposed" }. Through this link you can only say ' +
    'whether your new address is right; nothing else about it can be changed here.',
  nl:
    'Stuur alleen { "state": "confirmed" } of { "state": "proposed" }. Via deze link kunt u alleen zeggen ' +
    'of uw nieuwe adres klopt; verder kan er hier niets aan worden gewijzigd.',
};

function refuse(res: Response, refusal: AddressChangeRefusal): void {
  res.status(refusalStatus(refusal)).json(refusal);
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
      const parsed = AnswerSchema.safeParse(req.body ?? {});
      if (!parsed.success) return void refuse(res, invalidAddressChange(ONLY_THE_STATE));
      const oldKey = oldKeyOf(String(req.params.oldKey ?? ''));
      const person = link.personLink;
      // A migration's own link is nobody's: it reaches no row.
      if (!person) return void refuse(res, addressChangeNotFound(oldKey));
      const written = await withTenantDb(person.tenantId, pool(), (db) =>
        answerAddressChangeByLink(db, person.tenantId, person.personId, oldKey, parsed.data.state),
      );
      if (!written.ok) return void refuse(res, written.refusal);
      res.json(written.row);
    } catch (error) {
      serverFault(res, 'link_address_change_failed', 'saving your answer about your new address', error);
    }
  };
}
