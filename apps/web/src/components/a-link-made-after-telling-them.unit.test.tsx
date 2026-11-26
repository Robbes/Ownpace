// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A LINK MADE AFTER TELLING THEM, WITH A MESSAGE TO SEND (workplan 0176 §12,
 * T8; §7, T3; the owner, 2026-11-26).
 *
 * The person's first screen asks whether the sender told them about the link
 * themselves. Step A put one line where the link is made; step B makes it the
 * moment it can still be acted on:
 *
 *  - **a tick before the button**: *I have told Anna that a link is coming: by
 *    phone, or in person.* It cannot be checked; it is a prompt, and the link
 *    is not made until it is ticked;
 *  - **who you are to them**, from the fixed list (D7), or *I would rather
 *    not say*; offered again as the member chose it last for this person;
 *  - **your name, as they know you**, asked here once: only while you have
 *    given none, and saved for you before the link is made;
 *  - during the Alpha, for a Google account: that the address must be on
 *    Google's list of test users first, with the tester guide's part, and
 *    that the Google step is best done together;
 *  - thirty days first, as in step A;
 *  - with the link, **a message to send**, which names what was said aloud
 *    (*This is the link I told you about*), what is copied and where to, and
 *    until when, with no greeting written for the member and no urgency
 *    (R2). The member may change it; *Copy message* copies what is in the
 *    box, the link with it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { LocaleProvider } from '../i18n/index.tsx';

const { issueMock, memberList, memberSetMine, auth } = vi.hoisted(() => ({
  issueMock: vi.fn(),
  memberList: vi.fn(),
  memberSetMine: vi.fn(),
  auth: { user: { id: 'pat', email: 'pat@example.org', name: 'Pat', role: 'owner' }, tenantId: 'acme' },
}));

vi.mock('../services/grant-link-service.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/grant-link-service.ts')>();
  return { ...actual, personLinkApi: { list: vi.fn(), issue: issueMock, revoke: vi.fn() } };
});
vi.mock('../services/mapping-service.ts', () => ({ memberApi: { list: memberList, setMine: memberSetMine } }));
vi.mock('../stores/auth-store.ts', () => ({ useAuthStore: () => auth }));
vi.mock('../services/edition.ts', () => ({ isSelfHost: () => false }));
vi.mock('../services/api.ts', () => ({ default: {}, serverMessage: () => 'a server sentence' }));
vi.mock('../services/operating-service.ts', () => ({ fetchPeople: vi.fn(), createPerson: vi.fn(), addMigrationToPerson: vi.fn() }));

import { PersonGrantLinkSection } from './MappingLinksPanel.tsx';

const IN_A_MONTH = '2026-12-26T10:00:00.000Z';
const LAST_WEEK = new Date(Date.now() - 7 * 86_400_000).toISOString();

const member = (over: Record<string, unknown> = {}) => ({
  id: 'm-1',
  tenantId: 'acme',
  userId: 'pat',
  email: 'pat@example.org',
  role: 'owner',
  status: 'active',
  displayName: 'Pat',
  phone: null,
  ...over,
});

const link = (over: Record<string, unknown> = {}) => ({
  id: 'link-1',
  purpose: 'grant' as const,
  state: 'used' as const,
  createdAt: LAST_WEEK,
  createdBy: 'pat',
  expiresAt: LAST_WEEK,
  usedAt: LAST_WEEK,
  revokedAt: null,
  relation: null,
  ...over,
});

const ISSUED = {
  id: 'link-2',
  purpose: 'grant',
  url: 'https://app.example/grant/p.link-2.sekrit',
  expiresAt: IN_A_MONTH,
  expiryDays: 30,
  distribution: '',
  copies: { domains: ['email', 'calendar'], to: ['soverin'] },
};

