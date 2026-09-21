// Copyright 2026 The Ownpace authors (Apache-2.0)
//
// THE ARCHIVE THAT IS ALREADY IN THE TARGET (workplan 0116 T4, the relay's
// first slice, on the real stack).
//
// The owner picked RELAY for a managed customer's archive on 2026-09-20: the
// parts travel through Ownpace straight into the customer's own file target,
// and the pass reads them THERE. The reading half landed as a store seam over
// PROPFIND, GET and `Range`, and it was proved against a fake Nextcloud in
// memory. This is the same claim against a real one, over real HTTP:
//
//   - the parts are in the TARGET, not on any disk the appliance can see.
//     Nothing is mounted for this mapping; the gate PUTs them into Nextcloud
//     itself, exactly as the relay will;
//   - `where: "target"` is what makes the path relative to this migration's
//     own file target, so the whole read is `PROPFIND` for what is there and
//     `GET` with `Range` for the bytes — a managed run container has a network
//     and no shared volume (measured 2026-09-05), and this is the route that
//     fact leaves open;
//   - part 2 is found BESIDE part 1 in the target, by the same numbering rule
//     that finds it on a disk. The mapping names only part 1;
//   - and the parts are still byte-identical afterwards. Hard rule 2 says we
//     never write the source, and once the relay has put a part in the
//     customer's storage that part IS the source.
//
// Then the same comparison the zip-route gate makes: the four placements and
// the manifest, byte for byte against what the extracted-folder route wrote at
// the account root. A `.zip` in the target, a `.zip` on a disk and the folder
// it extracts to are one archive, and the manifest's name — the fingerprint
// over every item's content hash — is where that is provable in one value.
//
// What it proves that no unit test can: Nextcloud really answers a `Range`
// request with `206` and the asked bytes (the store refuses a `200` by
// sentence rather than downloading a gigabyte to read a kilobyte, so a server
// that ignored `Range` would fail here loudly), the read-ahead windows work
// against a real server, and the appliance's file arm carries `where` from a
// mapping file all the way into the store.
//
// PREREQUISITES: the same running stack as the other selfhost gates, and the
// in-target mapping in the config dir with its target URL ending in
// `from-target/`. No fixture mount: this gate needs none, which is the point.

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

const MAPPING_ID = (
  JSON.parse(readFileSync('test/e2e/fixtures/selfhost-archive-in-target-import.mapping.json', 'utf8')) as {
    mappingId: string;
  }
).mappingId;

/** The subfolder e2e.yml appends to this mapping's target URL — what the import writes into. */
const SUBFOLDER = 'from-target';

/**
 * Where the parts sit, INSIDE the migration's own target.
 *
 * A child of the folder the import writes to, because that is where the relay
 * leaves them: 0116 §3 says the parts stay where the relay put them until the
 * person deletes them, and `where: "target"` resolves a path against the file
 * target the migration writes to. So the import's own output folder has the
 * export sitting in a subfolder of it — untidy on paper, and exactly what a
 * customer's storage looks like the moment before the first pass runs.
 */
const PARTS_DIR = `${SUBFOLDER}/exports`;
const PARTS = ['takeout-20240506T070810Z-001.zip', 'takeout-20240506T070810Z-002.zip'];

const ZIP_FIXTURE = 'test/e2e/fixtures/takeout-zip';
const FIXTURE = 'test/e2e/fixtures/takeout/Takeout/Google Photos';
const fixtureBytes = (relative: string): Buffer => readFileSync(`${FIXTURE}/${relative}`);
const partBytes = (name: string): Buffer => readFileSync(`${ZIP_FIXTURE}/${name}`);

/** A path in the target account, each segment encoded the way a DAV href is. */
const target = (relative: string): string =>
  `${NEXTCLOUD_URL}/remote.php/dav/files/${DAV_TARGET_USER}/` +
  relative.split('/').filter(Boolean).map(encodeURIComponent).join('/');
const auth = () => davAuthHeader(DAV_TARGET_USER, TARGET_DAV_PASSWORD);

const isManifest = (name: string): boolean =>
  name.startsWith('export-archive-manifest-') && name.endsWith('.json');

/** MKCOL, tolerating "already there" so a re-run against a kept stack works. */
async function makeCollection(relative: string): Promise<void> {
  const response = await fetch(target(relative) + '/', { method: 'MKCOL', headers: auth() });
  // 201 created it; 405 is "already there" (RFC 4918 §9.3.1).
  expect([201, 405], `MKCOL ${relative} -> ${response.status}`).toContain(response.status);
}

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

