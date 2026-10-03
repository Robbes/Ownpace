// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PERSON'S LINK (ADR-0035, amended 2026-09-29; workplan 0153 T5 (b)):
 * `person-link-store.ts` and managed migration 0034.
 *
 *  - the token is shown once and only its hash is kept;
 *  - it verifies for its purpose only, and not once revoked, expired or, for a
 *    grant, spent; a progress link opens again after use;
 *  - a person's token and a migration's are told apart by shape, and neither
 *    store will verify the other's;
 *  - a link-scoped read finds the presented link and no other;
 *  - an organisation sees and writes its own people's links only, and a link
 *    cannot name another organisation's person, whoever writes it;
 *  - spending is once, and not after the kill switch or the date;
 *  - revoking names the person, and the live count is the grant links that
 *    can still be used;
 *  - deleting the person deletes their links;
 *  - a link that asks again (managed migration 0036) keeps the migrations it
 *    asks for, says them when verified, and loses each as its account is
 *    connected through it.
 *
 * PGlite as `app_user`, both chains. The names are invented.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  MAPPING_LINK_REFUSAL,
  pgliteDriver,
  runMigrations,
  verifyMappingLink,
  withMappingLink,
  withTenant,
} from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from './migrate-managed.ts';
import { createPerson, deletePerson } from './people.ts';
import {
  countLivePersonGrantLinks,
  connectedThroughPersonLink,
  isPersonLinkToken,
  issuePersonLink,
  listPersonLinks,
  revokePersonLink,
  spendPersonLink,
  verifyPersonLink,
} from './person-link-store.ts';

// UUID family 0153b5b0-…, unused elsewhere in the repo.
const P = '0153b5b0-e29b-41d4-a716-4466554430';
const OURS = `${P}01`;
const THEIRS = `${P}02`;

const DAY = 24 * 60 * 60 * 1000;
const inDays = (days: number) => new Date(Date.now() + days * DAY);

let driver: LedgerDriver;
let anna: string;
let bram: string;
let theirPerson: string;

async function owner(statement: string, params: unknown[] = []): Promise<Array<Record<string, unknown>>> {
  const conn = await driver.acquire();
  try {
    return (await conn.query(statement, params)).rows as Array<Record<string, unknown>>;
  } finally {
    await conn.release();
  }
}

const issue = (tenantId: string, personId: string, purpose: 'grant' | 'view' = 'grant', expiresAt = inDays(7)) =>
  withTenant(driver, tenantId, (db) =>
    issuePersonLink(db, { tenantId, personId, purpose, createdBy: 'owner-sub', expiresAt }),
  );

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });
  for (const [id, name] of [
    [OURS, 'Ours BV'],
    [THEIRS, 'Theirs BV'],
  ]) {
    await owner(`INSERT INTO tenant (id, name) VALUES ($1, $2)`, [id, name]);
  }
  anna = (await withTenant(driver, OURS, (db) => createPerson(db, OURS, { displayName: 'Anna', email: null }))).id;
  bram = (await withTenant(driver, OURS, (db) => createPerson(db, OURS, { displayName: 'Bram', email: null }))).id;
  theirPerson = (
    await withTenant(driver, THEIRS, (db) => createPerson(db, THEIRS, { displayName: 'Cato', email: null }))
  ).id;
}, 120_000);

