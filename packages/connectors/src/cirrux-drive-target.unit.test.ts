// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * FILES INTO CIRRUX DRIVE, AGAINST A CIRRUX AS STRICT AS ITS PAGE (workplan
 * 0160 T5).
 *
 * Every behaviour the writer promises, over `FakeCirrux`
 * (`__testing__/cirrux-fake.ts`): folders by name under Cirrux's own rule, the
 * simple upload streamed with the source's modification time, an existing
 * file adopted and a case-variant refused, a changed file replaced under
 * `base_ctag` and encrypted in Cirrux's format, an edit in Cirrux kept, an
 * approved removal moved to the trash and never deleted, the storage pool read
 * before the first upload, a `429` waited out, and a file over 100 MB said to
 * wait, before a byte is read.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { isDecisionError, statedFailureCategoryOf, type RawFileItem } from '@openmig/shared';
import { CirruxDriveApi } from './cirrux-drive-api.ts';
import { CirruxDriveTarget, cirruxNameKey, parseCirruxTargetVersion } from './cirrux-drive-target.ts';
import { CirruxTokenProvider } from './cirrux-token-provider.ts';
import { FakeCirrux, MemoryRotatingGrantStore } from './__testing__/cirrux-fake.ts';

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const bytes = (text: string) => new TextEncoder().encode(text);

function setup(p: { chunkSize?: number; simpleMax?: number; prefix?: string; waits?: number[] } = {}) {
  const cirrux = new FakeCirrux({ refreshToken: 'rt-0', chunkSize: p.chunkSize ?? 64 });
  const store = new MemoryRotatingGrantStore('rt-0');
  const sleep = async (ms: number) => {
    p.waits?.push(ms);
  };
  const tokens = new CirruxTokenProvider({ clientId: 'test-client', store, fetchImpl: cirrux.fetch, sleep });
  const api = new CirruxDriveApi({ tokens, fetchImpl: cirrux.fetch, partFetch: cirrux.partFetch, sleep });
  const target = new CirruxDriveTarget({
    api,
    simpleUploadMaxBytes: p.simpleMax ?? 1000,
    ...(p.prefix ? { targetFolderPrefix: p.prefix } : {}),
  });
  return { cirrux, target, store, api };
}

function raw(path: string, content: Uint8Array, over: Partial<RawFileItem['item']> = {}): RawFileItem {
  return {
    item: {
      path,
      name: path.split('/').pop()!,
      isDirectory: false,
      size: content.byteLength,
      modifiedAt: '2026-06-19T11:12:58+02:00',
      sourceRef: path,
      mimeType: 'text/plain',
      ...over,
    },
    content,
  };
}

/** The same file, handed over as a stream in small pieces, as a large file is. */
function streamed(path: string, content: Uint8Array): RawFileItem {
  return {
    item: { path, name: path.split('/').pop()!, isDirectory: false, size: content.byteLength, modifiedAt: '2026-06-19T09:00:00Z', sourceRef: path },
    body: {
      sizeBytes: content.byteLength,
      open: async () => {
        let at = 0;
        return new ReadableStream<Uint8Array>({
          pull(c) {
            if (at >= content.byteLength) return c.close();
            c.enqueue(content.slice(at, at + 13));
            at += 13;
          },
        });
      },
    },
  };
}

const posts = (cirrux: FakeCirrux, path: string) => cirrux.requests.filter((r) => r.method === 'POST' && r.path === path);

