// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * An error as a log may print it: all that diagnoses it, and none of the
 * values it carries (workplan 0168).
 *
 * The shared `log` reads every error it is handed through this (`logger.ts`),
 * so whatever a process logs, a route's fault, a job's failure or the
 * appliance's 500, prints the same way. `serverFault` (apps/api) calls it too.
 *
 * And one layer down, `errorWithoutValues` gives the ledger an error to throw
 * in place of a database driver's, whose own message already says no value:
 * a line that writes `${err.message}` into its own text then prints none.
 */

/** How deep a chain of causes is followed before the rest is printed as it is. */
const MAX_DEPTH = 8;

/** What the logged copy says where a value stood. */
const REDACTED = '[redacted]';

/**
 * Fields that hold values, on whatever error carries them: a body parser's
 * `body`, the raw request text; the statement's parameters, as Drizzle's
 * `DrizzleQueryError` and PGlite carry them (`params`) and as postgres.js
 * does (`parameters`, `args`); PGlite's `queryOptions`, whose `blob` is a
 * file's bytes; and the addresses a mail server refused, as nodemailer lists
 * them (`rejected`, `rejectedErrors`, each with its `recipient`, and an
 * `envelope`'s `from` and `to`).
 */
const VALUE_FIELDS: ReadonlySet<PropertyKey> = new Set([
  'body',
  'params',
  'parameters',
  'args',
  'queryOptions',
  'rejected',
  'rejectedErrors',
  'recipient',
  'envelope',
]);

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

/** An own field's value, read without calling a getter. */
function ownValue(error: object, key: PropertyKey): unknown {
  return Object.getOwnPropertyDescriptor(error, key)?.value;
}

/**
 * A mail server's refusal, as nodemailer reports one: the server's reply as
 * `response`, and after the message nodemailer builds from it, with the
 * command it answered (`RCPT TO`) and its status (`responseCode`). The reply
 * quotes the address it refused (`550 5.1.1 <…>: Recipient address rejected`),
 * and nodemailer's own message can name it too (`Message failed for recipient
 * …`).
 */
function isMailError(error: object): boolean {
  return (
    typeof ownValue(error, 'command') === 'string' ||
    typeof ownValue(error, 'responseCode') === 'number' ||
    typeof ownValue(error, 'response') === 'string' ||
    Object.prototype.hasOwnProperty.call(error, 'rejected')
  );
}

