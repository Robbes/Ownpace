// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHAT GOOGLE ANSWERS TO `sync-collection`: a measurement, read-only, run once
 * at the machine (workplan 0164 T1).
 *
 * ## The question
 *
 * A Google calendar read over CalDAV reports no removal today. Google answers
 * an RFC 6578 `sync-collection` REPORT with a 207 that carries no calendar
 * data, so the CalDAV source lists the calendar whole with `calendar-query`
 * instead and returns `removed: []` (`caldav-source.ts`, "WHEN
 * `sync-collection` DOES NOT ANSWER"). An event deleted at Google therefore
 * never reaches *Deleted on the old system*. Workplan 0164 names two readers
 * that could report one: A reads `sync-collection` as RFC 6578 describes it,
 * which works only if Google lists a removed event as a member with a 404;
 * B is Google's Calendar API. This asks Google the question that decides
 * between them, on a real account, and says which.
 *
 * ## What it does
 *
 * 1. Chooses the migration itself, so nobody types an id: the newest one whose
 *    calendars come from Google over CalDAV, in an open organisation, with its
 *    grant in place, carrying calendars. It prints that migration's id and
 *    creation date, nothing else about it.
 * 2. For every event calendar of the account, one `sync-collection` with no
 *    sync token, and its counts: the status, the members by status, whether a
 *    sync token came back, whether any member carried calendar data.
 * 3. Asks the owner, in English and Dutch, to change one event and delete
 *    another at Google, and waits for Enter.
 * 4. One `sync-collection` per calendar with the token from step 2: changed
 *    members (200), removed ones (404), the others, the status, and whether a
 *    new token came back.
 * 5. The verdict, the plan's rule: a removed member listed as 404 makes A the
 *    reader, none makes B.
 *
 * ## Its four limits, and what holds each
 *
 * - **Read-only at Google.** Every request to a calendar goes through
 *   `readOnlyGoogleCalDav`, which refuses before sending anything but PROPFIND
 *   and REPORT, or anything to a host but Google's CalDAV, and follows a
 *   redirect only by asking itself again. The one other request is the
 *   sign-in: a POST to Google's token endpoint that mints an access token, as
 *   every pass does. The token is kept in memory for the run and written
 *   nowhere.
 * - **Nothing of Ownpace's changes.** The database is read in one transaction
 *   opened `READ ONLY` and rolled back, before Google is asked anything, so
 *   Postgres itself refuses a write; the statements are three SELECTs.
 * - **Counts and status codes only.** Every line goes through `countsOnly`,
 *   which lets through this file's own fixed sentences and lines whose only
 *   variable parts are numbers, status codes, yes and no, the migration's id
 *   and its creation date. Nothing read from Google is ever handed to a line:
 *   the renderers take counts. An error is said in a fixed sentence, with a
 *   status code where there is one, never in its own words, which may carry
 *   an href or a body.
 * - **Tokens in memory only**, between the two readings, in this run's own
 *   variables.
 *
 * ## The request, and how it differs from the source's
 *
 * The REPORT asks what the CalDAV source asks (`resourcetype`, `getetag`,
 * `calendar-data`), with `sync-level` 1 added, which RFC 6578 makes part of
 * every `sync-collection` and the source leaves out. A reader A would send
 * it. Should Google refuse it with 400, the same REPORT goes once more without
 * it, as the source sends it, and the line says so. A truncated answer (a 507
 * for the collection, RFC 6578 §3.6) is followed with the token it carries,
 * so the counts are the whole calendar's and the token is the one after it.
 *
 * Managed only: the appliance never imports this, and nothing here is in
 * `packages/`.
 */

import { createInterface, type Interface } from 'node:readline';
import type { Pool } from 'pg';
import { CalDAVSource, GoogleJwtBearerProvider, GoogleTokenProvider, type TokenFetch } from '@openmig/connectors';
import { SecretStore } from '@openmig/core/secret-store';
import { AN_OPEN_ORGANISATION_WHERE } from '@openmig/ledger';
import { sourceCredentialsFor } from '@openmig/orchestration/build-deps-from-mapping';
import { GOOGLE_CALDAV_SCOPE, googleCalDavPrincipalUrl } from '@openmig/orchestration/google-dav-source-factory';
import { STORED_GOOGLE_DWD_KEY_NAME } from '@openmig/orchestration/google-dwd';
import { connectionKindsWithFace } from '@openmig/orchestration/source-face-builders';
import { collectionCarries, elementsIn, namesElement, withoutElements, type ProviderClientEnv, type TokenProvider } from '@openmig/shared';

// ---------------------------------------------------------------------------
// The method guard: what may go to Google's calendars at all
// ---------------------------------------------------------------------------

/** The only methods this sends to Google's calendars. Both read; neither can change a thing. */
export const READ_ONLY_METHODS: ReadonlySet<string> = new Set(['PROPFIND', 'REPORT']);

/** The only place they go: the host the product's own Google principal URL names. */
export const GOOGLE_CALDAV_ORIGIN = new URL(googleCalDavPrincipalUrl('origin')).origin;

/** Node's `fetch`, narrowed to what this file uses, so a test can be a literal. */
export type FetchLike = (
  url: string,
  init: {
    readonly method: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly body?: string;
    readonly redirect?: 'manual';
  },
) => Promise<{
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

/** One request to Google's CalDAV. */
export interface CalDavRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
}

/** Its answer: the status, and a body that is read and never printed. */
export interface CalDavAnswer {
  readonly status: number;
  readonly body: string;
}

/** A request the guard would not send. Its message names neither the URL nor the method sent. */
export class RefusedRequest extends Error {
  readonly why: 'method' | 'host' | 'redirects';
  constructor(why: 'method' | 'host' | 'redirects') {
    super(`refused before sending: ${why}`);
    this.name = 'RefusedRequest';
    this.why = why;
  }
}

/** The redirects followed, by asking the guard again for the new address. */
const REDIRECTS: ReadonlySet<number> = new Set([301, 302, 307, 308]);
const MOST_REDIRECTS = 3;

function refuseUnlessReadOnly(method: string, url: string): void {
  if (!READ_ONLY_METHODS.has(method)) throw new RefusedRequest('method');
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    throw new RefusedRequest('host');
  }
  if (origin !== GOOGLE_CALDAV_ORIGIN) throw new RefusedRequest('host');
}

