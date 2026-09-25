// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHICH STORE THE PASS PICKS, AND WHAT IT SAYS BEFORE IT CAN PICK ONE.
 *
 * Workplan 0116 T4, the relay's first slice, second half. The reading half
 * landed as a seam nothing chose: `webdavStore` could read an archive inside a
 * file target and no caller ever asked it to, because a managed pass had no
 * way to say *this export is in the target, not on a disk*. `where` is that
 * way, and this file holds the four things it must mean.
 *
 * 1. **A mapping that does not say it keeps meaning what it meant.** `where`
 *    is optional and defaults to `disk`. Every archive mapping written before
 *    2026-09-20 is a path on the machine running the pass, and none of them
 *    may change meaning under this.
 * 2. **The store carries the migration's OWN target** — the endpoint the file
 *    domain itself writes to, `fileBaseUrl` and Nextcloud's `files/{user}/`
 *    and all. Not a store the archive names, not a store this product keeps.
 * 3. **A target that cannot serve a byte range is refused by sentence.** The
 *    owner's constraint of 2026-09-20 — *"we do however have to anticipate
 *    people might have other targets then nextcloud for files or photo's"* —
 *    cuts both ways: the read path must not assume Nextcloud, AND the one
 *    target shape that genuinely cannot answer must say so rather than come
 *    back empty-handed and let the archive take the blame.
 * 4. **A Test with no migration in hand says the counts come later.** A
 *    connection is tested before any migration names where it writes, so
 *    there is nothing to read the export through yet. Never a measured no.
 *    The owner, reading this: *"Ok, this is correct."*
 *
 * The thing every test here is written to catch is the same one 0116 has been
 * written around throughout: an archive that could not be reached reporting
 * ZERO rather than reporting why.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseArchiveSource,
  ConfigError,
  ARCHIVE_WHERE,
  archiveInJmapTargetSentence,
} from '@openmig/shared';
import { localStore, type ArchiveStore } from '@openmig/connectors';
import { probeSourceConnection } from './probe-connection.ts';
import { qualifyArchive } from './account-qualification.ts';
import { buildFileSourceFromConnection } from './build-deps-from-mapping.ts';
import {
  ARCHIVE_CONNECTION_KIND,
  archiveStoreInTarget,
  buildArchiveSourceFrom,
} from './archive-source-factory.ts';

const made: string[] = [];

