// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE ENDPOINTS A PROVIDER PUBLISHES AND NOBODY TYPES.
 *
 * Workplan 0115 T4. Every seam in this product resolves a source's endpoint
 * from the connection's stored config — the host and port somebody typed into
 * a form, or a provider directory row that PRE-FILLED that form before they
 * pressed Test. Both routes end in the same place: a value in `config`.
 *
 * **Apple is the first source with no such value**, and it is not an
 * oversight. Its hosts are not a customer choice: an iCloud account is at
 * `imap.mail.me.com` and `caldav.icloud.com` for everybody, there is no
 * variant to configure, and a form asking would be asking a question with one
 * answer. So `appleAccountFields()` asks for an address and an app-specific
 * password, and nothing else — which left `davUrl` throwing
 * *"DAV connection config is missing url/baseUrl/host"* from inside a pass.
 *
 * ## Why not a `PROVIDER_DIRECTORY` row
 *
 * That table pre-fills FORM BOXES, and its own guard holds that a row may only
 * name boxes its door actually asks for. An Apple row naming `host` would fail
 * that guard, correctly: the Apple door asks for no host. The two tables
 * answer different questions —
 *
 *   `PROVIDER_DIRECTORY`  what to put in the box before somebody presses Test
 *   `PROVIDER_ENDPOINTS`  where to go when there is no box
 *
 * — and collapsing them would make one of the two lie.
 *
 * ## The never-guess rule still applies (0105)
 *
 * Every value here is a **published** setting with the page it was read from
 * and the day it was read, exactly as the directory carries. Nothing here is
 * trusted: Test measures the endpoint against the live provider like any typed
 * value, and a provider that moves a host makes that Test refuse in the
 * provider's own words. A value in this table is where to look, never a claim
 * that looking will work.
 */

/** One face's reachable address, and where the value came from. */
export interface PublishedEndpoint {
  /** The DAV collection root, or the IMAP host — whichever the face uses. */
  readonly host: string;
  /** Present for IMAP; DAV is https and needs none. */
  readonly port?: number;
}

export interface ProviderEndpoints {
  /** CalDAV root. Reminders ride this too — a task list is a calendar collection. */
  readonly calendar?: PublishedEndpoint;
  /** CardDAV root, which is NOT always the calendar host. */
  readonly contact?: PublishedEndpoint;
  /** IMAP host and port. */
  readonly email?: PublishedEndpoint;
  /** Where each value above was read, and when. */
  readonly sources: ReadonlyArray<{ readonly url: string; readonly seen: string }>;
  /**
   * The kind's door asks for these hosts (workplan 0174 D3 (a)): the table is
   * then NOT where a row with no host goes (`publishedEndpoint` answers
   * nothing for it, and a row saved without its mail server still says which
   * field is missing), only where a person's own password goes
   * (`pinnedToPublished`). Absent for Apple, whose door asks for none.
   */
  readonly doorAsks?: true;
}

/**
 * Per connection kind. A kind absent from here has no published endpoints and
 * must carry its own in `config`.
 *
 * Apple's hosts are where its rows go, because its door asks for none. Cirrux's
 * and Infomaniak's (workplan 0174 D3 (a), 2026-11-25) are here for a second
 * reason: a password a PERSON types on their grant link is tried only against
 * the server its provider publishes, whatever the owner typed into the row
 * (`pinnedToPublished`). Their doors still ask for the hosts, pre-filled from
 * `PROVIDER_DIRECTORY`, and a row the owner connected with their own password
 * keeps what they typed: for them the table is no fallback (`doorAsks`).
 *
 * **Soverin is not here.** Its help pages (soverin.com/help, and the help desk
 * the search engines list for it) could not be read from the builder's
 * checkout on 2026-11-25, so its servers are not cited, and 0174 §14 question
 * 2 says a provider whose page cannot be read stays generic: its host shown on
 * the page for the person to judge, as for any IMAP or DAV account.
 */
