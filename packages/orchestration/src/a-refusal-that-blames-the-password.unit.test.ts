// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A REFUSAL THAT BLAMES THE PASSWORD.
 *
 * Every Apple Account has two-factor authentication, and a two-factor
 * account's OWN password is refused by IMAP, CalDAV and CardDAV **by design**.
 * So the single most likely first attempt on an Apple connection — typing the
 * password you sign in to Apple with — fails, and Apple answers
 * `AUTHENTICATIONFAILED` or a bare `401`.
 *
 * Rendered verbatim, which is 0080's rule and the right rule almost
 * everywhere, that tells a person their password is wrong. **It is not
 * wrong.** It is the wrong KIND of password, and no amount of retyping it will
 * help — the fix is a page on Apple's site the error does not mention.
 *
 * This is the exception 0083 anticipated: the useful sentence here is OURS,
 * because we know something the provider's error does not say. It is returned
 * as a `BilingualRefusal` so it rides the `credentialsRefused` path every
 * refusal we author already uses — the Dutch and the appliance come free.
 *
 * ## What must stay narrow
 *
 * Only `apple`, and only for messages that actually look like an
 * authentication rejection. A timeout, a DNS failure or a 500 must keep
 * Apple's own words: for those the provider's text is the more useful
 * sentence, and substituting ours would be guessing at a cause. A refusal that
 * cries wolf gets weakened, which is the second half of what this file holds.
 */

import { describe, it, expect, vi } from 'vitest';
import { appleAuthRefusal, refusalText } from '@openmig/shared';
import { probeSourceConnection } from './probe-connection.ts';

const APPLE_CONFIG = { user: 'someone@icloud.com' };
const CREDS = { username: 'someone@icloud.com', password: 'not-an-app-password' };

describe('the sentence Apple could not say', () => {
  it('names the app-specific password, in both languages', () => {
    const r = appleAuthRefusal('apple', 'AUTHENTICATIONFAILED authentication failed');
    expect(r, 'an Apple authentication failure produced no refusal of ours').toBeDefined();

    // The finding: what to make, and where. Both languages carry it, because
    // the appliance has no dictionary and would otherwise be English-only on
    // the sentence its owner most needs (0083).
    for (const locale of ['en', 'nl'] as const) {
      const text = refusalText(r!, locale);
      expect(text).toContain('account.apple.com');
      expect(text.length).toBeGreaterThan(120);
    }
    expect(refusalText(r!, 'en')).toContain('two-factor');
    expect(refusalText(r!, 'nl')).toContain('tweefactor');
  });

  it('recognises the shapes Apple actually answers with', () => {
    for (const message of [
      'AUTHENTICATIONFAILED',
      'Invalid credentials (Failure)',
      'LOGIN failed',
      'Request failed with status 401',
      'Unauthorized',
    ]) {
      expect(appleAuthRefusal('apple', message), message).toBeDefined();
    }
  });

  it('keeps the provider\'s own words for anything that is not an auth failure', () => {
    // The control, and the reason this matcher is a list rather than a
    // catch-all: for a timeout or a 500 the provider's text IS the useful
    // sentence, and ours would be a guess at a cause wearing a confident face.
    for (const message of [
      'connect ETIMEDOUT 17.253.144.10:993',
      'getaddrinfo ENOTFOUND caldav.icloud.com',
      'Request failed with status 503',
    ]) {
      expect(appleAuthRefusal('apple', message), message).toBeUndefined();
    }
  });

  it('is Apple\'s alone — no other kind borrows it', () => {
    // A soverin 401 may be a per-protocol app-password scope, which is a
    // different thing with a different remedy; telling that person about
    // account.apple.com would be worse than saying nothing.
    expect(appleAuthRefusal('soverin', 'AUTHENTICATIONFAILED')).toBeUndefined();
    expect(appleAuthRefusal('caldav', '401 Unauthorized')).toBeUndefined();
  });
});

describe('Test on an Apple connection', () => {
  it('has a probe at all — the front door offers the card', async () => {
    // Without a branch the kind fell to `default` and Test answered "No probe
    // exists for a 'apple' source connection". Honest about a gap, and not the
    // same thing as a product that works.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<d:multistatus xmlns:d="DAV:"></d:multistatus>', {
        status: 207,
        headers: { 'content-type': 'application/xml; charset=utf-8' },
      })),
    );
    try {
      const r = await probeSourceConnection('apple', APPLE_CONFIG, CREDS);
      expect(r.outcome?.code, JSON.stringify(r)).not.toBe('noProbe');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('answers a rejected password with our sentence, not Apple\'s', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })));
    try {
      const r = await probeSourceConnection('apple', APPLE_CONFIG, CREDS);

      expect(r.ok).toBe(false);
      expect(
        r.outcome?.code,
        'a 401 from Apple stayed a bare providerRefused, so the screen tells the person their ' +
          'password is wrong when it is the wrong KIND of password and retyping it cannot help',
      ).toBe('credentialsRefused');
      // `reason` lives only on the refusing arm of `ProbeResult`; the two
      // assertions above are what go red if we are somehow on the other one.
      if (!r.ok) {
        expect(r.reason).toContain('app-specific password');
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
