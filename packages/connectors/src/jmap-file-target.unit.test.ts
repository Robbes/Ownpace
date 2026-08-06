// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Files over JMAP (workplan 0031 T3).
 *
 * These tests are aimed at the things that fail SILENTLY, because that is what
 * this connector's design is arranged around. A JMAP write returns success
 * whether or not the node ended up where the ledger will look for it, so "the
 * route returns 201" pins nothing worth pinning.
 *
 * Four properties get the attention:
 *
 *   1. **The natural key is the reconstructed PATH.** A FileNode has no path —
 *      only a name and a parentId — and `fileNaturalKeyHash` hashes a path. If
 *      the reconstruction and `WebdavFileSource.toRelativePath` disagree by one
 *      byte, every file re-copies on every pass and every write succeeds while
 *      it happens (hard rule 1). Asserted THROUGH the hash, not by string
 *      equality, because comparing strings would pass a reconstruction that
 *      agreed by accident.
 *   2. **`contentHashFor` reads the blobId off the NODE.** Stalwart re-issues
 *      the handle once the blob is attached, so the upload's id is not the
 *      store's. Getting this wrong does not fail at write time — it surfaces as
 *      §20 samples quietly returning `checksumUnavailable`, which looks exactly
 *      like a check that ran and had nothing to say.
 *   3. **A failed enumeration never reads as "the account is empty".** That
 *      turn is how a duplicate gets written, and a duplicate is a successful
 *      write nobody notices until a drive is twice its size.
 *   4. **Overwrite and removal refuse when the node has moved under us.** This
 *      transport has no ETag, so the guard is a fingerprint of the stored node
 *      — and if that fingerprint were unstable, update propagation would
 *      silently stop working.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RawFileItem, TargetEntry } from '@openmig/shared';
import { fileNaturalKeyHash, fileContentHash } from '@openmig/shared';
import { JmapFileTarget } from './jmap-file-target';

vi.mock('jmap-jam', () => ({
  default: {
    loadSession: async () => ({
      accounts: { acct: { email: 'target@dev.local' } },
      primaryAccounts: { 'urn:ietf:params:jmap:filenode': 'acct' },
      // Deliberately unroutable, the way Stalwart really answers. If the
      // writer ever starts trusting either of these, tests here fail.
      apiUrl: 'https://0.0.0.0/jmap/',
      downloadUrl: 'https://0.0.0.0/jmap/download/{accountId}/{blobId}/{name}?accept={type}',
    }),
  },
}));

/** One JMAP method call, as the fake transport recorded it. */
interface Call {
  readonly url: string;
  readonly method: string;
  readonly args: Record<string, unknown>;
  readonly using: string[];
}

/** What the fake server should answer, per JMAP method name. */
type Responder = (args: Record<string, unknown>, call: number) => unknown;

const calls: Call[] = [];
let responders: Record<string, Responder>;
let uploads: Array<{ contentType: string | undefined; bytes: Uint8Array }>;
let downloads: string[];
/** blobId -> the bytes the fake store will serve for it. */
let blobs: Map<string, Uint8Array>;

function target(): JmapFileTarget {
  return new JmapFileTarget({
    baseUrl: 'http://jmap.test',
    username: 'target@dev.local',
    password: 'pw',
  });
}

const CONTENT = new TextEncoder().encode('the bytes of a real file\n');

function rawFile(path: string, content: Uint8Array = CONTENT, mimeType = 'text/plain'): RawFileItem {
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

/** A node as `FileNode/get` returns it. */
function node(
  id: string,
  name: string,
  parentId: string | null,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return { id, name, parentId, nodeType: 'directory', ...extra };
}

function fileNode(
  id: string,
  name: string,
  parentId: string | null,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    name,
    parentId,
    nodeType: 'file',
    blobId: `stored-${id}`,
    size: CONTENT.byteLength,
    type: 'text/plain',
    ...extra,
  };
}

/** How many times each method has been asked for, so responders can vary. */
const seen: Record<string, number> = {};

