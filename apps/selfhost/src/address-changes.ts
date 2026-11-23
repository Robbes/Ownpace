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
 *    `confirmedBy: operator`, as its decisions are. A file that is gone takes
 *    its rows with it: at start-up, every row `address-changes.json` set is
 *    deleted, and the log says how many (0168's review, finding 7). A row
 *    nothing can change any more is not one anybody chose to keep.
 *
 * WHICH DOOR IS A FACT OF THE CONFIG DIRECTORY, NOT A SETTING. ADR-0034 names
 * an explicit deployment mode, Personal by default; the appliance has no such
 * switch yet, and reads its mapping files from the same directory in every
 * case. So the file's presence is what decides, and the answer says which
 * door it is (`door`, `file`).
 *
 * ONE TABLE, HOWEVER MANY TENANTS (0168's review, finding 5). The config
 * directory's mappings may name more than one tenant, and every migration
 * reads its own tenant's table, so the tables are kept equal: through the
 * file, each is made the file's; through the page, each is made, at start-up,
 * the first tenant's that holds any row (in the order the directory names
 * them, so a mapping added later, whose tenant's table is empty, takes the
 * rows rather than emptying everyone's), and after every write on the page,
 * the table the write was decided in is copied to every other tenant. So the
 * table `GET` reads, the first tenant's, is every tenant's, and a `DELETE`
 * deletes the row wherever it is and says so.
 *
 * EVERY WRITE ON THE PAGE IS RECORDED in the appliance's own audit trail, as
 * its other presses are: `operator`, the row by reference (its key as the
 * audit export's pseudonym) and the states it went from and to, never an
 * address (`recordAddressChangeWrite`). Once, in the tenant the write was
 * decided in, since the log reads every tenant's records as one. What the file
 * writes at start-up is said in the start-up log instead: it is the file's
 * text, which the person who keeps the file keeps.
 *
 * The appliance has one implicit person and no `address_change_person`
 * (managed-only, `no-managed-leakage.unit.test.ts`): `person` is always null,
 * and a body naming a person is refused.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  addAddressChange,
  deleteAddressChange,
  deleteAddressChangesSetBy,
  deploymentKeyFor,
  oldKeyOf,
  readAddressChanges,
  recordAddressChangeWrite,
  replaceAddressChanges,
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
  AUDIT_PSEUDONYM_PURPOSE,
  CONFIRMED_HERE,
  fileDoor,
  invalidAddressChange,
  isAddress,
  NO_PERSON_HERE,
  parseAddressChangesFile,
  pseudonymizer,
  refusalStatus,
  saidBy,
  type AddressChange,
  type AddressChangeRefusal,
  type AddressChangeTable,
  type Bilingual,
  type FileAddressChange,
  type Pseudonymize,
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

/** What every configured tenant's table is made at start-up, before any of its passes runs. */
export type AddressTableAtStart =
  | { readonly door: 'file'; readonly file: string; readonly rows: readonly FileAddressChange[] }
  | {
      readonly door: 'page';
      /** The first tenant's table that holds any row, or null when none holds one. */
      readonly rows: readonly StoredAddressChange[] | null;
      /** How many rows `address-changes.json` had set, deleted now that it is gone. */
      readonly fileRowsDeleted: number;
    };

/**
 * Decide the table every configured tenant starts with (0168's review,
 * findings 5 and 7), in the order the config directory names the tenants.
 *
 * Through the file, it is the file's. Through the page, first every row the
 * file set is deleted, in every tenant, since the file is gone; then it is
 * the first tenant's table that still holds a row. Writes nothing to any
 * other row: `seedAddressChanges` makes each tenant's table this, once that
 * tenant's own row exists.
 */
export async function addressTableAtStart(
  driver: LedgerDriver,
  tenantIds: readonly string[],
  door: ApplianceAddressDoor,
): Promise<AddressTableAtStart> {
  if (door.door === 'file') return { door: 'file', file: door.file, rows: door.rows };
  const deleted = new Set<string>();
  for (const tenantId of tenantIds) {
    const keys = await withTenant(driver, tenantId, (db) => deleteAddressChangesSetBy(db, tenantId, ADDRESS_CHANGES_FILE));
    for (const k of keys) deleted.add(k);
  }
  for (const tenantId of tenantIds) {
    const rows = await withTenant(driver, tenantId, (db) => readAddressChanges(db, tenantId));
    if (rows.length > 0) return { door: 'page', rows, fileRowsDeleted: deleted.size };
  }
  return { door: 'page', rows: null, fileRowsDeleted: deleted.size };
}

/**
 * Make one tenant's table the one it starts with, before any pass of it runs.
 * Null when there is nothing to make it: the page's tables, all empty.
 */
export async function seedAddressChanges(
  driver: LedgerDriver,
  tenantId: string,
  start: AddressTableAtStart,
): Promise<{ readonly added: number; readonly changed: number; readonly removed: number; readonly kept: number } | null> {
  if (start.door === 'file') {
    return withTenant(driver, tenantId, (db) => replaceAddressChangesFromFile(db, tenantId, start.rows, start.file));
  }
  const rows = start.rows;
  if (rows === null) return null;
  return withTenant(driver, tenantId, (db) => replaceAddressChanges(db, tenantId, rows));
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

/** A path whose `%` escapes do not decode (0168's review, finding 10): the caller's 400, not our 500. */
const PATH_NOT_ENCODED: Bilingual = {
  en: 'The address in the path is not encoded correctly. Encode it as encodeURIComponent does.',
  nl: 'Het adres in het pad is niet goed gecodeerd. Codeer het zoals encodeURIComponent dat doet.',
};

/** Before a mapping file names a tenant there is no table to write. */
const NO_TABLE_YET: Bilingual = {
  en: 'This appliance has no migration yet, so there is no table to change. Add a migration file first.',
  nl: 'Deze appliance heeft nog geen migratie, dus er is geen tabel om te wijzigen. Voeg eerst een migratiebestand toe.',
};

/**
 * The audit export's pseudonym under this appliance's key, read once per
 * database, outside any transaction: on PGlite the key's read takes the one
 * connection, which a transaction already holds. A failed read is forgotten,
 * so the next write asks again.
 */
const KEYS = new WeakMap<LedgerDriver, Promise<Uint8Array>>();
async function pseudonymOn(driver: LedgerDriver): Promise<Pseudonymize> {
  let key = KEYS.get(driver);
  if (!key) {
    key = deploymentKeyFor(driver, AUDIT_PSEUDONYM_PURPOSE);
    KEYS.set(driver, key);
    key.catch(() => KEYS.delete(driver));
  }
  return pseudonymizer(await key);
}

/** Copy one tenant's table to every other configured tenant, after a write on the page (finding 5). */
async function copyToTheOthers(driver: LedgerDriver, from: string, table: readonly StoredAddressChange[], tenants: readonly string[]) {
  for (const tenantId of tenants) {
    if (tenantId === from) continue;
    await withTenant(driver, tenantId, (db) => replaceAddressChanges(db, tenantId, table));
  }
}

/**
 * One write on the page at a time, its copies included. The organisation's
 * lock orders two writes in the tenant they are decided in, but not their
 * copies to the others, which are transactions of their own: the first write
 * could copy the table it saw after the second had copied the one it saw.
 * The appliance is one process, so an order kept here is the only order.
 */
const WRITING = new WeakMap<LedgerDriver, Promise<unknown>>();
export function oneAtATime<T>(driver: LedgerDriver, work: () => Promise<T>): Promise<T> {
  const next = (WRITING.get(driver) ?? Promise.resolve()).then(work, work);
  // The next write waits for this one to settle, either way; its failure is
  // the caller's, through `next`, and settling keeps it from being thrown twice.
  WRITING.set(driver, Promise.allSettled([next]));
  return next;
}

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
    // The first tenant's table is every tenant's: they are kept equal.
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
      // Only a body that does not parse is the caller's; a request cut short
      // goes on to the server's own catch, which logs it (hard rule 9).
      if (!(err instanceof SyntaxError)) throw err;
      refuse(invalidAddressChange({ en: `This request is not JSON: ${err.message}`, nl: 'Dit verzoek is geen JSON.' }));
      return true;
    }
    const shape = bodyShape(body, method === 'POST');
    if (shape !== null) {
      refuse(invalidAddressChange(shape));
      return true;
    }
  }

  // The key in the path: decoded, or the caller's 400; and a value that is no
  // address names no row, so it is not asked of the database.
  let oldKey: string | undefined;
  if (segment !== undefined) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      refuse(invalidAddressChange(PATH_NOT_ENCODED));
      return true;
    }
    if (!isAddress(decoded)) {
      refuse(addressChangeNotFound(decoded));
      return true;
    }
    oldKey = oldKeyOf(decoded);
  }

  if (tenants.length === 0) {
    refuse(invalidAddressChange(NO_TABLE_YET));
    return true;
  }

  const fields = (body ?? {}) as { oldAddress?: string; newAddress?: string; state?: string };
  const pseudonym = await pseudonymOn(ctx.driver);
  const record = { actor: ADDRESS_CHANGE_OPERATOR, via: 'page', pseudonym } as const;

  if (method === 'DELETE') {
    // Wherever the row is, it goes, and the answer says so: each tenant's
    // DELETE answers what it removed. Recorded once, in the first tenant
    // that held it.
    const gone = await oneAtATime(ctx.driver, async () => {
      let first: StoredAddressChange | undefined;
      for (const tenantId of tenants) {
        const here = await withTenant(ctx.driver, tenantId, async (db) => {
          const deleted = await deleteAddressChange(db, tenantId, oldKey!);
          if (deleted && !first) await recordAddressChangeWrite(db, tenantId, { ...record, before: deleted, after: null });
          return deleted;
        });
        first ??= here;
      }
      return first;
    });
    if (!gone) refuse(addressChangeNotFound(oldKey!));
    else ctx.sendJson(res, 200, answer(gone));
    return true;
  }

  // POST and PUT are decided in the first tenant, recorded there, and its
  // table, as the write left it, is copied to every other tenant.
  const decidedIn = tenants[0]!;
  const w = await oneAtATime(ctx.driver, async (): Promise<AddressChangeWrite> => {
    const decided = await withTenant(ctx.driver, decidedIn, async (db) => {
      const write: AddressChangeWrite =
        method === 'POST'
          ? await addAddressChange(db, decidedIn, {
              oldAddress: fields.oldAddress!,
              newAddress: fields.newAddress!,
              confirm: true,
              by: ADDRESS_CHANGE_OPERATOR,
            })
          : await updateAddressChange(db, decidedIn, oldKey!, {
              ...(fields.newAddress === undefined ? {} : { newAddress: fields.newAddress }),
              // A row the page writes is confirmed: a new address is confirmed with it.
              state: 'confirmed',
              by: ADDRESS_CHANGE_OPERATOR,
            });
      if (!write.ok) return { write, table: null };
      await recordAddressChangeWrite(db, decidedIn, { ...record, before: write.before, after: write.row });
      return { write, table: await readAddressChanges(db, decidedIn) };
    });
    if (decided.table !== null) await copyToTheOthers(ctx.driver, decidedIn, decided.table, tenants);
    return decided.write;
  });
  if (!w.ok) {
    refuse(w.refusal);
    return true;
  }
  ctx.sendJson(res, w.created ? 201 : 200, answer(w.row));
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
