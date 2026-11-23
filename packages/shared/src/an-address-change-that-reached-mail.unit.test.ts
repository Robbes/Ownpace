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

const NAMES = /\b(applyAddressChanges|prepareAddressTable|addressTableDigest|ConfirmedAddressChange)\b|address-changes(\.ts)?['"]/;

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

  it('would see it if it did', () => {
    expect(NAMES.test("import { applyAddressChanges } from '@openmig/shared';")).toBe(true);
    expect(NAMES.test("import { x } from './address-changes.ts';")).toBe(true);
    expect(NAMES.test("import { contentHash } from '@openmig/shared';")).toBe(false);
  });
});
