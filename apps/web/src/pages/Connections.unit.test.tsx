// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The connections screen (workplan 0062).
 *
 * The value of this page is the Test button and what it shows: a provider
 * refusal is the ANSWER somebody came for, so it must render as readable text
 * rather than vanish, and it must be the provider's own sentence rather than
 * a rephrasing of it (hard rule 9). The usage count is the other half — it
 * says whether a broken connection matters.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { AxiosError, AxiosHeaders } from 'axios';
import { credentialFieldsFor, wizardTypeForConnectionKind } from '@openmig/shared';
import type { ConnectionSummary } from '../services/mapping-service.ts';
import { STRINGS } from '../i18n/strings.ts';

/** An axios-shaped 400, the way the real apiClient delivers a refusal. */
const axiosStatus = (status: number, statusText: string, data: unknown): AxiosError => {
  const err = new AxiosError(`Request failed with status code ${status}`);
  err.response = {
    status,
    statusText,
    headers: {},
    config: { headers: new AxiosHeaders() },
    data,
  };
  return err;
};
const axios409 = (data: unknown): AxiosError => axiosStatus(409, 'Conflict', data);
const axios400 = (data: unknown): AxiosError => {
  const err = new AxiosError('Request failed with status code 400');
  err.response = {
    status: 400,
    statusText: 'Bad Request',
    headers: {},
    config: { headers: new AxiosHeaders() },
    data,
  };
  return err;
};

const {
  list,
  test: testConnection,
  rotate,
  remove,
  add,
  providerClients,
  googleAuthorize,
  dropboxAuthorize,
} = vi.hoisted(() => ({
  list: vi.fn(),
  test: vi.fn(),
  rotate: vi.fn(),
  remove: vi.fn(),
  add: vi.fn(),
  // Which OAuth applications the deployment carries (ADR-0041), one fact
  // per provider, as the add-form reads them. Neither by default: the pair
  // stays in plain view, as on an appliance.
  providerClients: vi.fn(),
  googleAuthorize: vi.fn(),
  dropboxAuthorize: vi.fn(),
}));

vi.mock('../services/mapping-service', () => ({
  connectionsApi: { list, test: testConnection, rotate, remove, add },
  providerClientsApi: { get: providerClients },
  mappingApi: { googleAuthorize, dropboxAuthorize },
}));

import Connections from './Connections.tsx';

const conn = (over: Partial<ConnectionSummary> = {}): ConnectionSummary => ({
  id: 'c1',
  role: 'source',
  kind: 'box',
  displayName: 'Acme migration (source)',
  status: 'connected',
  createdAt: '2026-08-01T10:00:00Z',
  usedByMailboxes: 3,
  ...over,
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Connections />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  list.mockReset();
  testConnection.mockReset();
  rotate.mockReset();
  providerClients.mockReset().mockResolvedValue({ google: 'connection', dropbox: 'connection' });
  googleAuthorize.mockReset();
  dropboxAuthorize.mockReset();
  add.mockReset();
  remove.mockReset();
});

describe('the connections screen', () => {
  it('says how many migrations depend on a connection — whether it matters', async () => {
    // Migrations, not mailboxes (owner remark 2026-09-02): a Dropbox
    // connection carries files and a Google account four faces. And none
    // yet is a sentence, never "0 … use this".
    list.mockResolvedValue([conn(), conn({ id: 'c2', displayName: 'Spare', usedByMailboxes: 0 })]);
    renderPage();

    expect(await screen.findByText('Acme migration (source)')).toBeTruthy();
    expect(screen.getByText(/3 migration\(s\) use this/)).toBeTruthy();
    expect(screen.getByText('Not used by any migration yet')).toBeTruthy();
    expect(screen.queryByText(/mailbox/)).toBeNull();
  });

  it('says when the door answered before the measuring finished (2026-09-02)', async () => {
    list.mockResolvedValue([conn()]);
    testConnection.mockResolvedValue({ ok: true, detail: 'reachable', qualificationPending: true });
    renderPage();

    fireEvent.click(await screen.findByText('Test'));

    expect(await screen.findByText(/Still measuring what this account can carry/)).toBeTruthy();
  });

  it("shows a refusal VERBATIM — that sentence is what somebody came to find out", async () => {
    list.mockResolvedValue([conn()]);
    testConnection.mockResolvedValue({
      ok: false,
      reason:
        'Box refused the token request (400): unauthorized_client — a Box admin must authorise ' +
        'the app in the Admin Console.',
    });
    renderPage();

    fireEvent.click(await screen.findByText('Test'));

    expect(await screen.findByText(/a Box admin must authorise the app/)).toBeTruthy();
  });

  it('a success is shown too, so "I tested it" has evidence', async () => {
    list.mockResolvedValue([conn()]);
    testConnection.mockResolvedValue({ ok: true, detail: 'Listed 12 folders.' });
    renderPage();

    fireEvent.click(await screen.findByText('Test'));

    expect(await screen.findByText('Listed 12 folders.')).toBeTruthy();
  });

  it('a thrown error still reaches the person rather than disappearing', async () => {
    list.mockResolvedValue([conn()]);
    testConnection.mockRejectedValue(new Error('Network is unreachable'));
    renderPage();

    fireEvent.click(await screen.findByText('Test'));

    expect(await screen.findByText(/Network is unreachable/)).toBeTruthy();
  });

  it('offers the provider setup steps beside each connection', async () => {
    list.mockResolvedValue([conn()]);
    renderPage();

    const link = (await screen.findByText('Setup steps')) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/setup/source/box');
  });

  it('an empty tenant says so instead of rendering nothing', async () => {
    list.mockResolvedValue([]);
    renderPage();

    expect(await screen.findByText(/No connections yet/)).toBeTruthy();
  });
});