function renderSection(opts: { locale?: 'en' | 'nl'; links?: unknown[]; asksGoogle?: boolean } = {}) {
  window.localStorage.setItem('ownpace.locale', opts.locale ?? 'en');
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <LocaleProvider>
        <MemoryRouter>
          <PersonGrantLinkSection
            personId="p-anna"
            personName="Anna"
            links={(opts.links ?? []) as never}
            loadFailed={false}
            asksGoogle={opts.asksGoogle ?? false}
          />
        </MemoryRouter>
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

const tick = () => screen.getByRole('checkbox', { name: 'I have told Anna that a link is coming: by phone, or in person.' });
const make = () => screen.getByRole('button', { name: /Create grant link/ });

let written: string[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  written = [];
  memberList.mockResolvedValue([member()]);
  memberSetMine.mockImplementation(async (_t: string, body: { displayName?: string }) => ({
    displayName: body.displayName ?? null,
    phone: null,
  }));
  issueMock.mockResolvedValue(ISSUED);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async (text: string) => void written.push(text) },
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('a tick before the button (§12)', () => {
  it('the link is not made until you say you told them', async () => {
    renderSection();
    await screen.findByText('Tell Anna first, by phone or in person. The page asks whether you did.');
    expect(make()).toBeDisabled();
    await userEvent.click(tick());
    expect(make()).toBeEnabled();
    await userEvent.click(make());
    await waitFor(() => expect(issueMock).toHaveBeenCalledTimes(1));
  });

  it('and the tick stands before the button', async () => {
    renderSection();
    const box = await screen.findByRole('checkbox', { name: /I have told Anna/ });
    expect(box.compareDocumentPosition(make()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('who you are to them (D7)', () => {
  it('is chosen from the list, in this order, or not said', async () => {
    renderSection();
    const select = await screen.findByLabelText('Who are you to Anna?');
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'I would rather not say',
      'Daughter',
      'Son',
      'Child',
      'Granddaughter',
      'Grandson',
      'Grandchild',
      'Partner',
      'Brother',
      'Sister',
      'Father',
      'Mother',
      'A family member',
      'Someone Anna knows',
      'Colleague',
    ]);
  });

  it('goes with the link', async () => {
    renderSection();
    await userEvent.selectOptions(await screen.findByLabelText('Who are you to Anna?'), 'daughter');
    await userEvent.click(tick());
    await userEvent.click(make());
    await waitFor(() => expect(issueMock).toHaveBeenCalledWith('p-anna', 'grant', 30, { relation: 'daughter' }));
  });

  it('not said is none', async () => {
    renderSection();
    await screen.findByLabelText('Who are you to Anna?');
    await userEvent.click(tick());
    await userEvent.click(make());
    await waitFor(() => expect(issueMock).toHaveBeenCalledWith('p-anna', 'grant', 30, { relation: null }));
  });

  it('is offered again as you chose it last for this person', async () => {
    renderSection({
      links: [
        link({ id: 'old', createdAt: '2026-10-01T10:00:00.000Z', relation: 'son' }),
        link({ id: 'new', createdAt: '2026-11-01T10:00:00.000Z', relation: 'grandson' }),
        link({ id: 'theirs', createdAt: '2026-11-20T10:00:00.000Z', relation: 'colleague', createdBy: 'sam' }),
      ],
    });
    expect((await screen.findByLabelText('Who are you to Anna?')) as HTMLSelectElement).toHaveValue('grandson');
  });
});

describe('your name, as they know you (§7)', () => {
  it('is asked here while you have given none, and saved for you before the link is made', async () => {
    memberList.mockResolvedValue([member({ displayName: null })]);
    renderSection();
    const name = await screen.findByLabelText('Your name, as Anna knows you');
    expect(screen.getByText('Shown on the page Anna opens.')).toBeInTheDocument();
    await userEvent.type(name, 'Pat de Vries');
    await userEvent.click(tick());
    await userEvent.click(make());
    await waitFor(() => expect(issueMock).toHaveBeenCalled());
    expect(memberSetMine).toHaveBeenCalledWith('acme', { displayName: 'Pat de Vries' });
    expect(memberSetMine.mock.invocationCallOrder[0]!).toBeLessThan(issueMock.mock.invocationCallOrder[0]!);
  });

  it('is not asked once you have given one: that is on Team', async () => {
    renderSection();
    await screen.findByLabelText('Who are you to Anna?');
    expect(screen.queryByLabelText('Your name, as Anna knows you')).not.toBeInTheDocument();
  });

  it('a name refused makes no link, and says why', async () => {
    memberList.mockResolvedValue([member({ displayName: null })]);
    memberSetMine.mockRejectedValue(
      Object.assign(new Error('400'), { response: { status: 400, data: { error: 'sender_name_refused', message: 'en' } } }),
    );
    renderSection();
    await userEvent.type(await screen.findByLabelText('Your name, as Anna knows you'), 'www.bank.example');
    await userEvent.click(tick());
    await userEvent.click(make());
    expect(await screen.findByText(/That is not a name a person’s page can show/)).toBeInTheDocument();
    expect(issueMock).not.toHaveBeenCalled();
  });
});

describe('during the Alpha, for a Google account (§12)', () => {
  it('says the address must be on Google’s list first, with the guide, and that the step is best done together', async () => {
    vi.stubEnv('VITE_OWNPACE_STAGE', 'alpha');
    renderSection({ asksGoogle: true });
    expect(
      await screen.findByText(
        /During the Alpha, Google only lets in addresses on its list of test users\. Mail us Anna's Google address first, and wait for our answer\./,
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /tester guide/ })).toHaveAttribute('href', expect.stringMatching(/#family-link$/));
    expect(screen.getByText('Do the Google step together if you can. Google shows a warning during the Alpha.')).toBeInTheDocument();
  });

  it('says neither outside the Alpha, nor for a link that asks no Google account', async () => {
    const outside = renderSection({ asksGoogle: true });
    await screen.findByLabelText('Who are you to Anna?');
    expect(screen.queryByText(/list of test users/)).not.toBeInTheDocument();
    outside.unmount();
    vi.stubEnv('VITE_OWNPACE_STAGE', 'alpha');
    renderSection({ asksGoogle: false });
    await screen.findByLabelText('Who are you to Anna?');
    expect(screen.queryByText(/list of test users/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Do the Google step together/)).not.toBeInTheDocument();
  });
});

describe('with the link, a message to send (§12, §15)', () => {
  async function madeIn(locale: 'en' | 'nl') {
    renderSection({ locale });
    const ticked = locale === 'en' ? tick() : await screen.findByRole('checkbox', { name: /Ik heb Anna verteld/ });
    await userEvent.click(ticked);
    await userEvent.click(screen.getByRole('button', { name: locale === 'en' ? /Create grant link/ : /Toegangslink maken/ }));
    return (await screen.findByLabelText(locale === 'en' ? 'A message to send with it' : 'Een bericht om mee te sturen')) as HTMLTextAreaElement;
  }

  it('names what was said aloud, what is copied, where to and until when, and holds the link', async () => {
    const box = await madeIn('en');
    expect(box.value).toMatch(
      /^This is the link I told you about\. It opens a page of Ownpace\. There you give permission to copy your email and calendar to Soverin\. There is no hurry: the link works until .+\. Shall we do it together\? Call me when you want to start\.\n\nhttps:\/\/app\.example\/grant\/p\.link-2\.sekrit$/,
    );
    // No greeting written for the member, and no urgency (R2).
    expect(box.value).not.toMatch(/^(Hi|Hello|Dear|Hallo|Beste)\b|urgent|today|now\b|vandaag|meteen/i);
  });

  it('in Dutch, with u, as §15 has it', async () => {
    const box = await madeIn('nl');
    expect(box.value).toMatch(
      /^Dit is de link waarover ik u vertelde\. U komt op een pagina van Ownpace\. Daar geeft u toestemming om uw e-mail en agenda te kopiëren naar Soverin\. Er is geen haast: de link werkt tot .+\. Zullen we het samen doen\? Bel mij als u wilt beginnen\.\n\nhttps:\/\/app\.example\/grant\/p\.link-2\.sekrit$/,
    );
  });

  it('may be changed, and Copy message copies what is in the box', async () => {
    const box = await madeIn('en');
    await userEvent.clear(box);
    await userEvent.type(box, 'Mum, this is it.');
    await userEvent.click(screen.getByRole('button', { name: 'Copy message' }));
    expect(written).toEqual(['Mum, this is it.']);
  });
});
