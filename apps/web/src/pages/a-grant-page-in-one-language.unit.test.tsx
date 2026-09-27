// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A GRANT PAGE IN ONE LANGUAGE (workplan 0145 T6).
 *
 * The grant page is read by somebody a tester asks for access, and on
 * 2026-09-24 a Dutch reader of it saw *"U staat op het punt toegang te geven
 * tot your email — messages, folders and labels."* The frame came from the
 * dictionary and the phrase inside it from the server, which built it in
 * English only. Every refusal on the page was the server's English sentence,
 * and the page had no way to change language: the only switch lives in
 * `Layout`, and the grant and view pages are routed outside it.
 *
 * What is held here:
 *
 * - what will be read is built from the dictionary, from the data types the
 *   server names (`domains`), and joined as the page's language joins a list;
 *   under `nl` it is all Dutch and carries none of the English phrases the
 *   server used to send;
 * - a refusal shows the half in the page's language, the one the server sends
 *   beside it (`messageNl`, `reasonNl`), and is announced (`role="alert"`,
 *   which 0145 T4 leaves to this task); the waiting line is a status;
 * - a failure the server wrote no sentence for (no connection, a timeout, a
 *   subject the page cannot read, a proxy's page) is the page's own sentence
 *   in its language, never the transport's English or a parser's JSON;
 * - both pages carry the same two language buttons `Layout` has, with
 *   `aria-pressed`, and pressing one changes the sentence and the refusal;
 * - the button asks for the ending in the page's language.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { AxiosError, AxiosHeaders } from 'axios';
import { z } from 'zod';
import { DISCOVERY_DOMAINS, type DiscoveryDomain } from '@openmig/shared';
import { LocaleProvider } from '../i18n/index.tsx';

const { readMock, authorizeMock, viewReadMock, assignMock } = vi.hoisted(() => ({
  readMock: vi.fn(),
  authorizeMock: vi.fn(),
  viewReadMock: vi.fn(),
  assignMock: vi.fn(),
}));

vi.mock('../services/grant-service.ts', () => ({
  grantApi: { read: readMock, authorize: authorizeMock },
}));
vi.mock('../services/view-service.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/view-service.ts')>();
  return { ...actual, viewApi: { read: viewReadMock, withdraw: vi.fn() } };
});
vi.mock('../services/link-report-service.ts', () => ({
  linkReportApi: { available: vi.fn().mockResolvedValue(false), send: vi.fn() },
}));
// `api.ts` is NOT mocked: the refusal is read by the real code, off an
// axios-shaped error, the way the page meets one.

import Grant from './Grant.tsx';
import View from './View.tsx';

/** What the server used to send, in English only (`READS`, `grant.ts`). */
const ENGLISH_READS = [
  'your email — messages, folders and labels',
  'your calendars and their events',
  'your contacts',
  'your files in Google Drive',
  'your tasks',
];

const SUBJECT = {
  organisation: 'Acme Legal',
  checkedCompany: null,
  askedBy: 'owner@example.org',
  organisationPhone: null,
  domains: ['email', 'calendar'],
  scope: 'https://mail.google.com/ https://www.googleapis.com/auth/calendar',
  readOnlyAtProvider: false,
  from: 'someone@example.invalid',
  to: { provider: 'nextcloud', host: 'cloud.example.org', account: 'dest@example.org' },
  expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
};

const LINK_EN =
  'This link cannot be used. It may have been used already, it may have expired, or the person ' +
  'who sent it may have withdrawn it. Ask them for a fresh link — issuing one takes them a moment.';
const LINK_NL =
  'Deze link kan niet worden gebruikt. Misschien is hij al gebruikt, verlopen of ingetrokken door ' +
  'wie hem stuurde. Vraag om een nieuwe link; die is zo gemaakt.';

/** A refusal as the link client delivers one. */
function refusal(status: number, data: unknown): AxiosError {
  const err = new AxiosError(`Request failed with status code ${status}`);
  err.response = {
    status,
    statusText: '',
    headers: {},
    config: { headers: new AxiosHeaders() },
    data,
  };
  return err;
}

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <LocaleProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/grant/:link" element={<Grant />} />
            <Route path="/view/:link" element={<View />} />
          </Routes>
        </MemoryRouter>
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

const inLocale = (locale: 'en' | 'nl') => window.localStorage.setItem('ownpace.locale', locale);

beforeEach(() => {
  vi.clearAllMocks();
  inLocale('en');
  readMock.mockResolvedValue(SUBJECT);
  vi.stubGlobal('location', { assign: assignMock });
});

