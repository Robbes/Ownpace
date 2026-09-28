// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * AN ACCEPTANCE BEFORE THE FIRST CONNECTION (workplan 0139 T3).
 *
 * After the first sign-in, and before any other page, there is one screen: the
 * Alpha conditions, the privacy policy and the terms, each linked in the
 * reader's language with its version, and one button to accept. It appears
 * again when any of the three changes version, and an invited member sees it at
 * their own first sign-in, because it stands in front of every signed-in page
 * whenever `GET /api/me` says acceptance is due, not only on the way in.
 *
 * What this holds:
 *
 *  - due: the screen stands in front of the page, with the three texts linked,
 *    in English to the English pages and in Dutch to the Dutch ones, each with
 *    its version, and the page itself is not rendered;
 *  - the one button sends the versions it showed and the reader's language,
 *    and once the answer says nothing is due the page comes back;
 *  - a text whose version changed says so, and is asked for again;
 *  - not due, or a deployment that does not ask (no `acceptance` in the
 *    answer), or the appliance: no screen, the page;
 *  - a version that changed while the screen was open is read again, not
 *    accepted; and a read that failed is said, never taken for "nothing due".
 *
 * The links are the site's pages (`services/legal-links.ts`), which
 * `scripts/a-policy-link-that-answers.unit.test.ts` holds to the files the site
 * build writes. Unset, the site is the production one.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { AxiosError, AxiosHeaders } from 'axios';
import { LocaleProvider } from '../i18n/index.tsx';

const { getMock, postMock, edition } = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(),
  edition: { selfhost: false },
}));

vi.mock('../services/api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/api.ts')>();
  return { ...actual, default: { get: getMock, post: postMock } };
});
vi.mock('../services/edition.ts', () => ({
  isSelfHost: () => edition.selfhost,
  operatingBaseUrl: () => '',
}));
// The build stamp asks the server what it runs; not this file's subject.
vi.mock('../components/BuildStamp.tsx', () => ({ default: () => null }));

import AcceptanceGate from '../components/AcceptanceGate.tsx';
import { rememberSignIn } from '../services/acceptance.ts';
import { useAuthStore } from '../stores/auth-store.ts';

const SITE = 'https://www.ownpace.eu';
const VERSIONS = { alpha: '1.0', privacy: '1.2', terms: '1.3' } as const;

type Doc = keyof typeof VERSIONS;
const documents = (accepted: Partial<Record<Doc, boolean>> = {}, versions: Record<Doc, string> = VERSIONS) =>
  (['alpha', 'privacy', 'terms'] as const).map((document) => ({
    document,
    version: versions[document],
    accepted: accepted[document] ?? false,
  }));

const me = (acceptance?: unknown) => ({
  data: {
    userId: 'tester',
    email: 'tester@example.invalid',
    tenantId: 'tenant-1',
    role: 'owner',
    tenants: [{ tenantId: 'tenant-1', role: 'owner' }],
    invitations: [],
    operator: false,
    ...(acceptance === undefined ? {} : { acceptance }),
  },
});
const DUE = { due: true, documents: documents() };
const GIVEN = { due: false, documents: documents({ alpha: true, privacy: true, terms: true }) };

