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
 * WHO MAY DO WHAT (0168 §4.4, D6; the review's finding 1). An owner or an
 * admin proposes, changes, deletes and confirms any row, a confirmation for
 * someone else attributed to them. Any other member (a `member` or `viewer`
 * row from before the alpha's roles) reads only the rows that are their own
 * person's (`person.user_id`, managed 0061) and may only confirm one or send
 * it back: a `PUT` of `{state}` alone. Everything else is refused 403, in
 * both languages, as every refusal here is. `requireRole` holds the same rule
 * elsewhere, but its 403 is English only, so this router says its own.
 *
 * WHO IS THE SIGN-IN. A row is set and confirmed by the subject
 * `authenticate` verified (`req.userId`); the answer says it as the member's
 * address, never as the id.
 *
 * EVERY WRITE IS RECORDED (0168 §5; the review's finding 4): one `audit_log`
 * row in the write's own transaction, naming who, the row by reference (its
 * key as the audit export's pseudonym, under the key `audit-key.ts` reads),
 * the states it went from and to, and whose row it is. Never an address.
 *
 * NOT REFUSED FOR A CLOSED ORGANISATION. A row is a fact about addresses:
 * writing one starts no pass and uses no stored access, which is what a close
 * stops. The erasure removes both tables (`PURGED_TABLES`).
 */

import { Router } from 'express';
import { idsThatAreNoUuid } from '../an-id-that-is-no-uuid.ts';
import type { NextFunction, Response } from 'express';
import { z } from 'zod';
import {
  addAddressChange,
  deleteAddressChange,
  lockAddressChanges,
  oldKeyOf,
  readAddressChanges,
  recordAddressChangeWrite,
  updateAddressChange,
} from '@openmig/ledger';
import type { PgDatabase } from '@openmig/ledger/db';
import {
  addressChangeAnswer,
  hasPerson,
  linkAddressChangePerson,
  memberLabels,
  ownAddressChangeKeys,
  readAddressChangePeople,
} from '@openmig/managed';
import {
  ADDRESS_CHANGE_MAX,
  addressChangeNotFound,
  invalidAddressChange,
  isAddress,
  notYourAddressChange,
  ownerOrAdminOnly,
  personNotFound,
  pseudonymizer,
  refusalStatus,
  type AddressChange,
  type AddressChangeRefusal,
  type AddressChangeTable,
  type Bilingual,
  type Pseudonymize,
  type StoredAddressChange,
} from '@openmig/shared';
import { authenticate, getDbPool, withTenantDb } from '../middleware/auth.ts';
import type { AuthenticatedRequest } from '../types/api.ts';
import { serverFault } from '../server-fault.ts';
import { auditPseudonymKey } from '../audit-key.ts';

const router = idsThatAreNoUuid(Router());

let _dbPool: ReturnType<typeof getDbPool> | null = null;
function pool() {
  if (!_dbPool) _dbPool = getDbPool();
  return _dbPool;
}

/** The roles that may add, change, delete and confirm any row (0168 §4.4). */
const MAY_MANAGE: readonly string[] = ['owner', 'admin'];
const manages = (req: AuthenticatedRequest): boolean => MAY_MANAGE.includes(req.userRole ?? '');

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

/**
 * The gate of `POST` and `DELETE`: an owner or an admin, else the 403 in both
 * languages. `requireRole('owner', 'admin')`'s rule, with this router's
 * refusal.
 */
function ownerOrAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!req.userId) {
    res.status(401).json({ error: 'Unauthorized', message: 'Authentication required' });
    return;
  }
  if (!manages(req)) return refuse(res, ownerOrAdminOnly());
  next();
}

/**
 * One fault of a body, in both languages (N7 of 0168's review: the Dutch
 * half used to carry zod's English). Said per field, in the words the
 * appliance's own refusals use, so both editions say the same.
 */
function issueSaid(issue: z.core.$ZodIssue, body: unknown): Bilingual {
  const field = issue.path.map(String).join('.');
  if (issue.code === 'unrecognized_keys') {
    const keys = issue.keys.join(', ');
    return { en: `The body has a field this route does not take: ${keys}.`, nl: `De inhoud heeft een veld dat hier niet past: ${keys}.` };
  }
  if (field === '') return { en: 'The body must be a JSON object.', nl: 'De inhoud moet een JSON-object zijn.' };
  const given = typeof body === 'object' && body !== null && Object.hasOwn(body, field);
  switch (field) {
    case 'oldAddress':
    case 'newAddress':
      if (!given) {
        return { en: 'An address change needs oldAddress and newAddress.', nl: 'Een adreswijziging heeft oldAddress en newAddress nodig.' };
      }
      if (issue.code === 'too_big') {
        return { en: `${field} is longer than an address can be.`, nl: `${field} is langer dan een adres kan zijn.` };
      }
      return { en: `${field} is a string.`, nl: `${field} is tekst.` };
    case 'confirm':
      return { en: 'confirm is true or false.', nl: 'confirm is true of false.' };
    case 'state':
      return { en: 'state is proposed or confirmed.', nl: 'state is proposed of confirmed.' };
    case 'personId':
      return { en: "personId is a person's id, or null.", nl: 'personId is het id van een persoon, of null.' };
    default:
      return { en: `${field} is not what this route takes.`, nl: `${field} past hier niet.` };
  }
}

/** A body that is not the route's shape, in both languages, as every refusal here is. */
function invalid(res: Response, error: z.ZodError, body: unknown): void {
  const said: Bilingual[] = [];
  for (const issue of error.issues) {
    const s = issueSaid(issue, body);
    if (!said.some((t) => t.en === s.en)) said.push(s);
  }
  refuse(
    res,
    invalidAddressChange({
      en: `This request cannot be read. ${said.map((s) => s.en).join(' ')}`,
      nl: `Dit verzoek is niet te lezen. ${said.map((s) => s.nl).join(' ')}`,
    }),
  );
}

/**
 * The key in the path, decoded and folded; undefined when the segment is no
 * address. Every row's key is an address's, so such a segment names no row,
 * and is answered without asking the database (a NUL in it would make the
 * query fail with a 500, 0168's review, finding 3).
 */
function keyOf(req: AuthenticatedRequest): { readonly raw: string; readonly key: string | undefined } {
  const raw = String(req.params.oldKey ?? '');
  return { raw, key: isAddress(raw) ? oldKeyOf(raw) : undefined };
}

/** What an answer says of who set, confirmed and owns each row, read once per request. */
interface Facts {
  readonly labels: ReadonlyMap<string, string>;
  readonly people: ReadonlyMap<string, { readonly id: string; readonly displayName: string }>;
  readonly asker: string | undefined;
}

async function factsOf(db: PgDatabase, tenantId: string, asker: string | undefined): Promise<Facts> {
  return { labels: await memberLabels(db, tenantId), people: await readAddressChangePeople(db, tenantId), asker };
}

/**
 * The row's reference in its audit record: its key as the audit export's
 * pseudonym. Read before the write's transaction opens, on the owner's own
 * connection (`audit-key.ts`), which the request path may not read.
 */
async function rowReference(): Promise<Pseudonymize> {
  return pseudonymizer(await auditPseudonymKey());
}

router.get('/', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tenantId = tenantOf(req, res);
    if (!tenantId) return;
    const rows = await withTenantDb(tenantId, pool(), async (db) => {
      const all = await readAddressChanges(db, tenantId);
      // A member who is not an owner or an admin reads their own rows only.
      let visible: StoredAddressChange[] = all;
      if (!manages(req)) {
        const own = await ownAddressChangeKeys(db, tenantId, req.userId);
        visible = all.filter((r) => own.has(r.oldKey));
      }
      const facts = await factsOf(db, tenantId, req.userId);
      return visible.map((r) => addressChangeAnswer(r, facts));
    });
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
  | { readonly kind: 'refused'; readonly refusal: AddressChangeRefusal };

function send(res: Response, outcome: Outcome): void {
  if (outcome.kind === 'refused') return refuse(res, outcome.refusal);
  res.status(outcome.status).json(outcome.row);
}

/** Whose row it is now, and whether this write moved the link: what the audit record says of the person. */
function personAfter(facts: Facts, oldKey: string, moved: boolean): { readonly id: string | null; readonly moved: boolean } {
  return { id: facts.people.get(oldKey)?.id ?? null, moved };
}

router.post('/', authenticate, ownerOrAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tenantId = tenantOf(req, res);
    if (!tenantId) return;
    const parsed = CreateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return invalid(res, parsed.error, req.body);
    const by = req.userId ?? 'unknown';
    const body = parsed.data;
    const pseudonym = await rowReference();

    const outcome = await withTenantDb(tenantId, pool(), async (db): Promise<Outcome> => {
      if (body.personId && !(await hasPerson(db, tenantId, body.personId))) {
        return { kind: 'refused', refusal: personNotFound() };
      }
      const w = await addAddressChange(db, tenantId, {
        oldAddress: body.oldAddress,
        newAddress: body.newAddress,
        confirm: body.confirm === true,
        by,
      });
      if (!w.ok) return { kind: 'refused', refusal: w.refusal };
      const moved =
        body.personId !== undefined && (await linkAddressChangePerson(db, tenantId, w.row.oldKey, body.personId));
      const facts = await factsOf(db, tenantId, req.userId);
      await recordAddressChangeWrite(db, tenantId, {
        actor: by,
        via: 'api',
        pseudonym,
        before: w.before,
        after: w.row,
        person: personAfter(facts, w.row.oldKey, moved),
      });
      return { kind: 'row', status: w.created ? 201 : 200, row: addressChangeAnswer(w.row, facts) };
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
    if (!parsed.success) return invalid(res, parsed.error, req.body);
    const by = req.userId ?? 'unknown';
    const body = parsed.data;
    const managing = manages(req);
    // A member who is not an owner or an admin sends `{state}` and nothing else.
    const onlyState = body.state !== undefined && body.newAddress === undefined && body.personId === undefined;
    if (!managing && !onlyState) return refuse(res, ownerOrAdminOnly());
    const { raw, key: oldKey } = keyOf(req);
    if (oldKey === undefined) return refuse(res, managing ? addressChangeNotFound(raw) : notYourAddressChange());
    const pseudonym = await rowReference();

    const outcome = await withTenantDb(tenantId, pool(), async (db): Promise<Outcome> => {
      if (!managing) {
        // Whose row it is, read under the lock every write and every link
        // takes, so it still holds when the write lands.
        await lockAddressChanges(db, tenantId);
        if (!(await ownAddressChangeKeys(db, tenantId, req.userId)).has(oldKey)) {
          return { kind: 'refused', refusal: notYourAddressChange() };
        }
      }
      if (body.personId && !(await hasPerson(db, tenantId, body.personId))) {
        return { kind: 'refused', refusal: personNotFound() };
      }
      const w = await updateAddressChange(db, tenantId, oldKey, {
        ...(body.newAddress === undefined ? {} : { newAddress: body.newAddress }),
        ...(body.state === undefined ? {} : { state: body.state }),
        by,
      });
      if (!w.ok) return { kind: 'refused', refusal: w.refusal };
      const moved = body.personId !== undefined && (await linkAddressChangePerson(db, tenantId, oldKey, body.personId));
      const facts = await factsOf(db, tenantId, req.userId);
      await recordAddressChangeWrite(db, tenantId, {
        actor: by,
        via: 'api',
        pseudonym,
        before: w.before,
        after: w.row,
        person: personAfter(facts, oldKey, moved),
      });
      return { kind: 'row', status: 200, row: addressChangeAnswer(w.row, facts) };
    });
    send(res, outcome);
  } catch (error) {
    serverFault(res, 'address_change_update_failed', 'changing this address change', error);
  }
});

router.delete('/:oldKey', authenticate, ownerOrAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tenantId = tenantOf(req, res);
    if (!tenantId) return;
    const { raw, key: oldKey } = keyOf(req);
    if (oldKey === undefined) return refuse(res, addressChangeNotFound(raw));
    const by = req.userId ?? 'unknown';
    const pseudonym = await rowReference();
    const outcome = await withTenantDb(tenantId, pool(), async (db): Promise<Outcome> => {
      // Whose it was is read under the lock, before the cascade takes the
      // link with the row; the answer is the DELETE's own RETURNING, so of
      // two deletes at once the second finds nothing and says so (finding 8).
      await lockAddressChanges(db, tenantId);
      const facts = await factsOf(db, tenantId, req.userId);
      const gone = await deleteAddressChange(db, tenantId, oldKey);
      if (!gone) return { kind: 'refused', refusal: addressChangeNotFound(oldKey) };
      await recordAddressChangeWrite(db, tenantId, {
        actor: by,
        via: 'api',
        pseudonym,
        before: gone,
        after: null,
        person: personAfter(facts, oldKey, false),
      });
      return { kind: 'row', status: 200, row: addressChangeAnswer(gone, facts) };
    });
    send(res, outcome);
  } catch (error) {
    serverFault(res, 'address_change_delete_failed', 'deleting this address change', error);
  }
});

export default router;