describe('folders, by name, under Cirrux’s own rule', () => {
  it('creates a nested folder root first, and asks for each segment once a pass', async () => {
    const { cirrux, target } = setup();
    const id = await target.ensureDirectory({ path: 'Documents/Taxes/2026' });
    await target.ensureDirectory({ path: 'Documents/Taxes' });
    await target.ensureDirectory({ path: 'Documents/Taxes/2026' });
    expect(posts(cirrux, '/drive/folders').map((r) => (r.body as { name: string }).name)).toEqual(['Documents', 'Taxes', '2026']);
    expect(cirrux.folders.get(id)?.name).toBe('2026');
  });

  it('finds the person’s own folder whatever its capitals and Unicode form, and makes no second one', async () => {
    const { cirrux, target } = setup();
    const photos = cirrux.addFolder('photos');
    const cafe = cirrux.addFolder('Café Notes'); // decomposed é
    expect(await target.ensureDirectory({ path: 'Photos' })).toBe(photos.uuid);
    expect(await target.ensureDirectory({ path: 'CAFÉ notes' })).toBe(cafe.uuid); // composed É
    expect(posts(cirrux, '/drive/folders')).toHaveLength(0);
  });

  it('a folder made between the listing and the create is found again, not made twice', async () => {
    const { cirrux, target } = setup();
    await target.ensureDirectory({ path: 'Shared' });
    // The listing of Shared is cached by the next call; the person makes the
    // folder just before ours is created.
    const shared = [...cirrux.folders.values()].find((f) => f.name === 'Shared')!;
    await target.findFileByNaturalKey('', 'Shared/x.txt');
    const theirs = cirrux.addFolder('Plans', shared.uuid);
    expect(await target.ensureDirectory({ path: 'Shared/plans' })).toBe(theirs.uuid);
  });

  it('refuses a name Cirrux would refuse, before asking', async () => {
    const { cirrux, target } = setup();
    await expect(target.ensureDirectory({ path: 'ok/..' })).rejects.toThrow(/does not take as a name/);
    await expect(target.ensureDirectory({ path: 'tab\there' })).rejects.toThrow(/control character/);
    await expect(target.ensureDirectory({ path: 'x'.repeat(256) })).rejects.toThrow(/255/);
    expect(posts(cirrux, '/drive/folders').map((r) => (r.body as { name: string }).name)).toEqual(['ok']);
  });

  it('keys names the way Cirrux compares them: trimmed, composed, without capitals', () => {
    expect(cirruxNameKey('  Café.PDF ')).toBe(cirruxNameKey('café.pdf'));
  });
});

