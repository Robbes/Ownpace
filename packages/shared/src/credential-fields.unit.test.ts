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

  it("names whose consent mints each token, and pairs Dropbox's App key with its secret (2026-09-02)", () => {
    const dropbox = credentialFieldsFor('source', 'dropbox');
    expect(dropbox.find((f) => f.key === 'refreshToken')?.consent).toBe('dropbox');
    expect(dropbox.find((f) => f.key === 'clientId')).toMatchObject({ pairedWith: 'clientSecret' });
    expect(dropbox.find((f) => f.key === 'clientId')?.required).not.toBe(true);
    expect(dropbox.find((f) => f.key === 'clientSecret')?.required).toBe(false);
    for (const type of ['gmail', 'google-drive', 'google'] as const) {
      expect(credentialFieldsFor('source', type).find((f) => f.key === 'refreshToken')?.consent).toBe('google');
    }
    // Box mints no refresh token and names no consent.
    expect(credentialFieldsFor('source', 'box').some((f) => f.consent)).toBe(false);
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

describe('the soverin mail face is asked at ITS door only (0106 T4b)', () => {
  it('soverin offers optional mailHost + mailPort — typed, never pre-filled', () => {
    const fields = credentialFieldsFor('target', 'soverin');
    const mailHost = fields.find((f) => f.key === 'mailHost');
    const mailPort = fields.find((f) => f.key === 'mailPort');
    expect(mailHost).toBeDefined();
    expect(mailPort).toBeDefined();
    // Optional: an account used only for calendars and contacts needs no
    // mail server — the create door demands it when email is ticked instead.
    expect(mailHost?.required).not.toBe(true);
    expect(mailHost?.secret, 'a host name is not a secret').not.toBe(true);
    expect(mailPort?.numeric).toBe(true);
  });

  it('the protocol trio, imap and jmap never grow a mail face', () => {
    for (const type of ['caldav', 'carddav', 'webdav', 'imap', 'jmap']) {
      expect(
        credentialFieldsFor('target', type).some((f) => f.key === 'mailHost'),
        `${type} must not ask for a mailHost`,
      ).toBe(false);
    }
  });
});

describe('a pair is presented as a pair (ADR-0041)', () => {
  const GOOGLE_TYPES = ['gmail', 'google-drive', 'google-calendar', 'google-contacts', 'google'];

  it("pairs every Google type's client id with its secret", () => {
    // The id is neither secret nor required once the deployment may carry the
    // client, so a panel offering "required or secret" would drop it and let
    // a new secret travel alone — the half pair every door now refuses.
    for (const type of GOOGLE_TYPES) {
      const fields = credentialFieldsFor('source', type);
      const id = fields.find((f) => f.key === 'clientId');
      expect(id?.pairedWith, `${type}: the client id travels alone`).toBe('clientSecret');
      expect(
        fields.find((f) => f.key === id?.pairedWith)?.secret,
        `${type}: pairedWith names a field that is not the secret half`,
      ).toBe(true);
    }
  });

  it('never points at a field the same type does not have', () => {
    // A dangling pair is worse than none: a panel would show a box for a
    // partner that the route never reads.
    for (const role of ['source', 'target'] as const) {
      for (const type of connectableTypes(role)) {
        const fields = credentialFieldsFor(role, type);
        for (const f of fields) {
          if (f.pairedWith === undefined) continue;
          expect(
            fields.some((g) => g.key === f.pairedWith),
            `${role}/${type}: '${f.key}' is paired with '${f.pairedWith}', which does not exist there`,
          ).toBe(true);
        }
      }
    }
  });
});
