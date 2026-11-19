// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN ADDRESS BOOK THE SERVER WOULD NOT MAKE (workplan 0160).
 *
 * The owner's first contacts pass into Cirrux, on 2026-11-19, failed before
 * it wrote a single card:
 *
 *     contact sync failed: MKCOL failed for /addressbooks/users/<mailbox>/
 *     address-book/ with status 501: the server answered with something that
 *     is not a DAV, JMAP or IMAP error.
 *
 * Two assumptions met a server they did not hold for. The writer put every
 * address book at `addressbooks/users/<username>/`, which is Nextcloud's
 * layout and nobody's standard, and it made a new book for every source
 * folder, which Cirrux does not do: every Cirrux mailbox has one address
 * book, Contacts, and no way to make another, over CardDAV or through
 * Cirrux's own API (https://cirrux.co/help/api/contacts, read 2026-11-19).
 * And the 501 was asked five times, as if the server were busy.
 *
 * The server here is shaped from what Cirrux publishes and what it answered:
 * no Nextcloud path, a home found only by asking (RFC 6764), one book, and
 * 501 to every MKCOL. Where Cirrux keeps its books is not published, so the
 * paths are this test's own; what is pinned is that the writer finds them by
 * asking rather than by assuming.
 */

import { describe, it, expect } from 'vitest';
import { asTenantId, asMappingId, type Ledger } from '@openmig/shared';
import { CardDAVTargetWriter, type HttpClient } from './carddav-target-writer.ts';

const TENANT = asTenantId('a1b2c3d4-0160-4000-8000-000000000001' as never);
const MAPPING = asMappingId('a1b2c3d4-0160-4000-8000-000000000002' as never);
const BASE = 'https://dav.example.net';
const USER = 'sam@example.com';
const ASSUMED_HOME = `${BASE}/addressbooks/users/${USER}/`;
const ASSUMED_BOOK = `${ASSUMED_HOME}address-book/`;
const UID = 'card-0160-1';

const emptyLedger = {
  find: async () => undefined,
  recordIfAbsent: async () => undefined,
} as unknown as Ledger;

/** The folder the owner's source handed over: "Address Book", slug `address-book`. */
const SOURCE_BOOK = { name: 'Address Book', path: '/addressbooks/users/owner/address-book/' };

interface Call {
  method: string;
  url: string;
  depth: string | undefined;
}

type Answer = { status: number; body?: string; headers?: Record<string, string> };

function multistatus(...responses: string[]): string {
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<d:multistatus xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav">' +
    responses.join('') +
    '</d:multistatus>'
  );
}

function propResponse(href: string, prop: string): string {
  return (
    `<d:response><d:href>${href}</d:href><d:propstat><d:prop>${prop}</d:prop>` +
    '<d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>'
  );
}

function principalAt(href: string): Answer {
  return {
    status: 207,
    body: multistatus(
      propResponse('/', `<d:current-user-principal><d:href>${href}</d:href></d:current-user-principal>`),
    ),
  };
}

function homeAt(principal: string, home: string): Answer {
  return {
    status: 207,
    body: multistatus(
      propResponse(principal, `<card:addressbook-home-set><d:href>${home}</d:href></card:addressbook-home-set>`),
    ),
  };
}

/** A Depth-1 listing of `home`: the home itself, then each book with its name. */
function booksAt(home: string, books: Array<{ path: string; name: string }>): Answer {
  return {
    status: 207,
    body: multistatus(
      propResponse(home, '<d:resourcetype><d:collection/></d:resourcetype>'),
      ...books.map((b) =>
        propResponse(
          b.path,
          `<d:resourcetype><d:collection/><card:addressbook/></d:resourcetype><d:displayname>${b.name}</d:displayname>`,
        ),
      ),
    ),
  };
}

const NOT_IMPLEMENTED: Answer = { status: 501, body: 'Not Implemented' };

/**
 * A server answering from a table, keyed `METHOD url`. Anything not in it is
 * a 404, as a server answers a path it does not have. Every request is kept,
 * so a test can say what was NOT asked as well as what was.
 */
function server(routes: Record<string, Answer | ((calls: Call[]) => Answer)>) {
  const calls: Call[] = [];
  const client: HttpClient = {
    async request(o) {
      calls.push({ method: o.method, url: o.url, depth: o.headers?.['Depth'] });
      const route = routes[`${o.method} ${o.url}`];
      const answer = typeof route === 'function' ? route(calls) : route;
      if (answer === undefined) return { status: 404, body: '', headers: {} };
      return { status: answer.status, body: answer.body ?? '', headers: answer.headers ?? {} };
    },
  };
  const writer = new CardDAVTargetWriter(
    { url: BASE, username: USER, password: 'app-password' },
    { ledger: emptyLedger, tenantId: TENANT, mappingId: MAPPING, httpClient: client },
  );
  return { writer, calls };
}

