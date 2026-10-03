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

import { grantApi, isPersonSubject } from './grant-service.ts';

/** A migration's page, as these cases expect: a person's would fail them loudly. */
async function readMigration(link: string) {
  const subject = await grantApi.read(link);
  if (isPersonSubject(subject)) throw new Error("expected a migration's page, got a person's");
  return subject;
}

describe('the grant subject, as the page receives it', () => {
  it('keeps the account it reads and the destination it writes', async () => {
    getMock.mockResolvedValue({
      data: {
        organisation: 'Acme Legal',
        checkedCompany: 'ACME LEGAL B.V.',
        askedBy: 'owner@example.org',
        organisationPhone: '+31 20 123 4567',
        domains: ['contact'],
        scope: 'https://www.googleapis.com/auth/contacts.readonly',
        readOnlyAtProvider: true,
        from: 'someone@example.invalid',
        to: { provider: 'nextcloud', host: 'cloud.example.org', account: 'dest@example.org' },
        expiresAt: '2026-09-30T00:00:00.000Z',
      },
    });
    const subject = await readMigration('abc.def');
    expect(subject.checkedCompany).toBe('ACME LEGAL B.V.');
    // Whether Google holds the grant to reading (0144 T3 (c)): the page picks
    // its box by it, so a schema that dropped it would say one thing to all.
    expect(subject.readOnlyAtProvider).toBe(true);
    expect(subject.askedBy).toBe('owner@example.org');
    expect(subject.organisationPhone).toBe('+31 20 123 4567');
    expect(subject.from).toBe('someone@example.invalid');
    expect(subject.to).toEqual({
      provider: 'nextcloud',
      host: 'cloud.example.org',
      account: 'dest@example.org',
    });
    // Which data types, which the page words in its own language (0145 T6).
    expect(subject.domains).toEqual(['contact']);
  });

  it('keeps what the server cannot say as null, not as a missing field', async () => {
    getMock.mockResolvedValue({
      data: {
        organisation: 'Acme Legal',
        checkedCompany: null,
        askedBy: null,
        organisationPhone: null,
        domains: ['contact'],
        scope: 'https://www.googleapis.com/auth/contacts.readonly',
        readOnlyAtProvider: true,
        from: 'someone@example.invalid',
        to: { provider: 'jmap', host: null, account: null },
        expiresAt: '2026-09-30T00:00:00.000Z',
      },
    });
    const subject = await readMigration('abc.def');
    expect(subject.checkedCompany).toBeNull();
    expect(subject.askedBy).toBeNull();
    expect(subject.organisationPhone).toBeNull();
    expect(subject.to.host).toBeNull();
  });

  it('refuses a subject that does not say whether Google holds it to reading (0144 T3 (c))', async () => {
    // Absent is not "no": a page that defaulted either way would be deciding
    // what Google enforces on the server's behalf.
    getMock.mockResolvedValue({
      data: {
        organisation: 'Acme Legal',
        checkedCompany: null,
        askedBy: null,
        organisationPhone: null,
        domains: ['contact'],
        scope: 'https://www.googleapis.com/auth/contacts.readonly',
        from: 'someone@example.invalid',
        to: { provider: 'jmap', host: null, account: null },
        expiresAt: '2026-09-30T00:00:00.000Z',
      },
    });
    await expect(grantApi.read('abc.def')).rejects.toThrow();
  });

  it('refuses a subject that names no account to sign in with (0108 T8 (b))', async () => {
    // The server answers no page for such a migration. A subject without one
    // is not a page this screen can draw truthfully: "sign in as nobody".
    getMock.mockResolvedValue({
      data: {
        organisation: 'Acme Legal',
        checkedCompany: null,
        askedBy: null,
        organisationPhone: null,
        domains: ['contact'],
        scope: 'https://www.googleapis.com/auth/contacts.readonly',
        readOnlyAtProvider: true,
        from: null,
        to: { provider: 'jmap', host: null, account: null },
        expiresAt: '2026-09-30T00:00:00.000Z',
      },
    });
    await expect(grantApi.read('abc.def')).rejects.toThrow();
  });

  it('refuses a data type it has no words for, or none at all, rather than naming less (0145 T6)', async () => {
    // A consent page that dropped a data type would say less than will be
    // read; one with none would say "access to ." Both are refused.
    for (const domains of [['contact', 'photos'], []]) {
      getMock.mockResolvedValue({
        data: {
          organisation: 'Acme Legal',
          checkedCompany: null,
          askedBy: null,
          organisationPhone: null,
          domains,
          scope: 'https://www.googleapis.com/auth/contacts.readonly',
          readOnlyAtProvider: true,
          from: 'someone@example.invalid',
          to: { provider: 'jmap', host: null, account: null },
          expiresAt: '2026-09-30T00:00:00.000Z',
        },
      });
      await expect(grantApi.read('abc.def'), JSON.stringify(domains)).rejects.toThrow();
    }
  });
});

describe("a person's page, as the page receives it (0153 T5 (b))", () => {
  const PERSON = {
    kind: 'person',
    organisation: 'Acme Legal',
    checkedCompany: null,
    askedBy: 'owner@example.org',
    organisationPhone: null,
    accounts: [
      {
        account: 'anna@gmail.com',
        granted: false,
        domains: ['calendar', 'contact'],
        scope: 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/carddav openid',
        readOnlyAtProvider: false,
        notReady: null,
        migrations: [
          { domains: ['calendar'], to: { provider: 'nextcloud', host: 'cloud.example.org', account: 'anna' }, granted: false },
        ],
      },
    ],
    expiresAt: '2026-10-06T00:00:00.000Z',
  };

  it('keeps each account, what it copies and where, and says it is a person’s', async () => {
    getMock.mockResolvedValue({ data: PERSON });
    const subject = await grantApi.read('p.abc.def');
    expect(isPersonSubject(subject)).toBe(true);
    if (!isPersonSubject(subject)) return;
    expect(subject.accounts[0]?.account).toBe('anna@gmail.com');
    expect(subject.accounts[0]?.migrations[0]?.to.host).toBe('cloud.example.org');
  });

  it('refuses a data type it has no words for, rather than naming less than will be read', async () => {
    getMock.mockResolvedValue({
      data: { ...PERSON, accounts: [{ ...PERSON.accounts[0], domains: ['photos'] }] },
    });
    await expect(grantApi.read('p.abc.def')).rejects.toThrow();
  });
});
