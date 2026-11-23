// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE APPLIANCE'S ADDRESS CHANGES (ADR-0055; workplan 0168 T2, §7; ADR-0034's
 * doors).
 *
 * The table is the shared chain's `address_change`, so the appliance keeps it
 * on Postgres and on PGlite alike, and the engine reads it the same way on
 * both editions (`Ledger.listConfirmedAddressChanges`). What differs is the
 * door rows come in by:
 *
 *  - **The file (Organisation).** When the config directory holds
 *    `address-changes.json`, that file is the only door. It is read at
 *    start-up, before any pass, and a malformed file stops the start, naming
 *    the file and what is wrong, as a malformed mapping file does. Its rows
 *    become the table, each confirmed by the file, and a row the file no
 *    longer lists is deleted (`replaceAddressChangesFromFile`). The routes
 *    serve them read-only, naming the file, and refuse every write with
 *    `file_door`.
 *  - **The page (Personal).** Without the file, the appliance's own page
 *    writes the rows through `POST /address-changes`, `PUT` and `DELETE`.
 *    Nobody signs in here and the person at the loopback page is the
 *    appliance's owner, so a row written there is `confirmed` with
 *    `confirmedBy: operator`, as its decisions are.
 *
 * WHICH DOOR IS A FACT OF THE CONFIG DIRECTORY, NOT A SETTING. ADR-0034 names
 * an explicit deployment mode, Personal by default; the appliance has no such
 * switch yet, and reads its mapping files from the same directory in every
 * case. So the file's presence is what decides, and the answer says which
 * door it is (`door`, `file`).
 *
 * The appliance has one implicit person and no `address_change_person`
 * (managed-only, `no-managed-leakage.unit.test.ts`): `person` is always null,
 * and a body naming a person is refused. Its configured mappings share one
 * tenant (`applianceTenantId` in `index.ts`), and a write goes to every tenant
 * they name, as a standing answer does, so no migration reads another table.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  addAddressChange,
  deleteAddressChange,
  oldKeyOf,
  readAddressChange,
  readAddressChanges,
  replaceAddressChangesFromFile,
  updateAddressChange,
  withTenant,
  type AddressChangeWrite,
  type LedgerDriver,
} from '@openmig/ledger';
import {
  ADDRESS_CHANGE_OPERATOR,
  ADDRESS_CHANGES_FILE,
  addressChangeNotFound,
  CONFIRMED_HERE,
  fileDoor,
  invalidAddressChange,
  NO_PERSON_HERE,
  parseAddressChangesFile,
  refusalStatus,
  saidBy,
  type AddressChange,
  type AddressChangeRefusal,
  type AddressChangeTable,
  type FileAddressChange,
  type StoredAddressChange,
} from '@openmig/shared';

/** Which door the rows come in by, and what the file said when it is the file. */
export type ApplianceAddressDoor =
  | { readonly door: 'page' }
  | { readonly door: 'file'; readonly file: string; readonly rows: readonly FileAddressChange[] };

/**
 * Read the config directory's door. Throws, naming the file, when the file is
 * there and malformed: the appliance does not start on a table it half read.
 */
export function readAddressDoor(configDir: string): ApplianceAddressDoor {
  const path = join(configDir, ADDRESS_CHANGES_FILE);
  if (!existsSync(path)) return { door: 'page' };
  return { door: 'file', file: ADDRESS_CHANGES_FILE, rows: parseAddressChangesFile(readFileSync(path, 'utf-8')) };
}

/** Make one tenant's table the file's, before any pass of it runs. */
export async function seedAddressChangesFromFile(
  driver: LedgerDriver,
  tenantId: string,
  door: ApplianceAddressDoor,
): Promise<{ readonly added: number; readonly changed: number; readonly removed: number; readonly kept: number } | null> {
  if (door.door !== 'file') return null;
  return withTenant(driver, tenantId, (db) => replaceAddressChangesFromFile(db, tenantId, door.rows, door.file));
}

/** A stored row as the appliance answers it: no person, no "you", the setter in its own words. */
function answer(row: StoredAddressChange): AddressChange {
  const none = (): null => null;
  return {
    oldAddress: row.oldAddress,
    oldKey: row.oldKey,
    newAddress: row.newAddress,
    state: row.state,
    setBy: saidBy(row.setBy, none),
    setByYou: false,
    confirmedBy: saidBy(row.confirmedBy, none),
    confirmedByYou: false,
    createdAt: row.createdAt,
    confirmedAt: row.confirmedAt,
    person: null,
  };
}

/** What the routes need of the appliance around them. */
export interface AddressChangeRouteContext {
  readonly driver: LedgerDriver;
  readonly door: ApplianceAddressDoor;
  /** Every tenant the config directory names, first the one the appliance reads by. */
  readonly tenantIds: () => readonly string[];
  readonly sendJson: (res: ServerResponse, status: number, body: unknown) => void;
  readonly readJson: (req: IncomingMessage) => Promise<unknown>;
  readonly drain: (req: IncomingMessage) => Promise<void>;
}

const PATH = /^\/address-changes(?:\/([^/?]+))?$/;

/**
 * Answer `/address-changes` and `/address-changes/:oldKey`, or return false
 * for any other request, so the caller goes on to its other routes.
 */
