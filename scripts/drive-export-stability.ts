// Copyright 2026 The Ownpace authors (Apache-2.0)

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
 * WHEN IT SAYS NOT STABLE IT ALSO SAYS WHERE. A `.docx` and a `.odt` are zip
 * containers, and a zip's index already records a CRC-32 per member, so the
 * run names the members that moved instead of leaving the operator to guess —
 * see `drive-export-members.ts`, which also explains why reading the index
 * rather than the members keeps the promise this script makes about a
 * customer's documents. A `.pdf` is not a zip and the run says so rather than
 * pretending it looked.
 *
 *   pnpm exec tsx scripts/drive-export-stability.ts
 *
 * Environment. BOTH EDITIONS, because both need this verdict and neither keeps
 * its credentials where the other does (`drive-export-credentials.ts` says why
 * the managed half was missing until 2026-09-14):
 *
 *   managed — nothing secret is typed, and nothing is read out of the database
 *   by hand:
 *
 *   DRIVE_CONNECTION_ID     the Google connection to read the Drive as. Its
 *                           refresh token is decrypted here through the same
 *                           secret store the API uses.
 *   DATABASE_URL            the stack that connection lives in.
 *   SECRET_ENCRYPTION_KEY   as the API already has it — without it the stored
 *                           grant cannot be decrypted.
 *   GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET
 *                           the deployment's own client, already set for
 *                           Connect with Google. A connection carrying its own
 *                           pair overrides them, as at every other door.
 *
 *   appliance — unchanged, and still the override on managed for a Drive with
 *   no connection row yet:
 *
 *   GOOGLE_CLIENT_ID        with GOOGLE_CLIENT_SECRET; half a pair is refused
 *   GOOGLE_CLIENT_SECRET    rather than completed from the deployment's
 *   GOOGLE_REFRESH_TOKEN    delegated, for the account whose Drive this reads
 *   DRIVE_FILE_ID           optional — a specific Doc/Sheet/Slide. Unset means
 *                           "find the first native editor file under the root",
 *                           which is what most people want and nobody wants to
 *                           look up by hand.
 *   DRIVE_FILE_KIND         optional — `doc`, `sheet` or `slide`: measure the
 *                           first file OF THAT KIND under the root, so nobody
 *                           has to look an id up in a browser to measure the
 *                           other two renderers. `DRIVE_FILE_ID` wins when both
 *                           are set. A typo REFUSES rather than falling back —
 *                           see `drive-export-choose.ts` for why, and for the
 *                           run that made it necessary.
 *   DRIVE_PICK              optional — `largest`: instead of taking the FIRST
 *                           file of the kind, export every candidate ONCE and
 *                           measure the biggest. A measurement is only as wide
 *                           as the document it was taken on, and "the first
 *                           one found" is a document nobody chose: the Slides
 *                           deck that answered `export-pdf` on 2026-09-16
 *                           rendered to 2017 bytes, which is a deck with very
 *                           little in it to be unstable about. This finds a
 *                           document with something in it WITHOUT anybody
 *                           pasting an id, which is the other half of why it
 *                           exists — a placeholder in a command block is a
 *                           command that gets run verbatim.
 *   DRIVE_PICK_LIMIT        optional — how many candidates `largest` may
 *                           export to choose between. Default 25. Each one
 *                           costs a real export, so this is a spend, and it is
 *                           capped rather than unbounded.
 *   DRIVE_ROOT_FOLDER_ID    optional — where to search. Unset means My Drive.
 *   DRIVE_EXPORT_POLICY     optional — `export-office` (default), `export-odf`
 *                           or `export-pdf`. Measure EACH before trusting any:
 *                           they are different renderers and one can be stable
 *                           while another is not.
 *   DRIVE_EXPORT_GAP_MS     optional — pause between exports, default 3000. A
 *                           longer gap is a stronger test: an export that is
 *                           stable back-to-back because it was cached for four
 *                           seconds is not stable.
 *   DRIVE_EXPORT_SAMPLES    optional — how many times to export, default 5,
 *                           minimum 2. TWO IS NOT ENOUGH when the wobble is
 *                           small: `export-odf` was measured moving inside a
 *                           four-byte window, and two draws of that can collide
 *                           and read as stable. See `drive-export-verdict.ts`.
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
import {
  fileContentHash,
  resolveGoogleClient,
  type GoogleNativeFilePolicy,
} from '@openmig/shared';
import { SecretStore } from '@openmig/core/secret-store';
import { createRecordingTransport } from '@openmig/testing/drive-capture';
import { writeFileSync } from 'node:fs';
import { Pool } from 'pg';
import {
  resolveMeasurementCredentials,
  type OpenMeasurementRoute,
} from './drive-export-credentials.ts';
import {
  compareMembers,
  containerNormalisedHash,
  readZipMembers,
  type ZipMember,
} from './drive-export-members.ts';
import { KIND_MIME_TYPES, candidatesToWeigh, chooseFile, readKind } from './drive-export-choose.ts';
import { stabilityVerdict, type ExportSample } from './drive-export-verdict.ts';

