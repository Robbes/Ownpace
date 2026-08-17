// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The provider setup checklist screen (workplan 0061).
 *
 * What these hold is what makes the page worth building over the amber
 * paragraph it replaces: a step says what VALUE it yields, the steps needing
 * an administrator are called out (that being the usual reason a setup
 * stalls), ticking persists through the API rather than living in component
 * state, and "nothing to set up" renders as an answer instead of an empty page.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { SetupChecklist } from '../services/mapping-service';

const { get, setStep } = vi.hoisted(() => ({ get: vi.fn(), setStep: vi.fn() }));

vi.mock('../services/mapping-service', () => ({
  setupApi: { get, setStep },
}));

import Setup from './Setup';

const checklist = (over: Partial<SetupChecklist> = {}): SetupChecklist => ({
  side: 'source',
  provider: 'box',
  steps: [
    {
      step: {
        key: 'create_app',
        titleKey: 'setup.box.create_app.title',
        detailKey: 'setup.box.create_app.detail',
        yieldsKey: 'setup.box.create_app.yields',
      },
      state: 'open',
    },
    {
      step: {
        key: 'admin_authorize',
        titleKey: 'setup.box.admin_authorize.title',
        detailKey: 'setup.box.admin_authorize.detail',
        needsAnotherPerson: true,
      },
      state: 'open',
    },
  ],
  progress: { total: 2, done: 0, skipped: 0, open: 2, blockedOnOthers: 1, complete: false },
  ...over,
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/setup/source/box']}>
        <Routes>
          <Route path="/setup/:side/:provider" element={<Setup />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  get.mockReset();
  setStep.mockReset();
});

describe('the setup checklist screen', () => {
  it('says what each step YIELDS — the value you come back with', async () => {
    get.mockResolvedValue(checklist());
    renderPage();

    // "You get: a Client ID and a Client Secret."
    expect(await screen.findByText(/Client ID and a Client Secret/)).toBeTruthy();
  });

  it('calls out the steps that need an administrator, and counts them', async () => {
    get.mockResolvedValue(checklist());
    renderPage();

    expect(await screen.findByText(/needs an administrator/)).toBeTruthy();
    // The header explains WHY it is stuck, not just how many are left.
    expect(screen.getByText(/waiting on an administrator/)).toBeTruthy();
  });

  it('ticking a step persists it through the API, not just in the component', async () => {
    get.mockResolvedValue(checklist());
    setStep.mockResolvedValue(
      checklist({
        steps: [
          {
            step: {
              key: 'create_app',
              titleKey: 'setup.box.create_app.title',
              detailKey: 'setup.box.create_app.detail',
            },
            state: 'done',
            decidedBy: 'someone@example.nl',
            decidedAt: '2026-08-17T10:00:00Z',
          },
        ],
        progress: { total: 1, done: 1, skipped: 0, open: 0, blockedOnOthers: 0, complete: true },
      }),
    );
    renderPage();

    fireEvent.click((await screen.findAllByLabelText(/Mark this step done/))[0]!);

    await waitFor(() =>
      expect(setStep).toHaveBeenCalledWith('source', 'box', 'create_app', 'done'),
    );
    // ...and the refreshed answer is what gets rendered.
    expect(await screen.findByText(/you can complete the wizard/)).toBeTruthy();
  });

  it('skipping is a first-class answer, recorded rather than hidden', async () => {
    get.mockResolvedValue(checklist());
    setStep.mockResolvedValue(checklist());
    renderPage();

    fireEvent.click((await screen.findAllByText('Skip'))[0]!);

    await waitFor(() =>
      expect(setStep).toHaveBeenCalledWith('source', 'box', 'create_app', 'skipped'),
    );
  });

  it('"nothing to set up" is an answer, not an empty page', async () => {
    get.mockResolvedValue(
      checklist({
        steps: [],
        progress: { total: 0, done: 0, skipped: 0, open: 0, blockedOnOthers: 0, complete: false },
      }),
    );
    renderPage();

    expect(await screen.findByText(/needs nothing set up in advance/)).toBeTruthy();
  });
});