beforeEach(() => {
  calls.length = 0;
  uploads = [];
  downloads = [];
  blobs = new Map();
  for (const k of Object.keys(seen)) delete seen[k];
  responders = {};

  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    if (url.includes('/upload/')) {
      const bytes = new Uint8Array(await new Response(init.body as Blob).arrayBuffer());
      const headers = (init.headers ?? {}) as Record<string, string>;
      uploads.push({ contentType: headers['Content-Type'], bytes });
      const blobId = `uploaded-${uploads.length}`;
      blobs.set(blobId, bytes);
      return new Response(JSON.stringify({ blobId }), { status: 200 });
    }
    if (url.includes('/download/')) {
      downloads.push(url);
      // The fake store serves ONLY the handles it has issued. An id that was
      // never stored 404s, which is exactly what a real Stalwart does with a
      // handle it has re-issued — and is what makes assertion (2) bite.
      const blobId = decodeURIComponent(new URL(url).pathname.split('/')[4] ?? '');
      const bytes = blobs.get(blobId);
      if (!bytes) return new Response('no such blob', { status: 404 });
      return new Response(new Blob([bytes.slice().buffer as ArrayBuffer]), { status: 200 });
    }

    const body = JSON.parse(String(init.body)) as {
      using: string[];
      methodCalls: Array<[string, Record<string, unknown>, string]>;
    };
    const [method, args] = body.methodCalls[0]!;
    calls.push({ url, method, args, using: body.using });
    seen[method] = (seen[method] ?? 0) + 1;

    const responder = responders[method];
    if (!responder) throw new Error(`test fake has no responder for ${method}`);
    const result = responder(args, seen[method]!);
    // A responder may hand back a method-level error, which RFC 8620 §3.6.2
    // says arrives INSIDE an HTTP 200. Modelled faithfully, because the whole
    // point of one of the tests below is that it must not read as a result.
    const isError =
      typeof result === 'object' && result !== null && 'type' in (result as object)
        && (result as { __error?: boolean }).__error === true;
    return new Response(
      JSON.stringify({
        methodResponses: [[isError ? 'error' : method, stripMarker(result), 'c1']],
      }),
      { status: 200 },
    );
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function methodError(type: string, description?: string) {
  return { __error: true, type, ...(description ? { description } : {}) };
}
function stripMarker(result: unknown): unknown {
  if (typeof result !== 'object' || result === null) return result;
  const { __error: _drop, ...rest } = result as Record<string, unknown>;
  return rest;
}

/**
 * `FileNode/get` responder over a fixed tree; handles `ids: null` and
 * `ids: [...]`.
 *
 * **It honours `properties`, and that is not decoration.** A real server
 * returns exactly what was asked for, so a connector that forgets to name
 * `blobId` gets a node that LOOKS complete and has no handle back to the
 * bytes — a passing read with missing data, which is the shape this repo keeps
 * finding. A fake that ignored the property list would let that mutation
 * through, so the fake enforces it.
 */
function treeResponder(nodes: Array<Record<string, unknown>>): Responder {
  return (args) => {
    const ids = args.ids as string[] | null;
    const matched = ids === null ? nodes : nodes.filter((n) => ids.includes(n.id as string));
    const wanted = args.properties as string[] | undefined;
    if (!wanted) return { list: matched };
    const list = matched.map((n) =>
      Object.fromEntries(Object.entries(n).filter(([k]) => wanted.includes(k))),
    );
    return { list };
  };
}

// =======================================================================
// 1. The natural key
// =======================================================================

describe('the natural key is the reconstructed path', () => {
  it('keys a nested file exactly as the WebDAV source would', async () => {
    // The shape `WebdavFileSource.toRelativePath` produces for the same file:
    // root-relative, percent-DECODED, no leading slash. Note the SPACE — a
    // reconstruction that percent-encoded its segments would produce
    // `Documents/Meeting%20notes.txt`, which hashes to something the ledger
    // never holds, and every pass would copy the file again.
    const webdavPath = 'Documents/Meeting notes.txt';

    responders['FileNode/get'] = treeResponder([
      node('d1', 'Documents', null),
      fileNode('f1', 'Meeting notes.txt', 'd1'),
    ]);

    const entries: TargetEntry[] = [];
    for await (const entry of target().listEntries()) entries.push(entry);

    expect(entries).toHaveLength(1);
    expect(entries[0]!.naturalKey).toBe(webdavPath);
    // Through the HASH the ledger keys on, not through string equality:
    // comparing strings would pass a reconstruction that agreed by accident.
    expect(fileNaturalKeyHash(entries[0]!.naturalKey)).toBe(fileNaturalKeyHash(webdavPath));
    expect(entries[0]!.targetId).toBe('f1');
  });

  it('carries the size the node reports, so verification can count bytes', async () => {
    responders['FileNode/get'] = treeResponder([
      fileNode('f1', 'sized.txt', null, { size: 4242 }),
      // A node whose size the server did not state. Left UNDEFINED rather than
      // guessed at 0: an estimated total is indistinguishable from a measured
      // one in the report, and the whole point of the field is that it was
      // measured. (Contacts have no such field at all, which is why their
      // verification is counts-only and this domain's is not.)
      fileNode('f2', 'unsized.txt', null, { size: null }),
    ]);

    const entries: TargetEntry[] = [];
    for await (const entry of target().listEntries()) entries.push(entry);

    expect(entries.find((e) => e.targetId === 'f1')!.sizeBytes).toBe(4242);
    expect(entries.find((e) => e.targetId === 'f2')!.sizeBytes).toBeUndefined();
  });

  it('refuses the whole enumeration rather than mis-key one broken chain', async () => {
    responders['FileNode/get'] = treeResponder([
      // The parent is NOT in the list. Any path built here would be a SUFFIX
      // of the real one — well-formed, plausible, and hashing to something
      // WebDAV never produces, so the file would copy again on every pass
      // forever with every write succeeding.
      fileNode('f1', 'orphan.txt', 'missing-parent'),
    ]);

    const entries: TargetEntry[] = [];
    await expect(async () => {
      for await (const entry of target().listEntries()) entries.push(entry);
    }).rejects.toThrow(/broken/i);
    expect(entries).toHaveLength(0);
  });

  it('refuses a node whose type is neither file nor directory', async () => {
    responders['FileNode/get'] = treeResponder([{ id: 'x', name: 'odd', parentId: null }]);
    await expect(async () => {
      for await (const _ of target().listEntries()) void _;
    }).rejects.toThrow(/neither 'file' nor 'directory'/);
  });

  it('lists only the subtree when asked for one directory', async () => {
    responders['FileNode/get'] = treeResponder([
      node('d1', 'Documents', null),
      node('d2', 'Nested', 'd1'),
      node('d3', 'Elsewhere', null),
      fileNode('f1', 'deep.txt', 'd2'),
      fileNode('f2', 'other.txt', 'd3'),
    ]);

    const entries: TargetEntry[] = [];
    for await (const entry of target().listEntries('d1')) entries.push(entry);

    expect(entries.map((e) => e.naturalKey)).toEqual(['Documents/Nested/deep.txt']);
  });
});

// =======================================================================
// 2. The blobId is the NODE's, never the upload's
// =======================================================================

describe('contentHashFor', () => {
  it('reads the blobId off the node rather than reusing the upload handle', async () => {
    // THE SPIKE'S FINDING, TURNED INTO A TEST. Stalwart re-issues the handle
    // once the blob is attached to a node: uploaded `eda…udrxi0gbq`, stored
    // `cc2…gaqmai`. So the fake below hands back a DIFFERENT id on the node
    // than the upload returned — and, like the real server, serves content
    // only for the one it issued.
    const stored = 'stored-by-the-server';
    blobs.set(stored, CONTENT);

    responders['FileNode/get'] = treeResponder([
      fileNode('f1', 'report.pdf', null, { blobId: stored }),
    ]);

    const t = target();
    const entry: TargetEntry = { naturalKey: 'report.pdf', targetId: 'f1', mailboxId: '' };
    const hash = await t.contentHashFor(entry);

    // The bytes came back, so the handle used was the store's.
    expect(hash).toBe(fileContentHash(CONTENT));
    expect(downloads).toHaveLength(1);
    expect(downloads[0]).toContain(encodeURIComponent(stored));
  });

  it('ignores the blobId the create response volunteered', async () => {
    // A lazy implementation would keep `created['0'].blobId` — which a real
    // server may well echo from the upload — and hand it to the download.
    // That handle is dead the moment the blob is attached, so the sample
    // would 404 and be counted `checksumUnavailable`: a check that looks like
    // it ran. The fake echoes the upload's id on create for exactly that
    // reason.
    const t = target();
    let created = false;
    responders['FileNode/get'] = (args) => {
      const ids = args.ids as string[] | null;
      if (!created) return { list: [] };
      const stored = fileNode('f1', 'report.pdf', null, { blobId: 'reissued-by-the-store' });
      return { list: ids === null ? [stored] : ids.includes('f1') ? [stored] : [] };
    };
    responders['FileNode/set'] = () => {
      created = true;
      // `blobId` echoed straight back from the upload, the plausible-server
      // shape this test exists to make unusable.
      return { created: { '0': { id: 'f1', blobId: 'uploaded-1' } } };
    };
    blobs.set('reissued-by-the-store', CONTENT);

    const result = await t.upsertFile('', rawFile('report.pdf'));
    expect(result.created).toBe(true);

    const hash = await t.contentHashFor({
      naturalKey: 'report.pdf',
      targetId: 'f1',
      mailboxId: '',
    });
    expect(hash).toBe(fileContentHash(CONTENT));
    // The dead handle was never asked for.
    expect(downloads.some((u) => u.includes('uploaded-1'))).toBe(false);
  });

  it('rebuilds the download URL on the routable origin, not the advertised host', async () => {
    blobs.set('b1', CONTENT);
    responders['FileNode/get'] = treeResponder([fileNode('f1', 'x.txt', null, { blobId: 'b1' })]);

    await target().contentHashFor({ naturalKey: 'x.txt', targetId: 'f1', mailboxId: '' });

    // The session advertises `https://0.0.0.0/…`. Its PATH shape is the
    // server's to define and cannot be guessed (Stalwart's ends in `/{name}`),
    // so the template is kept — but the host is replaced with the one we were
    // actually given.
    expect(downloads[0]).toMatch(/^http:\/\/jmap\.test\/jmap\/download\/acct\/b1\/x\.txt\?/);
  });

  it('reports a download failure as unavailable rather than as a mismatch', async () => {
    // Nothing seeded into `blobs`, so the store 404s.
    responders['FileNode/get'] = treeResponder([
      fileNode('f1', 'x.txt', null, { blobId: 'never-stored' }),
    ]);
    const hash = await target().contentHashFor({
      naturalKey: 'x.txt',
      targetId: 'f1',
      mailboxId: '',
    });
    // undefined => "not measured". Inventing a hash here would report a
    // healthy file as corrupt.
    expect(hash).toBeUndefined();
  });
});

// =======================================================================
// 3. A failed read never reads as "the account is empty"
// =======================================================================

describe('failures never degrade to an empty target', () => {
  it('throws rather than writing a duplicate when the tree cannot be read', async () => {
    responders['FileNode/get'] = () => methodError('serverFail', 'the store is down');
    responders['FileNode/set'] = () => {
      throw new Error('the connector must not reach a write after a failed existence check');
    };

    await expect(target().upsertFile('', rawFile('report.pdf'))).rejects.toThrow(/serverFail/);
    // Nothing was uploaded and nothing was written. A swallowed failure here
    // would have created a second copy of a file the target already holds.
    expect(uploads).toHaveLength(0);
    expect(calls.filter((c) => c.method === 'FileNode/set')).toHaveLength(0);
  });

  it('surfaces a method-level error instead of returning it as a result', async () => {
    // RFC 8620 §3.6.2: the error arrives as ["error", {...}] inside an HTTP
    // 200. Returning `first[1]` blindly hands it back AS IF it were the
    // result, so enumeration yields `{ list: undefined }` — an empty target,
    // reported as total data loss. That bug was fixed in the mail writer and
    // is not being re-introduced here.
    responders['FileNode/get'] = () => methodError('unknownMethod');
    await expect(async () => {
      for await (const _ of target().listEntries()) void _;
    }).rejects.toThrow(/unknownMethod/);
  });

  it('surfaces an HTTP failure with the status the server actually returned', async () => {
    vi.stubGlobal('fetch', async () => new Response('<html>gateway</html>', { status: 502 }));
    await expect(async () => {
      for await (const _ of target().listEntries()) void _;
    }).rejects.toThrow(/HTTP 502/);
  });
});

// =======================================================================
// 4. Writing: adoption, directories, conflicts
// =======================================================================

describe('upsertFile', () => {
  it('adopts a file already on the target instead of writing a second copy', async () => {
    responders['FileNode/get'] = treeResponder([
      node('d1', 'Documents', null),
      fileNode('f1', 'report.pdf', 'd1'),
    ]);
    responders['FileNode/set'] = () => {
      throw new Error('nothing should be written for a file already on the target');
    };

    const result = await target().upsertFile('d1', rawFile('Documents/report.pdf'));
    expect(result.created).toBe(false);
    // ADOPTED, not merely "not created": a first migration into an account the
    // customer is already using has to be visible before a cutover.
    expect(result.adopted).toBe(true);
    expect(result.targetId).toBe('f1');
  });

  it('creates the missing directory chain and parents the file under its leaf', async () => {
    const madeDirs: Array<{ name: unknown; parentId: unknown }> = [];
    let fileCreate: Record<string, unknown> | undefined;
    responders['FileNode/get'] = () => ({ list: [] });
    responders['FileNode/set'] = (args) => {
      const create = (args.create as Record<string, Record<string, unknown>>)['0']!;
      if (create.blobId) {
        fileCreate = create;
        return { created: { '0': { id: 'f1' } } };
      }
      madeDirs.push({ name: create.name, parentId: create.parentId });
      return { created: { '0': { id: `d${madeDirs.length}` } } };
    };

    const result = await target().upsertFile('', rawFile('Documents/2026/report.pdf'));
    expect(result.created).toBe(true);

    // Root first, each parented on the one before. `null` is the account root:
    // a JMAP file tree has no node for it.
    expect(madeDirs).toEqual([
      { name: 'Documents', parentId: null },
      { name: '2026', parentId: 'd1' },
    ]);
    expect(fileCreate).toMatchObject({ name: 'report.pdf', parentId: 'd2', type: 'text/plain' });
    // `@type` is NOT sent. Stalwart refused it with
    // `invalidProperties: ["@type"]` during the spike.
    expect(fileCreate).not.toHaveProperty('@type');
  });

  it('refuses to write over a directory sitting at the file path', async () => {
    responders['FileNode/get'] = treeResponder([node('d1', 'report.pdf', null)]);
    responders['FileNode/set'] = () => {
      throw new Error('nothing should be written over a directory');
    };

    // Writing the file would destroy the directory; adopting it would record
    // an item whose content was never written. Neither is acceptable and
    // there is no third answer this writer can give on its own.
    await expect(target().upsertFile('', rawFile('report.pdf'))).rejects.toThrow(
      /already holds a DIRECTORY/,
    );
  });

  it('adopts when the server itself says the node already exists', async () => {
    // The snapshot is a whole pass old by the time a write lands, so the
    // SERVER — not our snapshot — is what actually guarantees no second copy.
    let exists = false;
    responders['FileNode/get'] = (args) => {
      const list = exists ? [fileNode('f1', 'report.pdf', null)] : [];
      const ids = args.ids as string[] | null;
      return { list: ids === null ? list : list.filter((n) => ids.includes(n.id as string)) };
    };
    responders['FileNode/set'] = () => {
      exists = true;
      return { notCreated: { '0': { type: 'alreadyExists' } } };
    };

    const result = await target().upsertFile('', rawFile('report.pdf'));
    expect(result.adopted).toBe(true);
    expect(result.targetId).toBe('f1');
  });

  it('uploads the bytes with the source mime type', async () => {
    responders['FileNode/get'] = (args) =>
      (args.ids as string[] | null) === null
        ? { list: [] }
        : { list: [fileNode('f1', 'photo.jpg', null)] };
    responders['FileNode/set'] = () => ({ created: { '0': { id: 'f1' } } });

    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    await target().upsertFile('', rawFile('photo.jpg', bytes, 'image/jpeg'));

    expect(uploads).toHaveLength(1);
    expect(uploads[0]!.contentType).toBe('image/jpeg');
    // The exact bytes, not a window onto a larger buffer.
    expect(Array.from(uploads[0]!.bytes)).toEqual([1, 2, 3, 4, 5]);
  });
});

// =======================================================================
// 5. Ownership: the rewrite and removal guards
// =======================================================================

describe('the ownership guard', () => {
  const tree = [fileNode('f1', 'report.pdf', null)];

  it('refuses a rewrite when the stored node has moved under us', async () => {
    responders['FileNode/get'] = treeResponder(tree);
    responders['FileNode/set'] = () => {
      throw new Error('a rewrite must not reach the server when the guard refuses');
    };

    const result = await target().upsertFile('', rawFile('report.pdf'), {
      overwrite: true,
      expectedTargetVersion: 'a fingerprint this node has never had',
    });
    // Hard rule 2 on a transport with no ETag. Not thrown: a conflict is a
    // fact about ownership, not a failure to migrate — throwing would spend
    // one of the item's attempts and count towards the systemic-failure
    // tripwire, both of which describe something else entirely.
    expect(result.conflicted).toBe(true);
    expect(result.updated).toBeUndefined();
    expect(uploads).toHaveLength(0);
  });

  it('rewrites when the version we hold still matches, and the fingerprint is stable', async () => {
    responders['FileNode/get'] = treeResponder(tree);
    responders['FileNode/set'] = () => ({ updated: { f1: null } });

    const t = target();
    const first = await t.upsertFile('', rawFile('report.pdf'), { overwrite: true });
    expect(first.updated).toBe(true);
    expect(first.targetVersion).toBeDefined();

    const second = await t.upsertFile('', rawFile('report.pdf'), {
      overwrite: true,
      expectedTargetVersion: first.targetVersion,
    });
    // Same stored node, so the fingerprint must be the same. An unstable one
    // would report a conflict on every pass and silently stop update
    // propagation working at all.
    expect(second.conflicted).toBeUndefined();
    expect(second.updated).toBe(true);
  });

  it('does not depend on the server keeping its key order stable', async () => {
    // JMAP makes no promise about key order and Stalwart demonstrably varies
    // it between reads. Hashing the raw JSON would therefore report a conflict
    // on every rewrite — which is why the fingerprint is canonical.
    let flip = false;
    responders['FileNode/get'] = (args) => {
      flip = !flip;
      const n = flip
        ? { id: 'f1', name: 'report.pdf', parentId: null, nodeType: 'file', blobId: 'b', size: 1 }
        : { size: 1, blobId: 'b', nodeType: 'file', parentId: null, name: 'report.pdf', id: 'f1' };
      const ids = args.ids as string[] | null;
      return { list: ids === null ? [n] : [n] };
    };
    responders['FileNode/set'] = () => ({ updated: { f1: null } });

    const t = target();
    const first = await t.upsertFile('', rawFile('report.pdf'), { overwrite: true });
    const second = await t.upsertFile('', rawFile('report.pdf'), {
      overwrite: true,
      expectedTargetVersion: first.targetVersion,
    });
    expect(second.conflicted).toBeUndefined();
  });

  it('refuses to create a file it was asked to rewrite', async () => {
    responders['FileNode/get'] = treeResponder([]);
    responders['FileNode/set'] = () => {
      throw new Error('a rewrite must never fall through to a create');
    };

    // The caller believes this item is already on the target. Quietly
    // disagreeing would hide whatever made that false.
    await expect(
      target().upsertFile('', rawFile('report.pdf'), { overwrite: true }),
    ).rejects.toThrow(/Refusing to create one instead/);
  });

  it('refuses a removal when the node has moved under us', async () => {
    responders['FileNode/get'] = treeResponder(tree);
    responders['FileNode/set'] = () => {
      throw new Error('a removal must not reach the server when the guard refuses');
    };
    const result = await target().removeItem('f1', { expectedTargetVersion: 'stale' });
    expect(result.conflicted).toBe(true);
    expect(result.kind).toBeUndefined();
  });
});

// =======================================================================
// 6. Removal
// =======================================================================

describe('removeItem', () => {
  it('reports deleted rather than binned', async () => {
    responders['FileNode/set'] = () => ({ destroyed: ['f1'] });
    const result = await target().removeItem('f1');
    // Nothing has established that a JMAP `FileNode/set destroy` lands in a
    // recoverable bin on Stalwart, unlike a Nextcloud WebDAV DELETE.
    // Understating recoverability is the safe direction to be wrong in.
    expect(result.kind).toBe('deleted');
  });

  it('refuses to record a removal the server did not confirm', async () => {
    responders['FileNode/set'] = () => ({});
    // Neither destroyed nor refused. Reporting success on that would let the
    // ledger tombstone a row for a file still sitting on the target.
    await expect(target().removeItem('f1')).rejects.toThrow(/neither destroyed nor notDestroyed/);
  });

  it('surfaces a per-item refusal', async () => {
    responders['FileNode/set'] = () => ({ notDestroyed: { f1: { type: 'forbidden' } } });
    await expect(target().removeItem('f1')).rejects.toThrow(/forbidden/);
  });
});

// =======================================================================
// 7. Session
// =======================================================================

describe('the session', () => {
  it('ignores the advertised apiUrl and rebuilds from the configured base', async () => {
    responders['FileNode/get'] = treeResponder([]);
    for await (const _ of target().listEntries()) void _;
    // Stalwart advertises `https://0.0.0.0/jmap/`, which is unroutable.
    expect(calls[0]!.url).toBe('http://jmap.test/jmap');
    expect(calls[0]!.using).toContain('urn:ietf:params:jmap:filenode');
  });
});