const ROOT = process.env.DRIVE_ROOT_FOLDER_ID || 'root';
const GAP_MS = Number(process.env.DRIVE_EXPORT_GAP_MS ?? 3000);
const SAMPLES = Number(process.env.DRIVE_EXPORT_SAMPLES ?? 5);
const POLICY = (process.env.DRIVE_EXPORT_POLICY || 'export-office') as GoogleNativeFilePolicy;
const PICK = (process.env.DRIVE_PICK || '').trim().toLowerCase();
const PICK_LIMIT = Number(process.env.DRIVE_PICK_LIMIT ?? 25);
const KIND_READ = readKind(process.env.DRIVE_FILE_KIND);
const BASE = 'https://www.googleapis.com/drive/v3';

/**
 * Whether the recording machinery below exists yet.
 *
 * `fail()` is reached from TWO eras of this module and only one of them has a
 * recorder. The refusals for a bad environment run at import time, ABOVE the
 * `const`s that `writeCapture` reads — and reading a `const` before its line
 * has run is not `undefined`, it throws:
 *
 *   ReferenceError: Cannot access 'recorder' before initialization
 *
 * The operator gets a stack trace naming line 373 instead of the sentence
 * saying which variable they are missing, and the refusal that was written to
 * help them is the thing that hides it. Found on the owner's stack 2026-09-15,
 * on the first managed run of this script.
 *
 * A flag rather than a `typeof` check, because `typeof` on a const in its dead
 * zone throws too — there is no way to ASK whether one is ready, only to have
 * been told.
 */
let recordingReady = false;

function fail(message: string): never {
  // The capture is written FIRST, and that ordering is the fix for a real hole:
  // `fail()` exits the process rather than throwing, so every refusal reached
  // from inside `main()` — a 404 for a named file, a folder with no Doc in it,
  // a 403 for the wrong scope — used to pre-empt the `.catch()` that writes the
  // recording. Those are the likeliest outcomes of a first run against a real
  // tenant, and they are the ones whose recording is most worth having.
  writeCapture({ partial: true });
  console.error(`\n  ✖ ${message}\n`);
  process.exit(1);
}

const ROUTE = resolveMeasurementCredentials(process.env);
if (ROUTE.route === 'refuse') fail(ROUTE.reason);
if (POLICY !== 'export-odf' && POLICY !== 'export-office' && POLICY !== 'export-pdf') {
  fail(
    `DRIVE_EXPORT_POLICY must be "export-odf", "export-office" or "export-pdf" ` +
      `(got "${POLICY}").`,
  );
}
if (!Number.isInteger(SAMPLES) || SAMPLES < 2) {
  // Refused rather than clamped. One draw cannot disagree with anything, so a
  // run with SAMPLES=1 would report STABLE over every policy ever measured —
  // the one verdict this script must never produce by accident.
  fail(
    `DRIVE_EXPORT_SAMPLES must be a whole number of at least 2 ` +
      `(got "${process.env.DRIVE_EXPORT_SAMPLES}"). Two exports cannot disagree if only one ` +
      `is taken.`,
  );
}
if (!KIND_READ.ok) {
  // Refused rather than fallen back from, and refused HERE rather than beside
  // the read at the top of the file: `fail()` touches the recorder, which does
  // not exist until `recordingReady` is set below it. A typo quietly measuring
  // "whatever was first" would file a Doc's stability under a Sheet's heading,
  // which is the same shape of wrong answer as the run that made
  // `DRIVE_FILE_KIND` necessary at all.
  fail(KIND_READ.reason);
}
const KIND = KIND_READ.file;