export const PROVIDER_ENDPOINTS: Readonly<Record<string, ProviderEndpoints>> = {
  apple: {
    // Two DIFFERENT hosts, which is the detail worth writing down: calendars
    // and contacts do not share a root the way Soverin's do, so a single
    // `host` for both would send CardDAV to the calendar service. Each is a
    // discovery root rather than a final address — iCloud partitions accounts
    // across hundreds of hosts and answers the home set with an absolute URL
    // naming yours, which is what 0115 T1 taught the DAV sources to follow.
    calendar: { host: 'caldav.icloud.com' },
    contact: { host: 'contacts.icloud.com' },
    // The username Apple wants here is usually the LOCAL PART rather than the
    // whole address, and full addresses work on some accounts and not others.
    // That is a credential question, not an endpoint one, so it lives with the
    // field's hint and its refusal — recorded here only so the next person
    // reading this table does not go looking for it.
    email: { host: 'imap.mail.me.com', port: 993 },
    sources: [
      { url: 'https://support.apple.com/en-us/102525', seen: '2026-09-04' },
      { url: 'https://support.apple.com/en-us/102654', seen: '2026-09-04' },
    ],
  },
  cirrux: {
    // ONE server for calendars, contacts and reminders: the setup page's
    // Manual Configuration names "api.cirrux.co" under each of Calendar,
    // Contacts and Reminders, and the Calendar page says "point your client
    // at api.cirrux.co". Neither gives a port; a DAV server named alone is
    // HTTPS on 443. Mail is IMAP at "imap.cirrux.co", port "993 (SSL)" (143
    // with STARTTLS is the other the page lists; 993 is the one a pass uses).
    // Cirrux Drive is not a face here: it is a sign-in to Cirrux's API, whose
    // host `CONSENT_HOSTS.cirrux` holds.
    calendar: { host: 'api.cirrux.co' },
    contact: { host: 'api.cirrux.co' },
    email: { host: 'imap.cirrux.co', port: 993 },
    doorAsks: true,
    sources: [
      { url: 'https://cirrux.co/help/setup', seen: '2026-11-25' },
      { url: 'https://cirrux.co/help/calendar', seen: '2026-11-25' },
    ],
  },
  infomaniak: {
    // "Pour l'adresse du serveur, utilisez uniquement sync.infomaniak.com"
    // (for the server address, use only sync.infomaniak.com), for contacts and
    // calendars alike, with no port; the Thunderbird page names the account
    // address `https://sync.infomaniak.com`, which is 443. Mail: "Serveur IMAP
    // entrant = mail.infomaniak.com", "Port IMAP = 993 + SSL". kDrive's WebDAV
    // address is per drive (`https://<kDrive ID>.connect.kdrive.infomaniak.com`,
    // faq/2409) and is no face of this kind (`PROVIDER_ACCOUNT_DOMAINS`).
    calendar: { host: 'sync.infomaniak.com' },
    contact: { host: 'sync.infomaniak.com' },
    email: { host: 'mail.infomaniak.com', port: 993 },
    doorAsks: true,
    sources: [
      {
        url: 'https://www.infomaniak.com/fr/support/faq/1544/synchroniser-contacts-calendar-apps-ios-manuellement-en-carddavcaldav',
        seen: '2026-11-25',
      },
      { url: 'https://www.infomaniak.com/fr/support/faq/2046', seen: '2026-11-25' },
      {
        url: 'https://www.infomaniak.com/fr/support/faq/2427/synchroniser-les-e-mails-sur-tous-vos-equipements',
        seen: '2026-11-25',
      },
    ],
  },
};

/** The published endpoint for one kind's face, or nothing — never a guess. */
export function publishedEndpoint(
  kind: string,
  face: 'calendar' | 'contact' | 'email',
): PublishedEndpoint | undefined {
  const endpoints = PROVIDER_ENDPOINTS[kind];
  // A kind whose door asks for its hosts carries them in its row; the table
  // is not a fallback for it (`ProviderEndpoints.doorAsks`).
  if (!endpoints || endpoints.doorAsks) return undefined;
  return endpoints[face];
}

/**
 * The DAV root for a kind's face as a URL, or nothing.
 *
 * `task` resolves to the CALENDAR root deliberately: a to-do list is a
 * calendar collection declaring VTODO (RFC 4791 §5.2.3, workplan 0113 T5), so
 * a separate task endpoint would be a second name for one address.
 */
export function publishedDavUrl(kind: string, face: string): string | undefined {
  const which = face === 'task' ? 'calendar' : face;
  if (which !== 'calendar' && which !== 'contact') return undefined;
  const endpoint = publishedEndpoint(kind, which);
  return endpoint ? `https://${endpoint.host}/` : undefined;
}

