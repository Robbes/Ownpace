// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN ADDRESS CHANGE THAT REACHED MAIL (workplan 0168 T3, D1; ADR-0055).
 *
 * Mail is copied byte for byte (`ensureMessageId`, `contentHash`). Rewriting
 * an address in it would break every DKIM signature over its headers, change
 * the generated Message-ID of a message that has none (so the next pass would
 * copy it again, against hard rule 1), and falsify the archive. So the
 * address change never reaches the mail path: no file on it, and no file it
 * imports by a relative path, names the module or what it exports.
 *
 * A package's index is not followed: `@openmig/shared` exports everything,
 * the change included, and importing the index for `contentHash` is not
 * applying a change. What a file takes from an index is named in its own
 * import, and that is what is read.
 *
 * Mail runs on the loop every data type shares (`runDomainSync`), which takes
 * the change through two hooks and records its digest. So the hooks are read
 * too, on every file the mail path reaches save that loop, and both
 * dispatchers are read where they hand a pass its table: to contacts,
 * calendars and tasks, never to mail or files (the data-path review's N6).
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../../..');

/** Where mail is read, keyed, hashed and written. */
const MAIL_PATH = [
  'packages/core/src/reconcile.ts',
  'packages/connectors/src/imapflow-source.ts',
  'packages/connectors/src/graph-mail-source.ts',
  'packages/connectors/src/mail-source-with-graph-fallback.ts',
  'packages/connectors/src/imapflow-dav-target.ts',
  'packages/connectors/src/jmap-target.ts',
  'packages/shared/src/generated-message-id.ts',
  'packages/shared/src/hash.ts',
];

/**
 * The change, its table, and what carries the table to a pass. Not the
 * predicates over a copy's recorded columns (`guardsAnAddressRewrite`), which
 * the shared loop asks of a rewrite its hooks asked for.
 */
const NAMES =
  /\b(applyAddressChanges|prepareAddressTable|addressTableDigest|addressTableDigestInput|addressTablePressDigest|ConfirmedAddressChange|AddressTable|AddressTableRefused|AddressChangesForPass|addressChangesForPass|addressHooks|addressTableTag|cursorsUnderTheTable)\b|address-changes(-for-pass)?(\.ts)?['"]/;

/** The hooks the shared loop takes the change through, what it records, and the deps field that brings it. */
const HOOKS = /\b(addressDigestNow|addressRewritePastCutover|addressDigest|addressDigestDue|addressChanges)\b/;

/** The loop every data type shares: it takes the hooks; nothing on the mail path hands them to it. */
const SHARED_LOOP = 'packages/core/src/domain-sync.ts';

const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

/** The text from one marker to the next, both found, in order. */
function between(text: string, from: string, to: string): string {
  const start = text.indexOf(from);
  const end = text.indexOf(to, start + from.length);
  expect(start, from).toBeGreaterThanOrEqual(0);
  expect(end, to).toBeGreaterThan(start);
  return text.slice(start, end);
}

/** Each file the mail path reaches by relative imports, the mail path included. */
function reached(): string[] {
  const seen = new Set<string>();
  const queue = MAIL_PATH.map((p) => join(ROOT, p));
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const target = resolve(dirname(file), m[1]!);
      if (existsSync(target) && target.endsWith('.ts')) queue.push(target);
    }
  }
  return [...seen];
}

describe('the mail path', () => {
  it('exists where this guard looks for it', () => {
    for (const p of MAIL_PATH) expect(existsSync(join(ROOT, p)), p).toBe(true);
  });

  it('never names the address change, in any file it reaches', () => {
    const files = reached();
    expect(files.length).toBeGreaterThan(MAIL_PATH.length);
    const offenders = files.filter((f) => NAMES.test(readFileSync(f, 'utf8'))).map((f) => relative(ROOT, f));
    expect(offenders).toEqual([]);
  });

  it('never hands the shared loop the change’s hooks, in any file it reaches save the loop itself', () => {
    const files = reached().map((f) => relative(ROOT, f));
    expect(files).toContain(SHARED_LOOP);
    const offenders = files.filter((f) => f !== SHARED_LOOP && HOOKS.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it('would see it if it did', () => {
    expect(NAMES.test("import { applyAddressChanges } from '@openmig/shared';")).toBe(true);
    expect(NAMES.test("import { x } from './address-changes.ts';")).toBe(true);
    expect(NAMES.test("import { addressChangesForPass } from './address-changes-for-pass.ts';")).toBe(true);
    expect(NAMES.test('const t: AddressTable = prepared;')).toBe(true);
    expect(NAMES.test('...addressHooks<RawMessage>(deps.addressChanges, ...)')).toBe(true);
    expect(HOOKS.test('runDomainSync({ ...deps, addressDigestNow })')).toBe(true);
    expect(HOOKS.test('{ ...built, addressChanges: changes }')).toBe(true);
    expect(NAMES.test("import { contentHash } from '@openmig/shared';")).toBe(false);
    expect(HOOKS.test('const address = message.from;')).toBe(false);
  });
});

describe('both dispatchers', () => {
  it('on the appliance, hand the table to contacts, calendars and tasks, and build mail without it', () => {
    const dispatcher = read('packages/orchestration/src/orchestration.ts');
    const mail = between(dispatcher, "if (domain === 'email') {", "} else if (domain === 'calendar') {");
    expect(mail).not.toMatch(HOOKS);
    expect(mail).not.toMatch(/addressChangesOf/);
    const reached = between(dispatcher, "} else if (domain === 'calendar') {", "} else if (domain === 'file') {");
    const handed = [...dispatcher.matchAll(/addressChangesOf\(/g)].length;
    expect(handed).toBe(3);
    expect([...reached.matchAll(/addressChangesOf\(/g)].length).toBe(handed);
    const mailBuilder = read('packages/orchestration/src/build-deps.ts');
    expect(mailBuilder).not.toMatch(NAMES);
    expect(mailBuilder).not.toMatch(HOOKS);
  });

  it('on managed, build mail without it, and read it only for contacts, calendars and tasks', () => {
    const builder = read('packages/orchestration/src/build-deps-from-mapping.ts');
    const mail = between(builder, 'export async function buildDepsFromMapping(', 'export function tenantThrottleLimiter(');
    expect(mail).not.toMatch(NAMES);
    expect(mail).not.toMatch(HOOKS);
    const perType = builder.slice(builder.indexOf('export async function buildDomainDepsFromMapping('));
    // Mail returns before the table is read; the table is read for the three.
    expect(perType.indexOf('return buildDepsFromMapping(')).toBeGreaterThan(0);
    expect(perType.indexOf('return buildDepsFromMapping(')).toBeLessThan(perType.indexOf('addressChangesForPass('));
    expect(perType).toMatch(
      /const addressChanges =\s*domain === 'calendar' \|\| domain === 'task' \|\| domain === 'contact'\s*\?\s*await addressChangesForPass\(/,
    );
    expect([...builder.matchAll(/addressChangesForPass\(/g)].length).toBe(1);
    // Files are built after the three, and never take it.
    expect(perType.slice(perType.indexOf('const fileTgtEndpoint'))).not.toMatch(HOOKS);
    const pass = read('apps/worker/src/jobs/run-delta-sync.ts');
    expect(between(pass, "if (domain === 'email') {", "} else if (domain === 'calendar') {")).not.toMatch(HOOKS);
  });
});