/**
 * The refresh token, from wherever this edition keeps it.
 *
 * On the `connection` route nothing is read out by a person: the row names the
 * grant and `SecretStore` decrypts it here, on the box, with the same
 * `SECRET_ENCRYPTION_KEY` the API already has. A connection that carries its
 * OWN client pair wins over the deployment's, through the same
 * `resolveGoogleClient` every other door uses — measuring the deployment's
 * application against a Drive granted to a different one would answer a
 * question nobody asked.
 */
async function credentials(
  route: OpenMeasurementRoute,
): Promise<{ clientId: string; clientSecret: string; refreshToken: string }> {
  if (route.route === 'env') return route;

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const { rows } = await pool.query<{ kind: string; secret_ref: unknown }>(
      `SELECT kind, secret_ref FROM connection WHERE id = $1`,
      [route.connectionId],
    );
    const row = rows[0];
    if (!row) {
      fail(
        `No connection with id "${route.connectionId}" in this database. The id is the one ` +
          'the Connections page shows, and DATABASE_URL must point at the same stack.',
      );
    }
    if (!row.secret_ref) {
      fail(
        `Connection "${route.connectionId}" (${row.kind}) stores no credentials, so there is ` +
          'no grant to measure with. Reconnect it through Connect with Google first.',
      );
    }
    const stored = SecretStore.decryptCredentials(row.secret_ref as object);
    const refreshToken = (stored['refreshToken'] ?? '').trim();
    if (!refreshToken) {
      fail(
        `Connection "${route.connectionId}" (${row.kind}) holds credentials but no ` +
          'refreshToken, so it is not an OAuth grant this can read a Drive with. A Google ' +
          'account connected through Connect with Google has one.',
      );
    }
    // `sent` wins, exactly as at every other door (ADR-0041).
    const client = resolveGoogleClient(
      { clientId: stored['clientId'], clientSecret: stored['clientSecret'] },
      process.env,
    );
    if (!client.ok) fail(client.reason);
    return { clientId: client.clientId, clientSecret: client.clientSecret, refreshToken };
  } finally {
    await pool.end();
  }
}

const CREDS = await credentials(ROUTE);
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

/**
 * THE BIGGEST RENDERING OF THE REQUESTED KIND, found by exporting each once.
 *
 * ## Why "biggest", when the question is about stability
 *
 * A green in `EXPORT_STABILITY` is exactly as wide as the document it was taken
 * on, and taking it on whatever Drive listed first means taking it on a
 * document nobody chose. That is how `export-pdf` came to be recorded `stable`
 * for a Slides deck on a deck that renders to **2017 bytes** — a title and not
 * much else, with almost no surface to be unstable about. A deck carrying
 * images, embedded fonts or charts has far more: font subset tags and image
 * recompression are where a PDF renderer is known to differ between draws.
 *
 * Size is a PROXY for that surface, not a measure of it, and saying so matters.
 * A 4 MB deck of one photograph has less varying structure than a 400 KB deck
 * of thirty charts. But it is a proxy available for one export apiece, needing
 * no parsing and no judgement about what "content-rich" means, and it is a very
 * great deal better than first-found.
 *
 * ## Why size is measured rather than read
 *
 * Drive reports NO `size` for a native editor file — a Google Doc has no bytes
 * until somebody asks for some — so there is no field to sort on. The rendering
 * has to exist before it can be weighed, which is why this costs an export per
 * candidate and why `DRIVE_PICK_LIMIT` caps how many.
 *
 * ## What it prints, and what it deliberately does not
 *
 * A count and a size. No names and no ids, exactly as the run below: this
 * output gets pasted into workplans and issues, and a document's name is the
 * most identifying thing about it. The operator knows which Drive they pointed
 * it at.
 */
