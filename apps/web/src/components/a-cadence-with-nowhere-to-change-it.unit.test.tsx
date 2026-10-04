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
 *  5. each cadence's words say how often it runs, in both languages;
 *  6. it is a fold, closed, in a family's words (0153 T6 (b)), that says the
 *     cadence in force without being opened.
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
import { LocaleProvider } from '../i18n/index.tsx';

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

  it('says a first copy does not wait for the schedule, in both languages (0156 T5)', () => {
    // Until 2026-10-03 the panel said a daily schedule copied for 50 minutes a
    // day, which was true and was the defect the owner asked to end: a first
    // copy now runs pass after pass, and the schedule applies after it.
    renderPanel('0 2 * * *');
    expect(screen.getByText(EN['settings.schedule.hint'])).toBeInTheDocument();
    expect(EN['settings.schedule.hint']).toBe('Passes run back to back until the first copy is done.');
    expect(NL['settings.schedule.hint']).toBe('Rondes lopen direct na elkaar tot de eerste kopie klaar is.');
    for (const [locale, why] of [
      ['en', EN['settings.schedule.hint.why']],
      ['nl', NL['settings.schedule.hint.why']],
    ] as const) {
      expect(why, locale).not.toMatch(/50 minutes a day|50 minuten per dag/);
      expect(why, locale).toMatch(/15 minut/);
    }
    // The wizard, where the schedule is first chosen, says the same.
    expect(EN['wizard.scheduleHint']).toContain('does not wait for this schedule');
    expect(NL['wizard.scheduleHint']).toContain('niet op dit schema wacht');
  });
});

/**
 * FOLDED, IN A FAMILY'S WORDS (workplan 0153 T6 (b); the owner approved the
 * words on 2026-09-28): *How often to look for changes* where it said *Sync
 * schedule*, as a fold that stays closed until somebody opens it, and says the
 * cadence in force while closed.
 */
describe('the fold, in a family’s words (0153 T6 (b))', () => {
  /** The fold, by the words on it. */
  const fold = () => screen.getByText(EN['settings.schedule']).closest('details');

  it('is a fold, closed, headed in the owner’s words', () => {
    renderPanel('0 * * * *');
    expect(fold()).not.toBeNull();
    expect(fold()).not.toHaveAttribute('open');
    expect(EN['settings.schedule']).toBe('How often to look for changes');
    expect(NL['settings.schedule']).toBe('Hoe vaak naar wijzigingen kijken');
    // The chooser and its save sit inside it.
    expect(fold()!.contains(save())).toBe(true);
  });

  it('says the cadence in force while closed, in the chooser’s words', () => {
    const summary = () => fold()!.querySelector('summary')!.textContent;
    const { unmount } = renderPanel('0 * * * *');
    expect(summary()).toBe(`${EN['settings.schedule']} · ${EN['wizard.schedule.hourly']}`);
    unmount();

    // No schedule of its own: the tick's every 15 minutes.
    const second = renderPanel(undefined);
    expect(summary()).toContain(EN['wizard.schedule.quarterHourly']);
    second.unmount();

    // A cadence the chooser does not offer: nothing guessed on the fold, and
    // the line inside says what runs.
    renderPanel('30 3 * * 1');
    expect(summary()).toBe(EN['settings.schedule']);
    expect(screen.getByText(/^Now: 30 3 \* \* 1/)).toBeInTheDocument();
  });

  it('in Dutch', () => {
    window.localStorage.setItem('ownpace.locale', 'nl');
    try {
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(
        <LocaleProvider>
          <QueryClientProvider client={qc}>
            <SchedulePanel mappingId="m-1" current="0 2 * * *" />
          </QueryClientProvider>
        </LocaleProvider>,
      );
      const summary = screen.getByText(NL['settings.schedule']).closest('summary');
      expect(summary?.textContent).toBe(`${NL['settings.schedule']} · ${NL['wizard.schedule.daily']}`);
    } finally {
      window.localStorage.removeItem('ownpace.locale');
    }
  });
});
