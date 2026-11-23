// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A database fault must not print the values its statement carried (workplan
 * 0168's Status: "A database fault logs the driver's whole error, parameters
 * included (`server-fault.ts`), on every route; the fix belongs in
 * `loggableError`").
 *
 * Every error here is a real one, made by an installed driver against a real
 * Postgres: PGlite, which the appliance and the route tests run on, and `pg`,
 * which the API runs on, here talking to that same PGlite through a socket in
 * this process, each bare and wrapped by Drizzle's session as the routes meet
 * them. Each is written to the log by `serverFault`, printed in full, and must
 * name nobody while keeping what diagnoses it.
 *
 * And the same errors handed straight to the shared `log`, as about fifty
 * routes, jobs and the appliance hand theirs, without `serverFault`: the log
 * itself reads every error through `loggableError`, at every level.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import type { Response } from 'express';
import { Duplex } from 'node:stream';
import { formatWithOptions, inspect } from 'node:util';
import pg from 'pg';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { CutoverRefused } from '@openmig/core';
import { pgDriver, pgliteDriver, type LedgerConnection, type LedgerDriver } from '@openmig/ledger';
import { log, loggableError, resetLogLevel, setLogLevel } from '@openmig/shared';
import { serverFault } from './server-fault.ts';

/** The person's values. None of them may reach the log. */
const EMAIL = 'someone-s1@example.com';
const NAME = 'Someone S1';
const NOTE = 'a note from someone S1';
const VALUES = [EMAIL, 'someone-s1', NAME, NOTE];

/** What PGlite offers a socket: the wire protocol, in and out. */
interface WireProtocol {
  execProtocolRawSync(message: Uint8Array): Uint8Array;
}

/**
 * A socket for `pg` whose far end is PGlite: the API's own driver against a
 * real Postgres, in this process, with no port. Each batch `pg` writes, the
 * startup packet and then every run of messages up to a Sync, a Query or a
 * Terminate, goes to PGlite whole, and PGlite's answer is what `pg` reads.
 */
function socketTo(postgres: WireProtocol): Duplex {
  let pending = Buffer.alloc(0);
  let started = false;
  /** Where the next whole batch ends, or 0 while it has not all arrived. */
  const batchEnd = (): number => {
    if (!started) {
      return pending.length >= 4 && pending.length >= pending.readInt32BE(0) ? pending.readInt32BE(0) : 0;
    }
    for (let at = 0; at + 5 <= pending.length; ) {
      const type = String.fromCharCode(pending[at]!);
      at += 1 + pending.readInt32BE(at + 1);
      if (at > pending.length) return 0;
      if (type === 'S' || type === 'Q' || type === 'X') return at;
    }
    return 0;
  };
  const socket = new Duplex({
    read() {},
    write(chunk: Buffer, _encoding, done) {
      pending = Buffer.concat([pending, chunk]);
      for (let end = batchEnd(); end > 0; end = batchEnd()) {
        const batch = pending.subarray(0, end);
        pending = pending.subarray(end);
        if (started && batch[0] === 'X'.charCodeAt(0)) {
          socket.push(null);
          break;
        }
        started = true;
        const answer = postgres.execProtocolRawSync(new Uint8Array(batch));
        if (answer.length > 0) socket.push(Buffer.from(answer));
      }
      done();
    },
  });
  return Object.assign(socket, {
    connect() {
      process.nextTick(() => socket.emit('connect'));
      return socket;
    },
    setNoDelay: () => socket,
    setKeepAlive: () => socket,
  });
}

/** Just enough Express Response for `serverFault` to answer. */
function fakeRes(): Response {
  const res = { status: () => res, json: () => res };
  return res as unknown as Response;
}

/** What `serverFault` writes to the log for this fault, printed in full. */
function logged(error: unknown): string {
  const lines: string[] = [];
  const spy = vi.spyOn(log, 'error').mockImplementation((...args: unknown[]) => {
    lines.push(args.map((a) => (typeof a === 'string' ? a : inspect(a, { depth: Infinity }))).join(' '));
  });
  try {
    serverFault(fakeRes(), 'add_failed', 'adding this person', error);
  } finally {
    spy.mockRestore();
  }
  return lines.join('\n');
}

