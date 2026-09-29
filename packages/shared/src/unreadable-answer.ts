// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN ANSWER A PAGE COULD NOT READ, KEPT IN THE LOG (reported 2026-09-29; the
 * owner's "Log it" the same day; workplan 0145).
 *
 * When a page's schema refuses an answer, the page says so in the reader's
 * language and shows a reference (`serverMessage` in `apps/web`). It also tells
 * its server, once, and the server keeps the report the way it keeps its own
 * faults (`serverFault`, workplan 0129): an app event under that reference, on
 * the log page, metadata only, and one line in its output with the detail.
 * Quoting the reference finds both. Both editions answer it: the managed API at
 * `POST /api/unreadable-answers`, the appliance at `POST /unreadable-answers`.
 *
 * ## Nothing a person typed
 *
 * Anybody signed in can write this body, and its words end up in a log line.
 * So each field is read on its own, to a shape nothing personal fits, and a
 * field of any other shape is DROPPED, not refused, as the problem report's
 * browser facts are: what a page added wrongly is no reason to lose the report.
 * Only the reference is required, since without it nobody can find the report.
 *
 * - the issue's CODE, as zod names one (`invalid_value`);
 * - WHERE in the answer, as {@link issuePathForLog} writes it: positions and
 *   field names from code, and `*` for a key taken from data, since a record
 *   keyed by an address or a name would otherwise put that into the log;
 * - the PAGE, as {@link pageForLog} writes it: its words, and `:id` for
 *   anything else, since a link's page carries its token in its address;
 * - the PAGE'S BUILD, beside which the server writes its own. Two builds that
 *   differ are the likeliest cause: a partial deploy, or a tab left open
 *   across one.
 */

import { APP_EVENT_REFERENCE } from './app-event.ts';

/** The event's name on the log page. */
export const UNREADABLE_ANSWER_EVENT = 'web.answer_unreadable';

/** A field name from code: a letter or `_`, then letters, digits and `_`. */
const FIELD = /^[A-Za-z_][A-Za-z0-9_]{0,39}$/;
/** One step of a path as the log keeps it: a position, a field name, or `*`. */
const STEP = String.raw`(?:[0-9]{1,9}|[A-Za-z_][A-Za-z0-9_]{0,39}|\*)`;
/** The deepest path kept: twelve steps are deeper than any answer this API sends. */
const MAX_STEPS = 12;
const PATH = new RegExp(`^${STEP}(?:\\.${STEP}){0,${MAX_STEPS - 1}}$`);

/** A word of a page's address: lower case and `-`, as the web app's routes are. */
const WORD = /^[a-z][a-z-]{0,39}$/;
const MAX_SEGMENTS = 8;
const PAGE = new RegExp(
  String.raw`^\/(?:(?:[a-z][a-z-]{0,39}|:id)(?:\/(?:[a-z][a-z-]{0,39}|:id)){0,${MAX_SEGMENTS - 1}})?$`,
);

/** An issue code, as zod names one. */
const CODE = /^[a-z][a-z_]{0,39}$/;
const VERSION = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,39}$/;
const COMMIT = /^[0-9a-f]{7,40}$/;

/** Where in an answer an issue sits, as the log keeps it: `2.domains.2`, or `` for the whole answer. */
export function issuePathForLog(path: ReadonlyArray<PropertyKey>): string {
  return path
    .slice(0, MAX_STEPS)
    .map((key) =>
      typeof key === 'number' && Number.isInteger(key) && key >= 0 && key < 1e9
        ? String(key)
        : typeof key === 'string' && FIELD.test(key)
          ? key
          : '*',
    )
    .join('.');
}

/** A page's address as the log keeps it: `/people/:id` for `/people/0e32…`. */
export function pageForLog(pathname: string): string {
  const segments = pathname
    .split('/')
    .filter((s) => s !== '')
    .slice(0, MAX_SEGMENTS);
  return `/${segments.map((s) => (WORD.test(s) ? s : ':id')).join('/')}`;
}

/** A report, as the server keeps it: every field but the reference may be missing. */
export interface UnreadableAnswerReport {
  readonly reference: string;
  readonly code?: string;
  /** `` when the whole answer was refused. */
  readonly path?: string;
  readonly page?: string;
  readonly pageVersion?: string;
  readonly pageCommit?: string;
}

/** The body a page sends. */
export interface UnreadableAnswerBody {
  readonly reference: string;
  readonly code: string;
  readonly path: string;
  readonly page: string;
  readonly build: { readonly version: string; readonly commit: string };
}

const take = (value: unknown, shape: RegExp): string | undefined =>
  typeof value === 'string' && shape.test(value) ? value : undefined;

/**
 * The report in a body, each field kept only in its own shape; `undefined`
 * when there is no reference to keep it under, or no body at all.
 */
export function parseUnreadableAnswer(body: unknown): UnreadableAnswerReport | undefined {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return undefined;
  const b = body as Record<string, unknown>;
  const reference = take(b.reference, APP_EVENT_REFERENCE);
  if (!reference) return undefined;
  const code = take(b.code, CODE);
  const path = b.path === '' ? '' : take(b.path, PATH);
  const page = take(b.page, PAGE);
  const build = typeof b.build === 'object' && b.build !== null ? (b.build as Record<string, unknown>) : {};
  const pageVersion = take(build.version, VERSION);
  const pageCommit = take(build.commit, COMMIT);
  return {
    reference,
    ...(code !== undefined ? { code } : {}),
    ...(path !== undefined ? { path } : {}),
    ...(page !== undefined ? { page } : {}),
    ...(pageVersion !== undefined ? { pageVersion } : {}),
    ...(pageCommit !== undefined ? { pageCommit } : {}),
  };
}

const describeBuild = (version?: string, commit?: string): string =>
  [version, commit?.slice(0, 7)].filter((part) => part !== undefined).join(' ') || 'unknown';

/**
 * The line the server writes under the report's reference: English, for
 * whoever runs it, and made only of what {@link parseUnreadableAnswer} kept.
 *
 * The builds are said to differ only on a part both sides know: a server built
 * by hand answers its commit as `unknown`, which is not a different commit.
 */
export function unreadableAnswerLogLine(
  report: UnreadableAnswerReport,
  server: { readonly version?: string; readonly commit?: string },
): string {
  const where =
    report.path === undefined ? '' : report.path === '' ? ' in the whole answer' : ` at ${report.path}`;
  const on = report.page ? `, on ${report.page}` : '';
  const serverVersion = take(server.version, VERSION);
  const serverCommit = take(server.commit, COMMIT);
  const versionsDiffer =
    report.pageVersion !== undefined && serverVersion !== undefined && report.pageVersion !== serverVersion;
  const commitsDiffer =
    report.pageCommit !== undefined &&
    serverCommit !== undefined &&
    report.pageCommit.slice(0, 7) !== serverCommit.slice(0, 7);
  const pageBuild = describeBuild(report.pageVersion, report.pageCommit);
  const serverBuild = describeBuild(serverVersion, serverCommit);
  const differ = versionsDiffer || commitsDiffer ? ' (they differ)' : '';
  return (
    `[web] a page could not read an answer [ref ${report.reference}]: ` +
    `${report.code ?? 'an issue of an unknown kind'}${where}${on}; ` +
    `page build ${pageBuild}, server build ${serverBuild}${differ}`
  );
}
