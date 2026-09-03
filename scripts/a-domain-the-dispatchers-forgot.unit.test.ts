// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A catch-all `else` that ran the wrong sync and called it a success.
 *
 * Workplan 0113's seventh fan-out, and the worst of the seven. Two dispatchers
 * decide which sync pass a domain gets — `runOneDomain` in
 * `packages/orchestration/src/orchestration.ts` for the appliance, and the
 * domain loop in `apps/worker/src/jobs/run-delta-sync.ts` for the managed
 * stack. Both were an if/else-if chain ending in a bare `else` that built FILE
 * deps and ran `runFileSync`.
 *
 * So `task` — enabled, discovered, verified, in five widened lists — fell into
 * the file branch. It ran a file pass, copied nothing (that pass is
 * idempotent), and was then handed to `markCompleted`. The ledger got no task
 * row and the mapping was told its tasks were done.
 *
 * ## Why nothing caught it
 *
 * T5 widened five LISTS, and #750's note explains why that could not help:
 * *"an array literal is never a compile error."* A bare `else` is worse. An
 * absent branch omits work and shows it; a catch-all does the WRONG work and
 * reports success, and the type checker is happy either way because every
 * branch returns the same result shape.
 *
 * `buildDomainDepsFromMapping` even had a `'task'` overload, added by T5 and
 * never called by anything. The plumbing was in place and nothing was
 * connected to it.
 *
 * ## What these tests hold
 *
 * Two properties, because either alone is escapable:
 *
 *  1. every domain the engine can enable has its OWN branch in BOTH
 *     dispatchers — not a shared fallback;
 *  2. neither dispatcher ends in a catch-all, so the NEXT domain added to
 *     `DISCOVERY_DOMAINS` fails loudly instead of quietly becoming a file.
 *
 * Read as text rather than executed: these are two TypeScript files in
 * different packages, and what is being asserted is the SHAPE of a branch
 * chain, which no runtime call can observe. A test that imported and ran them
 * would need a database, two DAV servers and a Trigger.dev runtime, and would
 * still not notice a fifth domain silently sharing the fourth's branch.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The same text with its comments removed.
 *
 * Necessary, not tidiness. The branches this file guards are commented with an
 * account of the defect, and that account NAMES the wrong function — "it ran
 * runFileSync and was marked completed". A matcher reading raw text finds
 * `runFileSync` inside the task branch's own explanation and fails a correct
 * fix; #749's guard hit the mirror image, where `toContain('TRIGGER_API_URL')`
 * passed on the comment that explained the assignment while the assignment
 * itself was deleted. A comment is prose about code, never code.
 */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

/** The two files that decide which sync pass a domain gets. */
const DISPATCHERS = [
  {
    what: 'the appliance (orchestration.runOneDomain)',
    path: 'packages/orchestration/src/orchestration.ts',
    // The chain lives inside runOneDomain; bound the search to it so an
    // unrelated if/else elsewhere in a 1000-line file cannot answer for it.
    from: 'async function runOneDomain(',
    to: 'results.push(outcome);',
  },
  {
    what: 'the managed worker (run-delta-sync)',
    path: 'apps/worker/src/jobs/run-delta-sync.ts',
    from: 'for (const domain of domains) {',
    to: 'new PgMigrationStatusStore(db).markCompleted(tenantId, mappingId, domain);',
  },
] as const;

/**
 * The domains a dispatcher must be able to tell apart.
 *
 * Restated from `DISCOVERY_DOMAINS` rather than imported, and checked against
 * it below: a root-level test file cannot resolve `@openmig/*`, which is what
 * `no-workspace-imports.unit.test.ts` enforces.
 */
const DOMAINS = ['email', 'calendar', 'contact', 'file', 'task'] as const;

function chain(d: (typeof DISPATCHERS)[number]): string {
  const text = readFileSync(join(REPO_ROOT, d.path), 'utf8');
  const start = text.indexOf(d.from);
  expect(start, `${d.what}: '${d.from}' is no longer in ${d.path}`).toBeGreaterThan(-1);
  const end = text.indexOf(d.to, start);
  expect(end, `${d.what}: the end of its domain branch chain is no longer recognisable`).toBeGreaterThan(start);
  return code(text.slice(start, end));
}

