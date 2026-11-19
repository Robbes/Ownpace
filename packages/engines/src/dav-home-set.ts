// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHERE A DAV ACCOUNT KEEPS ITS COLLECTIONS, ASKED OF THE SERVER (workplan 0160).
 *
 * The CardDAV and CalDAV writers put a new collection where Nextcloud and
 * SabreDAV keep them: `addressbooks/users/<user>/` and `calendars/<user>/`.
 * That is an assumption, and Cirrux is the first destination it does not
 * hold for. On a test mailbox, on 2026-11-19, its CardDAV server refused
 * the address book's MKCOL with 501, and its CalDAV server the calendar's
 * MKCALENDAR with 404. So when the assumed place is refused, both writers
 * ask the server, and this is the asking, written once for both.
 */

import { log } from '@openmig/shared';
import { collectionSlug } from './dav-collection-path.ts';
import { firstElementText, hrefRelativeTo, unescapeXml } from './dav-multistatus.ts';

/**
 * ANSWERS THAT SAY THE PLACE IS WRONG, NOT THE REQUEST.
 *
 * To an MKCOL or MKCALENDAR: 403, where nobody may make a collection
 * (RFC 4918 §9.3.1); 405, an address already taken; 409, a parent that
 * does not exist; 404, which some servers give for that instead of 409
 * (Cirrux's CalDAV server does); and 501, a server that makes no
 * collection of that kind at all (Cirrux's CardDAV server: every mailbox
 * has one address book, Contacts, and no way to make another, over CardDAV
 * or through Cirrux's own API, https://cirrux.co/help/api/contacts, read
 * 2026-11-19).
 *
 * To the PROPFIND that lists the assumed home, the same answers say that
 * home is not this account's. Any other answer (a sign-in refused, a server
 * in trouble, a full disk) is the answer itself, and is reported as it
 * always was.
 */
export const NOT_THIS_PLACE: ReadonlySet<number> = new Set([403, 404, 405, 409, 501]);

/** One collection a server listed: where it is, and what it calls itself. */
export interface CollectionAt {
  readonly path: string;
  readonly displayName?: string;
}

/**
 * Is this the collection a folder with this slug would have been made as?
 * By its path, or by its name.
 */
export function isNamed(collection: CollectionAt, slug: string): boolean {
  return (
    collectionSlug(undefined, collection.path, '') === slug ||
    (collection.displayName !== undefined && collectionSlug(collection.displayName, undefined, '') === slug)
  );
}

/** Which of the two homes is asked for. */
export type DavHomeKind = 'carddav' | 'caldav';

/**
 * The home-set property of each kind and its namespace: `addressbook-home-set`
 * (RFC 6352 §7.1.1) and `calendar-home-set` (RFC 4791 §6.2.1), both
 * properties of the PRINCIPAL, not of the server's root.
 */
const HOME_SET: Readonly<Record<DavHomeKind, { readonly namespace: string; readonly property: string }>> = {
  carddav: { namespace: 'urn:ietf:params:xml:ns:carddav', property: 'addressbook-home-set' },
  caldav: { namespace: 'urn:ietf:params:xml:ns:caldav', property: 'calendar-home-set' },
};

/** The one request this sends, in the shape both writers' HTTP clients take. */
export type HomeSetRequest = (options: {
  method: string;
  url: string;
  body: string;
  headers: Record<string, string>;
}) => Promise<{ status: number; body: string }>;

/**
 * The home the SERVER names for this account, as a path under `base`
 * (not normalised: each writer normalises its own paths), or undefined.
 *
 * Reached as RFC 6764 §6 says: `current-user-principal` (RFC 5397), asked
 * at `/.well-known/carddav` or `/.well-known/caldav` on the configured host
 * and then at the configured base, and the principal asked for its home
 * set. The DAV sources have always looked this way (carddav-source.ts,
 * caldav-source.ts); the writers assumed instead.
 *
 * Undefined when nothing names a home this writer can reach: one on another
 * host, or outside the configured base, is not one its `buildUrl` can
 * address. An href that cannot be read is one more place that named nothing,
 * so this never rejects: the writers keep the answer for every later call.
 *
 * @param base The configured base, as the writer's `buildUrl('')` gives it.
 */
export async function discoverHomeSet(
  kind: DavHomeKind,
  base: string,
  authorization: string,
  request: HomeSetRequest,
): Promise<string | undefined> {
  const { namespace, property } = HOME_SET[kind];
  const origin = new URL(base).origin;
  for (const start of [new URL(`/.well-known/${kind}`, base).toString(), base]) {
    try {
      const principal = await hrefProperty(
        kind,
        request,
        authorization,
        start,
        '<D:current-user-principal/>',
        'current-user-principal',
        namespace,
      );
      if (principal === undefined) continue;
      const principalUrl = new URL(principal, start);
      if (principalUrl.origin !== origin) continue;
      const home = await hrefProperty(
        kind,
        request,
        authorization,
        principalUrl.toString(),
        `<C:${property}/>`,
        property,
        namespace,
      );
      if (home === undefined) continue;
      const homeUrl = new URL(home, principalUrl);
      if (homeUrl.origin !== origin) continue;
      const relative = hrefRelativeTo(homeUrl.pathname, base);
      if (relative === undefined) continue;
      return relative;
    } catch (err) {
      log.warn(
        `[${kind}] could not read the home named from ${start}: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return undefined;
}

/** One href-valued property of one resource; undefined when the server gives none. */
async function hrefProperty(
  kind: DavHomeKind,
  request: HomeSetRequest,
  authorization: string,
  url: string,
  prop: string,
  localName: string,
  namespace: string,
): Promise<string | undefined> {
  let response: { status: number; body: string };
  try {
    response = await request({
      method: 'PROPFIND',
      url,
      body: `<?xml version="1.0" encoding="utf-8"?>
        <D:propfind xmlns:D="DAV:" xmlns:C="${namespace}"><D:prop>${prop}</D:prop></D:propfind>`,
      headers: {
        Depth: '0',
        'Content-Type': 'application/xml',
        Authorization: authorization,
      },
    });
  } catch (err) {
    // The second question, asked because the first answer failed. A place
    // that cannot be reached names nothing, and the error the caller then
    // raises carries the first answer, which is the one to act on.
    log.warn(`[${kind}] could not ask ${url} for its ${localName}: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
  if (response.status !== 207) return undefined;
  const value = firstElementText(response.body, localName);
  const href = value === undefined ? undefined : firstElementText(value, 'href')?.trim();
  return href ? unescapeXml(href) : undefined;
}
