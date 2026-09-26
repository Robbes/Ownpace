// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The audit export's line (workplan 0129 T4; the owner's D4: *"One JSON line
 * per audit event, using OpenTelemetry field names, written to stdout. ...
 * Email addresses and file names replaced by pseudonyms in the export by
 * default."*).
 *
 * ## The shape
 *
 * OpenTelemetry's log data model, by its own field names: `Timestamp` (in
 * nanoseconds since the epoch, as a string, as the data model's examples write
 * it), `SeverityText` and `SeverityNumber` (`INFO`, 9: an audit event is a
 * record, not a problem), `Body` (the event's name), `Attributes` and
 * `Resource`. A collector that reads container output (Vector, Fluent Bit, the
 * OpenTelemetry Collector, Loki's agent) forwards it without a parser of its
 * own. The row's id rides as `ownpace.audit.id`, so a line written here and
 * the same event read back later (T4's download) are one event to a store that
 * de-duplicates.
 *
 * ## Nobody is named
 *
 * An address or a file name leaves the deployment as a pseudonym: a keyed
 * hash, so the same person is always the same pseudonym here and a store can
 * still say who did what, without anybody being named in it. The key never
 * leaves (`deploymentKeyFor`, ledger migration 0062).
 *
 * Which detail field is which is written down field by field
 * (`AUDIT_DETAIL_FIELDS`), because a pattern cannot tell a file's name from a
 * migration's state. A field this list does not know is DROPPED, not passed
 * through: an unclassified field is one nobody has decided may leave. A guard
 * (`scripts/every-audit-field-is-classified.unit.test.ts`) reads every place
 * that writes an audit event and fails on a field missing here, so a new one is
 * classified before it ships rather than dropped without anybody noticing. And
 * an address anywhere in a kept string is replaced as well: the list decides
 * what a field is, and the pattern catches what a field should not have held.
 */

import { createHmac } from 'node:crypto';
import { log } from './logger.ts';

/** The purpose the pseudonym key is kept under (`deploymentKeyFor`). */
export const AUDIT_PSEUDONYM_PURPOSE = 'audit-pseudonym';

/** An audit event as it was recorded: the row, before anything is left out. */
export interface AuditExportEvent {
  readonly id: string;
  /** The row's time, in UTC to the microsecond: `2026-09-24T00:12:34.123456Z`. */
  readonly at: string;
  readonly tenantId: string;
  readonly actor: string;
  readonly action: string;
  readonly entity?: string;
  readonly detail?: Record<string, unknown>;
}

/**
 * What each detail field is, wherever in the detail it appears.
 *
 * - `keep`: an id, a count, a code or a state, exported as it is (any address
 *   inside a string is still replaced);
 * - `pseudonym`: a name or an address, exported as its pseudonym;
 * - `origin`: a URL, exported as its scheme and host only, because its path
 *   can hold a username.
 */
export const AUDIT_DETAIL_FIELDS = {
  // Ids and hashes: this deployment's own, naming nobody.
  mappingId: 'keep',
  connectionId: 'keep',
  linkId: 'keep',
  grantId: 'keep',
  receiptId: 'keep',
  memberId: 'keep',
  userId: 'keep',
  naturalKeyHash: 'keep',
  // Counts, codes and states.
  refused: 'keep',
  kind: 'keep',
  role: 'keep',
  status: 'keep',
  attempted: 'keep',
  applied: 'keep',
  grantees: 'keep',
  sent: 'keep',
  failed: 'keep',
  withoutAddress: 'keep',
  locale: 'keep',
  resend: 'keep',
  leftForChecklist: 'keep',
  waitingForCutover: 'keep',
  links: 'keep',
  manual: 'keep',
  capability: 'keep',
  sentence: 'keep',
  from: 'keep',
  to: 'keep',
  via: 'keep',
  forced: 'keep',
  leftEmpty: 'keep',
  mail: 'keep',
  calendar: 'keep',
  contact: 'keep',
  file: 'keep',
  scheduling: 'keep',
  provider: 'keep',
  host: 'keep',
  // What Google answered when a grant was taken back (0108 T8 (c)): a state.
  atGoogle: 'keep',
  // The operator's number of live grant links, and the moment it stops
  // applying (0108 T8 (d)): a count and a date.
  liveLinks: 'keep',
  until: 'keep',
  // A data type added, stopped or resumed (0128 T4), and the phase it was in
  // then: product vocabulary (`calendar`, `continuous`), naming nobody.
  domain: 'keep',
  phase: 'keep',
  // Names and addresses.
  on: 'pseudonym',
  folder: 'pseudonym',
  parentKey: 'pseudonym',
  grantee: 'pseudonym',
  sentTo: 'pseudonym',
  account: 'pseudonym',
  email: 'pseudonym',
  // Places.
  url: 'origin',
} as const satisfies Record<string, 'keep' | 'pseudonym' | 'origin'>;

type FieldKind = (typeof AUDIT_DETAIL_FIELDS)[keyof typeof AUDIT_DETAIL_FIELDS];

/** A name from code, as the log page reads one (managed migration 0025). */
const ACTION_NAME = /^[a-z][a-z0-9_.:-]{0,63}$/;
/** An actor that is an identifier: a process, or an id. An address is not one. */
const ACTOR_ID = /^[A-Za-z0-9][A-Za-z0-9._:+-]{0,127}$/;
const ADDRESS = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** A name or an address, as its pseudonym under this deployment's key. */
export type Pseudonymize = (value: string) => string;

/**
 * The pseudonym of a value: `pseudo:` and sixteen hex characters of an
 * HMAC-SHA256 under the key. An address is compared without its case, as mail
 * systems compare one; a name is compared as written.
 */
export function pseudonymizer(key: Uint8Array): Pseudonymize {
  return (value) => {
    const trimmed = value.normalize('NFC').trim();
    const normal = trimmed.includes('@') ? trimmed.toLowerCase() : trimmed;
    return `pseudo:${createHmac('sha256', key).update(normal).digest('hex').slice(0, 16)}`;
  };
}

function scrubbed(value: string, pseudonym: Pseudonymize): string {
  return value.replace(ADDRESS, (address) => pseudonym(address));
}

function exported(value: unknown, kind: FieldKind, pseudonym: Pseudonymize): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => exported(v, kind, pseudonym));
  if (kind === 'pseudonym') {
    return pseudonym(typeof value === 'string' ? value : JSON.stringify(value));
  }
  if (kind === 'origin') {
    try {
      return new URL(String(value)).origin;
    } catch {
      return null;
    }
  }
  if (typeof value === 'string') return scrubbed(value, pseudonym);
  if (typeof value === 'object') return exportedDetail(value as Record<string, unknown>, pseudonym);
  return value;
}

/** The detail as it may leave: classified fields only, each as its kind says. */
export function exportedDetail(detail: Record<string, unknown>, pseudonym: Pseudonymize): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(detail)) {
    const kind = (AUDIT_DETAIL_FIELDS as Record<string, FieldKind | undefined>)[field];
    if (kind === undefined) continue;
    out[field] = exported(value, kind, pseudonym);
  }
  return out;
}

