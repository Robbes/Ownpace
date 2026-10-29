// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A GRANT LINK THAT OPENS REGISTRATION (workplan 0095 T6; the owner,
 * 2026-10-29).
 *
 * The owner asked for access to the Alpha on live, was granted, and then had
 * to type the same address again at the sign-in service: *"I needed to
 * register an account again. While I thought I already filled in my data when
 * asking access to the alpha."* The grant mail's link now ends in
 * `#register=` and the address it was granted to (`registrationLink` in
 * `@openmig/shared`). Opened from it, the sign-in page offers:
 *
 * - EN *"Create your account"*, with the address under it, then *"Already have
 *   an account?"* and the usual *"Sign in"*;
 * - NL *"Maak uw account aan"*, then *"Heeft u al een account?"* and
 *   *"Aanmelden"*.
 *
 * "Create your account" asks the issuer for registration with the address
 * filled in (`prompt=create`, `login_hint`, `ui_locales`); "Sign in" asks for
 * exactly what it always asked for. There is no request-access link: this
 * person's request has been answered.
 *
 * ONLY WHERE A VERIFIED ADDRESS BINDS ANYBODY: behind the request link's own
 * gate (`acceptsSeedToken: false`, see a-door-from-the-sign-in-page). And only
 * for a fragment that holds an address; anything else is today's page.
 *
 * A BUTTON, NOT A REDIRECT: nothing leaves for the issuer until somebody
 * presses it.
 *
 * The real route table renders the real sign-in page, as in
 * a-door-from-the-sign-in-page.unit.test.tsx; the issuer and the API's answer
 * are mocked the same way.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../services/edition.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/edition.ts')>();
  return { ...actual, isSelfHost: () => false };
});
vi.mock('../services/oidc.ts', () => ({ oidcConfig: vi.fn(), beginSignIn: vi.fn() }));
vi.mock('../services/auth-mode.ts', () => ({ fetchAuthMode: vi.fn() }));
vi.mock('../services/build-identity.ts', () => ({
  uiBuild: () => ({ version: '0.1.0-rc.1', commit: '72a78d4' }),
  fetchServerBuild: () => Promise.resolve(null),
  describeBuild: () => 'v0.1.0-rc.1 · 72a78d4',
  shortCommit: (c: string) => c.slice(0, 7),
}));
vi.mock('../components/Layout.tsx', async () => {
  const { Outlet } = await import('react-router');
  return { default: () => <Outlet /> };
});

import AppRoutes from '../AppRoutes.tsx';
import { LocaleProvider } from '../i18n/index.tsx';
import { beginSignIn, oidcConfig } from '../services/oidc.ts';
import { fetchAuthMode } from '../services/auth-mode.ts';

/** The address the grant was for, with the `+` that encoding has to keep. */
const GRANTED = 'anna+x@example.test';
const LINK = (locale: string) => `/login?locale=${locale}#register=anna%2Bx%40example.test`;

/** The words to find things by, in each language. */
const SAID = {
  en: {
    create: 'Create your account',
    as: `With ${GRANTED}. The sign-in service mails a code to that address to confirm it is yours.`,
    have: 'Already have an account?',
    signIn: /^sign in$/i,
  },
  nl: {
    create: 'Maak uw account aan',
    as: `Met ${GRANTED}. De aanmeldservice mailt een code naar dat adres om te bevestigen dat het van u is.`,
    have: 'Heeft u al een account?',
    signIn: /^aanmelden$/i,
  },
} as const;

type Locale = keyof typeof SAID;
const LOCALES = Object.keys(SAID) as Locale[];

/**
 * The browser's stored language is English throughout: the link's `?locale=`
 * is what makes the Dutch page Dutch, as it is for the tester the mail is for.
 */
const renderAt = (path: string) => {
  window.localStorage.setItem('ownpace.locale', 'en');
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <LocaleProvider>
        <MemoryRouter initialEntries={[path]}>
          <AppRoutes />
        </MemoryRouter>
      </LocaleProvider>
    </QueryClientProvider>,
  );
};

const doorsToTheRequestPage = () =>
  screen
    .queryAllByRole('link')
    .filter((a) => (a.getAttribute('href') ?? '').startsWith('/request-access'));

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(beginSignIn).mockReset();
  vi.mocked(beginSignIn).mockResolvedValue(undefined);
  vi.mocked(oidcConfig).mockReturnValue({ issuer: 'https://id.example.test', clientId: 'web' });
  vi.mocked(fetchAuthMode).mockResolvedValue({ mode: 'managed', acceptsSeedToken: false });
});

afterEach(() => {
  window.localStorage.clear();
});

