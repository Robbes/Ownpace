// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A LINK PAGE THAT ASKS ONE THING AT A TIME (workplan 0176 T1, §5).
 *
 * A person's link opened on one long page: one sentence, a box of facts, a
 * question in small print, the note about chat apps, then every account as a
 * card with its permission, its scope and its button. Seven readers of the desk
 * review read it as the trap they had been warned about. Now it asks in steps,
 * one thing per screen:
 *
 * 1. who asks, and for what, with one question: did they tell you themselves?
 *    *No, not yet* is an answer as good as *yes*, and leads to a calm screen;
 * 2. the accounts, where there is more than one, or one already connected, or
 *    a new address to confirm;
 * 3. what to have ready;
 * 4. what the provider will show, then the provider's button.
 *
 * Each step is a place in the page, as *Start a migration*'s are (0145 T3 (a),
 * `a-step-that-starts-at-the-top`): one `h1`, focus on it, the page at its
 * top, the tab named after it, *Step n of total* in words, and the browser's
 * Back one step back. The answer to the question is kept for the tab only,
 * under the link's id and never its secret.
 *
 * One case for each of §21.4's thirteen points.
 */
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { LocaleProvider } from '../i18n/index.tsx';

const { readMock, authorizeMock, reportAvailableMock, assignMock } = vi.hoisted(() => ({
  readMock: vi.fn(),
  authorizeMock: vi.fn(),
  reportAvailableMock: vi.fn(async () => false),
  assignMock: vi.fn(),
}));

vi.mock('../services/grant-service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/grant-service.ts')>()),
  grantApi: { read: readMock, authorize: authorizeMock, authorizeDrive: vi.fn(), password: vi.fn() },
}));
vi.mock('../services/link-report-service.ts', () => ({
  linkReportApi: { available: reportAvailableMock, send: vi.fn() },
}));
vi.mock('../services/api.ts', () => ({ default: {}, serverMessage: () => 'a server sentence' }));

import Grant from './Grant.tsx';

/** A person's link: `p.<id>.<secret>`. The secret never leaves the page. */
const ID = 'a1b2c3';
const SECRET = 'the-secret-part';
const LINK = `p.${ID}.${SECRET}`;
const PATH = `/grant/${LINK}`;

const IN_A_WEEK = new Date(Date.now() + 7 * 86_400_000).toISOString();

/** A Google account still to connect, copying mail to Soverin. */
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

/** A Microsoft account still to connect, copying files to Nextcloud. */
const MICROSOFT = {
  ...GMAIL,
  ref: 'ref-ms',
  provider: 'microsoft',
  account: 'anna@outlook.example',
  domains: ['file'],
  scope: 'offline_access openid email profile User.Read Files.Read',
  readOnlyAtProvider: true,
  migrations: [
    { domains: ['file'], to: { provider: 'nextcloud', host: 'cloud.example.org', account: 'anna' }, granted: false, theOrganisationOpensIt: false },
  ],
};

/** An IMAP account connected with the person's own password. */
const PASSWORD = {
  ref: 'ref-imap',
  role: 'source',
  way: 'password',
  provider: 'imap',
  account: 'anna@mail.example',
  server: { hosts: ['imap.mail.example'], published: false },
  fields: [
    { key: 'password', who: 'person', labelKey: 'connections.field.password', secret: true, autoComplete: 'new-password' },
  ],
  tries: { left: 5, locked: false },
  granted: false,
  again: false,
  domains: ['email'],
  scope: null,
  readOnlyAtProvider: false,
  notReady: null,
  migrations: [
    { domains: ['email'], to: { provider: 'soverin', host: null, account: 'anna@soverin.net' }, granted: false, theOrganisationOpensIt: false },
  ],
};

const subject = (accounts: readonly unknown[], over: Record<string, unknown> = {}) => ({
  kind: 'person',
  organisation: 'Acme Families',
  checkedCompany: null,
  askedBy: 'owner@example.org',
  organisationPhone: '+31 20 123 4567',
  accounts,
  expiresAt: IN_A_WEEK,
  ...over,
});

