// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * CONNECT CIRRUX DRIVE ON THE ACCOUNTS PAGE (workplan 0160 T5; ADR-0052), in
 * English and in Dutch.
 *
 * - **No button without the deployment's Cirrux client**, and none on any row
 *   but a Cirrux destination.
 * - **Not connected**: *Connect Cirrux Drive*; the press opens the window
 *   before the server has answered, and sends it to Cirrux once it has.
 * - **The window's answer** is one message from this origin, for this row:
 *   the page reads the accounts again. One from another origin, or for
 *   another account, is not this row's.
 * - **Connected**, by the account's own record: said, and the button offers
 *   to connect again.
 * - **A refusal** closes the blank window and is shown in the server's words.
 * - **Disconnect Cirrux Drive** (workplan 0160), beside a stored sign-in only:
 *   the press asks first and sends nothing; *Keep it connected* sends
 *   nothing; the confirmed press sends the account's id, says what was done
 *   and how the sign-in ends at Cirrux, and reads the accounts again; an
 *   account that stored none says so; a refusal is the server's words.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { render, screen, cleanup, act, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AxiosError, AxiosHeaders } from 'axios';
import { LocaleProvider } from '../i18n/index.tsx';
import { STRINGS } from '../i18n/strings.ts';
import type { ConnectionSummary } from '../services/mapping-service.ts';

const { cirruxDriveAuthorize, cirruxDriveDisconnect, facts } = vi.hoisted(() => ({
  cirruxDriveAuthorize: vi.fn(),
  cirruxDriveDisconnect: vi.fn(),
  facts: vi.fn(),
}));

vi.mock('../services/mapping-service', () => ({
  mappingApi: { cirruxDriveAuthorize, cirruxDriveDisconnect },
  providerAccountsApi: { get: facts },
}));

import { CirruxDrivePanel } from './CirruxDrive.tsx';

type Locale = 'en' | 'nl';
const words = (locale: Locale, key: string): string => {
  const s = (STRINGS[locale] as Record<string, string>)[key];
  expect(s, `${locale} has no '${key}'`).toBeTruthy();
  return s as string;
};

const ID = '0160cd00-e29b-41d4-a716-446655440011';
const CONSENT_URL = 'https://api.cirrux.co/oauth/authorize?client_id=c&state=s';

const unasked = { answer: 'unknown', reason: 'notAskable', detail: 'not measured' } as const;
const account = (file?: { answer: 'yes' | 'no' | 'unknown'; reason?: string; detail: string }, kind = 'cirrux'): ConnectionSummary =>
  ({
    id: ID,
    role: 'target',
    kind,
    displayName: 'Cirrux',
    status: 'connected',
    createdAt: '2026-11-19T10:00:00.000Z',
    usedByMigrations: 0,
    qualification: file
      ? { domains: { mail: unasked, calendar: unasked, contact: unasked, task: unasked, file } }
      : null,
  }) as unknown as ConnectionSummary;

const NOT_GRANTED = { answer: 'no' as const, reason: 'notGranted', detail: 'Cirrux Drive is not connected on this account.' };
const CONNECTED = { answer: 'yes' as const, detail: 'Cirrux Drive connected as ada: 3 items at the top level.' };

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

let open: MockInstance;
let blank: BlankWindow;

function wrap(locale: Locale, node: React.ReactNode) {
  globalThis.localStorage.setItem('ownpace.locale', locale);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rendered = render(
    <LocaleProvider>
      <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>
    </LocaleProvider>,
  );
  return { ...rendered, queryClient };
}

/** The deployment's facts read AND drawn: what the panel answers once it knows. */
async function factsArrived(queryClient: QueryClient): Promise<void> {
  await waitFor(() => expect(queryClient.getQueryState(['provider-accounts'])?.status).toBe('success'));
  await act(async () => {});
}

