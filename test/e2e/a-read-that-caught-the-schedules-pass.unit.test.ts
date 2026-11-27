// Copyright 2026 The Ownpace authors (Apache-2.0)

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { STATUS_URL, statusAfterAPass } from './apply-deletion-lib.ts';

/**
 * THE READ THAT CAUGHT THE SCHEDULE'S PASS (2026-11-27). The E2E fixtures run a
 * pass every minute (`* * * * *`). The zip gate's *a second import writes
 * nothing* asked for one pass, then read the status once. On PGlite, on
 * alpha.21's fold, the case ran across a minute's turn: the schedule started a
 * pass between the one asked for and the read, and the read found the domain
 * `in_progress` where the case expected `completed`. The appliance said what
 * was true. The case read too soon.
 *
 * `statusAfterAPass` asks for a pass and reads the domain once no pass is
 * running. Asking again joins a pass already running and answers when it ends,
 * so it asks again while the read finds one, a few times at most.
 */

const MAPPING = '33333333-3333-4333-8333-333333333333';

/** An appliance whose `/status` answers `states` in order, the last one again
 *  and again, and which counts the passes it is asked for. */
function applianceAnswering(states: string[]): { asks: () => number; reads: () => number } {
  let asks = 0;
  let reads = 0;
  vi.stubGlobal('fetch', async (url: string, init?: { method?: string }) => {
    if (init?.method === 'POST' && url.endsWith(`/mappings/${MAPPING}/run`)) {
      asks += 1;
      return new Response(JSON.stringify({ status: 'ok', action: 'run' }), { status: 200 });
    }
    if (url === STATUS_URL) {
      const state = states[Math.min(reads, states.length - 1)]!;
      reads += 1;
      const domains = [{ domain: 'file', state, itemsSynced: 4, itemsFailed: 0 }];
      return new Response(JSON.stringify({ status: 'ok', mappings: [{ mappingId: MAPPING, domains }] }), {
        status: 200,
      });
    }
    return new Response('not found', { status: 404 });
  });
  return { asks: () => asks, reads: () => reads };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a read after a pass, when the schedule starts one of its own (2026-11-27)', () => {
  it('reads again when it finds a pass running, and answers the settled domain', async () => {
    const appliance = applianceAnswering(['in_progress', 'completed']);
    const status = await statusAfterAPass(MAPPING, 'file');
    expect(status?.state).toBe('completed');
    expect(appliance.asks(), 'one pass asked for, then one more to wait the running one out').toBe(2);
  });

  it('asks for one pass, and reads once, when no pass is running', async () => {
    const appliance = applianceAnswering(['completed']);
    const status = await statusAfterAPass(MAPPING, 'file');
    expect(status?.state).toBe('completed');
    expect(appliance.asks()).toBe(1);
    expect(appliance.reads()).toBe(1);
  });

  it('stops after a few asks, and answers what it read last, so a case fails on it and does not hang', async () => {
    const appliance = applianceAnswering(['in_progress']);
    const status = await statusAfterAPass(MAPPING, 'file');
    expect(status?.state).toBe('in_progress');
    expect(appliance.asks()).toBe(3);
  });

  it('answers a failed domain as it is, without asking again', async () => {
    const appliance = applianceAnswering(['failed']);
    const status = await statusAfterAPass(MAPPING, 'file');
    expect(status?.state).toBe('failed');
    expect(appliance.asks()).toBe(1);
  });
});

describe('the three archive gates read their second import through it', () => {
  const GATES = [
    'selfhost-archive-import.e2e.test.ts',
    'selfhost-archive-in-target-import.e2e.test.ts',
    'selfhost-archive-zip-import.e2e.test.ts',
  ];

  for (const gate of GATES) {
    it(gate, () => {
      const source = readFileSync(new URL(`./${gate}`, import.meta.url), 'utf8');
      const start = source.indexOf("it('a second import writes nothing'");
      expect(start, 'the case is where it was').toBeGreaterThan(-1);
      const end = source.indexOf('\n  }', start);
      const body = source.slice(start, end);
      expect(body).toMatch(/const after = await statusAfterAPass\(/);
      expect(body, 'a bare pass and one read is the shape that met the schedule').not.toMatch(/runPassNow\(/);
    });
  }
});