describe('replacing credentials', () => {
  it('never re-asks where the migration is rooted', async () => {
    // Rotation replaces a credential, not a root folder — re-presenting the
    // latter invites somebody to change it while fixing a login (0065).
    list.mockResolvedValue([conn({ kind: 'box' })]);
    renderPage();

    fireEvent.click(await screen.findByText('Replace credentials'));

    expect(screen.getByText(/Source client secret/)).toBeTruthy();
    expect(screen.queryByText(/Root folder id/), 'config is not re-asked').toBeNull();
  });

  /**
   * The rule this table exists for (workplan 0071): **a rotate panel must
   * render every field the rotate route requires.**
   *
   * It did not. The panel asked for `f.secret || f.key === 'username'`, and
   * the route validates every `f.required` — so Dropbox's App key, which is
   * required and not secret, had no input and the refusal read
   * `Still needed: clientId.` beside a form with no such box. Rotation was
   * impossible for box, dropbox, graph, oauth2, imap and EVERY target; only
   * the four Google types worked, and only because their client id is
   * optional. The owner found it on Dropbox.
   *
   * This is the fourth time a gate has demanded a field its screen does not
   * render (0037 T1, 0067 T1, 0067 T2), and the first three were each fixed
   * by hand for the one provider that surfaced it. Hence a table over every
   * stored `connection.kind` rather than a case: adding a provider whose
   * required fields the panel cannot supply fails HERE.
   */
  const KINDS: { kind: string; role: 'source' | 'target' }[] = [
    { kind: 'imap', role: 'source' },
    { kind: 'o365', role: 'source' },
    { kind: 'google_drive', role: 'source' },
    { kind: 'gmail', role: 'source' },
    { kind: 'google_calendar', role: 'source' },
    { kind: 'google_contacts', role: 'source' },
    { kind: 'dropbox', role: 'source' },
    { kind: 'box', role: 'source' },
    { kind: 'jmap', role: 'target' },
    { kind: 'imap', role: 'target' },
    { kind: 'caldav', role: 'target' },
    { kind: 'carddav', role: 'target' },
    { kind: 'webdav', role: 'target' },
  ];

  it.each(KINDS)('$role/$kind renders every field its rotate would require', async ({ kind, role }) => {
    list.mockResolvedValue([conn({ kind, role })]);
    renderPage();

    fireEvent.click(await screen.findByText('Replace credentials'));

    // Exactly the server's own rule, read from the same descriptor the route
    // reads — not a list copied into this test to agree by hand.
    const required = credentialFieldsFor(role, wizardTypeForConnectionKind(kind)).filter(
      (f) => f.required,
    );
    expect(required.length, `${kind} declares no required fields`).toBeGreaterThan(0);
    for (const field of required) {
      expect(
        screen.queryAllByText(STRINGS.en[field.labelKey as keyof typeof STRINGS.en]).length,
        `rotating a ${kind} ${role} would be refused for '${field.key}', which this panel never asks for`,
      ).toBeGreaterThan(0);
    }
  });

  it('offers a Google client id BESIDE its secret, so a rotated pair is a pair (ADR-0041)', async () => {
    // The id is neither required nor secret since the deployment may carry
    // the client, so "required or secret" dropped it — and a new secret typed
    // here travelled alone, to a door that refuses half a pair. Read from the
    // descriptor's `pairedWith`, not from a Google list kept in this page.
    list.mockResolvedValue([conn({ kind: 'gmail', role: 'source' })]);
    renderPage();
    fireEvent.click(await screen.findByText('Replace credentials'));

    expect(screen.queryAllByText(STRINGS.en['wizard.clientId']).length).toBeGreaterThan(0);
    expect(screen.queryAllByText(STRINGS.en['wizard.sourceClientSecret']).length).toBeGreaterThan(0);
  });

  it('starts from what the connection already knows (0078)', async () => {
    // Rotating an expired secret meant retyping the server address and the
    // account that had not changed. Only NON-SECRET config values arrive —
    // the encrypted record is never opened — so the secrets stay blank, which
    // is the half this test also pins.
    list.mockResolvedValue([
      conn({
        kind: 'jmap',
        role: 'target',
        knownValues: { host: 'stalwart.acme.example', port: '443', username: 'anna@acme.net' },
      }),
    ]);
    renderPage();

    fireEvent.click(await screen.findByText('Replace credentials'));

    expect(screen.getByDisplayValue('stalwart.acme.example')).toBeTruthy();
    expect(screen.getByDisplayValue('443')).toBeTruthy();
    expect(screen.getByDisplayValue('anna@acme.net')).toBeTruthy();
    // The password is what you came to change, and nothing pretends to know it.
    const password = document.querySelector('input[type="password"]') as HTMLInputElement;
    expect(password.value, 'a secret must never be prefilled').toBe('');
  });

  it('shows the same example the wizard does (0077)', async () => {
    // Somebody adding a Dropbox connection here was asked for an "App key"
    // with no indication of what one looks like, while the same field two
    // screens away showed a shape. Since 0075 the examples live on the
    // descriptor, so both doors read them instead of one door owning them.
    list.mockResolvedValue([conn({ kind: 'dropbox' })]);
    renderPage();

    fireEvent.click(await screen.findByText('Replace credentials'));

    expect(screen.getByPlaceholderText('user@example.com')).toBeTruthy();
    expect(screen.getByPlaceholderText('1//…')).toBeTruthy();
  });

  it('names the missing field the way the FORM does, not the way the database does', async () => {
    // `Still needed: clientId.` in a Dutch UI, beside an input labelled
    // App-sleutel (workplan 0071). The keys are the handle; the labels are
    // what a person can act on, and they already exist in both locales.
    list.mockResolvedValue([conn({ kind: 'dropbox' })]);
    rotate.mockRejectedValue(
      axios400({ error: 'missing_fields', fields: ['clientId'], reason: 'Still needed: clientId.' }),
    );
    renderPage();

    fireEvent.click(await screen.findByText('Replace credentials'));
    fireEvent.click(screen.getByText('Check and replace'));

    expect(await screen.findByText(/App key/)).toBeTruthy();
    expect(screen.queryByText(/clientId/), 'a storage key is not a field name').toBeNull();
  });

  it('names the field the FORM does when a value is the wrong shape (0072)', async () => {
    // `port: Invalid input: expected number, received NaN` — a zod path and a
    // zod sentence, in English, naming a storage key. The owner met it adding
    // a target connection.
    list.mockResolvedValue([conn({ kind: 'jmap', role: 'target' })]);
    rotate.mockRejectedValue(
      axios400({
        error: 'invalid_values',
        fields: ['port'],
        reason: 'port: Invalid input: expected number, received NaN',
      }),
    );
    renderPage();

    fireEvent.click(await screen.findByText('Replace credentials'));
    fireEvent.click(screen.getByText('Check and replace'));

    // The whole sentence: 'Port' alone also matches the field's own label.
    expect(
      await screen.findByText(`${STRINGS.en['connections.invalidValues.lead']} Port`),
    ).toBeTruthy();
    expect(screen.queryByText(/received NaN/), 'a zod path is not a field name').toBeNull();
  });

  it('keeps the OLD credentials when the new ones do not work', async () => {
    list.mockResolvedValue([conn()]);
    rotate.mockResolvedValue({
      ok: false,
      rotated: false,
      reason: 'Box refused the token request (400): invalid_client.',
    });
    renderPage();

    fireEvent.click(await screen.findByText('Replace credentials'));
    fireEvent.click(screen.getByText('Check and replace'));

    // The provider's words, and nothing silently swapped underneath.
    expect(await screen.findByText(/invalid_client/)).toBeTruthy();
    expect(screen.getByText('Check and replace'), 'the form stays open to retry').toBeTruthy();
  });

  it('closes and refreshes once the new credentials prove out', async () => {
    list.mockResolvedValue([conn()]);
    rotate.mockResolvedValue({ ok: true, rotated: true, detail: 'Listed 12 folders.' });
    renderPage();

    fireEvent.click(await screen.findByText('Replace credentials'));
    fireEvent.click(screen.getByText('Check and replace'));

    await waitFor(() => expect(screen.queryByText('Check and replace')).toBeNull());
  });
});

