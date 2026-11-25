// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A page at a time, for the two support lists that used to serve every row
 * (an outside, read-only check, PERF-2; the owner, 2026-11-24: *"page both
 * (Show more) in alpha.20; a plain maximum would hide rows from the
 * operator"*). Workplan 0006 §P.
 *
 * `GET /support/tenants` and `GET /support/retained-invoices` page by KEYSET:
 * each page starts after the last row of the one before, by the route's own
 * ORDER BY plus a column that makes every row's place unique. An offset would
 * skip or repeat a row whenever one is added or removed between two pages; a
 * keyset does neither.
 *
 * The cursor is opaque to the caller, base64url of a small JSON object, and is
 * checked here field by field before any of it reaches a query. A cursor that
 * does not parse, or parses into anything but what a route gives out, is a
 * `400` naming `after` — never an empty page, which would read as "nothing
 * more" (AGENTS.md rule 9).
 *
 * The timestamps in a cursor are text to the microsecond, as the log's are
 * (`support.ts`, `/log`): a JavaScript date keeps milliseconds, and a cursor
 * cut to those would skip every row stamped later in the same millisecond.
 */

/** Rows per page, on both routes. The same hundred the log pages by. */
export const SUPPORT_PAGE = 100;

/** `to_char` pattern that gives a timestamptz back as the cursor carries it. */
export const CURSOR_TIME_FORMAT = 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** `tenantRef`: a sha256, in hex. */
const REF = /^[0-9a-f]{64}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
/** Far past any cursor this file writes; a longer one is not ours. */
const CURSOR_MAX = 2048;
/** `tenant.name` has no length limit of its own; this bounds what a cursor may carry. */
const NAME_MAX = 512;

export function encodeCursor(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

/**
 * The cursor's JSON, `null` when none was given, or `undefined` when the value
 * is not one: repeated, empty, too long, not base64url or not JSON.
 */
function cursorJson(raw: unknown): unknown {
  if (raw === undefined) return null;
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > CURSOR_MAX) return undefined;
  if (!BASE64URL.test(raw)) return undefined;
  const text = Buffer.from(raw, 'base64url').toString('utf8');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // Not a failure to hide: the caller turns `undefined` into a 400.
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Exactly these keys, so a cursor cannot carry anything the route ignores. */
function hasKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((k) => own.includes(k));
}

/** A real instant, not just the shape of one: `2026-02-30…` would be a 500 from Postgres. */
function isTime(value: unknown): value is string {
  if (typeof value !== 'string' || !TIME.test(value)) return false;
  const at = new Date(value);
  return !Number.isNaN(at.getTime()) && at.toISOString().slice(0, 19) === value.slice(0, 19);
}

function isDay(value: unknown): value is string {
  if (typeof value !== 'string' || !DAY.test(value)) return false;
  const at = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(at.getTime()) && at.toISOString().slice(0, 10) === value;
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

// ---------------------------------------------------------------- organisations

/** Where the list of organisations continues: after this name, then this id. */
export interface TenantsAfter {
  readonly name: string;
  readonly id: string;
}

export function tenantsCursor(after: TenantsAfter): string {
  return encodeCursor({ name: after.name, id: after.id });
}

/** `null` for the first page; `undefined` for a cursor this route did not give. */
export function parseTenantsCursor(raw: unknown): TenantsAfter | null | undefined {
  const json = cursorJson(raw);
  if (json === null || json === undefined) return json;
  if (!isRecord(json) || !hasKeys(json, ['name', 'id'])) return undefined;
  const { name, id } = json;
  if (typeof name !== 'string' || name.length > NAME_MAX || !isUuid(id)) return undefined;
  return { name, id };
}

// ---------------------------------------------------- what an erasure kept

/** A kept invoice's place: when its erasure was purged, its period, its id. */
export interface InvoiceAfter {
  readonly purgedAt: string | null;
  readonly periodStart: string;
  readonly invoiceId: string;
}

/** An erasure's place in the list of numbers: when it was purged, and its hash. */
export interface NumbersAfter {
  readonly purgedAt: string | null;
  readonly tenantRef: string;
}

/**
 * Where each of the screen's two lists continues; `null` for a list that has
 * ended. A cursor is only given while at least one of them has more, so one
 * with both ended is not a cursor this route gave.
 */
export interface RetainedAfter {
  readonly invoices: InvoiceAfter | null;
  readonly numbers: NumbersAfter | null;
}

export function retainedCursor(after: RetainedAfter): string {
  return encodeCursor({ invoices: after.invoices, numbers: after.numbers });
}

function parseInvoiceAfter(value: unknown): InvoiceAfter | null | undefined {
  if (value === null) return null;
  if (!isRecord(value) || !hasKeys(value, ['purgedAt', 'periodStart', 'invoiceId'])) return undefined;
  const { purgedAt, periodStart, invoiceId } = value;
  if (purgedAt !== null && !isTime(purgedAt)) return undefined;
  if (!isDay(periodStart) || !isUuid(invoiceId)) return undefined;
  return { purgedAt, periodStart, invoiceId };
}

function parseNumbersAfter(value: unknown): NumbersAfter | null | undefined {
  if (value === null) return null;
  if (!isRecord(value) || !hasKeys(value, ['purgedAt', 'tenantRef'])) return undefined;
  const { purgedAt, tenantRef } = value;
  if (purgedAt !== null && !isTime(purgedAt)) return undefined;
  if (typeof tenantRef !== 'string' || !REF.test(tenantRef)) return undefined;
  return { purgedAt, tenantRef };
}

/** `null` for the first page; `undefined` for a cursor this route did not give. */
export function parseRetainedCursor(raw: unknown): RetainedAfter | null | undefined {
  const json = cursorJson(raw);
  if (json === null || json === undefined) return json;
  if (!isRecord(json) || !hasKeys(json, ['invoices', 'numbers'])) return undefined;
  const invoices = parseInvoiceAfter(json.invoices);
  const numbers = parseNumbersAfter(json.numbers);
  if (invoices === undefined || numbers === undefined) return undefined;
  if (invoices === null && numbers === null) return undefined;
  return { invoices, numbers };
}
