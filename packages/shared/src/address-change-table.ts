// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE TABLE OF ADDRESS CHANGES, AS BOTH EDITIONS SERVE IT (ADR-0055; workplan
 * 0168 T2, §4.2, §4.4, §7).
 *
 * One table per organisation, one row per old address, keyed by `addressKey`
 * (`address-forms.ts`). The managed API serves it at `/api/address-changes`
 * and the appliance at `/address-changes`, in the shapes here (ADR-0026), and
 * `apps/api/docs/openapi.yaml` is the contract both are held to.
 *
 * What this file holds, so that the two editions cannot disagree:
 *
 *  - the shapes a row and the table are answered in;
 *  - the rules a row is checked by before it is written (`checkAddressChange`):
 *    both values are addresses, the new one is not the old one in another
 *    spelling, an old address has one row, and no change runs on into another
 *    (`chained`, 0168 §1.2: the table stores each old address against its
 *    final new address, so no chain is ever applied);
 *  - every refusal, in English and in Dutch. The server writes these, so the
 *    web dictionary cannot hold them: this is the class-4 pattern of
 *    `docs/i18n-prose-boundary.md`, the one `link-holder-refusals.ts` follows,
 *    with the Dutch beside its English, changed together or neither;
 *  - the appliance's Organisation door: `address-changes.json` in its config
 *    directory, parsed by `parseAddressChangesFile`, which refuses a file that
 *    is not the shape, naming what is wrong.
 *
 * An address in a refusal is a finding, the value the person typed: it is put
 * into both halves verbatim. The rest of each sentence is ours.
 *
 * WHAT IS NOT HERE: the change itself (`applyAddressChanges`) and the table's
 * digest (`addressTableDigest`) are `address-changes.ts`'s (0168 T3). This
 * file never reads an item.
 */

import { addressKey, isAddress } from './address-forms.ts';
import type { Bilingual } from './link-holder-refusals.ts';
import { PERSON_NOT_FOUND } from './people.ts';

/**
 * The longest address a row may hold (RFC 5321's path). `address_change`'s
 * CHECKs say the same of the old address, its key and the new address.
 */
export const ADDRESS_CHANGE_MAX = 254;

/**
 * The most rows one organisation's table holds (0168's review, finding 11).
 *
 * A family changes a handful of addresses and a small team a few dozen, so
 * nobody the table is for reaches this. It bounds what every write reads
 * under the organisation's lock, and what every pass reads at its start. The
 * appliance's `address-changes.json` is held to it too.
 */
export const ADDRESS_CHANGE_ROWS_MAX = 300;

/** The two states a row may be in. Only `confirmed` reaches a writer. */
export const ADDRESS_CHANGE_STATES = ['proposed', 'confirmed'] as const;
export type AddressChangeState = (typeof ADDRESS_CHANGE_STATES)[number];

/** Where a table's rows are written (`AddressChangeTable.door`). */
export type AddressChangeDoor = 'api' | 'page' | 'file';

/** The Organisation door's file, in the appliance's config directory (0168 §7). */
export const ADDRESS_CHANGES_FILE = 'address-changes.json';

/**
 * Who set or confirmed a row on the appliance's own page: the person at its
 * loopback page is its owner, the word its decisions already use.
 */
export const ADDRESS_CHANGE_OPERATOR = 'operator';

/** The refusals, by name. */
export const NOT_AN_ADDRESS = 'not_an_address';
export const SAME_ADDRESS = 'same_address';
export const ALREADY_CHANGED = 'already_changed';
export const CHAINED = 'chained';
export const ADDRESS_CHANGE_NOT_FOUND = 'address_change_not_found';
export const FILE_DOOR = 'file_door';
export const INVALID_ADDRESS_CHANGE = 'invalid_request';
export const TOO_MANY_ADDRESS_CHANGES = 'too_many_address_changes';
/** Managed: what only an owner or an admin may do (0168 §4.4, D6). */
export const OWNER_OR_ADMIN_ONLY = 'owner_or_admin_only';
/** Managed: a member confirms or sends back only a row that is their own person's. */
export const NOT_YOUR_ADDRESS_CHANGE = 'not_your_address_change';

/** A row as it is stored, in the words both editions read it in. */
export interface StoredAddressChange {
  readonly oldKey: string;
  readonly oldAddress: string;
  readonly newAddress: string;
  readonly state: AddressChangeState;
  /** The decision idiom as stored: a sign-in subject, `operator`, or the file's name. */
  readonly setBy: string;
  readonly confirmedBy: string | null;
  readonly createdAt: string;
  readonly confirmedAt: string | null;
}

