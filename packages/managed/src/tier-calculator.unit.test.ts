// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The third copy of the numbers, held to the first two (workplan 0109 T4).
 *
 * Three guards, because the drift this project has caught twice must not
 * arrive in the copy that costs money:
 *
 *  1. **ADR parity** — the same structurally-identical parse of ADR-0014's
 *     own Markdown table that `site/site.unit.test.ts` runs, against
 *     `MANAGED_TIERS`. A price change flows through the ADR or turns red.
 *  2. **Agreement with the site** — `site/calculator.mjs` cannot be imported
 *     by managed CODE (site depends on nothing in the workspace, 0086 T7),
 *     but a TEST may read both: the two derivations are driven over a grid
 *     spanning every boundary and must answer identically, tier and axis.
 *  3. **The live derivation** — `currentTier` against PGlite: the peak axis
 *     comes from `occupancy_peak` WITH T2's true-up (a standing fleet in a
 *     quiet month is counted the moment somebody asks — the documented gap,
 *     closed here), the data axis from `bytes_moved`'s total, and the answer
 *     carries the evidence the invoice will quote.
 *
 * UUID family 01940000-…, unused elsewhere in the repo.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pgliteDriver, runMigrations, withTenant } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import type { TenantId } from '@openmig/shared';
import { runManagedMigrations } from './migrate-managed.ts';
import {
  MANAGED_TIERS,
  GB_PER_TB,
  deriveTier,
  observedTier,
  currentTier,
} from './tier-calculator.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');

/** The ADR's own spelling of a data ceiling — the same formatter the site guards with. */
const size = (gb: number): string => (gb >= GB_PER_TB ? `${gb / GB_PER_TB} TB` : `${gb} GB`);

/** Parse ADR-0014's tier table — structurally identical to site/site.unit.test.ts. */
function tiersFromAdr(): Map<string, { paths: number; data: string; setup: number; monthly: number }> {
  const adr = readFileSync(join(repoRoot, 'docs/adr/0014-cost-recovery-billing.md'), 'utf8');
  const rows = adr
    .split('\n')
    .filter((l) => /^\|\s*\*\*(Tiny|Small|Medium|Large|Extra large)\*\*/.test(l));
  expect(rows.length, 'ADR-0014 no longer has a five-row tier table').toBe(5);

  const out = new Map<string, { paths: number; data: string; setup: number; monthly: number }>();
  for (const row of rows) {
    const c = row
      .split('|')
      .slice(1, -1)
      .map((x) => x.trim());
    const name = c[0]!.replace(/\*\*/g, '');
    out.set(name.toLowerCase(), {
      paths: Number(c[2]),
      data: c[3]!,
      setup: Number(c[4]!.replace(/[^0-9]/g, '')),
      monthly: Number(c[5]!.replace(/[^0-9]/g, '')),
    });
  }
  return out;
}

describe('the managed tiers agree with the decision that set them (ADR parity)', () => {
  it('matches ADR-0014 tier for tier', () => {
    const adr = tiersFromAdr();
    expect(MANAGED_TIERS.length).toBe(adr.size);
    for (const t of MANAGED_TIERS) {
      const a = adr.get(t.name.toLowerCase());
      expect(a, `ADR-0014 has no row for "${t.name}"`).toBeDefined();
      const where = `${t.name}: tier-calculator.ts disagrees with ADR-0014`;
      expect(t.paths, `${where} on paths at the same time`).toBe(a!.paths);
      expect(t.setup, `${where} on the setup fee`).toBe(a!.setup);
      expect(t.monthly, `${where} on the monthly`).toBe(a!.monthly);
      expect(size(t.dataGb), `${where} on the data ceiling`).toBe(a!.data);
    }
  });
});

describe('the managed derivation agrees with the site, everywhere', () => {
  it('answers identically over a grid spanning every boundary', async () => {
    // prices.mjs refuses to load without the app URL (its own guard against a
    // build that forgets); the OTA test value is what its refusal names.
    process.env.OWNPACE_APP_URL ??= 'https://app.ota.ownpace.eu';
    const site = (await import(
      /* @vite-ignore */ join(repoRoot, 'site', 'calculator.mjs')
    )) as {
      deriveTier: (
        tiers: unknown[],
        paths: number,
        gb: number,
      ) => { tier: { id?: string } | null; decidedBy: string };
    };
    const { TIERS } = (await import(
      /* @vite-ignore */ join(repoRoot, 'site', 'prices.mjs')
    )) as { TIERS: unknown[] };

    const pathPoints = [0, 1, 2, 4, 5, 19, 20, 21, 50, 51, 199, 200, 201];
    const gbPoints = [0, 1, 249, 250, 251, 749, 750, 751, 1999, 2000, 2001, 7500, 7501, 15000, 15001];
    for (const paths of pathPoints) {
      for (const gb of gbPoints) {
        const ours = deriveTier(paths, gb);
        const theirs = site.deriveTier(TIERS, paths, gb);
        const at = `paths=${paths}, gb=${gb}`;
        expect(ours.tier?.id ?? null, `tier disagrees at ${at}`).toBe(theirs.tier?.id ?? null);
        expect(ours.decidedBy, `decidedBy disagrees at ${at}`).toBe(theirs.decidedBy);
      }
    }
  });
});

