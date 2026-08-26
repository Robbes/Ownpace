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
import { buildImapSourceFrom } from './mail-source-factory.ts';
import { davEndpointFromCreds } from './dav-endpoint.ts';
import { measureTargetScheduling } from './target-scheduling.ts';
import type { SchedulingVerdict } from './target-scheduling.ts';

export type DomainAnswer = 'yes' | 'no' | 'unknown';

export interface QualifiedDomain {
  readonly answer: DomainAnswer;
  /** The English sentence that justifies the answer — a count, a refusal's
   *  own words, or WHY this stayed unmeasured. The UI words yes/no/unknown
   *  itself; this is the evidence line. */
  readonly detail: string;
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

async function askListable(
  build: () => Listable,
  noun: string,
): Promise<QualifiedDomain> {
  try {
    const folders = await build().listFolders();
    return {
      answer: 'yes',
      detail: `${folders.length} ${noun}${folders.length === 1 ? '' : 's'} visible.`,
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

  // The DAV family (caldav/carddav/webdav/nextcloud): one endpoint
  // resolution, three faces asked — the SAME resolution the writers use, so
  // Soverin's per-protocol app-password scoping (if any) shows up here as
  // exactly the unknown-with-a-401 it is.
  const endpoint = davEndpointFromCreds('target', config, creds);
  const [calendar, contact, file] = await Promise.all([
    askListable(
      () => new CalDAVSource({ url: endpoint.url, username: endpoint.username, password: endpoint.password }),
      'calendar',
    ),
    askListable(
      () => new CarddavSource({ url: endpoint.url, username: endpoint.username, password: endpoint.password }),
      'address book',
    ),
    askListable(
      () => new WebdavFileSource({ url: endpoint.url, username: endpoint.username, password: endpoint.password }),
      'folder',
    ),
  ]);
  // The scheduling verdict rides the calendar face it belongs to (0105 T0) —
  // measured only when that face answered, because a verdict about a
  // calendar nobody reached would be a sentence about nothing.
  const scheduling =
    calendar.answer === 'yes'
      ? await measureTargetScheduling(endpoint.url, endpoint.username, endpoint.password)
      : undefined;
  return {
    domains: {
      mail: { answer: 'unknown', detail: NOT_ASKABLE_MAIL },
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

/**
 * The qualification as §14.2 report lines: mark + evidence per domain, the
 * scheduling sentence riding along. English-only, like the report it lands
 * in; shared here so both editions render the identical lines.
 */
export function qualificationReportLines(qualification: AccountQualification): readonly string[] {
  const mark = (answer: DomainAnswer): string =>
    answer === 'yes' ? '✓' : answer === 'no' ? '✗' : '?';
  const label = { mail: 'Email', calendar: 'Calendar', contact: 'Contacts', file: 'Files' } as const;
  const lines = (['mail', 'calendar', 'contact', 'file'] as const).map(
    (domain) =>
      `${label[domain]} ${mark(qualification.domains[domain].answer)}: ${
        qualification.domains[domain].detail
      }`,
  );
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
] as const;

export function isGoogleGrantKind(kind: string): boolean {
  return (GOOGLE_GRANT_KINDS as ReadonlyArray<string>).includes(kind);
}

/**
 * The product's own scope needs, domain by domain — what a grant must carry
 * for each face to actually work here. These are the scopes the factories
 * mint tokens with (GMAIL_SCOPE, GOOGLE_CALDAV_SCOPE, GOOGLE_CARDDAV_SCOPE,
 * DRIVE_READONLY_SCOPE); drive also accepts the broader read-write scope a
 * person may have granted elsewhere.
 */
const GOOGLE_DOMAIN_SCOPES: Record<
  'mail' | 'calendar' | 'contact' | 'file',
  ReadonlyArray<string>
> = {
  mail: ['https://mail.google.com/'],
  calendar: ['https://www.googleapis.com/auth/calendar'],
  contact: ['https://www.googleapis.com/auth/carddav'],
  file: [
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/drive',
  ],
};

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
export async function qualifyGoogleGrant(
  kind: string,
  creds: Record<string, string>,
  tokenEndpoint: string = GOOGLE_TOKEN_ENDPOINT,
): Promise<AccountQualification | undefined> {
  if (!isGoogleGrantKind(kind)) return undefined;
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

  const domainFromGrant = (domain: 'mail' | 'calendar' | 'contact' | 'file'): QualifiedDomain => {
    const accepted = GOOGLE_DOMAIN_SCOPES[domain];
    const carried = accepted.find((scope) => granted.has(scope));
    return carried
      ? { answer: 'yes', detail: `The grant carries ${carried}.` }
      : {
          answer: 'no',
          detail:
            `The grant does not carry ${accepted[0]} — asking is granting: ` +
            're-consent with that scope to add this domain.',
        };
  };
  return {
    domains: {
      mail: domainFromGrant('mail'),
      calendar: domainFromGrant('calendar'),
      contact: domainFromGrant('contact'),
      file: domainFromGrant('file'),
    },
  };
}