/**
 * The only way this file reaches a calendar: PROPFIND and REPORT, to Google's
 * CalDAV, and nothing else, refused BEFORE `fetchImpl` is called. A redirect
 * is not left to `fetch`, which would follow it anywhere: it is followed here,
 * through the same check, at most three times.
 */
export function readOnlyGoogleCalDav(fetchImpl: FetchLike): (request: CalDavRequest) => Promise<CalDavAnswer> {
  return async (request) => {
    let url = request.url;
    for (let hop = 0; ; hop += 1) {
      refuseUnlessReadOnly(request.method, url);
      const answer = await fetchImpl(url, {
        method: request.method,
        headers: request.headers,
        ...(request.body !== undefined ? { body: request.body } : {}),
        redirect: 'manual',
      });
      const body = await answer.text();
      const location = answer.headers.get('location');
      if (!REDIRECTS.has(answer.status) || !location) return { status: answer.status, body };
      if (hop >= MOST_REDIRECTS) throw new RefusedRequest('redirects');
      url = new URL(location, url).toString();
    }
  };
}

// ---------------------------------------------------------------------------
// The output guard: what may be printed at all
// ---------------------------------------------------------------------------

/** Every fixed sentence this command prints. Nothing in them comes from Google or the database. */
export const SAID = {
  header:
    "measure-google-sync (workplan 0164 T1). Read-only: it asks Google's calendars with PROPFIND and REPORT " +
    'only, signs in as every pass does, writes nothing, and prints counts and status codes only.',
  firstReading: 'First reading: one sync-collection per calendar, with no sync token.',
  promptEn:
    'EN: Now, in Google Calendar, in the account this migration copies from: change one event (its time, ' +
    'for example) and delete one other event. Use two events made for a test, that were there before this ' +
    'started. Then come back here and press Enter.',
  promptNl:
    'NL: Ga nu naar Google Agenda, in het account waaruit deze migratie kopieert: wijzig één afspraak ' +
    '(bijvoorbeeld de tijd) en verwijder één andere afspraak. Neem twee afspraken die voor een test zijn ' +
    'gemaakt en die er al waren voordat dit begon. Kom daarna hier terug en druk op Enter.',
  secondReading: 'Second reading: one sync-collection per calendar, with the token from the first.',
  verdictB: 'Verdict: B is the reader. Google listed no removed event as 404 (workplan 0164 §3.2).',
  noChangeEither:
    'Google listed no change either, not even the event you changed. If you changed one event and deleted ' +
    'another before pressing Enter, sync-collection lists nothing at Google; if you did not, run this again.',
  nothingToReadAgain:
    'Verdict: none. No calendar gave a complete first reading with a sync token, so there is nothing to ' +
    'read again, and nothing at Google needs changing.',
  verdictNone: 'Verdict: none. No calendar answered the second reading with 207, so nothing was measured.',
  notATerminal:
    'Refused: this waits for you to press Enter, and its input is not a terminal. Run it in a terminal.',
  rowSecurity:
    'Refused: this database connection is bound by row security, so it cannot look across organisations. ' +
    "Run it with ./deploy/compose/operator.sh measure-google-sync, which connects as the stack's owner.",
  noMigration:
    'Refused: no migration here reads its calendars from Google over CalDAV, in an open organisation and ' +
    'with its grant in place, so there is nothing to measure.',
  noKey:
    "Refused: SECRET_ENCRYPTION_KEY is not set, so the migration's Google sign-in cannot be read. Run it " +
    "with ./deploy/compose/operator.sh measure-google-sync, which loads the stack's .env.",
  cannotDecrypt: "Refused: the migration's stored Google sign-in could not be decrypted with this stack's key.",
  noCredentials: "Refused: the migration's source holds no credentials, so Google cannot be asked.",
  incompleteSignIn:
    "Refused: the migration's Google sign-in is incomplete (its client id, client secret or refresh token " +
    'is missing), so Google cannot be asked.',
  badServiceKey: "Refused: the migration's Google service-account key could not be read, so Google cannot be asked.",
  noAddress: "Refused: the migration's Google account names no address, so there is no calendar principal to ask.",
  signInNoAnswer: "Stopped: Google's sign-in did not answer, so nothing more was read.",
  homeNoAnswer: 'Stopped: Google did not answer the PROPFIND for the calendar home; no calendar was read.',
  listNoAnswer: 'Stopped: Google did not answer the PROPFIND that lists the calendars; no calendar was read.',
  noHome: 'Stopped: Google named no calendar home for this account; no calendar was read.',
  noCalendars: 'Stopped: Google listed no event calendar in this account, so there is nothing to measure.',
  methodRefused:
    'Stopped: a request other than PROPFIND or REPORT was about to go to Google. It was not sent, and the ' +
    'run ends here.',
  hostRefused:
    "Stopped: a request to a host other than Google's CalDAV was about to be sent. It was not sent, and the " +
    'run ends here.',
  redirectsRefused: 'Stopped: Google redirected one request more than three times, so the run ends here.',
  databaseFailed: 'Stopped: the database could not be read, so nothing was measured.',
  inputClosed: 'Stopped: the input closed before Enter was pressed, so the second reading was not made.',
  outputRefused:
    'Stopped: a line that was not a count was about to be printed. Nothing more is printed, and the run ends ' +
    'here.',
  unprinted:
    'Stopped: the run ended on an error this command does not print, because its words may carry what this ' +
    'command never prints.',
} as const;

