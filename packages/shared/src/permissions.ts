// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The permission inventory's vocabulary (SAD §14.2, workplan 0029 T1).
 *
 * §14.2's promise is *covered, not necessarily automated*: discover every
 * right on the source, map what maps cleanly, guide the rest. This module is
 * the shape those findings take, kept in `shared` for the same reason
 * `DirectoryListing` is — the connector that produces them and the report
 * that consumes them are in different packages, and neither should own the
 * other's vocabulary.
 *
 * THE UNION IS THE DESIGN, again. A cutover that nobody inventoried is how
 * SendAs on the shared address, the assistant's FullAccess and the family
 * calendar share all break silently on day one. An inventory that came back
 * empty because nobody could look reads exactly like one that came back empty
 * because there was nothing to find — and the first is the dangerous one, so
 * they are different values (hard rule 9).
 */

/** What kind of thing a right was granted over. */
export type PermissionSubject = 'mailbox' | 'calendar' | 'drive_item';

/**
 * One right, as the source stated it.
 *
 * `raw` is the source's own words, kept verbatim — the report renders it
 * unchanged (the prose boundary: translate the frame, never the finding).
 * Everything else is a handle for grouping and mapping; nothing here is a
 * normalised model of "permission", because the whole §14.2 position is that
 * a fragile full ACL translator is what NOT to build.
 */
export interface PermissionGrant {
  readonly subject: PermissionSubject;
  /** What the right is over: an address, a calendar name, a file path. */
  readonly on: string;
  /** Who holds it, as the source names them. Empty for a link-style grant. */
  readonly grantee?: string;
  /** The source's own name for the right: `FullAccess`, `write`, `owner`. */
  readonly role: string;
  /**
   * The grant verbatim, for the report and for anybody re-checking it later.
   * Never parsed for meaning downstream — it is evidence, not a model.
   */
  readonly raw: string;
  /**
   * True when the right is held by a sharing LINK rather than a person —
   * "anyone with this link can edit" is a different risk from "Anna can
   * edit", and a report that flattened them would hide the one worth acting
   * on before cutover.
   */
  readonly viaLink?: boolean;
}

/**
 * What a source came back with when asked for the rights on something.
 *
 * `not_discoverable` carries the reason IN THE SOURCE'S TERMS, and it is not
 * a failure state: some rights genuinely cannot be read through the API this
 * tool uses, and saying so precisely is more useful than an empty list and
 * more honest than a silent skip.
 */
export type PermissionListing =
  | { readonly kind: 'listed'; readonly grants: readonly PermissionGrant[] }
  | { readonly kind: 'not_discoverable'; readonly reason: string };

/** What a source should SAY when it cannot inventory a class of rights. */
export function permissionsNotDiscoverable(reason: string): string {
  return (
    `These permissions could not be inventoried: ${reason}. This is not "no permissions ` +
    `are set" — nothing was looked at, and anything granted here will stop working at ` +
    `cutover without warning.`
  );
}