/** Who acted, as the export may say it: an identifier as it is, anyone else as a pseudonym. */
export function exportedActor(actor: string, pseudonym: Pseudonymize): string {
  return ACTOR_ID.test(actor) ? actor : pseudonym(actor);
}

/** `2026-09-24T00:12:34.123456Z` as nanoseconds since the epoch, in a string. */
export function nanosSinceEpoch(at: string): string {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/.exec(at);
  if (!match) throw new Error(`Not a UTC time to the microsecond: ${at}`);
  const seconds = BigInt(Date.parse(`${match[1]}Z`) / 1000);
  const fraction = BigInt((match[2] ?? '').padEnd(9, '0'));
  return (seconds * 1_000_000_000n + fraction).toString();
}

/**
 * Where a download resumes: after this event, in the order the download
 * serves them (its time, then its id).
 */
export interface AuditExportCursor {
  /** The event's time, in UTC to the microsecond: `2026-09-24T00:12:34.123456Z`. */
  readonly at: string;
  readonly id: string;
}

const CURSOR = /^(\d{1,20})-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/**
 * The cursor after one event, as the download hands it out: the line's own
 * `Timestamp` and `ownpace.audit.id`, joined by a hyphen. So a log store can
 * resume from the newest line it holds, and keeps no state of its own.
 */
export function auditCursorAfter(event: Pick<AuditExportEvent, 'at' | 'id'>): string {
  return `${nanosSinceEpoch(event.at)}-${event.id}`;
}

