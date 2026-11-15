// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A RECONNECT THAT FOLDS THE CLIENT AWAY (the owner, 2026-11-15).
 *
 * *Reconnect* on a row whose kind has a consent button drew every box the
 * rotate route can take in plain view above *Connect with Google*: the
 * account, the client ID, the client secret, the refresh token, and the
 * service account key. On the managed service the deployment carries
 * Google's application (ADR-0041), the button mints the token, and a tester
 * never had a client pair; the boxes asked for what the button supplies. The
 * add form on the same page had folded them away since 2026-09-02, under
 * *Use your own Google client*. The owner asked for the same: the other
 * fields behind a fold, for experts.
 *
 * What is pinned, in English and in Dutch:
 *
 * - where the deployment carries the provider's application, the client ID,
 *   the client secret and the refresh token are in one closed fold, in the
 *   add form's words (`account.<provider>.ownClient`, `.deploymentClient`);
 *   the other ways in nobody starts from (Google's service account key,
 *   Gmail's app password) are in a closed *More options*; the account, which
 *   the consent needs, stays in view, filled in;
 * - the line under the button names the token box only where it is in view;
 * - where the deployment carries no application of its own (the appliance,
 *   or a provider without one), every box stays in view, as before;
 * - a folded box still works: typed into, it keeps its value when the fold
 *   closes, and the consent and *Check and replace* both send it; a token
 *   the consent hands back lands in the folded box, and is sent.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { credentialFieldsFor, wizardTypeForConnectionKind } from '@openmig/shared';
import type { ConnectionSummary } from '../services/mapping-service.ts';
import { LocaleProvider } from '../i18n/index.tsx';
import { STRINGS } from '../i18n/strings.ts';

const { list, rotate, providerClients, googleAuthorize } = vi.hoisted(() => ({
  list: vi.fn(),
  rotate: vi.fn(),
  providerClients: vi.fn(),
  googleAuthorize: vi.fn(),
}));

vi.mock('../services/mapping-service', () => ({
  connectionsApi: { list, test: vi.fn(), rotate, remove: vi.fn(), add: vi.fn() },
  providerClientsApi: { get: providerClients },
  providerAccountsApi: { get: vi.fn().mockResolvedValue({}) },
  mappingApi: { googleAuthorize, dropboxAuthorize: vi.fn(), microsoftAuthorize: vi.fn() },
}));

import Connections from './Connections.tsx';

type Locale = 'en' | 'nl';
type ClientSource = 'deployment' | 'connection';
const LOCALES: ReadonlyArray<Locale> = ['en', 'nl'];

/** A key read without the compiler's help, so a missing string fails here, not in tsc. */
const words = (locale: Locale, key: string): string => {
  const s = (STRINGS[locale] as { readonly [key: string]: string })[key];
  expect(s, `${locale} has no '${key}'`).toBeTruthy();
  return s as string;
};

const ROW_NAME = 'The family’s account';
const ADDRESS = 'someone@example.invalid';

/**
 * The rows whose kind has a consent button, the provider it asks, and the
 * boxes other than the pair and the token that the rotate panel offers.
 */
const ROWS = [
  { kind: 'google', provider: 'google', more: ['serviceAccountKey'] },
  { kind: 'gmail', provider: 'google', more: ['serviceAccountKey', 'appPassword'] },
  { kind: 'dropbox', provider: 'dropbox', more: [] },
  { kind: 'microsoft', provider: 'microsoft', more: [] },
] as const;
const OWN_CLIENT = ['clientId', 'clientSecret', 'refreshToken'] as const;

const conn = (kind: string): ConnectionSummary => ({
  id: 'c1',
  role: 'source',
  kind,
  displayName: ROW_NAME,
  status: 'error',
  createdAt: '2026-08-01T10:00:00Z',
  usedByMigrations: 1,
  knownValues: { username: ADDRESS },
});

/**
 * The page, with the deployment's answer about its applications already in:
 * before it arrives the panel reads "none" (the direction that cannot
 * under-ask), which is the in-view case, so a test of that case could pass
 * before the answer it is about.
 */
function renderPage(locale: Locale, clients: ClientSource) {
  globalThis.localStorage.setItem('ownpace.locale', locale);
  const answer = { google: clients, dropbox: clients, microsoft: clients };
  providerClients.mockResolvedValue(answer);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['provider-clients'], answer);
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

/** Open the row's Reconnect panel, and answer the row. */
const reconnect = async (locale: Locale): Promise<HTMLElement> => {
  const row = (await screen.findByText(ROW_NAME)).closest('li') as HTMLElement;
  fireEvent.click(within(row).getByRole('button', { name: words(locale, 'connections.reconnect') }));
  await within(row).findByRole('button', { name: words(locale, 'connections.rotate.save') });
  return row;
};

/** The box for a descriptor field, found by the label the panel gives it. */
const boxFor = (row: HTMLElement, locale: Locale, kind: string, key: string): HTMLInputElement => {
  const field = credentialFieldsFor('source', wizardTypeForConnectionKind(kind)).find((f) => f.key === key);
  expect(field, `${kind} has no '${key}' field`).toBeDefined();
  return within(row).getByLabelText(words(locale, field!.labelKey)) as HTMLInputElement;
};

/** The fold a box sits in, or null; and that fold's own title. */
const foldOf = (el: HTMLElement): HTMLDetailsElement | null => el.closest('details');
const titleOf = (fold: HTMLDetailsElement): string => fold.querySelector(':scope > summary')?.textContent ?? '';

let opened: MockInstance<typeof window.open>;

beforeEach(() => {
  vi.clearAllMocks();
  googleAuthorize.mockResolvedValue({ url: 'https://provider.example/consent' });
  rotate.mockResolvedValue({ ok: true, rotated: true, detail: 'Listed 3 calendars.' });
  const popup = { location: { href: 'about:blank' }, closed: false, close: vi.fn() };
  opened = vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
});
afterEach(() => {
  opened.mockRestore();
  cleanup();
  globalThis.localStorage.removeItem('ownpace.locale');
});

describe('Reconnect folds the client away where the deployment carries it (the owner, 2026-11-15)', () => {
  for (const locale of LOCALES) {
    for (const { kind, provider, more } of ROWS) {
      it(`${locale}: a ${kind} row folds the pair and the token under the add form’s words, and keeps the account in view`, async () => {
        list.mockResolvedValue([conn(kind)]);
        renderPage(locale, 'deployment');
        const row = await reconnect(locale);

        const account = boxFor(row, locale, kind, 'username');
        expect(foldOf(account), 'the account the consent needs went into a fold').toBeNull();
        expect(account).toBeVisible();
        expect(account).toHaveValue(ADDRESS);

        const fold = foldOf(boxFor(row, locale, kind, 'clientId'));
        expect(fold, `the ${kind} client ID is in plain view above the button`).not.toBeNull();
        expect(fold!.open, 'the fold opened by itself').toBe(false);
        expect(titleOf(fold!)).toBe(words(locale, `account.${provider}.ownClient`));
        expect(within(fold!).getByText(words(locale, `account.${provider}.deploymentClient`))).toBeTruthy();
        for (const key of OWN_CLIENT) {
          const box = boxFor(row, locale, kind, key);
          expect(foldOf(box), `${key} is not in the same fold as the client ID`).toBe(fold);
          expect(box, `${key} is in plain view`).not.toBeVisible();
        }

        for (const key of more) {
          const box = boxFor(row, locale, kind, key);
          const other = foldOf(box);
          expect(other, `${key} is in plain view above the button`).not.toBeNull();
          expect(other).not.toBe(fold);
          expect(other!.open).toBe(false);
          expect(titleOf(other!)).toBe(words(locale, 'start.moreOptions'));
          expect(box).not.toBeVisible();
        }
        if (more.length === 0) {
          expect(within(row).queryByText(words(locale, 'start.moreOptions')), 'an empty More options').toBeNull();
        }

        // The line under the button names no box the person cannot see. Read
        // as text: Microsoft's fold says its own reason first, in one line.
        expect(within(row).getByRole('button', { name: words(locale, `account.${provider}.connect`) })).toBeTruthy();
        expect(row.textContent).not.toContain(words(locale, 'account.consent.pasteToken'));
      });

      it(`${locale}: without the deployment’s application, a ${kind} row keeps every box in view, as before`, async () => {
        list.mockResolvedValue([conn(kind)]);
        renderPage(locale, 'connection');
        const row = await reconnect(locale);

        for (const key of ['username', ...OWN_CLIENT, ...more]) {
          const box = boxFor(row, locale, kind, key);
          expect(foldOf(box), `${key} went into a fold where the person must bring their own client`).toBeNull();
          expect(box).toBeVisible();
        }
        expect(within(row).queryByText(words(locale, `account.${provider}.ownClient`))).toBeNull();
        expect(within(row).queryByText(words(locale, 'start.moreOptions'))).toBeNull();
        // And the line under the button says the token box is below, which it is.
        expect(row.textContent).toContain(words(locale, 'account.consent.pasteToken'));
      });
    }
  }
});

describe('a folded box still works', () => {
  it('typed into, it keeps its value when the fold closes, and the consent and Check and replace both send it', async () => {
    list.mockResolvedValue([conn('google')]);
    renderPage('en', 'deployment');
    const row = await reconnect('en');
    const fold = foldOf(boxFor(row, 'en', 'google', 'clientId'))!;

    // The fold opens, and takes the person's own pair.
    fireEvent.click(fold.querySelector(':scope > summary')!);
    expect(fold.open).toBe(true);
    expect(boxFor(row, 'en', 'google', 'clientId')).toBeVisible();
    fireEvent.change(boxFor(row, 'en', 'google', 'clientId'), { target: { value: 'own-client-id' } });
    fireEvent.change(boxFor(row, 'en', 'google', 'clientSecret'), { target: { value: 'own-secret' } });

    // Closed again, the values are kept.
    fireEvent.click(fold.querySelector(':scope > summary')!);
    expect(fold.open).toBe(false);
    expect(boxFor(row, 'en', 'google', 'clientId')).toHaveValue('own-client-id');
    expect(boxFor(row, 'en', 'google', 'clientSecret')).toHaveValue('own-secret');

    // The consent runs on the pair typed in the fold, for the faces ticked.
    const connect = within(row).getByRole('button', { name: words('en', 'account.google.connect') });
    await waitFor(() => expect(connect).toBeEnabled());
    fireEvent.click(connect);
    await waitFor(() => expect(googleAuthorize).toHaveBeenCalledTimes(1));
    expect(googleAuthorize.mock.calls[0]![0]).toMatchObject({
      clientId: 'own-client-id',
      clientSecret: 'own-secret',
    });

    // And Check and replace sends what the fold holds, beside the account.
    fireEvent.click(within(row).getByRole('button', { name: words('en', 'connections.rotate.save') }));
    await waitFor(() => expect(rotate).toHaveBeenCalledTimes(1));
    expect(rotate.mock.calls[0]![1]).toMatchObject({
      username: ADDRESS,
      clientId: 'own-client-id',
      clientSecret: 'own-secret',
    });
  });

  it('a token the consent hands back lands in the folded box, and Check and replace sends it', async () => {
    list.mockResolvedValue([conn('google')]);
    renderPage('en', 'deployment');
    const row = await reconnect('en');
    const token = boxFor(row, 'en', 'google', 'refreshToken');
    const fold = foldOf(token);
    expect(fold).not.toBeNull();

    const connect = within(row).getByRole('button', { name: words('en', 'account.google.connect') });
    await waitFor(() => expect(connect).toBeEnabled());
    fireEvent.click(connect);
    await waitFor(() => expect(googleAuthorize).toHaveBeenCalledTimes(1));
    // The deployment's application: no pair of the person's is sent.
    expect(googleAuthorize.mock.calls[0]![0]).not.toHaveProperty('clientId');
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: window.location.origin,
          data: { type: 'ownpace-google-consent', refreshToken: '1//landed' },
        }),
      );
    });

    expect(await within(row).findByText(words('en', 'account.consent.received'))).toBeVisible();
    expect(token).toHaveValue('1//landed');
    expect(foldOf(token), 'the token box left its fold').toBe(fold);
    fireEvent.click(within(row).getByRole('button', { name: words('en', 'connections.rotate.save') }));
    await waitFor(() => expect(rotate).toHaveBeenCalledTimes(1));
    expect(rotate.mock.calls[0]![1]).toMatchObject({ username: ADDRESS, refreshToken: '1//landed' });
  });
});
