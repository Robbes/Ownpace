// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Free space at the destination (workplan 0171 T9): each reader over a
 * recorded answer, unknown for each `why`, and two data types in one pool
 * added once.
 */
import { describe, it, expect } from 'vitest';
import {
  capacityFromDavQuota,
  capacityFromImapQuota,
  capacityFromJmapQuotas,
  capacityFromCirruxStorage,
  imapAnnouncesQuota,
  spaceByPool,
  spaceVerdict,
  spaceHoldsStart,
  type DataTypeSpace,
} from './destination-capacity.ts';
import type { DestinationCapacity } from './ports.ts';

/** A Nextcloud 30 answer to `PROPFIND Depth: 0` on the user's files root, as recorded. */
const nextcloud = (available: string, used = '1048576') => `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:s="http://sabredav.org/ns" xmlns:oc="http://owncloud.org/ns" xmlns:nc="http://nextcloud.org/ns">
 <d:response>
  <d:href>/remote.php/dav/files/ana/</d:href>
  <d:propstat>
   <d:prop>
    <d:quota-available-bytes>${available}</d:quota-available-bytes>
    <d:quota-used-bytes>${used}</d:quota-used-bytes>
   </d:prop>
   <d:status>HTTP/1.1 200 OK</d:status>
  </d:propstat>
 </d:response>
</d:multistatus>`;

/** A server without RFC 4331: both properties under a 404 propstat, empty. */
const noQuotaDav = `<?xml version="1.0"?>
<D:multistatus xmlns:D="DAV:">
 <D:response>
  <D:href>/dav/</D:href>
  <D:propstat>
   <D:prop><D:quota-available-bytes/><D:quota-used-bytes/></D:prop>
   <D:status>HTTP/1.1 404 Not Found</D:status>
  </D:propstat>
 </D:response>
</D:multistatus>`;

const POOL = 'https://cloud.example.org/remote.php/dav/files/ana/';

describe('WebDAV: quota-available-bytes (RFC 4331)', () => {
  it('reads free and total from a Nextcloud user with a quota', () => {
    expect(capacityFromDavQuota(nextcloud('5367660544'), POOL)).toEqual({
      known: true,
      freeBytes: 5367660544,
      totalBytes: 5367660544 + 1048576,
      pool: POOL,
    });
  });

  it('reads a namespace prefix other than d:, and none at all', () => {
    const upper = nextcloud('1000').replaceAll('d:', 'D:');
    expect(capacityFromDavQuota(upper, POOL)).toMatchObject({ known: true, freeBytes: 1000 });
    const bare = '<multistatus xmlns="DAV:"><response><propstat><prop><quota-available-bytes>42</quota-available-bytes></prop></propstat></response></multistatus>';
    expect(capacityFromDavQuota(bare, POOL)).toEqual({ known: true, freeBytes: 42, pool: POOL });
  });

  it('reads a float Nextcloud sends for a large number', () => {
    expect(capacityFromDavQuota(nextcloud('1.0737418240E+11', '0'), POOL)).toMatchObject({
      known: true,
      freeBytes: 107374182400,
    });
  });

  it('is unlimited on Nextcloud’s −3', () => {
    expect(capacityFromDavQuota(nextcloud('-3'), POOL)).toEqual({ known: false, why: 'unlimited' });
  });

  it.each(['-1', '-2'])('is not answered on Nextcloud’s %s (not computed)', (v) => {
    expect(capacityFromDavQuota(nextcloud(v), POOL)).toEqual({ known: false, why: 'not_answered' });
  });

  it('is not offered when the properties are absent or empty', () => {
    expect(capacityFromDavQuota(noQuotaDav, POOL)).toEqual({ known: false, why: 'not_offered' });
    expect(capacityFromDavQuota('', POOL)).toEqual({ known: false, why: 'not_offered' });
  });

  it('never says less than nothing is free', () => {
    expect(capacityFromDavQuota(nextcloud('0', '10'), POOL)).toMatchObject({ known: true, freeBytes: 0, totalBytes: 10 });
  });
});

describe('IMAP: GETQUOTAROOT INBOX (RFC 9208)', () => {
  it('knows QUOTA and QUOTA=RES-STORAGE, and nothing else', () => {
    expect(imapAnnouncesQuota(['IMAP4rev1', 'QUOTA'])).toBe(true);
    expect(imapAnnouncesQuota(['IMAP4rev2', 'quota=res-storage'])).toBe(true);
    expect(imapAnnouncesQuota(['IMAP4rev1', 'IDLE', 'QUOTAX'])).toBe(false);
  });

  // Stalwart's `* QUOTAROOT INBOX ""` / `* QUOTA "" (STORAGE 2048 102400)`, as
  // imapflow hands it back: storage already multiplied out of KiB.
  const stalwart = { path: 'INBOX', quotaRoot: '', storage: { usage: 2048 * 1024, limit: 102400 * 1024, status: '2%' } };

  it('reads free and total from STORAGE, the pool named by account and root', () => {
    expect(capacityFromImapQuota(true, stalwart, 'imap://ana@mail.example.org:993')).toEqual({
      known: true,
      freeBytes: (102400 - 2048) * 1024,
      totalBytes: 102400 * 1024,
      pool: 'imap://ana@mail.example.org:993#quota-root:',
    });
  });

  it('is not offered without the capability, whatever came back', () => {
    expect(capacityFromImapQuota(false, stalwart, 'a')).toEqual({ known: false, why: 'not_offered' });
  });

  it('is not answered when a server that announces QUOTA failed the command', () => {
    expect(capacityFromImapQuota(true, false, 'a')).toEqual({ known: false, why: 'not_answered' });
  });

  it('is not offered with only a MESSAGE resource', () => {
    expect(capacityFromImapQuota(true, { quotaRoot: 'user', storage: undefined }, 'a')).toEqual({
      known: false,
      why: 'not_offered',
    });
  });
});

