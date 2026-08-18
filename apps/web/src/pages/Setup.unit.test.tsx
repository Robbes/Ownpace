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

function renderPage(entry: string | { pathname: string; state?: unknown } = '/setup/source/box') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry as never]}>
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


/**
 * A checklist that says WHOSE it is, and gets you back where you were
 * (workplan 0074).
 *
 * Two things the owner reported in the same breath. The heading rendered the
 * wizard type — an operator was told to configure `oauth2`, and asked the
 * question that makes it obvious: *how should a user guess that is for Entra
 * ID?* And the back link was a hardcoded *← Back to the migration wizard*, so
 * reaching this page from Connections — which links here by design since 0065
 * — sent you somewhere you had never been.
 */
describe('Setup — names the provider, and goes back where you came from (0074)', () => {
  beforeEach(() => {
    get.mockReset();
    setStep.mockReset();
  });

  it('heads the page with the provider NAME, not the wizard type', async () => {
    get.mockResolvedValue(checklist({ provider: 'oauth2' }));
    renderPage({ pathname: '/setup/source/oauth2' });

    // BOTH places that name the provider — the heading and the admin
    // question. The second one is why this assertion is `getAllByText`: it
    // was missed on the first pass and this test is what found it.
    expect((await screen.findAllByText(/Microsoft 365/)).length).toBeGreaterThanOrEqual(2);
    // The raw type must not be what an operator is asked to go and configure.
    expect(screen.queryByText(/— oauth2/)).toBeNull();
  });

  it('returns to CONNECTIONS when that is where the link came from', async () => {
    get.mockResolvedValue(checklist());
    renderPage({ pathname: '/setup/source/box', state: { from: '/connections' } });

    const back = await screen.findByText(/Back to connections/);
    expect(back.getAttribute('href')).toBe('/connections');
  });

  it('still defaults to the wizard for a direct URL', async () => {
    // Most people arrive from the wizard, and a bookmarked checklist has no
    // origin to honour — so the default stays what it always was.
    get.mockResolvedValue(checklist());
    renderPage();

    const back = await screen.findByText(/Back to the migration wizard/);
    expect(back.getAttribute('href')).toBe('/mappings/new');
  });
});
