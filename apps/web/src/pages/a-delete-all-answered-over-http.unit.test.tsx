// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * DELETE ALL OF THESE HERE TOO, OVER THE REAL OPERATING SERVICE (workplan
 * 0164 T3).
 *
 * The page's other tests mock the operating service, `DecisionRefusedError`
 * included, so they cannot see how an HTTP answer becomes a refusal or a
 * fault. Here nothing of the service is mocked: only axios's transport is
 * replaced, by answers in the shapes the managed API sends. A 403 with a
 * gate's code is a refusal and the run goes on; a 500 from `serverFault`
 * carries an `error` field too, and it is not known, and it stops the run.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AxiosRequestConfig } from 'axios';
import type { DeletionsQueue, ItemDeletion } from '@openmig/shared';
import { DELETIONS_MEANING, DELETION_GUIDANCE } from '@openmig/shared';
import { STRINGS } from '../i18n/strings.ts';
import { LocaleProvider } from '../i18n/index.tsx';

/** What the fake server answers, by method and path, and what it was asked. */
const http = vi.hoisted(() => {
  type Answer = { status: number; data: unknown };
  const answers = new Map<string, Answer>();
  const asked: string[] = [];
  return {
    answers,
    asked,
    adapter: async (config: { method?: string; url?: string }) => {
      const key = `${(config.method ?? 'get').toUpperCase()} ${config.url ?? ''}`;
      asked.push(key);
      const answer = answers.get(key) ?? { status: 404, data: { error: 'no fake answer for ' + key } };
      const response = { data: answer.data, status: answer.status, statusText: '', headers: {}, config };
      if (answer.status >= 200 && answer.status < 300) return response;
      throw Object.assign(new Error(`Request failed with status code ${answer.status}`), {
        isAxiosError: true,
        response,
        config,
      });
    },
  };
});

// Every axios instance the app makes talks to the fake server; nothing else of axios changes.
vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  const real = actual.default;
  const create = (config?: AxiosRequestConfig) =>
    real.create({ ...config, adapter: http.adapter as unknown as AxiosRequestConfig['adapter'] });
  return { ...actual, default: Object.assign(Object.create(real) as typeof real, real, { create }) };
});

import Deletions from './Deletions.tsx';

const en = STRINGS.en;
const MAPPING = 'm-0164';

function deletion(naturalKeyHash: string): ItemDeletion {
  return {
    domain: 'calendar',
    collection: 'Personal',
    displayName: `Event ${naturalKeyHash}`,
    absentPasses: 0,
    confirmed: true,
    evidence: 'reported',
    naturalKeyHash,
  };
}

const queue: DeletionsQueue = {
  migrationStatus: 'active',
  afterCutover: [],
  confirmed: ['a', 'b', 'c', 'd'].map(deletion),
  watching: [],
  acknowledged: [],
  whatThisMeans: DELETIONS_MEANING,
  howToResolve: DELETION_GUIDANCE,
  earlierExports: { waiting: [], kept: [] },
};

beforeEach(() => {
  http.answers.clear();
  http.asked.length = 0;
  const m = `/migrations/${MAPPING}`;
  http.answers.set(`GET ${m}/deletions`, { status: 200, data: { [MAPPING]: queue } });
  http.answers.set(`GET ${m}/apply-deletions`, {
    status: 200,
    data: { allowApplyDeletions: true, autoApplyRelocations: false, source: 'mapping' },
  });
  // a: a gate's refusal, as the route sends it.
  http.answers.set(`POST ${m}/deletions/a/apply`, {
    status: 403,
    data: { error: 'not_ours', reason: 'The copy on the target was already there before this migration ran.' },
  });
  // b: a fault, as `serverFault` sends it: an `error` field, and a 500.
  http.answers.set(`POST ${m}/deletions/b/apply`, {
    status: 500,
    data: {
      error: 'deletion_apply_failed',
      reason: "Something went wrong queuing this deletion's removal — this is a fault on our side. Reference QX7.",
    },
  });
  http.answers.set(`POST ${m}/deletions/c/apply`, {
    status: 202,
    data: { queued: true, receipt: { state: 'queued', requestedAt: '2026-11-22T00:00:00Z' } },
  });
});

describe('Delete all of these here too, answered over HTTP', () => {
  it('reads a 403 with a gate’s code as a refusal, and a 500 with an error field as not known, which stops the run', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <LocaleProvider>
        <MemoryRouter initialEntries={[`/migrations/${MAPPING}/deletions`]}>
          <QueryClientProvider client={qc}>
            <Routes>
              <Route path="/migrations/:mappingId/deletions" element={<Deletions receiptPollMs={5} confirmGuardMs={0} />} />
            </Routes>
          </QueryClientProvider>
        </MemoryRouter>
      </LocaleProvider>,
    );

    (await screen.findByRole('button', { name: en['deletions.all'] })).click();
    (await screen.findByRole('button', { name: 'Delete 4' })).click();

    expect(await screen.findByText(new RegExp(en['deletions.all.stoppedBy.failure']))).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      en['deletions.all.done'].replace('{deleted}', '0').replace('{notDeleted}', '3').replace('{unknown}', '1'),
    );
    const refused = screen.getByRole('heading', { level: 4, name: new RegExp(`^${en['deletions.all.notRemoved']}`) })
      .parentElement!;
    expect(within(refused).getByText(en['deletions.refused.notOurs'])).toBeInTheDocument();
    const unknown = screen.getByRole('heading', { level: 4, name: new RegExp(`^${en['deletions.all.unknown']}`) })
      .parentElement!;
    expect(within(unknown).getByText(en['deletions.all.failed'])).toBeInTheDocument();
    expect(within(unknown).getByText(/Reference QX7.*\(deletion_apply_failed, HTTP 500\)/)).toBeInTheDocument();

    // a and b were pressed; c and d never were.
    const presses = http.asked.filter((key) => key.startsWith('POST '));
    expect(presses).toEqual([`POST /migrations/${MAPPING}/deletions/a/apply`, `POST /migrations/${MAPPING}/deletions/b/apply`]);
  });
});
