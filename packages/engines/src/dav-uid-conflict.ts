// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE COLLECTION ALREADY HOLDS THIS UID — AT SOME OTHER HREF.
 *
 * Both DAV writers create with `If-None-Match: *`, which makes the write
 * atomic against the HREF: if something is already at that path the server
 * answers 412, and both writers read that correctly — *"not an error, the
 * caller's snapshot was merely stale, and the resource is exactly what we
 * would have written."*
 *
 * But a CalDAV collection's uniqueness rule is not on the href. RFC 4791
 * §5.3.2 forbids two calendar object resources in one collection from sharing
 * a UID, and the href is ours to choose — we name it after the source's own
 * handle. So when the same UID reaches us under a second source handle, the
 * precondition does not fire (that path IS free) and the server refuses the
 * body instead:
 *
 *     PUT failed for …/<id>.ics with status 400:
 *     Sabre\DAV\Exception\BadRequest — Calendar object with uid already
 *     exists in this calendar collection.
 *
 * Which is the 412 again, on the other axis, and it was being thrown. The item
 * spent an attempt, landed `failed`, and reported a category of `unknown` —
 * whose published remedy is *"send it to us and we will look"* for a refusal
 * that says in plain words what is wrong. A later pass then found the object
 * through the by-UID check and adopted it, so the failure was transient in the
 * ledger and permanent in the operator's report of that run.
 *
 * ## What is matched, and how sure each part is
 *
 * The same standard `dav-payload-defects.ts` and the `format_refused` rule
 * keep: a phrase that turns out to be wrong must fail to fire rather than fire
 * wrongly, because the fallback (throw the refusal unchanged) is exactly the
 * behaviour this replaces.
 *
 *  - `uid` followed by `already exists` is the SHAPE of the claim, and the
 *    CalDAV sentence above is the one this code has OBSERVED, on a live
 *    Nextcloud, four times in one run.
 *  - The window between them is bounded because a server that names the UID
 *    inline (`Card with uid <…> already exists in this addressbook`) puts an
 *    arbitrary identifier in the middle. Bounded, not unbounded, so the two
 *    tokens have to belong to one sentence rather than merely to one document.
 *
 * NOT matched, deliberately: "already exists" on its own. That is what a
 * server says about an HREF, which is the 412 case and is already handled —
 * reading it here would claim a UID collision for an ordinary stale snapshot
 * and adopt a resource that is not this item.
 */

/**
 * Does this refusal body say the collection already holds our UID?
 *
 * Reading only. A `true` here is never on its own enough to record anything:
 * the caller must still ASK the server where that UID lives and get an href
 * back, because a refusal is a claim about the collection and not a handle to
 * the object. See `caldav-target-writer.ts`'s use — it throws the original
 * refusal when the lookup comes back empty.
 */
export function refusalSaysUidAlreadyPresent(body: string): boolean {
  return /\buid\b.{0,200}?\balready\s+exists\b/is.test(body);
}
