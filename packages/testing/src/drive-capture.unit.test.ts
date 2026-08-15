// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The redaction, which is the only part of a fixture recorder that can hurt
 * somebody (workplan 0042 T6).
 *
 * A capture is taken from a real customer's Drive and lands in a public
 * repository. So the tests that matter are not "does it record" — they are
 * "does anything of theirs survive". Each one below names a specific thing that
 * must not come out the other side, and the structural facts a replay genuinely
 * needs are asserted alongside, because a redactor that threw those away would
 * be safe and useless.
 */

import { describe, it, expect } from 'vitest';
import { createRecordingTransport, type RecordableTransport } from './drive-capture';

const REAL_LISTING = {
  files: [
    {
      id: '1AbCdEfGhIjKlMnOpQrStUvWxYz',
      name: 'Q3 board pack — CONFIDENTIAL.pdf',
      mimeType: 'application/pdf',
      size: '204813',
      md5Checksum: 'd41d8cd98f00b204e9800998ecf8427e',
      modifiedTime: '2026-08-01T10:00:00Z',
      parents: ['0BxSharedDriveId'],
    },
    {
      id: '2ZyXwVuTsRqPoNmLkJiHgFeDcBa',
      name: 'Salaries 2026',
      mimeType: 'application/vnd.google-apps.spreadsheet',
      modifiedTime: '2026-08-02T11:00:00Z',
    },
    {
      id: '3FolderIdentifier',
      name: 'HR — do not share',
      mimeType: 'application/vnd.google-apps.folder',
    },
  ],
  nextPageToken: '~!!~AI9FV7QK3nOpAqUeR2sTuVwXyZ',
};

function transportFor(answers: Array<{ json?: unknown; bytes?: Uint8Array }>): RecordableTransport {
  const queue = [...answers];
  return async () => {
    const answer = queue.length > 1 ? queue.shift()! : queue[0]!;
    return {
      ok: true,
      status: 200,
      json: async () => answer.json ?? {},
      arrayBuffer: async () => (answer.bytes ?? new Uint8Array()).buffer as ArrayBuffer,
      text: async () => '',
    };
  };
}

describe('what must not survive a recording', () => {
  it('keeps NO file or folder name from the customer', async () => {
    const { transport, capture } = createRecordingTransport(transportFor([{ json: REAL_LISTING }]));
    await transport('https://www.googleapis.com/drive/v3/files?q=x');

    const recorded = JSON.stringify(capture());

    expect(recorded).not.toContain('Q3 board pack');
    expect(recorded).not.toContain('CONFIDENTIAL');
    expect(recorded).not.toContain('Salaries');
    expect(recorded).not.toContain('HR — do not share');
  });

  it('keeps NO Drive id, including the one in the URL', async () => {
    const { transport, capture } = createRecordingTransport(transportFor([{ json: REAL_LISTING }]));
    await transport('https://www.googleapis.com/drive/v3/files?q=x');
    // The metadata fetch that follows names the file in its PATH, which is the
    // place an id most easily escapes a body-only redactor.
    await transport(
      'https://www.googleapis.com/drive/v3/files/1AbCdEfGhIjKlMnOpQrStUvWxYz?fields=id,name',
    );

    const recorded = JSON.stringify(capture());

    expect(recorded).not.toContain('1AbCdEfGhIjKlMnOpQrStUvWxYz');
    expect(recorded).not.toContain('0BxSharedDriveId');
    expect(recorded).not.toContain('3FolderIdentifier');
  });

  it('keeps NO page token, which is an opaque server cursor', async () => {
    const { transport, capture } = createRecordingTransport(transportFor([{ json: REAL_LISTING }]));
    await transport('https://www.googleapis.com/drive/v3/files?q=x');

    const recorded = JSON.stringify(capture());

    expect(recorded).not.toContain('AI9FV7QK3nOpAqUeR2sTuVwXyZ');
    // Its PRESENCE survives, because it drives the pagination loop a replay has
    // to exercise. Redacting it out of existence would hide a whole code path.
    expect(recorded).toContain('page-token');
  });

  it('keeps NO document bytes — only what arrived, and how much', async () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
    const { transport, capture } = createRecordingTransport(transportFor([{ bytes }]));

    await transport('https://www.googleapis.com/drive/v3/files/abc/export?mimeType=x');

    const [exchange] = capture().exchanges;
    expect(exchange?.bytes?.byteLength).toBe(6);
    expect(exchange?.bytes?.sha256).toHaveLength(64);
    expect(JSON.stringify(capture())).not.toContain('UEsDBBQA');
  });
});

