// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A PAGE PER PERSON (workplan 0153 T5): the person's name, where from and
 * where to, one stage, what waits on them, their migrations' lines with a way
 * to each migration's own page, and their steps before they switch as one
 * ordered list (0154 T4). A failed read is a failure on screen, and a count
 * that could not be read says so (hard rule 9). Beside a migration that waits
 * for their grant, what the grant does to it when it lands (start when granted,
 * per person).
 */
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AxiosError, AxiosHeaders } from 'axios';
import { lifecycleCounts, type MappingAttention, type Person as PersonShape, type PersonMigration } from '@openmig/shared';
import Person from './Person.tsx';
import { mappingApi, type MappingListItem } from '../services/mapping-service.ts';
import { fetchAttention, fetchPeople } from '../services/operating-service.ts';
import { personLinkApi } from '../services/grant-link-service.ts';
import userEvent from '@testing-library/user-event';

vi.mock('../services/mapping-service', () => ({ mappingApi: { list: vi.fn() } }));
vi.mock('../services/operating-service', () => ({ fetchPeople: vi.fn(), fetchAttention: vi.fn() }));
vi.mock('../services/grant-link-service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/grant-link-service.ts')>()),
  personLinkApi: { list: vi.fn(), issue: vi.fn(), revoke: vi.fn(), awaiting: vi.fn() },
}));

const listMock = vi.mocked(mappingApi.list);
const peopleMock = vi.mocked(fetchPeople);
const attentionMock = vi.mocked(fetchAttention);

const migration = (over: Partial<MappingListItem>): MappingListItem => ({
  id: 'm1',
  tenantId: 't1',
  name: 'Inbox',
  sourceType: 'gmail',
  targetType: 'soverin',
  status: 'active',
  mode: 'mirror',
  domains: ['email'],
  createdAt: '2026-07-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
  ...over,
});

const person = (id: string, displayName: string, migrations: PersonMigration[]): PersonShape => ({
  id,
  implicit: false,
  displayName,
  email: null,
  createdAt: '2026-09-28T10:00:00.000Z',
  migrations,
  counts: lifecycleCounts(migrations),
});

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

const MAIL = migration({ id: 'm-mail', name: 'Anna mail', lastSyncAt: '2026-09-28T09:00:00Z' });
const FILES = migration({ id: 'm-files', name: 'Anna files', sourceType: 'dropbox', targetType: 'nextcloud', domains: ['file'] });
const ANNA = person('p-anna', 'Anna Jansen', [
  { id: 'm-mail', status: 'active' },
  { id: 'm-files', status: 'active' },
]);

const renderAt = (path = '/people/p-anna') =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/people/:personId" element={<Person />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

const step = (key: string) => document.querySelector(`[data-step="${key}"]`) as HTMLElement;

beforeEach(() => {
  vi.resetAllMocks();
  listMock.mockResolvedValue([MAIL, FILES]);
  peopleMock.mockResolvedValue({ people: [ANNA], unassigned: [] });
  vi.mocked(personLinkApi.list).mockResolvedValue([]);
  vi.mocked(personLinkApi.awaiting).mockResolvedValue([]);
  attentionMock.mockResolvedValue({
    mappings: [quiet('m-mail', { deletionsWaiting: 2, failuresWaiting: 1 }), quiet('m-files', { sharingOpen: 5 })],
  });
});