/** A cursor as a log store sends it back, or undefined when it is not one. */
export function parseAuditCursor(text: string): AuditExportCursor | undefined {
  const match = CURSOR.exec(text.trim().toLowerCase());
  if (!match) return undefined;
  // To the microsecond, which is what the row holds: a nanosecond below it
  // cannot name a different row. Twenty digits reach the year 5138, well
  // inside what a Date holds, so no cursor the pattern admits overflows one.
  const micros = BigInt(match[1]!) / 1000n;
  const date = new Date(Number(micros / 1000n));
  const fraction = (micros % 1_000_000n).toString().padStart(6, '0');
  return { at: `${date.toISOString().slice(0, 19)}.${fraction}Z`, id: match[2]! };
}

/** A page of the download, unless the caller asks for another size. */
export const AUDIT_EXPORT_PAGE = 1000;
/** The largest page a caller may ask for. */
export const AUDIT_EXPORT_PAGE_MAX = 10_000;

/**
 * What a download asks for, as both editions read it (hard rule 5): the cursor
 * to start after, and a page size, each refused by name when it is not one.
 */
export type AuditExportQuery =
  | {
      readonly after?: AuditExportCursor;
      /** The cursor as it was sent, handed back as-is when nothing follows it. */
      readonly afterText?: string;
      readonly limit: number;
    }
  | { readonly field: 'after' | 'limit'; readonly message: string };

/** Read `after` and `limit` from a download's query string. */
export function parseAuditExportQuery(asked: {
  readonly after?: string | null;
  readonly limit?: string | null;
}): AuditExportQuery {
  const afterText = asked.after ?? undefined;
  const after = afterText ? parseAuditCursor(afterText) : undefined;
  if (afterText && !after) {
    return {
      field: 'after',
      message:
        "A cursor is a line's Timestamp and its ownpace.audit.id, joined by a hyphen, as Ownpace-Next-After gives it.",
    };
  }
  const limitText = asked.limit ?? null;
  const limit = limitText === null ? AUDIT_EXPORT_PAGE : Number(limitText);
  if (!Number.isInteger(limit) || limit < 1 || limit > AUDIT_EXPORT_PAGE_MAX) {
    return { field: 'limit', message: `A page is 1 to ${AUDIT_EXPORT_PAGE_MAX} lines.` };
  }
  return { ...(after ? { after } : {}), ...(afterText ? { afterText } : {}), limit };
}

/** One audit event as the line a collector reads. */
export function auditExportLine(
  event: AuditExportEvent,
  options: { readonly pseudonym: Pseudonymize; readonly resource: Readonly<Record<string, string>> },
): Record<string, unknown> {
  const action = ACTION_NAME.test(event.action) ? event.action : 'audit.unnamed';
  return {
    Timestamp: nanosSinceEpoch(event.at),
    SeverityText: 'INFO',
    SeverityNumber: 9,
    Body: action,
    Attributes: {
      'event.name': action,
      'ownpace.audit.id': event.id,
      'ownpace.tenant.id': event.tenantId,
      // An older row may name nobody as its actor; it is left out rather than
      // exported as the pseudonym of nothing.
      ...(event.actor ? { 'ownpace.audit.actor': exportedActor(event.actor, options.pseudonym) } : {}),
      ...(event.entity ? { 'ownpace.audit.entity': event.entity } : {}),
      ...(event.detail ? { 'ownpace.audit.detail': exportedDetail(event.detail, options.pseudonym) } : {}),
    },
    Resource: { ...options.resource },
  };
}

/** Where this process's audit lines go. */
export interface AuditExportSink {
  record(event: AuditExportEvent): Promise<void>;
}

let sink: AuditExportSink | undefined;

/** Point this process's audit lines somewhere; `undefined` stops them. */
export function setAuditExportSink(next: AuditExportSink | undefined): void {
  sink = next;
}

/**
 * Export one audit event, without waiting and without ever throwing.
 *
 * Not awaited by the writer, on purpose: the audit row is usually written
 * inside a tenant's transaction, and the sink may need a connection of its own
 * to read its key. On PGlite, which is one connection, waiting for that inside
 * the transaction would wait forever. A line that cannot be written costs the
 * line, never the event.
 */
export function exportAuditEvent(event: AuditExportEvent): void {
  if (!sink) return;
  const current = sink;
  void (async () => {
    try {
      await current.record(event);
    } catch (err) {
      log.warn(
        `[audit-export] a line was not written (${err instanceof Error ? err.message : 'unknown error'}); ` +
          'the event itself is recorded, and the download serves it.',
      );
    }
  })();
}
