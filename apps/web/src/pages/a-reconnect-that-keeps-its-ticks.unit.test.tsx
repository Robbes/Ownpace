// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A RECONNECT THAT KEEPS ITS TICKS (the owner, 2026-11-15).
 *
 * *Reconnect* on a Google account row opens the panel that mints a new token
 * for an existing connection, with the account's face ticks above *Connect
 * with Google*. The ticks started empty: `useProviderConsent` began a door's
 * own ticks from none, which is right for an account being added and wrong
 * for one being reconnected. The owner, reconnecting an account that already
 * carried its types, had to tick every one again.
 *
 * Now the panel starts from what the account carries: every face this
 * deployment serves but those the account's last Test measured as a no
 * (`qualification`, 0106 T2, read off the grant for a Google or Microsoft
 * account; the rule of 0106 T3a, where only a measured no constrains). So a
 * grant that carried calendars and contacts starts with exactly those, and no
 * record, or a grant the provider would not exchange, starts from every face
 * served. Opening or closing the panel puts the ticks back there.
 *
 * The least-privilege door is unchanged, and pinned here too: the ticks stay
 * on screen and can be unticked, the consent asks for exactly what is ticked,
 * and the add form on the same page still starts from none.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import {
  DISCOVERY_DOMAINS,
  GOOGLE_RESTRICTED_ACCOUNT_DOMAINS,
  PROVIDER_ACCOUNT_DOMAINS,
  QUALIFICATION_KEYS,
  credentialFieldsFor,
  type DiscoveryDomain,
  type QualificationKey,
} from '@openmig/shared';
import type { ConnectionSummary } from '../services/mapping-service.ts';
import { LocaleProvider } from '../i18n/index.tsx';
import { STRINGS } from '../i18n/strings.ts';

const { list, providerClients, providerAccounts, googleAuthorize, microsoftAuthorize } = vi.hoisted(() => ({
  list: vi.fn(),
  providerClients: vi.fn(),
  providerAccounts: vi.fn(),
  googleAuthorize: vi.fn(),
  microsoftAuthorize: vi.fn(),
}));

vi.mock('../services/mapping-service', () => ({
  connectionsApi: { list, test: vi.fn(), rotate: vi.fn(), remove: vi.fn(), add: vi.fn() },
  providerClientsApi: { get: providerClients },
  providerAccountsApi: { get: providerAccounts },
  mappingApi: { googleAuthorize, dropboxAuthorize: vi.fn(), microsoftAuthorize },
}));

import Connections from './Connections.tsx';
import { ProviderConsentPanel, useProviderConsent } from '../components/ProviderConsent.tsx';

type Locale = 'en' | 'nl';
type Answer = 'yes' | 'no' | 'unknown';
type QualificationRecord = NonNullable<ConnectionSummary['qualification']>;

/** A key read without the compiler's help, so a missing string fails here, not in tsc. */
const words = (locale: Locale, key: string): string => {
  const s = (STRINGS[locale] as { readonly [key: string]: string })[key];
  expect(s, `${locale} has no '${key}'`).toBeTruthy();
  return s as string;
};

/** A measured record, face by face, in the record's own words (`mail`, not `email`). */
const measured = (answers: Partial<{ readonly [face in QualificationKey]: Answer }>): QualificationRecord => {
  const domains: QualificationRecord['domains'] = {};
  for (const [face, answer] of Object.entries(answers) as Array<[QualificationKey, Answer]>) {
    domains[face] = { answer, detail: `${face}: ${answer}` };
  }
  return { domains };
};

/** A grant read in full, as the qualifier writes one: every face answered. */
const grant = (carried: ReadonlyArray<QualificationKey>, unanswered: ReadonlyArray<QualificationKey> = []) =>
  measured(
    Object.fromEntries(
      QUALIFICATION_KEYS.map((face) => [
        face,
        unanswered.includes(face) ? 'unknown' : carried.includes(face) ? 'yes' : 'no',
      ]),
    ),
  );

/** The sensitive tier: what Google's own table serves, and the managed default. */
const SENSITIVE: ReadonlyArray<DiscoveryDomain> = PROVIDER_ACCOUNT_DOMAINS.google;
/** A deployment whose own Google application carries the restricted scopes too. */
const RESTRICTED: ReadonlyArray<DiscoveryDomain> = GOOGLE_RESTRICTED_ACCOUNT_DOMAINS;

const GOOGLE_ROW = 'The family’s Google account';
const MICROSOFT_ROW = 'The family’s Microsoft 365 account';

const conn = (over: Partial<ConnectionSummary>): ConnectionSummary => ({
  id: 'c-google',
  role: 'source',
  kind: 'google',
  displayName: GOOGLE_ROW,
  status: 'error',
  createdAt: '2026-08-01T10:00:00Z',
  usedByMigrations: 1,
  knownValues: { username: 'someone@example.invalid' },
  ...over,
});

