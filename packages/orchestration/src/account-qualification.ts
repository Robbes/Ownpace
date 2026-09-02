// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * What can this account CARRY? Measured per domain, remembered on the
 * connection (workplan 0106 T0 — the probe-qualified record).
 *
 * The owner's brief: one account entered once, credentials reused across the
 * object types it supports, with the connection HOLDING the qualification.
 * This module is the measuring half for Basic-auth account families, where
 * discovery is free and read-only: ask every protocol face the stored config
 * can express, and record what answered.
 *
 * THE THREE-STATE RULE, which is this module's whole spine:
 *
 *   - `yes` requires an ANSWER: a listing that succeeded (0 collections is
 *     still an answer — the protocol works).
 *   - `no` ALSO requires an answer: a JMAP session that enumerated its
 *     capabilities and left one out, or this product's own matrix saying a
 *     domain is not carried over a protocol (a fact about US, stated as
 *     such). A refusal is NOT a no.
 *   - everything else is `unknown`, with the words that say why: a 401 may
 *     be a per-protocol app-password scope (Soverin's documented choice), a
 *     discovery that failed may be a path problem, and a question the config
 *     cannot even ask (mail on a DAV-only connection) was never measured at
 *     all. Unknown is unmeasured, and unmeasured is never safe to render as
 *     either yes or no (the run-#6 rule, 0105's wording).
 *
 * READ-ONLY BY CONSTRUCTION: every probe here is a `listFolders`-class
 * question or a session-document GET. Qualification never writes to
 * anybody's account.
 */

import { CalDAVSource, CarddavSource, WebdavFileSource } from '@openmig/connectors';
import { parseGoogleDriveSource, withDeploymentGoogleClient } from '@openmig/shared';
import type { ProbeUnit } from '@openmig/shared';
import { buildImapSourceFrom } from './mail-source-factory.ts';
import { davEndpointFromCreds } from './dav-endpoint.ts';
import { measureTargetScheduling } from './target-scheduling.ts';
import type { SchedulingVerdict } from './target-scheduling.ts';
// THE FOUR FACES OF A GOOGLE GRANT, built exactly as a pass builds them
// (2026-09-02): the same factories `build-deps-from-mapping.ts` reaches for,
// under the same stored names, so the reach cannot pass a shape a pass would
// refuse — `probe-connection.ts`'s reason, applied to the qualification.
import { buildGmailSourceFrom, STORED_GMAIL_CREDENTIAL_NAMES } from './gmail-source-factory.ts';
import {
  buildGoogleCalendarDavSourceFrom,
  buildGoogleContactsDavSourceFrom,
  STORED_GOOGLE_DAV_CREDENTIAL_NAMES,
} from './google-dav-source-factory.ts';
import { buildGoogleDriveSourceFrom, STORED_GOOGLE_CREDENTIAL_NAMES } from './drive-source-factory.ts';
import type { GoogleCredentialsAsFound } from './drive-source-factory.ts';

export type DomainAnswer = 'yes' | 'no' | 'unknown';

export interface QualifiedDomain {
  readonly answer: DomainAnswer;
  /** The English sentence that justifies the answer — a count, a refusal's
   *  own words, or WHY this stayed unmeasured. The UI words yes/no/unknown
   *  itself; this is the evidence line. */
  readonly detail: string;
  /**
   * What the face COUNTED when it answered (2026-09-02): the number and the
   * unit, as data, so a screen can say "5 calendars" in its own language
   * beside the tick rather than only in a hover nobody's phone has. Present
   * only on a `yes` that came from a listing — absent on a no, an unknown,
   * and on a grant read without a reach.
   */
  readonly count?: number;
  readonly unit?: ProbeUnit;
  /**
   * How MUCH the face holds, measured when it answered (2026-09-02, the
   * owner's "GB in Drive, number of contacts, GB of mail"): a sizing answer
   * beside the capability one, never instead of it. Absent when the face
   * has no cheap measure, when it was not reached, or when measuring failed
   * (then `detail` says so).
   */
  readonly volume?: MeasuredVolume;
}

/** A face's volume, as data — a screen words and formats it. */
export interface MeasuredVolume {
  /** Items: messages, cards, files. */
  readonly items?: number;
  /** Bytes, where the face can say: mail's sizes, Drive's usage. */
  readonly bytes?: number;
  /** True when `bytes` was extrapolated from a sample rather than summed. */
  readonly estimated?: boolean;
  /** Drive: native editor files (Docs, Sheets, Slides) weigh nothing in `bytes`
   *  and are exported on migration, so the target ends up larger. */
  readonly nativeFilesExcluded?: boolean;
  /**
   * Why the face could NOT be measured, when the face answered and the
   * measure did not (2026-09-02). Data rather than a clause in `detail`, so
   * a screen can show it beside the line on a phone — the owner's second
   * measured Test showed Drive and nothing for mail or contacts, and the
   * reason sat in a hover nobody's phone has.
   */
  readonly failed?: string;
}

export interface AccountQualification {
  readonly domains: {
    readonly mail: QualifiedDomain;
    readonly calendar: QualifiedDomain;
    readonly contact: QualifiedDomain;
    readonly file: QualifiedDomain;
  };
  /** Folded in when the calendar face answered yes (0105 T0's verdict). */
  readonly scheduling?: SchedulingVerdict;
}

/** The kinds this measuring half covers — the Basic-auth account families.
 *  OAuth families are grant-qualified instead (0106 T1). */
export const QUALIFIABLE_KINDS = ['caldav', 'carddav', 'webdav', 'nextcloud', 'soverin', 'imap', 'jmap'] as const;

export function isQualifiableKind(kind: string): boolean {
  return (QUALIFIABLE_KINDS as ReadonlyArray<string>).includes(kind);
}

interface Listable {
  listFolders(): Promise<ReadonlyArray<unknown>>;
}

/** Injectable seams so the unit tests measure decisions, not sockets. */
export interface QualifyDeps {
  /** Build the IMAP face's listable; the default opens a real connection. */
  readonly imapListable?: (config: Record<string, unknown>, creds: Record<string, string>) => Listable;
}

const NOT_ASKABLE_MAIL =
  'This connection carries no mail server address, so mail was not measured — ' +
  'mail is qualified on an imap or jmap connection.';
const NOT_ASKABLE_DAV =
  'This connection carries no DAV address, so this face was not measured — ' +
  'calendars, contacts and files are qualified on a DAV connection.';

/** The English noun for a unit, in the right number — the fallback wording;
 *  a screen words the unit itself from `count` and `unit`. */
function counted(count: number, unit: ProbeUnit): string {
  const noun = unit === 'addressBook' ? 'address book' : unit;
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

async function askListable(
  build: () => Listable,
  unit: ProbeUnit,
): Promise<QualifiedDomain> {
  try {
    const folders = await build().listFolders();
    return {
      answer: 'yes',
      detail: `${counted(folders.length, unit)} visible.`,
      count: folders.length,
      unit,
    };
  } catch (err) {
    // A refusal is NOT a no: a 401 here may be an app-password scoped to
    // another protocol, and calling that "cannot carry calendars" would send
    // somebody hunting the wrong problem.
    return {
      answer: 'unknown',
      detail: `Unmeasured — the probe was refused: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
}

/**
 * Qualify one account connection. `kind` is the connection.kind as stored;
 * config/creds are the SAME shapes the probe and the passes read, so the
 * qualification cannot describe a different account than the one that would
 * migrate.
 */
export async function qualifyAccount(
  kind: string,
  config: Record<string, unknown>,
  creds: Record<string, string>,
  deps: QualifyDeps = {},
): Promise<AccountQualification | undefined> {
  if (!isQualifiableKind(kind)) return undefined;

  if (kind === 'imap') {
    const mail = await askListable(
      () =>
        deps.imapListable
          ? deps.imapListable(config, creds)
          : buildImapSourceFrom(
              {
                host: String(config.host ?? ''),
                port: Number(config.port ?? 993),
                tls: config.useSsl !== false,
                user: String(config.user ?? creds.username ?? ''),
              },
              { authType: 'LOGIN', password: creds.password },
            ),
      'folder',
    );
    const notAskable: QualifiedDomain = { answer: 'unknown', detail: NOT_ASKABLE_DAV };
    return { domains: { mail, calendar: notAskable, contact: notAskable, file: notAskable } };
  }

  if (kind === 'jmap') {
    return qualifyJmap(config, creds);
  }

  // The DAV family (caldav/carddav/webdav/nextcloud/soverin): one endpoint
  // resolution, three faces asked — the SAME resolution the writers use, so
  // Soverin's per-protocol app-password scoping (if any) shows up here as
  // exactly the unknown-with-a-401 it is.
  const endpoint = davEndpointFromCreds('target', config, creds);
  // The soverin ACCOUNT kind may also NAME its mail server (0106 T4b:
  // `mailHost`, typed by the person, never guessed) — when it does, the
  // mail face is measured with the same credential the DAV faces use; when
  // it does not, the unmeasured sentence carries the remedy.
  const mailHost =
    kind === 'soverin' && typeof config.mailHost === 'string' ? config.mailHost.trim() : '';
  const [calendar, contact, file, mailMeasured] = await Promise.all([
    askListable(
      () => new CalDAVSource({ url: endpoint.url, username: endpoint.username, password: endpoint.password }),
      'calendar',
    ),
    askListable(
      () => new CarddavSource({ url: endpoint.url, username: endpoint.username, password: endpoint.password }),
      'addressBook',
    ),
    askListable(
      () => new WebdavFileSource({ url: endpoint.url, username: endpoint.username, password: endpoint.password }),
      'folder',
    ),
    mailHost
      ? askListable(
          () =>
            deps.imapListable
              ? deps.imapListable({ host: mailHost, port: config.mailPort ?? 993 }, creds)
              : buildImapSourceFrom(
                  {
                    host: mailHost,
                    port: Number(config.mailPort ?? 993),
                    tls: config.useSsl !== false,
                    user: String(config.user ?? creds.username ?? ''),
                  },
                  { authType: 'LOGIN', password: creds.password },
                ),
          'folder',
        )
      : Promise.resolve(undefined),
  ]);
  // The scheduling verdict rides the calendar face it belongs to (0105 T0) —
  // measured only when that face answered, because a verdict about a
  // calendar nobody reached would be a sentence about nothing.
  const scheduling =
    calendar.answer === 'yes'
      ? await measureTargetScheduling(endpoint.url, endpoint.username, endpoint.password)
      : undefined;
  const mail: QualifiedDomain =
    mailMeasured ??
    (kind === 'soverin'
      ? {
          answer: 'unknown',
          detail:
            'This account stores no mail server address, so mail was not measured — add the ' +
            'mail host (mailHost) to the connection to measure this face.',
        }
      : { answer: 'unknown', detail: NOT_ASKABLE_MAIL });
  return {
    domains: {
      mail,
      calendar,
      contact,
      file,
    },
    ...(scheduling ? { scheduling } : {}),
  };
}

/**
 * JMAP is the one face where an honest NO exists without this product's
 * matrix: RFC 8620's session document ENUMERATES capabilities, so an
 * answered session with `urn:ietf:params:jmap:mail` absent is a measured
 * absence, not a guess.
 */
async function qualifyJmap(
  config: Record<string, unknown>,
  creds: Record<string, string>,
): Promise<AccountQualification> {
  const baseUrl = String(config.baseUrl ?? '');
  const sessionUrl = `${baseUrl}/.well-known/jmap`;
  const unknownAll = (why: string): AccountQualification => ({
    domains: {
      mail: { answer: 'unknown', detail: why },
      calendar: { answer: 'unknown', detail: why },
      contact: { answer: 'unknown', detail: why },
      file: { answer: 'unknown', detail: why },
    },
  });
  let capabilities: Record<string, unknown>;
  try {
    const response = await fetch(sessionUrl, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${creds.username}:${creds.password}`).toString('base64')}`,
        Accept: 'application/json',
      },
    });
    if (!response.ok) {
      return unknownAll(`Unmeasured — the session document answered ${response.status}.`);
    }
    const session = (await response.json()) as { capabilities?: Record<string, unknown> };
    capabilities = session.capabilities ?? {};
  } catch (err) {
    return unknownAll(
      `Unmeasured — the session document could not be read: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  const has = (urn: string): boolean => urn in capabilities;
  const fromCapability = (urn: string, noun: string): QualifiedDomain =>
    has(urn)
      ? { answer: 'yes', detail: `The session advertises ${urn}.` }
      : {
          answer: 'no',
          detail: `The session answered and does not advertise ${urn} — this server does not speak JMAP ${noun}.`,
        };
  return {
    domains: {
      mail: fromCapability('urn:ietf:params:jmap:mail', 'mail'),
      contact: fromCapability('urn:ietf:params:jmap:contacts', 'contacts'),
      // A fact about US, stated as ours: calendars are deliberately not
      // carried over JMAP by this product (workplan 0031 T1, parked) — a
      // caldav connection is the calendar door.
      calendar: {
        answer: 'no',
        detail:
          'Calendars are not carried over JMAP by this product (0031 T1 parked) — use a caldav connection.',
      },
      // No standard capability marks file storage; the product's JMAP file
      // writer exists, but whether THIS server carries it is unmeasured.
      file: {
        answer: 'unknown',
        detail: 'Unmeasured — no standard JMAP capability announces file storage.',
      },
    },
  };
}

/** Bytes for an English report line: the nearest unit, one decimal past KB. */
export function bytesText(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let n = bytes;
  let u = 0;
  while (n >= 1024 && u < units.length - 1) {
    n /= 1024;
    u += 1;
  }
  return `${n.toFixed(u === 0 ? 0 : 1)} ${units[u]}`;
}

/** The English sentence for a measured volume — the report's, not the screen's. */
export function volumeSentence(
  domain: 'mail' | 'calendar' | 'contact' | 'file',
  volume: MeasuredVolume,
): string {
  if (volume.failed) return `not measured — ${volume.failed}`;
  const parts: string[] = [];
  if (volume.items !== undefined) {
    const noun = domain === 'mail' ? 'message' : domain === 'contact' ? 'card' : 'item';
    parts.push(`${volume.items} ${noun}${volume.items === 1 ? '' : 's'}`);
  }
  if (volume.bytes !== undefined) {
    parts.push(`${volume.estimated ? '≈ ' : ''}${bytesText(volume.bytes)}`);
  }
  if (volume.nativeFilesExcluded) parts.push('Docs, Sheets and Slides not counted');
  return parts.join(', ');
}

/**
 * The qualification as §14.2 report lines: mark + evidence per domain, the
 * scheduling sentence riding along. English-only, like the report it lands
 * in; shared here so both editions render the identical lines.
 */
export function qualificationReportLines(qualification: AccountQualification): readonly string[] {
  const mark = (answer: DomainAnswer): string =>
    answer === 'yes' ? '✓' : answer === 'no' ? '✗' : '?';
  const label = { mail: 'Email', calendar: 'Calendar', contact: 'Contacts', file: 'Files' } as const;
  const lines = (['mail', 'calendar', 'contact', 'file'] as const).map((domain) => {
    const d = qualification.domains[domain];
    const measured = d.volume ? ` Measured: ${volumeSentence(domain, d.volume)}.` : '';
    return `${label[domain]} ${mark(d.answer)}: ${d.detail}${measured}`;
  });
  if (qualification.scheduling) lines.push(qualification.scheduling.sentence);
  return lines;
}

// ======================= The grant-qualified half (T1a) =======================

/** Google's token endpoint — a parameter so tests exchange against a stub. */
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

export const GOOGLE_GRANT_KINDS = [
  'gmail',
  'google_calendar',
  'google_contacts',
  'google_drive',
  // The ACCOUNT kind (workplan 0106 T3b). It qualifies exactly like the four
  // above and by the same mechanism — the stored refresh token is exchanged
  // and the token response's `scope` field enumerates the grant — which is
  // what makes an account row honest about carrying several faces: each face
  // is a MEASURED yes or a measured no, never an inference from the kind.
  //
  // It matters most here. A single-purpose row's grant is one scope and the
  // answer is nearly rhetorical; an account row's grant is the place where
  // "you ticked two and Google gave one" becomes visible at all.
  'google',
] as const;

export function isGoogleGrantKind(kind: string): boolean {
  return (GOOGLE_GRANT_KINDS as ReadonlyArray<string>).includes(kind);
}

/** The four faces an account can carry here. */
export type GoogleGrantDomain = 'mail' | 'calendar' | 'contact' | 'file';

/**
 * The product's own scope needs, domain by domain — one table read in BOTH
 * directions (workplan 0106 T1a reads a grant; T1b asks for one).
 *
 * The two fields are not decoration, they are the least-privilege invariant
 * made structural. The owner's ask was *"grant access to what they want and
 * not more/all"*, and the failure mode is not a wrong scope — it is a
 * BROADER one arriving quietly, because a broader scope makes every feature
 * work and nothing goes red.
 *
 *  - `asked` is the ONLY scope a consent request may name for this domain.
 *    It is the scope the factory actually mints tokens with (GMAIL_SCOPE,
 *    GOOGLE_CALDAV_SCOPE, GOOGLE_CARDDAV_SCOPE, DRIVE_READONLY_SCOPE).
 *  - `alsoAccepted` is broader scopes that SATISFY the domain when a person
 *    already granted them elsewhere. Read-only, never asked for.
 *
 * Kept apart rather than as one ordered list where the ask is element zero:
 * an ordered list makes the invariant positional, so a reorder — or an
 * innocent-looking "add the broader scope, it covers more" — silently widens
 * every consent screen the product shows. Here, widening the ask means
 * editing a field named `asked`, in a diff somebody reads.
 *
 * Over-RECEIVING is a different thing and is fine: if Google enumerates the
 * broader Drive scope because the person granted it long ago, the domain is
 * satisfied and reported. Over-ASKING is what least privilege forbids.
 */
const GOOGLE_DOMAIN_SCOPES: Record<
  GoogleGrantDomain,
  { readonly asked: string; readonly alsoAccepted: ReadonlyArray<string> }
> = {
  mail: { asked: 'https://mail.google.com/', alsoAccepted: [] },
  calendar: { asked: 'https://www.googleapis.com/auth/calendar', alsoAccepted: [] },
  contact: { asked: 'https://www.googleapis.com/auth/carddav', alsoAccepted: [] },
  file: {
    asked: 'https://www.googleapis.com/auth/drive.readonly',
    alsoAccepted: ['https://www.googleapis.com/auth/drive'],
  },
};

/**
 * The one scope each domain may ASK for, exposed so the invariant can be
 * asserted against the table rather than only against this module's output —
 * a widened ask is then red at the table, before a consent screen is built
 * from it. Read-only: the ask is decided in `GOOGLE_DOMAIN_SCOPES` above.
 */
export const GOOGLE_SCOPES_ASKED_BY_DOMAIN: Readonly<Record<GoogleGrantDomain, string>> =
  Object.freeze({
    mail: GOOGLE_DOMAIN_SCOPES.mail.asked,
    calendar: GOOGLE_DOMAIN_SCOPES.calendar.asked,
    contact: GOOGLE_DOMAIN_SCOPES.contact.asked,
    file: GOOGLE_DOMAIN_SCOPES.file.asked,
  });

/** Every scope that satisfies a domain: the one we ask for, then the broader
 *  ones we accept if they happen to be there. Ask-first, so the message that
 *  names `[0]` names the scope a person can actually go and grant. */
function scopesSatisfying(domain: GoogleGrantDomain): ReadonlyArray<string> {
  const { asked, alsoAccepted } = GOOGLE_DOMAIN_SCOPES[domain];
  return [asked, ...alsoAccepted];
}

/**
 * The scopes a consent screen may ask for, given exactly the domains ticked
 * (workplan 0106 T1b). The stepout URL is built from this and nothing else.
 *
 * Deduplicated and in a stable order so the same tick set always produces the
 * same consent screen — a scope string that varies run to run is one a person
 * cannot recognise as the same request they approved yesterday.
 *
 * An empty tick set returns an empty array rather than a default. There is no
 * sensible scope for "no domains", and a fallback here would be a way to ask
 * for something nobody ticked — which is the one thing this function exists
 * to prevent. Callers refuse; they do not substitute.
 */
export function domainsToScopes(
  domains: Iterable<GoogleGrantDomain>,
): ReadonlyArray<string> {
  const order: ReadonlyArray<GoogleGrantDomain> = ['mail', 'calendar', 'contact', 'file'];
  const ticked = new Set(domains);
  return order.filter((d) => ticked.has(d)).map((d) => GOOGLE_DOMAIN_SCOPES[d].asked);
}

const DWD_UNMEASURED =
  "Unmeasured — a service-account key's scopes live in the Workspace admin " +
  'console domain-wide delegation grant, which no token response enumerates.';

function allUnknown(why: string): AccountQualification {
  const domain: QualifiedDomain = { answer: 'unknown', detail: why };
  return { domains: { mail: domain, calendar: domain, contact: domain, file: domain } };
}

/**
 * Read what a stored Google grant ACTUALLY CARRIES (0106 T1a) — no new flow
 * needed: exchanging the refresh token yields a token response whose `scope`
 * field enumerates the grant, so the qualification is read, never assumed
 * from the wizard kind the credential happened to be typed under.
 *
 * An answered exchange is the OAuth twin of JMAP's session document: a scope
 * absent from an enumeration that arrived is a MEASURED no — and the remedy
 * rides the sentence, because in the grant-qualified world asking is
 * granting: adding the domain means re-consenting with its scope (the
 * stepout's job, 0089 + T1b). A refused exchange enumerates nothing: every
 * domain stays unknown, carrying Google's own words — the same words the
 * headline probe fails with, so the two never disagree.
 */
/**
 * The seam through which a carried face is REACHED (2026-09-02).
 *
 * The owner's first Google account connection tested "5 calendars visible"
 * and said nothing about the three other faces it had just been granted —
 * the grant half read the scopes and stopped there, so a face whose API was
 * switched off in the client's project passed Test and would have failed at
 * the first migration. Now each face the grant carries is asked the one
 * question every source answers, with the builder a pass would use.
 *
 * `user` is the account address every builder starts from (the Gmail user,
 * the DAV principal, the Drive subject); `config` is the row's own blob, so
 * a Drive row's chosen root is honoured and an account row lands on My Drive
 * as a pass would. `listable` is the test seam: the default builds the real
 * sources.
 */
export interface GoogleReach {
  readonly user: string;
  readonly config?: Record<string, unknown>;
  readonly listable?: (
    domain: GoogleGrantDomain,
    user: string,
    creds: GoogleCredentialsAsFound,
    config: Record<string, unknown>,
  ) => Listable;
}

export interface QualifyGoogleGrantOptions {
  /** Google's token endpoint — a parameter so tests exchange against a stub. */
  readonly tokenEndpoint?: string;
  /** Absent: the grant is read and not reached (an older caller's contract). */
  readonly reach?: GoogleReach;
}

/**
 * The measures a face may offer beyond listing, asked for by shape rather
 * than by class: the reach holds whatever the builder returned, and the test
 * seam returns plain objects. A source without the method is simply not
 * measured — the yes stands on the listing, and no volume is claimed.
 */
interface MailMeasurable {
  measureMailbox(): Promise<{ messages: number; bytes: number; estimated: boolean }>;
}
interface UsageMeasurable {
  storageUsage(): Promise<{ bytes: number; nativeFilesExcluded?: boolean }>;
}
interface CardListable {
  listSince(folder: unknown): Promise<{ items: ReadonlyArray<unknown> }>;
}
const offers = <T>(source: unknown, method: keyof T & string): source is T =>
  typeof source === 'object' && source !== null && typeof (source as Record<string, unknown>)[method] === 'function';

/**
 * How much the face holds, in the cheapest honest way each face allows.
 * Bounded by construction: mail samples sizes (see `measureMailbox`), Drive
 * is one `about` request, contacts are one listing per address book —
 * the same listing a pass makes, metadata only. Calendar offers no cheap
 * measure and claims none.
 */
async function measureGoogleFace(
  domain: GoogleGrantDomain,
  source: unknown,
  listed: ReadonlyArray<unknown>,
): Promise<MeasuredVolume | undefined> {
  switch (domain) {
    case 'mail': {
      if (!offers<MailMeasurable>(source, 'measureMailbox')) return undefined;
      const m = await source.measureMailbox();
      return { items: m.messages, bytes: m.bytes, estimated: m.estimated };
    }
    case 'contact': {
      if (!offers<CardListable>(source, 'listSince')) return undefined;
      let items = 0;
      for (const folder of listed) items += (await source.listSince(folder)).items.length;
      return { items };
    }
    case 'file': {
      if (!offers<UsageMeasurable>(source, 'storageUsage')) return undefined;
      const usage = await source.storageUsage();
      return { bytes: usage.bytes, ...(usage.nativeFilesExcluded ? { nativeFilesExcluded: true } : {}) };
    }
    case 'calendar':
      return undefined;
  }
}

/** What each face counts, in the unit a screen words. */
const GOOGLE_FACE_UNIT: Readonly<Record<GoogleGrantDomain, ProbeUnit>> = {
  mail: 'folder',
  calendar: 'calendar',
  contact: 'addressBook',
  file: 'folder',
};

function googleFaceListable(
  domain: GoogleGrantDomain,
  user: string,
  creds: GoogleCredentialsAsFound,
  config: Record<string, unknown>,
): Listable {
  switch (domain) {
    case 'mail':
      return buildGmailSourceFrom(user, creds, STORED_GMAIL_CREDENTIAL_NAMES);
    case 'calendar':
      return buildGoogleCalendarDavSourceFrom(user, creds, STORED_GOOGLE_DAV_CREDENTIAL_NAMES);
    case 'contact':
      return buildGoogleContactsDavSourceFrom(user, creds, STORED_GOOGLE_DAV_CREDENTIAL_NAMES);
    case 'file':
      return buildGoogleDriveSourceFrom(
        parseGoogleDriveSource(config),
        creds,
        STORED_GOOGLE_CREDENTIAL_NAMES,
      );
  }
}

export async function qualifyGoogleGrant(
  kind: string,
  rawCreds: Record<string, string>,
  options: QualifyGoogleGrantOptions = {},
): Promise<AccountQualification | undefined> {
  const tokenEndpoint = options.tokenEndpoint ?? GOOGLE_TOKEN_ENDPOINT;
  if (!isGoogleGrantKind(kind)) return undefined;
  // THE DEPLOYMENT'S OWN CLIENT, where it configured one (ADR-0041, owner
  // decision 2026-09-01). Without this the measurement is the one that goes
  // quiet: a connection whose client lives in the deployment rather than in
  // its own credentials would answer "Unmeasured — the stored credentials
  // carry no clientId/refreshToken pair", which reads as a broken grant and is
  // a missing exchange. Already kind-gated by the guard above.
  const creds = withDeploymentGoogleClient(true, rawCreds);
  if (creds.serviceAccountKey) return allUnknown(DWD_UNMEASURED);
  const clientId = creds.clientId;
  const refreshToken = creds.refreshToken;
  if (!clientId || !refreshToken) {
    return allUnknown(
      'Unmeasured — the stored credentials carry no clientId/refreshToken pair to read the grant from.',
    );
  }
  let granted: ReadonlySet<string>;
  try {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      refresh_token: refreshToken,
      ...(creds.clientSecret ? { client_secret: creds.clientSecret } : {}),
    });
    const response = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!response.ok) {
      const head = (await response.text()).slice(0, 200);
      return allUnknown(
        `Unmeasured — the token exchange answered ${response.status}: ${head}`,
      );
    }
    const token = (await response.json()) as { scope?: string };
    granted = new Set((token.scope ?? '').split(' ').filter(Boolean));
  } catch (err) {
    return allUnknown(
      `Unmeasured — the token exchange failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const reach = options.reach;
  const domainFromGrant = async (domain: GoogleGrantDomain): Promise<QualifiedDomain> => {
    const carried = scopesSatisfying(domain).find((scope) => granted.has(scope));
    if (!carried) {
      return {
        answer: 'no',
        detail:
          `The grant does not carry ${GOOGLE_DOMAIN_SCOPES[domain].asked} — asking is ` +
          'granting: re-consent with that scope to add this domain.',
      };
    }
    if (!reach) return { answer: 'yes', detail: `The grant carries ${carried}.` };
    // REACHED, not inferred: the scope says Google MAY answer this face; the
    // listing says it DID. A face the grant does not carry is never asked —
    // asking would be a request Google refuses by design, and the no above
    // already names the remedy.
    try {
      const source = (reach.listable ?? googleFaceListable)(
        domain,
        reach.user,
        creds,
        reach.config ?? {},
      );
      const listed = await source.listFolders();
      const unit = GOOGLE_FACE_UNIT[domain];
      const answered: QualifiedDomain = {
        answer: 'yes',
        detail: `The grant carries ${carried}; ${counted(listed.length, unit)} visible.`,
        count: listed.length,
        unit,
      };
      // MEASURED, once the face has answered — and a measure that fails does
      // not take the yes away: the listing is the capability evidence, the
      // volume is a second fact. It fails aloud, in the evidence sentence,
      // rather than as a missing number nobody explains (rule 9).
      try {
        const volume = await measureGoogleFace(domain, source, listed);
        return volume ? { ...answered, volume } : answered;
      } catch (err) {
        return {
          ...answered,
          volume: { failed: err instanceof Error ? err.message : String(err) },
        };
      }
    } catch (err) {
      // The three-state rule: a refusal is NOT a no. The scope is carried, so
      // "cannot carry" would be false; and it is not a yes either, since
      // nothing answered. Unknown, with the refusal's own words — Google's,
      // when the switch behind the face is off, naming the API and the page.
      return {
        answer: 'unknown',
        detail:
          `The grant carries ${carried}, but the face did not answer: ${
            err instanceof Error ? err.message : String(err)
          }`,
      };
    }
  };
  const [mail, calendar, contact, file] = await Promise.all([
    domainFromGrant('mail'),
    domainFromGrant('calendar'),
    domainFromGrant('contact'),
    domainFromGrant('file'),
  ]);
  return { domains: { mail, calendar, contact, file } };
}
