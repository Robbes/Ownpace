// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A COUNT THAT EXCEEDS WHAT GOOGLE SAYS YOU HAVE.
 *
 * Workplan 0116 T7, and the arithmetic is the whole of it.
 *
 * §4's owner decision of 2026-09-04 is that an edited photo and a motion clip
 * are **distinct items**, each with their own bytes and their own hash, rather
 * than attributes of one record. The reason is data loss: Google Photos shows
 * the EDITED version by default, so a single-record design writes the
 * original's bytes and silently discards the version the person has been
 * looking at for years and calls "my photo".
 *
 * The price of that decision is a number that looks wrong. A person with three
 * thousand photos in Google Photos is shown **four thousand items** by this
 * product, and their entirely reasonable conclusion is that something has gone
 * wrong — most likely that we are about to duplicate their library.
 *
 * So the measure may not show the total alone. It must **break it down and say
 * why**, on the same line, in the same breath. This file holds three things
 * shut:
 *
 *  1. the classifier tells the three apart, and never invents a relationship
 *     to something that is not in the archive;
 *  2. the breakdown ADDS UP — a breakdown that does not sum to the total makes
 *     the total look wrong as well, which is worse than showing no breakdown;
 *  3. the sentence a person reads names the excess before they can be
 *     surprised by it.
 *
 * ## And the snapshot
 *
 * The other half of T7 is one sentence no other source in this product needs:
 * an archive answers with the day it was prepared, forever. A count of 12,431
 * items means nothing without the span it covers and the fact that nothing
 * after the export date is in it.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ARCHIVE_ITEM_KINDS } from '@openmig/core/archive-reader';
import {
  classifyMedia,
  stillsByStem,
  createTakeoutArchiveReader,
} from '@openmig/connectors';
import { qualifyArchive } from './account-qualification.ts';

describe('telling the three things apart', () => {
  const stills = stillsByStem(['IMG_0001.jpg', 'IMG_0002.heic', 'CLIP_ONLY.mp4']);

  it('an ordinary photo is an original, related to nothing', () => {
    expect(classifyMedia('IMG_0001.jpg', stills)).toEqual({ kind: 'original' });
  });

  it('an edit points at the original it was made from', () => {
    expect(classifyMedia('IMG_0001-edited.jpg', stills)).toEqual({
      kind: 'edited',
      relatedTo: 'IMG_0001.jpg',
    });
  });

  it('a motion clip points at its still, ACROSS the extension', () => {
    // The pairing is by stem, and the two files do not share an extension —
    // which is the point: a map from stem to the still's real NAME is what
    // makes `relatedTo` a path somebody can look up, rather than a stem
    // nothing is keyed by.
    expect(classifyMedia('IMG_0002.mp4', stills)).toEqual({
      kind: 'motion',
      relatedTo: 'IMG_0002.heic',
    });
  });

  it('an MP4 with no still is a VIDEO, not a motion clip', () => {
    // A person films things. Calling every MP4 a motion photo would both
    // mislabel their videos and invent a `relatedTo` pointing at nothing,
    // which placement would then have to special-case forever.
    expect(classifyMedia('CLIP_ONLY.mp4', stills)).toEqual({ kind: 'original' });
  });

  it('an edit whose original is gone is still an edit, and points at nothing', () => {
    // A real state: you can delete an original in Photos and keep the edit.
    // A dangling pointer would be worse than no pointer.
    expect(classifyMedia('DELETED-edited.jpg', stills)).toEqual({ kind: 'edited' });
  });

  it('an edited still never becomes the target of a pairing', () => {
    // `IMG_0001-edited.jpg` must not claim the stem `IMG_0001-edited`, or
    // `IMG_0001-edited.mp4` would pair with the EDIT while the original sits
    // right beside it.
    expect(stillsByStem(['IMG.jpg', 'IMG-edited.jpg']).get('IMG-edited')).toBeUndefined();
    expect(stillsByStem(['IMG.jpg', 'IMG-edited.jpg']).get('IMG')).toBe('IMG.jpg');
  });

  it('two stills sharing a stem pair the same way on every run', () => {
    // `readdir` order is alphabetical accident, and this reader has already
    // produced one defect from trusting it (the sidecar sought beside
    // whichever copy came back first).
    const a = stillsByStem(['IMG.jpg', 'IMG.heic']).get('IMG');
    const b = stillsByStem(['IMG.heic', 'IMG.jpg']).get('IMG');
    expect(a).toBe(b);
  });
});

