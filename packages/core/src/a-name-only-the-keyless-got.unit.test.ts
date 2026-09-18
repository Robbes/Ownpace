// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A NAME ONLY THE KEYLESS WOULD HAVE GOT.
 *
 * #995 gave the loop a `displayName` hook and called it twice: once from the
 * listing, and again with `raw` in hand. The second call was written beside the
 * natural-key text it was copied from — and that line sits INSIDE
 *
 *     if (naturalKeyHash === undefined) { … }
 *
 * which is the branch for an item the listing could not key. For mail that
 * means a message with no Message-ID: a few strays in a mailbox of a hundred
 * thousand.
 *
 * So a mail descriptor reading its Subject out of `raw` — the only place a
 * Subject can be read from — would have named the strays and nothing else. The
 * feature would have worked on the rarest input in the domain and on no other,
 * and it would have DEMOED: a hand-made message with no Message-ID gets its
 * name, every real message does not.
 *
 * Nothing would have been red. The hook is optional, every domain that had one
 * took its answer from the listing, and the failing case did not exist yet —
 * the same shape as `a-qualifier-wired-to-a-guard-that-never-lets-it-run`, one
 * layer along: **a value only one input reaches is a value no test asserts.**
 *
 * The line now sits after the fetch, for every item. These hold that, from both
 * sides of the branch that used to contain it.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runDomainSync } from './domain-sync.ts';
import { MemoryLedger } from './__testing__/memory.ts';
import { asTenantId, asMappingId, setLogLevel, resetLogLevel } from '@openmig/shared';

const TENANT = asTenantId('02250000-e29b-41d4-a716-4466554406aa');
const MAPPING = asMappingId('02250000-e29b-41d4-a716-4466554406bb');

beforeEach(() => setLogLevel('error'));
afterEach(() => resetLogLevel());

/** A message shape: what the listing knows, and what only the bytes know. */
interface Message {
  readonly id: string;
  /** Absent for the stray with no Message-ID — the keyless case. */
  readonly messageId?: string;
  /** Only ever read from `raw`, exactly as a Subject is. */
  readonly subject: string;
}

const keyOf = (id: string) => `hash:${id}`;

/**
 * One pass over one message.
 *
 * `displayName` reads ONLY `raw`, which is the whole point: a hook that could
 * answer from the item would pass whether or not the second call ever happens.
 */
function onePass(ledger: MemoryLedger, message: Message) {
  return runDomainSync<unknown, unknown, Message, { path: string }>({
    sourceIsAuthorityOnExistence: true,
    tenantId: TENANT,
    mappingId: MAPPING,
    domain: 'email',
    source: {},
    target: {},
    ledger,
    listFolders: async () => [{ path: 'INBOX' }],
    listSince: async () => ({ items: [message], nextCursor: { value: '1' } }),
    fetchRaw: async (m) => ({ raw: m, sizeBytes: 10 }),
    upsert: async () => ({ targetId: 't', created: true }),
    // Undefined for a message the listing could not key, like mail with no
    // Message-ID — which is what selects the branch this defect lived in.
    naturalKey: (m) => (m.messageId ? keyOf(m.messageId) : undefined),
    naturalKeyFromRaw: (_m, raw) => keyOf((raw as Message).id),
    displayName: (_m, raw) => (raw === undefined ? undefined : (raw as Message).subject),
    contentHash: () => 'h',
    ensureCollection: async (f) => f.path,
  });
}

const nameOn = async (ledger: MemoryLedger, key: string) =>
  (await ledger.find(TENANT, MAPPING, 'email', key))?.displayName;

describe('a message the listing COULD key still gets its name', () => {
  it('records the Subject that only the fetched bytes carry', async () => {
    // The case that was broken, and the only case that exists in a real
    // mailbox: a message with a Message-ID.
    const ledger = new MemoryLedger();
    await onePass(ledger, {
      id: 'm1',
      messageId: '<CAF1@mail.example.test>',
      subject: 'Quarterly résumé',
    });
    expect(
      await nameOn(ledger, keyOf('<CAF1@mail.example.test>')),
      'the row carries no name, so the confirmed list shows the Message-ID — which is ' +
        'what it showed before. The name is derived only inside the branch for items the ' +
        'listing could not key, and a message with a Message-ID never enters it.',
    ).toBe('Quarterly résumé');
  });
});

describe('and the keyless one still does too', () => {
  it('names a message whose key had to be derived from its own bytes', async () => {
    // The path the line used to live on. Moving it must not cost this.
    const ledger = new MemoryLedger();
    await onePass(ledger, { id: 'm2', subject: 'No Message-ID here' });
    expect(await nameOn(ledger, keyOf('m2'))).toBe('No Message-ID here');
  });
});

describe('the hook stays optional', () => {
  it('writes the row with no name when no descriptor supplies one', async () => {
    const ledger = new MemoryLedger();
    await runDomainSync<unknown, unknown, Message, { path: string }>({
      sourceIsAuthorityOnExistence: true,
      tenantId: TENANT,
      mappingId: MAPPING,
      domain: 'email',
      source: {},
      target: {},
      ledger,
      listFolders: async () => [{ path: 'INBOX' }],
      listSince: async () => ({
        items: [{ id: 'm3', messageId: '<CAF3@mail.example.test>', subject: 'unused' }],
        nextCursor: { value: '1' },
      }),
      fetchRaw: async (m) => ({ raw: m, sizeBytes: 10 }),
      upsert: async () => ({ targetId: 't', created: true }),
      naturalKey: (m) => keyOf(m.messageId!),
      contentHash: () => 'h',
      ensureCollection: async (f) => f.path,
    });
    const row = await ledger.find(TENANT, MAPPING, 'email', keyOf('<CAF3@mail.example.test>'));
    expect(row, 'the pass did not write a row at all').toBeDefined();
    expect(row?.displayName).toBeUndefined();
  });
});