function expectNoValue(line: string): void {
  for (const value of VALUES) expect(line, `the log printed ${value}`).not.toContain(value);
}

/**
 * The error a statement's own fields came from: since the ledger throws a
 * database error without its values (`errorWithoutValues`, workplan 0168), the
 * original is kept only at the end of its chain of causes.
 */
function original(error: unknown): Record<string, unknown> {
  let at = error as Record<string, unknown>;
  while (typeof at.cause === 'object' && at.cause !== null) at = at.cause as Record<string, unknown>;
  return at;
}

/** The error the statement threw. */
async function thrown(statement: () => Promise<unknown>): Promise<unknown> {
  try {
    await statement();
  } catch (error) {
    return error;
  }
  throw new Error('the statement did not fail');
}

let driver: LedgerDriver;
let connection: LedgerConnection;
let client: pg.Client;

beforeAll(async () => {
  driver = pgliteDriver();
  connection = await driver.acquire();
  await connection.exec(`
    CREATE TABLE person (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email text NOT NULL UNIQUE,
      name text,
      note text CHECK (length(note) < 10)
    );
  `);
  await connection.query('INSERT INTO person (email, name) VALUES ($1, $2)', [EMAIL, NAME]);
  // Drizzle keeps the client it was given; for PGlite that is the database.
  const postgres = (connection.db as unknown as { $client: WireProtocol }).$client;
  client = new pg.Client({ stream: () => socketTo(postgres), user: 'postgres', database: 'postgres' });
  await client.connect();
});

afterAll(async () => {
  await client.end();
  connection.release();
  await driver.end();
});

beforeEach(() => vi.restoreAllMocks());

