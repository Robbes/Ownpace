// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A CONSENT WINDOW OPENED BY THE PRESS (workplan 0145 T5).
 *
 * A browser lets a page open a window only as the direct result of a press,
 * and only for a short while after it. Both doors that run a consent (the
 * Connections page's panel and the wizard's source step) used to ask our own
 * server for the provider's address first and open the window after that
 * answer arrived. Desktop Chrome still counted the press; Safari on an iPhone
 * is reported not to, and then blocks the window without a word. Nothing
 * checked whether a window opened, so a blocked one looked like a button that
 * did nothing.
 *
 * What is pinned, in both doors, in English and in Dutch:
 *
 * - **The window opens in the press.** `window.open` is called before the
 *   server has answered (`begin` held pending), with no address yet, and the
 *   window is sent to the provider once the address arrives. No second window
 *   is opened for it.
 * - **A refused ask closes the blank window**, and the refusal shows as it did.
 * - **A window that did not open says so.** With `window.open` answering
 *   `null`, the door shows the plan's sentence and a link to the consent
 *   address. The link opens the same named window and keeps its opener
 *   (`rel="opener"`), so the ending can still hand the result back. It is a
 *   status, so a screen reader hears it. It goes when the consent lands, when
 *   the door asks again, and when the door is shown again without a new press
 *   (Cancel and *Add a connection*, the *Reconnect* fold closed and opened,
 *   the wizard's card switched away and back, Next and Back), as T4's note
 *   does. A link kept past a card switch would name one provider and open
 *   another's page.
 * - **A window closed before the address arrived** counts as not opened, and
 *   gets the same sentence and link (a departure from §3, recorded in 0145's
 *   Status).
 * - **The link lives as long as its consent.** The server forgets a consent
 *   `CONSENT_STATE_TTL_MS` after it began, and a tap after that ends on its
 *   English *"expired"* refusal. So once the press is that old, the link gives
 *   way to a sentence asking for a new press: when the timer runs, and when a
 *   tap comes first because a phone that slept ran the timer late. The count
 *   starts at the press, which comes before the server began the consent, so
 *   a slow answer does not stretch the link's life past it. A new press
 *   brings a new link.
 * - **One helper.** No `.ts` or `.tsx` under `apps/web/src` but
 *   `services/consent-window.ts` calls `window.open(` (or `globalThis.open(`,
 *   `self.open(`), so a third copy of the opening cannot come back beside the
 *   two this change folded into it. Test files (`*.test.ts`, `*.test.tsx`)
 *   are not scanned: they spy on the call, they do not open windows.
 *
 * jsdom has no windows, so `window.open` is spied: a blank window is a small
 * object with a `location`, `closed` and `close`, which is all the helper
 * touches.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent, act, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router';
import { AxiosError, AxiosHeaders } from 'axios';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LocaleProvider } from '../i18n/index.tsx';
import { STRINGS } from '../i18n/strings.ts';
import type { ConnectionSummary } from '../services/mapping-service.ts';
import { CONSENT_STATE_TTL_MS } from '@openmig/shared';

const { googleAuthorize, add, list, clients } = vi.hoisted(() => ({
  googleAuthorize: vi.fn(),
  add: vi.fn(),
  list: vi.fn(),
  clients: vi.fn(),
}));

vi.mock('../services/mapping-service', () => ({
  mappingApi: {
    create: vi.fn(),
    googleAuthorize,
    dropboxAuthorize: vi.fn(),
    microsoftAuthorize: vi.fn(),
    listSharedDrives: vi.fn(),
    listSharedFolders: vi.fn(),
    listDropboxSharedFolders: vi.fn(),
  },
  connectionsApi: {
    list,
    add,
    rotate: vi.fn(),
    test: vi.fn(),
    remove: vi.fn(),
  },
  providerAccountsApi: { get: vi.fn().mockResolvedValue({}) },
  providerClientsApi: { get: clients },
  setupApi: { get: vi.fn(), setStep: vi.fn() },
}));

import CreateMapping from '../pages/CreateMapping.tsx';
import Connections from '../pages/Connections.tsx';

