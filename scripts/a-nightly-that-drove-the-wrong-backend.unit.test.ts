// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A cron moved, and both nightlies quietly ran the same backend.
 *
 * `e2e.yml` proves BOTH persistence backends every night, as two firings of
 * one workflow. A `schedule` event carries no inputs, so which backend a
 * firing drives cannot be passed in — it is DERIVED from which cron fired, by
 * comparing `github.event.schedule` against a cron string written out again,
 * by hand, in two `pglite` expressions further down the file.
 *
 * That is a literal repeated in three places with no compiler between them.
 * Change the cron and forget the expressions and nothing errors, nothing warns,
 * and no log line says so: both firings match neither branch, both fall to the
 * `|| ''` default, and the PGlite stack is never stood up again. The nightly
 * keeps reporting two green runs a night. It is proving one thing twice.
 *
 * It nearly happened on 2026-09-08, moving the whole nightly block two hours
 * earlier (GitHub had been dispatching this repository's crons four to five
 * hours late since 27 August, so the block had walked into the working day).
 * The `on:` comment says "change a cron here and those two expressions must
 * follow" and has said so since 0025 T5 — a comment that has to be read by
 * whoever edits the line above it, at the moment they edit it. This is the
 * same sentence, enforced.
 *
 * ## What these tests hold
 *
 *  1. every `github.event.schedule ==` comparison in `e2e.yml` names a cron
 *     that workflow actually declares — so a moved cron cannot leave a
 *     comparison pointing at a time that no longer fires;
 *  2. exactly one of the two declared crons is named by those comparisons —
 *     naming both, or neither, means both firings drive the same backend,
 *     which is the failure itself;
 *  3. the three gates the Spark runs stay staggered by at least an hour. It is
 *     one shared box: two stacks at once fight over Docker and the loser is
 *     blamed on whatever it happened to be testing.
 *
 * Read as text, because what is asserted is agreement between a YAML key and a
 * string inside an expression — GitHub is the only thing that ever evaluates
 * it, and it does so once a night on somebody else's machine.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const read = (p: string) => readFileSync(join(REPO_ROOT, p), 'utf8');

/** Every `- cron: '...'` a workflow declares, in file order. */
function declaredCrons(yaml: string): string[] {
  return [...yaml.matchAll(/^\s*-\s*cron:\s*'([^']+)'/gm)].map((m) => m[1] ?? '');
}

/** Every cron string a `github.event.schedule ==` comparison names. */
function comparedCrons(yaml: string): string[] {
  return [...yaml.matchAll(/github\.event\.schedule\s*==\s*'([^']+)'/g)].map((m) => m[1] ?? '');
}

/** Minutes past midnight UTC, for a 5-field cron with literal minute and hour. */
function minuteOfDay(cron: string): number {
  const [minute = '', hour = ''] = cron.split(/\s+/);
  expect(
    /^\d+$/.test(minute) && /^\d+$/.test(hour),
    `${cron} does not start with a literal minute and hour, so this guard cannot compare it`,
  ).toBe(true);
  return Number(hour) * 60 + Number(minute);
}

describe('the nightly drives the backend the cron says it does', () => {
  const e2e = read('.github/workflows/e2e.yml');

  it('names two crons, one per persistence backend', () => {
    expect(declaredCrons(e2e)).toHaveLength(2);
  });

  it('every schedule comparison names a cron the workflow actually declares', () => {
    const declared = declaredCrons(e2e);
    const compared = comparedCrons(e2e);

    // Not "at least one": a comparison is only reachable if its string is a
    // cron this workflow fires. One that is not can never be true, and the
    // branch it guards is dead code that reads as live.
    expect(compared.length).toBeGreaterThan(0);
    for (const cron of compared) {
      expect(
        declared,
        `.github/workflows/e2e.yml compares github.event.schedule against '${cron}',\n` +
          `which is not one of the crons it declares (${declared.map((c) => `'${c}'`).join(', ')}).\n` +
          'That comparison can never be true, so the branch it guards never runs and\n' +
          'BOTH nightly firings fall through to the default backend — two green runs a\n' +
          'night, proving one thing twice. Move the cron and the comparisons together.',
      ).toContain(cron);
    }
  });

  it('the comparisons single out exactly one of the two firings', () => {
    const declared = declaredCrons(e2e);
    const compared = new Set(comparedCrons(e2e));
    const singledOut = declared.filter((c) => compared.has(c));

    expect(
      singledOut,
      'The two firings must be told apart by exactly one cron string: the one that\n' +
        'matches drives PGlite, the one that does not drives Postgres. Naming both, or\n' +
        'neither, sends both firings down the same branch.',
    ).toHaveLength(1);
  });
});

describe('the three gates on the shared runner stay staggered', () => {
  // The Spark runs all of these. `concurrency` queues rather than cancels, so
  // two firings close together do not corrupt each other — they just make one
  // wait, and a queued job that waits an hour looks like a hung one.
  const GATES = [
    { what: 'E2E (self-hosted)', path: '.github/workflows/e2e.yml' },
    { what: 'E2E (managed)', path: '.github/workflows/e2e-managed.yml' },
  ];

  it('leaves at least an hour between every scheduled firing', () => {
    const firings = GATES.flatMap(({ what, path }) =>
      declaredCrons(read(path)).map((cron) => ({ what, cron, at: minuteOfDay(cron) })),
    ).sort((a, b) => a.at - b.at);

    expect(firings.length).toBeGreaterThanOrEqual(3);

    // Round the clock, not along it: the block deliberately starts the night
    // before (23:30) and ends at 03:30, so the tightest gap in it is the one
    // ACROSS MIDNIGHT. A loop that stops at the last element never measures
    // that one, and 23:30 beside 00:00 would read as twenty-three hours apart.
    for (let i = 1; i <= firings.length; i++) {
      const before = firings[i - 1]!;
      const after = firings[i % firings.length]!;
      const gap = i === firings.length ? after.at + 1440 - before.at : after.at - before.at;
      expect(
        gap,
        `${before.what} ('${before.cron}') and ${after.what} ('${after.cron}') fire ` +
          `${gap} minutes apart.\n` +
          'The runner is one shared box; the longest run either gate has taken is about\n' +
          'twelve minutes, and an hour is the margin that has held. Space them out.',
      ).toBeGreaterThanOrEqual(60);
    }
  });
});
