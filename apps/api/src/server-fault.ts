// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A 500 is a BUG, not a refusal — and it must not answer with the bug
 * (workplan 0079).
 *
 * Eleven routes answered `{ error: 'list_failed', reason: String(error) }`.
 * Two things were wrong with that, and the create route's own comment had
 * already said both:
 *
 *  1. **It hands internals to a browser.** `String(error)` on a driver failure
 *     can carry a connection string, a query, a host. That is the reason the
 *     create route stopped doing it (workplan 0068), and eleven other places
 *     went on doing it.
 *  2. **It gives the person nothing to act on.** A stringified error is not a
 *     sentence anyone can use, and it does not connect the red box in front of
 *     them to the stack sitting in the log.
 *
 * The fix for both is the one 0068 T10c asked for and only ever applied to
 * create: a short reference shared by the log line and the response. The
 * message stays safe, and quoting the reference finds the detail. Reference
 * `e133a809` is how the create-route 500 was diagnosed at all — this is that,
 * everywhere.
 */

import type { Response } from 'express';
import { log, newReference, recordAppEvent } from '@openmig/shared';

/** How deep a chain of causes is followed before the rest is printed as it is. */
const MAX_DEPTH = 8;

/** What the logged copy says where a value stood. */
const REDACTED = '[redacted]';

/**
 * Fields that hold values, on whatever error carries them: a body parser's
 * `body`, the raw request text; the statement's parameters, as Drizzle's
 * `DrizzleQueryError` and PGlite carry them (`params`) and as postgres.js
 * does (`parameters`, `args`); and PGlite's `queryOptions`, whose `blob` is a
 * file's bytes.
 */
const VALUE_FIELDS: ReadonlySet<PropertyKey> = new Set(['body', 'params', 'parameters', 'args', 'queryOptions']);

/**
 * The fields of Postgres's own report that quote values, as `pg` and PGlite
 * copy it onto the error: `detail` (`Key (email)=(…) already exists.`,
 * `Failing row contains (…)`), `where` (`unnamed portal parameter $1 = '…'`,
 * `JSON data, line 1: …`) and `hint`, which a function's `RAISE … USING HINT`
 * fills as it likes. Left out only of an error that carries a SQLSTATE: on any
 * other a `hint` is the program's own sentence (`CutoverRefused`).
 */
const SERVER_VALUE_FIELDS: ReadonlySet<PropertyKey> = new Set(['detail', 'where', 'hint']);

/** Statement text, printed up to its first literal (`statementWithoutValues`). */
const STATEMENT_FIELDS = ['query', 'internalQuery'] as const;

/** The SQLSTATE of Postgres's own report, from any driver; undefined on any other error. */
function sqlState(error: object): string | undefined {
  const { code, severity } = error as { code?: unknown; severity?: unknown };
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) && typeof severity === 'string'
    ? code
    : undefined;
}

/**
 * A statement up to its first literal. One built with placeholders (`$1`), as
 * Drizzle builds every statement, has none and is printed whole; a value
 * written into the text starts at a quote (`'…'`, `$$…$$`), and nothing from
 * there on is printed.
 */
