// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE ADDRESSES, AND THE PROMISE THAT THEY ARE THIS DEPLOYMENT'S.
 *
 * The owner registered `https://app.ota.ownpace.eu/api/migrations/google/callback`
 * at Google — the right string — and still got `redirect_uri_mismatch`,
 * because `API_URL` was `http://localhost:3001` and the app asked for a
 * different address than the one he had registered.
 *
 * A page listing these is only worth having if what it shows is what the
 * product will actually send. So the property under test is not "the strings
 * look right": it is that each one is built from the SAME setting the code
 * builds it from, and that a setting nobody set produces a visible gap rather
 * than a plausible wrong address somebody would go and register.
 */

import { describe, it, expect } from 'vitest';
import { redirectUris } from './redirect-uris.ts';

const CONFIGURED = {
  API_URL: 'https://app.ota.ownpace.eu',
  WEB_URL: 'https://app.ota.ownpace.eu',
  // The provider's own path shape, as the setup script writes it. A TEST may
  // name it; shipped source may not (no-issuer-lock-in.unit.test.ts).
  IDP_UPSTREAM_CALLBACK_URL: 'https://id.ota.ownpace.eu/ui/login/login/externalidp/callback',
};
const find = (env: Record<string, string | undefined>, id: string) =>
  redirectUris(env).find((e) => e.id === id)!;

describe('the addresses this deployment needs registered', () => {
  it('builds the Google callback from API_URL, the way the consent route does', () => {
    // The exact string the owner had registered, and the one the route sends —
    // they are the same string or this page is decoration.
    expect(find(CONFIGURED, 'google.migration').uri).toBe(
      'https://app.ota.ownpace.eu/api/migrations/google/callback',
    );
  });

  it('shows the localhost default AS the localhost default, not as a working address', () => {
    // The configuration that produced the mismatch. It is not hidden — the
    // page's job is to show what WILL be sent, and this is what will be sent.
    expect(find({ ...CONFIGURED, API_URL: 'http://localhost:3001' }, 'google.migration').uri).toBe(
      'http://localhost:3001/api/migrations/google/callback',
    );
  });

  it('builds the sign-in pair from WEB_URL, matching what setup-zitadel.sh registers', () => {
    // `REDIRECT_URIS="[$WEB_URL + /auth/callback]"` and
    // `LOGOUT_URIS="[$WEB_URL + /login]"`. Two files, one fact: if these ever
    // disagree, one of them is registering an address nothing uses.
    expect(find(CONFIGURED, 'app.signIn').uri).toBe('https://app.ota.ownpace.eu/auth/callback');
    expect(find(CONFIGURED, 'app.signOut').uri).toBe('https://app.ota.ownpace.eu/login');
  });

  it("gives the social upstream the ISSUER'S address, not this app's", () => {
    // The mistake this line exists to prevent. A social sign-in redirects to
    // the identity provider, which then redirects here — so registering the
    // app's address at Google fails in a way that looks like everything else.
    const social = find(CONFIGURED, 'social.upstream');
    expect(social.uri).toBe('https://id.ota.ownpace.eu/ui/login/login/externalidp/callback');
    expect(social.uri).not.toContain('app.ota.ownpace.eu');
    expect(social.why).toContain('IDENTITY PROVIDER’S address');
  });

  it('READS the upstream address rather than composing it — the path is the provider’s', () => {
    // Composing `${issuer}/ui/login/…` here would have pinned the product to
    // one provider's routing, which is exactly the decay ADR-0042's guard
    // exists to catch — and it caught the first draft of this file. So the
    // value is the setup script's, and with no value there is no guess.
    const noUpstream = find({ ...CONFIGURED, IDP_UPSTREAM_CALLBACK_URL: undefined }, 'social.upstream');
    expect(noUpstream.uri).toBeNull();
    expect(noUpstream.unconfigured).toBe(true);
    // And a different provider's shape is shown exactly as written.
    const other = find(
      { ...CONFIGURED, IDP_UPSTREAM_CALLBACK_URL: 'https://sso.example.test/realms/x/broker/endpoint/' },
      'social.upstream',
    );
    expect(other.uri).toBe('https://sso.example.test/realms/x/broker/endpoint');
  });

  it('trims a trailing slash, which is an ordinary thing to write in a .env', () => {
    expect(find({ ...CONFIGURED, API_URL: 'https://app.example.test/' }, 'google.migration').uri)
      .toBe('https://app.example.test/api/migrations/google/callback');
  });

  it('MARKS an unset setting instead of inventing an address for it', () => {
    // A plausible wrong address is worse than a gap: somebody registers it,
    // and it fails later at a provider's screen for a reason that looks like
    // ours. Null plus the flag, and the page renders the warning.
    const entry = find({ WEB_URL: 'https://app.example.test' }, 'google.migration');
    expect(entry.uri).toBeNull();
    expect(entry.unconfigured).toBe(true);
  });

  it('treats blank and whitespace as unset', () => {
    expect(
      find({ ...CONFIGURED, IDP_UPSTREAM_CALLBACK_URL: '   ' }, 'social.upstream').unconfigured,
    ).toBe(true);
  });
});

