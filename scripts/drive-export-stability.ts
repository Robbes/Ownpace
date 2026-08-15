// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Workplan 0042 T0 Q3 — the ONE measurement that decides whether Google's
 * export policies are usable at all.
 *
 * THE QUESTION. A Google Doc has no bytes. Migrating one means asking Drive to
 * EXPORT a rendering (`.docx`, `.pdf`, …). This product hashes the bytes it
 * writes and stores that hash, so if two exports of the same UNCHANGED document
 * differ by a single byte — a timestamp in the OOXML zip, a rebuilt style table,
 * a regenerated document id — then `contentHash` sees a change on every pass and
 * the migration REWRITES EVERY DOCUMENT, nightly, forever. Nothing would look
 * broken: every write succeeds.
 *
 * That is why `nativeFilePolicy` defaults to `refuse` and why the config parser
 * says, in the refusal for a bad value, that the export paths are unmeasured.
 * This script is the measurement. It cannot be a unit test and it cannot be an
 * integration test: Google Drive cannot be containerised, so this is the
 * "recorded contract" tier's manual half (docs/testing.md), run by hand against
 * a real tenant.
 *
 * IT IS ALSO THE SMALLEST USEFUL SLICE OF T6. It goes through the SAME code the
 * appliance does — the same token provider, the same transport, the same
 * connector, the same environment variable names — so a run that gets this far
 * has proven the credentials, the scope, the 401 retry and the export URL
 * against the real API, not against a fake.
 *
 * IT WRITES NOTHING. The token is minted with `drive.readonly`, so it cannot,
 * whatever this script does.
 *
 *   pnpm exec tsx scripts/drive-export-stability.ts
 *
 * Environment (the same names the appliance reads — if it works here it works
 * there, which is half the point of not inventing new ones):
 *
 *   GOOGLE_CLIENT_ID        required
 *   GOOGLE_CLIENT_SECRET    required
 *   GOOGLE_REFRESH_TOKEN    required — delegated, for the account whose Drive
 *                           this reads
 *   DRIVE_FILE_ID           optional — a specific Doc/Sheet/Slide. Unset means
 *                           "find the first native editor file under the root",
 *                           which is what most people want and nobody wants to
 *                           look up by hand.
 *   DRIVE_ROOT_FOLDER_ID    optional — where to search. Unset means My Drive.
 *   DRIVE_EXPORT_POLICY     optional — `export-office` (default) or `export-pdf`.
 *                           Measure BOTH before trusting either: they are
 *                           different renderers and one can be stable while the
 *                           other is not.
 *   DRIVE_EXPORT_GAP_MS     optional — pause between the two exports, default
 *                           3000. A longer gap is a stronger test: an export
 *                           that is stable back-to-back because it was cached
 *                           for four seconds is not stable.
 *   DRIVE_CAPTURE_FILE      optional — where to write a REDACTED recording of
 *                           everything Drive answered, so this one run also
 *                           produces the fixture the replay tier needs (T6).
 *                           Off unless set. See
 *                           `packages/testing/src/drive-capture.ts` for exactly
 *                           what is kept and what is not.
 */

import {
  GoogleDriveSource,
  NATIVE_EXPORT_TYPES,
  createGoogleTokenProvider,
  googleDriveTransport,
  isNativeEditorFile,
  type DriveFile,
  type DriveFileList,
} from '@openmig/connectors';
import { fileContentHash, type GoogleNativeFilePolicy } from '@openmig/shared';
import { createRecordingTransport } from '@openmig/testing/drive-capture';
import { writeFileSync } from 'node:fs';

const CREDS = {
  clientId: process.env.GOOGLE_CLIENT_ID ?? '',
  clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
  refreshToken: process.env.GOOGLE_REFRESH_TOKEN ?? '',
};

const ROOT = process.env.DRIVE_ROOT_FOLDER_ID || 'root';
const GAP_MS = Number(process.env.DRIVE_EXPORT_GAP_MS ?? 3000);
const POLICY = (process.env.DRIVE_EXPORT_POLICY || 'export-office') as GoogleNativeFilePolicy;
const BASE = 'https://www.googleapis.com/drive/v3';

function fail(message: string): never {
  console.error(`\n  ✖ ${message}\n`);
  process.exit(1);
}

if (!CREDS.clientId || !CREDS.clientSecret || !CREDS.refreshToken) {
  fail(
    'Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REFRESH_TOKEN. These are the same ' +
      'variables the appliance reads, so a value that works here works in a mapping.',
  );
}
if (POLICY !== 'export-office' && POLICY !== 'export-pdf') {
  fail(`DRIVE_EXPORT_POLICY must be "export-office" or "export-pdf" (got "${POLICY}").`);
}

