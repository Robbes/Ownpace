// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A SENDER THE PERSON CAN CHECK (workplan 0176 §7, T3; D7, D11; the owner,
 * 2026-11-26).
 *
 * In step A the first screen's box said *Sender* over the sign-in address of
 * the member who made the link, and *Phone* over the organisation's number.
 * The reader was taught never to trust a link; the box is what they can
 * check. Now it says:
 *
 *  - the member by the name they gave, as the people they send a link to know
 *    them, and the address under the name. Every `{who}` on the page is that
 *    name. Nothing says how the reader knows them: the owner, 2026-11-26,
 *    reversing D7 (*"Does the relationship matter and need to be registered?
 *    I would like not to..."*);
 *  - a number, as something to check and never as proof: *Pat's number: …
 *    Or use the number you already have for Pat.* The member's own where they
 *    gave one, else the organisation's, and then the sentence says it is the
 *    organisation's (D11). No number, no sentence;
 *  - a member who gave no name is named by their address, as before; and an
 *    answer from a server before step B, with no sender in it, reads as step
 *    A did.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { LocaleProvider } from '../i18n/index.tsx';
import { STRINGS } from '../i18n/strings.ts';
import { NL_JE } from '../i18n/informal.ts';

const { readMock } = vi.hoisted(() => ({ readMock: vi.fn() }));

vi.mock('../services/grant-service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/grant-service.ts')>()),
  grantApi: { read: readMock, authorize: vi.fn(), authorizeDrive: vi.fn(), password: vi.fn() },
}));
vi.mock('../services/link-report-service.ts', () => ({
  linkReportApi: { available: vi.fn(async () => false), send: vi.fn() },
}));
vi.mock('../services/api.ts', () => ({ default: {}, serverMessage: () => 'a server sentence' }));

import Grant from './Grant.tsx';

const LINK = 'p.a1b2c3.the-secret-part';
const IN_A_WEEK = new Date(Date.now() + 7 * 86_400_000).toISOString();

const GMAIL = {
  ref: 'ref-gmail',
  role: 'source',
  way: 'sign-in',
  provider: 'google',
  account: 'anna@work.example',
  granted: false,
  again: false,
  domains: ['email'],
  scope: 'https://mail.google.com/ openid',
  readOnlyAtProvider: false,
  notReady: null,
  migrations: [
    { domains: ['email'], to: { provider: 'soverin', host: null, account: 'anna@soverin.net' }, granted: false, theOrganisationOpensIt: false },
  ],
};

const PASSWORD = {
  ...GMAIL,
  ref: 'ref-imap',
  way: 'password',
  provider: 'imap',
  account: 'anna@mail.example',
  server: { hosts: ['imap.mail.example'], published: false },
  fields: [{ key: 'password', who: 'person', labelKey: 'connections.field.password', secret: true, autoComplete: 'new-password' }],
  tries: { left: 5, locked: false },
  scope: null,
};

const subject = (over: Record<string, unknown> = {}, accounts: readonly unknown[] = [GMAIL]) => ({
  kind: 'person',
  organisation: 'Acme Families',
  checkedCompany: null,
  askedBy: 'owner@example.org',
  sender: { name: 'Pat de Vries', phone: '+31 6 1234 5678' },
  organisationPhone: '+31 20 123 4567',
  accounts,
  expiresAt: IN_A_WEEK,
  ...over,
});

function renderPage(locale: 'en' | 'nl' = 'en') {
  window.localStorage.setItem('ownpace.locale', locale);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([{ path: '/grant/:link', element: <Grant /> }], { initialEntries: [`/grant/${LINK}`] });
  return render(
    <QueryClientProvider client={qc}>
      <LocaleProvider>
        <RouterProvider router={router} />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

/** The box of facts on the first screen, by its label *Sender*. */
async function senderBox(label = 'Sender'): Promise<HTMLElement> {
  const term = await screen.findByText(label);
  return term.closest('[data-sender]') as HTMLElement;
}

/** A paragraph's whole text, the number's link inside it included. */
const textOf = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the sender, by the name they gave (§7)', () => {
  it('in English: the name, and the address under the name', async () => {
    readMock.mockResolvedValue(subject());
    renderPage('en');
    expect(await screen.findByRole('heading', { level: 1, name: 'Pat de Vries asks for your permission' })).toBeInTheDocument();
    const box = await senderBox();
    expect(within(box).getByText('Pat de Vries')).toBeInTheDocument();
    expect(within(box).getByText('owner@example.org')).toBeInTheDocument();
    // Every {who} on the page is the name.
    expect(screen.getByText('Did Pat de Vries tell you about this link themselves?')).toBeInTheDocument();
    // No *Phone* as a fact with a label, as step A's box had it.
    expect(within(box).queryByText('Phone')).not.toBeInTheDocument();
  });

  it('in Dutch, under *Afzender*', async () => {
    readMock.mockResolvedValue(subject());
    renderPage('nl');
    expect(await screen.findByRole('heading', { level: 1, name: 'Pat de Vries vraagt uw toestemming' })).toBeInTheDocument();
    const box = await senderBox('Afzender');
    expect(within(box).getByText('Pat de Vries')).toBeInTheDocument();
    expect(within(box).queryByText('Telefoon')).not.toBeInTheDocument();
  });

  it('says nothing of how the reader knows them, even from an answer that carries it (D7, reversed)', async () => {
    readMock.mockResolvedValue(subject({ sender: { name: 'Pat', relation: 'daughter', phone: null } }));
    renderPage('nl');
    const box = await senderBox('Afzender');
    expect(within(box).getByText('Pat')).toBeInTheDocument();
    expect(textOf(box)).not.toMatch(/Pat,|dochter|daughter/);
  });

  it('and the dictionary has no words for a relation, in either language or voice', () => {
    const keys = [...Object.keys(STRINGS.en), ...Object.keys(STRINGS.nl), ...Object.keys(NL_JE)];
    expect(keys.filter((k) => /^(sender\.relation\.|personLink\.relation\.)|^grant\.person\.senderIs$/.test(k))).toEqual([]);
  });
});

