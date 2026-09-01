// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The checks, and the three ways a registry of them goes quietly wrong.
 *
 *  1. A QUERY THAT DOES NOT ANSWER THE RUNNER'S QUESTION. Every `find` must
 *     return the same six columns, because one runner reads all of them by
 *     name. A check aliasing `total` instead of `count` maps to `undefined`,
 *     and `undefined === 1 ? … : …` prints "NaN mappings" in a report somebody
 *     is deciding from. Nothing throws.
 *  2. A REPORT THAT PRINTS THE THING IT FOUND. Two checks are about rows
 *     holding a credential where an identifier belongs, and the value IS the
 *     finding. Printing it moves the credential out of a table and into a
 *     terminal, a scrollback, and whatever gets pasted where.
 *  3. A CLEAN THAT IS BOLDER THAN ITS CHECK. `find` decides what is worth
 *     reporting and `can` decides what may be acted on without a person, and
 *     the second must be the narrower of the two — an empty organisation is
 *     always worth a line, and only one holding nothing at all may be deleted
 *     by a script.
 *
 * The queries themselves are exercised against a real database in
 * `operator-housekeeping.integration.test.ts`: SQL that has never been run is
 * SQL nobody has checked, and a column name is not something to assert about
 * in a string.
 */

import { describe, it, expect } from 'vitest';
import {
  checkByKind,
  HOUSEKEEPING_CHECKS,
  HOUSEKEEPING_KINDS,
  notCleanableRefusal,
  unknownKindRefusal,
  type HousekeepingRow,
} from './operator-housekeeping.ts';
import { subjectRefusal } from './operator.ts';

const row = (over: Partial<HousekeepingRow> = {}): HousekeepingRow => ({
  id: '5f6f0000-e29b-41d4-a716-446655440001',
  label: 'Acme Families',
  note: '',
  count: 0,
  otherCount: 0,
  ageDays: 0,
  ...over,
});

/** The columns the runner reads, and the only ones a check may return. */
const CONTRACT = ['id', 'label', 'note', 'count', 'other_count', 'age_days'] as const;

describe('every check answers the question the runner asks', () => {
  it('there are checks at all, and their kinds are unique', () => {
    // Never vacuous: every loop below is over this list.
    expect(HOUSEKEEPING_CHECKS.length).toBeGreaterThan(3);
    expect(new Set(HOUSEKEEPING_KINDS).size).toBe(HOUSEKEEPING_CHECKS.length);
    expect(HOUSEKEEPING_KINDS).toEqual(HOUSEKEEPING_CHECKS.map((c) => c.kind));
  });

  it('returns exactly the six columns the runner reads', () => {
    for (const check of HOUSEKEEPING_CHECKS) {
      const aliases = [...check.find.matchAll(/\bAS ([a-z_]+)/g)].map((m) => m[1]!);
      expect(
        aliases.sort(),
        `${check.kind} does not return the runner's columns.\n\n` +
          'The runner reads them by name, so a missing or renamed one becomes ' +
          '`undefined`\nand prints as NaN in a report somebody is deciding from. ' +
          'Nothing throws.',
      ).toEqual([...CONTRACT].sort());
    }
  });

  it('casts its counts to int, because node-pg hands back bigint as a string', () => {
    // `'1' === 1` is false, and every plural in every describe() below turns on
    // exactly that comparison — so the singular case, the one somebody is most
    // likely to be staring at, would read "1 members" for ever.
    for (const check of HOUSEKEEPING_CHECKS) {
      const counts = [...check.find.matchAll(/count\(\*\)[\s\S]*?\)::int/g)];
      const literalZeros = check.find.includes('0 AS ');
      expect(
        counts.length > 0 || literalZeros,
        `${check.kind} counts rows without an ::int cast`,
      ).toBe(true);
    }
  });

  it('describes and remedies every row it could return', () => {
    // A `describe` that threw on a row shape its own query produces would take
    // down the whole report at the first finding.
    for (const check of HOUSEKEEPING_CHECKS) {
      for (const sample of [row(), row({ count: 1, otherCount: 1, ageDays: 1, note: 'x@y.test' })]) {
        expect(check.describe(sample).length, check.kind).toBeGreaterThan(10);
        expect(check.remedy(sample).length, check.kind).toBeGreaterThan(10);
      }
    }
  });

  it('tells you the shortcut exists where there is one', () => {
    // The remedy is the only surface that reaches somebody reading the report.
    // A cleanable finding whose remedy printed hand-written SQL would send them
    // the long way round past a command that does it.
    for (const check of HOUSEKEEPING_CHECKS) {
      if (!check.clean) continue;
      const cleanable = [row(), row({ count: 0, otherCount: 0 })].filter(
        (r) => check.clean!.can(r) === null,
      );
      for (const r of cleanable) {
        expect(check.remedy(r), `${check.kind}'s remedy never names \`clean\``).toContain(
          `operator.sh clean ${check.kind}`,
        );
      }
    }
  });
});

