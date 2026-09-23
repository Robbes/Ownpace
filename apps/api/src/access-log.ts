// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * THE ACCESS LOG, WITHOUT THE SECRETS IN IT.
 *
 * `morgan('combined')` writes each request's full URL and its Referer header,
 * and three kinds of request carry a secret in exactly those places:
 *
 *  - **A grant or view link**, `/api/grant/<link>` and `/api/view/<link>`. The
 *    link IS the credential (workplan 0108): whoever holds it may consent on a
 *    customer's behalf, or read their progress. Written to a log, it outlives
 *    the link's own expiry and reaches everyone who can read the log.
 *  - **The page that holds one**, `/grant/<link>` and `/view/<link>`, which the
 *    browser sends as the Referer of every API call that page makes.
 *  - **An OAuth callback**, `?code=…&state=…`: a code that can still be spent,
 *    and the state that binds it to the grant.
 *
 * So the log keeps what it is for (who asked, for which route, with what
 * outcome) and loses the rest: a link becomes `:link`, and a query string is
 * reduced to the fact that there was one, since its values can carry codes and,
 * on a search, whatever a person typed. The web image's nginx writes its own
 * access log by the same rule (`apps/web/nginx.conf.template`).
 */
import morgan from 'morgan';
import type { IncomingMessage } from 'node:http';

/** A path segment that is a link credential, and the route it follows. */
const LINK_SEGMENT = /^(\/(?:api\/)?(?:grant|view)\/)[^/]+/;

/** What a query string is reduced to: that there was one, and nothing it said. */
export const QUERY_MARK = '?...';

/** A request URL as the log may keep it. */
export function loggableUrl(url: string | undefined): string {
  if (!url) return '-';
  const query = url.indexOf('?');
  const path = query === -1 ? url : url.slice(0, query);
  const kept = path.replace(LINK_SEGMENT, '$1:link');
  return query === -1 ? kept : `${kept}${QUERY_MARK}`;
}

/** The start of an absolute URL: a scheme and `://`. */
const ABSOLUTE_URL = /^[a-z][a-z0-9+.-]*:\/\//;

/** The same link segment, behind a scheme and a host. */
const REFERRER_LINK_SEGMENT = /^([a-z][a-z0-9+.-]*:\/\/[^/]+\/(?:api\/)?(?:grant|view)\/)[^/]+/;

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

morgan.token('loggable-url', (req: IncomingMessage) =>
  loggableUrl((req as IncomingMessage & { originalUrl?: string }).originalUrl ?? req.url),
);
morgan.token('loggable-referrer', (req: IncomingMessage) => {
  const header = req.headers.referer ?? req.headers['referrer'];
  return loggableReferrer(Array.isArray(header) ? header[0] : header);
});

/**
 * Apache's combined format, the one `morgan('combined')` wrote, with the URL
 * and the Referer swapped for their loggable forms. The same fields in the same
 * places, so whatever already reads these lines still can.
 */
export const ACCESS_LOG_FORMAT =
  ':remote-addr - :remote-user [:date[clf]] ":method :loggable-url HTTP/:http-version" ' +
  ':status :res[content-length] ":loggable-referrer" ":user-agent"';

/** The API's access log. `stream` is for tests; the default is stdout. */
export function accessLog(stream?: { write(line: string): void }) {
  return morgan(ACCESS_LOG_FORMAT, stream ? { stream } : undefined);
}
