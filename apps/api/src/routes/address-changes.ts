// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE ORGANISATION'S ADDRESS CHANGES (ADR-0055; workplan 0168 T2, §4.2, §4.4).
 *
 *  - `GET /api/address-changes` lists the table, oldest first.
 *  - `POST /api/address-changes` adds a row: proposed, or confirmed by the
 *    asker with `confirm: true`. The same change again changes nothing.
 *  - `PUT /api/address-changes/:oldKey` changes its new address, confirms it,
 *    sends it back (*Not right?*), or links it to a person.
 *  - `DELETE /api/address-changes/:oldKey` deletes it, with its link.
 *
 * The contract is `apps/api/docs/openapi.yaml`, and the appliance answers the
 * same shapes at `/address-changes` (ADR-0026). The rules and every refusal,
 * in English and in Dutch, are `@openmig/shared`'s (`address-change-table.ts`),
 * and the one writer of the table is `@openmig/ledger`'s
 * (`address-change-store.ts`), which takes the organisation's lock first, so
 * two presses at once cannot make a chain.
 *
 * WHO IS THE SIGN-IN. A row is set and confirmed by the subject
 * `authenticate` verified (`req.userId`); the answer says it as the member's
 * address, never as the id. Any member may propose and confirm during the
 * alpha (`ALPHA_ROLES`, 0168 §4.4; 0137 T2 gates writes by role), and every
 * confirmation is attributed.
 *
 * NOT REFUSED FOR A CLOSED ORGANISATION. A row is a fact about addresses:
 * writing one starts no pass and uses no stored access, which is what a close
 * stops. The erasure removes both tables (`PURGED_TABLES`).
 */

import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';
import {
  addAddressChange,
  deleteAddressChange,
  oldKeyOf,
  readAddressChange,
  readAddressChanges,
  updateAddressChange,
} from '@openmig/ledger';
import type { PgDatabase } from '@openmig/ledger/db';
import {
  addressChangeAnswer,
  hasPerson,
  linkAddressChangePerson,
  memberLabels,
  readAddressChangePeople,
} from '@openmig/managed';
import {
  ADDRESS_CHANGE_MAX,
  addressChangeNotFound,
  invalidAddressChange,
  PERSON_NOT_FOUND,
  refusalStatus,
  type AddressChange,
  type AddressChangeRefusal,
  type AddressChangeTable,
  type StoredAddressChange,
} from '@openmig/shared';
import { authenticate, getDbPool, withTenantDb } from '../middleware/auth.ts';
import type { AuthenticatedRequest } from '../types/api.ts';
import { serverFault } from '../server-fault.ts';

const router = Router();

let _dbPool: ReturnType<typeof getDbPool> | null = null;
function pool() {
  if (!_dbPool) _dbPool = getDbPool();
  return _dbPool;
}

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const Address = z.string({ error: 'An address is a string.' }).max(ADDRESS_CHANGE_MAX + 50);
const PersonId = z.string().regex(ID, 'personId is not a person id.').nullable();

const CreateSchema = z
  .object({
    oldAddress: Address,
    newAddress: Address,
    confirm: z.boolean({ error: 'confirm is true or false.' }).optional(),
    personId: PersonId.optional(),
  })
  .strict();

const UpdateSchema = z
  .object({
    newAddress: Address.optional(),
    state: z.enum(['proposed', 'confirmed'], { error: 'state is proposed or confirmed.' }).optional(),
    personId: PersonId.optional(),
  })
  .strict();

/** The tenant, or the 401 the other routes answer without one. */
function tenantOf(req: AuthenticatedRequest, res: Response): string | undefined {
  if (req.tenantId) return req.tenantId;
  res.status(401).json({ error: 'Unauthorized', message: 'Tenant ID not found in authentication context' });
  return undefined;
}

function refuse(res: Response, refusal: AddressChangeRefusal): void {
  res.status(refusalStatus(refusal)).json(refusal);
}

/** A body that is not the route's shape, in both languages, as every refusal here is. */
function invalid(res: Response, error: z.ZodError): void {
  const said = error.issues.map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message)).join(' ');
  refuse(
    res,
    invalidAddressChange({
      en: `This request cannot be read. ${said}`,
      nl: `Dit verzoek is niet te lezen. ${said}`,
    }),
  );
}

function personNotFound(res: Response): void {
  res.status(404).json({ error: PERSON_NOT_FOUND, message: 'There is no such person in this organisation.' });
}

/** The key in the path, decoded and folded. */
function keyOf(req: AuthenticatedRequest): string {
  const raw = String(req.params.oldKey ?? '');
  return oldKeyOf(raw);
}