const card = () =>
  ({ vcard: `BEGIN:VCARD\r\nVERSION:3.0\r\nUID:${UID}\r\nFN:Someone\r\nEND:VCARD` }) as never;

/** One card in an addressbook-query answer, as the listing asks for it. */
function cardListing(bookPath: string): string {
  return multistatus(
    `<d:response><d:href>${bookPath}${UID}.vcf</d:href><d:propstat><d:prop>` +
      '<d:getetag>"e1"</d:getetag><d:getcontentlength>80</d:getcontentlength>' +
      `<card:address-data>BEGIN:VCARD\r\nUID:${UID}\r\nEND:VCARD</card:address-data>` +
      '</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>',
  );
}

/** Cirrux's shape: the home is named by the principal, it holds one book, and MKCOL is 501 everywhere. */
function oneBookServer() {
  const home = '/addressbooks/7f3a/';
  const book = '/addressbooks/7f3a/0a1b2c3d/';
  let written = false;
  const routes: Record<string, Answer | ((calls: Call[]) => Answer)> = {
    [`MKCOL ${ASSUMED_BOOK}`]: NOT_IMPLEMENTED,
    [`PROPFIND ${BASE}/.well-known/carddav`]: principalAt('/principals/7f3a/'),
    [`PROPFIND ${BASE}/principals/7f3a/`]: homeAt('/principals/7f3a/', home),
    [`PROPFIND ${BASE}${home}`]: booksAt(home, [{ path: book, name: 'Contacts' }]),
    [`MKCOL ${BASE}${home}address-book/`]: NOT_IMPLEMENTED,
    // A second source folder, asked for in its turn: refused the same way.
    [`MKCOL ${ASSUMED_HOME}work/`]: NOT_IMPLEMENTED,
    [`MKCOL ${BASE}${home}work/`]: NOT_IMPLEMENTED,
    [`REPORT ${BASE}${book}`]: () =>
      written ? { status: 207, body: cardListing(book) } : { status: 207, body: multistatus() },
    [`PUT ${BASE}${book}${UID}.vcf`]: () => {
      written = true;
      return { status: 201, headers: { etag: '"e1"' } };
    },
  };
  return { ...server(routes), home, book };
}

describe('a server that makes no address book (Cirrux)', () => {
  it('writes the folder into the one book the account has, found by asking', async () => {
    const { writer, calls, book } = oneBookServer();

    const folderId = await writer.ensureContactFolder(SOURCE_BOOK);
    expect(folderId).toBe(book);

    const result = await writer.upsertContact(folderId, card());
    expect(result.created).toBe(true);
    expect(calls.filter((c) => c.method === 'PUT').map((c) => c.url)).toEqual([`${BASE}${book}${UID}.vcf`]);
  });

  it('hears the 501 once: Not Implemented is not "busy"', async () => {
    const { writer, calls } = oneBookServer();

    await writer.ensureContactFolder(SOURCE_BOOK);

    expect(calls.filter((c) => c.method === 'MKCOL' && c.url === ASSUMED_BOOK)).toHaveLength(1);
  });

  it('asks where the books are as RFC 6764 says: the well-known address, then the principal', async () => {
    const { writer, calls } = oneBookServer();

    await writer.ensureContactFolder(SOURCE_BOOK);

    const asked = calls.filter((c) => c.method === 'PROPFIND').map((c) => c.url);
    expect(asked).toContain(`${BASE}/.well-known/carddav`);
    expect(asked).toContain(`${BASE}/principals/7f3a/`);
    // Each a question about one resource, not a walk.
    for (const c of calls.filter((x) => x.url.includes('well-known') || x.url.includes('principals'))) {
      expect(c.depth).toBe('0');
    }
  });

  it('asks once per writer, however many folders it is handed', async () => {
    const { writer, calls, book } = oneBookServer();

    expect(await writer.ensureContactFolder(SOURCE_BOOK)).toBe(book);
    expect(await writer.ensureContactFolder({ name: 'Work', path: '/addressbooks/users/owner/work/' })).toBe(book);

    expect(calls.filter((c) => c.url === `${BASE}/.well-known/carddav`)).toHaveLength(1);
  });

  it('looks further when the assumed home answers but holds no book', async () => {
    // A server may answer 207 for a path it has nothing at. An assumed home
    // with no book in it is no evidence the account has none.
    const book = '/addressbooks/7f3a/0a1b2c3d/';
    const { writer: answering } = server({
      [`PROPFIND ${ASSUMED_HOME}`]: booksAt(`/addressbooks/users/${USER}/`, []),
      [`MKCOL ${ASSUMED_BOOK}`]: NOT_IMPLEMENTED,
      [`PROPFIND ${BASE}/.well-known/carddav`]: principalAt('/principals/7f3a/'),
      [`PROPFIND ${BASE}/principals/7f3a/`]: homeAt('/principals/7f3a/', '/addressbooks/7f3a/'),
      [`PROPFIND ${BASE}/addressbooks/7f3a/`]: booksAt('/addressbooks/7f3a/', [{ path: book, name: 'Contacts' }]),
    });

    expect(await answering.ensureContactFolder(SOURCE_BOOK)).toBe(book);
  });

  it('verifies against the book the server named, not an empty assumed home', async () => {
    const { writer, book } = oneBookServer();
    await writer.upsertContact(await writer.ensureContactFolder(SOURCE_BOOK), card());

    const entries = [];
    for await (const entry of writer.listEntries()) entries.push(entry);

    expect(entries.map((e) => [e.naturalKey, e.mailboxId])).toEqual([[UID, book]]);
  });
});

