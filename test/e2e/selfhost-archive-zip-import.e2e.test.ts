// Copyright 2026 The Ownpace authors (Apache-2.0)
//
// THE ZIP-ROUTE GATE (workplan 0116 T10, second half; D7's second slice): the
// same Takeout, as the two-part `.zip` download Google hands over, read IN
// PLACE by the reader we own and imported into the real Nextcloud.
//
// Runs after the archive-import gate and depends on it. That gate imported
// the extracted folder to the account's root; this one imports the zip parts
// into a subfolder of the same account, `from-zip/`, which it creates first
// — an EMPTY folder, so every item is written rather than adopted. (The
// WebDAV writer adopts an existing path without comparing bytes, so an import
// into the root would prove only that the paths matched.) Then the two routes
// are compared:
//
//   - the same four things landed (the album copy, the two under the year,
//     the manifest), byte for byte against the fixture;
//   - the manifest carries the SAME NAME and the SAME BYTES as the folder
//     route's. The name is the fingerprint over every item's content hash and
//     the bytes carry the albums, the sidecar and the edit's link, so this is
//     the four-layout unit test's claim made on the real stack: a zip and the
//     folder it extracts to are one archive;
//   - a second pass writes nothing.
//
// What it proves that no unit test can: the appliance's own file arm hands a
// `.zip` path to the reader, the reader finds part 2 beside part 1 on the
// container's filesystem through the read-only mount, and the pass's deps and
// the real target are in the loop. This is the gate that found the appliance
// had no archive case at all (2026-09-05); a zip case only the unit tests had
// seen would be the same class of gap. The parts were written by Info-ZIP,
// not by our test writer (test/e2e/fixtures/takeout-zip/README.md).
//
// PREREQUISITES: the same running stack as the other selfhost gates; the
// fixture zips mounted at /data/fixtures/takeout-zip; the zip mapping in the
// config dir with its target URL ending in `from-zip/`.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  NEXTCLOUD_URL,
  DAV_TARGET_USER,
  TARGET_DAV_PASSWORD,
  PASS_WAIT_MS,
  davAuthHeader,
  getDomainStatusFor,
  runPassNow,
  startMapping,
} from './apply-deletion-lib.ts';

const ZIP_MAPPING_ID = (
  JSON.parse(readFileSync('test/e2e/fixtures/selfhost-archive-zip-import.mapping.json', 'utf8')) as {
    mappingId: string;
  }
).mappingId;

/** The subfolder e2e.yml appends to the zip mapping's target URL. */
const SUBFOLDER = 'from-zip';

const FIXTURE = 'test/e2e/fixtures/takeout/Takeout/Google Photos';
const fixtureBytes = (relative: string): Buffer => readFileSync(`${FIXTURE}/${relative}`);

/** A path in the target account, each segment encoded the way a DAV href is. */
const target = (relative: string): string =>
  `${NEXTCLOUD_URL}/remote.php/dav/files/${DAV_TARGET_USER}/` +
  relative.split('/').filter(Boolean).map(encodeURIComponent).join('/');
const auth = () => davAuthHeader(DAV_TARGET_USER, TARGET_DAV_PASSWORD);

const isManifest = (name: string): boolean =>
  name.startsWith('export-archive-manifest-') && name.endsWith('.json');

