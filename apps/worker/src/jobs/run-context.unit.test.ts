// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE TRIGGER.DEV RUNNER MAKES THE CALLS THE JOBS MADE (ADR-0054; workplan
 * 0167 T6).
 *
 * The jobs' calls of the Trigger.dev SDK moved into `run-context.ts`, behind
 * the run's runner, so that a job runs on either runner. Moved, not changed:
 *
 * - the tick's `runDeltaSync.trigger(payload, { concurrencyKey, tags })`, and
 *   the cutover's `triggerAndWait` with the same, each right after `configure`
 *   points the SDK at the stack's own API, as the cutover always did;
 * - the purge's `runs.retrieve(ref)`, read positively both ways, and
 *   `runs.cancel(ref)`, with no `configure`, as before;
 * - the pass's own id, `ctx.run.id`, read defensively: absent rather than
 *   wrong.
 *
 * The SDK's `configure` and `runs` are stood in for, and the pass's task is a
 * stand-in handed to the runner as the jobs hand the real one.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { onTriggerDev, type RunContext, type TriggerDevTasks } from './run-context.ts';

const sdk = vi.hoisted(() => ({
  calls: [] as string[],
  configure: undefined as unknown as ReturnType<typeof vi.fn>,
  retrieve: undefined as unknown as ReturnType<typeof vi.fn>,
  cancel: undefined as unknown as ReturnType<typeof vi.fn>,
}));

vi.mock('@trigger.dev/sdk', async (importOriginal) => {
  const real = await importOriginal<typeof import('@trigger.dev/sdk')>();
  sdk.configure = vi.fn((options: unknown) => void sdk.calls.push(`configure ${JSON.stringify(options)}`));
  sdk.retrieve = vi.fn();
  sdk.cancel = vi.fn(async () => ({}));
  return { ...real, configure: sdk.configure, runs: { ...real.runs, retrieve: sdk.retrieve, cancel: sdk.cancel } };
});

const TENANT = '0167a100-e29b-41d4-a716-446655440001';
const MAPPING = '0167a100-e29b-41d4-a716-446655440002';
const PAYLOAD = { tenantId: TENANT, mappingId: MAPPING, domains: ['email' as const] };
const OPTIONS = { serializeBy: MAPPING, tags: [`tenant:${TENANT}`, `mapping:${MAPPING}`] };

/** The context Trigger.dev's `run` would make from `params`. */
const contextFrom = (params: unknown, tasks?: TriggerDevTasks): Promise<RunContext> =>
  onTriggerDev(async (_payload: unknown, context: RunContext) => context, tasks)({}, params);

/** A stand-in for run-delta-sync's task, which notes each call in order. */
function aPassTask() {
  return {
    trigger: vi.fn(async (payload: unknown, options: unknown) => {
      sdk.calls.push(`trigger ${JSON.stringify([payload, options])}`);
      return { id: 'run_triggered' };
    }),
    triggerAndWait: vi.fn(async (payload: unknown, options: unknown) => {
      sdk.calls.push(`triggerAndWait ${JSON.stringify([payload, options])}`);
      return { ok: true as const, id: 'run_waited', taskIdentifier: 'run-delta-sync', output: { asked: ['email'], domains: {} } };
    }),
  };
}

beforeEach(() => {
  sdk.calls.length = 0;
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});
afterEach(() => vi.unstubAllEnvs());

describe('the context of a Trigger.dev run', () => {
  it('carries the run’s id and attempt, as Trigger.dev hands them, and its runner', async () => {
    const context = await contextFrom({ ctx: { run: { id: 'run_cabc123' }, attempt: { number: 2 } } });
    expect(context.runId).toBe('run_cabc123');
    expect(context.attempt).toBe(2);
    expect(context.runner.name).toBe('trigger');
  });

  it('leaves out what Trigger.dev did not hand it, rather than guess', async () => {
    for (const params of [undefined, {}, { ctx: {} }, { ctx: { run: { id: 42 }, attempt: { number: '2' } } }]) {
      const context = await contextFrom(params);
      expect('runId' in context, JSON.stringify(params)).toBe(false);
      expect('attempt' in context, JSON.stringify(params)).toBe(false);
    }
  });

  it('calls the job’s run with its own payload, and hands back what it returns', async () => {
    const run = vi.fn(async (payload: { n: number }, _context: RunContext) => ({ doubled: payload.n * 2 }));
    expect(await onTriggerDev(run)({ n: 21 }, { ctx: { run: { id: 'run_x' } } })).toEqual({ doubled: 42 });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]![0]).toEqual({ n: 21 });
  });
});