describe('JMAP: Quota/get (RFC 9425)', () => {
  // Stalwart's `Quota/get` for an account with a 100 MiB quota, as recorded.
  const stalwart = [
    { id: 'b', resourceType: 'octets', scope: 'account', used: 1_310_720, hardLimit: 104_857_600, name: 'ana', types: ['Mail'] },
    { id: 'a', resourceType: 'count', scope: 'account', used: 12, hardLimit: 0, name: 'ana' },
  ];

  it('reads the octets quota and leaves the count one out', () => {
    expect(capacityFromJmapQuotas(true, stalwart, 'jmap:acc')).toEqual({
      known: true,
      freeBytes: 104_857_600 - 1_310_720,
      totalBytes: 104_857_600,
      pool: 'jmap:acc',
    });
  });

  it('takes the tightest of an account and a domain quota', () => {
    const list = [...stalwart, { resourceType: 'octets', scope: 'domain', used: 900, hardLimit: 1000 }];
    expect(capacityFromJmapQuotas(true, list, 'p')).toMatchObject({ freeBytes: 100, totalBytes: 1000 });
  });

  it('is unlimited when no octets quota is set, or its limit is 0', () => {
    expect(capacityFromJmapQuotas(true, [], 'p')).toEqual({ known: false, why: 'unlimited' });
    expect(capacityFromJmapQuotas(true, [{ resourceType: 'octets', used: 5, hardLimit: 0 }], 'p')).toEqual({
      known: false,
      why: 'unlimited',
    });
  });

  it('is not offered when the session does not list the capability', () => {
    expect(capacityFromJmapQuotas(false, undefined, 'p')).toEqual({ known: false, why: 'not_offered' });
  });

  it('is not answered when the list did not come', () => {
    expect(capacityFromJmapQuotas(true, undefined, 'p')).toEqual({ known: false, why: 'not_answered' });
  });
});

describe('Cirrux Drive: GET /workspace/storage', () => {
  it('reads the pool', () => {
    expect(capacityFromCirruxStorage({ used_bytes: 3_000, pool_bytes: 10_000 }, 'cirrux:w1')).toEqual({
      known: true,
      freeBytes: 7_000,
      totalBytes: 10_000,
      pool: 'cirrux:w1',
    });
  });

  it('is not answered when a part is missing', () => {
    expect(capacityFromCirruxStorage({ pool_bytes: 10 }, 'p')).toEqual({ known: false, why: 'not_answered' });
    expect(capacityFromCirruxStorage(undefined, 'p')).toEqual({ known: false, why: 'not_answered' });
  });
});

describe('the sum, per pool', () => {
  const account: DestinationCapacity = { known: true, freeBytes: 1_000, totalBytes: 5_000, pool: 'jmap:acc' };

  it('adds two data types in one pool ONCE, against one number', () => {
    const rows: DataTypeSpace[] = [
      { dataType: 'email', needBytes: 600, capacity: account, destination: 'Stalwart' },
      { dataType: 'files', needBytes: 300, capacity: { ...account, freeBytes: 990 }, destination: 'Stalwart' },
    ];
    const lines = spaceByPool(rows);
    expect(lines).toEqual([
      { pool: 'jmap:acc', destination: 'Stalwart', dataTypes: ['email', 'files'], needBytes: 900, capacity: account },
    ]);
    expect(spaceVerdict(lines[0]!)).toBe('fits');
  });

  it('counts the same data type once even when it is handed in twice', () => {
    const rows: DataTypeSpace[] = [
      { dataType: 'email', needBytes: 600, capacity: account, destination: 'S' },
      { dataType: 'email', needBytes: 600, capacity: account, destination: 'S' },
    ];
    expect(spaceByPool(rows)[0]!.needBytes).toBe(600);
  });

  it('keeps two pools apart, and says which is short', () => {
    const rows: DataTypeSpace[] = [
      { dataType: 'email', needBytes: 600, capacity: account, destination: 'Mail' },
      { dataType: 'files', needBytes: 300, capacity: { known: true, freeBytes: 100, pool: 'dav:x' }, destination: 'Files' },
    ];
    const lines = spaceByPool(rows);
    expect(lines.map(spaceVerdict)).toEqual(['fits', 'short']);
    expect(spaceHoldsStart(lines)).toBe(true);
  });

  it('groups unknown answers by destination and reason, and lets Start through (D3 (a))', () => {
    const rows: DataTypeSpace[] = [
      { dataType: 'email', needBytes: 10, capacity: { known: false, why: 'not_offered' }, destination: 'Mail' },
      { dataType: 'files', needBytes: 20, capacity: { known: false, why: 'not_offered' }, destination: 'Mail' },
      { dataType: 'contacts', needBytes: 1, capacity: { known: false, why: 'not_answered' }, destination: 'Mail' },
    ];
    const lines = spaceByPool(rows);
    expect(lines.map((l) => [l.dataTypes, l.needBytes, spaceVerdict(l)])).toEqual([
      [['email', 'files'], 30, 'unknown'],
      [['contacts'], 1, 'unknown'],
    ]);
    expect(spaceHoldsStart(lines)).toBe(false);
  });

  it('holds Start when a known pool is short (D4 (a)), and not when it fits exactly', () => {
    expect(spaceHoldsStart([{ needBytes: 1_001, capacity: account }])).toBe(true);
    expect(spaceHoldsStart([{ needBytes: 1_000, capacity: account }])).toBe(false);
  });
});