type Locale = 'en' | 'nl';
const LOCALES: ReadonlyArray<Locale> = ['en', 'nl'];

/** A key read without the compiler's help, so a missing string fails here, not in tsc. */
const words = (locale: Locale, key: string): string => {
  const s = (STRINGS[locale] as Record<string, string>)[key];
  expect(s, `${locale} has no '${key}'`).toBeTruthy();
  return s as string;
};

/**
 * §3's sentences, word for word, filled in for Google. The English apostrophe
 * is the dictionary's typographic one (’) where §3 has a straight one, a
 * departure recorded in 0145's Status. The owner reads the Dutch before it
 * ships (0144 D1); if the reading changes it, this table changes with the
 * dictionary.
 */
const SENTENCE: Readonly<Record<Locale, string>> = {
  en: 'Your browser did not open Google’s page. Open it with this link:',
  nl: 'Uw browser heeft de pagina van Google niet geopend. Open die met deze link:',
};
const blockedSentence = (locale: Locale): string =>
  words(locale, 'wizard.consent.windowBlocked').replace('{provider}', 'Google');

/**
 * What takes the link's place once its consent has expired, filled in for
 * Google. Not §3's: new Dutch for the owner's reading (0144 D1).
 */
const EXPIRED: Readonly<Record<Locale, string>> = {
  en: 'The link to Google’s page has expired. Press Connect with Google again.',
  nl: 'De link naar de pagina van Google is verlopen. Druk opnieuw op Verbinden met Google.',
};

/** Where the server sends the window: the provider's consent screen. */
const CONSENT_URL = 'https://accounts.google.example/o/oauth2/v2/auth?client_id=x&state=s';
const WINDOW_NAME = 'ownpace-google-consent';

/** An axios-shaped refusal, the way the real apiClient delivers one. */
const refusal = (status: number, data: unknown): AxiosError => {
  const err = new AxiosError(`Request failed with status code ${status}`);
  err.response = {
    status,
    statusText: 'Refused',
    headers: {},
    config: { headers: new AxiosHeaders() },
    data,
  };
  return err;
};
const REFUSED = 'Google refused to start a consent.';
const consentRefused = (): AxiosError => refusal(400, { error: 'Validation error', message: REFUSED });

/** A blank window the browser opened: where it was sent, and whether it was closed. */
interface BlankWindow {
  location: { href: string };
  closed: boolean;
  close: ReturnType<typeof vi.fn>;
}
const aBlankWindow = (): BlankWindow => {
  const w: BlankWindow = {
    location: { href: 'about:blank' },
    closed: false,
    close: vi.fn(() => {
      w.closed = true;
    }),
  };
  return w;
};

/** `begin` held pending, as the network holds it, until the test answers. */
const heldAnswer = () => {
  let answer: (value: { url: string; redirectUri?: string }) => void = () => {};
  let refuse: (err: unknown) => void = () => {};
  googleAuthorize.mockReturnValue(
    new Promise((resolve, reject) => {
      answer = resolve;
      refuse = reject;
    }),
  );
  return {
    answer: async () => {
      await act(async () => answer({ url: CONSENT_URL }));
    },
    refuse: async () => {
      await act(async () => refuse(consentRefused()));
    },
  };
};

const LIVE = new Set(['alert', 'status', 'log', 'marquee', 'timer']);
const liveAncestor = (el: HTMLElement): HTMLElement | null => {
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (LIVE.has(p.getAttribute('role') ?? '')) return p;
    const live = p.getAttribute('aria-live');
    if (live !== null && live !== 'off') return p;
  }
  return null;
};

/** The status holding the blocked-window sentence, or undefined. */
const blockedLine = (locale: Locale): HTMLElement | undefined =>
  screen.queryAllByRole('status').find((el) => el.textContent?.includes(SENTENCE[locale]));

/** The status saying the link has expired, or undefined. */
const expiredLine = (locale: Locale): HTMLElement | undefined =>
  screen.queryAllByRole('status').find((el) => el.textContent?.includes(EXPIRED[locale]));

/** The popup's answer, over the same postMessage every door listens for. */
const consentLands = async () => {
  await act(async () => {
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        data: { type: 'ownpace-google-consent', refreshToken: '1//landed' },
      }),
    );
  });
};

