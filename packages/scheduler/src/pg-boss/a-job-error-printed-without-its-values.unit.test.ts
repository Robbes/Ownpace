// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The job runner's own error lines go through the shared log (workplan 0168).
 *
 * pg-boss reports trouble as an `error` event, and the runner printed what it
 * was handed with `console.error`: a database error whole, its `detail`
 * quoting a key or a failing row. Its three lines now go through the shared
 * `log`, which prints every error through `loggableError`.
 *
 * The error is `pg`'s own `DatabaseError`, filled field by field as `pg`'s
 * parser fills it from Postgres's report; nothing here reaches a database.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { formatWithOptions } from 'node:util';
import pg from 'pg';
import { PgBossProducer } from './job-runner.ts';

const EMAIL = 'someone-s1@example.com';

/** A unique violation as `pg` hands it over: Postgres's report, copied onto its `DatabaseError`. */
function uniqueViolation(): Error {
  return Object.assign(
    new pg.DatabaseError('duplicate key value violates unique constraint "person_email_key"', 212, 'error'),
    {
      severity: 'ERROR',
      code: '23505',
      detail: `Key (email)=(${EMAIL}) already exists.`,
      schema: 'public',
      table: 'person',
      constraint: 'person_email_key',
      file: 'nbtinsert.c',
      line: '673',
      routine: '_bt_check_unique',
    },
  );
}

afterEach(() => vi.restoreAllMocks());

describe("the job runner's error lines", () => {
  it("print pg-boss's error event without the values a database error carries", () => {
    const lines: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...printed: unknown[]) => {
      lines.push(formatWithOptions({ depth: Infinity }, ...printed));
    });
    // Made, never started: nothing connects.
    const producer = new PgBossProducer({ connectionString: 'postgres://jobs.example.invalid/jobs', schema: 'jobs' }, []);

    (producer as unknown as { boss: { emit(event: 'error', error: unknown): boolean } }).boss.emit(
      'error',
      uniqueViolation(),
    );

    const line = lines.join('\n');
    expect(line).toContain('[jobs] pg-boss error:');
    expect(line).toContain("code: '23505'");
    expect(line).toContain("constraint: 'person_email_key'");
    expect(line, 'the log printed the address').not.toContain(EMAIL);
  });
});