describe('a new file: the simple upload', () => {
  it('uploads into its folder with the source’s modification time, and records its version', async () => {
    const { cirrux, target } = setup();
    await target.ensureDirectory({ path: 'Receipts' });
    const result = await target.upsertFile('', raw('Receipts/april.txt', bytes('april receipts')));
    const file = cirrux.fileAt('Receipts/april.txt')!;
    expect(new TextDecoder().decode(file.bytes)).toBe('april receipts');
    expect(file.content_modified_at).toBe('2026-06-19T09:12:58.000Z');
    expect(file.content_type).toBe('text/plain');
    expect(result).toEqual({ targetId: file.uuid, created: true, targetVersion: `cirrux:0:${file.uuid}`, contentHash: sha(bytes('april receipts')) });
  });

  it('streams a file it was handed as a stream, and hashes what it sent', async () => {
    const { cirrux, target } = setup();
    const content = Uint8Array.from({ length: 401 }, (_, i) => (i * 7) % 256);
    const result = await target.upsertFile('', streamed('big.bin', content));
    expect(Buffer.from(cirrux.fileAt('big.bin')!.bytes).equals(Buffer.from(content))).toBe(true);
    expect(result.contentHash).toBe(sha(content));
  });

  it('adopts a file of the same name, and writes nothing', async () => {
    const { cirrux, target } = setup();
    const theirs = cirrux.addFile('notes.txt', bytes('theirs'));
    const result = await target.upsertFile('', raw('notes.txt', bytes('ours')));
    expect(result).toMatchObject({ targetId: theirs.uuid, created: false, adopted: true });
    expect(new TextDecoder().decode(cirrux.files.get(theirs.uuid)!.bytes)).toBe('theirs');
    expect(posts(cirrux, '/drive/files')).toHaveLength(0);
  });

  it('does not take a file still being uploaded in Cirrux as the copy, and writes nothing', async () => {
    const { cirrux, target } = setup();
    const uploading = cirrux.addFile('report.pdf', bytes('half'));
    uploading.upload_status = 'uploading';
    await expect(target.upsertFile('', raw('report.pdf', bytes('the whole report')))).rejects.toThrow(/still being uploaded/);
    expect(posts(cirrux, '/drive/files')).toHaveLength(0);
  });

  it('refuses a file whose name Cirrux takes for another’s: capitals do not count there', async () => {
    const { cirrux, target } = setup();
    const theirs = cirrux.addFile('report.pdf', bytes('theirs'));
    const failure = await target.upsertFile('', raw('Report.pdf', bytes('ours'))).catch((e: unknown) => e);
    expect(String(failure)).toMatch(/already holds “report\.pdf”/);
    expect(isDecisionError(failure)).toBe(true);
    expect(statedFailureCategoryOf(failure)).toBe('target_refused');
    expect(new TextDecoder().decode(cirrux.files.get(theirs.uuid)!.bytes)).toBe('theirs');
  });

  it('two source files that differ only in capitals: the first goes, the second is refused', async () => {
    const { target } = setup();
    await target.upsertFile('', raw('Plan.txt', bytes('one')));
    await expect(target.upsertFile('', raw('plan.txt', bytes('two')))).rejects.toThrow(/treats the two names as one/);
  });

  it('applies the mapping’s folder to folders and files alike', async () => {
    const { cirrux, target } = setup({ prefix: 'From Google' });
    await target.ensureDirectory({ path: 'Docs' });
    await target.upsertFile('', raw('Docs/a.txt', bytes('a')));
    expect(cirrux.fileAt('From Google/Docs/a.txt')).toBeDefined();
    expect(target.ownsTargetFolderPrefix).toBe(true);
  });

  it('waits out a 429 for its Retry-After, then uploads', async () => {
    const waits: number[] = [];
    const { cirrux, target } = setup({ waits });
    await target.ensureDirectory({ path: '' });
    cirrux.rateLimitNext = 2;
    cirrux.retryAfterSeconds = '3';
    await target.upsertFile('', raw('slow.txt', bytes('slow')));
    expect(waits).toEqual([3000, 3000]);
    expect(cirrux.fileAt('slow.txt')).toBeDefined();
  });
});

describe('what does not go, and says why, before a byte is read', () => {
  it('a file over 100 MB waits for the chunked step', async () => {
    const { cirrux, target } = setup({ simpleMax: 100 });
    const item = raw('movie.mp4', new Uint8Array(101)).item;
    const refused = target.refuseBeforeRead(item);
    expect(String(refused)).toMatch(/waits for it/);
    expect(isDecisionError(refused)).toBe(true);
    expect(statedFailureCategoryOf(refused)).toBe('too_large');
    await expect(target.upsertFile('', raw('movie.mp4', new Uint8Array(101)))).rejects.toThrow(/waits for it/);
    expect(posts(cirrux, '/drive/files')).toHaveLength(0);
  });

  it('a file over 2 GiB is not moved, with the reason', () => {
    const { target } = setup();
    const refused = target.refuseBeforeRead({ ...raw('huge.iso', new Uint8Array(1)).item, size: 2 * 1024 ** 3 + 1 });
    expect(String(refused)).toMatch(/takes files up to 2 GB each/);
    expect(statedFailureCategoryOf(refused)).toBe('too_large');
    expect(target.refuseBeforeRead({ ...raw('ok.iso', new Uint8Array(1)).item, size: 2 })).toBeUndefined();
  });

  it('a file that would not fit in the workspace’s pool is refused before it is sent', async () => {
    const { cirrux, target } = setup();
    cirrux.poolBytes = 1100;
    cirrux.usedBytes = 1000;
    await target.upsertFile('', raw('small.txt', new Uint8Array(60)));
    // This pass's own upload counts against what was read: 40 bytes are left.
    const failure = await target.upsertFile('', raw('next.txt', new Uint8Array(60))).catch((e: unknown) => e);
    expect(String(failure)).toMatch(/has no room for it/);
    expect(isDecisionError(failure)).toBe(true);
    expect(cirrux.requests.filter((r) => r.path === '/workspace/storage')).toHaveLength(1);
    expect(cirrux.fileAt('next.txt')).toBeUndefined();
  });

  it('Cirrux’s own storage_limit_exceeded says the same', async () => {
    const { cirrux, target } = setup();
    await target.upsertFile('', raw('first.txt', bytes('x')));
    cirrux.usedBytes = cirrux.poolBytes; // filled by something else since
    await expect(target.upsertFile('', raw('second.txt', bytes('y')))).rejects.toThrow(/has no room for it/);
  });
});

