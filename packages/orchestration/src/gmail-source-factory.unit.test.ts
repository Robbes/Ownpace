// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The Gmail source's construction, for both editions (workplan 0044).
 *
 * The IMAP connector's tests know nothing about Google, and the token
 * provider's tests know nothing about mail. This file pins the parts that are
 * Gmail's OWN: the build-time refusals in each edition's vocabulary, the scope
 * the token provider is built with, and the view-folder filter that keeps All
 * Mail / Starred / Important from duplicating every message on the target.
 */

import { describe, it, expect } from 'vitest';
import type { MailFolder, MailItem, RawMessage, SourceConnector, TokenProvider } from '@openmig/shared';
import {
  ENV_GMAIL_CREDENTIAL_NAMES,
  GMAIL_SCOPE,
  GmailFolderView,
  STORED_GMAIL_CREDENTIAL_NAMES,
  buildGmailSourceFrom,
  gmailVisibleFolders,
} from './gmail-source-factory';

const CREDS = {
  clientId: 'client-1.apps.googleusercontent.com',
  clientSecret: 'GOCSPX-secret',
  refreshToken: '1//refresh',
};

const fakeProvider: TokenProvider = {
  getToken: async () => 'at-1',
  refresh: async () => 'at-2',
};

/** A folder as the imapflow source reports it — raw LIST attributes included. */
const folder = (path: string, listAttributes: string[]): MailFolder => ({
  path,
  name: path.split('/').pop()!,
  specialUse: 'normal',
  listAttributes,
});

describe('refusing before anything is attempted', () => {
  it('names EVERY missing credential at once, in the appliance operator vocabulary', () => {
    expect(() => buildGmailSourceFrom('user@example.com', {}, ENV_GMAIL_CREDENTIAL_NAMES)).toThrow(
      /GOOGLE_CLIENT_ID.*GOOGLE_CLIENT_SECRET.*GOOGLE_MAIL_REFRESH_TOKEN/s,
    );
  });

  it('names the STORED field for the managed edition, not an env var it never reads', () => {
    const failure = (() => {
      try {
        buildGmailSourceFrom(
          'user@example.com',
          { clientId: 'id', clientSecret: 'secret' },
          STORED_GMAIL_CREDENTIAL_NAMES,
        );
        return undefined;
      } catch (e) {
        return e as Error;
      }
    })();

    expect(failure?.message).toContain('refreshToken');
    expect(failure?.message).not.toContain('GOOGLE_MAIL_REFRESH_TOKEN');
    expect(failure?.message).toContain("connection's stored credentials");
  });

  it('refuses an EMPTY credential, not merely an absent one', () => {
    expect(() =>
      buildGmailSourceFrom(
        'user@example.com',
        { ...CREDS, clientSecret: '' },
        ENV_GMAIL_CREDENTIAL_NAMES,
      ),
    ).toThrow(/GOOGLE_CLIENT_SECRET/);
  });

  it('says the token must be MAIL-consented, because that is the mistake waiting to happen', () => {
    // The operator most likely to configure Gmail already configured Drive with
    // the same OAuth client — and that token answers invalid_scope at mint time.
    expect(() => buildGmailSourceFrom('user@example.com', {})).toThrow(
      /https:\/\/mail\.google\.com\//,
    );
  });

  it('refuses a missing account address: XOAUTH2 authenticates a token FOR an address', () => {
    expect(() => buildGmailSourceFrom('', CREDS)).toThrow(/user/);
  });
});

describe('the token provider is built for MAIL, with the credentials as found', () => {
  it('hands the factory the full mail scope and all three credentials', () => {
    let seen: { creds?: Record<string, string>; scope?: string } = {};
    buildGmailSourceFrom('user@example.com', CREDS, ENV_GMAIL_CREDENTIAL_NAMES, (c, scope) => {
      seen = { creds: c, scope };
      return fakeProvider;
    });

    // https://mail.google.com/ — the ONE scope Google's IMAP endpoint accepts.
    // A factory that fell back to the Drive default would mint tokens Gmail
    // refuses at the door, on every connection, mid-pass.
    expect(seen.scope).toBe(GMAIL_SCOPE);
    expect(seen.creds).toEqual(CREDS);
  });
});

describe('the view-folder filter', () => {
  it('drops All Mail, Starred and Important by ATTRIBUTE, keeping real folders', () => {
    // The three views re-present other folders' messages. Copying them
    // duplicates the mailbox — and worse: mail is ledger-keyed by Message-ID,
    // so the second sighting of each message reads as a MOVE, and the moves
    // queue fills with reports describing Gmail's UI.
    const folders = [
      folder('INBOX', ['\\HasNoChildren']),
      folder('[Gmail]/All Mail', ['\\HasNoChildren', '\\All']),
      folder('[Gmail]/Starred', ['\\HasNoChildren', '\\Flagged']),
      folder('[Gmail]/Important', ['\\HasNoChildren', '\\Important']),
      folder('Projects/2026', ['\\HasNoChildren']),
    ];

    expect(gmailVisibleFolders(folders).map((f) => f.path)).toEqual(['INBOX', 'Projects/2026']);
  });

  it('recognises the attribute case-insensitively, as IMAP requires', () => {
    expect(gmailVisibleFolders([folder('[Gmail]/Alles', ['\\ALL'])])).toEqual([]);
  });

  it('is NOT fooled by localisation or by specialUse', () => {
    // By name the views are localised ("Alle berichten"); by role they map to
    // 'normal' exactly like a real folder. Only the raw attribute tells.
    const dutchView = folder('[Gmail]/Alle berichten', ['\\All']);
    const realFolder = folder('Alle berichten', ['\\HasNoChildren']);

    expect(gmailVisibleFolders([dutchView, realFolder])).toEqual([realFolder]);
  });

  it('keeps a folder that carries no attributes at all', () => {
    // Fakes and non-IMAP folders omit listAttributes; absence of evidence is a
    // real folder, not a view.
    const bare: MailFolder = { path: 'INBOX', specialUse: 'inbox' };
    expect(gmailVisibleFolders([bare])).toEqual([bare]);
  });
});

describe('the wrapper delegates, explicitly', () => {
  // A spread of a class instance loses its prototype methods and produces an
  // object that typechecks and cannot list a folder — the delegation is the
  // behaviour under test.
  const inbox = folder('INBOX', []);
  const view = folder('[Gmail]/All Mail', ['\\All']);
  const item = { messageId: '<m1@x>', folder: inbox, keywords: [], receivedAt: '2026-01-01T00:00:00Z' } as MailItem;
  const raw = { raw: new Uint8Array([1]) } as unknown as RawMessage;

  const innerCalls: string[] = [];
  const inner: SourceConnector = {
    listFolders: async () => {
      innerCalls.push('listFolders');
      return [inbox, view];
    },
    listSince: async (f, cursor) => {
      innerCalls.push(`listSince:${f.path}:${String(cursor)}`);
      return { items: [item], nextCursor: 'c-2' };
    },
    fetch: async (i) => {
      innerCalls.push(`fetch:${i.messageId}`);
      return raw;
    },
  };

  it('filters listFolders and passes listSince/fetch through untouched', async () => {
    const wrapped = new GmailFolderView(inner);

    expect(await wrapped.listFolders()).toEqual([inbox]);
    expect(await wrapped.listSince(inbox, 'c-1')).toEqual({ items: [item], nextCursor: 'c-2' });
    expect(await wrapped.fetch(item)).toBe(raw);
    expect(innerCalls).toEqual(['listFolders', 'listSince:INBOX:c-1', `fetch:<m1@x>`]);
  });
});
