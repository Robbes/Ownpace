// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A FAILURE WITH ITS REFERENCE (workplan 0129 T1's promise, ledger 0061): the
 * data type's status row is marked failed with the SAME reference the failure
 * was recorded under for the operator's log page.
 *
 * Two references would be worse than none: the customer would quote one and
 * the operator would search for the other. So the catch that builds the event
 * hands its reference to `markFailed`, in both processes that run a pass: the
 * appliance's and command-line worker's loop, driven here for real, and the
 * managed worker's task, pinned by reading the source the way
 * `an-error-the-operator-can-find.unit.test.ts` pins it.
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

const TENANT = '00000000-0000-4000-8000-000000000061';
const MAPPING = '11111111-1111-4111-8111-111111110061';

const davEnd = {
  type: 'caldav',
  url: 'https://cloud.example.invalid/remote.php/dav',
  user: 'someone',
  auth: { kind: 'login', passwordFromEnv: 'A_PASSWORD_NOBODY_SET_0061' },
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

afterEach(() => {
  setAppEventSink(undefined);
  vi.restoreAllMocks();
});

describe('a data type that fails', () => {
  it('is marked failed with the reference its event was recorded under', async () => {
    const events: AppEvent[] = [];
    setAppEventSink({ record: async (e) => void events.push(e) });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const marked: Array<string | undefined> = [];
    const store: MigrationStatusStore = {
      initDomainStatus: async () => {},
      markInProgress: async () => {},
      markCompleted: async () => {},
      markPaused: async () => {},
      markFailed: async (_t, _m, _d, _error, _side, reference) => void marked.push(reference),
      markSwitchedOff: async (): Promise<SwitchedOffState> => ({ state: 'skipped' }),
      markSwitchedOn: async () => {},
      getStatus: async () => [],
    };

    await runAllDomains(mapping(), store, 'active');

    expect(events).toHaveLength(1);
    expect(marked).toEqual([events[0]!.reference]);
  });
});

const HERE = dirname(fileURLToPath(import.meta.url));

describe("the managed worker's task", () => {
  it('marks the data type failed with the same reference', () => {
    const worker = readFileSync(join(HERE, '../../..', 'apps/worker/src/jobs/run-delta-sync.ts'), 'utf8');
    expect(worker).toMatch(/markFailed\([\s\S]{0,200}?failureSideOf\(error\),\s*failed\.reference,\s*\)/);
  });
});
