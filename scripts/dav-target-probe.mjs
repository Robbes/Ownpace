#!/usr/bin/env node
// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHY THE TARGET LISTING SAW NOTHING — the four ways a DAV count can be zero.
 *
 * E2E (managed) #166 reported `calendar` 81→0, `contacts` 6→0, `tasks` 2→0
 * while `files` copied 65 of 68 through the same mapping. The gate's own hint
 * says why that is hard to read:
 *
 *   "a DAV query the server ACCEPTS and that matches nothing returns an empty
 *    multistatus, which every consumer here reads as 'the collection is
 *    empty'. Check the listing query for that domain before assuming the sync
 *    is at fault."
 *
 * A zero has FOUR possible causes and they need different fixes. This probe
 * separates them by measuring each stage of the same request the reindexer
 * makes, against the real server:
 *
 *   1. NOTHING WAS WRITTEN.        PROPFIND finds no resources either.
 *                                  -> the sync is at fault, not the listing.
 *   2. THE FILTER MATCHES NOTHING. PROPFIND finds resources; the REPORT comes
 *                                  back 207 with zero <response> elements.
 *                                  -> the filter body is wrong for this server.
 *   3. PARTIAL RETRIEVAL IGNORED.  The REPORT returns responses, but none
 *                                  carries the calendar-data/address-data the
 *                                  query asked for. The reindexer's
 *                                  `if (data === undefined) continue` then
 *                                  skips every one of them, silently.
 *                                  -> ask for the whole object, or key off the
 *                                     href.
 *   4. UID UNREADABLE.             Data comes back but no UID can be extracted.
 *                                  -> the reindexer THROWS here rather than
 *                                     miscounting, so this shows as an error
 *                                     in the pass, not as a zero.
 *
 * Read-only: PROPFIND and REPORT, nothing else. It writes nothing and deletes
 * nothing, so it is safe to run against a live stack.
 *
 * PROVENANCE OF THE QUERY BODIES. The CardDAV filter is IMPORTED from
 * `packages/shared/src/carddav-query.ts`, so it cannot drift from what ships.
 * The CalDAV body is reproduced from `caldav-target-writer.ts` (the
 * `calendar-query` in its reindexer listing) and is PRINTED with `--show-xml`
 * so it can be diffed against the source by eye. If those two ever disagree,
 * the probe is the one that is wrong.
 *
 * Usage, from the repo root on the box running the stack:
 *
 *   node scripts/dav-target-probe.mjs
 *   node scripts/dav-target-probe.mjs --user tenant-b-source   # the source side
 *   node scripts/dav-target-probe.mjs --show-xml               # print the queries
 *   node scripts/dav-target-probe.mjs --dump                   # print the answers
 *   node scripts/dav-target-probe.mjs --base http://localhost:8083
 */

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { carddavMatchAllFilter } from '../packages/shared/src/carddav-query.ts';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const SHOW_XML = args.includes('--show-xml');
const DUMP = args.includes('--dump');

/**
 * The LAST assignment of a key in the stack's own .env, like `env_value` in
 * `deploy/compose/env-read.sh` — a file that sets a key twice means the second
 * one, and reading the first would quietly disagree with every other tool here.
 */
