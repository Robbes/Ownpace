// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * §22.1's idempotent re-run gate (0025 T5) — against the REAL migration
 * chain on a real database, not a fake driver.
 *
 * The driver-seam suite proves the runner's mechanics with synthetic files;
 * what it cannot prove is that OUR migrations survive their own re-run. This
 * gate runs the actual chain twice on PGlite: the first pass applies every
 * file in the directory (so a migration that silently fails to record itself
 * shows up here as a missing name, not as a duplicate-application error two
 * releases later), the second pass applies NOTHING. Every future migration
 * joins the gate the moment it lands in the directory — there is nothing to
 * remember to update.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pgliteDriver } from './pglite-driver.ts';
import { runMigrations } from './migrate.ts';
import type { LedgerDriver } from './driver.ts';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

let driver: LedgerDriver;

beforeAll(() => {
  driver = pgliteDriver();
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

describe('the real migration chain (§22.1 idempotent re-run gate)', () => {
  // 60s: the first run pays PGlite's WASM cold boot plus the whole baseline.
  it('first run applies EVERY file in the directory, in order', { timeout: 60_000 }, async () => {
    const onDisk = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    expect(onDisk.length).toBeGreaterThan(0);

    const first = await runMigrations({ driver, logger: () => {} });

    // Every migration on disk was applied and recorded — by name, so a file
    // the runner skipped or failed to record is a visible diff, not a count.
    expect(first.applied).toEqual(onDisk);
    expect(first.currentVersion).toBe(onDisk[onDisk.length - 1]);
  });

  it('second run applies NOTHING — the re-run is a recorded no-op', { timeout: 30_000 }, async () => {
    const second = await runMigrations({ driver, logger: () => {} });

    expect(second.applied).toEqual([]);
    // The version pointer did not move either: a no-op that bumped the
    // version would be rewriting history on every boot.
    const onDisk = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    expect(second.currentVersion).toBe(onDisk[onDisk.length - 1]);
  });

  it('and a third, for the boot-loop shape: every appliance start re-runs this', { timeout: 30_000 }, async () => {
    // The appliance runs migrations on EVERY start (index.ts step 1). A
    // property that held once but not twice-more is exactly the kind that
    // corrupts on the fifth reboot of a NAS.
    const third = await runMigrations({ driver, logger: () => {} });
    expect(third.applied).toEqual([]);
  });
});
