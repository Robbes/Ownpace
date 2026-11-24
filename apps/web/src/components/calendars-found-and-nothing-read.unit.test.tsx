// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * CALENDARS FOUND, AND NO EVENT READ FROM THEM (2026-11-24).
 *
 * A Microsoft 365 migration listed a personal account's four calendars and
 * read no event from any of them, and the calendar row said a green *Kept in
 * step* with *none found to copy*: the sentence a source with nothing in it
 * earns. The account held a weekly event and a holiday calendar. The run log
 * had the truth (*"4 collection(s) listed and NOT ONE ITEM scanned"*); the
 * screen now says it too, in amber, in the card's line and in the live strip,
 * in English and in Dutch (`listedButEmpty` in `@openmig/shared`).
 */
import type { ReactElement } from 'react';
import { render as renderBare, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { domainProgressOf, listedButEmpty, type DomainStatusReport } from '@openmig/shared';
import { LocaleProvider } from '../i18n/index.tsx';
import LiveProgress, { type LiveProgressRow } from './LiveProgress.tsx';
import { MigrationLines } from './MigrationLines.tsx';
import type { LinesProgress } from '../services/stage-line.ts';

const render = (ui: ReactElement) => renderBare(<MemoryRouter><LocaleProvider>{ui}</LocaleProvider></MemoryRouter>);
afterEach(() => window.localStorage.removeItem('ownpace.locale'));

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

/** The calendar row as the owner's migration had it: four calendars, nothing read, nothing found. */
const EMPTY_CALENDARS: DomainStatusReport = {
  domain: 'calendar',
  state: 'completed',
  itemsSynced: 0,
  itemsFailed: 0,
  bytesTransferred: 0,
  itemsRetrying: 0,
  itemsNeedingDecision: 0,
  itemsAdopted: 0,
  itemsFound: 0,
  lastSyncedAt: ago(120_000),
  lastPass: { items: 0, wallMs: 900, sourceFetchMs: 0, targetWriteMs: 0, ledgerMs: 0, hashMs: 0, overlap: 0, collectionsOpened: 4 },
};

describe('which rows it is', () => {
  it('a calendar row whose last pass opened calendars and read nothing, with nothing ever copied', () => {
    expect(listedButEmpty(EMPTY_CALENDARS)).toBe(4);
  });

  it('not a row that copied something, nor one whose last pass read items, nor another data type, nor a pass with no metrics', () => {
    expect(listedButEmpty({ ...EMPTY_CALENDARS, itemsSynced: 3 })).toBeUndefined();
    expect(listedButEmpty({ ...EMPTY_CALENDARS, itemsAdopted: 2 })).toBeUndefined();
    expect(listedButEmpty({ ...EMPTY_CALENDARS, lastPass: { ...EMPTY_CALENDARS.lastPass!, items: 7 } })).toBeUndefined();
    expect(listedButEmpty({ ...EMPTY_CALENDARS, domain: 'email' })).toBeUndefined();
    const { lastPass: _none, ...unmeasured } = EMPTY_CALENDARS;
    expect(listedButEmpty(unmeasured)).toBeUndefined();
    expect(listedButEmpty({ ...EMPTY_CALENDARS, lastPass: { ...EMPTY_CALENDARS.lastPass!, collectionsOpened: 0 } })).toBeUndefined();
  });

  it('travels on the progress read a person’s card draws from', () => {
    expect(domainProgressOf(EMPTY_CALENDARS, { phase: 'active' }).listedButEmpty).toBe(4);
    expect(domainProgressOf({ ...EMPTY_CALENDARS, itemsSynced: 1 }, { phase: 'active' })).not.toHaveProperty('listedButEmpty');
  });
});

const MIGRATION = {
  sourceType: 'm365',
  targetType: 'cirrux',
  status: 'active' as const,
  domains: ['calendar'] as 'calendar'[],
  lastSyncAt: ago(120_000),
};

const lines = (): LinesProgress => ({
  report: { mappingId: 'm', domains: [domainProgressOf(EMPTY_CALENDARS, { phase: 'active' })], check: { state: 'not_run' } },
  failuresWaiting: 0,
});

describe('a person’s card', () => {
  it('says it in amber, and never *none found to copy*', () => {
    render(<MigrationLines migration={MIGRATION} progress={lines()} />);
    const said = screen.getByText(/4 calendars found, but not one event read from them/);
    expect(said.getAttribute('data-tone')).toBe('amber');
    expect(said.className).toContain('text-amber');
    expect(screen.queryByText(/none found to copy/)).toBeNull();
  });

  it('in Dutch', () => {
    window.localStorage.setItem('ownpace.locale', 'nl');
    render(<MigrationLines migration={MIGRATION} progress={lines()} />);
    expect(screen.getByText(/4 agenda's gevonden, maar er is geen enkele afspraak uit gelezen/)).toBeTruthy();
    expect(screen.queryByText(/niets gevonden om te migreren/)).toBeNull();
  });
});

describe('the live strip on a migration’s page', () => {
  const strip = (over: Partial<LiveProgressRow> = {}) => <LiveProgress domains={[{ ...EMPTY_CALENDARS, ...over }]} stages={{ calendar: 'kept_in_step' }} />;

  it('says it in amber beside the stage, and never *none found to copy*', () => {
    render(strip());
    const said = screen.getByText('4 calendars found, but not one event read from them');
    expect(said.getAttribute('data-tone')).toBe('amber');
    expect(screen.queryByText('none found to copy')).toBeNull();
  });

  it('one calendar, in the singular, and in Dutch', () => {
    render(strip({ lastPass: { items: 0, collectionsOpened: 1 } }));
    expect(screen.getByText('1 calendar found, but not one event read from it')).toBeTruthy();
  });

  it('in Dutch', () => {
    window.localStorage.setItem('ownpace.locale', 'nl');
    render(strip({ lastPass: { items: 0, collectionsOpened: 1 } }));
    expect(screen.getByText('1 agenda gevonden, maar er is geen enkele afspraak uit gelezen')).toBeTruthy();
  });

  it('a source with nothing in it still says none were found', () => {
    render(strip({ lastPass: { items: 0, collectionsOpened: 0 } }));
    expect(screen.getByText('none found to copy')).toBeTruthy();
  });
});
