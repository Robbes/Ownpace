// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A STEP LIST THAT SAYS WHAT IS TRUE OF THESE MIGRATIONS (UX sweep, 2026-10-17).
 *
 * The seven steps before a switch (`CutoverSteps`, 0154 T4) said the same
 * words whatever the migrations were:
 *
 * - Finish said *Switch mail delivery, then end* of a Dropbox, a Box, or a
 *   calendar-and-contacts migration, whose Finish page has no mail step;
 * - a migration kept in step after its switch read *Not yet* at Finish, as if
 *   it had started over;
 * - a person's queue steps listed every migration under every step, most of
 *   them as *(0)*, a link to no work.
 *
 * The owner's sentence stays for every migration that carries mail, and for
 * any whose data types are not known.
 */
import { render, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, it, expect } from 'vitest';
import type { CheckFacts, MappingAttention } from '@openmig/shared';
import { CutoverSteps, type StepsRow } from './CutoverSteps.tsx';
import { LocaleProvider } from '../i18n/index.tsx';

const quiet = (mappingId: string, over: Partial<MappingAttention> = {}): MappingAttention => ({
  mappingId,
  pendingDecisions: 0,
  deletionsWaiting: 0,
  movesWaiting: 0,
  failuresWaiting: 0,
  readyForCutover: false,
  autoApplied: 0,
  sharingOpen: 0,
  ...over,
});
const NOT_RUN: CheckFacts = { state: 'not_run' };
const READ = { queues: false, check: false, lifecycle: false };

function drawn(migrations: StepsRow[], attention: MappingAttention[] = migrations.map((m) => quiet(m.id))) {
  render(
    <MemoryRouter>
      <CutoverSteps
        migrations={migrations}
        attention={new Map(attention.map((a) => [a.mappingId, a]))}
        checks={new Map(migrations.map((m): [string, CheckFacts] => [m.id, NOT_RUN]))}
        pending={READ}
      />
    </MemoryRouter>,
  );
}
const step = (key: string) => document.querySelector(`[data-step="${key}"]`) as HTMLElement;

describe('Finish, in words that fit the migrations', () => {
  it('says the switch to the new system for migrations that move no mail', () => {
    drawn([
      { id: 'm-files', status: 'active', label: 'Anna files', domains: ['file'] },
      { id: 'm-cal', status: 'active', label: 'Anna calendar', domains: ['calendar', 'contact'] },
    ]);
    expect(step('finish').textContent).toContain('Switch to the new system, then end');
    expect(step('finish').textContent).not.toContain('mail delivery');
  });

  it('keeps the mail’s switch where one of them carries mail', () => {
    drawn([
      { id: 'm-files', status: 'active', label: 'Anna files', domains: ['file'] },
      { id: 'm-mail', status: 'active', label: 'Anna mail', domains: ['email', 'calendar'] },
    ]);
    expect(step('finish').textContent).toContain('Switch mail delivery, then end');
  });

  it('keeps the mail’s switch where the data types are not known', () => {
    drawn([{ id: 'm1', status: 'active', label: 'Acme' }]);
    expect(step('finish').textContent).toContain('Switch mail delivery, then end');
  });

  it('says it in Dutch too', () => {
    window.localStorage.setItem('ownpace.locale', 'nl');
    try {
      render(
        <LocaleProvider>
          <MemoryRouter>
            <CutoverSteps
              migrations={[
                { id: 'm-files', status: 'active', label: 'Bestanden', domains: ['file'] },
                { id: 'm-box', status: 'continuous', label: 'Box', domains: ['file'] },
              ]}
              attention={new Map([['m-files', quiet('m-files')], ['m-box', quiet('m-box')]])}
              checks={new Map([['m-files', NOT_RUN]])}
              pending={READ}
            />
          </MemoryRouter>
        </LocaleProvider>,
      );
      expect(step('finish').textContent).toContain('Stap over op het nieuwe systeem, en rond dan af');
    } finally {
      window.localStorage.removeItem('ownpace.locale');
    }
  });
});

describe('a migration kept in step after its switch', () => {
  it('reads as switched and kept in step, not as one that has to start again', () => {
    drawn([{ id: 'm-box', status: 'continuous', label: 'Box', domains: ['file'] }]);
    expect(step('finish').textContent).toContain('Switched, and kept in step');
    expect(step('finish').textContent).toContain('Done');
    expect(step('check').textContent).toContain('Passed');
    expect(step('check').textContent).not.toContain('Not run yet');
  });

  it('says Finished once every one is done and none is kept in step', () => {
    drawn([{ id: 'm1', status: 'done', label: 'Acme', domains: ['email'] }]);
    expect(step('finish').textContent).toContain('Finished');
    expect(step('finish').textContent).not.toContain('kept in step');
  });
});

describe('a queue’s step, of a person’s several migrations', () => {
  const two: StepsRow[] = [
    { id: 'm-mail', status: 'active', label: 'Anna mail', domains: ['email'] },
    { id: 'm-files', status: 'active', label: 'Anna files', domains: ['file'] },
  ];
  const names = (key: string) => within(step(key)).queryAllByRole('link').map((a) => a.textContent);

  it('lists only the migrations with work in it', () => {
    drawn(two, [quiet('m-mail', { deletionsWaiting: 2 }), quiet('m-files')]);
    expect(names('deletions')).toEqual(['Anna mail (2)']);
    // Nothing in it anywhere: the count says None, and no link points at nothing.
    expect(step('moves').textContent).toContain('None');
    expect(names('moves')).toEqual([]);
    expect(step('moves').querySelector('ul')).toBeNull();
    // Not a queue: every migration, each to its own page.
    expect(names('check')).toEqual(['Anna mail', 'Anna files']);
    expect(names('finish')).toEqual(['Anna mail', 'Anna files']);
  });

  /** Hard rule 9: a count that could not be read is not none. */
  it('keeps the link of a migration whose count could not be read', () => {
    drawn(two, [quiet('m-mail'), quiet('m-files', { blindSpots: ['the deletions queue: timeout'] })]);
    expect(names('deletions')).toEqual(['Anna files (could not be read)']);
  });

  it('lists every migration while the count is still being read', () => {
    render(
      <MemoryRouter>
        <CutoverSteps migrations={two} attention={undefined} checks={undefined} pending={{ ...READ, queues: true }} />
      </MemoryRouter>,
    );
    expect(names('failures')).toEqual(['Anna mail', 'Anna files']);
  });

  it('a migration that never ran: its empty queues are not yet done', () => {
    drawn([{ id: 'm1', status: 'paused', label: 'Acme', notStarted: true, domains: ['email'] }]);
    for (const key of ['deletions', 'moves', 'failures']) {
      expect(step(key).textContent, key).toContain('None');
      expect(step(key).textContent, key).toContain('Not yet');
      expect(step(key).textContent, key).not.toContain('Done');
    }
  });
});