describe('the domain list these dispatchers must cover is the real one', () => {
  it('matches DISCOVERY_DOMAINS in packages/shared', () => {
    // The restatement above, paired against the source as text — the same
    // technique #750 used for the e2e gates, and for the same reason.
    const shared = readFileSync(join(REPO_ROOT, 'packages/shared/src/discovery.ts'), 'utf8');
    const match = shared.match(/DISCOVERY_DOMAINS\s*=\s*\[([^\]]*)\]/);
    expect(match, 'DISCOVERY_DOMAINS is no longer recognisable in discovery.ts').not.toBeNull();
    const declared = match![1]!
      .split(',')
      .map((d) => d.trim().replace(/['"]/g, ''))
      .filter(Boolean);
    expect([...declared].sort()).toEqual([...DOMAINS].sort());
  });
});

describe.each(DISPATCHERS)('$what gives every domain its own branch', (d) => {
  it.each(DOMAINS)("tests for '%s' by name", (domain) => {
    // The whole defect, stated positively. `task` had no test of its own and
    // arrived at the file branch by falling through.
    expect(chain(d)).toMatch(new RegExp(`domain === ['"]${domain}['"]`));
  });

  it('ends by REFUSING an unknown domain, never by running one of the others', () => {
    // The property, stated exactly. A trailing `else` is not the defect — a
    // trailing else that does WORK is. `else { …runFileSync }` gave a task a
    // file pass and a markCompleted; `else { throw }` leaves the domain
    // in_progress and says why, which is what an unimplemented domain should
    // look like.
    const text = chain(d);
    const tail = text.slice(text.lastIndexOf('} else'));
    // If there is a bare `else` at all, its body must throw and nothing else.
    if (/}\s*else\s*{/.test(tail)) {
      expect(tail, 'the catch-all else must refuse, not run a pass').toContain('throw new Error');
      for (const pass of ['runFileSync', 'runCalendarSync', 'runContactSync', 'runTaskSync', 'runShadowPass']) {
        expect(tail, `the catch-all else runs ${pass} — that is the seventh fan-out`).not.toContain(pass);
      }
    }
  });

  it('the task branch runs the TASK pass, not the calendar or file one', () => {
    // Naming runTaskSync rather than "some sync": the branch existing while
    // calling runFileSync would satisfy every assertion above and reproduce
    // the defect exactly.
    const text = chain(d);
    const taskAt = text.search(/domain === ['"]task['"]/);
    expect(taskAt).toBeGreaterThan(-1);
    // From the task test to the end of its block — the next `} else` — is the
    // branch body, and runTaskSync must be the pass it calls.
    const body = text.slice(taskAt, text.indexOf('} else', taskAt) + 1 || undefined);
    expect(body).toContain('runTaskSync');
    expect(body).not.toContain('runFileSync');
    expect(body).not.toContain('runCalendarSync');
  });

  it("the task branch builds TASK deps, not the file deps it used to inherit", () => {
    const text = chain(d);
    const taskAt = text.search(/domain === ['"]task['"]/);
    const body = text.slice(taskAt, text.indexOf('} else', taskAt) + 1 || undefined);
    expect(body).toMatch(/['"]task['"]\s*\)/);
  });
});

describe('the task pass is a task pass, not the calendar one under another name', () => {
  const davSync = readFileSync(join(REPO_ROOT, 'packages/core/src/dav-sync.ts'), 'utf8');

  function wrapper(name: string): string {
    const start = davSync.indexOf(`export async function ${name}(`);
    expect(start, `${name} is gone from dav-sync.ts`).toBeGreaterThan(-1);
    const end = davSync.indexOf('\n}\n', start);
    return code(davSync.slice(start, end));
  }

  it('runTaskSync exists at all — it did not, for the whole of workplan 0113', () => {
    expect(davSync).toContain('export async function runTaskSync(');
  });

  it("files its items under the 'task' domain", () => {
    // Passing `domain: 'calendar'` here would put every to-do in the ledger as
    // a calendar item: the verification gate would then find task rows absent
    // and report SKIPPED, which is the state the owner's Spark was in.
    expect(wrapper('runTaskSync')).toMatch(/domain:\s*['"]task['"]/);
  });

  it('keys them with the todo: prefix, so a VTODO and a VEVENT cannot collide', () => {
    // naturalKeyForTask hashes `todo:<uid>`; naturalKeyForCalendar hashes
    // `cal:<uid>`. RFC 5545 lets one account hold a to-do and an event under
    // the same UID, and keying tasks with the calendar helper would make each
    // look, to the other, like an item already copied.
    const body = wrapper('runTaskSync');
    expect(body).toContain('naturalKeyForTask');
    expect(body).not.toContain('naturalKeyForCalendar');
  });

  it('each DAV wrapper files under its own domain, none sharing another’s', () => {
    const domains = ['runCalendarSync', 'runContactSync', 'runFileSync', 'runTaskSync'].map((n) => {
      const m = wrapper(n).match(/domain:\s*['"]([a-z]+)['"]/);
      expect(m, `${n} does not name a domain`).not.toBeNull();
      return m![1]!;
    });
    expect(new Set(domains).size).toBe(domains.length);
  });
});
