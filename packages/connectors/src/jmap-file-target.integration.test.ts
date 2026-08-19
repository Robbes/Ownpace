// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * `JmapFileTarget` against a REAL Stalwart (workplan 0031 T3).
 *
 * The unit tests run against a fake transport, so they pin the connector's
 * shape and prove nothing about the server. Everything this file asserts was
 * established by hand in `scripts/jmap-target-spike.ts` (rung 2, 2026-08-06) —
 * this is that evidence turned into something that fails when it stops being
 * true.
 *
 * **The assertion this file exists for is the checksum one.** The spike found
 * that the blobId read back off a node is NOT the one the upload returned:
 * Stalwart re-issues the handle once the blob is attached. A connector holding
 * the upload's handle does not fail at write time — the write succeeds, the
 * count is correct, and §20's content leg quietly returns
 * `checksumUnavailable` forever. No fake transport can catch that, because the
 * fake is written by the same person who got it wrong. Only the real server
 * can.
 *
 * NOTHING NEEDS CONFIGURING. `vitest.global-setup.ts` provisions a Stalwart
 * with Testcontainers and exports `STALWART_JMAP_URL`, `STALWART_JMAP_USERNAME`
 * and `STALWART_JMAP_PASSWORD` before any test file loads, so this runs — and
 * is gated in CI — under:
 *
 *     pnpm test:integration
 *
 * The skip below says WHAT WAS NOT VERIFIED rather than "skipped", because a
 * suite that goes green having checked nothing is the failure mode this repo
 * keeps finding. Under the integration project it is effectively unreachable —
 * the harness always sets the URL — so it guards the case of someone running
 * this file outside the harness, and nothing else.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { JmapFileTarget } from './jmap-file-target.ts';
import type { RawFileItem, TargetEntry } from '@openmig/shared';
import { fileNaturalKeyHash, fileContentHash } from '@openmig/shared';

const BASE = process.env.STALWART_JMAP_URL;
// The names the global setup exports, not names of this file's own invention.
const USER = process.env.STALWART_JMAP_USERNAME ?? 'target@dev.local';
/**
 * The dev fixture credential, applied only against loopback.
 *
 * `target_password` is not a secret: it is `setup-stalwart.sh`'s committed
 * fixture password, in the repo in plain text, for a throwaway container of
 * `dev.local` accounts. What hard rule 3 is about is a real credential
 * reaching a real server, so the default stops at the boundary where that
 * becomes possible.
 */
const LOOPBACK = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/.test(BASE ?? '');
const PASSWORD = process.env.STALWART_JMAP_PASSWORD ?? (LOOPBACK ? 'target_password' : undefined);

function raw(path: string, content: Uint8Array, mimeType = 'text/plain'): RawFileItem {
  return {
    item: {
      path,
      isDirectory: false,
      size: content.byteLength,
      modifiedAt: '2026-08-06T10:00:00.000Z',
      mimeType,
      sourceRef: `/dav/files/${path}`,
    },
    content,
  };
}