describe("a person's link is shown once and kept as a hash", () => {
  it('answers p.<id>.<secret>, and the table holds neither the token nor the secret', async () => {
    const issued = await issue(OURS, anna);
    expect(issued.token).toMatch(/^p\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{40,}$/);
    expect(issued.token.startsWith(`p.${issued.id}.`)).toBe(true);
    const secret = issued.token.slice(`p.${issued.id}.`.length);

    const [row] = await owner(`SELECT * FROM person_link WHERE id = $1`, [issued.id]);
    const stored = JSON.stringify(row);
    expect(stored).not.toContain(secret);
    expect(row?.secret_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('verifying', () => {
  it('verifies its own purpose, naming the person and the organisation', async () => {
    const issued = await issue(OURS, anna);
    const verdict = await verifyPersonLink(driver, issued.token, { purpose: 'grant' });
    expect(verdict).toEqual({
      ok: true,
      link: { id: issued.id, tenantId: OURS, personId: anna, purpose: 'grant', expiresAt: issued.expiresAt, asksAgain: null },
    });
  });

  it('refuses a wrong secret, the other purpose, a revoked link and an expired one, all in one sentence', async () => {
    const issued = await issue(OURS, anna);
    const wrongSecret = `p.${issued.id}.${'A'.repeat(43)}`;
    expect(await verifyPersonLink(driver, wrongSecret, { purpose: 'grant' })).toEqual({
      ok: false,
      reason: MAPPING_LINK_REFUSAL,
    });
    expect((await verifyPersonLink(driver, issued.token, { purpose: 'view' })).ok).toBe(false);

    const revoked = await issue(OURS, anna);
    await withTenant(driver, OURS, (db) => revokePersonLink(db, { tenantId: OURS, personId: anna, linkId: revoked.id }));
    expect((await verifyPersonLink(driver, revoked.token, { purpose: 'grant' })).ok).toBe(false);

    const expired = await issue(OURS, anna, 'grant', inDays(1));
    expect((await verifyPersonLink(driver, expired.token, { purpose: 'grant', now: inDays(2) })).ok).toBe(false);
  });

  it('refuses a spent grant link, and opens a progress link again after it was used', async () => {
    const grant = await issue(OURS, anna);
    await withTenant(driver, OURS, (db) => spendPersonLink(db, { tenantId: OURS, linkId: grant.id }));
    expect((await verifyPersonLink(driver, grant.token, { purpose: 'grant' })).ok).toBe(false);

    const view = await issue(OURS, anna, 'view', inDays(90));
    await owner(`UPDATE person_link SET used_at = now() WHERE id = $1`, [view.id]);
    expect((await verifyPersonLink(driver, view.token, { purpose: 'view' })).ok).toBe(true);
  });

  it("tells a person's token from a migration's by shape, and neither store verifies the other's", async () => {
    const issued = await issue(OURS, anna);
    expect(isPersonLinkToken(issued.token)).toBe(true);
    const asAMigrations = issued.token.slice(2);
    expect(isPersonLinkToken(asAMigrations)).toBe(false);
    // The migration's store refuses the person's token by its shape, and the
    // person's store refuses the same id and secret without the prefix.
    expect((await verifyMappingLink(driver, issued.token, { purpose: 'grant' })).ok).toBe(false);
    expect((await verifyPersonLink(driver, asAMigrations, { purpose: 'grant' })).ok).toBe(false);
  });
});

describe('a link-scoped read finds the presented link and no other', () => {
  it('sees exactly the one row whose id was presented, and none under an unset one', async () => {
    const first = await issue(OURS, anna);
    const second = await issue(THEIRS, theirPerson);
    const seen = await withMappingLink(driver, first.id, (db) =>
      db.execute(sql`SELECT id FROM person_link`),
    );
    expect(seen.rows.map((r) => (r as { id: string }).id)).toEqual([first.id]);
    const none = await withMappingLink(driver, '', (db) => db.execute(sql`SELECT id FROM person_link`));
    expect(none.rows).toEqual([]);
    expect(second.id).not.toBe(first.id);
  });
});

describe('an organisation has its own people’s links only', () => {
  it("lists its own, and never another organisation's", async () => {
    const theirs = await issue(THEIRS, theirPerson);
    const listed = await withTenant(driver, OURS, (db) =>
      listPersonLinks(db, { tenantId: OURS, personId: theirPerson }),
    );
    expect(listed).toEqual([]);
    const ownList = await withTenant(driver, THEIRS, (db) =>
      listPersonLinks(db, { tenantId: THEIRS, personId: theirPerson }),
    );
    expect(ownList.map((l) => l.id)).toContain(theirs.id);
  });

  it("cannot write a link naming another organisation's person, under either organisation", async () => {
    const underOurs = issue(OURS, theirPerson);
    await expect(underOurs).rejects.toThrow();
    // Written as the other organisation but claiming ours: the tenant policy.
    const claimingOurs = withTenant(driver, THEIRS, (db) =>
      issuePersonLink(db, { tenantId: OURS, personId: anna, purpose: 'grant', createdBy: 'x', expiresAt: inDays(7) }),
    );
    await expect(claimingOurs).rejects.toThrow();
  });
});

describe('spending, revoking and counting', () => {
  it('spends a grant link once, and not after the kill switch or the date', async () => {
    const once = await issue(OURS, bram);
    const spend = () => withTenant(driver, OURS, (db) => spendPersonLink(db, { tenantId: OURS, linkId: once.id }));
    expect(await spend()).toBe(true);
    expect(await spend()).toBe(false);

    const killed = await issue(OURS, bram);
    await withTenant(driver, OURS, (db) => revokePersonLink(db, { tenantId: OURS, personId: bram, linkId: killed.id }));
    expect(
      await withTenant(driver, OURS, (db) => spendPersonLink(db, { tenantId: OURS, linkId: killed.id })),
    ).toBe(false);

    const old = await issue(OURS, bram, 'grant', inDays(1));
    expect(
      await withTenant(driver, OURS, (db) => spendPersonLink(db, { tenantId: OURS, linkId: old.id, now: inDays(2) })),
    ).toBe(false);
  });

  it('revokes only under the person the link is for, and a second press changes nothing', async () => {
    const annas = await issue(OURS, anna);
    const revoke = (personId: string) =>
      withTenant(driver, OURS, (db) => revokePersonLink(db, { tenantId: OURS, personId, linkId: annas.id }));
    expect(await revoke(bram)).toBe(false);
    expect(await revoke(anna)).toBe(true);
    expect(await revoke(anna)).toBe(false);
    const [listed] = (
      await withTenant(driver, OURS, (db) => listPersonLinks(db, { tenantId: OURS, personId: anna }))
    ).filter((l) => l.id === annas.id);
    expect(listed?.state).toBe('revoked');
  });

  it('counts the grant links that can still be used, and no progress link', async () => {
    const tenant = `${P}03`;
    await owner(`INSERT INTO tenant (id, name) VALUES ($1, 'Counted BV')`, [tenant]);
    const dora = (await withTenant(driver, tenant, (db) => createPerson(db, tenant, { displayName: 'Dora', email: null }))).id;
    await issue(tenant, dora);
    await issue(tenant, dora);
    await issue(tenant, dora, 'view', inDays(90));
    const spent = await issue(tenant, dora);
    await withTenant(driver, tenant, (db) => spendPersonLink(db, { tenantId: tenant, linkId: spent.id }));
    const revoked = await issue(tenant, dora);
    await withTenant(driver, tenant, (db) => revokePersonLink(db, { tenantId: tenant, personId: dora, linkId: revoked.id }));
    await issue(tenant, dora, 'grant', inDays(1));

    expect(await withTenant(driver, tenant, (db) => countLivePersonGrantLinks(db, tenant))).toBe(3);
    expect(await withTenant(driver, tenant, (db) => countLivePersonGrantLinks(db, tenant, inDays(2)))).toBe(2);
    // Under another organisation the count is that organisation's, and nothing here.
    expect(await withTenant(driver, OURS, (db) => countLivePersonGrantLinks(db, tenant))).toBe(0);
  });
});

describe('a link that asks again (managed migration 0036)', () => {
  const CAL = `${P}31`;
  const MAIL = `${P}32`;

  it('keeps what it asks for, says it when verified, and loses each as it is connected through it', async () => {
    const issued = await withTenant(driver, OURS, (db) =>
      issuePersonLink(db, {
        tenantId: OURS,
        personId: anna,
        purpose: 'grant',
        createdBy: 'owner-sub',
        expiresAt: inDays(7),
        asksAgain: [CAL, MAIL],
      }),
    );
    const verdict = await verifyPersonLink(driver, issued.token, { purpose: 'grant' });
    expect(verdict.ok && verdict.link.asksAgain).toEqual([CAL, MAIL]);

    const connected = (mappingIds: string[]) =>
      withTenant(driver, OURS, (db) => connectedThroughPersonLink(db, { tenantId: OURS, linkId: issued.id, mappingIds }));
    expect(await connected([CAL])).toEqual([MAIL]);
    expect(await connected([CAL])).toEqual([MAIL]);
    expect(await connected([MAIL])).toEqual([]);
    // Under another organisation the row is not there to change.
    expect(
      await withTenant(driver, THEIRS, (db) =>
        connectedThroughPersonLink(db, { tenantId: THEIRS, linkId: issued.id, mappingIds: [MAIL] }),
      ),
    ).toBeNull();
  });

  it('asks for nothing again when made while something was not connected, and never for a progress link', async () => {
    const first = await issue(OURS, anna);
    expect(
      await withTenant(driver, OURS, (db) =>
        connectedThroughPersonLink(db, { tenantId: OURS, linkId: first.id, mappingIds: [CAL] }),
      ),
    ).toBeNull();
    const view = await withTenant(driver, OURS, (db) =>
      issuePersonLink(db, {
        tenantId: OURS,
        personId: anna,
        purpose: 'view',
        createdBy: 'owner-sub',
        expiresAt: inDays(90),
        asksAgain: [CAL],
      }),
    );
    const [row] = await owner('SELECT asks_again FROM person_link WHERE id = $1', [view.id]);
    expect(row?.asks_again).toBeNull();
  });
});

describe('a person who is gone leaves no door open', () => {
  it("deleting the person deletes their links, and nobody else's", async () => {
    const eva = (await withTenant(driver, OURS, (db) => createPerson(db, OURS, { displayName: 'Eva', email: null }))).id;
    const evas = await issue(OURS, eva);
    const annas = await issue(OURS, anna);
    await withTenant(driver, OURS, (db) => deletePerson(db, OURS, eva));
    expect(await owner(`SELECT id FROM person_link WHERE id = $1`, [evas.id])).toEqual([]);
    expect(await owner(`SELECT id FROM person_link WHERE id = $1`, [annas.id])).toHaveLength(1);
    expect((await verifyPersonLink(driver, evas.token, { purpose: 'grant' })).ok).toBe(false);
  });
});
