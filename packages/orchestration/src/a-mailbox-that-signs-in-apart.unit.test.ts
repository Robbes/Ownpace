// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A MAILBOX THAT SIGNS IN APART, AT EVERY SEAM THAT SIGNS IN (workplan 0161 T1).
 *
 * Infomaniak's calendars, contacts and tasks sign in with the account's sync
 * login, a short username such as AB12345 and an app password; its mail
 * signs in with the mailbox's own, the full address and the password made for
 * it on its Devices tab, because an app password "ne permettra pas de
 * synchroniser une adresse mail" (https://www.infomaniak.com/fr/support/faq/2855).
 * So an `infomaniak` row holds both logins in its one secret, and the defect
 * this file exists to stop is the quiet one: a seam that signs in to MAIL with
 * the record's `username`/`password` builds perfectly, and is refused by the
 * mail server at the first pass with what reads as a wrong password.
 *
 * Held here, for each seam that signs in to a face:
 *
 *  - the mail writer, through `mailTargetConfigFromConnection` and
 *    `mailCredentialsOf`, signs in as the mailbox, and never as the sync
 *    login, even where a reused connection's override names the sync user;
 *  - the source-side mail face of the account (the table serves both roles);
 *  - the DAV faces sign in with the sync login, never the mailbox's;
 *  - the qualification measures mail with the mail login, and does not
 *    measure it at all, saying which fields are missing, where none is stored;
 *  - the probe's headline face signs in with the sync login;
 *  - a row with no mail login refuses by field name, as one with no mail
 *    server does;
 *  - Soverin and Cirrux, which sign in with one login, are handed exactly what
 *    they were handed before;
 *  - and the call sites themselves, read as text, which a pure test cannot see.
 */

import { readFileSync } from 'node:fs';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ImapFlowDavMailTarget, ImapFlowSource } from '@openmig/connectors';
import type { TargetConfig } from '@openmig/shared';
import {
  buildSourceConnectorFromCredentials,
  buildTargetWriterFromCredentials,
  mailCredentialsOf,
  mailTargetConfigFromConnection,
} from './build-deps-from-mapping.ts';
import { davEndpointFromCreds } from './dav-endpoint.ts';
import { qualifyAccount } from './account-qualification.ts';
import { probeTargetConnection } from './probe-connection.ts';

/** The servers Infomaniak publishes, as the pre-filled door stores them. */
const CONFIG = { host: 'sync.infomaniak.com', port: 443, mailHost: 'mail.infomaniak.com', mailPort: 993 };

/** Both logins, as one encrypted secret holds them. Obvious dummies, never a real login. */
const CREDS = {
  username: 'AB12345',
  password: 'dummy-sync-app-password',
  mailUsername: 'someone@example.com',
  mailPassword: 'dummy-mailbox-device-password',
};

/** The sync login alone: a row saved for calendars only. */
const SYNC_ONLY = { username: 'AB12345', password: 'dummy-sync-app-password' };

/** What a mail connector was built to sign in with, read off the object it is. */
function imapTargetLogin(writer: unknown): { username: string; password: string } {
  const config = (writer as { config: { username: string; password: string } }).config;
  return { username: config.username, password: config.password };
}

function imapSourceLogin(source: unknown): { user: string; password?: string } {
  return (source as { config: { auth: { user: string; password?: string } } }).config.auth;
}

/** The Basic credentials a request carried, decoded. */
function basicOf(init: { headers?: unknown } | undefined): string | undefined {
  const headers = init?.headers;
  let value: string | null | undefined;
  if (headers instanceof Headers) value = headers.get('authorization');
  else if (headers && typeof headers === 'object') {
    const record = headers as Record<string, string>;
    value = record.Authorization ?? record.authorization;
  }
  if (!value?.startsWith('Basic ')) return undefined;
  return Buffer.from(value.slice('Basic '.length), 'base64').toString('utf8');
}

