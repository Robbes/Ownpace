// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * NO EXPORT ARCHIVE ON THE SERVER'S OWN DISK (workplan 0136 T5; 0148 D10, D11).
 *
 * An archive's credential is a location (0116 T1), and `where` says which
 * store the path is in. `disk`, and a config that says nothing, mean the
 * machine running the pass. That is the appliance's route: there the machine
 * is the person's own, and the shared parser keeps `disk` as the default
 * because the appliance's mapping file needs it (hard rule 5). On managed the
 * machine is ours. A run container has no shared volume, so the pass could
 * never read the export, and the connection doors did something worse: they
 * probed and qualified the typed path inside the API process, which answered
 * whether a path existed, what kind of thing it was, and a walk of any folder
 * (0136 §1 and §4).
 *
 * `apps/api` serves the managed edition only, so the refusal lives here and
 * not in the parser, and every door that stores, probes or qualifies an
 * archive calls this one function before anything opens a path:
 *
 *  - `POST /api/connections` (add) and `POST /api/migrations/test-connection`
 *    and `POST /api/migrations` (create, a new connection or a reused one's
 *    override) — a path somebody posted, answered 400;
 *  - `POST /api/connections/:id/test` and `PUT /api/connections/:id/credentials`
 *    — a path already stored, answered 409, because the request is fine and
 *    the row is what this edition cannot serve.
 *
 * `where: 'target'` passes: the path is inside the migration's own file target
 * and is read over the wire (0116 T4). Since 0148 T9 the doors keep a posted
 * `where`, and the wizard and the Connections page offer the choice the
 * sentence names, with the destination as managed's default. Whether the
 * destination can serve it is the create door's next question, asked through
 * the shared `archiveInTargetRefusal`.
 *
 * The sentence is a refusal, so it renders as served and stays English
 * (`docs/i18n-prose-boundary.md`); `archive_on_server` is the stable code a
 * screen may explain beside it.
 */

import type { ArchiveWhere } from '@openmig/shared';
import { isArchiveKind } from '@openmig/orchestration/account-qualification';

/** The stable code beside the sentence. */
export const ARCHIVE_ON_SERVER = 'archive_on_server';

/** Where a managed migration can read an export: the only `where` this edition serves. */
const READABLE_ON_MANAGED: ArchiveWhere = 'target';

/**
 * What the person reads. It says why (a managed pass cannot read a file on
 * the server) and where the export goes instead (0148 D11): a folder of the
 * Nextcloud or WebDAV files the migration writes to — the two targets whose
 * files the reader can ask for in byte ranges.
 */
export const ARCHIVE_ON_SERVER_REASON =
  'A managed migration cannot read a file on the server: a path here names a place on this ' +
  "service's own machine, not on yours. On the managed service, the export goes in a folder " +
  'of the Nextcloud or WebDAV files the migration writes to.';

export interface ArchiveOnServerRefusal {
  readonly error: typeof ARCHIVE_ON_SERVER;
  /** The field at fault, the handle `missing_fields` and `invalid_values` give too. */
  readonly fields: readonly ['path'];
  readonly reason: string;
}

/**
 * The refusal for an archive this edition would have to read from its own
 * disk, or `undefined` for anything else.
 *
 * `kind` is the connection kind (for an archive the wizard's word and the
 * kind are the same word). `location` is the config the door would store or
 * read — the new connection's, a reused connection's override, or the stored
 * row's — so the judgement is on what the pass and the probe would actually
 * see, never on a field the door drops on the way in.
 */
export function archiveOnServerRefusal(
  kind: string,
  location: Readonly<Record<string, unknown>> | null | undefined,
): ArchiveOnServerRefusal | undefined {
  if (!isArchiveKind(kind)) return undefined;
  if (location?.['where'] === READABLE_ON_MANAGED) return undefined;
  return { error: ARCHIVE_ON_SERVER, fields: ['path'], reason: ARCHIVE_ON_SERVER_REASON };
}