describe('a changed file: replaced under base_ctag, encrypted in Cirrux’s format', () => {
  async function copied(p: Parameters<typeof setup>[0] = {}) {
    const s = setup(p);
    const first = await s.target.upsertFile('', raw('plan.txt', bytes('version one')));
    return { ...s, first };
  }

  it('replaces the content, keeps the uuid and the modification time, and records the new version', async () => {
    const { cirrux, target, first } = await copied({ chunkSize: 16 });
    const next = Uint8Array.from({ length: 70 }, (_, i) => 65 + (i % 26)); // 5 chunks of 16
    const result = await target.upsertFile('', raw('plan.txt', next, { modifiedAt: '2026-07-01T08:00:00Z' }), {
      overwrite: true,
      expectedTargetVersion: first.targetVersion!,
    });
    const file = cirrux.files.get(first.targetId)!;
    expect(Buffer.from(file.bytes).equals(Buffer.from(next))).toBe(true);
    expect(file.ctag).toBe(1);
    expect(file.content_modified_at).toBe('2026-07-01T08:00:00.000Z');
    expect(result).toEqual({ targetId: first.targetId, created: false, updated: true, targetVersion: `cirrux:1:${first.targetId}`, contentHash: sha(next) });
    const init = posts(cirrux, `/drive/files/${first.targetId}/replace`)[0]!;
    expect(init.body).toMatchObject({ plaintext_size_bytes: 70, base_ctag: 0 });
    expect(cirrux.partPuts).toHaveLength(5);
  });

  it('leaves a copy somebody edited in Cirrux alone: version_conflict, nothing staged, theirs from now on', async () => {
    const { cirrux, target, first } = await copied();
    cirrux.editInCirrux(first.targetId, bytes('their edit'));
    const result = await target.upsertFile('', raw('plan.txt', bytes('version two')), {
      overwrite: true,
      expectedTargetVersion: first.targetVersion!,
    });
    expect(result).toEqual({ targetId: first.targetId, created: false, conflicted: true });
    expect(new TextDecoder().decode(cirrux.files.get(first.targetId)!.bytes)).toBe('their edit');
    expect(cirrux.partPuts).toHaveLength(0);
  });

  it('leaves a copy somebody put in the trash in the trash', async () => {
    const { cirrux, target, first } = await copied();
    cirrux.files.get(first.targetId)!.trashed = true;
    const result = await target.upsertFile('', raw('plan.txt', bytes('version two')), {
      overwrite: true,
      expectedTargetVersion: first.targetVersion!,
    });
    expect(result.conflicted).toBe(true);
    expect(posts(cirrux, `/drive/files/${first.targetId}/replace`)).toHaveLength(0);
  });

  it('an ADOPTED copy, never written by us, is replaced under the version just read, never without one', async () => {
    const { cirrux, target } = setup();
    const theirs = cirrux.addFile('plan.txt', bytes('version one'));
    cirrux.editInCirrux(theirs.uuid, bytes('version one, edited'));
    const adopted = await target.upsertFile('', raw('plan.txt', bytes('version one')));
    expect(adopted).toMatchObject({ targetId: theirs.uuid, adopted: true });
    expect(adopted.targetVersion).toBeUndefined();
    await target.upsertFile('', raw('plan.txt', bytes('version two')), { overwrite: true });
    const init = posts(cirrux, `/drive/files/${theirs.uuid}/replace`)[0]!;
    expect(init.body).toMatchObject({ base_ctag: 1 });
  });

  it('finds the file by its uuid when somebody renamed it in Cirrux', async () => {
    const { cirrux, target, first } = await copied();
    cirrux.files.get(first.targetId)!.name = 'plan (renamed).txt';
    await target.upsertFile('', raw('plan.txt', bytes('version two')), { overwrite: true, expectedTargetVersion: first.targetVersion! });
    expect(new TextDecoder().decode(cirrux.files.get(first.targetId)!.bytes)).toBe('version two');
  });

  it('a changed file over 100 MB waits for the chunked step too', async () => {
    const { cirrux, target, first } = await copied({ simpleMax: 50 });
    await expect(
      target.upsertFile('', raw('plan.txt', new Uint8Array(51)), { overwrite: true, expectedTargetVersion: first.targetVersion! }),
    ).rejects.toThrow(/waits for it/);
    expect(posts(cirrux, `/drive/files/${first.targetId}/replace`)).toHaveLength(0);
  });

  it('a part Cirrux’s storage refuses aborts the staged replace, and the file stays as it was', async () => {
    const { cirrux, target, first, api } = await copied({ chunkSize: 16 });
    const failing = new CirruxDriveTarget({
      api: Object.assign(Object.create(Object.getPrototypeOf(api) as object) as CirruxDriveApi, api, {
        putPart: async () => {
          throw new Error('storage said no');
        },
      }),
      simpleUploadMaxBytes: 1000,
    });
    await expect(
      failing.upsertFile('', raw('plan.txt', new Uint8Array(40)), { overwrite: true, expectedTargetVersion: first.targetVersion! }),
    ).rejects.toThrow(/storage said no/);
    expect(posts(cirrux, `/drive/files/${first.targetId}/replace/abort`)).toHaveLength(1);
    expect(new TextDecoder().decode(cirrux.files.get(first.targetId)!.bytes)).toBe('version one');
    // And nothing is left staged in front of the file.
    await target.upsertFile('', raw('plan.txt', bytes('version two')), { overwrite: true, expectedTargetVersion: first.targetVersion! });
    expect(new TextDecoder().decode(cirrux.files.get(first.targetId)!.bytes)).toBe('version two');
  });

  it('bytes Cirrux cannot decrypt are refused by Cirrux and said in our words, and the file stays', async () => {
    const { cirrux, first, api } = await copied({ chunkSize: 16 });
    const tampered = new CirruxDriveTarget({
      api: Object.assign(Object.create(Object.getPrototypeOf(api) as object) as CirruxDriveApi, api, {
        putPart: (url: string, part: Uint8Array, what: string) => {
          const flipped = Uint8Array.from(part);
          flipped[flipped.byteLength - 1]! ^= 0xff;
          return api.putPart(url, flipped, what);
        },
      }),
      simpleUploadMaxBytes: 1000,
    });
    await expect(
      tampered.upsertFile('', raw('plan.txt', new Uint8Array(10)), { overwrite: true, expectedTargetVersion: first.targetVersion! }),
    ).rejects.toThrow(/could not decrypt the first part/);
    expect(new TextDecoder().decode(cirrux.files.get(first.targetId)!.bytes)).toBe('version one');
  });

  it('records a version the next pass can read back', async () => {
    const { first } = await copied();
    expect(parseCirruxTargetVersion(first.targetVersion)).toEqual({ ctag: 0, uuid: first.targetId });
    expect(parseCirruxTargetVersion('"an-etag"')).toBeUndefined();
  });
});