export function envValue(key, file = 'deploy/compose/.env') {
  try {
    const lines = readFileSync(file, 'utf8')
      .split('\n')
      .filter((l) => l.startsWith(`${key}=`));
    const last = lines[lines.length - 1];
    if (last === undefined) return undefined;
    // `KEY="value"` and `KEY=value` both occur in these files.
    return last.slice(key.length + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
  } catch {
    return undefined;
  }
}

/**
 * THE PUBLISH MOVED AND THE CALLER STAYED AT LOCALHOST.
 *
 * `smoke-managed.sh` reads NEXTCLOUD_BIND for exactly this reason and says so
 * in its own words: "an operator who binds the DAV backend to a private mesh
 * address (NEXTCLOUD_BIND, for browsing it over the VPN) would otherwise leave
 * every assertion below curling a loopback address nothing listens on any
 * more". The first draft of this probe read the PORT and not the BIND, and on
 * the reference box — where Nextcloud publishes on a Tailscale address —
 * answered `fetch failed` three times for a server that was up and healthy.
 *
 * A diagnostic that cannot reach the thing it diagnoses reports the same
 * "could not reach it" whether the service is down or the probe is looking in
 * the wrong place, which is the one answer it must never be able to give by
 * accident.
 */
const PORT = envValue('NEXTCLOUD_PORT') || '8083';
const HOST = envValue('NEXTCLOUD_BIND') || 'localhost';
const BASE = flag('base', `http://${HOST}:${PORT}`);
const USER = flag('user', process.env.SMOKE_TARGET_DAV_USER || 'tenant-b-target');
const PASS = flag('pass', process.env.SMOKE_TARGET_DAV_PASSWORD || 'tenant_b_target_pw');
// `seed-demo-dav-content.sh` — what the MANAGED gate runs — defaults to
// openmig-tasks. `test/e2e/seed-dav-source.mjs`, the SELFHOST lane, defaults to
// e2e-tasks, and taking that one made this probe ask a real server about a
// collection nobody had created. It answered 404, which the probe reported as
// "the filter body is rejected outright" — a confident wrong answer about a
// query that was never the problem.
const TASK_LIST =
  process.env.DAV_TASK_COLLECTION || process.env.SEED_DAV_TASK_LIST || 'openmig-tasks';

const auth = 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64');

/**
 * What a non-207 answer actually means, per status class.
 *
 * EVERY refusal used to read "the filter body is rejected outright", which is
 * true of a 400 and a confident lie about everything else. Both halves of that
 * lie were met on the real Spark on 2026-09-09: a `--user` passed without a
 * `--pass` answered 401 and was reported as a rejected filter, and a task
 * collection nobody had created answered 404 and was reported as a rejected
 * filter. In each case the tool named the one thing that was working and sent
 * the reader to rewrite it.
 *
 * So the status is read rather than assumed, and the default names the status
 * instead of guessing — an unrecognised refusal is a refusal this tool has not
 * learned yet, which is a different statement from any of the four below.
 */
export function refusal(status) {
  if (status === 401 || status === 403) {
    return (
      'CREDENTIALS REFUSED — the query never ran, so it cannot be at fault. ' +
      'Check --user/--pass (or SMOKE_TARGET_DAV_USER / SMOKE_TARGET_DAV_PASSWORD); ' +
      'passing one of the pair alone leaves the other at its default.'
    );
  }
  if (status === 404) {
    return (
      'NO SUCH COLLECTION — nothing was ever created at this path, so there is ' +
      'nothing for a filter to match. For the task list this is the seeder ' +
      'vocabulary: deploy/compose/seed-demo-dav-content.sh writes ' +
      'DAV_TASK_COLLECTION (openmig-tasks) and test/e2e/seed-dav-source.mjs ' +
      'writes SEED_DAV_TASK_LIST (e2e-tasks).'
    );
  }
  if (status === 405 || status === 501) {
    return 'METHOD NOT AVAILABLE HERE — the server does not serve this report at this path.';
  }
  if (status === 400 || status === 415) {
    return 'THE FILTER BODY IS REJECTED outright, not merely unmatched.';
  }
  return `REFUSED WITH ${status} — this tool has no reading for that status; the body below is the whole of what is known.`;
}

/** The reindexer's calendar-query — see PROVENANCE above. */
function calendarQuery(component) {
  return `<?xml version="1.0" encoding="utf-8"?>
      <C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
        <D:prop>
          <D:getetag/>
          <D:getcontentlength/>
          <C:calendar-data>
            <C:comp name="VCALENDAR">
              <C:comp name="${component}">
                <C:prop name="UID"/>
              </C:comp>
            </C:comp>
          </C:calendar-data>
        </D:prop>
        <C:filter>
          <C:comp-filter name="VCALENDAR">
            <C:comp-filter name="${component}"/>
          </C:comp-filter>
        </C:filter>
      </C:calendar-query>`;
}

function addressbookQuery() {
  return `<?xml version="1.0" encoding="utf-8"?>
      <C:addressbook-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
        <D:prop>
          <D:getetag/>
          <C:address-data/>
        </D:prop>
        ${carddavMatchAllFilter('C')}
      </C:addressbook-query>`;
}

const PROPFIND_BODY = `<?xml version="1.0" encoding="utf-8"?>
  <D:propfind xmlns:D="DAV:"><D:prop><D:getetag/><D:resourcetype/></D:prop></D:propfind>`;

async function dav(method, url, body, depth) {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: auth,
      Depth: depth,
      'Content-Type': 'application/xml; charset=utf-8',
    },
    body,
  });
  return { status: res.status, text: await res.text() };
}

