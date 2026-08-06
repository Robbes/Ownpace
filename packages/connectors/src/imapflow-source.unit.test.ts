// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * `ImapFlowSource` against a fake imapflow client (workplan 0032 T1).
 *
 * The real gate for this connector is `imap-parity.integration.test.ts`, which
 * runs it beside `ImapSource` against a live Stalwart and names every field
 * they disagree about. These tests do the thing that harness cannot: pin the
 * decisions that are ours rather than the server's, and pin them where a fake
 * can make the wrong answer reachable on demand.
 *
 * Four of them matter:
 *
 *   1. **Special-use comes from the server's LIST flags, never imapflow's
 *      name-based inference.** imapflow will happily decide that a folder
 *      called "Gelöschte Elemente" is `\Trash`. Believing it would change
 *      which folders `excludeSpecialUse` keeps out of the migration AND which
 *      folder the deletion signal reads as the owner's bin — an owner-visible
 *      scope change smuggled inside a client swap.
 *   2. **The natural key is produced by the SHARED helper.** Angle brackets
 *      kept when present, added when not, and an absent id counted as
 *      `unkeyable` rather than dropped.
 *   3. **The cursor arithmetic is `ImapSource`'s, exactly.** A resume filters
 *      `uid >= cursor.uidNext`; a UIDVALIDITY change falls back to a full scan;
 *      the next cursor is `max(uid) + 1`.
 *   4. **An empty mailbox is not fetched, and a failure is never an empty
 *      listing.** "This folder has no mail" and "this folder could not be
 *      read" are answers the sync loop treats very differently (hard rule 9).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MailFolder } from '@openmig/shared';

/** One message as the fake server holds it. */
interface FakeMessage {
  uid: number;
  flags?: Set<string>;
  envelope?: { messageId?: string };
  internalDate?: Date;
  size?: number;
  source?: Buffer;
}

/** What the fake server is configured to be, per test. */
let mailboxes: Array<{
  path: string;
  name: string;
  flags: Set<string>;
  specialUse?: string;
}>;
let messages: FakeMessage[];
let boxState: { uidValidity: bigint; uidNext: number; exists: number };
let openable: boolean;
/** Every call the connector made, so a test can assert what was NOT called. */
let calls: string[];
let connects: number;
let logouts: number;
/** Set to make the next N operations fail, e.g. to drive the auth-retry path. */
let failNextOperations: { count: number; error: Error } | null;

vi.mock('imapflow', () => {
  class FakeImapFlow {
    mailbox: unknown = false;
    constructor(public readonly options: Record<string, unknown>) {
      calls.push(`new(${String(options.host)}:${String(options.port)})`);
    }
    async connect(): Promise<void> {
      connects++;
      calls.push('connect');
    }
    async logout(): Promise<void> {
      logouts++;
      calls.push('logout');
    }
    close(): void {
      calls.push('close');
    }
    async list() {
      calls.push('list');
      maybeFail();
      return mailboxes;
    }
    async mailboxOpen(path: string) {
      calls.push(`mailboxOpen(${path})`);
      if (!openable) throw new Error('NONEXISTENT');
      this.mailbox = { path, ...boxState };
      return this.mailbox;
    }
    async getMailboxLock(path: string) {
      calls.push(`lock(${path})`);
      maybeFail();
      if (!openable) throw new Error('NONEXISTENT');
      this.mailbox = { path, ...boxState };
      return { path, release: () => calls.push(`release(${path})`) };
    }
    async fetchAll(range: string, query: Record<string, unknown>) {
      calls.push(`fetchAll(${range},${Object.keys(query).sort().join('+')})`);
      return messages;
    }
    async fetchOne(seq: string, query: Record<string, unknown>, options: Record<string, unknown>) {
      calls.push(`fetchOne(${seq},uid=${String(options.uid)})`);
      const found = messages.find((m) => String(m.uid) === seq);
      return found ?? false;
    }
  }
  return { ImapFlow: FakeImapFlow };
});

function maybeFail(): void {
  if (failNextOperations && failNextOperations.count > 0) {
    failNextOperations.count--;
    throw failNextOperations.error;
  }
}

// Imported AFTER the mock is declared, the way vitest hoisting requires.
const { ImapFlowSource } = await import('./imapflow-source');

