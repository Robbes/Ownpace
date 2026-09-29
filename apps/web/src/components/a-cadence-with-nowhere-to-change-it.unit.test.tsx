// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A CADENCE WITH NOWHERE TO CHANGE IT (the owner, 2026-09-28).
 *
 * The owner asked, of his hourly Dropbox migration, whether he could make it
 * every 15 minutes. The revision table said a schedule may change, and no
 * screen offered it: the wizard was the only place a schedule was ever
 * chosen. He chose to have it on the migration page. These hold that panel:
 *
 *  1. it shows the schedule in force, and for a migration holding none of the
 *     four, says what runs instead rather than selecting a guess;
 *  2. it offers no save until something changed, and sends only the schedule;
 *  3. a refusal is shown as a refusal and a failure as a failure, never as
 *     "Saved" (hard rule 9);
 *  4. it offers what the wizard offers, through the wizard's own control, and
 *     every cadence offered is one the route accepts;
 *  5. each cadence's words say how often it runs, in both languages.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AxiosError, AxiosHeaders } from 'axios';
import { describeCronScheduleProblem } from '@openmig/shared';
import { STRINGS } from '../i18n/strings.ts';

const { setSchedule } = vi.hoisted(() => ({ setSchedule: vi.fn() }));
vi.mock('../services/mapping-service', () => ({ mappingApi: { setSchedule } }));

import SchedulePanel from './SchedulePanel.tsx';
import { SCHEDULE_PRESETS } from './ScheduleChooser.tsx';

const EN = STRINGS.en;
const NL = STRINGS.nl;

/** An axios-shaped answer, the way the real apiClient delivers one. */
const axiosError = (status: number, data: unknown): AxiosError => {
  const err = new AxiosError(`Request failed with status code ${status}`);
  err.response = { status, statusText: 'x', headers: {}, config: { headers: new AxiosHeaders() }, data };
  return err;
};

function renderPanel(current: string | undefined) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SchedulePanel mappingId="m-1" current={current} />
    </QueryClientProvider>,
  );
}

/** A cadence's button, by the name the reader sees on it. */
const cadence = (labelKey: keyof typeof EN) =>
  screen.getByRole('button', { name: new RegExp(`^${EN[labelKey]}`) });
const save = () => screen.getByRole('button', { name: EN['settings.schedule.save'] });

beforeEach(() => {
  vi.clearAllMocks();
  setSchedule.mockResolvedValue({ id: 'm-1', syncConfig: { schedule: '*/15 * * * *' }, updatedAt: 'now' });
});

describe('what the panel shows first', () => {
  it('selects the schedule in force, and none of the others', () => {
    renderPanel('0 * * * *');
    expect(cadence('wizard.schedule.hourly')).toHaveAttribute('aria-pressed', 'true');
    for (const other of ['wizard.schedule.daily', 'wizard.schedule.sixHourly', 'wizard.schedule.quarterHourly'] as const) {
      expect(cadence(other)).toHaveAttribute('aria-pressed', 'false');
    }
    expect(screen.queryByText(/^Now:/)).toBeNull();
  });

  it('says a migration without a schedule runs every 15 minutes, and selects nothing', () => {
    renderPanel(undefined);
    expect(screen.getByText(EN['settings.schedule.default'])).toBeInTheDocument();
    expect(screen.queryAllByRole('button', { pressed: true })).toHaveLength(0);
  });

  it('names a cadence set outside this page, rather than selecting a guess', () => {
    renderPanel('30 3 * * 1');
    expect(screen.getByText('Now: 30 3 * * 1, set outside this page.')).toBeInTheDocument();
    expect(screen.queryAllByRole('button', { pressed: true })).toHaveLength(0);
  });
});

describe('the press', () => {
  it('is not offered until something changed', async () => {
    renderPanel('0 * * * *');
    expect(save()).toBeDisabled();
    await userEvent.click(cadence('wizard.schedule.hourly'));
    expect(save()).toBeDisabled();
    await userEvent.click(cadence('wizard.schedule.quarterHourly'));
    expect(save()).toBeEnabled();
  });

  it('sends the schedule chosen, and says the next pass follows it', async () => {
    renderPanel('0 * * * *');
    await userEvent.click(cadence('wizard.schedule.quarterHourly'));
    await userEvent.click(save());
    expect(setSchedule).toHaveBeenCalledTimes(1);
    expect(setSchedule).toHaveBeenCalledWith('m-1', '*/15 * * * *');
    expect(await screen.findByText(EN['settings.schedule.saved'])).toBeInTheDocument();
  });

  it('shows a refusal as the refusal it is, never as saved', async () => {
    setSchedule.mockRejectedValue(
      axiosError(409, {
        error: 'revision_refused',
        refused: [{ field: 'schedule', reason: 'This migration cannot change its schedule now.' }],
      }),
    );
    renderPanel('0 * * * *');
    await userEvent.click(cadence('wizard.schedule.daily'));
    await userEvent.click(save());
    expect(await screen.findByText(EN['settings.schedule.refused'])).toBeInTheDocument();
    expect(screen.getByText('This migration cannot change its schedule now.')).toBeInTheDocument();
    expect(screen.queryByText(EN['settings.schedule.saved'])).toBeNull();
  });

  it('shows a failure in the server’s words, never as saved', async () => {
    setSchedule.mockRejectedValue(axiosError(500, { error: 'update_failed', message: 'The database is away.' }));
    renderPanel('0 * * * *');
    await userEvent.click(cadence('wizard.schedule.daily'));
    await userEvent.click(save());
    expect(await screen.findByText(new RegExp(`^${EN['settings.schedule.failed']}`))).toBeInTheDocument();
    expect(screen.queryByText(EN['settings.schedule.saved'])).toBeNull();
  });
});

describe('what is offered', () => {
  it('is the wizard’s four, through the wizard’s own control', () => {
    expect(SCHEDULE_PRESETS.map((p) => p.value)).toEqual(['0 * * * *', '0 2 * * *', '0 */6 * * *', '*/15 * * * *']);
    const wizard = readFileSync(join(import.meta.dirname, '../pages/CreateMapping.tsx'), 'utf-8');
    expect(wizard).toContain('<ScheduleChooser');
    // A second list of labelled cadences in the wizard is the drift this
    // control ends. (Its `'0 2 * * *'` fallback, sent when none is picked, is
    // not an offer, and stays.)
    expect(wizard).not.toMatch(/labelKey: 'wizard\.schedule\./);
  });

  it('is every one a cadence the route accepts', () => {
    for (const preset of SCHEDULE_PRESETS) expect(describeCronScheduleProblem(preset.value), preset.value).toBeNull();
  });

  it('says how often each cadence runs, in both languages', () => {
    // `0 */6 * * *` runs at 00:00, 06:00, 12:00 and 18:00. Its words said six.
    expect(EN['wizard.schedule.sixHourly.hint']).toBe('Four times a day');
    expect(NL['wizard.schedule.sixHourly.hint']).toBe('Vier keer per dag');
  });
});
