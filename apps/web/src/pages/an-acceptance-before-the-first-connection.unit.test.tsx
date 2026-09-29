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
 * And, since the review of 2026-09-29:
 *
 *  - *Not now* signs out of the sign-in service too, as the nav's *Sign out*
 *    does, so the next person at a shared machine is asked to sign in;
 *  - a bundle not built for the Alpha (`VITE_OWNPACE_STAGE`) asks nothing and
 *    waits for nothing: its pages render as before, even when `/api/me` fails;
 *  - a door's 409 `conditions_not_accepted`, through the app's own client,
 *    brings the screen up at once, and keeps the page (and what was typed on
 *    it) underneath for when the texts are accepted;
 *  - the texts that changed are marked, under a heading that says so;
 *  - a failure is said in the reader's language, with the reference kept;
 *  - the screen is a `main` landmark, and its Dutch says *aanvaarden*, as the
 *    texts do, and *uitloggen*, as the nav does.
 *
 * The links are the site's pages (`services/legal-links.ts`), which
 * `scripts/a-policy-link-that-answers.unit.test.ts` holds to the files the site
 * build writes. Unset, the site is the production one.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router';
import { AxiosError, AxiosHeaders } from 'axios';
import React from 'react';
import { LocaleProvider } from '../i18n/index.tsx';

const { getMock, postMock, edition, signOutUrlMock, leaveMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(),
  edition: { selfhost: false },
  signOutUrlMock: vi.fn(),
  leaveMock: vi.fn(),
}));

// The screen's own reads and writes are these two mocks. The app's real
// client stays reachable as `realClient`, so a door's refusal can travel
// through its own response interceptor, as it does in the app.
vi.mock('../services/api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/api.ts')>();
  return { ...actual, default: { get: getMock, post: postMock }, realClient: actual.default };
});
// The sign-in service's end-session address, and leaving for it.
vi.mock('../services/oidc.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/oidc.ts')>();
  return { ...actual, signOutUrl: signOutUrlMock, leaveForIssuer: leaveMock };
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

/** A page with something typed on it, to see whether it survives the screen. */
const Page: React.FC = () => (
  <div>
    screen:dashboard
    <label>
      A note
      <input type="text" />
    </label>
  </div>
);

