// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The credential field descriptor (workplan 0063). What these hold:
 *
 *  1. Every secret is MARKED. A field that should be masked and is not gets
 *     rendered in the clear and echoed into logs — the one mistake here that
 *     is not recoverable by editing a form.
 *  2. Providers are named in THEIR vocabulary, not ours: Dropbox's client id
 *     is an "App key", and the label key says so.
 *  3. An unknown type answers `[]` rather than a plausible-looking default,
 *     because a form with the wrong fields silently stores the wrong thing.
 */

import { describe, it, expect } from 'vitest';
import {
  connectableTypes,
  credentialFieldsFor,
  secretFieldKeys,
} from './credential-fields.ts';

describe('secrets', () => {
  it('marks every value that must never be rendered in the clear', () => {
    expect(secretFieldKeys('source', 'dropbox')).toEqual([
      'clientSecret',
      'refreshToken',
    ]);
    expect(secretFieldKeys('source', 'google-drive')).toContain('serviceAccountKey');
    expect(secretFieldKeys('target', 'jmap')).toEqual(['password']);
  });

  it('never marks an identifier as secret — masking a client id only hides typos', () => {
    for (const type of connectableTypes('source')) {
      expect(secretFieldKeys('source', type)).not.toContain('clientId');
      expect(secretFieldKeys('source', type)).not.toContain('username');
    }
  });
});

describe('the provider\'s own vocabulary', () => {
  it("calls Dropbox's client id an App key, because Dropbox does", () => {
    const appKey = credentialFieldsFor('source', 'dropbox').find((f) => f.key === 'clientId');
    expect(appKey?.labelKey).toBe('wizard.dropboxAppKey');
  });

  it('asks Box for the numeric subject user id it needs', () => {
    const keys = credentialFieldsFor('source', 'box').map((f) => f.key);
    expect(keys).toContain('userId');
    // ...and never for a refresh token, which Box rotates (workplan 0056).
    expect(keys).not.toContain('refreshToken');
  });

  it('offers Google a pasted key file as a multiline alternative to the trio', () => {
    const key = credentialFieldsFor('source', 'gmail').find(
      (f) => f.key === 'serviceAccountKey',
    );
    expect(key?.multiline).toBe(true);
    // The trio is therefore NOT required — either flow is valid (ADR-0033).
    const trio = credentialFieldsFor('source', 'gmail').filter((f) =>
      ['clientId', 'clientSecret', 'refreshToken'].includes(f.key),
    );
    expect(trio.every((f) => !f.required)).toBe(true);
  });
});

describe('unknown types', () => {
  it('answer an empty list rather than a plausible default', () => {
    expect(credentialFieldsFor('source', 'not-a-provider')).toEqual([]);
    // A source type is not automatically a target type, and vice versa.
    expect(credentialFieldsFor('target', 'box')).toEqual([]);
    expect(credentialFieldsFor('source', 'jmap')).toEqual([]);
  });
});

describe('what each side can offer', () => {
  it('lists the types a connection form may present', () => {
    expect(connectableTypes('source')).toContain('box');
    expect(connectableTypes('target')).toEqual([
      'jmap',
      'imap',
      'caldav',
      'carddav',
      'webdav',
      'soverin',
    ]);
  });
});

describe('the DAV targets ask for an optional base URL (0105 T1)', () => {
  it('caldav, carddav, webdav and soverin offer url, and it gates nothing', () => {
    // The escape hatch for a provider whose DAV root lives behind a path —
    // host+port can only ever say https://host:port/.
    for (const type of ['caldav', 'carddav', 'webdav', 'soverin']) {
      const url = credentialFieldsFor('target', type).find((f) => f.key === 'url');
      expect(url, `${type} has no url field`).toBeDefined();
      expect(url?.required, `${type}'s url must stay optional — host+port keep working`).not.toBe(
        true,
      );
      expect(url?.secret, 'a URL is not a secret').not.toBe(true);
    }
  });

  it('imap and jmap targets do NOT — one has no URL, the other derives its own', () => {
    for (const type of ['imap', 'jmap']) {
      expect(
        credentialFieldsFor('target', type).some((f) => f.key === 'url'),
        `${type} must not ask for a url`,
      ).toBe(false);
    }
  });
});
