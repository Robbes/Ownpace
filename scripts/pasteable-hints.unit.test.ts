// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A command a script prints for a human to paste is part of its interface, and
 * it is expanded by the OPERATOR'S shell before it ever reaches a container.
 *
 * `$POSTGRES_USER` and `$POSTGRES_DB` are set inside `ownpace-db` and nowhere
 * else. Printed bare they expand to nothing in the operator's shell, `psql`
 * falls back to the host username, and the answer is:
 *
 *   psql: error: connection to server on socket "…" failed:
 *   FATAL:  role "root" does not exist
 *
 * THIS HAS NOW HAPPENED TWICE. It was found and fixed in
 * `seed-demo-dav-content.sh` (#487, "the watch it land hint could not be
 * pasted"), and the test written for it watched that ONE FILE — so when
 * `bootstrap-managed.sh` printed a clear-down remedy in the same shape on
 * 2026-08-23, nothing objected, and an operator pasted it and got the same
 * `role "root" does not exist` back. `smoke-managed.sh`'s run_event hint was
 * carrying the same bug at the same time, unnoticed and unreported.
 *
 * A guard scoped to the file where a bug was found does not stop the class. So
 * this one reads EVERY script in deploy/compose and refuses the shape, wherever
 * it appears and whoever writes it next.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const COMPOSE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'deploy', 'compose');

const scripts = readdirSync(COMPOSE_DIR)
  .filter((f) => f.endsWith('.sh'))
  .map((f) => ({ file: f, text: readFileSync(join(COMPOSE_DIR, f), 'utf8') }));

/** Lines that run OR print a psql call carrying a container-only variable. */
const psqlLines = scripts.flatMap(({ file, text }) =>
  text
    .split('\n')
    .map((line, i) => ({ file, n: i + 1, line }))
    .filter(
      ({ line }) =>
        /\bpsql\b/.test(line) &&
        /\$\{?POSTGRES_(USER|DB)\b/.test(line) &&
        // A `${POSTGRES_USER:-openmigrate}` default resolves in ANY shell, so
        // it is not this rule's business — that is a script calling psql for
        // itself, not a line somebody is meant to paste.
        !/\$\{POSTGRES_(USER|DB):-/.test(line),
    ),
);

describe('a psql hint a human is meant to paste', () => {
  it('found some to check', () => {
    // Vacuity guard: if the regex stops matching, every case below passes on an
    // empty list and the guard silently stops guarding — which is the exact
    // failure mode that let this bug come back.
    expect(psqlLines.length, 'no psql-with-container-variable lines found at all').
      toBeGreaterThan(2);
  });

  it('resolves its credentials INSIDE the container, never in the pasting shell', () => {
    const bare = psqlLines.filter(({ line }) => !/\bsh -l?c\b/.test(line));
    expect(
      bare.map(({ file, n, line }) => `${file}:${n}: ${line.trim()}`),
      'expands to nothing in the operator\'s shell — `FATAL: role "root" does not exist`',
    ).toEqual([]);
  });

  it('keeps the dollar signs literal all the way to that container', () => {
    // `sh -c` with the right words in the wrong quotes is no better: inside
    // DOUBLE quotes the operator's shell expands the name before `sh` sees it.
    // Either single-quote the whole `sh -c` argument, or backslash-escape the
    // dollars so what PRINTS still carries them.
    const leaky = psqlLines.filter(({ line }) => {
      const inSingles = /sh -l?c '[^']*\$\{?POSTGRES_/.test(line);
      const escaped = /\\\$\{?POSTGRES_/.test(line);
      return !inSingles && !escaped;
    });
    expect(
      leaky.map(({ file, n, line }) => `${file}:${n}: ${line.trim()}`),
      'the operator\'s shell expands these before the container ever sees them',
    ).toEqual([]);
  });

  it('the clear-down remedy is idempotent, so a second paste is not an error', () => {
    // It is printed at a moment when somebody is already debugging; pasting it
    // twice must not add a failure to the pile they are reading.
    const bootstrap = readFileSync(join(COMPOSE_DIR, 'bootstrap-managed.sh'), 'utf8');
    const drops = bootstrap.split('\n').filter((l) => /DROP DATABASE/.test(l));
    expect(drops.length, 'the clear-down remedy has gone missing').toBeGreaterThan(0);
    for (const line of drops) {
      expect(line, 'DROP DATABASE without IF EXISTS errors on a second run').
        toMatch(/DROP DATABASE IF EXISTS/);
    }
  });
});
