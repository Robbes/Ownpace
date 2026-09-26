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
 * What is pinned, in English and in Dutch:
 *
 * - **A refusal is an alert.** The wizard's refused create (the generic
 *   failure and the duplicate), and a refused consent in both doors: the
 *   wizard's source step and the panel the Connections page draws.
 * - **A received consent is a status, not an alert.** It is good news, said
 *   politely (0145 §3 T4).
 * - **One announcement per failure** (`Login.tsx`:73 says why). `getByRole`
 *   finds exactly one alert, and neither line sits inside another live region,
 *   where a screen reader would read it twice.
 * - **A new note is a new element.** When a consent lands after a refusal,
 *   the refusal's element goes and a status element takes its place. Changing
 *   the role of the node already on the page is not reliably announced, so the
 *   test holds the refusal's node and checks that it has left the page.
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
import { credentialFieldsFor } from '@openmig/shared';
import { LocaleProvider } from '../i18n/index.tsx';
import { STRINGS } from '../i18n/strings.ts';

const { create, googleAuthorize, add, clients } = vi.hoisted(() => ({
  create: vi.fn(),
  googleAuthorize: vi.fn(),
  add: vi.fn(),
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
    list: vi.fn().mockResolvedValue([]),
    add,
    rotate: vi.fn(),
    test: vi.fn(),
  },
  providerAccountsApi: { get: vi.fn().mockResolvedValue({}) },
  providerClientsApi: { get: clients },
  setupApi: { get: vi.fn(), setStep: vi.fn() },
}));

import CreateMapping from './CreateMapping.tsx';
import { ProviderConsentPanel, useProviderConsent } from '../components/ProviderConsent.tsx';

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

const LIVE = new Set(['alert', 'status', 'log', 'marquee', 'timer']);

/**
 * The nearest ANCESTOR that is itself a live region, or null. A line inside
 * one is announced by both, which is the double announcement `Login.tsx`:73
 * warns about.
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
  const status = screen.queryAllByRole('status').find((el) => el.textContent?.includes(text));
  expect(status, `no role="status" says "${text}"`).toBeDefined();
  expect(liveAncestor(status!), 'the status sits inside another live region and is read twice').toBeNull();
  return status!;
};

/** The popup's answer, over the same postMessage both doors listen for. */
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

/** The Connections page's consent, without the page around it. */
const Panel: React.FC = () => {
  const consent = useProviderConsent({
    role: 'source',
    type: 'gmail',
    fields: credentialFieldsFor('source', 'gmail'),
    values: { username: 'owner@example.invalid' },
    onToken: () => {},
    refusalText: (e) => (e instanceof Error ? e.message : String(e)),
  });
  return <ProviderConsentPanel consent={consent} />;
};

