// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE MEASUREMENT THAT CANNOT BE RE-TAKEN (workplan 0042 T3 and T6, ADR-0046).
 *
 * `EXPORT_STABILITY` is written from the output of
 * `scripts/drive-export-stability.ts`. The connector refuses what that table
 * calls `unstable`. And the script measures THROUGH the connector, on purpose —
 * its own comment says why: the question is "what would a MIGRATION store", and
 * a hand-rolled export answers a different question.
 *
 * Those three facts closed a circle. On 2026-09-16 the refusal landed and the
 * instrument stopped being able to measure the two combinations its own output
 * had condemned: `export-office` on a Slide, `export-odf` on a Doc. Nobody
 * noticed for a day, because the cases that still worked were the ones anybody
 * would think to run.
 *
 * ## Why that is worse than an inconvenience
 *
 * A red verdict becomes PERMANENT BY CONSTRUCTION. Google rebuilding its
 * `.pptx` exporter tomorrow would change nothing here: the one instrument that
 * could observe the fix refuses to look, and the only route back to green is
 * somebody editing the table by hand — which is precisely the "moving an entry
 * on a guess" the three-answer table exists to prevent. A measurement you
 * cannot repeat is not a measurement; it is a recorded opinion with a date on
 * it.
 *
 * ## The shape of the escape, and why it is shaped like that
 *
 * A third constructor argument, `{ exportDespiteMeasuredInstability: true }`,
 * and nothing else lifts the refusal. Deliberately NOT a field on
 * `GoogleDriveSourceConfig`: that type is parsed from an appliance's config
 * file and from a managed connection's stored row, so anything in it is
 * reachable by a customer or an operator typing a key. The refusal is the only
 * thing standing between a Slides deck and a library rewritten nightly, and it
 * must not have a text-file route around it.
 *
 * So this file holds both halves: that the escape WORKS for the instrument, and
 * that no production call site has taken it.
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

describe('the instrument can take the reading its own output condemned', () => {
  it('refuses a Slides deck under export-office for an ordinary caller', () => {
    // The gate, unchanged. This is the behaviour the whole refusal exists for
    // and the escape below must not weaken it.
    const source = new GoogleDriveSource(transportFor(`${G}presentation`), {
      nativeFilePolicy: 'export-office',
    });

    return expect(source.fetch(deck)).rejects.toBeInstanceOf(NativeFileRefused);
  });

  it('exports the same deck when the caller says it is measuring', async () => {
    // Red before the fix: this threw `NativeFileRefused`, which is exactly what
    // stopped `export-office` on a Slide from ever being measured again.
    const source = new GoogleDriveSource(
      transportFor(`${G}presentation`),
      { nativeFilePolicy: 'export-office' },
      { exportDespiteMeasuredInstability: true },
    );

    const got = await source.fetch(deck);

    expect(got.content, 'the instrument got no bytes to hash').toBeDefined();
    expect(got.content?.byteLength).toBe(BYTES.byteLength);
  });

  it('still marks those bytes as a rendering, so a draw is hashed as one', async () => {
    // The measurement must see what a migration would see, including the flag
    // that decides WHICH hash settles it. An exempted export that arrived
    // unmarked would measure a different thing from the one being asked about.
    const source = new GoogleDriveSource(
      transportFor(`${G}presentation`),
      { nativeFilePolicy: 'export-office' },
      { exportDespiteMeasuredInstability: true },
    );

    expect((await source.fetch(deck)).rendering).toBe(true);
  });

  it('lifts ONLY the stability refusal — `refuse` still refuses', async () => {
    // The exemption is about one verdict, not about the policy system. An
    // instrument pointed at `refuse` is asking a question with no answer, and
    // it must still be told so.
    const source = new GoogleDriveSource(
      transportFor(`${G}presentation`),
      { nativeFilePolicy: 'refuse' },
      { exportDespiteMeasuredInstability: true },
    );

    await expect(source.fetch(deck)).rejects.toBeInstanceOf(NativeFileRefused);
  });

  it('lifts ONLY the stability refusal — a Form still has nothing to export', async () => {
    // Drive renders a Form in no format at all. No exemption can conjure bytes
    // that do not exist, and pretending otherwise would turn a clear refusal
    // into a confusing transport error.
    const source = new GoogleDriveSource(
      transportFor(`${G}form`),
      { nativeFilePolicy: 'export-office' },
      { exportDespiteMeasuredInstability: true },
    );

    await expect(source.fetch(deck)).rejects.toBeInstanceOf(NativeFileRefused);
  });
});

describe('and no migration has taken that escape', () => {
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

  it('is named in scripts/ and in the connector, and nowhere else', () => {
    // The joining assertion. A production call site taking this escape would
    // not fail any behavioural test — the decks would export, the pass would be
    // green, and the damage would arrive as a storage bill weeks later. That is
    // the same failure shape the refusal itself was built against, so it gets
    // the same kind of guard: a list somebody has to edit.
    const ALLOWED = [
      // The connector: the escape is declared and honoured here.
      'packages/connectors/src/google-drive-source.ts',
      // The instrument, which is the whole reason it exists.
      'scripts/drive-export-stability.ts',
      // This file.
      'scripts/an-instrument-that-cannot-take-its-own-reading.unit.test.ts',
    ];

    const offenders: string[] = [];
    for (const dir of ['apps', 'packages', 'scripts']) {
      for (const file of sourcesUnder(join(ROOT, dir))) {
        const rel = relative(ROOT, file);
        if (ALLOWED.includes(rel)) continue;
        if (readFileSync(file, 'utf8').includes('exportDespiteMeasuredInstability')) {
          offenders.push(rel);
        }
      }
    }

    expect(
      offenders,
      'these files lift the measured-instability refusal. That refusal is the only thing ' +
        'between a Google Slides deck and a library re-copied every night, with every write ' +
        'succeeding and nothing in any report saying so. It exists for the measurement script ' +
        'and for nothing else — if a migration path genuinely needs it, that is a product ' +
        'decision and a workplan row, not a third argument.',
    ).toEqual([]);
  });

  it('is not reachable through the config a customer or operator can write', () => {
    // The reason it is a positional argument. `GoogleDriveSourceConfig` is
    // parsed from an appliance's config file and a managed connection's row; a
    // field there would be a text-file route around the refusal.
    const schema = readFileSync(join(ROOT, 'packages/shared/src/config.ts'), 'utf8');
    expect(
      schema,
      'the measuring escape has become a config key, so a config file can now turn off a ' +
        'refusal that exists to stop a nightly rewrite',
    ).not.toMatch(/exportDespiteMeasuredInstability/);
  });
});
