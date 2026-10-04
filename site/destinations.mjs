// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHERE TO: the destinations the app moves data into, for the home page's
 * *Where to* (workplan 0152 T4).
 *
 * A COPY, because `site/` imports no workspace package (this directory's
 * `build.mjs` says why). The app's list is `TARGET_TYPE_DOMAINS` in
 * `packages/shared/src/target-domains.ts`, which the create door enforces.
 * `scripts/where-to-is-the-apps-own-list.unit.test.ts` reads that table and
 * fails when this one says more or less: a destination the app drops leaves
 * the site in the same pull request, and the site never offers a data type
 * the app cannot write.
 *
 * WHAT IT NAMES, AND NOTHING ELSE (0152 T4 (c)): which data types a destination
 * takes. Not what the provider costs, where it is hosted or how good it is;
 * `docs/target-providers.md` keeps that, with its dates.
 */

/** The data types the site writes, in this order. Each is the app's `DiscoveryDomain`. */
export const DATA_TYPES = ['email', 'calendar', 'contact', 'file', 'task'];

/**
 * The home page's four destinations. `types` are the app's target types the
 * card stands for. `takes` maps each data type the card shows to the target
 * type that carries it: one card can be four protocols, each carrying its own.
 */
export const DESTINATIONS = [
  {
    id: 'soverin',
    types: ['soverin'],
    takes: { email: 'soverin', calendar: 'soverin', contact: 'soverin', task: 'soverin' },
  },
  {
    id: 'nextcloud',
    types: ['nextcloud'],
    takes: { calendar: 'nextcloud', contact: 'nextcloud', file: 'nextcloud', task: 'nextcloud' },
  },
  {
    id: 'jmap',
    types: ['jmap'],
    takes: { email: 'jmap', contact: 'jmap', file: 'jmap' },
  },
  {
    id: 'protocols',
    types: ['imap', 'caldav', 'carddav', 'webdav'],
    takes: { email: 'imap', calendar: 'caldav', contact: 'carddav', file: 'webdav', task: 'caldav' },
  },
];

/** A protocol's name as a person reads it, for the card that is four of them. */
export const PROTOCOL_NAMES = { imap: 'IMAP', caldav: 'CalDAV', carddav: 'CardDAV', webdav: 'WebDAV' };
