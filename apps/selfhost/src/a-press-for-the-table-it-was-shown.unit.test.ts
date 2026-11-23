// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PRESS FOR THE TABLE IT WAS SHOWN (workplan 0168 D5, the data-path
 * review's S5 (d)): the appliance's half, the same answers as managed's.
 *
 * The real appliance on PGlite, on its page door. The press of *Apply the
 * new addresses here too* names the press digest of the table the page
 * showed; a table that moved since is refused with 409 in English and Dutch,
 * a press that names none with 400, and an unknown migration is a 404. The
 * connectors point at port 1 and the schedule never fires. Addresses are
 * invented.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ADDRESS_TABLE_MOVED, NO_SUCH_MIGRATION_HERE, addressKey, addressTablePressDigest } from '@openmig/shared';
import { start, type SelfhostHandle } from './index.ts';

const TENANT = '0168d5a0-e29b-41d4-a716-446655443201';
const MAPPING = '0168d5a0-e29b-41d4-a716-446655443211';

const tempDirs: string[] = [];
let h: SelfhostHandle | undefined;

afterAll(async () => {
  await h?.stop();
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function configDir(): string {
  const cfg = mkdtempSync(join(tmpdir(), 'ownpace-press-cfg-'));
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
  return cfg;
}

function ask(path: string, body?: unknown, method = 'POST'): Promise<{ status: number; json: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = request(
      {
        host: '127.0.0.1',
        port: h!.port,
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

const ANA = { oldKey: addressKey('ana@old.example.org'), oldAddress: 'ana@old.example.org', newAddress: 'ana@example.org' };
const APPLY = `/mappings/${MAPPING}/address-changes/apply`;

describe('the appliance’s press for the table it was shown', () => {
  it('refuses a press that names no table, in both languages', async () => {
    const data = mkdtempSync(join(tmpdir(), 'ownpace-press-db-'));
    tempDirs.push(data);
    h = await start({ persistence: 'pglite', pgliteDataDir: data, configDir: configDir(), port: 0, host: '127.0.0.1' });
    const res = await ask(APPLY);
    expect(res.status).toBe(400);
    expect(res.json).toMatchObject({ error: 'digest_required' });
    expect(res.json.messageNl).toEqual(expect.any(String));
  }, 120_000);

  it('refuses with 409 a press for a table that moved since the page showed it', async () => {
    // The page showed the empty table; a row was added after it rendered.
    const shown = addressTablePressDigest([]);
    expect((await ask('/address-changes', { oldAddress: ANA.oldAddress, newAddress: ANA.newAddress })).status).toBe(201);
    const res = await ask(APPLY, { digest: shown });
    expect(res.status).toBe(409);
    expect(res.json).toMatchObject({
      error: 'address_table_moved',
      message: ADDRESS_TABLE_MOVED.en,
      messageNl: ADDRESS_TABLE_MOVED.nl,
      digest: addressTablePressDigest([ANA]),
      rows: 1,
    });
  });

  it('records the press for the table as the page showed it', async () => {
    const shown = addressTablePressDigest([ANA]);
    const res = await ask(APPLY, { digest: shown });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ id: MAPPING, applied: true, digest: shown, rows: 1 });
  });

  it('answers 404 for a migration it does not have, with a sentence in both languages (0168)', async () => {
    const res = await ask('/mappings/no-such-mapping/address-changes/apply', { digest: addressTablePressDigest([ANA]) });
    expect(res.status).toBe(404);
    // It carried a code and no sentence; managed's says one in both languages.
    expect(res.json).toMatchObject({
      message: NO_SUCH_MIGRATION_HERE.en,
      messageNl: NO_SUCH_MIGRATION_HERE.nl,
    });
  });
});
