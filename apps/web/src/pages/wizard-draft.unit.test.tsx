// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
/**
 * The wizard remembers the cheap half and never the secrets (workplan 0069).
 *
 * The owner asked for intermediate storage after losing a half-finished wizard
 * on a phone. The answer has two halves, and only one of them is this file's
 * business:
 *
 *  - The **credentials** are kept by testing them, which now saves a stored
 *    connection (`runProbes`). They never enter web storage at all.
 *  - The **rest** — a name, which accounts, the domains, a schedule — goes to
 *    `sessionStorage`, because it is seconds to retype and worth nothing to
 *    anybody who reads it.
 *
 * The test that matters is the second one. Writing a client secret or a mailbox
 * password into `sessionStorage` would put a credential where every script on
 * the page can read it, when the product's whole posture is that secrets live
 * encrypted and server-side. A future field added to the wizard must not drift
 * into the draft by accident, so this asserts on the STORED PAYLOAD rather than
 * on the allow-list that produced it.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import CreateMapping from './CreateMapping';
import { connectionsApi } from '../services/mapping-service';

vi.mock('../services/mapping-service', () => ({
  mappingApi: { create: vi.fn(), testConnection: vi.fn() },
  connectionsApi: { list: vi.fn().mockResolvedValue([]), add: vi.fn(), rotate: vi.fn() },
}));

const DRAFT_KEY = 'wizard.draft.v1';

/** Every secret the wizard can hold, and a value unique enough to grep for. */
const SECRETS = {
  sourcePassword: 'SRC-PASSWORD-a1b2c3',
  sourceClientSecret: 'SRC-CLIENT-SECRET-d4e5f6',
  sourceRefreshToken: 'SRC-REFRESH-TOKEN-g7h8i9',
  sourceServiceAccountKey: 'SRC-SERVICE-ACCOUNT-KEY-j1k2l3',
  targetPassword: 'TGT-PASSWORD-m4n5o6',
};

const renderWizard = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={['/mappings/new']}>
        <Routes>
          <Route path="/mappings/new" element={<CreateMapping />} />
          <Route path="/mappings/:mappingId/confirm" element={<div>confirm-route</div>} />
          <Route path="/mappings" element={<div>mappings-list-route</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

const draft = () => globalThis.sessionStorage.getItem(DRAFT_KEY);

beforeEach(() => {
  globalThis.sessionStorage.clear();
  vi.mocked(connectionsApi.list).mockResolvedValue([]);
});

describe('the wizard draft', () => {
  it('remembers what was typed on the first step', async () => {
    renderWizard();
    fireEvent.change(screen.getByPlaceholderText('imap.example.com'), {
      target: { value: 'mail.acme.example' },
    });
    await waitFor(() => expect(draft()).toContain('mail.acme.example'));
  });

  it('restores it into a freshly mounted wizard', async () => {
    globalThis.sessionStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({ sourceHost: 'restored.acme.example', name: 'Acme mail' }),
    );
    renderWizard();
    await waitFor(() =>
      expect((screen.getByPlaceholderText('imap.example.com') as HTMLInputElement).value).toBe(
        'restored.acme.example',
      ),
    );
  });

  it('survives a malformed draft rather than breaking the wizard', async () => {
    globalThis.sessionStorage.setItem(DRAFT_KEY, '{not json');
    renderWizard();
    // The first step renders at all — that is the whole assertion.
    expect(screen.getByPlaceholderText('imap.example.com')).toBeInTheDocument();
  });

  it('NEVER writes a secret into session storage', async () => {
    renderWizard();

    // Each side carries its own credentials since workplan 0070, so the
    // secrets are typed on TWO steps rather than one. Both are covered.
    const typeEverySecret = (offset: number) => {
      const masked = document.querySelectorAll('input[type="password"]');
      expect(masked.length).toBeGreaterThan(0);
      masked.forEach((el, i) =>
        fireEvent.change(el, {
          target: { value: Object.values(SECRETS)[offset + i] ?? 'SECRET-x9y8z7' },
        }),
      );
    };

    // Step 1 — source: host, account, and every secret it renders.
    fireEvent.change(screen.getByPlaceholderText('imap.example.com'), {
      target: { value: 'mail.acme.example' },
    });
    fireEvent.change(screen.getAllByPlaceholderText('user@example.com')[0]!, {
      target: { value: 'anna@acme.example' },
    });
    typeEverySecret(0);
    await waitFor(() => expect(screen.getByRole('button', { name: /Next/ })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));

    // Step 2 — target: same again, on the other side.
    fireEvent.change(screen.getByPlaceholderText('jmap.example.com'), {
      target: { value: 'stalwart.acme.example' },
    });
    fireEvent.change(screen.getAllByPlaceholderText('user@example.com')[0]!, {
      target: { value: 'anna@acme.net' },
    });
    typeEverySecret(4);

    await waitFor(() => expect(draft()).not.toBeNull());

    const stored = draft()!;
    for (const [field, value] of Object.entries(SECRETS)) {
      expect(
        stored,
        `the draft contains ${field} — secrets must never be written here`,
      ).not.toContain(value);
    }
    // Belt and braces: nothing shaped like the marker at all.
    expect(stored).not.toMatch(/SECRET|PASSWORD|REFRESH-TOKEN|SERVICE-ACCOUNT/i);
  });
});
