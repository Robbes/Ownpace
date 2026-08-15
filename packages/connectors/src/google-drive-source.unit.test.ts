// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

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
import { GoogleDriveSource, NativeFileRefused, isNativeEditorFile } from './google-drive-source';
import type { DriveTransport } from './google-drive-source.types';

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
