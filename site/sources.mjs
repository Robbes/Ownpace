// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * LEAVING…: one page per provider a person leaves (workplan 0152 T5).
 *
 * A COPY, because `site/` imports no workspace package (`build.mjs`'s header).
 * What each row may say is the app's to decide, and
 * `scripts/leaving-pages-say-what-the-app-says.unit.test.ts` holds this file to
 * it:
 *
 * - **a row that moves** names the source card that carries it, and that card
 *   carries the data type (`SOURCE_TYPE_DOMAINS`, the account faces in
 *   `PROVIDER_ACCOUNT_DOMAINS`, or the protocol's own words);
 * - **a row is tagged experimental** exactly when the app tags that card's
 *   face (`sourceFaceIsExperimental`, 0131 T2);
 * - **a row that does not move** has no card on its page that carries it;
 * - **a step** is a button exactly when the card's credential has a consent,
 *   and a password or an app of your own exactly when it has none, so a step
 *   the wizard does not have is never written;
 * - **what stays behind** is the scope manifest's own *Does not migrate* list
 *   for that provider, row for row;
 * - **each limit** links a guide section that exists;
 * - **photos from an export** go only where the app reads an export from
 *   (`ARCHIVE_READABLE_TARGETS`), and **each page's tile** is the app's own
 *   letter for its first card (`TILE_LETTERS` in `ProviderTile.tsx`).
 *
 * The words are `copy.mjs`'s, in both languages; this file holds only what is
 * true. A data type is the app's `DiscoveryDomain`, plus `photos` where a
 * provider keeps photos as a product of its own, which arrive as files.
 */

/** The data types a page can list, in the order it lists them. */
export const LEAVING_TYPES = ['email', 'calendar', 'contact', 'file', 'task', 'photos'];

/** The app's data type a row's type arrives as. */
export const DOMAIN_OF = { email: 'email', calendar: 'calendar', contact: 'contact', file: 'file', task: 'task', photos: 'file' };

/**
 * The target types an export is read from, so the only places photos from a
 * Takeout can go: the app's `ARCHIVE_READABLE_TARGETS` (a JMAP server's files
 * cannot be read by byte range, and the create door refuses it).
 */
export const EXPORT_TARGETS = ['nextcloud', 'webdav'];

/**
 * The six pages. Each has:
 * - `cards`: the source cards the page speaks for (`connectableTypes('source')` ids);
 * - `rows`: one per data type the provider keeps, with a verdict:
 *   `moves`, `limit` (moves, with the limit named by `limit`), or `no` (with
 *   the limit that says why); `by` is the card that carries a moving row, and
 *   `experimental` is the app's tag on that card's face (`SOURCE_PROOFS`);
 * - `staysBehind`: the scope manifest's *Does not migrate* rows for the page's
 *   family, by their item, or null; `except` names a row the page moves
 *   another way (Google Photos, through Takeout);
 * - `limits`: the limits the page explains, each with the guide section it links;
 * - `steps`: what the person does, per card: `button` (a consent), `password`
 *   (one they create at the provider), `app` (an app of their own, registered
 *   by an administrator) or `export` (an export they ask the provider for);
 * - `typical`: the data types of the typical case its cost is worked out for;
 * - `from`: the calculator's own answer to *Moving away from?*;
 * - `tile`: the initial on its tile (0152 D4), the app's for its first card.
 */
export const LEAVING = [
  {
    id: 'google',
    tile: 'G',
    cards: ['google', 'gmail', 'google-drive', 'archive'],
    rows: [
      { type: 'email', verdict: 'moves', by: 'gmail', experimental: false },
      { type: 'calendar', verdict: 'moves', by: 'google', experimental: false },
      { type: 'contact', verdict: 'moves', by: 'google', experimental: false },
      { type: 'file', verdict: 'limit', by: 'google-drive', limit: 'googleNative', experimental: false },
      { type: 'task', verdict: 'moves', by: 'google', experimental: true },
      { type: 'photos', verdict: 'limit', by: 'archive', limit: 'takeout', experimental: true },
    ],
    staysBehind: { family: 'google', items: ['Google Keep', 'Google Sites, Forms', 'Revision history'], except: ['Google Photos'] },
    limits: [
      { id: 'gmailDaily', guide: 'google#gmail' },
      { id: 'googleNative', guide: 'google#google-drive' },
      { id: 'takeout', guide: 'google#photos' },
    ],
    steps: [
      { card: 'google', kind: 'button' },
      { card: 'gmail', kind: 'button' },
      { card: 'google-drive', kind: 'button' },
      { card: 'archive', kind: 'export' },
    ],
    typical: ['email', 'calendar', 'contact', 'file'],
    from: 'google',
  },
  {
    id: 'microsoft',
    tile: 'M',
    cards: ['microsoft', 'graph', 'oauth2'],
    rows: [
      { type: 'email', verdict: 'moves', by: 'microsoft', experimental: true },
      { type: 'calendar', verdict: 'moves', by: 'microsoft', experimental: true },
      { type: 'contact', verdict: 'moves', by: 'microsoft', experimental: true },
      { type: 'file', verdict: 'moves', by: 'microsoft', experimental: true },
      { type: 'task', verdict: 'moves', by: 'microsoft', experimental: true },
    ],
    staysBehind: {
      family: 'microsoft',
      items: [
        'SharePoint extras',
        'Teams chat & calls',
        'Planner',
        'Power Automate',
        'InfoPath',
        'OneNote',
        'Retention holds',
        'Other O365 apps',
      ],
      except: [],
    },
    limits: [{ id: 'otherMailboxes', guide: 'microsoft#application' }],
    steps: [
      { card: 'microsoft', kind: 'button' },
      { card: 'graph', kind: 'app' },
    ],
    typical: ['email', 'calendar', 'contact', 'file'],
    from: 'microsoft',
  },
  {
    id: 'apple',
    tile: 'A',
    cards: ['apple'],
    rows: [
      { type: 'email', verdict: 'moves', by: 'apple', experimental: true },
      { type: 'calendar', verdict: 'moves', by: 'apple', experimental: true },
      { type: 'contact', verdict: 'moves', by: 'apple', experimental: true },
      { type: 'task', verdict: 'limit', by: 'apple', limit: 'reminders', experimental: true },
      { type: 'file', verdict: 'no', limit: 'icloudDrive' },
      { type: 'photos', verdict: 'no', limit: 'appleExport' },
    ],
    staysBehind: null,
    limits: [
      { id: 'reminders', guide: 'apple#reminders' },
      { id: 'icloudDrive', guide: 'apple#files' },
      { id: 'appleExport', guide: 'apple#export' },
    ],
    steps: [{ card: 'apple', kind: 'password' }],
    typical: ['email', 'calendar', 'contact'],
    from: 'apple',
  },
  {
    id: 'dropbox',
    tile: 'D',
    cards: ['dropbox'],
    rows: [{ type: 'file', verdict: 'limit', by: 'dropbox', limit: 'paper', experimental: true }],
    staysBehind: null,
    limits: [{ id: 'paper', guide: 'dropbox#what-moves' }],
    steps: [{ card: 'dropbox', kind: 'button' }],
    typical: ['file'],
    from: 'dropbox',
  },
  {
    id: 'box',
    tile: 'B',
    cards: ['box'],
    rows: [{ type: 'file', verdict: 'moves', by: 'box', experimental: true }],
    staysBehind: null,
    limits: [{ id: 'boxTrash', guide: 'box#trash' }],
    steps: [{ card: 'box', kind: 'app' }],
    typical: ['file'],
    from: 'box',
  },
  {
    id: 'mail',
    tile: '@',
    cards: ['imap'],
    rows: [
      { type: 'email', verdict: 'moves', by: 'imap', experimental: false },
      { type: 'calendar', verdict: 'no', limit: 'imapOnlyMail' },
      { type: 'contact', verdict: 'no', limit: 'imapOnlyMail' },
    ],
    staysBehind: null,
    limits: [{ id: 'imapOnlyMail', guide: 'imap#what-moves' }],
    steps: [{ card: 'imap', kind: 'password' }],
    typical: ['email'],
    from: 'other',
  },
];