const made: string[] = [];

afterEach(async () => {
  await Promise.all(made.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

/** A library of two photos, one of which is edited and one of which moves. */
async function mixedTakeout(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'takeout-measure-'));
  made.push(root);
  const photos = join(root, 'Takeout', 'Google Photos', 'Photos from 2024');
  await mkdir(photos, { recursive: true });
  // Distinct bytes per file: same bytes would be collapsed as one item by the
  // reader's de-duplication, which is correct and would hide what is measured.
  await writeFile(join(photos, 'IMG_0001.jpg'), Buffer.from('original one'));
  await writeFile(join(photos, 'IMG_0001-edited.jpg'), Buffer.from('the edit'));
  await writeFile(join(photos, 'IMG_0002.jpg'), Buffer.from('original two'));
  await writeFile(join(photos, 'IMG_0002.mp4'), Buffer.from('the motion clip'));
  await writeFile(
    join(photos, 'IMG_0001.jpg.supplemental-metadata.json'),
    JSON.stringify({ photoTakenTime: { timestamp: '1700000000' } }),
  );
  return root;
}

/** The COMMON library: photos, no edits, no motion. */
async function originalsOnlyTakeout(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'takeout-plain-'));
  made.push(root);
  const photos = join(root, 'Takeout', 'Google Photos', 'Photos from 2024');
  await mkdir(photos, { recursive: true });
  await writeFile(join(photos, 'IMG_0001.jpg'), Buffer.from('one'));
  await writeFile(join(photos, 'IMG_0002.jpg'), Buffer.from('two'));
  return root;
}

describe('the breakdown adds up', () => {
  it('counts four items as two originals, one edit and one clip', async () => {
    const reader = createTakeoutArchiveReader();
    const handle = await reader.open({ provider: 'google-takeout', path: await mixedTakeout() });
    const summary = await reader.summary(handle);
    await handle.close();

    expect(summary.items).toBe(4);
    expect(summary.byKind).toEqual({ original: 2, edited: 1, motion: 1 });
  });

  it('sums to the total', async () => {
    // A breakdown that does not add up makes the TOTAL look wrong too, which
    // is worse than showing no breakdown at all.
    const reader = createTakeoutArchiveReader();
    const handle = await reader.open({ provider: 'google-takeout', path: await mixedTakeout() });
    const summary = await reader.summary(handle);
    await handle.close();

    const total = Object.values(summary.byKind).reduce((n, c) => n + c, 0);
    expect(total, 'the breakdown does not sum to the item count').toBe(summary.items);
  });

  it('carries every kind at ZERO, on a library that has none of them', async () => {
    // The fixture matters here and the first draft of this file got it wrong:
    // asserted against `mixedTakeout`, which contains all three, the claim
    // passes whether the counts are seeded or merely counted up — a test that
    // agreed for the wrong reason. An originals-only export is what proves it,
    // and it is also the COMMON case: most people have never edited a photo.
    //
    // What a missing key costs: a screen reading `byKind.motion` gets
    // `undefined` and renders a blank beside two real numbers, which reads as
    // a failure rather than as "you have none".
    const reader = createTakeoutArchiveReader();
    const handle = await reader.open({
      provider: 'google-takeout',
      path: await originalsOnlyTakeout(),
    });
    const summary = await reader.summary(handle);
    await handle.close();

    expect(summary.items).toBe(2);
    expect(summary.byKind).toEqual({ original: 2, edited: 0, motion: 0 });
    for (const kind of ARCHIVE_ITEM_KINDS) {
      expect(summary.byKind[kind], `${kind} is missing from the breakdown`).toBeTypeOf('number');
    }
  });

  it('says nothing about an excess there is none of', async () => {
    // The other half of the same point: the "MORE than your library shows"
    // sentence must NOT appear for a library whose count matches what Google
    // reports. An explanation of a discrepancy that does not exist invents one.
    const q = await qualifyArchive('archive', {
      type: 'archive',
      provider: 'google-takeout',
      path: await originalsOnlyTakeout(),
    });
    expect(q!.domains.file.detail).not.toMatch(/MORE than your library shows/);
    expect(q!.domains.file.detail).toContain('2 items');
  });
});