function source(extra: Record<string, unknown> = {}) {
  return new ImapFlowSource({
    host: 'imap.test',
    port: 993,
    tls: true,
    auth: { user: 'source@dev.local', password: 'pw' },
    ...extra,
  } as ConstructorParameters<typeof ImapFlowSource>[0]);
}

const INBOX: MailFolder = { path: 'INBOX', name: 'INBOX', specialUse: 'inbox' };

beforeEach(() => {
  calls = [];
  connects = 0;
  logouts = 0;
  openable = true;
  failNextOperations = null;
  mailboxes = [
    { path: 'INBOX', name: 'INBOX', flags: new Set(['\\HasNoChildren']) },
    { path: 'Sent', name: 'Sent', flags: new Set(['\\Sent']) },
  ];
  boxState = { uidValidity: 42n, uidNext: 10, exists: 0 };
  messages = [];
});

// =======================================================================
// 1. Special-use: the server's flags, not imapflow's guess
// =======================================================================

describe('special-use', () => {
  it('reads the roles the server actually advertised', async () => {
    const folders = await source().listFolders();
    expect(folders.map((f) => [f.path, f.specialUse])).toEqual([
      ['INBOX', 'normal'],
      ['Sent', 'sent'],
    ]);
  });

  it('IGNORES imapflow’s name-based inference', async () => {
    // imapflow infers a role from a LOCALISED FOLDER NAME when the server does
    // not advertise RFC 6154 — here it has decided a folder called "Gelöschte
    // Elemente" is the trash, with no server flag behind it.
    //
    // Believing that would change which folders `excludeSpecialUse` keeps out
    // of the migration, and would make a folder nobody classified as a bin
    // start being read as evidence the owner deleted things (§11.1). That is
    // an owner-visible scope change, and shipping it inside a client swap is
    // exactly what 0032's harness exists to prevent. So: `normal`.
    mailboxes = [
      { path: 'Gelöschte Elemente', name: 'Gelöschte Elemente', flags: new Set(), specialUse: '\\Trash' },
      { path: 'Verzonden', name: 'Verzonden', flags: new Set(), specialUse: '\\Sent' },
    ];
    const folders = await source().listFolders();
    expect(folders.map((f) => f.specialUse)).toEqual(['normal', 'normal']);
  });

  it('falls back to INBOX when the server lists nothing but can open it', async () => {
    mailboxes = [];
    const folders = await source().listFolders();
    // An account with mail in it reported as empty is the failure hard rule 9
    // forbids, so a LIST that returns nothing is probed rather than believed.
    expect(folders).toEqual([{ path: 'INBOX', name: 'INBOX', specialUse: 'inbox' }]);
  });

  it('throws when the server lists nothing AND INBOX cannot be opened', async () => {
    mailboxes = [];
    openable = false;
    await expect(source().listFolders()).rejects.toThrow(/INBOX cannot be opened/);
  });
});

// =======================================================================
// 2. The natural key
// =======================================================================