/**
 * A confirmed row as the engine reads it (`Ledger.listConfirmedAddressChanges`):
 * the shape of `address-changes.ts`'s `ConfirmedAddressChange` (0168 T3), which
 * this is assignable to field for field.
 */
export interface ConfirmedAddressChangeRow {
  readonly oldKey: string;
  readonly oldAddress: string;
  readonly newAddress: string;
}

/** One row as the routes answer it. `setBy` and `confirmedBy` are said, never an id. */
export interface AddressChange {
  readonly oldAddress: string;
  readonly oldKey: string;
  readonly newAddress: string;
  readonly state: AddressChangeState;
  readonly setBy: string | null;
  readonly setByYou: boolean;
  readonly confirmedBy: string | null;
  readonly confirmedByYou: boolean;
  readonly createdAt: string;
  readonly confirmedAt: string | null;
  /** Managed only: whose old address it is. Always null on the appliance. */
  readonly person: { readonly id: string; readonly displayName: string } | null;
}

/** `GET /api/address-changes` and the appliance's `GET /address-changes`. */
export interface AddressChangeTable {
  readonly rows: readonly AddressChange[];
  readonly door: AddressChangeDoor;
  /** The file the rows come from when `door` is `file`; null otherwise. */
  readonly file: string | null;
}

/** The row a refusal names. */
export interface NamedRow {
  readonly oldAddress: string;
  readonly oldKey: string;
  readonly newAddress: string;
}

/** A refusal as it is answered: `{error, message, messageNl}`, and what it names. */
export interface AddressChangeRefusal {
  readonly error: string;
  readonly message: string;
  readonly messageNl: string;
  readonly field?: 'oldAddress' | 'newAddress';
  readonly row?: NamedRow;
  readonly file?: string;
}

/** The status a refusal is answered with. */
export function refusalStatus(refusal: AddressChangeRefusal): 400 | 403 | 404 | 409 {
  switch (refusal.error) {
    case OWNER_OR_ADMIN_ONLY:
    case NOT_YOUR_ADDRESS_CHANGE:
      return 403;
    case ADDRESS_CHANGE_NOT_FOUND:
    case PERSON_NOT_FOUND:
      return 404;
    case ALREADY_CHANGED:
    case CHAINED:
    case FILE_DOOR:
    case TOO_MANY_ADDRESS_CHANGES:
      return 409;
    default:
      return 400;
  }
}

function refusal(error: string, text: Bilingual, extra: Partial<AddressChangeRefusal> = {}): AddressChangeRefusal {
  return { error, message: text.en, messageNl: text.nl, ...extra };
}

const named = (r: { oldAddress: string; oldKey: string; newAddress: string }): NamedRow => ({
  oldAddress: r.oldAddress,
  oldKey: r.oldKey,
  newAddress: r.newAddress,
});

/** A value that is not an address, said for the field it was typed in. */
export function notAnAddress(field: 'oldAddress' | 'newAddress', value: string): AddressChangeRefusal {
  const shown = value.trim();
  const text: Bilingual =
    field === 'oldAddress'
      ? {
          en: `The old address "${shown}" is not an email address. Type it as name@example.org.`,
          nl: `Het oude adres "${shown}" is geen e-mailadres. Typ het als naam@example.org.`,
        }
      : {
          en: `The new address "${shown}" is not an email address. Type it as name@example.org.`,
          nl: `Het nieuwe adres "${shown}" is geen e-mailadres. Typ het als naam@example.org.`,
        };
  return refusal(NOT_AN_ADDRESS, text, { field });
}

/** The new address is the old one in another spelling, so nothing would change. */
export function sameAddress(oldAddress: string, newAddress: string): AddressChangeRefusal {
  return refusal(SAME_ADDRESS, {
    en: `${newAddress.trim()} is the same address as ${oldAddress.trim()}, so nothing would change. Type the new address.`,
    nl: `${newAddress.trim()} is hetzelfde adres als ${oldAddress.trim()}, dus er verandert niets. Typ het nieuwe adres.`,
  });
}

/** The old address has a row already, with another new address. */
export function alreadyChanged(row: StoredAddressChange): AddressChangeRefusal {
  return refusal(
    ALREADY_CHANGED,
    {
      en: `${row.oldAddress} already becomes ${row.newAddress}. Change that address change instead of adding another.`,
      nl: `${row.oldAddress} wordt al ${row.newAddress}. Wijzig die adreswijziging in plaats van er een toe te voegen.`,
    },
    { row: named(row) },
  );
}

