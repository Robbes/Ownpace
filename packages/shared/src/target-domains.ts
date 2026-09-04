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
 *  - `caldav` — calendars AND task lists; `carddav` — contacts only; `webdav`
 *    — files only (the per-domain DAV writers). CalDAV carries two of this
 *    product's data types because on the wire they are one thing: both are
 *    calendar collections written by the same writer with the same credential,
 *    and only `supported-calendar-component-set` says which components each
 *    holds (RFC 4791 §5.2.3, workplan 0113).
 *
 * The managed per-domain factories make the stakes concrete: they fall back
 * to carddav/webdav for any non-jmap connection kind, so an `imap` target
 * with a `contact` domain would aim a CardDAV client at an IMAP host.
 */

import { PROVIDER_ACCOUNT_DOMAINS } from './provider-accounts.ts';
import type { DiscoveryDomain } from './discovery.ts';

/** The wizard's target vocabulary (mirrors CreateMappingSchema.targetType). */
export type WizardTargetType = 'jmap' | 'imap' | 'caldav' | 'carddav' | 'webdav' | 'soverin';

export const TARGET_TYPE_DOMAINS: Record<WizardTargetType, ReadonlyArray<DiscoveryDomain>> = {
  jmap: ['email', 'contact', 'file'],
  imap: ['email'],
  caldav: ['calendar', 'task'],
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
  // host). Tasks ride the same CalDAV face as calendars (0113 T5): a Soverin
  // account's task list is a calendar collection that declares VTODO. Files
  // stay out until a Soverin account MEASURES a file face (the
  // qualification's job, never this table's guess).
  soverin: ['email', 'calendar', 'contact', 'task'],
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
  | 'box'
  // One Google ACCOUNT rather than one Google API (workplan 0106 T3b): several
  // faces from one row, one credential, one consent. The four single-domain
  // kinds above stay valid and cohabit — the owner's decision of 2026-08-27 —
  // because mail and files wait on Google's restricted-scope assessment.
  | 'google'
  // One Microsoft 365 ACCOUNT (workplan 0114), the same shape a provider
  // later. It cohabits with `oauth2` and `graph` above for the same reason:
  // a customer with their own app registration keeps it.
  | 'microsoft'
  // One Apple ACCOUNT (workplan 0115), and nothing to cohabit with: there has
  // never been an `icloud` or `apple-mail` kind, because Apple has never
  // published an API one could have been built on. It constrains nothing here
  // for the same reason the O365 mail sources do not — one app-specific
  // password reaches mail, calendars, contacts and reminders alike, so no
  // domain is aimed at an API the credential does not serve.
  | 'apple'
  // An EXPORT ARCHIVE (workplan 0116 T1) — the first source type that is not
  // an account at all. Its credential is a LOCATION, and WHICH export it is
  // (`ARCHIVE_PROVIDERS`) is a value on the connection rather than a type of
  // its own, deliberately: 0116 §2 requires that a third export be a new
  // reader and nothing else, and a type per export would drag every table in
  // this file back into the diff each time one arrived.
  | 'archive';

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
  // FILES ONLY, and photos are files (owner decision D5, 2026-09-04). Both
  // exports contain more than that — Takeout will hand over mail as `.mbox`
  // and contacts as `.vcf`, Apple's ships `.ics`, `.vcf` and `.eml` — and this
  // product deliberately does not read them from an archive. The reason is
  // that mail, calendars and contacts have LIVE routes here already, and a
  // snapshot import of them would compete with the live one: two doors writing
  // the same mailbox, one of them stuck on the day the export was prepared.
  // Photos and iCloud Drive have no live route at all, which is why they are
  // the ones worth the archive's compromises.
  archive: ['file'],
  // NOT written out here: read from PROVIDER_ACCOUNT_DOMAINS, so a provider
  // gaining a face is one row edit rather than two that can disagree. Two
  // copies of a capability list is the drift 0106 T1b just removed from the
  // Google SCOPE tables, and there is no reason to reintroduce it one file
  // away.
  google: PROVIDER_ACCOUNT_DOMAINS.google,
  // Read from the same table, for the same reason. Microsoft constrains too,
  // and it is worth being clear about WHICH face is missing: `task` is the
  // one, Graph has it at `/me/todo/lists`, and the connector for it is not
  // built (0114 T9). So a mapping that ticks tasks against a Microsoft source
  // is refused with a reason rather than run against a face nothing serves.
  microsoft: PROVIDER_ACCOUNT_DOMAINS.microsoft,
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
  archive: {
    name: 'an export archive',
    // The honest asymmetry with every other line here: the others say what a
    // CREDENTIAL reaches. This one says what the PRODUCT chose to read out of
    // a file that contains more, so the sentence names the live route rather
    // than implying the archive lacks the data.
    reads:
      'files and photos only — mail, calendars and contacts are migrated from the account '
      + 'itself, live, rather than from a snapshot taken on the day the export was prepared',
  },
  gmail: { name: 'Gmail', reads: 'mail only (the https://mail.google.com/ scope)' },
  'google-calendar': {
    name: 'Google Calendar',
    reads: 'calendars only (the https://www.googleapis.com/auth/calendar scope)',
  },
  'google-contacts': {
    name: 'Google Contacts',
    reads: 'contacts only (the https://www.googleapis.com/auth/carddav scope)',
  },
  microsoft: {
    name: 'Microsoft 365',
    // The honest asymmetry with Google's sentence below: Microsoft's four
    // faces are not held back by a scope tier — its delegated read scopes
    // carry no equivalent of Google's restricted class. The ONE face missing
    // is tasks, and that absence is ours: Graph serves To Do lists at
    // /me/todo/lists under Tasks.Read, and no connector reads them yet
    // (workplan 0114 T9). Saying so is the difference between "this provider
    // cannot" and "we have not built it".
    reads:
      'mail, calendars, contacts and OneDrive. Microsoft To Do is not among them yet — '
      + 'Graph serves it and this product has no connector for it',
  },
  google: {
    name: 'Google',
    // Honest about WHY it is not all four: the missing faces are a scope
    // Google prices differently, not a face this product cannot drive.
    //
    // And this is the NARROW deployment's sentence. One whose own application
    // carries the restricted scopes gets a shorter one — see
    // `constrainedSourceProse` below, which is where that stops being a
    // property of the product and becomes a property of the deployment
    // (ADR-0041, owner decision 2026-09-01).
    reads:
      'the object types you granted — calendars and contacts today; mail and ' +
      'files need a Google security assessment we have not bought yet, and ' +
      'the single-purpose Gmail and Google Drive sources still serve those',
  },
  dropbox: { name: 'Dropbox', reads: 'the Dropbox API only' },
  box: { name: 'Box', reads: 'the Box API only' },
};

