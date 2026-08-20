// Copyright 2026 The Ownpace authors (Apache-2.0)

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
import { createRecordingTransport, type RecordableTransport } from './drive-capture.ts';

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
      modifiedTime: '2026-08-01T10:00:00Z',
    });
    // The checksum is NOT among them — it fingerprints the customer's content.
    // Its presence and its length are what a replay uses; see the leak tests.
    expect(body.files[0]!.md5Checksum).not.toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(body.files[0]!.md5Checksum).toHaveLength(32);
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

/**
 * The two that got through the first draft, and how.
 *
 * Both were found by re-reading the order of operations rather than by a test
 * failing, which is worth saying: a redactor's bugs do not announce themselves.
 * The capture is written, it looks redacted, and the one field that is not sits
 * in the middle of it.
 */
describe('the leaks that survived the first draft', () => {
  it('does not write the ROOT folder id, which appears in no response body', async () => {
    // The listing query carries `'{root}' in parents`, and when the owner points
    // the migration at a SHARED DRIVE that root is the drive's own id. The
    // connector's field mask never asks Drive to echo `parents` back, so the id
    // reached no body, was never given a pseudonym, and went into the fixture's
    // first URL verbatim.
    const { transport, capture } = createRecordingTransport(
      transportFor([{ json: { files: [] } }]),
    );

    await transport(
      "https://www.googleapis.com/drive/v3/files?q=" +
        encodeURIComponent("'0AJxRealSharedDriveId' in parents and trashed=false"),
    );

    expect(JSON.stringify(capture())).not.toContain('0AJxRealSharedDriveId');
  });

  it('does not write a file id named in the URL before its body arrives', async () => {
    // `DRIVE_FILE_ID` points the probe at one document, and its metadata call
    // carries the id in the PATH — recorded before the response that would have
    // registered it.
    const { transport, capture } = createRecordingTransport(
      transportFor([{ json: { id: 'RealFileId123', name: 'x' } }]),
    );

    await transport('https://www.googleapis.com/drive/v3/files/RealFileId123?fields=id,name');

    expect(JSON.stringify(capture())).not.toContain('RealFileId123');
  });

  it('gives a URL id and the SAME id in a later body one pseudonym', async () => {
    // The registering fix must not create a second identity: if the URL's id
    // and the body's id disagreed, the fixture would describe two files where
    // Drive had one.
    const { transport, capture } = createRecordingTransport(
      transportFor([{ json: { id: 'RealFileId123', name: 'x' } }]),
    );

    await transport('https://www.googleapis.com/drive/v3/files/RealFileId123?fields=id,name');

    const { exchanges } = capture();
    const inBody = (exchanges[0]?.json as { id: string }).id;
    expect(exchanges[0]?.url).toContain(inBody);
  });

  it('does not write a CHECKSUM, which fingerprints the customer’s content', async () => {
    // Not a name, and still theirs: anybody holding a candidate file can
    // confirm from an md5 that this Drive held that exact file. A replay needs a
    // checksum to exist and be stable, never its value.
    const { transport, capture } = createRecordingTransport(
      transportFor([
        {
          json: {
            files: [
              { id: 'a', name: 'x.pdf', md5Checksum: 'd41d8cd98f00b204e9800998ecf8427e' },
              { id: 'b', name: 'y.pdf', md5Checksum: 'd41d8cd98f00b204e9800998ecf8427e' },
            ],
          },
        },
      ]),
    );

    await transport('https://www.googleapis.com/drive/v3/files?q=x');

    const recorded = JSON.stringify(capture());
    expect(recorded).not.toContain('d41d8cd98f00b204e9800998ecf8427e');

    const files = (capture().exchanges[0]?.json as { files: Array<{ md5Checksum: string }> }).files;
    // Present, same LENGTH, and — the property a replay actually uses — two
    // files with identical content still agree with each other.
    expect(files[0]!.md5Checksum).toHaveLength(32);
    expect(files[0]!.md5Checksum).toBe(files[1]!.md5Checksum);
  });
});

/**
 * What an adversarial audit found that the first two rounds of tests did not.
 *
 * Five independent readers went at this file hunting for anything of the
 * customer's that survives, and each finding was then attacked by a separate
 * reader trying to refute it. What follows is what survived that, and every one
 * of them was invisible to the leak tests already here — which is the lesson
 * worth keeping: a redactor's own test suite tends to be written from the same
 * assumptions as the redactor.
 */
