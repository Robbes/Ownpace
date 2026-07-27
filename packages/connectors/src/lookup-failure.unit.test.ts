// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
//
// A failed idempotency lookup must never be reported as "not present".
//
// Both mail target writers check `findByNaturalKey` before appending. When that
// lookup swallowed its error and returned `undefined`, `upsertEmail` read it as
// "this message isn't on the target yet" and APPENDed — silently duplicating a
// message that was already there. That breaks the one property the product
// rests on (AGENTS.md hard rule 1: "Idempotency is sacred. Re-runs converge: no
// duplicates"), and it is exactly the shape hard rule 9 forbids: a failure
// turned into an empty result.
//
// These tests pin the corrected behaviour: a lookup that could not complete
// throws, and — critically — no write reaches the target.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JmapTargetWriter } from './jmap-target';
import { ImapDavMailTarget } from './imap-dav-target';

describe('JmapTargetWriter.findByNaturalKey — lookup failure', () => {
  let writer: JmapTargetWriter;

  beforeEach(() => {
    writer = new JmapTargetWriter({
      baseUrl: 'https://jmap.test',
      username: 'user@test',
      password: 'pw',
    });
    // Pretend the session is already established so the test exercises the
    // query path rather than connect().
    Object.assign(writer, {
      accountId: 'acct-1',
      apiUrl: 'https://jmap.test/jmap',
      authHeader: 'Basic xxx',
      client: {},
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws instead of returning undefined when Email/query fails', async () => {
    vi.spyOn(
      writer as unknown as { apiRequest: () => Promise<unknown> },
      'apiRequest',
    ).mockRejectedValue(new Error('503 Service Unavailable'));

    await expect(writer.findByNaturalKey('mbox-1', '<msg-1@test>')).rejects.toThrow(
      /refusing to treat this as "not present"/,
    );
  });

  it('preserves the underlying cause so the real failure stays visible', async () => {
    const cause = new Error('503 Service Unavailable');
    vi.spyOn(
      writer as unknown as { apiRequest: () => Promise<unknown> },
      'apiRequest',
    ).mockRejectedValue(cause);

    await expect(writer.findByNaturalKey('mbox-1', '<msg-1@test>')).rejects.toThrow(
      /503 Service Unavailable/,
    );
  });

  it('still returns undefined for a successful query that genuinely matches nothing', async () => {
    vi.spyOn(
      writer as unknown as { apiRequest: () => Promise<unknown> },
      'apiRequest',
    ).mockResolvedValue({ ids: [] });

    await expect(writer.findByNaturalKey('mbox-1', '<msg-1@test>')).resolves.toBeUndefined();
  });

  it('returns the id for a successful query that matches', async () => {
    vi.spyOn(
      writer as unknown as { apiRequest: () => Promise<unknown> },
      'apiRequest',
    ).mockResolvedValue({ ids: ['email-42'] });

    await expect(writer.findByNaturalKey('mbox-1', '<msg-1@test>')).resolves.toBe('email-42');
  });

  it('does NOT append when the pre-write lookup fails (the actual duplicate bug)', async () => {
    // Everything downstream of the lookup is made to SUCCEED, so that if the
    // lookup's failure were swallowed the append would genuinely go through and
    // this test would see it. (Without this, the old code failed later on an
    // unmocked network call and the test passed for the wrong reason.)
    const blobUpload = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ blobId: 'blob-1' }),
      text: async () => '',
    });
    global.fetch = blobUpload as unknown as typeof fetch;

    const apiRequest = vi
      .spyOn(writer as unknown as { apiRequest: (m: string) => Promise<unknown> }, 'apiRequest')
      .mockImplementation(async (method: string) => {
        if (method === 'Email/query') throw new Error('connection reset');
        // A reachable Email/import means a duplicate was just created.
        if (method === 'Email/import') {
          return { created: { imp: { id: 'email-new', blobId: 'blob-1' } } };
        }
        return {};
      });

    await expect(
      writer.upsertEmail('mbox-1', {
        rfc822: Buffer.from('Message-ID: <msg-1@test>\r\n\r\nbody'),
      } as never, []),
    ).rejects.toThrow(/refusing to treat this as "not present"/);

    // The load-bearing assertions: the lookup was the ONLY JMAP method called,
    // and no blob was uploaded. Nothing reached the target.
    expect(apiRequest.mock.calls.map((c) => c[0])).toEqual(['Email/query']);
    expect(blobUpload).not.toHaveBeenCalled();
  });
});

describe('ImapDavMailTarget.findByNaturalKey — lookup failure', () => {
  let target: ImapDavMailTarget;

  beforeEach(() => {
    target = new ImapDavMailTarget({
      host: 'imap.test',
      port: 993,
      tls: true,
      username: 'user@test',
      password: 'pw',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws instead of returning undefined when the mailbox cannot be opened', async () => {
    Object.assign(target, {
      conn: {
        openBox: vi.fn().mockRejectedValue(new Error('SELECT failed: mailbox is locked')),
        search: vi.fn(),
        imap: {},
      },
      connectPromise: Promise.resolve(),
    });

    await expect(target.findByNaturalKey('INBOX', '<msg-1@test>')).rejects.toThrow(
      /refusing to treat this as "not present"/,
    );
  });

  it('throws instead of returning undefined when the search itself fails', async () => {
    Object.assign(target, {
      conn: {
        openBox: vi.fn().mockResolvedValue(undefined),
        search: vi.fn().mockRejectedValue(new Error('connection reset by peer')),
        imap: {},
      },
      connectPromise: Promise.resolve(),
    });

    await expect(target.findByNaturalKey('INBOX', '<msg-1@test>')).rejects.toThrow(
      /connection reset by peer/,
    );
  });

  it('still returns undefined when the mailbox is genuinely empty', async () => {
    Object.assign(target, {
      conn: {
        openBox: vi.fn().mockResolvedValue(undefined),
        search: vi.fn().mockResolvedValue([]),
        imap: {},
      },
      connectPromise: Promise.resolve(),
    });

    await expect(target.findByNaturalKey('INBOX', '<msg-1@test>')).resolves.toBeUndefined();
  });
});