const MULTISTATUS = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav" xmlns:cal="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>/calendars/AB12345/default/</d:href>
    <d:propstat>
      <d:prop>
        <d:current-user-principal><d:href>/principals/AB12345/</d:href></d:current-user-principal>
        <card:addressbook-home-set><d:href>/addressbooks/AB12345/</d:href></card:addressbook-home-set>
        <cal:calendar-home-set><d:href>/calendars/AB12345/</d:href></cal:calendar-home-set>
        <d:resourcetype><d:collection/><card:addressbook/><cal:calendar/></d:resourcetype>
        <d:displayname>default</d:displayname>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`;

/** A DAV server that answers everything, and remembers who every request signed in as. */
function davServerRemembering(seen: string[]) {
  return vi.fn(async (_url: string, init?: { method?: string; headers?: unknown }) => {
    const who = basicOf(init);
    if (who !== undefined) seen.push(who);
    if (init?.method === 'OPTIONS') {
      return new Response('', { status: 200, headers: { DAV: '1, 2, calendar-access' } });
    }
    return new Response(MULTISTATUS, { status: 207, headers: { 'content-type': 'application/xml; charset=utf-8' } });
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the mail writer signs in as the mailbox, never as the sync login', () => {
  it('builds the imap-dav shape on the mail host, as the mailbox’s address', () => {
    const resolved = mailTargetConfigFromConnection('infomaniak', CONFIG, CREDS) as unknown as {
      type: string;
      host: string;
      port: number;
      tls: boolean;
      user: string;
    };
    expect(resolved).toMatchObject({ type: 'imap-dav', host: 'mail.infomaniak.com', port: 993, tls: true });
    expect(resolved.user).toBe('someone@example.com');
  });

  it('ignores a config.user, which a reused connection’s override sets to the sync username', () => {
    // The create door writes the account a migration was shown as the
    // mapping's override `user`, and for this kind that is AB12345.
    const resolved = mailTargetConfigFromConnection('infomaniak', { ...CONFIG, user: 'AB12345' }, CREDS) as unknown as {
      user: string;
    };
    expect(resolved.user).toBe('someone@example.com');
  });

  it('hands the writer the mailbox’s password, and the sync password goes nowhere near it', () => {
    const resolved = mailTargetConfigFromConnection('infomaniak', CONFIG, CREDS);
    const writer = buildTargetWriterFromCredentials(resolved, mailCredentialsOf('infomaniak', CREDS));
    expect(writer).toBeInstanceOf(ImapFlowDavMailTarget);
    expect(imapTargetLogin(writer)).toEqual({
      username: 'someone@example.com',
      password: 'dummy-mailbox-device-password',
    });
    expect(JSON.stringify(mailCredentialsOf('infomaniak', CREDS))).not.toContain('dummy-sync-app-password');
  });

  it('refuses a row with no mail login by field name, rather than signing in with the sync login', () => {
    expect(() => mailTargetConfigFromConnection('infomaniak', CONFIG, SYNC_ONLY)).toThrow(
      'This infomaniak connection stores no mail login, so its mail face cannot be built: ' +
        'mailUsername/mailPassword are missing.',
    );
    expect(() =>
      mailTargetConfigFromConnection('infomaniak', CONFIG, { ...SYNC_ONLY, mailUsername: 'someone@example.com' }),
    ).toThrow('mailPassword is missing');
  });

  it('asks for the mail server first, in the sentence Soverin’s and Cirrux’s guides quote', () => {
    expect(() => mailTargetConfigFromConnection('infomaniak', { host: 'sync.infomaniak.com' }, CREDS)).toThrow(
      'This infomaniak connection stores no mail server, so its mail face cannot be built: config.mailHost is missing.',
    );
  });
});

describe('Soverin and Cirrux sign in to mail exactly as before', () => {
  for (const [kind, config] of [
    ['soverin', { host: 'caldav.soverin.net', port: 443, mailHost: 'imap.soverin.net', mailPort: 993 }],
    ['cirrux', { host: 'api.cirrux.co', port: 443, mailHost: 'imap.cirrux.co', mailPort: 993 }],
  ] as const) {
    it(`${kind}: one login, the row's own user first, the record handed over as stored`, () => {
      const one = { username: 'someone@example.com', password: 'dummy-app-password' };
      // A stray mailbox key on such a record is not a login it signs in with.
      const record = { ...one, mailUsername: 'other@example.com', mailPassword: 'dummy-other' };
      expect(mailCredentialsOf(kind, record)).toEqual(record);
      const resolved = mailTargetConfigFromConnection(kind, config, record) as unknown as { user: string };
      expect(resolved.user).toBe('someone@example.com');
      // The row's `user` still wins for these kinds, as it always has.
      expect((mailTargetConfigFromConnection(kind, { ...config, user: 'row@example.com' }, record) as unknown as { user: string }).user).toBe(
        'row@example.com',
      );
      const writer = buildTargetWriterFromCredentials(mailTargetConfigFromConnection(kind, config, record), mailCredentialsOf(kind, record));
      expect(imapTargetLogin(writer)).toEqual({ username: 'someone@example.com', password: 'dummy-app-password' });
      // And no mail login is demanded of them.
      expect(() => mailTargetConfigFromConnection(kind, config, one)).not.toThrow();
    });
  }

  it('a protocol writer’s token fallbacks read what they always read', () => {
    // An IMAP target storing an access token and no password.
    const imap = { type: 'imap-dav', host: 'imap.example.com', port: 993, tls: true, user: 'a@example.com' } as unknown as TargetConfig;
    // Key for key as stored: no empty `username` or `password` is added.
    expect(mailCredentialsOf('imap', { access_token: 'dummy-token' })).toEqual({ access_token: 'dummy-token' });
    const writer = buildTargetWriterFromCredentials(imap, mailCredentialsOf('imap', { access_token: 'dummy-token' }));
    expect(imapTargetLogin(writer).password).toBe('dummy-token');
  });
});

