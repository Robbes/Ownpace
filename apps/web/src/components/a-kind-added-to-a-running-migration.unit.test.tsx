// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A KIND ADDED TO A RUNNING MIGRATION: the page half (workplan 0125 T6).
 *
 * The owner reconnected his Google account with Tasks ticked and his running
 * migration had nowhere to take them. The panel shows what the migration
 * copies and offers exactly what the shared rule calls addable; these pin that
 * it offers, says, sends and refuses the way the route does.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AxiosError, AxiosHeaders } from 'axios';
import { STRINGS } from '../i18n/strings.ts';
import { LocaleProvider } from '../i18n/index.tsx';
import type { KindChoiceView } from '../services/mapping-service.ts';

const { addDomain } = vi.hoisted(() => ({ addDomain: vi.fn() }));
vi.mock('../services/mapping-service', () => ({ mappingApi: { addDomain } }));

import MigrationKindsPanel from './MigrationKindsPanel.tsx';

const EN = STRINGS.en;
const NL = STRINGS.nl;

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
    expect(screen.getByRole('button', { name: 'Add tasks' })).toBeTruthy();
    expect(screen.getByText(EN['settings.kinds.consequence'])).toBeTruthy();
  });

  it('shows a refused data type with no code in the rule’s own sentence, said as English, and no button', () => {
    const reason = 'A kind can only be added before cutover.';
    renderPanel([
      { domain: 'calendar', state: 'on' },
      { domain: 'task', state: 'refused', reason },
    ]);
    expect(screen.getByText(reason)).toBeTruthy();
    // An older API's refusal, or one this page has no words for: shown as
    // served, and marked English so a Dutch screen reader does not mangle it.
    expect(screen.getByText(reason).getAttribute('lang')).toBe('en');
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

/**
 * A REFUSAL IN THE READER'S LANGUAGE (UX sweep, 2026-10-17).
 *
 * The rule's `reason` is English developer prose, written for the API, its
 * logs and the appliance: *"A kind can only be added before cutover. From
 * cutover on, the old account no longer decides what exists…"*, or *"This
 * account MEASURED that it cannot carry 'task'"*. A Dutch screen showed it as
 * served. The rule now says which refusal it was in `code`, and the page says
 * that in the reader's words.
 */
describe('a refused data type, in the reader’s language', () => {
  const SERVED = 'A kind can only be added before cutover. From cutover on, the old account no longer decides.';

  afterEach(() => {
    window.localStorage.removeItem('ownpace.locale');
  });

  function renderIn(locale: 'en' | 'nl', choices: KindChoiceView[]) {
    window.localStorage.setItem('ownpace.locale', locale);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={qc}>
        <LocaleProvider>
          <MigrationKindsPanel mappingId="m-1" choices={choices} />
        </LocaleProvider>
      </QueryClientProvider>,
    );
  }

  it.each([
    ['en', 'after_cutover', EN['settings.kinds.refused.afterCutover']],
    ['nl', 'after_cutover', NL['settings.kinds.refused.afterCutover']],
    ['en', 'measured_no', EN['settings.kinds.refused.measured']],
    ['nl', 'measured_no', NL['settings.kinds.refused.measured']],
  ] as const)('under %s, a %s refusal reads the page’s own sentence', (locale, code, words) => {
    renderIn(locale, [
      { domain: 'calendar', state: 'on' },
      { domain: 'task', state: 'refused', reason: SERVED, code },
    ]);
    expect(words).toBeTruthy();
    const line = screen.getByText(words);
    expect(line.getAttribute('lang')).toBeNull();
    expect(screen.queryByText(SERVED)).toBeNull();
  });

  it('under nl, a refusal with no code shows the served English, said as English', () => {
    renderIn('nl', [
      { domain: 'calendar', state: 'on' },
      { domain: 'task', state: 'refused', reason: SERVED },
    ]);
    expect(screen.getByText(SERVED).getAttribute('lang')).toBe('en');
    // The data type's own name is the reader's.
    expect(screen.getByText(NL['domain.task'])).toBeTruthy();
  });
});

describe('the buttons, in sentence case', () => {
  afterEach(() => {
    window.localStorage.removeItem('ownpace.locale');
  });

  it('lower-cases the data type only in English: Dutch still reads “Taken toevoegen”', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    window.localStorage.setItem('ownpace.locale', 'nl');
    render(
      <QueryClientProvider client={qc}>
        <LocaleProvider>
          <MigrationKindsPanel mappingId="m-1" choices={BEFORE} />
        </LocaleProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByRole('button', { name: 'Taken toevoegen' })).toBeTruthy();
  });
});

describe('the press', () => {
  it('adds the data type, says so, and reads the migration again', async () => {
    addDomain.mockResolvedValue({ id: 'm-1', added: 'task', domains: ['calendar', 'contact', 'task'] });
    const { invalidate } = renderPanel(BEFORE);

    await userEvent.click(screen.getByRole('button', { name: 'Add tasks' }));

    expect(addDomain).toHaveBeenCalledWith('m-1', 'task');
    await waitFor(() => expect(screen.getByText('Tasks added. The next pass copies it.')).toBeTruthy());
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['mapping', 'm-1'] });
  });

  it('keeps the confirmation when the re-read shows everything as copied', async () => {
    addDomain.mockResolvedValue({ id: 'm-1', added: 'task', domains: ['calendar', 'contact', 'task'] });
    const { rerender } = renderPanel(BEFORE);
    await userEvent.click(screen.getByRole('button', { name: 'Add tasks' }));
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

    await userEvent.click(screen.getByRole('button', { name: 'Add tasks' }));

    await waitFor(() => expect(screen.getByText(`${EN['settings.kinds.failed']} ${reason}`)).toBeTruthy());
    expect(screen.queryByText('Tasks added. The next pass copies it.')).toBeNull();
  });
});