if (!BASE || !PASSWORD) {
  console.warn(
    '[jmap-files] NOT RUN: no STALWART_JMAP_URL. Under `pnpm test:integration` the global ' +
      'setup provides one, so seeing this means the harness did not start Stalwart.',
  );
  describe.skip('JMAP files target — NOT VERIFIED against a real server', () => {
    it('was not run, so nothing below is known to hold', () => {
      expect(true).toBe(true);
    });
  });
} else {
  describe('JmapFileTarget against a real Stalwart', () => {
    // Unique per run, so a previous run's leftovers cannot make an assertion
    // pass for the wrong reason. The SPACE in the nested segment is
    // deliberate: it is the character a percent-encoding reconstruction gets
    // wrong, and getting it wrong is silent.
    const stamp = `${process.pid}-${Math.floor(Math.random() * 1e6)}`;
    const root = `openmig-it-${stamp}`;
    const nested = `${root}/Meeting notes/report.txt`;
    const CONTENT = new TextEncoder().encode(`openmig integration fixture ${stamp}\n`);

    const target = new JmapFileTarget({ baseUrl: BASE, username: USER, password: PASSWORD });
    const written: string[] = [];
    let dirId: string;

    beforeAll(async () => {
      dirId = await target.ensureDirectory({ path: root, name: root });
      expect(dirId).toBeTruthy();
    }, 60_000);

    afterAll(async () => {
      // Leave the fixture account as we found it. A test that litters makes
      // the NEXT run's "already exists" look like a finding.
      for (const id of written) await target.removeItem(id).catch(() => undefined);
      await target.removeItem(dirId).catch(() => undefined);
    }, 60_000);

    it('writes a file and keys it by the reconstructed path', async () => {
      const result = await target.upsertFile(dirId, raw(nested, CONTENT));
      expect(result.created).toBe(true);
      written.push(result.targetId);

      // The natural key is the whole point: a FileNode carries no path, so the
      // key is rebuilt from the parent chain, and it has to be the same string
      // `WebdavFileSource.toRelativePath` would have produced for the same
      // file. Asserted through the SAME hash the ledger uses — comparing
      // strings would pass a reconstruction that agreed by accident.
      const entries: TargetEntry[] = [];
      for await (const entry of target.listEntries()) entries.push(entry);
      const mine = entries.find((e) => e.targetId === result.targetId);
      expect(mine, 'nothing in listEntries matched the id just written').toBeDefined();
      expect(mine!.naturalKey).toBe(nested);
      expect(fileNaturalKeyHash(mine!.naturalKey)).toBe(fileNaturalKeyHash(nested));

      // The node reports its own size, so §20 can report `totalBytesTarget` as
      // a measurement. Contacts have no equivalent and get counts alone; this
      // domain does not have to narrow that promise.
      expect(mine!.sizeBytes).toBe(CONTENT.byteLength);
    }, 60_000);

    it('adopts on a second pass instead of writing a duplicate', async () => {
      // A duplicate is a SUCCESSFUL write nobody notices until a drive is
      // twice its size, which is why this is the assertion that matters most
      // in the file. A FRESH writer, so the LEDGER-facing behaviour is what is
      // on trial rather than this instance's cached tree.
      const fresh = new JmapFileTarget({ baseUrl: BASE, username: USER, password: PASSWORD });
      const again = await fresh.upsertFile(dirId, raw(nested, CONTENT));
      expect(again.created).toBe(false);
      expect(again.adopted).toBe(true);
      expect(again.targetId).toBe(written[0]);
    }, 60_000);

    it('content-verifies the stored file through the blobId ON THE NODE', async () => {
      // THE SPIKE'S FINDING, GATED. Stalwart re-issues the blob handle once it
      // is attached to a node, so a connector that kept the upload's handle
      // would GET a 404 here and report `checksumUnavailable` — a check that
      // looks like it ran. This passes only if the handle came off the node.
      const hash = await target.contentHashFor({
        naturalKey: nested,
        targetId: written[0]!,
        mailboxId: dirId,
      });
      expect(hash, 'no content hash: the blob could not be downloaded').toBeDefined();
      // The same function the ledger recorded the SOURCE hash with, so this is
      // the comparison §20 actually makes.
      expect(hash).toBe(fileContentHash(CONTENT));
    }, 60_000);

    it('refuses to rewrite a file whose stored node has moved under us', async () => {
      const result = await target.upsertFile(dirId, raw(nested, CONTENT), {
        overwrite: true,
        expectedTargetVersion: 'a fingerprint this node has never had',
      });
      // Hard rule 2 on a transport with no ETag: the guard is a fingerprint of
      // the node as stored. An owner who edited our copy in the new system —
      // which shadow migration positively invites — keeps their edit.
      expect(result.conflicted).toBe(true);
    }, 60_000);

    it('rewrites when the version we hold still matches, and re-verifies', async () => {
      const changed = new TextEncoder().encode(`openmig integration fixture ${stamp} v2\n`);
      const first = await target.upsertFile(dirId, raw(nested, changed), { overwrite: true });
      expect(first.updated).toBe(true);
      expect(first.targetVersion).toBeDefined();

      const second = await target.upsertFile(dirId, raw(nested, changed), {
        overwrite: true,
        expectedTargetVersion: first.targetVersion,
      });
      // Same bytes in, so the stored node is unchanged and the fingerprint
      // must be stable. An unstable one would report a conflict on every pass
      // and silently stop update propagation working at all.
      expect(second.conflicted).toBeUndefined();
      expect(second.updated).toBe(true);

      // And the rewrite actually replaced the bytes — a `notUpdated` the
      // connector failed to read would leave the old content in place while
      // the pass counted `updated: 1`.
      const hash = await target.contentHashFor({
        naturalKey: nested,
        targetId: written[0]!,
        mailboxId: dirId,
      });
      expect(hash).toBe(fileContentHash(changed));
    }, 60_000);

    it('removes a file and reports it as deleted rather than binned', async () => {
      const doomedPath = `${root}/doomed.txt`;
      const created = await target.upsertFile(dirId, raw(doomedPath, CONTENT));
      const removal = await target.removeItem(created.targetId);
      // Nothing has established that a JMAP `FileNode/set destroy` lands in a
      // recoverable bin on Stalwart, unlike a Nextcloud WebDAV DELETE.
      expect(removal.kind).toBe('deleted');

      const entries: TargetEntry[] = [];
      for await (const entry of target.listEntries()) entries.push(entry);
      expect(entries.some((e) => e.naturalKey === doomedPath)).toBe(false);
    }, 60_000);
  });
}
