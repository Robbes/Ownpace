// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The operator's log (workplan 0129 T2): what one page of it is, and what may
 * narrow it, the same on both editions.
 *
 * The managed edition reads the log through `support_log` (managed migration
 * 0025) for a platform operator; the appliance reads the same two tables for
 * its own owner (0129 D5: "same page"). Hard rule 5: the filters the page
 * sends mean the same thing to both, so they are parsed here, once, and a
 * value of the wrong shape is refused by name on either edition rather than
 * quietly matching nothing on one of them.
 */

import { isFailureCategory } from './failure-category.ts';

/** Rows a page of the log holds. */
export const LOG_PAGE = 100;

const LOG_LEVELS = ['error', 'warn', 'info'] as const;
const LOG_EVENT = /^[a-z][a-z0-9_.:-]{0,63}$/;
const LOG_REFERENCE = /^[0-9a-f]{8}$/;
const LOG_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One row of the log: an audit event, or one of the application's errors and warnings. */
export interface OperatorLogEntry {
  readonly id: string;
  /** To the microsecond, in UTC: a page's cursor is made of it. */
  readonly at: string;
  readonly source: 'audit' | 'app';
  readonly level: 'error' | 'warn' | 'info';
  readonly tenant_id: string | null;
  readonly tenant_name: string | null;
  readonly mapping_id: string | null;
  readonly migration_name: string | null;
  readonly event: string;
  readonly category: string | null;
  readonly reference: string | null;
  /** Who acted on an audit row; none on an application event. */
  readonly actor: string | null;
}

/** One page of the log, and where the next begins. */
export interface OperatorLogPage {
  readonly entries: readonly OperatorLogEntry[];
  readonly next: { readonly before: string; readonly beforeId: string } | null;
  readonly limit: number;
}

/** A time in the one form the page sends, and a real one: 2026-02-30 is refused, not rolled over. */
function isLogTime(value: string): boolean {
  if (!LOG_TIME.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 19) === value.slice(0, 19);
}

/** The filters, in the order a recorded search names them. */
export const LOG_FILTERS = [
  ['level', (v: string) => (LOG_LEVELS as readonly string[]).includes(v), 'A level is error, warn or info.'],
  ['tenantId', (v: string) => UUID.test(v), 'A customer is named by its id.'],
  ['mappingId', (v: string) => UUID.test(v), 'A migration is named by its id.'],
  ['event', (v: string) => LOG_EVENT.test(v), 'An event is a name such as sync.calendar.failed, or the start of one.'],
  ['category', (v: string) => isFailureCategory(v), 'That is not one of the error categories.'],
  ['reference', (v: string) => LOG_REFERENCE.test(v), 'A reference is eight characters, 0-9 and a-f.'],
  ['since', isLogTime, 'A time is written like 2026-09-23T10:00:00Z.'],
  ['before', isLogTime, 'A time is written like 2026-09-23T10:00:00Z.'],
  ['beforeId', (v: string) => UUID.test(v), 'A page is continued from a row id.'],
] as const;

export type LogFilterName = (typeof LOG_FILTERS)[number][0];
export type LogFilters = Partial<Record<LogFilterName, string>>;

/** The filters as asked, or the first one of the wrong shape. */
export function parseLogFilters(
  query: Record<string, unknown>,
): LogFilters | { readonly field: string; readonly message: string } {
  const filters: LogFilters = {};
  for (const [field, ok, message] of LOG_FILTERS) {
    const raw = query[field];
    if (raw === undefined || raw === '') continue;
    // A reference is quoted by a person, who may type it in capitals.
    const value = typeof raw === 'string' ? (field === 'reference' ? raw.trim().toLowerCase() : raw.trim()) : '';
    if (!ok(value)) return { field, message };
    filters[field] = value;
  }
  if (filters.beforeId && !filters.before) {
    return { field: 'beforeId', message: 'A page is continued from a row id and its time.' };
  }
  return filters;
}

/**
 * The LIKE pattern for "an event that starts with this". `_` is a wildcard to
 * LIKE and a letter to an event name, so it is escaped (with `\`, the escape a
 * query names); the shape check admits no `%` or `\`.
 */
export function logEventPattern(event: string): string {
  return `${event.replace(/_/g, '\\_')}%`;
}
