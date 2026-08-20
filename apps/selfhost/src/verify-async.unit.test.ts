// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The §20 gate's start + poll pair over HTTP (workplan 0017 T2).
 *
 * The state machine itself — join-not-stack, failed-keeps-its-reason, fresh
 * runs after terminal states — is proved deterministically against a
 * controlled scan in `verify-run.unit.test.ts`. This file proves the WIRING:
 * a real appliance on PGlite serves the pair, the verbs behave (GET never
 * starts anything), a run started over HTTP reaches a terminal state, and the
 * retired synchronous `GET /verify` stays retired (0019 T6 — the pin is the
 * absence).
 *
 * The fixture's connector secrets are deliberately ABSENT, so the scan cannot
 * construct a target and completes in milliseconds with the unreachable
 * domains recorded inside a `done` report. Fast is the point here; slow and
 * held-open belonged to the state-machine file, where it costs nothing.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { start, type SelfhostHandle } from './index.ts';
import type { VerificationRunReport, VerifyStartResponse } from '@openmig/shared';

const MAPPING_ID = '11111111-1111-4111-8111-1111111111ee';

let handle: SelfhostHandle;
let base: string;

async function report(): Promise<VerificationRunReport> {
  return (await (await fetch(`${base}/verify/report`)).json()) as VerificationRunReport;
}

type TerminalReport = Extract<VerificationRunReport, { state: 'done' | 'failed' }>;

async function waitForTerminal(timeoutMs = 30_000): Promise<TerminalReport> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const r = await report();
    if (r.state === 'done' || r.state === 'failed') return r;
    if (Date.now() > until) throw new Error(`run never terminated; last state: ${r.state}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

beforeAll(async () => {
  // OPENMIG_TEST_NOPE stays UNSET: the target never constructs, the scan
  // completes fast, and what it could not read is a verdict inside the report
  // rather than a hang inside this suite.
  delete process.env.OPENMIG_TEST_NOPE;

  const configDir = mkdtempSync(join(tmpdir(), 'openmig-verify-cfg-'));
  writeFileSync(
    join(configDir, 'mapping.json'),
    JSON.stringify({
      tenantId: '00000000-0000-4000-8000-0000000000ee',
      mappingId: MAPPING_ID,
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
    pgliteDataDir: mkdtempSync(join(tmpdir(), 'openmig-verify-db-')),
    configDir,
    port: 0,
    host: '127.0.0.1',
  });
  base = `http://127.0.0.1:${handle.port}`;
}, 120_000);

afterAll(async () => {
  await handle?.stop();
});

describe('the verify pair over HTTP', () => {
  it('reports never-run before anything starts — and reading does not start it', async () => {
    expect(await report()).toEqual({ state: 'never-run' });
    // Twice: a GET that launched a target scan would have flipped this to
    // running, and the Verify screen's polling safety rests on it not doing so.
    expect(await report()).toEqual({ state: 'never-run' });
  });

  it('POST answers 202 with the running report, built at start time', async () => {
    const res = await fetch(`${base}/verify/start`, { method: 'POST' });
    const body = (await res.json()) as VerifyStartResponse;
    expect(res.status).toBe(202);
    expect(body.started).toBe(true);
    // Deterministic even though the scan may finish a millisecond later: the
    // response body is composed synchronously at launch.
    expect(body.report.state).toBe('running');
  });

  it('the run reaches a terminal state a poller can read', async () => {
    const terminal = await waitForTerminal();
    if (terminal.state === 'done') {
      expect(Object.keys(terminal.report)).toContain(MAPPING_ID);
      expect(terminal.finishedAt >= terminal.startedAt).toBe(true);
    } else {
      expect(terminal.error).toBeTruthy();
    }
  }, 60_000);

  it('a start after a terminal state is a fresh 202', async () => {
    const res = await fetch(`${base}/verify/start`, { method: 'POST' });
    expect(res.status).toBe(202);
    expect(((await res.json()) as VerifyStartResponse).started).toBe(true);
    await waitForTerminal();
  }, 60_000);

  it('the synchronous GET /verify is GONE (0019 T6) — it survived exactly one release', async () => {
    // The pin is now the ABSENCE: 0017 T2 promised the route one release, PR
    // #200 moved the e2e gate onto the pair, and nothing calls it. A 200 here
    // would mean somebody resurrected a route that holds one HTTP request
    // open for a whole target scan.
    const res = await fetch(`${base}/verify`);
    expect(res.status).toBe(404);
  });
});
