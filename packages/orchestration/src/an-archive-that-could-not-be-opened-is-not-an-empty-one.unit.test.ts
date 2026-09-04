// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN ARCHIVE THAT COULD NOT BE OPENED IS NOT AN EMPTY ONE.
 *
 * Workplan 0116 T1, §1. This is the single property that most needs holding on
 * the archive route, and the one easiest to lose in a refactor, because BOTH
 * answers are a successful function call returning a small number.
 *
 * The failure modes here are not exotic. A 25 GB export arrives in parts and
 * one of them was never fetched; the download was interrupted; the person
 * pointed us at the `.zip` rather than the folder they extracted; the path is
 * a Takeout and the connection says Apple. Every one of those is somebody's
 * ordinary Tuesday, and every one of them produces **"we could not open
 * this"**.
 *
 * If any of them instead produced `ok: true, count: 0`, the three-state record
 * would take it as a MEASURED NO (0106 T3a) and the screen would tell somebody
 * who has waited a week for their photo library that **they have no photos**.
 * That is simultaneously the most alarming sentence this product could say and
 * the one they can do least about — there is no credential to fix and no
 * setting to change, only a wrong conclusion stated confidently.
 *
 * ## And the second half: the face nothing builds
 *
 * `archive` claims the `file` domain. Without an arm of its own, the file seam
 * resolves it through `protocolDefault('file')` to `dav` and aims a WebDAV
 * client at a folder on a disk — refused, eventually, for a missing password
 * that this kind does not have. That is the #597 family exactly: a fan-out
 * whose absence is invisible until somebody runs one. The arm exists so the
 * error names the real state of the world instead.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { probeSourceConnection } from './probe-connection.ts';
import { sourceFaceBuilder } from './source-face-builders.ts';
import { buildFileSourceFromConnection } from './build-deps-from-mapping.ts';
import {
  ARCHIVE_CONNECTION_KIND,
  archiveReaderFor,
  archiveProvidersWithReaders,
} from './archive-source-factory.ts';

const made: string[] = [];

async function takeoutWithOnePhoto(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'archive-probe-'));
  made.push(root);
  const photos = join(root, 'Takeout', 'Google Photos', 'Photos from 2024');
  await mkdir(photos, { recursive: true });
  await writeFile(join(photos, 'IMG_0001.jpg'), Buffer.from('not really a jpeg'));
  return root;
}

async function emptyDirectory(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  made.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(made.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe('Test on an archive connection', () => {
  it('opens a real Takeout and counts what is in it', async () => {
    const root = await takeoutWithOnePhoto();
    const r = await probeSourceConnection(
      ARCHIVE_CONNECTION_KIND,
      { type: 'archive', provider: 'google-takeout', path: root },
      // No credentials at all, which is this kind's whole point: the probe must
      // not demand a username and password it will never be given.
      {},
    );
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.outcome).toEqual({ code: 'connected', count: 1, unit: 'folder' });
  });

  it('answers a folder that is not a Takeout with the REASON, not with zero', async () => {
    // The heart of it. `ok: false` and a sentence; never `ok: true, count: 0`,
    // which a screen would render as a measured "you have no photos".
    const root = await emptyDirectory('not-a-takeout-');
    const r = await probeSourceConnection(
      ARCHIVE_CONNECTION_KIND,
      { type: 'archive', provider: 'google-takeout', path: root },
      {},
    );
    expect(
      r.ok,
      'an archive we could not open reported success, so its emptiness will be read as a ' +
        'measured "no" and somebody will be told they have no photos',
    ).toBe(false);
    expect(r.outcome?.code).toBe('providerRefused');
    if (!r.ok) {
      expect(r.reason).toContain('could not be opened');
    }
  });

  it('says which export it expected when the connection names the other one', async () => {
    // A Takeout on disk, a connection that says Apple. The Google reader would
    // find no landmarks and report nothing; the readers refuse by name instead.
    const root = await takeoutWithOnePhoto();
    const r = await probeSourceConnection(
      ARCHIVE_CONNECTION_KIND,
      { type: 'archive', provider: 'apple-privacy', path: root },
      {},
    );
    expect(r.ok).toBe(false);
    // No reader for Apple yet — deliberately absent rather than stubbed, so
    // the answer is "we have not built this", never "your export is empty".
    expect(r.outcome?.code, JSON.stringify(r)).toBe('noProbe');
    if (!r.ok) {
      expect(r.reason).toContain('not a problem with your export');
    }
  });

  it('refuses a config that is not an archive at all, in the shared parser', async () => {
    const r = await probeSourceConnection(
      ARCHIVE_CONNECTION_KIND,
      { type: 'archive', provider: 'google-photos', path: '/nowhere' },
      {},
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain('google-takeout');
    }
  });
});

describe('the readers, and the one that is absent on purpose', () => {
  it('has a Google reader and no Apple one — an absence, not a stub', () => {
    // 0116 T3b starts by opening a real Apple export and writing down what is
    // inside. A stub answering "0 items" until then would be indistinguishable,
    // on screen, from an export that really was empty.
    expect(archiveProvidersWithReaders()).toEqual(['google-takeout']);
    expect(archiveReaderFor('google-takeout')?.provider).toBe('google-takeout');
    expect(archiveReaderFor('apple-privacy')).toBeUndefined();
    expect(archiveReaderFor('meta-dyi')).toBeUndefined();
  });
});

describe('the file face an archive claims', () => {
  it('resolves to the archive builder, NOT to the DAV default', () => {
    // Without this the kind falls to `protocolDefault('file')` and a WebDAV
    // client is aimed at a folder on a disk — #597's shape, and invisible
    // until somebody runs a migration.
    expect(sourceFaceBuilder(ARCHIVE_CONNECTION_KIND, 'file')).toBe('archive');
    expect(sourceFaceBuilder(ARCHIVE_CONNECTION_KIND, 'file')).not.toBe('dav');
  });

  it('refuses to build one, naming what is missing rather than what is broken', () => {
    // The second wall. The create-mapping door already refuses an archive
    // source by name, so nothing should reach here — but that door is a
    // validator somebody could widen, and this is what stands behind it.
    expect(() =>
      buildFileSourceFromConnection({
        kind: ARCHIVE_CONNECTION_KIND,
        config: { type: 'archive', provider: 'google-takeout', path: '/srv/exports/x' },
        creds: {},
      }),
    ).toThrow(/not built yet/);
  });
});
