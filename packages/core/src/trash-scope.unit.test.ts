// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Whether the owner's Deleted Items and Junk come along.
 *
 * Nothing filtered on RFC 6154 special-use anywhere, so the answer was "yes,
 * always, silently". A migration copied everything the owner had thrown away
 * into their new mailbox next to everything they had kept, and nobody had
 * decided that — it was simply what iterating `listFolders()` did.
 *
 * Almost nobody wants it. So the default is now to leave trash and junk behind,
 * and — because a default that nobody is told about is just a different silent
 * answer — the pass reports what it skipped and discovery counts what is in
 * there before anything runs.
 *
 * There is a second reason, and it is why this is the first step of the deletion
 * work rather than a tidy-up. An item sitting in Deleted Items is EXPLICIT
 * evidence that the owner deleted it. Absence is not: it has a dozen innocent
 * causes, which is why the deletions queue needs two confirmations and still
 * cannot be acted on automatically. Taking the trash out of scope as content is
 * what makes it available as a signal.
 */

import { describe, it, expect } from 'vitest';
import { runShadowPass } from './reconcile';
import { discoverSource } from './discovery';
import { MemorySource, MemoryTarget, MemoryLedger } from './__testing__/memory';
import {
  asTenantId,
  asMappingId,
  DEFAULT_EXCLUDE_SPECIAL_USE,
  type MailFolder,
  type SpecialUse,
} from '@openmig/shared';

const TENANT = asTenantId('8e440000-e29b-41d4-a716-4466554481aa');
const MAPPING = asMappingId('8e440000-e29b-41d4-a716-4466554481bb');

/**
 * A source with one message in each of four folders.
 *
 * `MemorySource` derives special-use from the folder name, which covers inbox
 * and sent but not trash or junk — so those two are set directly. The roles are
 * what the real IMAP source reports from RFC 6154 LIST flags; the names are
 * incidental.
 */
function fourFolders() {
  const source = new MemorySource();
  const roles: Array<[string, SpecialUse]> = [
    ['INBOX', 'inbox'],
    ['Sent', 'sent'],
    ['Trash', 'trash'],
    ['Junk', 'junk'],
  ];
  for (const [path] of roles) {
    source.add({ folderPath: path, messageId: `<${path}-1@dev.local>`, rfc822: `Subject: ${path}\r\n\r\nbody` });
  }
  // Override what MemorySource guessed, so the roles are the ones under test.
  const original = source.listFolders.bind(source);
  source.listFolders = async (): Promise<ReadonlyArray<MailFolder>> => {
    const folders = await original();
    return folders.map((f) => {
      const role = roles.find(([path]) => path === f.path)?.[1] ?? 'normal';
      return { ...f, specialUse: role };
    });
  };
  return source;
}

describe('the default: trash and junk are left behind', () => {
  it('is trash and junk, and nothing else', () => {
    // Inbox, Sent, Drafts and Archive are all things the owner chose to KEEP.
    expect([...DEFAULT_EXCLUDE_SPECIAL_USE].sort()).toEqual(['junk', 'trash']);
  });

  it('copies the kept folders and skips the discarded ones', async () => {
    const target = new MemoryTarget();
    const result = await runShadowPass({
      tenantId: TENANT,
      mappingId: MAPPING,
      source: fourFolders(),
      target,
      ledger: new MemoryLedger(),
    });

    // Two folders, one message each. Before this, it was four.
    expect(result.created).toBe(2);
    expect(target.size()).toBe(2);
  });

  it('says which folders it left behind', async () => {
    // A default nobody is told about is just a different silent answer.
    const result = await runShadowPass({
      tenantId: TENANT,
      mappingId: MAPPING,
      source: fourFolders(),
      target: new MemoryTarget(),
      ledger: new MemoryLedger(),
    });

    expect([...(result.excludedCollections ?? [])].sort()).toEqual(['junk', 'trash']);
  });

  it('reports nothing when the source has no such folders', async () => {
    const source = new MemorySource();
    source.add({ folderPath: 'INBOX', messageId: '<a@dev.local>', rfc822: 'Subject: a\r\n\r\nb' });

    const result = await runShadowPass({
      tenantId: TENANT,
      mappingId: MAPPING,
      source,
      target: new MemoryTarget(),
      ledger: new MemoryLedger(),
    });

    expect(result.created).toBe(1);
    expect(result.excludedCollections).toBeUndefined();
  });
});

describe('the owner overrides it', () => {
  it('migrates everything when told to', async () => {
    // A legitimate answer for anyone who treats Deleted Items as an archive.
    const target = new MemoryTarget();
    const result = await runShadowPass({
      tenantId: TENANT,
      mappingId: MAPPING,
      source: fourFolders(),
      target,
      ledger: new MemoryLedger(),
      excludeSpecialUse: [],
    });

    expect(result.created).toBe(4);
    expect(target.size()).toBe(4);
    expect(result.excludedCollections).toBeUndefined();
  });

  it('honours a different choice entirely', async () => {
    // Junk out, Deleted Items in — someone who wants their spam gone but keeps
    // deleted mail as an archive.
    const result = await runShadowPass({
      tenantId: TENANT,
      mappingId: MAPPING,
      source: fourFolders(),
      target: new MemoryTarget(),
      ledger: new MemoryLedger(),
      excludeSpecialUse: ['junk'],
    });

    expect(result.created).toBe(3);
    expect(result.excludedCollections).toEqual(['junk']);
  });
});

describe('discovery counts what will be left behind', () => {
  it('keeps excluded items out of `items` and reports them separately', async () => {
    // The owner is being asked to approve leaving these behind, and they cannot
    // approve a number nobody produced. `items` stays "what will be on the
    // target" so the confirm screen does not overstate the migration.
    const source = fourFolders();
    const discovery = await discoverSource(source, {
      isExcluded: (folder) =>
        DEFAULT_EXCLUDE_SPECIAL_USE.includes(folder.specialUse) ? folder.specialUse : undefined,
    });

    expect(discovery.items, 'inbox + sent').toBe(2);
    expect(discovery.excludedItems, 'trash + junk').toBe(2);
    expect(discovery.collections).toBe(4);

    // Each excluded collection carries the REASON, not just a flag — "we are
    // leaving 1,240 items behind" is alarming, "…in Deleted Items and Junk" is
    // a decision.
    const excluded = (discovery.perCollection ?? []).filter((c) => c.excluded !== undefined);
    expect(excluded.map((c) => c.excluded).sort()).toEqual(['junk', 'trash']);
  });

  it('omits the field entirely when nothing is excluded', async () => {
    const source = fourFolders();
    const discovery = await discoverSource(source, { isExcluded: () => undefined });
    expect(discovery.items).toBe(4);
    expect(discovery.excludedItems).toBeUndefined();
  });
});