/** The deployment's answers: the applications it carries, and the faces each account serves. */
function deployment(google: ReadonlyArray<DiscoveryDomain>): void {
  providerClients.mockResolvedValue({ google: 'deployment', dropbox: 'deployment', microsoft: 'deployment' });
  providerAccounts.mockResolvedValue({
    google: { domains: [...google], client: 'deployment' },
    microsoft: { domains: [...PROVIDER_ACCOUNT_DOMAINS.microsoft], client: 'deployment' },
  });
}

function renderPage(locale: Locale = 'en') {
  globalThis.localStorage.setItem('ownpace.locale', locale);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <LocaleProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Connections />
        </MemoryRouter>
      </QueryClientProvider>
    </LocaleProvider>,
  );
}

/** A row's `<li>`, found by its name. */
const rowOf = async (name: string): Promise<HTMLElement> => {
  const row = (await screen.findByText(name)).closest('li');
  expect(row, `no row for ${name}`).not.toBeNull();
  return row as HTMLElement;
};

/** Press the row's Reconnect: it opens the panel, and closes it again. */
const pressReconnect = async (locale: Locale, name: string): Promise<void> => {
  fireEvent.click(within(await rowOf(name)).getByRole('button', { name: words(locale, 'connections.reconnect') }));
};

/** The face box with this face's name, inside `scope`. */
const box = (scope: HTMLElement, locale: Locale, face: DiscoveryDomain): HTMLInputElement =>
  within(scope).getByRole('checkbox', { name: words(locale, `domain.${face}`) }) as HTMLInputElement;

/** The faces ticked inside `scope`, in the order the panel draws them. */
const tickedIn = (scope: HTMLElement, locale: Locale): DiscoveryDomain[] =>
  DISCOVERY_DOMAINS.filter((face) => {
    const found = within(scope).queryByRole('checkbox', { name: words(locale, `domain.${face}`) });
    return (found as HTMLInputElement | null)?.checked === true;
  });

/** The faces the panel draws inside `scope`, ticked or not. */
const drawnIn = (scope: HTMLElement, locale: Locale): DiscoveryDomain[] =>
  DISCOVERY_DOMAINS.filter(
    (face) => within(scope).queryByRole('checkbox', { name: words(locale, `domain.${face}`) }) !== null,
  );

/** The Connect button inside `scope`. */
const connectIn = (scope: HTMLElement, locale: Locale, provider: 'google' | 'microsoft'): HTMLElement =>
  within(scope).getByRole('button', { name: words(locale, `account.${provider}.connect`) });

/** Press the live Connect button inside `scope`, with the browser opening a window. */
const pressConnect = async (scope: HTMLElement, locale: Locale, provider: 'google' | 'microsoft'): Promise<void> => {
  const connect = connectIn(scope, locale, provider);
  await waitFor(() => expect(connect).toBeEnabled());
  fireEvent.click(connect);
};

let opened: MockInstance<typeof window.open>;

beforeEach(() => {
  vi.clearAllMocks();
  deployment(SENSITIVE);
  googleAuthorize.mockResolvedValue({ url: 'https://provider.example/consent' });
  microsoftAuthorize.mockResolvedValue({ url: 'https://provider.example/consent' });
  const popup = { location: { href: 'about:blank' }, closed: false, close: vi.fn() };
  opened = vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
});
afterEach(() => {
  opened.mockRestore();
  cleanup();
  globalThis.localStorage.removeItem('ownpace.locale');
});

