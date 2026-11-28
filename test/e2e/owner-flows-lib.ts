// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE OWNER'S FLOWS ON THE APPLIANCE (workplan 0179 T6; the maintainer's yes
 * of 2026-11-28). What an owner presses on the appliance's screens that no
 * gate pressed before: retrying a failed item and applying a move (G9),
 * stopping and resuming one data type, and ending one while keeping another
 * (G7), answering the sharing queue (G8), and the one person the appliance
 * moves (G6). Each flow is here, in a library, so that
 * `owner-flows-lib.unit.test.ts` can run it against a fake appliance off the
 * stack, and `selfhost-owner-flows.e2e.test.ts` against the real one.
 *
 * HOW EACH FLOW IS BUILT (plan 0179 §4.2 and §5):
 *
 *  - Its own mapping and its own folder: three mappings the workflow writes
 *    into the config directory (`fixtures/selfhost-owner-flows-*.mapping.json`),
 *    each loaded paused and green-lit here, each reading a folder of its own on
 *    e2e-source and writing the folder of the same name on e2e-target.
 *  - Every pass asked for, and every status read, through `statusAfterAPass`:
 *    the fixtures schedule a pass every minute, and a read can catch one.
 *  - The failure and the move are made by the gate on the seeded stack, never
 *    by a change to the product: a folder on the target where the source has a
 *    file is a failure no timing can undo, and a rename on the source is a move.
 *  - Names carry the run's own token, so a stack an earlier run left behind
 *    halfway (rows in the ledger, files in the folders) cannot answer for this
 *    run. Each flow empties its folders first, and brings its data types back
 *    to copying from whatever phase `/status` says an earlier run left;
 *    `takeBack` removes what the flows made, at the end.
 *
 * Like apply-deletion-lib.ts it imports nothing from `packages/*`: the gate is
 * a black-box test of a deployed appliance.
 */

import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  BASE_URL,
  DAV_TARGET_USER,
  NEXTCLOUD_URL,
  TARGET_DAV_PASSWORD,
  davAuthHeader,
  fileNaturalKeyHash,
  startMapping,
  statusAfterAPass,
  type DomainStatus,
} from './apply-deletion-lib.ts';

export const DAV_SOURCE_USER = process.env.NEXTCLOUD_SOURCE_USER || 'e2e-source';
const SOURCE_DAV_PASSWORD = process.env.SOURCE_DAV_PASSWORD || '';

/** The gate's three mappings, as the fixtures name them. */
export const RETRY_MAPPING_ID = '55555555-5555-4555-8555-555555555555';
export const PATHS_MAPPING_ID = '66666666-6666-4666-8666-666666666666';
export const SHARING_MAPPING_ID = '77777777-7777-4777-8777-777777777777';

/** Each mapping's folder, the same name on both accounts. */
export const FOLDERS = {
  retry: 'owner-flows-retry',
  paths: 'owner-flows-paths',
  sharing: 'owner-flows-sharing',
} as const;

/** How many passes a flow drives before it says what it waited for. */
const MAX_PASSES = 8;

let pauseMs = 1000;
/** The pause between passes; the unit test sets it to 0. */
export function setPauseMs(ms: number): void {
  pauseMs = ms;
}

function log(line: string): void {
  console.log(`[e2e] owner flows: ${line}`);
}

/** Time a flow, and print it as the upgrade gate prints its own. */
export async function timed<T>(name: string, flow: () => Promise<T>): Promise<T> {
  const started = Date.now();
  try {
    return await flow();
  } finally {
    log(`${name} took ${((Date.now() - started) / 1000).toFixed(1)}s`);
  }
}

// ---------------------------------------------------------------------------
// The two Nextcloud accounts, over plain WebDAV and OCS.
// ---------------------------------------------------------------------------

type Side = 'source' | 'target';
const ACCOUNT: Record<Side, { user: string; password: () => string }> = {
  source: { user: DAV_SOURCE_USER, password: () => SOURCE_DAV_PASSWORD },
  target: { user: DAV_TARGET_USER, password: () => TARGET_DAV_PASSWORD },
};

function auth(side: Side): Record<string, string> {
  return davAuthHeader(ACCOUNT[side].user, ACCOUNT[side].password());
}

function fileUrl(side: Side, path: string): string {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return `${NEXTCLOUD_URL}/remote.php/dav/files/${ACCOUNT[side].user}/${encoded}`;
}

async function dav(side: Side, method: string, path: string, init: { body?: string; headers?: Record<string, string> } = {}): Promise<Response> {
  return fetch(fileUrl(side, path), {
    method,
    headers: { ...auth(side), ...(init.headers ?? {}) },
    ...(init.body !== undefined ? { body: init.body } : {}),
  });
}

