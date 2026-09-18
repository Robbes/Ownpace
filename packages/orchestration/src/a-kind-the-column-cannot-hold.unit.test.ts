// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A KIND THE COLUMN CANNOT HOLD.
 *
 * The owner, 2026-09-17: the Sharing page found no Google sharings on a live
 * migration full of them. The managed permission report's lookup read
 *
 *     WHERE role = 'source' AND kind = 'google-drive'
 *
 * and that value has never been storable. `connection.kind` is a CHECK
 * constraint (migration 0008 added the Drive row to it) and it spells the kind
 * `google_drive`, underscored. `google-drive` is the WIZARD's word for the same
 * provider — the one a mapping file's `source.type` carries.
 *
 * So the query matched nothing for anybody, ever: not the `google` ACCOUNT kind
 * the owner was running, and not the legacy Drive connection it was written
 * for. The scan never ran and the page printed a not-discoverable sentence
 * written for a different source, which an operator reads as "nothing is
 * shared" — the one thing hard rule 9 forbids a blind spot to look like.
 *
 * ## Why the guard asks the database
 *
 * A test that compared the lookup against a list of kinds this file typed
 * would have passed on the broken line just as happily, because the broken line
 * and the broken list would have been typed by the same hand on the same
 * afternoon. There is exactly one authority for what the column can hold, and
 * it is the constraint. So the migrations run against PGlite and the constraint
 * is read out of the catalogue.
 *
 * `GOOGLE_DRIVE_CONNECTION_KIND`'s own header predicted this word for word —
 * *"this constant exists to keep the managed comparison from being a bare
 * string literal somebody 'corrects' to the other spelling"*. A comment could
 * not stop it. This can.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { GOOGLE_NATIVE_FILE_SOURCE_TYPES } from '@openmig/shared';
import { connectionKindsWithFace } from './source-face-builders.ts';
import { GOOGLE_DRIVE_CONNECTION_KIND } from './drive-source-factory.ts';

let driver: LedgerDriver;
/** The CHECK constraint's own text, straight out of the catalogue. */
let kindCheck: string;

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  const conn = await driver.acquire();
  try {
    const { rows } = await conn.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def
         FROM pg_constraint WHERE conname = 'connection_kind_check'`,
    );
    kindCheck = rows[0]?.def ?? '';
  } finally {
    conn.release();
  }
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

/** Every kind the constraint permits, as the constraint spells them. */
function storableKinds(): ReadonlySet<string> {
  return new Set([...kindCheck.matchAll(/'([a-z0-9_]+)'::text/g)].map((m) => m[1]!));
}

describe('the constraint is readable at all', () => {
  it('found connection_kind_check with kinds in it', () => {
    // Guards every assertion below: an empty constraint text would make the
    // "is storable" checks vacuous and the "is not storable" checks trivially
    // true, which is the shape of a guard that reads nothing and passes.
    expect(kindCheck, 'connection_kind_check is not on the connection table').toContain('kind');
    expect(storableKinds().size).toBeGreaterThan(10);
    expect(storableKinds().has('o365'), 'the parse found no known kind').toBe(true);
  });
});

describe('every kind the Drive lookup asks for is one the column can hold', () => {
  const asked = connectionKindsWithFace('file', 'google-drive');

  it('asks for something', () => {
    expect(
      asked.length,
      'no stored kind has a Google Drive file face, so the managed sharing scan can ' +
        'never run for anybody. Either the face tables lost their Drive row or this ' +
        'question is being asked the wrong way.',
    ).toBeGreaterThan(0);
  });

  it.each([...asked])('%s is storable', (kind) => {
    expect(
      storableKinds().has(kind),
      `the Drive lookup asks for connection.kind = '${kind}', and the CHECK constraint ` +
        `does not permit that value — so no row can ever match it. This is the ` +
        `'google-drive' defect exactly: ${kindCheck}`,
    ).toBe(true);
  });

  it('names the account kind AND the single-purpose row', () => {
    // Both halves of the owner's defect in one assertion. `google` is what
    // Connect with Google creates and what he was running; `google_drive` is
    // the row the scan was written for and never reached either.
    expect(asked).toContain('google');
    expect(asked).toContain(GOOGLE_DRIVE_CONNECTION_KIND);
  });
});

describe('the wizard vocabulary and the column vocabulary are not one list', () => {
  it('the wizard word for Drive is a kind the column refuses', () => {
    // The trap, stated as a fact rather than a comment: these two lists read
    // alike, name the same providers, and are not interchangeable. Folding one
    // into the other is what broke the scan.
    expect(GOOGLE_NATIVE_FILE_SOURCE_TYPES).toContain('google-drive');
    expect(
      storableKinds().has('google-drive'),
      "'google-drive' has become a storable connection.kind. If that is deliberate, the " +
        'two vocabularies have merged and this guard should say so; until then it is the ' +
        'wizard word and a lookup using it matches nothing.',
    ).toBe(false);
  });

  it('the two lists do not have the same members', () => {
    expect([...GOOGLE_NATIVE_FILE_SOURCE_TYPES].sort()).not.toEqual([
      ...connectionKindsWithFace('file', 'google-drive'),
    ]);
  });
});