describe('what a person reads on the connection', () => {
  it('names the excess BEFORE they can be surprised by it', async () => {
    const q = await qualifyArchive('archive', {
      type: 'archive',
      provider: 'google-takeout',
      path: await mixedTakeout(),
    });
    const file = q!.domains.file;

    expect(file.answer).toBe('yes');
    expect(file.count).toBe(4);
    // The number, and immediately why it is larger than the one in their head.
    expect(file.detail).toContain('4 items');
    expect(
      file.detail,
      'the Measured line shows a total larger than the provider reports and does not say why',
    ).toMatch(/MORE than your library shows/);
    expect(file.detail).toContain('2 originals');
    expect(file.detail).toContain('1 edited versions');
    expect(file.detail).toContain('1 motion clips');
    // And the reason the decision was taken, in the person's terms.
    expect(file.detail).toMatch(/the version you actually look at is not the one that gets lost/);
  });

  it('says an archive is a SNAPSHOT, with the span it covers', async () => {
    const q = await qualifyArchive('archive', {
      type: 'archive',
      provider: 'google-takeout',
      path: await mixedTakeout(),
    });
    const file = q!.domains.file;

    // The one sentence no other source in this product needs. Every other
    // connection answers with today; this one answers with the day it was
    // prepared, forever.
    expect(file.detail).toMatch(/snapshot/i);
    expect(file.detail).toMatch(/nothing added since/i);
    expect(file.volume?.earliest).toMatch(/^2023-11-14/);
  });

  it('carries the measure as DATA, not only as a sentence', async () => {
    // A screen must be able to word and format this itself — the rule every
    // other Measured line follows since 2026-09-02.
    const q = await qualifyArchive('archive', {
      type: 'archive',
      provider: 'google-takeout',
      path: await mixedTakeout(),
    });
    expect(q!.domains.file.volume).toMatchObject({
      items: 4,
      byKind: { original: 2, edited: 1, motion: 1 },
    });
    expect(q!.domains.file.volume?.bytes).toBeGreaterThan(0);
  });

  it('an archive that cannot be opened is UNKNOWN with the reason, never a no', async () => {
    // The three-state rule (0106 T3a), and the difference that matters: an
    // unknown never constrains a tick, a `no` does. Telling somebody who
    // waited a week for a 25 GB download that they have no photos is the
    // worst answer available here.
    const empty = await mkdtemp(join(tmpdir(), 'not-a-takeout-'));
    made.push(empty);
    const q = await qualifyArchive('archive', {
      type: 'archive',
      provider: 'google-takeout',
      path: empty,
    });
    expect(q!.domains.file.answer).toBe('unknown');
    expect(q!.domains.file.answer).not.toBe('no');
    expect(q!.domains.file.detail).toMatch(/could not be opened/i);
    // And nothing measured, so no screen can render a zero from it.
    expect(q!.domains.file.volume).toBeUndefined();
    expect(q!.domains.file.count).toBeUndefined();
  });

  it('the other four faces are a no that blames US, not the export', async () => {
    // Both exports DO contain mail, calendars and contacts. We choose not to
    // read them from an archive because those have live routes and a snapshot
    // would compete with the live one. Saying "your export does not have it"
    // would be false, and the kind of false that makes somebody re-request a
    // 25 GB download.
    const q = await qualifyArchive('archive', {
      type: 'archive',
      provider: 'google-takeout',
      path: await mixedTakeout(),
    });
    for (const face of ['mail', 'calendar', 'contact', 'task'] as const) {
      expect(q!.domains[face].answer).toBe('no');
      expect(q!.domains[face].detail).toMatch(/The export does contain them/);
      expect(q!.domains[face].detail).toMatch(/live/);
    }
  });

  it('answers for archives and nothing else', async () => {
    expect(await qualifyArchive('dropbox', {})).toBeUndefined();
    expect(await qualifyArchive('apple', {})).toBeUndefined();
  });
});