/**
 * Every line with a variable part, by shape. The only variable parts any of
 * them admits are digits, a status code, yes or no, a UUID and a date.
 */
const COUNT = String.raw`\d+`;
const CODE = String.raw`\d{3}`;
const YES_NO = '(?:yes|no)';
const ONE_CODE = String.raw`(?:\d{3}(?: in propstat)?|no status): \d+`;
const CODES = `${ONE_CODE}(?:, ${ONE_CODE})*`;
const OTHER = String.raw`other: \d+(?: \(${CODES}\))?`;
const PAGES = String.raw`(?:, pages \d+)?(?:, still truncated)?`;
const STATUS = String.raw`status \d{3}(?: without sync-level \(400 with it\))?`;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const SHAPES: readonly RegExp[] = [
  `Migration ${UUID}, created \\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2} UTC, (?:the only one|the newest of ${COUNT}) whose calendars come from Google over CalDAV\\.`,
  `Calendars in this account: ${COUNT}\\.`,
  `Calendar ${COUNT}: ${STATUS}${PAGES}; members 200: ${COUNT}, 404: ${COUNT}, ${OTHER}; sync token: ${YES_NO}; calendar data: ${YES_NO}\\.`,
  `Calendar ${COUNT}: status ${CODE}${PAGES}; changed \\(200\\): ${COUNT}, removed \\(404\\): ${COUNT}, ${OTHER}; new sync token: ${YES_NO}\\.`,
  `Calendar ${COUNT}: no answer, the request failed before Google answered\\.`,
  `Calendar ${COUNT}: not read again, the first reading (?:had no answer|answered ${CODE}|was not complete|gave no sync token)\\.`,
  `Verdict: A is the reader\\. Google listed ${COUNT} removed events? as 404, and ${COUNT} changed (?:one|ones) as 200 \\(workplan 0164 §3\\.1\\)\\.`,
  `The change was listed \\(${COUNT} changed\\), so the second reading did answer\\.`,
  `Google also listed ${COUNT} members? with another status \\(${CODES}\\): read (?:it|them) before deciding\\.`,
  `Stopped: Google's sign-in answered ${CODE}, so nothing more was read\\.`,
  `Stopped: Google answered ${CODE} to the PROPFIND (?:for the calendar home|that lists the calendars); no calendar was read\\.`,
  `Stopped: the database answered SQLSTATE [0-9A-Z]{5}, so nothing was measured\\.`,
].map((shape) => new RegExp(`^${shape}$`));

const FIXED_LINES: ReadonlySet<string> = new Set<string>(Object.values(SAID));

/** A line `countsOnly` would not let through. */
export class OutputRefused extends Error {
  constructor() {
    super('a line that is not a count');
    this.name = 'OutputRefused';
  }
}

/**
 * THE OUTPUT GUARD. A line passes when it is empty, one of `SAID`'s fixed
 * sentences, or one of `SHAPES`; anything else, an href, an address, a title,
 * a token, an ETag or a body included, is refused, and the run stops.
 */
export function countsOnly(line: string): string {
  if (line === '' || FIXED_LINES.has(line) || SHAPES.some((shape) => shape.test(line))) return line;
  throw new OutputRefused();
}

// ---------------------------------------------------------------------------
// Reading a multistatus: counts, never contents
// ---------------------------------------------------------------------------

/** A namespace prefix at the start of a tag, `C:`. */
const PREFIX = /^[A-Za-z][\w.-]*:/;

/** The elements of a piece of XML with one local name: every one's text, the first one's, or the XML without them. */
interface Elements {
  all(xml: string): string[];
  first(xml: string): string | undefined;
  outOf(xml: string): string;
}

/**
 * An element by its local name, with or without a namespace prefix, case
 * aside: as `<(?:p:)?name\b[^>]*>([\s\S]*?)</(?:p:)?name\s*>` with the `i` flag
 * read it, but a tag at a time, in time linear in the answer's length
 * (`elementsIn`, workplan 0163), since that pattern was quadratic on an
 * answer that opens the element many times and never closes it.
 */
const element = (name: string): Elements => {
  const opens = (tag: string): boolean => namesElement(tag, name, PREFIX, (rest) => !/^\w/.test(rest), true);
  const closes = (tag: string): boolean =>
    tag.startsWith('/') && namesElement(tag.slice(1), name, PREFIX, (rest) => /^\s*$/.test(rest), true);
  return {
    all: (xml) => elementsIn(xml, opens, closes).map((found) => found.text),
    first: (xml) => elementsIn(xml, opens, closes, true)[0]?.text,
    outOf: (xml) => withoutElements(xml, opens, closes),
  };
};

const RESPONSES = element('response');
const PROPSTATS = element('propstat');
const STATUS_ELEMENT = element('status');
const SYNC_TOKEN = element('sync-token');
const CALENDAR_DATA = element('calendar-data');
const HREF = element('href');
const RESOURCETYPE = element('resourcetype');
/** `<C:calendar/>` in a resourcetype, the spelling the CalDAV source also takes (`calendar-collection`). */
const A_CALENDAR = /<(?:[A-Za-z][\w.-]*:)?calendar(?:-collection)?(?:\s[^<>]*)?\/?>/i;