describe('what a replay still needs, and therefore survives', () => {
  it('keeps every structural field verbatim', async () => {
    const { transport, capture } = createRecordingTransport(transportFor([{ json: REAL_LISTING }]));
    await transport('https://www.googleapis.com/drive/v3/files?q=x');

    const body = capture().exchanges[0]?.json as { files: Array<Record<string, unknown>> };

    expect(body.files[0]).toMatchObject({
      mimeType: 'application/pdf',
      size: '204813',
      md5Checksum: 'd41d8cd98f00b204e9800998ecf8427e',
      modifiedTime: '2026-08-01T10:00:00Z',
    });
    // The native file's absent size and checksum are themselves the fact that
    // makes it native. A redactor that invented values would erase the case.
    expect(body.files[1]).not.toHaveProperty('size');
    expect(body.files[1]!.mimeType).toBe('application/vnd.google-apps.spreadsheet');
  });

  it('keeps the file EXTENSION, which path derivation depends on', async () => {
    const { transport, capture } = createRecordingTransport(transportFor([{ json: REAL_LISTING }]));
    await transport('https://www.googleapis.com/drive/v3/files?q=x');

    const body = capture().exchanges[0]?.json as { files: Array<{ name: string }> };
    expect(body.files[0]!.name).toMatch(/\.pdf$/);
    // A folder is named as one, so a replay can still tell the tree apart.
    expect(body.files[2]!.name).toMatch(/^folder-/);
  });

  it('gives one real id ONE pseudonym, in the body and in a later URL alike', async () => {
    // The property everything else rests on: a listing and the metadata fetch
    // that follows must still be talking about the same file, or the fixture
    // describes a Drive that never existed.
    const { transport, capture } = createRecordingTransport(
      transportFor([{ json: REAL_LISTING }, { json: { id: '1AbCdEfGhIjKlMnOpQrStUvWxYz' } }]),
    );
    await transport('https://www.googleapis.com/drive/v3/files?q=x');
    await transport('https://www.googleapis.com/drive/v3/files/1AbCdEfGhIjKlMnOpQrStUvWxYz');

    const { exchanges } = capture();
    const listed = (exchanges[0]?.json as { files: Array<{ id: string }> }).files[0]!.id;
    const fetched = (exchanges[1]?.json as { id: string }).id;

    expect(fetched).toBe(listed);
    expect(exchanges[1]?.url).toContain(listed);
  });

  it('hands the caller a response it can still read', async () => {
    // The recorder consumes each body to record it. A wrapper that did not give
    // one back would break the very call it is observing — and the probe would
    // fail in a way that looked like Drive's fault.
    const bytes = new Uint8Array([1, 2, 3]);
    const { transport } = createRecordingTransport(
      transportFor([{ json: { files: [] } }, { bytes }]),
    );

    const listing = await transport('https://www.googleapis.com/drive/v3/files?q=x');
    expect(await listing.json()).toEqual({ files: [] });

    const download = await transport('https://www.googleapis.com/drive/v3/files/x?alt=media');
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(bytes);
  });

  it('says in the fixture itself what it is and is not', async () => {
    // A fixture outlives the conversation that produced it, and the next reader
    // will not have been here to be told.
    const { transport, capture } = createRecordingTransport(transportFor([{ json: { files: [] } }]));
    await transport('https://www.googleapis.com/drive/v3/files?q=x');

    expect(capture().note).toMatch(/REDACTED/);
    expect(capture().note).toMatch(/says nothing about any particular document/);
  });
});