describe('a database fault, as the log prints it (workplan 0168)', () => {
  it('pg: the key a unique violation quotes is not printed, and what diagnoses it is', async () => {
    const error = await thrown(() =>
      client.query('INSERT INTO person (email, name) VALUES ($1, $2)', [EMAIL, NAME]),
    );
    // The driver's own error names the person: this is what the log printed.
    expect((error as { detail?: string }).detail).toBe(`Key (email)=(${EMAIL}) already exists.`);

    const line = logged(error);

    expectNoValue(line);
    expect(line).toContain('duplicate key value violates unique constraint "person_email_key"');
    expect(line).toContain("code: '23505'");
    expect(line).toContain("severity: 'ERROR'");
    expect(line).toContain("table: 'person'");
    expect(line).toContain("constraint: 'person_email_key'");
    expect(line).toContain("routine: '_bt_check_unique'");
    // And the caller's error is left as it was handed in.
    expect((error as { detail?: string }).detail).toContain(EMAIL);
  });

  it('pg: the row a check violation prints whole is not printed', async () => {
    const error = await thrown(() =>
      client.query('INSERT INTO person (email, name, note) VALUES ($1, $2, $3)', [EMAIL, NAME, NOTE]),
    );
    expect((error as { detail?: string }).detail).toContain(`${EMAIL}, ${NAME}, ${NOTE}`);

    const line = logged(error);

    expectNoValue(line);
    expect(line).toContain("code: '23514'");
    expect(line).toContain("constraint: 'person_note_check'");
  });

  it('pg: the input a column could not take is not printed, in the message or its stack', async () => {
    const error = await thrown(() => client.query('SELECT name FROM person WHERE id = $1', [EMAIL]));
    // Postgres quotes it in the message itself, so in the stack's first line too.
    expect((error as Error).message).toBe(`invalid input syntax for type uuid: "${EMAIL}"`);
    expect((error as Error).stack).toContain(EMAIL);

    const line = logged(error);

    expectNoValue(line);
    expect(line).toContain('invalid input syntax for type uuid: "[redacted]"');
    expect(line).toContain("code: '22P02'");
    expect(line).toContain("routine: 'string_to_uuid'");
  });

  it("Drizzle over pg: the statement's values are not printed, in its message, its stack or its params", async () => {
    const error = await thrown(() =>
      drizzle(client).execute(sql`INSERT INTO person (email, name) VALUES (${EMAIL}, ${NAME})`),
    );
    // Thrown without its values already, by the ledger's reading of Drizzle's
    // failures; the driver's error is still its cause, the original behind it.
    expect((error as Error).message).toBe(
      'Failed query: INSERT INTO person (email, name) VALUES ($1, $2)\nparams: [redacted]',
    );
    expect((error as { cause?: { code?: string } }).cause?.code).toBe('23505');
    expect(original(error).detail).toBe(`Key (email)=(${EMAIL}) already exists.`);

    const line = logged(error);

    expectNoValue(line);
    // Which statement failed, and why, still read.
    expect(line).toContain('Failed query: INSERT INTO person (email, name) VALUES ($1, $2)\nparams: [redacted]');
    expect(line).toContain("query: 'INSERT INTO person (email, name) VALUES ($1, $2)'");
    expect(line).toContain("code: '23505'");
    expect(line).toContain("constraint: 'person_email_key'");
  });

  it("PGlite: the statement's params are not printed, bare or wrapped by Drizzle, and the statement is", async () => {
    const bare = await thrown(() =>
      connection.query('INSERT INTO person (email, name) VALUES ($1, $2)', [EMAIL, NAME]),
    );
    const wrapped = await thrown(() =>
      connection.db.execute(sql`INSERT INTO person (email, name) VALUES (${EMAIL}, ${NAME})`),
    );
    // The ledger's driver throws it without them; the original keeps them.
    expect((bare as { params?: unknown }).params).toBeUndefined();
    expect(original(bare).params).toEqual([EMAIL, NAME]);
    expect(Object.hasOwn(original(bare), 'queryOptions')).toBe(true);

    for (const error of [bare, wrapped]) {
      const line = logged(error);

      expectNoValue(line);
      expect(line).toContain("query: 'INSERT INTO person (email, name) VALUES ($1, $2)'");
      expect(line).toContain("code: '23505'");
      expect(line).not.toContain('queryOptions');
    }
  });

  it('PGlite: a value written into the statement itself is not printed', async () => {
    const error = await thrown(() =>
      connection.exec(`INSERT INTO person (email, name) VALUES ('${EMAIL}', '${NAME}')`),
    );
    expect((error as { query?: string }).query).toBe('INSERT INTO person (email, name) VALUES ([redacted]');
    expect(original(error).query).toContain(EMAIL);

    const line = logged(error);

    expectNoValue(line);
    // The statement up to its first literal: what it was, without what it said.
    expect(line).toContain("query: 'INSERT INTO person (email, name) VALUES ([redacted]'");
  });

  it('keeps the frames, and not the first line, of a stack read before its message changed', () => {
    // V8 writes a stack's first line when the stack is first read, so this
    // one still says the old message, value and all.
    const error = Object.assign(new Error(`invalid input syntax for type uuid: "${EMAIL}"`), {
      code: '22P02',
      severity: 'ERROR',
    });
    void error.stack;
    error.message = `invalid input syntax for type uuid: "${EMAIL}" (read again)`;

    const line = inspect(loggableError(error), { depth: Infinity });

    expectNoValue(line);
    expect(line).toContain('invalid input syntax for type uuid: "[redacted]"');
    expect(line).toContain('a-database-fault-logged-without-its-values.unit.test.ts');
  });

  it("returns an error with nothing to leave out as it is, the program's own hint included", () => {
    // A `hint` is Postgres's only on an error that carries a SQLSTATE; this
    // one is a sentence the program wrote for the person, and stays.
    const refused = new CutoverRefused('this migration has not been approved', 'approve it first');
    expect(loggableError(refused)).toBe(refused);
  });
});

/** What the shared log prints for these arguments, as `console` prints them but in full. */
function printedByTheLog(level: 'error' | 'warn' | 'info' | 'debug', ...args: unknown[]): string {
  const lines: string[] = [];
  const stream = level === 'error' || level === 'warn' ? level : 'log';
  const spy = vi.spyOn(console, stream).mockImplementation((...printed: unknown[]) => {
    lines.push(formatWithOptions({ depth: Infinity }, ...printed));
  });
  try {
    log[level](...args);
  } finally {
    spy.mockRestore();
  }
  return lines.join('\n');
}