/** The config keys that name where a connection goes, besides its port. */
const HOST_KEYS = ['host', 'mailHost'] as const;
const URL_KEYS = ['url', 'baseUrl', 'fileBaseUrl'] as const;
/** Keys that lower how a connection is made (plain text, or an unchecked certificate): never kept for a pinned kind. */
const TRANSPORT_KEYS = ['useSsl', 'tlsVerify'] as const;

/** Every host this kind publishes, or an empty set for a kind with none. */
function publishedHosts(kind: string): ReadonlySet<string> {
  const e = PROVIDER_ENDPOINTS[kind];
  if (!e) return new Set();
  return new Set([e.calendar?.host, e.contact?.host, e.email?.host].filter((h): h is string => !!h).map((h) => h.toLowerCase()));
}

/** The host a stored URL names, lower-cased, or null when it names none. */
function hostOfUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  try {
    return new URL(value).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

/**
 * Does this kind's password go only to its provider's published server
 * (workplan 0174 §5.8, D3 (a))? Apple, Cirrux and Infomaniak.
 */
export function pinsItsServer(kind: string | null | undefined): boolean {
  return !!kind && Object.hasOwn(PROVIDER_ENDPOINTS, kind);
}

/**
 * A config with every address that is not one its provider publishes taken
 * out, for a kind that pins its server; any other kind's config as it is.
 *
 * What stays is only what names a published host: a DAV address on
 * `sync.infomaniak.com` with the path Infomaniak's assistant shows is kept,
 * one on any other host is dropped, as is a typed `host`, `mailHost` or port
 * that is not the provider's, and anything that lowers the connection
 * (`useSsl: false`, `tlsVerify: false`). Used for a migration's own override,
 * which only ever narrows the row.
 */
export function withoutUnpublishedHosts(
  kind: string,
  config: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...config };
  if (!pinsItsServer(kind)) return out;
  const published = publishedHosts(kind);
  for (const key of HOST_KEYS) {
    const v = out[key];
    if (v === undefined) continue;
    if (typeof v !== 'string' || !published.has(v.trim().toLowerCase())) {
      delete out[key];
      delete out[key === 'host' ? 'port' : 'mailPort'];
    }
  }
  for (const key of URL_KEYS) {
    if (out[key] === undefined) continue;
    const host = hostOfUrl(out[key]);
    if (host === null || !published.has(host)) delete out[key];
  }
  for (const key of TRANSPORT_KEYS) delete out[key];
  return out;
}

/**
 * THE SERVER A PERSON'S PASSWORD GOES TO, for a kind that pins it (workplan
 * 0174 §5.8, D3 (a)): the config with the provider's published server in
 * every place a host is read, whatever the owner typed.
 *
 * A grant link is shaped exactly like phishing, and the host the owner typed
 * is the new risk: an owner who names a server they run would receive the
 * person's password at the test's login. So for these kinds the typed hosts
 * are not used: the DAV host and its port, and the mail host and its port, are
 * the published ones, and a DAV address survives only when it names the
 * published host. Apple publishes two DAV hosts, so its `host` is dropped and
 * every reader falls back to this table per face (`davUrl`,
 * `accountMailEndpoint`), as an Apple row always has.
 *
 * The test is run on this config, and the store writes it to the row in the
 * same transaction as the password, so the pass connects where the test did.
 */
export function pinnedToPublished(
  kind: string,
  config: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const out = withoutUnpublishedHosts(kind, config);
  const e = PROVIDER_ENDPOINTS[kind];
  if (!e) return out;
  const dav = e.calendar?.host;
  if (dav && dav === e.contact?.host) {
    out.host = dav;
    out.port = 443;
  }
  // A kind that keeps its mail server in `mailHost` beside one DAV host
  // (Cirrux, Infomaniak); Apple's mail is read from this table per face.
  if (e.email && dav && dav === e.contact?.host) {
    out.mailHost = e.email.host;
    out.mailPort = e.email.port ?? 993;
  }
  return out;
}

/** Every host a pinned kind's password may reach: what the grant page names. */
export function publishedServerHosts(kind: string): ReadonlyArray<string> {
  const e = PROVIDER_ENDPOINTS[kind];
  if (!e) return [];
  return [...new Set([e.email?.host, e.calendar?.host, e.contact?.host].filter((h): h is string => !!h))];
}
