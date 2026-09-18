// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Workplan 0123 T4 — the ONE measurement that decides how a shared folder is
 * rendered, and the task's stated FIRST STEP.
 *
 * THE QUESTION. The owner's Sharing page showed 482 rows for what he thinks of
 * as a handful of shared folders, because Drive populates `permissions` on
 * every child of a shared folder as well as on the folder. §5 says we cannot
 * collapse them today, because the scan does not ask for the fields that would
 * let us — no `parents`, and nothing from `permissionDetails`. An inherited
 * grant and a direct one are indistinguishable in what we hold.
 *
 * §5 then names two designs and says which one is right depends on a fact
 * nobody has checked:
 *
 * > *"Google documents `permissions.permissionDetails[].inherited` /
 * > `inheritedFrom` for items in shared drives. What it reports for **My
 * > Drive** items is what decides the design, and it must be checked against
 * > the live API (the owner's account, read-only) rather than assumed."*
 *
 * **This script is that check.** It is deliberately not a unit test and not an
 * integration test: Google Drive cannot be containerised, and the answer is a
 * property of Google's live behaviour rather than of our code. Same tier, same
 * shape and same credential story as `drive-export-stability.ts`, which is how
 * 0042 T0 Q3's three measurements were answered.
 *
 *   pnpm exec tsx scripts/drive-share-inheritance.ts
 *
 * IT WRITES NOTHING. The token is minted with `drive.readonly`
 * (`DRIVE_READONLY_SCOPE`), so it cannot, whatever this script does. It reads
 * metadata only — it never downloads a file's bytes.
 *
 * WHAT IT PRINTS, AND WHAT IT NEVER PRINTS. Folder and file NAMES are printed,
 * because the operator running this needs to recognise their own Drive and the
 * whole output is for their eyes on their own machine. Grantee addresses are
 * NOT: the question is "is this grant inherited", which the addresses do not
 * answer, and a transcript pasted into an issue should not carry the mail
 * addresses of the owner's colleagues. Each grantee is reduced to a stable
 * pseudonym (`person-1`, `domain-1`, `anyone`) that is consistent within a run,
 * so grant SETS can still be compared by eye.
 *
 * ## The three answers it distinguishes, and why three rather than two
 *
 * Hard rule 9: "I could not look" and "there is nothing" must never look the
 * same. `permissionDetails` is documented for shared-drive items, so on a My
 * Drive file there are three outcomes and they mean different things:
 *
 *   REPORTED       the field came back AND carries `inherited` / `inheritedFrom`
 *                  → §5's first design: group children under the folder they
 *                    inherit from, one row per folder, one press.
 *   ABSENT         the field was requested and Drive returned nothing for it
 *                  → §5's fallback: group by `parents` and compare grant sets.
 *   NOT REQUESTABLE the request itself was refused for naming the field
 *                  → also the fallback, and worth telling apart from ABSENT:
 *                    one says Drive has no answer, the other says we asked
 *                    wrongly, and only the second is our bug to fix.
 *
 * Environment. Identical to `drive-export-stability.ts` — the same resolver,
 * so a Drive already measured for export stability needs nothing new set:
 *
 *   managed    DRIVE_CONNECTION_ID, DATABASE_URL, SECRET_ENCRYPTION_KEY,
 *              GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET
 *   appliance  GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN
 *
 * Optional:
 *   DRIVE_SHARE_FOLDER_ID   measure THIS folder rather than searching for one.
 *   DRIVE_SHARE_CHILDREN    how many children to read (default 10). The answer
 *                           needs a handful; a whole folder is somebody's
 *                           quota.
 */

import { createGoogleTokenProvider, googleDriveTransport } from '@openmig/connectors';
import { resolveGoogleClient } from '@openmig/shared';
import { SecretStore } from '@openmig/core/secret-store';
import { Pool } from 'pg';
import {
  resolveMeasurementCredentials,
  type OpenMeasurementRoute,
} from './drive-export-credentials.ts';
import {
  deviation,
  grantSet as grantSetOf,
  inheritanceVerdict,
  pseudonymiser,
  type SharePermission,
} from './drive-share-grouping.ts';

const BASE = 'https://www.googleapis.com/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const PICK_FOLDER = (process.env.DRIVE_SHARE_FOLDER_ID || '').trim();
const CHILD_LIMIT = Number(process.env.DRIVE_SHARE_CHILDREN ?? 10);

function fail(reason: string): never {
  console.error(`\n  REFUSED: ${reason}\n`);
  process.exit(2);
}

const ROUTE = resolveMeasurementCredentials(process.env);
if (ROUTE.route === 'refuse') fail(ROUTE.reason);

/**
 * The same credential bootstrap `drive-export-stability.ts` uses, and for the
 * same reason: nothing secret is typed, and nothing is read out of the database
 * by hand. Kept as its own function rather than imported from that script
 * because that one is a 600-line measurement with its own top-level work — a
 * `import` of it would run the export sampling as a side effect.
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
          'no grant to read a Drive with. Reconnect it through Connect with Google first.',
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

const transport = googleDriveTransport(createGoogleTokenProvider(await credentials(ROUTE)));

async function getJson(url: string): Promise<{ ok: boolean; status: number; body: unknown }> {
  const response = await transport(url);
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { ok: response.ok, status: response.status, body };
}

type Permission = SharePermission;

interface DriveItem {
  readonly id: string;
  readonly name: string;
  readonly mimeType?: string;
  readonly shared?: boolean;
  readonly parents?: readonly string[];
  readonly permissions?: readonly Permission[];
}

/**
 * One pseudonymiser for the whole run — see `drive-share-grouping.ts` for why
 * it is built rather than imported as module state, and what it protects.
 */
const grantee = pseudonymiser();
const grantSet = (item: DriveItem): string[] => grantSetOf(item.permissions ?? [], grantee);

/**
 * Ask for `permissionDetails` and find out what happens.
 *
 * Two requests, deliberately: `files.list` carries `permissions` inline, and
 * `permissions.list` is the endpoint Google documents `permissionDetails` on.
 * If the inline one is silent and the dedicated one answers, that is a fact
 * about which call to make and not about Drive having no answer — exactly the
 * ABSENT / NOT REQUESTABLE split the header describes.
 */
const DETAIL_FIELDS =
  'permissions(id,type,role,emailAddress,domain,permissionDetails(permissionType,inherited,inheritedFrom,role))';

async function permissionsVia(fileId: string): Promise<{
  readonly endpoint: string;
  readonly ok: boolean;
  readonly status: number;
  readonly permissions: readonly Permission[];
  readonly sawDetails: boolean;
  readonly sawSource: boolean;
  readonly error?: string;
}> {
  const fields =
    'permissions(id,type,role,emailAddress,domain,permissionDetails(permissionType,inherited,inheritedFrom,role))';
  const url = `${BASE}/files/${encodeURIComponent(fileId)}/permissions?fields=${encodeURIComponent(fields)}&supportsAllDrives=true`;
  const { ok, status, body } = await getJson(url);
  if (!ok) {
    const message =
      typeof body === 'object' && body !== null
        ? ((body as { error?: { message?: string } }).error?.message ?? JSON.stringify(body))
        : String(body);
    return {
      endpoint: 'permissions.list',
      ok: false,
      status,
      permissions: [],
      sawDetails: false,
      sawSource: false,
      error: message,
    };
  }
  const permissions = ((body as { permissions?: Permission[] }).permissions ?? []) as Permission[];
  return {
    endpoint: 'permissions.list',
    ok: true,
    status,
    permissions,
    sawDetails: permissions.some((p) => p.permissionDetails !== undefined),
    // The GROUPING KEY, counted on its own. `inherited` is a boolean and
    // answers "is this handed down"; only `inheritedFrom` answers "from
    // what", which is the field §5's first design would group on.
    sawSource: permissions.some((p) =>
      (p.permissionDetails ?? []).some((d) => (d.inheritedFrom ?? '').trim() !== ''),
    ),
  };
}

/** The folder this run measures: the one named, or the first shared folder found. */
async function findSharedFolder(): Promise<DriveItem> {
  if (PICK_FOLDER) {
    const fields = `id,name,mimeType,shared,parents,${DETAIL_FIELDS}`;
    const { ok, status, body } = await getJson(
      `${BASE}/files/${encodeURIComponent(PICK_FOLDER)}?fields=${encodeURIComponent(fields)}&supportsAllDrives=true`,
    );
    if (!ok) fail(`DRIVE_SHARE_FOLDER_ID "${PICK_FOLDER}" could not be read (HTTP ${status}).`);
    const item = body as DriveItem;
    if (item.mimeType !== FOLDER_MIME) fail(`"${item.name}" is not a folder.`);
    return item;
  }
  const q = `'me' in owners and trashed=false and mimeType='${FOLDER_MIME}'`;
  const fields = `nextPageToken,files(id,name,mimeType,shared,parents,${DETAIL_FIELDS})`;
  const { ok, status, body } = await getJson(
    `${BASE}/files?q=${encodeURIComponent(q)}&pageSize=100&fields=${encodeURIComponent(fields)}`,
  );
  if (!ok) fail(`Could not list folders (HTTP ${status}).`);
  const folders = ((body as { files?: DriveItem[] }).files ?? []) as DriveItem[];
  // A folder is only useful here if somebody OTHER than the owner can see it:
  // a folder with one `owner` permission and nothing else has no inheritance
  // to report, so a run on one would answer ABSENT for the wrong reason.
  const shared = folders.find(
    (f) => f.shared === true && (f.permissions ?? []).some((p) => p.role !== 'owner'),
  );
  if (!shared) {
    fail(
      `No shared folder found in this Drive (looked at ${folders.length}). This measurement ` +
        'needs one folder shared with at least one other person. Share one, or name it with ' +
        'DRIVE_SHARE_FOLDER_ID.',
    );
  }
  return shared;
}

async function main(): Promise<void> {
  console.log('\n0123 T4 — does Drive report share inheritance on My Drive items?\n');

  const folder = await findSharedFolder();
  const folderGrants = grantSet(folder);
  console.log(`  folder    "${folder.name}"`);
  console.log(`  grants    ${folderGrants.join(', ') || '(none)'}`);

  const childFields = `nextPageToken,files(id,name,mimeType,shared,parents,${DETAIL_FIELDS})`;
  const childQ = `'${folder.id}' in parents and trashed=false`;
  const { ok, status, body } = await getJson(
    `${BASE}/files?q=${encodeURIComponent(childQ)}&pageSize=${CHILD_LIMIT}` +
      `&fields=${encodeURIComponent(childFields)}`,
  );
  if (!ok) fail(`Could not list the folder's children (HTTP ${status}).`);
  const children = ((body as { files?: DriveItem[] }).files ?? []) as DriveItem[];
  if (children.length === 0) {
    fail(
      `"${folder.name}" has no children, so there is nothing to ask about inheritance. ` +
        'Name a folder with files in it via DRIVE_SHARE_FOLDER_ID.',
    );
  }
  console.log(`  children  ${children.length} read (cap ${CHILD_LIMIT})\n`);

  let inlineDetails = 0;
  let endpointDetails = 0;
  let sourcedDetails = 0;
  let endpointRefused: string | undefined;
  let sameGrants = 0;

  for (const child of children) {
    const grants = grantSet(child);
    const diff = deviation(folderGrants, grants);
    if (!diff.deviates) sameGrants += 1;
    const inline = (child.permissions ?? []).some((p) => p.permissionDetails !== undefined);
    if (inline) inlineDetails += 1;

    const via = await permissionsVia(child.id);
    if (!via.ok) endpointRefused ??= `HTTP ${via.status}: ${via.error ?? 'no message'}`;
    if (via.sawDetails) endpointDetails += 1;
    const inlineSource = (child.permissions ?? []).some((p) =>
      (p.permissionDetails ?? []).some((d) => (d.inheritedFrom ?? '').trim() !== ''),
    );
    if (via.sawSource || inlineSource) sourcedDetails += 1;

    const detail = via.permissions.flatMap((p) => p.permissionDetails ?? []);
    const inheritedFlags = detail
      .map((d) =>
        d.inherited === undefined && d.inheritedFrom === undefined
          ? 'no-inheritance-fields'
          : `inherited=${String(d.inherited)}${d.inheritedFrom ? ` from=${d.inheritedFrom === folder.id ? 'THIS FOLDER' : 'other'}` : ''}`,
      )
      .join(', ');

    console.log(`  - "${child.name}"${child.mimeType === FOLDER_MIME ? ' (folder)' : ''}`);
    console.log(`      grants          ${grants.join(', ') || '(none)'}`);
    console.log(
      `      same as folder  ${
        diff.deviates
          ? `NO — a deviation${diff.extra.length ? `, extra: ${diff.extra.join(', ')}` : ''}${diff.missing.length ? `, missing: ${diff.missing.join(', ')}` : ''}`
          : 'yes'
      }`,
    );
    console.log(`      inline details  ${inline ? 'present' : 'absent'}`);
    console.log(
      `      permissions.list ${via.ok ? (via.sawDetails ? inheritedFlags || 'present, empty' : 'answered, no permissionDetails') : `REFUSED (${via.status})`}`,
    );
  }

  /**
   * THE VERDICT, in §5's own words, so whoever reads this output does not have
   * to translate it back into the workplan's two designs.
   */
  console.log('\n  ── verdict ──────────────────────────────────────────────');
  const verdict = inheritanceVerdict({
    inlineDetails,
    endpointDetails,
    sourcedDetails,
    endpointRefused: endpointRefused !== undefined,
  });
  const counts =
    `             inline: ${inlineDetails}/${children.length},` +
    ` permissions.list: ${endpointDetails}/${children.length},` +
    ` with inheritedFrom: ${sourcedDetails}/${children.length}`;
  if (verdict === 'reported') {
    console.log('  REPORTED — Drive returns permissionDetails AND says what each grant');
    console.log('             is inherited from.');
    console.log(counts);
    console.log('  → §5 first design: group children under the folder they inherit from,');
    console.log('    one row per folder with its grantee set and a count, one press.');
  } else if (verdict === 'reported-without-source') {
    console.log('  REPORTED WITHOUT A SOURCE — Drive says a grant IS inherited and will');
    console.log('             not say what from. `inheritedFrom` was requested and did not');
    console.log('             come back, so there is no key to group on.');
    console.log(counts);
    console.log('  → §5 FALLBACK, not the first design: group by `parents` and compare');
    console.log('    grant sets. `inherited` is still worth reading as CONFIRMATION of a');
    console.log('    grouping made on parents — never as the grouping itself.');
    if (inlineDetails === 0 && endpointDetails > 0) {
      console.log('  → and note the split above: the details are on permissions.list only,');
      console.log('    which is ONE REQUEST PER ITEM. `parents` rides along on the listing');
      console.log('    the scan already makes, so the fallback is also the cheaper design.');
    }
  } else if (verdict === 'not-requestable') {
    console.log('  NOT REQUESTABLE — the request naming permissionDetails was refused:');
    console.log(`             ${endpointRefused}`);
    console.log('  → this is OUR bug before it is a design decision: the field name or the');
    console.log('    call is wrong. Fix the ask, run again, and only then choose a design.');
  } else {
    console.log('  ABSENT — Drive answered and reported no permissionDetails at all.');
    console.log('  → §5 fallback: group by `parents` and compare grant sets. On this run');
    console.log(`    ${sameGrants}/${children.length} children carried EXACTLY the folder's grants,`);
    console.log(`    and ${children.length - sameGrants} deviated — the deviations are the rows that`);
    console.log('    must stay listed separately, never folded into the folder.');
  }
  console.log('  ─────────────────────────────────────────────────────────');
  console.log('\n  Paste this output into workplan 0123 §5 and the T4 row.\n');
}

await main();
