// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A KIND THE CONFIRM SCREEN COULD NOT PLACE (workplan 0153 T1 (a)).
 *
 * The managed confirm screen reads the migration's `sourceType`, which the
 * detail route fills with the CONNECTION KIND (`sourceType: sourceConn?.kind`).
 * It looked that up in `SCOPE_FAMILY`, which is keyed by the mapping file's
 * source TYPE. For `google_drive`, `o365`, `imap` and `apple` the answer was
 * `undefined`, the manifest was not narrowed to the migration's provider, and
 * a Google Drive migration was confirmed under SharePoint, Teams and Planner.
 *
 * These cases pin what each source kind is. The companion guard in
 * `apps/api/src/routes/migrations/a-source-kind-with-no-scope-family.unit.test.ts`
 * pins that no kind the create door can store is missing, because only the
 * API holds `sourceKindFor` and the list of source types it accepts.
 */

import { describe, it, expect } from 'vitest';
import {
  SCOPE_FAMILIES,
  SCOPE_MANIFEST,
  scopeFamilyOf,
  scopeFamilyOfConnectionKind,
  scopeManifestFor,
} from './scope-manifest.ts';

describe('scopeFamilyOfConnectionKind', () => {
  it.each(['gmail', 'google_drive', 'google_calendar', 'google_contacts', 'google'])(
    'places the Google kind %s with Google',
    (kind) => {
      expect(scopeFamilyOfConnectionKind(kind)).toBe('google');
    },
  );

  it.each(['o365', 'microsoft'])('places the Microsoft kind %s with Microsoft', (kind) => {
    // `o365` is what BOTH customer-registered Microsoft cards store (IMAP and
    // Graph), so it is the kind a Microsoft migration most often carries.
    expect(scopeFamilyOfConnectionKind(kind)).toBe('microsoft');
  });

  it.each(['imap', 'apple'])('places %s with the standards, as the appliance does', (kind) => {
    expect(scopeFamilyOfConnectionKind(kind)).toBe('standards');
    // The appliance names the same endpoints by their mapping-file types.
    expect(scopeFamilyOf('imap-oauth2')).toBe('standards');
    expect(scopeFamilyOf('caldav')).toBe('standards');
  });

  it('agrees with the source-type table wherever the two vocabularies share a word', () => {
    // `gmail`, `google`, `microsoft`, `dropbox`, `box` and `archive` are the
    // same string as kind and as type. Two tables that answered differently
    // for one word would make the screen depend on which edition asked.
    const shared = ['gmail', 'google', 'microsoft', 'dropbox', 'box', 'archive'];
    for (const word of shared) {
      expect(scopeFamilyOf(word), `${word} is not a source type any more`).toBeDefined();
      expect(scopeFamilyOfConnectionKind(word), word).toBe(scopeFamilyOf(word));
    }
  });

  it.each(['soverin', 'nextcloud', 'jmap', 'unknown', '', 'constructor', 'toString', '__proto__'])(
    'answers undefined for %j, which is not a source kind',
    (notAKind) => {
      // Target kinds, the detail route's 'unknown' for a missing connection
      // row, and inherited object keys: none of them may borrow a family.
      expect(scopeFamilyOfConnectionKind(notAKind)).toBeUndefined();
    },
  );

  it('only ever answers with a family the manifest knows', () => {
    const kinds = [
      'imap', 'o365', 'microsoft', 'gmail', 'google_drive', 'google_calendar',
      'google_contacts', 'google', 'apple', 'dropbox', 'box', 'archive',
    ];
    for (const kind of kinds) {
      expect(SCOPE_FAMILIES, kind).toContain(scopeFamilyOfConnectionKind(kind));
    }
  });
});

describe('what a Google Drive migration is confirmed under', () => {
  const family = scopeFamilyOfConnectionKind('google_drive');
  const scoped = scopeManifestFor(SCOPE_MANIFEST, family ? [family] : []);
  const rows = [...scoped.migrates, ...scoped.partial, ...scoped.doesNotMigrate];

  it('carries no row that is only about Microsoft', () => {
    const microsoftOnly = rows.filter(
      (e) => e.appliesTo !== undefined && !e.appliesTo.includes('google'),
    );
    expect(microsoftOnly.map((e) => `${e.item}: ${e.detail}`)).toEqual([]);
    expect(rows.map((e) => e.item)).not.toContain('Teams chat & calls');
  });

  it('carries the Google rows, the Drive one first among them', () => {
    expect(rows.some((e) => e.detail.startsWith('Google Drive:'))).toBe(true);
    expect(rows.map((e) => e.item)).toContain('Google-native files');
  });
});
