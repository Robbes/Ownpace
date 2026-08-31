// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The drift decision queue's appliance routes (workplan 0028 T1).
 *
 * The store's semantics (idempotent raise, never-overwrite) are proved
 * against the database in `decision-store.unit.test.ts`; this file proves
 * the WIRING on a real appliance over PGlite: the list serves (empty,
 * honestly — no detector exists yet, and PGlite's single connection means
 * seeding around the server is not possible here; the first detector's
 * tests own the full round trip), the answer verbs carry the shared 409
 * contract, and malformed input gets a 400 with the reason, not a hang.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
let base: string;

beforeAll(async () => {
  const configDir = tempDir('ownpace-decisions-cfg-');
  writeFileSync(
    join(configDir, 'mapping.json'),
    JSON.stringify({
      tenantId: '00000000-0000-4000-8000-0000000000dd',
      mappingId: '11111111-1111-4111-8111-1111111111dd',
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
    pgliteDataDir: tempDir('ownpace-decisions-db-'),
    configDir,
    port: 0,
    host: '127.0.0.1',
  });
  base = `http://127.0.0.1:${handle.port}`;
}, 120_000);

afterAll(async () => {
  await handle?.stop();
});

describe('GET /permissions/report (workplan 0029)', () => {
  it('refuses without a mailbox, and says how to ask', async () => {
    const res = await fetch(`${base}/permissions/report`);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { reason: string }).reason).toContain('mailbox=');
  });

  it('serves a report whose blind spots are stated, not omitted', async () => {
    const res = await fetch(`${base}/permissions/report?mailbox=rob@acme.nl`);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/markdown');
    const md = await res.text();
    // This appliance has an IMAP source and no Graph credentials, so every
    // category is uninventoried — which the document must SAY rather than
    // render as an empty report (rule 9).
    expect(md).toContain('could NOT be inventoried');
    expect(md).toContain('Mailbox delegation');
    expect(md).toContain('Get-MailboxPermission');
    // And the deferred apply step is stated before the first finding.
    expect(md).toContain('has been applied');
  });
});

describe('GET /decisions', () => {
  it('serves the queue — empty, because nothing can raise decisions yet', async () => {
    const res = await fetch(`${base}/decisions`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ decisions: [] });
  });
});

describe('answering', () => {
  it('an unknown decision gets the shared 409, same words as managed (ADR-0026)', async () => {
    const res = await fetch(`${base}/decisions/00000000-0000-4000-8000-000000000999/resolve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resolution: { action: 'x' } }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe('This decision does not exist or has already been answered.');
  });

  it('dismiss carries the same contract, with no body needed', async () => {
    const res = await fetch(`${base}/decisions/00000000-0000-4000-8000-000000000999/dismiss`, {
      method: 'POST',
    });
    expect(res.status).toBe(409);
  });

  it('resolve without a resolution is a 400 that says what to send', async () => {
    const res = await fetch(`${base}/decisions/00000000-0000-4000-8000-000000000999/resolve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; reason: string };
    expect(body.error).toBe('missing_resolution');
    expect(body.reason).toContain('resolution');
  });

  it('malformed JSON is a 400 with the parse error verbatim, not a hang', async () => {
    const res = await fetch(`${base}/decisions/00000000-0000-4000-8000-000000000999/resolve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_json');
  });
});
