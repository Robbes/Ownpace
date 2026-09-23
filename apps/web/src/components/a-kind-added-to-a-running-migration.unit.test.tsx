// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A KIND ADDED TO A RUNNING MIGRATION: the page half (workplan 0125 T6).
 *
 * The owner reconnected his Google account with Tasks ticked and his running
 * migration had nowhere to take them. The panel shows what the migration
 * copies and offers exactly what the shared rule calls addable; these pin that
 * it offers, says, sends and refuses the way the route does.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AxiosError, AxiosHeaders } from 'axios';
import { STRINGS } from '../i18n/strings.ts';
import type { KindChoiceView } from '../services/mapping-service.ts';

const { addDomain } = vi.hoisted(() => ({ addDomain: vi.fn() }));
vi.mock('../services/mapping-service', () => ({ mappingApi: { addDomain } }));

import MigrationKindsPanel from './MigrationKindsPanel.tsx';

const EN = STRINGS.en;

/** A Google account migration into Nextcloud, before Tasks is added. */
const BEFORE: KindChoiceView[] = [
  { domain: 'calendar', state: 'on' },
  { domain: 'contact', state: 'on' },
  { domain: 'task', state: 'addable' },
];

/** An axios-shaped refusal, the way the real apiClient delivers one. */
const axiosError = (status: number, data: unknown): AxiosError => {
  const err = new AxiosError(`Request failed with status code ${status}`);
  err.response = { status, statusText: 'Conflict', headers: {}, config: { headers: new AxiosHeaders() }, data };
  return err;
};

function renderPanel(choices: KindChoiceView[] | undefined) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  const view = render(
    <QueryClientProvider client={qc}>
      <MigrationKindsPanel mappingId="m-1" choices={choices} />
    </QueryClientProvider>,
  );
  const rerender = (next: KindChoiceView[] | undefined) =>
    view.rerender(
      <QueryClientProvider client={qc}>
        <MigrationKindsPanel mappingId="m-1" choices={next} />
      </QueryClientProvider>,
    );
  return { ...view, rerender, invalidate };
}

beforeEach(() => {
  addDomain.mockReset();
});

describe('what the panel shows', () => {
  it('lists what the migration copies and offers what it may gain, with what adding does', () => {
    renderPanel(BEFORE);
    expect(screen.getByText(EN['settings.kinds'])).toBeTruthy();
    expect(screen.getByText(EN['domain.calendar'])).toBeTruthy();
    expect(screen.getByText(EN['domain.contact'])).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add Tasks' })).toBeTruthy();
    expect(screen.getByText(EN['settings.kinds.consequence'])).toBeTruthy();
  });

  it('shows a refused data type with the rule’s own sentence, and no button', () => {
    const reason = 'A kind can only be added before cutover.';
    renderPanel([
      { domain: 'calendar', state: 'on' },
      { domain: 'task', state: 'refused', reason },
    ]);
    expect(screen.getByText(reason)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    // Nothing is on offer, so nothing is said about what adding does.
    expect(screen.queryByText(EN['settings.kinds.consequence'])).toBeNull();
  });

  it('renders nothing with nothing to add, and nothing for a payload without choices', () => {
    const { container, rerender } = renderPanel([{ domain: 'calendar', state: 'on' }]);
    expect(container.textContent).toBe('');
    rerender(undefined);
    expect(container.textContent).toBe('');
  });
});

describe('the press', () => {
  it('adds the data type, says so, and reads the migration again', async () => {
    addDomain.mockResolvedValue({ id: 'm-1', added: 'task', domains: ['calendar', 'contact', 'task'] });
    const { invalidate } = renderPanel(BEFORE);

    await userEvent.click(screen.getByRole('button', { name: 'Add Tasks' }));

    expect(addDomain).toHaveBeenCalledWith('m-1', 'task');
    await waitFor(() => expect(screen.getByText('Tasks added. The next pass copies it.')).toBeTruthy());
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['mapping', 'm-1'] });
  });

  it('keeps the confirmation when the re-read shows everything as copied', async () => {
    addDomain.mockResolvedValue({ id: 'm-1', added: 'task', domains: ['calendar', 'contact', 'task'] });
    const { rerender } = renderPanel(BEFORE);
    await userEvent.click(screen.getByRole('button', { name: 'Add Tasks' }));
    await waitFor(() => expect(screen.getByText('Tasks added. The next pass copies it.')).toBeTruthy());

    rerender([
      { domain: 'calendar', state: 'on' },
      { domain: 'contact', state: 'on' },
      { domain: 'task', state: 'on' },
    ]);
    expect(screen.getByText('Tasks added. The next pass copies it.')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows a refusal in the server’s words, never as an add that worked', async () => {
    const reason = "'task' is already part of this migration.";
    addDomain.mockRejectedValue(axiosError(409, { error: 'kind_refused', message: reason, reason }));
    renderPanel(BEFORE);

    await userEvent.click(screen.getByRole('button', { name: 'Add Tasks' }));

    await waitFor(() => expect(screen.getByText(`${EN['settings.kinds.failed']} ${reason}`)).toBeTruthy());
    expect(screen.queryByText('Tasks added. The next pass copies it.')).toBeNull();
  });
});