/**
 * Count <response> elements, and how many CARRY the payload we asked for.
 *
 * Opening tags only — `(?!\/)` after the `<`. Counting bare occurrences of the
 * name doubles every figure, because `</d:response>` matches a pattern meant
 * for `<d:response>`; the self-test below caught exactly that.
 *
 * "Carries" is measured as non-empty content between the open and close tags,
 * not as the element's presence. A server answering a partial-retrieval it
 * will not satisfy returns `<cal:calendar-data/>` inside a 404 propstat — the
 * element IS there and holds nothing, which is the case this probe exists to
 * tell apart from a genuine payload.
 */
export function measure(xml, dataLocalName) {
  const responses = [...xml.matchAll(/<(?!\/)[^:>\s]*:?response[\s>]/gi)].length;
  const paired = new RegExp(
    `<(?!\\/)[^>]*?${dataLocalName}[^>]*?(?<!\\/)>([\\s\\S]*?)<\\/[^>]*?${dataLocalName}\\s*>`,
    'gi',
  );
  const withData = [...xml.matchAll(paired)].filter((m) => (m[1] ?? '').trim() !== '').length;
  const uids = [...xml.matchAll(/UID:([^\r\n]+)/g)].length;
  return { responses, withData, uids };
}

/**
 * MEMBERS of the collection — the collection itself answers a Depth:1 PROPFIND
 * too, and counting it turns an empty collection into "1 resource".
 *
 * By path depth, not by file extension. The first draft filtered on `.vcf` and
 * `.ics`; a server free to name its resources anything then reported an
 * addressbook holding cards as empty, and the verdict below believed it. What
 * makes something a member is that its path sits UNDER the collection's, which
 * is true whatever the server calls it.
 */
export function propfindMembers(xml, collectionPath) {
  const base = decodeURIComponent(collectionPath).replace(/\/+$/, '');
  const hrefs = [...xml.matchAll(/<(?!\/)[^:>\s]*:?href[^>]*>([^<]+)</gi)].map((m) =>
    decodeURIComponent((m[1] ?? '').trim()).replace(/\/+$/, ''),
  );
  return hrefs.filter((h) => h !== base && h.includes(`${base}/`)).length;
}

const DOMAINS = [
  {
    name: 'calendar',
    path: `calendars/${USER}/personal`,
    body: () => calendarQuery('VEVENT'),
    data: 'calendar-data',
  },
  {
    name: 'tasks',
    path: `calendars/${USER}/${TASK_LIST}`,
    body: () => calendarQuery('VTODO'),
    data: 'calendar-data',
  },
  {
    name: 'contacts',
    path: `addressbooks/users/${USER}/contacts`,
    body: () => addressbookQuery(),
    data: 'address-data',
  },
];

/**
 * Only when RUN, never when imported — the guard beside this file imports the
 * two counters, and a module that probes at import time would fire HTTP
 * requests from a unit test.
 */
