// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A MICROSOFT CONSENT IN ITS OWN DIRECTORY (workplan 0153 open question 5).
 *
 * A person who brings their own app registration may have made it for their
 * own organisation only: a single-tenant registration. Its consent has to be
 * asked in that organisation's directory, and the route takes the tenant for
 * exactly that (`resolveMicrosoftClient`). Neither door sent it: the account
 * form held the tenant behind *Is this a company account with an
 * administrator?*, and the consent asked `common`, where Microsoft answers
 * that the application cannot be found.
 *
 * So: a typed tenant goes with the consent, beside the person's own pair; and
 * none is invented where none was typed.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { credentialFieldsFor } from '@openmig/shared';
import { STRINGS } from '../i18n/strings.ts';

const { authorize, clients } = vi.hoisted(() => ({ authorize: vi.fn(), clients: vi.fn() }));

vi.mock('../services/mapping-service', () => ({
  mappingApi: { microsoftAuthorize: authorize, googleAuthorize: vi.fn(), dropboxAuthorize: vi.fn() },
  providerClientsApi: { get: clients },
  providerAccountsApi: { get: vi.fn().mockResolvedValue({}) },
}));

import { ProviderConsentPanel, useProviderConsent } from './ProviderConsent.tsx';

/** The consent as the account form uses it, for a Microsoft account with mail and calendars ticked. */
const Panel: React.FC<{ values: Record<string, string> }> = ({ values }) => {
  const consent = useProviderConsent({
    role: 'source',
    type: 'microsoft',
    fields: credentialFieldsFor('source', 'microsoft'),
    values,
    onToken: () => {},
    refusalText: (e) => String(e),
    fixedDomains: ['email', 'calendar'],
  });
  return <ProviderConsentPanel consent={consent} />;
};

/** Draws the panel and presses the button once it can be pressed: the deployment's app is read first. */
async function press(values: Record<string, string>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <Panel values={values} />
    </QueryClientProvider>,
  );
  const button = screen.getByRole('button', { name: STRINGS.en['wizard.microsoft.connect'] });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
}

beforeEach(() => {
  vi.clearAllMocks();
  clients.mockResolvedValue({ microsoft: 'deployment' });
  authorize.mockResolvedValue({ url: 'https://login.microsoftonline.com/x', redirectUri: 'https://x/cb' });
});
afterEach(cleanup);

describe('the Microsoft consent asks in the directory a registration belongs to', () => {
  it('sends the tenant typed beside the person’s own pair', async () => {
    await press({
      username: 'anna@contoso.example',
      clientId: 'own-client-id',
      clientSecret: 'own-secret',
      tenantId: ' contoso.onmicrosoft.com ',
    });
    await waitFor(() => expect(authorize).toHaveBeenCalled());
    expect(authorize.mock.calls[0]![0]).toMatchObject({
      domains: ['email', 'calendar'],
      clientId: 'own-client-id',
      clientSecret: 'own-secret',
      tenantId: 'contoso.onmicrosoft.com',
    });
  });

  it('invents none where none was typed', async () => {
    await press({ username: 'anna@example.invalid' });
    await waitFor(() => expect(authorize).toHaveBeenCalled());
    expect(authorize.mock.calls[0]![0]).not.toHaveProperty('tenantId');
    expect(authorize.mock.calls[0]![0]).not.toHaveProperty('clientId');
  });
});
