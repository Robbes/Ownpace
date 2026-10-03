// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * OF ABOUT HOW MANY, ON THE APPLIANCE (workplan 0154 T2), on the real
 * appliance on PGlite.
 *
 * `/status` is what every appliance page polls, and its rows said how many had
 * arrived and not of how many. Each now carries what discovery found of it
 * (`itemsFound`, `bytesFound`), from the counts `/discovery` serves, so Review
 * & confirm and a migration's page set the copies against them as managed's
 * pages do. What a total means is the shared test's business
 * (`a-count-with-no-total.unit.test.ts`); here it is the wiring.
 *
 * The connectors point at port 1 and the schedule never fires: discovery at
 * start-up fails, and keeps the counts written here, as it keeps any count
 * from before an error.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pgliteDriver } from '@openmig/ledger';
import { start, type SelfhostHandle } from './index.ts';
import { mappingSeed, uuidFromString } from './config-dir.ts';

const tempDirs: string[] = [];
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

// UUID family 0154a300-…, unused elsewhere in the repo.
const TENANT = '0154a300-e29b-41d4-a716-446655440001';
const MAPPING = '0154a300-e29b-41d4-a716-446655440002';
const ROW = uuidFromString(mappingSeed(TENANT, MAPPING));

const dav = (type: 'caldav' | 'carddav') => ({
  enabled: true,
  source: {
    type,
    url: 'http://127.0.0.1:1/remote.php/dav',
    user: 'source',
    auth: { kind: 'login', passwordFromEnv: 'OPENMIG_TEST_NOPE' },
  },
  target: {
    type,
    url: 'http://127.0.0.1:1/remote.php/dav',
    user: 'target',
    auth: { kind: 'login', passwordFromEnv: 'OPENMIG_TEST_NOPE' },
  },
});

/** Calendars and contacts, both on. */
function configDir(): string {
  const dir = tempDir('ownpace-totals-cfg-');
  writeFileSync(
    join(dir, 'mapping.json'),
    JSON.stringify({
      tenantId: TENANT,
      mappingId: MAPPING,
      schedule: { cron: '0 5 31 2 *' }, // 31 February: valid, never fires.
      source: dav('caldav').source,
      target: dav('caldav').target,
      domains: { calendar: dav('caldav'), contacts: dav('carddav') },
    }),
  );
  return dir;
}

async function boot(cfg: string, dataDir: string): Promise<{ handle: SelfhostHandle; base: string }> {
  const handle = await start({ persistence: 'pglite', pgliteDataDir: dataDir, configDir: cfg, port: 0, host: '127.0.0.1' });
  return { handle, base: `http://127.0.0.1:${handle.port}` };
}

async function asTheDatabase(dataDir: string, text: string, params: unknown[] = []) {
  const driver = pgliteDriver({ dataDir });
  const conn = await driver.acquire();
  try {
    return (await conn.query(text, params)).rows as Array<Record<string, unknown>>;
  } finally {
    conn.release();
    await driver.end();
  }
}

type Row = { domain: string; itemsSynced: number; itemsFound?: number; bytesFound?: number };

describe('/status on the appliance — of about how many', () => {
  it('sets each data type beside what discovery found of it, and gives none a count nobody took', async () => {
    const cfg = configDir();
    const dataDir = tempDir('ownpace-totals-db-');
    // The first boot writes the tenant and the migration's row.
    let booted = await boot(cfg, dataDir);
    await booted.handle.stop();

    // A pass has reported for both data types.
    for (const domain of ['calendar', 'contact']) {
      await asTheDatabase(
        dataDir,
        `INSERT INTO migration_status (tenant_id, mapping_id, domain, state) VALUES ($1,$2,$3,'in_progress')
         ON CONFLICT (tenant_id, mapping_id, domain) DO NOTHING`,
        [TENANT, ROW, domain],
      );
    }
    // Discovery counted the calendars; its only attempt at the contacts failed.
    const discovered = async (domain: string, items: number, bytes: number, lastError: string | null) =>
      asTheDatabase(
        dataDir,
        `INSERT INTO migration_discovery (tenant_id, mapping_id, domain, collections, items, bytes, last_error)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (tenant_id, mapping_id, domain)
         DO UPDATE SET collections = EXCLUDED.collections, items = EXCLUDED.items, bytes = EXCLUDED.bytes,
                       last_error = EXCLUDED.last_error`,
        [TENANT, ROW, domain, items > 0 ? 2 : 0, items, bytes, lastError],
      );
    await discovered('calendar', 1_204, 2_000_000, null);
    await discovered('contact', 0, 0, 'ECONNREFUSED 127.0.0.1:1');

    booted = await boot(cfg, dataDir);
    try {
      const body = (await (await fetch(`${booted.base}/status`)).json()) as {
        mappings: Array<{ mappingId: string; domains: Row[] }>;
      };
      const rows = Object.fromEntries(
        (body.mappings.find((m) => m.mappingId === MAPPING)?.domains ?? []).map((r) => [r.domain, r]),
      );
      expect(rows.calendar).toMatchObject({ itemsSynced: 0, itemsFound: 1_204, bytesFound: 2_000_000 });
      // Hard rule 9: a count nobody took is absent, never 0.
      expect(rows.contact).toBeDefined();
      expect(rows.contact && 'itemsFound' in rows.contact).toBe(false);
      expect(rows.contact && 'bytesFound' in rows.contact).toBe(false);

      // And the report says the same (0154 T5): found beside what arrived.
      const report = (await (await fetch(`${booted.base}/mappings/${MAPPING}/completion-report`)).json()) as {
        report: { domains: Row[] };
        markdown: string;
      };
      const lines = Object.fromEntries(report.report.domains.map((r) => [r.domain, r]));
      expect(lines.calendar).toMatchObject({ itemsSynced: 0, itemsFound: 1_204 });
      expect(lines.contact && 'itemsFound' in lines.contact).toBe(false);
      expect(report.markdown).toContain('| found | left as it was |');
    } finally {
      await booted.handle.stop();
    }
  }, 120_000);
});