/** The five predefined entities and character references: an href or a token is text inside XML. */
function decodeXml(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** The code of the first `<status>` in a piece of XML: `HTTP/1.1 404 Not Found` is 404. */
function statusCodeIn(xml: string): number | undefined {
  const text = STATUS_ELEMENT.first(xml);
  const code = text ? /^\s*HTTP\/\d(?:\.\d)?\s+(\d{3})\b/i.exec(text)?.[1] : undefined;
  return code === undefined ? undefined : Number(code);
}

/** Members of one answer, by what their status says. */
export interface MemberCounts {
  /** 200: a member that is there, changed or listed. */
  ok: number;
  /** 404 at the response's own level: a member that is gone (RFC 6578 §3.5). */
  gone: number;
  /** Everything else, by status: `403`, `410`, `404 in propstat`, `no status`. */
  readonly other: Map<string, number>;
}

/** What one multistatus said, as counts. The token is the one thing kept, for the next request. */
export interface MultistatusCounts {
  readonly members: MemberCounts;
  readonly token: string | undefined;
  readonly carriedData: boolean;
  /** A 507 for the collection: the server stopped early and the token carries on (RFC 6578 §3.6). */
  readonly truncated: boolean;
}

const emptyCounts = (): MemberCounts => ({ ok: 0, gone: 0, other: new Map() });

function bump(counts: Map<string, number>, key: string, by = 1): void {
  counts.set(key, (counts.get(key) ?? 0) + by);
}

/**
 * Count one `sync-collection` answer.
 *
 * A 404 means two things depending on where it sits, which is the subtlety
 * `dav-removals.ts` is written about and this reads the same way: directly
 * under `<response>` the member is gone; inside a `<propstat>` one property
 * has no value, which Google may well say of `calendar-data`. So a member's own
 * status is read with its propstats taken out first; without one, a propstat
 * that says 200 makes it a member that is there.
 */
export function countMultistatus(body: string): MultistatusCounts {
  const members = emptyCounts();
  let carriedData = false;
  let truncated = false;
  for (const response of RESPONSES.all(body)) {
    const own = statusCodeIn(PROPSTATS.outOf(response));
    if (own !== undefined) {
      if (own === 507) truncated = true;
      else if (own === 200) members.ok += 1;
      else if (own === 404) members.gone += 1;
      else bump(members.other, String(own));
      continue;
    }
    const propstats = PROPSTATS.all(response);
    const found = propstats.filter((p) => statusCodeIn(p) === 200);
    if (found.length > 0) {
      members.ok += 1;
      if (found.some((p) => (CALENDAR_DATA.first(p) ?? '').trim() !== '')) carriedData = true;
      continue;
    }
    const first = propstats.map(statusCodeIn).find((code) => code !== undefined);
    bump(members.other, first === undefined ? 'no status' : `${first} in propstat`);
  }
  // The multistatus's own token, outside every response.
  const raw = SYNC_TOKEN.first(RESPONSES.outOf(body));
  const token = raw === undefined ? '' : decodeXml(raw).trim();
  return { members, token: token === '' ? undefined : token, carriedData, truncated };
}

/** The href a property names, when a propstat that says 200 carries it. */
function hrefOfProperty(body: string, property: string): string | undefined {
  for (const propstat of PROPSTATS.all(body)) {
    if (statusCodeIn(propstat) !== 200) continue;
    const value = element(property).first(propstat);
    const href = value === undefined ? undefined : HREF.first(value);
    if (href !== undefined && href.trim() !== '') return decodeXml(href).trim();
  }
  return undefined;
}

/**
 * The event calendars a home-set listing names, as addresses: a calendar
 * resource type, and a component set that carries VEVENT or says nothing,
 * which is the CalDAV source's own rule (`parseComponentSet`,
 * `collectionCarries`). Each address once, in the order Google gave them.
 */
export function calendarsIn(body: string, homeUrl: string): string[] {
  const found: string[] = [];
  for (const response of RESPONSES.all(body)) {
    const href = HREF.first(response);
    if (href === undefined || href.trim() === '') continue;
    if (!A_CALENDAR.test(RESOURCETYPE.first(response) ?? '')) continue;
    if (!collectionCarries(CalDAVSource.parseComponentSet(response), 'VEVENT')) continue;
    const url = new URL(decodeXml(href).trim(), homeUrl).toString();
    if (url !== homeUrl && !found.includes(url)) found.push(url);
  }
  return found;
}

// ---------------------------------------------------------------------------
// Asking Google
// ---------------------------------------------------------------------------

const XML = 'application/xml; charset=utf-8';

const HOME_SET_PROPFIND = `<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop>
    <D:current-user-principal/>
    <C:calendar-home-set/>
  </D:prop>
</D:propfind>`;

/** No display name is asked for: nothing here needs a calendar's name. */
const CALENDARS_PROPFIND = `<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop>
    <D:resourcetype/>
    <C:supported-calendar-component-set/>
  </D:prop>
</D:propfind>`;

/** The CalDAV source's REPORT, with `sync-level` 1, unless Google refused it with that. */
export function syncCollectionBody(token: string | undefined, withLevel: boolean): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<D:sync-collection xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  ${token === undefined ? '<D:sync-token/>' : `<D:sync-token>${escapeXml(token)}</D:sync-token>`}
  ${withLevel ? '<D:sync-level>1</D:sync-level>\n  ' : ''}<D:prop>
    <D:resourcetype/>
    <D:getetag/>
    <C:calendar-data/>
  </D:prop>
</D:sync-collection>`;
}

/** A stop said in one of `SAID`'s sentences or one of `SHAPES`, never in an error's own words. */
class Stop extends Error {
  readonly line: string;
  constructor(line: string) {
    super('stopped');
    this.name = 'Stop';
    this.line = line;
  }
}

/** A request that never got an answer: the network, a timeout. */
class NoAnswer extends Error {
  constructor() {
    super('no answer');
    this.name = 'NoAnswer';
  }
}

interface SignedIn {
  send(method: 'PROPFIND' | 'REPORT', url: string, headers: Record<string, string>, body: string): Promise<CalDavAnswer>;
}

/**
 * Every CalDAV request, signed in. A sign-in that fails stops the run, with
 * the token endpoint's status and not its words; a request that gets no answer
 * is `NoAnswer`; the guard's own refusal passes through and stops everything.
 */
function signedIn(
  tokens: TokenProvider,
  signInStatus: () => number | undefined,
  transport: (request: CalDavRequest) => Promise<CalDavAnswer>,
): SignedIn {
  return {
    async send(method, url, headers, body) {
      let accessToken: string;
      try {
        accessToken = (await tokens.getToken()).accessToken;
      } catch {
        const status = signInStatus();
        throw new Stop(
          status === undefined ? SAID.signInNoAnswer : `Stopped: Google's sign-in answered ${status}, so nothing more was read.`,
        );
      }
      try {
        return await transport({ method, url, headers: { ...headers, Authorization: `Bearer ${accessToken}` }, body });
      } catch (err) {
        if (err instanceof RefusedRequest) throw err;
        throw new NoAnswer();
      }
    },
  };
}