describe('deleting a connection', () => {
  it('renders OUR frame around the SERVER\'s names, so it can be read in Dutch', async () => {
    // 0068 T4 was right that this refusal must answer why, what to do first
    // and where. It shipped as one English paragraph on the route, which is
    // how a Dutch operator got five clauses of English (workplan 0071). The
    // migrations are the finding and render verbatim; the sentence is ours.
    list.mockResolvedValue([conn({ usedByMailboxes: 3 })]);
    remove.mockRejectedValue(
      axios409({
        error: 'in_use',
        migrations: ['Acme mail', 'Acme files'],
        used: 3,
        reason: 'This connection is still used by “Acme mail”, “Acme files”.',
      }),
    );
    renderPage();

    fireEvent.click(await screen.findByText('Delete'));

    // The names, verbatim — a person can go and act on those.
    expect(await screen.findByText(/Acme mail/)).toBeTruthy();
    expect(screen.getByText(/Acme files/)).toBeTruthy();
    // ...and the frame is the dictionary's, which is what makes it Dutch
    // under nl rather than a paragraph nobody translated.
    expect(screen.getByText(new RegExp(STRINGS.en['connections.inUse.why']))).toBeTruthy();
  });

  it('says it in Dutch even when the migration has no name (0072)', async () => {
    // `mailbox_mapping.name` is nullable — the appliance writes rows without
    // one — so `migrations` can be shorter than `used`. Falling back to the
    // server's English sentence for that case put the reader back in English
    // for the case they were most likely to meet.
    list.mockResolvedValue([conn({ usedByMailboxes: 1 })]);
    remove.mockRejectedValue(
      axios409({
        error: 'in_use',
        migrations: [],
        used: 1,
        reason: 'This connection is still used by 1 mailbox.',
      }),
    );
    renderPage();

    fireEvent.click(await screen.findByText('Delete'));

    expect(await screen.findByText(new RegExp(STRINGS.en['connections.inUse.unnamed']))).toBeTruthy();
    expect(screen.getByText(new RegExp(STRINGS.en['connections.inUse.why']))).toBeTruthy();
    // The server's English sentence must NOT be what reaches the screen.
    expect(screen.queryByText(/still used by 1 mailbox/)).toBeNull();
  });

  it("refuses while anything uses it, and names what — not a flat no", async () => {
    // The cascade is the reason: mailbox.connection_id cascades and item hangs
    // off the mailboxes, so deleting one in use would take the migration
    // ledger with it silently (workplan 0066).
    list.mockResolvedValue([conn({ usedByMailboxes: 3 })]);
    remove.mockRejectedValue(
      new Error('3 mailbox(es) still use this connection (Acme mail). Deleting it would take their migration history with it, so remove those migrations first.'),
    );
    renderPage();

    fireEvent.click(await screen.findByText('Delete'));

    expect(await screen.findByText(/Acme mail/)).toBeTruthy();
    expect(screen.getByText(/migration history/)).toBeTruthy();
  });

  it('deletes one nothing depends on, and refreshes', async () => {
    list.mockResolvedValue([conn({ usedByMailboxes: 0 })]);
    remove.mockResolvedValue(undefined);
    renderPage();

    fireEvent.click(await screen.findByText('Delete'));

    await waitFor(() => expect(remove).toHaveBeenCalledWith('c1'));
  });
});