describe('a server whose home is elsewhere, but which makes books', () => {
  it('makes the book in the home the server names, beside the one it has', async () => {
    // SabreDAV's own default layout: `addressbooks/<user>/`, no `users/`. The
    // assumed path's parent does not exist, which MKCOL answers with 409.
    const home = `/addressbooks/${USER}/`;
    const { writer, calls } = server({
      [`MKCOL ${ASSUMED_BOOK}`]: { status: 409 },
      [`PROPFIND ${BASE}/.well-known/carddav`]: principalAt(`/principals/${USER}/`),
      [`PROPFIND ${BASE}/principals/${USER}/`]: homeAt(`/principals/${USER}/`, home),
      [`PROPFIND ${BASE}${home}`]: booksAt(home, [{ path: `${home}default/`, name: 'Contacts' }]),
      [`MKCOL ${BASE}${home}address-book/`]: { status: 201 },
    });

    expect(await writer.ensureContactFolder(SOURCE_BOOK)).toBe(`${home}address-book/`);
    expect(calls.filter((c) => c.method === 'MKCOL').map((c) => c.url)).toEqual([
      ASSUMED_BOOK,
      `${BASE}${home}address-book/`,
    ]);
  });
});

describe('a server with several books', () => {
  const home = '/addressbooks/7f3a/';
  const discovery = {
    [`MKCOL ${ASSUMED_BOOK}`]: NOT_IMPLEMENTED,
    [`PROPFIND ${BASE}/.well-known/carddav`]: principalAt('/principals/7f3a/'),
    [`PROPFIND ${BASE}/principals/7f3a/`]: homeAt('/principals/7f3a/', home),
    [`MKCOL ${BASE}${home}address-book/`]: NOT_IMPLEMENTED,
  };

  it('uses the one with the folder’s name', async () => {
    const { writer, calls } = server({
      ...discovery,
      [`PROPFIND ${BASE}${home}`]: booksAt(home, [
        { path: `${home}0a1b/`, name: 'Contacts' },
        { path: `${home}9e8d/`, name: 'Address Book' },
      ]),
    });

    expect(await writer.ensureContactFolder(SOURCE_BOOK)).toBe(`${home}9e8d/`);
    // Found, so not made: the only MKCOL is the first one.
    expect(calls.filter((c) => c.method === 'MKCOL').map((c) => c.url)).toEqual([ASSUMED_BOOK]);
  });

  it('does not guess between them when none has it, and names them', async () => {
    const { writer, calls } = server({
      ...discovery,
      [`PROPFIND ${BASE}${home}`]: booksAt(home, [
        { path: `${home}0a1b/`, name: 'Contacts' },
        { path: `${home}5c6d/`, name: 'Work' },
      ]),
    });

    const thrown = await writer.ensureContactFolder(SOURCE_BOOK).catch((e: unknown) => e);
    expect(String(thrown)).toMatch(new RegExp(`MKCOL failed for /addressbooks/users/${USER}/address-book/ with status 501`));
    expect(String(thrown)).toContain(`2 at ${home}, none of them by that name (Contacts, Work)`);
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });
});

