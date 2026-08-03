// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

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
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { start, type SelfhostHandle } from './index';

let handle: SelfhostHandle;

beforeAll(async () => {
  // Deliberately no SMTP_* in the environment: the default an appliance
  // ships with, and the one an operator meets first.
  for (const key of ['SMTP_HOST', 'SMTP_PORT', 'NOTIFY_FROM', 'NOTIFY_TO', 'NOTIFY_LOCALE']) {
    delete process.env[key];
  }

  const configDir = mkdtempSync(join(tmpdir(), 'openmig-notify-cfg-'));
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
    pgliteDataDir: mkdtempSync(join(tmpdir(), 'openmig-notify-db-')),
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