let router: ReturnType<typeof createMemoryRouter>;

function renderPage(entry: string | { pathname: string; state: unknown } = PATH) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  router = createMemoryRouter([{ path: '/grant/:link', element: <Grant /> }], { initialEntries: [entry] });
  return render(
    <QueryClientProvider client={qc}>
      <LocaleProvider>
        <RouterProvider router={router} />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

const h1 = () => screen.getByRole('heading', { level: 1 });
const press = async (name: string | RegExp) => userEvent.click(await screen.findByRole('button', { name }));

/** Through the first screen and, where the link has one, the accounts, to an account's *Have this ready*. */
async function toReady(account?: string) {
  await press('Yes, that is right');
  if (account !== undefined) await press(`Connect ${account}`);
  await screen.findByRole('heading', { level: 1, name: 'Have this ready' });
}

let scrolls: MockInstance<typeof window.scrollTo>;

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.setItem('ownpace.locale', 'en');
  window.sessionStorage.clear();
  readMock.mockResolvedValue(subject([GMAIL]));
  vi.stubGlobal('location', { assign: assignMock });
  // A reader who asked for less motion: the scroll is instant (§5.6).
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
  scrolls = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('1. the first screen: who asks, for what, and one question', () => {
  it('opens on it while no account is connected and the tab holds no answer: one h1, the question, two buttons of one size', async () => {
    renderPage();
    const title = await screen.findByRole('heading', { level: 1, name: 'owner@example.org asks for your permission' });
    expect(screen.getAllByRole('heading', { level: 1 })).toEqual([title]);
    expect(screen.getByText('This page is from Ownpace, the service that makes the copy.')).toBeInTheDocument();
    expect(screen.getByText('owner@example.org wants to copy your email from Google (anna@work.example) to Soverin (anna@soverin.net).')).toBeInTheDocument();
    expect(screen.getByText('Did owner@example.org tell you about this link themselves?')).toBeInTheDocument();
    const yes = screen.getByRole('button', { name: 'Yes, that is right' });
    const notYet = screen.getByRole('button', { name: 'No, not yet' });
    expect(yes.className).toBe(notYet.className);
    // No provider's button, and no password box, on this screen.
    expect(screen.queryByRole('button', { name: /^(Sign in|Continue) with/ })).not.toBeInTheDocument();
    expect(document.querySelector('input[type="password"]')).toBeNull();
    // The sender's facts, under the label Sender (T3 gives it a name).
    expect(screen.getByText('Sender')).toBeInTheDocument();
    expect(screen.getByText('There is no hurry. You can do this until', { exact: false })).toBeInTheDocument();
  });
});

describe('2. No, not yet', () => {
  it('opens a calm screen and sends nothing; Back returns', async () => {
    renderPage();
    await screen.findByRole('heading', { level: 1 });
    const calls = [readMock.mock.calls.length, authorizeMock.mock.calls.length, reportAvailableMock.mock.calls.length];
    await press('No, not yet');
    expect(await screen.findByRole('heading', { level: 1, name: 'Then wait a moment' })).toBeInTheDocument();
    expect(screen.getByText('This page can wait. The link works until', { exact: false })).toBeInTheDocument();
    expect([readMock.mock.calls.length, authorizeMock.mock.calls.length, reportAvailableMock.mock.calls.length]).toEqual(calls);
    expect(window.sessionStorage.length).toBe(0);
    await press('Back');
    expect(await screen.findByRole('heading', { level: 1, name: 'owner@example.org asks for your permission' })).toBeInTheDocument();
  });
});

describe('3. Yes', () => {
  it('opens Have this ready for the one waiting account', async () => {
    renderPage();
    await press('Yes, that is right');
    expect(await screen.findByRole('heading', { level: 1, name: 'Have this ready' })).toBeInTheDocument();
  });

  it('opens the accounts where the link holds more than one', async () => {
    readMock.mockResolvedValue(subject([GMAIL, MICROSOFT]));
    renderPage();
    await press('Yes, that is right');
    expect(await screen.findByRole('heading', { level: 1, name: 'Your accounts' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect anna@work.example' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect anna@outlook.example' })).toBeInTheDocument();
  });
});

describe('4. the provider’s button', () => {
  it('stands only on the last screen of an account, and follows only that provider’s own address', async () => {
    authorizeMock.mockResolvedValue({ url: 'https://accounts.google.com/o/oauth2/v2/auth?x=1' });
    renderPage();
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('button', { name: 'Sign in with Google' })).not.toBeInTheDocument();
    await toReady();
    expect(screen.queryByRole('button', { name: 'Sign in with Google' })).not.toBeInTheDocument();
    await press('Next');
    expect(await screen.findByRole('heading', { level: 1, name: 'What you will see at Google' })).toBeInTheDocument();
    await press('Sign in with Google');
    expect(authorizeMock).toHaveBeenCalledWith(LINK, 'en', 'google', 'anna@work.example');
    expect(assignMock).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/v2/auth?x=1');
  });

  it('follows nothing that is not the provider’s own page', async () => {
    authorizeMock.mockResolvedValue({ url: 'https://accounts.google.com.example.net/o/oauth2' });
    renderPage();
    await toReady();
    await press('Next');
    await press('Sign in with Google');
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(assignMock).not.toHaveBeenCalled();
  });
});

