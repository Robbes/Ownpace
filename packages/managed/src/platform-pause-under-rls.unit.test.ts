// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Who may declare a hold, and who may read it — decided by the database.
 *
 * A hold stops copying for every customer on the platform and puts a sentence
 * on every one of their screens. Two things must be true of it, and neither
 * may depend on a route remembering to check:
 *
 *  1. **Only an operator may start or lift one.** The route in front of these
 *     functions is `authenticateSubject`, which asks for a valid token and
 *     nothing more — exactly the hole `recordSupportRead` documents. So the
 *     writes carry `WHERE EXISTS (platform_operator …)` and the policies say
 *     the same thing again.
 *  2. **Every signed-in customer may read the OPEN one.** It is the sentence
 *     that explains their own screen; withholding it is the silence this
 *     table exists to end. The history is an operator's, because it is a
 *     record of us rather than an explanation to them.
 *
 * Asserted against the real `app_user` role: a policy checked on an owner
 * connection proves nothing, because Postgres exempts owners from row
 * security.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { pgliteDriver, runMigrations, withSubject } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from './migrate-managed.ts';
import {
  readOpenPause,
  startPlatformPause,
  endPlatformPause,
  listPlatformPauses,
} from './platform-pause.ts';

// UUID family 0023…, unused elsewhere in the repo.
const OPERATOR = 'sub-hold-operator';
const CUSTOMER = 'sub-hold-customer';

let driver: LedgerDriver;

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });
  const conn = await driver.acquire();
  try {
    await conn.query(`INSERT INTO platform_operator (user_id, email) VALUES ($1, $2)`, [
      OPERATOR,
      'operator@ownpace.test',
    ]);
  } finally {
    conn.release();
  }
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

beforeEach(async () => {
  const conn = await driver.acquire();
  try {
    await conn.query('DELETE FROM platform_pause');
  } finally {
    conn.release();
  }
});

describe('starting a hold', () => {
  it('an operator can, and their words are stored', async () => {
    const started = await withSubject(driver, OPERATOR, async (db) =>
      startPlatformPause(db, { operatorUserId: OPERATOR, message: 'Back in about an hour.' }),
    );
    expect(started?.message).toBe('Back in about an hour.');
    const open = await withSubject(driver, OPERATOR, async (db) => readOpenPause(db));
    expect(open?.message).toBe('Back in about an hour.');
  });

  it('a signed-in customer cannot, and is told nothing', async () => {
    // Null rather than a thrown policy error: an absence is what the database
    // sees, and a refusal would tell somebody there was something to refuse.
    const started = await withSubject(driver, CUSTOMER, async (db) =>
      startPlatformPause(db, { operatorUserId: CUSTOMER, message: 'mine now' }),
    );
    expect(started).toBeNull();
    const open = await withSubject(driver, OPERATOR, async (db) => readOpenPause(db));
    expect(open).toBeNull();
  });

  it('refuses a hold attributed to nobody', async () => {
    await expect(
      withSubject(driver, OPERATOR, async (db) => startPlatformPause(db, { operatorUserId: '' })),
    ).rejects.toThrow(/no operator subject/);
  });

  it('a hold with no message is still a hold', async () => {
    const started = await withSubject(driver, OPERATOR, async (db) =>
      startPlatformPause(db, { operatorUserId: OPERATOR }),
    );
    expect(started).not.toBeNull();
    expect(started?.message).toBeUndefined();
  });

  it('the database refuses a second open hold', async () => {
    // Two would leave every screen choosing which sentence is real. Folding
    // the second into the first would be worse: the new message would be
    // silently discarded.
    await withSubject(driver, OPERATOR, async (db) =>
      startPlatformPause(db, { operatorUserId: OPERATOR, message: 'first' }),
    );
    await expect(
      withSubject(driver, OPERATOR, async (db) =>
        startPlatformPause(db, { operatorUserId: OPERATOR, message: 'second' }),
      ),
    ).rejects.toThrow();
  });
});

describe('reading a hold', () => {
  beforeEach(async () => {
    await withSubject(driver, OPERATOR, async (db) =>
      startPlatformPause(db, { operatorUserId: OPERATOR, message: 'Updating the platform.' }),
    );
  });

  it('a customer sees the open one — it explains their own screen', async () => {
    const open = await withSubject(driver, CUSTOMER, async (db) => readOpenPause(db));
    expect(open?.message).toBe('Updating the platform.');
  });

  it('a customer sees no history', async () => {
    await withSubject(driver, OPERATOR, async (db) =>
      endPlatformPause(db, { operatorUserId: OPERATOR }),
    );
    const theirs = await withSubject(driver, CUSTOMER, async (db) => listPlatformPauses(db));
    expect(theirs).toHaveLength(0);
    const ours = await withSubject(driver, OPERATOR, async (db) => listPlatformPauses(db));
    expect(ours).toHaveLength(1);
  });
});

describe('lifting a hold', () => {
  beforeEach(async () => {
    await withSubject(driver, OPERATOR, async (db) =>
      startPlatformPause(db, { operatorUserId: OPERATOR }),
    );
  });

  it('an operator can, and the row keeps who and when', async () => {
    const ended = await withSubject(driver, OPERATOR, async (db) =>
      endPlatformPause(db, { operatorUserId: OPERATOR }),
    );
    expect(ended).toBe(true);
    expect(await withSubject(driver, OPERATOR, async (db) => readOpenPause(db))).toBeNull();
    const [record] = await withSubject(driver, OPERATOR, async (db) => listPlatformPauses(db));
    expect(record?.endedBy).toBe(OPERATOR);
    expect(record?.endedAt).toBeTruthy();
  });

  it('a customer cannot, and the hold stands', async () => {
    const ended = await withSubject(driver, CUSTOMER, async (db) =>
      endPlatformPause(db, { operatorUserId: CUSTOMER }),
    );
    expect(ended).toBe(false);
    expect(await withSubject(driver, CUSTOMER, async (db) => readOpenPause(db))).not.toBeNull();
  });

  it('answers false when there is nothing to lift', async () => {
    await withSubject(driver, OPERATOR, async (db) =>
      endPlatformPause(db, { operatorUserId: OPERATOR }),
    );
    const again = await withSubject(driver, OPERATOR, async (db) =>
      endPlatformPause(db, { operatorUserId: OPERATOR }),
    );
    expect(again).toBe(false);
  });
});