export async function handleAddressChanges(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: AddressChangeRouteContext,
): Promise<boolean> {
  const match = PATH.exec(req.url ?? '');
  if (!match) return false;
  const segment = match[1];
  const method = req.method ?? 'GET';
  const refuse = (r: AddressChangeRefusal): void => ctx.sendJson(res, refusalStatus(r), r);
  const tenants = ctx.tenantIds();

  if (method === 'GET' && segment === undefined) {
    const rows = tenants.length === 0 ? [] : await withTenant(ctx.driver, tenants[0]!, (db) => readAddressChanges(db, tenants[0]!));
    const table: AddressChangeTable =
      ctx.door.door === 'file'
        ? { rows: rows.map(answer), door: 'file', file: ctx.door.file }
        : { rows: rows.map(answer), door: 'page', file: null };
    ctx.sendJson(res, 200, table);
    return true;
  }

  const isWrite =
    (method === 'POST' && segment === undefined) || ((method === 'PUT' || method === 'DELETE') && segment !== undefined);
  if (!isWrite) return false;

  if (ctx.door.door === 'file') {
    await ctx.drain(req);
    refuse(fileDoor(ctx.door.file));
    return true;
  }

  let body: unknown;
  if (method === 'DELETE') {
    await ctx.drain(req);
  } else {
    try {
      body = (await ctx.readJson(req)) ?? {};
    } catch (err) {
      refuse(
        invalidAddressChange({
          en: `This request is not JSON: ${err instanceof Error ? err.message : String(err)}`,
          nl: `Dit verzoek is geen JSON: ${err instanceof Error ? err.message : String(err)}`,
        }),
      );
      return true;
    }
    const shape = bodyShape(body, method === 'POST');
    if (shape !== null) {
      refuse(invalidAddressChange(shape));
      return true;
    }
  }

  if (tenants.length === 0) {
    refuse(
      invalidAddressChange({
        en: 'This appliance has no migration yet, so there is no table to change. Add a migration file first.',
        nl: 'Dit apparaat heeft nog geen migratie, dus er is geen tabel om te wijzigen. Voeg eerst een migratiebestand toe.',
      }),
    );
    return true;
  }

  const fields = (body ?? {}) as { oldAddress?: string; newAddress?: string; state?: string };
  const oldKey = segment === undefined ? undefined : oldKeyOf(decodeURIComponent(segment));

  // One table per appliance, written to every tenant its files name. The
  // first tenant's answer is the one served; the others are written the same
  // and refuse the same, because they are kept the same.
  let first: AddressChangeWrite | { ok: 'deleted'; row: StoredAddressChange | undefined } | undefined;
  for (const tenantId of tenants) {
    const outcome = await withTenant(ctx.driver, tenantId, async (db) => {
      if (method === 'POST') {
        return addAddressChange(db, tenantId, {
          oldAddress: fields.oldAddress!,
          newAddress: fields.newAddress!,
          confirm: true,
          by: ADDRESS_CHANGE_OPERATOR,
        });
      }
      if (method === 'PUT') {
        return updateAddressChange(db, tenantId, oldKey!, {
          ...(fields.newAddress === undefined ? {} : { newAddress: fields.newAddress }),
          // A row the page writes is confirmed: a new address is confirmed with it.
          state: 'confirmed',
          by: ADDRESS_CHANGE_OPERATOR,
        });
      }
      const before = await readAddressChange(db, tenantId, oldKey!);
      if (before) await deleteAddressChange(db, tenantId, oldKey!);
      return { ok: 'deleted' as const, row: before };
    });
    first ??= outcome;
    if (outcome.ok === false) break;
  }

  if (first === undefined) return true;
  if (first.ok === 'deleted') {
    if (!first.row) refuse(addressChangeNotFound(oldKey!));
    else ctx.sendJson(res, 200, answer(first.row));
    return true;
  }
  if (!first.ok) {
    refuse(first.refusal);
    return true;
  }
  ctx.sendJson(res, first.created ? 201 : 200, answer(first.row));
  return true;
}

/** Why a body is not the route's shape, in both languages, or null when it is. */
function bodyShape(body: unknown, create: boolean): { en: string; nl: string } | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { en: 'The body must be a JSON object.', nl: 'De inhoud moet een JSON-object zijn.' };
  }
  const b = body as Record<string, unknown>;
  if ('personId' in b) return NO_PERSON_HERE;
  if (!create && b.state === 'proposed') return CONFIRMED_HERE;
  const allowed = create ? ['oldAddress', 'newAddress', 'confirm'] : ['newAddress', 'state'];
  const extra = Object.keys(b).find((k) => !allowed.includes(k));
  if (extra !== undefined) {
    return { en: `The body has a field this route does not take: ${extra}.`, nl: `De inhoud heeft een veld dat hier niet past: ${extra}.` };
  }
  if (create && (typeof b.oldAddress !== 'string' || typeof b.newAddress !== 'string')) {
    return { en: 'An address change needs oldAddress and newAddress.', nl: 'Een adreswijziging heeft oldAddress en newAddress nodig.' };
  }
  if (!create && b.newAddress !== undefined && typeof b.newAddress !== 'string') {
    return { en: 'newAddress is a string.', nl: 'newAddress is tekst.' };
  }
  if (!create && b.state !== undefined && b.state !== 'confirmed') {
    return { en: 'state is confirmed here.', nl: 'state is hier confirmed.' };
  }
  return null;
}
