// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * RFC 6764 well-known URIs are properties of the ORIGIN, not of the DAV path.
 *
 * §4 places `/.well-known/caldav` and `/.well-known/carddav` at the root of the
 * origin. Both DAV sources built them by appending to the configured base URL
 * instead, which for the standard Nextcloud base produced
 * `https://host/remote.php/dav/.well-known/caldav` — a path that cannot exist.
 * Every calendar and contact discovery therefore paid a guaranteed 404 plus the
 * fallback PROPFIND before doing any work, on every pass. Confirmed live:
 *
 *     "GET /remote.php/dav/.well-known/caldav HTTP/1.1" 404
 *     "GET /remote.php/dav/.well-known/carddav HTTP/1.1" 404
 *
 * These pin the origin-rooting so the wasted round trip cannot come back.
 */

import { describe, it, expect } from 'vitest';
import { wellKnownUrl } from './dav-http.types';

describe('wellKnownUrl (RFC 6764 §4)', () => {
  it('roots the URI at the origin, discarding the configured DAV path', () => {
    // The exact base the e2e stack and every Nextcloud deployment uses.
    expect(wellKnownUrl('https://cloud.example.com/remote.php/dav', 'caldav')).toBe(
      'https://cloud.example.com/.well-known/caldav',
    );
    expect(wellKnownUrl('https://cloud.example.com/remote.php/dav', 'carddav')).toBe(
      'https://cloud.example.com/.well-known/carddav',
    );
  });

  it('is unaffected by a trailing slash on the base', () => {
    expect(wellKnownUrl('https://cloud.example.com/remote.php/dav/', 'caldav')).toBe(
      'https://cloud.example.com/.well-known/caldav',
    );
  });

  it('keeps a non-default port, which is part of the origin', () => {
    // The e2e stack reaches Nextcloud on a randomly-picked host port. Dropping
    // it would send discovery to a different server entirely.
    expect(wellKnownUrl('http://127.0.0.1:40361/remote.php/dav', 'carddav')).toBe(
      'http://127.0.0.1:40361/.well-known/carddav',
    );
  });

  it('already-rooted and bare-origin bases are left at the origin too', () => {
    expect(wellKnownUrl('https://cloud.example.com', 'caldav')).toBe(
      'https://cloud.example.com/.well-known/caldav',
    );
    expect(wellKnownUrl('https://cloud.example.com/', 'carddav')).toBe(
      'https://cloud.example.com/.well-known/carddav',
    );
  });

  it('does not carry a query string or fragment from the base', () => {
    expect(wellKnownUrl('https://cloud.example.com/remote.php/dav?x=1#frag', 'caldav')).toBe(
      'https://cloud.example.com/.well-known/caldav',
    );
  });
});