/**
 * The new address is itself an old address in the table: the change would run
 * on into that row. The person names the final address instead.
 */
export function chainedOnward(row: StoredAddressChange): AddressChangeRefusal {
  return refusal(
    CHAINED,
    {
      en: `${row.oldAddress} is changing too, to ${row.newAddress}. Use ${row.newAddress} as the new address.`,
      nl: `${row.oldAddress} verandert zelf ook, in ${row.newAddress}. Gebruik ${row.newAddress} als het nieuwe adres.`,
    },
    { row: named(row) },
  );
}

/**
 * The old address is another row's new address: that row would run on into
 * this one. The person changes that row to the final address instead.
 */
export function chainedBack(row: StoredAddressChange, newAddress: string): AddressChangeRefusal {
  return refusal(
    CHAINED,
    {
      en:
        `${row.oldAddress} already becomes ${row.newAddress}. Change that address change to ` +
        `${newAddress.trim()} instead, so that each old address goes straight to its new one.`,
      nl:
        `${row.oldAddress} wordt al ${row.newAddress}. Wijzig die adreswijziging in ` +
        `${newAddress.trim()}, zodat elk oud adres meteen naar het nieuwe gaat.`,
    },
    { row: named(row) },
  );
}

/** No row for the key in the path. */
export function addressChangeNotFound(oldKey: string): AddressChangeRefusal {
  return refusal(ADDRESS_CHANGE_NOT_FOUND, {
    en: `There is no address change for ${oldKey}. It may have been deleted already.`,
    nl: `Er is geen adreswijziging voor ${oldKey}. Misschien is die al verwijderd.`,
  });
}

/** The appliance's rows are its file's: every write is refused, naming the file. */
export function fileDoor(file: string = ADDRESS_CHANGES_FILE): AddressChangeRefusal {
  return refusal(
    FILE_DOOR,
    {
      en:
        `The address changes here are read from ${file} in the config directory. ` +
        'Change them in that file, then restart.',
      nl:
        `De adreswijzigingen worden hier gelezen uit ${file} in de configuratiemap. ` +
        'Wijzig ze in dat bestand en start daarna opnieuw.',
    },
    { file },
  );
}

/** A body that is not the route's shape, with the reason in both languages. */
export function invalidAddressChange(text: Bilingual): AddressChangeRefusal {
  return refusal(INVALID_ADDRESS_CHANGE, text);
}

/** The table holds `ADDRESS_CHANGE_ROWS_MAX` rows already: a new one is refused, nothing written. */
export function tooManyAddressChanges(max: number = ADDRESS_CHANGE_ROWS_MAX): AddressChangeRefusal {
  return refusal(TOO_MANY_ADDRESS_CHANGES, {
    en: `The table holds ${max} address changes, the most it can hold. Delete one that is no longer needed before you add another.`,
    nl: `De tabel bevat ${max} adreswijzigingen, het maximum. Verwijder er een die niet meer nodig is voordat u er een toevoegt.`,
  });
}

/** Managed: the body names a person this organisation does not have. The people pages' own words. */
export function personNotFound(): AddressChangeRefusal {
  return refusal(PERSON_NOT_FOUND, {
    en: 'There is no such person here.',
    nl: 'Deze persoon bestaat hier niet.',
  });
}

/**
 * Managed: adding, changing or deleting a row, or confirming one for someone
 * else, is an owner's or an admin's (0168 §4.4, D6). A member may confirm
 * their own row, or send it back.
 */
export function ownerOrAdminOnly(): AddressChangeRefusal {
  return refusal(OWNER_OR_ADMIN_ONLY, {
    en:
      'Only an owner or an admin of this organisation can add, change or delete an address change. ' +
      'You can confirm your own address change, or send it back.',
    nl:
      'Alleen een eigenaar of beheerder van deze organisatie kan een adreswijziging toevoegen, wijzigen of ' +
      'verwijderen. Uw eigen adreswijziging kunt u bevestigen of terugsturen.',
  });
}

/**
 * Managed: a member's confirmation or *Not right?* of a row that is not their
 * own person's. Said the same whether or not the row exists, so a member
 * learns nothing of the rows they cannot read.
 */
export function notYourAddressChange(): AddressChangeRefusal {
  return refusal(NOT_YOUR_ADDRESS_CHANGE, {
    en: 'This is not your address change, so only an owner or an admin of this organisation can confirm it or send it back.',
    nl: 'Dit is niet uw adreswijziging, dus alleen een eigenaar of beheerder van deze organisatie kan die bevestigen of terugsturen.',
  });
}