/** The account's event calendars: the principal's calendar home, then what it lists. */
async function eventCalendars(google: SignedIn, principalUrl: string): Promise<string[]> {
  const propfind = async (url: string, depth: '0' | '1', body: string, noAnswer: string): Promise<CalDavAnswer> => {
    try {
      return await google.send('PROPFIND', url, { 'Content-Type': XML, Depth: depth }, body);
    } catch (err) {
      if (err instanceof NoAnswer) throw new Stop(noAnswer);
      throw err;
    }
  };
  const homeStatus = (status: number): Stop =>
    new Stop(`Stopped: Google answered ${status} to the PROPFIND for the calendar home; no calendar was read.`);

  const principal = await propfind(principalUrl, '0', HOME_SET_PROPFIND, SAID.homeNoAnswer);
  if (principal.status !== 207) throw homeStatus(principal.status);
  let base = principalUrl;
  let home = hrefOfProperty(principal.body, 'calendar-home-set');
  if (home === undefined) {
    // The CalDAV source's second way in: the current user's principal, asked for its home.
    const me = hrefOfProperty(principal.body, 'current-user-principal');
    if (me !== undefined) {
      base = new URL(me, principalUrl).toString();
      const mine = await propfind(base, '0', HOME_SET_PROPFIND, SAID.homeNoAnswer);
      if (mine.status !== 207) throw homeStatus(mine.status);
      home = hrefOfProperty(mine.body, 'calendar-home-set');
    }
  }
  if (home === undefined) throw new Stop(SAID.noHome);

  const homeUrl = new URL(home, base).toString();
  const listing = await propfind(homeUrl, '1', CALENDARS_PROPFIND, SAID.listNoAnswer);
  if (listing.status !== 207) {
    throw new Stop(`Stopped: Google answered ${listing.status} to the PROPFIND that lists the calendars; no calendar was read.`);
  }
  return calendarsIn(listing.body, homeUrl);
}

/** One reading of one calendar, as counts. */
export interface Reading {
  readonly answered: boolean;
  /** The last page's status: 207 unless a page answered otherwise. */
  readonly status: number;
  readonly pages: number;
  readonly counts: MemberCounts;
  readonly tokenCame: boolean;
  readonly carriedData: boolean;
  /** No 507 left: the whole calendar was listed. */
  readonly complete: boolean;
  /** Google refused `sync-level` with 400 and answered without it. */
  readonly withoutLevel: boolean;
}

/** Pages followed after a 507, at most. A calendar of 6,000 events in pages of 500 is 13. */
const MOST_PAGES = 40;

/**
 * One `sync-collection`, followed through any truncation, counted.
 *
 * `token` is the previous reading's, or none for the first; `level` whether
 * to send `sync-level`. The token this answers with is returned beside the
 * counts, never inside them, so nothing that renders a line can reach it.
 */
async function readCalendar(
  google: SignedIn,
  url: string,
  start: { readonly token: string | undefined; readonly level: boolean; readonly mayDropLevel: boolean },
): Promise<{ readonly reading: Reading; readonly token: string | undefined; readonly level: boolean }> {
  const counts = emptyCounts();
  let level = start.level;
  let withoutLevel = false;
  let next = start.token;
  let token: string | undefined;
  let tokenCame = false;
  let carriedData = false;
  let complete = false;
  let status = 0;
  let pages = 0;
  try {
    while (pages < MOST_PAGES) {
      let answer = await google.send('REPORT', url, { 'Content-Type': XML }, syncCollectionBody(next, level));
      if (answer.status === 400 && level && start.mayDropLevel && pages === 0) {
        const without = await google.send('REPORT', url, { 'Content-Type': XML }, syncCollectionBody(next, false));
        if (without.status === 207) {
          answer = without;
          level = false;
          withoutLevel = true;
        }
      }
      pages += 1;
      status = answer.status;
      if (answer.status !== 207) break;
      const page = countMultistatus(answer.body);
      counts.ok += page.members.ok;
      counts.gone += page.members.gone;
      for (const [code, n] of page.members.other) bump(counts.other, code, n);
      carriedData ||= page.carriedData;
      token = page.token;
      tokenCame = page.token !== undefined;
      if (!page.truncated) {
        complete = true;
        break;
      }
      if (page.token === undefined) break;
      next = page.token;
    }
  } catch (err) {
    if (!(err instanceof NoAnswer)) throw err;
    const none: Reading = {
      answered: false,
      status: 0,
      pages,
      counts,
      tokenCame: false,
      carriedData: false,
      complete: false,
      withoutLevel,
    };
    return { reading: none, token: undefined, level };
  }
  return {
    reading: { answered: true, status, pages, counts, tokenCame, carriedData, complete, withoutLevel },
    token,
    level,
  };
}