/**
 * THE SAME DOOR THE WIZARD DRAWS (workplan 0107; owner remark 2026-09-01).
 *
 * The add-form used to be two drop-downs — "the same authority, rendered
 * plainly" — which, beside the wizard's cards, read as a different product. It
 * now renders the wizard's own chooser. What is pinned here is that picking a
 * card does what picking the option did: the chosen provider's OWN fields
 * appear, read from the same descriptor the server reads, and switching the
 * side switches the cards.
 */
describe('adding a connection through the front door', () => {
  const open = async () => {
    list.mockResolvedValue([]);
    renderPage();
    fireEvent.click(await screen.findByText('Add a connection'));
  };

  it('offers the wizard’s cards, grouped the wizard’s way', async () => {
    await open();
    // A family heading, a provider card and a protocol card — the three
    // shapes the wizard's chooser draws, and a `<select>` has none of them.
    expect(screen.getByText('Your provider')).toBeTruthy();
    expect(screen.getByText('Any server, by protocol')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Google account/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^IMAP/ })).toBeTruthy();
  });

  it('picking a card asks for that provider’s own fields', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: /^Gmail/ }));
    // Exactly the server's rule, from the same descriptor — not a list copied
    // into this test to agree by hand.
    for (const field of credentialFieldsFor('source', 'gmail').filter((f) => f.required)) {
      expect(
        screen.queryAllByText(STRINGS.en[field.labelKey as keyof typeof STRINGS.en]).length,
        `gmail's '${field.key}' is not asked for after picking its card`,
      ).toBeGreaterThan(0);
    }
  });

  it('folds the Google client pair away where the deployment carries the client (ADR-0041)', async () => {
    // The owner's remark of 2026-09-02: on a managed deployment a person
    // grants Ownpace's own application; "use your own" is the exception. So
    // the pair sits behind a disclosure, both halves inside it, and the
    // default form is the address and the token. Which kinds fold is the
    // descriptor's answer — an id paired with its secret — not a list here.
    providerClients.mockResolvedValue({ google: 'deployment', dropbox: 'connection' });
    await open();
    fireEvent.click(screen.getByRole('button', { name: /^Gmail/ }));
    const fold = (
      await screen.findByText('Use your own Google application instead')
    ).closest('details');
    expect(fold).not.toBeNull();
    expect(fold).toContainElement(screen.getByPlaceholderText('…apps.googleusercontent.com'));
    expect(fold).toContainElement(screen.getByPlaceholderText('••••••••'));
    // The address stays in plain view — it is what the fold is not about.
    expect(screen.getByPlaceholderText('user@example.com').closest('details')).toBeNull();
  });

  it('offers Connect with Google where the deployment carries the client, and the token it hands back lands inside the fold', async () => {
    // Owner step 4, 2026-09-02: the fold took the pair away (#709) and left
    // no way to obtain the token — on a managed deployment this door's Gmail
    // and Drive paths were dead ends. The wizard's consent, on this door.
    providerClients.mockResolvedValue({ google: 'deployment', dropbox: 'connection' });
    googleAuthorize.mockResolvedValue({
      url: 'https://accounts.google.com/o/oauth2/v2/auth?scope=x',
      redirectUri: 'https://app.example.test/api/migrations/google/callback',
      scope: 'x',
    });
    const opened = vi.spyOn(window, 'open').mockReturnValue(null);
    try {
      add.mockResolvedValue({ ok: true, id: 'c1', detail: 'reachable' });
      await open();
      fireEvent.click(screen.getByRole('button', { name: /^Gmail/ }));
      fireEvent.change(screen.getByPlaceholderText('user@example.com'), {
        target: { value: 'owner@gmail.com' },
      });
      const button = await screen.findByRole('button', { name: /Connect with Google/ });
      await waitFor(() => expect(button).toBeEnabled());
      // The token box is inside the fold, with the pair — not above it with
      // an asterisk, asking for what the button supplies.
      const fold = screen.getByText('Use your own Google application instead').closest('details');
      expect(fold).toContainElement(screen.getByPlaceholderText('1//…'));

      fireEvent.click(button);
      await waitFor(() => expect(googleAuthorize).toHaveBeenCalled());
      // The deployment's client: no pair sent, not even empty strings.
      expect(googleAuthorize.mock.calls[0]![0]).toEqual({ sourceType: 'gmail' });
      expect(opened).toHaveBeenCalled();

      // The popup hands the token back; same origin, the flow's own shape.
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'ownpace-google-consent', refreshToken: '1//granted' },
          origin: window.location.origin,
        }),
      );
      await screen.findByText(/Consent received/);
      expect((screen.getByPlaceholderText('1//…') as HTMLInputElement).value).toBe('1//granted');
      // …and it is saved and tested in one go (owner remark 2026-09-02): no
      // second press, the address as the name where none was typed.
      await waitFor(() => expect(add).toHaveBeenCalled());
      expect(add.mock.calls[add.mock.calls.length - 1]![0]).toMatchObject({
        role: 'source',
        type: 'gmail',
        displayName: 'owner@gmail.com',
        values: { username: 'owner@gmail.com', refreshToken: '1//granted' },
      });
      await screen.findByText(/reachable/);
    } finally {
      opened.mockRestore();
    }
  });

  it('the account kind asks for the faces ticked, and nothing with none ticked', async () => {
    providerClients.mockResolvedValue({ google: 'deployment', dropbox: 'connection' });
    googleAuthorize.mockResolvedValue({ url: 'https://accounts.google.com/x', redirectUri: 'r', scope: 'x' });
    const opened = vi.spyOn(window, 'open').mockReturnValue(null);
    try {
      await open();
      fireEvent.click(screen.getByRole('button', { name: /^Google account/ }));
      fireEvent.change(screen.getByPlaceholderText('user@example.com'), {
        target: { value: 'owner@gmail.com' },
      });
      const button = await screen.findByRole('button', { name: /Connect with Google/ });
      // A connection has no mapping to read the faces from, so it asks; with
      // none ticked there is nothing to ask Google for.
      await screen.findByText('What this account will serve');
      expect(button).toBeDisabled();
      fireEvent.click(screen.getByLabelText('Calendar'));
      await waitFor(() => expect(button).toBeEnabled());
      fireEvent.click(button);
      await waitFor(() => expect(googleAuthorize).toHaveBeenCalled());
      expect(googleAuthorize.mock.calls[0]![0]).toEqual({ domains: ['calendar'] });
    } finally {
      opened.mockRestore();
    }
  });

  it('where each connection brings its own client, the button waits for the whole pair', async () => {
    googleAuthorize.mockResolvedValue({ url: 'https://accounts.google.com/x', redirectUri: 'r', scope: 'x' });
    const opened = vi.spyOn(window, 'open').mockReturnValue(null);
    try {
      await open();
      fireEvent.click(screen.getByRole('button', { name: /^Gmail/ }));
      fireEvent.change(screen.getByPlaceholderText('user@example.com'), {
        target: { value: 'owner@gmail.com' },
      });
      const button = screen.getByRole('button', { name: /Connect with Google/ });
      expect(button).toBeDisabled();
      fireEvent.change(screen.getByPlaceholderText('…apps.googleusercontent.com'), {
        target: { value: 'cid.apps.googleusercontent.com' },
      });
      // Half a pair is still no pair (ADR-0041).
      expect(button).toBeDisabled();
      fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'shh' } });
      expect(button).toBeEnabled();
      fireEvent.click(button);
      await waitFor(() => expect(googleAuthorize).toHaveBeenCalled());
      expect(googleAuthorize.mock.calls[0]![0]).toEqual({
        sourceType: 'gmail',
        clientId: 'cid.apps.googleusercontent.com',
        clientSecret: 'shh',
      });
    } finally {
      opened.mockRestore();
    }
  });

  it('keeps the pair in plain view where each connection brings its own', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: /^Gmail/ }));
    expect(screen.queryByText('Use your own Google application instead')).toBeNull();
    expect(screen.getByPlaceholderText('…apps.googleusercontent.com').closest('details')).toBeNull();
  });

  it('offers Connect with Dropbox where the deployment carries a Dropbox app, folds the App key pair away, and a consent that lands saves and tests in one go', async () => {
    // Owner ask 2026-09-02: "add the grant button for Dropbox, similar to how
    // we now have Google". Which kinds have a button is the descriptor's
    // answer (`consent` on the token field), so Dropbox's arrival changed no
    // list in this page — and the fact is Dropbox's own: a deployment with
    // no Google client and a Dropbox app folds Dropbox's pair, not Google's.
    providerClients.mockResolvedValue({ google: 'connection', dropbox: 'deployment' });
    dropboxAuthorize.mockResolvedValue({
      url: 'https://www.dropbox.com/oauth2/authorize?client_id=x&token_access_type=offline',
      redirectUri: 'https://app.example.test/api/migrations/dropbox/callback',
    });
    const opened = vi.spyOn(window, 'open').mockReturnValue(null);
    try {
      add.mockResolvedValue({ ok: true, id: 'c2', detail: 'reachable' });
      await open();
      fireEvent.click(screen.getByRole('button', { name: /^Dropbox/ }));
      fireEvent.change(screen.getByPlaceholderText('user@example.com'), {
        target: { value: 'owner@example.invalid' },
      });
      const button = await screen.findByRole('button', { name: /Connect with Dropbox/ });
      await waitFor(() => expect(button).toBeEnabled());
      expect(screen.queryByRole('button', { name: /Connect with Google/ })).toBeNull();
      // Dropbox's words on the fold, and the App key, its secret and the
      // token inside it — the same fold Google's kinds get, in its words.
      const fold = screen.getByText('Use your own Dropbox app instead').closest('details');
      expect(fold).not.toBeNull();
      expect(fold).toHaveTextContent(/has its own Dropbox app/);
      expect(fold).toContainElement(screen.getByLabelText(/App key/));
      expect(fold).toContainElement(screen.getByPlaceholderText('••••••••'));
      expect(fold).toContainElement(screen.getByPlaceholderText('1//…'));

      fireEvent.click(button);
      await waitFor(() => expect(dropboxAuthorize).toHaveBeenCalled());
      // The deployment's app: no pair sent, not even empty strings — and
      // Dropbox's route, never Google's.
      expect(dropboxAuthorize.mock.calls[0]![0]).toEqual({});
      expect(googleAuthorize).not.toHaveBeenCalled();
      expect(opened.mock.calls[0]?.[1]).toBe('ownpace-dropbox-consent');

      // A Google popup's message is not this form's: same origin, wrong flow.
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'ownpace-google-consent', refreshToken: 'not-for-dropbox' },
          origin: window.location.origin,
        }),
      );
      await act(async () => {});
      expect((screen.getByPlaceholderText('1//…') as HTMLInputElement).value).toBe('');
      expect(add).not.toHaveBeenCalled();

      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'ownpace-dropbox-consent', refreshToken: 'dbx-granted' },
          origin: window.location.origin,
        }),
      );
      await screen.findByText(/Consent received/);
      expect((screen.getByPlaceholderText('1//…') as HTMLInputElement).value).toBe('dbx-granted');
      // Saved and tested in one go, the address as the name; the connection
      // stores neither half of the pair (ADR-0041).
      await waitFor(() => expect(add).toHaveBeenCalled());
      const saved = add.mock.calls[add.mock.calls.length - 1]![0];
      expect(saved).toMatchObject({
        role: 'source',
        type: 'dropbox',
        displayName: 'owner@example.invalid',
        values: { username: 'owner@example.invalid', refreshToken: 'dbx-granted' },
      });
      expect(saved.values).not.toHaveProperty('clientId');
      expect(saved.values).not.toHaveProperty('clientSecret');
      await screen.findByText(/reachable/);
    } finally {
      opened.mockRestore();
    }
  });

  it('where each connection brings its own Dropbox app, the button waits for the whole pair and sends it', async () => {
    dropboxAuthorize.mockResolvedValue({ url: 'https://www.dropbox.com/oauth2/authorize', redirectUri: 'r' });
    const opened = vi.spyOn(window, 'open').mockReturnValue(null);
    try {
      await open();
      fireEvent.click(screen.getByRole('button', { name: /^Dropbox/ }));
      fireEvent.change(screen.getByPlaceholderText('user@example.com'), {
        target: { value: 'owner@example.invalid' },
      });
      const button = screen.getByRole('button', { name: /Connect with Dropbox/ });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute(
        'title',
        expect.stringContaining('Enter the App key and App secret first'),
      );
      // No fold: the pair is required here, so it is in plain view.
      expect(screen.queryByText('Use your own Dropbox app instead')).toBeNull();
      expect(screen.getByLabelText(/App key/).closest('details')).toBeNull();
      fireEvent.change(screen.getByLabelText(/App key/), { target: { value: 'dbx-app-key' } });
      // Half a pair is still no pair (ADR-0041).
      expect(button).toBeDisabled();
      fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'dbx-app-secret' } });
      expect(button).toBeEnabled();
      fireEvent.click(button);
      await waitFor(() => expect(dropboxAuthorize).toHaveBeenCalled());
      expect(dropboxAuthorize.mock.calls[0]![0]).toEqual({
        clientId: 'dbx-app-key',
        clientSecret: 'dbx-app-secret',
      });
    } finally {
      opened.mockRestore();
    }
  });

  it('waits for the account address before offering the consent (the owner’s walk, 2026-09-02)', async () => {
    // The consent saves and tests in one go, and the save needs the address:
    // pressed before it was typed, the door answered "Still needed: username"
    // to a form whose button had just said yes.
    providerClients.mockResolvedValue({ google: 'connection', dropbox: 'deployment' });
    await open();
    fireEvent.click(screen.getByRole('button', { name: /^Dropbox/ }));
    const button = await screen.findByRole('button', { name: /Connect with Dropbox/ });
    await act(async () => {});
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', expect.stringContaining('Enter the account address first'));
    fireEvent.change(screen.getByPlaceholderText('user@example.com'), {
      target: { value: 'owner@example.invalid' },
    });
    await waitFor(() => expect(button).toBeEnabled());
  });

  it('switching the side switches the cards', async () => {
    await open();
    fireEvent.click(screen.getByRole('radio', { name: 'Targets' }));
    expect(screen.getByRole('button', { name: /^JMAP/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Soverin/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Gmail/ })).toBeNull();
  });
});

