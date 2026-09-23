// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A FORMAT THAT HAD TO FIT ALL FOUR KINDS (workplan 0042 T9).
 *
 * `nativeFilePolicy` set one export format for Docs, Sheets, Slides and
 * Drawings together, and no editable format carries all four
 * (`NATIVE_POLICY_COVERAGE`): ODF leaves every Doc behind, Office every deck.
 * The owner's decision, 2026-09-23: *"a per kind choice makes more sense for
 * the fileformats. Split that up."*
 *
 * This file holds the shared half, which both editions read:
 *
 *  - the mapping file and the managed blob accept a format per kind, laid over
 *    the single one, and refuse a kind or a format they do not know BY NAME;
 *  - one function answers which format each kind is exported in, so the
 *    connector and the revision snapshot cannot disagree about an unset kind;
 *  - the snapshot of a mapping written before this does not change, so no
 *    appliance reads its own upgrade as a change of settings.
 */

import { describe, it, expect } from 'vitest';
import { parseGoogleDriveSource, parseMappingConfig, ConfigError } from './config.ts';
import {
  GOOGLE_EDITOR_KINDS,
  googleEditorKindOf,
  googleEditorMime,
  nativeFilePoliciesOf,
} from './google-native-coverage.ts';
import { compareRevision, mayRevise, revisionSnapshotOf } from './config-revision.ts';

const account = (source: Record<string, unknown>) => ({
  tenantId: 't',
  mappingId: 'm',
  source: { type: 'google', user: 'someone@example.invalid', ...source },
  target: {
    type: 'webdav',
    url: 'https://cloud.example.invalid/remote.php/dav/files/someone/',
    user: 'someone',
    auth: { kind: 'login', passwordFromEnv: 'UNUSED_IN_THIS_TEST' },
  },
});

const refusalOf = (fn: () => unknown): string => {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ConfigError);
    return (err as Error).message;
  }
  throw new Error('expected a refusal, and the value was accepted');
};

describe('which kind a Drive file is', () => {
  it('names the four editor kinds by their MIME type', () => {
    for (const kind of GOOGLE_EDITOR_KINDS) {
      expect(googleEditorKindOf(googleEditorMime(kind))).toBe(kind);
    }
  });

  it('names nothing else: a Form, a folder, a shortcut, an ordinary file', () => {
    for (const mime of [
      'application/vnd.google-apps.form',
      'application/vnd.google-apps.folder',
      'application/vnd.google-apps.shortcut',
      'application/pdf',
    ]) {
      expect(googleEditorKindOf(mime), mime).toBeUndefined();
    }
  });
});

describe('the format each kind is exported in', () => {
  it('is a kind’s own where it has one, and the single setting where it has not', () => {
    expect(
      nativeFilePoliciesOf({
        nativeFilePolicy: 'export-office',
        nativeFilePolicies: { presentation: 'export-odf' },
      }),
    ).toEqual({
      document: 'export-office',
      spreadsheet: 'export-office',
      presentation: 'export-odf',
      drawing: 'export-office',
    });
  });

  it('is refuse for a kind nothing speaks for, as the default always was', () => {
    expect(nativeFilePoliciesOf({ nativeFilePolicies: { document: 'export-pdf' } })).toEqual({
      document: 'export-pdf',
      spreadsheet: 'refuse',
      presentation: 'refuse',
      drawing: 'refuse',
    });
    expect(nativeFilePoliciesOf({})).toEqual({
      document: 'refuse',
      spreadsheet: 'refuse',
      presentation: 'refuse',
      drawing: 'refuse',
    });
  });
});

