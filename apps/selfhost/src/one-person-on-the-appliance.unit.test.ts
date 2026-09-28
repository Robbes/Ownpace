// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * ONE PERSON ON THE APPLIANCE (ADR-0050, amended by the owner on 2026-09-28;
 * workplan 0153 T2).
 *
 * The managed API answers `GET /api/people` from its tables. The appliance
 * moves one person and has no table: it answers `GET /people` in the same
 * shapes (ADR-0026), with one implicit person whose migrations are every one
 * its config directory holds, in the order it lists them. Its writes are
 * refused with the reason, not a 404: there is nobody to add or delete.
 *
 * The real appliance on PGlite. The connectors point at port 1 and the
 * schedule never fires; the names are invented.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IMPLICIT_PERSON_ID, implicitPeople, ONE_PERSON_HERE } from '@openmig/shared';
import { start, type SelfhostHandle } from './index.ts';

const TENANT = '0153a2d0-e29b-41d4-a716-446655443201';
/** Written in the other order below: the answer follows the directory's listing, by file name. */
const CALENDAR = '0153a2d0-e29b-41d4-a716-446655443211';
const CONTACTS = '0153a2d0-e29b-41d4-a716-446655443212';

const tempDirs: string[] = [];
let handle: SelfhostHandle;

beforeAll(async () => {
  const cfg = mkdtempSync(join(tmpdir(), 'ownpace-people-cfg-'));
  const data = mkdtempSync(join(tmpdir(), 'ownpace-people-db-'));
  tempDirs.push(cfg, data);
  const dav = {
    type: 'caldav',
    url: 'http://127.0.0.1:1/remote.php/dav',
    user: 'nobody',
    auth: { kind: 'login', passwordFromEnv: 'OPENMIG_TEST_NOPE' },
  };
  for (const [file, mappingId] of [
    ['b-contacts.json', CONTACTS],
    ['a-calendar.json', CALENDAR],
  ] as const) {
    writeFileSync(
      join(cfg, file),
      JSON.stringify({
        tenantId: TENANT,
        mappingId,
        schedule: { cron: '0 5 31 2 *' }, // 31 February: valid, never fires.
        source: dav,
        target: dav,
        domains: { calendar: { enabled: true, source: dav, target: dav } },
      }),
    );
  }
  handle = await start({ persistence: 'pglite', pgliteDataDir: data, configDir: cfg, port: 0, host: '127.0.0.1' });
}, 120_000);

afterAll(async () => {
  await handle?.stop();
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function ask(method: string, path: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = request(
      {
        host: '127.0.0.1',
        port: handle.port,
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

describe('GET /people', () => {
  it('answers one implicit person, whose migrations are every one configured, in the directory’s order', async () => {
    const res = await ask('GET', '/people');

    expect(res.status).toBe(200);
    expect(res.json).toEqual(
      implicitPeople([
        { id: CALENDAR, status: 'paused' },
        { id: CONTACTS, status: 'paused' },
      ]),
    );
  });

  it('is the managed shape: no name, no address, nobody unassigned, and the states counted', async () => {
    const res = await ask('GET', '/people');
    const [person] = res.json.people as Array<Record<string, unknown>>;

    expect(person).toMatchObject({
      id: IMPLICIT_PERSON_ID,
      implicit: true,
      displayName: null,
      email: null,
      createdAt: null,
    });
    expect(person!.counts).toMatchObject({ paused: 2, active: 0, cutover: 0, done: 0, continuous: 0 });
    expect(res.json.unassigned).toEqual([]);
  });
});

describe('the writes the managed edition answers', () => {
  it.each([
    ['POST', '/people', { displayName: 'Anna' }],
    ['POST', `/people/${IMPLICIT_PERSON_ID}/migrations`, { mappingId: CALENDAR }],
    ['DELETE', `/people/${IMPLICIT_PERSON_ID}`, undefined],
  ])('%s %s is refused with the reason, and changes nothing', async (method, path, body) => {
    const res = await ask(method, path, body);

    expect(res.status).toBe(409);
    expect(res.json.error).toBe(ONE_PERSON_HERE);
    expect(res.json.message).toMatch(/moves one person/);
    const after = await ask('GET', '/people');
    expect((after.json.people as unknown[]).length).toBe(1);
  });
});