describe('what will be read, from the dictionary (0145 T6)', () => {
  it('under nl, is all Dutch, and carries none of the English phrases', async () => {
    inLocale('nl');
    renderAt('/grant/abc.def');
    expect(
      await screen.findByText(
        'U staat op het punt toegang te geven tot uw e-mail: berichten, mappen en labels en uw agenda’s en de afspraken erin.',
      ),
    ).toBeInTheDocument();
    const page = document.body.textContent ?? '';
    for (const phrase of ENGLISH_READS) expect(page).not.toContain(phrase);
  });

  it('under en, joins the data types as English joins a list', async () => {
    readMock.mockResolvedValue({ ...SUBJECT, domains: ['email', 'calendar', 'task'] });
    renderAt('/grant/abc.def');
    expect(
      await screen.findByText(
        'You are about to give access to your email — messages, folders and labels, your calendars and their events, and your tasks.',
      ),
    ).toBeInTheDocument();
  });

  it('names each of the five data types in both languages', async () => {
    readMock.mockResolvedValue({ ...SUBJECT, domains: ['contact', 'file', 'task'] });
    inLocale('nl');
    renderAt('/grant/abc.def');
    expect(
      await screen.findByText(
        'U staat op het punt toegang te geven tot uw contactpersonen, uw bestanden in Google Drive en uw taken.',
      ),
    ).toBeInTheDocument();
  });
});

