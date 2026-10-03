// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A DATABASE THAT COUNTS ITS QUERIES (workplan 0143 T8).
 *
 * The alpha's rehearsal (T9) and its weeks after are the only measurements the
 * machine will get before testers depend on it, and without statistics a slow
 * database is a guess: which statement, how often, how long. `pg_stat_statements`
 * keeps each statement's calls and time with its literal values replaced, and
 * it has to be preloaded when postgres starts, so it is part of the service's
 * command, not something a person turns on afterwards.
 *
 * What this holds:
 *
 *  1. `managed.yml`'s postgres service preloads the library, with utility
 *     statements not tracked: an `ALTER ROLE … PASSWORD`
 *     (`rotate-db-passwords.sh`) must never be kept in the statistics view.
 *  2. The bring-up's data phase, which both the nightly gate and live's deploy
 *     run (`--from data`), creates the extension, idempotently, as the database
 *     owner, and only after postgres is up.
 *  3. The operator runbook gives the one query for the ten statements with the
 *     most total time.
 *
 * ROOT-LEVEL, SO VITEST AND NODE BUILTINS ONLY: the files are read as text.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');

/** One top-level service of a compose file, up to the next one at the same indent. */
function serviceBlock(compose: string, name: string): string {
  const start = compose.search(new RegExp(`^  ${name}:\\s*$`, 'm'));
  if (start < 0) throw new Error(`no service ${name}`);
  const rest = compose.slice(start + 1);
  const next = rest.search(/^ {2}[a-z][\w-]*:\s*$/m);
  return next < 0 ? compose.slice(start) : compose.slice(start, start + 1 + next);
}

/** The words of the service's `command:` list, comments left out. */
function commandOf(service: string): string[] {
  const match = /^ {4}command:\s*\n((?: {6}- .*\n)+)/m.exec(service);
  if (!match) return [];
  return match[1]!
    .split('\n')
    .map((line) => line.replace(/^ {6}- /, '').trim())
    .filter((word) => word !== '');
}

/** A bash function's body, from its `name() {` line to the `}` that closes it. */
function functionBody(script: string, name: string): string {
  const start = script.indexOf(`${name}() {`);
  if (start < 0) throw new Error(`no function ${name}`);
  const end = script.indexOf('\n}\n', start);
  return script.slice(start, end);
}

describe('the managed database counts its queries', () => {
  const postgres = serviceBlock(read('deploy/compose/managed.yml'), 'postgres');
  const command = commandOf(postgres);

  it('preloads pg_stat_statements when postgres starts', () => {
    expect(command[0]).toBe('postgres');
    expect(command).toContain('shared_preload_libraries=pg_stat_statements');
    // Each setting is its own `-c`, or postgres reads it as a stray argument.
    const setting = command.indexOf('shared_preload_libraries=pg_stat_statements');
    expect(command[setting - 1]).toBe('-c');
  });

  it('keeps no utility statement, so no password change reaches the view', () => {
    expect(command).toContain('pg_stat_statements.track_utility=off');
    const setting = command.indexOf('pg_stat_statements.track_utility=off');
    expect(command[setting - 1]).toBe('-c');
  });
});

describe('the bring-up creates the extension', () => {
  const data = functionBody(read('deploy/compose/bootstrap-managed.sh'), 'phase_data');
  const create = data.indexOf('CREATE EXTENSION IF NOT EXISTS pg_stat_statements');

  it('in the data phase, which the gate and live both run', () => {
    expect(create).toBeGreaterThan(-1);
  });

  it('only once postgres is up', () => {
    expect(data.indexOf('up_wait postgres')).toBeGreaterThan(-1);
    expect(data.indexOf('up_wait postgres')).toBeLessThan(create);
  });

  it('as the database owner, in the application database, stopping on an error', () => {
    const call = data.slice(data.lastIndexOf('exec -T postgres psql', create), create);
    expect(call).toContain('-U "${POSTGRES_USER:-openmigrate}"');
    expect(call).toContain('-d "${POSTGRES_DB:-openmigrate}"');
    expect(call).toContain('ON_ERROR_STOP=1');
  });
});

describe('the runbook reads the statistics', () => {
  it('gives the ten statements with the most total time', () => {
    const runbook = read('docs/operator-runbook.md');
    expect(runbook).toContain('FROM pg_stat_statements');
    expect(runbook).toMatch(/ORDER BY total_exec_time DESC\s+LIMIT 10;/);
  });
});