const lands = async (data: unknown, origin = window.location.origin) => {
  await act(async () => {
    window.dispatchEvent(new MessageEvent('message', { origin, data }));
  });
};

beforeEach(() => {
  facts.mockResolvedValue({ cirrux: { domains: ['email', 'calendar', 'contact', 'task'], client: 'deployment' } });
  blank = aBlankWindow();
  open = vi.spyOn(window, 'open').mockImplementation(() => blank as unknown as Window);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  cirruxDriveAuthorize.mockReset();
  cirruxDriveDisconnect.mockReset();
  facts.mockReset();
  globalThis.localStorage.clear();
});

const UNMEASURED = { answer: 'unknown' as const, reason: 'refused', detail: 'Unmeasured — Cirrux Drive refused: 503' };
const DISCONNECTED = {
  connectionId: ID,
  removed: true,
  revocation: { kind: 'cirrux', status: 'unsupported', reason: 'Cirrux documents no way for an app to withdraw a Drive sign-in.' },
};

describe.each(['en', 'nl'] as const)('in %s', (locale) => {
  it('offers no button on a deployment without a Cirrux client, nor on another kind', async () => {
    facts.mockResolvedValue({ cirrux: { domains: ['email', 'calendar', 'contact', 'task'] } });
    const { queryClient } = wrap(locale, <CirruxDrivePanel connection={account(NOT_GRANTED)} onChanged={() => {}} />);
    // Not before the answer is in: a panel still waiting draws nothing either.
    await factsArrived(queryClient);
    expect(screen.queryByRole('button')).toBeNull();
    cleanup();

    facts.mockResolvedValue({ cirrux: { domains: [], client: 'deployment' } });
    wrap(locale, <CirruxDrivePanel connection={account(NOT_GRANTED, 'nextcloud')} onChanged={() => {}} />);
    await act(async () => {});
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('not connected: the press opens the window first, sends it to Cirrux, and the answer reads the accounts again', async () => {
    let answer: (v: { url: string; redirectUri: string }) => void = () => {};
    cirruxDriveAuthorize.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const onChanged = vi.fn();
    wrap(locale, <CirruxDrivePanel connection={account(NOT_GRANTED)} onChanged={onChanged} />);
    const button = await screen.findByRole('button', { name: words(locale, 'account.cirrux.connect') });
    fireEvent.click(button);

    // In the press: a blank window under the consent's name, before any answer.
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0]![0]).toBe('');
    expect(open.mock.calls[0]![1]).toBe('ownpace-cirrux-consent');
    expect(cirruxDriveAuthorize).toHaveBeenCalledWith({ connectionId: ID, locale });
    await act(async () => answer({ url: CONSENT_URL, redirectUri: 'https://app.example/api/migrations/cirrux/callback' }));
    expect(blank.location.href).toBe(CONSENT_URL);
    expect(open).toHaveBeenCalledTimes(1);

    // Another origin, another account, another message: none of them this row's.
    await lands({ type: 'ownpace-cirrux-drive', connected: true, connectionId: ID }, 'https://elsewhere.example');
    await lands({ type: 'ownpace-cirrux-drive', connected: true, connectionId: '0160cd00-e29b-41d4-a716-446655440099' });
    await lands({ type: 'ownpace-dropbox-consent', refreshToken: 'x' });
    expect(onChanged).not.toHaveBeenCalled();

    await lands({ type: 'ownpace-cirrux-drive', connected: true, connectionId: ID });
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status').textContent).toBe(words(locale, 'account.cirrux.landed'));
  });

  it('connected by the record: said, and the button connects again', async () => {
    wrap(locale, <CirruxDrivePanel connection={account(CONNECTED)} onChanged={() => {}} />);
    expect(await screen.findByText(words(locale, 'account.cirrux.connected'))).toBeTruthy();
    expect(screen.getByRole('button', { name: words(locale, 'account.cirrux.again') })).toBeTruthy();
  });

  it('a record that never measured the Drive is not called connected', async () => {
    wrap(locale, <CirruxDrivePanel connection={account()} onChanged={() => {}} />);
    expect(await screen.findByRole('button', { name: words(locale, 'account.cirrux.connect') })).toBeTruthy();
    expect(screen.queryByText(words(locale, 'account.cirrux.connected'))).toBeNull();
  });

  it('a refusal closes the blank window and is shown in the server’s words', async () => {
    const err = new AxiosError('Request failed with status code 400');
    err.response = {
      status: 400,
      statusText: 'Refused',
      headers: {},
      config: { headers: new AxiosHeaders() },
      data: { error: 'no_cirrux_client', reason: 'This deployment has no Cirrux client yet.' },
    };
    cirruxDriveAuthorize.mockRejectedValue(err);
    wrap(locale, <CirruxDrivePanel connection={account(NOT_GRANTED)} onChanged={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: words(locale, 'account.cirrux.connect') }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'This deployment has no Cirrux client yet.');
    expect(blank.close).toHaveBeenCalled();
  });

  it('a window the browser did not open offers the link, named for Cirrux', async () => {
    open.mockImplementation(() => null);
    cirruxDriveAuthorize.mockResolvedValue({ url: CONSENT_URL, redirectUri: 'x' });
    wrap(locale, <CirruxDrivePanel connection={account(NOT_GRANTED)} onChanged={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: words(locale, 'account.cirrux.connect') }));
    const link = await screen.findByRole('link');
    expect(link.getAttribute('href')).toBe(CONSENT_URL);
    expect(link.getAttribute('target')).toBe('ownpace-cirrux-consent');
    expect(link.getAttribute('rel')).toBe('opener');
    expect(screen.getByRole('status').textContent).toContain(
      words(locale, 'account.consent.windowBlocked').replace('{provider}', 'Cirrux'),
    );
  });

  describe('Disconnect Cirrux Drive (workplan 0160)', () => {
    const disconnectButton = () => screen.queryByRole('button', { name: words(locale, 'account.cirrux.disconnect') });

    it('is offered beside a stored sign-in only: connected, or unmeasured; never without one, nor without a record', async () => {
      wrap(locale, <CirruxDrivePanel connection={account(CONNECTED)} onChanged={() => {}} />);
      expect(await screen.findByRole('button', { name: words(locale, 'account.cirrux.disconnect') })).toBeTruthy();
      cleanup();

      wrap(locale, <CirruxDrivePanel connection={account(UNMEASURED)} onChanged={() => {}} />);
      expect(await screen.findByRole('button', { name: words(locale, 'account.cirrux.disconnect') })).toBeTruthy();
      cleanup();

      for (const record of [NOT_GRANTED, undefined]) {
        wrap(locale, <CirruxDrivePanel connection={account(record)} onChanged={() => {}} />);
        await screen.findByRole('button', { name: words(locale, 'account.cirrux.connect') });
        expect(disconnectButton()).toBeNull();
        cleanup();
      }
    });

    it('is not offered on a deployment without a Cirrux client, however connected the record says it is', async () => {
      facts.mockResolvedValue({ cirrux: { domains: ['email', 'calendar', 'contact', 'task'] } });
      const { queryClient } = wrap(locale, <CirruxDrivePanel connection={account(CONNECTED)} onChanged={() => {}} />);
      await factsArrived(queryClient);
      expect(screen.queryByRole('button')).toBeNull();
      expect(cirruxDriveDisconnect).not.toHaveBeenCalled();
    });

    it('asks first and sends nothing; Keep it connected sends nothing either', async () => {
      wrap(locale, <CirruxDrivePanel connection={account(CONNECTED)} onChanged={() => {}} />);
      fireEvent.click(await screen.findByRole('button', { name: words(locale, 'account.cirrux.disconnect') }));
      const dialog = screen.getByRole('alertdialog');
      expect(dialog.textContent).toContain(words(locale, 'account.cirrux.disconnect.confirm'));
      expect(cirruxDriveDisconnect).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: words(locale, 'account.cirrux.disconnect.keep') }));
      expect(screen.queryByRole('alertdialog')).toBeNull();
      expect(cirruxDriveDisconnect).not.toHaveBeenCalled();
      expect(disconnectButton()).toBeTruthy();
    });

    it('the confirmed press sends the account, says what was done and how it ends at Cirrux, and reads the accounts again', async () => {
      let answer: (v: typeof DISCONNECTED) => void = () => {};
      cirruxDriveDisconnect.mockReturnValue(new Promise((resolve) => (answer = resolve)));
      const onChanged = vi.fn();
      wrap(locale, <CirruxDrivePanel connection={account(CONNECTED)} onChanged={onChanged} />);
      fireEvent.click(await screen.findByRole('button', { name: words(locale, 'account.cirrux.disconnect') }));
      fireEvent.click(screen.getByRole('button', { name: words(locale, 'account.cirrux.disconnect.yes') }));
      expect(cirruxDriveDisconnect).toHaveBeenCalledWith({ connectionId: ID });
      // While the server answers, the press says so and cannot be pressed twice.
      const busy = screen.getByRole('button', { name: words(locale, 'account.cirrux.disconnecting') });
      expect(busy).toHaveProperty('disabled', true);
      await act(async () => answer(DISCONNECTED));
      expect(screen.getByRole('status').textContent).toBe(
        `${words(locale, 'account.cirrux.disconnected')} ${words(locale, 'account.cirrux.disconnected.atCirrux')}`,
      );
      expect(screen.queryByRole('alertdialog')).toBeNull();
      expect(onChanged).toHaveBeenCalledTimes(1);
      expect(cirruxDriveDisconnect).toHaveBeenCalledTimes(1);
    });

    it('an account that stored no sign-in says there was nothing to disconnect', async () => {
      cirruxDriveDisconnect.mockResolvedValue({
        connectionId: ID,
        removed: false,
        revocation: { kind: 'cirrux', status: 'no_credential', reason: 'none' },
      });
      const onChanged = vi.fn();
      wrap(locale, <CirruxDrivePanel connection={account(CONNECTED)} onChanged={onChanged} />);
      fireEvent.click(await screen.findByRole('button', { name: words(locale, 'account.cirrux.disconnect') }));
      fireEvent.click(screen.getByRole('button', { name: words(locale, 'account.cirrux.disconnect.yes') }));
      expect((await screen.findByRole('status')).textContent).toBe(words(locale, 'account.cirrux.notConnected'));
      // The record said connected; it is read again either way.
      expect(onChanged).toHaveBeenCalledTimes(1);
    });

    it('a refusal is shown in the server’s words, and the question stays open', async () => {
      const err = new AxiosError('Request failed with status code 404');
      err.response = {
        status: 404,
        statusText: 'Not Found',
        headers: {},
        config: { headers: new AxiosHeaders() },
        data: { error: 'not_a_cirrux_account', reason: 'No Cirrux destination with that id is on your Accounts page.' },
      };
      cirruxDriveDisconnect.mockRejectedValue(err);
      const onChanged = vi.fn();
      wrap(locale, <CirruxDrivePanel connection={account(CONNECTED)} onChanged={onChanged} />);
      fireEvent.click(await screen.findByRole('button', { name: words(locale, 'account.cirrux.disconnect') }));
      fireEvent.click(screen.getByRole('button', { name: words(locale, 'account.cirrux.disconnect.yes') }));
      expect(await screen.findByRole('alert')).toHaveProperty(
        'textContent',
        'No Cirrux destination with that id is on your Accounts page.',
      );
      expect(screen.getByRole('alertdialog')).toBeTruthy();
      expect(onChanged).not.toHaveBeenCalled();
    });
  });
});
