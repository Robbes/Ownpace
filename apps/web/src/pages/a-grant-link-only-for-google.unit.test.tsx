// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A GRANT LINK ONLY FOR GOOGLE (the UX sweep of 2026-10-17).
 *
 * A grant link asks somebody to sign in with Google. A person's page offered
 * one to everybody, so Sophie, whose only migration reads iCloud, was shown
 * *One grant link for everything* and a *Create grant link* button, and the
 * press could only be refused (`nothing_to_grant`), in English. Her page now
 * says why there is none, and still offers the progress link, which works for
 * every source.
 *
 * And, on the same page, two things a reader could not do before: a failed
 * read offers to read again, and the wait while it loads is heard, not only
 * seen.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AxiosError, AxiosHeaders } from 'axios';
import { lifecycleCounts, type Person as PersonShape, type PersonMigration } from '@openmig/shared';
import Person from './Person.tsx';
import { mappingApi, type MappingListItem } from '../services/mapping-service.ts';
import { fetchAttention, fetchPeople } from '../services/operating-service.ts';
import { personLinkApi } from '../services/grant-link-service.ts';
import { STRINGS } from '../i18n/strings.ts';

const EN = STRINGS.en;

vi.mock('../services/mapping-service', () => ({ mappingApi: { list: vi.fn(), pace: vi.fn() } }));
vi.mock('../services/operating-service', () => ({
  fetchPeople: vi.fn(),
  fetchAttention: vi.fn(),
  fetchStatus: vi.fn(),
  fetchVerifyReport: vi.fn(),
}));
const apiGet = vi.hoisted(() => vi.fn());
vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/api.ts')>()),
  default: { get: apiGet },
}));
vi.mock('../services/grant-link-service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/grant-link-service.ts')>()),
  personLinkApi: { list: vi.fn(), issue: vi.fn(), revoke: vi.fn(), awaiting: vi.fn() },
}));

const listMock = vi.mocked(mappingApi.list);
const peopleMock = vi.mocked(fetchPeople);

const migration = (over: Partial<MappingListItem>): MappingListItem => ({
  id: 'm1',
  tenantId: 't1',
  name: 'Mail',
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

const renderAt = (path: string) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/people/:personId" element={<Person />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(mappingApi.pace).mockResolvedValue({ leastMinutesBetweenPasses: 0, nextPassAt: {} });
  vi.mocked(fetchAttention).mockResolvedValue({ mappings: [] });
  vi.mocked(personLinkApi.list).mockResolvedValue([]);
  vi.mocked(personLinkApi.awaiting).mockResolvedValue([]);
  apiGet.mockRejectedValue(new Error('the progress read is not part of this case'));
});

