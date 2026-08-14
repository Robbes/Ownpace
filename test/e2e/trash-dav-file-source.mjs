// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
//
// Delete ONE already-migrated file on the SOURCE Nextcloud, then check that its
// trashbin entry reports a path our natural keys can actually match.
//
// Everything else in the e2e ADDS items. This throws one away, which §11.1 calls a
// lifecycle decision: the source is authoritative for content, the owner for whether
// something should exist. The migration must notice, report it at `GET /deletions`
// with `evidence: "trashed"`, and remove nothing from the target.
//
// WHY THIS SCRIPT ASSERTS RATHER THAN JUST SEEDING. The whole feature rests on one
// agreement: `{http://nextcloud.org/ns}trashbin-original-location` must come back in
// the same form as `FileItem.path` — root-relative, no leading slash, real characters
// rather than percent-escapes. If it does not, the natural keys differ, the lookup
// misses, and NOTHING IS REPORTED. Not an error: silence, which is the failure mode
// nobody notices, and the one this repo has already shipped four times (`collection`,
// `target_version`, `absent_passes`, `source_ref` each spent a release inert). Unit
// tests can only prove the parser against a body I wrote myself; only a real
// Nextcloud can say what it actually sends. So this script prints what it got, states
// what the app expects, and exits non-zero if they differ.
//
// A file with a SPACE and a non-ASCII character in its name is deleted alongside the
// plain one, because that is where an escaping mismatch would show up first.
//
// Config via env (same names as seed-dav-source.mjs):
//   SEED_DAV_URL             Nextcloud base URL (default http://127.0.0.1:8082)
//   SEED_DAV_SOURCE_USER     source account userid (default e2e-source)
//   SEED_DAV_SOURCE_PASSWORD source account password (required)
//   TRASH_FILE_NAME          file to delete (default dav-seed-file-1.txt)
//
// Idempotent: a file already in the bin is reported and not re-deleted, so a
// re-dispatched workflow does not fail on a deletion it already made.

import { davFetch } from './dav-retry.mjs';

const baseUrl = (process.env.SEED_DAV_URL || 'http://127.0.0.1:8082').replace(/\/$/, '');
const user = process.env.SEED_DAV_SOURCE_USER || 'e2e-source';
const password = process.env.SEED_DAV_SOURCE_PASSWORD;
const fileName = process.env.TRASH_FILE_NAME || 'dav-seed-file-1.txt';
/** Deleted as well, because escaping trouble surfaces here and not on ASCII. */
const awkwardName = 'openmig e2e trashed café.txt';

if (!password) {
  console.error('[trash-dav] SEED_DAV_SOURCE_PASSWORD is required');
  process.exit(1);
}

const authHeader = `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
const filesUrl = `${baseUrl}/remote.php/dav/files/${user}`;
const trashUrl = `${baseUrl}/remote.php/dav/trashbin/${user}/trash/`;

// Retries while the source Nextcloud is merely busy — its SQLite backend answers
// 500 "database is locked" under concurrent access, and MOVE/DELETE below are
// write paths. See dav-retry.mjs.
const dav = (method, url, options = {}) =>
  davFetch(
    url,
    {
      method,
      headers: { Authorization: authHeader, ...(options.headers ?? {}) },
      ...(options.body !== undefined ? { body: options.body } : {}),
    },
    { label: '[trash-dav]' },
  );

/** Percent-encode each path segment, as a DAV URL requires and the app does. */
const encodePath = (path) => path.split('/').map(encodeURIComponent).join('/');

/** Decode the five XML entities — this is element TEXT, not a URI. */
const decodeXml = (text) =>
  text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');

/** Every original location the bin reports, exactly as the app parses them. */
async function readBin() {
  const response = await dav('PROPFIND', trashUrl, {
    headers: { 'Content-Type': 'application/xml', Depth: '1' },
    body: `<?xml version="1.0" encoding="utf-8"?>
      <d:propfind xmlns:d="DAV:" xmlns:nc="http://nextcloud.org/ns">
        <d:prop><nc:trashbin-original-location/><nc:trashbin-deletion-time/></d:prop>
      </d:propfind>`,
  });
  if (response.status !== 207) {
    throw new Error(`trashbin PROPFIND -> ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  const body = await response.text();
  const locations = [];
  const responseRegex = /<[A-Za-z][\w-]*:response[^>]*>([\s\S]*?)<\/[A-Za-z][\w-]*:response>/gi;
  let match;
  while ((match = responseRegex.exec(body)) !== null) {
    const found = match[1]?.match(
      /<[A-Za-z][\w-]*:trashbin-original-location[^>]*>([\s\S]*?)<\/[A-Za-z][\w-]*:trashbin-original-location>/i,
    );
    const raw = found?.[1]?.trim();
    if (raw) locations.push(decodeXml(raw));
  }
  return locations;
}