describe('why a face is `?` is on screen, not in a hover (owner 2026-09-02)', () => {
  const REFUSAL =
    'The grant carries https://www.googleapis.com/auth/carddav, but the face did not answer: ' +
    'PROPFIND failed with status 403: accessNotConfigured — Google Contacts CardDAV API has not ' +
    'been used in project 123 before or it is disabled. Enable it by visiting ' +
    'https://console.developers.google.com/apis/api/carddav.googleapis.com/overview?project=123 then retry.';
  const qualification = {
    domains: {
      mail: { answer: 'yes' as const, detail: '29 folders visible.', count: 29, unit: 'folder' as const },
      calendar: { answer: 'yes' as const, detail: '5 calendars visible.', count: 5, unit: 'calendar' as const },
      contact: { answer: 'unknown' as const, detail: REFUSAL },
      file: { answer: 'yes' as const, detail: '3 folders visible.', count: 3, unit: 'folder' as const },
    },
  };

  it('the test panel shows the sentence behind the `?` — the owner read "Contacts ?" on a phone and could not learn which switch to flip', async () => {
    list.mockResolvedValue([conn({ kind: 'google', role: 'source' })]);
    testConnection.mockResolvedValue({
      ok: true,
      detail: 'Connected. 5 calendars visible.',
      outcome: { code: 'connected', count: 5, unit: 'calendar' },
      qualification,
    });
    renderPage();

    fireEvent.click(await screen.findByText('Test'));

    expect(await screen.findByText(/Can carry: Email ✓ 29 folders · Calendar ✓ 5 calendars · Contacts \? · Files ✓ 3 folders/)).toBeTruthy();
    expect(screen.getByText(/^Contacts \?: .*Google Contacts CardDAV API has not been used/)).toBeTruthy();
  });

  it('the card shows it too, without pressing Test — the stored record is what a phone opens first', async () => {
    list.mockResolvedValue([conn({ kind: 'google', role: 'source', qualification })]);
    renderPage();

    expect(await screen.findByText(/^Contacts \?: .*carddav\.googleapis\.com/)).toBeTruthy();
  });
});