/** An address as a mail server or nodemailer writes one, inside angle brackets or not. */
const ADDRESS = /[^\s<>"'(),;:@[\]]+@[^\s<>"'(),;:@[\]]+/g;

/** Text with every address in it said as `[redacted]`. */
function withoutAddresses(text: string): string {
  return text.replace(ADDRESS, REDACTED);
}

/** The SQLSTATE of Postgres's own report, from any driver; undefined on any other error. */
function sqlState(error: object): string | undefined {
  const code = ownValue(error, 'code');
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) && typeof ownValue(error, 'severity') === 'string'
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
 * - A mail server's refusal names the address it refused (`isMailError`): every
 *   address in it goes, and the status and the words around it stay.
 */
function messageWithoutValues(error: object, message: string): string {
  const query = ownValue(error, 'query');
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
  if (isMailError(error)) return withoutAddresses(message);
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

/** What one error's own fields need to say no value, its causes aside: those replaced, and those left out. */
interface OwnRedactions {
  readonly replaced: Map<PropertyKey, unknown>;
  readonly leftOut: (key: PropertyKey) => boolean;
}

function ownRedactions(error: object): OwnRedactions {
  const replaced = new Map<PropertyKey, unknown>();
  for (const key of STATEMENT_FIELDS) {
    const text = ownValue(error, key);
    if (typeof text !== 'string') continue;
    const kept = statementWithoutValues(text);
    if (kept !== text) replaced.set(key, kept);
  }
  const response = ownValue(error, 'response');
  if (typeof response === 'string' && isMailError(error)) {
    const kept = withoutAddresses(response);
    if (kept !== response) replaced.set('response', kept);
  }
  const message = ownValue(error, 'message');
  if (typeof message === 'string') {
    const told = messageWithoutValues(error, message);
    if (told !== message) {
      replaced.set('message', told);
      const stack: unknown = (error as { stack?: unknown }).stack;
      if (typeof stack === 'string') replaced.set('stack', stackWithout(stack, message, told));
    }
  }
  const fromServer = sqlState(error) !== undefined;
  return {
    replaced,
    leftOut: (key) => VALUE_FIELDS.has(key) || (fromServer && SERVER_VALUE_FIELDS.has(key)),
  };
}

/** A copy of the error: the same prototype, its fields but those left out, the replaced ones replaced. */
function copyOf(error: object, { replaced, leftOut }: OwnRedactions): object {
  const copy: PropertyDescriptorMap = {};
  for (const key of Reflect.ownKeys(error)) {
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
    if (!Object.prototype.hasOwnProperty.call(copy, key)) {
      copy[key] = { value, enumerable: false, writable: true, configurable: true };
    }
  }
  return Object.create(Object.getPrototypeOf(error) as object | null, copy) as object;
}

/**
 * The error as a log may print it: all that diagnoses it, and none of the
 * values it carries.
 *
 * A body parser's error carries the raw request text as `body` (#1490's
 * review, workplan 0093): a stranger's address and note, printed with the
 * error. Those errors no longer reach a log (`unreadable-body.ts`, apps/api),
 * and this keeps any other error that carries a body, in its `cause` or among
 * the `errors` it gathers, from doing the same.
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
 * A mail server's refusal quotes the address it refused, and nodemailer lists
 * it (`isMailError`): the address goes from the reply and the message, the
 * lists go, and the code, the status and the command stay.
 *
 * What diagnoses stays: the message, name and stack, `code`, `severity`,
 * `routine`, `file` and `line`, the names in `schema`, `table`, `column`,
 * `dataType` and `constraint`, a statement up to its first literal, and every
 * cause in the chain, each read the same way.
 *
 * The caller's error is not changed. An error with nothing to leave out is
 * returned as it is, so it prints exactly as before, and a copy read again is
 * returned as it is too. Any other is copied: same prototype, same fields but
 * those, and its message and stack read into the copy, so the line still names
 * the error and where it began.
 */
export function loggableError(error: unknown, depth = 0): unknown {
  if (typeof error !== 'object' || error === null || depth > MAX_DEPTH) return error;
  const own = ownRedactions(error);
  const cause = Object.getOwnPropertyDescriptor(error, 'cause');
  if (cause && 'value' in cause) {
    const kept = loggableError(cause.value, depth + 1);
    if (kept !== cause.value) own.replaced.set('cause', kept);
  }
  const errors = ownValue(error, 'errors');
  if (Array.isArray(errors)) {
    const kept = errors.map((e: unknown) => loggableError(e, depth + 1));
    if (kept.some((e, i) => e !== errors[i])) own.replaced.set('errors', kept);
  }
  if (!Reflect.ownKeys(error).some(own.leftOut) && own.replaced.size === 0) return error;
  return copyOf(error, own);
}

/** The errors `errorWithoutValues` made: nothing of theirs is hidden twice. */
const WITHOUT_VALUES = new WeakSet<object>();

/**
 * A database error to throw on in place of the driver's (workplan 0168): the
 * same class, `code` and names, so a caller that branches on them still does,
 * and a message and stack that say no value, so a line that writes
 * `${err.message}` into its own text prints none.
 *
 * What the error's own fields carried stays reachable only as its `cause`: the
 * original itself, or, for an error that already had a cause, that cause read
 * the same way. So Drizzle's shape holds: a `DrizzleQueryError`'s `cause` is
 * still the driver's error, with its `code` and `constraint`, and the
 * original is behind that. Drizzle's own wrapper adds nothing but the values,
 * and is not kept.
 *
 * An error with nothing to hide is returned as it is, and so is one this made:
 * reading an error twice changes nothing. `loggableError` still reads the
 * whole chain when the error is logged, the kept original included.
 */
export function errorWithoutValues(error: unknown, depth = 0): unknown {
  if (typeof error !== 'object' || error === null || depth > MAX_DEPTH || WITHOUT_VALUES.has(error)) return error;
  const own = ownRedactions(error);
  const hasOwnValues = own.replaced.size > 0 || Reflect.ownKeys(error).some(own.leftOut);
  const cause = Object.getOwnPropertyDescriptor(error, 'cause');
  const original: unknown = cause && 'value' in cause ? cause.value : undefined;
  const hadCause = cause !== undefined && 'value' in cause;
  const keptCause = hadCause ? errorWithoutValues(original, depth + 1) : undefined;
  if (!hasOwnValues && keptCause === original) return error;
  own.replaced.set('cause', hadCause ? keptCause : error);
  const twin = copyOf(error, own);
  WITHOUT_VALUES.add(twin);
  return twin;
}
