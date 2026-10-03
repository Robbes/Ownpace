// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * EVERY DATA TYPE GETS A TURN, in the pass itself (workplan 0143 T5).
 *
 * `passOrder` and `domainDeadline` are proved in
 * `packages/shared/src/a-domain-that-waits-its-turn.unit.test.ts`. This holds
 * the other half: the delta-sync task uses them. It sorts its data types with
 * the first, and hands each of the five branches its own share from the second,
 * asked inside the loop so that the time a type did not use flows on. A branch
 * handed the pass's own `deadline` would take the whole pass again, which is
 * the defect: a large mailbox's first copy holding back everything behind it.
 *
 * Read as text, as `a-drain-that-only-said-so` reads the tick: the task body
 * needs a database, a runner and five connectors to execute, and what is
 * asserted is which value each call is handed.
 *
 * It fails today: every branch is handed the same `deadline`.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Comments removed: the task's own prose names the very calls it guards. */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

/** The task body, from its `run`, not the file: an import line is a promise, not a use. */
const TASK = (() => {
  const whole = code(readFileSync(join(HERE, 'run-delta-sync.ts'), 'utf8'));
  const body = whole.indexOf("run: leavesAReference('run-delta-sync', async (");
  expect(body, 'the task body is no longer recognisable').toBeGreaterThan(-1);
  return whole.slice(body);
})();

/** The loop over the data types, from its head to the end of the task. */
const LOOP = (() => {
  const head = TASK.indexOf('for (const domain of domains) {');
  expect(head, 'the loop over the data types is no longer recognisable').toBeGreaterThan(-1);
  return TASK.slice(head);
})();

const BRANCHES = ['runShadowPass', 'runCalendarSync', 'runContactSync', 'runTaskSync', 'runFileSync'];

describe('the delta-sync task', () => {
  it('takes its data types in the pass order', () => {
    expect(TASK).toMatch(/const domains = passOrder\(typedPayload\.domains \?\? \[\.\.\.selected\]\);/);
  });

  it('asks for each type’s share inside the loop, from the time and the types left', () => {
    expect(LOOP).toMatch(/const typesLeft = domains\.length - domains\.indexOf\(domain\);/);
    expect(LOOP).toMatch(/const typeDeadline = domainDeadline\(deadline, Date\.now\(\), typesLeft\);/);
  });

  it('hands every branch its share, and none of them the whole pass', () => {
    // Through `passStops` since 2026-09-29: the share, and beside it the
    // question a pass asks to hear a Pause pressed while it copies. One
    // object, so no branch can be handed its share without the question, and
    // the share is still this type's and never the whole pass.
    expect(LOOP).toMatch(/const passStops[^=]*=\s*\{\s*deadline: typeDeadline,/);
    for (const branch of BRANCHES) {
      const at = LOOP.indexOf(`await ${branch}(`);
      expect(at, `${branch} is no longer called in the loop`).toBeGreaterThan(-1);
      const call = LOOP.slice(at, LOOP.indexOf(')', LOOP.indexOf('}', at)) + 1);
      expect(call, `${branch} is not handed its share`).toMatch(/\.\.\.passStops\b/);
      expect(call, `${branch} is handed the whole pass`).not.toMatch(/[{,]\s*deadline\s*[,}]/);
    }
  });

  it('asks for the share after the pass deadline is known, and only once per type', () => {
    expect(TASK.indexOf('const deadline = passDeadlineFrom(Date.now());')).toBeLessThan(TASK.indexOf('const typeDeadline'));
    expect(LOOP.match(/domainDeadline\(/g) ?? []).toHaveLength(1);
  });
});