function wrap(locale: Locale, node: React.ReactNode, path: string) {
  globalThis.localStorage.setItem('ownpace.locale', locale);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <LocaleProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path={path} element={node} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </LocaleProvider>,
  );
}

/** Each door, brought to a live *Connect with Google* for a Gmail source. */
const DOORS: ReadonlyArray<{ readonly name: string; readonly open: (locale: Locale) => Promise<HTMLElement> }> = [
  {
    name: 'the Connections page’s panel',
    open: async (locale) => {
      wrap(locale, <Connections />, '/connections');
      fireEvent.click(await screen.findByRole('button', { name: words(locale, 'connections.add') }));
      return pickGmail(locale);
    },
  },
  {
    name: 'the wizard’s source step',
    open: async (locale) => {
      wrap(locale, <CreateMapping />, '/mappings/new');
      return pickGmail(locale);
    },
  },
];

const pickGmail = async (locale: Locale): Promise<HTMLElement> => {
  fireEvent.click(screen.getByRole('button', { name: /^Gmail/ }));
  fireEvent.change(screen.getByPlaceholderText('someone@example.com'), {
    target: { value: 'owner@gmail.com' },
  });
  return liveConnect(locale);
};

/** *Connect with Google* once it is live. */
const liveConnect = async (locale: Locale): Promise<HTMLElement> => {
  const connect = await screen.findByRole('button', { name: words(locale, 'wizard.google.connect') });
  await waitFor(() => expect(connect).toBeEnabled());
  return connect;
};

/** Press Connect with the browser opening no window, and wait for the link. */
const pressBlocked = async (locale: Locale, connect: HTMLElement): Promise<void> => {
  open.mockReturnValue(null);
  googleAuthorize.mockResolvedValue({ url: CONSENT_URL });
  fireEvent.click(connect);
  await waitFor(() => expect(blockedLine(locale), `no role="status" says "${SENTENCE[locale]}"`).toBeDefined());
};

/** The Connections page's *Add a connection* button, which opens the form. */
const addConnection = async (locale: Locale): Promise<void> => {
  fireEvent.click(await screen.findByRole('button', { name: words(locale, 'connections.add') }));
};

/** A Gmail connection the page lists, whose row offers *Reconnect*. */
const gmailRow: ConnectionSummary = {
  id: 'conn-gmail',
  role: 'source',
  kind: 'gmail',
  displayName: 'Owner mail',
  status: 'error',
  createdAt: '2026-08-01T10:00:00Z',
  usedByMigrations: 1,
  knownValues: { username: 'owner@gmail.com' },
};
const reconnect = async (locale: Locale): Promise<void> => {
  fireEvent.click(await screen.findByRole('button', { name: words(locale, 'connections.reconnect') }));
};

/** No link to the consent address anywhere on the page, under any sentence. */
const noConsentLink = (): void => {
  expect(
    screen.queryAllByRole('link').filter((a) => a.getAttribute('href') === CONSENT_URL),
    'a link to the last consent’s address is still offered',
  ).toEqual([]);
};

let open: MockInstance<typeof window.open>;

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.sessionStorage.clear();
  // The deployment carries Google's application: Connect needs only the address.
  clients.mockResolvedValue({ google: 'deployment', dropbox: 'deployment', microsoft: 'deployment' });
  list.mockResolvedValue([]);
  // A landed consent saves and tests at once; held, so the block stays drawn.
  add.mockReturnValue(new Promise(() => {}));
  open = vi.spyOn(window, 'open');
});
afterEach(() => {
  open.mockRestore();
  cleanup();
  globalThis.localStorage.removeItem('ownpace.locale');
});