describe('the natural key', () => {
  beforeEach(() => {
    boxState = { uidValidity: 42n, uidNext: 10, exists: 3 };
    messages = [
      { uid: 1, envelope: { messageId: '<plain@dev.local>' }, size: 10, internalDate: new Date(0) },
      { uid: 2, envelope: { messageId: 'unbracketed@dev.local' }, size: 20, internalDate: new Date(0) },
      { uid: 3, envelope: {}, size: 30, internalDate: new Date(0) },
    ];
  });

  it('keeps angle brackets, adds them when missing, and counts what has none', async () => {
    const listed = await source().listSince(INBOX);
    expect(listed.items.map((i) => i.messageId)).toEqual([
      // Verbatim. `MailItem.messageId` documents "including angle brackets as
      // received", and this is the string `naturalKeyForItem` hashes.
      '<plain@dev.local>',
      '<unbracketed@dev.local>',
      // Emitted with an EMPTY id rather than dropped: the sync derives one from
      // the body bytes and writes it in. Dropping it made such messages
      // invisible to both halves of the verification gate at once.
      '',
    ]);
    // And the customer is told how many of their messages we had to give an id
    // to, because we modified those messages.
    expect(listed.unkeyable).toBe(1);
  });

  it('omits the unkeyable count entirely when there is nothing to report', async () => {
    messages = messages.slice(0, 1);
    boxState = { ...boxState, exists: 1 };
    const listed = await source().listSince(INBOX);
    // Absent, not zero — the same shape `ImapSource` returns, so the parity
    // harness compares like with like.
    expect(listed.unkeyable).toBeUndefined();
  });

  it('builds sourceRef as folder:uid, which is what fetch reads back', async () => {
    const listed = await source().listSince(INBOX);
    expect(listed.items.map((i) => i.sourceRef)).toEqual(['INBOX:1', 'INBOX:2', 'INBOX:3']);
  });

  it('carries flags, size and the internal date', async () => {
    messages = [
      {
        uid: 7,
        flags: new Set(['\\Seen', '\\Flagged']),
        envelope: { messageId: '<x@dev.local>' },
        internalDate: new Date('2026-08-06T10:00:00.000Z'),
        size: 512,
      },
    ];
    boxState = { ...boxState, exists: 1 };
    const [item] = (await source().listSince(INBOX)).items;
    expect([...item!.keywords].sort()).toEqual(['$flagged', '$seen']);
    expect(item!.receivedAt).toBe('2026-08-06T10:00:00.000Z');
    expect(item!.size).toBe(512);
  });
});

// =======================================================================
// 3. The cursor
// =======================================================================

describe('the cursor', () => {
  beforeEach(() => {
    boxState = { uidValidity: 42n, uidNext: 10, exists: 2 };
    messages = [
      { uid: 4, envelope: { messageId: '<a@dev.local>' }, size: 1, internalDate: new Date(0) },
      { uid: 9, envelope: { messageId: '<b@dev.local>' }, size: 1, internalDate: new Date(0) },
    ];
  });

  it('encodes UIDVALIDITY:maxUid+1, converting imapflow’s bigint', async () => {
    const listed = await source().listSince(INBOX);
    // imapflow types UIDVALIDITY as a bigint; the cursor is decimal text either
    // way. A `42n` leaking into the string would make every resume mis-parse.
    expect(listed.nextCursor.value).toBe('42:10');
  });

  it('resumes at uid >= the cursor, including the message AT the boundary', async () => {
    const listed = await source().listSince(INBOX, { value: '42:9' });
    // `>=`, not `>`. Off by one here silently skips exactly one message per
    // pass, forever.
    expect(listed.items.map((i) => i.sourceRef)).toEqual(['INBOX:9']);

    // AND THE CURSOR DOES NOT ADVANCE PAST IT — `42:9`, not `42:10`.
    //
    // That is `ImapSource`'s arithmetic reproduced exactly, quirk included:
    // it seeds `maxUidNext` from the CURSOR and only bumps on `uid > maxUidNext`,
    // so the highest message re-lists on every subsequent pass. Harmless (the
    // ledger skips it) and NOT fixed here on purpose: T1 is a client swap, and
    // a cursor that advanced differently is precisely the disagreement the
    // parity harness would report — correctly, since one of the two clients
    // would then be resuming from a different place than the other.
    //
    // This expectation was written as `42:10` first and the test caught it,
    // which is the only reason it is stated rather than assumed.
    expect(listed.nextCursor.value).toBe('42:9');
  });

  it('falls back to a full scan when UIDVALIDITY changed', async () => {
    const listed = await source().listSince(INBOX, { value: '41:9' });
    // The server re-numbered the mailbox, so the cursor's UIDs now name
    // different messages. Resuming from one would skip real mail.
    expect(listed.items.map((i) => i.sourceRef)).toEqual(['INBOX:4', 'INBOX:9']);
  });

  it('falls back to a full scan on a malformed cursor', async () => {
    const listed = await source().listSince(INBOX, { value: 'not-a-cursor' });
    expect(listed.items).toHaveLength(2);
  });
});

// =======================================================================
// 4. Empty is not the same as broken
// =======================================================================