/** The appliance has one implicit person: a body naming a person is refused. */
export const NO_PERSON_HERE: Bilingual = {
  en: 'This appliance moves one person, so an address change here names no person. Leave personId out.',
  nl: 'Deze appliance migreert voor één persoon, dus een adreswijziging noemt hier geen persoon. Laat personId weg.',
};

/** The appliance's page keeps its rows confirmed: a row it does not want is deleted. */
export const CONFIRMED_HERE: Bilingual = {
  en: 'An address change made on this appliance is confirmed by its owner. Delete it if it is not right.',
  nl: 'Een adreswijziging op deze appliance is bevestigd door de eigenaar. Verwijder die als die niet klopt.',
};

/** What a row is checked against: the rest of the organisation's table. */
export interface CandidateChange {
  readonly oldAddress: string;
  readonly newAddress: string;
}

/**
 * Check a row against the table it would join, before anything is written.
 *
 * `table` is every row of the organisation. `replacing` is the key of the row
 * being changed (a `PUT`), which is left out of the comparison; for an add it
 * is undefined, and a row with the same old key and the same new address is
 * answered `{ ok: true, same }` so the route can answer 200 with no write.
 *
 * Order matters only in which refusal a body with two faults hears first: the
 * values, then the old address's own row, then the chains, then the table's
 * size (`ADDRESS_CHANGE_ROWS_MAX`, for a new row only: the same change again
 * is still answered with its row).
 *
 * The lengths are the CHECKs' of `address_change` (ledger 0071), so a value
 * that passes here is one the table stores. The KEY is measured as well as
 * the address typed: lower case can be longer than the address (`İ` is one
 * character, and two once lower-cased), and a key over the limit failed the
 * write with a 500 (0168's review, finding 3).
 */
export function checkAddressChange(
  table: readonly StoredAddressChange[],
  candidate: CandidateChange,
  replacing?: string,
):
  | { readonly ok: true; readonly oldKey: string; readonly same: StoredAddressChange | null }
  | { readonly ok: false; readonly refusal: AddressChangeRefusal } {
  const { oldAddress, newAddress } = candidate;
  if (
    !isAddress(oldAddress) ||
    oldAddress.trim().length > ADDRESS_CHANGE_MAX ||
    addressKey(oldAddress).length > ADDRESS_CHANGE_MAX
  ) {
    return { ok: false, refusal: notAnAddress('oldAddress', oldAddress) };
  }
  if (!isAddress(newAddress) || newAddress.trim().length > ADDRESS_CHANGE_MAX) {
    return { ok: false, refusal: notAnAddress('newAddress', newAddress) };
  }
  const oldKey = addressKey(oldAddress);
  const newKey = addressKey(newAddress);
  if (oldKey === newKey) return { ok: false, refusal: sameAddress(oldAddress, newAddress) };

  const others = table.filter((r) => r.oldKey !== replacing);
  const own = others.find((r) => r.oldKey === oldKey);
  if (own) {
    if (replacing === undefined && addressKey(own.newAddress) === newKey) {
      return { ok: true, oldKey, same: own };
    }
    return { ok: false, refusal: alreadyChanged(own) };
  }
  const onward = others.find((r) => r.oldKey === newKey);
  if (onward) return { ok: false, refusal: chainedOnward(onward) };
  const back = others.find((r) => addressKey(r.newAddress) === oldKey);
  if (back) return { ok: false, refusal: chainedBack(back, newAddress) };
  if (replacing === undefined && table.length >= ADDRESS_CHANGE_ROWS_MAX) {
    return { ok: false, refusal: tooManyAddressChanges() };
  }
  return { ok: true, oldKey, same: null };
}

/** One row of `address-changes.json`, read. */
export interface FileAddressChange {
  readonly oldKey: string;
  readonly oldAddress: string;
  readonly newAddress: string;
}

/**
 * Read `address-changes.json` (0168 §7, the Organisation door).
 *
 * The shape is `{ "changes": [ { "oldAddress": "…", "newAddress": "…" } ] }`.
 * A row in the file is confirmed by the admin who wrote it, so the file has no
 * state. Every row is held to the rules a `POST` is held to, against the rows
 * above it in the file, and any fault refuses the whole file: a table that is
 * half read would change some copies and not others, which nobody chose.
 *
 * Throws an `Error` whose message names the file and what is wrong, in
 * English, for the start-up log; a malformed file stops the appliance from
 * starting, as a malformed mapping file does.
 */