function renderGate(locale: 'en' | 'nl' = 'en') {
  window.localStorage.setItem('ownpace.locale', locale);
  // App.tsx's own defaults, but for retries: the gate must not rely on a
  // focus or a refetch it would not get in the app.
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <LocaleProvider>
        <MemoryRouter initialEntries={['/dashboard']}>
          <Routes>
            <Route path="/login" element={<div>screen:login</div>} />
            <Route
              path="*"
              element={
                <AcceptanceGate>
                  <Page />
                </AcceptanceGate>
              }
            />
          </Routes>
        </MemoryRouter>
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

/** A door's refusal, sent through the app's own client and its interceptor. */
async function aDoorRefuses(): Promise<void> {
  const { realClient } = (await import('../services/api.ts')) as unknown as {
    realClient: import('axios').AxiosInstance;
  };
  await realClient
    .post('/connections', {}, {
      adapter: () =>
        Promise.reject(
          refused(409, {
            error: 'conditions_not_accepted',
            message: 'Accept the texts first.',
            messageNl: 'Aanvaard eerst de teksten.',
            documents: [{ document: 'privacy', version: '1.3' }],
          }),
        ),
    })
    .catch(() => undefined);
}

function refused(status: number, data: unknown): AxiosError {
  const err = new AxiosError(`Request failed with status code ${status}`);
  err.response = { status, statusText: '', data, headers: {}, config: { headers: new AxiosHeaders() } };
  return err;
}

beforeEach(() => {
  vi.clearAllMocks();
  edition.selfhost = false;
  // A bundle built for the Alpha, as live's is: the only one that asks on load.
  vi.stubEnv('VITE_OWNPACE_STAGE', 'alpha');
  signOutUrlMock.mockResolvedValue(null);
  useAuthStore.setState({ isAuthenticated: true, token: 'token', tenantId: 'tenant-1', tenantCount: 1 });
});

afterEach(() => {
  vi.unstubAllEnvs();
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
    // The texts' own word (terms §1, Alpha §2, privacy §4.4), and the nav's.
    expect(screen.getByRole('button', { name: 'Alle drie aanvaarden' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nu niet, uitloggen' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'De teksten om te aanvaarden' })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/accepte/i);
  });

  it('is the page’s main landmark', async () => {
    getMock.mockResolvedValue(me(DUE));
    renderGate('en');

    const main = await screen.findByRole('main');
    expect(within(main).getByRole('heading', { level: 1 })).toBeInTheDocument();
  });

  it('one button sends the versions it showed and the reader’s language, and the page comes back', async () => {
    getMock.mockResolvedValue(me(DUE));
    postMock.mockResolvedValue({ data: { written: 3, acceptance: GIVEN } });
    renderGate('nl');

    await userEvent.click(await screen.findByRole('button', { name: /aanvaarden/i }));

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

  it('marks the text that changed, inside its link, under a heading that says the texts changed', async () => {
    getMock.mockResolvedValue(
      me({ due: true, documents: documents({ alpha: true, terms: true }, { ...VERSIONS, privacy: '1.3' }) }),
    );
    renderGate('en');

    expect(await screen.findByRole('heading', { level: 1, name: 'The texts have changed' })).toBeInTheDocument();
    const got = await links();
    expect(got.privacy).toHaveAccessibleName(/new version/i);
    expect(got.alpha).not.toHaveAccessibleName(/new version/i);
    expect(got.terms).not.toHaveAccessibleName(/new version/i);
  });

  it('in Dutch too', async () => {
    getMock.mockResolvedValue(
      me({ due: true, documents: documents({ alpha: true, terms: true }, { ...VERSIONS, privacy: '1.3' }) }),
    );
    renderGate('nl');

    expect(await screen.findByRole('heading', { level: 1, name: 'De teksten zijn gewijzigd' })).toBeInTheDocument();
    expect((await links()).privacy).toHaveAccessibleName(/nieuwe versie/i);
  });

  it('a first acceptance marks nothing as new, under its own heading', async () => {
    getMock.mockResolvedValue(me(DUE));
    renderGate('en');

    expect(await screen.findByRole('heading', { level: 1, name: 'Before you start' })).toBeInTheDocument();
    const got = await links();
    for (const link of Object.values(got)) expect(link).not.toHaveAccessibleName(/new version/i);
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

describe('Not now', () => {
  it('signs out of the sign-in service too, so the next person at this machine is asked to sign in', async () => {
    const END = 'https://id.example.invalid/oidc/v1/end_session?id_token_hint=token';
    signOutUrlMock.mockResolvedValue(END);
    getMock.mockResolvedValue(me(DUE));
    renderGate('en');

    await userEvent.click(await screen.findByRole('button', { name: 'Not now, sign out' }));

    await waitFor(() => expect(leaveMock).toHaveBeenCalledWith(END));
    expect(signOutUrlMock).toHaveBeenCalledWith('token');
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(postMock).not.toHaveBeenCalled();
  });

  it('with no sign-in service to end, signs out here and goes to the sign-in page', async () => {
    getMock.mockResolvedValue(me(DUE));
    renderGate('en');

    await userEvent.click(await screen.findByRole('button', { name: 'Not now, sign out' }));

    expect(await screen.findByText('screen:login')).toBeInTheDocument();
    expect(leaveMock).not.toHaveBeenCalled();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });
});

describe('when a door refuses because the texts are not accepted', () => {
  it('brings the screen up at once, through the app’s own client, and keeps the page underneath', async () => {
    getMock.mockResolvedValueOnce(me(GIVEN));
    getMock.mockResolvedValue(
      me({ due: true, documents: documents({ alpha: true, terms: true }, { ...VERSIONS, privacy: '1.3' }) }),
    );
    postMock.mockResolvedValue({
      data: {
        written: 1,
        acceptance: { due: false, documents: documents({ alpha: true, privacy: true, terms: true }) },
      },
    });
    renderGate('en');
    await userEvent.type(await screen.findByRole('textbox', { name: 'A note' }), 'half a form');

    await aDoorRefuses();

    expect(await screen.findByRole('heading', { level: 1, name: 'The texts have changed' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'A note' }), 'the page is still offered').not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Accept all three' }));
    expect(await screen.findByRole('textbox', { name: 'A note' })).toHaveValue('half a form');
  });

  it('on a bundle not built for the Alpha too, which then starts asking', async () => {
    vi.stubEnv('VITE_OWNPACE_STAGE', '');
    getMock.mockResolvedValue(me(DUE));
    renderGate('en');
    expect(await screen.findByText('screen:dashboard')).toBeInTheDocument();
    expect(getMock).not.toHaveBeenCalled();

    await aDoorRefuses();

    expect(await screen.findByRole('heading', { level: 1, name: 'Before you start' })).toBeInTheDocument();
  });

  it('says the refusal in the reader’s language wherever a door shows it', async () => {
    const { conditionsRefusal } = await import('../services/acceptance.ts');
    const err = refused(409, {
      error: 'conditions_not_accepted',
      message: 'Accept the texts first.',
      messageNl: 'Aanvaard eerst de teksten.',
    });
    const t = (key: string) => `t:${key}`;

    expect(conditionsRefusal(err, t as never)).toBe('t:acceptance.refused');
    expect(conditionsRefusal(refused(409, { error: 'account_closed', message: 'closed' }), t as never)).toBeNull();
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

  it('asks nothing and waits for nothing on a bundle not built for the Alpha, even when /api/me fails', async () => {
    vi.stubEnv('VITE_OWNPACE_STAGE', '');
    getMock.mockRejectedValue(refused(503, { error: 'me_failed', reason: 'down' }));
    renderGate('en');

    expect(screen.getByText('screen:dashboard')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(getMock).not.toHaveBeenCalled();
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

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be read.*fault is on our side/);
    expect(screen.queryByText('screen:dashboard')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('says a fault on our side in the reader’s language, keeping its reference', async () => {
    getMock.mockRejectedValue(
      refused(500, {
        error: 'me_failed',
        reason:
          'Something went wrong reading your account — this is a fault on our side, not something your input ' +
          'caused. Reference 0a1b2c3d; quoting it finds the detail in the server log.',
      }),
    );
    renderGate('nl');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('0a1b2c3d');
    expect(alert).not.toHaveTextContent(/Something went wrong/);
    expect(alert).toHaveTextContent(/Uw account kon niet worden gelezen/);
  });

  it('says a connection that never answered in the reader’s language', async () => {
    getMock.mockRejectedValue(new AxiosError('Network Error', 'ERR_NETWORK'));
    renderGate('nl');

    const alert = await screen.findByRole('alert');
    expect(alert).not.toHaveTextContent(/Network Error/);
    expect(alert).toHaveTextContent(/niet bereikbaar/);
  });
});

describe('when recording the acceptance fails', () => {
  it('says so in the reader’s language, keeping the reference, and the screen stays', async () => {
    getMock.mockResolvedValue(me(DUE));
    postMock.mockRejectedValue(
      refused(500, {
        error: 'acceptance_failed',
        reason:
          'Something went wrong recording your acceptance — this is a fault on our side, not something your ' +
          'input caused. Reference 9f8e7d6c; quoting it finds the detail in the server log.',
      }),
    );
    renderGate('nl');

    await userEvent.click(await screen.findByRole('button', { name: /aanvaarden/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('9f8e7d6c');
    expect(alert).not.toHaveTextContent(/Something went wrong/);
    expect(alert).toHaveTextContent(/niet vastgelegd/);
    expect(screen.queryByText('screen:dashboard')).not.toBeInTheDocument();
  });
});
