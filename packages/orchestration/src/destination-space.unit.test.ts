// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The route's core (workplan 0171 §6.3, T9): every destination writer asked
 * at once, each within its limit, closed after; answers grouped per pool;
 * a failure or a late answer is `not_answered`, never room.
 */
import { describe, it, expect } from 'vitest';
import type { DestinationCapacity, DiscoveryDomain } from '@openmig/shared';
import {
  destinationLabelOf,
  needFromDiscovery,
  readDestinationSpace,
  type DestinationOpener,
} from './destination-space.ts';

const account: DestinationCapacity = { known: true, freeBytes: 1_000, totalBytes: 2_000, pool: 'jmap:s#a' };

function opener(
  dataType: DiscoveryDomain,
  capacity: (() => Promise<DestinationCapacity>) | undefined,
  log: string[],
  destination = 'mail.example.org',
): DestinationOpener {
  return {
    dataType,
    destination,
    open: async () => {
      log.push(`open ${dataType}`);
      return {
        target: {
          ...(capacity ? { capacity } : {}),
          disconnect: async () => void log.push(`disconnect ${dataType}`),
        },
        close: async () => void log.push(`close ${dataType}`),
      };
    },
  };
}

const need = (d: DiscoveryDomain) => ({ email: 600, file: 300, calendar: 5, contact: 1, task: 1 })[d];

describe('readDestinationSpace', () => {
  it('adds mail and files in one JMAP account once, and closes every writer it opened', async () => {
    const log: string[] = [];
    const pools = await readDestinationSpace(
      [opener('email', async () => account, log), opener('file', async () => account, log)],
      need,
    );
    expect(pools).toEqual([
      { pool: 'jmap:s#a', destination: 'mail.example.org', dataTypes: ['email', 'file'], needBytes: 900, capacity: account },
    ]);
    expect(log.filter((l) => l.startsWith('close')).sort()).toEqual(['close email', 'close file']);
  });

  it('asks no calendar, contact or task destination, and says not offered', async () => {
    const log: string[] = [];
    const pools = await readDestinationSpace([opener('calendar', async () => account, log), opener('contact', async () => account, log)], need);
    expect(log).toEqual([]);
    expect(pools).toEqual([
      expect.objectContaining({ dataTypes: ['calendar', 'contact'], needBytes: 6, capacity: { known: false, why: 'not_offered' } }),
    ]);
  });

  it('says not offered for a writer with no capacity()', async () => {
    const pools = await readDestinationSpace([opener('file', undefined, [])], need);
    expect(pools[0]!.capacity).toEqual({ known: false, why: 'not_offered' });
  });

  it('says not answered for a read that throws, or a writer that cannot be built', async () => {
    const log: string[] = [];
    const failing: DestinationOpener = { dataType: 'file', destination: 'x', open: () => Promise.reject(new Error('no client')) };
    const pools = await readDestinationSpace(
      [opener('email', () => Promise.reject(new Error('HTTP 503')), log), failing],
      need,
    );
    expect(pools.map((p) => [p.dataTypes, p.capacity])).toEqual([
      [['email'], { known: false, why: 'not_answered' }],
      [['file'], { known: false, why: 'not_answered' }],
    ]);
    expect(log).toContain('close email');
  });

  it('says not answered for a read past its limit, and still lets the writer go when it answers', async () => {
    const log: string[] = [];
    let answer!: (c: DestinationCapacity) => void;
    const slow = () => new Promise<DestinationCapacity>((r) => (answer = r));
    const pools = await readDestinationSpace([opener('email', slow, log)], need, { timeoutMs: 20 });
    expect(pools[0]!.capacity).toEqual({ known: false, why: 'not_answered' });
    answer(account);
    await new Promise((r) => setTimeout(r, 0));
    expect(log).toContain('disconnect email');
  });
});

describe('needFromDiscovery', () => {
  it('reads each data type’s bytes, and a row with an error or none as nothing', () => {
    const of = needFromDiscovery([
      { domain: 'email', bytes: 600 },
      { domain: 'file', bytes: 300, lastError: 'refused' },
      { domain: 'contact' },
    ]);
    expect([of('email'), of('file'), of('contact'), of('task')]).toEqual([600, 0, 0, 0]);
  });
});

describe('destinationLabelOf', () => {
  it('names the host, never the account or the path', () => {
    expect(destinationLabelOf('jmap', { type: 'jmap', baseUrl: 'https://mail.example.org/', user: 'ana' })).toBe('mail.example.org');
    expect(destinationLabelOf('imap', { host: 'IMAP.Example.org', port: 993 })).toBe('imap.example.org');
    expect(destinationLabelOf('nextcloud', { url: 'https://cloud.example.org/remote.php/dav/files/ana' })).toBe('cloud.example.org');
  });

  it('names Cirrux by name, and a kind with no address by its kind', () => {
    expect(destinationLabelOf('cirrux', { host: 'x' })).toBe('Cirrux');
    expect(destinationLabelOf('dropbox', {})).toBe('dropbox');
  });
});
