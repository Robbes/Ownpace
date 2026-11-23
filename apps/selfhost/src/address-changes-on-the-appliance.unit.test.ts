// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * ADDRESS CHANGES ON THE APPLIANCE (ADR-0055; workplan 0168 T2, §7; ADR-0034's
 * doors).
 *
 * The real appliance on PGlite, started three times:
 *
 *  - **the page door** (no `address-changes.json`): `POST /address-changes`
 *    writes a row `confirmed` by `operator`, the same shapes as managed, a
 *    person in the body and *Not right?* are refused in both languages;
 *  - **the file door**: the file's rows are the table, served read-only and
 *    naming the file, every write refused with `file_door`, and the mapping
 *    loader does not take the file for a mapping;
 *  - **a malformed file**: the appliance does not start, and says which file
 *    and what is wrong;
 *
 * and, since 0168's review:
 *
 *  - **one table however many tenants** (finding 5): a mapping added later,
 *    whose tenant sorts first, gets the table rather than hiding it, and a
 *    write on the page reaches every tenant;
 *  - **a file that is gone takes its rows** (finding 7), said in one line;
 *  - **a path that does not decode** is the caller's 400 (finding 10);
 *  - **every write on the page is in the audit trail** (finding 4), by
 *    reference, never by address;
 *  - the appliance is *de appliance* in Dutch (N6).
 *
 * The connectors point at port 1 and the schedule never fires. Addresses are
 * invented.
 */

import { describe, it, expect, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPgliteDb } from '@openmig/ledger';
import { start, type SelfhostHandle } from './index.ts';

const TENANT = '0168a2f0-e29b-41d4-a716-446655443201';
const MAPPING = '0168a2f0-e29b-41d4-a716-446655443211';
const TENANT_2 = '0168a2f0-e29b-41d4-a716-446655443202';
const MAPPING_2 = '0168a2f0-e29b-41d4-a716-446655443212';

const tempDirs: string[] = [];
const handles: SelfhostHandle[] = [];

afterAll(async () => {
  for (const h of handles) await h.stop();
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

/** One mapping file in a config directory. */
function mappingFile(cfg: string, file: string, tenantId: string, mappingId: string): void {
  const dav = {
    type: 'carddav',
    url: 'http://127.0.0.1:1/remote.php/dav',
    user: 'nobody',
    auth: { kind: 'login', passwordFromEnv: 'OPENMIG_TEST_NOPE' },
  };
  writeFileSync(
    join(cfg, file),
    JSON.stringify({
      tenantId,
      mappingId,
      schedule: { cron: '0 5 31 2 *' }, // 31 February: valid, never fires.
      source: dav,
      target: dav,
      domains: { contacts: { enabled: true, source: dav, target: dav } },
    }),
  );
}

function configDir(addressFile?: string, withMapping = true): string {
  const cfg = mkdtempSync(join(tmpdir(), 'ownpace-address-cfg-'));
  tempDirs.push(cfg);
  if (withMapping) mappingFile(cfg, 'contacts.json', TENANT, MAPPING);
  if (addressFile !== undefined) writeFileSync(join(cfg, 'address-changes.json'), addressFile);
  return cfg;
}

function dataDir(): string {
  const data = mkdtempSync(join(tmpdir(), 'ownpace-address-db-'));
  tempDirs.push(data);
  return data;
}

async function boot(cfg: string, data: string = dataDir()): Promise<SelfhostHandle> {
  const h = await start({ persistence: 'pglite', pgliteDataDir: data, configDir: cfg, port: 0, host: '127.0.0.1' });
  handles.push(h);
  return h;
}

/** Stop an appliance this test is done with, so its data directory can be read or booted again. */
async function stop(h: SelfhostHandle): Promise<void> {
  handles.splice(handles.indexOf(h), 1);
  await h.stop();
}

/** Every tenant's rows, read from a stopped appliance's database. */
async function tablesIn(data: string): Promise<Array<Record<string, unknown>>> {
  const { driver, close } = await createPgliteDb({ dataDir: data });
  try {
    const conn = await driver.acquire();
    try {
      return (
        await conn.query(
          `SELECT tenant_id, old_key, new_address, state, set_by, confirmed_by, created_at, confirmed_at
             FROM address_change ORDER BY old_key, tenant_id`,
        )
      ).rows as Array<Record<string, unknown>>;
    } finally {
      conn.release();
    }
  } finally {
    await close();
  }
}

function ask(
  h: SelfhostHandle,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = request(
      {
        host: '127.0.0.1',
        port: h.port,
        method,
        path,
        headers: payload === undefined ? {} : { 'content-type': 'application/json' },
      },
      (res) => {
        let text = '';
        res.on('data', (chunk: Buffer) => (text += chunk.toString()));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, json: text ? JSON.parse(text) : {} }));
      },
    );
    req.on('error', reject);
    req.end(payload);
  });
}