describe('5. each step, as a browser and a screen reader meet it (§5.6)', () => {
  it('has one h1 with the focus on it, the page at its top at once, the tab named after it, and its number in words', async () => {
    renderPage();
    await screen.findByRole('heading', { level: 1 });
    // The first render moves nothing.
    expect(scrolls).not.toHaveBeenCalled();
    expect(screen.getByText('Step 1 of 4')).toBeInTheDocument();
    await press('Yes, that is right');
    const ready = await screen.findByRole('heading', { level: 1, name: 'Have this ready' });
    expect(document.activeElement).toBe(ready);
    expect(scrolls).toHaveBeenLastCalledWith({ top: 0, left: 0, behavior: 'instant' });
    expect(document.title).toBe('Have this ready — Ownpace');
    expect(screen.getByText('Step 2 of 4')).toBeInTheDocument();
    await press('Next');
    expect(await screen.findByText('Step 3 of 4')).toBeInTheDocument();
    expect(document.activeElement).toBe(h1());
    expect(document.title).toBe('What you will see at Google — Ownpace');
  });
});

describe('6. the browser’s Back', () => {
  it('goes one step back', async () => {
    renderPage();
    await toReady();
    await press('Next');
    await screen.findByRole('heading', { level: 1, name: 'What you will see at Google' });
    await act(async () => {
      await router.navigate(-1);
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'Have this ready' })).toBeInTheDocument();
  });

  it('a step opened first, with no answer in the tab, shows the first screen', async () => {
    renderPage({ pathname: PATH, state: { grantStep: 'provider', account: 'ref-gmail' } });
    expect(await screen.findByRole('heading', { level: 1, name: 'owner@example.org asks for your permission' })).toBeInTheDocument();
  });
});

describe('7. the answer, kept for the tab only', () => {
  it('under the link’s id and never its secret, so a return does not ask again', async () => {
    const view = renderPage();
    await press('Yes, that is right');
    await screen.findByRole('heading', { level: 1, name: 'Have this ready' });
    const keys = Array.from({ length: window.sessionStorage.length }, (_, i) => window.sessionStorage.key(i) ?? '');
    expect(keys.some((k) => k.includes(ID))).toBe(true);
    expect(keys.join(' ')).not.toContain(SECRET);
    expect(Object.values({ ...window.sessionStorage }).join(' ')).not.toContain(SECRET);
    expect(window.localStorage.getItem(keys[0]!)).toBeNull();
    view.unmount();
    renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: 'Have this ready' })).toBeInTheDocument();
  });

  it('storage that throws breaks nothing: the page asks again', async () => {
    // As a browser that blocks site data answers: reaching the storage throws.
    const own = Object.getOwnPropertyDescriptor(window, 'sessionStorage');
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    });
    try {
      const view = renderPage();
      await press('Yes, that is right');
      expect(await screen.findByRole('heading', { level: 1, name: 'Have this ready' })).toBeInTheDocument();
      view.unmount();
      renderPage();
      expect(await screen.findByRole('heading', { level: 1, name: 'owner@example.org asks for your permission' })).toBeInTheDocument();
    } finally {
      if (own) Object.defineProperty(window, 'sessionStorage', own);
      else delete (window as { sessionStorage?: Storage }).sessionStorage;
    }
  });
});