/**
 * NOTHING PRINTS A CREDENTIAL, and the check for it cannot be "we were careful".
 *
 * `platform_operator` held a nine-hundred-character ID token on 2026-08-31,
 * because the arguments shifted by one and nothing refused it. The row is now
 * refused at the moment of writing and FOUND here — and a finder that printed
 * what it found would take a credential out of a table, which is at least
 * access-controlled, and put it in a terminal, a scrollback, and whatever the
 * operator pastes into a chat window while asking what to do about it.
 */
describe('a report that never prints what it found', () => {
  const TOKEN = `eyJhbGciOiJSUzI1NiJ9.${'A'.repeat(600)}.c2ln`;

  it('says nothing about the value, for either operator check', () => {
    for (const kind of ['credential-at-rest', 'operator-that-matches-nobody'] as const) {
      const check = checkByKind(kind)!;
      // The runner passes whatever the query returned. These two queries return
      // `(not printed)` for the label deliberately — but describe() must be safe
      // even if that ever changes, because it is the last thing before stdout.
      const finding = row({ id: TOKEN, label: TOKEN, note: TOKEN, count: TOKEN.length });
      for (const text of [check.describe(finding), check.remedy(finding)]) {
        expect(text, `${kind} printed the value it found`).not.toContain(TOKEN);
        expect(text, `${kind} printed part of the value it found`).not.toContain('A'.repeat(20));
      }
    }
  });

  it('says enough to be actionable without saying it', () => {
    // A refusal that only says "something is wrong" is not worth the row.
    const check = checkByKind('credential-at-rest')!;
    const line = check.describe(row({ count: 912, ageDays: 3 }));
    expect(line).toContain('912 characters');
    expect(line).toContain('3 days ago');
    expect(check.remedy(row())).toContain('operator.sh clean credential-at-rest --confirm');
  });
});

/**
 * WHAT MAY BE DONE WITHOUT ASKING, which is the whole of `clean`'s licence.
 */
describe('cleaning is narrower than reporting', () => {
  it('will not delete an organisation that holds anything', () => {
    // Deleting a tenant cascades roughly twenty-five tables, invoices among
    // them — and invoices are kept for tax retention and are refused an UPDATE
    // by the database itself once issued. The check reports every empty
    // organisation; only one holding nothing at all may go.
    const check = checkByKind('empty-tenant')!;
    expect(check.clean!.can(row({ count: 0, otherCount: 0 }))).toBeNull();
    expect(check.clean!.can(row({ count: 4, otherCount: 0 }))).toContain('4 mappings/connections');
    expect(check.clean!.can(row({ count: 0, otherCount: 2 }))).toContain('2 invoices');
    expect(check.clean!.can(row({ count: 1, otherCount: 1 }))).toContain('cascade');
  });

  it('offers the way back in rather than the delete, when it holds work', () => {
    const check = checkByKind('empty-tenant')!;
    const holding = check.remedy(row({ count: 3 }));
    expect(holding).toContain('INSERT INTO tenant_member');
    expect(holding, 'never offers a delete for an organisation with work in it').not.toContain(
      'clean empty-tenant',
    );
  });

  it('refuses to pick an administrator for somebody else', () => {
    // The most consequential report here, and deliberately not automatic:
    // choosing who owns a customer's organisation is a decision with a person's
    // name on it.
    const check = checkByKind('ownerless-tenant')!;
    expect(check.clean).toBeNull();
    const refusal = notCleanableRefusal(check);
    expect(refusal).toContain('`ownerless-tenant` is reported, never cleaned automatically');
    expect(refusal, 'and says what to run instead').toContain(
      'operator.sh check ownerless-tenant',
    );
  });

  it('names the candidate to promote, and says so when there is none', () => {
    const check = checkByKind('ownerless-tenant')!;
    expect(check.remedy(row({ note: 'someone@acme.test' }))).toContain(
      "UPDATE tenant_member SET role = 'owner'",
    );
    expect(check.remedy(row({ note: 'someone@acme.test' }))).toContain("'someone@acme.test'");
    // No active member means no `UPDATE` that would work — and emitting one
    // anyway is worse than saying so, because it looks like a remedy.
    const none = check.remedy(row({ note: '' }));
    expect(none).not.toContain('UPDATE tenant_member');
    expect(none).toContain('nobody to promote');
  });

  it("escapes an address, because somebody's really does have a quote in it", () => {
    const check = checkByKind('ownerless-tenant')!;
    expect(check.remedy(row({ note: "o'brien@acme.test" }))).toContain("'o''brien@acme.test'");
  });

  it('declares tenant scoping to match what its statement keys on', () => {
    // Every table here carries FORCE ROW LEVEL SECURITY whose policies read
    // `app.current_tenant`. Setting it to a member's uuid, or to an operator's
    // subject, would be wrong in a way that works on any stack whose owner
    // bypasses RLS and fails on the one that does not.
    for (const check of HOUSEKEEPING_CHECKS) {
      if (!check.clean) continue;
      const targetsOperator = /\bplatform_operator\b/.test(check.clean.sql);
      expect(check.clean.tenantScoped, `${check.kind}`).toBe(!targetsOperator);
    }
  });

  it('acts on one row by id, never on a set', () => {
    // A statement without `$1` would clean everything the check found the
    // moment one row passed `can`, including the rows that did not.
    for (const check of HOUSEKEEPING_CHECKS) {
      if (!check.clean) continue;
      expect(check.clean.sql, `${check.kind} does not key on $1`).toContain('$1');
    }
  });
});

