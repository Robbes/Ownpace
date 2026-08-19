// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Whether a directory can be read, and WHY NOT when it cannot (0028 T2).
 *
 * Three preconditions fail for three different reasons with three different
 * fixes. The reason this function returns is the sentence an operator reads
 * in a log and acts on — "directory unavailable" would send them hunting
 * through all three.
 */

import { describe, it, expect } from 'vitest';
import { directoryAvailability } from './directory-availability.ts';

const TENANT = 'contoso.onmicrosoft.com';

describe('when the directory can be read', () => {
  it('hands back the credentials it validated', () => {
    const result = directoryAvailability(
      { OAUTH2_CLIENT_ID: 'app-id', OAUTH2_CLIENT_SECRET: 'secret' },
      TENANT,
    );
    expect(result).toEqual({ ok: true, clientId: 'app-id', clientSecret: 'secret' });
  });
});

describe('a tenant with no Microsoft 365 source', () => {
  it('is not an error, and is not "no new mailboxes" either', () => {
    const result = directoryAvailability(
      { OAUTH2_CLIENT_ID: 'app-id', OAUTH2_CLIENT_SECRET: 'secret' },
      undefined,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // An IMAP-only or DAV-only tenant is a legitimate configuration; it is
      // simply not one whose directory can be listed.
      expect(result.reason).toContain('no Microsoft 365 source connection');
    }
  });
});

describe('the delegated flow', () => {
  it('is refused, naming the variable that puts the worker in it', () => {
    const result = directoryAvailability(
      { OAUTH2_CLIENT_ID: 'app-id', OAUTH2_REFRESH_TOKEN: 'refresh' },
      TENANT,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('OAUTH2_REFRESH_TOKEN');
      expect(result.reason).toContain('DELEGATED');
      expect(result.reason).toContain('o365-application-access.md');
    }
  });

  it('wins over a client secret that is ALSO present', () => {
    // A stack carrying both is configured for delegated access. Reporting it
    // as fine and then meeting a 403 from Graph is the outcome this ordering
    // exists to prevent.
    const result = directoryAvailability(
      {
        OAUTH2_CLIENT_ID: 'app-id',
        OAUTH2_CLIENT_SECRET: 'secret',
        OAUTH2_REFRESH_TOKEN: 'refresh',
      },
      TENANT,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('DELEGATED');
  });
});

describe('missing application credentials', () => {
  it('names the ONE that is missing, not both', () => {
    // "Credentials are missing" leaves an operator checking two things when
    // only one is absent.
    const noSecret = directoryAvailability({ OAUTH2_CLIENT_ID: 'app-id' }, TENANT);
    expect(noSecret.ok).toBe(false);
    if (!noSecret.ok) {
      expect(noSecret.reason).toContain('OAUTH2_CLIENT_SECRET is not set');
      expect(noSecret.reason).not.toContain('OAUTH2_CLIENT_ID and');
    }

    const noId = directoryAvailability({ OAUTH2_CLIENT_SECRET: 'secret' }, TENANT);
    if (!noId.ok) expect(noId.reason).toContain('OAUTH2_CLIENT_ID is not set');
  });

  it('names both when both are missing, and reads as a sentence', () => {
    const result = directoryAvailability({}, TENANT);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('OAUTH2_CLIENT_ID and OAUTH2_CLIENT_SECRET are not set');
    }
  });

  it('treats an empty string as missing, not as set', () => {
    // A `.env` line with nothing after the `=` is the commonest way to have a
    // variable that exists and is useless.
    const result = directoryAvailability(
      { OAUTH2_CLIENT_ID: 'app-id', OAUTH2_CLIENT_SECRET: '' },
      TENANT,
    );
    expect(result.ok).toBe(false);
  });
});