describe('the account’s source-side mail face signs in as the mailbox too', () => {
  it('builds the IMAP source on the mail host with the mailbox’s login', () => {
    const source = buildSourceConnectorFromCredentials({ type: 'infomaniak', ...CONFIG } as never, CREDS);
    expect(source).toBeInstanceOf(ImapFlowSource);
    expect(imapSourceLogin(source)).toMatchObject({ user: 'someone@example.com', password: 'dummy-mailbox-device-password' });
  });

  it('refuses one with no mail login by field name', () => {
    expect(() => buildSourceConnectorFromCredentials({ type: 'infomaniak', ...CONFIG } as never, SYNC_ONLY)).toThrow(
      'mailUsername/mailPassword are missing',
    );
  });
});

describe('the DAV faces sign in with the sync login, never the mailbox’s', () => {
  it.each(['calendar', 'contact', 'task'] as const)('the %s face', (face) => {
    for (const role of ['source', 'target'] as const) {
      const endpoint = davEndpointFromCreds(role, CONFIG, CREDS, 'infomaniak', face);
      expect(endpoint.username).toBe('AB12345');
      expect(endpoint.password).toBe('dummy-sync-app-password');
    }
  });
});

describe('the qualification measures each face with its own login', () => {
  it('mail with the mailbox’s login at the mail host; calendars, contacts and tasks with the sync login', async () => {
    const seen: string[] = [];
    vi.stubGlobal('fetch', davServerRemembering(seen));
    const asked: Array<{ config: Record<string, unknown>; creds: Record<string, string> }> = [];
    const q = await qualifyAccount('infomaniak', CONFIG, CREDS, {
      imapListable: (config, creds) => {
        asked.push({ config, creds });
        return { listFolders: async () => ['INBOX', 'Sent'] };
      },
    });
    expect(q?.domains.mail.answer).toBe('yes');
    expect(asked).toHaveLength(1);
    expect(asked[0]!.config).toMatchObject({ host: 'mail.infomaniak.com', port: 993 });
    expect(asked[0]!.creds).toEqual({ username: 'someone@example.com', password: 'dummy-mailbox-device-password' });
    expect(q?.domains.calendar.answer).toBe('yes');
    expect(q?.domains.contact.answer).toBe('yes');
    expect(q?.domains.task.answer).toBe('yes');
    expect(seen.length).toBeGreaterThan(0);
    expect(new Set(seen)).toEqual(new Set(['AB12345:dummy-sync-app-password']));
  });

  it('answers kDrive with the reason it is not carried, not "not a face of this connection"', async () => {
    vi.stubGlobal('fetch', davServerRemembering([]));
    const q = await qualifyAccount('infomaniak', CONFIG, CREDS, {
      imapListable: () => ({ listFolders: async () => [] }),
    });
    expect(q?.domains.file).toMatchObject({ answer: 'no', reason: 'structural' });
    expect(q?.domains.file.detail).toContain('kDrive');
    expect(q?.domains.file.detail).not.toContain('is not a face of this connection');
  });

  it('does not measure mail without a mail login, and names the missing fields', async () => {
    vi.stubGlobal('fetch', davServerRemembering([]));
    const imapListable = vi.fn(() => ({ listFolders: async () => ['INBOX'] }));
    const q = await qualifyAccount('infomaniak', CONFIG, SYNC_ONLY, { imapListable });
    // Never asked with the sync login in the mailbox's place.
    expect(imapListable).not.toHaveBeenCalled();
    expect(q?.domains.mail).toMatchObject({ answer: 'unknown', reason: 'incomplete' });
    expect(q?.domains.mail.detail).toContain('stores no mail login');
    expect(q?.domains.mail.detail).toContain('mailUsername/mailPassword');
    // The DAV faces are measured all the same.
    expect(q?.domains.calendar.answer).toBe('yes');
  });

  it('names the mail server and the login when the row stores neither', async () => {
    vi.stubGlobal('fetch', davServerRemembering([]));
    const q = await qualifyAccount('infomaniak', { host: 'sync.infomaniak.com', port: 443 }, SYNC_ONLY);
    expect(q?.domains.mail).toMatchObject({ answer: 'unknown', reason: 'incomplete' });
    expect(q?.domains.mail.detail).toContain('mailHost');
    expect(q?.domains.mail.detail).toContain('mailUsername/mailPassword');
  });

  it('leaves Soverin’s sentence for a row with no mail server word for word', async () => {
    vi.stubGlobal('fetch', davServerRemembering([]));
    const q = await qualifyAccount('soverin', { host: 'caldav.soverin.net', port: 443 }, SYNC_ONLY);
    expect(q?.domains.mail.detail).toBe(
      'This account stores no mail server address, so mail was not measured — add the mail host (mailHost) to ' +
        'the connection to measure this face.',
    );
  });
});