describe('the reader both editions go through', () => {
  it('carries a format per kind on the google-drive row and on the Google account', () => {
    const perKind = { document: 'export-office', presentation: 'export-odf' };
    expect(parseGoogleDriveSource({ nativeFilePolicies: perKind })).toEqual({
      type: 'google-drive',
      nativeFilePolicies: perKind,
    });
    // The account's file face is the Drive connector, reading this key out of
    // the same blob; a reader that dropped it would hand that face a config
    // with every kind back on the single setting.
    expect(parseMappingConfig(account({ nativeFilePolicies: perKind })).source).toEqual({
      type: 'google',
      user: 'someone@example.invalid',
      nativeFilePolicies: perKind,
    });
  });

  it('refuses a kind it does not know BY NAME, rather than ignoring it', () => {
    // "slides" read as nothing would leave every deck on the single setting,
    // and the person who wrote it would find out from the Failures screen.
    const message = refusalOf(() =>
      parseGoogleDriveSource({ nativeFilePolicies: { slides: 'export-odf' } }),
    );
    expect(message).toContain('source.nativeFilePolicies');
    expect(message).toContain('"slides"');
    for (const kind of GOOGLE_EDITOR_KINDS) expect(message).toContain(`"${kind}"`);
  });

  it('refuses a format it does not know, naming the kind it was given for', () => {
    const message = refusalOf(() =>
      parseMappingConfig(account({ nativeFilePolicies: { presentation: 'export_odf' } })),
    );
    expect(message).toContain('source.nativeFilePolicies.presentation');
    expect(message).toContain('"export_odf"');
    // In the single setting's own words, which name every format accepted.
    expect(message).toContain('export-odf');
  });

  it('refuses anything but an object of kinds', () => {
    for (const value of ['export-odf', ['export-odf'], null, 7]) {
      expect(refusalOf(() => parseGoogleDriveSource({ nativeFilePolicies: value }))).toContain(
        'source.nativeFilePolicies',
      );
    }
  });
});

describe('what a migration is recorded as', () => {
  const snapshot = (source: Record<string, unknown>) =>
    revisionSnapshotOf({
      source: { type: 'google-drive', ...source },
      target: { type: 'webdav' },
    } as Parameters<typeof revisionSnapshotOf>[0]);

  it('is the single format when every kind agrees, as it was before', () => {
    // Every snapshot already stored was written this way; reading an upgrade
    // as a change of settings would put a line in every appliance's log.
    expect(snapshot({ nativeFilePolicy: 'export-office' })['source.nativeFilePolicy']).toBe(
      'export-office',
    );
    const spelledOut = snapshot({
      nativeFilePolicy: 'export-pdf',
      nativeFilePolicies: {
        document: 'export-pdf',
        spreadsheet: 'export-pdf',
        presentation: 'export-pdf',
        drawing: 'export-pdf',
      },
    });
    expect(spelledOut['source.nativeFilePolicy']).toBe('export-pdf');
    expect(compareRevision(snapshot({ nativeFilePolicy: 'export-pdf' }), spelledOut).changed).toEqual(
      [],
    );
  });

  it('is one format per kind when they differ', () => {
    expect(
      snapshot({
        nativeFilePolicy: 'export-office',
        nativeFilePolicies: { presentation: 'export-odf' },
      })['source.nativeFilePolicy'],
    ).toBe(
      'document: export-office, spreadsheet: export-office, presentation: export-odf, ' +
        'drawing: export-office',
    );
  });

  it('counts a change to one kind as a change, and allows it', () => {
    const before = snapshot({ nativeFilePolicy: 'export-office' });
    const after = snapshot({
      nativeFilePolicy: 'export-office',
      nativeFilePolicies: { presentation: 'export-odf' },
    });
    const verdict = compareRevision(before, after);
    expect(verdict.changed).toEqual(['source.nativeFilePolicy']);
    expect(verdict.refusals).toEqual([]);
  });

  it('says a change re-copies the documents whose format changes, not every one', () => {
    const verdict = mayRevise('source.nativeFilePolicy');
    expect(verdict.allowed).toBe(true);
    expect(verdict.allowed ? verdict.consequence : '').toMatch(
      /Every Google document whose format changes is copied again/,
    );
  });
});
