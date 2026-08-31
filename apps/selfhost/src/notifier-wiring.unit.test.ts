// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The appliance boots with a notification channel (workplan 0030 T1).
 *
 * `notifications.ts` proves what the channel SAYS and `notifier-config`
 * proves how an environment becomes one; this proves the appliance actually
 * builds one and hands it out — the seam 0030 T2/T3's events will call.
 *
 * Unconfigured is the default state and the important one: the appliance must
 * still start, and the notifier it exposes must be the honest no-op rather
 * than absent, so a caller never has to ask whether notifications exist
 * before reporting something.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { start, type SelfhostHandle } from './index.ts';

/**
 * Temp directories this file makes, and the removal that used to be missing.
 *
 * See the sweep in workplan 0099: `mkdtempSync` with no matching `rmSync`
 * leaks for the lifetime of the machine, a PGlite data directory is 41MB, and
 * the suite was measured leaking 322MB per run after quietly accumulating
 * 29GB and filling the disk of the box running it. `unit-tests` runs on the
 * SELF-HOSTED runner for pushes to main — the same Spark the managed stack
 * needs ~15GB free on.
 *
 * Registered rather than removed at each call site, so a new test here cannot
 * forget.
 */
const tempDirs: string[] = [];
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});


let handle: SelfhostHandle;
/** Reused by the configured-appliance suite below, so the mapping is one fact. */
let baseConfigDir: string;

beforeAll(async () => {
  // Deliberately no SMTP_* in the environment: the default an appliance
  // ships with, and the one an operator meets first.
  for (const key of ['SMTP_HOST', 'SMTP_PORT', 'NOTIFY_FROM', 'NOTIFY_TO', 'NOTIFY_LOCALE']) {
    delete process.env[key];
  }

  const configDir = tempDir('ownpace-notify-cfg-');
  baseConfigDir = configDir;
  writeFileSync(
    join(configDir, 'mapping.json'),
    JSON.stringify({
      tenantId: '00000000-0000-4000-8000-0000000000cc',
      mappingId: '11111111-1111-4111-8111-1111111111cc',
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
      domains: {},
    }),
  );

  handle = await start({
    persistence: 'pglite',
    pgliteDataDir: tempDir('ownpace-notify-db-'),
    configDir,
    port: 0,
    host: '127.0.0.1',
  });
}, 120_000);

afterAll(async () => {
  await handle?.stop();
});

describe('the appliance with no SMTP configured', () => {
  it('starts anyway — an unconfigured channel is not a startup failure', () => {
    expect(handle.port).toBeGreaterThan(0);
  });

  it('still exposes a notifier, so callers never have to check for one', async () => {
    expect(handle.notifier).toBeDefined();
    // The honest no-op: it accepts the message, does not send it, and does
    // not throw. A caller reporting a real event must not have to know
    // whether email happens to be set up on this box.
    await expect(
      handle.notifier.notify({ subject: 'subject', body: 'body' }),
    ).resolves.toBeUndefined();
  });
});

/**
 * The digest schedule (workplan 0030 T3).
 *
 * `digestSchedule` decides WHICH jobs exist and is tested exhaustively in
 * shared; what only a real boot can prove is that the appliance's scheduler
 * accepts those cron expressions and that the jobs are torn down with it. A
 * cron string croner rejects throws inside `start()`, which would take the
 * appliance down at boot over a summary email — so it is worth one real
 * start.
 */
describe('the appliance with SMTP and both digests configured', () => {
  let configured: SelfhostHandle;
  let stopped = false;

  beforeAll(async () => {
    // Port 1 with no listener: the channel is built, and nothing is sent
    // during a boot, so this never touches the network.
    process.env.SMTP_HOST = '127.0.0.1';
    process.env.SMTP_PORT = '1';
    process.env.NOTIFY_FROM = 'openmigrate@example.nl';
    process.env.NOTIFY_TO = 'owner@example.nl';
    process.env.NOTIFY_DIGEST = 'both';

    const configDir = tempDir('ownpace-digest-cfg-');
    writeFileSync(join(configDir, 'mapping.json'), readFileSync(join(baseConfigDir, 'mapping.json')));

    configured = await start({
      persistence: 'pglite',
      pgliteDataDir: tempDir('ownpace-digest-db-'),
      configDir,
      port: 0,
      host: '127.0.0.1',
    });
  }, 120_000);

  afterAll(async () => {
    if (!stopped) await configured?.stop();
    for (const key of ['SMTP_HOST', 'SMTP_PORT', 'NOTIFY_FROM', 'NOTIFY_TO', 'NOTIFY_DIGEST']) {
      delete process.env[key];
    }
  });

  it('boots with the digest jobs registered — both crons parse', () => {
    expect(configured.port).toBeGreaterThan(0);
  });

  it('shuts down cleanly, taking the digest jobs with it', async () => {
    // If a scheduled digest outlived `stop()`, a test run would keep the
    // process alive and the appliance would leak a job per restart.
    await expect(configured.stop()).resolves.toBeUndefined();
    stopped = true;
  });
});