describe('an empty mailbox', () => {
  it('is not fetched at all, and still returns a usable cursor', async () => {
    boxState = { uidValidity: 42n, uidNext: 5, exists: 0 };
    const listed = await source().listSince(INBOX);
    expect(listed.items).toEqual([]);
    // `1:*` against zero messages errors on some servers and returns nothing on
    // others. A thrown error would read as "this folder could not be listed",
    // which the sync loop treats very differently from "this folder is empty".
    expect(calls.some((c) => c.startsWith('fetchAll'))).toBe(false);
    expect(listed.nextCursor.value).toBe('42:5');
  });

  it('surfaces a listing failure rather than reporting no messages', async () => {
    failNextOperations = { count: 1, error: new Error('server said NO') };
    await expect(source().listSince(INBOX)).rejects.toThrow(/server said NO/);
  });
});

// =======================================================================
// 5. Fetching bytes
// =======================================================================

describe('fetch', () => {
  const item = {
    messageId: '<a@dev.local>',
    folder: INBOX,
    keywords: [],
    receivedAt: '2026-08-06T10:00:00.000Z',
    size: 4,
    sourceRef: 'INBOX:7',
  };

  it('reads the UID out of sourceRef and returns the bytes verbatim', async () => {
    const bytes = Buffer.from('From: a\r\n\r\nbody');
    messages = [{ uid: 7, source: bytes }];
    const raw = await source().fetch(item);
    expect(raw.rfc822).toBe(bytes);
    // By UID, not by sequence number: a sequence number changes when anything
    // ahead of it is expunged, so fetching by one would return a different
    // message than the listing named.
    expect(calls).toContain('fetchOne(7,uid=true)');
  });

  it('retries a message that is not there yet, then gives up loudly', async () => {
    messages = [];
    await expect(source().fetch(item)).rejects.toThrow(/Message not found: INBOX:7/);
    // Three attempts, matching `ImapSource` — the race belongs to the server
    // (a message APPENDed moments ago), not to the client library.
    expect(calls.filter((c) => c.startsWith('fetchOne'))).toHaveLength(3);
  });

  it('refuses a message whose bytes did not arrive', async () => {
    messages = [{ uid: 7 }];
    // Returning an empty buffer would copy a zero-byte message and count it a
    // success — the worst thing this method could do.
    await expect(source().fetch(item)).rejects.toThrow(/No body found/);
  });

  it('releases the mailbox lock even when the fetch fails', async () => {
    messages = [];
    await source().fetch(item).catch(() => undefined);
    expect(calls).toContain('release(INBOX)');
  });
});

// =======================================================================
// 6. Connections and tokens
// =======================================================================

describe('the connection', () => {
  it('logs out after a successful operation', async () => {
    await source().listFolders();
    expect(connects).toBe(1);
    expect(logouts).toBe(1);
  });

  it('logs out after a failed one, without replacing the error', async () => {
    failNextOperations = { count: 1, error: new Error('LIST exploded') };
    await expect(source().listFolders()).rejects.toThrow(/LIST exploded/);
    // A logout that swallowed the real error would leave the operator with a
    // meaningless message about a socket (hard rule 9).
    expect(logouts).toBe(1);
  });

  it('refreshes the token ONCE on an auth failure and retries', async () => {
    let refreshes = 0;
    failNextOperations = { count: 1, error: new Error('AUTHENTICATIONFAILED') };
    const folders = await source({
      authType: 'XOAUTH2',
      tokenProvider: {
        getToken: async () => ({ accessToken: 'tok', expiresAt: new Date().toISOString() }),
        refresh: async () => {
          refreshes++;
          return { accessToken: 'tok2', expiresAt: new Date().toISOString() };
        },
      },
    }).listFolders();

    expect(refreshes).toBe(1);
    expect(folders).toHaveLength(2);
    // Once, deliberately: a token still rejected after a refresh is a
    // configuration problem, and looping turns a clear failure into a slow one.
    expect(connects).toBe(2);
  });

  it('does not retry an auth failure when there is no token provider', async () => {
    failNextOperations = { count: 5, error: new Error('AUTHENTICATIONFAILED') };
    await expect(source().listFolders()).rejects.toThrow(/AUTHENTICATIONFAILED/);
    expect(connects).toBe(1);
  });

  it('passes the configured host, port and TLS through', async () => {
    await source().listFolders();
    expect(calls[0]).toBe('new(imap.test:993)');
  });
});