/** Rows as the asker reads them: who set and confirmed each said in words, and whose it is. */
async function answers(
  db: PgDatabase,
  tenantId: string,
  rows: readonly StoredAddressChange[],
  asker: string | undefined,
): Promise<AddressChange[]> {
  const facts = { labels: await memberLabels(db, tenantId), people: await readAddressChangePeople(db, tenantId), asker };
  return rows.map((r) => addressChangeAnswer(r, facts));
}

router.get('/', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tenantId = tenantOf(req, res);
    if (!tenantId) return;
    const rows = await withTenantDb(tenantId, pool(), async (db) =>
      answers(db, tenantId, await readAddressChanges(db, tenantId), req.userId),
    );
    // Never an empty table on failure: "we could not read it" and "nothing
    // changes" are opposite sentences (hard rule 9).
    res.json({ rows, door: 'api', file: null } satisfies AddressChangeTable);
  } catch (error) {
    serverFault(res, 'address_changes_list_failed', 'reading the address changes', error);
  }
});

/** A transaction's outcome: an answer, or a refusal that rolled nothing back because nothing was written. */
type Outcome =
  | { readonly kind: 'row'; readonly status: 200 | 201; readonly row: AddressChange }
  | { readonly kind: 'refused'; readonly refusal: AddressChangeRefusal }
  | { readonly kind: 'no_person' };

function send(res: Response, outcome: Outcome): void {
  if (outcome.kind === 'refused') return refuse(res, outcome.refusal);
  if (outcome.kind === 'no_person') return personNotFound(res);
  res.status(outcome.status).json(outcome.row);
}

router.post('/', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tenantId = tenantOf(req, res);
    if (!tenantId) return;
    const parsed = CreateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return invalid(res, parsed.error);
    const by = req.userId ?? 'unknown';
    const body = parsed.data;

    const outcome = await withTenantDb(tenantId, pool(), async (db): Promise<Outcome> => {
      if (body.personId && !(await hasPerson(db, tenantId, body.personId))) return { kind: 'no_person' };
      const w = await addAddressChange(db, tenantId, {
        oldAddress: body.oldAddress,
        newAddress: body.newAddress,
        confirm: body.confirm === true,
        by,
      });
      if (!w.ok) return { kind: 'refused', refusal: w.refusal };
      if (body.personId !== undefined) await linkAddressChangePerson(db, tenantId, w.row.oldKey, body.personId);
      const [row] = await answers(db, tenantId, [w.row], req.userId);
      return { kind: 'row', status: w.created ? 201 : 200, row: row! };
    });
    send(res, outcome);
  } catch (error) {
    serverFault(res, 'address_change_create_failed', 'adding this address change', error);
  }
});

router.put('/:oldKey', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tenantId = tenantOf(req, res);
    if (!tenantId) return;
    const parsed = UpdateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return invalid(res, parsed.error);
    const oldKey = keyOf(req);
    const by = req.userId ?? 'unknown';
    const body = parsed.data;

    const outcome = await withTenantDb(tenantId, pool(), async (db): Promise<Outcome> => {
      if (body.personId && !(await hasPerson(db, tenantId, body.personId))) return { kind: 'no_person' };
      const w = await updateAddressChange(db, tenantId, oldKey, {
        ...(body.newAddress === undefined ? {} : { newAddress: body.newAddress }),
        ...(body.state === undefined ? {} : { state: body.state }),
        by,
      });
      if (!w.ok) return { kind: 'refused', refusal: w.refusal };
      if (body.personId !== undefined) await linkAddressChangePerson(db, tenantId, oldKey, body.personId);
      const [row] = await answers(db, tenantId, [w.row], req.userId);
      return { kind: 'row', status: 200, row: row! };
    });
    send(res, outcome);
  } catch (error) {
    serverFault(res, 'address_change_update_failed', 'changing this address change', error);
  }
});

router.delete('/:oldKey', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tenantId = tenantOf(req, res);
    if (!tenantId) return;
    const oldKey = keyOf(req);
    const outcome = await withTenantDb(tenantId, pool(), async (db): Promise<Outcome> => {
      // Read first, so the answer can say whose it was: the cascade takes the link with the row.
      const before = await readAddressChange(db, tenantId, oldKey);
      if (!before) return { kind: 'refused', refusal: addressChangeNotFound(oldKey) };
      const [row] = await answers(db, tenantId, [before], req.userId);
      await deleteAddressChange(db, tenantId, oldKey);
      return { kind: 'row', status: 200, row: row! };
    });
    send(res, outcome);
  } catch (error) {
    serverFault(res, 'address_change_delete_failed', 'deleting this address change', error);
  }
});

export default router;
