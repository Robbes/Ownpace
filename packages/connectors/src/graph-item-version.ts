// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The version of an Outlook item, a contact or an event, as the sync loop
 * compares it: `sourceVersion`, read from the item's `etag`.
 *
 * ## An edit nobody copied, again (found 2026-09-23)
 *
 * `classifyKnownItem` SKIPS a copied item whose listing gives no version, and
 * both Graph listings gave none. So a contact or an event edited in Outlook
 * after its first copy was never copied again. Graph's delta put the edited
 * item in front of the pass every time, and every pass skipped it and said
 * nothing. It is the defect `fileVersion` fixed for Drive and OneDrive the day
 * before (#1083), in the two Microsoft listings that fix did not reach. Found
 * while tracing the owner's contact that arrived without its photo: with no
 * version, an edit could not bring the photo either.
 *
 * ## Which field, and why in this order
 *
 *  - `changeKey` is what Graph documents as the item's version: it changes
 *    every time the item does. It comes with every contact and every event.
 *  - `@odata.etag` is the same validator as a weak ETag. It is the fallback
 *    for a response that leaves `changeKey` out.
 *  - `lastModifiedDateTime` is the last resort, as it is for a file without a
 *    hash.
 *
 * Each is prefixed with what it is, so a listing that switches from one to
 * another reads as a change rather than an accidental match. With none of the
 * three there is no version at all rather than a constant, which would claim
 * "unchanged" with the confidence of a real comparison.
 *
 * ## No mass rewrite on upgrade
 *
 * A copy made before this has no recorded version, so the loop records one
 * (`record-version`) and rewrites nothing. The next real edit is the one that
 * is copied. That is #1083's rule, for the same reason: a first pass after an
 * upgrade must not rewrite every card in somebody's address book.
 */

export interface GraphVersioned {
  readonly changeKey?: string;
  readonly '@odata.etag'?: string;
  readonly lastModifiedDateTime?: string;
}

/** The item's version as `{ etag }`, or nothing when Graph gave none. */
export function graphItemVersion(item: GraphVersioned): { readonly etag?: string } {
  if (item.changeKey) return { etag: `changeKey:${item.changeKey}` };
  if (item['@odata.etag']) return { etag: `odata:${item['@odata.etag']}` };
  if (item.lastModifiedDateTime) return { etag: `modified:${item.lastModifiedDateTime}` };
  return {};
}
