// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHO SENDS THE LINK (workplan 0176 §7, T3 and T6; D7, D11; managed
 * migration 0067).
 *
 * A person's page names the member who sent their link: a name, how the
 * reader knows them, and a number to check. The page shows each under
 * Ownpace's name, so each is held to a shape by the database too, not only by
 * the route that writes it:
 *
 *  - a member's name is at most 60 characters, with no space at either end
 *    and no control character;
 *  - a member's number has the organisation's number's characters and 6 to
 *    15 digits;
 *  - how the reader knows them is one of a fixed list (D7), the same list the
 *    code offers (`SENDER_RELATIONS`), held equal here;
 *  - a progress link handed over after a sign-in names the grant link it
 *    speaks for, of its own organisation only; no other link names one, and
 *    deleting that grant link forgets only where the page came from.
 *
 * PGlite, both chains, as a managed deployment applies them.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { pgliteDriver, runMigrations, withTenant } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { SENDER_RELATIONS } from '@openmig/shared';
import { runManagedMigrations, managedMigrationsDir } from './migrate-managed.ts';

// UUID family 01760067-…, unused elsewhere in the repo.
const U = (n: string) => `01760067-e29b-41d4-a716-4466554400${n}`;
const OURS = U('01');
const THEIRS = U('02');
const ANNA = U('11');
const THEIR_PERSON = U('12');
const GRANT = U('21');
const THEIR_GRANT = U('22');

let driver: LedgerDriver;

async function owner(statement: string, params: unknown[] = []): Promise<Array<Record<string, unknown>>> {
  const conn = await driver.acquire();
  try {
    return (await conn.query(statement, params)).rows as Array<Record<string, unknown>>;
  } finally {
    await conn.release();
  }
}

/** What a statement's refusal says, or null when it went through. */
async function refused(statement: string, params: unknown[] = []): Promise<string | null> {
  return owner(statement, params).then(
    () => null,
    (e: Error) => e.message,
  );
}

/** A link row of ours, with whatever the case sets. */
const link = (id: string, purpose: 'grant' | 'view', extra = '', values = '') =>
  `INSERT INTO person_link (id, tenant_id, person_id, purpose, secret_hash, created_by, expires_at${extra})
   VALUES ('${id}', '${OURS}', '${ANNA}', '${purpose}', 'h-${id}', 'pat', now() + interval '7 days'${values})`;

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });
  await owner('INSERT INTO tenant (id, name) VALUES ($1, $2), ($3, $4)', [OURS, 'Ours', THEIRS, 'Theirs']);
  await owner(
    `INSERT INTO tenant_member (tenant_id, user_id, email) VALUES ($1,'pat','pat@example.org'), ($2,'sam','sam@example.org')`,
    [OURS, THEIRS],
  );
  await owner(`INSERT INTO person (id, tenant_id, display_name) VALUES ($1,$3,'Anna'), ($2,$4,'Carl')`, [
    ANNA,
    THEIR_PERSON,
    OURS,
    THEIRS,
  ]);
  await owner(link(GRANT, 'grant'));
  await owner(
    `INSERT INTO person_link (id, tenant_id, person_id, purpose, secret_hash, created_by, expires_at)
     VALUES ($1, $2, $3, 'grant', 'h-theirs', 'sam', now() + interval '7 days')`,
    [THEIR_GRANT, THEIRS, THEIR_PERSON],
  );
}, 60_000);

afterAll(async () => {
  await driver.end?.();
});

