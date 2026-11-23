// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A NEW ADDRESS, AS A DECLARED CHANGE (workplan 0168 §2, §3.1, §3.2, T3;
 * ADR-0055).
 *
 * `applyAddressChanges` is a pure function of a contact's or an event's
 * source bytes and the organisation's table of **confirmed** address changes.
 * The contact and calendar writers apply it first, before `repairPayload` and
 * before `neutraliseScheduling` (0168 T4). Mail never reaches it: a guard
 * beside this file walks the mail path's imports (D1).
 *
 * ## What it changes
 *
 * - **vCard `EMAIL` (D2).** A line whose address is an old address in the
 *   table gains the new address on a line of its own, put before the card's
 *   first `EMAIL` and marked preferred (`PREF=1`; in a vCard 2.1 or 3.0,
 *   which has no `PREF` parameter, `TYPE=pref`). The old line stays and loses
 *   its preference. A card that already lists the new address gains no line:
 *   that address's own line takes the preference instead, where no gained
 *   line has it, so mail goes to the new address there too (the data-path
 *   review's N2).
 * - **iCalendar `ORGANIZER` (D3).** Its address is replaced when it is an old
 *   address in the table. `CN` and every other parameter are kept.
 * - **iCalendar `ATTENDEE` (D3).** Its address is replaced when it is an old
 *   address in the table **and** the component's organiser is in the table
 *   (an old or a new address of a row) or is one of the account's own
 *   addresses (`ownKeys`). An invitation from anyone else is left as it is.
 * - A `mailto:` value is matched on the address after it, ignoring case, and
 *   the scheme is written back as the source spelled it. An `EMAIL=`
 *   parameter whose address is an old one changes with the value.
 *
 * ## What it never changes
 *
 * Free text (`SUMMARY`, `DESCRIPTION`, `LOCATION`, `NOTE`, `COMMENT`), display
 * names (`FN`, `N`, a `CN` parameter, even one that spells the old address),
 * UIDs, and every line it does not deliberately rewrite, byte for byte, folds
 * and line ends included. An `ATTENDEE` inside a `VALARM` is who an email
 * alarm goes to, not a guest, and is left alone.
 *
 * ## Idempotency (0168 §3.2)
 *
 * - An empty table is the identity, byte for byte.
 * - `f(f(x)) = f(x)`: a table is refused when a new address is itself an old
 *   address of the table (`chained`), so a changed address never matches
 *   again, and a card that already lists its new address, preferred, gains
 *   nothing.
 *
 * A rewritten line is emitted unfolded, as `neutraliseScheduling` emits one:
 * a long line is legal (75 octets is a SHOULD) and servers re-fold it.
 *
 * ## The digest a copy records (0168 §3.1, S4)
 *
 * Per item: the digest of the confirmed rows that decided the body's bytes
 * (each row whose old address a line names, and each row that puts an
 * event's organiser in the table), or null when nothing changed. Two tables
 * that agree on those rows give the body the same bytes, so a pass rewrites a
 * copy only when a row that copy names came, went or changed its new address.
 * The account's own addresses (`ownKeys`) are the migration's, not the
 * table's, and are not in it.
 */

import { createHash } from 'node:crypto';
import { addressKey, isAddress } from './address-forms.ts';

/** One confirmed row of the organisation's table (0168 §4.2). */
export type ConfirmedAddressChange = {
  /** `addressKey(oldAddress)`: what a source address is matched on. */
  readonly oldKey: string;
  /** The old address as it was typed. */
  readonly oldAddress: string;
  /** The address it becomes, as it was typed; written as it stands. */
  readonly newAddress: string;
};

/** The two formats the change knows. */
export type AddressChangeFormat = 'vcard' | 'icalendar';

/** What `applyAddressChanges` answers. */
export interface AppliedAddressChanges {
  /** The body to write: the input itself, byte for byte, when `changed` is false. */
  readonly body: string;
  /** Whether any line was rewritten or added. */
  readonly changed: boolean;
  /**
   * The digest of the confirmed rows that decided this body's bytes, or null
   * when nothing changed (`item.address_digest`; workplan 0168 S4). Per item,
   * not per table: a row for somebody else's address is not in it, so a row
   * added for one person changes only the copies that name that person.
   */
  readonly digest: string | null;
}

/** A table that cannot be applied, said in the ledger's own words. Never applied in part. */
export class AddressTableRefused extends Error {
  readonly code: 'chained' | 'already_changed' | 'not_an_address' | 'wrong_key';
  constructor(code: AddressTableRefused['code'], message: string) {
    super(message);
    this.name = 'AddressTableRefused';
    this.code = code;
  }
}

/**
 * A table made ready once per pass (0168 §4.3: every pass reads the
 * confirmed rows once, at its start): checked, indexed and digested.
 */
export interface AddressTable {
  readonly rows: ReadonlyArray<ConfirmedAddressChange>;
  /** `addressTableDigest(rows)`. */
  readonly digest: string | null;
  /** Each old key's row. */
  readonly byOldKey: ReadonlyMap<string, ConfirmedAddressChange>;
  /** Every key the table knows, old and new: whom "the organiser is in the table" means. */
  readonly members: ReadonlySet<string>;
  /** The rows each of those keys belongs to, as its old address or its new one. */
  readonly holders: ReadonlyMap<string, ReadonlyArray<ConfirmedAddressChange>>;
}

/**
 * The table's digest (0168 §3.1): a SHA-256, in hex, over the confirmed rows
 * sorted by old key, or null for an empty table. Only what changes the output
 * is in it, the old key and the new address as typed; the old address's own
 * spelling is not, since nothing is matched on it.
 */
export function addressTableDigest(rows: ReadonlyArray<ConfirmedAddressChange>): string | null {
  if (rows.length === 0) return null;
  return createHash('sha256').update(addressTableDigestInput(rows)).digest('hex');
}

/**
 * The text a table's digest is the SHA-256 of, in UTF-8: a header line, then
 * one line per row sorted by old key, `["<old key>","<new address>"]`. Pure,
 * so a page can hash it with the browser's own SHA-256 and send the press
 * digest of the table it showed (workplan 0168 S5 (d)); every digest here is
 * of this text, so the two cannot disagree.
 */
export function addressTableDigestInput(
  rows: ReadonlyArray<Pick<ConfirmedAddressChange, 'oldKey' | 'newAddress'>>,
): string {
  const sorted = [...rows].sort((a, b) => (a.oldKey < b.oldKey ? -1 : a.oldKey > b.oldKey ? 1 : 0));
  return `ownpace-address-table-v1\n${sorted.map((r) => `${JSON.stringify([r.oldKey, r.newAddress])}\n`).join('')}`;
}

/**
 * What a press of *Apply the new addresses here too* records for a table
 * (workplan 0168 D5; ledger migration 0073): its digest, or, for an empty
 * table, the digest of no rows at all. An empty table has no digest
 * (`addressTableDigest` is null), and yet removing the last row after a
 * cutover is a change a person may press for, so that every copy goes back to
 * what the source says. Never written on an item.
 */
export function addressTablePressDigest(rows: ReadonlyArray<ConfirmedAddressChange>): string {
  return addressTableDigest(rows) ?? ADDRESS_DIGEST_OF_NO_CHANGE;
}

/**
 * The digest of no rows at all, which no table of rows can have: the press
 * for an empty table (above), and the change a copy waits for when the table
 * says it should carry none (`addressDigestDue`).
 *
 * A literal, not a hash taken when the module loads: the web bundle imports
 * this module and has no `node:crypto` to call. `address-changes.unit` pins
 * it to the SHA-256 of `addressTableDigestInput([])`.
 */
export const ADDRESS_DIGEST_OF_NO_CHANGE = '2cbba60cb6d49adc1df7c709282f76838ca4cdb6e5062805e6f49e90acd08582';

/**
 * A press of *Apply the new addresses here too* refused because the table
 * moved since the page showed it (workplan 0168 D5, S5 (d)): a row added or
 * changed after the page rendered would otherwise reach the person's live
 * data unseen. Both editions answer 409 with it, in both languages.
 */
export const ADDRESS_TABLE_MOVED = {
  en: 'The address changes changed since this page showed them, so nothing was applied. Look at them again, then press again.',
  nl: 'De adreswijzigingen zijn veranderd sinds deze pagina ze liet zien, dus er is niets toegepast. Bekijk ze opnieuw en druk dan nog een keer.',
} as const;

/** A press that does not say which table it was shown: 400, in both languages. */
export const ADDRESS_PRESS_NAMES_NO_TABLE = {
  en: 'This press does not say which address changes it was shown, so nothing was applied. Reload the page and press again.',
  nl: 'Deze knop zegt niet welke adreswijzigingen hij liet zien, dus er is niets toegepast. Laad de pagina opnieuw en druk nog een keer.',
} as const;

/**
 * What a pass records on a copy it did not write although its table moved
 * (`item.address_digest_due`, ledger migration 0074; workplan 0168 S3): the
 * digest the copy should carry now, or the digest of no change when it should
 * carry none (a row deleted or sent back). NULL in the column says nothing is
 * due: the copy carries what the last pass that looked at it said it should.
 */
export function addressDigestDue(digestNow: string | null): string {
  return digestNow ?? ADDRESS_DIGEST_OF_NO_CHANGE;
}

/**
 * DOES THIS COPY WAIT FOR A CHANGE OF THE ADDRESS TABLE? (ADR-0055 decision 5;
 * workplan 0168 §3.1, S3.) True when a pass found it should carry another
 * digest than the one it was written under, and nothing has written it since.
 * Such a copy is never a match: the bytes on the target are what we wrote
 * then, and what the table says now is something else. The confirmed list,
 * verification and the report all ask this, of the two columns.
 */
export function waitsForAnAddressChange(
  recorded: string | null | undefined,
  due: string | null | undefined,
): boolean {
  if (due === null || due === undefined) return false;
  return due !== (recorded ?? ADDRESS_DIGEST_OF_NO_CHANGE);
}

/**
 * May a rewrite of this copy for its addresses go ahead (workplan 0168 §3.4,
 * S1)? Only with a recorded target version the write can be guarded by: one
 * that is there and strong. A weak one keeps its `W/` (`UpsertResult.
 * targetVersion`), and cannot be sent as `If-Match`. Without one the person's
 * own edit on the target could not be told apart from our copy, so the copy
 * is left as it is and counted (`addressChangesUnguarded`).
 */
export function guardsAnAddressRewrite(targetVersion: string | undefined): boolean {
  return targetVersion !== undefined && targetVersion !== '' && !targetVersion.startsWith('W/');
}

/**
 * The new address a confirmed row gives an address, or undefined when the
 * table has no row for it (workplan 0168 §2.4, T6). Matched on the key, as
 * every other use of the table is. The Sharing checklist proposes it for a
 * grantee, and a folder press counts it as that grantee's confirmation
 * (ADR-0032 §6): the row IS a person's confirmation of the new address.
 */
export function newAddressFor(
  rows: ReadonlyArray<ConfirmedAddressChange>,
  address: string,
): string | undefined {
  if (!isAddress(address)) return undefined;
  const key = addressKey(address);
  return rows.find((r) => r.oldKey === key)?.newAddress;
}

/**
 * A sharing row as both editions serve it, with the new address a confirmed
 * row of the address table gives its grantee (`granteeNewAddress`), for the
 * Sharing checklist to propose (ADR-0055 decision 7; workplan 0168 T6). Left
 * off when the table has none. Proposed, never pressed: each press still
 * sends the address the page shows.
 */
export function withGranteesNewAddress<Row extends { readonly grantee?: string | null }>(
  row: Row,
  rows: ReadonlyArray<ConfirmedAddressChange>,
): Row & { readonly granteeNewAddress?: string } {
  const found = row.grantee ? newAddressFor(rows, row.grantee) : undefined;
  return found === undefined ? row : { ...row, granteeNewAddress: found };
}

/**
 * Check and index a table. Refuses (`AddressTableRefused`), rather than
 * applying a part of it, a table the ledger should never have held: a row
 * whose key is not its old address's, two rows for one old key, a value that
 * is not an address, or a new address that is an old address of the table
 * (§4.2), which would make the change apply twice.
 */
export function prepareAddressTable(rows: ReadonlyArray<ConfirmedAddressChange>): AddressTable {
  const byOldKey = new Map<string, ConfirmedAddressChange>();
  for (const r of rows) {
    if (!isAddress(r.oldAddress) || !isAddress(r.newAddress)) {
      throw new AddressTableRefused('not_an_address', `A row of the address table is not an address (${r.oldKey}).`);
    }
    if (addressKey(r.oldAddress) !== r.oldKey) {
      throw new AddressTableRefused('wrong_key', `A row's key is not its old address's key (${r.oldKey}).`);
    }
    if (byOldKey.has(r.oldKey)) {
      throw new AddressTableRefused('already_changed', `Two rows of the address table change ${r.oldKey}.`);
    }
    byOldKey.set(r.oldKey, r);
  }
  for (const r of rows) {
    if (byOldKey.has(addressKey(r.newAddress))) {
      throw new AddressTableRefused('chained', `The new address of ${r.oldKey} is an old address in the table.`);
    }
  }
  const members = new Set<string>();
  const holders = new Map<string, ConfirmedAddressChange[]>();
  for (const r of rows) {
    for (const key of new Set([r.oldKey, addressKey(r.newAddress)])) {
      members.add(key);
      holders.set(key, [...(holders.get(key) ?? []), r]);
    }
  }
  return { rows, digest: addressTableDigest(rows), byOldKey, members, holders };
}

/**
 * Apply the confirmed address changes to one vCard or iCalendar body.
 *
 * @param format  `vcard` for a contact, `icalendar` for an event or a task.
 * @param body    the source bytes, as text.
 * @param table   the confirmed rows, or a table `prepareAddressTable` made
 *                ready (once per pass).
 * @param ownKeys `addressKey` of each of the migration's own account's
 *                addresses: an `ATTENDEE` changes in an event that account
 *                organised. Unused for a vCard.
 */
export function applyAddressChanges(
  format: AddressChangeFormat,
  body: string,
  table: AddressTable | ReadonlyArray<ConfirmedAddressChange>,
  ownKeys: ReadonlyArray<string> = [],
): AppliedAddressChanges {
  const t = isPrepared(table) ? table : prepareAddressTable(table);
  if (t.rows.length === 0) return { body, changed: false, digest: null };
  // THE DIGEST IS PER ITEM (workplan 0168 S4). Every row the change consulted
  // and found is recorded here: each old address a line names, and each row
  // that puts an event's organiser in the table. Those rows, and only those,
  // decide the output, so two tables that agree on them give the same bytes,
  // and the digest of them is what the item records. A row for an address
  // this body never names is not in it, and adding, changing or removing that
  // row leaves this copy's digest, and so the copy, alone. The table's own
  // digest stays for the reports (`AddressTable.digest`).
  const decided = new Map<string, ConfirmedAddressChange>();
  const out =
    format === 'vcard' ? changeVcard(body, t, decided) : changeIcalendar(body, t, new Set(ownKeys), decided);
  return out === body
    ? { body, changed: false, digest: null }
    : { body: out, changed: true, digest: addressTableDigest([...decided.values()]) };
}

function isPrepared(t: AddressTable | ReadonlyArray<ConfirmedAddressChange>): t is AddressTable {
  return !Array.isArray(t) && 'byOldKey' in t;
}

// ---------------------------------------------------------------------------
// Content lines

/** One logical content line: its physical lines as they stand, and unfolded. */
interface Line {
  readonly span: ReadonlyArray<string>;
  readonly logical: string;
  /** The line end of its last physical line. */
  readonly eol: string;
}

/**
 * A vCard property whose value is quoted-printable (`ENCODING=QUOTED-PRINTABLE`,
 * or vCard 2.1's bare `QUOTED-PRINTABLE`), read off its first line.
 */
const QUOTED_PRINTABLE = /^[^:]*;(ENCODING=)?"?QUOTED-PRINTABLE"?[;:]/i;

/**
 * The body's logical lines. `quotedPrintable` is for a vCard: there a
 * quoted-printable value that ends in `=` goes on on the next physical line
 * (a soft line break, RFC 2045 §6.7), whatever that line reads like, so a
 * note's next line that reads `EMAIL:…` is the note's, never an address to
 * change (the data-path review's N4). Its bytes are kept as they stand.
 */
function linesOf(text: string, quotedPrintable = false): Line[] {
  const physical = text.split(/(?<=\n)/);
  const out: Line[] = [];
  let i = 0;
  while (i < physical.length) {
    const span = [physical[i]!];
    let j = i + 1;
    const unfold = () => {
      while (j < physical.length && /^[ \t]/.test(physical[j]!)) {
        span.push(physical[j]!);
        j += 1;
      }
    };
    unfold();
    const folded = span.length;
    const logical = span
      .map((l) => l.replace(/\r?\n$/, ''))
      .map((l, k) => (k === 0 ? l : l.slice(1)))
      .join('');
    if (quotedPrintable && QUOTED_PRINTABLE.test(logical)) {
      while (j < physical.length && /=\r?\n$/.test(span[span.length - 1]!)) {
        span.push(physical[j]!);
        j += 1;
        unfold();
      }
    }
    // A soft line break's lines are the value's, read as one with the first.
    const value = span
      .slice(folded)
      .map((l) => l.replace(/\r?\n$/, ''))
      .join('');
    const last = span[span.length - 1]!;
    out.push({ span, logical: logical + value, eol: /\r\n$/.test(last) ? '\r\n' : /\n$/.test(last) ? '\n' : '' });
    i = j;
  }
  return out;
}

/** A content line taken apart: `group.NAME;param;param:value`. */
interface Property {
  /** `group.` included when there is one. */
  readonly prefix: string;
  /** The name, upper case, for comparing. */
  readonly name: string;
  /** The name as written. */
  readonly rawName: string;
  /** Each parameter as written, `KEY=value`, quotes kept. */
  readonly params: string[];
  readonly value: string;
}

function parse(logical: string): Property | null {
  // The value starts at the first colon outside a quoted parameter value, and
  // the parameters are split on semicolons outside one.
  let quoted = false;
  let colon = -1;
  const cuts: number[] = [];
  for (let k = 0; k < logical.length; k += 1) {
    const ch = logical[k];
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === ';') cuts.push(k);
    else if (!quoted && ch === ':') {
      colon = k;
      break;
    }
  }
  if (colon === -1) return null;
  const head = logical.slice(0, colon);
  const firstCut = cuts.length > 0 ? cuts[0]! : head.length;
  const nameWithGroup = head.slice(0, firstCut);
  const dot = nameWithGroup.lastIndexOf('.');
  const prefix = dot === -1 ? '' : nameWithGroup.slice(0, dot + 1);
  const rawName = nameWithGroup.slice(dot + 1);
  const params: string[] = [];
  for (let c = 0; c < cuts.length; c += 1) {
    params.push(head.slice(cuts[c]! + 1, c + 1 < cuts.length ? cuts[c + 1]! : head.length));
  }
  return { prefix, name: rawName.toUpperCase(), rawName, params, value: logical.slice(colon + 1) };
}

function render(p: Property): string {
  return `${p.prefix}${p.rawName}${p.params.map((x) => `;${x}`).join('')}:${p.value}`;
}

/** A parameter's key, upper case. */
function paramKey(param: string): string {
  const eq = param.indexOf('=');
  return (eq === -1 ? param : param.slice(0, eq)).toUpperCase();
}

/** A parameter's value, unquoted. */
function paramValue(param: string): string {
  const eq = param.indexOf('=');
  const v = eq === -1 ? '' : param.slice(eq + 1);
  return v.startsWith('"') && v.endsWith('"') && v.length >= 2 ? v.slice(1, -1) : v;
}

/** The address in a value: after `mailto:`, ignoring case, or the value itself. */
function addressIn(value: string): { readonly scheme: string; readonly address: string } {
  const m = /^(mailto:)(.*)$/i.exec(value.trim());
  return m ? { scheme: m[1]!, address: m[2]!.trim() } : { scheme: '', address: value.trim() };
}

/** The rows a body's change was decided by, by old key (`applyAddressChanges`). */
type Decided = Map<string, ConfirmedAddressChange>;

/** The row an address belongs to, or undefined; a row found is one the change was decided by. */
function rowFor(t: AddressTable, address: string, decided: Decided): ConfirmedAddressChange | undefined {
  const row = address === '' ? undefined : t.byOldKey.get(addressKey(address));
  if (row) decided.set(row.oldKey, row);
  return row;
}

// ---------------------------------------------------------------------------
// vCard (D2)

const BEGIN_VCARD = /^BEGIN:VCARD\s*$/i;
const END_VCARD = /^END:VCARD\s*$/i;

/**
 * Every top-level card of a body, its EMAIL lines changed (D2).
 *
 * A CARD INSIDE A CARD IS PART OF THE OUTER ONE (the review's B1). vCard 2.1
 * lets `AGENT:` carry another card on the lines after it, and a first card
 * whose `END:VCARD` is missing looks the same: a `BEGIN:VCARD` while a card is
 * open. Taking that as the start of a new card dropped the outer card's head
 * (its `BEGIN`, `VERSION`, `N`, `FN`), even where no address was in the table.
 * Now the outer card runs to the `END:VCARD` that closes it, every line of a
 * card nested in it passes through as it stands (it is another person's
 * card, the value of the outer card's `AGENT`), and only the outer card's own
 * lines change. A card that never closes is passed through whole. No byte is
 * ever dropped.
 */
function changeVcard(body: string, t: AddressTable, decided: Decided): string {
  const lines = linesOf(body, true);
  const out: string[] = [];
  let card: Line[] | null = null;
  let depth = 0;
  for (const line of lines) {
    const begin = BEGIN_VCARD.test(line.logical);
    if (card === null) {
      if (begin) {
        card = [line];
        depth = 1;
      } else out.push(...line.span);
      continue;
    }
    card.push(line);
    if (begin) depth += 1;
    else if (END_VCARD.test(line.logical)) {
      depth -= 1;
      if (depth === 0) {
        out.push(...changeCard(card, t, decided));
        card = null;
      }
    }
  }
  // An unterminated card is passed through as it stands, with what it holds.
  if (card !== null) for (const l of card) out.push(...l.span);
  return out.join('');
}

/** Parameters that name one property, never two: the added line carries none of them (the review's S7). */
const IDENTITY_PARAMETERS: ReadonlySet<string> = new Set(['PID', 'ALTID', 'PROP-ID']);

/** One card, `BEGIN:VCARD` to its own `END:VCARD`, with its own EMAIL lines changed. */
function changeCard(lines: ReadonlyArray<Line>, t: AddressTable, decided: Decided): string[] {
  // Which lines are the card's own: not a card nested in it, nor its edges.
  let depth = 0;
  const own = lines.map((l) => {
    if (BEGIN_VCARD.test(l.logical)) {
      depth += 1;
      return false;
    }
    if (END_VCARD.test(l.logical)) {
      depth -= 1;
      return false;
    }
    return depth === 1;
  });
  const version = lines
    .map((l, i) => (own[i] ? /^VERSION:\s*(\S+)/i.exec(l.logical)?.[1] : undefined))
    .find((v) => v !== undefined);
  const v4 = version !== undefined && version.startsWith('4');
  const emails = lines.map((l, i) => {
    if (!own[i]) return null;
    const p = parse(l.logical);
    return p !== null && p.name === 'EMAIL' ? p : null;
  });
  // Each address the card lists, and the first of its lines.
  const listed = new Map<string, number>();
  emails.forEach((p, i) => {
    if (!p) return;
    const key = addressKey(addressIn(p.value).address);
    if (!listed.has(key)) listed.set(key, i);
  });

  // The new addresses this card gains, in the order their old lines stand.
  const gained: { readonly row: ConfirmedAddressChange; readonly from: Property }[] = [];
  const gainedKeys = new Set<string>();
  // The first lines of new addresses the card already lists, in the same order.
  const listedNew: number[] = [];
  const losing = new Set<number>();
  emails.forEach((p, i) => {
    if (!p) return;
    const row = rowFor(t, addressIn(p.value).address, decided);
    if (!row) return;
    const newKey = addressKey(row.newAddress);
    const already = listed.get(newKey);
    if (already !== undefined) {
      // The card already lists the new address: it gains no line, and that
      // address's own line takes the preference the old one loses (the
      // review's N2), as a gained line would have it (D2).
      if (!listedNew.includes(already)) listedNew.push(already);
    } else if (!gainedKeys.has(newKey)) {
      gainedKeys.add(newKey);
      gained.push({ row, from: p });
    }
    // EVERY old line of an address the card gains or lists loses its
    // preference, not only the first: two old addresses that both become the
    // new one would otherwise leave a second preferred line beside the new one
    // (the review's N1).
    losing.add(i);
  });
  if (gained.length === 0 && listedNew.length === 0) return lines.flatMap((l) => [...l.span]);
  // One line takes the preference: the first gained line, or, where the card
  // gains none and none of the new addresses it lists is preferred already,
  // the first of them. So a second application, which finds the gained line
  // listed and preferred, moves nothing.
  const preferredHere =
    gained.length === 0 && !listedNew.some((i) => preferredFirst(emails[i]!, v4)) ? listedNew[0] : undefined;

  const firstEmail = emails.findIndex((p) => p !== null);
  const out: string[] = [];
  lines.forEach((line, i) => {
    if (i === firstEmail) {
      gained.forEach(({ row, from }, k) => {
        // The old line's parameters, but never its preference and never the
        // ones that name ONE property: lines sharing an ALTID are one value in
        // several forms (RFC 6350 §5.4), a PID is one property for a sync to
        // merge by (§5.5, §7), and PROP-ID is JSContact's key for it (RFC
        // 9555). Copied, the new line and the old one would read as one.
        const kept = from.params
          .filter((x) => !isPreference(x, v4) && !IDENTITY_PARAMETERS.has(paramKey(x)))
          .map(withoutPrefType);
        const params = kept.filter((x) => x !== '');
        if (k === 0) params.unshift(v4 ? 'PREF=1' : 'TYPE=pref');
        const { scheme } = addressIn(from.value);
        out.push(`${render({ prefix: '', name: 'EMAIL', rawName: from.rawName, params, value: `${scheme}${row.newAddress}` })}${line.eol || '\r\n'}`);
      });
    }
    const p = emails[i];
    if (p && losing.has(i) && p.params.some((x) => isPreference(x, v4) || hasPrefType(x))) {
      const params = p.params
        .filter((x) => paramKey(x) !== 'PREF')
        .map(withoutPrefType)
        .filter((x) => x !== '');
      out.push(`${render({ ...p, params })}${line.eol}`);
      return;
    }
    if (p && i === preferredHere && !preferredFirst(p, v4)) {
      // `PREF=1` in a vCard 4.0, in place of a lower preference; before 4.0,
      // `TYPE=pref` as a gained line carries it.
      const params = v4 ? ['PREF=1', ...p.params.filter((x) => paramKey(x) !== 'PREF')] : ['TYPE=pref', ...p.params];
      out.push(`${render({ ...p, params })}${line.eol}`);
      return;
    }
    out.push(...line.span);
  });
  return out;
}

/** A line already preferred first: `PREF=1` in a vCard 4.0; before it, any preference. */
function preferredFirst(p: Property, v4: boolean): boolean {
  if (v4) return p.params.some((x) => paramKey(x) === 'PREF' && paramValue(x).trim() === '1');
  return p.params.some((x) => isPreference(x, false) || hasPrefType(x));
}

/** A `PREF` parameter, or in a vCard before 4.0 a bare `PREF` or a `TYPE` that says only `pref`. */
function isPreference(param: string, v4: boolean): boolean {
  const key = paramKey(param);
  if (key === 'PREF') return true;
  if (v4) return false;
  return key === 'TYPE' && paramValue(param).split(',').every((v) => v.trim().toLowerCase() === 'pref');
}

function hasPrefType(param: string): boolean {
  return paramKey(param) === 'TYPE' && paramValue(param).split(',').some((v) => v.trim().toLowerCase() === 'pref');
}

/** A `TYPE` parameter with `pref` taken out of its list, or '' when nothing is left. */
function withoutPrefType(param: string): string {
  if (!hasPrefType(param)) return param;
  const eq = param.indexOf('=');
  const rest = paramValue(param)
    .split(',')
    .filter((v) => v.trim().toLowerCase() !== 'pref');
  if (rest.length === 0) return '';
  const quoted = param.slice(eq + 1).startsWith('"');
  const joined = rest.join(',');
  return `${param.slice(0, eq)}=${quoted ? `"${joined}"` : joined}`;
}

// ---------------------------------------------------------------------------
// iCalendar (D3)

const SCHEDULED = /^(VEVENT|VTODO|VJOURNAL)$/i;

function changeIcalendar(body: string, t: AddressTable, ownKeys: ReadonlySet<string>, decided: Decided): string {
  const lines = linesOf(body);
  const out: string[] = [];
  // Components nest (VCALENDAR > VEVENT > VALARM). The scheduled component a
  // line belongs to is the innermost VEVENT, VTODO or VJOURNAL open around it.
  const stack: string[] = [];
  let component: Line[] | null = null;
  for (const line of lines) {
    const begin = /^BEGIN:(\S+)\s*$/i.exec(line.logical)?.[1];
    const end = /^END:(\S+)\s*$/i.exec(line.logical)?.[1];
    if (component === null && begin !== undefined && SCHEDULED.test(begin)) {
      component = [line];
      stack.length = 0;
      stack.push(begin.toUpperCase());
      continue;
    }
    if (component === null) {
      out.push(...line.span);
      continue;
    }
    component.push(line);
    if (begin !== undefined) stack.push(begin.toUpperCase());
    else if (end !== undefined) {
      stack.pop();
      if (stack.length === 0) {
        out.push(...changeComponent(component, t, ownKeys, decided));
        component = null;
      }
    }
  }
  if (component !== null) for (const l of component) out.push(...l.span);
  return out.join('');
}

/** One VEVENT, VTODO or VJOURNAL, with its ORGANIZER and, where D3 says so, its ATTENDEEs changed. */
function changeComponent(
  lines: ReadonlyArray<Line>,
  t: AddressTable,
  ownKeys: ReadonlySet<string>,
  decided: Decided,
): string[] {
  // Which lines sit inside a VALARM (or any sub-component): those are not the event's own.
  let depth = 0;
  const own = lines.map((l, i) => {
    if (i === 0) return false;
    if (/^BEGIN:/i.test(l.logical)) {
      depth += 1;
      return false;
    }
    if (/^END:/i.test(l.logical)) {
      depth = Math.max(0, depth - 1);
      return false;
    }
    return depth === 0;
  });
  const props = lines.map((l, i) => (own[i] ? parse(l.logical) : null));

  // The organiser's addresses, as the source has them.
  const organiser = props.find((p) => p !== null && p.name === 'ORGANIZER') ?? null;
  const organiserKeys = organiser === null ? [] : addressesOf(organiser).map(addressKey);
  // The rows that put the organiser in the table decide whether its guests
  // change, so they are rows this body's change was decided by too.
  for (const k of organiserKeys) for (const r of t.holders.get(k) ?? []) decided.set(r.oldKey, r);
  const inside = organiserKeys.some((k) => t.members.has(k) || ownKeys.has(k));

  const out: string[] = [];
  lines.forEach((line, i) => {
    const p = props[i] ?? null;
    const touches = p !== null && (p.name === 'ORGANIZER' || (p.name === 'ATTENDEE' && inside));
    const changed = p !== null && touches ? replaceAddress(p, t, decided) : null;
    if (changed === null) out.push(...line.span);
    else out.push(`${render(changed)}${line.eol}`);
  });
  return out;
}

/** The addresses a calendar user property names: its `mailto:` value and its `EMAIL=` parameter. */
function addressesOf(p: Property): string[] {
  const out: string[] = [];
  const v = addressIn(p.value);
  if (v.scheme !== '' || isAddress(v.address)) out.push(v.address);
  for (const x of p.params) if (paramKey(x) === 'EMAIL') out.push(paramValue(x));
  return out.filter((a) => a !== '');
}

/** The property with each old address in its value and its `EMAIL=` replaced, or null when none was old. */
function replaceAddress(p: Property, t: AddressTable, decided: Decided): Property | null {
  let changed = false;
  let value = p.value;
  const v = addressIn(p.value);
  if (v.scheme !== '' || isAddress(v.address)) {
    const row = rowFor(t, v.address, decided);
    if (row) {
      value = `${v.scheme}${row.newAddress}`;
      changed = true;
    }
  }
  const params = p.params.map((x) => {
    if (paramKey(x) !== 'EMAIL') return x;
    const row = rowFor(t, paramValue(x), decided);
    if (!row) return x;
    changed = true;
    const eq = x.indexOf('=');
    const quoted = x.slice(eq + 1).startsWith('"');
    return `${x.slice(0, eq)}=${quoted ? `"${row.newAddress}"` : row.newAddress}`;
  });
  return changed ? { ...p, params, value } : null;
}