describe('an approved removal: the trash, and never a permanent delete', () => {
  it('moves a copy we wrote to the trash, restorable, and reports it binned', async () => {
    const { cirrux, target } = setup();
    const first = await target.upsertFile('', raw('old.txt', bytes('old')));
    expect(await target.removeItem(first.targetId, { expectedTargetVersion: first.targetVersion! })).toEqual({ kind: 'binned' });
    expect(cirrux.files.get(first.targetId)!.trashed).toBe(true);
    expect(cirrux.requests.some((r) => r.method === 'DELETE')).toBe(false);
  });

  it('leaves a copy somebody edited since', async () => {
    const { cirrux, target } = setup();
    const first = await target.upsertFile('', raw('old.txt', bytes('old')));
    cirrux.editInCirrux(first.targetId, bytes('edited'));
    expect(await target.removeItem(first.targetId, { expectedTargetVersion: first.targetVersion! })).toEqual({ conflicted: true });
    expect(cirrux.files.get(first.targetId)!.trashed).toBe(false);
  });

  it('removes nothing without a recorded version, and does not ask Cirrux', async () => {
    const { cirrux, target } = setup();
    const theirs = cirrux.addFile('theirs.txt', bytes('x'));
    expect(await target.removeItem(theirs.uuid)).toEqual({ unversioned: true });
    expect(cirrux.requests).toHaveLength(0);
  });

  it('a copy already in the trash is binned, and one gone for good is deleted', async () => {
    const { cirrux, target } = setup();
    const first = await target.upsertFile('', raw('a.txt', bytes('a')));
    cirrux.files.get(first.targetId)!.trashed = true;
    expect(await target.removeItem(first.targetId, { expectedTargetVersion: first.targetVersion! })).toEqual({ kind: 'binned' });
    cirrux.files.delete(first.targetId);
    expect(await target.removeItem(first.targetId, { expectedTargetVersion: first.targetVersion! })).toEqual({ kind: 'deleted' });
  });

  it('has no code that sends a permanent delete', () => {
    for (const file of ['cirrux-drive-api.ts', 'cirrux-drive-target.ts']) {
      const code = readFileSync(join(import.meta.dirname, file), 'utf8')
        .split('\n')
        .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
        .join('\n');
      expect(code, `${file} sends a DELETE`).not.toMatch(/['"]DELETE['"]/);
    }
  });
});

describe('reading back, for verification', () => {
  it('lists every live file under the mapping’s folder, keyed as the ledger keys them', async () => {
    const { cirrux, target } = setup({ prefix: 'Moved' });
    await target.ensureDirectory({ path: 'a/b' });
    await target.upsertFile('', raw('a/b/one.txt', bytes('1')));
    await target.upsertFile('', raw('two.txt', bytes('22')));
    const gone = await target.upsertFile('', raw('gone.txt', bytes('3')));
    cirrux.files.get(gone.targetId)!.trashed = true;
    const entries = [];
    for await (const e of target.listEntries()) entries.push(e);
    expect(entries.map((e) => [e.naturalKey, e.sizeBytes]).sort()).toEqual([
      ['a/b/one.txt', 1],
      ['two.txt', 2],
    ]);
  });

  it('hashes a sampled file as Cirrux stores it, and says nothing for one it does not download', async () => {
    const { target } = setup();
    const r = await target.upsertFile('', raw('x.txt', bytes('xyz')));
    expect(await target.contentHashFor({ naturalKey: 'x.txt', targetId: r.targetId, mailboxId: '', sizeBytes: 3 })).toBe(sha(bytes('xyz')));
    expect(await target.contentHashFor({ naturalKey: 'x.txt', targetId: r.targetId, mailboxId: '', sizeBytes: 3 }, 'container-parts')).toBeUndefined();
  });

  it('answers whether a copy is there: live yes, trashed or gone no', async () => {
    const { cirrux, target } = setup();
    const r = await target.upsertFile('', raw('x.txt', bytes('x')));
    expect(await target.hasItem(r.targetId)).toBe(true);
    cirrux.files.get(r.targetId)!.trashed = true;
    expect(await target.hasItem(r.targetId)).toBe(false);
    cirrux.files.delete(r.targetId);
    expect(await target.hasItem(r.targetId)).toBe(false);
  });
});
