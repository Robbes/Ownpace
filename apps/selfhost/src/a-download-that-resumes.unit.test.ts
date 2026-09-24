// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A DOWNLOAD THAT RESUMES (workplan 0129 T4; the owner's D4: "a download
 * endpoint that resumes where the last one stopped, for backfill"), on the
 * real appliance on PGlite: `GET /audit-export`.
 *
 * What a log store gets from it: the lines the appliance prints, oldest first,
 * naming nobody; `Ownpace-Next-After` to resume from, which is the last line's
 * own `Timestamp` and id, so the newest line a store holds resumes it just as
 * well; and a refusal by name for a cursor or a page size that is not one.
 *
 * The audit events are written into the appliance's database between two
 * boots, the way `a-data-type-switched-off` writes its copies. The addresses and
 * names are invented. The connectors point at port 1 and the schedule never
 * fires.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deploymentKeyFor, pgliteDriver } from '@openmig/ledger';
import { AUDIT_PSEUDONYM_PURPOSE, pseudonymizer } from '@openmig/shared';
import { start, type SelfhostHandle } from './index.ts';

const TENANT = '00000000-0000-4000-8000-000000000590';
const MAPPING = '59595959-5959-4595-8595-595959595959';
const id = (n: number) => `0e129200-e29b-41d4-a716-44665544000${n}`;
const EVENTS = [
  { id: id(1), at: '2026-09-01T10:00:00.000001Z' },
  { id: id(2), at: '2026-09-02T10:00:00.000002Z' },
  { id: id(3), at: '2026-09-03T10:00:00.000003Z' },
];

const tempDirs: string[] = [];
let handle: SelfhostHandle;
let base: string;
/** Jan's pseudonym under this appliance's own key, read while it was stopped. */
let jan: string;

async function boot(cfg: string, data: string): Promise<SelfhostHandle> {
  return start({ persistence: 'pglite', pgliteDataDir: data, configDir: cfg, port: 0, host: '127.0.0.1' });
}

beforeAll(async () => {
  const cfg = mkdtempSync(join(tmpdir(), 'ownpace-download-cfg-'));
  const data = mkdtempSync(join(tmpdir(), 'ownpace-download-db-'));
  tempDirs.push(cfg, data);
  const dav = {
    type: 'caldav',
    url: 'http://127.0.0.1:1/remote.php/dav',
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
  // The first boot makes the organisation; its events are written while the
  // appliance is stopped, as the database's own user.
  await (await boot(cfg, data)).stop();
  const driver = pgliteDriver({ dataDir: data });
  const conn = await driver.acquire();
  try {
    for (const e of EVENTS) {
      await conn.query(
        `INSERT INTO audit_log (id, tenant_id, actor, action, entity, detail, at)
         VALUES ($1, $2, 'jan@example.invalid', 'share.decided', 'share_grant', $3, $4)`,
        [e.id, TENANT, JSON.stringify({ mappingId: MAPPING, on: 'Salaries 2026.xlsx' }), e.at],
      );
    }
  } finally {
    conn.release();
  }
  try {
    jan = pseudonymizer(await deploymentKeyFor(driver, AUDIT_PSEUDONYM_PURPOSE))('jan@example.invalid');
  } finally {
    await driver.end();
  }
  handle = await boot(cfg, data);
  base = `http://127.0.0.1:${handle.port}`;
}, 180_000);

afterAll(async () => {
  await handle?.stop();
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

type Line = { Timestamp: string; Body: string; Attributes: Record<string, unknown>; Resource: Record<string, unknown> };

async function page(query = ''): Promise<{ status: number; lines: Line[]; next: string | null; caughtUp: string | null; type: string | null; text: string }> {
  const res = await fetch(`${base}/audit-export${query}`);
  const text = await res.text();
  const lines = res.status === 200 ? text.split('\n').filter(Boolean).map((l) => JSON.parse(l) as Line) : [];
  return {
    status: res.status,
    lines,
    next: res.headers.get('ownpace-next-after'),
    caughtUp: res.headers.get('ownpace-caught-up'),
    type: res.headers.get('content-type'),
    text,
  };
}

describe('GET /audit-export', () => {
  it('serves the lines the appliance prints, oldest first, naming nobody', async () => {
    const got = await page();

    expect(got.status).toBe(200);
    expect(got.type).toMatch(/^application\/x-ndjson/);
    expect(got.lines.map((l) => l.Attributes['ownpace.audit.id'])).toEqual(EVENTS.map((e) => e.id));
    for (const line of got.lines) {
      expect(line.Body).toBe('share.decided');
      expect(line.Resource).toEqual({ 'service.name': 'ownpace-appliance' });
      // The deployment's own key, the one the stream uses: the same person is
      // the same pseudonym in both.
      expect(line.Attributes['ownpace.audit.actor']).toBe(jan);
    }
    expect(got.text).not.toContain('jan@example.invalid');
    expect(got.text).not.toContain('Salaries');
    expect(got.caughtUp).toBe('true');
    const last = got.lines.at(-1)!;
    expect(got.next).toBe(`${last.Timestamp}-${last.Attributes['ownpace.audit.id'] as string}`);
  });

  it('resumes where it stopped, a page at a time, until it has caught up', async () => {
    const seen: unknown[] = [];
    let cursor = '';
    let last: Awaited<ReturnType<typeof page>> | undefined;
    for (let n = 0; n < 10; n++) {
      last = await page(`?limit=1&after=${encodeURIComponent(cursor)}`);
      seen.push(...last.lines.map((l) => l.Attributes['ownpace.audit.id']));
      if (last.caughtUp === 'true') break;
      cursor = last.next ?? '';
    }

    expect(seen).toEqual(EVENTS.map((e) => e.id));
    // Caught up with nothing new, it hands the same cursor back: the next
    // download starts there.
    expect(last?.lines).toEqual([]);
    expect(last?.next).toBe(cursor);
  });

  it('resumes as well from the newest line a store already holds', async () => {
    const [, second] = (await page()).lines;

    const rest = await page(`?after=${second!.Timestamp}-${second!.Attributes['ownpace.audit.id'] as string}`);

    expect(rest.lines.map((l) => l.Attributes['ownpace.audit.id'])).toEqual([EVENTS[2]!.id]);
  });

  it('refuses a cursor or a page size that is not one, by name', async () => {
    const cases = [
      ['?after=yesterday', 'after'],
      ['?limit=0', 'limit'],
      ['?limit=10001', 'limit'],
      ['?limit=many', 'limit'],
    ] as const;
    for (const [query, field] of cases) {
      const got = await page(query);
      expect(got.status, query).toBe(400);
      expect((JSON.parse(got.text) as { field: string }).field, query).toBe(field);
    }
    // The largest page there is, and the smallest.
    expect((await page('?limit=10000')).status).toBe(200);
    expect((await page('?limit=1')).status).toBe(200);
  });
});