describe('what is not a wrong place', () => {
  it('a refused sign-in is the answer: nothing else is asked', async () => {
    const { writer, calls } = server({ [`MKCOL ${ASSUMED_BOOK}`]: { status: 401, body: 'Unauthorized' } });

    await expect(writer.ensureContactFolder(SOURCE_BOOK)).rejects.toThrow(
      new RegExp(`^MKCOL failed for /addressbooks/users/${USER}/address-book/ with status 401`),
    );
    expect(calls.map((c) => c.method)).toEqual(['PROPFIND', 'MKCOL']);
  });

  it('a server that names no home fails with the first answer, and with what asking found', async () => {
    // No well-known address, no principal at the base, no assumed home.
    const { writer } = server({ [`MKCOL ${ASSUMED_BOOK}`]: NOT_IMPLEMENTED });

    const thrown = String(await writer.ensureContactFolder(SOURCE_BOOK).catch((e: unknown) => e));
    expect(thrown).toMatch(new RegExp(`MKCOL failed for /addressbooks/users/${USER}/address-book/ with status 501`));
    expect(thrown).toContain(
      `Looking for this account's own address books failed too: PROPFIND on address book home set /addressbooks/users/${USER}/ failed with status 404`,
    );
  });

  it('a home on another host is not followed', async () => {
    const { writer, calls } = server({
      [`MKCOL ${ASSUMED_BOOK}`]: NOT_IMPLEMENTED,
      [`PROPFIND ${BASE}/.well-known/carddav`]: principalAt('https://elsewhere.example.org/principals/7f3a/'),
    });

    await expect(writer.ensureContactFolder(SOURCE_BOOK)).rejects.toThrow(/with status 501/);
    expect(calls.some((c) => c.url.startsWith('https://elsewhere.example.org'))).toBe(false);
  });

  it('an href it cannot read names nothing, and the next place is still asked', async () => {
    // `%E0%A4%A` is a cut-off escape: the href cannot be decoded. The
    // well-known answer is unreadable; the base's answer is not.
    const { writer } = server({
      [`MKCOL ${ASSUMED_BOOK}`]: NOT_IMPLEMENTED,
      [`PROPFIND ${BASE}/.well-known/carddav`]: principalAt('/principals/7f3a/'),
      [`PROPFIND ${BASE}/principals/7f3a/`]: homeAt('/principals/7f3a/', '/addressbooks/%E0%A4%A/'),
      [`PROPFIND ${BASE}/`]: principalAt('/principals/b2/'),
      [`PROPFIND ${BASE}/principals/b2/`]: homeAt('/principals/b2/', '/addressbooks/b2/'),
      [`PROPFIND ${BASE}/addressbooks/b2/`]: booksAt('/addressbooks/b2/', [{ path: '/addressbooks/b2/c/', name: 'Contacts' }]),
    });

    expect(await writer.ensureContactFolder(SOURCE_BOOK)).toBe('/addressbooks/b2/c/');
  });

  it('a home that cannot be listed is a failure, never an empty account', async () => {
    const home = '/addressbooks/7f3a/';
    const { writer } = server({
      [`PROPFIND ${BASE}/.well-known/carddav`]: principalAt('/principals/7f3a/'),
      [`PROPFIND ${BASE}/principals/7f3a/`]: homeAt('/principals/7f3a/', home),
      [`PROPFIND ${BASE}${home}`]: { status: 503, body: 'busy' },
    });

    const listing = (async () => {
      for await (const _ of writer.listEntries()) void _;
    })();
    await expect(listing).rejects.toThrow(`PROPFIND on address book home set ${home} failed with status 503`);
  });
});

describe("Nextcloud's layout", () => {
  it('costs no request more than before: the assumed book exists, nothing is discovered', async () => {
    const { writer, calls } = server({ [`PROPFIND ${ASSUMED_BOOK}`]: { status: 207, body: multistatus() } });

    expect(await writer.ensureContactFolder(SOURCE_BOOK)).toBe(`/addressbooks/users/${USER}/address-book/`);
    expect(calls).toHaveLength(1);
  });

  it('nor when the book is made where it is assumed', async () => {
    const { writer, calls } = server({ [`MKCOL ${ASSUMED_BOOK}`]: { status: 201 } });

    expect(await writer.ensureContactFolder(SOURCE_BOOK)).toBe(`/addressbooks/users/${USER}/address-book/`);
    expect(calls.map((c) => c.method)).toEqual(['PROPFIND', 'MKCOL']);
  });
});