describe('the measured-volume line (2026-09-02)', () => {
  it('the test panel says how much each reached face holds, beside what it can carry', async () => {
    list.mockResolvedValue([conn({ kind: 'google', role: 'source' })]);
    testConnection.mockResolvedValue({
      ok: true,
      detail: 'Connected. 5 calendars visible.',
      qualification: {
        domains: {
          mail: { answer: 'yes', detail: 'x', count: 29, unit: 'folder', volume: { items: 12400, bytes: 3_400_000_000, estimated: true } },
          calendar: { answer: 'yes', detail: 'x', count: 5, unit: 'calendar' },
          contact: { answer: 'yes', detail: 'x', count: 1, unit: 'addressBook', volume: { items: 412 } },
          file: { answer: 'yes', detail: 'x', count: 6, unit: 'folder', volume: { bytes: 1_900_000_000, nativeFilesExcluded: true } },
        },
      },
    });
    renderPage();

    fireEvent.click(await screen.findByText('Test'));

    expect(await screen.findByText(/Measured: Email 12,400 messages ≈ 3.2 GB/)).toBeTruthy();
    expect(screen.getByText(/Contacts 412 cards/)).toBeTruthy();
    expect(screen.getByText(/Files 1.8 GB \(Docs, Sheets and Slides not counted\)/)).toBeTruthy();
    // The capability line is still its own line.
    expect(screen.getByText(/Can carry: Email ✓ 29 folders/)).toBeTruthy();
  });
});