const tokens = createGoogleTokenProvider(CREDS);

/**
 * Optionally RECORD what Drive answers, so one run of this script produces both
 * the verdict below and the fixture the replay tier needs (0042 T6).
 *
 * Off unless `DRIVE_CAPTURE_FILE` names a path, because recording somebody's
 * Drive is not something a script should decide to do. What lands in the file
 * is redacted — names, ids and page tokens become pseudonyms and document
 * bytes become a sha256 and a length — and `drive-capture.ts` states exactly
 * what that leaves and why.
 */
const CAPTURE_FILE = process.env.DRIVE_CAPTURE_FILE;
const recorder = CAPTURE_FILE
  ? createRecordingTransport(googleDriveTransport(tokens))
  : undefined;
const transport = recorder ? recorder.transport : googleDriveTransport(tokens);

/** The first native editor file under the root, or the one that was named. */
async function pickDocument(): Promise<DriveFile> {
  const named = process.env.DRIVE_FILE_ID;
  if (named) {
    const response = await transport(
      `${BASE}/files/${encodeURIComponent(named)}?fields=id,name,mimeType,modifiedTime`,
    );
    if (!response.ok) {
      fail(`Drive answered ${response.status} for file ${named}: ${await response.text()}`);
    }
    const file = (await response.json()) as DriveFile;
    if (!isNativeEditorFile(file.mimeType)) {
      fail(
        `"${file.name}" is ${file.mimeType}, which is an ordinary file with real bytes — there ` +
          'is nothing to export and nothing to measure. Point DRIVE_FILE_ID at a Google Doc, ' +
          'Sheet or Slide.',
      );
    }
    return file;
  }

  const q = `'${ROOT}' in parents and trashed=false`;
  const fields = 'files(id,name,mimeType,modifiedTime)';
  const response = await transport(
    `${BASE}/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent(fields)}&pageSize=200`,
  );
  if (!response.ok) {
    fail(`Drive answered ${response.status} listing ${ROOT}: ${await response.text()}`);
  }
  const found = ((await response.json()) as DriveFileList).files ?? [];
  // Only the three types the policy can actually export. A Google Form or a
  // Drawing is a native editor file with no export mapping, so picking one
  // would refuse — correctly, and answering a question nobody asked.
  const exportable = NATIVE_EXPORT_TYPES[POLICY as Exclude<GoogleNativeFilePolicy, 'refuse'>];
  const native = found.find((f) => isNativeEditorFile(f.mimeType) && exportable[f.mimeType]);
  if (!native) {
    fail(
      `No Google Doc, Sheet or Slide directly under ${ROOT === 'root' ? 'My Drive' : ROOT} ` +
        '(this listing is that folder only, not its subfolders). Set DRIVE_FILE_ID to one, or ' +
        'point DRIVE_ROOT_FOLDER_ID at a folder that has one — the whole question is about ' +
        'native editor files, so an ordinary file cannot answer it.',
    );
  }
  return native;
}

/**
 * Walk the folder tree once, so the recording covers the thing most likely to
 * be wrong: PATH DERIVATION.
 *
 * A Drive file has no path — only an id and a name — so the natural key the
 * whole ledger turns on is COMPOSED by this connector. That composition is what
 * a replay should gate, and it cannot be gated by a recording of one flat
 * listing of the root. So when a capture is being taken, this asks the
 * connector for the folder tree and then lists the first subfolder, which is
 * exactly the sequence a real pass makes.
 *
 * Only when capturing. Without `DRIVE_CAPTURE_FILE` this would be a handful of
 * API calls spent on nothing, and the byte-stability question does not need
 * them.
 */
async function maybeWalk(): Promise<void> {
  if (!recorder) return;
  const source = new GoogleDriveSource(transport, { rootFolderId: ROOT, nativeFilePolicy: POLICY });

  const folders = await source.listFolders();
  console.log(`  ✔ walked ${folders.length} folder(s) for the recording`);

  // The first folder BELOW the root: `listFolders` always yields the root
  // itself as `''`, and a listing of the root proves nothing about composing a
  // path out of a folder name and a file name.
  const nested = folders.find((f) => f.path !== '');
  if (!nested) {
    console.log(
      '    ⚠ no subfolder under the root, so the recording cannot gate path derivation.',
    );
    console.log(
      '      Point DRIVE_ROOT_FOLDER_ID at a folder that has one, or make a folder with a',
    );
    console.log('      file in it — the derived path is what the ledger keys on.');
    return;
  }

  const { items } = await source.listSince(nested);
  console.log(`  ✔ listed "${nested.path}" — ${items.length} item(s), paths derived
`);
}