describe("a member's name, as the people they send a link to know them", () => {
  const setName = (name: string | null) =>
    refused(`UPDATE tenant_member SET display_name = $1 WHERE tenant_id = $2 AND user_id = 'pat'`, [name, OURS]);

  it('takes a name, in any script, and none', async () => {
    expect(await setName('Anna de Vries')).toBeNull();
    expect(await setName('Zoë O’Brien-Müller')).toBeNull();
    expect(await setName(null)).toBeNull();
  });

  it('refuses one over 60 characters, one with a space at either end, and one with a control character', async () => {
    expect(await setName('A'.repeat(61))).toMatch(/tenant_member_display_name_check/);
    expect(await setName(' Anna')).toMatch(/tenant_member_display_name_check/);
    expect(await setName('Anna\nCall 0800')).toMatch(/tenant_member_display_name_check/);
    expect(await setName('')).toMatch(/tenant_member_display_name_check/);
  });

  it('is read under row security in its own organisation only', async () => {
    await setName('Pat');
    const ours = await withTenant(driver, OURS, async (db) =>
      (await db.execute(sql.raw(`SELECT display_name FROM tenant_member`))).rows,
    );
    const theirs = await withTenant(driver, THEIRS, async (db) =>
      (await db.execute(sql.raw(`SELECT display_name FROM tenant_member WHERE user_id = 'pat'`))).rows,
    );
    expect(ours).toEqual([{ display_name: 'Pat' }]);
    expect(theirs).toEqual([]);
  });
});

describe("a member's own number", () => {
  const setPhone = (phone: string | null) =>
    refused(`UPDATE tenant_member SET phone = $1 WHERE tenant_id = $2 AND user_id = 'pat'`, [phone, OURS]);

  it("takes a number in the organisation's number's shape, and none", async () => {
    expect(await setPhone('+31 6 1234 5678')).toBeNull();
    expect(await setPhone('(020) 123-4567')).toBeNull();
    expect(await setPhone(null)).toBeNull();
  });

  it('refuses words, too few digits and too many', async () => {
    expect(await setPhone('Call IT, they know')).toMatch(/tenant_member_phone_check/);
    expect(await setPhone('12345')).toMatch(/tenant_member_phone_check/);
    expect(await setPhone('1234567890123456')).toMatch(/tenant_member_phone_check/);
  });
});

describe('how the reader knows the sender (D7)', () => {
  it('is the list the code offers, word for word, in the same order', () => {
    const file = readFileSync(join(managedMigrationsDir(), '0067_who_sends_the_link.sql'), 'utf8');
    const check = /person_link_relation_check CHECK \(([\s\S]*?)\)\s*\);/.exec(file)?.[1] ?? '';
    const listed = [...check.matchAll(/'([a-z]+)'::text/g)].map((m) => m[1]);
    expect(listed).toEqual([...SENDER_RELATIONS]);
  });

  it('takes each word of the list, and none', async () => {
    for (const relation of SENDER_RELATIONS) {
      expect(await refused(`UPDATE person_link SET relation = $1 WHERE id = $2`, [relation, GRANT])).toBeNull();
    }
    expect(await refused(`UPDATE person_link SET relation = NULL WHERE id = $1`, [GRANT])).toBeNull();
  });

  it('refuses anything else, which is where an impersonator would write *your bank*', async () => {
    expect(await refused(`UPDATE person_link SET relation = 'bank' WHERE id = $1`, [GRANT])).toMatch(
      /person_link_relation_check/,
    );
    expect(await refused(`UPDATE person_link SET relation = 'Daughter' WHERE id = $1`, [GRANT])).toMatch(
      /person_link_relation_check/,
    );
  });
});

describe('the grant link a progress link speaks for', () => {
  it('is named by a progress link of the same organisation, and by nothing else', async () => {
    const page = U('31');
    expect(await refused(link(page, 'view', ', made_from', `, '${GRANT}'`))).toBeNull();
    // A grant link names none.
    expect(await refused(link(U('32'), 'grant', ', made_from', `, '${GRANT}'`))).toMatch(/person_link_made_from_check/);
    // Another organisation's link cannot be named.
    expect(await refused(link(U('33'), 'view', ', made_from', `, '${THEIR_GRANT}'`))).toMatch(
      /person_link_made_from_fkey/,
    );
  });

  it('deleting that grant link forgets where the page came from, and keeps the page', async () => {
    const grant = U('41');
    const page = U('42');
    await owner(link(grant, 'grant'));
    await owner(link(page, 'view', ', made_from', `, '${grant}'`));
    await owner(`DELETE FROM person_link WHERE id = $1`, [grant]);
    const [row] = await owner(`SELECT tenant_id, made_from FROM person_link WHERE id = $1`, [page]);
    expect(row).toEqual({ tenant_id: OURS, made_from: null });
  });
});