describe("a person's page (0153 T5)", () => {
  it('says who, where from and where to, one stage, and what waits on them', async () => {
    renderAt();
    expect(await screen.findByRole('heading', { level: 1, name: 'Anna Jansen' })).toBeInTheDocument();
    expect(screen.getByText('From Google and Dropbox to Soverin and Nextcloud')).toBeInTheDocument();
    // One stage: the least advanced of the two.
    expect(screen.getAllByText('Copying').length).toBeGreaterThan(0);
    const needs = await screen.findByRole('link', { name: 'Needs you: 3 →' });
    expect(needs).toHaveAttribute('href', '#before-you-switch');
    expect(screen.getByRole('link', { name: '← Migrations' })).toHaveAttribute('href', '/mappings');
  });

  it("draws each migration's lines, with Details to its own page", async () => {
    renderAt();
    await screen.findAllByText('Anna mail');
    expect(screen.getByText('Email')).toBeInTheDocument();
    expect(screen.getByText('Files')).toBeInTheDocument();
    const details = screen.getAllByRole('link', { name: 'Details →' });
    expect(details.map((a) => a.getAttribute('href'))).toEqual(['/mappings/m-mail', '/mappings/m-files']);
    expect(screen.getByRole('link', { name: 'Add a migration' })).toHaveAttribute('href', '/start?person=p-anna');
    expect(screen.getByRole('link', { name: 'Add one migration by hand' })).toHaveAttribute(
      'href',
      '/mappings/new?person=p-anna',
    );
  });

  it('lists the steps before they switch, in cutover order, summed, with a state in words', async () => {
    renderAt();
    await screen.findByRole('heading', { name: 'Before you switch' });
    const keys = [...document.querySelectorAll('[data-step]')].map((el) => el.getAttribute('data-step'));
    expect(keys).toEqual(['deletions', 'moves', 'failures', 'sharing', 'check', 'confirmed', 'finish']);

    expect(step('deletions').textContent).toContain('2 to decide');
    expect(step('deletions').textContent).toContain('Needs you');
    expect(step('moves').textContent).toContain('None');
    expect(step('moves').textContent).toContain('Done');
    expect(step('failures').textContent).toContain('1 could not be copied');
    // Sharing is worked after finishing.
    expect(step('sharing').textContent).toContain('5 to go through');
    expect(step('sharing').textContent).toContain('Not yet');
    expect(step('check').textContent).toContain('Not passed yet');
    expect(step('confirmed').textContent).toContain('After the check');
    expect(step('finish').textContent).toContain('Switch mail delivery, then end');
  });

  it("opens each migration's own page for a step, when the person has several", async () => {
    renderAt();
    await screen.findByRole('heading', { name: 'Before you switch' });
    const links = within(step('failures')).getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/mappings/m-mail/failures',
      '/mappings/m-files/failures',
    ]);
  });

  it("says on each migration's link what that migration holds of a queue's step, so the work can be found", async () => {
    renderAt();
    await screen.findByRole('heading', { name: 'Before you switch' });
    const names = (key: string) => within(step(key)).getAllByRole('link').map((a) => a.textContent);
    expect(names('deletions')).toEqual(['Anna mail (2)', 'Anna files (0)']);
    expect(names('sharing')).toEqual(['Anna mail (0)', 'Anna files (5)']);
    // The check is not a queue: its links name the migration alone.
    expect(names('check')).toEqual(['Anna mail', 'Anna files']);
  });

  it("says a migration's own count could not be read, rather than showing none (hard rule 9)", async () => {
    attentionMock.mockResolvedValue({
      mappings: [quiet('m-mail', { deletionsWaiting: 2 }), quiet('m-files', { blindSpots: ['the deletions queue: timeout'] })],
    });
    renderAt();
    await screen.findByRole('heading', { name: 'Before you switch' });
    const [mail, files] = within(step('deletions')).getAllByRole('link');
    expect(mail).toHaveAccessibleName('Anna mail (2)');
    expect(files).toHaveAccessibleName('Anna files (could not be read)');
  });

  it('links the step itself to the migration, when the person has one', async () => {
    peopleMock.mockResolvedValue({ people: [person('p-anna', 'Anna Jansen', [{ id: 'm-mail', status: 'active' }])], unassigned: [] });
    renderAt();
    await screen.findByRole('heading', { name: 'Before you switch' });
    expect(within(step('check')).getByRole('link', { name: 'Check' })).toHaveAttribute('href', '/mappings/m-mail/verify');
  });

  it('says a count could not be read, and claims no state, when what waits cannot be read', async () => {
    attentionMock.mockRejectedValue(new Error('the database is unreachable'));
    renderAt();
    expect(await screen.findByText('Could not count what needs you.')).toBeInTheDocument();
    expect(step('deletions').textContent).toContain('Could not be read');
    expect(step('deletions').textContent).not.toContain('Done');
    expect(step('deletions').textContent).not.toContain('Needs you');
  });

  it('says the people could not be read, rather than that there is no such person (hard rule 9)', async () => {
    const err = new AxiosError('Request failed with status code 500');
    err.response = {
      status: 500,
      statusText: 'Error',
      headers: {},
      config: { headers: new AxiosHeaders() },
      data: { error: 'list_failed', reason: 'Something went wrong. Reference 1a2b3c4d.' },
    };
    peopleMock.mockRejectedValue(err);
    renderAt();
    expect(await screen.findByText('Could not load this person.')).toBeInTheDocument();
    expect(screen.getByText(/Reference 1a2b3c4d/)).toBeInTheDocument();
    expect(screen.queryByText('There is no such person here.')).not.toBeInTheDocument();
  });

  it('says there is no such person, for an address that names nobody here', async () => {
    renderAt('/people/p-nobody');
    expect(await screen.findByText('There is no such person here.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Before you switch' })).not.toBeInTheDocument();
  });
});

/**
 * FOR ANNA (ADR-0035, amended 2026-09-29; 0153 T5 (b)): one grant link for all
 * of their Google accounts, made on their page, its URL said once.
 */
