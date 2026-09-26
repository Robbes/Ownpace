// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A RECONNECT THE PAGE CAN FIND (workplan 0140 T2 (b)).
 *
 * A Google connection in Testing stops about a week after its consent: Google
 * refuses the refresh token with `invalid_grant`, `failure-category.ts` files
 * that under `auth_expired`, and the migration's progress shows the category's
 * sentence. In English that sentence said *"Reconnect it on the Connections
 * page"*. No button on the Connections page said Reconnect: a new token for an
 * existing connection is minted under *Replace credentials*, whose panel has
 * carried the same consent button as the add form since 2026-09-08. In Dutch
 * the sentence named no button at all (*"Herstel de verbinding op de pagina
 * Verbindingen"*). A tester sent to the page looked for a word that was not on
 * it.
 *
 * Now the row of a connection whose kind has a consent button (Google, Dropbox
 * and Microsoft, with the deployment's app or the connection's own) labels its
 * button *Reconnect* / *Opnieuw verbinden*, and opens the same panel. A
 * password connection keeps *Replace credentials*, because the same category
 * also covers a refused password (`AUTHENTICATIONFAILED`, `401`), so the
 * sentence names both buttons.
 *
 * AND TIES NEITHER TO A KIND OF CREDENTIAL (the review of 2026-09-26). The
 * first build's sentence said *"or use Replace credentials for a password"*.
 * The label is chosen by the connection's KIND, not by what the row stores: a
 * Gmail connection that signs in with an app password is a password, and its
 * row says Reconnect, because Gmail's kind carries Google's consent button. A
 * revoked app password lands in this category too (`AUTHENTICATIONFAILED`), so
 * that sentence sent its reader to a button their row did not have, which is
 * the fault this task exists to remove. So the sentence names both buttons
 * and lets the row decide: *"whichever its row shows"*.
 *
 * What is pinned, in English and in Dutch: each row's button label appears
 * verbatim inside `failure.authExpired`; the consent rows, a Gmail row with an
 * app password among them, say Reconnect and open the panel with the
 * provider's own Connect button; the password row still says Replace
 * credentials; and the sentence says nothing about passwords.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { ConnectionSummary } from '../services/mapping-service.ts';
import { LocaleProvider } from '../i18n/index.tsx';
import { STRINGS } from '../i18n/strings.ts';

const { list, providerClients } = vi.hoisted(() => ({ list: vi.fn(), providerClients: vi.fn() }));

vi.mock('../services/mapping-service', () => ({
  connectionsApi: { list, test: vi.fn(), rotate: vi.fn(), remove: vi.fn(), add: vi.fn() },
  providerClientsApi: { get: providerClients },
  providerAccountsApi: { get: vi.fn().mockResolvedValue({}) },
  mappingApi: { googleAuthorize: vi.fn(), dropboxAuthorize: vi.fn(), microsoftAuthorize: vi.fn() },
}));

import Connections from './Connections.tsx';

type Locale = 'en' | 'nl';
const LOCALES: ReadonlyArray<Locale> = ['en', 'nl'];

/** A key read without the compiler's help, so a missing string fails here, not in tsc. */
const words = (locale: Locale, key: string): string => {
  const s = (STRINGS[locale] as Record<string, string>)[key];
  expect(s, `${locale} has no '${key}'`).toBeTruthy();
  return s as string;
};

const conn = (over: Partial<ConnectionSummary>): ConnectionSummary => ({
  id: 'c1',
  role: 'source',
  kind: 'imap',
  displayName: 'A connection',
  status: 'connected',
  createdAt: '2026-08-01T10:00:00Z',
  usedByMigrations: 1,
  ...over,
});

/** The rows the plan names: consent kinds, and one that signs in with a password. */
const CONSENT_ROWS = [
  { kind: 'google', name: 'Anna’s Google account', provider: 'google' },
  { kind: 'dropbox', name: 'Anna’s Dropbox', provider: 'dropbox' },
  { kind: 'microsoft', name: 'Anna’s Microsoft 365 account', provider: 'microsoft' },
] as const;
const PASSWORD_ROW = { kind: 'imap', name: 'Anna’s mailbox at the old host' } as const;
/**
 * A Gmail connection stored with an app password (0089 T7): a password, on a
 * kind whose descriptor carries Google's consent. Nothing on the row says
 * which of the two it holds; its label follows the kind.
 */
const APP_PASSWORD_ROW = { kind: 'gmail', name: 'Anna’s Gmail, with an app password', provider: 'google' } as const;

function renderPage(locale: Locale) {
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

/**
 * The button on a row that opens its credential panel: every button in the
 * row but Test and Delete. Found by elimination, so the test reads whatever
 * the row says rather than the word it hopes for.
 */
async function panelButton(locale: Locale, displayName: string): Promise<HTMLElement> {
  const row = (await screen.findByText(displayName)).closest('li') as HTMLElement;
  expect(row, `no row for ${displayName}`).not.toBeNull();
  const others = new Set([words(locale, 'connections.test'), words(locale, 'connections.delete')]);
  const buttons = within(row)
    .getAllByRole('button')
    .filter((b) => !others.has((b.textContent ?? '').trim()));
  expect(buttons, `${displayName}: expected one button besides Test and Delete`).toHaveLength(1);
  return buttons[0]!;
}

beforeEach(() => {
  vi.clearAllMocks();
  // The deployment carries every app, as on the managed service a tester uses.
  providerClients.mockResolvedValue({ google: 'deployment', dropbox: 'deployment', microsoft: 'deployment' });
  list.mockResolvedValue([
    ...CONSENT_ROWS.map((r, i) => conn({ id: `c${i}`, kind: r.kind, displayName: r.name })),
    conn({ id: 'pw', kind: PASSWORD_ROW.kind, displayName: PASSWORD_ROW.name }),
    conn({
      id: 'app-pw',
      kind: APP_PASSWORD_ROW.kind,
      displayName: APP_PASSWORD_ROW.name,
      knownValues: { username: 'anna@example.invalid' },
    }),
  ]);
});
afterEach(() => {
  cleanup();
  globalThis.localStorage.removeItem('ownpace.locale');
});

describe('the failure line names a button the Connections page has (0140 T2 (b))', () => {
  for (const locale of LOCALES) {
    it(`${locale}: every row's button is named, verbatim, by failure.authExpired`, async () => {
      renderPage(locale);
      const sentence = words(locale, 'failure.authExpired');
      for (const name of [...CONSENT_ROWS.map((r) => r.name), PASSWORD_ROW.name, APP_PASSWORD_ROW.name]) {
        const label = ((await panelButton(locale, name)).textContent ?? '').trim();
        expect(
          sentence,
          `${name}: its button says "${label}", and the sentence that sends a tester to this page ` +
            'never says that word, so they look for a button that is not there',
        ).toContain(label);
      }
    });

    for (const row of CONSENT_ROWS) {
      it(`${locale}: the ${row.kind} row says Reconnect, and opens the panel with its Connect button`, async () => {
        renderPage(locale);
        const button = await panelButton(locale, row.name);
        expect((button.textContent ?? '').trim()).toBe(words(locale, 'connections.reconnect'));
        fireEvent.click(button);
        expect(
          await screen.findByRole('button', { name: words(locale, `wizard.${row.provider}.connect`) }),
        ).toBeTruthy();
      });
    }

    it(`${locale}: a password row still says Replace credentials`, async () => {
      renderPage(locale);
      const button = await panelButton(locale, PASSWORD_ROW.name);
      expect((button.textContent ?? '').trim()).toBe(words(locale, 'connections.rotate'));
    });

    it(`${locale}: a Gmail row with an app password says Reconnect, so the sentence ties no button to a password`, async () => {
      renderPage(locale);
      const button = await panelButton(locale, APP_PASSWORD_ROW.name);
      // The premise: the label follows the kind, not what the row stores. If a
      // row is ever labelled by its credential, this fails first, and the
      // sentence below can be read again with that in mind.
      expect((button.textContent ?? '').trim()).toBe(words(locale, 'connections.reconnect'));
      fireEvent.click(button);
      expect(
        await screen.findByRole('button', { name: words(locale, `wizard.${APP_PASSWORD_ROW.provider}.connect`) }),
      ).toBeTruthy();
      // So a sentence that sends "a password" to Replace credentials sends this
      // reader to a button their row does not have.
      expect(
        words(locale, 'failure.authExpired'),
        'the sentence assigns a button to a kind of credential, and the row label does not follow the credential',
      ).not.toMatch(/password|wachtwoord/i);
    });
  }
});
