// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A DROPBOX GRANT LINK'S ENDING (workplan 0174 §6, superseding 0171 T4).
 *
 * The ending Microsoft's link has had since alpha.20 (`link-ending.ts`), with
 * Dropbox's own parts: its name, and what it recorded judged by the scopes
 * this product reads with. The binding itself is the entry's `finish`
 * (`grant-providers.ts`): the code exchanged, then `get_current_account`,
 * whose verified `email` must be the account the migration names. Anything
 * else stores nothing and leaves the link live.
 */

import { DROPBOX_ACCEPTED_SCOPES } from './dropbox-consent.ts';
import type { RecordedPermission } from './google-consent.ts';
import {
  decideLinkEnding,
  type LinkEndingEffects,
  type LinkEndingPage,
  type LinkEndingPending,
  type LinkEndingProvider,
} from './link-ending.ts';

/**
 * Read-only at Dropbox when every scope it recorded is one this product reads
 * with. The exchange already refuses a grant that carries more
 * (`unexpectedDropboxScopes`), so a stored grant is read-only; this says so
 * from what Dropbox recorded rather than assuming it.
 */
export function dropboxRecordedPermission(grantedScopes: ReadonlyArray<string>): RecordedPermission {
  return grantedScopes.every((s) => DROPBOX_ACCEPTED_SCOPES.includes(s)) ? 'read-only' : 'allows-changes';
}

/** Dropbox's own parts of the ending. It words no policy refusal of its own. */
export const DROPBOX_LINK_ENDING: LinkEndingProvider = {
  id: 'dropbox',
  name: 'Dropbox',
  recordedPermission: dropboxRecordedPermission,
};

/** The whole ending, decided, for a Dropbox consent (`decideLinkEnding`). */
export function decideDropboxLinkEnding(
  pending: LinkEndingPending,
  query: { readonly error?: unknown; readonly error_description?: unknown; readonly code?: unknown },
  effects: LinkEndingEffects,
): Promise<LinkEndingPage> {
  return decideLinkEnding(DROPBOX_LINK_ENDING, pending, query, effects);
}