afterEach(async () => {
  await Promise.all(made.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

/** A Takeout with one photo in one album, on disk. */
async function takeoutOnDisk(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'store-the-pass-picks-'));
  made.push(root);
  const photos = join(root, 'Takeout', 'Google Photos', 'Holiday');
  await mkdir(photos, { recursive: true });
  await writeFile(join(photos, 'IMG_0001.jpg'), Buffer.from('not really a jpeg'));
  // An album carries its own `metadata.json`; a year folder does not. That is
  // how the reader tells the two apart in any language (measured 2026-09-21).
  await writeFile(join(photos, 'metadata.json'), JSON.stringify({ title: 'Holiday' }));
  return root;
}

/**
 * A store that answers relative paths from one root, and records what it was
 * asked for.
 *
 * SHIFTED deliberately: the archive's `path` is a bare name that exists
 * NOWHERE relative to this process's working directory. So a wiring that
 * ignored the store and reached for the disk cannot pass by accident — it
 * finds nothing at all, which is exactly the failure this file is here to
 * make impossible.
 */
function shiftedStore(root: string): ArchiveStore & { readonly asked: string[] } {
  const disk = localStore();
  const asked: string[] = [];
  const at = (path: string): string => join(root, path);
  return {
    asked,
    stat: (path) => {
      asked.push(path);
      return disk.stat(at(path));
    },
    list: (folder) => disk.list(at(folder)),
    folderTree: (path) => disk.folderTree(at(path)),
    source: (path) => disk.source(at(path)),
    describe: (path) => `shifted:${path}`,
    split: (path) => disk.split(path),
    join: (folder, name) => disk.join(folder, name),
  };
}

const TARGET = { url: 'https://cloud.example.org/remote.php/dav/files/pat/', username: 'pat', password: 'pw' };

describe('where an archive is, as data', () => {
  it('defaults to the disk, so no mapping written before the relay changes meaning', () => {
    const parsed = parseArchiveSource({ provider: 'google-takeout', path: '/srv/exports' });
    expect(parsed.where).toBeUndefined();
  });

  it('takes both answers, and only those two', () => {
    expect(parseArchiveSource({ provider: 'google-takeout', path: '/a', where: 'disk' }).where).toBe('disk');
    expect(parseArchiveSource({ provider: 'google-takeout', path: '/a', where: 'target' }).where).toBe('target');
    expect(ARCHIVE_WHERE).toEqual(['disk', 'target']);
  });

  it('refuses anything else BY NAME rather than falling back to the disk', () => {
    // A silent fallback here is a managed pass looking for a path on a
    // container that has no shared volume at all — and the sentence that
    // comes back would be about the person's export, for our typo.
    for (const bad of ['Target', 'nextcloud', '', 'both', 7, null]) {
      let thrown: unknown;
      try {
        parseArchiveSource({ provider: 'google-takeout', path: '/a', where: bad });
      } catch (err) {
        thrown = err;
      }
      expect(thrown, `where: ${JSON.stringify(bad)} was accepted`).toBeInstanceOf(ConfigError);
      expect(String(thrown)).toContain('"disk"');
      expect(String(thrown)).toContain('"target"');
    }
  });
});

describe('the store the pass picks', () => {
  it('reads the archive THROUGH the store when the location says target', async () => {
    const root = await takeoutOnDisk();
    const store = shiftedStore(root);
    const source = buildArchiveSourceFrom(
      // A bare name. Nothing is at this path on this machine.
      { type: 'archive', provider: 'google-takeout', path: '.', where: 'target' },
      { targetStore: () => store },
    );
    const folders = await source.listFolders();
    expect(folders.map((f) => f.path)).toContain('Holiday');
    expect(store.asked.length, 'the store was never consulted').toBeGreaterThan(0);
  });

  it('never asks for a target store when the location does not say target', async () => {
    const root = await takeoutOnDisk();
    let built = 0;
    const source = buildArchiveSourceFrom(
      { type: 'archive', provider: 'google-takeout', path: root },
      {
        targetStore: () => {
          built += 1;
          throw new Error('a disk archive asked for the target');
        },
      },
    );
    const folders = await source.listFolders();
    expect(folders.map((f) => f.path)).toContain('Holiday');
    expect(built, 'a mapping that says nothing reached for the target anyway').toBe(0);
  });

  it('says the counts come at the preflight when there is no target in hand', () => {
    // The wiring gap that must never read as an empty export.
    expect(() =>
      buildArchiveSourceFrom({ type: 'archive', provider: 'google-takeout', path: 'x.zip', where: 'target' }),
    ).toThrow(/counted at the preflight/);
  });
});

describe('a file target, whatever is behind it', () => {
  it('aims the store at the migration’s own target URL', () => {
    const store = archiveStoreInTarget('webdav', TARGET, 'nextcloud');
    // The endpoint travels: the path is resolved against the target the file
    // domain writes to, not against anything this product holds.
    expect(store.describe('Imports/takeout-001.zip')).toBe(
      'https://cloud.example.org/remote.php/dav/files/pat/Imports/takeout-001.zip',
    );
  });

  it('asks nothing about which product answers the URL', () => {
    // The owner's constraint, as a test: the same endpoint under a kind that
    // is not Nextcloud resolves identically. Anything that branched on the
    // kind — an OCS call, a path convention, a capability probe — fails here.
    const plain = archiveStoreInTarget('webdav', TARGET, 'webdav');
    const nextcloud = archiveStoreInTarget('webdav', TARGET, 'nextcloud');
    const owncloud = archiveStoreInTarget('webdav', TARGET, 'owncloud');
    for (const store of [nextcloud, owncloud]) {
      expect(store.describe('a/b.zip')).toBe(plain.describe('a/b.zip'));
    }
  });

  it('refuses a JMAP target by sentence, with both ways out', () => {
    let thrown: unknown;
    try {
      archiveStoreInTarget('jmap', TARGET, 'fastmail');
    } catch (err) {
      thrown = err;
    }
    const said = String(thrown);
    expect(said).toContain('fastmail');
    expect(said).toContain('JMAP');
    // Not the export's fault, and both ways forward named.
    expect(said).toContain('Nothing is wrong with the export');
    expect(said).toContain('WebDAV');
    // And it is the sentence the create door refuses a JMAP destination with
    // (0148 T9): one sentence, in shared, whichever of the two meets it first.
    expect(said).toContain(archiveInJmapTargetSentence('fastmail'));
  });
});

describe('the pass builder, end to end', () => {
  it('hands an archive source the target this migration writes to', async () => {
    const root = await takeoutOnDisk();
    const store = shiftedStore(root);
    const source = buildFileSourceFromConnection(
      {
        kind: ARCHIVE_CONNECTION_KIND,
        config: { type: 'archive', provider: 'google-takeout', path: '.', where: 'target' },
        // No credentials: an archive's credential is a location.
        creds: {},
      },
      undefined,
      { targetStore: () => store },
    );
    const folders = await source.listFolders();
    expect(folders.map((f) => f.path)).toContain('Holiday');
  });

  it('still builds a disk archive for a caller with no target at all', async () => {
    const root = await takeoutOnDisk();
    const source = buildFileSourceFromConnection(
      {
        kind: ARCHIVE_CONNECTION_KIND,
        config: { type: 'archive', provider: 'google-takeout', path: root },
        creds: {},
      },
      undefined,
    );
    const folders = await source.listFolders();
    expect(folders.map((f) => f.path)).toContain('Holiday');
  });
});

describe('Test, before any migration names a target', () => {
  it('says the counts come at the preflight — never that the export is empty', async () => {
    const r = await probeSourceConnection(
      ARCHIVE_CONNECTION_KIND,
      { type: 'archive', provider: 'google-takeout', path: 'Imports/takeout-001.zip', where: 'target' },
      {},
    );
    // UNKNOWN, on the `timedOut` precedent: nothing is wrong, and the
    // connection is kept. What it must NOT be is `connected, count: 0`.
    expect(r.ok).toBe(false);
    expect(r.outcome).toEqual({ code: 'countedAtPreflight' });
    if (!r.ok) {
      expect(r.reason).toContain('preflight');
      expect(r.reason).not.toContain('could not be opened');
    }
  });

  it('does not go looking on this machine for it', async () => {
    // A path that WOULD open if the probe fell through to the disk. It must
    // not: a managed run container has no volume, so the honest answer is the
    // one above rather than a reading of whatever happens to be here.
    const root = await takeoutOnDisk();
    const r = await probeSourceConnection(
      ARCHIVE_CONNECTION_KIND,
      { type: 'archive', provider: 'google-takeout', path: root, where: 'target' },
      {},
    );
    expect(r.outcome?.code).toBe('countedAtPreflight');
  });

  it('qualifies the file face as UNKNOWN with the reason, not as a measured no', async () => {
    const q = await qualifyArchive(ARCHIVE_CONNECTION_KIND, {
      type: 'archive',
      provider: 'google-takeout',
      path: 'Imports/takeout-001.zip',
      where: 'target',
    });
    expect(q, 'an archive connection went unqualified').toBeDefined();
    const file = q?.domains.file;
    expect(file?.answer, JSON.stringify(file)).toBe('unknown');
    expect(file?.detail ?? '').toContain('preflight');
    // The one answer that would put "you have no photos" on a screen.
    expect(file?.count).toBeUndefined();
  });

  it('still measures a disk archive at Test, which is the appliance’s whole route', async () => {
    const root = await takeoutOnDisk();
    const r = await probeSourceConnection(
      ARCHIVE_CONNECTION_KIND,
      { type: 'archive', provider: 'google-takeout', path: root },
      {},
    );
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.outcome).toEqual({ code: 'connected', count: 1, unit: 'folder' });
  });
});