/**
 * What a wizard source may serve ON THIS DEPLOYMENT.
 *
 * `accountDomains` is the deployment's own answer for a provider-ACCOUNT
 * source — `providerAccountDomains('google', env)` on the server, and the same
 * list fetched from `GET /api/provider-accounts` in the browser. Everything
 * else is a fact about a protocol or a single-purpose API and takes no
 * argument: a Gmail credential reads mail whoever deployed it.
 *
 * PASSED, NEVER READ FROM THE ENVIRONMENT HERE, and that is not fussiness.
 * `providerAccountDomains` defaults its `env` to `process.env`, which does not
 * exist in a browser — a default here would make the wizard's own refusal
 * throw on the one edition that has a wizard. The deployment's answer travels
 * over the wire to the client, which is the only way one fact can hold on both
 * sides of it.
 *
 * ABSENT MEANS THE STATIC DEFAULT, which is what an appliance always gets: it
 * registers its own OAuth client and this table never spoke for it (ADR-0041).
 */
export function sourceTypeDomains(
  sourceType: WizardSourceType,
  accountDomains?: ReadonlyArray<DiscoveryDomain>,
): ReadonlyArray<DiscoveryDomain> | undefined {
  if (sourceType === 'google' && accountDomains !== undefined) return accountDomains;
  return SOURCE_TYPE_DOMAINS[sourceType];
}

/**
 * How a constrained source explains itself, given what it actually serves.
 *
 * The Google ACCOUNT is the only entry whose sentence moves, because it is the
 * only one whose ceiling is a deployment's decision rather than an API's shape.
 * A deployment carrying the restricted scopes must not be told that mail
 * "needs a Google security assessment we have not bought yet" — it bought one,
 * or registered its own application and accepted the tier. Saying otherwise
 * sends its owner looking for a wall that is not there.
 */
function constrainedSourceProse(
  sourceType: WizardSourceType,
  allowed: ReadonlyArray<DiscoveryDomain>,
): { name: string; reads: string } | undefined {
  const prose = CONSTRAINED_SOURCE_PROSE[sourceType];
  if (!prose) return undefined;
  if (sourceType !== 'google') return prose;
  // The long sentence claims TWO things are missing — mail and files — and it
  // is false the moment either is served. So it survives only where neither
  // is, which is the default this product publishes; anything wider means the
  // deployment registered its own application or bought the assessment, and
  // the refusal is then only ever about a face nobody ticked. Checked as "is
  // the claim still true" rather than "is this the restricted list", because
  // the claim is what a person reads.
  const stillTrue = !allowed.includes('email') && !allowed.includes('file');
  return stillTrue ? prose : { ...prose, reads: 'the object types you granted' };
}

/**
 * The refusal for an incoherent source/domain combination — the source-side
 * sibling of `targetDomainRefusal`, in shared for the same reason: the wizard
 * constrains the choice as it is made, the create API refuses it verbatim for
 * any other client, and one matrix per door is one drift away from the client
 * offering what the server refuses.
 *
 * `accountDomains` — see `sourceTypeDomains`. The create API passes what this
 * deployment declares; the wizard passes what the API told it.
 */
export function sourceDomainRefusal(
  sourceType: WizardSourceType,
  domains: ReadonlyArray<DiscoveryDomain>,
  accountDomains?: ReadonlyArray<DiscoveryDomain>,
): string | null {
  const allowed = sourceTypeDomains(sourceType, accountDomains);
  const prose = allowed ? constrainedSourceProse(sourceType, allowed) : undefined;
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