async function main(): Promise<void> {
  console.log('\n  Google Drive export byte-stability (workplan 0042 T0 Q3)');
  console.log('  ────────────────────────────────────────────────────────');
  console.log(`  policy   ${POLICY}`);
  console.log(`  root     ${ROOT}`);
  console.log(`  gap      ${GAP_MS} ms\n`);

  // Minting first, and separately, so a credential problem is reported AS a
  // credential problem rather than as a failed listing.
  const token = await tokens.getToken();
  console.log(`  ✔ token minted, scope: ${token.scope ?? '(not reported)'}`);
  if (token.scope && !token.scope.includes('drive.readonly')) {
    console.log(
      '    ⚠ the GRANTED scope is not drive.readonly. The consent screen gave something else, ' +
        'which is worth knowing before a migration runs.',
    );
  }

  await maybeWalk();

  const doc = await pickDocument();
  console.log(`  ✔ document: "${doc.name}" (${doc.mimeType})`);
  console.log(`    id ${doc.id}, last modified ${doc.modifiedTime ?? 'unknown'}\n`);

  // Through the connector, not through a hand-rolled request: the point is to
  // measure what a MIGRATION would store, and that is whatever `fetch` returns.
  const source = new GoogleDriveSource(transport, { rootFolderId: ROOT, nativeFilePolicy: POLICY });
  const item = {
    path: doc.name,
    isDirectory: false,
    size: 0,
    modifiedAt: doc.modifiedTime ?? new Date(0).toISOString(),
    sourceRef: doc.id,
  };

  const first = await source.fetch(item);
  const firstHash = fileContentHash(first.content!);
  console.log(`  export 1  ${first.content!.byteLength} bytes  sha256 ${firstHash.slice(0, 16)}…`);

  await new Promise((resolve) => setTimeout(resolve, GAP_MS));

  const second = await source.fetch(item);
  const secondHash = fileContentHash(second.content!);
  console.log(`  export 2  ${second.content!.byteLength} bytes  sha256 ${secondHash.slice(0, 16)}…\n`);

  if (firstHash === secondHash) {
    console.log('  ✔ STABLE — two exports of an unchanged document produced identical bytes.');
    console.log(`    "${POLICY}" is usable: a second pass over this document creates nothing.`);
    console.log('    Measure the other policy too, and ideally a Sheet and a Slide as well —');
    console.log('    they are different renderers and this result does not speak for them.');
    console.log('\n    Record the result in docs/workplans/0042-google-drive-source.md (T3).\n');
    return;
  }

  const sizeNote =
    first.content!.byteLength === second.content!.byteLength
      ? 'Same LENGTH, different bytes — so something inside the rendering varies (a timestamp, ' +
        'a generated id) rather than the content.'
      : `Different lengths (${first.content!.byteLength} vs ${second.content!.byteLength}).`;

  console.log('  ✖ NOT STABLE — the same unchanged document exported differently twice.');
  console.log(`    ${sizeNote}`);
  console.log(`    "${POLICY}" MUST NOT be enabled for a real migration: contentHash would see a`);
  console.log('    change on every pass, and every document would be re-copied nightly, forever,');
  console.log('    with every write succeeding and nothing looking wrong.');
  console.log('\n    Record this in docs/workplans/0042-google-drive-source.md (T3) and keep the');
  console.log('    default `refuse`. A stable alternative would have to come from somewhere else:');
  console.log("    a stored export hash that ignores the volatile parts, or Drive's own revision");
  console.log('    id as the change signal instead of the bytes.\n');
  process.exitCode = 2;
}

/**
 * Written even when the verdict is NOT STABLE, and especially then: an unstable
 * export is the more interesting recording, because the replay tier is where
 * somebody will eventually ask what changed between two exports.
 */
function writeCapture(): void {
  if (!recorder || !CAPTURE_FILE) return;
  writeFileSync(CAPTURE_FILE, `${JSON.stringify(recorder.capture(), null, 2)}\n`);
  console.log(`  ✔ recorded ${recorder.capture().exchanges.length} exchanges to ${CAPTURE_FILE}`);
  console.log('    Redacted: no names, ids, page tokens or document bytes. Read the top of');
  console.log('    packages/testing/src/drive-capture.ts before committing it anyway.\n');
}

main()
  .then(writeCapture)
  .catch((error: unknown) => {
    // The exchanges up to the failure are worth keeping: a fixture of the calls
    // that DID work, plus the point where it stopped, is what makes a remote
    // failure diagnosable from here.
    writeCapture();
    fail(error instanceof Error ? error.message : String(error));
  });
