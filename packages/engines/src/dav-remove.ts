// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Removing a copy this tool wrote, over DAV.
 *
 * Shared by the three DAV target writers because the sequence is identical and the
 * two subtleties are easy to get differently wrong in three places — and a
 * difference between them would be a difference in whether somebody's data is
 * recoverable.
 *
 * SUBTLETY ONE: ownership is re-checked at the last possible moment, by HEADing
 * the resource and comparing ETags, exactly as the overwrite path does. Checking
 * in the caller instead would leave a window between reading the version and
 * deleting, and this is the operation where that window costs the most.
 *
 * SUBTLETY TWO: whether a DELETE is recoverable is a property of the SERVER, not
 * of DAV. Nextcloud moves a deleted file to its trashbin and keeps it for a
 * retention window; a plain WebDAV server removes it outright. RFC 4918 §9.6 says
 * nothing either way. So the kind is reported from what we can actually tell, and
 * the honest default is the pessimistic one: claiming `binned` when the bytes are
 * gone would tell an operator their mistake is recoverable when it is not.
 */

import { readEtag, ownershipOf } from './dav-target-version.ts';
import { requestWithDavRetry } from './dav-retry.ts';
import type { RemovalResult, RemovalKind } from '@openmig/shared';

/**
 * The minimum an HTTP client must do for this helper.
 *
 * Matches the `HttpClient`/`HttpResponse` shape each of the three DAV writers
 * already declares (and the shared one in `dav-http.types.ts`) — `headers` is
 * always present, never optional, because every real implementation normalises
 * it that way before handing a response back.
 */
interface DavRequest {
  method: string;
  url: string;
  headers?: Record<string, string>;
}
interface DavResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/**
 * Does a DELETE on this URL go to a recoverable bin?
 *
 * True only for Nextcloud's files endpoint, whose trashbin behaviour is
 * documented and which this repo already reads on the source side
 * (`nextcloudTrashbinUrl` in the connectors package — the same convention, matched
 * the same way, deliberately duplicated as one regex rather than made into a
 * cross-package dependency).
 *
 * CALENDAR AND CONTACTS ANSWER FALSE even on Nextcloud. Recent versions do keep a
 * deleted calendar object for a while, but that is version-dependent and this code
 * cannot tell which version it is talking to. Reporting `deleted` when the server
 * may in fact have kept a copy is the safe direction to be wrong in; the reverse
 * would promise a recovery path that might not exist.
 */
export function davDeleteIsRecoverable(url: string): boolean {
  try {
    return /\/dav\/files\/[^/]+/.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

export interface RemoveDavResourceDeps {
  /** Absolute URL of the resource to remove. */
  readonly url: string;
  readonly authorization: string;
  readonly request: (options: DavRequest) => Promise<DavResponse>;
  /**
   * The ETag we recorded for our copy. When present, the resource is HEADed and
   * the removal refused unless the target still reports it.
   */
  readonly expectedTargetVersion?: string;
  /**
   * Force the reported kind instead of deriving it from the URL.
   *
   * Used by the calendar and contact writers, which answer `deleted` regardless —
   * see the note on `davDeleteIsRecoverable`.
   */
  readonly kind?: RemovalKind;
}

/**
 * A removal needs a resource to remove.
 *
 * Every DAV writer turns its `targetId` into a URL with `buildUrl(targetId)`,
 * and `buildUrl('')` is the COLLECTION — so an empty handle does not fail, it
 * silently aims the DELETE at the whole calendar, address book or folder.
 * Applying one deletion would remove the container and everything in it.
 *
 * That was reachable: `PgLedger` stored `target_ref` double-encoded, so
 * `mapRowToRecord` read `undefined` and handed `''` to every caller, and
 * `apply-deletion.ts` passes that straight to `removeItem`. The storage bug is
 * fixed and migration 0027 repairs the rows, but the guard belongs here too —
 * a handle we do not have must never widen into permission to delete its
 * container (ADR-0024: nothing is removed outside the gated apply path, and
 * certainly not more than was asked for).
 */
export function assertRemovableTargetId(targetId: string, what: string): void {
  if (targetId.trim() === '') {
    throw new Error(
      `Refusing to remove ${what}: the ledger holds no target handle for it. ` +
        'An empty handle would address the collection itself, and deleting a ' +
        'container is never what a single-item removal meant. Nothing was changed.',
    );
  }
}

/** DELETE one DAV resource, refusing if the owner has edited it since. */
export async function removeDavResource(deps: RemoveDavResourceDeps): Promise<RemovalResult> {
  const { url, authorization, request, expectedTargetVersion } = deps;
  const send = (options: DavRequest) => requestWithDavRetry(() => request(options));

  if (expectedTargetVersion !== undefined) {
    const head = await send({ method: 'HEAD', url, headers: { Authorization: authorization } });
    // A HEAD that fails tells us nothing about the ETag, and `ownershipOf` treats
    // two unknowns as "proceed" — which is right for a rewrite and right here too:
    // the alternative is refusing every removal against a server that answers no
    // ETag, i.e. a protection that presents as an outage.
    const current = head.status >= 200 && head.status < 300 ? readEtag(head) : undefined;
    if (ownershipOf(expectedTargetVersion, current) === 'changed') {
      return { conflicted: true };
    }
  }

  const response = await send({
    method: 'DELETE',
    url,
    // Schedule-Reply: F (RFC 6638 §8.1) — this DELETE is a migration's
    // bookkeeping, not a person declining a meeting. On a scheduling server
    // it suppresses the iTIP reply/cancel a bare DELETE can fan out to the
    // organiser and attendees; elsewhere it is an unknown header, ignored
    // (0103 T5, ADR-0043). Belt to the writer's SCHEDULE-AGENT=CLIENT
    // braces: either alone silences an honouring server, and a server
    // honouring neither is T3's measurement to expose.
    headers: { Authorization: authorization, 'Schedule-Reply': 'F' },
  });

  // 404/410 mean it is already gone. Reported as a successful removal rather than
  // an error: the end state the owner asked for is the end state that exists, and
  // failing here would leave a queue entry nobody can ever close.
  if (response.status === 404 || response.status === 410) {
    return { kind: 'deleted' };
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `DELETE ${url} failed with status ${response.status}${response.body ? `: ${response.body.slice(0, 200)}` : ''}`,
    );
  }

  return { kind: deps.kind ?? (davDeleteIsRecoverable(url) ? 'binned' : 'deleted') };
}