describe('Reconnect starts from the faces the account carries (the owner, 2026-11-15)', () => {
  for (const locale of ['en', 'nl'] as const) {
    it(`${locale}: a grant that carried calendars and contacts starts with exactly those two ticked, and asks for them`, async () => {
      list.mockResolvedValue([conn({ qualification: grant(['calendar', 'contact']) })]);
      renderPage(locale);
      await pressReconnect(locale, GOOGLE_ROW);
      const row = await rowOf(GOOGLE_ROW);

      await waitFor(() => expect(drawnIn(row, locale)).toEqual(SENSITIVE));
      expect(
        tickedIn(row, locale),
        'Reconnect opened with faces the account does not carry, or without the ones it does',
      ).toEqual(['calendar', 'contact']);

      // What is asked is what is ticked: the ticks are the ask, not a picture of it.
      await pressConnect(row, locale, 'google');
      await waitFor(() => expect(googleAuthorize).toHaveBeenCalledTimes(1));
      expect(googleAuthorize.mock.calls[0]![0]).toEqual({ domains: ['calendar', 'contact'], locale });
    });

    it(`${locale}: with no record, every face the deployment serves starts ticked`, async () => {
      list.mockResolvedValue([conn({})]);
      renderPage(locale);
      await pressReconnect(locale, GOOGLE_ROW);
      const row = await rowOf(GOOGLE_ROW);

      await waitFor(() => expect(drawnIn(row, locale)).toEqual(SENSITIVE));
      expect(tickedIn(row, locale), 'with nothing to start from, Reconnect started from none').toEqual(SENSITIVE);
    });
  }

  it.each([
    {
      what: 'a grant the provider would not exchange (every face unknown) starts from every face served',
      qualification: grant([], ['mail', 'calendar', 'contact', 'file', 'task']),
      served: SENSITIVE,
      ticked: SENSITIVE,
    },
    {
      what: 'a face the grant carries whose service did not answer (unknown) starts ticked: only a no unticks',
      qualification: grant(['calendar'], ['contact']),
      served: SENSITIVE,
      ticked: ['calendar', 'contact'],
    },
    {
      what: 'a record written before a face existed has no word for it, and unmeasured is never a wall',
      qualification: measured({ mail: 'no', calendar: 'yes', contact: 'yes', file: 'no' }),
      served: SENSITIVE,
      ticked: SENSITIVE,
    },
    {
      what: 'a face the account carries that this deployment does not serve is not ticked: the panel cannot draw it',
      qualification: grant(['mail', 'calendar']),
      served: SENSITIVE,
      ticked: ['calendar'],
    },
    {
      what: 'on a deployment that serves mail, the mail the grant carries starts ticked',
      qualification: grant(['mail', 'calendar']),
      served: RESTRICTED,
      ticked: ['email', 'calendar'],
    },
  ] as const)('$what', async ({ qualification, served, ticked }) => {
    deployment(served);
    list.mockResolvedValue([conn({ qualification })]);
    renderPage();
    await pressReconnect('en', GOOGLE_ROW);
    const row = await rowOf(GOOGLE_ROW);

    // The faces this deployment serves arrive over the wire: the ticks follow them.
    await waitFor(() => expect(drawnIn(row, 'en')).toEqual([...served]));
    await waitFor(() => expect(tickedIn(row, 'en')).toEqual([...ticked]));
    await pressConnect(row, 'en', 'google');
    await waitFor(() => expect(googleAuthorize).toHaveBeenCalledTimes(1));
    expect(googleAuthorize.mock.calls[0]![0]).toEqual({ domains: [...ticked], locale: 'en' });
  });

  it('a grant that carries none of the faces served starts from none: a measured no is a no', async () => {
    // The deployment narrowed after the account was made: what the grant
    // carries is no longer offered here, and nothing is ticked in its place.
    list.mockResolvedValue([conn({ qualification: grant(['mail', 'file']) })]);
    renderPage();
    await pressReconnect('en', GOOGLE_ROW);
    const row = await rowOf(GOOGLE_ROW);

    await waitFor(() => expect(drawnIn(row, 'en')).toEqual(SENSITIVE));
    expect(tickedIn(row, 'en')).toEqual([]);
    await waitFor(() => expect(connectIn(row, 'en', 'google')).toBeDisabled());
    expect(within(row).getByText(words('en', 'account.google.connect.needsDomains'))).toBeTruthy();
  });

  it('a Microsoft account starts from what its grant carries too: the rule is the record’s, not Google’s', async () => {
    list.mockResolvedValue([
      conn({
        id: 'c-microsoft',
        kind: 'microsoft',
        displayName: MICROSOFT_ROW,
        qualification: grant(['mail', 'calendar']),
      }),
    ]);
    renderPage();
    await pressReconnect('en', MICROSOFT_ROW);
    const row = await rowOf(MICROSOFT_ROW);

    await waitFor(() => expect(drawnIn(row, 'en')).toEqual(PROVIDER_ACCOUNT_DOMAINS.microsoft));
    expect(tickedIn(row, 'en')).toEqual(['email', 'calendar']);
    await pressConnect(row, 'en', 'microsoft');
    await waitFor(() => expect(microsoftAuthorize).toHaveBeenCalledTimes(1));
    expect(microsoftAuthorize.mock.calls[0]![0]).toEqual({ domains: ['email', 'calendar'], locale: 'en' });
  });
});

