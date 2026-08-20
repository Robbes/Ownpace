// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The replay half (workplan 0042 T6), and the ways it must refuse.
 *
 * A replay's whole job is to make a recorded Drive available to CI. Its whole
 * DANGER is being quietly useless: a fixture that no longer matches the code
 * answering an empty listing, the connector reporting zero items, and the gate
 * going green having proved that nothing happened. So most of what follows is
 * about failing loudly rather than about serving correctly.
 *
 * These run against a hand-built capture, which is legitimate here and would
 * not be for the connector: what is under test IS the replay mechanism, and a
 * synthetic capture exercises it exactly. The connector's replay test is the
 * one that needs a recording from a real tenant, and it is not written yet
 * because there is nothing honest to write it against.
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { createReplayTransport } from './drive-replay.ts';
import type { DriveCapture } from './drive-capture.ts';

const LIST_URL = 'https://www.googleapis.com/drive/v3/files?q=root';
const EXPORT_URL = 'https://www.googleapis.com/drive/v3/files/id-1/export?mimeType=x';

function capture(exchanges: DriveCapture['exchanges']): DriveCapture {
  return { recordedAt: '2026-08-15T00:00:00Z', note: 'test fixture', exchanges };
}

const LISTING = capture([
  { url: LIST_URL, status: 200, json: { files: [{ id: 'id-1', name: 'f1.pdf' }] } },
]);

describe('serving what was recorded', () => {
  it('answers a recorded URL with the recorded body', async () => {
    const { transport } = createReplayTransport(LISTING);

    const response = await transport(LIST_URL);

    expect(response.ok).toBe(true);
    expect(await response.json()).toEqual({ files: [{ id: 'id-1', name: 'f1.pdf' }] });
  });

  it('serves repeats IN ORDER, not the first one twice', async () => {
    // The probe exports the same document twice on purpose, and those two
    // exchanges share a URL. A matcher that always returned the first would
    // replay a byte-stability test that can only pass.
    const twice = capture([
      { url: EXPORT_URL, status: 200, bytes: { sha256: 'aaa', byteLength: 3 } },
      { url: EXPORT_URL, status: 200, bytes: { sha256: 'bbb', byteLength: 7 } },
    ]);
    const replay = createReplayTransport(twice);

    const first = await replay.transport(EXPORT_URL);
    const second = await replay.transport(EXPORT_URL);

    expect((await first.arrayBuffer()).byteLength).toBe(3);
    expect((await second.arrayBuffer()).byteLength).toBe(7);
    expect(replay.recordedSha256(0)).toBe('aaa');
    expect(replay.recordedSha256(1)).toBe('bbb');
  });

  it('reports a recorded failure as a failure, not as an exception', async () => {
    // A 429 or a 403 is something Drive said, and the connector has its own
    // handling for it. The replay must let that code run.
    const refused = capture([{ url: LIST_URL, status: 429 }]);

    const response = await createReplayTransport(refused).transport(LIST_URL);

    expect(response.ok).toBe(false);
    expect(response.status).toBe(429);
  });

  it('says which recordings nothing asked for', async () => {
    // The other half of a stale fixture: not a call with no recording, but a
    // recording no call reached — a code path that quietly stopped running.
    const replay = createReplayTransport(
      capture([
        { url: LIST_URL, status: 200, json: { files: [] } },
        { url: EXPORT_URL, status: 200, bytes: { sha256: 'aaa', byteLength: 1 } },
      ]),
    );

    await replay.transport(LIST_URL);

    expect(replay.unplayed().map((e) => e.url)).toEqual([EXPORT_URL]);
  });
});

describe('the refusals, which are the point', () => {
  it('THROWS on a URL the fixture does not have, naming what it wanted', async () => {
    // The failure this file exists to prevent. Answering `{}` here would turn a
    // stale fixture into a green test.
    const { transport } = createReplayTransport(LISTING);

    await expect(transport('https://www.googleapis.com/drive/v3/files?q=other')).rejects.toThrow(
      /No recorded Drive answer/,
    );
    await expect(transport('https://www.googleapis.com/drive/v3/files?q=other')).rejects.toThrow(
      /q=other/,
    );
    // And it lists what IS there, so the reader can see the difference rather
    // than go hunting for the fixture.
    await expect(transport('https://www.googleapis.com/drive/v3/files?q=other')).rejects.toThrow(
      /q=root/,
    );
  });

  it('distinguishes "never recorded" from "recorded, already used up"', async () => {
    // Two different bugs. One means the code calls Drive differently from when
    // this was recorded; the other means it calls Drive MORE — a retry loop, a
    // duplicated pass — and telling somebody the URL is missing would send them
    // to the wrong place entirely.
    const { transport } = createReplayTransport(LISTING);
    await transport(LIST_URL);

    await expect(transport(LIST_URL)).rejects.toThrow(/already used/);
    await expect(transport(LIST_URL)).rejects.toThrow(/more times than Drive was asked/);
  });

  it('refuses to read a bytes answer as JSON, and the reverse', async () => {
    const mixed = capture([
      { url: LIST_URL, status: 200, json: { files: [] } },
      { url: EXPORT_URL, status: 200, bytes: { sha256: 'aaa', byteLength: 4 } },
    ]);
    const { transport } = createReplayTransport(mixed);

    const listing = await transport(LIST_URL);
    await expect(listing.arrayBuffer()).rejects.toThrow(/is JSON, not bytes/);

    const download = await transport(EXPORT_URL);
    await expect(download.json()).rejects.toThrow(/is bytes, not JSON/);
  });
});

describe('what a replay cannot give back', () => {
  it('hands out filler, whose hash is NOT the recorded one', async () => {
    // A capture stores a sha256 and a length, never content — that is the
    // redaction working. So a test can never re-derive the recorded hash from a
    // replayed download, and this pins that: somebody trying to make a failing
    // byte-stability assertion pass by re-hashing the replay would be comparing
    // a fixture with itself, and it would not even agree.
    const real = createHash('sha256').update(new Uint8Array([9, 9, 9, 9])).digest('hex');
    const one = capture([{ url: EXPORT_URL, status: 200, bytes: { sha256: real, byteLength: 4 } }]);
    const replay = createReplayTransport(one);

    const bytes = new Uint8Array(await (await replay.transport(EXPORT_URL)).arrayBuffer());
    const replayed = createHash('sha256').update(bytes).digest('hex');

    expect(bytes.byteLength, 'the LENGTH is real — Drive sent it').toBe(4);
    expect(replayed).not.toBe(real);
    expect(replay.recordedSha256(0), 'the real hash is reachable, from the record').toBe(real);
  });

  it('fills with something a human recognises as not a document', async () => {
    const one = capture([
      { url: EXPORT_URL, status: 200, bytes: { sha256: 'x', byteLength: 32 } },
    ]);

    const bytes = new Uint8Array(
      await (await createReplayTransport(one).transport(EXPORT_URL)).arrayBuffer(),
    );

    expect(Buffer.from(bytes).toString('ascii')).toContain('REDACTED-BYTES');
  });
});