describe('what the audit found', () => {
  it('does not smuggle the name out inside the "extension"', async () => {
    // `slice(lastIndexOf('.'))` returns everything after the last dot, however
    // long and whatever it contains. And it lands hardest on exactly the files
    // this recorder exists for: a native Google Doc has NO filename extension,
    // so for every Doc, Sheet and Slide any dot in the name is a false one.
    const { transport, capture } = createRecordingTransport(
      transportFor([
        {
          json: {
            files: [
              { id: 'a', name: 'Mr. Jansen severance', mimeType: 'application/vnd.google-apps.document' },
              { id: 'b', name: 'notulen 12.03.2026 ontslag Jansen', mimeType: 'application/pdf' },
              { id: 'c', name: 'vaststelling R.Berentsen definitief', mimeType: 'application/pdf' },
            ],
          },
        },
      ]),
    );

    await transport('https://www.googleapis.com/drive/v3/files?q=x');
    const recorded = JSON.stringify(capture());

    expect(recorded).not.toContain('Jansen');
    expect(recorded).not.toContain('Berentsen');
    expect(recorded).not.toContain('ontslag');
    expect(recorded).not.toContain('2026 ontslag');
  });

  it('still keeps a REAL extension, which is what the tail was there for', async () => {
    const { transport, capture } = createRecordingTransport(
      transportFor([
        { json: { files: [{ id: 'a', name: 'board pack.pdf', mimeType: 'application/pdf' }] } },
      ]),
    );

    await transport('https://www.googleapis.com/drive/v3/files?q=x');

    const files = (capture().exchanges[0]?.json as { files: Array<{ name: string }> }).files;
    expect(files[0]!.name).toMatch(/^f\d+\.pdf$/);
  });

  it('does not write the real page TOKEN into the next request URL', async () => {
    // The token is pseudonymised in the body, and the connector then puts the
    // real one into the following request. Scrubbing only bodies left it in
    // every page-2 URL — and left the fixture unreplayable, since the body said
    // one thing and the URL said another.
    const real = '~!!~AI9FV7QK3nOpAqUeR2sTuVwXyZ';
    const { transport, capture } = createRecordingTransport(
      transportFor([
        { json: { files: [], nextPageToken: real } },
        { json: { files: [] } },
      ]),
    );

    await transport('https://www.googleapis.com/drive/v3/files?q=x');
    await transport(`https://www.googleapis.com/drive/v3/files?q=x&pageToken=${encodeURIComponent(real)}`);

    const recorded = JSON.stringify(capture());
    expect(recorded).not.toContain('AI9FV7QK3nOpAqUeR2sTuVwXyZ');

    // And the two halves agree, or no paginated capture could ever replay.
    const body = capture().exchanges[0]?.json as { nextPageToken: string };
    expect(capture().exchanges[1]?.url).toContain(body.nextPageToken);
  });

  it('does not leave a FRAGMENT of a longer id behind', async () => {
    // Plain substring replacement, and Drive ids are not prefix-free: replacing
    // a short id first rewrites the middle of a longer one that contains it and
    // leaves the rest — part of a real id — in the fixture.
    const shortId = 'AbCdEf';
    const longId = 'AbCdEfGhIjKlMnOp';
    const { transport, capture } = createRecordingTransport(
      transportFor([{ json: { files: [{ id: shortId, name: 'x.pdf' }, { id: longId, name: 'y.pdf' }] } }]),
    );

    await transport(`https://www.googleapis.com/drive/v3/files/${longId}?fields=id`);
    await transport('https://www.googleapis.com/drive/v3/files?q=x');

    const recorded = JSON.stringify(capture());
    expect(recorded).not.toContain('GhIjKlMnOp');
  });

  it('gives the 1st and the 10th checksum DIFFERENT pseudonyms', async () => {
    // Padding a decimal counter with zeroes collides: `checksum1` and
    // `checksum10` padded to 32 with '0' are the same string, so two unrelated
    // files would claim identical content — a duplicate Drive never had.
    const files = Array.from({ length: 10 }, (_, i) => ({
      id: `id${i}`,
      name: `f${i}.pdf`,
      md5Checksum: `${i}`.repeat(32).slice(0, 32),
    }));
    const { transport, capture } = createRecordingTransport(transportFor([{ json: { files } }]));

    await transport('https://www.googleapis.com/drive/v3/files?q=x');

    const out = (capture().exchanges[0]?.json as { files: Array<{ md5Checksum: string }> }).files;
    expect(new Set(out.map((f) => f.md5Checksum)).size).toBe(10);
  });

  it('does not give a folder and a file sharing a name ONE pseudonym', async () => {
    const { transport, capture } = createRecordingTransport(
      transportFor([
        {
          json: {
            files: [
              { id: 'a', name: 'Archive', mimeType: 'application/vnd.google-apps.folder' },
              { id: 'b', name: 'Archive', mimeType: 'application/pdf' },
            ],
          },
        },
      ]),
    );

    await transport('https://www.googleapis.com/drive/v3/files?q=x');

    const out = (capture().exchanges[0]?.json as { files: Array<{ name: string }> }).files;
    expect(out[0]!.name).toMatch(/^folder-/);
    expect(out[1]!.name).not.toBe(out[0]!.name);
  });
});

