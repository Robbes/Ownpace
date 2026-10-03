// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * AN ERROR THAT IS ANNOUNCED (workplan 0145 T4, the half outside the grant
 * flow).
 *
 * A screen reader says what is focused and what a live region says; it does
 * not read out text that simply appears somewhere else on the page. The
 * wizard's create failure and the consent notes under *Connect with …* were
 * plain text: a tester who could not see the screen pressed the button and
 * heard nothing, whether the server refused or the consent landed. Other
 * screens already carry `role="alert"` (`Login.tsx`, `RequestAccess.tsx`,
 * `ReportProblem.tsx` and more); these did not.
 *
 * What is pinned, in English and in Dutch, on the real pages: the wizard, and
 * the Connections page with both of its doors (*Add a connection* and a row's
 * *Reconnect*).
 *
 * - **A refusal is an alert.** The wizard's refused create (the generic
 *   failure and the duplicate), and a refused consent in every door.
 * - **A received consent is a status, not an alert.** It is good news, said
 *   politely (0145 §3 T4).
 * - **One alert per failure** (`Login.tsx`:73): `getByRole` finds exactly one.
 * - **Not inside another live region.** A live region inside another one can
 *   be announced by both, so the line would be heard twice. `liveAncestor`
 *   looks for one around each line, where the page draws it.
 * - **A new note is a new element.** When a consent lands after a refusal,
 *   the refusal's element goes and a status element takes its place. Changing
 *   the role of the node already on the page is not reliably announced, so the
 *   test holds the refusal's node and checks that it has left the page.
 * - **A second refusal is heard again.** Each door takes the old line off the
 *   page before it asks again, so the next answer is a new element.
 * - **An old note does not come back.** A line put on the page with its text
 *   already in it is announced as if it had just happened. So when a door is
 *   shown again without a new press (Cancel and *Add a connection*, the
 *   *Reconnect* fold closed and opened, the wizard's card switched away and
 *   back, Next and Back), the last answer is gone.
 *
 * The grant and view pages' refusals and waiting lines go in with T6, which
 * rewrites those pages; their cases join this file then.
 *
 * The wizard walk below is local. 0145 T3 (a) moves `walkToReview` out of
 * `CreateMapping.unit.test.tsx` into a shared file; once both have landed,
 * this one should use that.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router';
import { AxiosError, AxiosHeaders } from 'axios';
import { LocaleProvider } from '../i18n/index.tsx';
import { STRINGS } from '../i18n/strings.ts';
import type { ConnectionSummary } from '../services/mapping-service.ts';

const { create, googleAuthorize, add, list, clients } = vi.hoisted(() => ({
  create: vi.fn(),
  googleAuthorize: vi.fn(),
  add: vi.fn(),
  list: vi.fn(),
  clients: vi.fn(),
}));