describe('8. shown again from the browser’s back cache', () => {
  it('its buttons can be pressed', async () => {
    authorizeMock.mockResolvedValue({ url: 'https://accounts.google.com/o/oauth2/v2/auth?x=1' });
    renderPage();
    await toReady();
    await press('Next');
    await press('Sign in with Google');
    // The page left for Google, and came back from the browser's cache.
    expect(screen.getByRole('button', { name: 'Opening Google…' })).toBeDisabled();
    const shown = new Event('pageshow');
    Object.defineProperty(shown, 'persisted', { value: true });
    act(() => {
      window.dispatchEvent(shown);
    });
    expect(screen.getByRole('button', { name: 'Sign in with Google' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'No, rather not' })).toBeEnabled();
  });
});

/** Whether `a` comes before `b` in the document. */
const before = (a: Element, b: Element): boolean => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe('9. before any button that leaves the page or sends a password', () => {
  it('says where from and where to, which account, the date, and the texts a person accepts with their two links', async () => {
    renderPage();
    await toReady();
    await press('Next');
    const button = await screen.findByRole('button', { name: 'Sign in with Google' });
    for (const said of [
      screen.getByText('To anna@soverin.net, Soverin: your email — messages, folders and labels.'),
      screen.getByText(/^Sign in as anna@work\.example\./),
      screen.getByText(/^This link works until /),
      screen.getByText(/^By continuing you accept how your data is handled:/),
      screen.getByRole('link', { name: 'Privacy policy' }),
      screen.getByRole('link', { name: 'Terms of service' }),
    ]) {
      expect(before(said, button), said.textContent ?? '').toBe(true);
    }
  });

  it('and before a password box, on the password account’s one screen', async () => {
    readMock.mockResolvedValue(subject([PASSWORD]));
    renderPage();
    await toReady();
    const box = document.querySelector('input[type="password"]');
    expect(box).not.toBeNull();
    for (const said of [
      screen.getByText('To anna@soverin.net, Soverin: your email — messages, folders and labels.'),
      screen.getByText(/^This link works until /),
      screen.getByText(/^By continuing you accept how your data is handled:/),
      screen.getByRole('link', { name: 'Privacy policy' }),
    ]) {
      expect(before(said, box!), said.textContent ?? '').toBe(true);
    }
  });
});

