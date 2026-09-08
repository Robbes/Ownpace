// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * EVERY DOMAIN'S PASS CARRIES THE DEADLINE, OR NONE OF THEM DOES (2026-09-08).
 *
 * Five wrappers stand between a job and `runDomainSync` — mail in
 * `reconcile.ts`, calendar, task, contact and file in `dav-sync.ts` — and
 * each is a hand-written argument list. A deadline forwarded by four of them
 * is worse than one forwarded by none: the job would report a clean stop
 * while the fifth domain ran on until its runner killed it, and the mapping
 * it belongs to would be the one that silently stops syncing.
 *
 * This repository has paid for that shape repeatedly, always the same way — a
 * bare `else` that ran the file pass for tasks (0113), a dispatcher that
 * forgot a domain (`a-domain-the-dispatchers-forgot`), a table and a switch
 * that agreed by hand until a provider was added to one. The remedy each
 * time is a guard that reads the call sites rather than a reviewer who
 * remembers them.
 *
 * READ AS TEXT, not imported and driven. Driving all five would need a fake
 * source, target, ledger and cursor store per domain — four times the
 * scaffolding of the thing under test, and scaffolding that would itself have
 * to be kept in step with five signatures. What the deadline DOES is proved
 * behaviourally next door in
 * `a-pass-that-stops-halfway-keeps-its-cursor.unit.test.ts`; what this asks is
 * narrower and exactly what a text read can answer: does every call forward
 * it at all.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The files holding a `runDomainSync` call, and how many each should hold. */
const CALLERS = [
  { file: 'dav-sync.ts', calls: 4, domains: 'calendar, task, contact and file' },
  { file: 'reconcile.ts', calls: 1, domains: 'mail' },
] as const;

function source(file: string): string {
  return readFileSync(join(HERE, file), 'utf8');
}

/**
 * The argument object of each `runDomainSync(...)` call, by bracket depth —
 * a regex cannot balance braces, and the calls nest object literals several
 * deep.
 */
function callArguments(text: string): string[] {
  const out: string[] = [];
  // A CALL, not every mention: both files also IMPORT the name, and the first
  // draft of this guard took the import's next `(` — hundreds of lines away —
  // as its argument list. Optional generics come between the name and the
  // parenthesis (`runDomainSync<Source, Target, …>({…})`), so they are matched
  // rather than skipped over.
  const call = /runDomainSync\s*(?:<[^(]*>\s*)?\(/g;
  for (;;) {
    const found = call.exec(text);
    if (!found) return out;
    const open = found.index + found[0].length - 1;
    let depth = 0;
    let i = open;
    for (; i < text.length; i++) {
      if (text[i] === '(') depth += 1;
      else if (text[i] === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    out.push(text.slice(open, i + 1));
    call.lastIndex = i + 1;
  }
}

describe('every pass forwards the deadline it was given', () => {
  for (const { file, calls, domains } of CALLERS) {
    it(`${file} calls runDomainSync ${calls}× (${domains}) and every call forwards the clock`, () => {
      const args = callArguments(source(file));

      // A vacuity floor first: if the reader ever stops finding the calls,
      // every assertion below would pass having checked nothing — the same
      // reason the README domain guard refuses a count below two.
      expect(args.length).toBe(calls);

      for (const [i, arg] of args.entries()) {
        expect(
          arg.includes('passClock('),
          `${file}: the runDomainSync call at index ${i} does not spread passClock(...). ` +
            'A domain that does not forward its deadline runs until its runner kills it, ' +
            'and the job cannot tell that apart from a domain that finished.',
        ).toBe(true);
      }
    });
  }

  it('forwards through the ONE helper, so half a clock cannot be forwarded', () => {
    // `deadline` without `now`, or the reverse, is the failure a hand-written
    // pair invites and the helper makes unspellable. Naming the fields
    // directly at a call site is therefore the thing to refuse.
    for (const { file } of CALLERS) {
      for (const arg of callArguments(source(file))) {
        expect(
          /(^|[^.\w])deadline\s*:/.test(arg),
          `${file}: a runDomainSync call names \`deadline:\` itself instead of spreading ` +
            'passClock(deps). Forward both fields together or neither.',
        ).toBe(false);
      }
    }
  });
});