vi.mock('../services/mapping-service', () => ({
  mappingApi: {
    create,
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

import CreateMapping from './CreateMapping.tsx';
import Connections from './Connections.tsx';

type Locale = 'en' | 'nl';
const LOCALES: ReadonlyArray<Locale> = ['en', 'nl'];

/** A key read without the compiler's help, so a missing string fails here, not in tsc. */
const words = (locale: Locale, key: string): string => {
  const s = (STRINGS[locale] as Record<string, string>)[key];
  expect(s, `${locale} has no '${key}'`).toBeTruthy();
  return s as string;
};

/** An axios-shaped refusal, the way the real apiClient delivers one: the sentence is in the body. */
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

/** The server's refusal to start a consent, in its own words, as every door shows it. */
const REFUSED = 'Google refused to start a consent.';
const consentRefused = (): AxiosError => refusal(400, { error: 'Validation error', message: REFUSED });

const LIVE = new Set(['alert', 'status', 'log', 'marquee', 'timer']);

/**
 * The nearest ANCESTOR that is itself a live region, or null. A live region
 * inside another live region can be announced by both, so the line is heard
 * twice.
 */
const liveAncestor = (el: HTMLElement): HTMLElement | null => {
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (LIVE.has(p.getAttribute('role') ?? '')) return p;
    const live = p.getAttribute('aria-live');
    if (live !== null && live !== 'off') return p;
  }
  return null;
};

/** The one alert on the page, announced once, saying `text`. */
const theAlert = (text: string | RegExp): HTMLElement => {
  const alert = screen.getByRole('alert');
  expect(alert).toHaveTextContent(text);
  expect(liveAncestor(alert), 'the alert sits inside another live region and is read twice').toBeNull();
  return alert;
};

/** The status saying `text`, announced once. There may be others: Next's reason is one. */
const theStatus = (text: string): HTMLElement => {
  const status = aStatus(text);
  expect(status, `no role="status" says "${text}"`).toBeDefined();
  expect(liveAncestor(status!), 'the status sits inside another live region and is read twice').toBeNull();
  return status!;
};
const aStatus = (text: string): HTMLElement | undefined =>
  screen.queryAllByRole('status').find((el) => el.textContent?.includes(text));

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

function wrap(locale: Locale, node: React.ReactNode, path: string, route: string) {
  globalThis.localStorage.setItem('ownpace.locale', locale);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <LocaleProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path={route} element={node} />
            <Route path="/mappings/:mappingId/confirm" element={<div>confirm-route</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </LocaleProvider>,
  );
}
const wizard = (locale: Locale) => wrap(locale, <CreateMapping />, '/mappings/new', '/mappings/new');
const connectionsPage = (locale: Locale) => wrap(locale, <Connections />, '/connections', '/connections');

/** The Connect button once it is live: the deployment carries Google's application. */
const liveConnect = async (locale: Locale): Promise<HTMLElement> => {
  const connect = await screen.findByRole('button', { name: words(locale, 'wizard.google.connect') });
  await waitFor(() => expect(connect).toBeEnabled());
  return connect;
};

/** Pick Gmail and type the address, in either door that has cards. */
const pickGmail = async (locale: Locale): Promise<HTMLElement> => {
  fireEvent.click(screen.getByRole('button', { name: /^Gmail/ }));
  fireEvent.change(screen.getByPlaceholderText('someone@example.com'), {
    target: { value: 'owner@gmail.com' },
  });
  return liveConnect(locale);
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

/** Fill only what each wizard step renders, and arrive at the review step. */
const walkToReview = (locale: Locale) => {
  const next = () => screen.getByRole('button', { name: words(locale, 'wizard.next') });
  // Source: an IMAP account, the wizard's first card.
  fireEvent.change(screen.getByPlaceholderText('imap.example.com'), {
    target: { value: 'mail.old-provider.example' },
  });
  fireEvent.change(screen.getAllByPlaceholderText('someone@example.com')[0]!, {
    target: { value: 'source@acme.example' },
  });
  fireEvent.change(document.querySelectorAll('input[type="password"]')[0]!, {
    target: { value: 'source-password' },
  });
  fireEvent.click(next());
  // Target: JMAP, preselected.
  fireEvent.change(screen.getByLabelText(new RegExp(`^${words(locale, 'wizard.host')}`)), {
    target: { value: 'stalwart.acme.example' },
  });
  fireEvent.change(screen.getAllByPlaceholderText('someone@example.com')[0]!, {
    target: { value: 'target@acme.example' },
  });
  fireEvent.change(document.querySelectorAll('input[type="password"]')[0]!, {
    target: { value: 'target-password' },
  });
  fireEvent.click(next());
  // The migration: a name; email is preselected.
  fireEvent.change(screen.getByPlaceholderText(words(locale, 'wizard.migrationName.placeholder')), { target: { value: 'Acme mail' } });
  fireEvent.click(next());
  return screen.getByRole('button', { name: words(locale, 'wizard.create') });
};

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.sessionStorage.clear();
  // The deployment carries Google's application: Connect needs only the address.
  clients.mockResolvedValue({ google: 'deployment', dropbox: 'deployment', microsoft: 'deployment' });
  add.mockResolvedValue({ ok: true, id: 'conn-google', detail: 'reachable' });
  list.mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  globalThis.localStorage.removeItem('ownpace.locale');
});

describe('an error that is announced (0145 T4)', () => {
  for (const locale of LOCALES) {
    describe(locale, () => {
      it('the wizard: a refused create is one alert, with the frame and the server’s words', async () => {
        create.mockRejectedValue(
          refusal(400, { error: 'Validation error', message: 'The server refused this in its own words.' }),
        );
        wizard(locale);
        const createButton = walkToReview(locale);
        fireEvent.click(createButton);
        await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
        await screen.findByText('The server refused this in its own words.');
        const alert = theAlert('The server refused this in its own words.');
        expect(alert).toHaveTextContent(words(locale, 'createMapping.createFailed'));

        // Pressed again and refused again. The alert leaves the page while the
        // second attempt is on its way (held here, as the network holds it),
        // so the second refusal is a new alert and is heard again.
        let refuseAgain: (err: unknown) => void = () => {};
        create.mockReturnValueOnce(new Promise((_, reject) => (refuseAgain = reject)));
        fireEvent.click(createButton);
        await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(alert).not.toBeInTheDocument());
        expect(screen.queryByRole('alert'), 'an alert while the second attempt is pending').toBeNull();
        await act(async () => {
          refuseAgain(
            refusal(400, { error: 'Validation error', message: 'The server refused this in its own words.' }),
          );
        });
        await screen.findByText('The server refused this in its own words.');
        expect(theAlert('The server refused this in its own words.')).not.toBe(alert);
      });

      it('the wizard: a refused create that is a duplicate is one alert too', async () => {
        create.mockRejectedValue(
          refusal(409, {
            error: 'duplicate_mapping',
            existingMappingId: 'm-1',
            existingMappingName: 'Acme mail',
          }),
        );
        wizard(locale);
        fireEvent.click(walkToReview(locale));
        await screen.findByText(words(locale, 'createMapping.duplicate.lead'));
        const alert = theAlert(words(locale, 'createMapping.duplicate.lead'));
        expect(alert).toHaveTextContent('Acme mail');
      });

      it('the wizard: a refused consent is one alert; a consent that lands is a status, in a new element', async () => {
        googleAuthorize.mockRejectedValue(consentRefused());
        // A landed consent saves and tests the connection at once, and a saved
        // connection takes the consent block (and this line) off the step. The
        // line says it is saving and testing, so it is read while that runs:
        // held pending here.
        add.mockReturnValue(new Promise(() => {}));
        wizard(locale);
        const connect = await pickGmail(locale);
        expect(screen.queryByRole('alert'), 'an alert before anything was pressed').toBeNull();

        fireEvent.click(connect);
        await screen.findByText(REFUSED);
        const refused = theAlert(REFUSED);

        await consentLands();
        const received = words(locale, 'wizard.consent.received');
        await screen.findByText(received);
        const status = theStatus(received);
        expect(screen.queryByRole('alert'), 'good news announced as an alert').toBeNull();
        expect(refused, 'the refusal’s element changed its role in place').not.toBeInTheDocument();
        expect(status).not.toBe(refused);
      });

      it('the wizard: a second refusal after a first is announced again, as a new alert', async () => {
        // The wizard has its own state and its own ask, apart from the
        // Connections page's. Pressed twice and refused twice: the line leaves
        // the page while the second ask is on its way.
        googleAuthorize.mockRejectedValue(consentRefused());
        wizard(locale);
        const connect = await pickGmail(locale);
        fireEvent.click(connect);
        await screen.findByText(REFUSED);
        const first = theAlert(REFUSED);

        let refuseAgain: (err: unknown) => void = () => {};
        googleAuthorize.mockReturnValueOnce(new Promise((_, reject) => (refuseAgain = reject)));
        fireEvent.click(connect);
        await waitFor(() => expect(googleAuthorize).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(first).not.toBeInTheDocument());
        expect(screen.queryByRole('alert'), 'an alert while the second ask is pending').toBeNull();
        await act(async () => {
          refuseAgain(consentRefused());
        });
        await screen.findByText(REFUSED);
        expect(theAlert(REFUSED)).not.toBe(first);
      });

      it('the wizard: switching the card away and back brings back neither an old refusal nor an old received line', async () => {
        googleAuthorize.mockRejectedValue(consentRefused());
        add.mockReturnValue(new Promise(() => {}));
        wizard(locale);
        fireEvent.click(await pickGmail(locale));
        await screen.findByText(REFUSED);
        theAlert(REFUSED);

        fireEvent.click(screen.getByRole('button', { name: /^IMAP/ }));
        await waitFor(() => expect(screen.queryByText(REFUSED)).toBeNull());
        fireEvent.click(screen.getByRole('button', { name: /^Gmail/ }));
        await liveConnect(locale);
        expect(screen.queryByRole('alert'), 'the old refusal came back as a new alert, with nothing pressed').toBeNull();
        expect(googleAuthorize).toHaveBeenCalledTimes(1);

        const received = words(locale, 'wizard.consent.received');
        await consentLands();
        await screen.findByText(received);
        theStatus(received);
        fireEvent.click(screen.getByRole('button', { name: /^IMAP/ }));
        await waitFor(() => expect(screen.queryByText(received)).toBeNull());
        fireEvent.click(screen.getByRole('button', { name: /^Gmail/ }));
        await liveConnect(locale);
        expect(aStatus(received), 'the old received line came back as a new status').toBeUndefined();
      });

      it('the wizard: a consent that landed and was saved, then “a new connection” picked, does not bring back the received line', async () => {
        // A landed consent saves the connection, and the saved row is picked,
        // which takes the consent block off the step. Picking "a new
        // connection" draws the block again, with nothing pressed.
        const saved: ConnectionSummary = { ...gmailRow, id: 'conn-google', status: 'connected' };
        add.mockImplementation(async () => {
          list.mockResolvedValue([saved]);
          return { ok: true, id: saved.id, detail: 'reachable' };
        });
        wizard(locale);
        await pickGmail(locale);
        const received = words(locale, 'wizard.consent.received');
        await consentLands();
        await waitFor(() => expect(add).toHaveBeenCalledTimes(1));
        const picker = await screen.findByLabelText(words(locale, 'wizard.reuseSource'));
        await waitFor(() => expect(picker).toHaveValue(saved.id));
        expect(screen.queryByText(received), 'the consent block is still on the step').toBeNull();

        fireEvent.change(picker, { target: { value: '' } });
        await liveConnect(locale);
        expect(aStatus(received), 'the old received line came back as a new status').toBeUndefined();
      });

      it('the wizard: Next and Back do not bring back an old refusal', async () => {
        googleAuthorize.mockRejectedValue(consentRefused());
        wizard(locale);
        fireEvent.click(await pickGmail(locale));
        await screen.findByText(REFUSED);
        theAlert(REFUSED);

        // The token pasted by hand instead, as somebody holding one may.
        fireEvent.change(screen.getByPlaceholderText('1//…'), { target: { value: '1//pasted' } });
        const next = screen.getByRole('button', { name: words(locale, 'wizard.next') });
        await waitFor(() => expect(next).toBeEnabled());
        fireEvent.click(next);
        await waitFor(() => expect(screen.queryByText(REFUSED)).toBeNull());
        fireEvent.click(screen.getByRole('button', { name: words(locale, 'wizard.back') }));
        await liveConnect(locale);
        expect(screen.queryByRole('alert'), 'the old refusal came back as a new alert, with nothing pressed').toBeNull();
      });

      it('Add a connection: a refused consent is one alert; a consent that lands is a status, in a new element', async () => {
        googleAuthorize.mockRejectedValue(consentRefused());
        connectionsPage(locale);
        await addConnection(locale);
        const connect = await pickGmail(locale);
        expect(screen.queryByRole('alert'), 'an alert before anything was pressed').toBeNull();

        fireEvent.click(connect);
        await screen.findByText(REFUSED);
        const refused = theAlert(REFUSED);

        await consentLands();
        const received = words(locale, 'wizard.consent.received');
        await screen.findByText(received);
        const status = theStatus(received);
        expect(screen.queryByRole('alert'), 'good news announced as an alert').toBeNull();
        expect(refused, 'the refusal’s element changed its role in place').not.toBeInTheDocument();
        expect(status).not.toBe(refused);
      });

      it('Add a connection: a second refusal after a first is announced again, as a new alert', async () => {
        // Pressed twice and refused twice: the second press clears the note
        // before it asks, so the alert leaves the page and comes back, which
        // is what makes a screen reader say it again.
        googleAuthorize.mockRejectedValue(consentRefused());
        connectionsPage(locale);
        await addConnection(locale);
        const connect = await pickGmail(locale);

        fireEvent.click(connect);
        await screen.findByText(REFUSED);
        const first = theAlert(REFUSED);
        fireEvent.click(connect);
        await waitFor(() => expect(googleAuthorize).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(first).not.toBeInTheDocument());
        await screen.findByText(REFUSED);
        expect(theAlert(REFUSED)).not.toBe(first);
      });

      it('Add a connection: opening the form again brings back neither an old refusal nor an old received line', async () => {
        googleAuthorize.mockRejectedValue(consentRefused());
        connectionsPage(locale);
        await addConnection(locale);
        fireEvent.click(await pickGmail(locale));
        await screen.findByText(REFUSED);
        theAlert(REFUSED);

        // Cancel, then Add a connection again: the form keeps what was typed,
        // and nothing was pressed since the refusal.
        fireEvent.click(screen.getByRole('button', { name: words(locale, 'common.cancel') }));
        await addConnection(locale);
        const connect = await liveConnect(locale);
        expect(screen.queryByRole('alert'), 'the old refusal came back as a new alert, with nothing pressed').toBeNull();
        expect(googleAuthorize).toHaveBeenCalledTimes(1);

        // The door still speaks: a new press, a new refusal, then the consent
        // lands, the connection is saved, and the form is closed and opened.
        fireEvent.click(connect);
        await screen.findByText(REFUSED);
        theAlert(REFUSED);
        const received = words(locale, 'wizard.consent.received');
        await consentLands();
        await screen.findByText(received);
        theStatus(received);
        await waitFor(() => expect(add).toHaveBeenCalledTimes(1));
        fireEvent.click(await screen.findByRole('button', { name: words(locale, 'common.close') }));
        await addConnection(locale);
        await liveConnect(locale);
        expect(aStatus(received), 'the old received line came back as a new status').toBeUndefined();
        expect(screen.queryByRole('alert')).toBeNull();
      });

      it('Reconnect: a refused consent is one alert; closing and opening the fold brings back neither it nor a received line', async () => {
        googleAuthorize.mockRejectedValue(consentRefused());
        list.mockResolvedValue([gmailRow]);
        connectionsPage(locale);
        await reconnect(locale);
        const connect = await liveConnect(locale);
        expect(screen.queryByRole('alert'), 'an alert before anything was pressed').toBeNull();
        fireEvent.click(connect);
        await screen.findByText(REFUSED);
        const refused = theAlert(REFUSED);

        await reconnect(locale); // closes the fold
        await waitFor(() => expect(refused).not.toBeInTheDocument());
        await reconnect(locale); // and opens it again
        const again = await liveConnect(locale);
        expect(screen.queryByRole('alert'), 'the old refusal came back as a new alert, with nothing pressed').toBeNull();
        expect(googleAuthorize).toHaveBeenCalledTimes(1);

        // The consent lands after a new refusal: a status, where the page draws it.
        fireEvent.click(again);
        await screen.findByText(REFUSED);
        theAlert(REFUSED);
        const received = words(locale, 'wizard.consent.received');
        await consentLands();
        await screen.findByText(received);
        theStatus(received);
        expect(screen.queryByRole('alert'), 'good news announced as an alert').toBeNull();

        await reconnect(locale);
        await waitFor(() => expect(screen.queryByText(received)).toBeNull());
        await reconnect(locale);
        await liveConnect(locale);
        expect(aStatus(received), 'the old received line came back as a new status').toBeUndefined();
      });
    });
  }
});
