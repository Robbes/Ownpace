// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PAGE ON ANOTHER SITE CANNOT PRESS THE APPLIANCE'S BUTTONS.
 *
 * The appliance has no login: the address it listens on is the boundary
 * (`SELFHOST_BIND`, and the warning it prints at start-up when that is wider
 * than this machine). A browser on this machine is inside that boundary, and so
 * is every page it opens. So a page on any site the owner happened to visit
 * could have that browser POST here. `POST /mappings/<id>/finish?force=true`
 * carries no body, so a browser sends it without asking the appliance first (no
 * CORS preflight), and the example mapping file's `mappingId` is the same on
 * every appliance that kept it. `POST /verify/start` and `POST /confirm` need no
 * id at all. The page never sees the answer, and does not need to.
 *
 * A browser says where a request comes from (`Sec-Fetch-Site`, which every
 * current Chrome, Edge, Firefox and Safari sends and no page can set), and this
 * edition's own screens are always the same origin as its routes
 * (`apps/web/src/services/edition.ts`). So a request that can change something
 * and says `cross-site` is refused. Nothing else changes: a script, `curl` or a
 * monitor sends no such header, and a page on another site reading a `GET` is
 * already the browser's to refuse.
 *
 * What this does not stop is a page that makes itself this appliance's own
 * site, by pointing a name it controls at this machine (DNS rebinding). That
 * needs the appliance to know the names it answers to, which changes how it is
 * reached, and is the owner's decision.
 */

/** Methods that change nothing: these pass whatever site asked. */
const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Is this a request that could change something, sent by a page on another
 * site? Node's parser only admits upper-case methods, so none is folded here.
 */
export function isCrossSiteWrite(method: string | undefined, secFetchSite: string | string[] | undefined): boolean {
  return !READS.has(method ?? 'GET') && secFetchSite === 'cross-site';
}
