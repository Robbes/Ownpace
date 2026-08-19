// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Removing a copy this tool wrote, over DAV — the shared sequence all three DAV
 * target writers use.
 *
 * Two things have to be exactly right, and both are hard to get right THREE times
 * independently, which is why this lives in one place: whether a DELETE is
 * recoverable is a property of the SERVER (Nextcloud files vs. everything else),
 * and ownership has to be re-checked at the moment of removal, not before it.
 */

import { describe, it, expect, vi } from 'vitest';
import { removeDavResource, davDeleteIsRecoverable } from './dav-remove.ts';

describe('davDeleteIsRecoverable', () => {
  it('is true only for a Nextcloud files endpoint', () => {
    expect(davDeleteIsRecoverable('https://cloud.example.com/remote.php/dav/files/alice/report.pdf')).toBe(true);
  });

  it('is false for calendars, contacts and anything else', () => {
    // Recent Nextcloud versions DO keep a deleted calendar object for a while,
    // but which versions do is not something this code can tell from a URL —
    // and understating recoverability is the safe direction to be wrong in.
    expect(davDeleteIsRecoverable('https://cloud.example.com/remote.php/dav/calendars/alice/personal/evt.ics')).toBe(false);
    expect(davDeleteIsRecoverable('https://cloud.example.com/remote.php/dav/addressbooks/alice/default/card.vcf')).toBe(false);
    expect(davDeleteIsRecoverable('https://dav.example.com/webdav/report.pdf')).toBe(false);
  });

  it('is false rather than throwing for a malformed URL', () => {
    expect(davDeleteIsRecoverable('not a url')).toBe(false);
  });
});

/** The exact shape `removeDavResource` expects back from its `request` function. */
type FakeDavResponse = { status: number; headers: Record<string, string>; body: string };

describe('removeDavResource', () => {
  function client(handler: (opts: { method: string; url: string }) => FakeDavResponse) {
    return vi.fn(async (opts: { method: string; url: string }) => handler(opts));
  }

  it('DELETEs the resource and reports the kind the URL implies', async () => {
    const request = client((opts) => {
      expect(opts.method).toBe('DELETE');
      return { status: 204, headers: {}, body: '' };
    });

    const result = await removeDavResource({
      url: 'https://cloud.example.com/remote.php/dav/files/alice/report.pdf',
      authorization: 'Basic xyz',
      request,
    });

    expect(result).toEqual({ kind: 'binned' });
  });

  it('reports deleted for a non-Nextcloud-files URL', async () => {
    const request = client(() => ({ status: 204, headers: {}, body: '' }));

    const result = await removeDavResource({
      url: 'https://dav.example.com/webdav/report.pdf',
      authorization: 'Basic xyz',
      request,
    });

    expect(result).toEqual({ kind: 'deleted' });
  });

  it('honours a forced kind, overriding what the URL would imply', async () => {
    // The calendar/contact writers always force 'deleted', even on a
    // Nextcloud-files-shaped URL (which never actually happens for them, but the
    // override must win regardless).
    const request = client(() => ({ status: 204, headers: {}, body: '' }));

    const result = await removeDavResource({
      url: 'https://cloud.example.com/remote.php/dav/files/alice/report.pdf',
      authorization: 'Basic xyz',
      request,
      kind: 'deleted',
    });

    expect(result).toEqual({ kind: 'deleted' });
  });

  it('treats 404 and 410 as an already-accomplished removal, not an error', async () => {
    // The end state the owner asked for already exists. Failing here would
    // leave a queue entry nobody could ever close.
    for (const status of [404, 410]) {
      const request = client(() => ({ status, headers: {}, body: '' }));
      const result = await removeDavResource({
        url: 'https://dav.example.com/webdav/gone.pdf',
        authorization: 'Basic xyz',
        request,
      });
      expect(result).toEqual({ kind: 'deleted' });
    }
  });

  it('throws on a genuine failure status, with the body for diagnosis', async () => {
    const request = client(() => ({ status: 500, headers: {}, body: 'internal error' }));

    await expect(
      removeDavResource({
        url: 'https://dav.example.com/webdav/report.pdf',
        authorization: 'Basic xyz',
        request,
      }),
    ).rejects.toThrow(/500/);
  });

  it('does NOT check ownership when no expectedTargetVersion was given', async () => {
    let headCalled = false;
    const request = client((opts) => {
      if (opts.method === 'HEAD') headCalled = true;
      return { status: 204, headers: {}, body: '' };
    });

    await removeDavResource({
      url: 'https://dav.example.com/webdav/report.pdf',
      authorization: 'Basic xyz',
      request,
    });

    expect(headCalled).toBe(false);
  });

  describe('ownership re-check', () => {
    it('HEADs first and refuses the DELETE when the ETag has changed', async () => {
      let deleteCalled = false;
      const request = client((opts): FakeDavResponse => {
        if (opts.method === 'HEAD') return { status: 200, headers: { etag: '"changed"' }, body: '' };
        deleteCalled = true;
        return { status: 204, headers: {}, body: '' };
      });

      const result = await removeDavResource({
        url: 'https://dav.example.com/webdav/report.pdf',
        authorization: 'Basic xyz',
        request,
        expectedTargetVersion: 'original',
      });

      expect(result).toEqual({ conflicted: true });
      // The DELETE must never even be sent once ownership looks wrong.
      expect(deleteCalled).toBe(false);
    });

    it('proceeds when the ETag still matches', async () => {
      const request = client(
        (opts): FakeDavResponse =>
          opts.method === 'HEAD'
            ? { status: 200, headers: { etag: '"same"' }, body: '' }
            : { status: 204, headers: {}, body: '' },
      );

      const result = await removeDavResource({
        url: 'https://dav.example.com/webdav/report.pdf',
        authorization: 'Basic xyz',
        request,
        expectedTargetVersion: 'same',
      });

      expect(result).toEqual({ kind: 'deleted' });
    });

    it('proceeds when the HEAD fails — an unknown ETag is not a known mismatch', async () => {
      // The alternative — refusing whenever HEAD fails — would block every
      // removal against a server that answers no ETag at all, which is a
      // protection that presents as an outage.
      const request = client(
        (opts): FakeDavResponse =>
          opts.method === 'HEAD'
            ? { status: 404, headers: {}, body: '' }
            : { status: 204, headers: {}, body: '' },
      );

      const result = await removeDavResource({
        url: 'https://dav.example.com/webdav/report.pdf',
        authorization: 'Basic xyz',
        request,
        expectedTargetVersion: 'original',
      });

      expect(result).toEqual({ kind: 'deleted' });
    });
  });
});
