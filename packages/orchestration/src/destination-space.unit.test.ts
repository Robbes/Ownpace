// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The route's core (workplan 0171 §6.3, T9): every destination writer asked
 * at once, each within its limit, closed after; answers grouped per pool;
 * a failure or a late answer is `not_answered`, never room.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { log, type DestinationCapacity, type DiscoveryDomain } from '@openmig/shared';
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

/**
 * Nothing caught here disappears (an outside, read-only check, ERR-1, 2026-11-25;
 * workplan 0006 §T): the answer is still `not_answered` or the room, as before,
 * and each failure nobody else sees is one log line.
 */
describe('readDestinationSpace: a failure is said, never dropped', () => {
  afterEach(() => vi.restoreAllMocks());
  const said = () => vi.spyOn(log, 'warn').mockImplementation(() => {});
  const settle = () => new Promise((r) => setTimeout(r, 0));

  it('logs a connection that does not close after the answer, and keeps the answer', async () => {
    const warn = said();
    const target = { capacity: async () => account, disconnect: () => Promise.reject(new Error('LOGOUT refused')) };
    const pools = await readDestinationSpace(
      [{ dataType: 'email', destination: 'mail.example.org', open: async () => ({ target, close: async () => {} }) }],
      need,
    );
    await settle();
    expect(pools[0]!.capacity).toEqual(account);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('email at mail.example.org: its connection did not close');
    expect(String(warn.mock.calls[0]![0])).toContain('LOGOUT refused');
  });

  it('logs a read that fails after its limit, which the answer could no longer carry', async () => {
    const warn = said();
    let fail!: (e: Error) => void;
    const slow = () => new Promise<DestinationCapacity>((_, reject) => (fail = reject));
    const pools = await readDestinationSpace([opener('email', slow, [])], need, { timeoutMs: 20 });
    expect(pools[0]!.capacity).toEqual({ known: false, why: 'not_answered' });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('no answer within');
    fail(new Error('connection reset'));
    await settle();
    expect(warn).toHaveBeenCalledTimes(2);
    expect(String(warn.mock.calls[1]![0])).toContain('email at mail.example.org failed after its limit: connection reset');
  });

  it('logs a read that fails within its limit once, where it is answered', async () => {
    const warn = said();
    const pools = await readDestinationSpace([opener('email', () => Promise.reject(new Error('HTTP 503')), [])], need);
    await settle();
    expect(pools[0]!.capacity).toEqual({ known: false, why: 'not_answered' });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('did not say its free space: HTTP 503');
  });

  it('logs what was opened to ask and would not close, and keeps the answer', async () => {
    const warn = said();
    const pools = await readDestinationSpace(
      [{ dataType: 'file', destination: 'cloud.example.org', open: async () => ({ target: { capacity: async () => account }, close: () => Promise.reject(new Error('pool gone')) }) }],
      need,
    );
    expect(pools[0]!.capacity).toEqual(account);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('file at cloud.example.org: what was opened to ask did not close: pool gone');
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
