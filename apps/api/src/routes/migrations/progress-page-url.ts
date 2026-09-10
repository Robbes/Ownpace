// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The one kind of string the migrator's ending page may be handed
 * (workplan 0122 T7).
 *
 * ## Why a type exists for this at all
 *
 * `grantResultPage` was built in 0108 T4 with a signature that has **nowhere to
 * put a token**, and its own header says why:
 *
 * > *"the page cannot show it, cannot postMessage it, and cannot be edited later
 * > to do either without someone first widening this signature and explaining
 * > why."*
 *
 * Slice 2 is that widening, and this file is the explanation — plus the part
 * that makes the explanation load-bearing rather than decorative. The page now
 * takes one more value, and that value is a **bearer secret in a URL**, which is
 * exactly the shape of the thing the original signature was built to keep out.
 * A plain `string` parameter would hand the next person a slot that
 * `outcome.refreshToken` fits into perfectly.
 *
 * So the parameter is not a `string`. `ProgressPageUrl` is a branded type, and
 * `progressPageUrl()` below is the only way to make one — called from the one
 * place that mints a `view` link. Passing a refresh token, an access token, a
 * client secret or any other string to the page is a **compile error**, in all
 * four `tsc` passes, rather than a review someone has to catch.
 *
 * ## What is deliberately NOT claimed
 *
 * This does not make the URL safe to log, to email or to put in an error
 * message. It carries a secret and it is the holder's whole credential for
 * their progress page. The brand says one thing only: *this string came from
 * minting a progress link, and nothing else can pretend it did.*
 */

declare const progressPageUrlBrand: unique symbol;

/** A `/view/<id>.<secret>` address, and provably nothing else. */
export type ProgressPageUrl = string & { readonly [progressPageUrlBrand]: true };

/**
 * The only constructor. Deliberately not exported beyond this package's own
 * minting path — see `grant-ending.ts`, its single caller.
 */
export function progressPageUrl(base: string, token: string): ProgressPageUrl {
  return `${base}/view/${token}` as ProgressPageUrl;
}
