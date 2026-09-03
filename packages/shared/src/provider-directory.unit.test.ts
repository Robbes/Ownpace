// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The provider directory (workplan 0106 T5). What these hold:
 *
 *  1. A row may only pre-fill boxes the door ASKS FOR that kind — a value
 *     for a key no descriptor names would be typed into nothing and stored
 *     nowhere, and a value for a secret would be a credential in a table.
 *  2. Every row says where it was read and when: a value without a source
 *     is a guess wearing a table's clothes (0105's never-guess rule).
 *  3. A protocol kind and an unknown kind pre-fill NOTHING. "IMAP" names no
 *     provider, so there is nothing to look up.
 *  4. Applying a row overwrites only what is ours: blanks and the previous
 *     pick's defaults. What the person typed is never touched, and a default
 *     left behind by a provider the next pick did not name is emptied.
 */

import { describe, it, expect } from 'vitest';
import { credentialFieldsFor } from './credential-fields.ts';
import {
  PROVIDER_DIRECTORY,
  applyProviderDefaults,
  providerDefaultsFor,
  providerDirectoryEntry,
} from './provider-directory.ts';

describe('what a row may say', () => {
  it('pre-fills only boxes the door asks for that kind, and never a secret', () => {
    for (const entry of PROVIDER_DIRECTORY) {
      const fields = credentialFieldsFor(entry.role, entry.type);
      expect(fields.length, `${entry.role}/${entry.type} is not a door`).toBeGreaterThan(0);
      const asked = new Map(fields.map((f) => [f.key, f]));
      for (const key of Object.keys(entry.values)) {
        expect(asked.has(key), `${entry.type} pre-fills '${key}', which its door never asks`).toBe(
          true,
        );
        expect(asked.get(key)?.secret, `${entry.type} would pre-fill the secret '${key}'`).not.toBe(
          true,
        );
      }
    }
  });

  it('names the page each row was read from, and the day', () => {
    for (const entry of PROVIDER_DIRECTORY) {
      expect(entry.sources.length, `${entry.type} has no source`).toBeGreaterThan(0);
      for (const source of entry.sources) {
        expect(source.url).toMatch(/^https:\/\//);
        expect(source.seen).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });

  it('carries no blank value — an empty default would be a placeholder pretending to be typed', () => {
    for (const entry of PROVIDER_DIRECTORY) {
      for (const [key, value] of Object.entries(entry.values)) {
        expect(value.trim(), `${entry.type}.${key}`).not.toBe('');
      }
    }
  });
});

describe('who has a row', () => {
  it('the Soverin target: its DAV host and its mail host, each with a port', () => {
    expect(Object.keys(providerDefaultsFor('target', 'soverin')).sort()).toEqual([
      'host',
      'mailHost',
      'mailPort',
      'port',
    ]);
    expect(providerDirectoryEntry('target', 'soverin')?.sources[0]?.url).toContain('soverin');
  });

  it('a protocol kind and an unknown kind pre-fill nothing', () => {
    expect(providerDefaultsFor('target', 'jmap')).toEqual({});
    expect(providerDefaultsFor('target', 'imap')).toEqual({});
    expect(providerDefaultsFor('target', 'caldav')).toEqual({});
    expect(providerDefaultsFor('source', 'imap')).toEqual({});
    expect(providerDefaultsFor('source', 'soverin')).toEqual({});
    expect(providerDefaultsFor('target', 'no-such-provider')).toEqual({});
    expect(providerDirectoryEntry('target', 'jmap')).toBeUndefined();
  });
});

describe('applying a row', () => {
  const soverin = providerDefaultsFor('target', 'soverin');
  const none = providerDefaultsFor('target', 'jmap');

  it('fills blank boxes and leaves typed ones alone', () => {
    const out = applyProviderDefaults(none, soverin, {
      host: '',
      port: '  ',
      username: 'owner@example.invalid',
      mailHost: 'imap.typed.example',
    });
    expect(out).toEqual({
      host: 'caldav.soverin.net',
      port: '443',
      username: 'owner@example.invalid',
      mailHost: 'imap.typed.example',
      mailPort: '993',
    });
  });

  it('on leaving the provider, empties a box still at its default and keeps a typed one', () => {
    const out = applyProviderDefaults(soverin, none, {
      host: 'caldav.soverin.net',
      port: '443',
      mailHost: 'imap.typed.example',
      mailPort: '993',
      username: 'owner@example.invalid',
    });
    expect(out).toEqual({
      host: '',
      port: '',
      mailHost: 'imap.typed.example',
      mailPort: '',
      username: 'owner@example.invalid',
    });
  });

  it('between two providers, a box at the old default takes the new one', () => {
    const other = { host: 'dav.other.example', port: '8443' };
    const out = applyProviderDefaults(soverin, other, {
      host: 'caldav.soverin.net',
      port: '443',
      mailHost: 'imap.soverin.net',
    });
    expect(out).toEqual({ host: 'dav.other.example', port: '8443', mailHost: '' });
  });

  it('never touches its input', () => {
    const values = Object.freeze({ host: '' });
    const out = applyProviderDefaults(none, soverin, values);
    expect(values).toEqual({ host: '' });
    expect(out.host).toBe('caldav.soverin.net');
  });
});