describe('opened from the grant mail’s link', () => {
  for (const locale of LOCALES) {
    it(`${locale}: offers registration with the address first, and sign-in second`, async () => {
      renderAt(LINK(locale));

      const create = await screen.findByRole('button', { name: SAID[locale].create });
      const signIn = screen.getByRole('button', { name: SAID[locale].signIn });
      expect(screen.getByText(SAID[locale].as)).toBeInTheDocument();
      const have = screen.getByText(SAID[locale].have);
      expect(
        create.compareDocumentPosition(have) & Node.DOCUMENT_POSITION_FOLLOWING,
        'registration first: the link is for somebody granted access, who has\n' +
          'most likely no account yet',
      ).toBeTruthy();
      expect(have.compareDocumentPosition(signIn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(
        doorsToTheRequestPage(),
        'no request-access link: this person’s request has been answered',
      ).toEqual([]);
      expect(beginSignIn, 'a button, not a redirect: nothing leaves on arrival').not.toHaveBeenCalled();
    });

    it(`${locale}: "${SAID[locale].create}" asks the issuer for registration, with the address and the page’s language`, async () => {
      const user = userEvent.setup();
      renderAt(LINK(locale));

      await user.click(await screen.findByRole('button', { name: SAID[locale].create }));

      expect(beginSignIn).toHaveBeenCalledTimes(1);
      expect(beginSignIn).toHaveBeenCalledWith(undefined, {
        create: true,
        loginHint: GRANTED,
        uiLocales: locale,
      });
    });

    it(`${locale}: the sign-in button beside it asks for exactly what it always did`, async () => {
      const user = userEvent.setup();
      renderAt(LINK(locale));

      await user.click(await screen.findByRole('button', { name: SAID[locale].signIn }));

      expect(beginSignIn).toHaveBeenCalledTimes(1);
      expect(
        beginSignIn,
        'plain sign-in takes no options: no prompt, no hint, no locale',
      ).toHaveBeenCalledWith();
    });
  }

  it('says which button is on its way, and holds both while it goes', async () => {
    const user = userEvent.setup();
    vi.mocked(beginSignIn).mockReturnValue(new Promise(() => {}));
    renderAt(LINK('en'));

    await user.click(await screen.findByRole('button', { name: SAID.en.create }));

    expect(screen.getByRole('button', { name: 'Taking you to the sign-in service…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: SAID.en.signIn })).toBeDisabled();
  });

  it('says the sign-in service’s own sentence when it cannot be reached, and lets them try again', async () => {
    const user = userEvent.setup();
    vi.mocked(beginSignIn).mockRejectedValueOnce(new Error('The sign-in service did not answer (503).'));
    renderAt(LINK('en'));

    await user.click(await screen.findByRole('button', { name: SAID.en.create }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The sign-in service did not answer (503).');
    expect(screen.getByRole('button', { name: SAID.en.create })).toBeEnabled();
  });

  it('shows the address as text, whatever it holds', async () => {
    // The fragment is anybody's to write. React writes text as text; this
    // pins that the address is never handed to anything that would not.
    renderAt('/login?locale=en#register=%3Cb%3Ex%3C%2Fb%3E%40example.test');

    await screen.findByRole('button', { name: SAID.en.create });
    expect(screen.getByText(/With <b>x<\/b>@example\.test\./)).toBeInTheDocument();
    expect(document.querySelector('main b')).toBeNull();
  });
});

describe('today’s page, wherever the link’s promise cannot hold', () => {
  it.each([
    ['no fragment', '/login?locale=en'],
    ['another key', '/login?locale=en#login=anna%40example.test'],
    ['a value that is no address', '/login?locale=en#register=javascript%3Aalert(1)'],
    ['a broken escape', '/login?locale=en#register=%E0%A'],
  ])('%s: no registration button, and the request link is back', async (_what, path) => {
    renderAt(path);

    await screen.findByRole('button', { name: SAID.en.signIn });
    expect(screen.queryByRole('button', { name: SAID.en.create })).toBeNull();
    expect(screen.queryByText(SAID.en.have)).toBeNull();
    expect(doorsToTheRequestPage()).toHaveLength(1);
  });

  it('an API without an issuer: nothing would verify the address, so no registration button', async () => {
    // The request link's own gate (0144 T7): with `acceptsSeedToken: true`
    // the API has no issuer, and a granted request is never taken up there.
    vi.mocked(fetchAuthMode).mockResolvedValue({ mode: 'local', acceptsSeedToken: true });
    renderAt(LINK('en'));

    await screen.findByRole('button', { name: SAID.en.signIn });
    expect(screen.queryByRole('button', { name: SAID.en.create })).toBeNull();
    expect(screen.queryByText(SAID.en.have)).toBeNull();
  });

  it('a build without an issuer: the paste box, and no registration button', async () => {
    vi.mocked(oidcConfig).mockReturnValue(null);
    vi.mocked(fetchAuthMode).mockResolvedValue({ mode: 'local', acceptsSeedToken: true });
    renderAt(LINK('en'));

    expect(await screen.findByLabelText(/access token/i)).toBeVisible();
    expect(screen.queryByRole('button', { name: SAID.en.create })).toBeNull();
  });

  it('while the page is still asking the API: nothing to press yet', async () => {
    vi.mocked(fetchAuthMode).mockReturnValue(new Promise(() => {}));
    renderAt(LINK('en'));

    expect(await screen.findByText(/checking how to sign in/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: SAID.en.create })).toBeNull();
  });
});
