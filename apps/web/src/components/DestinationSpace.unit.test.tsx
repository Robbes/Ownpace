// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Free space at the destination, said before Start (workplan 0171 T9).
 *
 * One line per pool: room enough, too little (and Start held behind *Start
 * anyway*, D4 (a)), or not known (said, Start allowed, D3 (a)). No line for
 * calendars and contacts alone, which are not asked, nor for a destination
 * that says it has no limit. A question that failed as a whole is said.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DestinationSpaceLines, spaceHolds, spaceLinesShown } from './DestinationSpace.tsx';
import type { DestinationSpacePool } from '../services/operating-service.ts';

// A plain function, steered by the test, rather than a `vi.fn()`: a spy's
// rejected result is reported by the runner against every test after it.
const fake = vi.hoisted(() => ({
  calls: 0,
  answer: (): Promise<unknown> => Promise.resolve([]),
}));
vi.mock('../services/operating-service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/operating-service.ts')>()),
  fetchDestinationSpace: () => {
    fake.calls += 1;
    return fake.answer();
  },
}));
const answer = (pools: DestinationSpacePool[]) => {
  fake.answer = () => Promise.resolve(pools);
};

const MB = 1024 * 1024;
const GB = 1024 * MB;

const pool = (over: Partial<DestinationSpacePool>): DestinationSpacePool => ({
  pool: 'p',
  destination: 'cloud.example.org',
  dataTypes: ['file'],
  needBytes: 2 * GB,
  capacity: { known: true, freeBytes: 5 * GB, pool: 'p' },
  ...over,
});

function renderLines(enabled = true) {
  const onHolds = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <DestinationSpaceLines mappingId="m1" enabled={enabled} onHolds={onHolds} />
    </QueryClientProvider>,
  );
  return onHolds;
}

beforeEach(() => {
  fake.calls = 0;
  fake.answer = () => Promise.resolve([]);
});

describe('the lines', () => {
  it('says what fits, and holds nothing', async () => {
    answer([pool({})]);
    const onHolds = renderLines();
    expect(await screen.findByText('2.0 GB to copy; 5.0 GB free at cloud.example.org.')).toBeTruthy();
    expect(onHolds).toHaveBeenLastCalledWith('m1', false);
  });

  it('says what is short, why, and holds Start (D4 (a))', async () => {
    answer([pool({ needBytes: 6 * GB })]);
    const onHolds = renderLines();
    expect(await screen.findByText('6.0 GB to copy, but only 5.0 GB free at cloud.example.org.')).toBeTruthy();
    expect(screen.getByText(/Make room or raise the quota first, then start\./)).toBeTruthy();
    await waitFor(() => expect(onHolds).toHaveBeenLastCalledWith('m1', true));
  });

  it('says what is not known, what to check, and lets Start through (D3 (a))', async () => {
    answer([
      pool({ pool: 'u', destination: 'mail.example.org', dataTypes: ['email'], needBytes: 300 * MB, capacity: { known: false, why: 'not_offered' } }),
    ]);
    const onHolds = renderLines();
    expect(await screen.findByText('mail.example.org does not tell us its free space.')).toBeTruthy();
    expect(screen.getByText('Check it at mail.example.org before you start: there is 300.0 MB to copy.')).toBeTruthy();
    expect(onHolds).toHaveBeenLastCalledWith('m1', false);
  });

  it('says a question that failed as a whole, in the server’s words', async () => {
    fake.answer = () => Promise.reject(new Error('Network Error'));
    renderLines();
    expect(await screen.findByText(/The free space at the destination could not be read:/)).toBeTruthy();
  });

  it('asks nothing until the count is in', () => {
    renderLines(false);
    expect(fake.calls).toBe(0);
  });
});

describe('which lines are drawn, and what holds Start', () => {
  const calendars = pool({ pool: 'c', dataTypes: ['calendar', 'contact'], capacity: { known: false, why: 'not_offered' } });
  const unlimited = pool({ pool: 'n', capacity: { known: false, why: 'unlimited' } });
  const short = pool({ pool: 's', needBytes: 9 * GB });

  it('leaves out calendars and contacts alone, and a destination without a limit', () => {
    expect(spaceLinesShown([calendars, unlimited, short]).map((p) => p.pool)).toEqual(['s']);
  });

  it('holds only for a known pool that is short', () => {
    expect(spaceHolds([calendars, unlimited])).toBe(false);
    expect(spaceHolds([calendars, short])).toBe(true);
    expect(spaceHolds(undefined)).toBe(false);
  });
});
