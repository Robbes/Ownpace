// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

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
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { AxiosError, AxiosHeaders } from 'axios';
import { credentialFieldsFor, wizardTypeForConnectionKind } from '@openmig/shared';
import type { ConnectionSummary } from '../services/mapping-service';
import { STRINGS } from '../i18n/strings';

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

const { list, test: testConnection, rotate, remove } = vi.hoisted(() => ({
  list: vi.fn(),
  test: vi.fn(),
  rotate: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('../services/mapping-service', () => ({
  connectionsApi: { list, test: testConnection, rotate, remove },
}));

import Connections from './Connections';

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
  remove.mockReset();
});

describe('the connections screen', () => {
  it('says how many mailboxes depend on a connection — whether it matters', async () => {
    list.mockResolvedValue([conn()]);
    renderPage();

    expect(await screen.findByText('Acme migration (source)')).toBeTruthy();
    expect(screen.getByText(/3 mailbox\(es\) use this/)).toBeTruthy();
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
