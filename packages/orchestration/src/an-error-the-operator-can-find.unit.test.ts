// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN ERROR THE OPERATOR CAN FIND (workplan 0129 T1): a data type that fails
 * is recorded for the operator's log page, in every process that runs one.
 *
 * Two catch sites run a pass for a data type: `runAllDomains` here (the
 * appliance and the command-line worker) and the managed worker's
 * `run-delta-sync`. Each records `sync.<domain>.failed` with the category the
 * customer's progress strip shows, and puts the event's reference on the log
 * line that carries the message, so the page finds the text without storing
 * it. And each process points the recorder at its own database at start-up,
 * or the events go nowhere. The first is driven through the real loop; the
 * worker's task and the processes' start-up are pinned by reading the source,
 * the way `failure-side-recorded.unit.test.ts` pins the same two catches.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseMappingConfig,
  setAppEventSink,
  type AppEvent,
  type MigrationStatusStore,
  type SwitchedOffState,
} from '@openmig/shared';
import { runAllDomains } from './orchestration.ts';

const TENANT = '00000000-0000-4000-8000-000000000129';
const MAPPING = '11111111-1111-4111-8111-111111110129';

const davEnd = {
  type: 'caldav',
  url: 'https://cloud.example.invalid/remote.php/dav',
  user: 'someone',
  auth: { kind: 'login', passwordFromEnv: 'A_PASSWORD_NOBODY_SET_0129' },
};

/** A calendar the pass cannot even start: its password is in no environment. */
const mapping = () =>
  parseMappingConfig({
    tenantId: TENANT,
    mappingId: MAPPING,
    source: davEnd,
    target: davEnd,
    domains: { calendar: { enabled: true, source: davEnd, target: davEnd } },
  });

function fakeStore() {
  const calls: string[] = [];
  const store: MigrationStatusStore = {
    initDomainStatus: async () => {},
    markInProgress: async () => {},
    markCompleted: async () => {},
    markPaused: async () => {},
    markFailed: async (_t, _m, d) => void calls.push(`failed ${d}`),
    markSwitchedOff: async (): Promise<SwitchedOffState> => ({ state: 'skipped' }),
    markSwitchedOn: async () => {},
    getStatus: async () => [],
  };
  return { store, calls };
}

afterEach(() => {
  setAppEventSink(undefined);
  vi.restoreAllMocks();
});

describe('a data type that fails, in the appliance and the command-line worker', () => {
  it('is recorded as sync.<domain>.failed, with its category and no message', async () => {
    const events: AppEvent[] = [];
    setAppEventSink({ record: async (e) => void events.push(e) });
    const said = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { store, calls } = fakeStore();

    await runAllDomains(mapping(), store, 'active');

    expect(calls).toContain('failed calendar');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      level: 'error',
      event: 'sync.calendar.failed',
      tenantId: TENANT,
      mappingId: MAPPING,
    });
    expect(events[0]!.category).toBeDefined();
    // The message is on the log line, with the reference that finds it.
    const lines = said.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(lines).toContain(`[ref ${events[0]!.reference}]`);
    expect(JSON.stringify(events[0])).not.toContain('A_PASSWORD_NOBODY_SET_0129');
  });
});

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (path: string) => readFileSync(join(HERE, '../../..', path), 'utf8');

describe('the managed worker records the same event', () => {
  const worker = read('apps/worker/src/jobs/run-delta-sync.ts');

  it('builds it in the catch that marks the data type failed, and records it', () => {
    expect(worker).toMatch(/const failed = domainFailedEvent\(\{[\s\S]{0,200}?side: failureSideOf\(error\)/);
    expect(worker).toMatch(/sync failed \[ref \$\{failed\.reference\}\]/);
    expect(worker).toMatch(/markFailed\([\s\S]{0,600}?await recordAppEvent\(failed\);\s*\/\/ Re-throw/);
  });
});

describe('every process points the recorder at its own database', () => {
  it.each([
    ['the managed worker', 'apps/worker/src/jobs/run-delta-sync.ts'],
    ['the command-line worker', 'apps/worker/src/index.ts'],
    ['the appliance', 'apps/selfhost/src/index.ts'],
    ['the API', 'apps/api/src/index.ts'],
  ])('%s', (_who, path) => {
    expect(read(path)).toMatch(/setAppEventSink\(appEventSinkOn\(/);
  });
});