describe('a consent window opened by the press (0145 T5)', () => {
  for (const locale of LOCALES) {
    describe(locale, () => {
      it('says §3’s sentence, word for word', () => {
        expect(blockedSentence(locale)).toBe(SENTENCE[locale]);
      });

      for (const door of DOORS) {
        describe(door.name, () => {
          it('opens the window in the press, before the server has answered, then sends it to the provider', async () => {
            const blank = aBlankWindow();
            open.mockReturnValue(blank as unknown as Window);
            const connect = await door.open(locale);
            const server = heldAnswer();

            fireEvent.click(connect);
            expect(googleAuthorize).toHaveBeenCalledTimes(1);
            expect(
              open,
              'no window was opened while the ask was still on its way: it opens after an await, ' +
                'where Safari no longer counts the press',
            ).toHaveBeenCalledTimes(1);
            expect(open.mock.calls[0]?.[0], 'opened with an address it could not have known yet').toBe('');
            expect(open.mock.calls[0]?.[1]).toBe(WINDOW_NAME);
            expect(String(open.mock.calls[0]?.[2])).toContain('popup');
            expect(blank.location.href).toBe('about:blank');

            await server.answer();
            expect(blank.location.href, 'the blank window was never sent to the provider').toBe(CONSENT_URL);
            expect(open, 'a second window was opened for the address').toHaveBeenCalledTimes(1);
            expect(blank.close).not.toHaveBeenCalled();
            expect(blockedLine(locale), 'a window that opened is not a blocked one').toBeUndefined();
          });

          it('closes the blank window when the server refuses, and shows the refusal as before', async () => {
            const blank = aBlankWindow();
            open.mockReturnValue(blank as unknown as Window);
            const connect = await door.open(locale);
            const server = heldAnswer();

            fireEvent.click(connect);
            expect(open).toHaveBeenCalledTimes(1);
            await server.refuse();
            await screen.findByText(REFUSED);
            expect(screen.getByRole('alert')).toHaveTextContent(REFUSED);
            expect(blank.close, 'the blank window was left open over nothing').toHaveBeenCalled();
            expect(blank.location.href).toBe('about:blank');
            expect(blockedLine(locale)).toBeUndefined();
          });

          it('says so when the browser opened no window, with a link that keeps its opener', async () => {
            open.mockReturnValue(null);
            const connect = await door.open(locale);
            const server = heldAnswer();

            fireEvent.click(connect);
            expect(open).toHaveBeenCalledTimes(1);
            expect(blockedLine(locale), 'the sentence before the address was known').toBeUndefined();
            await server.answer();

            const line = await waitFor(() => {
              const found = blockedLine(locale);
              expect(found, `no role="status" says "${SENTENCE[locale]}"`).toBeDefined();
              return found!;
            });
            expect(liveAncestor(line), 'the line sits inside another live region and is read twice').toBeNull();
            const link = within(line).getByRole('link');
            expect(link).toHaveAttribute('href', CONSENT_URL);
            expect(link, 'a named window, not _blank, so the ending can find its opener').toHaveAttribute(
              'target',
              WINDOW_NAME,
            );
            expect((link.getAttribute('rel') ?? '').split(/\s+/)).toContain('opener');
            expect((link.getAttribute('rel') ?? '').split(/\s+/)).not.toContain('noopener');
            expect(link.textContent?.trim(), 'a link with no words to read').toBeTruthy();
            expect(open, 'no second window was tried after the await').toHaveBeenCalledTimes(1);

            // The consent lands through the link: the sentence has done its job.
            await consentLands();
            await screen.findByText(words(locale, 'wizard.consent.received'));
            expect(blockedLine(locale), 'the blocked line stayed after the consent landed').toBeUndefined();
          });

          it('treats a window closed before the address arrived as one that did not open', async () => {
            const blank = aBlankWindow();
            open.mockReturnValue(blank as unknown as Window);
            const connect = await door.open(locale);
            const server = heldAnswer();

            fireEvent.click(connect);
            blank.closed = true;
            await server.answer();
            const line = await waitFor(() => {
              const found = blockedLine(locale);
              expect(found).toBeDefined();
              return found!;
            });
            expect(within(line).getByRole('link')).toHaveAttribute('href', CONSENT_URL);
          });

          it('takes the old link away when it is pressed again', async () => {
            open.mockReturnValue(null);
            const connect = await door.open(locale);
            googleAuthorize.mockResolvedValue({ url: CONSENT_URL });
            fireEvent.click(connect);
            await waitFor(() => expect(blockedLine(locale)).toBeDefined());

            const blank = aBlankWindow();
            open.mockReturnValue(blank as unknown as Window);
            const server = heldAnswer();
            fireEvent.click(connect);
            expect(blockedLine(locale), 'the last press’s link is still offered for this one').toBeUndefined();
            await server.answer();
            expect(blank.location.href).toBe(CONSENT_URL);
            expect(blockedLine(locale)).toBeUndefined();
          });

          // THE LINK LIVES AS LONG AS ITS CONSENT: past the server's
          // CONSENT_STATE_TTL_MS a tap ends on its English "expired" refusal.
          // The clock runs with real time, so the door's own waits still work.
          describe('a link that lives as long as its consent', () => {
            beforeEach(() => {
              vi.useFakeTimers({ shouldAdvanceTime: true });
            });
            afterEach(() => {
              vi.useRealTimers();
            });

            it('gives way to a new press once the consent has expired', async () => {
              await pressBlocked(locale, await door.open(locale));
              await act(async () => {
                await vi.advanceTimersByTimeAsync(CONSENT_STATE_TTL_MS - 1000);
              });
              expect(blockedLine(locale), 'the link went before its consent expired').toBeDefined();
              expect(expiredLine(locale)).toBeUndefined();

              await act(async () => {
                await vi.advanceTimersByTimeAsync(1000);
              });
              expect(blockedLine(locale), 'a link to an expired consent is still offered').toBeUndefined();
              noConsentLink();
              expect(expiredLine(locale), `no role="status" says "${EXPIRED[locale]}"`).toBeDefined();

              // A new press is a new consent, with a link of its own.
              await pressBlocked(locale, await liveConnect(locale));
              expect(expiredLine(locale), 'the old expiry hid the new press’s link').toBeUndefined();
            });

            it('counts its life from the press, not from the server’s answer', async () => {
              open.mockReturnValue(null);
              const connect = await door.open(locale);
              const server = heldAnswer();
              // The door reads the clock in the same synchronous press.
              const pressedAt = Date.now();
              fireEvent.click(connect);
              // A slow network: the server answers five seconds after the press.
              await act(async () => {
                await vi.advanceTimersByTimeAsync(5000);
              });
              await server.answer();
              await waitFor(() => expect(blockedLine(locale)).toBeDefined());

              await act(async () => {
                await vi.advanceTimersByTimeAsync(pressedAt + CONSENT_STATE_TTL_MS - 1000 - Date.now());
              });
              expect(blockedLine(locale), 'the link went before its consent expired').toBeDefined();

              await act(async () => {
                await vi.advanceTimersByTimeAsync(pressedAt + CONSENT_STATE_TTL_MS - Date.now());
              });
              expect(
                blockedLine(locale),
                'the link outlived its press by the server’s answer time, and a tap now ends on "expired"',
              ).toBeUndefined();
              noConsentLink();
              expect(expiredLine(locale), `no role="status" says "${EXPIRED[locale]}"`).toBeDefined();
            });

            it('refuses a tap on an expired consent before the timer has run', async () => {
              await pressBlocked(locale, await door.open(locale));
              // A phone that slept: the clock moved on, the timer did not.
              vi.setSystemTime(Date.now() + CONSENT_STATE_TTL_MS);
              const link = within(blockedLine(locale)!).getByRole('link');
              expect(fireEvent.click(link), 'the tap went on to an expired consent').toBe(false);
              await waitFor(() => expect(expiredLine(locale)).toBeDefined());
              noConsentLink();
            });
          });
        });
      }

      // SHOWN AGAIN WITHOUT A NEW PRESS, the link is gone, as T4's note is
      // (`pages/an-error-that-is-announced.unit.test.tsx`). Each door keeps
      // the address in state that outlives what it draws; only the door's
      // reset takes it away.
      describe('shown again without a new press', () => {
        it('the Connections page’s panel: Cancel and Add a connection again take the old link away', async () => {
          wrap(locale, <Connections />, '/connections');
          await addConnection(locale);
          await pressBlocked(locale, await pickGmail(locale));

          // The form keeps what was typed when it is cancelled, but not the link.
          fireEvent.click(screen.getByRole('button', { name: words(locale, 'common.cancel') }));
          await waitFor(() => expect(blockedLine(locale)).toBeUndefined());
          await addConnection(locale);
          await liveConnect(locale);
          expect(blockedLine(locale), 'the old link came back with nothing pressed').toBeUndefined();
          noConsentLink();
          expect(googleAuthorize).toHaveBeenCalledTimes(1);
        });

        it('Reconnect: closing and opening the fold takes the old link away', async () => {
          list.mockResolvedValue([gmailRow]);
          wrap(locale, <Connections />, '/connections');
          await reconnect(locale);
          await pressBlocked(locale, await liveConnect(locale));

          await reconnect(locale); // closes the fold
          await waitFor(() => expect(blockedLine(locale)).toBeUndefined());
          await reconnect(locale); // and opens it again
          await liveConnect(locale);
          expect(blockedLine(locale), 'the old link came back with nothing pressed').toBeUndefined();
          noConsentLink();
          expect(googleAuthorize).toHaveBeenCalledTimes(1);
        });

        it('the wizard: switching the card away and back takes the old link away', async () => {
          wrap(locale, <CreateMapping />, '/mappings/new');
          await pressBlocked(locale, await pickGmail(locale));

          // Away to another provider's consent first: Google's address under
          // Dropbox's name is the harm, a link that opens the wrong company.
          fireEvent.click(screen.getByRole('button', { name: /^Dropbox/ }));
          await waitFor(() => expect(blockedLine(locale)).toBeUndefined());
          noConsentLink();
          fireEvent.click(screen.getByRole('button', { name: /^IMAP/ }));
          fireEvent.click(screen.getByRole('button', { name: /^Gmail/ }));
          await liveConnect(locale);
          expect(blockedLine(locale), 'the old link came back with nothing pressed').toBeUndefined();
          noConsentLink();
          expect(googleAuthorize).toHaveBeenCalledTimes(1);
        });

        it('the wizard: Next and Back take the old link away', async () => {
          wrap(locale, <CreateMapping />, '/mappings/new');
          await pressBlocked(locale, await pickGmail(locale));

          // The token pasted by hand instead, as somebody holding one may.
          fireEvent.change(screen.getByPlaceholderText('1//…'), { target: { value: '1//pasted' } });
          const next = screen.getByRole('button', { name: words(locale, 'wizard.next') });
          await waitFor(() => expect(next).toBeEnabled());
          fireEvent.click(next);
          await waitFor(() => expect(blockedLine(locale)).toBeUndefined());
          fireEvent.click(screen.getByRole('button', { name: words(locale, 'wizard.back') }));
          await liveConnect(locale);
          expect(blockedLine(locale), 'the old link came back with nothing pressed').toBeUndefined();
          noConsentLink();
          expect(googleAuthorize).toHaveBeenCalledTimes(1);
        });
      });
    });
  }
});

