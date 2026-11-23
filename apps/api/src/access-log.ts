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
 * And one kind carries an ADDRESS: a row of the table of address changes is
 * named by its old address, `/api/address-changes/<key>` (`PUT`, `DELETE`),
 * and a link's own `/api/grant/<link>/address-changes/<key>`. The operator of
 * the managed service sees how many rows an organisation has, never an
 * address (workplan 0168 §5, D7; the review's finding 2).
 *
 * So the log keeps what it is for (who asked, for which route, with what
 * outcome) and loses the rest: a link becomes `:link`, whatever the case or
 * the spelling of its route (`/API/GRANT/<link>` and `/%67rant/<link>` too),
 * an address change's key becomes `:key` by the same reading, and a query
 * string is reduced to the fact that there was one, since its values can
 * carry codes and, on a search, whatever a person typed. The web image's
 * nginx writes its own access log by the same rule
 * (`apps/web/nginx.conf.template`). The rule itself is `loggableUrl` and
 * `loggableReferrer` in @openmig/shared, where the appliance's line for a
 * request that failed reads it too (workplan 0168).
 */
import morgan from 'morgan';
import type { IncomingMessage } from 'node:http';
import { loggableReferrer, loggableUrl } from '@openmig/shared';

export { QUERY_MARK, loggableReferrer, loggableUrl } from '@openmig/shared';

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
