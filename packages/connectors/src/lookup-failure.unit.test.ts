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

    // The load-bearing assertions: NOTHING that writes was called. No import,
    // no blob upload — the message did not reach the target.
    //
    // Stated as "only reads happened" rather than as a literal call list. The
    // writer now tries to enumerate the account once before falling back to
    // the per-message lookup, so a failing server sees two Email/query calls
    // instead of one. That is a change in how many times we ask, not in what
    // we do with the answer, and pinning the exact list made the test fail for
    // a behaviour that is still correct.
    const methods = apiRequest.mock.calls.map((c) => c[0]);
    expect(methods).toContain('Email/query');
    expect(methods.filter((m) => m !== 'Email/query')).toEqual([]);
    expect(blobUpload).not.toHaveBeenCalled();
  });
});

// The IMAP half of this file used to live here, against `ImapDavMailTarget`.
// That writer was removed by workplan 0032 T3b and its replacement carries the
// same three cases plus two more, in `imapflow-dav-target.unit.test.ts` under
// `findByNaturalKey`: the lock failure, the FETCH failure, a genuinely empty
// mailbox, and — added after a mutation SURVIVED — the end-to-end consequence
// that a swallowed lookup must not become a duplicate append. Nothing was lost
// in the move; this note exists so nobody has to prove that again.
