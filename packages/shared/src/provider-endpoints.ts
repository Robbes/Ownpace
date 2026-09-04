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
}

/**
 * Per connection kind. A kind absent from here has no published endpoints and
 * must carry its own in `config` — which is every kind but `apple` today.
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
};

/** The published endpoint for one kind's face, or nothing — never a guess. */
export function publishedEndpoint(
  kind: string,
  face: 'calendar' | 'contact' | 'email',
): PublishedEndpoint | undefined {
  return PROVIDER_ENDPOINTS[kind]?.[face];
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