/** The names directly under a directory of the target account, from a Depth 1 PROPFIND. */
async function namesUnder(relativeDir: string): Promise<string[]> {
  const url = target(relativeDir) + (relativeDir ? '/' : '');
  const response = await fetch(url, {
    method: 'PROPFIND',
    headers: { ...auth(), 'Content-Type': 'application/xml', Depth: '1' },
    body: `<?xml version="1.0" encoding="utf-8"?>
      <d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>`,
  });
  if (response.status !== 207) {
    throw new Error(`PROPFIND ${url} -> ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  const body = await response.text();
  const names: string[] = [];
  const hrefRegex = /<[A-Za-z][\w-]*:href[^>]*>([\s\S]*?)<\/[A-Za-z][\w-]*:href>/gi;
  let match: RegExpExecArray | null;
  while ((match = hrefRegex.exec(body)) !== null) {
    const href = decodeURIComponent(match[1]!.trim()).replace(/\/$/, '');
    const name = href.slice(href.lastIndexOf('/') + 1);
    if (name) names.push(name);
  }
  // The first response is the directory itself.
  return names.slice(1);
}

async function bytesAt(relative: string): Promise<Buffer> {
  const response = await fetch(target(relative), { headers: auth() });
  expect(response.status, `${relative} is missing from the target`).toBe(200);
  return Buffer.from(await response.arrayBuffer());
}

describe('archive import from the .zip itself — the download, never extracted, into the real Nextcloud (0116 T10, zip route)', () => {
  it('creates the empty subfolder the zip route writes into', async () => {
    const response = await fetch(target(SUBFOLDER) + '/', { method: 'MKCOL', headers: auth() });
    // 201 created it; 405 is "already there" (RFC 4918 §9.3.1), which a second
    // run of this gate against a kept stack answers.
    expect([201, 405], `MKCOL ${SUBFOLDER} -> ${response.status}`).toContain(response.status);
  }, 30000);

  it(
    'green-lights the zip mapping and imports it: the same three placements and the manifest, written',
    async () => {
      await startMapping(ZIP_MAPPING_ID);
      const deadline = Date.now() + PASS_WAIT_MS;
      let status = await getDomainStatusFor(ZIP_MAPPING_ID, 'file');
      while (Date.now() < deadline && !(status?.state === 'completed' && status.itemsSynced > 0)) {
        await runPassNow(ZIP_MAPPING_ID);
        status = await getDomainStatusFor(ZIP_MAPPING_ID, 'file');
        if (status?.state === 'completed' && status.itemsSynced > 0) break;
        await sleep(1000);
      }
      expect(status, 'the zip mapping never reported a file domain').not.toBeNull();
      expect(status!.state).toBe('completed');
      expect(status!.itemsFailed).toBe(0);
      // WRITTEN, all four — into an empty folder nothing could be adopted from.
      // Four and not five: the album photo is not written under its year too,
      // exactly as from the folder. Four and not three: part 2 was read, or
      // the second photo and the edit under the year would be missing.
      expect(status!.itemsSynced).toBe(4);
    },
    PASS_WAIT_MS + 60000,
  );

  it('placed the photos exactly where the folder route placed them, byte for byte', async () => {
    expect(await bytesAt(`${SUBFOLDER}/Holiday/IMG_0001.jpg`)).toEqual(fixtureBytes('Holiday/IMG_0001.jpg'));

    const year = await namesUnder(`${SUBFOLDER}/Photos from 2024`);
    expect(year.sort()).toEqual(['IMG_0001-edited.jpg', 'IMG_0002.jpg']);
    const duplicate = await fetch(target(`${SUBFOLDER}/Photos from 2024/IMG_0001.jpg`), { headers: auth() });
    expect(duplicate.status, 'the album photo was written under its year too').toBe(404);

    expect(await bytesAt(`${SUBFOLDER}/Photos from 2024/IMG_0001-edited.jpg`)).toEqual(
      fixtureBytes('Photos from 2024/IMG_0001-edited.jpg'),
    );
    expect(await bytesAt(`${SUBFOLDER}/Photos from 2024/IMG_0002.jpg`)).toEqual(
      fixtureBytes('Photos from 2024/IMG_0002.jpg'),
    );
  }, 30000);

  it('wrote the manifest the folder route wrote: the same name, the same bytes', async () => {
    const fromZip = (await namesUnder(SUBFOLDER)).filter(isManifest);
    const fromFolder = (await namesUnder('')).filter(isManifest);
    expect(fromZip, 'the zip route wrote no manifest, or more than one').toHaveLength(1);
    expect(fromFolder, 'the folder route left no manifest at the root, or more than one').toHaveLength(1);
    // The name carries the fingerprint over every item's content hash: the
    // same name means the zip route hashed every item to the same value.
    expect(fromZip[0]).toBe(fromFolder[0]);
    const zipManifest = await bytesAt(`${SUBFOLDER}/${fromZip[0]!}`);
    const folderManifest = await bytesAt(fromFolder[0]!);
    // The bytes carry the albums, the sidecar and the edit's link, in order:
    // the four-layout unit test's claim, on the real stack.
    expect(zipManifest.equals(folderManifest), 'the two routes wrote different manifests').toBe(true);

    // And the sidecar reached the zip route: it sits in PART 2, beside the
    // year copy, while the mapping points at part 1.
    const manifest = JSON.parse(zipManifest.toString('utf8')) as {
      provider: string;
      items: Array<{
        path: string;
        folders: string[];
        kind: string;
        relatedTo?: string;
        metadata: { sidecar?: { description?: string } };
      }>;
    };
    expect(manifest.provider).toBe('google-takeout');
    expect(manifest.items).toHaveLength(3);
    const original = manifest.items.find((i) => i.path === 'IMG_0001.jpg');
    expect(original?.folders.sort()).toEqual(['Holiday', 'Photos from 2024']);
    expect(original?.metadata.sidecar?.description).toBe("The e2e fixture's one described photo");
    const edit = manifest.items.find((i) => i.path === 'IMG_0001-edited.jpg');
    expect(edit?.kind).toBe('edited');
    expect(edit?.relatedTo).toBe('IMG_0001.jpg');
  }, 30000);

  it('a second import writes nothing', async () => {
    const before = await getDomainStatusFor(ZIP_MAPPING_ID, 'file');
    await runPassNow(ZIP_MAPPING_ID);
    const after = await getDomainStatusFor(ZIP_MAPPING_ID, 'file');
    expect(after?.state).toBe('completed');
    expect(after?.itemsFailed).toBe(0);
    expect(after?.itemsSynced, 'a second import of the same download wrote something').toBe(before?.itemsSynced);
  }, 60000);
});