describe('one helper opens every consent window (0145 T5)', () => {
  const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
  const HELPER = 'services/consent-window.ts';
  const OPEN = /\b(?:window|globalThis|self)\s*\.\s*open\s*\(/;

  const sourceFiles = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return sourceFiles(path);
      if (!/\.(?:ts|tsx)$/.test(name) || /\.test\.(?:ts|tsx)$/.test(name)) return [];
      return [path];
    });

  it('the helper exists and is the one that opens', () => {
    const helper = readFileSync(join(SRC, HELPER), 'utf8');
    expect(helper, `${HELPER} does not open the window`).toMatch(OPEN);
  });

  it('nothing else in apps/web/src opens a window', () => {
    const files = sourceFiles(SRC);
    expect(files.length, 'the scan found no source files, so it proves nothing').toBeGreaterThan(50);
    const openers = files
      .filter((path) => OPEN.test(readFileSync(path, 'utf8')))
      .map((path) => relative(SRC, path).split('\\').join('/'))
      .filter((rel) => rel !== HELPER);
    expect(
      openers,
      'these files open a window themselves; a consent window opens through ' +
        `${HELPER}, in the press, or a blocked window goes unsaid again (a comment ` +
        'naming the call counts too: say "the helper" instead)',
    ).toEqual([]);
  });
});
