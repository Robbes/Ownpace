// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A BODY CUT SHORT ON THE APPLIANCE (the swallowed-error check of 2026-11-19;
 * workplan 0006 J).
 *
 * Two doors, `PUT /decisions/presets/{category}` and `PUT /mappings/{id}`, read
 * their body with `.catch(() => undefined)`: whatever reading it failed with
 * became "no body", and the door answered its own 400. For a body that is not
 * JSON that is the answer meant. For a request the client cut short it was a
 * 400 sent to nobody, and nothing reached the log.
 *
 * What this holds, on the real appliance over PGlite:
 *  - a body that is not JSON is still each door's own 400, word for word;
 *  - a body cut short reaches the handler's catch, which logs the request as
 *    failed, with the error it failed with.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { start, type SelfhostHandle } from './index.ts';

/** Registered, and removed after the file, as `decisions-routes.unit.test.ts` explains. */
const tempDirs: string[] = [];
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

// UUID family 0006e770-…, unused elsewhere in the repo.
const TENANT = '0006e770-e29b-41d4-a716-446655440001';
const MAPPING = '0006e770-e29b-41d4-a716-446655440002';

const PRESET = '/decisions/presets/new_mailbox';
const LANE = `/mappings/${MAPPING}`;

let handle: SelfhostHandle;
let base: string;

beforeAll(async () => {
  const configDir = tempDir('ownpace-cut-short-cfg-');
  writeFileSync(
    join(configDir, 'mapping.json'),
    JSON.stringify({
      tenantId: TENANT,
      mappingId: MAPPING,
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
    pgliteDataDir: tempDir('ownpace-cut-short-db-'),
    configDir,
    port: 0,
    host: '127.0.0.1',
  });
  base = `http://127.0.0.1:${handle.port}`;
}, 120_000);

afterAll(async () => {
  await handle?.stop();
});

const put = (path: string, body: string) =>
  fetch(`${base}${path}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body });

/**
 * A PUT whose body stops after its first bytes: the client says 100 bytes,
 * sends ten, and goes. It asks to continue first: Node answers `100 Continue`
 * and runs the handler in the same turn, so by the time the answer arrives the
 * door is reading the body, as a client that drops off mid-send meets it.
 * Resolves with the client's own error, which is the hang-up it caused.
 */
async function cutShort(path: string): Promise<NodeJS.ErrnoException> {
  const sent = request({
    host: '127.0.0.1',
    port: handle.port,
    method: 'PUT',
    path,
    headers: { 'content-type': 'application/json', 'content-length': '100', expect: '100-continue' },
  });
  const hungUp = new Promise<NodeJS.ErrnoException>((resolve) => sent.once('error', resolve));
  const reading = new Promise<void>((resolve) => sent.once('continue', () => resolve()));
  sent.flushHeaders();
  await reading;
  sent.write('{"status":');
  sent.destroy();
  return hungUp;
}

describe('a body that is not JSON', () => {
  it('is still each door’s own 400, word for word', async () => {
    const preset = await put(PRESET, '{not json');
    expect(preset.status).toBe(400);
    expect(await preset.json()).toEqual({ error: 'Bad Request', message: "action must be 'auto' or 'ask'." });

    const lane = await put(LANE, '{not json');
    expect(lane.status).toBe(400);
    expect(((await lane.json()) as { error: string }).error).toBe('invalid_request');
  });
});

describe('a body the client cut short', () => {
  for (const path of [PRESET, LANE]) {
    it(`is logged as the request’s failure on ${path.split('/')[1]}, not answered as a bad request`, async () => {
      const failures: unknown[][] = [];
      const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
        failures.push(args);
      });
      try {
        expect((await cutShort(path)).code).toBe('ECONNRESET');
        await vi.waitFor(
          () => {
            // The line names the request and the reference its answer gives
            // (workplan 0168): `failed [ref 0a1b2c3d]:`.
            const head = `[selfhost] PUT ${path} failed [ref `;
            const logged = failures.find((args) => {
              const first = String(args[0]);
              return first.startsWith(head) && /^[0-9a-f]{8}\]:$/.test(first.slice(head.length));
            });
            expect(logged, 'the request that failed was not logged').toBeDefined();
            expect((logged![1] as Error).message).toBe('aborted');
          },
          { timeout: 5_000, interval: 20 },
        );
      } finally {
        spy.mockRestore();
      }
    });
  }
});