describe('the page door, without address-changes.json', () => {
  let h: SelfhostHandle;
  const data = dataDir();

  it('starts with an empty table, on the page', async () => {
    h = await boot(configDir(), data);
    expect((await ask(h, 'GET', '/address-changes')).json).toEqual({ rows: [], door: 'page', file: null });
  }, 120_000);

  it('POST writes a row confirmed by operator, whatever confirm says', async () => {
    const res = await ask(h, 'POST', '/address-changes', {
      oldAddress: 'Me.Myself@gmail.com',
      newAddress: 'me@example.org',
      confirm: false,
    });
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({
      oldKey: 'memyself@gmail.com',
      state: 'confirmed',
      setBy: 'operator',
      confirmedBy: 'operator',
      setByYou: false,
      confirmedByYou: false,
      confirmedByThePerson: false,
      person: null,
    });
    expect((await ask(h, 'POST', '/address-changes', { oldAddress: 'memyself@gmail.com', newAddress: 'me@example.org' })).status).toBe(200);
  });

  it.each([
    ['POST', '/address-changes', { oldAddress: 'a@example.net', newAddress: 'a@example.org', personId: 'implicit' }, 'invalid_request'],
    ['PUT', '/address-changes/memyself%40gmail.com', { state: 'proposed' }, 'invalid_request'],
    ['POST', '/address-changes', { oldAddress: 'me@example.org', newAddress: 'later@example.org' }, 'chained'],
    ['POST', '/address-changes', { oldAddress: 'nobody', newAddress: 'a@example.org' }, 'not_an_address'],
  ])('%s %j is refused in both languages', async (method, path, body, error) => {
    const res = await ask(h, method, path, body);
    expect(res.json.error).toBe(error);
    expect(res.json.messageNl).toBeTypeOf('string');
    expect(res.json.messageNl).not.toBe(res.json.message);
  });

  it('PUT changes the new address, still confirmed; DELETE removes it', async () => {
    const put = await ask(h, 'PUT', '/address-changes/memyself%40gmail.com', { newAddress: 'me.too@example.org' });
    expect(put.json).toMatchObject({ newAddress: 'me.too@example.org', state: 'confirmed', confirmedBy: 'operator' });
    expect((await ask(h, 'DELETE', '/address-changes/memyself%40gmail.com')).status).toBe(200);
    expect((await ask(h, 'DELETE', '/address-changes/memyself%40gmail.com')).json.error).toBe('address_change_not_found');
  });

  // N6 of 0168's review: the dictionary's *de appliance*; *dit apparaat* is the reader's own device.
  it('calls itself de appliance in Dutch', async () => {
    const res = await ask(h, 'POST', '/address-changes', { oldAddress: 'a@example.com', newAddress: 'a@example.org', personId: 'implicit' });
    expect(res.json.messageNl).toContain('Deze appliance migreert voor één persoon');
    expect(res.json.messageNl).not.toMatch(/apparaat/i);
  });

  // 0168's review, finding 10: `decodeURIComponent` threw, and the appliance answered 500.
  it.each(['PUT', 'DELETE'])('%s with a path that does not decode is the caller\'s 400, in both languages', async (method) => {
    const res = await ask(h, method, '/address-changes/me%E0%A4%A', method === 'PUT' ? { newAddress: 'x@example.org' } : undefined);
    expect(res.status).toBe(400);
    expect(res.json.error).toBe('invalid_request');
    expect(res.json.messageNl).not.toBe(res.json.message);
    expect(res.json.messageNl).toContain('niet goed gecodeerd');
  });

  // 0168's review, finding 4: who confirmed which row, by reference, in the
  // appliance's own audit trail. Read from its database once it has stopped:
  // the download serves an event only once it has settled, minutes later.
  it('records every write on the page in its audit trail, by reference, never by address', async () => {
    await stop(h);
    const { driver, close } = await createPgliteDb({ dataDir: data });
    let ours: Array<{ actor: string; action: string; entity: string; detail: Record<string, unknown> }>;
    try {
      const conn = await driver.acquire();
      ours = (
        await conn.query(`SELECT actor, action, entity, detail FROM audit_log WHERE entity = 'address_change' ORDER BY at, id`)
      ).rows as typeof ours;
      conn.release();
    } finally {
      await close();
    }
    expect(ours.map((a) => [a.action, a.actor, a.detail.from, a.detail.to, a.detail.via])).toEqual([
      ['address_change.added', 'operator', null, 'confirmed', 'page'],
      ['address_change.readdressed', 'operator', 'confirmed', 'confirmed', 'page'],
      ['address_change.deleted', 'operator', 'confirmed', null, 'page'],
    ]);
    const refs = new Set(ours.map((a) => a.detail.addressChange));
    expect(refs.size).toBe(1);
    expect(String([...refs][0])).toMatch(/^pseudo:[0-9a-f]{16}$/);
    for (const a of ours) expect(JSON.stringify(a)).not.toMatch(/@|memyself|me\.too/);
  }, 120_000);
});

