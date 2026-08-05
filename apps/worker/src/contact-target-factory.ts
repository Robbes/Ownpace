// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Which protocol carries the contacts domain to the target (workplan 0031 T2.2).
 *
 * ONE decision function used by BOTH deps builders — `build-deps.ts` (self-host
 * file config) and `build-deps-from-mapping.ts` (managed DB rows) — because
 * ADR-0026 is "one operating UI, one contract" and a target available in one
 * edition and not the other is exactly the split that promise forbids
 * (hard rule 5).
 *
 * **JMAP does not replace CardDAV and must not.** Nextcloud, openDesk and
 * Soverin do not speak JMAP for contacts, and a customer already mid-migration
 * on CardDAV must not be moved. `carddav` stays the default for everything
 * that is not explicitly a JMAP connection; this only adds a door for the one
 * server that speaks it.
 *
 * Switching an existing mapping between the two is safe, and that is not an
 * assumption: the natural key is the vCard UID on both paths, proven to
 * survive `ContactCard/parse` byte-identical on 2026-08-05, so a switched
 * mapping adopts what is there rather than re-copying it (hard rule 1).
 */

import { CardDAVTargetWriter } from '@openmig/engines';
import { JmapContactTarget } from '@openmig/connectors';
import type { ContactTargetWriter } from '@openmig/shared';
import type { DavEndpoint, DavTargetDeps } from './dav-factories';

/** The protocols this product can carry contacts over. */
export type ContactTargetProtocol = 'carddav' | 'jmap';

/**
 * Read the protocol off a stored connection `kind` or a config `type`.
 *
 * The two editions name the same fact differently — the managed schema calls
 * it `connection.kind` (`'jmap'` has been a valid value since the 0001
 * baseline) and the self-host config calls it `target.type` — so both spellings
 * resolve here rather than each builder deciding for itself.
 *
 * **Everything unrecognised falls back to `carddav`, deliberately.** The
 * alternative is throwing on a kind we do not know, and that would turn every
 * existing `nextcloud` / `soverin` / `proton` contacts mapping into a hard
 * failure the day this shipped. The fallback is what it has always done.
 */
export function contactTargetProtocol(kindOrType: string | undefined): ContactTargetProtocol {
  return kindOrType === 'jmap' ? 'jmap' : 'carddav';
}

/**
 * Build the contacts target writer for a resolved endpoint.
 *
 * `deps` is the ledger bundle the DAV writer needs and the JMAP one does not:
 * `CardDAVTargetWriter` records its own rows because `recordIfAbsent` makes the
 * first writer win and that is it, whereas `JmapContactTarget` leaves recording
 * to `runDomainSync` exactly as `JmapTargetWriter` does for mail. Nothing is
 * lost by that — the loop persists `result.targetVersion` (domain-sync.ts), so
 * the JMAP writer's stored-card fingerprint reaches the ledger and its
 * overwrite protection works on the next pass.
 */
export function buildContactTargetFor(
  protocol: ContactTargetProtocol,
  endpoint: DavEndpoint,
  deps: DavTargetDeps,
): ContactTargetWriter {
  if (protocol === 'jmap') {
    return new JmapContactTarget({
      baseUrl: endpoint.url,
      username: endpoint.username,
      password: endpoint.password,
    });
  }
  return new CardDAVTargetWriter(
    { url: endpoint.url, username: endpoint.username, password: endpoint.password },
    deps,
  );
}
