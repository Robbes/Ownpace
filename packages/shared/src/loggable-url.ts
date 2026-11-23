// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A REQUEST'S URL AS A LOG MAY KEEP IT (moved from apps/api's `access-log.ts`,
 * workplan 0168, so the appliance's own lines can keep the same rule).
 *
 * Three kinds of request carry a secret in the URL or the Referer: a grant or
 * view link (`/api/grant/<link>`, `/api/view/<link>`), the page that holds one
 * (`/grant/<link>`, `/view/<link>`), which the browser sends as the Referer of
 * every call it makes, and an OAuth callback's `?code=…&state=…`. And one kind
 * carries an address: a row of the table of address changes is named by its
 * old address (`/address-changes/<key>`, behind `/api/` or a link's route on
 * the managed service, at the root on the appliance).
 *
 * So a link becomes `:link`, whatever the case or the spelling of its route,
 * an address change's key becomes `:key` by the same reading, and a query
 * string is reduced to the fact that there was one. The API's access log
 * (`apps/api/src/access-log.ts`), its other lines, and the appliance's line
 * for a request that failed all keep a URL by this rule; the web image's
 * nginx writes its access log by the same patterns
 * (`apps/web/nginx.conf.template`, held to them by
 * `scripts/a-log-that-kept-the-link.unit.test.ts`).
 */

/**
 * A route word as a router reads it: each letter in either case, or as its
 * percent escape. Express routes without regard to case, its default, so
 * `/API/GRANT/<link>` reaches the grant route. The web app's router matches
 * without regard to case too, and decodes the path before it matches, so
 * `/GRANT/<link>` and `/%67rant/<link>` open the grant page (2026-10-05). The
 * pattern reads the escape as written and decodes nothing, so the route is
 * kept as it came in; only the link goes. Used with the `i` flag, which also
 * reads the escape's hex digits in either case.
 */
function spelled(word: string): string {
  return [...word]
    .map((letter) => {
      const lower = letter.charCodeAt(0).toString(16);
      const upper = letter.toUpperCase().charCodeAt(0).toString(16);
      return `(?:${letter}|%[${upper[0]}${lower[0]}]${lower[1]})`;
    })
    .join('');
}

/** The route a link follows: `/grant/`, `/view/`, `/api/grant/` or `/api/view/`. */
const LINK_ROUTE = `/(?:${spelled('api')}/)?(?:${spelled('grant')}|${spelled('view')})/`;

/**
 * A path segment that is a link credential, and the route it follows. Behind
 * a scheme and a host too: a request may name its target in absolute form
 * (`GET http://host/api/grant/<link>`), and Express routes it by its path.
 */
const LINK_SEGMENT = new RegExp(`^((?:[a-z][a-z0-9+.-]*://[^/]+)?${LINK_ROUTE})[^/]+`, 'i');

/**
 * The path segment that is an address change's key, and everything before it
 * (0168's review, finding 2): the first segment after an `address-changes/`
 * route word, wherever it is, in any case or spelling, as a link's route is
 * read. The one such segment that is a route word and no key is `apply`
 * (`/api/migrations/<id>/address-changes/apply`), and it stays.
 */
const KEY_SEGMENT = new RegExp(`^([^?]*?/${spelled('address-changes')}/)(?!apply(?:[/?]|$))[^/?]+`, 'i');

/** What a query string is reduced to: that there was one, and nothing it said. */
export const QUERY_MARK = '?...';

/** A request URL as the log may keep it. */
export function loggableUrl(url: string | undefined): string {
  if (!url) return '-';
  const query = url.indexOf('?');
  const path = query === -1 ? url : url.slice(0, query);
  const kept = path.replace(LINK_SEGMENT, '$1:link').replace(KEY_SEGMENT, '$1:key');
  return query === -1 ? kept : `${kept}${QUERY_MARK}`;
}

/** The start of an absolute URL: a scheme and `://`. */
const ABSOLUTE_URL = /^[a-z][a-z0-9+.-]*:\/\//;

/**
 * The same link segment, behind a scheme and a host. Only a value
 * `ABSOLUTE_URL` has passed reaches it, so the scheme is still read in lower
 * case alone, as before; the host was always read in any case.
 */
const REFERRER_LINK_SEGMENT = new RegExp(`^([a-z][a-z0-9+.-]*://[^/]+${LINK_ROUTE})[^/]+`, 'i');

/**
 * A Referer as the log may keep it: the same rule, behind the origin. A value
 * that is not a URL is not echoed, since there is no telling what it holds.
 *
 * Plain patterns rather than `new URL()`, which would also normalise the value
 * (a default port dropped, a host lower-cased), because the web image's nginx
 * applies these same patterns and cannot normalise: two logs that must agree
 * are held to one rule by a guard that runs the template's own patterns
 * (`scripts/a-log-that-kept-the-link.unit.test.ts`).
 */
export function loggableReferrer(referrer: string | undefined): string {
  if (!referrer || !ABSOLUTE_URL.test(referrer)) return '-';
  const query = referrer.indexOf('?');
  const path = query === -1 ? referrer : referrer.slice(0, query);
  const kept = path.replace(REFERRER_LINK_SEGMENT, '$1:link');
  return query === -1 ? kept : `${kept}${QUERY_MARK}`;
}