describe('the file door, address-changes.json', () => {
  let h: SelfhostHandle;
  const file = JSON.stringify({
    changes: [
      { oldAddress: 'parent@outlook.com', newAddress: 'parent@example.org' },
      { oldAddress: 'kid.name@gmail.com', newAddress: 'kid@example.org' },
    ],
  });

  it("serves the file's rows read-only, naming the file, confirmed by it", async () => {
    h = await boot(configDir(file));
    const res = await ask(h, 'GET', '/address-changes');
    expect(res.json.door).toBe('file');
    expect(res.json.file).toBe('address-changes.json');
    const rows = res.json.rows as Array<Record<string, unknown>>;
    expect(rows.map((r) => [r.oldKey, r.newAddress, r.state, r.setBy, r.confirmedBy]).sort()).toEqual([
      ['kidname@gmail.com', 'kid@example.org', 'confirmed', 'address-changes.json', 'address-changes.json'],
      ['parent@outlook.com', 'parent@example.org', 'confirmed', 'address-changes.json', 'address-changes.json'],
    ]);
    expect(rows).toHaveLength(2);
  }, 120_000);

  it('did not take the file for a mapping', async () => {
    const people = await ask(h, 'GET', '/people');
    const [person] = people.json.people as Array<{ migrations: Array<{ id: string }> }>;
    expect(person!.migrations.map((m) => m.id)).toEqual([MAPPING]);
  });

  it.each([
    ['POST', '/address-changes', { oldAddress: 'a@example.net', newAddress: 'a@example.org' }],
    ['PUT', '/address-changes/kidname%40gmail.com', { newAddress: 'x@example.org' }],
    ['DELETE', '/address-changes/kidname%40gmail.com', undefined],
  ])('%s %s is refused with file_door, naming the file, in both languages', async (method, path, body) => {
    const res = await ask(h, method, path, body);
    expect(res.status).toBe(409);
    expect(res.json).toMatchObject({ error: 'file_door', file: 'address-changes.json' });
    expect(res.json.message).toContain('address-changes.json');
    expect(res.json.messageNl).toContain('address-changes.json');
    expect(((await ask(h, 'GET', '/address-changes')).json.rows as unknown[]).length).toBe(2);
  });
});

describe('a malformed address-changes.json', () => {
  it.each([
    ['not JSON', '{"changes": [', /Invalid address-changes\.json: it is not JSON/],
    [
      'a chain',
      JSON.stringify({ changes: [{ oldAddress: 'a@example.net', newAddress: 'b@example.net' }, { oldAddress: 'b@example.net', newAddress: 'c@example.org' }] }),
      /Invalid address-changes\.json: change 2: a@example\.net already becomes b@example\.net/,
    ],
  ])('stops the start, saying which file and what is wrong: %s', async (_what, text, why) => {
    await expect(boot(configDir(text))).rejects.toThrow(why);
  }, 120_000);
});

