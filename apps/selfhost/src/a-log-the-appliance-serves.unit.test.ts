// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A LOG THE APPLIANCE SERVES (workplan 0129 T2, the appliance's half; the
 * owner's D5: "same page").
 *
 * `GET /log` over the real server, on PGlite, the way `runs-route` proves the
 * run history: a REAL pass against connectors that point at port 1 fails the
 * email domain honestly, and the failure it records is what the route must
 * then serve. The reader's own rules are held in the ledger
 * (`a-log-the-appliance-can-read`); this holds the route:
 *
 *  - a filter of the wrong shape is refused by name, as managed refuses it;
 *  - the failure a pass just recorded is served, with its reference;
 *  - the migration is named as the appliance's screens name it, by the
 *    mapping's `name`, not by the slug its row holds.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OperatorLogPage } from '@openmig/shared';
import { start, type SelfhostHandle } from './index.ts';
import { mappingSeed, uuidFromString } from './config-dir.ts';

/** Registered so each one is removed: a PGlite data directory is 41MB (see `runs-route`). */
const tempDirs: string[] = [];
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

const TENANT = '0e320000-e29b-41d4-a716-446655440001';
const MAPPING = '0e320000-e29b-41d4-a716-4466554400ee';
const ROW_ID = uuidFromString(mappingSeed(TENANT, MAPPING));

let handle: SelfhostHandle;
let base: string;

beforeAll(async () => {
  const configDir = tempDir('ownpace-log-cfg-');
  writeFileSync(
    join(configDir, 'mapping.json'),
    JSON.stringify({
      tenantId: TENANT,
      mappingId: MAPPING,
      name: 'Finance mail',
      schedule: { cron: '0 5 31 2 *' }, // 31 February: valid, never fires.
      source: {
        type: 'imap-oauth2',
        host: '127.0.0.1',
        port: 1,
        user: 'nobody@invalid',
        auth: { kind: 'login', passwordFromEnv: 'OPENMIG_TEST_NOPE' },
      },
      target: {
        type: 'jmap',
        baseUrl: 'http://127.0.0.1:1',
        user: 'nobody@invalid',
        auth: { kind: 'basic', passwordFromEnv: 'OPENMIG_TEST_NOPE' },
      },
    }),
  );

  handle = await start({
    persistence: 'pglite',
    pgliteDataDir: tempDir('ownpace-log-db-'),
    configDir,
    port: 0,
    host: '127.0.0.1',
  });
  base = `http://127.0.0.1:${handle.port}`;
}, 120_000);

afterAll(async () => {
  await handle?.stop();
});

describe('GET /log', () => {
  it('refuses a filter of the wrong shape by name, as managed does', async () => {
    const res = await fetch(`${base}/log?level=loud`);

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ field: 'level' });
  });

  it('serves the failure a real pass just recorded, named as its screens name the migration', async () => {
    expect((await fetch(`${base}/mappings/${MAPPING}/start`, { method: 'POST' })).status).toBe(200);
    expect((await fetch(`${base}/mappings/${MAPPING}/run`, { method: 'POST' })).status).toBe(200);

    const res = await fetch(`${base}/log?level=error&event=sync.email`);
    expect(res.status).toBe(200);
    const page = (await res.json()) as OperatorLogPage;

    const failed = page.entries.find((e) => e.event === 'sync.email.failed');
    expect(failed).toMatchObject({
      source: 'app',
      level: 'error',
      tenant_id: TENANT,
      mapping_id: ROW_ID,
      migration_name: 'Finance mail',
      actor: null,
    });
    expect(failed?.reference).toMatch(/^[0-9a-f]{8}$/);
    expect(page.limit).toBe(100);
  });

  it('narrows to that migration by the id the row carries', async () => {
    const page = (await (await fetch(`${base}/log?mappingId=${ROW_ID}`)).json()) as OperatorLogPage;

    expect(page.entries.length).toBeGreaterThan(0);
    expect(page.entries.every((e) => e.mapping_id === ROW_ID)).toBe(true);
  });
});

/**
 * An answer a page could not read (workplan 0145, the owner's "Log it"): the
 * page sends the reference it showed its reader, and the log page finds the
 * report by it, on this real server, as managed's does.
 */
describe('POST /unreadable-answers', () => {
  const report = (reference: string) => ({
    reference,
    code: 'invalid_value',
    path: '2.domains.2',
    page: '/ui/mappings',
    build: { version: '0.3.1', commit: 'abc1234def5678abc1234def5678abc1234def56' },
  });
  const send = (body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}/unreadable-answers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });

  it('keeps it on the log page under the reference the page showed', async () => {
    expect((await send(report('5e5e5e5e'))).status).toBe(204);

    // Recorded without holding the page's request open: look until it lands.
    let found: OperatorLogPage['entries'][number] | undefined;
    for (let i = 0; i < 50 && !found; i += 1) {
      const page = (await (await fetch(`${base}/log?reference=5e5e5e5e`)).json()) as OperatorLogPage;
      found = page.entries.find((e) => e.reference === '5e5e5e5e');
      if (!found) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(found).toMatchObject({ source: 'app', level: 'error', event: 'web.answer_unreadable' });
  });

  it('refuses one with no reference to keep it under', async () => {
    const res = await send({ ...report('5e5e5e5e'), reference: 'nope' });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_report' });
  });

  it('is a write, refused when a page on another site sends it', async () => {
    expect((await send(report('6f6f6f6f'), { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
  });
});