function renderGate(locale: 'en' | 'nl' = 'en') {
  window.localStorage.setItem('ownpace.locale', locale);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <LocaleProvider>
        <MemoryRouter initialEntries={['/dashboard']}>
          <AcceptanceGate>
            <div>screen:dashboard</div>
          </AcceptanceGate>
        </MemoryRouter>
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

function refused(status: number, data: unknown): AxiosError {
  const err = new AxiosError(`Request failed with status code ${status}`);
  err.response = { status, statusText: '', data, headers: {}, config: { headers: new AxiosHeaders() } };
  return err;
}

beforeEach(() => {
  vi.clearAllMocks();
  edition.selfhost = false;
  useAuthStore.setState({ isAuthenticated: true, token: 'token', tenantId: 'tenant-1', tenantCount: 1 });
});

/** The screen's three links, by the text each one carries. */
async function links(): Promise<Record<Doc, HTMLAnchorElement>> {
  const list = await screen.findByRole('list', { name: /texts|teksten/i });
  const [alpha, privacy, terms] = within(list).getAllByRole('link') as HTMLAnchorElement[];
  return { alpha: alpha!, privacy: privacy!, terms: terms! };
}

describe('when acceptance is due', () => {
  it('stands in front of the page, with the three texts linked in English, each with its version', async () => {
    getMock.mockResolvedValue(me(DUE));
    renderGate('en');

    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.queryByText('screen:dashboard')).not.toBeInTheDocument();
    const got = await links();
    expect(got.alpha.href).toBe(`${SITE}/alpha.html`);
    expect(got.privacy.href).toBe(`${SITE}/privacy.html`);
    expect(got.terms.href).toBe(`${SITE}/terms.html`);
    expect(got.alpha).toHaveAccessibleName(/Alpha conditions.*1\.0/);
    expect(got.privacy).toHaveAccessibleName(/Privacy policy.*1\.2/);
    expect(got.terms).toHaveAccessibleName(/Terms of service.*1\.3/);
    expect(screen.getAllByRole('button', { name: /accept/i })).toHaveLength(1);
  });

  it('in Dutch, links each text’s Dutch page, never the English one', async () => {
    getMock.mockResolvedValue(me(DUE));
    renderGate('nl');

    const got = await links();
    expect(got.alpha.href).toBe(`${SITE}/nl/alpha.html`);
    expect(got.privacy.href).toBe(`${SITE}/nl/privacy.html`);
    expect(got.terms.href).toBe(`${SITE}/nl/voorwaarden.html`);
    expect(got.alpha).toHaveAccessibleName(/Voorwaarden voor de Alpha.*1\.0/);
    expect(got.privacy).toHaveAccessibleName(/Privacyverklaring.*1\.2/);
    expect(got.terms).toHaveAccessibleName(/Servicevoorwaarden.*1\.3/);
    expect(screen.getByRole('button', { name: /accepteren/i })).toBeInTheDocument();
  });

  it('one button sends the versions it showed and the reader’s language, and the page comes back', async () => {
    getMock.mockResolvedValue(me(DUE));
    postMock.mockResolvedValue({ data: { written: 3, acceptance: GIVEN } });
    renderGate('nl');

    await userEvent.click(await screen.findByRole('button', { name: /accepteren/i }));

    expect(postMock).toHaveBeenCalledWith('/me/acceptance', { versions: VERSIONS, language: 'nl' });
    expect(await screen.findByText('screen:dashboard')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: /teksten/i })).not.toBeInTheDocument();
  });

  it('asks again when a text’s version changed, and says so', async () => {
    getMock.mockResolvedValue(
      me({ due: true, documents: documents({ alpha: true, terms: true }, { ...VERSIONS, privacy: '1.3' }) }),
    );
    renderGate('en');

    expect(await screen.findByText(/changed since you last accepted/i)).toBeInTheDocument();
    const got = await links();
    expect(got.privacy).toHaveAccessibleName(/Privacy policy.*1\.3/);
    expect(screen.queryByText('screen:dashboard')).not.toBeInTheDocument();
  });

  it('reads the texts again when their version changed while the screen was open, and accepts nothing', async () => {
    getMock.mockResolvedValueOnce(me(DUE));
    getMock.mockResolvedValueOnce(me({ due: true, documents: documents({}, { ...VERSIONS, terms: '1.4' }) }));
    postMock.mockRejectedValue(
      refused(409, { error: 'version_not_current', stale: ['terms'], current: { ...VERSIONS, terms: '1.4' } }),
    );
    renderGate('en');

    await userEvent.click(await screen.findByRole('button', { name: /accept/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/changed while this page was open/i);
    await waitFor(async () => expect((await links()).terms).toHaveAccessibleName(/1\.4/));
    expect(postMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('screen:dashboard')).not.toBeInTheDocument();
  });
});

describe('on the page a sign-in lands on', () => {
  it('shows the screen from the answer the sign-in just read, without asking again', async () => {
    rememberSignIn({ tenantId: 'tenant-1', acceptance: DUE });
    renderGate('en');

    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(getMock).not.toHaveBeenCalled();
  });

  it('asks afresh when the answer was for another organisation', async () => {
    rememberSignIn({ tenantId: 'tenant-2', acceptance: DUE });
    getMock.mockResolvedValue(me(GIVEN));
    renderGate('en');

    expect(await screen.findByText('screen:dashboard')).toBeInTheDocument();
    expect(getMock).toHaveBeenCalledTimes(1);
  });
});

describe('when nothing is due', () => {
  it('shows the page once acceptance is given, and no screen', async () => {
    getMock.mockResolvedValue(me(GIVEN));
    renderGate('en');

    expect(await screen.findByText('screen:dashboard')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /accept/i })).not.toBeInTheDocument();
  });

  it('shows the page where the deployment does not ask: no acceptance in the answer', async () => {
    getMock.mockResolvedValue(me());
    renderGate('en');

    expect(await screen.findByText('screen:dashboard')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /accept/i })).not.toBeInTheDocument();
  });

  it('never asks on the appliance', async () => {
    edition.selfhost = true;
    renderGate('en');

    expect(screen.getByText('screen:dashboard')).toBeInTheDocument();
    expect(getMock).not.toHaveBeenCalled();
  });
});

describe('when the answer could not be read', () => {
  it('says so, and does not take a failed read for "nothing due"', async () => {
    getMock.mockRejectedValue(refused(500, { error: 'me_failed', message: 'the database is unreachable' }));
    renderGate('en');

    expect(await screen.findByRole('alert')).toHaveTextContent('the database is unreachable');
    expect(screen.queryByText('screen:dashboard')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });
});