describe('a pass, enqueued on Trigger.dev', () => {
  it('points the SDK at the stack’s own API, then triggers the pass with the caller’s key and tags', async () => {
    const task = aPassTask();
    const { runner } = await contextFrom({}, { deltaSync: async () => task });
    expect(await runner.enqueue('run-delta-sync', PAYLOAD, OPTIONS)).toEqual({ runId: 'run_triggered' });
    expect(sdk.calls).toEqual([
      'configure {"baseURL":"http://trigger-api:3000"}',
      `trigger ${JSON.stringify([PAYLOAD, { concurrencyKey: MAPPING, tags: OPTIONS.tags }])}`,
    ]);
  });

  it('takes the in-network address from the environment when it is set', async () => {
    vi.stubEnv('TRIGGER_API_URL_IN_NETWORK', 'http://trigger-api.test.invalid:3000');
    const task = aPassTask();
    const { runner } = await contextFrom({}, { deltaSync: async () => task });
    await runner.enqueue('run-delta-sync', PAYLOAD, OPTIONS);
    expect(sdk.configure).toHaveBeenCalledWith({ baseURL: 'http://trigger-api.test.invalid:3000' });
  });

  it('waits for a pass the same way, and hands back what Trigger.dev said of it', async () => {
    const task = aPassTask();
    const { runner } = await contextFrom({}, { deltaSync: async () => task });
    const settled = await runner.enqueueAndWait('run-delta-sync', PAYLOAD, { ...OPTIONS, tags: [...OPTIONS.tags, 'cutover-final-sync'] });
    expect(settled).toEqual({ ok: true, id: 'run_waited', taskIdentifier: 'run-delta-sync', output: { asked: ['email'], domains: {} } });
    expect(sdk.calls).toEqual([
      'configure {"baseURL":"http://trigger-api:3000"}',
      `triggerAndWait ${JSON.stringify([PAYLOAD, { concurrencyKey: MAPPING, tags: [...OPTIONS.tags, 'cutover-final-sync'] }])}`,
    ]);
  });

  it('loads the pass’s task only when a pass is enqueued, so the job decides when its module loads', async () => {
    const task = aPassTask();
    const load = vi.fn(async () => task);
    const { runner } = await contextFrom({}, { deltaSync: load });
    expect(load).not.toHaveBeenCalled();
    await runner.enqueue('run-delta-sync', PAYLOAD, OPTIONS);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('refuses to enqueue for a run that was handed no pass, before it calls the SDK', async () => {
    const { runner } = await contextFrom({});
    await expect(runner.enqueue('run-delta-sync', PAYLOAD, OPTIONS)).rejects.toThrow(/handed no task to enqueue "run-delta-sync" on/);
    await expect(runner.enqueueAndWait('run-delta-sync', PAYLOAD, OPTIONS)).rejects.toThrow(/handed no task/);
    expect(sdk.calls).toEqual([]);
  });
});

describe('a run asked after, and cancelled, on Trigger.dev', () => {
  const remote = (flags: Partial<Record<'isExecuting' | 'isQueued' | 'isWaiting' | 'isCompleted' | 'isFailed' | 'isCancelled', boolean>>) => ({
    isExecuting: false,
    isQueued: false,
    isWaiting: false,
    isCompleted: false,
    isFailed: false,
    isCancelled: false,
    ...flags,
  });

  it('is live while Trigger.dev says it executes, is queued or waits', async () => {
    const { runner } = await contextFrom({});
    for (const flag of ['isExecuting', 'isQueued', 'isWaiting'] as const) {
      sdk.retrieve.mockResolvedValueOnce(remote({ [flag]: true }));
      expect(await runner.verdict('run_live'), flag).toBe('live');
    }
    // Still going wins over a terminal flag beside it: nothing is landed under a live pass.
    sdk.retrieve.mockResolvedValueOnce(remote({ isExecuting: true, isCompleted: true }));
    expect(await runner.verdict('run_both')).toBe('live');
    expect(sdk.retrieve).toHaveBeenCalledWith('run_live');
    expect(sdk.configure).not.toHaveBeenCalled();
  });

  it('is finished once Trigger.dev says it completed, failed or was cancelled', async () => {
    const { runner } = await contextFrom({});
    for (const flag of ['isCompleted', 'isFailed', 'isCancelled'] as const) {
      sdk.retrieve.mockResolvedValueOnce(remote({ [flag]: true }));
      expect(await runner.verdict('run_done'), flag).toBe('finished');
    }
  });

  it('is unknown when Trigger.dev names neither, and the failure to ask is the caller’s to hear', async () => {
    const { runner } = await contextFrom({});
    sdk.retrieve.mockResolvedValueOnce(remote({}));
    expect(await runner.verdict('run_odd')).toBe('unknown');
    sdk.retrieve.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
    await expect(runner.verdict('run_unreachable')).rejects.toThrow('connect ECONNREFUSED');
  });

  it('is cancelled by its id, with nothing pointed first', async () => {
    const { runner } = await contextFrom({});
    await runner.cancel('run_to_stop');
    expect(sdk.cancel).toHaveBeenCalledWith('run_to_stop');
    expect(sdk.configure).not.toHaveBeenCalled();
  });
});