async function expectStatus(what: string, res: Response, allowed: number[]): Promise<void> {
  if (!allowed.includes(res.status)) {
    throw new Error(`${what} -> ${res.status} (expected ${allowed.join(' or ')}): ${(await res.text()).slice(0, 300)}`);
  }
}

/** A folder made empty on both accounts: removed if it was there, made again. */
async function emptyFolders(folder: string): Promise<void> {
  for (const side of ['source', 'target'] as const) {
    await expectStatus(`DELETE ${side}/${folder}`, await dav(side, 'DELETE', folder), [204, 404]);
    await expectStatus(`MKCOL ${side}/${folder}`, await dav(side, 'MKCOL', folder), [201]);
  }
}

async function putFile(side: Side, path: string, body: string): Promise<void> {
  await expectStatus(`PUT ${side}/${path}`, await dav(side, 'PUT', path, { body }), [201, 204]);
}

/** The bytes at `path`, or undefined when nothing is there. A folder there is not a file. */
async function readFile(side: Side, path: string): Promise<string | undefined> {
  const res = await dav(side, 'GET', path);
  if (res.status === 404) return undefined;
  if (!res.ok) {
    const head = await dav(side, 'PROPFIND', path, { headers: { Depth: '0' } });
    if (head.status === 207 && /<[a-z]*:?collection/i.test(await head.text())) return undefined;
    throw new Error(`GET ${side}/${path} -> ${res.status}`);
  }
  return res.text();
}

async function exists(side: Side, path: string): Promise<boolean> {
  const res = await dav(side, 'PROPFIND', path, { headers: { Depth: '0' } });
  if (res.status === 404) return false;
  if (res.status === 207) return true;
  throw new Error(`PROPFIND ${side}/${path} -> ${res.status}`);
}

const OCS = `${NEXTCLOUD_URL}/ocs/v2.php/apps/files_sharing/api/v1/shares`;
interface OcsShare {
  readonly id: number | string;
  readonly path: string;
  readonly share_with?: string;
}

