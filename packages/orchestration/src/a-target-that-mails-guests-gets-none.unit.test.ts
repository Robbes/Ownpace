// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A TARGET THAT MAILS GUESTS GETS NONE, IN BOTH EDITIONS (workplan 0160).
 *
 * Cirrux mailed invitations on 2026-11-19 for events whose every attendee
 * carried `SCHEDULE-AGENT=CLIENT`. The writer can drop the guests
 * (`mailsGuests`), but only a deps builder knows the target's kind. Every
 * calendar and task writer either builder makes is therefore built with the
 * kind's answer, and this guard fails the day one of them is built without.
 */

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { mailsGuestsItself } from '@openmig/shared';
import { buildCalendarTarget, buildTaskTarget } from './dav-factories.ts';

const BUILDERS: ReadonlyArray<{ file: string; kind: string }> = [
  { file: 'build-deps-from-mapping.ts', kind: 'tgt.kind' },
  { file: 'build-deps.ts', kind: 'targetConfig.type' },
];

/** The argument text of every call to `name(` in `source`, parentheses balanced. */
function callsOf(source: string, name: string): string[] {
  const calls: string[] = [];
  let from = 0;
  for (;;) {
    const at = source.indexOf(`${name}(`, from);
    if (at === -1) return calls;
    let depth = 0;
    let end = at + name.length;
    for (; end < source.length; end += 1) {
      if (source[end] === '(') depth += 1;
      else if (source[end] === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    calls.push(source.slice(at, end + 1));
    from = end + 1;
  }
}

describe('every calendar and task writer is told whether its target mails guests', () => {
  for (const { file, kind } of BUILDERS) {
    const source = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
    for (const name of ['buildCalendarTarget', 'buildTaskTarget']) {
      it(`${file}: ${name} passes mailsGuestsItself(${kind})`, () => {
        const calls = callsOf(source, name);
        expect(calls.length, `no ${name} call in ${file}`).toBeGreaterThan(0);
        for (const call of calls) {
          expect(call).toContain(`mailsGuests: mailsGuestsItself(${kind})`);
        }
      });
    }
  }
});

describe('every scheduling verdict is told the kind, so a target that mails guests is said to be one', () => {
  // The sentence a person reads at the connection test, in the assessment and
  // in the audit row once promised "migrating sends no invitations" from the
  // marker alone. For a kind that mails guests it now says what the writer
  // does instead, and only if the kind reaches it.
  const CALLERS: ReadonlyArray<{ file: string; name: string; kind: string }> = [
    { file: 'build-deps-from-mapping.ts', name: 'schedulingRecorder', kind: 'tgt.kind' },
    { file: 'build-deps.ts', name: 'schedulingRecorder', kind: 'targetConfig.type' },
    { file: 'target-scheduling.ts', name: 'measureTargetScheduling', kind: 'kind' },
    { file: 'probe-connection.ts', name: 'measureTargetScheduling', kind: 'targetType' },
    { file: 'account-qualification.ts', name: 'measureTargetScheduling', kind: 'kind' },
    { file: '../../../apps/api/src/routes/permissions.ts', name: 'measureTargetScheduling', kind: 'target.kind' },
    { file: '../../../apps/selfhost/src/index.ts', name: 'measureTargetScheduling', kind: 'davTarget.type' },
  ];
  for (const { file, name, kind } of CALLERS) {
    it(`${file}: ${name} is handed ${kind}`, () => {
      const source = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
      // A call, not the declaration: the declaration is followed by a
      // parameter list with types in it.
      const calls = callsOf(source, name).filter((call) => !/^\w+\(\s*\n?\s*url: string/.test(call));
      expect(calls.length, `no ${name} call in ${file}`).toBeGreaterThan(0);
      for (const call of calls) {
        expect(call.replace(/\s+/g, ' ')).toMatch(new RegExp(`[,(] ?${kind.replace(/\./g, '\\.')},? ?\\)$`));
      }
    });
  }
});

describe('the factories hand the answer to the writer', () => {
  const endpoint = { url: 'https://dav.example.org/', username: 'u', password: 'p' };
  const deps = { ledger: {} as never, tenantId: 't' as never, mappingId: 'm' as never };
  const configOf = (writer: unknown) => (writer as { config: { mailsGuests?: boolean } }).config;

  it('for Cirrux, both writers drop guests', () => {
    const options = { mailsGuests: mailsGuestsItself('cirrux') };
    expect(configOf(buildCalendarTarget(endpoint, deps, options)).mailsGuests).toBe(true);
    expect(configOf(buildTaskTarget(endpoint, deps, options)).mailsGuests).toBe(true);
  });

  it('for Infomaniak too, until a pass shows it sends nothing (workplan 0161)', () => {
    const options = { mailsGuests: mailsGuestsItself('infomaniak') };
    expect(configOf(buildCalendarTarget(endpoint, deps, options)).mailsGuests).toBe(true);
    expect(configOf(buildTaskTarget(endpoint, deps, options)).mailsGuests).toBe(true);
  });

  it('for any other target, and when nothing is said, they keep guests as before', () => {
    const options = { mailsGuests: mailsGuestsItself('nextcloud') };
    expect(configOf(buildCalendarTarget(endpoint, deps, options)).mailsGuests).toBeUndefined();
    expect(configOf(buildTaskTarget(endpoint, deps)).mailsGuests).toBeUndefined();
  });
});
