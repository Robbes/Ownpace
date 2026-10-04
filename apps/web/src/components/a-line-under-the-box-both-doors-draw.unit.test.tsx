// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A LINE UNDER THE BOX, DRAWN BY BOTH DOORS (workplan 0153 D5).
 *
 * The descriptor gives some fields a line of their own (`hintKey`, 0118 T1):
 * the Apple box that is not the Apple Account password, the domain-wide key
 * that can read every user, the mail server Soverin needs only for mail. The
 * wizard drew those lines and nothing else did, so retiring it would have
 * taken them off every screen. The account form both doors draw now draws
 * them. What is pinned here:
 *
 * - every such field, on every card, shows its line on the Accounts page;
 * - *Start a migration* shows them where its form puts the field: in plain
 *   view, in *Server settings*, or behind the company question once it is
 *   answered yes;
 * - the line is the reader's language;
 * - it sits beside the box, not inside its label, so it is not read as part
 *   of the box's name.
 *
 * The cases are read from the descriptor, so a field given a line later is
 * judged here without an edit; the non-empty check keeps that from passing on
 * nothing.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { choiceDefaults, connectableTypes, credentialFieldsFor, followedField } from '@openmig/shared';

vi.mock('../services/mapping-service', () => ({
  mappingApi: {
    googleAuthorize: vi.fn(),
    dropboxAuthorize: vi.fn(),
    microsoftAuthorize: vi.fn(),
  },
  connectionsApi: { list: vi.fn(), test: vi.fn(), add: vi.fn(), rotate: vi.fn(), remove: vi.fn() },
  providerAccountsApi: { get: vi.fn().mockResolvedValue({}) },
  // No application of the deployment's own: every field is drawn where the
  // form puts it, none folded under *Use your own …*.
  providerClientsApi: {
    get: vi.fn().mockResolvedValue({ google: 'connection', dropbox: 'connection', microsoft: 'connection' }),
  },
}));

import { AccountForm } from './AccountForm.tsx';
import { LocaleProvider } from '../i18n/index.tsx';
import { STRINGS, type Locale } from '../i18n/strings.ts';

afterEach(() => {
  cleanup();
  globalThis.localStorage.removeItem('ownpace.locale');
});

const Form: React.FC<{ role: 'source' | 'target'; type: string; variant: 'accounts' | 'flow' }> = ({
  role,
  type,
  variant,
}) => {
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [name, setName] = React.useState('Anna');
  return (
    <AccountForm
      role={role}
      type={type}
      variant={variant}
      values={values}
      onValues={setValues}
      displayName={name}
      onDisplayName={setName}
      onAdded={() => undefined}
    />
  );
};

function renderForm(role: 'source' | 'target', type: string, variant: 'accounts' | 'flow', locale: Locale = 'en') {
  globalThis.localStorage.setItem('ownpace.locale', locale);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <LocaleProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Form role={role} type={type} variant={variant} />
        </MemoryRouter>
      </QueryClientProvider>
    </LocaleProvider>,
  );
}

/**
 * Every field the descriptor gives a line, on every card that asks for it, as
 * the form resolves it on this edition: a field that follows another answer
 * (the archive's path) carries the line of the answer already marked.
 */
const LINED = (['source', 'target'] as const).flatMap((role) =>
  connectableTypes(role).flatMap((type) => {
    const declared = credentialFieldsFor(role, type);
    const answers = choiceDefaults(declared, false);
    return declared
      .map((f) => followedField(f, answers))
      .filter((f) => f.hintKey !== undefined)
      .map((f) => ({ role, type, key: f.key, hintKey: f.hintKey as keyof (typeof STRINGS)['en'] }));
  }),
);

describe('on the Accounts page', () => {
  it('judges some fields', () => {
    expect(LINED.length).toBeGreaterThan(5);
  });

  it.each(LINED)('$role $type: $key shows its line beside the box', ({ role, type, hintKey }) => {
    renderForm(role, type, 'accounts');
    const line = screen.getByText(STRINGS.en[hintKey]);
    expect(line).toBeVisible();
    expect(line.closest('label'), 'the line is inside the label').toBeNull();
  });
});

describe('in Start a migration', () => {
  it('shows the Apple line in plain view, in both languages', () => {
    for (const locale of ['en', 'nl'] as const) {
      renderForm('source', 'apple', 'flow', locale);
      expect(screen.getByText(STRINGS[locale]['wizard.appleAppPassword.hint'])).toBeVisible();
      cleanup();
    }
  });

  it('shows Soverin’s mail-server line inside Server settings, which it opens', async () => {
    renderForm('target', 'soverin', 'flow');
    const line = screen.getByText(STRINGS.en['wizard.soverinMailHost.hint']);
    expect(line.closest('details')?.querySelector('summary')?.textContent).toContain(
      STRINGS.en['start.serverSettings'],
    );
    expect(line).not.toBeVisible();
    await userEvent.click(screen.getByText(/^Server settings/));
    expect(line).toBeVisible();
  });

  it('shows the domain-wide key’s warning once the company question is answered yes', async () => {
    renderForm('source', 'gmail', 'flow');
    expect(screen.queryByText(STRINGS.en['wizard.serviceAccountKey.width'])).toBeNull();
    await userEvent.click(screen.getByRole('radio', { name: STRINGS.en['start.company.yes'] }));
    expect(screen.getByText(STRINGS.en['wizard.serviceAccountKey.width'])).toBeVisible();
  });
});