async function ocs(side: Side, method: string, suffix: string, form?: Record<string, string>): Promise<unknown> {
  const res = await fetch(`${OCS}${suffix}${suffix.includes('?') ? '&' : '?'}format=json`, {
    method,
    headers: {
      ...auth(side),
      'OCS-APIRequest': 'true',
      Accept: 'application/json',
      ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    ...(form ? { body: new URLSearchParams(form).toString() } : {}),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`OCS ${method} ${side} shares${suffix} -> ${res.status}: ${text.slice(0, 300)}`);
  return (JSON.parse(text) as { ocs: { data: unknown } }).ocs.data;
}

/** The shares an account made of the paths under `folder`. */
async function sharesUnder(side: Side, folder: string): Promise<OcsShare[]> {
  const all = (await ocs(side, 'GET', '')) as OcsShare[];
  return all.filter((s) => s.path.replace(/^\//, '').startsWith(`${folder}/`));
}

// ---------------------------------------------------------------------------
// The appliance, through the routes its screens call.
// ---------------------------------------------------------------------------

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const raw = await res.text();
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    parsed = { raw };
  }
  return { status: res.status, body: parsed };
}

async function expectAnswer(what: string, got: { status: number; body: Record<string, unknown> }, status: number): Promise<Record<string, unknown>> {
  if (got.status !== status) throw new Error(`${what} -> ${got.status} (expected ${status}): ${JSON.stringify(got.body).slice(0, 400)}`);
  return got.body;
}

/**
 * Green-light the gate's mapping. A mapping an earlier run of this gate left
 * running answers Start with 409 once a data type of it is past its cutover;
 * that is a mapping already copying, which is what Start is for here.
 */
async function started(mappingId: string): Promise<void> {
  try {
    await startMapping(mappingId);
  } catch (err) {
    const status = (await mappingOnStatus(mappingId)).migrationStatus;
    if (!['active', 'cutover', 'continuous'].includes(status ?? '')) throw err;
  }
}

interface MappingOnStatus {
  readonly migrationStatus?: string;
  readonly endings?: ReadonlyArray<{ readonly domain: string; readonly phase: string; readonly stopped: boolean }>;
}
async function mappingOnStatus(mappingId: string): Promise<MappingOnStatus> {
  const body = await expectAnswer('GET /status', await call('GET', '/status'), 200);
  const found = (body.mappings as Array<MappingOnStatus & { mappingId: string }>).find((m) => m.mappingId === mappingId);
  if (!found) throw new Error(`GET /status names no mapping ${mappingId}`);
  return found;
}

/** One data type's phase as `/status` says it (`endings`): active, cutover, done or continuous. */
async function phaseOf(mappingId: string, domain: string): Promise<string | undefined> {
  return (await mappingOnStatus(mappingId)).endings?.find((e) => e.domain === domain)?.phase;
}

/**
 * A data type of the gate's mapping copying, whatever an earlier run of the
 * gate left: ended, it is kept copying (Keep is how a person brings an ended
 * data type back, `endOrKeepPath`); stopped, it is resumed. Answers the
 * phase it found, so a flow can say where it started from.
 */
async function copying(mappingId: string, domain: string): Promise<string | undefined> {
  const phase = await phaseOf(mappingId, domain);
  if (phase === 'done') {
    await expectAnswer(`keep ${domain}, ended by an earlier run`, await call('POST', `/mappings/${mappingId}/domains/${domain}/keep`), 200);
  }
  await expectAnswer(`resume ${domain} before the flow`, await call('POST', `/mappings/${mappingId}/domains/${domain}/resume`), 200);
  return phase;
}

/**
 * Drive passes, each through `statusAfterAPass`, until `check` answers; at
 * most `passes` of them. Says what it waited for, and the status it read last.
 */
async function afterPasses<T>(
  mappingId: string,
  domain: string,
  what: string,
  check: () => Promise<T | undefined>,
  passes = MAX_PASSES,
): Promise<T> {
  let status: DomainStatus | null = null;
  for (let pass = 0; pass < passes; pass++) {
    status = await statusAfterAPass(mappingId, domain);
    const got = await check();
    if (got !== undefined) return got;
    if (pauseMs > 0) await sleep(pauseMs);
  }
  throw new Error(`${what}, after ${passes} passes (last ${domain} status: ${JSON.stringify(status)})`);
}

/** A pass that completed after `after`, read through `statusAfterAPass`: proof a pass ran. */
async function aPassAfter(mappingId: string, domain: string, after: string | undefined): Promise<DomainStatus> {
  return afterPasses(mappingId, domain, `no ${domain} pass completed after ${after ?? 'none'}`, async () => {
    const s = await statusAfterAPass(mappingId, domain);
    return s?.state === 'completed' && s.lastSyncedAt !== undefined && s.lastSyncedAt !== after ? s : undefined;
  }, 3);
}

interface FailureEntry {
  readonly naturalKeyHash: string;
  readonly attempts: number;
  readonly lastError?: string;
  readonly displayName?: string;
}
async function failures(mappingId: string): Promise<{ needsDecision: FailureEntry[]; retrying: FailureEntry[] }> {
  const body = await expectAnswer('GET /failures', await call('GET', '/failures'), 200);
  const mine = body[mappingId] as { needsDecision: FailureEntry[]; retrying: FailureEntry[] } | undefined;
  if (!mine) throw new Error(`GET /failures names no mapping ${mappingId}: ${Object.keys(body).join(', ')}`);
  return mine;
}

interface MoveEntry {
  readonly naturalKeyHash: string;
  readonly toNaturalKeyHash?: string;
}
async function openMoves(mappingId: string): Promise<MoveEntry[]> {
  const body = await expectAnswer('GET /moves', await call('GET', '/moves'), 200);
  const mine = body[mappingId] as { open: MoveEntry[] } | undefined;
  if (!mine) throw new Error(`GET /moves names no mapping ${mappingId}`);
  return mine.open;
}

const describeFailures = (q: { needsDecision: FailureEntry[]; retrying: FailureEntry[] }) =>
  JSON.stringify({
    needsDecision: q.needsDecision.map((f) => [f.displayName ?? f.naturalKeyHash.slice(0, 12), f.attempts]),
    retrying: q.retrying.map((f) => [f.displayName ?? f.naturalKeyHash.slice(0, 12), f.attempts]),
  });

// ---------------------------------------------------------------------------
// G9 — a failed item retried until it is copied; a move applied.
// ---------------------------------------------------------------------------

/**
 * A FAILED ITEM, RETRIED UNTIL IT IS COPIED (G9, `/failures/:h/retry`).
 *
 * The failure is certain, not timed: a folder on the target where the source
 * has a file, the same conflict the restart-resume gate plants. It is driven
 * until the item waits on a decision (`needsDecision`, after its attempts),
 * the folder in its way is then removed, and one pass shows a parked item is
 * not retried by itself. Only then the retry, and the item is copied, its
 * bytes the source's, and gone from both lists. A second retry finds nothing.
 */
export async function retryAFailedItem(run: string): Promise<string[]> {
  const folder = FOLDERS.retry;
  const name = `blocked-${run}.txt`;
  const bytes = `Retried by the owner, run ${run}.`;
  const hash = fileNaturalKeyHash(name);
  await emptyFolders(folder);
  await putFile('source', `${folder}/${name}`, bytes);
  await expectStatus(`MKCOL target/${folder}/${name}`, await dav('target', 'MKCOL', `${folder}/${name}`), [201]);
  await started(RETRY_MAPPING_ID);
  await copying(RETRY_MAPPING_ID, 'file');

  const parked = await afterPasses(RETRY_MAPPING_ID, 'file', `${name} never came to wait on a decision`, async () => {
    const q = await failures(RETRY_MAPPING_ID);
    return q.needsDecision.find((f) => f.naturalKeyHash === hash);
  });
  const evidence = [`${name} failed ${parked.attempts} time(s) and waits on a decision: ${parked.lastError ?? '(no reason)'}`];

  await expectStatus(`DELETE target/${folder}/${name}`, await dav('target', 'DELETE', `${folder}/${name}`), [204]);
  await statusAfterAPass(RETRY_MAPPING_ID, 'file');
  if ((await readFile('target', `${folder}/${name}`)) !== undefined) {
    throw new Error(`${name} was copied before anybody pressed retry: a parked item was retried by itself, so the retry would prove nothing`);
  }
  const still = await failures(RETRY_MAPPING_ID);
  if (!still.needsDecision.some((f) => f.naturalKeyHash === hash)) {
    throw new Error(`${name} left the decision list before anybody pressed retry: ${describeFailures(still)}`);
  }

  const retry = await expectAnswer(
    `POST /failures/${hash.slice(0, 12)}…/retry`,
    await call('POST', `/mappings/${RETRY_MAPPING_ID}/failures/${hash}/retry`),
    200,
  );
  if (retry.action !== 'retry') throw new Error(`the retry answered ${JSON.stringify(retry)}`);

  let lastQueue = still;
  await afterPasses(RETRY_MAPPING_ID, 'file', `${name} was not copied after the retry (failures: ${describeFailures(lastQueue)})`, async () => {
    lastQueue = await failures(RETRY_MAPPING_ID);
    const listed = [...lastQueue.needsDecision, ...lastQueue.retrying].some((f) => f.naturalKeyHash === hash);
    const copied = await readFile('target', `${folder}/${name}`);
    return copied === bytes && !listed ? true : undefined;
  }, 3);
  evidence.push(`after the retry, ${name} is on the target with the source's bytes and on neither failure list`);

  const again = await call('POST', `/mappings/${RETRY_MAPPING_ID}/failures/${hash}/retry`);
  await expectAnswer('a second retry of a copied item', again, 404);
  evidence.push('a second retry is refused: 404, nothing left to retry');
  return evidence;
}

/**
 * A MOVE, APPLIED (G9, `/moves/:h/apply`; ADR-0030).
 *
 * A file is copied, then renamed on the source. The pass after it copies the
 * file under its new name and records the move with the new key. Apply
 * removes the target's old copy: the file is at its new place, with the
 * source's bytes, and not at the old one. A second apply is refused, and a
 * pass after it does not bring the old copy back.
 */
export async function applyAMove(run: string): Promise<string[]> {
  const folder = FOLDERS.retry;
  const before = `move-${run}-before.txt`;
  const after = `move-${run}-after.txt`;
  const bytes = `Moved by the owner, run ${run}.`;
  const from = fileNaturalKeyHash(before);
  const to = fileNaturalKeyHash(after);
  await started(RETRY_MAPPING_ID);
  await copying(RETRY_MAPPING_ID, 'file');
  await putFile('source', `${folder}/${before}`, bytes);
  await afterPasses(RETRY_MAPPING_ID, 'file', `${before} was never copied`, async () =>
    (await readFile('target', `${folder}/${before}`)) === bytes ? true : undefined,
  );

  const move = await dav('source', 'MOVE', `${folder}/${before}`, {
    headers: { Destination: fileUrl('source', `${folder}/${after}`), Overwrite: 'F' },
  });
  await expectStatus(`MOVE source/${before} -> ${after}`, move, [201, 204]);

  let seen: MoveEntry[] = [];
  const entry = await afterPasses(RETRY_MAPPING_ID, 'file', `the rename of ${before} never reached the move queue (open: ${JSON.stringify(seen)})`, async () => {
    seen = await openMoves(RETRY_MAPPING_ID);
    return seen.find((m) => m.naturalKeyHash === from);
  });
  if (entry.toNaturalKeyHash !== to) {
    throw new Error(`the move of ${before} names ${entry.toNaturalKeyHash ?? 'no new key'}, not ${after}'s`);
  }
  if ((await readFile('target', `${folder}/${after}`)) !== bytes) {
    throw new Error(`the move of ${before} is queued but ${after} is not on the target with the source's bytes`);
  }

  const applied = await expectAnswer(
    `POST /moves/${from.slice(0, 12)}…/apply`,
    await call('POST', `/mappings/${RETRY_MAPPING_ID}/moves/${from}/apply`),
    200,
  );
  const evidence = [`apply answered 200 (${String(applied.kind)})`];
  if (await exists('target', `${folder}/${before}`)) {
    throw new Error(`the move was applied and the old copy is still at its old place, ${folder}/${before}`);
  }
  if ((await readFile('target', `${folder}/${after}`)) !== bytes) {
    throw new Error(`the move was applied and ${after} is no longer on the target with the source's bytes`);
  }
  evidence.push(`${after} is on the target with the source's bytes, and ${before} is not`);

  await expectAnswer('a second apply of the same move', await call('POST', `/mappings/${RETRY_MAPPING_ID}/moves/${from}/apply`), 404);
  await statusAfterAPass(RETRY_MAPPING_ID, 'file');
  if (await exists('target', `${folder}/${before}`)) {
    throw new Error(`a pass after the apply brought the old copy back to ${before}`);
  }
  evidence.push('a second apply is refused (404), and a pass after it leaves the old place empty');
  return evidence;
}

// ---------------------------------------------------------------------------
// G7 — one data type stopped and resumed; one ended and one kept.
// ---------------------------------------------------------------------------

/**
 * ONE DATA TYPE STOPPED, THEN RESUMED (G7, `/domains/:d/(stop|resume)`).
 *
 * The mapping carries files and calendars. Files is stopped; a file made on
 * the source then is not copied by a pass that ran, which the calendar's own
 * newer completed pass proves; files is resumed, and the next passes copy it.
 */
export async function stopAndResumeOne(run: string): Promise<string[]> {
  const folder = FOLDERS.paths;
  const first = `first-${run}.txt`;
  const stopped = `while-stopped-${run}.txt`;
  await emptyFolders(folder);
  await putFile('source', `${folder}/${first}`, `First, run ${run}.`);
  await started(PATHS_MAPPING_ID);
  // The calendar first: a stop of the one data type still copying is refused
  // (`last_one_copying`), so the calendar must copy while files is stopped.
  await copying(PATHS_MAPPING_ID, 'calendar');
  await copying(PATHS_MAPPING_ID, 'file');
  await afterPasses(PATHS_MAPPING_ID, 'file', `${first}, the mapping's first pass, was never copied`, async () =>
    (await readFile('target', `${folder}/${first}`)) !== undefined ? true : undefined,
  );

  const stop = await expectAnswer('POST /domains/file/stop', await call('POST', `/mappings/${PATHS_MAPPING_ID}/domains/file/stop`), 200);
  if (stop.stopped !== true) throw new Error(`the stop answered ${JSON.stringify(stop)}`);
  // A pass the schedule started before the stop may still be running; asking
  // for one joins it and answers when it ends, so the file below is made only
  // once every pass that began before the stop is over.
  await statusAfterAPass(PATHS_MAPPING_ID, 'calendar');
  await putFile('source', `${folder}/${stopped}`, `Made while files were stopped, run ${run}.`);
  const before = await statusAfterAPass(PATHS_MAPPING_ID, 'calendar');
  const ran = await aPassAfter(PATHS_MAPPING_ID, 'calendar', before?.lastSyncedAt);
  if ((await readFile('target', `${folder}/${stopped}`)) !== undefined) {
    throw new Error(`${stopped} was copied while it was stopped, by the pass that completed at ${ran.lastSyncedAt}`);
  }
  const evidence = [`stopped: the pass that completed at ${ran.lastSyncedAt} copied no file`];

  const resume = await expectAnswer('POST /domains/file/resume', await call('POST', `/mappings/${PATHS_MAPPING_ID}/domains/file/resume`), 200);
  if (resume.stopped !== false) throw new Error(`the resume answered ${JSON.stringify(resume)}`);
  await afterPasses(PATHS_MAPPING_ID, 'file', `${stopped} was not copied after the resume`, async () =>
    (await readFile('target', `${folder}/${stopped}`)) !== undefined ? true : undefined,
  3);
  evidence.push(`resumed: ${stopped} is on the target`);
  return evidence;
}

/** Lines unfolded (RFC 5545 §3.1), CRLF read as LF. */
function unfold(text: string): string[] {
  return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

/**
 * The href of the calendar object on `side` whose bytes carry `UID:<uid>`,
 * wherever the writer put it: every collection of the account's calendar home,
 * one level down (as selfhost-address-changes.e2e.test.ts reads the target).
 */
async function calendarObject(side: Side, uid: string): Promise<string | undefined> {
  const home = `${NEXTCLOUD_URL}/remote.php/dav/calendars/${ACCOUNT[side].user}/`;
  const hrefs = async (url: string): Promise<string[]> => {
    const res = await fetch(url, { method: 'PROPFIND', headers: { ...auth(side), Depth: '1' } });
    if (res.status !== 207) throw new Error(`PROPFIND ${url} -> ${res.status}`);
    return [...(await res.text()).matchAll(/<[a-z]*:?href>([^<]+)<\/[a-z]*:?href>/gi)].map((m) => m[1]!);
  };
  for (const collection of await hrefs(home)) {
    if (!collection.endsWith('/') || `${NEXTCLOUD_URL}${collection}` === home) continue;
    for (const href of await hrefs(`${NEXTCLOUD_URL}${collection}`)) {
      if (href.endsWith('/')) continue;
      const res = await fetch(`${NEXTCLOUD_URL}${href}`, { headers: auth(side) });
      if (!res.ok) continue;
      if (unfold(await res.text()).includes(`UID:${uid}`)) return href;
    }
  }
  return undefined;
}

function eventUid(run: string, which: string): string {
  return `owner-flows-${which}-${run}@dev.local`;
}

async function putEvent(uid: string, summary: string): Promise<void> {
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Ownpace e2e//owner flows//EN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    'DTSTAMP:20261128T120000Z',
    'DTSTART:20261201T090000Z',
    'DTEND:20261201T100000Z',
    `SUMMARY:${summary}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
  const url = `${NEXTCLOUD_URL}/remote.php/dav/calendars/${DAV_SOURCE_USER}/personal/${encodeURIComponent(uid)}.ics`;
  const res = await fetch(url, { method: 'PUT', headers: { ...auth('source'), 'Content-Type': 'text/calendar' }, body: ics });
  await expectStatus(`PUT source event ${uid}`, res, [201, 204]);
}

/**
 * ONE DATA TYPE ENDED AND ONE KEPT (G7, `/domains/:d/(end|keep)`).
 *
 * After `stopAndResumeOne`, on the same mapping: an event made on the source
 * reaches the target first, so the calendar is seen copying; then the calendar
 * is ended and files kept copying. A file made then is copied, an event made
 * then is not. A second End changes nothing.
 */
export async function endOneKeepOne(run: string): Promise<string[]> {
  const folder = FOLDERS.paths;
  const beforeEnd = eventUid(run, 'before-end');
  const afterEnd = eventUid(run, 'after-end');
  const kept = `after-keep-${run}.txt`;
  await started(PATHS_MAPPING_ID);
  const calendarAtStart = await copying(PATHS_MAPPING_ID, 'calendar');
  await copying(PATHS_MAPPING_ID, 'file');
  await putEvent(beforeEnd, `Before the end, run ${run}`);
  await afterPasses(PATHS_MAPPING_ID, 'calendar', `${beforeEnd} never reached the target, so the calendar was not seen copying`, async () =>
    (await calendarObject('target', beforeEnd)) ?? undefined,
  );

  const ended = await expectAnswer('POST /domains/calendar/end', await call('POST', `/mappings/${PATHS_MAPPING_ID}/domains/calendar/end`), 200);
  const keep = await expectAnswer('POST /domains/file/keep', await call('POST', `/mappings/${PATHS_MAPPING_ID}/domains/file/keep`), 200);
  const evidence = [
    ...(calendarAtStart === 'done' ? ['an earlier run had ended the calendar: kept copying first, then ended again'] : []),
    `calendar ended (${String(ended.from ?? ended.phase)} -> ${String(ended.to ?? ended.phase)}), file kept (${String(keep.from ?? keep.phase)} -> ${String(keep.to ?? keep.phase)})`,
  ];

  // As after the stop: every pass that began before the presses ends first.
  await statusAfterAPass(PATHS_MAPPING_ID, 'file');
  await putEvent(afterEnd, `After the end, run ${run}`);
  await putFile('source', `${folder}/${kept}`, `Made after files were kept, run ${run}.`);
  await afterPasses(PATHS_MAPPING_ID, 'file', `${kept} was not copied after it was kept copying`, async () =>
    (await readFile('target', `${folder}/${kept}`)) !== undefined ? true : undefined,
  3);
  if ((await calendarObject('target', afterEnd)) !== undefined) {
    throw new Error(`${afterEnd} was copied after it was ended: the calendar goes on copying`);
  }
  evidence.push(`kept: ${kept} is on the target; ended: ${afterEnd} is not`);

  const again = await expectAnswer('a second End of the calendar', await call('POST', `/mappings/${PATHS_MAPPING_ID}/domains/calendar/end`), 200);
  if (again.changed !== false) throw new Error(`a second End changed something: ${JSON.stringify(again)}`);
  evidence.push('a second End changes nothing');
  return evidence;
}

// ---------------------------------------------------------------------------
// G8 — the appliance's sharing queue, answered.
// ---------------------------------------------------------------------------

/** A row of the queue as `GET /sharing` answers it (`ShareGrantRow`): the path is `onLabel`. */
interface Grant {
  readonly id: string;
  readonly onLabel: string;
  readonly grantee?: string;
  readonly state: string;
}
async function grants(): Promise<Grant[]> {
  const body = await expectAnswer('GET /sharing', await call('GET', `/mappings/${SHARING_MAPPING_ID}/sharing`), 200);
  return body.grants as Grant[];
}

/**
 * THE SHARING QUEUE, ANSWERED (G8, `/mappings/:id/sharing/…`; ADR-0032).
 *
 * A file is copied, then shared on the source with the target's account. The
 * rescan lists that share as an open row. Applied before its data type's
 * cutover it is refused, and nothing is shared. Files is then kept copying,
 * which is its cutover, and the row applied with the address a person confirms
 * on the screen (the source's grantee is the account the target shares from,
 * so the source account stands for them). The target then holds one share. A
 * second pass, rescan and one-go press later it still holds one: recreated
 * once, not twice.
 */
export async function answerTheSharingQueue(run: string): Promise<string[]> {
  const folder = FOLDERS.sharing;
  const name = `shared-${run}.txt`;
  const on = `${folder}/${name}`;
  await emptyFolders(folder);
  for (const side of ['source', 'target'] as const) {
    for (const s of await sharesUnder(side, folder)) await ocs(side, 'DELETE', `/${s.id}`);
  }
  await putFile('source', on, `Shared by the owner, run ${run}.`);
  await started(SHARING_MAPPING_ID);
  const phaseAtStart = await copying(SHARING_MAPPING_ID, 'file');
  await afterPasses(SHARING_MAPPING_ID, 'file', `${name} was never copied`, async () =>
    (await readFile('target', on)) !== undefined ? true : undefined,
  );
  await ocs('source', 'POST', '', { path: `/${on}`, shareType: '0', shareWith: DAV_TARGET_USER, permissions: '1' });

  const rescan = await expectAnswer('POST /sharing/rescan', await call('POST', `/mappings/${SHARING_MAPPING_ID}/sharing/rescan`), 200);
  const row = (await grants()).find((g) => g.onLabel === on && g.state === 'open');
  if (!row) throw new Error(`the rescan (open: ${String(rescan.open)}) lists no open row for ${on}: ${JSON.stringify(await grants())}`);
  const evidence = [`the rescan lists ${on}, shared with ${row.grantee ?? '(nobody)'}, open`];

  if (['active', undefined].includes(phaseAtStart)) {
    const early = await call('POST', `/mappings/${SHARING_MAPPING_ID}/sharing/${row.id}/decision`, { action: 'apply', grantee: DAV_SOURCE_USER });
    if (early.status !== 409 || early.body.error !== 'not_cut_over') {
      throw new Error(`a share was applied before its cutover: ${early.status} ${JSON.stringify(early.body).slice(0, 200)}`);
    }
    if ((await sharesUnder('target', folder)).length !== 0) throw new Error('a share refused before its cutover was made on the target all the same');
    evidence.push('before the cutover, apply is refused (409 not_cut_over) and nothing is shared');
  } else {
    evidence.push(`an earlier run left files ${phaseAtStart}, past its cutover: the refusal before it is not tried this run`);
  }

  await expectAnswer('POST /domains/file/keep', await call('POST', `/mappings/${SHARING_MAPPING_ID}/domains/file/keep`), 200);
  const applied = await expectAnswer(
    'POST /sharing/:grant/decision apply',
    await call('POST', `/mappings/${SHARING_MAPPING_ID}/sharing/${row.id}/decision`, { action: 'apply', grantee: DAV_SOURCE_USER }),
    200,
  );
  if ((applied.grant as Grant | undefined)?.state !== 'applied') throw new Error(`the apply answered ${JSON.stringify(applied)}`);

  const onTarget = async (): Promise<OcsShare[]> => (await sharesUnder('target', folder)).filter((s) => s.path.replace(/^\//, '') === on);
  const once = await onTarget();
  if (once.length !== 1 || once[0]!.share_with !== DAV_SOURCE_USER) {
    throw new Error(`after the apply the target holds ${once.length} shares of ${on}: ${JSON.stringify(once)}`);
  }
  evidence.push(`applied: the target shares ${on} with ${DAV_SOURCE_USER}, once`);

  await statusAfterAPass(SHARING_MAPPING_ID, 'file');
  await expectAnswer('a second rescan', await call('POST', `/mappings/${SHARING_MAPPING_ID}/sharing/rescan`), 200);
  await expectAnswer('the one-go press', await call('POST', `/mappings/${SHARING_MAPPING_ID}/sharing/apply-all`, {}), 200);
  const rows = (await grants()).filter((g) => g.onLabel === on);
  if (rows.length !== 1 || rows[0]!.state !== 'applied') {
    throw new Error(`after a second pass the queue holds ${rows.length} rows for ${on}: ${JSON.stringify(rows)}`);
  }
  const twice = await onTarget();
  if (twice.length !== 1) throw new Error(`after a second pass the target holds ${twice.length} shares of ${on}: ${JSON.stringify(twice)}`);
  const again = await call('POST', `/mappings/${SHARING_MAPPING_ID}/sharing/${row.id}/decision`, { action: 'apply', grantee: DAV_SOURCE_USER });
  if (again.status !== 409 && again.status !== 404) throw new Error(`a second apply of a settled row answered ${again.status}`);
  if ((await onTarget()).length !== 1) throw new Error('a second apply of a settled row made a second share');
  evidence.push(`a second pass, rescan and one-go press: one row, applied, one share; a second apply refused (${again.status})`);
  return evidence;
}

// ---------------------------------------------------------------------------
// G6 — the one person the appliance moves.
// ---------------------------------------------------------------------------

/**
 * THE ONE PERSON HERE (G6, `/people`, `/people/:id/migrations`; ADR-0050).
 *
 * The appliance moves one person, and every migration in its config directory
 * is theirs: `/people` lists one implicit person holding every mapping, the
 * gate's own among them, each started by its own flow above. Adding a person or
 * a migration through the routes the screens call is refused, with the reason,
 * never a 404. A migration is added on the appliance by adding its file, which
 * is how the gate's three came to be; that each one's first pass completes is
 * what the flows above wait for before anything else.
 */
export async function theOnePersonHere(mappingIds: ReadonlyArray<string>): Promise<string[]> {
  const body = await expectAnswer('GET /people', await call('GET', '/people'), 200);
  const people = body.people as Array<{ id: string; implicit?: boolean; migrations: Array<{ id: string; status: string }> }>;
  if (people.length !== 1 || people[0]!.implicit !== true) throw new Error(`GET /people lists ${JSON.stringify(people).slice(0, 300)}, not one implicit person`);
  const listed = new Set(people[0]!.migrations.map((m) => m.id));
  const missing = mappingIds.filter((id) => !listed.has(id));
  if (missing.length > 0) throw new Error(`GET /people lists no migration ${missing.join(', ')} for the one person`);
  const person = people[0]!.id;
  const evidence = [`one implicit person (${person}), holding ${listed.size} migrations, the gate's ${mappingIds.length} among them`];
  for (const [path, payload] of [
    ['/people', { displayName: 'Someone else' }],
    [`/people/${encodeURIComponent(person)}/migrations`, { mappingId: RETRY_MAPPING_ID }],
  ] as const) {
    const refused = await call('POST', path, payload);
    if (refused.status !== 409 || refused.body.error !== 'one_person_here' || typeof refused.body.message !== 'string') {
      throw new Error(`POST ${path} answered ${refused.status} ${JSON.stringify(refused.body).slice(0, 200)}, not 409 one_person_here with its reason`);
    }
  }
  evidence.push('adding a person, or a migration to the person, is refused: 409 one_person_here, with the reason');
  return evidence;
}

// ---------------------------------------------------------------------------
// Taking back what the gate made.
// ---------------------------------------------------------------------------

/**
 * Remove what the flows made: the files on both accounts, the two events, the
 * shares. Each folder is left there, empty: the gate's mappings go on being
 * scheduled (a data type cannot be stopped while it is the last one copying,
 * `last_one_copying`), and a pass over an empty folder copies nothing, where
 * one over a folder that is gone would fail. Answers what it could not remove.
 */
export async function takeBack(run: string): Promise<string[]> {
  const left: string[] = [];
  const attempt = async (what: string, step: () => Promise<void>) => {
    try {
      await step();
    } catch (err) {
      left.push(`${what}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  for (const side of ['source', 'target'] as const) {
    await attempt(`the shares on ${side}`, async () => {
      for (const s of await sharesUnder(side, FOLDERS.sharing)) await ocs(side, 'DELETE', `/${s.id}`);
    });
    for (const folder of Object.values(FOLDERS)) {
      await attempt(`${side}/${folder}`, async () => {
        await expectStatus(`DELETE ${side}/${folder}`, await dav(side, 'DELETE', folder), [204, 404]);
        await expectStatus(`MKCOL ${side}/${folder}`, await dav(side, 'MKCOL', folder), [201]);
      });
    }
    for (const which of ['before-end', 'after-end']) {
      await attempt(`${side} event ${which}`, async () => {
        const href = await calendarObject(side, eventUid(run, which));
        if (href) await expectStatus(`DELETE ${href}`, await fetch(`${NEXTCLOUD_URL}${href}`, { method: 'DELETE', headers: auth(side) }), [204]);
      });
    }
  }
  return left;
}

/** A token of this run's own, for names no earlier run can have left behind. */
export function runToken(): string {
  return createHash('sha256').update(`${Date.now()}-${Math.random()}`).digest('hex').slice(0, 10);
}