describe('the probe’s headline face signs in with the sync login', () => {
  it('asks the calendars as AB12345, never as the mailbox', async () => {
    const seen: string[] = [];
    vi.stubGlobal('fetch', davServerRemembering(seen));
    const result = await probeTargetConnection('infomaniak', CONFIG, CREDS);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(seen.length).toBeGreaterThan(0);
    expect(new Set(seen)).toEqual(new Set(['AB12345:dummy-sync-app-password']));
  });
});

/** The argument text of every call to `name(` in `source`, parentheses balanced. */
function callsOf(source: string, name: string): string[] {
  const calls: string[] = [];
  let from = 0;
  for (;;) {
    const at = source.indexOf(`${name}(`, from);
    if (at === -1) return calls;
    let depth = 0;
    let end = at + name.length;
    for (; end < source.length; end += 1) {
      if (source[end] === '(') depth += 1;
      else if (source[end] === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    calls.push(source.slice(at, end + 1));
    from = end + 1;
  }
}

/** The file with its comments removed: a comment is prose about code, never code. */
function code(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

describe('the call sites a pure test cannot see', () => {
  const deps = code('./build-deps-from-mapping.ts');

  it('the pass hands the mail writer the mail login, never the record as stored', () => {
    // The declaration is `buildTargetWriterFromCredentials(\n  targetConfig: …`.
    const calls = callsOf(deps, 'buildTargetWriterFromCredentials').filter((c) => !/\(\s*targetConfig: TargetConfig/.test(c));
    expect(calls.length, 'no call to buildTargetWriterFromCredentials').toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.replace(/\s+/g, ' ')).toContain('mailCredentialsOf(targetKind, targetCredentials)');
    }
  });

  it('the account’s source mail face signs in with the mail login, refused by name without one', () => {
    const at = deps.indexOf("sourceFaceBuilder(sourceConfig.type, 'email') === 'imap'");
    expect(at, 'the account kinds’ IMAP branch moved').toBeGreaterThan(-1);
    const branch = deps.slice(at, deps.indexOf('\n  }\n', at));
    expect(branch).toContain('refuseWithoutMailLogin(sourceConfig.type, credentials)');
    expect(branch).toContain('mailCredentialsOf(sourceConfig.type, credentials)');
    expect(branch).not.toMatch(/credentials\.username|credentials\.password/);
  });

  it('no mail seam reads the stored pair by hand', () => {
    // Where a seam signs in to a mail face, it asks `mailLoginOf`. A
    // `creds.password` or `credentials.username` beside an IMAP builder is
    // the seam that forgets the second login.
    const qualification = code('./account-qualification.ts');
    const probe = code('./probe-connection.ts');
    for (const [file, text] of [
      ['account-qualification.ts', qualification],
      ['probe-connection.ts', probe],
    ] as const) {
      for (const call of callsOf(text, 'buildImapSourceFrom')) {
        expect(call, `${file}: ${call.slice(0, 80)}`).not.toMatch(/creds\.(password|username)|credentials\.(password|username)/);
      }
    }
    const mailSeam = deps.slice(deps.indexOf('export function mailTargetConfigFromConnection('));
    const seamBody = mailSeam.slice(0, mailSeam.indexOf('\nexport function '));
    expect(seamBody).not.toMatch(/credentials\.(password|username)/);
  });
});
