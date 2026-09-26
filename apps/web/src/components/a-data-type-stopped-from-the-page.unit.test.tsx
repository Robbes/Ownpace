// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A DATA TYPE STOPPED AND RESUMED FROM THE MIGRATION'S PAGE (workplan 0128
 * T4, slice 3c): the panel half.
 *
 * The panel shows each data type's stop the way the stop door's own rule
 * made it (`pathStopChoices`): the button is the press the door accepts, and
 * a line with none says why only where the owner would look for one. These
 * pin that it offers, says, sends and refuses the way the door does, with or
 * without the add choices the appliance does not have.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AxiosError, AxiosHeaders } from 'axios';
import { STRINGS } from '../i18n/strings.ts';
import type { KindChoiceView, StopChoiceView } from '../services/mapping-service.ts';

const { addDomain, stopOrResumeDataType } = vi.hoisted(() => ({
  addDomain: vi.fn(),
  stopOrResumeDataType: vi.fn(),
}));
vi.mock('../services/mapping-service', () => ({ mappingApi: { addDomain } }));
vi.mock('../services/operating-service', () => ({ stopOrResumeDataType }));

import MigrationKindsPanel from './MigrationKindsPanel.tsx';

const EN = STRINGS.en;

/** Mail, calendars and contacts, all copying: each may be stopped. */
const COPYING: StopChoiceView[] = [
  { domain: 'email', stopped: false, offer: 'stop' },
  { domain: 'calendar', stopped: false, offer: 'stop' },
  { domain: 'contact', stopped: false, offer: 'stop' },
];

/** Mail and calendars stopped: contacts are the last one still copying (D5). */
const LAST_ONE: StopChoiceView[] = [
  { domain: 'email', stopped: true, offer: 'resume' },
  { domain: 'calendar', stopped: true, offer: 'resume' },
  { domain: 'contact', stopped: false, offer: null, held: 'last_one_copying' },
];

const on = (stops: StopChoiceView[]): KindChoiceView[] => stops.map((s) => ({ domain: s.domain, state: 'on' }));

const axiosError = (status: number, data: unknown): AxiosError => {
  const err = new AxiosError(`Request failed with status code ${status}`);
  err.response = { status, statusText: 'Conflict', headers: {}, config: { headers: new AxiosHeaders() }, data };
  return err;
};

function renderPanel(choices: KindChoiceView[] | undefined, stops: StopChoiceView[] | undefined) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  const view = render(
    <QueryClientProvider client={qc}>
      <MigrationKindsPanel mappingId="m-1" choices={choices} stops={stops} />
    </QueryClientProvider>,
  );
  return { ...view, invalidate };
}

beforeEach(() => {
  addDomain.mockReset();
  stopOrResumeDataType.mockReset();
});

describe('what the panel offers', () => {
  it('offers Stop for each data type the door would stop, and says what a stop does first', () => {
    renderPanel(on(COPYING), COPYING);
    for (const name of ['Stop Email', 'Stop Calendar', 'Stop Contacts']) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
    expect(screen.getByText(EN['settings.kinds.stop.consequence'])).toBeTruthy();
    expect(screen.queryByText(EN['settings.kinds.stoppedByYou'])).toBeNull();
  });

  it('shows a stopped data type as stopped by you, with Resume, and the last one copying with no Stop (D5)', () => {
    renderPanel(on(LAST_ONE), LAST_ONE);
    expect(screen.getAllByText(EN['settings.kinds.stoppedByYou'])).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Resume Email' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Resume Calendar' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Stop Contacts' })).toBeNull();
    expect(screen.getByText(EN['settings.kinds.held.lastOne'])).toBeTruthy();
    // Nothing on the page can be stopped, so nothing is said about stopping.
    expect(screen.queryByText(EN['settings.kinds.stop.consequence'])).toBeNull();
  });

  it('says a stopped data type comes back with the migration, and offers nothing while it does not run', () => {
    const paused: StopChoiceView[] = [
      { domain: 'email', stopped: true, offer: null, held: 'not_running' },
      { domain: 'calendar', stopped: false, offer: null },
    ];
    renderPanel(on(paused), paused);
    expect(screen.getByText(EN['settings.kinds.stoppedByYou'])).toBeTruthy();
    expect(screen.getByText(EN['settings.kinds.held.notRunning'])).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders nothing with nothing to add and nothing to stop: one data type, running', () => {
    const one: StopChoiceView[] = [{ domain: 'email', stopped: false, offer: null }];
    const { container } = renderPanel(on(one), one);
    expect(container.textContent).toBe('');
  });

  it('lists the stops alone where there are no choices, as on the appliance', () => {
    renderPanel(undefined, COPYING);
    expect(screen.getByRole('button', { name: 'Stop Calendar' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Add / })).toBeNull();
  });

  it('keeps offering what may be added beside the stops', () => {
    renderPanel([...on(COPYING), { domain: 'task', state: 'addable' }], COPYING);
    expect(screen.getByRole('button', { name: 'Add Tasks' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Stop Email' })).toBeTruthy();
  });
});

describe('the press', () => {
  it('stops the data type, says so, and reads both editions’ payloads again', async () => {
    stopOrResumeDataType.mockResolvedValue({ id: 'm-1', domain: 'email', stopped: true, changed: true });
    const { invalidate } = renderPanel(on(COPYING), COPYING);

    await userEvent.click(screen.getByRole('button', { name: 'Stop Email' }));

    expect(stopOrResumeDataType).toHaveBeenCalledWith('m-1', 'email', 'stop');
    await waitFor(() =>
      expect(
        screen.getByText('Email is stopped. Its copies stay; resume it to continue where it stopped.'),
      ).toBeTruthy(),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['mapping', 'm-1'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['status'] });
  });

  it('resumes a stopped data type, and says the next pass continues', async () => {
    stopOrResumeDataType.mockResolvedValue({ id: 'm-1', domain: 'calendar', stopped: false, changed: true });
    renderPanel(on(LAST_ONE), LAST_ONE);

    await userEvent.click(screen.getByRole('button', { name: 'Resume Calendar' }));

    expect(stopOrResumeDataType).toHaveBeenCalledWith('m-1', 'calendar', 'resume');
    await waitFor(() =>
      expect(screen.getByText('Calendar is resumed. The next pass continues where it stopped.')).toBeTruthy(),
    );
  });

  it('shows a refusal in the door’s own words, never as a stop that worked', async () => {
    const reason = 'email is the last data type still copying. To stop it, end the migration instead.';
    stopOrResumeDataType.mockRejectedValue(
      axiosError(409, { error: 'stop_refused', refused: 'last_one_copying', message: reason, reason }),
    );
    renderPanel(on(COPYING), COPYING);

    await userEvent.click(screen.getByRole('button', { name: 'Stop Email' }));

    await waitFor(() => expect(screen.getByText(`${EN['settings.kinds.stop.failed']} ${reason}`)).toBeTruthy());
    expect(screen.queryByText(/Email is stopped\./)).toBeNull();
  });
});
