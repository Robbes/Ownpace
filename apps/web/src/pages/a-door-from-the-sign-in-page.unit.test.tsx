// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A DOOR FROM THE SIGN-IN PAGE (workplan 0144 T7; 0131 §6, group R1, step 3).
 *
 * `Login.tsx` had no link of its own to the request page (the page carried only
 * the status link). The only way from the app to `/request-access` was on the
 * callback page, after a sign-in that worked and found no organisation.
 * Self-registration at the identity provider is on, so somebody given the app's
 * address registered there first, and only then learned that they had to ask
 * (0144 §1, the review's `journey-login-no-request-link`).
 *
 * So, under the sign-in button, one link, in the reader's language:
 *
 * - EN *"No account yet? Request access."*
 * - NL *"Nog geen account? Vraag toegang aan."*
 *
 * It goes to `/request-access?locale=<the reader's language>`. The request page
 * reads `?locale=` (#1137), and the locale it sends is the one the answer is
 * written in.
 *
 * ONLY WHERE THE BUTTON IS, IN ITS OWN BLOCK. A granted request is an
 * invitation (the grant in `apps/api/src/routes/access-requests.ts`), taken up
 * at the first sign-in only when the token says the issuer verified the address
 * (`claimRequestedMembership` in `apps/api/src/middleware/auth.ts`). A
 * deployment without an issuer shows the paste box instead of the button, a
 * seed token carries no such claim, and a request made there would lead
 * nowhere. So it gets no link. Nor does a page whose bundle has an issuer while
 * the API has none (`acceptsSeedToken: true`): the button is drawn there, but
 * nothing verifies what the issuer says about the address. And there is no link
 * while the page is still asking the API, or when it could not ask, because
 * there is no button then. So the cases hold the link inside the button's own
 * block, below the button and above the build stamp at the foot of the page.
 *
 * ONLY WHERE THE ROOM IS. `/login` and `/request-access` are both managed only:
 * each sits under `ManagedOnly` in `AppRoutes.tsx`, the way the route table
 * tells the editions apart. The appliance serves this bundle under `/ui` with no
 * login and no request page, and both addresses land on Review & confirm. So
 * this file renders the REAL route table, with the real sign-in page and the
 * real request page, and holds the pair together: on managed the link opens the
 * form, and on the appliance neither the link nor the form mounts. An issuer is
 * configured in every appliance case, which is the worst case.
 *
 * The edition is mocked through `services/edition`, the sanctioned seam; the
 * issuer through `services/oidc`, as `Login.unit.test.tsx` does.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { editionFlag, STAMP } = vi.hoisted(() => ({
  editionFlag: { selfhost: false },
  // The build stamp at the foot of the sign-in page, to place the link against.
  STAMP: 'v0.1.0-rc.1 · 72a78d4',
}));

vi.mock('../services/edition.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/edition.ts')>();
  return { ...actual, isSelfHost: () => editionFlag.selfhost };
});

// Which of the two sign-in paths the page renders (see Login.unit.test.tsx).
vi.mock('../services/oidc.ts', () => ({ oidcConfig: vi.fn(), beginSignIn: vi.fn() }));
vi.mock('../services/auth-mode.ts', () => ({ fetchAuthMode: vi.fn() }));
// The sign-in page carries the build stamp, which asks the server what it runs.
vi.mock('../services/build-identity.ts', () => ({
  uiBuild: () => ({ version: '0.1.0-rc.1', commit: '72a78d4' }),
  fetchServerBuild: () => Promise.resolve(null),
  describeBuild: () => STAMP,
  shortCommit: (c: string) => c.slice(0, 7),
}));
// The appliance's landing, as a marker: the route table is what is under test,
// not the screen, and not the layout around it.
vi.mock('./Confirm.tsx', () => ({ default: () => <div>screen:confirm</div> }));
vi.mock('../components/Layout.tsx', async () => {
  const { Outlet } = await import('react-router');
  return { default: () => <Outlet /> };
});

import AppRoutes from '../AppRoutes.tsx';
import { LocaleProvider } from '../i18n/index.tsx';
import { oidcConfig } from '../services/oidc.ts';
import { fetchAuthMode } from '../services/auth-mode.ts';

/** 0144 §3 T7's words, and the two pages' own, to find them by. */
const SAID = {
  en: {
    door: 'No account yet? Request access.',
    signIn: /^sign in$/i,
    formTitle: 'Request access',
  },
  nl: {
    door: 'Nog geen account? Vraag toegang aan.',
    signIn: /^aanmelden$/i,
    formTitle: 'Toegang aanvragen',
  },
} as const;

type Locale = keyof typeof SAID;
const LOCALES = Object.keys(SAID) as Locale[];

/** The app's own provider, reading the language this browser chose. */
const renderAt = (path: string, locale: Locale) => {
  window.localStorage.setItem('ownpace.locale', locale);
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
      <LocaleProvider>
        <MemoryRouter initialEntries={[path]}>
          <AppRoutes />
        </MemoryRouter>
      </LocaleProvider>
    </QueryClientProvider>,
  );
};

/** Every link on screen that leads to the request page, whatever it says. */
const doorsToTheRequestPage = () =>
  screen
    .queryAllByRole('link')
    .filter((a) => (a.getAttribute('href') ?? '').startsWith('/request-access'));

