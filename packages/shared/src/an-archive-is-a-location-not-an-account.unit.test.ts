// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN ARCHIVE IS A LOCATION, NOT AN ACCOUNT.
 *
 * Workplan 0116 T1. Every other source type in this product names an account
 * and something that proves it; `archive` names a file the person already
 * downloaded. Four consequences follow, and each of them is the kind of thing
 * that is obviously true while it is being written and quietly wrong two
 * refactors later.
 *
 * **1. Nothing about it is secret.** A path is not a password. If a
 * `secretFieldKeys('source', 'archive')` ever answers non-empty, either
 * somebody has added a credential to a kind that has none, or the descriptor
 * has been mis-marked and a form is about to mask a folder name.
 *
 * **2. The provider vocabulary has ONE home.** `ARCHIVE_PROVIDERS` lives in
 * shared and the reader seam re-exports it. The failure a second copy produces
 * is not a compile error: it is a form offering an export the create door
 * refuses, or hiding one it accepts — silent on both sides.
 *
 * **3. The wrong provider does not FAIL, it finds nothing.** Opening an Apple
 * export with Google's reader finds no `Takeout/Google Photos` tree and reports
 * an empty archive. So the value is checked by name at the door, and the
 * refusal names the list. Anything that answers "0 items" to somebody who
 * waited a week for a 25 GB download is the worst answer available here.
 *
 * **4. Files and photos, and nothing else** (owner decision D5, 2026-09-04).
 * Both exports contain mail, calendars and contacts too; this product reads
 * none of them from an archive, because those have live routes and a snapshot
 * would compete with the live one.
 */

import { describe, it, expect } from 'vitest';
import {
  ARCHIVE_PROVIDERS,
  ARCHIVE_PROVIDER_NAMES,
  ARCHIVE_PROVIDER_ORIGINS,
  archiveProviderName,
  isArchiveProvider,
} from './archive-providers.ts';
import { connectableTypes, credentialFieldsFor, secretFieldKeys, providerDisplayName } from './credential-fields.ts';
import { SOURCE_TYPE_DOMAINS } from './target-domains.ts';
import { FRONT_DOOR_GROUPS, frontDoorIconOf, frontDoorFamilyOf } from './front-door.ts';
import { parseArchiveSource, ConfigError } from './config.ts';

describe('the archive kind reaches the tables a source kind must reach', () => {
  it('is offered as a source, with a name a person would recognise', () => {
    expect(connectableTypes('source')).toContain('archive');
    // Named for what it IS, not for either gatekeeper: one card covers both
    // exports, so "Google Takeout" as the type name would be wrong half the
    // time and would need renaming the day a third export arrives.
    expect(providerDisplayName('archive')).toBe('Export archive');
  });

  it('carries files only — a snapshot never competes with a live route', () => {
    expect(SOURCE_TYPE_DOMAINS.archive).toEqual(['file']);
  });

  it('is placed in the front door and wears a mark, like every provider entry', () => {
    // The invariant `front-door.unit.test.ts` pins is marks-on-providers and
    // glyphs-on-protocols. An archive is not a server, so it cannot be a
    // protocol; being a provider means it needs a mark — a NEUTRAL one,
    // because this single card stands for two companies' exports at once.
    expect(FRONT_DOOR_GROUPS.archive).toBe('provider');
    expect(frontDoorIconOf('archive')?.kind).toBe('mark');
    // Standalone: a family would have to be Google's or Apple's, and it is
    // half of each.
    expect(frontDoorFamilyOf('archive')).toBeUndefined();
  });
});

describe('a path is not a password', () => {
  it('asks for two things and marks neither as secret', () => {
    const fields = credentialFieldsFor('source', 'archive');
    expect(fields.map((f) => f.key)).toEqual(['provider', 'path']);
    expect(fields.every((f) => f.required)).toBe(true);
    expect(secretFieldKeys('source', 'archive')).toEqual([]);
  });

  it('offers the providers as a closed list, read from the one vocabulary', () => {
    // NOT a hand-written list beside the table. A second copy is a form
    // offering an export the server refuses, and nothing errors on either
    // side — the drift this whole file exists to make loud.
    const provider = credentialFieldsFor('source', 'archive').find((f) => f.key === 'provider');
    expect(provider?.options?.map((o) => o.value)).toEqual([...ARCHIVE_PROVIDERS]);
    expect(provider?.options?.map((o) => o.label)).toEqual(
      ARCHIVE_PROVIDERS.map((p) => ARCHIVE_PROVIDER_NAMES[p]),
    );
  });

  it('the path is per-mapping, the provider is not', () => {
    // A reused archive connection is one person's export SERIES: the second
    // migration points at the next archive (0116 §5's two-monthly delta), so
    // the path is the mapping's to answer. The provider is not — an archive
    // that changed provider is a different connection, and overriding it would
    // let one row's export be opened by the other's reader.
    const fields = credentialFieldsFor('source', 'archive');
    expect(fields.find((f) => f.key === 'path')?.perMapping).toBe(true);
    expect(fields.find((f) => f.key === 'provider')?.perMapping).toBeUndefined();
  });
});

describe('the provider is checked by name, because the wrong one finds nothing', () => {
  it('accepts exactly the exports a reader could exist for', () => {
    expect([...ARCHIVE_PROVIDERS]).toEqual(['google-takeout', 'apple-privacy']);
    for (const p of ARCHIVE_PROVIDERS) {
      expect(isArchiveProvider(p)).toBe(true);
      // Every export carries the address the person has to visit before any
      // of this exists — 0105's rule, and the part of an archive import that
      // actually takes twenty minutes.
      expect(ARCHIVE_PROVIDER_ORIGINS[p]).toMatch(/^https:\/\//);
    }
    expect(isArchiveProvider('google-photos')).toBe(false);
    expect(isArchiveProvider('')).toBe(false);
  });

  it('refuses an unknown provider by naming the list, in the shared parser', () => {
    // The SHARED parser, so the appliance's mapping file and the managed API
    // refuse the same shape in the same words (hard rule 5).
    let refusal: unknown;
    try {
      parseArchiveSource({ provider: 'google-photos', path: '/srv/exports/x' });
    } catch (err) {
      refusal = err;
    }
    expect(refusal, 'an unknown export was accepted').toBeInstanceOf(ConfigError);
    expect(String((refusal as Error).message)).toContain('google-takeout');
    expect(String((refusal as Error).message)).toContain('apple-privacy');
  });

  it('demands both fields — neither has a safe default', () => {
    // A missing path cannot default to a working directory, and a missing
    // provider cannot be sniffed from the files: a folder of .zip files says
    // nothing about who made them.
    expect(() => parseArchiveSource({ provider: 'google-takeout' })).toThrow(ConfigError);
    expect(() => parseArchiveSource({ path: '/srv/exports/x' })).toThrow(ConfigError);
  });

  it('keeps the type on the way out, for a blob nobody can otherwise read back', () => {
    expect(parseArchiveSource({ provider: 'apple-privacy', path: '/srv/x' })).toEqual({
      type: 'archive',
      provider: 'apple-privacy',
      path: '/srv/x',
    });
  });

  it('names each export the way its own page does', () => {
    expect(archiveProviderName('google-takeout')).toBe('Google Takeout');
    expect(archiveProviderName('apple-privacy')).toBe('Apple Data & Privacy');
    // An unknown one is shown as itself rather than blanked — the same rule
    // `providerDisplayName` follows: a gap you can see is a bug report.
    expect(archiveProviderName('meta-dyi')).toBe('meta-dyi');
  });
});