async function pickLargest(candidates: readonly DriveFile[]): Promise<DriveFile> {
  // Through the connector with the stability refusal lifted, for the same
  // reason the measurement below does it: this is the instrument, and a
  // candidate the table calls `unstable` is still a candidate for measuring.
  const source = new GoogleDriveSource(
    transport,
    { rootFolderId: ROOT, nativeFilePolicy: POLICY },
    { exportDespiteMeasuredInstability: true },
  );

  console.log(
    `  weighing ${candidates.length} candidate(s) under "${POLICY}" — one export each, to ` +
      'choose a document with something in it',
  );

  let best: { file: DriveFile; bytes: number } | undefined;
  let refused = 0;
  /**
   * WHY the first failure failed, kept for the case where they all do.
   *
   * Swallowing these entirely made the run lie about its own cause. A grant
   * that expires between the listing and the first export fails EVERY
   * candidate with a 401, and the only sentence left was "none of them could
   * be exported under this policy — try another policy": a setting change
   * proposed for an authentication problem, which is the same wrong-cause
   * failure the refusals in this workplan exist to stop. A per-candidate skip
   * is still right; a silent one is not.
   */
  let firstFailure: string | undefined;
  for (const file of candidates) {
    let got;
    try {
      got = await source.fetch({
        path: file.name,
        isDirectory: false,
        size: 0,
        modifiedAt: file.modifiedTime ?? new Date(0).toISOString(),
        sourceRef: file.id,
      });
    } catch (error) {
      // One candidate failing is not the run failing. A file the grant cannot
      // read, or one Drive declines to render today, simply is not the one
      // being measured — and turning that into a dead run would make the whole
      // option useless on any Drive with a single awkward file in it.
      refused += 1;
      firstFailure ??= error instanceof Error ? error.message : String(error);
      continue;
    }
    const bytes = got.content?.byteLength ?? 0;
    if (!best || bytes > best.bytes) best = { file, bytes };
  }

  if (!best) {
    fail(
      `None of the ${candidates.length} candidate(s) could be exported under "${POLICY}", so ` +
        'there is nothing to measure. The first one failed with:\n\n' +
        `      ${firstFailure ?? 'no error recorded'}\n\n` +
        '    Read that before changing anything. If it is a 401 or a 403 the policy is not the ' +
        'problem and a different one will fail the same way — the grant is what needs ' +
        'attention. If it is Drive declining to render these particular files, try another ' +
        'policy, or unset DRIVE_PICK to measure the first file found instead.',
    );
  }

  console.log(`  ✔ largest renders to ${best.bytes} bytes`);
  if (refused > 0) {
    // THE COUNT IS NOT THE ANSWER, and the owner's run on 2026-09-16 is why:
    // it printed "1 could not be exported" and stopped there, leaving somebody
    // looking at a number with no way to tell whether a file was in a shared
    // drive, was a shortcut, or was refused for a reason that also affects the
    // document about to be measured. The all-failed message below had already
    // learned to carry its cause; this one had not, which made the lesson half
    // applied — the commonest case is one awkward file among several, not all
    // of them failing at once.
    console.log(`    ${refused} of ${candidates.length} could not be exported. The first:`);
    console.log(`      ${firstFailure ?? 'no error recorded'}`);
  }
  console.log('');
  return best.file;
}