describe('observedTier — the read-only twin', () => {
  it('answers exactly as deriveTier over the higher peak, and says which number it used', () => {
    // The whole contract: fold the live count in the way the true-up would
    // have written it, and derive. Driven over the same boundary grid as the
    // site parity, with recorded and live crossed both ways round — the twin
    // must not care which of the two is the higher one.
    const pathPoints = [0, 1, 2, 4, 5, 20, 21, 200, 201];
    const gbPoints = [0, 250, 251, 2000, 15000, 15001];
    for (const recorded of pathPoints) {
      for (const now of pathPoints) {
        for (const gb of gbPoints) {
          const observed = observedTier(recorded, now, gb);
          const effective = Math.max(recorded, now);
          const derived = deriveTier(effective, gb);
          const at = `recorded=${recorded}, now=${now}, gb=${gb}`;
          expect(observed.tier?.id ?? null, `tier disagrees at ${at}`).toBe(
            derived.tier?.id ?? null,
          );
          expect(observed.decidedBy, `decidedBy disagrees at ${at}`).toBe(derived.decidedBy);
          expect(observed.evidence.peakPaths, `evidence peak at ${at}`).toBe(effective);
          expect(observed.evidence.gbMoved, `evidence gb at ${at}`).toBe(gb);
        }
      }
    }
  });

  it('carries no peakAt — it records nothing, so it cannot date a mark', () => {
    // When the live count IS the higher number, the moment it becomes the
    // month's mark is when something writes it down; a date invented here
    // would be evidence of an event that has not happened.
    expect(observedTier(1, 3, 0).evidence.peakAt).toBeUndefined();
  });
});

describe('currentTier — the live derivation, with its evidence', () => {
  const TENANT = '01940000-e29b-41d4-a716-446655442001';
  const CONN = '01940000-e29b-41d4-a716-446655442051';
  const BOX = '01940000-e29b-41d4-a716-446655442071';
  const MAPPING = '01940000-e29b-41d4-a716-446655442101';

  let driver: LedgerDriver;

  beforeAll(async () => {
    driver = pgliteDriver({ role: 'app_user' });
    await runMigrations({ driver, logger: () => {} });
    await runManagedMigrations({ driver, logger: () => {} });

    const conn = await driver.acquire();
    try {
      const q = (sql: string, p: unknown[] = []) => conn.query(sql, p);
      await q(`INSERT INTO tenant (id, name, status) VALUES ($1,'T','active')`, [TENANT]);
      await q(
        `INSERT INTO connection (id, tenant_id, role, kind, display_name)
         VALUES ($1,$2,'source','imap','i')`,
        [CONN, TENANT],
      );
      await q(
        `INSERT INTO mailbox (id, tenant_id, connection_id, external_id)
         VALUES ($1,$2,$3,'box')`,
        [BOX, TENANT, CONN],
      );
      await q(
        `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status)
         VALUES ($1,$2,$3,'active')`,
        [MAPPING, TENANT, BOX],
      );
    } finally {
      conn.release();
    }
  }, 120_000);

  afterAll(async () => {
    await driver?.end();
  });

  beforeEach(async () => {
    const conn = await driver.acquire();
    try {
      await conn.query('DELETE FROM occupancy_peak');
      await conn.query('DELETE FROM bytes_moved');
      await conn.query('DELETE FROM path_lifecycle');
    } finally {
      conn.release();
    }
  });

  async function seedPaths(states: ReadonlyArray<[domain: string, state: string]>): Promise<void> {
    const conn = await driver.acquire();
    try {
      for (const [domain, state] of states) {
        await conn.query(
          `INSERT INTO path_lifecycle (tenant_id, mapping_id, domain, state, first_activated_at)
           VALUES ($1,$2,$3,$4,now())`,
          [TENANT, MAPPING, domain, state],
        );
      }
    } finally {
      conn.release();
    }
  }

  async function seedBytes(bytes: number): Promise<void> {
    const conn = await driver.acquire();
    try {
      await conn.query(`INSERT INTO bytes_moved (tenant_id, bytes) VALUES ($1,$2)`, [
        TENANT,
        bytes,
      ]);
    } finally {
      conn.release();
    }
  }

  const ask = () =>
    withTenant(driver, TENANT, async (db) => currentTier(db, TENANT as TenantId));

  it('a quiet month with a standing fleet is counted the moment somebody asks', async () => {
    // Two active, one paused — three slots held, and NO peak row: nothing
    // activated this month, which is exactly T2's documented gap.
    await seedPaths([
      ['email', 'active'],
      ['calendar', 'active'],
      ['contact', 'paused'],
    ]);
    const answer = await ask();
    // The true-up wrote the mark and the derivation read it: 3 paths → Small.
    expect(answer.evidence.peakPaths).toBe(3);
    expect(answer.tier?.id).toBe('small');
    expect(answer.decidedBy).toBe('paths');
  });

  it('the data axis wins when it is the higher one, and the evidence says so', async () => {
    await seedPaths([['email', 'active']]); // 1 path → Tiny by paths
    await seedBytes(400e9); // 400 GB → Small by data
    const answer = await ask();
    expect(answer.tier?.id).toBe('small');
    expect(answer.decidedBy).toBe('data');
    expect(answer.evidence.gbMoved).toBe(400);
    expect(answer.evidence.peakPaths).toBe(1);
    expect(answer.evidence.peakAt).toBeDefined();
  });

  it('nothing running and nothing moved derives the floor tier by both axes', async () => {
    const answer = await ask();
    expect(answer.evidence.peakPaths).toBe(0);
    expect(answer.evidence.gbMoved).toBe(0);
    expect(answer.tier?.id).toBe('tiny');
    expect(answer.decidedBy).toBe('both');
  });

  it('past the table the answer is null — talk to us', async () => {
    await seedBytes(15_001e9); // over the XL ceiling
    const answer = await ask();
    expect(answer.tier).toBeNull();
    expect(answer.decidedBy).toBe('data');
  });
});
