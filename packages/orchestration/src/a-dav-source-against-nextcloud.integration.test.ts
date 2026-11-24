// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A DAV SOURCE AGAINST A REAL NEXTCLOUD (workplan 0169).
 *
 * The managed door stores a CalDAV, CardDAV or WebDAV source as a connection
 * of its kind, in a DAV target's config shape, with the login in the
 * encrypted secret. Its Test is `probeSourceConnection`, through the builders
 * a pass calls (`buildCalendarSourceFromConnection` and its siblings). These
 * drive it against the Testcontainers Nextcloud the connectors' own
 * integration tests use (`NEXTCLOUD_WEBDAV_URL`, set by the global setup), so
 * the row a person's typing produces is read by a real server, not a stub:
 *
 * - typed as the DAV base URL, as the guide tells a Nextcloud user to: the
 *   CalDAV source lists the user's calendars and the CardDAV source their
 *   address books, each with Nextcloud's default one among them;
 * - the WebDAV source, typed as the folder of the user's own files, lists it;
 * - a wrong password is refused, and said as the server's refusal.
 *
 * No Nextcloud source card is tested, because there is none (the owner,
 * 2026-11-24): a Nextcloud is left through these three.
 */

import { describe, it, expect } from 'vitest';
import { probeSourceConnection } from './probe-connection.ts';

const NEXTCLOUD_WEBDAV_URL = process.env.NEXTCLOUD_WEBDAV_URL;
const NEXTCLOUD_USERNAME = process.env.NEXTCLOUD_USERNAME || 'testadmin';
const NEXTCLOUD_PASSWORD = process.env.NEXTCLOUD_PASSWORD || 'testadmin_password';

function base(): string {
  if (!NEXTCLOUD_WEBDAV_URL) throw new Error('NEXTCLOUD_WEBDAV_URL not configured: the global setup starts Nextcloud');
  return NEXTCLOUD_WEBDAV_URL.replace(/\/$/, '');
}

const login = { username: NEXTCLOUD_USERNAME, password: NEXTCLOUD_PASSWORD };

describe('a DAV source, as the create door stores it, against Nextcloud', () => {
  it('caldav, typed as the DAV base URL: connected, with the default calendar counted', async () => {
    const result = await probeSourceConnection('caldav', { host: '', url: `${base()}/` }, login);

    expect(result).toMatchObject({ ok: true, outcome: { code: 'connected', unit: 'calendar' } });
    if (result.ok && result.outcome.code === 'connected') expect(result.outcome.count).toBeGreaterThan(0);
  });

  it('carddav, typed as the DAV base URL: connected, with the default address book counted', async () => {
    const result = await probeSourceConnection('carddav', { host: '', url: `${base()}/` }, login);

    expect(result).toMatchObject({ ok: true, outcome: { code: 'connected', unit: 'addressBook' } });
    if (result.ok && result.outcome.code === 'connected') expect(result.outcome.count).toBeGreaterThan(0);
  });

  it("webdav, typed as the user's own files: connected", async () => {
    const result = await probeSourceConnection(
      'webdav',
      { host: '', url: `${base()}/files/${encodeURIComponent(NEXTCLOUD_USERNAME)}/` },
      login,
    );

    expect(result).toMatchObject({ ok: true, outcome: { code: 'connected', unit: 'folder' } });
  });

  it('a wrong password is refused, not answered as an empty account', async () => {
    const result = await probeSourceConnection(
      'caldav',
      { host: '', url: `${base()}/` },
      { username: NEXTCLOUD_USERNAME, password: 'not-the-password' },
    );

    expect(result.ok).toBe(false);
  });
});
