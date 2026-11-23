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
 *   its preference. A card that already lists the new address gets nothing.
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
 *   again, and a card that already lists its new address gains nothing.
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
  const sorted = [...rows].sort((a, b) => (a.oldKey < b.oldKey ? -1 : a.oldKey > b.oldKey ? 1 : 0));
  const h = createHash('sha256');
  h.update('ownpace-address-table-v1\n');
  for (const r of sorted) h.update(`${JSON.stringify([r.oldKey, r.newAddress])}\n`);
  return h.digest('hex');
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
 */
export const ADDRESS_DIGEST_OF_NO_CHANGE: string = createHash('sha256')
  .update('ownpace-address-table-v1\n')
  .digest('hex');

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

function linesOf(text: string): Line[] {
  const physical = text.split(/(?<=\n)/);
  const out: Line[] = [];
  let i = 0;
  while (i < physical.length) {
    const span = [physical[i]!];
    let j = i + 1;
    while (j < physical.length && /^[ \t]/.test(physical[j]!)) {
      span.push(physical[j]!);
      j += 1;
    }
    const logical = span
      .map((l) => l.replace(/\r?\n$/, ''))
      .map((l, k) => (k === 0 ? l : l.slice(1)))
      .join('');
    const last = span[span.length - 1]!;
    out.push({ span, logical, eol: /\r\n$/.test(last) ? '\r\n' : /\n$/.test(last) ? '\n' : '' });
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

function changeVcard(body: string, t: AddressTable, decided: Decided): string {
  const lines = linesOf(body);
  const out: string[] = [];
  let card: { readonly start: number; readonly lines: Line[] } | null = null;
  for (const line of lines) {
    if (/^BEGIN:VCARD\s*$/i.test(line.logical)) {
      card = { start: out.length, lines: [line] };
      continue;
    }
    if (card === null) {
      out.push(...line.span);
      continue;
    }
    card.lines.push(line);
    if (/^END:VCARD\s*$/i.test(line.logical)) {
      out.push(...changeCard(card.lines, t, decided));
      card = null;
    }
  }
  // An unterminated card is passed through as it stands.
  if (card !== null) for (const l of card.lines) out.push(...l.span);
  return out.join('');
}

/** One card, `BEGIN:VCARD` to `END:VCARD`, with its EMAIL lines changed. */
function changeCard(lines: ReadonlyArray<Line>, t: AddressTable, decided: Decided): string[] {
  const version = lines.map((l) => /^VERSION:\s*(\S+)/i.exec(l.logical)?.[1]).find((v) => v !== undefined);
  const v4 = version !== undefined && version.startsWith('4');
  const emails = lines.map((l) => {
    const p = parse(l.logical);
    return p !== null && p.name === 'EMAIL' ? p : null;
  });
  const present = new Set<string>();
  for (const p of emails) if (p) present.add(addressKey(addressIn(p.value).address));

  // The new addresses this card gains, in the order their old lines stand.
  const gained: { readonly row: ConfirmedAddressChange; readonly from: Property }[] = [];
  const losing = new Set<number>();
  emails.forEach((p, i) => {
    if (!p) return;
    const row = rowFor(t, addressIn(p.value).address, decided);
    if (!row) return;
    const newKey = addressKey(row.newAddress);
    if (present.has(newKey)) return;
    present.add(newKey);
    gained.push({ row, from: p });
    losing.add(i);
  });
  if (gained.length === 0) return lines.flatMap((l) => [...l.span]);

  const firstEmail = emails.findIndex((p) => p !== null);
  const out: string[] = [];
  lines.forEach((line, i) => {
    if (i === firstEmail) {
      gained.forEach(({ row, from }, k) => {
        const kept = from.params.filter((x) => !isPreference(x, v4)).map(withoutPrefType);
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
    out.push(...line.span);
  });
  return out;
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
