// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A FAULT THE APPLIANCE ANSWERS WITH A REFERENCE, NOT WITH ITS MESSAGE
 * (workplan 0168), on the real appliance on PGlite.
 *
 * The appliance answered every request that threw with `{ error: err.message }`,
 * and a database error's message says the statement's values: Drizzle's ends
 * `params: <values>`. Asked to set aside a decision whose id is not one, it
 * answered with the id it was sent, the organisation's and the rest of the
 * statement's values, and printed them in its log. It now answers as the API's
 * `serverFault` does: a sentence with a reference, in the `error` field its
 * screens read, and the same reference in the log line and on its log page.
 *
 * The connectors name a host that cannot resolve, and the schedule never fires.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatWithOptions } from 'node:util';
import { start, type SelfhostHandle } from './index.ts';

const TENANT = '00000000-0000-4000-8000-000000000681';
const MAPPING = '68686868-6868-4686-8686-686868686868';
/** Not a decision's id: an address, as somebody might paste one. */
const ADDRESS = 'someone-s1@example.com';

const tempDirs: string[] = [];
let handle: SelfhostHandle;
let base: string;

beforeAll(async () => {
  const cfg = mkdtempSync(join(tmpdir(), 'ownpace-fault-cfg-'));
  const data = mkdtempSync(join(tmpdir(), 'ownpace-fault-db-'));
  tempDirs.push(cfg, data);
  const dav = {
    type: 'caldav',
    url: 'https://dav.example.invalid/remote.php/dav',
    user: 'nobody',
    auth: { kind: 'login', passwordFromEnv: 'OPENMIG_TEST_NOPE' },
  };
  writeFileSync(
    join(cfg, 'mapping.json'),
    JSON.stringify({
      tenantId: TENANT,
      mappingId: MAPPING,
      schedule: { cron: '0 5 31 2 *' }, // 31 February: valid, never fires.
      source: dav,
      target: dav,
      domains: { calendar: { enabled: true, source: dav, target: dav } },
    }),
  );
  handle = await start({ persistence: 'pglite', pgliteDataDir: data, configDir: cfg, port: 0, host: 'localhost' });
  base = `http://localhost:${handle.port}`;
}, 120_000);

afterAll(async () => {
  await handle?.stop();
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

describe('a request the appliance fails on', () => {
  it('is answered 500 with a sentence and a reference, and logged under that reference without a value', async () => {
    const lines: string[] = [];
    const printed = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      lines.push(formatWithOptions({ depth: Infinity }, ...args));
    });
    let res: Response;
    try {
      res = await fetch(`${base}/decisions/${encodeURIComponent(ADDRESS)}/dismiss`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
    } finally {
      printed.mockRestore();
    }

    // The status and the field the appliance's screens read are as they were.
    expect(res.status).toBe(500);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(['error']);
    const error = String(body.error);
    const ref = /Reference ([0-9a-f]{8})/.exec(error)?.[1];
    expect(ref, `the answer carries no reference: ${error}`).toBeTruthy();
    expect(error).toContain('not something your input caused');
    expect(error).not.toMatch(/Failed query|params|someone-s1/);

    // The line says which request and which statement failed, under the same
    // reference; the address in it is the request's own path, as sent.
    const line = lines.join('\n');
    expect(line).toContain(`[selfhost] POST /decisions/someone-s1%40example.com/dismiss failed [ref ${ref}]:`);
    expect(line).toContain('Failed query: update "decision"');
    expect(line).toContain('params: [redacted]');
    expect(line, 'the log printed the statement’s values').not.toContain(ADDRESS);

    // And the log page finds it by the reference.
    let page = '';
    for (let i = 0; i < 50 && !page.includes(ref!); i++) {
      page = await (await fetch(`${base}/log`)).text();
      if (!page.includes(ref!)) await new Promise((r) => setTimeout(r, 100));
    }
    expect(page, 'the reference is not on the log page').toContain(ref);
  });
});