describe('a number to check, never proof (D11)', () => {
  it("the member's own, as a number a phone can dial", async () => {
    readMock.mockResolvedValue(subject());
    renderPage('en');
    const box = await senderBox();
    const line = box.querySelector('[data-number]');
    expect(textOf(line)).toBe("Pat de Vries's number: +31 6 1234 5678. Or use the number you already have for Pat de Vries.");
    expect(within(box).getByRole('link', { name: '+31 6 1234 5678' })).toHaveAttribute('href', 'tel:+31612345678');
  });

  it("in Dutch, as §15 has it", async () => {
    readMock.mockResolvedValue(subject());
    renderPage('nl');
    const line = (await senderBox('Afzender')).querySelector('[data-number]');
    expect(textOf(line)).toBe('Nummer van Pat de Vries: +31 6 1234 5678. Of gebruik het nummer dat u al van Pat de Vries hebt.');
  });

  it("the organisation's where the member gave none, said as the organisation's", async () => {
    readMock.mockResolvedValue(subject({ sender: { name: 'Pat de Vries', phone: null } }));
    renderPage('en');
    const box = await senderBox();
    expect(textOf(box.querySelector('[data-number]'))).toBe(
      'The number of Acme Families: +31 20 123 4567. Or use the number you already have for Pat de Vries.',
    );
    expect(within(box).getByRole('link', { name: '+31 20 123 4567' })).toHaveAttribute('href', 'tel:+31201234567');
  });

  it('no number at all: no sentence about one', async () => {
    readMock.mockResolvedValue(subject({ sender: { name: 'Pat', phone: null }, organisationPhone: null }));
    renderPage('en');
    const box = await senderBox();
    expect(box.querySelector('[data-number]')).toBeNull();
    expect(within(box).queryByRole('link')).not.toBeInTheDocument();
  });
});

describe('as before, where there is no name', () => {
  it('a member who gave no name is named by their address', async () => {
    readMock.mockResolvedValue(subject({ sender: { name: null, phone: null } }));
    renderPage('en');
    expect(await screen.findByRole('heading', { level: 1, name: 'owner@example.org asks for your permission' })).toBeInTheDocument();
    const box = await senderBox();
    expect(within(box).getByText('owner@example.org')).toBeInTheDocument();
  });

  it('an answer from a server before step B reads as step A did', async () => {
    const { sender: _none, ...before } = subject();
    readMock.mockResolvedValue(before);
    renderPage('en');
    expect(await screen.findByRole('heading', { level: 1, name: 'owner@example.org asks for your permission' })).toBeInTheDocument();
    const box = await senderBox();
    expect(within(box).getByText('owner@example.org')).toBeInTheDocument();
    expect(textOf(box.querySelector('[data-number]'))).toBe(
      'The number of Acme Families: +31 20 123 4567. Or use the number you already have for owner@example.org.',
    );
  });
});

describe("a password card's warning, when there is no number to call back on", () => {
  it("is not said when the member gave their own number, though the organisation gave none", async () => {
    readMock.mockResolvedValue(subject({ organisationPhone: null }, [PASSWORD]));
    renderPage('en');
    await userEvent.click(await screen.findByRole('button', { name: 'Yes, that is right' }));
    await screen.findByRole('heading', { level: 1, name: 'Have this ready' });
    expect(document.querySelector('[data-no-phone]')).toBeNull();
  });

  it('is said, naming the sender by their name, when neither gave one', async () => {
    readMock.mockResolvedValue(subject({ sender: { name: 'Pat', phone: null }, organisationPhone: null }, [PASSWORD]));
    renderPage('en');
    await userEvent.click(await screen.findByRole('button', { name: 'Yes, that is right' }));
    await screen.findByRole('heading', { level: 1, name: 'Have this ready' });
    expect(document.querySelector('[data-no-phone]')?.textContent).toMatch(/Pat/);
  });
});