/**
 * TWO READINGS OF ONE RULE, and this is the pair that has to agree.
 *
 * `subjectRefusal` runs in TypeScript over one value somebody is about to
 * write. The `operator-that-matches-nobody` query runs in Postgres over every
 * row that is already there. Neither can do the other's job — and if the query
 * is the narrower of the two, a row the writer refuses to create is a row that
 * exists historically and can never be found.
 *
 * Which is not hypothetical: `[^.]+` in the SQL let `eyJx..b` through while
 * `subjectRefusal` refused it, and that gap is precisely the set of rows a
 * cleanup check exists for. Found by writing this.
 *
 * The predicate is BUILT FROM THE SQL rather than restated, so the two cannot
 * drift apart without this failing.
 */
describe('the query finds every shape the writer refuses', () => {
  const find = checkByKind('operator-that-matches-nobody')!.find;

  const sqlSaysNotASubject = (() => {
    const pattern = /~ '(?<re>[^']+)'/.exec(find)?.groups?.re;
    const max = /length\([^)]+\) > (?<n>\d+)/.exec(find)?.groups?.n;
    const literal = /user_id = '(?<lit>[^']+)'/.exec(find)?.groups?.lit;
    expect(pattern, 'the token-shape regex is gone from the query').toBeDefined();
    expect(max, 'the length bound is gone from the query').toBeDefined();
    expect(literal, 'the argument-separator case is gone from the query').toBeDefined();
    // Postgres reads `\\.` in a single-quoted string as `\.`; JavaScript's own
    // escaping of the source literal has already collapsed it by the time it
    // reaches here, so this is the pattern the database actually compiles.
    const re = new RegExp(pattern!);
    return (value: string): boolean =>
      value === literal || value.length > Number(max) || re.test(value);
  })();

  const EXAMPLES = [
    // Refused by both.
    '--',
    'x'.repeat(201),
    'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln',
    'eyJx..b',
    'eyJx.a.',
    // Accepted by both — real subjects, and the half that matters most.
    '387847603254984715',
    'e29b41d4-a716-446655440000',
    'auth0|5f8a2b1c9d',
    'user.name@issuer',
    'a'.repeat(200),
    'eyJustsomething',
    'eyJx.a.b.c',
    'seed:demo-owner-a',
    'pending:038fc2a8-c534-4265-a78b-64342df08efe',
  ];

  it('agrees with subjectRefusal on every one of them', () => {
    for (const value of EXAMPLES) {
      expect(
        sqlSaysNotASubject(value),
        `the query and subjectRefusal disagree about \`${value.slice(0, 40)}\`.\n\n` +
          'If the QUERY is narrower, a row the writer refuses to create can exist ' +
          'and\nnever be found. If it is wider, the check reports a real operator ' +
          'as\nsomething to delete.',
      ).toBe(subjectRefusal(value) !== null);
    }
  });

  it('the examples cover both answers, so agreement is not vacuous', () => {
    const refused = EXAMPLES.filter((v) => subjectRefusal(v) !== null);
    expect(refused.length).toBeGreaterThan(3);
    expect(EXAMPLES.length - refused.length).toBeGreaterThan(3);
  });
});

describe('a kind that does not exist', () => {
  it('lists the ones that do', () => {
    // Same class of mistake as a typo in the sub-command, same answer.
    const refusal = unknownKindRefusal('emtpy-tenant');
    expect(refusal).toContain('there is no check called `emtpy-tenant`');
    for (const kind of HOUSEKEEPING_KINDS) expect(refusal).toContain(kind);
  });

  it('checkByKind answers null rather than throwing', () => {
    expect(checkByKind('nope')).toBeNull();
    expect(checkByKind('empty-tenant')?.kind).toBe('empty-tenant');
  });
});