async function main() {
  console.log(`probing ${BASE}/remote.php/dav as ${USER}\n`);

  let anyVerdict = false;
  for (const d of DOMAINS) {
    const url = `${BASE}/remote.php/dav/${d.path}`;
    console.log(`--- ${d.name} — ${d.path} ---`);
    if (SHOW_XML) console.log(d.body(), '\n');

    let ground, report;
    try {
      ground = await dav('PROPFIND', url, PROPFIND_BODY, '1');
      report = await dav('REPORT', url, d.body(), '1');
    } catch (err) {
      console.log(`  could not reach it: ${err.message}\n`);
      continue;
    }

    // THE GROUND TRUTH HAS TO BE TRUE. A PROPFIND that was refused parses to
    // zero members exactly like an empty collection does, and `present === 0`
    // is the first test the verdict chain makes — so an unread status here
    // turns "I was not allowed to look" into "(1) NOTHING WAS WRITTEN". That is
    // the confident wrong answer this whole tool exists to stop producing.
    if (ground.status !== 207) {
      console.log(`  PROPFIND  HTTP ${ground.status} — the collection could not be listed at all`);
      console.log(`  VERDICT   ${refusal(ground.status)}`);
      console.log(`            body: ${ground.text.slice(0, 300).replace(/\s+/g, ' ')}\n`);
      anyVerdict = true;
      continue;
    }

    const present = propfindMembers(ground.text, new URL(url).pathname);
    console.log(
      `  PROPFIND  HTTP ${ground.status} — ${present} member(s) actually in the collection`,
    );

    if (report.status !== 207) {
      console.log(`  REPORT    HTTP ${report.status} — the server REFUSED the listing query`);
      console.log(`  VERDICT   ${refusal(report.status)}`);
      console.log(`            body: ${report.text.slice(0, 300).replace(/\s+/g, ' ')}\n`);
      anyVerdict = true;
      continue;
    }

    const m = measure(report.text, d.data);
    console.log(`  REPORT    HTTP 207 — ${m.responses} <response>, ${m.withData} with <${d.data}>, ${m.uids} UID line(s)`);

    let verdict;
    if (present === 0 && m.withData > 0) {
      // The two measurements contradict each other, and picking one would be a
      // guess wearing a verdict's clothes. Seen for real on 2026-09-09: the
      // member count said the addressbook was empty while the REPORT returned a
      // card with data, because that count was filtering on a file extension.
      // The probe now says so and prints both bodies instead of answering.
      verdict =
        'CONTRADICTION — PROPFIND found no members, but the REPORT returned ' +
        `${m.withData} with data. One of the two is wrong; the bodies are below.`;
    } else if (present === 0) {
      verdict = '(1) NOTHING WAS WRITTEN — the collection really is empty. The sync is at fault, not the listing.';
    } else if (m.responses === 0) {
      verdict = `(2) THE FILTER MATCHES NOTHING — ${present} resource(s) are there and the REPORT returned none. The filter body is wrong for this server.`;
    } else if (m.withData === 0) {
      verdict = `(3) PARTIAL RETRIEVAL IGNORED — ${m.responses} response(s) came back with no <${d.data}>. The reindexer skips every one of them silently (\`if (data === undefined) continue\`), so it counts 0.`;
    } else if (m.uids === 0) {
      verdict = '(4) UID UNREADABLE — data came back but carries no UID line. The reindexer throws here rather than miscounting.';
    } else {
      verdict = `OK — ${m.responses} listed, ${m.withData} with data, ${m.uids} UID(s). This domain would count correctly.`;
    }
    console.log(`  VERDICT   ${verdict}`);
    if (DUMP || verdict.startsWith('CONTRADICTION')) {
      console.log(`  --- PROPFIND answer ---\n${ground.text}`);
      console.log(`  --- REPORT answer ---\n${report.text}`);
    }
    console.log('');
    anyVerdict = true;
  }

  if (!anyVerdict) {
    console.log('nothing was probed — check --base and the credentials.');
    process.exit(1);
  }
  console.log('read-only: this probe sent PROPFIND and REPORT only, and wrote nothing.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