function statementWithoutValues(text: string): string {
  const at = text.search(/'|\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/);
  return at === -1 ? text : `${text.slice(0, at)}${REDACTED}`;
}

/**
 * The message without the values it repeats.
 *
 * - Drizzle's `DrizzleQueryError` reads `Failed query: <statement>\nparams:
 *   <values>` (`drizzle-orm/errors.js`): its statement as above, its values not.
 * - In a data exception (SQLSTATE class 22) Postgres quotes the input it could
 *   not take: `invalid input syntax for type uuid: "…"`. That class quotes
 *   values, not names, so all from the first double quote to the last goes.
 */
function messageWithoutValues(error: object, message: string): string {
  const query: unknown = Object.getOwnPropertyDescriptor(error, 'query')?.value;
  if (typeof query === 'string') {
    const head = `Failed query: ${query}\nparams: `;
    if (message.startsWith(head)) {
      const values = message.length > head.length ? REDACTED : '';
      return `Failed query: ${statementWithoutValues(query)}\nparams: ${values}`;
    }
  }
  if (sqlState(error)?.startsWith('22')) {
    const first = message.indexOf('"');
    const last = message.lastIndexOf('"');
    if (first !== -1) return `${message.slice(0, first)}"${REDACTED}"${last > first ? message.slice(last + 1) : ''}`;
  }
  return message;
}

/**
 * The stack, saying `told` where it said `message`. V8 writes a stack's first
 * line from the message when the stack is first read, so one read before the
 * message last changed can say anything there: then only its frames are kept.
 */
function stackWithout(stack: string, message: string, told: string): string {
  const at = stack.indexOf(message);
  if (at !== -1) return `${stack.slice(0, at)}${told}${stack.slice(at + message.length)}`;
  const frames = stack.search(/^ {4}at /m);
  return frames === -1 ? told : `${told}\n${stack.slice(frames)}`;
}

/**
 * The error as the log may print it: all that diagnoses it, and none of the
 * values it carries.
 *
 * A body parser's error carries the raw request text as `body` (#1490's
 * review, workplan 0093): a stranger's address and note, printed with the
 * error. Those errors no longer reach here (`unreadable-body.ts`), and this
 * keeps any other error that carries a body, in its `cause` or among the
 * `errors` it gathers, from doing the same. Nothing that calls `serverFault`
 * hands it a body anybody reads in the log.
 *
 * A database driver's error carries the statement's values, and every route's
 * fault printed them (workplan 0168). As the installed drivers write them:
 *
 * - `pg` copies Postgres's report onto its `DatabaseError`: `detail` quotes a
 *   key or the whole failing row, `where` a parameter or an input, and a data
 *   exception's message the input it could not take.
 * - PGlite's error is the same report, and adds the statement as `query` (a
 *   value written into it included), its `params` and its `queryOptions`.
 * - Drizzle wraps either in a `DrizzleQueryError` whose `params` are the
 *   values, and whose message, and so its stack, ends `params: <values>`.
 *
 * What diagnoses stays: the message, name and stack, `code`, `severity`,
 * `routine`, `file` and `line`, the names in `schema`, `table`, `column`,
 * `dataType` and `constraint`, a statement up to its first literal, and every
 * cause in the chain, each read the same way.
 *
 * The caller's error is not changed. An error with nothing to leave out is
 * returned as it is, so it prints exactly as before. Any other is copied: same
 * prototype, same fields but those, and its message and stack read into the
 * copy, so the line still names the error and where it began.
 */
export function loggableError(error: unknown, depth = 0): unknown {
  if (typeof error !== 'object' || error === null || depth > MAX_DEPTH) return error;
  const replaced = new Map<PropertyKey, unknown>();
  const cause = Object.getOwnPropertyDescriptor(error, 'cause');
  if (cause && 'value' in cause) {
    const kept = loggableError(cause.value, depth + 1);
    if (kept !== cause.value) replaced.set('cause', kept);
  }
  const errors: unknown = Object.getOwnPropertyDescriptor(error, 'errors')?.value;
  if (Array.isArray(errors)) {
    const kept = errors.map((e: unknown) => loggableError(e, depth + 1));
    if (kept.some((e, i) => e !== errors[i])) replaced.set('errors', kept);
  }
  for (const key of STATEMENT_FIELDS) {
    const text: unknown = Object.getOwnPropertyDescriptor(error, key)?.value;
    if (typeof text !== 'string') continue;
    const kept = statementWithoutValues(text);
    if (kept !== text) replaced.set(key, kept);
  }
  const message: unknown = Object.getOwnPropertyDescriptor(error, 'message')?.value;
  if (typeof message === 'string') {
    const told = messageWithoutValues(error, message);
    if (told !== message) {
      replaced.set('message', told);
      const stack: unknown = (error as { stack?: unknown }).stack;
      if (typeof stack === 'string') replaced.set('stack', stackWithout(stack, message, told));
    }
  }
  const fromServer = sqlState(error) !== undefined;
  const leftOut = (key: PropertyKey) => VALUE_FIELDS.has(key) || (fromServer && SERVER_VALUE_FIELDS.has(key));
  const keys = Reflect.ownKeys(error);
  if (!keys.some(leftOut) && replaced.size === 0) return error;
  const copy: PropertyDescriptorMap = {};
  for (const key of keys) {
    if (leftOut(key)) continue;
    copy[key] = {
      value: replaced.has(key) ? replaced.get(key) : (error as Record<PropertyKey, unknown>)[key],
      enumerable: Object.getOwnPropertyDescriptor(error, key)?.enumerable ?? false,
      writable: true,
      configurable: true,
    };
  }
  // A stack the error holds through its prototype is printed all the same.
  for (const [key, value] of replaced) {
    if (!Object.hasOwn(copy, key)) copy[key] = { value, enumerable: false, writable: true, configurable: true };
  }
  return Object.create(Object.getPrototypeOf(error) as object | null, copy) as unknown;
}

/**
 * Log the fault with a reference and answer with a safe sentence carrying it.
 *
 * `doing` completes both "…failed" in the log and "Something went wrong …" in
 * the response, so it reads as a gerund: `'listing connections'`.
 */
export function serverFault(res: Response, code: string, doing: string, error: unknown): void {
  const ref = newReference();
  log.error(`[api] ${doing} failed [ref ${ref}]:`, loggableError(error));
  // And on the operator's log page (0129 T1), searchable by the same
  // reference: the code as the event, the organisation when the request had
  // one, and never the error's text. Not awaited: `recordAppEvent` never
  // throws, and the answer to the person must not wait on the log.
  const tenantId: unknown = res.locals?.tenantId;
  void recordAppEvent({
    level: 'error',
    event: `api.${code}`,
    reference: ref,
    ...(typeof tenantId === 'string' && tenantId ? { tenantId } : {}),
  });
  res.status(500).json({
    error: code,
    // Written for a tester (the owner, 2026-10-14): what to do with the
    // reference, which is to mention it to us. Where it leads, the log, is
    // ours; the sentence used to send the reader there.
    reason:
      `Something went wrong ${doing} — this is a fault on our side, not something ` +
      `your input caused. Reference ${ref}: mention it when you contact us.`,
  });
}
