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

import { CalDAVSource, CarddavSource, DropboxFileSource, WebdavFileSource } from '@openmig/connectors';
import {
  isProviderAccountKind,
  parseGoogleDriveSource,
  providerAccountDomains,
  providerAccountServes,
  providerDisplayName,
  withDeploymentDropboxClient,
  withDeploymentGoogleClient,
} from '@openmig/shared';
import { QUALIFICATION_KEYS, publishedEndpoint, type QualificationKey } from '@openmig/shared';
import type { DiscoveryDomain, ProbeUnit } from '@openmig/shared';
import { buildImapSourceFrom } from './mail-source-factory.ts';
import { davEndpointFromCreds, fileEndpointFromCreds } from './dav-endpoint.ts';
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
import { buildDropboxSourceFrom, STORED_DROPBOX_CREDENTIAL_NAMES } from './dropbox-source-factory.ts';
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
    /**
     * Tasks (workplan 0113 T5). A face of its own rather than a property of
     * the calendar one, because it is a separate answer: a DAV account can
     * hold calendars and no task list, or a task list and no calendar, and
     * the calendar face's count was never evidence about either.
     */
     readonly task: QualifiedDomain;
  };
  /** Folded in when the calendar face answered yes (0105 T0's verdict). */
  readonly scheduling?: SchedulingVerdict;
}

/** The kinds this measuring half covers — the Basic-auth account families.
 *  OAuth families are grant-qualified instead (0106 T1). */
export const QUALIFIABLE_KINDS = [
  'caldav',
  'carddav',
  'webdav',
  'nextcloud',
  'soverin',
  // Apple rides the DAV family branch below rather than getting a qualifier of
  // its own (workplan 0115 T6). It is Soverin's shape — protocols and a
  // password, discovered rather than granted — and a `qualifyApple` beside
  // `qualifyGoogleGrant` would be a third copy of the same measuring code,
  // which is how a face ends up measured one way in one place and another way
  // somewhere else. What Apple needs from that branch is two things it did not
  // do: PER-FACE endpoints, and its own sentence for the file face.
  'apple',
  'imap',
  'jmap',
] as const;

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
  'calendars, task lists, contacts and files are qualified on a DAV connection.';

/** The English noun for a unit, in the right number — the fallback wording;
 *  a screen words the unit itself from `count` and `unit`. */