/** Fill only what each wizard step renders, and arrive at the review step. */
const walkToReview = (locale: Locale) => {
  const next = () => screen.getByRole('button', { name: words(locale, 'wizard.next') });
  // Source: an IMAP account, the wizard's first card.
  fireEvent.change(screen.getByPlaceholderText('imap.example.com'), {
    target: { value: 'mail.old-provider.example' },
  });
  fireEvent.change(screen.getAllByPlaceholderText('user@example.com')[0]!, {
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
  fireEvent.change(screen.getAllByPlaceholderText('user@example.com')[0]!, {
    target: { value: 'target@acme.example' },
  });
  fireEvent.change(document.querySelectorAll('input[type="password"]')[0]!, {
    target: { value: 'target-password' },
  });
  fireEvent.click(next());
  // The migration: a name; email is preselected.
  fireEvent.change(screen.getByPlaceholderText('My Migration'), { target: { value: 'Acme mail' } });
  fireEvent.click(next());
  return screen.getByRole('button', { name: words(locale, 'wizard.create') });
};

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.sessionStorage.clear();
  // The deployment carries Google's application: Connect needs only the address.
  clients.mockResolvedValue({ google: 'deployment', dropbox: 'deployment', microsoft: 'deployment' });
  add.mockResolvedValue({ ok: true, id: 'conn-google', detail: 'reachable' });
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
        wrap(locale, <CreateMapping />, '/mappings/new', '/mappings/new');
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
        wrap(locale, <CreateMapping />, '/mappings/new', '/mappings/new');
        fireEvent.click(walkToReview(locale));
        await screen.findByText(words(locale, 'createMapping.duplicate.lead'));
        const alert = theAlert(words(locale, 'createMapping.duplicate.lead'));
        expect(alert).toHaveTextContent('Acme mail');
      });

      it('the wizard: a refused consent is one alert; a consent that lands is a status, in a new element', async () => {
        googleAuthorize.mockRejectedValue(
          refusal(400, { error: 'Validation error', message: 'Google refused to start a consent.' }),
        );
        // A landed consent saves and tests the connection at once, and a saved
        // connection takes the consent block (and this line) off the step. The
        // line says it is saving and testing, so it is read while that runs:
        // held pending here.
        add.mockReturnValue(new Promise(() => {}));
        wrap(locale, <CreateMapping />, '/mappings/new', '/mappings/new');
        fireEvent.click(screen.getByRole('button', { name: /^Gmail/ }));
        fireEvent.change(screen.getByPlaceholderText('user@example.com'), {
          target: { value: 'owner@gmail.com' },
        });
        const connect = screen.getByRole('button', { name: words(locale, 'wizard.google.connect') });
        await waitFor(() => expect(connect).toBeEnabled());
        expect(screen.queryByRole('alert'), 'an alert before anything was pressed').toBeNull();

        fireEvent.click(connect);
        await screen.findByText('Google refused to start a consent.');
        const refused = theAlert('Google refused to start a consent.');

        await consentLands();
        const received = words(locale, 'wizard.consent.received');
        await screen.findByText(received);
        const status = theStatus(received);
        expect(screen.queryByRole('alert'), 'good news announced as an alert').toBeNull();
        expect(refused, 'the refusal’s element changed its role in place').not.toBeInTheDocument();
        expect(status).not.toBe(refused);
      });

      it('the Connections panel: a refused consent is one alert; a consent that lands is a status, in a new element', async () => {
        googleAuthorize.mockRejectedValue(new Error('Google refused to start a consent.'));
        wrap(locale, <Panel />, '/connections', '/connections');
        const connect = await screen.findByRole('button', { name: words(locale, 'wizard.google.connect') });
        await waitFor(() => expect(connect).toBeEnabled());
        expect(screen.queryByRole('alert'), 'an alert before anything was pressed').toBeNull();

        fireEvent.click(connect);
        await screen.findByText('Google refused to start a consent.');
        const refused = theAlert('Google refused to start a consent.');

        await consentLands();
        const received = words(locale, 'wizard.consent.received');
        await screen.findByText(received);
        const status = theStatus(received);
        expect(screen.queryByRole('alert'), 'good news announced as an alert').toBeNull();
        expect(refused, 'the refusal’s element changed its role in place').not.toBeInTheDocument();
        expect(status).not.toBe(refused);
      });

      it('the Connections panel: a second refusal after a first is announced again, as a new alert', async () => {
        // Pressed twice and refused twice: the second press clears the note
        // before it asks, so the alert leaves the page and comes back, which
        // is what makes a screen reader say it again.
        googleAuthorize.mockRejectedValue(new Error('Google refused to start a consent.'));
        wrap(locale, <Panel />, '/connections', '/connections');
        const connect = await screen.findByRole('button', { name: words(locale, 'wizard.google.connect') });
        await waitFor(() => expect(connect).toBeEnabled());

        fireEvent.click(connect);
        await screen.findByText('Google refused to start a consent.');
        const first = theAlert('Google refused to start a consent.');
        fireEvent.click(connect);
        await waitFor(() => expect(googleAuthorize).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(first).not.toBeInTheDocument());
        await screen.findByText('Google refused to start a consent.');
        expect(theAlert('Google refused to start a consent.')).not.toBe(first);
      });
    });
  }
});