// ---------------------------------------------------------------------------
// The lines, from counts alone
// ---------------------------------------------------------------------------

const yesNo = (value: boolean): string => (value ? 'yes' : 'no');
const total = (counts: ReadonlyMap<string, number>): number => [...counts.values()].reduce((a, b) => a + b, 0);

function otherCodes(other: ReadonlyMap<string, number>): string {
  return [...other]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, n]) => `${code}: ${n}`)
    .join(', ');
}

function otherPart(other: ReadonlyMap<string, number>): string {
  const n = total(other);
  return n === 0 ? 'other: 0' : `other: ${n} (${otherCodes(other)})`;
}

function pagesPart(r: Reading): string {
  return `${r.pages > 1 ? `, pages ${r.pages}` : ''}${r.status === 207 && !r.complete ? ', still truncated' : ''}`;
}

export function firstReadingLine(n: number, r: Reading): string {
  if (!r.answered) return `Calendar ${n}: no answer, the request failed before Google answered.`;
  const status = r.withoutLevel ? `status ${r.status} without sync-level (400 with it)` : `status ${r.status}`;
  return (
    `Calendar ${n}: ${status}${pagesPart(r)}; members 200: ${r.counts.ok}, 404: ${r.counts.gone}, ` +
    `${otherPart(r.counts.other)}; sync token: ${yesNo(r.tokenCame)}; calendar data: ${yesNo(r.carriedData)}.`
  );
}

export function secondReadingLine(n: number, r: Reading): string {
  if (!r.answered) return `Calendar ${n}: no answer, the request failed before Google answered.`;
  return (
    `Calendar ${n}: status ${r.status}${pagesPart(r)}; changed (200): ${r.counts.ok}, removed (404): ` +
    `${r.counts.gone}, ${otherPart(r.counts.other)}; new sync token: ${yesNo(r.tokenCame)}.`
  );
}

/** Whether a first reading can be read again with its token. */
function readsAgain(r: Reading): boolean {
  return r.answered && r.status === 207 && r.complete && r.tokenCame;
}

function notAgainLine(n: number, r: Reading): string {
  const why = !r.answered
    ? 'had no answer'
    : r.status !== 207
      ? `answered ${r.status}`
      : !r.complete
        ? 'was not complete'
        : 'gave no sync token';
  return `Calendar ${n}: not read again, the first reading ${why}.`;
}

/** The verdict: the plan's rule, with the change as the control and any other status named. */
export function verdictLines(second: readonly Reading[]): string[] {
  const measured = second.filter((r) => r.answered && r.status === 207);
  if (measured.length === 0) return [SAID.verdictNone];
  const removed = measured.reduce((n, r) => n + r.counts.gone, 0);
  const changed = measured.reduce((n, r) => n + r.counts.ok, 0);
  const other = new Map<string, number>();
  for (const r of measured) for (const [code, n] of r.counts.other) bump(other, code, n);
  const lines: string[] = [];
  if (removed > 0) {
    lines.push(
      `Verdict: A is the reader. Google listed ${removed} removed ${removed === 1 ? 'event' : 'events'} as 404, ` +
        `and ${changed} changed ${changed === 1 ? 'one' : 'ones'} as 200 (workplan 0164 §3.1).`,
    );
  } else {
    lines.push(SAID.verdictB);
    lines.push(changed > 0 ? `The change was listed (${changed} changed), so the second reading did answer.` : SAID.noChangeEither);
  }
  const others = total(other);
  if (others > 0) {
    lines.push(
      `Google also listed ${others} ${others === 1 ? 'member' : 'members'} with another status ` +
        `(${otherCodes(other)}): read ${others === 1 ? 'it' : 'them'} before deciding.`,
    );
  }
  return lines;
}

// ---------------------------------------------------------------------------
// The migration, chosen by the database and read only
// ---------------------------------------------------------------------------

