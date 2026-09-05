// Copyright 2026 The Ownpace authors (Apache-2.0)
//
// THE ARCHIVE IMPORT GATE (workplan 0116 T10): a Takeout, imported end to end.
//
// The one source this suite can drive COMPLETELY. Every other source here
// needs a real account somewhere and a consent nobody in CI can press; an
// export archive is a folder of files, so a five-file Takeout checked into
// this repository (test/e2e/fixtures/takeout) is a complete and honest
// stand-in — the same bytes a person's export contains, minus the person.
// deploy/selfhost/compose.dev.yml mounts it READ-ONLY into the appliance,
// and e2e.yml bakes a second mapping (selfhost-archive-import.mapping.json)
// beside the main one, which loads PAUSED like every mapping (0013 T7).
//
// Runs LAST, on purpose: this gate green-lights that mapping and writes into
// the e2e-target account, and the verification and finish gates above must
// never have seen those files. What it proves, against the real Nextcloud
// rather than a memory target:
//
//   - placement (T5): a photo filed in an album and under its year lands
//     under the album and NOT under the year as well; a photo in no album
//     lands under its year; an edited version is its own file;
//   - the manifest (T5): one file at the root, carrying the sidecar Google
//     wrote, every folder, and the link from the edit to its original;
//   - idempotency (T6): a second pass writes nothing.
//
// And it is what found the appliance's file arm had no `archive` case at
// all — the managed seam had one, the appliance was handing a folder to the
// DAV resolver. A gate that exercises the edition where the local path IS
// the route (0116 §3) is the one that could say so.
//
// PREREQUISITES: the same running stack as the other selfhost gates; the
// fixture mounted at /data/fixtures/takeout inside the appliance; the archive
// mapping in its config dir.

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

const ARCHIVE_MAPPING_ID = (
  JSON.parse(readFileSync('test/e2e/fixtures/selfhost-archive-import.mapping.json', 'utf8')) as {
    mappingId: string;
  }
).mappingId;

const FIXTURE = 'test/e2e/fixtures/takeout/Takeout/Google Photos';
const fixtureBytes = (relative: string): Buffer => readFileSync(`${FIXTURE}/${relative}`);

/** A path in the target account, each segment encoded the way a DAV href is. */
const target = (relative: string): string =>
  `${NEXTCLOUD_URL}/remote.php/dav/files/${DAV_TARGET_USER}/` +
  relative.split('/').map(encodeURIComponent).join('/');
const auth = () => davAuthHeader(DAV_TARGET_USER, TARGET_DAV_PASSWORD);

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

describe('archive import — a Takeout into the real Nextcloud (0116 T10)', () => {
  it(
    'green-lights the archive mapping and imports it: three placements and the manifest',
    async () => {
      await startMapping(ARCHIVE_MAPPING_ID);
      const deadline = Date.now() + PASS_WAIT_MS;
      let status = await getDomainStatusFor(ARCHIVE_MAPPING_ID, 'file');
      while (Date.now() < deadline && !(status?.state === 'completed' && status.itemsSynced > 0)) {
        await runPassNow(ARCHIVE_MAPPING_ID);
        status = await getDomainStatusFor(ARCHIVE_MAPPING_ID, 'file');
        if (status?.state === 'completed' && status.itemsSynced > 0) break;
        await sleep(1000);
      }
      expect(status, 'the archive mapping never reported a file domain').not.toBeNull();
      expect(status!.state).toBe('completed');
      expect(status!.itemsFailed).toBe(0);
      // IMG_0001 under its album, the edit and IMG_0002 under their year, and
      // the manifest at the root. Not five: the album photo is not written
      // under its year as well.
      expect(status!.itemsSynced).toBe(4);
    },
    PASS_WAIT_MS + 60000,
  );

  it('placed the photos where the person filed them, verified against the real Nextcloud', async () => {
    const kent = await fetch(target('Holiday/IMG_0001.jpg'), { headers: auth() });
    expect(kent.status, 'the album copy is missing').toBe(200);
    expect(Buffer.from(await kent.arrayBuffer())).toEqual(fixtureBytes('Holiday/IMG_0001.jpg'));

    const year = await namesUnder('Photos from 2024');
    expect(year.sort()).toEqual(['IMG_0001-edited.jpg', 'IMG_0002.jpg']);
    // The year folder is Google's filing, not the person's: a photo that has
    // an album is not written under its year as well.
    const duplicate = await fetch(target('Photos from 2024/IMG_0001.jpg'), { headers: auth() });
    expect(duplicate.status, 'the album photo was written under its year too').toBe(404);

    const edit = await fetch(target('Photos from 2024/IMG_0001-edited.jpg'), { headers: auth() });
    expect(Buffer.from(await edit.arrayBuffer())).toEqual(fixtureBytes('Photos from 2024/IMG_0001-edited.jpg'));
  }, 30000);

  it('wrote one manifest at the root carrying everything the export knew', async () => {
    const root = await namesUnder('');
    const manifests = root.filter((n) => n.startsWith('export-archive-manifest-') && n.endsWith('.json'));
    expect(manifests, `no manifest among ${JSON.stringify(root)}`).toHaveLength(1);
    const response = await fetch(target(manifests[0]!), { headers: auth() });
    expect(response.status).toBe(200);
    const manifest = JSON.parse(await response.text()) as {
      provider: string;
      items: Array<{
        path: string;
        placedIn: string[];
        kind: string;
        relatedTo?: string;
        folders: string[];
        metadata: { sidecar?: { description?: string } };
      }>;
    };
    expect(manifest.provider).toBe('google-takeout');
    expect(manifest.items).toHaveLength(3);
    const original = manifest.items.find((i) => i.path === 'IMG_0001.jpg');
    expect(original?.placedIn).toEqual(['Holiday']);
    expect(original?.folders.sort()).toEqual(['Holiday', 'Photos from 2024']);
    // Verbatim (0116 T2, rule 3): what Google knew and the file does not.
    expect(original?.metadata.sidecar?.description).toBe("The e2e fixture's one described photo");
    const edit = manifest.items.find((i) => i.path === 'IMG_0001-edited.jpg');
    expect(edit?.kind).toBe('edited');
    expect(edit?.relatedTo).toBe('IMG_0001.jpg');
  }, 30000);

  it('a second import writes nothing', async () => {
    const before = await getDomainStatusFor(ARCHIVE_MAPPING_ID, 'file');
    await runPassNow(ARCHIVE_MAPPING_ID);
    const after = await getDomainStatusFor(ARCHIVE_MAPPING_ID, 'file');
    expect(after?.state).toBe('completed');
    expect(after?.itemsFailed).toBe(0);
    expect(after?.itemsSynced, 'a second import of the same archive wrote something').toBe(before?.itemsSynced);
  }, 60000);
});