describe('a grant link, offered only to a person a migration of whose reads Google', () => {
  it.each([
    ['apple', 'iCloud'],
    ['imap', 'another mail provider'],
  ])('offers none for a person whose only migration reads %s (%s), says why, and keeps the progress link', async (kind) => {
    listMock.mockResolvedValue([migration({ id: 'm-sophie', name: 'Sophie mail', sourceType: kind })]);
    peopleMock.mockResolvedValue({ people: [person('p-sophie', 'Sophie', [{ id: 'm-sophie', status: 'active' }])], unassigned: [] });

    renderAt('/people/p-sophie');

    const section = await screen.findByRole('region', { name: 'For Sophie' });
    expect(
      within(section).getByText(
        "A grant link is only for Google accounts, and none of Sophie's migrations reads one. Their other accounts are connected on the Accounts page.",
      ),
    ).toBeInTheDocument();
    expect(within(section).queryByRole('heading', { name: EN['personLink.title'] })).not.toBeInTheDocument();
    expect(within(section).queryByRole('button', { name: EN['grantLink.issue'] })).not.toBeInTheDocument();
    // The progress link works for every source.
    expect(within(section).getByRole('button', { name: EN['viewLink.issue'] })).toBeInTheDocument();
  });

  it.each(['gmail', 'google', 'google_drive', 'google_calendar', 'google_contacts'])(
    'keeps the grant link for a person with a %s migration',
    async (kind) => {
      listMock.mockResolvedValue([
        migration({ id: 'm-icloud', name: 'Anna photos', sourceType: 'apple' }),
        migration({ id: 'm-google', name: 'Anna Google', sourceType: kind }),
      ]);
      peopleMock.mockResolvedValue({
        people: [
          person('p-anna', 'Anna', [
            { id: 'm-icloud', status: 'active' },
            { id: 'm-google', status: 'active' },
          ]),
        ],
        unassigned: [],
      });

      renderAt('/people/p-anna');

      const section = await screen.findByRole('region', { name: 'For Anna' });
      expect(within(section).getByRole('button', { name: EN['grantLink.issue'] })).toBeInTheDocument();
      expect(within(section).queryByText(/A grant link is only for Google accounts/)).not.toBeInTheDocument();
    },
  );

  it('still lists, and can revoke, a live grant link made before their Google migration went', async () => {
    // Their Google migration was deleted, or moved to somebody else, after
    // the link was made: what still works must still be seen and taken back.
    listMock.mockResolvedValue([migration({ id: 'm-sophie', name: 'Sophie mail', sourceType: 'apple' })]);
    peopleMock.mockResolvedValue({ people: [person('p-sophie', 'Sophie', [{ id: 'm-sophie', status: 'active' }])], unassigned: [] });
    vi.mocked(personLinkApi.list).mockResolvedValue([
      {
        id: 'l-live',
        purpose: 'grant',
        state: 'live',
        createdAt: '2026-10-01T10:00:00.000Z',
        createdBy: 'owner@example.nl',
        expiresAt: '2026-10-31T10:00:00.000Z',
        usedAt: null,
        revokedAt: null,
      },
    ]);

    renderAt('/people/p-sophie');

    const section = await screen.findByRole('region', { name: 'For Sophie' });
    expect(await within(section).findByRole('button', { name: EN['grantLink.revoke'] })).toBeInTheDocument();
    expect(within(section).getByRole('heading', { name: EN['personLink.title'] })).toBeInTheDocument();
  });

  it('says it in Dutch too', () => {
    expect(STRINGS.nl['person.links.noGoogle']).toBe(
      'Een toegangslink is alleen voor Google-accounts, en geen van de migraties van {name} leest er een. Andere accounts verbindt u op de pagina Accounts.',
    );
  });
});

/** An axios-shaped rejection carrying the JSON body `serverFault` sends. */
const fault = (reference: string): AxiosError => {
  const err = new AxiosError('Request failed with status code 500');
  err.response = {
    status: 500,
    statusText: 'Error',
    headers: {},
    config: { headers: new AxiosHeaders() },
    data: {
      error: 'list_failed',
      reason: `Something went wrong listing the people you are moving — this is a fault on our side, not something your input caused. Reference ${reference}: mention it when you contact us.`,
    },
  };
  return err;
};

describe("a person's page that could not be read, or is still loading", () => {
  it('offers to read again, and the page comes back when the read does', async () => {
    listMock.mockResolvedValue([migration({ id: 'm-anna', name: 'Anna mail' })]);
    peopleMock
      .mockRejectedValueOnce(fault('5e6f7a8b'))
      .mockResolvedValue({ people: [person('p-anna', 'Anna', [{ id: 'm-anna', status: 'active' }])], unassigned: [] });

    renderAt('/people/p-anna');

    expect(await screen.findByText(EN['person.loadFailed'])).toBeInTheDocument();
    expect(screen.getByText(/Reference 5e6f7a8b/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Anna' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(EN['person.loadFailed'])).not.toBeInTheDocument());
  });

  it('is heard while it loads: a status that says Loading…', async () => {
    listMock.mockReturnValue(new Promise(() => {}));
    peopleMock.mockReturnValue(new Promise(() => {}));

    renderAt('/people/p-anna');

    expect(await screen.findByRole('status')).toHaveTextContent('Loading…');
  });
});
