// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A TARGET SECRET A DOOR BUILT BY HAND (workplan 0161 T1).
 *
 * Until 0161 every door that stored or tested a destination's credential
 * built it in place, as `{ username: …, password: … }`: the add door and the
 * rotation in `apps/api/src/routes/connections.ts`, the Test and the create in
 * `apps/api/src/routes/migrations/index.ts`. That was the whole record while
 * every destination signed in with one login. Infomaniak does not: its
 * calendars, contacts and tasks sign in with the account's sync login and its
 * mail with the mailbox's own, because an app password "ne permettra pas de
 * synchroniser une adresse mail" (https://www.infomaniak.com/fr/support/faq/2855).
 * Its one secret holds both, and a door that builds the pair by hand stores
 * the sync login and drops the mailbox's on its way to the store.
 *
 * Nothing goes red at that door. The row saves, Test passes on the calendar,
 * and the mail of the first pass is refused, by a seam that reads the record
 * correctly and finds no mail login in it. So the record is built in one
 * place, `targetCredentialRecord` in `packages/shared/src/provider-accounts.ts`,
 * and this guard holds the doors to it:
 *
 *  - no object property in either file reads a typed target login by hand:
 *    `username: …values.username`, `password: …targetConfig.password` and the
 *    like are the shape that dropped the second login;
 *  - no credential is encrypted, or handed to a target probe, as an object
 *    literal written in place;
 *  - each of the four doors does build through `targetCredentialRecord`, so a
 *    door rewritten without it fails here, not at a pass.
 *
 * Read as TEXT, with comments removed: this guard is at the repository root,
 * where workspace imports do not resolve, and the two files explain their old
 * shapes in comments that a matcher would otherwise read as code.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The file with its comments removed. */
function code(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

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
    calls.push(source.slice(at + name.length + 1, end));
    from = end + 1;
  }
}

/** The arguments of a call, split at its top-level commas. */
function argumentsOf(call: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < call.length; i += 1) {
    const c = call[i];
    if (c === '(' || c === '{' || c === '[') depth += 1;
    else if (c === ')' || c === '}' || c === ']') depth -= 1;
    else if (c === ',' && depth === 0) {
      out.push(call.slice(start, i).trim());
      start = i + 1;
    }
  }
  const last = call.slice(start).trim();
  if (last !== '') out.push(last);
  return out;
}

/** The doors, and how many of them build a target's record in each file. */
const DOORS: ReadonlyArray<{ readonly file: string; readonly doors: number; readonly what: string }> = [
  { file: 'apps/api/src/routes/migrations/index.ts', doors: 2, what: 'the Test route and the create route' },
  { file: 'apps/api/src/routes/connections.ts', doors: 2, what: 'the add door and Replace credentials' },
];

/**
 * A property that reads a typed login straight off a door's input: the shape
 * every door wrote before 0161. A login read for anything else (a display
 * name, a mailbox's address) is not a property named `username`/`password`.
 */
const HAND_BUILT = /\b(username|password)\s*:\s*[^,}\n]*\b(?:targetConfig|values)\.(?:username|password)\b/g;

describe('a target secret is built in one place, never by hand at a door', () => {
  for (const { file, doors, what } of DOORS) {
    const text = code(file);

    it(`${file}: no property reads a typed target login by hand`, () => {
      const found = [...text.matchAll(HAND_BUILT)].map((m) => m[0]);
      expect(
        found,
        `${file} builds a target's credential by hand. Build it with targetCredentialRecord(kind, values), ` +
          'which keeps the mailbox login a kind such as infomaniak stores beside its sync login; a pair ' +
          'written in place drops it, and the first pass’s mail is refused.',
      ).toEqual([]);
    });

    it(`${file}: no credential is encrypted, or handed to a target probe, as a literal written in place`, () => {
      for (const call of callsOf(text, 'encryptCredentials')) {
        expect(call.trim().startsWith('{'), `encryptCredentials(${call.slice(0, 60)}…)`).toBe(false);
      }
      for (const call of callsOf(text, 'probeTargetConnection')) {
        const creds = argumentsOf(call)[2] ?? '';
        expect(creds, `probeTargetConnection(${call.replace(/\s+/g, ' ').slice(0, 80)}…)`).not.toBe('');
        expect(creds.startsWith('{'), `a probe handed ${creds.slice(0, 60)}`).toBe(false);
      }
    });

    it(`${file}: ${what} build through targetCredentialRecord`, () => {
      expect(callsOf(text, 'targetCredentialRecord')).toHaveLength(doors);
    });
  }

  it('apps/api/src/routes/permissions.ts: the assessment hands the qualification the target’s record', () => {
    // Not a door, and the same drop (0161 T1): the assessment measured a
    // target by handing `qualifyAccount` a `{ username, password }` written in
    // place, which for a kind that signs in to mail apart would report its
    // mail as never set up. It measures only DAV kinds today; this holds it to
    // the one record for the day it measures an account kind.
    const text = code('apps/api/src/routes/permissions.ts');
    const calls = callsOf(text, 'qualifyAccount');
    expect(calls.length, 'the assessment no longer qualifies a target here').toBeGreaterThan(0);
    for (const call of calls) {
      const creds = argumentsOf(call)[2] ?? '';
      expect(creds, `qualifyAccount(${call.replace(/\s+/g, ' ').slice(0, 80)}…)`).toMatch(/^targetCredentialRecord\(/);
    }
  });

  it('reads files that have the doors in them: the vacuity floor', () => {
    // Without this, a renamed file or a parse that found nothing would make
    // every check above trivially true.
    for (const { file } of DOORS) {
      const text = code(file);
      expect(callsOf(text, 'probeTargetConnection').length, file).toBeGreaterThan(0);
      expect(text, file).toContain('SecretStore.encryptCredentials(');
    }
  });

  it('the pattern catches the shape it exists for', () => {
    // The four lines the doors held on 2026-11-19, before 0161.
    for (const line of [
      "{ username: values.username ?? '', password: values.password ?? '' }",
      '{ username: body.targetConfig.username, password: body.targetConfig.password }',
    ]) {
      expect([...line.matchAll(HAND_BUILT)].length, line).toBeGreaterThan(0);
    }
    // And not the lines that legitimately name a username: the account a
    // migration page shows, and the config a JMAP target stores.
    for (const line of ['username: usernameFor(targetConn),', "username: str(cfg.user) ?? str(cfg.mailbox),"]) {
      expect([...line.matchAll(HAND_BUILT)], line).toEqual([]);
    }
  });
});
