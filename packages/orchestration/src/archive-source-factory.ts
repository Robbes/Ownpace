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
  archiveInJmapTargetSentence,
  archiveProviderName,
  parseArchiveSource,
  type ArchiveProvider,
  type ArchiveSource,
  type FileSource,
} from '@openmig/shared';
import type { ArchiveReader } from '@openmig/core/archive-reader';
import {
  ArchiveFileSource,
  createTakeoutArchiveReader,
  webdavStore,
  type ArchiveStore,
} from '@openmig/connectors';
import type { DavEndpoint } from './dav-factories.ts';

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
 * `apple-privacy` is deliberately ABSENT rather than stubbed, and a stub would
 * be worse than nothing: answering "0 items" is indistinguishable, to the
 * person looking at the screen, from an export that really was empty. An
 * absent reader says *we have not built this*; a stub says *your export is
 * empty*, and only one of those is true.
 *
 * WHAT IS STILL MISSING, since 2026-09-17, when an export was finally opened
 * (0116 §"What one real export answered" has it in full): the shape is known —
 * two wrapper levels, the person's tree intact beneath them, no sidecars, one
 * flat `Drive Details.csv` with no path column. What is NOT known is how a
 * multi-part export splits, what a package (`.pages`, `.numbers`) arrives as,
 * and which timezone `Created On` is in; the one export available read as US
 * Pacific rather than the account holder's. A reader written today would parse
 * dates nine hours out and explode an iWork document into its members, so it
 * waits on the second export 0116 specifies rather than on a first one.
 *
 * A reader added here is added to `ARCHIVE_PROVIDERS_WITH_READERS` in shared
 * too, which is how the archive form drops its *To be tested* tag (0148 T3);
 * `the-form-and-the-readers-agree.unit.test.ts` fails until it is.
 */
const READERS: Readonly<Partial<Record<ArchiveProvider, (store?: ArchiveStore) => ArchiveReader>>> = {
  'google-takeout': (store) => createTakeoutArchiveReader(store),
};

/**
 * The reader for an export, or `undefined` where none is built yet.
 *
 * `store` is where the location points (0116 T4): the appliance's disk when
 * absent, the customer's own file target on the managed edition, where a
 * pass has no disk and the relay puts the parts in the target.
 */
export function archiveReaderFor(provider: string, store?: ArchiveStore): ArchiveReader | undefined {
  const make = READERS[provider as ArchiveProvider];
  return make ? make(store) : undefined;
}

/**
 * The exports a reader exists for — what a surface may honestly offer today.
 *
 * Read from `READERS`, as before 0148 T3. The form cannot call this (shared
 * cannot import orchestration), so it reads the copy in shared,
 * `ARCHIVE_PROVIDERS_WITH_READERS`, and a test holds the two equal.
 */
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
 *
 * `targetStore` is how this migration's own file target becomes readable, for
 * an archive whose `where` says it is in there (0116 T4, the relay). A thunk,
 * so a mapping that never says `target` is never refused for a target it does
 * not read from — see {@link storeFor}.
 */
export function buildArchiveSourceFrom(
  config: Record<string, unknown>,
  options: { readonly targetStore?: () => ArchiveStore } = {},
): FileSource {
  const location = parseArchiveSource(config);
  const reader = archiveReaderForLocation(location, options.targetStore);
  if (!reader) {
    throw new Error(
      `No reader is built for ${archiveProviderName(location.provider)} exports yet, so this ` +
        'archive cannot be migrated from. This is a wiring gap in this product, not a problem ' +
        'with your export — nothing about it prevents reading it once the reader exists.',
    );
  }
  return new ArchiveFileSource(reader, location);
}

/**
 * THE ARCHIVE'S OWN FILE TARGET, AS A STORE (workplan 0116 T4, the relay).
 *
 * The relay puts the parts of a download in the customer's own file target
 * and the pass reads them there. What "there" resolves to is already solved
 * for every target this product writes to: `fileEndpointFromCreds` is what
 * the file domain itself aims at, `fileBaseUrl` and all. So this takes that
 * same endpoint and hands it to the store — and in doing so it holds the
 * owner's constraint of 2026-09-20 (*"we do however have to anticipate
 * people might have other targets then nextcloud for files or photo's"*):
 * nothing here asks which product answers the URL. PROPFIND, GET and `Range`
 * are WebDAV.
 *
 * A target this product writes over JMAP is the one that cannot serve this,
 * and it is refused BY SENTENCE rather than by a store that answers "absent"
 * to every path — which is the difference between *this destination cannot
 * hand us bytes by range* and *your export is not there*, and only one of
 * those can be acted on.
 */
export function archiveStoreInTarget(
  protocol: 'webdav' | 'jmap',
  endpoint: DavEndpoint,
  targetKind: string,
): ArchiveStore {
  if (protocol !== 'webdav') {
    // The sentence is shared (0148 T9): the create door and the wizard's
    // target step refuse a JMAP destination in these words before any pass
    // gets here, through `archiveInTargetRefusal`.
    throw new Error(archiveInJmapTargetSentence(targetKind));
  }
  return webdavStore(endpoint);
}

/**
 * The reader for a PARSED location, opened through the store that location
 * names — the one door the pass, the probe and the qualification share.
 *
 * `archiveReaderFor` takes a provider and a store and asks no questions;
 * this takes the location and answers the question `where` poses, so that
 * three callers cannot each decide it differently. Undefined for an export
 * with no reader built, exactly as `archiveReaderFor` is; it THROWS for a
 * location inside a target that is not in hand, because that is not a missing
 * reader — it is a reader with nothing to read through, and the sentence
 * `storeFor` writes is the one a person can act on.
 */
export function archiveReaderForLocation(
  location: ArchiveSource,
  targetStore?: () => ArchiveStore,
): ArchiveReader | undefined {
  return archiveReaderFor(location.provider, storeFor(location, targetStore));
}

/**
 * Which store the location names, or `undefined` for the machine's own disk.
 *
 * `where` is the whole of the decision (see `ArchiveSource.where`) and the
 * default is `disk`, so a mapping written before the relay existed keeps
 * meaning what it meant. The caller passes a THUNK rather than a store
 * because building one can refuse — a JMAP target cannot serve a range — and
 * a mapping that never says `target` must not be refused for a target it
 * never asked to read from.
 */
function storeFor(
  location: ArchiveSource,
  targetStore: (() => ArchiveStore) | undefined,
): ArchiveStore | undefined {
  if (location.where !== 'target') return undefined;
  if (!targetStore) {
    throw new Error(
      'This archive says it is inside the migration\'s own file target, but it is being opened ' +
        'without one — a connection test, or a surface that has no migration in hand. The ' +
        'archive is readable; there is just nothing here yet to read it THROUGH. Its contents ' +
        'are counted at the preflight, once the migration names where it writes.',
    );
  }
  return targetStore();
}