beforeEach(() => {
  editionFlag.selfhost = false;
  window.localStorage.clear();
  vi.mocked(oidcConfig).mockReturnValue({ issuer: 'https://id.example.test', clientId: 'web' });
  vi.mocked(fetchAuthMode).mockResolvedValue({ mode: 'managed', acceptsSeedToken: false });
});

afterEach(() => {
  window.localStorage.clear();
});

describe('a door under the sign-in button, in the reader’s language', () => {
  for (const locale of LOCALES) {
    it(`${locale}: links to /request-access?locale=${locale}, under the sign-in button`, async () => {
      renderAt('/login', locale);

      const button = await screen.findByRole('button', { name: SAID[locale].signIn });
      const door = screen.getByRole('link', { name: SAID[locale].door });
      expect(
        door.getAttribute('href'),
        'the link must carry the reader’s language, so the request page, and the\n' +
          'answer to the request, are in it',
      ).toBe(`/request-access?locale=${locale}`);
      // Containment and order, both: inside the button's block alone would let
      // a link above the button pass, and after it alone would let a link at
      // the foot of the page pass.
      expect(
        button.parentElement?.contains(door),
        'the link belongs in the sign-in button’s own block (0144 §3 T7), not\n' +
          'elsewhere on the page',
      ).toBe(true);
      expect(
        button.compareDocumentPosition(door) & Node.DOCUMENT_POSITION_FOLLOWING,
        'the link belongs under the sign-in button (0144 §3 T7), not above it',
      ).toBeTruthy();
      expect(
        door.compareDocumentPosition(screen.getByText(STAMP)) & Node.DOCUMENT_POSITION_FOLLOWING,
        'the link belongs under the sign-in button, not at the foot of the page by\n' +
          'the build stamp',
      ).toBeTruthy();
      expect(doorsToTheRequestPage(), 'one link, not two').toHaveLength(1);
    });

    it(`${locale}: following it opens the request form, in the same language`, async () => {
      const user = userEvent.setup();
      renderAt('/login', locale);

      await user.click(await screen.findByRole('link', { name: SAID[locale].door }));

      expect(
        await screen.findByRole('heading', { name: SAID[locale].formTitle }),
        'the door leads to a room that exists on this edition',
      ).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: SAID[locale].signIn })).toBeNull();
    });
  }
});

describe('only where the sign-in button is', () => {
  it('a deployment without an issuer shows the paste box and no link', async () => {
    // The seed-token stack. A granted request is claimed at the first
    // sign-in, against an address the issuer verified; here there is none.
    vi.mocked(oidcConfig).mockReturnValue(null);
    vi.mocked(fetchAuthMode).mockResolvedValue({ mode: 'local', acceptsSeedToken: true });
    renderAt('/login', 'en');

    expect(await screen.findByLabelText(/access token/i)).toBeVisible();
    expect(doorsToTheRequestPage()).toEqual([]);
  });

  it('a bundle with an issuer and an API without one shows the button and the paste box, and no link', async () => {
    // The mismatch: this build can start a sign-in at the issuer, and the API
    // has none (`acceptsSeedToken: true`), so nothing there verifies what the
    // issuer says about the address, and a granted request is never taken up.
    vi.mocked(fetchAuthMode).mockResolvedValue({ mode: 'local', acceptsSeedToken: true });
    renderAt('/login', 'en');

    expect(await screen.findByRole('button', { name: SAID.en.signIn })).toBeVisible();
    expect(screen.getByText('Sign in with a token instead')).toBeVisible();
    expect(
      doorsToTheRequestPage(),
      'a request made here could never be taken up: the API has no issuer',
    ).toEqual([]);
  });

  it('no link while the page is still asking the API what it accepts', async () => {
    vi.mocked(fetchAuthMode).mockReturnValue(new Promise(() => {}));
    renderAt('/login', 'en');

    expect(await screen.findByText(/checking how this deployment/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: SAID.en.signIn })).toBeNull();
    expect(doorsToTheRequestPage(), 'no button yet, so no link under it').toEqual([]);
  });

  it('no link when the page could not ask the API', async () => {
    vi.mocked(fetchAuthMode).mockRejectedValue(new Error('down'));
    renderAt('/login', 'en');

    expect(await screen.findByText(/we could not ask this deployment/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: SAID.en.signIn })).toBeNull();
    expect(doorsToTheRequestPage(), 'no button, so no link under it').toEqual([]);
  });
});

describe('only where the request page is: never on the appliance', () => {
  for (const locale of LOCALES) {
    it(`${locale}: /login lands on Review & confirm, with no link to /request-access`, async () => {
      editionFlag.selfhost = true;
      renderAt('/login', locale);

      expect(await screen.findByText('screen:confirm')).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: SAID[locale].door })).toBeNull();
      expect(doorsToTheRequestPage()).toEqual([]);
    });

    it(`${locale}: /request-access lands on Review & confirm, and the form never mounts`, async () => {
      editionFlag.selfhost = true;
      renderAt(`/request-access?locale=${locale}`, locale);

      expect(await screen.findByText('screen:confirm')).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: SAID[locale].formTitle })).toBeNull();
    });
  }
});