describe('a FAILURE is recorded as one, with its reason', () => {
  function failing(status: number, body: string): RecordableTransport {
    return async () => ({
      ok: false,
      status,
      json: async () => ({}),
      arrayBuffer: async () => new ArrayBuffer(0),
      text: async () => body,
    });
  }

  it('hands the caller what Drive said, in full', async () => {
    // Rule 9, on the one manual run against a real tenant. The first version
    // read the body only on success and answered `text: () => ''`, so enabling
    // the capture silently blanked the reason for every 403, 404 and 429 — the
    // exact things that have to be diagnosable remotely.
    const reason = '{"error":{"code":403,"message":"Request had insufficient authentication scopes."}}';
    const { transport } = createRecordingTransport(failing(403, reason));

    const response = await transport('https://www.googleapis.com/drive/v3/files?q=x');

    expect(response.ok).toBe(false);
    expect(await response.text()).toBe(reason);
  });

  it('records the reason SCRUBBED, since an error body echoes ids back', async () => {
    const { transport, capture } = createRecordingTransport(
      failing(404, '{"error":{"message":"File not found: RealFileId123."}}'),
    );

    await transport('https://www.googleapis.com/drive/v3/files/RealFileId123?fields=id');

    const recorded = JSON.stringify(capture());
    expect(recorded).not.toContain('RealFileId123');
    expect(recorded).toContain('File not found');
  });

  it('does NOT record a failed export as document bytes', async () => {
    // Recording an error body as `bytes` gave two identical failures the same
    // sha256, which a byte-stability test would read as "stable" — a green tick
    // for a document that never exported once.
    const { transport, capture } = createRecordingTransport(failing(403, 'no export for you'));

    await transport('https://www.googleapis.com/drive/v3/files/x/export?mimeType=y');

    const [exchange] = capture().exchanges;
    expect(exchange?.bytes).toBeUndefined();
    expect(exchange?.text).toContain('no export');
  });
});

describe('scrubbing prose is not scrubbing a URL', () => {
  it('does not rewrite the inside of an ordinary word', async () => {
    // Found by a test, not by reading: a blind substring replacement over an
    // error body turned `no export for you` into `no eid-1port for you`,
    // because the id happened to be `x`. An error body is prose Google composed,
    // and it needs boundaries.
    const failing: RecordableTransport = async () => ({
      ok: false,
      status: 403,
      json: async () => ({}),
      arrayBuffer: async () => new ArrayBuffer(0),
      text: async () => 'no export for you',
    });
    const { transport, capture } = createRecordingTransport(failing);

    await transport('https://www.googleapis.com/drive/v3/files/x/export?mimeType=y');

    expect(capture().exchanges[0]?.text).toBe('no export for you');
  });

  it('still replaces a real id standing on its own in the prose', async () => {
    const id = 'A1bC2dE3fG4hI5jK6lM7nO8p';
    const failing: RecordableTransport = async () => ({
      ok: false,
      status: 404,
      json: async () => ({}),
      arrayBuffer: async () => new ArrayBuffer(0),
      text: async () => `File not found: ${id}.`,
    });
    const { transport, capture } = createRecordingTransport(failing);

    await transport(`https://www.googleapis.com/drive/v3/files/${id}?fields=id`);

    expect(capture().exchanges[0]?.text).not.toContain(id);
    expect(capture().exchanges[0]?.text).toContain('File not found');
  });
});
