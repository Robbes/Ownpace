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
import { connectableTypes, credentialFieldsFor } from './credential-fields.ts';
import {
  PROVIDER_DIRECTORY,
  applyProviderDefaults,
  formDefaultsFor,
  providerDefaultsFor,
  providerDefaultsProvenance,
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

  it("the Soverin target cites the help desk's articles 26 and 38, which its old addresses only redirect to (workplan 0175 T1)", () => {
    // soverin.com/help/calendar-setup answers 301 and soverin.com/help/setup
    // 302 to these two articles (0175 §3.1). The values are the ones they give.
    const urls = providerDirectoryEntry('target', 'soverin')?.sources.map((s) => s.url) ?? [];
    expect(urls).toEqual([
      'https://soverin.zammad.com/help/en-gb/15-calendar-contacts/26-calendar-and-contacts-app-setup',
      'https://soverin.zammad.com/help/en-gb/12-email-apps-and-imap/38-imap-and-smtp-settings',
    ]);
    expect(providerDefaultsFor('target', 'soverin')).toEqual({
      host: 'caldav.soverin.net',
      port: '443',
      mailHost: 'imap.soverin.net',
      mailPort: '993',
    });
  });

  it('the Cirrux target: the servers its setup page publishes, read from cirrux.co (workplan 0160)', () => {
    // Exactly the values https://cirrux.co/help/setup gives under Manual
    // Configuration: api.cirrux.co for Calendar, Contacts and Reminders, and
    // imap.cirrux.co with 993 (SSL) for mail. 443 is HTTPS's own port, for a
    // server the page names without one. A changed value here is a changed
    // claim about Cirrux, and must come with a new reading of the page.
    expect(providerDefaultsFor('target', 'cirrux')).toEqual({
      host: 'api.cirrux.co',
      port: '443',
      mailHost: 'imap.cirrux.co',
      mailPort: '993',
    });
    const sources = providerDirectoryEntry('target', 'cirrux')?.sources ?? [];
    expect(sources.map((s) => s.url)).toEqual(['https://cirrux.co/help/setup', 'https://cirrux.co/help/calendar']);
    for (const s of sources) expect(new URL(s.url).hostname).toBe('cirrux.co');
    // No path is published, so the row leaves the DAV base URL box alone.
    expect(providerDefaultsFor('target', 'cirrux')).not.toHaveProperty('url');
    expect(providerDefaultsProvenance('target', 'cirrux')).toEqual({ provider: 'Cirrux', seen: '2026-11-19' });
  });

  it('the Infomaniak target: its two servers, read from infomaniak.com, and no login (workplan 0161)', () => {
    // Exactly what Infomaniak's pages give: sync.infomaniak.com for contacts
    // and calendars (FAQ 1544, "utilisez uniquement sync.infomaniak.com"), and
    // mail.infomaniak.com on 993 with SSL (FAQ 2427). 443 is HTTPS's own port,
    // for a server named without one. A changed value here is a changed claim
    // about Infomaniak, and must come with a new reading of the page.
    expect(providerDefaultsFor('target', 'infomaniak')).toEqual({
      host: 'sync.infomaniak.com',
      port: '443',
      mailHost: 'mail.infomaniak.com',
      mailPort: '993',
    });
    const sources = providerDirectoryEntry('target', 'infomaniak')?.sources ?? [];
    expect(sources.map((s) => new URL(s.url).pathname.split('/')[4])).toEqual(['2427', '1544', '1321', '2855']);
    for (const s of sources) {
      expect(new URL(s.url).hostname).toBe('www.infomaniak.com');
      // The pages as the site served them that day: in French.
      expect(new URL(s.url).pathname.startsWith('/fr/support/faq/')).toBe(true);
      expect(s.seen).toBe('2026-11-19');
    }
    // No path is published, so the row leaves the DAV base URL box alone, and
    // neither of the two logins is anybody's to pre-fill.
    for (const key of ['url', 'username', 'password', 'mailUsername', 'mailPassword']) {
      expect(providerDefaultsFor('target', 'infomaniak')).not.toHaveProperty(key);
    }
    expect(providerDefaultsProvenance('target', 'infomaniak')).toEqual({ provider: 'Infomaniak', seen: '2026-11-19' });
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

describe('the usual port (the owner, 2026-10-04: "B")', () => {
  const PORT_BOXES = (['source', 'target'] as const).flatMap((role) =>
    connectableTypes(role).flatMap((type) =>
      credentialFieldsFor(role, type)
        .filter((f) => f.key === 'port' || f.key === 'mailPort')
        .map((f) => ({ role, type, key: f.key, example: f.placeholder })),
    ),
  );

  it('judges some boxes', () => {
    expect(PORT_BOXES.length).toBeGreaterThan(5);
  });

  it.each(PORT_BOXES)('$role $type: $key starts filled, with the number its example shows', ({ role, type, key, example }) => {
    expect(formDefaultsFor(role, type)[key]).toBe(example);
  });

  it('a protocol card gets its port and nothing else, and no "Pre-filled from" line', () => {
    expect(formDefaultsFor('source', 'imap')).toEqual({ port: '993' });
    expect(formDefaultsFor('target', 'imap')).toEqual({ port: '993' });
    expect(formDefaultsFor('target', 'jmap')).toEqual({ port: '443' });
    expect(formDefaultsFor('target', 'caldav')).toEqual({ port: '443' });
    expect(formDefaultsFor('target', 'carddav')).toEqual({ port: '443' });
    expect(formDefaultsFor('target', 'webdav')).toEqual({ port: '443' });
    expect(providerDefaultsProvenance('target', 'caldav')).toBeUndefined();
  });

  it('a named provider fills in what it published, and a card without a port box gets nothing', () => {
    expect(formDefaultsFor('target', 'soverin')).toEqual(providerDefaultsFor('target', 'soverin'));
    expect(formDefaultsFor('source', 'gmail')).toEqual({});
    expect(formDefaultsFor('target', 'nextcloud')).toEqual({});
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
