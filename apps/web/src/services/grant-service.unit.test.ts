// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Where from and where to survive the parse (workplan 0108 T8a).
 *
 * `z.object` strips what it does not name, and the grant page's tests mock
 * this service. So a schema that forgot `from` or `to` would pass every page
 * test while the page itself said "the Google account you sign in with" and
 * named no destination. `a-policy-the-client-threw-away.unit.test.ts` is the
 * same defect, met once already.
 */
import { describe, it, expect, vi } from 'vitest';

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));
vi.mock('./link-client.ts', () => ({ linkClient: { get: getMock, post: vi.fn() } }));

import { grantApi } from './grant-service.ts';

describe('the grant subject, as the page receives it', () => {
  it('keeps the account it reads and the destination it writes', async () => {
    getMock.mockResolvedValue({
      data: {
        organisation: 'Acme Legal',
        askedBy: 'owner@example.org',
        organisationPhone: '+31 20 123 4567',
        reads: 'your contacts',
        scope: 'https://www.googleapis.com/auth/contacts.readonly',
        from: 'someone@example.invalid',
        to: { provider: 'nextcloud', host: 'cloud.example.org', account: 'dest@example.org' },
        expiresAt: '2026-09-30T00:00:00.000Z',
      },
    });
    const subject = await grantApi.read('abc.def');
    expect(subject.askedBy).toBe('owner@example.org');
    expect(subject.organisationPhone).toBe('+31 20 123 4567');
    expect(subject.from).toBe('someone@example.invalid');
    expect(subject.to).toEqual({
      provider: 'nextcloud',
      host: 'cloud.example.org',
      account: 'dest@example.org',
    });
  });

  it('keeps an account the migration does not name as null, not as a missing field', async () => {
    getMock.mockResolvedValue({
      data: {
        organisation: 'Acme Legal',
        askedBy: null,
        organisationPhone: null,
        reads: 'your contacts',
        scope: 'https://www.googleapis.com/auth/contacts.readonly',
        from: null,
        to: { provider: 'jmap', host: null, account: null },
        expiresAt: '2026-09-30T00:00:00.000Z',
      },
    });
    const subject = await grantApi.read('abc.def');
    expect(subject.from).toBeNull();
    expect(subject.askedBy).toBeNull();
    expect(subject.organisationPhone).toBeNull();
    expect(subject.to.host).toBeNull();
  });
});
