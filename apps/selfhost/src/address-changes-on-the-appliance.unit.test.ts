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
 *    and what is wrong.
 *
 * The connectors point at port 1 and the schedule never fires. Addresses are
 * invented.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { start, type SelfhostHandle } from './index.ts';

const TENANT = '0168a2f0-e29b-41d4-a716-446655443201';
const MAPPING = '0168a2f0-e29b-41d4-a716-446655443211';

const tempDirs: string[] = [];
const handles: SelfhostHandle[] = [];

afterAll(async () => {
  for (const h of handles) await h.stop();
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function configDir(addressFile?: string): string {
  const cfg = mkdtempSync(join(tmpdir(), 'ownpace-address-cfg-'));
  tempDirs.push(cfg);
  const dav = {
    type: 'carddav',
    url: 'http://127.0.0.1:1/remote.php/dav',
    user: 'nobody',
    auth: { kind: 'login', passwordFromEnv: 'OPENMIG_TEST_NOPE' },
  };
  writeFileSync(
    join(cfg, 'contacts.json'),
    JSON.stringify({
      tenantId: TENANT,
      mappingId: MAPPING,
      schedule: { cron: '0 5 31 2 *' }, // 31 February: valid, never fires.
      source: dav,
      target: dav,
      domains: { contacts: { enabled: true, source: dav, target: dav } },
    }),
  );
  if (addressFile !== undefined) writeFileSync(join(cfg, 'address-changes.json'), addressFile);
  return cfg;
}

async function boot(cfg: string): Promise<SelfhostHandle> {
  const data = mkdtempSync(join(tmpdir(), 'ownpace-address-db-'));
  tempDirs.push(data);
  const h = await start({ persistence: 'pglite', pgliteDataDir: data, configDir: cfg, port: 0, host: '127.0.0.1' });
  handles.push(h);
  return h;
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
        res.on('end', () => resolve({ status: res.statusCode ?? 0, json: JSON.parse(text) }));
      },
    );
    req.on('error', reject);
    req.end(payload);
  });
}

describe('the page door, without address-changes.json', () => {
  let h: SelfhostHandle;

  it('starts with an empty table, on the page', async () => {
    h = await boot(configDir());
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
