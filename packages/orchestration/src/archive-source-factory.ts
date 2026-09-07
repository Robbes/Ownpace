// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHICH READER OPENS THIS ARCHIVE (workplan 0116 T1).
 *
 * The other `*-source-factory` modules in this directory build a connector out
 * of credentials. This one has no credentials to build from: an archive's
 * credential is a location, and the only decision left is which of the readers
 * knows the shape of the thing at the end of that path.
 *
 * ## The one place a third export is named
 *
 * 0116 §2 promises that adding Meta, Dropbox or Microsoft is a new READER and
 * nothing else — not a new connection kind, a new card, a new CHECK
 * constraint or a new branch in eleven files. This table is where that promise
 * is kept and where it could be broken: one entry, one reader, and everything
 * from the front door to the ledger keeps working because `provider` is a value
 * on an `archive` connection rather than a kind of its own.
 *
 * `archiveReaderFor` returns `undefined` rather than throwing for a provider
 * with no reader, so the caller can say *"this is a wiring gap, not a problem
 * with your export"* — which is the difference between a sentence somebody can
 * forward to us and one that makes them re-download 25 GB.
 */

import {
  ARCHIVE_PROVIDERS,
  archiveProviderName,
  parseArchiveSource,
  type ArchiveProvider,
  type FileSource,
} from '@openmig/shared';
import type { ArchiveReader } from '@openmig/core/archive-reader';
import { ArchiveFileSource, createTakeoutArchiveReader } from '@openmig/connectors';

/**
 * The `connection.kind` an archive row carries (migration 0039).
 *
 * A constant rather than the literal, for the reason `GOOGLE_DRIVE_CONNECTION_KIND`
 * is one: the wizard's vocabulary and `connection.kind` agree on this word today,
 * and a named constant is what makes a later divergence a compile error at
 * every site rather than a silent miss at one of them.
 */
export const ARCHIVE_CONNECTION_KIND = 'archive';

/**
 * The readers, by export.
 *
 * `apple-privacy` is deliberately ABSENT rather than stubbed. Nobody here has
 * opened an Apple Data & Privacy export yet — 0116 T3b starts by opening one
 * and writing down what is inside — and a stub that answered "0 items" would
 * be indistinguishable, to the person looking at the screen, from an export
 * that really was empty. An absent reader says *we have not built this*; a
 * stub says *your export is empty*, and only one of those is true.
 */
const READERS: Readonly<Partial<Record<ArchiveProvider, () => ArchiveReader>>> = {
  'google-takeout': createTakeoutArchiveReader,
};

/** The reader for an export, or `undefined` where none is built yet. */
export function archiveReaderFor(provider: string): ArchiveReader | undefined {
  const make = READERS[provider as ArchiveProvider];
  return make ? make() : undefined;
}

/** The exports a reader exists for — what a surface may honestly offer today. */
export function archiveProvidersWithReaders(): ReadonlyArray<ArchiveProvider> {
  return ARCHIVE_PROVIDERS.filter((p) => READERS[p] !== undefined);
}

/**
 * The file source over a stored archive connection (workplan 0116 T5/T6).
 *
 * The other builders in this directory refuse at BUILD TIME when a credential
 * is missing. This one has no credential to be missing — the config IS the
 * credential, a location — so the only refusals are the shared parser's (an
 * export this product does not read, a path that is not a string) and the
 * one below: a reader that is not built yet. That last sentence has to say
 * which of the two it is, because "your export cannot be migrated" is false
 * and would send somebody back to re-download 25 GB for nothing.
 *
 * `config` is the connection's blob merged with the mapping's override, so
 * the `path` is this mapping's archive — the next export in a series — while
 * `provider` stays the connection's (`sourceConfigOverride` keeps it out of
 * the override for exactly that reason).
 */
export function buildArchiveSourceFrom(config: Record<string, unknown>): FileSource {
  const location = parseArchiveSource(config);
  const reader = archiveReaderFor(location.provider);
  if (!reader) {
    throw new Error(
      `No reader is built for ${archiveProviderName(location.provider)} exports yet, so this ` +
        'archive cannot be migrated from. This is a wiring gap in this product, not a problem ' +
        'with your export — nothing about it prevents reading it once the reader exists.',
    );
  }
  return new ArchiveFileSource(reader, location);
}