/** One statement's answer, as node-postgres gives it. */
export interface ReadOnlyClient {
  query(text: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
  release(): void;
}

export interface ReadOnlyPool {
  connect(): Promise<ReadOnlyClient>;
}

/** Whether this connection sees every organisation: the question `task-pools.ts` asks. */
export const SEES_EVERY_ORGANISATION_SQL =
  'SELECT rolsuper OR rolbypassrls AS sees_every_organisation FROM pg_roles WHERE rolname = current_user';

/**
 * The newest migration whose calendars come from Google over CalDAV: the
 * kinds whose calendar face the `google-dav` builder speaks for
 * (`connectionKindsWithFace`), reached through the migration's own source
 * mailbox, carrying calendars, in an open organisation, its grant not taken
 * back, which is everything the product's own builders would read. Newest by
 * creation, the id breaking a tie, so the same database always gives the same
 * answer, with how many there were.
 */
export const GOOGLE_CALENDAR_MIGRATION_SQL = `SELECT m.id, m.created_at, m.source_secret_ref, m.source_config_override,
       c.kind, c.config, c.secret_ref, count(*) OVER () AS candidates
  FROM mailbox_mapping m
  JOIN mailbox b ON b.id = m.source_mailbox_id AND b.tenant_id = m.tenant_id
  JOIN connection c ON c.id = b.connection_id AND c.tenant_id = m.tenant_id
 WHERE c.kind = ANY($1::text[])
   AND m.grant_withdrawn_at IS NULL
   AND ${AN_OPEN_ORGANISATION_WHERE}
   AND EXISTS (SELECT 1 FROM scope_selection s
                WHERE s.tenant_id = m.tenant_id AND s.mapping_id = m.id
                  AND s.domain = 'calendar' AND s.included)
 ORDER BY m.created_at DESC, m.id DESC
 LIMIT 1`;

/** The kinds that statement asks for. */
export const GOOGLE_CALENDAR_KINDS: readonly string[] = connectionKindsWithFace('calendar', 'google-dav');

interface Chosen {
  readonly id: string;
  readonly createdAt: Date;
  readonly candidates: number;
  readonly kind: string;
  readonly config: Record<string, unknown>;
  readonly secretRef: string | null;
  readonly sourceSecretRef: string | null;
}

/**
 * Three SELECTs in one transaction opened READ ONLY and rolled back, so a
 * write is refused by Postgres whatever asks for one. Released before Google
 * is asked anything, so no connection waits on the owner's Enter.
 */
async function chooseMigration(pool: ReadOnlyPool): Promise<Chosen | undefined> {
  let client: ReadOnlyClient;
  try {
    client = await pool.connect();
  } catch (err) {
    throw databaseStop(err);
  }
  try {
    await client.query('BEGIN READ ONLY');
    const role = await client.query(SEES_EVERY_ORGANISATION_SQL);
    if (role.rows[0]?.sees_every_organisation !== true) throw new Stop(SAID.rowSecurity);
    const { rows } = await client.query(GOOGLE_CALENDAR_MIGRATION_SQL, [[...GOOGLE_CALENDAR_KINDS]]);
    const row = rows[0];
    if (row === undefined) return undefined;
    return {
      id: String(row.id),
      createdAt: row.created_at instanceof Date ? row.created_at : new Date(String(row.created_at)),
      candidates: Number(row.candidates),
      kind: String(row.kind),
      config: {
        ...((row.config ?? {}) as Record<string, unknown>),
        ...((row.source_config_override ?? {}) as Record<string, unknown>),
      },
      secretRef: typeof row.secret_ref === 'string' && row.secret_ref !== '' ? row.secret_ref : null,
      sourceSecretRef:
        typeof row.source_secret_ref === 'string' && row.source_secret_ref !== '' ? row.source_secret_ref : null,
    };
  } catch (err) {
    throw err instanceof Stop ? err : databaseStop(err);
  } finally {
    try {
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  }
}

/** A database failure, said with its SQLSTATE where Postgres gave one, never its message. */
function databaseStop(err: unknown): Stop {
  const code = (err as { code?: unknown } | null)?.code;
  return new Stop(
    typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)
      ? `Stopped: the database answered SQLSTATE ${code}, so nothing was measured.`
      : SAID.databaseFailed,
  );
}

function migrationLine(chosen: Chosen): string {
  const when = chosen.createdAt.toISOString().slice(0, 16).replace('T', ' ');
  const which = chosen.candidates <= 1 ? 'the only one' : `the newest of ${chosen.candidates}`;
  return `Migration ${chosen.id}, created ${when} UTC, ${which} whose calendars come from Google over CalDAV.`;
}

/**
 * The migration's Google sign-in, completed the way every pass completes it:
 * the connection's secret, or its typed credentials, or none when only the
 * migrator's grant holds one; then `sourceCredentialsFor`, which adds the
 * deployment's client and the grant (`loadDomainConnections`). A
 * service-account key selects domain-wide delegation, as `google-dwd.ts`
 * decides; otherwise the refresh token. Built here rather than through
 * `buildGoogleCalendarDavSourceFrom` so the token endpoint's status can be
 * read, and the CalDAV client is this file's guarded one.
 */
function signInFor(
  chosen: Chosen,
  env: ProviderClientEnv,
  tokenFetch: TokenFetch,
): { readonly principalUrl: string; readonly tokens: TokenProvider } {
  // `SecretStore` reads the key from the process's own environment, so that is where to look.
  const needsTheKey = chosen.secretRef !== null || chosen.sourceSecretRef !== null;
  if (needsTheKey && !process.env.SECRET_ENCRYPTION_KEY) throw new Stop(SAID.noKey);
  let stored: Record<string, string>;
  if (chosen.secretRef !== null) {
    try {
      stored = SecretStore.decryptCredentials(chosen.secretRef);
    } catch {
      throw new Stop(SAID.cannotDecrypt);
    }
  } else if (chosen.config.credentials && typeof chosen.config.credentials === 'object') {
    stored = chosen.config.credentials as Record<string, string>;
  } else if (chosen.sourceSecretRef !== null) {
    stored = {};
  } else {
    throw new Stop(SAID.noCredentials);
  }
  let creds: Record<string, string>;
  try {
    creds = sourceCredentialsFor(chosen.kind, 'source', stored, chosen.sourceSecretRef, env);
  } catch {
    throw new Stop(SAID.cannotDecrypt);
  }
  const user = String(chosen.config.user ?? '').trim();
  if (user === '') throw new Stop(SAID.noAddress);
  const principalUrl = googleCalDavPrincipalUrl(user);
  const serviceAccountKey = creds[STORED_GOOGLE_DWD_KEY_NAME];
  if (serviceAccountKey) {
    try {
      return {
        principalUrl,
        tokens: new GoogleJwtBearerProvider(serviceAccountKey, user, GOOGLE_CALDAV_SCOPE, { fetchImpl: tokenFetch }),
      };
    } catch {
      throw new Stop(SAID.badServiceKey);
    }
  }
  const { clientId, clientSecret, refreshToken } = creds;
  if (!clientId || !clientSecret || !refreshToken) throw new Stop(SAID.incompleteSignIn);
  return {
    principalUrl,
    tokens: new GoogleTokenProvider({ clientId, clientSecret, refreshToken }, { scope: GOOGLE_CALDAV_SCOPE, fetchImpl: tokenFetch }),
  };
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

export interface MeasureDeps {
  /** The owner's pool: SELECTs only, in a READ ONLY transaction. */
  readonly pool: ReadOnlyPool;
  /** Node's `fetch`: Google's CalDAV through the guard, and its token endpoint. */
  readonly fetch: FetchLike;
  /** Where every line goes. */
  readonly write: (text: string) => void;
  /** Resolves when the owner has pressed Enter. */
  readonly waitForEnter: () => Promise<void>;
  /** The deployment's Google client is read from here (`GOOGLE_OAUTH_CLIENT_ID`/`_SECRET`). */
  readonly env: ProviderClientEnv;
}

/** Run the measurement. Answers the exit code: 0 with a verdict, 1 without one. Never throws. */
export async function measureGoogleSync(deps: MeasureDeps): Promise<number> {
  const say = (line: string): void => deps.write(`${countsOnly(line)}\n`);
  try {
    say(SAID.header);
    const chosen = await chooseMigration(deps.pool);
    if (chosen === undefined) {
      say(SAID.noMigration);
      return 1;
    }
    say(migrationLine(chosen));

    let signInStatus: number | undefined;
    const tokenFetch: TokenFetch = async (url, init) => {
      const answer = await deps.fetch(url, { method: init.method, headers: { ...init.headers }, body: init.body });
      signInStatus = answer.status;
      return { ok: answer.status >= 200 && answer.status < 300, status: answer.status, text: () => answer.text() };
    };
    const { principalUrl, tokens } = signInFor(chosen, deps.env, tokenFetch);
    const google = signedIn(tokens, () => signInStatus, readOnlyGoogleCalDav(deps.fetch));

    const calendars = await eventCalendars(google, principalUrl);
    say(`Calendars in this account: ${calendars.length}.`);
    if (calendars.length === 0) {
      say(SAID.noCalendars);
      return 1;
    }

    say('');
    say(SAID.firstReading);
    // The tokens live here, in this run's own array, between the two readings
    // and nowhere else: no line is built from this array.
    const first: Array<{ readonly reading: Reading; readonly token: string | undefined; readonly level: boolean }> = [];
    for (const [i, url] of calendars.entries()) {
      const read = await readCalendar(google, url, { token: undefined, level: true, mayDropLevel: true });
      first.push(read);
      say(firstReadingLine(i + 1, read.reading));
    }
    if (!first.some((f) => readsAgain(f.reading))) {
      say('');
      say(SAID.nothingToReadAgain);
      return 1;
    }

    say('');
    say(SAID.promptEn);
    say(SAID.promptNl);
    await deps.waitForEnter();

    say('');
    say(SAID.secondReading);
    const second: Reading[] = [];
    for (const [i, url] of calendars.entries()) {
      const before = first[i]!;
      if (!readsAgain(before.reading)) {
        say(notAgainLine(i + 1, before.reading));
        continue;
      }
      const read = await readCalendar(google, url, { token: before.token, level: before.level, mayDropLevel: false });
      second.push(read.reading);
      say(secondReadingLine(i + 1, read.reading));
    }
    first.length = 0;

    say('');
    const verdict = verdictLines(second);
    for (const line of verdict) say(line);
    return verdict[0] === SAID.verdictNone ? 1 : 0;
  } catch (err) {
    deps.write(`${countsOnly(stopLine(err))}\n`);
    return 1;
  }
}

/** The one line an error is said in. */
function stopLine(err: unknown): string {
  if (err instanceof Stop) return err.line;
  if (err instanceof OutputRefused) return SAID.outputRefused;
  if (err instanceof RefusedRequest) {
    return err.why === 'method' ? SAID.methodRefused : err.why === 'host' ? SAID.hostRefused : SAID.redirectsRefused;
  }
  return SAID.unprinted;
}

// ---------------------------------------------------------------------------
// At the machine
// ---------------------------------------------------------------------------

/** How long one request may take before it counts as no answer: a whole calendar is one answer. */
const REQUEST_TIMEOUT_MS = 120_000;

/**
 * An Enter that arrives this soon after the prompt was typed before it: the
 * terminal keeps keystrokes until something reads them, and nobody changes and
 * deletes an event at Google in three seconds.
 */
const TYPED_AHEAD_MS = 3_000;

/** Node's own `fetch`, with a timeout: the one place this file reaches the network. */
const timedFetch: FetchLike = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });

