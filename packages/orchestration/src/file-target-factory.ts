// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Which protocol carries the files domain to the target (workplan 0031 T3).
 *
 * ONE decision function used by BOTH deps builders — `build-deps.ts` (self-host
 * file config) and `build-deps-from-mapping.ts` (managed DB rows) — because
 * ADR-0026 is "one operating UI, one contract" and a target available in one
 * edition and not the other is exactly the split that promise forbids
 * (hard rule 5). The same shape as `contact-target-factory.ts`, deliberately:
 * two near-identical dispatchers that drift apart is how one edition quietly
 * loses a target.
 *
 * **JMAP does not replace WebDAV and must not.** Nextcloud and openDesk do not
 * speak JMAP for files, and a customer already mid-migration on WebDAV must not
 * be moved. `webdav` stays the default for everything that is not explicitly a
 * JMAP connection; this only adds a door for the one server that speaks it.
 *
 * Switching an existing mapping between the two is safe, and that is not an
 * assumption about the protocol — it is a property of the KEY. Both paths key
 * on the same root-relative path: WebDAV reads it off the URL
 * (`WebdavFileSource.toRelativePath`) and JMAP rebuilds it from the node's
 * parent chain (`reconstructFileNodePath`), and `jmap-file-path.unit.test.ts`
 * pins the two as producing the same `fileNaturalKeyHash`. So a switched
 * mapping adopts what is there rather than re-copying it (hard rule 1).
 */

import { WebDAVTargetWriter } from '@openmig/engines';
import { CirruxDriveApi, CirruxDriveTarget, CirruxTokenProvider, JmapFileTarget } from '@openmig/connectors';
import type { FileTargetWriter } from '@openmig/shared';
import type { DavEndpoint, DavTargetDeps } from './dav-factories.ts';
import { PgCirruxGrantStore, type CirruxGrantRow } from './cirrux-grant-store.ts';

/**
 * The protocols this product can carry files over.
 *
 * `cirrux-drive` is no standard protocol: Cirrux Drive is reached only
 * through Cirrux's own API, with a person's OAuth sign-in stored on the
 * `cirrux` account (workplan 0160 T5, ADR-0052). It needs what a DAV endpoint
 * does not carry, the account's row (`CirruxDriveDeps`), because every
 * refresh of that sign-in is written back to it under its lock.
 */
export type FileTargetProtocol = 'webdav' | 'jmap' | 'cirrux-drive';

/** What the Cirrux Drive writer needs beside the endpoint every writer gets. */
export interface CirruxDriveDeps {
  /** The deployment's public client (`CIRRUX_OAUTH_CLIENT_ID`). */
  readonly clientId: string;
  /** The `cirrux` account the grant is stored on, and the pool its lock is taken on. */
  readonly row: CirruxGrantRow;
}

/**
 * Read the protocol off a stored connection `kind` or a config `type`.
 *
 * The two editions name the same fact differently — the managed schema calls
 * it `connection.kind` (`'jmap'` has been a valid value since the 0001
 * baseline) and the self-host config calls it `target.type` — so both spellings
 * resolve here rather than each builder deciding for itself.
 *
 * **Everything unrecognised falls back to `webdav`, deliberately.** The
 * alternative is throwing on a kind we do not know, and that would turn every
 * existing `nextcloud` / `webdav` files mapping into a hard failure the day
 * this shipped. The fallback is what it has always done.
 */
export function fileTargetProtocol(kindOrType: string | undefined): FileTargetProtocol {
  if (kindOrType === 'jmap') return 'jmap';
  // A `cirrux` account's files are its Drive (workplan 0160 T5). Only a
  // stored connection names this kind; the appliance's config has no such
  // type, and so never reaches it.
  if (kindOrType === 'cirrux') return 'cirrux-drive';
  return 'webdav';
}

/**
 * Build the files target writer for a resolved endpoint.
 *
 * `deps` is the ledger bundle the WebDAV writer needs and the JMAP one does
 * not: `WebDAVTargetWriter` records its own rows because `recordIfAbsent` makes
 * the first writer win and that is it, whereas `JmapFileTarget` leaves
 * recording to `runDomainSync` exactly as `JmapTargetWriter` and
 * `JmapContactTarget` do. Nothing is lost by that — the loop persists
 * `result.targetVersion` (domain-sync.ts), so the JMAP writer's stored-node
 * fingerprint reaches the ledger and its overwrite protection works on the
 * next pass.
 */
export function buildFileTargetFor(
  protocol: FileTargetProtocol,
  endpoint: DavEndpoint,
  deps: DavTargetDeps,
  cirrux?: CirruxDriveDeps,
): FileTargetWriter {
  if (protocol === 'cirrux-drive') {
    if (!cirrux) {
      // Never reached by the appliance, whose config has no `cirrux` type; a
      // caller that names the protocol without the account is refused by name.
      throw new Error(
        'Cirrux Drive is written through the Cirrux account it is connected on, and none was given. ' +
          'This is a wiring gap, not a credential problem.',
      );
    }
    return buildCirruxDriveTarget(cirrux, deps.targetFolderPrefix);
  }
  if (protocol === 'jmap') {
    return new JmapFileTarget({
      baseUrl: endpoint.url,
      username: endpoint.username,
      password: endpoint.password,
    });
  }
  return new WebDAVTargetWriter(
    {
      url: endpoint.url,
      username: endpoint.username,
      password: endpoint.password,
      ...(deps.targetFolderPrefix ? { targetFolderPrefix: deps.targetFolderPrefix } : {}),
    },
    deps,
  );
}

/**
 * The Cirrux Drive writer for one account: its token provider over the row's
 * lock (ADR-0052), the API over that, the writer over the API. One of each per
 * writer, so the items of one pass share one access token and one refresh.
 */
export function buildCirruxDriveTarget(cirrux: CirruxDriveDeps, targetFolderPrefix?: string): CirruxDriveTarget {
  const tokens = new CirruxTokenProvider({ clientId: cirrux.clientId, store: new PgCirruxGrantStore(cirrux.row) });
  return new CirruxDriveTarget({
    api: new CirruxDriveApi({ tokens }),
    ...(targetFolderPrefix ? { targetFolderPrefix } : {}),
  });
}