describe('archive import from inside the target — the relay’s route, read by byte range (0116 T4)', () => {
  it('puts the two parts in the customer’s own storage, the way the relay will', async () => {
    await makeCollection(SUBFOLDER);
    await makeCollection(PARTS_DIR);
    for (const name of PARTS) {
      const response = await fetch(target(`${PARTS_DIR}/${name}`), {
        method: 'PUT',
        headers: { ...auth(), 'Content-Type': 'application/zip' },
        body: new Uint8Array(partBytes(name)),
      });
      // 201 created; 204 replaced, which a re-run against a kept stack answers.
      expect([201, 204], `PUT ${name} -> ${response.status}`).toContain(response.status);
    }
    // And they really are there, byte for byte, before anything reads them.
    for (const name of PARTS) {
      expect(await bytesAt(`${PARTS_DIR}/${name}`)).toEqual(partBytes(name));
    }
  }, 60000);

  it(
    'green-lights the mapping and imports what is in the target: four placements and the manifest',
    async () => {
      await startMapping(MAPPING_ID);
      const deadline = Date.now() + PASS_WAIT_MS;
      let status = await getDomainStatusFor(MAPPING_ID, 'file');
      while (Date.now() < deadline && !(status?.state === 'completed' && status.itemsSynced > 0)) {
        await runPassNow(MAPPING_ID);
        status = await getDomainStatusFor(MAPPING_ID, 'file');
        if (status?.state === 'completed' && status.itemsSynced > 0) break;
        await sleep(1000);
      }
      expect(status, 'the in-target mapping never reported a file domain').not.toBeNull();
      expect(status!.state).toBe('completed');
      expect(status!.itemsFailed).toBe(0);
      // Four, for the same reasons the zip route's four are four: the album
      // photo is not written under its year as well, and part 2 was read —
      // over the wire this time — or the second photo and the edit would be
      // missing. A read that fell back to a disk would find NOTHING at all,
      // because nothing is mounted for this mapping.
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
    const fromTarget = (await namesUnder(SUBFOLDER)).filter(isManifest);
    const fromFolder = (await namesUnder('')).filter(isManifest);
    expect(fromTarget, 'the in-target route wrote no manifest, or more than one').toHaveLength(1);
    expect(fromFolder, 'the folder route left no manifest at the root, or more than one').toHaveLength(1);
    // The name carries the fingerprint over every item's content hash. The
    // same name means an archive read by `Range` over HTTP hashed every item
    // to the value the same archive hashed to when it was a folder on a disk.
    expect(fromTarget[0]).toBe(fromFolder[0]);
    const inTargetManifest = await bytesAt(`${SUBFOLDER}/${fromTarget[0]!}`);
    const folderManifest = await bytesAt(fromFolder[0]!);
    expect(
      inTargetManifest.equals(folderManifest),
      'reading the archive over the wire wrote a different manifest from reading it on a disk',
    ).toBe(true);

    // And the sidecar reached this route too: it sits in PART 2, which the
    // reader had to find beside part 1 in the TARGET — by PROPFIND, not by a
    // directory listing.
    const manifest = JSON.parse(inTargetManifest.toString('utf8')) as {
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

  it('left the parts exactly as it found them — we never write the source', async () => {
    // Hard rule 2. The moment the relay lands a part in the customer's own
    // storage, that part IS the source, and the import runs in a folder that
    // CONTAINS it — so "we only ever read it" is a claim with something real
    // to prove here rather than a property of being on another machine.
    const beside = await namesUnder(PARTS_DIR);
    expect(beside.sort(), 'the import added to or removed from the export folder').toEqual([...PARTS].sort());
    for (const name of PARTS) {
      expect(await bytesAt(`${PARTS_DIR}/${name}`), `${name} was modified`).toEqual(partBytes(name));
    }
  }, 30000);

  it('a second import writes nothing', async () => {
    const before = await getDomainStatusFor(MAPPING_ID, 'file');
    await runPassNow(MAPPING_ID);
    const after = await getDomainStatusFor(MAPPING_ID, 'file');
    expect(after?.state).toBe('completed');
    expect(after?.itemsFailed).toBe(0);
    expect(after?.itemsSynced, 'a second import of the same archive wrote something').toBe(before?.itemsSynced);
  }, 60000);
});
