// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A FILE LARGER THAN THE SERVER'S REQUEST LIMIT, against a real Nextcloud
 * (workplan 0156; the owner's report of 2026-10-03).
 *
 * The unit tests (`a-file-too-large-for-one-request`) hold the writer to a
 * fake that keeps the protocol's rules as they were measured. This holds it
 * to the server they were measured on: the integration Nextcloud
 * (nextcloud:34-apache, `testcontainers-setup.ts`) runs with Apache's
 * `LimitRequestBody` at `NEXTCLOUD_BODY_LIMIT_BYTES`, 16 MiB, so a file a few
 * MiB above it stands in for the owner's 1.3 GB video against the demo's
 * 1 GiB, at a size CI can afford.
 *
 *  1. As ONE request it is refused with 413, and the writer says so: the
 *     target's refusal, a sentence naming the limit, and a person rather than
 *     four more tries. This is the owner's failure, reproduced.
 *  2. In pieces it arrives, byte for byte, recorded with the whole file's
 *     hash and the version Nextcloud gave the assembled file.
 *  3. A re-run adopts what is there and writes nothing (hard rule 1).
 *  4. A path taken after the writer listed its folder is refused by the
 *     MOVE's `Overwrite: F` and adopted, and the file that was there is
 *     untouched (hard rule 2), exactly as `If-None-Match: *` answers a PUT.
 *  5. A rewrite with our version replaces the file; with a version that is
 *     no longer the file's, it is a conflict and nothing is replaced.
 *
 * The pieces are 8 MiB: inside the limit, and above Nextcloud v2's 5 MB
 * minimum, so the requests are the shape a v2 server would take too.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { WebDAVTargetWriter } from './webdav-target-writer.ts';
import {
  isDecisionError,
  statedFailureCategoryOf,
  type FileBody,
  type Ledger,
  type MappingId,
  type RawFileItem,
  type TenantId,
} from '@openmig/shared';

const NEXTCLOUD_WEBDAV_URL = process.env.NEXTCLOUD_WEBDAV_URL;
const NEXTCLOUD_USERNAME = process.env.NEXTCLOUD_USERNAME || 'testadmin';
const NEXTCLOUD_PASSWORD = process.env.NEXTCLOUD_PASSWORD || 'testadmin_password';
const NEXTCLOUD_BODY_LIMIT_BYTES = Number(process.env.NEXTCLOUD_BODY_LIMIT_BYTES ?? '');

if (!NEXTCLOUD_WEBDAV_URL || !Number.isFinite(NEXTCLOUD_BODY_LIMIT_BYTES) || NEXTCLOUD_BODY_LIMIT_BYTES <= 0) {
  console.warn(
    '[a-file-larger-than-the-servers-request-limit] Skipping: needs the integration Nextcloud ' +
      '(NEXTCLOUD_WEBDAV_URL) and the request limit it runs with (NEXTCLOUD_BODY_LIMIT_BYTES).',
  );
  describe.skip('a file larger than the server\'s request limit (real Nextcloud)', () => {
    it('skipped - Nextcloud not configured', () => {
      expect(true).toBe(true);
    });
  });
} else {
  const TENANT = '0156a400-e29b-41d4-a716-446655440001' as unknown as TenantId;
  const MAPPING = '0156a400-e29b-41d4-a716-446655440002' as unknown as MappingId;
  const AUTH = `Basic ${Buffer.from(`${NEXTCLOUD_USERNAME}:${NEXTCLOUD_PASSWORD}`).toString('base64')}`;
  const FILES_URL = `${NEXTCLOUD_WEBDAV_URL.replace(/\/$/, '')}/files/${NEXTCLOUD_USERNAME}`;
  const FOLDER = `openmig-chunked-${randomUUID().slice(0, 8)}`;
  const PIECE = 8 * 1024 * 1024;
  /** Over the limit by a few MiB and an odd tail, so the last piece is short. */
  const SIZE = NEXTCLOUD_BODY_LIMIT_BYTES + 4 * 1024 * 1024 + 12345;

  const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

  /** A file's bytes, different for each `seed`, so a replaced file shows. */
  const contentOf = (seed: number): Uint8Array =>
    new Uint8Array(SIZE).map((_, i) => (i * 31 + seed * 7 + (i >> 12)) % 251);

  /** Handed over the way a download is: 64 KiB at a time, opened afresh each time. */
  const bodyOf = (content: Uint8Array): FileBody => ({
    sizeBytes: content.byteLength,
    open: async () => {
      let at = 0;
      return new ReadableStream<Uint8Array>({
        pull(controller) {
          if (at >= content.byteLength) {
            controller.close();
            return;
          }
          const end = Math.min(at + 64 * 1024, content.byteLength);
          controller.enqueue(content.slice(at, end));
          at = end;
        },
      });
    },
  });

  const itemOf = (name: string, content: Uint8Array): RawFileItem => ({
    item: {
      path: `${FOLDER}/${name}`,
      isDirectory: false,
      size: content.byteLength,
      modifiedAt: '2026-10-03T09:50:21Z',
      sourceRef: name,
      mimeType: 'video/mp4',
    },
    body: bodyOf(content),
  });

  /** Just enough ledger for the writer: nothing known, every row kept. */
  const ledgerInto = (rows: Array<Record<string, unknown>>): Ledger =>
    ({
      find: async () => undefined,
      recordIfAbsent: async (row: Record<string, unknown>) => {
        rows.push(row);
      },
    }) as unknown as Ledger;

  const writerWith = (rows: Array<Record<string, unknown>>, uploadChunkBytes?: number): WebDAVTargetWriter =>
    new WebDAVTargetWriter(
      {
        url: FILES_URL,
        username: NEXTCLOUD_USERNAME,
        password: NEXTCLOUD_PASSWORD,
        ...(uploadChunkBytes !== undefined ? { uploadChunkBytes } : {}),
      },
      { ledger: ledgerInto(rows), tenantId: TENANT, mappingId: MAPPING },
    );

  const urlOf = (name: string): string => `${FILES_URL}/${FOLDER}/${encodeURIComponent(name)}`;

  /** What the server holds at `name`: its bytes' hash, length and ETag, or nothing. */
  async function held(name: string): Promise<{ sha256: string; length: number; etag: string } | undefined> {
    const response = await fetch(urlOf(name), { headers: { Authorization: AUTH } });
    if (response.status === 404) return undefined;
    expect(response.status, `GET ${name}`).toBe(200);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const etag = (response.headers.get('etag') ?? '').replace(/^W\//, '').replace(/"/g, '');
    return { sha256: sha256(bytes), length: bytes.byteLength, etag };
  }

  describe("a file larger than the server's request limit (real Nextcloud)", () => {
    beforeAll(async () => {
      const made = await fetch(`${FILES_URL}/${FOLDER}`, { method: 'MKCOL', headers: { Authorization: AUTH } });
      expect([201, 405]).toContain(made.status);
    });

    afterAll(async () => {
      await fetch(`${FILES_URL}/${FOLDER}`, { method: 'DELETE', headers: { Authorization: AUTH } });
    });

    it('as one request it is refused with 413, and the writer says what that is', async () => {
      // A piece larger than the file: the single PUT, as every large file
      // went before.
      const failure = await writerWith([], SIZE * 2)
        .upsertFile('', itemOf('one-request.mp4', contentOf(1)))
        .then(
          () => undefined,
          (err: unknown) => err as Error,
        );

      expect(failure, 'the server took a request larger than its limit').toBeInstanceOf(Error);
      expect(failure!.message).toMatch(/with status 413: the target refused this .* file \(\d+ bytes\) in one request/);
      expect(failure!.message).toContain('APACHE_BODY_LIMIT');
      expect(statedFailureCategoryOf(failure)).toBe('target_refused');
      expect(isDecisionError(failure)).toBe(true);
      expect(await held('one-request.mp4'), 'a refused request left a file behind').toBeUndefined();
    });

    it('in pieces it arrives whole, recorded with its hash and its version', async () => {
      const content = contentOf(2);
      const rows: Array<Record<string, unknown>> = [];

      const result = await writerWith(rows, PIECE).upsertFile('', itemOf('in-pieces.mp4', content));

      const landed = await held('in-pieces.mp4');
      expect(landed?.length).toBe(SIZE);
      expect(landed?.sha256, 'the assembled file is not the source').toBe(sha256(content));
      expect(result.created).toBe(true);
      expect(result.targetVersion, 'the MOVE answered with no ETag').toBe(landed?.etag);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.contentHash).toBe(sha256(content));
      expect(rows[0]!.targetVersion).toBe(landed?.etag);

      // A re-run converges: what is there is adopted, nothing is written.
      const again = await writerWith([], PIECE).upsertFile('', itemOf('in-pieces.mp4', content));
      expect(again).toMatchObject({ created: false, adopted: true });
      expect((await held('in-pieces.mp4'))?.etag, 'the re-run wrote the file again').toBe(landed?.etag);
    });

    it('a path taken after the listing is adopted, and the file there is untouched', async () => {
      const writer = writerWith([], PIECE);
      // The writer lists the folder once, here, while the path is free.
      await writer.upsertFile('', itemOf('first.mp4', contentOf(3)));
      // Then somebody else's file lands at the path.
      const theirs = contentOf(4);
      const put = await fetch(urlOf('taken.mp4'), { method: 'PUT', headers: { Authorization: AUTH }, body: theirs.slice(0, 1024) });
      expect(put.status).toBe(201);
      const before = await held('taken.mp4');

      const result = await writer.upsertFile('', itemOf('taken.mp4', theirs));

      expect(result).toMatchObject({ created: false, adopted: true });
      const after = await held('taken.mp4');
      expect(after?.sha256, 'the MOVE replaced a file it was told not to').toBe(before?.sha256);
      expect(after?.length).toBe(1024);
    });

    it('a rewrite carries our version: replaced when it is ours, a conflict when it is not', async () => {
      const rows: Array<Record<string, unknown>> = [];
      const first = await writerWith(rows, PIECE).upsertFile('', itemOf('rewritten.mp4', contentOf(5)));
      const ours = first.targetVersion;
      expect(ours).toBeDefined();

      const newer = contentOf(6);
      const rewritten = await writerWith([], PIECE).upsertFile('', itemOf('rewritten.mp4', newer), {
        overwrite: true,
        expectedTargetVersion: ours!,
      });
      expect(rewritten).toMatchObject({ updated: true });
      const now = await held('rewritten.mp4');
      expect(now?.sha256).toBe(sha256(newer));

      // The version we hold is now stale: the file is no longer the one it names.
      const stale = await writerWith([], PIECE).upsertFile('', itemOf('rewritten.mp4', contentOf(7)), {
        overwrite: true,
        expectedTargetVersion: ours!,
      });
      expect(stale).toMatchObject({ conflicted: true });
      expect((await held('rewritten.mp4'))?.sha256, 'a stale version replaced the file').toBe(sha256(newer));
    });
  });
}