describe('the ticks start from facts that may arrive after the panel opened', () => {
  it('the faces this deployment serves come over the wire: until a tick is changed, the ticks follow them', async () => {
    let answer: (value: unknown) => void = () => {};
    providerAccounts.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    list.mockResolvedValue([conn({ qualification: grant(['mail', 'calendar']) })]);
    renderPage();
    await pressReconnect('en', GOOGLE_ROW);
    const row = await rowOf(GOOGLE_ROW);

    // Until the deployment answers, the shared table does, and it offers no mail.
    await waitFor(() => expect(drawnIn(row, 'en')).toEqual(SENSITIVE));
    expect(tickedIn(row, 'en')).toEqual(['calendar']);

    // This deployment serves mail, and the grant carries it: it joins the ticks.
    await act(async () => answer({ google: { domains: [...RESTRICTED], client: 'deployment' } }));
    await waitFor(() => expect(drawnIn(row, 'en')).toEqual(RESTRICTED));
    expect(tickedIn(row, 'en'), 'the ticks stayed on what was served before the answer').toEqual([
      'email',
      'calendar',
    ]);
  });

  it('a door’s starting ticks are kept to the faces the panel draws: a tick nobody can see is never asked for', async () => {
    // The hook's own rule, whatever a door hands it: here a door that names
    // mail on a deployment that serves no mail.
    const Panel: React.FC = () => {
      const consent = useProviderConsent({
        role: 'source',
        type: 'google',
        fields: credentialFieldsFor('source', 'google'),
        values: { username: 'someone@example.invalid' },
        onToken: () => {},
        refusalText: (e) => String(e),
        initialDomains: () => ['email', 'calendar'],
      });
      return <ProviderConsentPanel consent={consent} />;
    };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Panel />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(drawnIn(container, 'en')).toEqual(SENSITIVE));
    expect(tickedIn(container, 'en')).toEqual(['calendar']);
    await pressConnect(container, 'en', 'google');
    await waitFor(() => expect(googleAuthorize).toHaveBeenCalledTimes(1));
    expect(googleAuthorize.mock.calls[0]![0]).toEqual({ domains: ['calendar'], locale: 'en' });
  });
});

describe('the ticks stay the person’s, and the panel starts from the same place each time', () => {
  it('closing and opening Reconnect again puts the ticks back where they started, not on none', async () => {
    list.mockResolvedValue([conn({ qualification: grant(['calendar', 'contact']) })]);
    renderPage();
    await pressReconnect('en', GOOGLE_ROW);
    let row = await rowOf(GOOGLE_ROW);
    await waitFor(() => expect(tickedIn(row, 'en')).toEqual(['calendar', 'contact']));

    // The person changes their mind: no contacts, and tasks after all.
    fireEvent.click(box(row, 'en', 'contact'));
    fireEvent.click(box(row, 'en', 'task'));
    expect(tickedIn(row, 'en')).toEqual(['calendar', 'task']);

    await pressReconnect('en', GOOGLE_ROW); // closes the panel
    expect(within(row).queryAllByRole('checkbox')).toEqual([]);
    await pressReconnect('en', GOOGLE_ROW); // and opens it again
    row = await rowOf(GOOGLE_ROW);
    expect(
      tickedIn(row, 'en'),
      'the panel opened again on the last ticks, or on none, instead of on what the account carries',
    ).toEqual(['calendar', 'contact']);
  });

  it('an unticked face is not asked for: the least-privilege door is the ticks, as before', async () => {
    list.mockResolvedValue([conn({ qualification: grant(['calendar', 'contact', 'task']) })]);
    renderPage();
    await pressReconnect('en', GOOGLE_ROW);
    const row = await rowOf(GOOGLE_ROW);
    await waitFor(() => expect(tickedIn(row, 'en')).toEqual(SENSITIVE));

    fireEvent.click(box(row, 'en', 'contact'));
    fireEvent.click(box(row, 'en', 'task'));
    await pressConnect(row, 'en', 'google');
    await waitFor(() => expect(googleAuthorize).toHaveBeenCalledTimes(1));
    expect(googleAuthorize.mock.calls[0]![0]).toEqual({ domains: ['calendar'], locale: 'en' });

    // And with every face unticked there is nothing to ask for, so nothing is asked.
    fireEvent.click(box(row, 'en', 'calendar'));
    await waitFor(() => expect(connectIn(row, 'en', 'google')).toBeDisabled());
    expect(within(row).getByText(words('en', 'account.google.connect.needsDomains'))).toBeTruthy();
  });

  it('the add form on the same page still starts from none: a new account has nothing to start from', async () => {
    list.mockResolvedValue([conn({ qualification: grant(['calendar', 'contact', 'task']) })]);
    renderPage();
    await pressReconnect('en', GOOGLE_ROW);
    const row = await rowOf(GOOGLE_ROW);
    await waitFor(() => expect(tickedIn(row, 'en')).toEqual(SENSITIVE));

    fireEvent.click(screen.getByRole('button', { name: words('en', 'connections.add') }));
    fireEvent.click(screen.getByRole('button', { name: /^Google[ -]account/ }));
    const form = screen.getByRole('region', { name: words('en', 'connections.add') });
    await waitFor(() => expect(drawnIn(form, 'en')).toEqual(SENSITIVE));
    expect(tickedIn(form, 'en'), 'a new account started with ticks it was never given').toEqual([]);
    // And the row's own panel kept its ticks beside it.
    expect(tickedIn(row, 'en')).toEqual(SENSITIVE);
  });
});