describe('the shared log, handed the error itself (workplan 0168)', () => {
  beforeEach(() => setLogLevel('debug'));
  afterEach(() => resetLogLevel());

  it('prints no value from a real pg, Drizzle or PGlite error, at any level', async () => {
    const faults = {
      'pg, a unique key': await thrown(() =>
        client.query('INSERT INTO person (email, name) VALUES ($1, $2)', [EMAIL, NAME]),
      ),
      'pg, an input the column could not take': await thrown(() =>
        client.query('SELECT name FROM person WHERE id = $1', [EMAIL]),
      ),
      'Drizzle over pg': await thrown(() =>
        drizzle(client).execute(sql`INSERT INTO person (email, name) VALUES (${EMAIL}, ${NAME})`),
      ),
      'PGlite, a failing row': await thrown(() =>
        connection.query('INSERT INTO person (email, name, note) VALUES ($1, $2, $3)', [EMAIL, NAME, NOTE]),
      ),
      'PGlite, a value written into the statement': await thrown(() =>
        connection.exec(`INSERT INTO person (email, name) VALUES ('${EMAIL}', '${NAME}')`),
      ),
    };

    for (const [fault, error] of Object.entries(faults)) {
      for (const level of ['error', 'warn', 'info', 'debug'] as const) {
        const line = printedByTheLog(level, '[jobs] a run failed:', error);

        expectNoValue(line);
        // Printed, and still saying what failed.
        expect(line, `${fault}, ${level}`).toContain('[jobs] a run failed:');
        expect(line, `${fault}, ${level}`).toMatch(/code: '(23505|22P02|23514)'/);
      }
    }
  });

  it('prints an argument that is not an error as it is', () => {
    const line = printedByTheLog('info', '[jobs] asked:', { params: ['kept as asked'] });

    expect(line).toContain('kept as asked');
  });
});

/**
 * A line that writes an error's message into its own text hands the log a
 * string, which the log cannot read again; so the ledger throws a database
 * error whose message already says no value (`errorWithoutValues`, workplan
 * 0168): Drizzle's failures where Drizzle runs a statement, and a statement a
 * ledger driver sends where it sends it.
 */
describe("a line that writes the error's message into its own text", () => {
  it('prints no value after a real pg, Drizzle or PGlite fault through the ledger', async () => {
    // The ledger's own pg driver, over the same socket to the same Postgres.
    const viaPg = pgDriver({
      connect: async () => Object.assign(client, { release: () => {} }),
      end: async () => {},
    } as unknown as pg.Pool);
    const pgConnection = await viaPg.acquire();
    const faults = {
      'pg, an input the column could not take': await thrown(() =>
        pgConnection.query('SELECT name FROM person WHERE id = $1', [EMAIL]),
      ),
      'Drizzle over pg, a unique key': await thrown(() =>
        drizzle(client).execute(sql`INSERT INTO person (email, name) VALUES (${EMAIL}, ${NAME})`),
      ),
      'Drizzle over pg, a value written into the statement': await thrown(() =>
        drizzle(client).execute(sql.raw(`INSERT INTO person (email, name) VALUES ('${EMAIL}', '${NAME}')`)),
      ),
      'PGlite, an input the column could not take': await thrown(() =>
        connection.query('SELECT name FROM person WHERE id = $1', [EMAIL]),
      ),
      'Drizzle over PGlite, a failing row': await thrown(() =>
        connection.db.execute(sql`INSERT INTO person (email, name, note) VALUES (${EMAIL}, ${NAME}, ${NOTE})`),
      ),
    };

    for (const [fault, error] of Object.entries(faults)) {
      const line = printedByTheLog('error', `[jobs] ${fault} failed: ${(error as Error).message}`);

      expectNoValue(line);
      expect(line, fault).toMatch(/^\[jobs\] .+ failed: \S/);
    }
  });
});
