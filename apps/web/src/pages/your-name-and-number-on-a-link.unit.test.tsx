// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * YOUR NAME AND NUMBER ON A PERSON'S LINK (workplan 0176 §7, T3; D11; the
 * owner, 2026-11-26).
 *
 * A person's page names the member who sent the link. Until step B that was
 * the address they sign in with. Now the member says, once, on Team, the name
 * the people they send a link to know them by, and their own number, which
 * the page shows as a number to check; without one it shows the
 * organisation's.
 *
 *  - the section is the signed-in member's own, and holds what they stored;
 *  - Save sends both, for themselves only, and says it is saved;
 *  - a refusal is said in the reader's language, by its code, as the server
 *    names it; nothing is shown as saved then;
 *  - another member's row has no such field: it is what each says of
 *    themselves.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../i18n/index.tsx';

const { tenantGet, memberList, memberSetMine, auth } = vi.hoisted(() => ({
  tenantGet: vi.fn(),
  memberList: vi.fn(),
  memberSetMine: vi.fn(),
  auth: {
    user: { id: 'user-owner', email: 'owner@acme.nl', name: 'Owner', role: 'owner' },
    tenantId: 'acme',
  },
}));

vi.mock('../services/mapping-service', () => ({
  tenantApi: { get: tenantGet, update: vi.fn(), setNotifications: vi.fn(), setContact: vi.fn() },
  memberApi: {
    list: memberList,
    invite: vi.fn(),
    updateRole: vi.fn(),
    remove: vi.fn(),
    resend: vi.fn(),
    setMine: memberSetMine,
  },
}));
vi.mock('../services/address-change-service', () => ({
  fetchAddressChanges: vi.fn(async () => ({ rows: [], door: 'api', file: null })),
}));
vi.mock('../services/operating-service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/operating-service.ts')>()),
  fetchPeople: vi.fn(async () => ({ people: [], unassigned: [] })),
}));
vi.mock('../stores/auth-store', () => ({ useAuthStore: () => auth }));

import Tenants from './Tenants.tsx';

const MEMBERS = [
  {
    id: 'm-1',
    tenantId: 'acme',
    userId: 'user-owner',
    email: 'owner@acme.nl',
    role: 'owner',
    status: 'active',
    invitedAt: null,
    joinedAt: '2026-07-01T10:00:00.000Z',
    displayName: 'Pat de Vries',
    phone: '+31 6 1234 5678',
  },
  {
    id: 'm-2',
    tenantId: 'acme',
    userId: 'user-b',
    email: 'collega@acme.nl',
    role: 'admin',
    status: 'active',
    invitedAt: null,
    joinedAt: '2026-07-02T10:00:00.000Z',
    displayName: 'Sam',
    phone: null,
  },
];

function renderScreen(locale: 'en' | 'nl' = 'en') {
  window.localStorage.setItem('ownpace.locale', locale);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <LocaleProvider>
        <Tenants />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

/** A refusal as the API answers it: the code, and the English beside it. */
const refusedWith = (error: string) =>
  Object.assign(new Error('refused'), { response: { status: 400, data: { error, message: 'The English sentence.' } } });

beforeEach(() => {
  vi.clearAllMocks();
  tenantGet.mockResolvedValue({ id: 'acme', name: 'Acme BV', slug: 'acme-bv', createdAt: '2026-07-01T10:00:00.000Z' });
  memberList.mockResolvedValue(MEMBERS);
  memberSetMine.mockImplementation(async (_tenant: string, body: { displayName?: string | null; phone?: string | null }) => ({
    displayName: body.displayName ?? null,
    phone: body.phone ?? null,
  }));
});

describe('your name and number, for the people you send a link to', () => {
  it('holds what you stored, in a section of your own', async () => {
    renderScreen('en');
    expect(await screen.findByRole('heading', { name: 'When you send someone a link' })).toBeInTheDocument();
    expect(screen.getByLabelText('Your name, as they know you')).toHaveValue('Pat de Vries');
    expect(screen.getByLabelText('Your own phone number')).toHaveValue('+31 6 1234 5678');
    // One section, and it is yours: no field holds another member's name.
    expect(screen.queryByDisplayValue('Sam')).not.toBeInTheDocument();
  });

  it('saves both, for you, and says so', async () => {
    renderScreen('en');
    const name = await screen.findByLabelText('Your name, as they know you');
    await userEvent.clear(name);
    await userEvent.type(name, 'Pat');
    const phone = screen.getByLabelText('Your own phone number');
    await userEvent.clear(phone);
    await userEvent.click(screen.getByRole('button', { name: 'Save name and number' }));
    expect(memberSetMine).toHaveBeenCalledWith('acme', { displayName: 'Pat', phone: '' });
    expect(await screen.findByText('Saved. A person’s page shows it from now on.')).toBeInTheDocument();
  });

  it('says a refused name in the reader’s language, by its code, and nothing as saved', async () => {
    memberSetMine.mockRejectedValue(refusedWith('sender_name_refused'));
    renderScreen('nl');
    const name = await screen.findByLabelText('Uw naam, zoals zij u kennen');
    await userEvent.clear(name);
    await userEvent.type(name, 'www.bank.example');
    await userEvent.click(screen.getByRole('button', { name: 'Naam en nummer opslaan' }));
    expect(
      await screen.findByText(
        "Dat is geen naam die de pagina van een persoon kan tonen. Gebruik alleen letters, spaties en ' - . (hooguit 60 tekens).",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Opgeslagen/)).not.toBeInTheDocument();
  });

  it('says a refused number the same way', async () => {
    memberSetMine.mockRejectedValue(refusedWith('sender_phone_refused'));
    renderScreen('en');
    const phone = await screen.findByLabelText('Your own phone number');
    await userEvent.clear(phone);
    await userEvent.type(phone, 'call us');
    await userEvent.click(screen.getByRole('button', { name: 'Save name and number' }));
    expect(
      await screen.findByText(
        'That is not a phone number a person’s page can show. Use only digits, spaces and + ( ) - . / (6 to 15 digits).',
      ),
    ).toBeInTheDocument();
  });
});