describe('10. Google’s screens, told before they come', () => {
  it('during the Alpha: the together line, the warning step in our own words with no quote of Google’s, and no line to the guide', async () => {
    vi.stubEnv('VITE_OWNPACE_STAGE', 'alpha');
    renderPage();
    await toReady();
    expect(screen.getByText('Do this together with owner@example.org if you can: on the phone, or at the table.')).toBeInTheDocument();
    await press('Next');
    await screen.findByRole('heading', { level: 1, name: 'What you will see at Google' });
    const steps = within(screen.getByRole('list', { name: 'What you will see at Google' })).getAllByRole('listitem');
    expect(steps).toHaveLength(4);
    expect(steps[1]!.textContent).toBe(
      'Google has not checked Ownpace yet. That is why Google warns, and Google is right to. Go on to Ownpace there. Do this only here, because owner@example.org told you about it themselves. At any other warning, stop.',
    );
    expect(steps[3]!.textContent).toBe(
      'Does Google not allow the connection? Then this address is not on Google’s list yet. Close the page and tell owner@example.org. You did nothing wrong.',
    );
    // Nothing of Google's is quoted until T0 has its words.
    expect(`${steps[1]!.textContent}${steps[3]!.textContent}`).not.toMatch(/[«»“”"]/);
    expect(screen.queryByRole('link', { name: /guide|handleiding/i })).not.toBeInTheDocument();
  });

  it('outside the Alpha: no warning step, no fourth step and no together line', async () => {
    vi.stubEnv('VITE_OWNPACE_STAGE', 'beta');
    renderPage();
    await toReady();
    // The together line only: *Do you not know the password? … together with {who}* stays at
    // every stage (§5.4), so the match names the line itself (corrected 2026-11-26).
    expect(screen.queryByText(/together with .* if you can/)).not.toBeInTheDocument();
    await press('Next');
    await screen.findByRole('heading', { level: 1, name: 'What you will see at Google' });
    const steps = within(screen.getByRole('list', { name: 'What you will see at Google' })).getAllByRole('listitem');
    expect(steps).toHaveLength(2);
    expect(document.body.textContent).not.toMatch(/Google warns|not allow the connection/);
  });
});

describe('11. read-only, only where the provider holds it', () => {
  it('Gmail: Google’s words are broader, and nothing says read-only', async () => {
    renderPage();
    await toReady();
    await press('Next');
    await screen.findByRole('heading', { level: 1, name: 'What you will see at Google' });
    expect(screen.getByText('Google’s words are broader than what Ownpace does. Ownpace only reads. It sends nothing and deletes nothing.')).toBeInTheDocument();
    expect(screen.getByText('Make sure everything Ownpace asks for is ticked.')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Read-only/);
  });

  it('Microsoft, which holds it to reading: read-only, and nothing says the words are broader', async () => {
    readMock.mockResolvedValue(subject([MICROSOFT]));
    renderPage();
    await toReady();
    await press('Next');
    await screen.findByRole('heading', { level: 1, name: 'What you will see at Microsoft' });
    expect(screen.getByText(/^Read-only\./)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/broader/);
    expect(screen.getByRole('button', { name: 'Sign in with Microsoft' })).toBeInTheDocument();
  });
});

describe('12. Report this link', () => {
  it('is a button on not yet, and a quiet link at the foot of every other screen', async () => {
    reportAvailableMock.mockResolvedValue(true);
    renderPage();
    await screen.findByRole('heading', { level: 1 });
    const atTheFoot = await screen.findByRole('button', { name: 'Report this link' });
    expect(atTheFoot.closest('[data-foot]')).not.toBeNull();
    expect(atTheFoot).toHaveAttribute('data-look', 'link');
    await press('No, not yet');
    await screen.findByRole('heading', { level: 1, name: 'Then wait a moment' });
    const reports = screen.getAllByRole('button', { name: 'Report this link' });
    expect(reports).toHaveLength(1);
    expect(reports[0]!.closest('[data-foot]')).toBeNull();
    expect(reports[0]).toHaveAttribute('data-look', 'button');
    await press('Back');
    await press('Yes, that is right');
    const later = await screen.findByRole('button', { name: 'Report this link' });
    expect(later.closest('[data-foot]')).not.toBeNull();
  });
});

describe('13. the person’s new address', () => {
  it('stands on the accounts screen and never on the first', async () => {
    readMock.mockResolvedValue(subject([GMAIL], { addressChanges: [{ ref: 'ac-1', newAddress: 'anna@soverin.net', state: 'proposed' }] }));
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'owner@example.org asks for your permission' });
    expect(screen.queryByText(/Your new address/)).not.toBeInTheDocument();
    // One Yes, that is right on the first screen: the question's.
    expect(screen.getAllByRole('button', { name: 'Yes, that is right' })).toHaveLength(1);
    await press('Yes, that is right');
    expect(await screen.findByRole('heading', { level: 1, name: 'Your accounts' })).toBeInTheDocument();
    expect(screen.getByText('Your new address: anna@soverin.net. Is that right?')).toBeInTheDocument();
  });
});
