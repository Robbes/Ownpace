// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE ONE POLICY THE COUNT LEFT OUT WAS THE ONE NOBODY CHOSE.
 *
 * `DiscoveryCounts` shows how many Google files a migration will not copy, and
 * its own comment says why the confirm screen is where that belongs: the
 * person choosing the export policy needs it *"while the choice is still open
 * — and not as a queue full of failure rows after the first pass"*.
 *
 * The tally behind it counted only files refused for measured byte-instability,
 * and stated its reason: *"under `refuse` every native file is refused and the
 * policy's own name says so"*. That is true of a policy somebody chose.
 * `refuse` is the DEFAULT. A default says nothing to a person who never opened
 * the screen, so the case the number was omitted from is precisely the case
 * where nothing else was telling them either.
 *
 * The owner met it on 2026-09-22: a Google → Nextcloud migration run to
 * completion under the default, twenty Docs, Sheets, Slides and a Drawing
 * refused, and the setting discovered afterwards from the failure rows — the
 * outcome the confirm screen exists to prevent, arriving in the shape it was
 * built to replace.
 *
 * ## The line this file defends
 *
 * Counting "every native file" would be worse than counting too few. Thirteen
 * of that same run's refusals were Maps, Forms and a shortcut: Drive exports
 * none of them under any policy, so listing them beside a format chooser
 * promises a remedy that does not exist. What belongs in the number is what
 * SOME policy would carry — `policy_refused` — and nothing else.
 */

import { describe, it, expect } from 'vitest';
import { statedFailureCategoryOf } from '@openmig/shared';
import {
  GoogleDriveSource,
  DRIVE_SHORTCUT_MIME,
  EXPORTABLE_NATIVE_TYPES,
} from './google-drive-source.ts';
import type { DriveTransport } from './google-drive-source.types.ts';

const BASE = 'https://drive.test/v3';
const G = 'application/vnd.google-apps.';

const native = (id: string, name: string, kind: string) => ({
  id,
  name,
  mimeType: kind.includes('/') ? kind : `${G}${kind}`,
  modifiedTime: '2026-09-22T10:00:00Z',
});

function drive(files: ReadonlyArray<Record<string, unknown>>) {
  const transport: DriveTransport = async (url) => ({
    ok: true,
    status: 200,
    json: async () => (url.includes('/files?q=') ? { files } : {}),
    arrayBuffer: async () => new ArrayBuffer(0),
    text: async () => '',
  });
  return transport;
}

const walk = async (
  files: ReadonlyArray<Record<string, unknown>>,
  nativeFilePolicy: 'refuse' | 'export-office' | 'export-pdf' | 'export-odf',
) => {
  const source = new GoogleDriveSource(drive(files), { baseUrl: BASE, nativeFilePolicy });
  await source.listSince({ path: '' });
  return source.nativeRefusals();
};

describe('what the confirm screen is told under the default policy', () => {
  it('counts the Docs, Sheets, Slides and Drawings that refuse will not carry', async () => {
    // The owner's own twenty, in miniature. Under `refuse` this returned `{}`
    // and the screen said nothing at all.
    const counted = await walk(
      [
        native('1', 'Voorbeeldtekst', 'document'),
        native('2', 'Prijsadvies', 'document'),
        native('3', 'Boodschappenlijst', 'spreadsheet'),
        native('4', 'Naamloze presentatie', 'presentation'),
        native('5', 'test tekening', 'drawing'),
      ],
      'refuse',
    );

    expect(counted).toEqual({ document: 2, spreadsheet: 1, presentation: 1, drawing: 1 });
  });

  it('keys by the MIME suffix, which is what the screen translates', async () => {
    // `discovery.refusedNative.kind.*` is keyed on the suffix in both locales.
    // A count stored under any other word renders as a raw English token in a
    // Dutch sentence.
    const counted = await walk([native('1', 'x', 'document')], 'refuse');
    expect(Object.keys(counted)).toEqual(['document']);
  });

  it('leaves out what no policy could carry, rather than promising a remedy', async () => {
    // A Form, a Map and a shortcut are refused under `export-office` exactly as
    // under `refuse`. Counting them beside a format chooser would tell somebody
    // that picking a format brings them back, and nothing would.
    const counted = await walk(
      [
        native('1', 'Thema-avond', 'form'),
        native('2', 'Havana', 'map'),
        native('3', 'Process mining tools overview', DRIVE_SHORTCUT_MIME),
      ],
      'refuse',
    );

    expect(counted).toEqual({});
  });

  it('separates the two kinds of no by the category the refusal itself states', async () => {
    // The property the count rests on, asserted directly: what a policy could
    // carry is `policy_refused`, and what Drive will never render is
    // `source_refused`. If these ever collapse into one category the filter
    // above silently starts counting Forms.
    const source = new GoogleDriveSource(drive([]), { baseUrl: BASE, nativeFilePolicy: 'refuse' });
    const categoryOf = (mime: string) =>
      statedFailureCategoryOf(source.refusalFor({ id: 'x', name: 'n', mimeType: mime } as never));

    expect(categoryOf(`${G}document`)).toBe('policy_refused');
    expect(categoryOf(`${G}form`)).toBe('source_refused');
    expect(categoryOf(DRIVE_SHORTCUT_MIME)).toBe('source_refused');
    // And the split the filter uses is the same one the export table draws.
    expect(EXPORTABLE_NATIVE_TYPES.has(`${G}document`)).toBe(true);
    expect(EXPORTABLE_NATIVE_TYPES.has(`${G}form`)).toBe(false);
  });
});

describe('a policy that does carry them', () => {
  it('counts nothing for the kinds it exports stably', async () => {
    // The screen must stay quiet when there is nothing to say: a tick-box on a
    // migration with no refusals is a click that buys nobody anything.
    const counted = await walk(
      [native('1', 'Voorbeeldtekst', 'document'), native('2', 'Boodschappenlijst', 'spreadsheet')],
      'export-office',
    );

    expect(counted).toEqual({});
  });
});
