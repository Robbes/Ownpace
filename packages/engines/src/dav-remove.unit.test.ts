// Copyright 2026 The Ownpace authors (Apache-2.0)

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
      expectedTargetVersion: 'v1',
    });

    expect(result).toEqual({ kind: 'binned' });
  });

  it('reports deleted for a non-Nextcloud-files URL', async () => {
    const request = client(() => ({ status: 204, headers: {}, body: '' }));

    const result = await removeDavResource({
      url: 'https://dav.example.com/webdav/report.pdf',
      authorization: 'Basic xyz',
      request,
      expectedTargetVersion: 'v1',
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
      expectedTargetVersion: 'v1',
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
        expectedTargetVersion: 'v1',
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
        expectedTargetVersion: 'v1',
      }),
    ).rejects.toThrow(/500/);
  });

  it('removes NOTHING when no version was recorded, and says so (workplan 0149 T3)', async () => {
    // It skipped the check and removed the copy anyway. With nothing to compare
    // there is no way to tell whether somebody changed it since, and a removal
    // cannot be undone (the owner's D1).
    const request = client(() => ({ status: 204, headers: {}, body: '' }));

    const result = await removeDavResource({
      url: 'https://dav.example.com/webdav/report.pdf',
      authorization: 'Basic xyz',
      request,
    });

    expect(result).toEqual({ unversioned: true });
    expect(request, 'not a DELETE, and not a HEAD either').not.toHaveBeenCalled();
  });

  describe('ownership, checked by the server (workplan 0149 T3)', () => {
    it('refuses when the server says the copy changed, and removes nothing', async () => {
      // The DELETE carries If-Match, so a changed copy is refused in the same
      // request: 412. It used to be a HEAD and a comparison first, with a gap
      // between them and the DELETE.
      const request = client((opts): FakeDavResponse => {
        if (opts.method === 'HEAD') return { status: 200, headers: { etag: '"changed"' }, body: '' };
        return { status: 412, headers: {}, body: '' };
      });

      const result = await removeDavResource({
        url: 'https://dav.example.com/webdav/report.pdf',
        authorization: 'Basic xyz',
        request,
        expectedTargetVersion: 'original',
      });

      expect(result).toEqual({ conflicted: true });
      expect(request.mock.calls.map(([o]) => o.method)).toEqual(['DELETE', 'HEAD']);
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

    it('asks nothing before the DELETE: the server does the checking', async () => {
      // A HEAD first was the gap between reading and acting that If-Match
      // closes, and when it failed the removal went ahead. Now there is no HEAD
      // unless the DELETE itself is refused.
      const request = client(() => ({ status: 204, headers: {}, body: '' }));

      await removeDavResource({
        url: 'https://dav.example.com/webdav/report.pdf',
        authorization: 'Basic xyz',
        request,
        expectedTargetVersion: 'original',
      });

      expect(request.mock.calls.map(([o]) => o.method)).toEqual(['DELETE']);
    });
  });
});

/**
 * A DELETE THAT CANCELS NOTHING (0103 T5 / ADR-0043). This removal is a
 * migration's bookkeeping, never a person declining a meeting — RFC 6638's
 * Schedule-Reply: F is how a client says so, and a server without scheduling
 * ignores an unknown header. Belt to the writer's SCHEDULE-AGENT=CLIENT.
 */
describe('the removal tells the server to tell nobody', () => {
  it('sends Schedule-Reply: F on the DELETE', async () => {
    const seen: Array<{ method: string; headers?: Record<string, string> }> = [];
    await removeDavResource({
      url: 'https://dav.example.com/calendars/a/personal/e1.ics',
      authorization: 'Basic abc',
      request: async (o) => {
        seen.push({ method: o.method, headers: o.headers });
        return { status: 204, headers: {}, body: '' };
      },
      expectedTargetVersion: 'v1',
    });
    const del = seen.find((c) => c.method === 'DELETE');
    expect(del, 'no DELETE was issued').toBeTruthy();
    expect(
      del!.headers?.['Schedule-Reply'],
      'the DELETE carries no Schedule-Reply: F, so on a scheduling target it\n' +
        'is a person declining or an organiser cancelling — and the server\n' +
        'MAILS the other side of years-old meetings on our bookkeeping.',
    ).toBe('F');
  });
});
