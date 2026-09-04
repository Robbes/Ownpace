// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PROVIDER ACCOUNT KIND CAN BE DECLARED AND HAVE NOWHERE TO BE STORED.
 *
 * Workplan 0115 T2. 0114 spent a night discovering that a connection kind is
 * not one row — `microsoft` needed rows in fourteen more tables, and **not one
 * of them was found by reading.** Every one was a red test.
 *
 * So 0115 added `apple` to `PROVIDER_ACCOUNT_KINDS` expecting the same
 * treatment, and **the entire suite stayed green.** Nineteen files name
 * `microsoft` as a kind; `apple` was in two of them.
 *
 * ## Why the guards 0114 left behind said nothing
 *
 * They pair the kind against the CONSENT machinery — `GRANT_PROVIDERS`, the
 * deployment-client probes, the `consent:` descriptors, the web's zod schema.
 * Apple has no consent screen for its data (Apple publishes no OAuth scope for
 * Mail, Calendar, Contacts, Reminders or iCloud Drive to anybody outside
 * Apple), so it is correctly absent from every one of them, and every one of
 * those guards is correctly silent.
 *
 * **The tables it must be in are the ones that have nothing to do with
 * consent**, and no guard paired against those, because for `google`,
 * `soverin` and `microsoft` the two sets happened to overlap. `soverin` is the
 * proof they need not: it has no consent either, and it was added by hand,
 * correctly, by somebody who happened to remember.
 *
 * ## What this holds
 *
 * Every `ProviderAccountKind` appears in the four places a kind must reach
 * before a person can have one at all:
 *
 *   1. the ledger's `connection.kind` enum — **or the row cannot be inserted**
 *   2. the credential descriptors — or the form asks for nothing
 *   3. the front door — or nobody can pick it
 *
 * Each of those three fails DIFFERENTLY and none of them fails at compile time,
 * which is the whole reason this file exists rather than a type.
 *
 * ## What it deliberately does NOT hold
 *
 * It says nothing about consent, scopes or deployment clients: those are
 * `a-consent-nobody-can-answer` and `a-consent-that-asks-for-a-different-scope`,
 * and a kind without a consent must not be dragged into them. It also does not
 * check the FACE table — `a-face-a-provider-account-cannot-build` owns that,
 * and owns it in both directions.
 *
 * **And it does NOT require a `SourceConfig` union member.** The first draft
 * did, on the reasoning that a kind with no shape cannot be built — and
 * `soverin` failed it, correctly and instructively. A kind needs
 * `<Kind>AccountSource` only when its faces resolve to PROVIDER-API builders,
 * as `google` and `microsoft` do; a kind whose faces are PROTOCOL builders
 * stores a protocol-shaped config and needs no member at all. `apple` is the
 * second of those. A guard demanding a type that should not exist is worse
 * than no guard, because somebody will write the type to make it quiet.
 *
 * Read as TEXT: this file is at the repository root, where workspace imports do
 * not resolve, and four of the five files it reads live in three packages.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The file with its comments removed.
 *
 * SIXTH time (#749, #752, 0114 T4, T5a, T5b). Every one of these files
 * explains its rows in prose that names other providers — `provider-accounts.ts`
 * contrasts Apple's absent file face with Google's absent mail face by name —
 * and a matcher reading raw text reports agreement that is not there.
 */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

const read = (p: string) => code(readFileSync(join(REPO_ROOT, p), 'utf8'));

const ACCOUNTS = 'packages/shared/src/provider-accounts.ts';
const LEDGER = 'packages/ledger/src/schema-pg.ts';
const FIELDS = 'packages/shared/src/credential-fields.ts';
const FRONT_DOOR = 'packages/shared/src/front-door.ts';

/** The kinds that claim to be provider accounts. */
function accountKinds(): string[] {
  const text = read(ACCOUNTS);
  const list = /PROVIDER_ACCOUNT_KINDS\s*=\s*\[([^\]]*)\]/.exec(text);
  expect(
    list?.[1],
    `${ACCOUNTS} no longer declares PROVIDER_ACCOUNT_KINDS as a literal array — this guard ` +
      'reads it as text, so it must stay one (or this guard must change)',
  ).toBeDefined();
  return [...(list?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
}

/**
 * The kinds a `connection` row may actually carry.
 *
 * The FIRST thing that fails, and the least visible: a kind absent here is
 * refused by the database on insert, which reaches the person as a failed
 * save on a form that validated fine.
 */
function ledgerKinds(): string[] {
  const text = read(LEDGER);
  const start = text.indexOf("kind: text('kind'");
  expect(start, `${LEDGER} no longer declares connection.kind as a text enum`).toBeGreaterThan(-1);
  const body = text.slice(start, text.indexOf('}).notNull()', start));
  return [...body.matchAll(/'([a-z_0-9-]+)'/g)].map((m) => m[1]!);
}

/** The kinds `FRONT_DOOR_GROUPS` classifies — the map that decides what appears. */
function frontDoorGroupKeys(): Set<string> {
  const text = read(FRONT_DOOR);
  const start = text.indexOf('FRONT_DOOR_GROUPS');
  expect(start, `${FRONT_DOOR} no longer declares FRONT_DOOR_GROUPS`).toBeGreaterThan(-1);
  const body = text.slice(start, text.indexOf('\n};', start));
  return new Set([...body.matchAll(/^\s{2}'?([a-z_0-9-]+)'?:\s*'/gm)].map((m) => m[1]!));
}

/**
 * The kinds SOME door asks for something — either side.
 *
 * Both sides, because a provider account is not necessarily both: `soverin` is
 * a TARGET (an EU provider people migrate onto) and lives in `TARGET_TYPES`;
 * `apple` is a SOURCE (nobody migrates onto iCloud through this product) and
 * lives in `SOURCE_FIELDS`. The first version of this reader asked only about
 * sources and reported `soverin` missing, which is the second false positive
 * this one guard produced — the question worth asking is whether a person can
 * fill the kind in ANYWHERE, not on a side it was never meant to appear on.
 */
function fillableKinds(): Set<string> {
  const text = read(FIELDS);
  const sourceStart = text.indexOf('SOURCE_FIELDS');
  expect(sourceStart, `${FIELDS} no longer declares SOURCE_FIELDS`).toBeGreaterThan(-1);
  const sources = text.slice(sourceStart, text.indexOf('\n};', sourceStart));
  const targets = /TARGET_TYPES\s*=\s*\[([^\]]*)\]/.exec(text);
  return new Set([
    ...[...sources.matchAll(/^\s{2}'?([a-z_0-9-]+)'?:\s*[[a-zA-Z]/gm)].map((m) => m[1]!),
    ...[...(targets?.[1] ?? '').matchAll(/'([a-z_0-9-]+)'/g)].map((m) => m[1]!),
  ]);
}

describe('a provider account kind reaches every table it has to', () => {
  it('finds kinds at all — this guard is not passing vacuously', () => {
    // The control. An empty list agrees with everything.
    expect(accountKinds().length, `${ACCOUNTS} names no provider account kinds`).toBeGreaterThan(2);
    expect(ledgerKinds().length, `${LEDGER} names no connection kinds`).toBeGreaterThan(2);
    expect(
      frontDoorGroupKeys().size,
      `${FRONT_DOOR} classifies no kinds`,
    ).toBeGreaterThan(2);
    expect(fillableKinds().size, `${FIELDS} asks for nothing on either door`).toBeGreaterThan(2);
  });

  it('can be stored: every account kind is in the ledger enum', () => {
    const stored = new Set(ledgerKinds());
    const homeless = accountKinds().filter((k) => !stored.has(k)).sort();
    expect(
      homeless,
      'a kind is offered as a provider account and the `connection` table will refuse the ' +
        'row: drizzle declares `kind` as a text enum, so the insert fails at the database ' +
        'and reaches the person as a save that did not work on a form that validated. ' +
        `Add the kind in ${LEDGER} AND a migration that widens the column`,
    ).toEqual([]);
  });

  it('can be filled in: every account kind has credential descriptors', () => {
    // `SOURCE_FIELDS`'s keys, not a search for a quoted name — the same
    // correction the front-door reader needed, and for the same reason: the
    // map keys a kind bare whenever the name is a valid identifier.
    const unasked = accountKinds()
      .filter((k) => !fillableKinds().has(k))
      .sort();
    expect(
      unasked,
      'a provider account kind that no credential descriptor names on EITHER door: the form ' +
        'is drawn with no fields in it, and there is nothing to refuse. Add its fields in ' +
        `${FIELDS} — SOURCE_FIELDS to migrate off it, TARGET_TYPES to migrate onto it`,
    ).toEqual([]);
  });

  it('can be chosen: every account kind is on the front door', () => {
    // Read the CLASSIFICATION MAP's keys rather than searching the file for a
    // quoted name. The first version of this matcher did the latter and
    // reported `soverin` missing when it is on line 57 — the map keys a kind
    // bare (`soverin:`) whenever the name is a valid identifier, and quotes it
    // only when it is not (`'google-calendar':`). A guard that cries wolf gets
    // weakened, so it asks the question it means: is this kind classified?
    const unofferable = accountKinds()
      .filter((k) => !frontDoorGroupKeys().has(k))
      .sort();
    expect(
      unofferable,
      'a provider account kind nobody can pick: it is not a member of any front-door family ' +
        'and has no icon, so the card never appears and every other row it was added to is ' +
        `dead code. Add it in ${FRONT_DOOR}`,
    ).toEqual([]);
  });
});