describe('the providers that need NOTHING are answers too', () => {
  it.each([['box.migration'], ['o365.migration']])(
    '%s says no redirect URI, and why',
    (id) => {
      // "We will probably have more, like Dropbox, Box, O365" deserves the real
      // answer. Omitting them leaves somebody hunting a setting that does not
      // exist, in a console where every other OAuth app has one.
      const entry = find(CONFIGURED, id);
      expect(entry.uri).toBeNull();
      expect(entry.unconfigured, 'absent by design, not by misconfiguration').toBeUndefined();
      expect(entry.why).toContain('None.');
    },
  );

  it('dropbox.migration is built from API_URL like Google\'s, since Connect with Dropbox (2026-09-02)', () => {
    const entry = find({ API_URL: 'https://app.ota.ownpace.eu' }, 'dropbox.migration');
    expect(entry.uri).toBe('https://app.ota.ownpace.eu/api/migrations/dropbox/callback');
    expect(entry.unconfigured).toBe(false);
    expect(entry.provider).toContain('Dropbox App Console');
    // And without API_URL it is a thing this deployment has not told us yet.
    expect(find({}, 'dropbox.migration').uri).toBeNull();
    expect(find({}, 'dropbox.migration').unconfigured).toBe(true);
  });

  it('does not warn about them, because there is nothing to set', () => {
    // The flag means "this deployment has not told us something". Raising it
    // for a provider that structurally has no redirect would be a permanent
    // warning nobody can clear.
    for (const id of ['box.migration', 'o365.migration']) {
      expect(find({}, id).unconfigured).toBeUndefined();
    }
  });
});

describe('the list itself', () => {
  it('names every group the page renders, so nothing is computed and hidden', () => {
    const groups = new Set(redirectUris(CONFIGURED).map((e) => e.group));
    expect([...groups].sort()).toEqual(['migration', 'signIn', 'socialSignIn']);
  });

  it('has unique ids, which are the translation keys and the test handles', () => {
    const ids = redirectUris(CONFIGURED).map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('reads three settings and carries no other environment value', () => {
    // Every value it DOES carry is an address published to a provider and
    // typed into a browser's location bar, which is what makes the page safe
    // to photograph — and an operator will photograph it.
    //
    // The property is about VALUES, not words: the prose legitimately says
    // "App secret" and "refresh token" because that is what Dropbox needs and
    // saying so is the point. What must never appear is something out of the
    // environment that is not one of the three addresses.
    const rendered = JSON.stringify(
      redirectUris({
        ...CONFIGURED,
        GOOGLE_OAUTH_CLIENT_SECRET: 'sentinel-client-secret',
        SECRET_ENCRYPTION_KEY: 'sentinel-encryption-key',
        POSTGRES_PASSWORD: 'sentinel-password',
        JWT_SECRET: 'sentinel-jwt',
      } as never),
    );
    for (const leaked of [
      'sentinel-client-secret',
      'sentinel-encryption-key',
      'sentinel-password',
      'sentinel-jwt',
    ]) {
      expect(rendered, `${leaked} reached the answer`).not.toContain(leaked);
    }
  });
});