function counted(count: number, unit: ProbeUnit): string {
  const noun = unit === 'addressBook' ? 'address book' : unit === 'taskList' ? 'task list' : unit;
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
 * Does this account kind serve that face AT ALL?
 *
 * `providerAccountServes` is the product's own statement of what a NAMED
 * provider carries from one account row (0106 T3b) — the same answer the
 * domain ticks and the target matrix read, deployment declaration and all. A
 * protocol kind (caldav, carddav, webdav, nextcloud, imap) names no provider
 * and claims nothing about the server behind it, so it is never constrained
 * here: `true`, and the probe answers.
 */
function accountServes(kind: string, face: DiscoveryDomain): boolean {
  if (!isProviderAccountKind(kind)) return true;
  return providerAccountServes(kind, face);
}

/**
 * The answer for a face a named account has not got, in the shape
 * `qualifyDropbox` already gives the three faces a Dropbox has not got.
 *
 * A MEASURED `no` rather than an `unknown`, and that distinction is the whole
 * three-state rule (0106 T3a): `unknown` means nobody could look and never
 * constrains a tick; `no` means the answer is known. Here it IS known — the
 * product states what a Soverin account carries — so `no` is the honest state,
 * and it agrees with the domain step that refuses the same tick.
 */
function notAFaceOf(kind: string, face: string): QualifiedDomain {
  const carried = providerAccountDomains(kind);
  const carries = carried.length > 1
    ? `${carried.slice(0, -1).join(', ')} and ${carried[carried.length - 1]}`
    : (carried[0] ?? 'other faces');
  return {
    answer: 'no',
    detail: `A ${providerDisplayName(kind)} account carries ${carries}; ${face} is not a face of this connection.`,
  };
}

/**
 * The same measured `no`, for the faces where the product knows WHY and the
 * why is worth a customer's time.
 *
 * `notAFaceOf` says a face is not one this account carries, which is true and
 * enough for most of them: a Soverin account has no file store because Soverin
 * sells no file store, and there is nothing further to explain.
 *
 * Apple's file face is the one where that sentence, while true, is unhelpful
 * and slightly misleading. The person HAS an iCloud Drive, very likely a large
 * one — macOS offers to sync a Mac's whole Desktop and Documents into it — so
 * "not a face of this connection" reads as if we had simply not bothered.
 * What is actually true is narrower and worth saying: Apple publishes no API
 * for it to anyone, CloudKit reaches an application's own container rather
 * than the person's files, and the only route to those bytes is the person's
 * own Data & Privacy export (workplan 0116, undecided).
 *
 * Returns `undefined` where the generic sentence is the right one, so this
 * stays a list of exceptions rather than a second vocabulary.
 */
function reasonedNo(kind: string, face: DiscoveryDomain): QualifiedDomain | undefined {
  if (kind === 'apple' && face === 'file') {
    return {
      answer: 'no',
      detail:
        'Apple publishes no API for iCloud Drive — to anyone, not just to us — so these files ' +
        'cannot be read from the account the way mail, calendars, contacts and reminders can. ' +
        'The only route to them is your own Data & Privacy export at privacy.apple.com.',
    };
  }
  return undefined;
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
    return {
      domains: { mail, calendar: notAskable, contact: notAskable, file: notAskable, task: notAskable },
    };
  }

  if (kind === 'jmap') {
    return qualifyJmap(config, creds);
  }

  // The DAV family (caldav/carddav/webdav/nextcloud/soverin): the faces asked
  // through the SAME resolution the writers use, so Soverin's per-protocol
  // app-password scoping (if any) shows up here as exactly the
  // unknown-with-a-401 it is.
  //
  // TWO RESOLUTIONS, NOT ONE, AND THE COMMENT ABOVE USED TO BE HALF FALSE
  // (owner, 2026-09-03: "It tells: Files has 5 folder. But, i dont recall
  // soverin already having Files (like nextcloud) enabled"). Calendar and
  // contacts live at the DAV base; FILES do not, and the run path has never
  // thought they did — `buildDepsFromMapping` resolves the file domain through
  // `fileEndpointFromCreds`, which appends Nextcloud's own `files/{username}/`
  // convention and honours the `fileBaseUrl` escape hatch. The qualification
  // handed `WebdavFileSource` the bare base instead, so it PROPFINDed the DAV
  // ROOT and counted what a DAV root holds — the account's principal, calendar
  // and address-book collections — as file folders. Five of them, on an
  // account with no file store at all. Same shape as the `[Gmail]` container
  // counted as a mail folder: a service collection read as content.
  // ONE ENDPOINT PER FACE, NOT ONE FOR ALL OF THEM (workplan 0115 T6).
  //
  // Every DAV provider before Apple put calendars and address books under one
  // root, so a single resolution served both and nothing said otherwise. Apple
  // does not: `caldav.icloud.com` carries calendars and reminders,
  // `contacts.icloud.com` carries contacts. Measured through one endpoint, the
  // contact face asks the CALENDAR service for address books, is refused, and
  // — correctly, under the three-state rule — records `unknown`. The card then
  // shows Contacts `?` on an account that carries them perfectly well, and per
  // 0106 T3a an unknown never constrains, so the wizard offers the tick anyway
  // and the migration finds out later.
  //
  // The #597 family again, and the same shape as everything workplan 0113 hit:
  // a two-way assumption meeting a third provider. Nothing changes for the
  // kinds that do share a root — `davUrl` returns the stored `url` when the
  // config has one, so per-face resolution gives them the same answer three
  // times — and the only rows that differ are the ones whose faces genuinely
  // live apart.
  const endpointFor = (face: DiscoveryDomain) =>
    davEndpointFromCreds('target', config, creds, kind, face);
  const calendarEndpoint = endpointFor('calendar');
  const contactEndpoint = endpointFor('contact');
  // Reminders are VTODO in the CALENDAR account, so the task face rides the
  // calendar endpoint by name rather than by luck — `publishedDavUrl` maps
  // `task` onto `calendar` for exactly this reason (0115 T4).
  const taskEndpoint = endpointFor('task');
  // LAZY, because a kind with no file face must not need a file ADDRESS to be
  // qualified at all. Resolved eagerly, this threw for `apple` — which has no
  // file face by design, and therefore no published file root — and took the
  // whole qualification down with it, so an Apple connection got no record and
  // every one of its four real faces read `?`. The face that is not asked must
  // cost nothing to not ask; `davFace` already takes a thunk for exactly this.
  const fileEndpoint = () => fileEndpointFromCreds('target', config, creds, kind);
  // The soverin ACCOUNT kind may also NAME its mail server (0106 T4b:
  // `mailHost`, typed by the person, never guessed) — when it does, the
  // mail face is measured with the same credential the DAV faces use; when
  // it does not, the unmeasured sentence carries the remedy.
  // THE MAIL HOST, TYPED OR PUBLISHED (0106 T4b, widened by 0115 T6).
  //
  // Soverin's is typed, because its mail server is a fact about one customer's
  // account and this product never guesses one. Apple's is not a customer
  // choice at all — every iCloud account is at `imap.mail.me.com` — so asking
  // somebody to type it would be asking them to prove they know something we
  // already know.
  //
  // DELIBERATELY NOT `accountMailEndpoint`, which is the rule the PASSES use,
  // and the difference is the point. That rule ends `?? stored.host`, which is
  // right for a mapping config (a top-level `host` on an imap mapping IS the
  // mail server) and wrong here: a `soverin` CONNECTION stores
  // `host: caldav.soverin.net`, so borrowing that fallback would point an IMAP
  // probe at a calendar server, collect its refusal, and render `unknown` with
  // a connection error — replacing a sentence that tells the person exactly
  // what to add. That is #133's mistake in a new place: reading whatever an
  // endpoint happens to expose instead of measuring the face at its own
  // address. A qualification that cannot ask must say so, not ask the wrong
  // server. It also must not throw: the pass rule refuses when it finds no
  // host, because it is about to connect; here "nobody could ask" is a legal
  // answer and the whole reason the third state exists.
  const publishedMail = publishedEndpoint(kind, 'email');
  const typedMailHost = typeof config.mailHost === 'string' ? config.mailHost.trim() : '';
  const mailHost = accountServes(kind, 'email')
    ? typedMailHost || publishedMail?.host || ''
    : '';
  const mailPort = Number(config.mailPort ?? publishedMail?.port ?? 993);
  // A FACE THIS ACCOUNT KIND HAS NOT GOT IS NOT MEASURED, IT IS ANSWERED.
  // `providerAccountDomains` is the product's own statement of what a NAMED
  // provider carries from one account row — soverin: email, calendar,
  // contact. Asking outside that list cannot produce a true answer, only a
  // reading of whatever the endpoint happens to expose, which is the second
  // half of how "Files ✓ 5 folders" reached a screen. So the face says so
  // instead, in the shape `qualifyDropbox` already uses for the three faces a
  // Dropbox has not got: a MEASURED no — honest, because the product knows,
  // and constraining correctly, because the domain step refuses that tick too.
  // A protocol kind (caldav, carddav, webdav, nextcloud) is not a named
  // account, claims nothing about the server behind it, and is measured
  // exactly as before.
  const davFace = (
    face: DiscoveryDomain,
    word: string,
    build: () => Listable,
    unit: ProbeUnit,
  ): Promise<QualifiedDomain> =>
    accountServes(kind, face)
      ? askListable(build, unit)
      : Promise.resolve(reasonedNo(kind, face) ?? notAFaceOf(kind, word));
  const [calendar, task, contact, file, mailMeasured] = await Promise.all([
    davFace(
      'calendar',
      'a calendar',
      () =>
        new CalDAVSource({
          url: calendarEndpoint.url,
          username: calendarEndpoint.username,
          password: calendarEndpoint.password,
        }),
      'calendar',
    ),
    // THE SAME ENDPOINT, A DIFFERENT COMPONENT (workplan 0113 T5). A task list
    // is a calendar collection that declares VTODO in its
    // `supported-calendar-component-set` — there is no second protocol and no
    // second address to resolve, which is why this rides `endpoint` rather
    // than getting a `taskEndpointFromCreds` of its own. What separates the
    // two faces is the component the source asks for: with `VTODO` the same
    // class lists only the collections that carry tasks, so this count is the
    // person's to-do lists and the calendar count above is their calendars,
    // and a MIXED collection is honestly counted in both.
    davFace(
      'task',
      'a task list',
      () =>
        new CalDAVSource({
          url: taskEndpoint.url,
          username: taskEndpoint.username,
          password: taskEndpoint.password,
          component: 'VTODO',
        }),
      'taskList',
    ),
    davFace(
      'contact',
      'an address book',
      () =>
        new CarddavSource({
          url: contactEndpoint.url,
          username: contactEndpoint.username,
          password: contactEndpoint.password,
        }),
      'addressBook',
    ),
    davFace(
      'file',
      'a file store',
      () =>
        (() => {
          const e = fileEndpoint();
          return new WebdavFileSource({ url: e.url, username: e.username, password: e.password });
        })(),
      'folder',
    ),
    mailHost
      ? askListable(
          () =>
            deps.imapListable
              ? deps.imapListable({ host: mailHost, port: mailPort }, creds)
              : buildImapSourceFrom(
                  {
                    host: mailHost,
                    port: mailPort,
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
      ? await measureTargetScheduling(
          calendarEndpoint.url,
          calendarEndpoint.username,
          calendarEndpoint.password,
        )
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
      task,
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
      task: { answer: 'unknown', detail: why },
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
      // Tasks follow calendars, and for the same reason rather than a new one:
      // this product's task face is CalDAV `VTODO` (workplan 0113), so there
      // is nothing to ask a JMAP session for. Stated as ours, like the line
      // above — a fact about what we carry, not a claim about this server.
      task: {
        answer: 'no',
        detail:
          'Tasks are not carried over JMAP by this product — they are CalDAV VTODO collections, ' +
          'so use a caldav connection.',
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
  domain: QualificationKey,
  volume: MeasuredVolume,
): string {
  if (volume.failed) return `not measured — ${volume.failed}`;
  const parts: string[] = [];
  if (volume.items !== undefined) {
    const noun =
      domain === 'mail' ? 'message' : domain === 'contact' ? 'card' : domain === 'task' ? 'task' : 'item';
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
  // Labelled and ORDERED from the one list (0113 T5), so the report reads the
  // faces in the same sequence as the qualification line on screen — a total
  // record, so a sixth domain is a compile error here rather than a face
  // missing from a report nobody re-reads.
  const label: Readonly<Record<QualificationKey, string>> = {
    mail: 'Email',
    calendar: 'Calendar',
    contact: 'Contacts',
    file: 'Files',
    task: 'Tasks',
  };
  const lines = QUALIFICATION_KEYS.map((domain) => {
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

/**
 * GOOGLE HAS NO TASK FACE, AND NO SCOPE BUYS ONE (workplan 0113 T5/T6).
 *
 * Google's own CalDAV developer guide says its service supports neither VTODO
 * nor VJOURNAL: a Google account's tasks live behind the separate Tasks REST
 * API, whose model is thinner than VTODO, and driving it is T6 — deliberately
 * out of v1. So this is a MEASURED no under the three-state rule (0106 T3a),
 * not an unknown: the answer is known, it just is not this account's to give.
 *
 * Which is why it stands even in `allUnknown`, where every other face is
 * unmeasured because the token exchange never answered. This one does not
 * depend on the exchange — it is a fact about the provider and about what this
 * product drives, and a `?` here would invite somebody to re-consent for a
 * scope that does not exist.
 */
const GOOGLE_NO_TASKS: QualifiedDomain = {
  answer: 'no',
  detail:
    "Google's CalDAV service carries no VTODO components at all, so there is no task face to " +
    'grant. Google Tasks is a separate API this product does not migrate yet.',
};

const DWD_UNMEASURED =
  "Unmeasured — a service-account key's scopes live in the Workspace admin " +
  'console domain-wide delegation grant, which no token response enumerates.';

function allUnknown(why: string): AccountQualification {
  const domain: QualifiedDomain = { answer: 'unknown', detail: why };
  return {
    domains: { mail: domain, calendar: domain, contact: domain, file: domain, task: GOOGLE_NO_TASKS },
  };
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

/**
 * THE DROPBOX ACCOUNT, qualified (2026-09-02, after the owner's first Dropbox
 * test read "Connected. 23 folders visible" and nothing beside it).
 *
 * One face, files, and two answers for it: reachable and listing — the top
 * level, as the probe asks it — and how much the Dropbox holds, from
 * `users/get_space_usage`, the same sizing Drive's `about` gives. The other
 * three faces are a measured NO: a Dropbox carries files and nothing else,
 * which is an answer rather than an absence of measurement, so the wizard's
 * domain step may constrain on it (0106 T3a) and the card shows no `?`.
 */
export const DROPBOX_QUALIFIED_KIND = 'dropbox';

export function isDropboxKind(kind: string): boolean {
  return kind === DROPBOX_QUALIFIED_KIND;
}

export async function qualifyDropbox(
  kind: string,
  config: Record<string, unknown>,
  rawCreds: Record<string, string>,
): Promise<AccountQualification | undefined> {
  if (!isDropboxKind(kind)) return undefined;
  // The deployment's own app, where it carries one (ADR-0041): the same fill
  // the probe and the pass apply, so a row that stores no pair measures too.
  const creds = withDeploymentDropboxClient(true, rawCreds);
  const notAFace = (face: string): QualifiedDomain => ({
    answer: 'no',
    detail: `A Dropbox carries files only; ${face} is not a face of this connection.`,
  });
  let file: QualifiedDomain;
  try {
    const source = buildDropboxSourceFrom(
      { rootPath: (config as { rootPath?: string }).rootPath },
      {
        appKey: creds[STORED_DROPBOX_CREDENTIAL_NAMES.appKey],
        appSecret: creds[STORED_DROPBOX_CREDENTIAL_NAMES.appSecret],
        refreshToken: creds[STORED_DROPBOX_CREDENTIAL_NAMES.refreshToken],
      },
      STORED_DROPBOX_CREDENTIAL_NAMES,
    );
    if (!(source instanceof DropboxFileSource)) {
      throw new Error('the Dropbox builder did not answer a Dropbox source');
    }
    const { folders, truncated } = await source.listTopLevelFolders();
    file = {
      answer: 'yes',
      detail: `${truncated ? 'At least ' : ''}${counted(folders.length, 'folder')} at the top level.`,
      count: folders.length,
      unit: 'folder',
    };
    try {
      const usage = await source.spaceUsage();
      file = { ...file, volume: { bytes: usage.bytes } };
    } catch (err) {
      // The face answered; the measure did not. Data, so a screen can say
      // so beside the line (the second-measured-Test lesson of 2026-09-02).
      file = {
        ...file,
        volume: { failed: `space usage: ${err instanceof Error ? err.message : String(err)}` },
      };
    }
  } catch (err) {
    // A refusal is NOT a no (the same rule as every other face).
    file = {
      answer: 'unknown',
      detail: `Unmeasured — the probe was refused: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  return {
    domains: {
      mail: notAFace('mail'),
      calendar: notAFace('a calendar'),
      contact: notAFace('an address book'),
      task: notAFace('a task list'),
      file,
    },
  };
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
  return { domains: { mail, calendar, contact, file, task: GOOGLE_NO_TASKS } };
}