describe("a person's grant link, on their page", () => {
  it('offers one link for all of their accounts, and says there is none yet', async () => {
    renderAt();
    const section = await screen.findByRole('region', { name: 'For Anna Jansen' });
    expect(within(section).getByRole('heading', { name: 'One grant link for everything' })).toBeInTheDocument();
    expect(await within(section).findByText('No link yet for this person.')).toBeInTheDocument();
    expect(personLinkApi.list).toHaveBeenCalledWith('p-anna');
  });

  it('makes it with the chosen expiry, and shows the URL once', async () => {
    vi.mocked(personLinkApi.issue).mockResolvedValue({
      id: 'l-1',
      purpose: 'grant',
      url: 'https://app.example/grant/p.l-1.secret',
      expiresAt: '2026-10-06T00:00:00.000Z',
      expiryDays: 7,
      distribution: 'Send this to the person yourself.',
    });
    renderAt();
    const section = await screen.findByRole('region', { name: 'For Anna Jansen' });
    await userEvent.click(within(section).getByRole('button', { name: 'Create grant link' }));
    expect(personLinkApi.issue).toHaveBeenCalledWith('p-anna', 'grant', 7);
    expect(await within(section).findByDisplayValue('https://app.example/grant/p.l-1.secret')).toBeInTheDocument();
    expect(within(section).queryByText(/asks them to connect each one again/)).not.toBeInTheDocument();
  });

  it('says so when the link asks every account again, because each is connected (managed migration 0036)', async () => {
    vi.mocked(personLinkApi.issue).mockResolvedValue({
      id: 'l-3',
      purpose: 'grant',
      url: 'https://app.example/grant/p.l-3.secret',
      expiresAt: '2026-10-06T00:00:00.000Z',
      expiryDays: 7,
      distribution: 'Send this to the person yourself.',
      asksAgain: true,
    });
    renderAt();
    const section = await screen.findByRole('region', { name: 'For Anna Jansen' });
    await userEvent.click(within(section).getByRole('button', { name: 'Create grant link' }));
    expect(
      await within(section).findByText(
        'Every Google account of theirs is connected, so this link asks them to connect each one again. Send it when a connection has stopped working.',
      ),
    ).toBeInTheDocument();
  });

  it('offers one progress link for all of their migrations too (slice 3), made with its own expiry', async () => {
    vi.mocked(personLinkApi.issue).mockResolvedValue({
      id: 'l-2',
      purpose: 'view',
      url: 'https://app.example/view/p.l-2.secret',
      expiresAt: '2026-12-28T00:00:00.000Z',
      expiryDays: 90,
      distribution: 'Send this to the person yourself.',
    });
    renderAt();
    const section = await screen.findByRole('region', { name: 'For Anna Jansen' });
    expect(within(section).getByRole('heading', { name: 'One progress link for everything' })).toBeInTheDocument();
    expect(await within(section).findByText('No progress link yet for this person.')).toBeInTheDocument();
    await userEvent.click(within(section).getByRole('button', { name: 'Create progress link' }));
    expect(personLinkApi.issue).toHaveBeenCalledWith('p-anna', 'view', 90);
    expect(await within(section).findByDisplayValue('https://app.example/view/p.l-2.secret')).toBeInTheDocument();
  });
});

describe('what waits for their grant, on their page (start when granted, per person)', () => {
  const row = (id: string) => document.querySelector(`[data-migration="${id}"]`) as HTMLElement;

  it.each([
    ['starts_by_itself', 'Waits for Anna Jansen to connect, then starts by itself: another migration of theirs is running.'],
    ['review_and_start', 'Waits for Anna Jansen to connect. Once they have, open Details to review and start it.'],
    ['ran_before', 'Waits for Anna Jansen to connect again.'],
  ] as const)('says beside the migration what their grant does to it: %s', async (then, words) => {
    vi.mocked(personLinkApi.awaiting).mockResolvedValue([{ mappingId: 'm-mail', then }]);
    renderAt();
    expect(await within(await waitForRow('m-mail')).findByText(words)).toBeInTheDocument();
    expect(personLinkApi.awaiting).toHaveBeenCalledWith('p-anna');
    // Only beside the one that waits.
    expect(row('m-files').querySelector('[data-awaiting-grant]')).toBeNull();
  });

  it('says nothing when nothing of theirs waits', async () => {
    renderAt();
    await screen.findByRole('heading', { level: 1, name: 'Anna Jansen' });
    await vi.waitFor(() => expect(personLinkApi.awaiting).toHaveBeenCalled());
    expect(document.querySelector('[data-awaiting-grant]')).toBeNull();
    expect(screen.queryByText(/could not be read/)).not.toBeInTheDocument();
  });

  it('says it could not read what waits, rather than that nothing does (hard rule 9)', async () => {
    vi.mocked(personLinkApi.awaiting).mockRejectedValue(new Error('down'));
    renderAt();
    expect(await screen.findByText('Which of these wait for Anna Jansen to connect could not be read.')).toBeInTheDocument();
    expect(document.querySelector('[data-awaiting-grant]')).toBeNull();
  });

  async function waitForRow(id: string): Promise<HTMLElement> {
    await screen.findByRole('heading', { level: 1, name: 'Anna Jansen' });
    return row(id);
  }
});
