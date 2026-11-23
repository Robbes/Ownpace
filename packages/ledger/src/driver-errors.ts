// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A DATABASE ERROR THAT SAYS NO VALUE, WHEREVER IT IS WRITTEN (workplan 0168).
 *
 * The shared `log` prints an error it is handed without the values it
 * carries (`loggableError`). A line that writes `${err.message}` into its own
 * text hands the log a string instead, and a database error's message can say
 * values: Drizzle's ends `params: <values>`, and Postgres's says the input it
 * could not take (`invalid input syntax for type uuid: "…"`). So the error is
 * made safe where it leaves the ledger's hands, one layer below every line
 * that writes it, by `errorWithoutValues`:
 *
 * - Drizzle builds its message itself, after the driver's error, so nothing
 *   wrapped around a pool or a client can change it. Every statement a
 *   Drizzle handle runs, on `pg` or PGlite, in a transaction or not, goes
 *   through `PgPreparedQuery.queryWithCache`, and its failure is read there,
 *   once per process (`readDrizzleFailuresWithoutValues`).
 * - A statement a ledger driver sends without Drizzle (`conn.query`,
 *   `conn.exec`) is read in `pgDriver` and `pgliteDriver`.
 *
 * The error that comes out has the class and `code` of the one that went in,
 * and a Drizzle error's `cause` is still the driver's error with its `code`
 * and `constraint`, so a caller that branches on them still does (the access
 * request's second knock, a migration's lock timeout).
 *
 * Not reached: a `pg` pool or client used without the ledger, whose message
 * can carry a value only in a data exception. Workplan 0168's Status lists
 * where.
 */

import { PgPreparedQuery } from 'drizzle-orm/pg-core';
import { errorWithoutValues } from '@openmig/shared';

/** Set on Drizzle's prototype once its failures are read, so they are never read twice. */
const READS_FAILURES = Symbol.for('ownpace.ledger.drizzle-failures-without-values');

/** Rethrow a database error as `errorWithoutValues` makes it: for a driver's `.catch`. */
export function rethrowWithoutValues(error: unknown): never {
  throw errorWithoutValues(error);
}

/**
 * Read every failure of every Drizzle statement through `errorWithoutValues`.
 *
 * Done when this module loads, which `db.ts` and `pglite-driver.ts` make sure
 * of, and harmless to do again. A Drizzle that no longer has the method is
 * refused at once: without it every Drizzle failure's message would carry its
 * values again, and nothing else would say so.
 */
export function readDrizzleFailuresWithoutValues(): void {
  const prototype = PgPreparedQuery.prototype as unknown as Record<PropertyKey, unknown>;
  if (prototype[READS_FAILURES] === true) return;
  const queryWithCache = prototype.queryWithCache;
  if (typeof queryWithCache !== 'function') {
    throw new Error(
      'drizzle-orm has no PgPreparedQuery.prototype.queryWithCache to read its failures through, so ' +
        'their messages would carry the values of their statements (workplan 0168; ' +
        'packages/ledger/src/driver-errors.ts).',
    );
  }
  const run = queryWithCache as (this: unknown, ...args: unknown[]) => Promise<unknown>;
  prototype.queryWithCache = async function (this: unknown, ...args: unknown[]): Promise<unknown> {
    try {
      return await run.apply(this, args);
    } catch (error) {
      throw errorWithoutValues(error);
    }
  };
  Object.defineProperty(prototype, READS_FAILURES, { value: true });
}

readDrizzleFailuresWithoutValues();
