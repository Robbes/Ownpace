// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The appliance's run-history route (workplan 0026 T3 row 23).
 *
 * PGlite's single connection means seeding rows around the server is not
 * possible here (see decisions-routes.unit.test.ts), and that constraint is
 * turned into the better test: a REAL pass is run against connectors that
 * point at port 1, which fails the email domain honestly — and that failure
 * is exactly what the route must then serve. So one test proves the whole
 * loop the 2026-08-09 session was missing: the pass writes run + run_event
 * rows, and the operator can READ them, error text verbatim, without a log
 * tail over PowerShell.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { start, type SelfhostHandle } from './index.ts';
import type { RunsResponse } from '@openmig/shared';

const MAPPING = '11111111-1111-4111-8111-1111111111ee';

let handle: SelfhostHandle;
let base: string;

beforeAll(async () => {
  const configDir = mkdtempSync(join(tmpdir(), 'openmig-runs-cfg-'));
  writeFileSync(
    join(configDir, 'mapping.json'),
    JSON.stringify({
      tenantId: '00000000-0000-4000-8000-0000000000ee',
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
    }),
  );

  handle = await start({
    persistence: 'pglite',
    pgliteDataDir: mkdtempSync(join(tmpdir(), 'openmig-runs-db-')),
    configDir,
    port: 0,
    host: '127.0.0.1',
  });
  base = `http://127.0.0.1:${handle.port}`;
}, 120_000);

afterAll(async () => {
  await handle?.stop();
});

describe('GET /mappings/{id}/runs', () => {
  it('serves an empty history as an empty list, before anything has run', async () => {
    const res = await fetch(`${base}/mappings/${MAPPING}/runs`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as RunsResponse).runs).toEqual([]);
  });

  it('answers 404 for a mapping that does not exist, not an empty history', async () => {
    // "Unknown mapping" and "no runs yet" are different findings; an operator
    // who typo'd an id must not be told their migration has never run.
    const res = await fetch(`${base}/mappings/does-not-exist/runs`);
    expect(res.status).toBe(404);
  });

  it('serves the run a real (failing) pass just wrote, error events verbatim', async () => {
    // Activate, then run: the mapping's connectors point at port 1, so the
    // email domain fails honestly — which is the panel's founding scenario.
    const started = await fetch(`${base}/mappings/${MAPPING}/start`, { method: 'POST' });
    expect(started.status).toBe(200);
    const ran = await fetch(`${base}/mappings/${MAPPING}/run`, { method: 'POST' });
    expect(ran.status).toBe(200);

    const res = await fetch(`${base}/mappings/${MAPPING}/runs`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as RunsResponse;

    expect(body.runs.length).toBeGreaterThan(0);
    const run = body.runs[0]!;
    // The pass's only domain failed, so the run finished failed with the
    // error counted — a pass that reported success here would be the exact
    // `pass complete (0 created)` lie this panel exists to end.
    expect(run.status).toBe('failed');
    expect(run.errors).toBeGreaterThan(0);
    expect(run.type).toBe('delta');
    expect(run.startedAt).toBeTruthy();

    // And the WORDS survived: an error-level event carrying the real failure,
    // verbatim, mentioning the domain that failed.
    const errorEvents = run.events.filter((e) => e.level === 'error');
    expect(errorEvents.length).toBeGreaterThan(0);
    expect(errorEvents[0]!.message).toContain('email');
  }, 60_000);
});