// 0168's review, finding 5: GET read the first tenant's table and each write
// went to each tenant in its own transaction, so a mapping added later, whose
// tenant sorts first, showed an empty table while the rows still applied, and
// a DELETE that found nothing in it answered 404 having deleted elsewhere.
describe('one table, however many tenants the directory names', () => {
  it('a tenant added later gets the table; the page shows it; a write and a delete reach every tenant', async () => {
    const cfg = configDir();
    const data = dataDir();
    let h = await boot(cfg, data);
    expect((await ask(h, 'POST', '/address-changes', { oldAddress: 'me@example.com', newAddress: 'me@example.org' })).status).toBe(201);
    await stop(h);

    mappingFile(cfg, 'calendar.json', TENANT_2, MAPPING_2); // sorts before contacts.json
    h = await boot(cfg, data);
    const seen = await ask(h, 'GET', '/address-changes');
    expect((seen.json.rows as Array<{ oldKey: string }>).map((r) => r.oldKey)).toEqual(['me@example.com']);
    expect((await ask(h, 'POST', '/address-changes', { oldAddress: 'kid@example.com', newAddress: 'kid@example.org' })).status).toBe(201);
    const gone = await ask(h, 'DELETE', '/address-changes/me%40example.com');
    expect(gone.status).toBe(200);
    expect(gone.json).toMatchObject({ oldKey: 'me@example.com', newAddress: 'me@example.org' });
    await stop(h);

    // Each tenant holds the same row, who set and confirmed it and when included.
    const rows = await tablesIn(data);
    expect(rows.map((r) => [r.old_key, r.tenant_id])).toEqual([
      ['kid@example.com', TENANT],
      ['kid@example.com', TENANT_2],
    ]);
    const strip = ({ tenant_id: _t, ...rest }: Record<string, unknown>) => rest;
    expect(strip(rows[0]!)).toEqual(strip(rows[1]!));
  }, 240_000);

  it('a tenant that lost its copy gets it back at the next start, and a DELETE deletes it everywhere and says so', async () => {
    const cfg = configDir();
    mappingFile(cfg, 'calendar.json', TENANT_2, MAPPING_2);
    const data = dataDir();
    let h = await boot(cfg, data);
    expect((await ask(h, 'POST', '/address-changes', { oldAddress: 'old@example.com', newAddress: 'new@example.org' })).status).toBe(201);
    await stop(h);
    // The first tenant's copy is gone, as a copy that failed would leave it,
    // and the other still holds it.
    {
      const { driver, close } = await createPgliteDb({ dataDir: data });
      const conn = await driver.acquire();
      await conn.query(`DELETE FROM address_change WHERE tenant_id = $1`, [TENANT_2]);
      conn.release();
      await close();
    }
    // Started again, every tenant is the first that holds a row: both hold it.
    h = await boot(cfg, data);
    expect(((await ask(h, 'GET', '/address-changes')).json.rows as unknown[]).length).toBe(1);
    const del = await ask(h, 'DELETE', '/address-changes/old%40example.com');
    expect(del.status).toBe(200);
    expect((await ask(h, 'DELETE', '/address-changes/old%40example.com')).status).toBe(404);
    await stop(h);
    expect(await tablesIn(data)).toEqual([]);
  }, 240_000);
});

// 0168's review, finding 7: removing the file kept its rows, confirmed and
// applied, and editable on the page, so an admin who deleted the file to stop
// the changes still had them.
describe('a file that is gone takes its rows', () => {
  it('deletes the rows the file set at the next start, saying so in one line with no address', async () => {
    const file = JSON.stringify({
      changes: [
        { oldAddress: 'parent@example.com', newAddress: 'parent@example.org' },
        { oldAddress: 'kid.old@example.com', newAddress: 'kid@example.org' },
      ],
    });
    const cfg = configDir(file);
    const data = dataDir();
    let h = await boot(cfg, data);
    expect(((await ask(h, 'GET', '/address-changes')).json.rows as unknown[]).length).toBe(2);
    await stop(h);

    unlinkSync(join(cfg, 'address-changes.json'));
    const said: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => void said.push(args.map(String).join(' ')));
    try {
      h = await boot(cfg, data);
    } finally {
      spy.mockRestore();
    }
    expect(await ask(h, 'GET', '/address-changes')).toMatchObject({ status: 200, json: { rows: [], door: 'page', file: null } });
    const gone = said.filter((l) => l.includes('address-changes.json is gone'));
    expect(gone).toEqual([
      "[selfhost] address changes: address-changes.json is gone, so the 2 address change(s) it set were deleted; this appliance's own page writes them from now on",
    ]);

    // A row the page writes is the page's: the next start keeps it, and says nothing.
    expect((await ask(h, 'POST', '/address-changes', { oldAddress: 'me@example.com', newAddress: 'me@example.org' })).status).toBe(201);
    await stop(h);
    const again: string[] = [];
    const spy2 = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => void again.push(args.map(String).join(' ')));
    try {
      h = await boot(cfg, data);
    } finally {
      spy2.mockRestore();
    }
    expect(((await ask(h, 'GET', '/address-changes')).json.rows as Array<{ setBy: string }>).map((r) => r.setBy)).toEqual(['operator']);
    expect(again.filter((l) => l.includes('is gone'))).toEqual([]);
  }, 240_000);
});

describe('an appliance with no migration yet', () => {
  it('refuses a write, saying so in both languages, de appliance in Dutch (N6)', async () => {
    const h = await boot(configDir(undefined, false));
    const res = await ask(h, 'POST', '/address-changes', { oldAddress: 'a@example.com', newAddress: 'a@example.org' });
    expect(res.status).toBe(400);
    expect(res.json.messageNl).toBe(
      'Deze appliance heeft nog geen migratie, dus er is geen tabel om te wijzigen. Voeg eerst een migratiebestand toe.',
    );
  }, 120_000);
});
