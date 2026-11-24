// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A DAV SOURCE THROUGH THE MANAGED DOOR (workplan 0169; the owner, 2026-11-24:
 * *"yes to all, build them. But dont add the nextcloud as source card, add
 * only the generic cards as source."*).
 *
 * The create route stores a CalDAV, CardDAV or WebDAV source as a connection
 * of that kind, in the shape a DAV target is stored: `host`, `port`, `useSsl`,
 * and `url` where one was typed, with the login in the encrypted secret. These
 * hold that the worker's managed wiring opens that row as the source a pass
 * reads, for the faces the protocol carries:
 *
 * - each kind's faces resolve to the `dav` builder, as an unclaimed kind's
 *   always have (`sourceFaceBuilder`);
 * - the builders a pass calls hand back the DAV connectors;
 * - a `listFolders` from each reaches the server at the address the row
 *   names, typed `url` first, signed in with the stored login; a WebDAV row
 *   is read where its address points, with no Nextcloud `files/<user>/`
 *   appended, because it is not a Nextcloud row;
 * - the Test button (`probeSourceConnection`) answers for each kind with its
 *   own face, rather than "No probe exists".
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { CalDAVSource, CarddavSource, WebdavFileSource } from '@openmig/connectors';
import { SOURCE_TYPE_DOMAINS } from '@openmig/shared';
import { sourceFaceBuilder } from './source-face-builders.ts';
import {
  buildCalendarSourceFromConnection,
  buildContactSourceFromConnection,
  buildFileSourceFromConnection,
  buildTaskSourceFromConnection,
} from './build-deps-from-mapping.ts';
import { probeSourceConnection } from './probe-connection.ts';

interface Arrival {
  readonly method: string;
  readonly path: string;
  readonly authorization: string;
}

let arrivals: Arrival[] = [];
let server: http.Server;
let port = 0;

/** An empty multistatus: a server that answers, and holds nothing. */
const EMPTY = '<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:"></d:multistatus>';

beforeAll(async () => {
  server = http.createServer((req, res) => {
    arrivals.push({
      method: req.method ?? '',
      path: req.url ?? '/',
      authorization: String(req.headers.authorization ?? ''),
    });
    req.resume();
    res.writeHead(207, { 'content-type': 'application/xml; charset=utf-8' });
    res.end(EMPTY);
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
});

afterEach(() => {
  arrivals = [];
});

const CREDS = { username: 'leaver', password: 'an-app-password' };
const BASIC = `Basic ${Buffer.from('leaver:an-app-password').toString('base64')}`;

/** A row as the create route stores it, by host and port. */
const byHost = () => ({ host: '127.0.0.1', port, useSsl: false });
/** The same row with a typed base URL, which wins over host and port. */
const byUrl = () => ({ host: 'not-used.example.test', port: 1, useSsl: true, url: `http://127.0.0.1:${port}/dav/root/` });

describe('each DAV kind is built by the dav builder, for the faces its protocol carries', () => {
  it.each([
    ['caldav', ['calendar', 'task']],
    ['carddav', ['contact']],
    ['webdav', ['file']],
  ] as const)('%s carries %j, and each is the dav builder', (kind, faces) => {
    expect(SOURCE_TYPE_DOMAINS[kind]).toEqual(faces);
    for (const face of faces) expect(sourceFaceBuilder(kind, face)).toBe('dav');
  });
});

describe('the builders a pass calls hand back the DAV connectors', () => {
  it('caldav: a CalDAV source for calendars, and the same class for tasks', () => {
    const row = { kind: 'caldav', config: byHost(), creds: CREDS };
    expect(buildCalendarSourceFromConnection(row, undefined)).toBeInstanceOf(CalDAVSource);
    expect(buildTaskSourceFromConnection(row, undefined)).toBeInstanceOf(CalDAVSource);
  });

  it('carddav: a CardDAV source', () => {
    expect(buildContactSourceFromConnection({ kind: 'carddav', config: byHost(), creds: CREDS }, undefined)).toBeInstanceOf(
      CarddavSource,
    );
  });

  it('webdav: a WebDAV file source', () => {
    expect(buildFileSourceFromConnection({ kind: 'webdav', config: byHost(), creds: CREDS }, undefined)).toBeInstanceOf(
      WebdavFileSource,
    );
  });

  it('a row with no login is refused by name, not built to fail later as a 401', () => {
    expect(() =>
      buildCalendarSourceFromConnection({ kind: 'caldav', config: byHost(), creds: { username: 'leaver' } }, undefined),
    ).toThrow(/source DAV connection is missing credentials/);
  });
});

describe('a listing reaches the address the row names, with the stored login', () => {
  it('webdav by its typed base URL: read there, with no Nextcloud files/<user>/ appended', async () => {
    await buildFileSourceFromConnection({ kind: 'webdav', config: byUrl(), creds: CREDS }, undefined).listFolders();

    expect(arrivals.length).toBeGreaterThan(0);
    expect(arrivals[0]!.method).toBe('PROPFIND');
    expect(arrivals[0]!.path).toBe('/dav/root/');
    expect(arrivals.every((a) => a.authorization === BASIC)).toBe(true);
    expect(arrivals.some((a) => a.path.includes('/files/leaver'))).toBe(false);
  });

  it('webdav by host and port: read at the host root', async () => {
    await buildFileSourceFromConnection({ kind: 'webdav', config: byHost(), creds: CREDS }, undefined).listFolders();

    expect(arrivals[0]!.path).toBe('/');
  });

  it.each([
    ['caldav', buildCalendarSourceFromConnection],
    ['carddav', buildContactSourceFromConnection],
  ] as const)('%s by its typed base URL: its discovery starts under that URL, signed in', async (kind, build) => {
    await build({ kind, config: byUrl(), creds: CREDS }, undefined)
      .listFolders()
      .catch(() => undefined);

    expect(arrivals.length).toBeGreaterThan(0);
    expect(arrivals.some((a) => a.path.startsWith('/dav/root/'))).toBe(true);
    expect(arrivals.every((a) => a.authorization === BASIC)).toBe(true);
  });
});

describe('the Test button answers for each DAV source kind', () => {
  it.each(['caldav', 'carddav', 'webdav'] as const)('%s: a probe exists, and it asks the server', async (kind) => {
    const result = await probeSourceConnection(kind, byUrl(), CREDS);

    if (!result.ok) expect(result.outcome?.code).not.toBe('noProbe');
    expect(arrivals.length).toBeGreaterThan(0);
  });

  it('webdav: an empty server answers connected, with no folders', async () => {
    const result = await probeSourceConnection('webdav', byUrl(), CREDS);

    expect(result).toMatchObject({ ok: true, outcome: { code: 'connected', count: 0, unit: 'folder' } });
  });
});