async function deleteIfPresent(path) {
  const url = `${filesUrl}/${encodePath(path)}`;
  const response = await dav('DELETE', url);
  if (response.status === 204 || response.status === 200) {
    console.log(`[trash-dav] deleted ${path}`);
    return true;
  }
  if (response.status === 404) {
    console.log(`[trash-dav] ${path} is not there (already deleted, or never seeded)`);
    return false;
  }
  throw new Error(`DELETE ${url} -> ${response.status}: ${(await response.text()).slice(0, 300)}`);
}

async function main() {
  // The awkward-named file has to exist before it can be thrown away, and seeding
  // it here keeps this script self-contained rather than coupling it to a change in
  // seed-dav-source.mjs.
  const awkwardUrl = `${filesUrl}/${encodePath(awkwardName)}`;
  const seeded = await dav('PUT', awkwardUrl, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    body: 'deleted on purpose, to prove the trashbin path form\n',
  });
  if (![201, 204].includes(seeded.status)) {
    console.log(`[trash-dav] note: PUT ${awkwardName} -> ${seeded.status} (may already exist)`);
  }

  const before = await readBin();
  console.log(`[trash-dav] bin holds ${before.length} entr${before.length === 1 ? 'y' : 'ies'} before`);

  await deleteIfPresent(fileName);
  await deleteIfPresent(awkwardName);

  const after = await readBin();
  console.log('[trash-dav] bin now reports:');
  for (const location of after) console.log(`  ${JSON.stringify(location)}`);

  // THE ASSERTION. `FileItem.path` for a file at the account's file root is just its
  // name — root-relative, no leading slash, real characters. If the bin says anything
  // else, every natural key derived from it misses and the queue stays empty for a
  // deletion that definitely happened.
  const problems = [];
  for (const expected of [fileName, awkwardName]) {
    if (after.includes(expected)) continue;
    const near = after.find((l) => l.replace(/^\/+/, '') === expected);
    problems.push(
      near !== undefined
        ? `${JSON.stringify(expected)} came back as ${JSON.stringify(near)} — same file, different ` +
          'form, so the natural keys will not match. `trashbinPathToKeyPath` needs to normalise this.'
        : `${JSON.stringify(expected)} is not in the bin at all under any recognisable form.`,
    );
  }

  if (problems.length > 0) {
    console.error('[trash-dav] the trashbin paths do NOT match what the app derives:');
    for (const p of problems) console.error(`  - ${p}`);
    console.error(
      '[trash-dav] this is exactly the mismatch that makes the feature silently report ' +
        'nothing, which is why it is asserted here rather than left to be noticed later.',
    );
    process.exit(1);
  }

  console.log(
    `[trash-dav] both deleted files are in the bin under the paths the app expects ` +
      `(${JSON.stringify(fileName)}, ${JSON.stringify(awkwardName)}). ` +
      'Run a pass, then check GET /deletions for evidence: "trashed".',
  );
}

main().catch((err) => {
  console.error(`[trash-dav] failed: ${err?.message ?? err}`);
  process.exit(1);
});
