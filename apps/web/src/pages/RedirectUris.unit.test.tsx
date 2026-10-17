// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The redirect URIs page says one thing per card (2026-09-01; the UX sweep of
 * 2026-10-17).
 *
 * The social sign-in card used to say two things at once when its value was
 * not set: "No redirect URI to register." and "This deployment has not been
 * told its own address". Both were wrong for it. There is an address to
 * register, and what is missing is the identity provider's
 * `IDP_UPSTREAM_CALLBACK_URL`, not this deployment's address.
 *
 * The entries come from the real `redirectUris()`, so the page is held to what
 * the API actually builds.
 */

import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { redirectUris, type RedirectUriEnv } from '@openmig/shared';
import RedirectUris from './RedirectUris.tsx';
import { redirectUriApi } from '../services/mapping-service.ts';
import { OPERATOR_STRINGS as O } from '../i18n/operator-strings.ts';

vi.mock('../services/mapping-service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/mapping-service.ts')>()),
  redirectUriApi: { get: vi.fn() },
}));

const getMock = vi.mocked(redirectUriApi.get);

const CONFIGURED: RedirectUriEnv = { API_URL: 'https://api.example.test', WEB_URL: 'https://app.example.test' };

const mount = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RedirectUris />
    </QueryClientProvider>,
  );
};

/** The card that names this provider. */
const card = async (provider: RegExp) => (await screen.findByText(provider)).parentElement!;

beforeEach(() => {
  getMock.mockReset();
});

describe('a card says one thing about its address', () => {
  it('says what is missing for social sign-in, and not that there is nothing to register', async () => {
    getMock.mockResolvedValue([...redirectUris(CONFIGURED)]);
    mount();

    const social = within(await card(/each provider’s own OAuth client/));
    expect(social.getByText(O['redirects.unconfigured.upstream'])).toBeInTheDocument();
    expect(social.queryByText(O['redirects.none'])).not.toBeInTheDocument();
    expect(social.queryByText(O['redirects.unconfigured'])).not.toBeInTheDocument();
  });

  it('says only that the address is not set, for a card built from this deployment’s own', async () => {
    getMock.mockResolvedValue([...redirectUris({})]);
    mount();

    const google = within(await card(/^Google Cloud Console/));
    expect(google.getByText(O['redirects.unconfigured'])).toBeInTheDocument();
    expect(google.queryByText(O['redirects.none'])).not.toBeInTheDocument();
  });

  it('keeps "nothing to register" for a provider that needs none', async () => {
    getMock.mockResolvedValue([...redirectUris(CONFIGURED)]);
    mount();

    await screen.findByText(/each provider’s own OAuth client/);
    const none = screen.getAllByText(O['redirects.none']);
    expect(none.length).toBeGreaterThan(0);
    for (const line of none) {
      expect(within(line.parentElement!).queryByText(O['redirects.unconfigured'])).not.toBeInTheDocument();
    }
  });

  it('shows the address and no warning once the value is set', async () => {
    getMock.mockResolvedValue([
      ...redirectUris({ ...CONFIGURED, IDP_UPSTREAM_CALLBACK_URL: 'https://id.example.test/idps/callback' }),
    ]);
    mount();

    const social = within(await card(/each provider’s own OAuth client/));
    expect(social.getByText('https://id.example.test/idps/callback')).toBeInTheDocument();
    expect(social.queryByText(O['redirects.unconfigured.upstream'])).not.toBeInTheDocument();
  });
});
