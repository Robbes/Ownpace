// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN EXPORT IN THE DESTINATION'S OWN FILES: WHICH DESTINATIONS, AND THE FORM
 * THAT ASKS (workplan 0148 T9, D11).
 *
 * `where: 'target'` (0116 T4) reads an export out of a folder of the files the
 * migration writes to, by byte range. The owner asked for it on 2026-09-24 so
 * that the archive card can complete on managed, where a path on the server
 * cannot be read (0136 T5). Two things live in shared, so both editions and
 * both doors read them:
 *
 *  - WHICH DESTINATIONS can serve it: `archiveInTargetRefusal`, one rule the
 *    wizard's target step and the create door both call. A WebDAV or a
 *    Nextcloud destination can; a JMAP one carries files and cannot, because
 *    JMAP has no byte ranges; the rest have no files at all.
 *  - THE FORM: the archive descriptor asks `where`, a choice of two, with the
 *    default each edition needs and the disk marked appliance-only.
 */

import { describe, it, expect } from 'vitest';
import {
  ARCHIVE_READABLE_TARGETS,
  archiveInJmapTargetSentence,
  archiveInTargetRefusal,
  credentialFieldsFor,
  followedField,
  secretFieldKeys,
  TARGET_TYPE_DOMAINS,
  type WizardTargetType,
} from './index.ts';

/** Every target type the create route knows: the table, which a guard pins to its enum. */
const EVERY_TARGET = Object.keys(TARGET_TYPE_DOMAINS) as WizardTargetType[];

describe('archiveInTargetRefusal — which destinations an export can be read from', () => {
  it('knows the target types — the vacuity floor', () => {
    expect(EVERY_TARGET.length).toBeGreaterThanOrEqual(7);
  });

  it('accepts a WebDAV and a Nextcloud destination', () => {
    expect(archiveInTargetRefusal('webdav')).toBeNull();
    expect(archiveInTargetRefusal('nextcloud')).toBeNull();
    expect([...ARCHIVE_READABLE_TARGETS].sort()).toEqual(['nextcloud', 'webdav']);
  });

  it('refuses every other target type the create route knows', () => {
    for (const type of EVERY_TARGET.filter((t) => t !== 'webdav' && t !== 'nextcloud')) {
      const refusal = archiveInTargetRefusal(type);
      expect(refusal, `an export in a '${type}' destination's files was accepted`).toEqual(
        expect.any(String),
      );
    }
  });

  it('refuses JMAP with the sentence the pass writes: files, but no byte ranges', () => {
    const refusal = archiveInTargetRefusal('jmap')!;
    expect(refusal).toBe(archiveInJmapTargetSentence('JMAP'));
    expect(refusal).toContain('byte ranges');
    expect(refusal).toContain('WebDAV');
  });

  it('names the destination as a person reads it, never by its lower-case key', () => {
    // The door and the wizard's target step show this sentence to a person
    // (0148 T9 review): "a jmap account" is our vocabulary, not theirs.
    expect(archiveInTargetRefusal('jmap')).toContain('a JMAP account');
    expect(archiveInTargetRefusal('jmap')).not.toContain('a jmap account');
  });

  it('reads right for every name, whatever its first letter (no "a IMAP")', () => {
    expect(archiveInTargetRefusal('imap')).toBe(
      "This export is to be read from a folder in the destination's files, and IMAP " +
        'destinations have no files. WebDAV and Nextcloud destinations have them: choose one of ' +
        'those as the destination, and put the export in a folder of its files.',
    );
    for (const type of EVERY_TARGET) {
      expect(archiveInTargetRefusal(type) ?? '', type).not.toMatch(/\ba [AEIOU]/);
    }
  });

  it('refuses a destination with no files by saying so, and which ones have them', () => {
    for (const type of ['imap', 'caldav', 'carddav', 'soverin'] as const) {
      const refusal = archiveInTargetRefusal(type)!;
      expect(refusal, type).toContain("the destination's files");
      expect(refusal, type).toContain('have no files');
      expect(refusal, type).toContain('Nextcloud');
      expect(refusal, type).toContain('WebDAV');
    }
  });
});

describe('the archive form asks where the export is', () => {
  const fields = credentialFieldsFor('source', 'archive');
  const where = fields.find((f) => f.key === 'where');
  const path = fields.find((f) => f.key === 'path');

  it('has a `where` field: a choice of the two places, not a secret', () => {
    expect(where, 'the archive form does not ask where the export is').toBeDefined();
    expect(where!.options?.map((o) => o.value)).toEqual(['target', 'disk']);
    // Our own words, so keys and not verbatim labels.
    for (const option of where!.options ?? []) expect(option.labelKey).toMatch(/^wizard\.archiveWhere\./);
    expect(secretFieldKeys('source', 'archive')).toEqual([]);
  });

  it('is this mapping’s answer, like the path beside it', () => {
    // The next export in a series can be kept somewhere else (0116 §5), so a
    // reused connection must still ask.
    expect(where!.perMapping).toBe(true);
  });

  it('defaults to the destination on managed and to the disk on the appliance', () => {
    expect(where!.defaultValue).toEqual({ managed: 'target', selfhost: 'disk' });
  });

  it('marks the disk as the appliance’s only, with the line a managed form shows beside it', () => {
    const disk = where!.options!.find((o) => o.value === 'disk')!;
    expect(disk.applianceOnly).toBe(true);
    expect(disk.applianceOnlyKey).toBe('wizard.archiveWhere.disk.onlyAppliance');
    const target = where!.options!.find((o) => o.value === 'target')!;
    expect(target.applianceOnly).toBeFalsy();
  });

  it('comes before the path, whose label, hint and example follow the choice', () => {
    expect(fields.findIndex((f) => f.key === 'where')).toBeLessThan(
      fields.findIndex((f) => f.key === 'path'),
    );
    const inTarget = followedField(path!, { where: 'target' });
    expect(inTarget.labelKey).toBe('wizard.archivePath.target');
    expect(inTarget.hintKey).toBe('wizard.archivePath.target.hint');
    expect(inTarget.placeholder).toBe('Exports/takeout-20260904');
    const onDisk = followedField(path!, { where: 'disk' });
    expect(onDisk.labelKey).toBe('wizard.archivePath');
    expect(onDisk.placeholder).toBe('/srv/exports/takeout-20260904');
  });
});
