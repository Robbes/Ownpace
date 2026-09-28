// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A SOURCE KIND WITH NO SCOPE FAMILY (workplan 0153 T1 (a)).
 *
 * The managed confirm screen narrows the §11.2 manifest to the migration's
 * provider. It learns the provider from the detail route's `sourceType`, which
 * is the source CONNECTION KIND this file's `sourceKindFor` stored, and places
 * it with shared's `scopeFamilyOfConnectionKind`. A kind that table does not
 * know narrows nothing: the screen then shows only the rows true of every
 * source, and says nothing about the provider being left. Until 2026-09-28 that
 * was `google_drive`, `o365`, `imap` and `apple`, silently.
 *
 * So the lock runs over what the create door can store, not over a list copied
 * into a test. It reads the door's own source types from `CreateMappingBase`,
 * sends each through `sourceKindFor`, and asks shared for the family. A source
 * type added to the door without a row in shared's table fails here, before
 * any migration is confirmed under the wrong promises.
 */

import { describe, it, expect } from 'vitest';
import { scopeFamilyOfConnectionKind } from '@openmig/shared';
import { CreateMappingBase, sourceKindFor } from './index.ts';

const SOURCE_TYPES = CreateMappingBase.shape.sourceType.options;

describe('every source kind the create door can store has a scope family', () => {
  it('read the door’s real list of source types', () => {
    // Vacuity guard: an empty list would make the check below assert nothing.
    expect(SOURCE_TYPES.length).toBeGreaterThan(10);
  });

  it('places the kind of every source type', () => {
    const unplaced = SOURCE_TYPES.map((type) => ({ type, kind: sourceKindFor(type) })).filter(
      ({ kind }) => scopeFamilyOfConnectionKind(kind) === undefined,
    );
    expect(
      unplaced,
      'these source types are stored under a connection kind with no scope family, so the ' +
        'confirm screen would narrow the manifest to nothing and say nothing about the ' +
        'provider being left. Add each kind to SCOPE_FAMILY_OF_SOURCE_KIND in ' +
        'packages/shared/src/scope-manifest.ts',
    ).toEqual([]);
  });

  it('stores Drive under the underscored kind the screen receives', () => {
    // The exact string the detail route hands the screen for a Google Drive
    // migration, which is what the web test feeds its confirm screen.
    expect(sourceKindFor('google-drive')).toBe('google_drive');
    expect(scopeFamilyOfConnectionKind('google_drive')).toBe('google');
  });
});
