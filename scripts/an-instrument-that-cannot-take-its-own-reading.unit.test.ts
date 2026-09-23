// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE MEASUREMENT THAT COULD NOT BE RE-TAKEN (workplan 0042 T3 and T6, ADR-0046).
 *
 * `EXPORT_STABILITY` is written from the output of
 * `scripts/drive-export-stability.ts`, and the script measures THROUGH the
 * connector, on purpose: the question is "what would a MIGRATION store", and a
 * hand-rolled export answers a different one.
 *
 * On 2026-09-16 the connector began refusing what that table calls
 * `unstable`, and the instrument stopped being able to measure the two
 * combinations its own output had condemned: `export-office` on a Slide,
 * `export-odf` on a Doc. A red became permanent by construction: the one
 * instrument that could observe Google fixing an exporter refused to look. The
 * way out then was a third constructor argument only the script passed.
 *
 * ## What holds now
 *
 * Since 2026-09-23 no measurement refuses an export (ADR-0046, amended): a
 * rewrite follows Drive's modified time rather than the bytes, and a renamed
 * document is paired by its Drive id. So the instrument measures through the
 * connector exactly as a migration does, with nothing to lift, and the third
 * argument is gone. This file holds that: any caller can export the two
 * combinations, the bytes are still marked a rendering, the refusals that are
 * about the file rather than the measurement still stand, and no way past a
 * refusal has come back.
 */

import { describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  GoogleDriveSource,
  NativeFileRefused,
  type DriveResponse,
  type DriveTransport,
} from '@openmig/connectors';

const ROOT = join(import.meta.dirname, '..');
const G = 'application/vnd.google-apps.';
const BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x09]);

/** Answers the metadata read with `mimeType`, and anything else with bytes. */
function transportFor(mimeType: string): DriveTransport {
  return vi.fn(async (url: string) => {
    if (url.includes('fields=id,name,mimeType')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: 'file-1', name: 'Thema-avond', mimeType }),
        text: async () => '',
      } as unknown as DriveResponse;
    }
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => BYTES.buffer.slice(0),
      text: async () => '',
    } as unknown as DriveResponse;
  }) as unknown as DriveTransport;
}

const deck = {
  path: 'Thema-avond',
  isDirectory: false,
  size: 0,
  modifiedAt: '2025-08-10T14:07:31.850Z',
  sourceRef: 'file-1',
};

describe('the instrument takes the reading its own output once condemned', () => {
  it('exports a Slides deck under export-office for an ordinary caller', async () => {
    // Refused from 2026-09-16 to 2026-09-23, which is exactly what stopped
    // `export-office` on a Slide from ever being measured again.
    const source = new GoogleDriveSource(transportFor(`${G}presentation`), {
      nativeFilePolicy: 'export-office',
    });

    const got = await source.fetch(deck);

    expect(got.content, 'the instrument got no bytes to hash').toBeDefined();
    expect(got.content?.byteLength).toBe(BYTES.byteLength);
  });

  it('exports a Doc under export-odf the same way', async () => {
    const source = new GoogleDriveSource(transportFor(`${G}document`), {
      nativeFilePolicy: 'export-odf',
    });

    expect((await source.fetch(deck)).content?.byteLength).toBe(BYTES.byteLength);
  });

  it('still marks those bytes as a rendering, so a draw is hashed as one', async () => {
    // The measurement must see what a migration would see, including the flag
    // that decides WHICH hash settles it.
    const source = new GoogleDriveSource(transportFor(`${G}presentation`), {
      nativeFilePolicy: 'export-office',
    });

    expect((await source.fetch(deck)).rendering).toBe(true);
  });

  it('still refuses under `refuse`: a question with no answer', async () => {
    const source = new GoogleDriveSource(transportFor(`${G}presentation`), {
      nativeFilePolicy: 'refuse',
    });

    await expect(source.fetch(deck)).rejects.toBeInstanceOf(NativeFileRefused);
  });

  it('still refuses a Form: Drive renders it in no format at all', async () => {
    const source = new GoogleDriveSource(transportFor(`${G}form`), {
      nativeFilePolicy: 'export-office',
    });

    await expect(source.fetch(deck)).rejects.toBeInstanceOf(NativeFileRefused);
  });
});

describe('and no way past a refusal has come back', () => {
  /** Every `.ts` under a directory, skipping `node_modules` and `dist`. */
  function sourcesUnder(dir: string, found: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === 'dist' || entry === '.git') continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) sourcesUnder(full, found);
      else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) found.push(full);
    }
    return found;
  }

  it('the measuring escape is named nowhere but in this file', () => {
    // If a refusal on the measurements is ever put back, it has to come back
    // with its reason and a workplan row, not with a private bypass for one
    // caller, which is how the instrument lost its reading the first time.
    const offenders: string[] = [];
    for (const dir of ['apps', 'packages', 'scripts']) {
      for (const file of sourcesUnder(join(ROOT, dir))) {
        const rel = relative(ROOT, file);
        if (rel === 'scripts/an-instrument-that-cannot-take-its-own-reading.unit.test.ts') continue;
        if (readFileSync(file, 'utf8').includes('exportDespiteMeasuredInstability')) {
          offenders.push(rel);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
