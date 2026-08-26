// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Which data types each wizard target protocol can actually receive
 * (workplan 0037 T4, ADR-0026's one-contract rule).
 *
 * Before this table existed, `carddav` + `email` (and friends) sailed through
 * the managed wizard, the API's CreateMappingSchema, and into scope_selection
 * rows the target protocol can never serve — failing later as sync errors the
 * admin cannot connect to a wizard choice. The table lives in shared because
 * TWO doors refuse the combination in the same words: the wizard constrains
 * the choice at the moment it is made, and the create API refuses it verbatim
 * for any other client. One hand-written matrix per door is one drift away
 * from the client offering what the server refuses.
 *
 * Ground truth is the engines, not aspiration:
 *  - `jmap`   — mail (JmapTargetWriter), contacts (JmapContactTarget), files
 *    (JmapFileTarget). NO calendar: workplan 0031 T1 is parked by owner
 *    decision — recurring events cannot round-trip over JMAP yet, so a JMAP
 *    calendar target would flatten a series into single events (data loss).
 *  - `imap`   — mail only (ImapFlowDavMailTarget's IMAP half).
 *  - `caldav` — calendars only; `carddav` — contacts only; `webdav` — files
 *    only (the per-domain DAV writers).
 *
 * The managed per-domain factories make the stakes concrete: they fall back
 * to carddav/webdav for any non-jmap connection kind, so an `imap` target
 * with a `contact` domain would aim a CardDAV client at an IMAP host.
 */

import type { DiscoveryDomain } from './discovery.ts';

/** The wizard's target vocabulary (mirrors CreateMappingSchema.targetType). */
export type WizardTargetType = 'jmap' | 'imap' | 'caldav' | 'carddav' | 'webdav' | 'soverin';

export const TARGET_TYPE_DOMAINS: Record<WizardTargetType, ReadonlyArray<DiscoveryDomain>> = {
  jmap: ['email', 'contact', 'file'],
  imap: ['email'],
  caldav: ['calendar'],
  carddav: ['contact'],
  webdav: ['file'],
  // The first provider-named ACCOUNT kind (0106 T4a): one connection row,
  // one credential, several protocol faces — the `nextcloud` model given a
  // wizard door. Ground truth stays the engines: calendar and contact ride
  // the existing DAV builders (the per-domain factories already route any
  // non-jmap kind to carddav/webdav endpoints), and email rides the IMAP
  // half of `imap-dav` since T4b — resolved at the one mail seam from the
  // account's STORED mail server (`mailHost`, typed by the person; the
  // create door demands it by name when email is ticked, never guesses a
  // host). Files stay out until a Soverin account MEASURES a file face
  // (the qualification's job, never this table's guess).
  soverin: ['email', 'calendar', 'contact'],
};

const PROTOCOL_NAMES: Record<WizardTargetType, string> = {
  jmap: 'JMAP',
  imap: 'IMAP',
  caldav: 'CalDAV',
  carddav: 'CardDAV',
  webdav: 'WebDAV',
  soverin: 'Soverin',
};

/** The selected domains the given target protocol cannot receive. */
export function incoherentTargetDomains(
  targetType: WizardTargetType,
  domains: ReadonlyArray<DiscoveryDomain>,
): DiscoveryDomain[] {
  const allowed = TARGET_TYPE_DOMAINS[targetType];
  return domains.filter((d) => !allowed.includes(d));
}

/**
 * The refusal sentence for an incoherent target/domain combination, naming
 * BOTH sides (prose boundary: rendered verbatim wherever it surfaces), or
 * null when the combination is coherent.
 */
export function targetDomainRefusal(
  targetType: WizardTargetType,
  domains: ReadonlyArray<DiscoveryDomain>,
): string | null {
  const bad = incoherentTargetDomains(targetType, domains);
  if (bad.length === 0) return null;
  const name = PROTOCOL_NAMES[targetType];
  const badList = bad.map((d) => `'${d}'`).join(', ');
  const allowedList = TARGET_TYPE_DOMAINS[targetType].map((d) => `'${d}'`).join(', ');
  const jmapCalendarNote =
    targetType === 'jmap' && bad.includes('calendar')
      ? ' There is deliberately no JMAP calendar target: recurring events cannot round-trip' +
        ' over JMAP yet, so writing calendars there would flatten a recurring series into' +
        ' single events. Use a CalDAV target for calendars.'
      : '';
  return (
    `A ${name} target cannot receive the ${badList} data type${bad.length > 1 ? 's' : ''} — ` +
    `${name} carries ${allowedList} only. Choose a target that speaks every selected data ` +
    `type, or drop the ones it cannot receive.${jmapCalendarNote}`
  );
}

/**
 * The wizard's SOURCE vocabulary (mirrors CreateMappingSchema.sourceType).
 *
 * Sources joined this file with `google-drive` (workplan 0042): the three
 * O365-family mail sources place no constraint here — their connection is the
 * combined one the DAV domains discover against, so any domain may ride it —
 * but a Google connection holds OAuth credentials for exactly one API, and
 * every other domain would be aimed at a provider that does not serve it.
 * `gmail` (workplan 0044) constrains for the same reason: its refresh token is
 * consented with the mail scope, which reads mailboxes and nothing else.
 */
export type WizardSourceType =
  | 'imap'
  | 'oauth2'
  | 'graph'
  | 'google-drive'
  | 'gmail'
  | 'google-calendar'
  | 'google-contacts'
  | 'dropbox'
  | 'box';

/** Domains a wizard source can serve, where the source constrains it at all. */
export const SOURCE_TYPE_DOMAINS: Partial<
  Record<WizardSourceType, ReadonlyArray<DiscoveryDomain>>
> = {
  'google-drive': ['file'],
  gmail: ['email'],
  'google-calendar': ['calendar'],
  'google-contacts': ['contact'],
  dropbox: ['file'],
  box: ['file'],
};

/**
 * How each constrained source is named and explained in its refusal. The
 * `reads` clause completes "its OAuth credential reads …" — per type, because
 * the honest explanation differs: Drive's credential is scoped to an API,
 * Gmail's to a mailbox.
 */
const CONSTRAINED_SOURCE_PROSE: Partial<
  Record<WizardSourceType, { name: string; reads: string }>
> = {
  'google-drive': { name: 'Google Drive', reads: 'the Drive API only' },
  gmail: { name: 'Gmail', reads: 'mail only (the https://mail.google.com/ scope)' },
  'google-calendar': {
    name: 'Google Calendar',
    reads: 'calendars only (the https://www.googleapis.com/auth/calendar scope)',
  },
  'google-contacts': {
    name: 'Google Contacts',
    reads: 'contacts only (the https://www.googleapis.com/auth/carddav scope)',
  },
  dropbox: { name: 'Dropbox', reads: 'the Dropbox API only' },
  box: { name: 'Box', reads: 'the Box API only' },
};

/**
 * The refusal for an incoherent source/domain combination — the source-side
 * sibling of `targetDomainRefusal`, in shared for the same reason: the wizard
 * constrains the choice as it is made, the create API refuses it verbatim for
 * any other client, and one matrix per door is one drift away from the client
 * offering what the server refuses.
 */
export function sourceDomainRefusal(
  sourceType: WizardSourceType,
  domains: ReadonlyArray<DiscoveryDomain>,
): string | null {
  const allowed = SOURCE_TYPE_DOMAINS[sourceType];
  const prose = CONSTRAINED_SOURCE_PROSE[sourceType];
  if (!allowed || !prose) return null;
  const bad = domains.filter((d) => !allowed.includes(d));
  if (bad.length === 0) return null;
  const badList = bad.map((d) => `'${d}'`).join(', ');
  const allowedList = allowed.map((d) => `'${d}'`).join(', ');
  return (
    `A ${prose.name} source cannot provide the ${badList} data type${bad.length > 1 ? 's' : ''} — ` +
    `its OAuth credential reads ${prose.reads}, which carries ${allowedList}. Create a ` +
    'separate mapping for the other data types, with a source that serves them.'
  );
}