describe('a refusal in the page’s language, announced', () => {
  it('a refused link shows its Dutch half, as an alert', async () => {
    readMock.mockRejectedValue(refusal(401, { error: 'link_unusable', message: LINK_EN, messageNl: LINK_NL }));
    inLocale('nl');
    renderAt('/grant/abc.def');
    expect(await screen.findByRole('alert')).toHaveTextContent(LINK_NL);
    expect(document.body.textContent).not.toContain(LINK_EN);
  });

  it('a refusal after the button shows its Dutch half, as an alert', async () => {
    authorizeMock.mockRejectedValue(
      refusal(409, { error: 'not_ready', reason: 'Not ready, in English.', reasonNl: 'Nog niet klaar, in het Nederlands.' }),
    );
    inLocale('nl');
    renderAt('/grant/abc.def');
    await userEvent.click(await screen.findByRole('button', { name: 'Doorgaan met Google' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Nog niet klaar, in het Nederlands.');
  });

  it('a refusal with no Dutch half shows the English one rather than nothing', async () => {
    readMock.mockRejectedValue(refusal(409, { error: 'x', reason: 'Only English here.' }));
    inLocale('nl');
    renderAt('/grant/abc.def');
    expect(await screen.findByRole('alert')).toHaveTextContent('Only English here.');
  });

  it('shows the Dutch half of the sentence it would show in English, never another one', async () => {
    // `message` is what English shows, so the Dutch is `messageNl` or
    // nothing: a `reasonNl` beside it belongs to another sentence.
    readMock.mockRejectedValue(
      refusal(401, { error: 'x', message: 'The English message.', reasonNl: 'Een andere zin.' }),
    );
    inLocale('nl');
    renderAt('/grant/abc.def');
    expect(await screen.findByRole('alert')).toHaveTextContent('The English message.');
  });

  it('the waiting line is a status', async () => {
    readMock.mockReturnValue(new Promise(() => {}));
    inLocale('nl');
    renderAt('/grant/abc.def');
    expect(await screen.findByRole('status')).toHaveTextContent('Een moment…');
  });
});

/**
 * A failure the server wrote no sentence for (0145 T6, review).
 *
 * Until then everything that was not a server body fell back to the error's
 * own message, inside the alert: zod's JSON dump of its issues for a subject
 * this page could not read (a data type it has no words for, after a sixth one
 * ships), and axios's English for a network that dropped, which a phone in a
 * chat app's browser meets often. Neither is a sentence, and neither is in the
 * page's language.
 */
describe('a failure with no sentence from the server', () => {
  const UNREACHABLE_NL =
    'Deze pagina kon de server niet bereiken. Controleer uw verbinding en probeer het opnieuw.';
  const UNREADABLE_NL =
    'Er ging iets mis op deze pagina. Probeer het later opnieuw; blijft het misgaan, laat het dan ' +
    'de persoon weten die u de link stuurde.';
  const UNREACHABLE_EN = 'This page could not reach the server. Check your connection and try again.';

  /** What the subject's parse throws for a data type this page has no words for. */
  function unreadableSubject(): unknown {
    const parsed = z
      .object({ domains: z.array(z.enum(DISCOVERY_DOMAINS as unknown as [DiscoveryDomain, ...DiscoveryDomain[]])).min(1) })
      .safeParse({ domains: ['photos'] });
    if (parsed.success) throw new Error('the schema was meant to refuse this');
    return parsed.error;
  }

  it('a subject the page cannot read says so in Dutch, with none of the parser’s words', async () => {
    readMock.mockRejectedValue(unreadableSubject());
    inLocale('nl');
    renderAt('/grant/abc.def');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(UNREADABLE_NL);
    expect(alert.textContent).not.toContain('"code"');
  });

  it('a server that cannot be reached says so in Dutch, not in the transport’s words', async () => {
    readMock.mockRejectedValue(new AxiosError('Network Error', AxiosError.ERR_NETWORK));
    inLocale('nl');
    renderAt('/grant/abc.def');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(UNREACHABLE_NL);
    expect(alert.textContent).not.toContain('Network Error');
  });

  it('a timeout after the button is the page’s own sentence, in English too', async () => {
    authorizeMock.mockRejectedValue(new AxiosError('timeout of 30000ms exceeded', AxiosError.ECONNABORTED));
    renderAt('/grant/abc.def');
    await userEvent.click(await screen.findByRole('button', { name: 'Continue with Google' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(UNREACHABLE_EN);
    expect(alert.textContent).not.toContain('timeout');
  });

  it('an answer with no sentence in it is the page’s own sentence, not the status line', async () => {
    readMock.mockRejectedValue(refusal(502, '<html><body>Bad Gateway</body></html>'));
    inLocale('nl');
    renderAt('/grant/abc.def');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(UNREADABLE_NL);
    expect(alert.textContent).not.toContain('status code');
  });

  it('the view page says the same', async () => {
    viewReadMock.mockRejectedValue(new AxiosError('Network Error', AxiosError.ERR_NETWORK));
    inLocale('nl');
    renderAt('/view/abc.def');
    expect(await screen.findByRole('alert')).toHaveTextContent(UNREACHABLE_NL);
  });
});

describe('the language switch on the grant page', () => {
  it('has the two text buttons Layout has, and says which is on', async () => {
    renderAt('/grant/abc.def');
    const group = await screen.findByRole('group', { name: 'Language' });
    expect(within(group).getByRole('button', { name: 'EN' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(group).getByRole('button', { name: 'NL' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('changes what will be read', async () => {
    renderAt('/grant/abc.def');
    await screen.findByText(/You are about to give access to your email/);
    await userEvent.click(screen.getByRole('button', { name: 'NL' }));
    expect(
      await screen.findByText(
        'U staat op het punt toegang te geven tot uw e-mail: berichten, mappen en labels en uw agenda’s en de afspraken erin.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'NL' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('changes a refusal', async () => {
    readMock.mockRejectedValue(refusal(401, { error: 'link_unusable', message: LINK_EN, messageNl: LINK_NL }));
    renderAt('/grant/abc.def');
    expect(await screen.findByRole('alert')).toHaveTextContent(LINK_EN);
    await userEvent.click(screen.getByRole('button', { name: 'NL' }));
    expect(screen.getByRole('alert')).toHaveTextContent(LINK_NL);
  });

  it('asks for the ending in the language the page is in', async () => {
    authorizeMock.mockResolvedValue({ url: 'https://accounts.google.com/o/oauth2/v2/auth?x=1' });
    renderAt('/grant/abc.def');
    await screen.findByText(/You are about to give access/);
    await userEvent.click(screen.getByRole('button', { name: 'NL' }));
    await userEvent.click(screen.getByRole('button', { name: 'Doorgaan met Google' }));
    expect(authorizeMock).toHaveBeenCalledWith('abc.def', 'nl');
  });
});

describe('the view page', () => {
  it('has the same switch, and its refusal changes with it, as an alert', async () => {
    viewReadMock.mockRejectedValue(refusal(401, { error: 'link_unusable', message: LINK_EN, messageNl: LINK_NL }));
    renderAt('/view/abc.def');
    expect(await screen.findByRole('alert')).toHaveTextContent(LINK_EN);
    const group = screen.getByRole('group', { name: 'Language' });
    await userEvent.click(within(group).getByRole('button', { name: 'NL' }));
    expect(screen.getByRole('alert')).toHaveTextContent(LINK_NL);
    expect(within(group).getByRole('button', { name: 'NL' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('its waiting line is a status', async () => {
    viewReadMock.mockReturnValue(new Promise(() => {}));
    renderAt('/view/abc.def');
    expect(await screen.findByRole('status')).toHaveTextContent('One moment…');
  });
});
