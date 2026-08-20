// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The Google Drive source, against a fake transport (workplan 0042, first slice).
 *
 * No network. The connector's one seam is a function, so a test can be a literal
 * — the same shape `smtpTransport` uses for its settings.
 *
 * What these hold, in order of what they would cost a customer if wrong:
 *  1. A Google Doc is NOT silently skipped and NOT silently exported.
 *  2. A trashed file is not migrated (copying somebody's bin is not a migration).
 *  3. `removed` is never populated — the field that becomes destructive evidence.
 *  4. The listing carries no bytes (the memory property `ports.ts` records).
 */

import { describe, it, expect } from 'vitest';
import { GoogleDriveSource, NativeFileRefused, isNativeEditorFile } from './google-drive-source.ts';
import type { DriveTransport } from './google-drive-source.types.ts';

const BASE = 'https://drive.test/v3';

interface Call {
  readonly url: string;
}

/** A transport that answers from a table, and records what was asked. */
function fakeDrive(routes: Record<string, unknown>, bytes?: Uint8Array) {
  const calls: Call[] = [];
  const transport: DriveTransport = async (url) => {
    calls.push({ url });
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (key === undefined) {
      return {
        ok: false,
        status: 404,
        json: async () => ({}),
        arrayBuffer: async () => new ArrayBuffer(0),
        text: async () => `no fake route for ${url}`,
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => routes[key],
      arrayBuffer: async () => (bytes ?? new Uint8Array()).buffer as ArrayBuffer,
      text: async () => '',
    };
  };
  return { transport, calls };
}

const BINARY = {
  id: 'file-1',
  name: 'report.pdf',
  mimeType: 'application/pdf',
  size: '2048',
  md5Checksum: 'abc123',
  modifiedTime: '2026-08-01T10:00:00Z',
};

const NATIVE_DOC = {
  id: 'doc-1',
  name: 'Notes',
  mimeType: 'application/vnd.google-apps.document',
  modifiedTime: '2026-08-01T10:00:00Z',
};

describe('isNativeEditorFile', () => {
  it('recognises Docs, Sheets and Slides but NOT folders', () => {
    // A folder shares the vnd.google-apps prefix and is emphatically not a
    // native editor file; treating it as one would refuse every folder.
    expect(isNativeEditorFile('application/vnd.google-apps.document')).toBe(true);
    expect(isNativeEditorFile('application/vnd.google-apps.spreadsheet')).toBe(true);
    expect(isNativeEditorFile('application/vnd.google-apps.folder')).toBe(false);
    expect(isNativeEditorFile('application/pdf')).toBe(false);
  });
});

describe('listSince', () => {
  it('lists a folder METADATA ONLY — no bytes', async () => {
    // The property ports.ts records WebDAV having broken: content in the listing
    // makes every download serial and holds a whole folder in memory at once.
    const { transport } = fakeDrive({ '/files?q=': { files: [BINARY] } });
    const source = new GoogleDriveSource(transport, { baseUrl: BASE });

    const { items } = await source.listSince({ path: '' });

    expect(items).toHaveLength(1);
    expect(items[0]!.content, 'the listing must not carry bytes').toBeUndefined();
    expect(items[0]!.item.path).toBe('report.pdf');
    expect(items[0]!.item.sourceRef).toBe('file-1');
  });

  it('asks Drive to exclude trashed files', async () => {
    // Copying somebody's bin into their new system is not a migration, and the
    // filter has to be in the QUERY — filtering after the fact still pages
    // through every trashed file.
    const { transport, calls } = fakeDrive({ '/files?q=': { files: [] } });
    await new GoogleDriveSource(transport, { baseUrl: BASE }).listSince({ path: '' });

    expect(decodeURIComponent(calls[0]!.url)).toContain('trashed=false');
  });

  it('NEVER reports removals', async () => {
    // The most dangerous field in this connector's reach. Drive sets `removed`
    // for losing access and for scope changes, and resolveReportedRemovals
    // treats it as the one place a deletion is KNOWN — feeding ADR-0024's
    // destructive apply. This slice populates nothing.
    const { transport } = fakeDrive({ '/files?q=': { files: [BINARY] } });
    const result = await new GoogleDriveSource(transport, { baseUrl: BASE }).listSince({ path: '' });

    expect((result as { removed?: readonly string[] }).removed).toBeUndefined();
  });

  it('derives a path from the folder it was asked about', async () => {
    // A Drive file has no path — only an id and a name — so the path the ledger
    // keys on is COMPOSED here. This drives the two-step it takes: resolve the
    // folder name to an id, then list that id's children.
    //
    // The fake answers the two queries differently, which is the point: a
    // folders-only query carries `mimeType='...folder'` and a files query
    // carries `mimeType!=`.
    const transport: DriveTransport = async (url) => {
      const decoded = decodeURIComponent(url);
      const foldersQuery = decoded.includes("mimeType='application/vnd.google-apps.folder'");
      return {
        ok: true,
        status: 200,
        json: async () =>
          foldersQuery
            ? { files: [{ id: 'folder-9', name: 'Invoices', mimeType: 'application/vnd.google-apps.folder' }] }
            : { files: [BINARY] },
        arrayBuffer: async () => new ArrayBuffer(0),
        text: async () => '',
      };
    };

    const source = new GoogleDriveSource(transport, { baseUrl: BASE, rootFolderId: 'root' });
    const { items } = await source.listSince({ path: 'Invoices' });

    expect(items[0]!.item.path).toBe('Invoices/report.pdf');
  });
});

describe('fetch — native editor files', () => {
  it('REFUSES a Google Doc by default, naming why', async () => {
    // Not skipped (which would report "migrated" for a file nobody copied) and
    // not silently exported (which is lossy). Thrown per item, so the rest of
    // the folder still migrates.
    const { transport } = fakeDrive({ '/files/doc-1?fields=': NATIVE_DOC });
    const source = new GoogleDriveSource(transport, { baseUrl: BASE });

    const item = {
      path: 'Notes',
      isDirectory: false,
      size: 0,
      modifiedAt: '2026-08-01T10:00:00Z',
      sourceRef: 'doc-1',
    };

    await expect(source.fetch(item)).rejects.toThrow(NativeFileRefused);
    await expect(source.fetch(item)).rejects.toThrow(/has no file to copy/);
    await expect(source.fetch(item)).rejects.toThrow(/nativeFilePolicy/);
  });

  it('exports a Google Doc when the owner chose an export policy', async () => {
    // T0 Q3: the owner chooses per migration. When they have, the refusal must
    // get out of the way — and the request must go to /export, not /alt=media,
    // which returns 403 for a native file.
    const bytes = new Uint8Array([1, 2, 3]);
    const { transport, calls } = fakeDrive(
      { '/files/doc-1?fields=': NATIVE_DOC, '/export': {} },
      bytes,
    );
    const source = new GoogleDriveSource(transport, {
      baseUrl: BASE,
      nativeFilePolicy: 'export-office',
    });

    const out = await source.fetch({
      path: 'Notes',
      isDirectory: false,
      size: 0,
      modifiedAt: '2026-08-01T10:00:00Z',
      sourceRef: 'doc-1',
    });

    expect(out.content).toEqual(bytes);
    const exportCall = calls.find((c) => c.url.includes('/export'));
    expect(exportCall, 'a native file must be exported, never downloaded').toBeDefined();
    expect(decodeURIComponent(exportCall!.url)).toContain('wordprocessingml');
  });

  it('downloads an ordinary file rather than exporting it', async () => {
    const bytes = new Uint8Array([9, 9]);
    const { transport, calls } = fakeDrive({ '/files/file-1': BINARY }, bytes);
    const source = new GoogleDriveSource(transport, { baseUrl: BASE });

    const out = await source.fetch({
      path: 'report.pdf',
      isDirectory: false,
      size: 2048,
      modifiedAt: '2026-08-01T10:00:00Z',
      sourceRef: 'file-1',
    });

    expect(out.content).toEqual(bytes);
    expect(calls.some((c) => c.url.includes('alt=media'))).toBe(true);
    expect(calls.some((c) => c.url.includes('/export'))).toBe(false);
  });

  it('reports the size it actually received, not the one it was told', async () => {
    // Drive's `size` is metadata; the bytes are the truth, and contentHash is
    // computed over what is written.
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const { transport } = fakeDrive({ '/files/file-1': BINARY }, bytes);

    const out = await new GoogleDriveSource(transport, { baseUrl: BASE }).fetch({
      path: 'report.pdf',
      isDirectory: false,
      size: 2048,
      modifiedAt: '2026-08-01T10:00:00Z',
      sourceRef: 'file-1',
    });

    expect(out.item.size).toBe(5);
  });

  it('refuses an item carrying no Drive id, rather than guessing', async () => {
    const { transport } = fakeDrive({});
    await expect(
      new GoogleDriveSource(transport, { baseUrl: BASE }).fetch({
        path: 'orphan.txt',
        isDirectory: false,
        size: 1,
        modifiedAt: '2026-08-01T10:00:00Z',
        sourceRef: '',
      }),
    ).rejects.toThrow(/No Drive file id/);
  });
});

describe('errors carry what the other end said', () => {
  it('includes the status and body verbatim (rule 9)', async () => {
    const transport: DriveTransport = async () => ({
      ok: false,
      status: 429,
      json: async () => ({}),
      arrayBuffer: async () => new ArrayBuffer(0),
      text: async () => 'Rate Limit Exceeded',
    });

    await expect(
      new GoogleDriveSource(transport, { baseUrl: BASE }).listSince({ path: '' }),
    ).rejects.toThrow(/429[\s\S]*Rate Limit Exceeded/);
  });
});

describe('listKeys — the complete key set move detection turns on', () => {
  // Route keys, by the query SHAPE the connector sends: `mimeType!=` (encoded
  // `!%3D`) lists files, `mimeType=` lists folders. Substring matching means
  // the more specific files key must be checked against a url that genuinely
  // differs, and these do.
  const ROOT_FOLDERS = `q='root'%20in%20parents%20and%20trashed%3Dfalse%20and%20mimeType%3D`;
  const ROOT_FILES = `q='root'%20in%20parents%20and%20trashed%3Dfalse%20and%20mimeType!%3D`;
  const SUB_FILES = `q='sub-1'%20in%20parents%20and%20trashed%3Dfalse%20and%20mimeType!%3D`;
  const SUBFOLDER = { id: 'sub-1', name: 'a', mimeType: 'application/vnd.google-apps.folder' };

  it('returns EXACTLY the paths listSince lists, native files included', async () => {
    // Parity is the whole contract: the loop hashes both sides into the same
    // natural key, and a composition that differs by so much as a prefix reads
    // an entire folder as absent — which two clean scans later is a corpus of
    // phantom deletions. The Doc matters too: listSince lists it (it fails at
    // fetch, per item), so a key set without it would count it absent.
    const { transport } = fakeDrive({
      [ROOT_FOLDERS]: { files: [SUBFOLDER] },
      [SUB_FILES]: { files: [BINARY, NATIVE_DOC] },
    });
    const source = new GoogleDriveSource(transport, { baseUrl: BASE });

    const { items } = await source.listSince({ path: 'a' });
    const keys = await source.listKeys({ path: 'a' });

    expect(keys).toEqual(items.map((i) => i.item.path));
    expect(keys).toEqual(['a/report.pdf', 'a/Notes']);
  });

  it('answers from the listing listSince just made — no second files.list', async () => {
    // The detector must not double the connector's dominant API cost. One
    // files listing per folder per pass, with listKeys reading the memo.
    const { transport, calls } = fakeDrive({ [ROOT_FILES]: { files: [BINARY] } });
    const source = new GoogleDriveSource(transport, { baseUrl: BASE });

    await source.listSince({ path: '' });
    await source.listKeys({ path: '' });

    expect(calls.filter((c) => c.url.includes('mimeType!%3D'))).toHaveLength(1);
  });

  it('lists for itself when nothing was memoised, composing the same prefixed paths', async () => {
    // The degradation path: a changed call order costs one extra request and
    // must NOT cost the prefix — a bare name where a/`name` was recorded is
    // the parity failure above by another route.
    const { transport } = fakeDrive({
      [ROOT_FOLDERS]: { files: [SUBFOLDER] },
      [SUB_FILES]: { files: [BINARY] },
    });
    const source = new GoogleDriveSource(transport, { baseUrl: BASE });

    expect(await source.listKeys({ path: 'a' })).toEqual(['a/report.pdf']);
  });

  it('a consumed memo is GONE — a second listKeys asks Drive, not the cache', async () => {
    // Consume-once is what bounds staleness. Without the clear, any calling
    // pattern other than the loop's strict listSince-then-listKeys pairing
    // could be answered with an old listing — and a stale key set reads a
    // renamed file as still present, which is an absence swallowed silently.
    const routes: Record<string, unknown> = { [ROOT_FILES]: { files: [BINARY] } };
    const { transport } = fakeDrive(routes);
    const source = new GoogleDriveSource(transport, { baseUrl: BASE });

    await source.listSince({ path: '' });
    await source.listKeys({ path: '' }); // consumes the memo

    routes[ROOT_FILES] = { files: [{ ...BINARY, name: 'renamed.pdf' }] };
    expect(await source.listKeys({ path: '' }), 'fresh, not the cache').toEqual(['renamed.pdf']);
  });

  it('never serves one pass an earlier pass\'s files', async () => {
    // The failure a listing cache invites. The memo is overwritten by every
    // listSince and consumed by every listKeys, so a rename between passes is
    // visible to the second pass's key set.
    const routes: Record<string, unknown> = { [ROOT_FILES]: { files: [BINARY] } };
    const { transport } = fakeDrive(routes);
    const source = new GoogleDriveSource(transport, { baseUrl: BASE });

    await source.listSince({ path: '' });
    await source.listKeys({ path: '' });

    routes[ROOT_FILES] = { files: [{ ...BINARY, name: 'renamed.pdf' }] };
    await source.listSince({ path: '' });

    expect(await source.listKeys({ path: '' })).toEqual(['renamed.pdf']);
  });
});

describe('shared drives are not silently empty', () => {
  // Without `includeItemsFromAllDrives` + `supportsAllDrives`, a files.list
  // scoped to a shared-drive parent answers 200 WITH AN EMPTY ARRAY — not an
  // error. A rootFolderId naming a shared drive (which the setup docs
  // explicitly support) would then discover zero files and complete every
  // pass clean, having migrated nothing. These pin the parameters onto every
  // call shape the connector makes, so removing one is a red test rather
  // than a customer with an empty migration.

  it('every LISTING asks for shared-drive items', async () => {
    // Folder queries answer empty — a catch-all here feeds listFolders' walk
    // the same child forever, which is an OOM, not a test.
    const { transport, calls } = fakeDrive({
      'mimeType!%3D': { files: [BINARY] },
      'mimeType%3D': { files: [] },
    });
    const source = new GoogleDriveSource(transport, { baseUrl: BASE });

    await source.listFolders();
    await source.listSince({ path: '' });
    await source.listKeys({ path: '' });

    const listings = calls.filter((c) => c.url.includes('/files?q='));
    expect(listings.length).toBeGreaterThan(0);
    for (const c of listings) {
      expect(c.url, 'supportsAllDrives on every listing').toContain('supportsAllDrives=true');
      expect(c.url, 'includeItemsFromAllDrives on every listing').toContain(
        'includeItemsFromAllDrives=true',
      );
    }
  });

  it('the metadata read and the download carry supportsAllDrives — a shared-drive file 404s without it', async () => {
    const { transport, calls } = fakeDrive(
      { '?fields=id,name,mimeType': BINARY, 'alt=media': {} },
      new Uint8Array([1, 2, 3]),
    );
    const source = new GoogleDriveSource(transport, { baseUrl: BASE });

    await source.fetch({
      path: 'report.pdf',
      isDirectory: false,
      size: 3,
      modifiedAt: '2026-08-01T10:00:00Z',
      sourceRef: 'file-1',
    });

    const meta = calls.find((c) => c.url.includes('?fields=id,name,mimeType'));
    const media = calls.find((c) => c.url.includes('alt=media'));
    expect(meta!.url).toContain('supportsAllDrives=true');
    expect(media!.url).toContain('supportsAllDrives=true');
    // And NOT the listing-only parameter — files.get does not define it.
    expect(media!.url).not.toContain('includeItemsFromAllDrives');
  });

  it('the EXPORT url carries neither — files.export is addressed by id alone', async () => {
    const { transport, calls } = fakeDrive(
      { '?fields=id,name,mimeType': NATIVE_DOC, '/export?mimeType=': {} },
      new Uint8Array([1]),
    );
    const source = new GoogleDriveSource(transport, {
      baseUrl: BASE,
      nativeFilePolicy: 'export-pdf',
    });

    await source.fetch({
      path: 'Notes',
      isDirectory: false,
      size: 0,
      modifiedAt: '2026-08-01T10:00:00Z',
      sourceRef: 'doc-1',
    });

    const exp = calls.find((c) => c.url.includes('/export'));
    expect(exp, 'the export happened').toBeDefined();
    expect(exp!.url).not.toContain('supportsAllDrives');
  });
});

describe('listTrashedPaths — the bin as positive deletion evidence', () => {
  const ROOT_META = '/files/root?fields=id';
  const TRASH_LIST = 'trashed%3Dtrue%20and%20mimeType!%3D';

  it('names the ORIGINAL root-relative path, nested folders walked and cached', async () => {
    const { transport, calls } = fakeDrive({
      [ROOT_META]: { id: 'root-real' },
      [TRASH_LIST]: {
        files: [
          { id: 'f1', name: 'gone.pdf', parents: ['dir-b'] },
          { id: 'f2', name: 'also-gone.pdf', parents: ['dir-b'] },
          { id: 'f3', name: 'top.txt', parents: ['root-real'] },
        ],
      },
      '/files/dir-b?fields=id,name,parents': { id: 'dir-b', name: 'b', parents: ['dir-a'] },
      '/files/dir-a?fields=id,name,parents': { id: 'dir-a', name: 'a', parents: ['root-real'] },
    });
    const source = new GoogleDriveSource(transport, { baseUrl: BASE });

    const paths = (await source.listTrashedPaths()).paths;

    expect([...paths].sort()).toEqual(['a/b/also-gone.pdf', 'a/b/gone.pdf', 'top.txt']);
    // The shared ancestry was walked ONCE: two files under dir-b, one lookup.
    expect(calls.filter((c) => c.url.includes('/files/dir-b?')).length).toBe(1);
  });

  it('excludes a file whose chain tops out somewhere other than the migration root', async () => {
    // Another drive, or above a scoped rootFolderId: never in this
    // migration's scope, so its disappearance is not this mapping's to report.
    const { transport } = fakeDrive({
      [TRASH_LIST]: { files: [{ id: 'f1', name: 'other.pdf', parents: ['elsewhere'] }] },
      '/files/elsewhere?fields=id,name,parents': { id: 'elsewhere', name: 'x' }, // no parents
    });
    const source = new GoogleDriveSource(transport, { baseUrl: BASE, rootFolderId: 'scoped-id' });

    expect((await source.listTrashedPaths()).paths).toEqual([]);
  });

  it('skips ONLY the file behind a permanently-deleted ancestor — one orphan cannot silence the bin', async () => {
    const { transport } = fakeDrive({
      [ROOT_META]: { id: 'root-real' },
      [TRASH_LIST]: {
        files: [
          { id: 'f1', name: 'orphan.pdf', parents: ['vanished-dir'] },
          { id: 'f2', name: 'fine.pdf', parents: ['root-real'] },
        ],
      },
      // no route for vanished-dir → 404 → that chain is unresolvable
    });
    const source = new GoogleDriveSource(transport, { baseUrl: BASE });

    expect((await source.listTrashedPaths()).paths).toEqual(['fine.pdf']);
  });

  it('asks with the all-drives parameters and excludes folders in the QUERY', async () => {
    const { transport, calls } = fakeDrive({
      [ROOT_META]: { id: 'root-real' },
      [TRASH_LIST]: { files: [] },
    });
    await new GoogleDriveSource(transport, { baseUrl: BASE }).listTrashedPaths();

    const listing = calls.find((c) => c.url.includes(TRASH_LIST))!;
    expect(listing.url).toContain('supportsAllDrives=true');
    expect(listing.url).toContain('includeItemsFromAllDrives=true');
    expect(decodeURIComponent(listing.url)).toContain("trashed=true and mimeType!=");
  });
});

describe('listOwnedShareGrants (workplan 0029, the Google half)', () => {
  const SHARES_LIST = "q='me'%20in%20owners";

  it('maps Drive permissions to grants: owner row skipped, anyone flagged as a link', async () => {
    const { transport, calls } = fakeDrive({
      [SHARES_LIST]: {
        files: [
          {
            id: 'f-1',
            name: 'budget.xlsx',
            shared: true,
            permissions: [
              { type: 'user', role: 'owner', emailAddress: 'me@example.nl' },
              { type: 'user', role: 'writer', emailAddress: 'anna@example.nl' },
              { type: 'anyone', role: 'reader', allowFileDiscovery: false },
              { type: 'domain', role: 'commenter', domain: 'example.nl' },
            ],
          },
          // Unshared: only the owner can reach it — nothing to act on.
          { id: 'f-2', name: 'private.txt', permissions: [{ type: 'user', role: 'owner' }] },
        ],
      },
    });
    const source = new GoogleDriveSource(transport, { baseUrl: BASE });

    const listing = await source.listOwnedShareGrants();

    expect(listing.kind).toBe('listed');
    if (listing.kind !== 'listed') return;
    expect(listing.grants).toHaveLength(3);
    const [person, link, domain] = listing.grants;
    expect(person).toMatchObject({
      subject: 'drive_item',
      on: 'budget.xlsx',
      role: 'writer',
      grantee: 'anna@example.nl',
    });
    expect(person!.viaLink).toBeUndefined();
    // "Anyone with the link" is the finding an owner most often does not
    // know about — it must never flatten into the list of names.
    expect(link).toMatchObject({ role: 'reader', viaLink: true });
    expect(link!.grantee).toBeUndefined();
    expect(domain).toMatchObject({ role: 'commenter', grantee: 'example.nl' });
    // raw keeps Drive's own fields verbatim, file id included.
    expect(JSON.parse(person!.raw)).toMatchObject({ fileId: 'f-1', type: 'user', role: 'writer' });
    // The query scopes to OWNED, untrashed files — outbound shares only.
    const asked = decodeURIComponent(calls[0]!.url);
    expect(asked).toContain("'me' in owners and trashed=false");
    expect(asked).toContain('permissions(');
  });

  it('a hit cap answers not_discoverable — never a short list dressed as the whole one', async () => {
    const shared = (n: number) => ({
      id: `f-${n}`,
      name: `file-${n}`,
      shared: true,
      permissions: [{ type: 'user', role: 'reader', emailAddress: 'x@example.nl' }],
    });
    const { transport } = fakeDrive({
      [SHARES_LIST]: { files: [shared(1), shared(2), shared(3)] },
    });
    const source = new GoogleDriveSource(transport, { baseUrl: BASE });

    const listing = await source.listOwnedShareGrants({ maxSharedItems: 2 });

    expect(listing.kind).toBe('not_discoverable');
    if (listing.kind !== 'not_discoverable') return;
    expect(listing.reason).toContain('more than 2');
  });

  it('a failed listing is a stated blind spot, not an empty inventory (hard rule 9)', async () => {
    // fakeDrive answers 404 to anything without a route.
    const { transport } = fakeDrive({});
    const source = new GoogleDriveSource(transport, { baseUrl: BASE });

    const listing = await source.listOwnedShareGrants();

    expect(listing.kind).toBe('not_discoverable');
    if (listing.kind !== 'not_discoverable') return;
    expect(listing.reason).toContain('not "no permissions');
  });
});

describe('listOrphanedFiles — the coverage question (workplan 0058)', () => {
  it('reports files the account owns that NO walk from the root can reach', async () => {
    // Drive is the one provider where a file genuinely floats: delete a parent
    // without deleting its contents and the file stays owned, intact, and
    // reachable by search only. `listFolders` walks DOWN, so a pass never sees
    // it — not migrated, and until this existed nothing said so.
    const { transport } = fakeDrive({
      '/files?q=': {
        files: [
          { id: 'f1', name: 'floating.pdf' }, // no parents at all
          { id: 'f2', name: 'filed.pdf', parents: ['some-folder'] },
        ],
      },
    });
    const source = new GoogleDriveSource(transport, { baseUrl: BASE });

    const result = await source.listOrphanedFiles();

    expect(result.files).toEqual([{ id: 'f1', name: 'floating.pdf' }]);
    expect(result.capped).toBe(false);
  });

  it('asks only about files this account OWNS', async () => {
    // A file shared WITH the account has parents the account cannot see, so it
    // would read as orphaned for everyone on every pass. Those are the
    // documented shared-with-me case, not a coverage gap.
    const { transport, calls } = fakeDrive({ '/files?q=': { files: [] } });

    await new GoogleDriveSource(transport, { baseUrl: BASE }).listOrphanedFiles();

    expect(decodeURIComponent(calls[0]!.url)).toContain("'me' in owners");
  });

  it('says when the answer was capped rather than passing a partial list off as all', async () => {
    const { transport } = fakeDrive({
      '/files?q=': {
        files: [
          { id: 'f1', name: 'a.pdf' },
          { id: 'f2', name: 'b.pdf' },
        ],
      },
    });
    const source = new GoogleDriveSource(transport, { baseUrl: BASE });

    const result = await source.listOrphanedFiles({ maxItems: 1 });

    expect(result.files).toHaveLength(1);
    expect(result.capped, 'a short list read as the whole one is the failure here').toBe(true);
  });
});