/** The next line typed, or `false` when the input closed first. */
function nextLine(lines: Interface): Promise<boolean> {
  return new Promise((resolve) => {
    const onLine = (): void => {
      lines.off('close', onClose);
      resolve(true);
    };
    const onClose = (): void => {
      lines.off('line', onLine);
      resolve(false);
    };
    lines.once('line', onLine);
    lines.once('close', onClose);
  });
}

/**
 * Wait for Enter, read as a line from the terminal as the terminal itself
 * edits it (`terminal: false`), so Ctrl-C still ends the process as it does
 * everywhere else, and nothing typed is echoed by this code.
 */
async function waitForEnterAtTheTerminal(): Promise<void> {
  const shown = Date.now();
  const lines = createInterface({ input: process.stdin, terminal: false });
  try {
    for (;;) {
      if (!(await nextLine(lines))) throw new Stop(SAID.inputClosed);
      if (Date.now() - shown >= TYPED_AHEAD_MS) return;
    }
  } finally {
    lines.close();
  }
}

/**
 * The CLI's entry: the owner's pool, Node's `fetch`, the terminal. Refuses
 * before anything is read when its input is not a terminal, since the run
 * would otherwise wait for an Enter nobody can press.
 */
export async function measureGoogleSyncAtTheMachine(pool: Pool): Promise<number> {
  const write = (text: string): void => {
    process.stdout.write(text);
  };
  if (!process.stdin.isTTY) {
    write(`${countsOnly(SAID.notATerminal)}\n`);
    return 1;
  }
  return measureGoogleSync({
    pool,
    fetch: timedFetch,
    write,
    waitForEnter: waitForEnterAtTheTerminal,
    env: process.env,
  });
}