export function parseAddressChangesFile(text: string, file: string = ADDRESS_CHANGES_FILE): FileAddressChange[] {
  const fail = (why: string): never => {
    throw new Error(`Invalid ${file}: ${why}`);
  };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return fail(`it is not JSON (${err instanceof Error ? err.message : String(err)}).`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return fail('it must be an object with a "changes" list.');
  }
  const extra = Object.keys(parsed).filter((k) => k !== 'changes');
  if (extra.length > 0) return fail(`it has a field this file does not take: "${extra[0]}".`);
  const changes = (parsed as { changes?: unknown }).changes;
  if (!Array.isArray(changes)) return fail('"changes" must be a list.');
  if (changes.length > ADDRESS_CHANGE_ROWS_MAX) {
    return fail(`it lists ${changes.length} changes, and a table holds at most ${ADDRESS_CHANGE_ROWS_MAX}.`);
  }

  const rows: StoredAddressChange[] = [];
  changes.forEach((entry: unknown, i) => {
    const at = `change ${i + 1}`;
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return fail(`${at} must be an object with "oldAddress" and "newAddress".`);
    }
    const unknownField = Object.keys(entry).find((k) => k !== 'oldAddress' && k !== 'newAddress');
    if (unknownField !== undefined) return fail(`${at} has a field this file does not take: "${unknownField}".`);
    const { oldAddress, newAddress } = entry as { oldAddress?: unknown; newAddress?: unknown };
    if (typeof oldAddress !== 'string' || typeof newAddress !== 'string') {
      return fail(`${at} needs "oldAddress" and "newAddress", each a string.`);
    }
    const checked = checkAddressChange(rows, { oldAddress, newAddress });
    if (!checked.ok) return fail(`${at}: ${checked.refusal.message}`);
    if (checked.same) return fail(`${at} repeats the change above it.`);
    rows.push({
      oldKey: checked.oldKey,
      oldAddress: oldAddress.trim(),
      newAddress: newAddress.trim(),
      state: 'confirmed',
      setBy: file,
      confirmedBy: file,
      createdAt: '',
      confirmedAt: '',
    });
  });
  return rows.map((r) => ({ oldKey: r.oldKey, oldAddress: r.oldAddress, newAddress: r.newAddress }));
}

/**
 * A PERSON'S OWN CONFIRMATION, THROUGH THEIR LINK (workplan 0168 §4.4, D6;
 * ADR-0035): how it is stored in `confirmed_by`. Managed only, since only
 * managed has people and their links.
 *
 * `person:` and the person's id. The decision idiom stores a sign-in's
 * subject, and a link carries none: the person holding it has no account. Nor
 * is it the member who issued the link, or the member the person may also be,
 * whose subject would be said as that member's address: the person is who
 * confirmed. So the stored value names the person, and is said as the
 * person's name (`saidBy`), never as the id. No column changes for it:
 * `confirmed_by` is free text, and its CHECK asks only that a confirmed row
 * says somebody (ledger 0071).
 */
export const CONFIRMED_BY_PERSON = 'person:';

/** The `confirmed_by` of a confirmation through this person's own link. */
export function confirmedByPerson(personId: string): string {
  return `${CONFIRMED_BY_PERSON}${personId}`;
}

/** The person a stored `confirmed_by` names when they confirmed through their own link, or null. */
export function personWhoConfirmed(stored: string | null): string | null {
  if (stored === null || !stored.startsWith(CONFIRMED_BY_PERSON)) return null;
  const id = stored.slice(CONFIRMED_BY_PERSON.length);
  return id === '' ? null : id;
}

/**
 * Who set or confirmed a row, as a person may read it (the decision idiom,
 * `Decisions.tsx`'s "by" rule): an address, or the appliance's own words.
 * `labelOf` turns a stored subject into the member's address on managed, and
 * a stored value it cannot say is null, never the id.
 *
 * A person's own confirmation through their link (`CONFIRMED_BY_PERSON`) is
 * said as `labelOf` names that person: their name, which is no address. A
 * label that is the stored value or the bare id is not said either.
 */
export function saidBy(stored: string | null, labelOf: (stored: string) => string | null): string | null {
  if (stored === null) return null;
  if (stored === ADDRESS_CHANGE_OPERATOR || stored === ADDRESS_CHANGES_FILE) return stored;
  const label = labelOf(stored);
  if (label === null) return null;
  const person = personWhoConfirmed(stored);
  if (person !== null) {
    const name = label.trim();
    return name === '' || name === stored || name === person ? null : name;
  }
  return label.includes('@') ? label : null;
}