/** The first native editor file under the root, or the one that was named. */
async function pickDocument(): Promise<DriveFile> {
  const named = process.env.DRIVE_FILE_ID;
  if (named) {
    if (PICK === 'largest') {
      // Both name a document, and silently letting one win would make the
      // output a lie about which was measured.
      fail(
        'DRIVE_FILE_ID names one document and DRIVE_PICK=largest searches for another, so ' +
          'only one of them can be what gets measured. Set one or the other.',
      );
    }
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

  // THE SEARCH WIDENS FOR `largest`, and only for it. The default stays one
  // folder deep, because "the first file under here" is a promise about a place
  // the operator named. `largest` is a promise about a DOCUMENT instead — the
  // most substantial one the grant can see — and keeping that inside one folder
  // would mean the richest deck in the Drive loses to whatever happens to sit
  // beside it at the top level. An explicit DRIVE_ROOT_FOLDER_ID still pins the
  // parent either way: a named folder is a scope somebody chose.
  const parent = PICK === 'largest' && ROOT === 'root' ? '' : `'${ROOT}' in parents and `;
  const kindFilter =
    PICK === 'largest' && KIND ? `mimeType = '${KIND_MIME_TYPES[KIND]}' and ` : '';
  const q = `${parent}${kindFilter}trashed=false`;
  const fields = 'files(id,name,mimeType,modifiedTime)';
  const response = await transport(
    `${BASE}/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent(fields)}&pageSize=200`,
  );
  if (!response.ok) {
    fail(`Drive answered ${response.status} listing ${ROOT}: ${await response.text()}`);
  }
  const found = ((await response.json()) as DriveFileList).files ?? [];
  // Only the three types the policy can actually export, and only the KIND
  // asked for when one was. A Google Form or a Drawing is a native editor file
  // with no export mapping, so picking one would refuse — correctly, and
  // answering a question nobody asked. See `drive-export-choose.ts`.
  const exportable = NATIVE_EXPORT_TYPES[POLICY as Exclude<GoogleNativeFilePolicy, 'refuse'>];
  const native = found.filter((f) => isNativeEditorFile(f.mimeType));

  if (PICK === 'largest') {
    const candidates = candidatesToWeigh(native, exportable, KIND, PICK_LIMIT);
    if (!candidates.ok) fail(candidates.reason);
    return pickLargest(candidates.file);
  }

  const chosen = chooseFile(
    native,
    exportable,
    KIND,
    ROOT === 'root' ? 'My Drive' : ROOT,
    POLICY,
  );
  if (!chosen.ok) fail(chosen.reason);
  return chosen.file;
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
  // The MIME type and the timestamp, not the name and the id. This output gets
  // pasted into issues and workplans — the docs invite exactly that — and a
  // document's name is the most identifying thing about it. Whoever ran this
  // knows which document they pointed it at.
  console.log(`  ✔ document: ${doc.mimeType}, last modified ${doc.modifiedTime ?? 'unknown'}\n`);

  // Through the connector, not through a hand-rolled request: the point is to
  // measure what a MIGRATION would store, and that is whatever `fetch` returns.
  //
  // WITH THE STABILITY REFUSAL LIFTED, and only that one. The connector refuses
  // what `EXPORT_STABILITY` calls `unstable`, and `EXPORT_STABILITY` is written
  // from THIS SCRIPT'S OUTPUT — so without the exemption the instrument cannot
  // re-take a reading it once took, which also means a red can never go back to
  // green no matter what Google fixes. Every other refusal still applies here:
  // a shortcut has nothing to export, a Form cannot be rendered, and `refuse`
  // refuses.
  const source = new GoogleDriveSource(
    transport,
    { rootFolderId: ROOT, nativeFilePolicy: POLICY },
    { exportDespiteMeasuredInstability: true },
  );
  const item = {
    path: doc.name,
    isDirectory: false,
    size: 0,
    modifiedAt: doc.modifiedTime ?? new Date(0).toISOString(),
    sourceRef: doc.id,
  };

  const samples: ExportSample[] = [];
  // The zip INDEX of each draw, never the draw itself. Taken here, inside the
  // loop, so the document's bytes are eligible for collection the moment the
  // hash and the index have been read off them — this script must not
  // accumulate somebody's documents in memory to answer a question about
  // timestamps. `null` for a rendering that is not a zip, which is the honest
  // answer for `export-pdf` rather than a failure.
  const indexes: (readonly ZipMember[] | null)[] = [];
  for (let i = 0; i < SAMPLES; i += 1) {
    // The gap goes BEFORE each export after the first, so a cached rendering
    // cannot be what makes two of them agree.
    if (i > 0) await new Promise((resolve) => setTimeout(resolve, GAP_MS));
    const got = await source.fetch(item);
    const hash = fileContentHash(got.content!);
    samples.push({ bytes: got.content!.byteLength, hash });
    indexes.push(readZipMembers(got.content!));
    console.log(
      `  export ${i + 1}  ${got.content!.byteLength} bytes  sha256 ${hash.slice(0, 16)}…`,
    );
  }
  console.log('');

  const verdict = stabilityVerdict(samples);

  if (verdict.stable) {
    console.log(`  ✔ STABLE — ${SAMPLES} exports of an unchanged document produced identical bytes.`);
    console.log(`    "${POLICY}" is usable on this evidence: a second pass creates nothing.`);
    console.log('');
    console.log('    READ THE ASYMMETRY. A red verdict here is CONCLUSIVE: one counterexample');
    console.log('    disproves the "every document, every pass" claim a policy needs. A green one');
    console.log(`    is weaker — ${SAMPLES} draws failed to disprove it, which is not the same as`);
    console.log('    proof. Raise DRIVE_EXPORT_SAMPLES if you want more of it, and measure a Sheet');
    console.log('    and a Slide too: different renderers, and this says nothing about them.');
    console.log('\n    Record the result in docs/workplans/0042-google-drive-source.md (T3).\n');
    return;
  }

  console.log(
    `  ✖ NOT STABLE — ${verdict.renderings} different renderings in ${SAMPLES} exports of an ` +
      `unchanged document.`,
  );
  console.log(`    ${verdict.note}`);
  reportMembers(indexes);
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
 * Say WHICH part of the container moved, when the container is one that can be
 * asked.
 *
 * Until this existed, a NOT STABLE verdict ended at "something changed" and the
 * next step was a guess — #963 recorded `export-office` moving with its length
 * pinned at 17644 bytes and had to write down `docProps/core.xml` as a
 * hypothesis, in as many words, because nobody had opened the file. This is the
 * opening, and it costs one read of the zip index.
 *
 * It also prints what the NORMALISED-hash route would have concluded on these
 * same draws, because that route is one of the two candidates 0042 T3 names and
 * an argument about it is much shorter when the number is on the screen.
 */
function reportMembers(indexes: readonly (readonly ZipMember[] | null)[]): void {
  if (indexes.some((index) => index === null)) {
    // Not a failure. A PDF has no members, and saying so beats a silence the
    // reader would have to interpret.
    console.log('    This rendering is not a zip container, so there is no member to name.');
    return;
  }

  const draws = indexes as (readonly ZipMember[])[];
  const comparison = compareMembers(draws);
  console.log(`\n    INSIDE THE CONTAINER — ${comparison.unchanged} member(s) held completely.`);
  console.log(`    ${comparison.note}`);

  const normalised = new Set(draws.map((draw) => containerNormalisedHash(draw)));
  if (normalised.size === 1) {
    console.log(
      '    Ignoring the zip\'s OWN bookkeeping — its stamps and member order — the draws agree.\n' +
        '    So nothing inside the document varies and only the container was rebuilt. That is\n' +
        '    the cheapest failure there is, and the one a rewrite of the container would fix.',
    );
    return;
  }
  console.log(
    `    ${normalised.size} draws still differ once the zip's own stamps and member order are\n` +
      '    ignored, so this is NOT merely a rebuilt container: some member really varies.\n' +
      '    Whether stripping volatile fields from INSIDE that member would settle it is the\n' +
      '    open route in 0042 T3, and this run does not measure it — that needs a parser per\n' +
      '    format and a decision about what may be discarded, which is an ADR, not a script.',
  );
}

/**
 * Written even when the verdict is NOT STABLE, and especially then: an unstable
 * export is the more interesting recording, because the replay tier is where
 * somebody will eventually ask what changed between two exports.
 */
let captureWritten = false;
// Everything `writeCapture` touches now exists. Set HERE, below the last of
// them, rather than beside the recorder: a call landing between the two would
// have cleared the flag's guard and hit this line's own dead zone instead.
recordingReady = true;

function writeCapture(options: { partial?: boolean } = {}): void {
  // Nothing was recorded because nothing could record yet — an environment
  // refusal at import time. There is no capture to write, and saying so is the
  // whole job: the refusal's sentence gets to print.
  if (!recordingReady) return;
  if (!recorder || !CAPTURE_FILE || captureWritten) return;
  captureWritten = true;
  const recording = recorder.capture();
  writeFileSync(CAPTURE_FILE, `${JSON.stringify(recording, null, 2)}\n`);
  // A PARTIAL capture is labelled as one. A truncated recording written with a
  // tick beside it is indistinguishable from a complete one, and the person who
  // later replays it has no way to know the run stopped early.
  const mark = options.partial ? '⚠ PARTIAL —' : '✔';
  console.log(`\n  ${mark} recorded ${recording.exchanges.length} exchange(s) to ${CAPTURE_FILE}`);
  if (options.partial) {
    console.log('    The run did not finish, so this covers only the calls made before it');
    console.log('    stopped. Useful for diagnosis; not a complete fixture.');
  }
  console.log('    Redacted — read the top of packages/testing/src/drive-capture.ts');
  console.log('    before committing it anyway.\n');
}

main()
  .then(() => writeCapture())
  .catch((error: unknown) => {
    // The exchanges up to the failure are worth keeping: a fixture of the calls
    // that DID work, plus the point where it stopped, is what makes a remote
    // failure diagnosable from here.
    writeCapture({ partial: true });
    fail(error instanceof Error ? error.message : String(error));
  });
