// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A VISIT COUNT THAT KEPT THE VISITOR (the owner, 2026-10-05: *"go with
 * GoAccess on the logs and the sentence. id and status we skip for now, no
 * netbird api tokens..."*; privacy §4.5, §5 and §9).
 *
 * Privacy §4.5 says: *"From these logs we also count visits to this website
 * (pages, the site you came from, the kind of browser), as totals only, which
 * identify nobody."* The counting is GoAccess, reading the access log live's
 * copy of `www.ownpace.eu` already writes (`deploy/compose/www-nginx.conf`,
 * format `ownpace_site`), on the machine: no script, cookie or banner on the
 * page, nothing leaving the machine, nothing counted on `app.`, `id.` or
 * `status.ownpace.eu`, and no NetBird API token.
 *
 * THE OBVIOUS RUN WOULD HAVE MADE THE SENTENCE FALSE. GoAccess's own way to
 * keep totals across runs is `--persist --restore --db-path`, and its own way
 * to hide addresses is `--anonymize-ip`. Read in its source at the tag
 * `v1.12` (github.com/allinurl/goaccess, `ef3c4f3c`):
 *
 *   - `--persist` writes, for every day, one fingerprint per visitor: a 64-bit
 *     FNV hash of the full address and the browser string (`visitor_fingerprint`
 *     in `src/util.c`, `U6432_UNIQUE_KEYS.db`), and per panel which of those
 *     visitors asked for which page (`MTRC_UNIQMAP`). Unsalted: anybody holding
 *     the file tries every IPv4 address with a common browser string and learns
 *     who came, when, and what they read. Rows per visitor, not totals.
 *   - `--anonymize-ip` and `--anonymize-level` mask the address only when the
 *     HOSTS panel is drawn (`add_host_to_holder` in `src/gholder.c`). The parser
 *     stores the address whole (`case 'h'` in `src/parser.c`), and so does every
 *     table built from it.
 *   - A log FILE given to GoAccess with `--persist` also has its first 4096
 *     bytes kept, to recognise the file next time (`set_initial_persisted_data`,
 *     `IGLP_LAST_PARSE.db`): the first lines of the log, addresses and all.
 *
 * AND THE ADDRESS WAS NOT THE ONLY THING A REPORT COULD NAME (review,
 * 2026-10-06). GoAccess copies text a visitor or a link chose into its report
 * word for word, and the first version of this script handed it that text:
 *
 *   - the UTM_CAMPAIGNS panel keeps the decoded value of nine `utm_`
 *     parameters (`src/utm.c`), read from the request before
 *     `--no-query-string` cuts it (`src/parser.c`): an email address in a
 *     newsletter's `utm_content`, a name in `utm_term`;
 *   - NOT_FOUND keeps the path of every 404 and REQUESTS the path of any other
 *     status, and nginx answers any path (`try_files ... =404`): a mistyped
 *     personal link, `/invite/<somebody's address>`; and a page of ours asked
 *     for through `/<a name>/../prices.html` is answered 200;
 *   - BROWSERS and OS keep a browser's or a system's version up to `;`, `)`, a
 *     space or a backslash (`parse_browser` in `src/browsers.c`, `src/opesys.c`):
 *     `Firefox/128.0-` and an email address;
 *   - REFERRING_SITES keeps the host of the Referer, which can be an address:
 *     a home server, a NAS, a machine on a mesh.
 *
 * Run through the first version and GoAccess 1.12, each of those stood in the
 * report. So the script hands GoAccess none of them: no query string at all
 * (and UTM_CAMPAIGNS ignored besides), the path only of a request answered
 * 2xx or 3xx and only when it is a plain path of the site, `/(not shown)` for
 * every other; a User-Agent with every version cut to its digits and dots and
 * every word holding a character no browser's own string holds (an `@`, a
 * `%`) left out whole; and `(an address)` for a referring site that is one. Privacy §4.5's comment on
 * the branch of 0139's privacy 1.2 lists the same, as the run's contract.
 *
 * AND THE TIME WAS THE VISITOR'S TO CHOOSE (2026-10-22, #1675). nginx writes
 * `$remote_user` from any Basic Authorization header, though the site asks for
 * none, escaping only quotes, backslashes and bytes below 32 or above 126 (the
 * default escaping, which `ownpace_site` uses). The filter took the time from
 * the FIRST bracketed group of the line's first piece, so a user
 * `[jan.devries at example dot nl]` was the time GoAccess was given (typed text
 * in GoAccess's input), a user `[01/Jan/2020:00:00:00 +0000]` dated the visit
 * in 2020, and a user `[marie`, opened and never closed, made its bracket and
 * nginx's time one group. Now the first piece must END in nginx's own
 * `$time_local`, in its exact shape, the time is taken from there, and a line
 * that does not end so is not an access line. The user is never handed on.
 *
 * AND IT COUNTS ONLY WHAT THE POLICY SAYS. The script reads the checkout's
 * own `site/legal/privacy.md` and `privacy.nl.md`, the texts the site
 * publishes, and refuses (exit 2, nothing read) while either lacks §4.5's
 * sentence or §5's purpose, outside a comment: this branch and privacy 1.2
 * merge apart, and live's duty runs from the tag it serves, so the counting
 * never starts before the text that discloses it.
 *
 * WHAT IS ASSERTED, by running the real script with `docker` replaced by a
 * stub whose GoAccess is the worst one possible: it puts everything it is
 * given into its report, and on failure quotes every line of it.
 *
 *   - GoAccess is given exactly the requests that came through the public
 *     name, each in the combined format with a number for a host; the same
 *     visitor gets the same number; no address, no first field, no user, no
 *     query string, no path of a request that found no page of ours, a
 *     referrer cut to its site (or `(an address)`), a User-Agent cut to its
 *     versions, and nginx's own time, never a bracketed text a user put before
 *     it; a line whose first piece does not end in that time is not a request.
 *     Not the status page's Website row, which asks through the public name
 *     every 60 seconds as `Gatus/1.0` (`gatus.yaml`; Gatus's own User-Agent at
 *     v5.37.0): it is ours, not a visit.
 *   - No address from the recorded log (the visitors', NetBird's, the
 *     healthcheck's, the one in nginx's error line, a Referer's) and nothing a
 *     link, a path or a browser string said about a person appears in anything
 *     the script prints or writes, or in what GoAccess was given: on success,
 *     on GoAccess's failure, and on `docker logs`' failure. Of GoAccess's own
 *     words, only those that quote nothing are shown.
 *   - No copy of the log exists while GoAccess reads it: the filter streams
 *     into it, so a run killed outright leaves none behind.
 *   - The flags: HOSTS, GEO_LOCATION, ASN, REFERRERS, REMOTE_USER and
 *     UTM_CAMPAIGNS ignored; `--anonymize-ip --anonymize-level=3`, which change
 *     nothing while HOSTS is ignored and its hosts are numbers, and say so if a
 *     later edit drops the panel's ignore; `--no-query-string`,
 *     `--ignore-crawlers`, `--log-format=COMBINED`, `--no-ip-validation`,
 *     `--no-global-config`, `--no-progress`. Never `-o`: GoAccess 1.12 checks
 *     that the directory of an `-o` path is writable (`is_writable_path`,
 *     `src/util.c`), even `-o html`'s `.`, and refuses as the image's user on
 *     a read-only disk; with no `-o` and its output not a terminal it writes
 *     its HTML there. Never `--persist`, `--restore`, `--db-path`,
 *     `--keep-last`, an agent list, a real-time server, a resolver or a GeoIP
 *     database.
 *   - The image is pinned by digest, and runs with `--network none`,
 *     read-only, as `65534:65534` with every capability dropped and no new
 *     privileges, with no port and nothing mounted but the image's own empty
 *     volume (`a-service-that-phones-home` names it too).
 *   - One report per container of the site, under live's persistent
 *     directory (`~/.persistent/<project>/site-visits/`), and nothing else
 *     left there: a deploy recreates the container and its log, and the
 *     earlier report stays beside the new one.
 *   - It refuses the OTA stack's `.env`, a project the reader refuses, a
 *     switch that is neither true nor false, an argument, and a privacy text
 *     without the sentence, before asking Docker anything; and while
 *     `WWW_LIVE` is not true it reads nothing and says so.
 *   - A failure is one: no container, `docker logs`, `docker run` or GoAccess
 *     failing, or a report that is not HTML, each exits 1, and an earlier
 *     report is kept.
 *   - The site's take-down in `docs/managed-bring-up.md` deletes the reports
 *     (privacy §9 on 0139's branch: the totals are kept "as long as we run
 *     this website").
 *
 * WHAT THIS CANNOT SEE. Docker, and GoAccess's reading of the lines. On
 * 2026-10-06 the pinned digest was read back from Docker Hub (a HEAD of the
 * tag `1.12` returns it: the index of the amd64 and arm64 images), and the
 * amd64 image's own `/usr/bin/goaccess`, from its layers, was run through
 * this script in place of `docker run`: as 65534:65534, under `setpriv
 * --no-new-privs`, on its own root file system mounted read-only, in a network
 * namespace with no interface. That run found the `-o` refusal above. With
 * the fix it took every flag, accepted every line this file's log became as
 * it was then, and wrote HTML in which none of this file's addresses or
 * personal words appears. The three lines GoAccess is given for the Basic
 * users added on 2026-10-22 were not run through it; they are of the same
 * combined shape as the others, with nginx's own time. Docker's own
 * `--read-only`, `--network none` and `--cap-drop ALL`, and the arm64 image,
 * were not run. The first run on the machine is that check
 * (`docs/managed-bring-up.md`, *Counting its visits*).
 *
 * Addresses here are documentation shapes: the placeholder `100.64.0.1` for
 * NetBird's on the mesh (`an-address-that-was-not-an-example`), RFC 5737's and
 * RFC 3849's for everything else.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE_DIR = join(ROOT, 'deploy/compose');
const SCRIPT_REL = 'deploy/compose/site-visits.sh';

const tempDirs: string[] = [];
// Many large temp folders can outlast vitest's 10 s hook timeout on a loaded run.
afterAll(() => {
  for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
}, 120_000);

/** NetBird's proxy on the mesh, the repository's placeholder: the first field of every line that came through the public name. */
const NETBIRD = '100.64.0.1';
const VISITOR_A = '198.51.100.23';
const VISITOR_B = '203.0.113.45';
const VISITOR_C = '2001:db8::5';
const VISITOR_D = '198.51.100.61';
const VISITOR_E = '203.0.113.77';
const VISITOR_F = '2001:db8::f00d';
/** Where the deploy's own check on loopback comes from: Docker's gateway, in a documentation shape. */
const GATEWAY = '192.0.2.1';
/** The address in nginx's error line, which `docker logs` hands back on stderr. */
const IN_ERROR_LOG = '203.0.113.99';
/** Where the status page's probe leaves the machine, as NetBird sees it. */
const OWN_FRONT = '198.51.100.200';
/** A home server and a mesh peer a visitor followed a link from: a Referer whose host is an address. */
const REFERRER_V4 = '192.0.2.5';
const REFERRER_V6 = '2001:db8::77';
const ADDRESSES = [
  NETBIRD,
  VISITOR_A,
  VISITOR_B,
  VISITOR_C,
  VISITOR_D,
  VISITOR_E,
  VISITOR_F,
  GATEWAY,
  IN_ERROR_LOG,
  OWN_FRONT,
  REFERRER_V4,
  REFERRER_V6,
  '127.0.0.1',
];
/**
 * What a link, a path, a Referer, a browser string or a Basic user in the
 * recorded log says about a person, or a query string at all: none of it may
 * reach GoAccess, its report, or anything the script prints.
 */
const PERSONAL = [
  'jan.devries',
  'example.nl',
  'marie',
  'tester-0042',
  'klaas.vermeer',
  'henk.jansen',
  'my-notes',
  'newsletter',
  'someone',
  'secret',
  'inbox',
  'utm_',
  '?',
  'contact',
  // Basic users' words, and a bracketed text where nginx's time should end the piece.
  'at example dot nl',
  '01/Jan/2020',
  'typed by a visitor',
];

const FIREFOX = 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0';
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
/** Every version cut to its digits and dots: `Mobile/15E148` is `Mobile/15`. */
const IPHONE_GIVEN =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15 Safari/604.1';
const GOOGLEBOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
/** Its URL cut after `http:/`; GoAccess still knows it by `Googlebot`, and by `; +http`. */
const GOOGLEBOT_GIVEN = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http:/)';
/** Text joined to a version, which GoAccess's browser panel would keep up to the next `;`, `)` or space. */
const FIREFOX_SIGNED = 'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0-jan.devries@example.nl';
const FIREFOX_SIGNED_GIVEN = 'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0';
/** An address as a word of its own: the word is left out whole, not cut at its `@`, which would keep `jan.devries`. */
const FIREFOX_WITH_ADDRESS = 'Mozilla/5.0 (X11; Linux x86_64; jan.devries@example.nl) Gecko/20100101 Firefox/131.0';
const FIREFOX_WITH_ADDRESS_GIVEN = 'Mozilla/5.0 (X11; Linux x86_64; ) Gecko/20100101 Firefox/131.0';

/** A recorded output of live's site container, in `ownpace_site` (www-nginx.conf). */
const LOG = [
  '/docker-entrypoint.sh: Configuration complete; ready for start up',
  `127.0.0.1 - - [07/Oct/2026:03:13:00 +0000] "GET / HTTP/1.1" 200 5120 "-" "Wget" "-"`,
  `${NETBIRD} - - [07/Oct/2026:09:01:02 +0000] "GET /?utm_source=linkedin&utm_campaign=alpha HTTP/1.1" 200 5120 "https://www.linkedin.com/feed/update/urn:li:activity:1/" "${FIREFOX}" "${VISITOR_A}"`,
  `${NETBIRD} - - [07/Oct/2026:09:01:09 +0000] "GET /prices.html HTTP/1.1" 200 4096 "https://www.ownpace.eu/" "${FIREFOX}" "${VISITOR_A}"`,
  `${NETBIRD} - - [07/Oct/2026:10:15:00 +0000] "GET /nl/ HTTP/1.1" 200 5300 "https://someone:secret@mail.example.net/inbox/4711?user=someone%40example.net" "${IPHONE}" "${VISITOR_B}"`,
  `${NETBIRD} - - [07/Oct/2026:11:00:00 +0000] "GET /robots.txt HTTP/1.1" 200 60 "-" "${GOOGLEBOT}" "${VISITOR_C}"`,
  `${NETBIRD} - - [07/Oct/2026:11:30:00 +0000] "GET /wp-login.php HTTP/1.1" 404 512 "-" "curl/8.5.0" "${VISITOR_B}"`,
  `${GATEWAY} - - [07/Oct/2026:12:00:00 +0000] "GET /robots.txt HTTP/1.1" 200 60 "-" "curl/8.5.0" "-"`,
  // The status page's Website row (gatus.yaml), asking through the public name every 60 seconds.
  `${NETBIRD} - - [07/Oct/2026:12:01:00 +0000] "GET / HTTP/1.1" 200 5120 "-" "Gatus/1.0" "${OWN_FRONT}"`,
  `${NETBIRD} - - [07/Oct/2026:12:02:00 +0000] "GET / HTTP/1.1" 200 5120 "-" "Gatus/1.0" "${OWN_FRONT}"`,
  // Somebody else's newsletter, which put its recipient into the link.
  `${NETBIRD} - - [08/Oct/2026:08:00:00 +0000] "GET /?utm_source=newsletter&utm_campaign=invite&utm_content=jan.devries%40example.nl&utm_term=marie&utm_id=tester-0042 HTTP/1.1" 200 5120 "-" "${FIREFOX}" "${VISITOR_D}"`,
  // A mistyped personal link: no page of ours, and nginx answers 404 to any path.
  `${NETBIRD} - - [08/Oct/2026:08:01:00 +0000] "GET /invite/klaas.vermeer@example.nl HTTP/1.1" 404 512 "-" "${FIREFOX}" "${VISITOR_D}"`,
  // A page of ours, asked for through a path that names somebody: nginx answers 200.
  `${NETBIRD} - - [08/Oct/2026:08:02:00 +0000] "GET /henk.jansen/../prices.html HTTP/1.1" 200 4096 "-" "${FIREFOX}" "${VISITOR_D}"`,
  // Text joined to a browser's version.
  `${NETBIRD} - - [08/Oct/2026:09:00:00 +0000] "GET /nl/ HTTP/1.1" 200 5300 "-" "${FIREFOX_SIGNED}" "${VISITOR_E}"`,
  // The site a visitor came from, when it is an address.
  `${NETBIRD} - - [08/Oct/2026:09:01:00 +0000] "GET /prices.html HTTP/1.1" 200 4096 "http://${REFERRER_V4}:8080/my-notes" "${FIREFOX}" "${VISITOR_E}"`,
  `${NETBIRD} - - [08/Oct/2026:09:02:00 +0000] "GET /estimate.html HTTP/1.1" 200 4096 "http://[${REFERRER_V6}]/" "${FIREFOX}" "${VISITOR_E}"`,
  // An email address as a word of its own in the browser string.
  `${NETBIRD} - - [08/Oct/2026:09:03:00 +0000] "GET / HTTP/1.1" 200 5120 "-" "${FIREFOX_WITH_ADDRESS}" "${VISITOR_E}"`,
  // A method the site does not answer, and a request line that is not one.
  `${NETBIRD} - - [08/Oct/2026:10:00:00 +0000] "POST /contact?name=marie HTTP/1.1" 405 157 "-" "${FIREFOX}" "${VISITOR_F}"`,
  `${NETBIRD} - - [08/Oct/2026:10:01:00 +0000] "GET /hello marie HTTP/1.1" 400 157 "-" "-" "${VISITOR_F}"`,
  // A Basic Authorization header the site never asked for: nginx writes its user as $remote_user,
  // spaces and brackets and all, before its own time.
  `${NETBIRD} - [jan.devries at example dot nl] [08/Oct/2026:10:02:00 +0000] "GET / HTTP/1.1" 200 5120 "-" "${FIREFOX}" "${VISITOR_F}"`,
  // A user that is a time: as the first bracketed group, it would date the visit in 2020.
  `${NETBIRD} - [01/Jan/2020:00:00:00 +0000] [08/Oct/2026:10:03:00 +0000] "GET /prices.html HTTP/1.1" 200 4096 "-" "${FIREFOX}" "${VISITOR_F}"`,
  // A user that opens a bracket and never closes it: with nginx's time it makes one bracketed group.
  `${NETBIRD} - [marie [08/Oct/2026:10:04:00 +0000] "GET /estimate.html HTTP/1.1" 200 4096 "-" "${FIREFOX}" "${VISITOR_F}"`,
  // A first piece that does not end in nginx's time: not an access line of ownpace_site.
  `${NETBIRD} - - [typed by a visitor] "GET / HTTP/1.1" 200 5120 "-" "${FIREFOX}" "${VISITOR_F}"`,
  '',
].join('\n');

/** What GoAccess must be given for that log: the public name's requests, numbered, cut. */
const GIVEN = [
  `v1 - - [07/Oct/2026:09:01:02 +0000] "GET / HTTP/1.1" 200 5120 "https://www.linkedin.com" "${FIREFOX}"`,
  `v1 - - [07/Oct/2026:09:01:09 +0000] "GET /prices.html HTTP/1.1" 200 4096 "https://www.ownpace.eu" "${FIREFOX}"`,
  `v2 - - [07/Oct/2026:10:15:00 +0000] "GET /nl/ HTTP/1.1" 200 5300 "https://mail.example.net" "${IPHONE_GIVEN}"`,
  `v3 - - [07/Oct/2026:11:00:00 +0000] "GET /robots.txt HTTP/1.1" 200 60 "-" "${GOOGLEBOT_GIVEN}"`,
  `v2 - - [07/Oct/2026:11:30:00 +0000] "GET /(not shown) HTTP/1.1" 404 512 "-" "curl/8.5.0"`,
  `v4 - - [08/Oct/2026:08:00:00 +0000] "GET / HTTP/1.1" 200 5120 "-" "${FIREFOX}"`,
  `v4 - - [08/Oct/2026:08:01:00 +0000] "GET /(not shown) HTTP/1.1" 404 512 "-" "${FIREFOX}"`,
  `v4 - - [08/Oct/2026:08:02:00 +0000] "GET /(not shown) HTTP/1.1" 200 4096 "-" "${FIREFOX}"`,
  `v5 - - [08/Oct/2026:09:00:00 +0000] "GET /nl/ HTTP/1.1" 200 5300 "-" "${FIREFOX_SIGNED_GIVEN}"`,
  `v5 - - [08/Oct/2026:09:01:00 +0000] "GET /prices.html HTTP/1.1" 200 4096 "http://(an address)" "${FIREFOX}"`,
  `v5 - - [08/Oct/2026:09:02:00 +0000] "GET /estimate.html HTTP/1.1" 200 4096 "http://(an address)" "${FIREFOX}"`,
  `v5 - - [08/Oct/2026:09:03:00 +0000] "GET / HTTP/1.1" 200 5120 "-" "${FIREFOX_WITH_ADDRESS_GIVEN}"`,
  `v6 - - [08/Oct/2026:10:00:00 +0000] "POST /(not shown) HTTP/1.1" 405 157 "-" "${FIREFOX}"`,
  `v6 - - [08/Oct/2026:10:01:00 +0000] "/(not shown)" 400 157 "-" "-"`,
  // nginx's own time, and no user: not the Basic user's words, not 2020, not the opened bracket.
  `v6 - - [08/Oct/2026:10:02:00 +0000] "GET / HTTP/1.1" 200 5120 "-" "${FIREFOX}"`,
  `v6 - - [08/Oct/2026:10:03:00 +0000] "GET /prices.html HTTP/1.1" 200 4096 "-" "${FIREFOX}"`,
  `v6 - - [08/Oct/2026:10:04:00 +0000] "GET /estimate.html HTTP/1.1" 200 4096 "-" "${FIREFOX}"`,
];

const ID_FIRST = '3f1c2b9a8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a';
const ID_SECOND = '9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a3f1c2b9a8d7e6f5a4b3c2d1e0f';

/**
 * Live's `.env`. Its binds are not NetBird's placeholder: `own_address_redact`
 * masks every value a `*_BIND` holds, and a bind equal to NetBird's address
 * would hide a leak of it on the paths that print through that filter.
 */
const LIVE_ENV = [
  'COMPOSE_PROJECT_NAME=ownpace-live',
  'STACK_KIND=production',
  'WEB_BIND=192.0.2.80',
  'WWW_LIVE=true',
  'WWW_PORT=3135',
  'WWW_BIND=192.0.2.80',
  '',
].join('\n');
const OTA_ENV = LIVE_ENV.split('\n')
  .filter((l) => !/^(COMPOSE_PROJECT_NAME|STACK_KIND)=/.test(l))
  .join('\n');

/** The owner's sentence and purpose (2026-10-05), as privacy 1.2 on 0139's branch publishes them. */
const SENTENCE_EN =
  'From these logs we also count visits to this website (pages, the site you came from, the kind of\nbrowser), as totals only, which identify nobody.';
const PURPOSE_EN =
  '| Server logs, for the app and this website | Keeping the service secure and working, and counting visits in totals | Legitimate interests (Art. 6(1)(f)) |';
const SENTENCE_NL =
  "Uit deze logs tellen we ook bezoeken aan deze website (pagina's, de site waar u vandaan kwam, het\nsoort browser), alleen als totalen, die niemand identificeren.";
const PURPOSE_NL =
  '| Serverlogs, van de app en van deze website | De dienst veilig en werkend houden, en bezoeken in totalen tellen | Gerechtvaardigd belang (art. 6 lid 1 sub f) |';

function privacyText(sentence: string, purpose: string, opts: { sentence?: 'shown' | 'absent' | 'commented' } = {}): string {
  const where = opts.sentence ?? 'shown';
  return [
    '# Privacy',
    '',
    '<!-- A note for the people who edit this text. -->',
    '',
    where === 'shown' ? sentence : where === 'commented' ? `<!-- ${sentence} -->` : 'Server logs are kept until the part that wrote them is replaced.',
    '',
    '| What | Why | Basis |',
    '|---|---|---|',
    purpose,
    '',
  ].join('\n');
}

/**
 * `docker`, as the script uses it. Its GoAccess (`docker run`) is the worst
 * one possible: everything it is given goes into its report, and on failure
 * it quotes every line of it, as GoAccess's format errors quote a token. And
 * it refuses an `-o`, as the image's GoAccess 1.12 does as 65534 on a
 * read-only disk ("No write permission for directory: .", run on 2026-10-06).
 * `docker logs` says nginx's error line, with an address, on stderr, as the
 * real one does. When GoAccess starts it notes every file under HOME, beside
 * a report, that holds a request: a copy of the log.
 */
const DOCKER_STUB = [
  '#!/usr/bin/env bash',
  'printf "%s\\n" "$*" >>"$STUB_DIR/asked"',
  'case "$1" in',
  '  ps)',
  '    [ -z "${STUB_PS_FAIL:-}" ] || { echo "Cannot connect to the Docker daemon" >&2; exit 1; }',
  '    for id in ${STUB_IDS:-}; do echo "$id"; done',
  '    ;;',
  '  inspect)',
  '    id="${*: -1}"',
  '    cat "$STUB_DIR/created.$id"',
  '    ;;',
  '  logs)',
  '    id="${*: -1}"',
  `    echo '2026/10/07 11:30:00 [error] 29#29: *7 open() "/usr/share/nginx/html/wp-login.php" failed (2: No such file or directory), client: ${IN_ERROR_LOG}, server: _' >&2`,
  '    [ -z "${STUB_LOGS_FAIL:-}" ] || exit 1',
  '    cat "$STUB_DIR/log.$id"',
  '    ;;',
  '  run)',
  '    shift',
  '    printf "%s\\n" "$@" >"$STUB_DIR/run.argv"',
  '    find "$HOME" -type f ! -name "*.html" -exec grep -l "HTTP/1" {} + >"$STUB_DIR/copies" 2>/dev/null',
  '    cat >"$STUB_DIR/given"',
  '    if [ -n "${STUB_DOCKER_RUN_FAIL:-}" ]; then echo "docker: Error response from daemon: pull access denied for allinurl/goaccess" >&2; exit 125; fi',
  '    for a in "$@"; do',
  '      case "$a" in -o|-o*|--output|--output=*) echo "No write permission for directory: ." >&2; echo "Invalid or unwritable path." >&2; exit 1 ;; esac',
  '    done',
  '    if [ -n "${STUB_GOACCESS_FAIL:-}" ]; then',
  "      while IFS= read -r l; do echo \"==1== Token '$l' doesn't match specifier '%h'\" >&2; done <\"$STUB_DIR/given\"",
  '      echo "==1== Format Errors - Verify your log/date/time format" >&2',
  '      exit 1',
  '    fi',
  '    if [ -n "${STUB_GOACCESS_EMPTY:-}" ]; then exit 0; fi',
  '    printf "<!DOCTYPE html>\\n<html><body><pre>\\n"',
  '    cat "$STUB_DIR/given"',
  '    printf "</pre></body></html>\\n"',
  '    ;;',
  '  *) echo "docker $1: not expected" >&2; exit 99 ;;',
  'esac',
].join('\n');

interface Stage {
  root: string;
  checkout: string;
  compose: string;
  home: string;
  stub: string;
  bin: string;
}

/** Live's checkout: the script, what it sources, managed.yml, a `.env`, the privacy texts, and `docker` on PATH. */
function stage(dotEnv: string = LIVE_ENV, privacy: { en?: string | null; nl?: string | null } = {}): Stage {
  if (!existsSync(join(ROOT, SCRIPT_REL))) throw new Error(`${SCRIPT_REL} does not exist`);
  const root = mkdtempSync(join(tmpdir(), 'site-visits-'));
  tempDirs.push(root);
  const checkout = join(root, 'checkout');
  const compose = join(checkout, 'deploy', 'compose');
  mkdirSync(compose, { recursive: true });
  for (const f of ['site-visits.sh', 'env-read.sh', 'stack-kind.sh', 'own-addresses.sh', 'www-live.sh', 'managed.yml']) {
    copyFileSync(join(COMPOSE_DIR, f), join(compose, f));
  }
  chmodSync(join(compose, 'site-visits.sh'), 0o755);
  writeFileSync(join(compose, '.env'), dotEnv);
  const legal = join(checkout, 'site', 'legal');
  mkdirSync(legal, { recursive: true });
  const en = privacy.en === undefined ? privacyText(SENTENCE_EN, PURPOSE_EN) : privacy.en;
  const nl = privacy.nl === undefined ? privacyText(SENTENCE_NL, PURPOSE_NL) : privacy.nl;
  if (en !== null) writeFileSync(join(legal, 'privacy.md'), en);
  if (nl !== null) writeFileSync(join(legal, 'privacy.nl.md'), nl);
  const home = join(root, 'home');
  mkdirSync(home);
  const stub = join(root, 'stub');
  mkdirSync(stub);
  writeFileSync(join(stub, 'asked'), '');
  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'docker'), `${DOCKER_STUB}\n`);
  chmodSync(join(bin, 'docker'), 0o755);
  const s = { root, checkout, compose, home, stub, bin };
  container(s, ID_FIRST, '2026-10-07T03:12:45.123456789Z', LOG);
  return s;
}

/** A container of the site's project, as `docker inspect` and `docker logs` answer for it. */
function container(s: Stage, id: string, created: string, log: string): void {
  writeFileSync(join(s.stub, `created.${id}`), `${created}\n`);
  writeFileSync(join(s.stub, `log.${id}`), log);
}

function run(s: Stage, extra: NodeJS.ProcessEnv = {}, args: string[] = []) {
  // A clean environment, so the shell this test runs in cannot choose a stack.
  const r = spawnSync(join(s.compose, 'site-visits.sh'), args, {
    encoding: 'utf8',
    env: {
      PATH: `${s.bin}:${process.env.PATH ?? '/usr/bin:/bin'}`,
      HOME: s.home,
      STUB_DIR: s.stub,
      STUB_IDS: ID_FIRST,
      ...extra,
    },
    cwd: s.root,
    timeout: 60_000,
  });
  const asked = readFileSync(join(s.stub, 'asked'), 'utf8').split('\n').filter(Boolean);
  const argvFile = join(s.stub, 'run.argv');
  const givenFile = join(s.stub, 'given');
  const copiesFile = join(s.stub, 'copies');
  return {
    status: r.status ?? -1,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    out: `${r.stdout ?? ''}${r.stderr ?? ''}`,
    asked,
    argv: existsSync(argvFile) ? readFileSync(argvFile, 'utf8').split('\n').filter(Boolean) : [],
    given: existsSync(givenFile) ? readFileSync(givenFile, 'utf8') : null,
    copies: existsSync(copiesFile) ? readFileSync(copiesFile, 'utf8').split('\n').filter(Boolean) : null,
  };
}

const visitsDir = (s: Stage): string => join(s.home, '.persistent', 'ownpace-live', 'site-visits');

/** Every file under a directory, with its text. */
function filesUnder(dir: string): Array<{ path: string; text: string }> {
  if (!existsSync(dir)) return [];
  const out: Array<{ path: string; text: string }> = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push({ path: relative(dir, p), text: readFileSync(p, 'utf8') });
    }
  };
  walk(dir);
  return out;
}

/**
 * No recorded address, and nothing the log said about a person, in anything
 * the run printed, wrote under HOME, or gave GoAccess. The query string's `?`
 * is looked for in what GoAccess was given and in the reports, where a
 * request would stand.
 */
function expectNobody(s: Stage, r: ReturnType<typeof run>): void {
  const places = [
    { where: 'stdout', text: r.stdout, kept: false },
    { where: 'stderr', text: r.stderr, kept: false },
    { where: 'what GoAccess was given', text: r.given ?? '', kept: true },
    ...filesUnder(s.home).map((f) => ({ where: `~/${f.path}`, text: f.text, kept: true })),
  ];
  for (const { where, text, kept } of places) {
    for (const a of ADDRESSES) expect(text.includes(a), `${where} holds ${a}`).toBe(false);
    expect(text, `${where} holds an address in the mesh's range`).not.toMatch(/\b100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+\b/);
    for (const p of PERSONAL) {
      if (p === '?' && !kept) continue;
      expect(text.includes(p), `${where} holds ${JSON.stringify(p)}`).toBe(false);
    }
  }
}

describe('site-visits.sh gives GoAccess the visits, and nobody', () => {
  it('hands on exactly the requests that came through the public name: a number for each visitor, no address, no query string, no path that found no page, the referrer cut to its site, the browser cut to its versions', () => {
    const s = stage();
    const r = run(s);
    expect(r.status, r.out).toBe(0);
    expect(r.given?.split('\n').filter(Boolean)).toEqual(GIVEN);
    expect(r.out).toMatch(/17 request\(s\) came through the public name, from 6 address\(es\)/);
    expect(r.out).toMatch(/2 did not \(the healthcheck, the deploy's own checks\)/);
    expect(r.out, "the status page's probe is ours, not a visit").toMatch(/2 were the status page's probe/);
    expect(r.out, "the image's start-up line, and a line that does not end its first piece in nginx's time").toMatch(
      /and 2 line\(s\) were not requests/,
    );
    expectNobody(s, r);
  });

  it('prints and writes nothing about anybody: on success, when GoAccess fails and quotes what it was given, and when docker logs fails', () => {
    const ok = stage();
    expectNobody(ok, run(ok));
    const goaccess = stage();
    const g = run(goaccess, { STUB_GOACCESS_FAIL: '1' });
    expect(g.status, g.out).toBe(1);
    expectNobody(goaccess, g);
    const logs = stage();
    const l = run(logs, { STUB_LOGS_FAIL: '1' });
    expect(l.status, l.out).toBe(1);
    expect(l.out).toMatch(/docker logs .* failed/);
    expect(filesUnder(visitsDir(logs)), 'a report of a log docker could not give').toEqual([]);
    expectNobody(logs, l);
  });

  it("shows GoAccess's words that quote nothing, and none that quote a line of the log", () => {
    const s = stage();
    const r = run(s, { STUB_GOACCESS_FAIL: '1' });
    expect(r.status, r.out).toBe(1);
    expect(r.out).toMatch(/GoAccess failed/);
    expect(r.out, "GoAccess's own words are shown").toContain('Format Errors - Verify your log/date/time format');
    expect(r.out, 'a line GoAccess quoted is shown').not.toContain("Token '");
    expect(r.out, 'a request GoAccess quoted is shown').not.toMatch(/HTTP\/1\.1/);
    expect(r.out).toMatch(/17 of GoAccess's lines quote the log, and are not shown/);
  });

  it("shows docker's own words when docker could not run GoAccess at all (exit 125)", () => {
    const s = stage();
    const r = run(s, { STUB_DOCKER_RUN_FAIL: '1' });
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain('pull access denied for allinurl/goaccess');
    expect(r.out).toMatch(/docker could not run GoAccess/);
    expectNobody(s, r);
  });

  it('keeps no copy of the log while GoAccess reads it, so a run killed outright leaves none behind', () => {
    const s = stage();
    const r = run(s);
    expect(r.status, r.out).toBe(0);
    expect(r.copies, 'GoAccess was not run').not.toBeNull();
    expect(r.copies, 'a file under HOME held requests while GoAccess ran').toEqual([]);
    const left = filesUnder(s.home).filter((f) => !f.path.endsWith('.html'));
    expect(left, 'something beside the reports was left').toEqual([]);
  });

  it('reads the site container of live’s project only, through Docker, and never with a timestamp cursor of its own', () => {
    const s = stage();
    const r = run(s);
    expect(r.status, r.out).toBe(0);
    const ps = r.asked.filter((a) => a.startsWith('ps '));
    expect(ps).toEqual([
      `ps -a --filter label=com.docker.compose.project=ownpace-live-www --filter label=com.docker.compose.service=www --format {{.ID}}`,
    ]);
    expect(r.asked.filter((a) => a.startsWith('logs '))).toEqual([`logs ${ID_FIRST}`]);
  });
});

describe('GoAccess keeps totals: the flags, the image and what it may touch', () => {
  /** One run, made when the first test asks, so a missing script fails the tests and not the file's collection. */
  let once: { r: ReturnType<typeof run>; image: number; docker: string[]; goaccess: string[] } | undefined;
  const ran = () => {
    if (!once) {
      const r = run(stage());
      const image = r.argv.findIndex((a) => /^allinurl\/goaccess[:@]/.test(a));
      once = { r, image, docker: r.argv.slice(0, Math.max(image, 0)), goaccess: image < 0 ? [] : r.argv.slice(image + 1) };
    }
    return once;
  };

  it('ran', () => {
    const { r, image } = ran();
    expect(r.status, r.out).toBe(0);
    expect(image, `no allinurl/goaccess image among: ${r.argv.join(' ')}`).toBeGreaterThan(-1);
  });

  it.each([
    ['--ignore-panel=HOSTS', 'the panel of addresses: never built'],
    ['--ignore-panel=GEO_LOCATION', 'a place, which the sentence does not name'],
    ['--ignore-panel=ASN', "a visitor's network, the same"],
    ['--ignore-panel=REFERRERS', 'the whole address of the page a visitor came from; "the site you came from" is REFERRING_SITES'],
    ['--ignore-panel=REMOTE_USER', 'a user name, which the site never has'],
    ['--ignore-panel=UTM_CAMPAIGNS', "campaigns: the value of nine utm_ parameters, word for word, which the sentence does not name"],
    ['--anonymize-ip', 'masks the HOSTS panel if a later edit draws it'],
    ['--anonymize-level=3', 'at its widest: a /8 or a /32'],
    ['--no-query-string', 'pages without their parameters, if a later edit hands them on'],
    ['--ignore-crawlers', 'visits, not robots'],
    ['--log-format=COMBINED', 'the shape the filter hands on'],
    ['--no-ip-validation', 'a host is a number for the run, never an address'],
    ['--no-global-config', 'nothing from a configuration file in the image'],
    ['--no-progress', 'no progress lines on stderr'],
  ])('passes %s (%s)', (flag) => {
    const { goaccess } = ran();
    expect(goaccess, goaccess.join(' ')).toContain(flag);
  });

  it('writes its HTML on its output with no -o, which GoAccess 1.12 refuses as the image’s user on a read-only disk, and reads the log from its input', () => {
    const { goaccess } = ran();
    expect(
      goaccess.filter((a) => /^(-o|--output)/.test(a)),
      'GoAccess 1.12 checks that the directory of an -o path is writable, even `-o html`’s `.` (util.c, is_writable_path)',
    ).toEqual([]);
    expect(goaccess[goaccess.length - 1]).toBe('-');
  });

  it('never keeps a store of its own, nor a list, a server, a resolver or a map', () => {
    const { goaccess } = ran();
    const kept = goaccess.filter((a) =>
      /^(--persist|--restore|--db-path|--keep-last|-a|--agent-list|--real-time-html|--enable-html-resolver|--geoip-database|--ws-url|--port|--addr|--unknowns-log|--invalid-requests|--debug-file|--daemonize|--pid-file|--fifo-in|--fifo-out)\b/.test(
        a,
      ),
    );
    expect(kept, 'privacy §4.5: totals only. --persist keeps a fingerprint per visitor and per day').toEqual([]);
  });

  it('is pinned by digest, and runs with no network, no port, nothing of ours mounted, nothing to write, no root and no capability', () => {
    const { r, image, docker } = ran();
    expect(r.argv[image]).toMatch(/^allinurl\/goaccess:[0-9][0-9.]*@sha256:[0-9a-f]{64}$/);
    const line = docker.join(' ');
    expect(docker).toContain('--rm');
    expect(docker).toContain('-i');
    expect(line).toMatch(/(^| )--network none( |$)/);
    expect(docker).toContain('--read-only');
    expect(line, 'the image sets no USER: without this GoAccess runs as root').toMatch(/(^| )--user 65534:65534( |$)/);
    expect(line).toMatch(/(^| )--cap-drop ALL( |$)/);
    expect(line).toMatch(/(^| )--security-opt no-new-privileges( |$)/);
    const reach = docker.filter((a) => /^(-p|-P|--publish|--publish-all|-v|--volume|--mount|--tmpfs|--network=(?!none$)|--net\b|--add-host)/.test(a));
    expect(reach, line).toEqual([]);
  });
});

describe('one report per container of the site, kept under live’s persistent directory', () => {
  it('writes the report for the container in ~/.persistent/<project>/site-visits, named after when the container was made, and nothing else', () => {
    const s = stage();
    const r = run(s);
    expect(r.status, r.out).toBe(0);
    const files = filesUnder(visitsDir(s));
    expect(files.map((f) => f.path)).toEqual([`2026-10-07-031245-${ID_FIRST.slice(0, 12)}.html`]);
    expect(files[0]?.text).toMatch(/^<!DOCTYPE html>/);
    expect(statSync(visitsDir(s)).mode & 0o077, 'the directory is the owner’s alone').toBe(0);
    expect(statSync(join(visitsDir(s), files[0]?.path ?? '')).mode & 0o077, 'the report is the owner’s alone').toBe(0);
    expect(r.out).toContain(`~/.persistent/ownpace-live/site-visits/2026-10-07-031245-${ID_FIRST.slice(0, 12)}.html`);
  });

  it('a deploy recreates the site: the new container gets a report of its own, and the earlier one stays as it was', () => {
    const s = stage();
    expect(run(s).status).toBe(0);
    const first = filesUnder(visitsDir(s));
    container(s, ID_SECOND, '2026-10-21T08:00:01.5Z', LOG.replace(/0([78])\/Oct\/2026/g, '2$1/Oct/2026'));
    const r = run(s, { STUB_IDS: ID_SECOND });
    expect(r.status, r.out).toBe(0);
    const both = filesUnder(visitsDir(s));
    expect(both.map((f) => f.path).sort()).toEqual(
      [`2026-10-07-031245-${ID_FIRST.slice(0, 12)}.html`, `2026-10-21-080001-${ID_SECOND.slice(0, 12)}.html`].sort(),
    );
    expect(both.find((f) => f.path === first[0]?.path)?.text).toBe(first[0]?.text);
  });

  it('a second run on the same container writes its report again, from the whole log', () => {
    const s = stage();
    expect(run(s).status).toBe(0);
    const r = run(s);
    expect(r.status, r.out).toBe(0);
    expect(filesUnder(visitsDir(s))).toHaveLength(1);
    expect(r.given?.split('\n').filter(Boolean)).toEqual(GIVEN);
  });
});

describe('it refuses what is not live’s, and reads nothing while the site is off', () => {
  it("refuses the OTA stack's .env before asking docker anything", () => {
    const s = stage(OTA_ENV);
    const r = run(s);
    expect(r.status, r.out).toBe(2);
    expect(r.out).toContain('STACK_KIND');
    expect(r.asked).toEqual([]);
    expect(existsSync(join(s.home, '.persistent')), 'it made a directory for a stack it refused').toBe(false);
  });

  it("refuses live's marker on a .env without live's project, which the reader refuses", () => {
    const s = stage(LIVE_ENV.replace('COMPOSE_PROJECT_NAME=ownpace-live\n', ''));
    const r = run(s);
    expect(r.status, r.out).toBe(2);
    expect(r.asked).toEqual([]);
  });

  it('refuses a shell that exported the other stack’s project', () => {
    const s = stage();
    const r = run(s, { COMPOSE_PROJECT_NAME: 'ownpace-managed' });
    expect(r.status, r.out).toBe(2);
    expect(r.asked).toEqual([]);
  });

  it.each([
    ['false', LIVE_ENV.replace('WWW_LIVE=true', 'WWW_LIVE=false')],
    ['absent', LIVE_ENV.replace('WWW_LIVE=true\n', '')],
  ])('with WWW_LIVE %s: reads nothing, writes nothing, says why, and exits 0', (_l, dotEnv) => {
    const s = stage(dotEnv);
    const r = run(s);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toMatch(/WWW_LIVE is not true/);
    expect(r.out).toMatch(/[Nn]othing was read/);
    expect(r.asked).toEqual([]);
    expect(existsSync(join(s.home, '.persistent'))).toBe(false);
  });

  it('a switch that is neither true nor false is refused, naming the key and not the value', () => {
    const s = stage(LIVE_ENV.replace('WWW_LIVE=true', 'WWW_LIVE=maybe-later'));
    const r = run(s);
    expect(r.status, r.out).toBe(2);
    expect(r.out).toContain('WWW_LIVE');
    expect(r.out).not.toContain('maybe-later');
    expect(r.asked).toEqual([]);
  });

  it('takes no argument', () => {
    const s = stage();
    const r = run(s, {}, ['--all']);
    expect(r.status, r.out).toBe(2);
    expect(r.asked).toEqual([]);
  });
});

describe('it counts only once the privacy text the site publishes says so (§4.5 and §5)', () => {
  it.each([
    ['privacy.md without §4.5’s sentence', { en: privacyText(SENTENCE_EN, PURPOSE_EN, { sentence: 'absent' }) }, 'privacy.md'],
    ['privacy.md with the sentence only in a comment', { en: privacyText(SENTENCE_EN, PURPOSE_EN, { sentence: 'commented' }) }, 'privacy.md'],
    ['privacy.md without §5’s purpose', { en: privacyText(SENTENCE_EN, PURPOSE_EN.replace(', and counting visits in totals', '')) }, 'privacy.md'],
    ['privacy.nl.md without §4.5’s sentence', { nl: privacyText(SENTENCE_NL, PURPOSE_NL, { sentence: 'absent' }) }, 'privacy.nl.md'],
    ['privacy.nl.md without §5’s purpose', { nl: privacyText(SENTENCE_NL, PURPOSE_NL.replace(', en bezoeken in totalen tellen', '')) }, 'privacy.nl.md'],
    ['no privacy.md', { en: null }, 'privacy.md'],
    ['no privacy.nl.md', { nl: null }, 'privacy.nl.md'],
  ] as const)('%s: refused before asking docker anything, naming the file', (_l, privacy, file) => {
    const s = stage(LIVE_ENV, privacy);
    const r = run(s);
    expect(r.status, r.out).toBe(2);
    expect(r.out).toContain(`site/legal/${file}`);
    expect(r.out).toMatch(/does not say/);
    expect(r.asked).toEqual([]);
    expect(existsSync(join(s.home, '.persistent')), 'it made a directory for a count it refused').toBe(false);
  });

  it('with WWW_LIVE false the text is not asked for: nothing is counted either way', () => {
    const s = stage(LIVE_ENV.replace('WWW_LIVE=true', 'WWW_LIVE=false'), { en: null, nl: null });
    const r = run(s);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toMatch(/WWW_LIVE is not true/);
  });

  it("looks for the owner's own words, in both languages", () => {
    const text = readFileSync(join(ROOT, SCRIPT_REL), 'utf8');
    for (const words of [
      'From these logs we also count visits to this website',
      'counting visits in totals',
      'Uit deze logs tellen we ook bezoeken aan deze website',
      'bezoeken in totalen tellen',
    ]) {
      expect(text, words).toContain(`'${words}'`);
      expect(`${SENTENCE_EN} ${PURPOSE_EN} ${SENTENCE_NL} ${PURPOSE_NL}`.replace(/\s+/g, ' '), words).toContain(words);
    }
  });
});

describe('a failure is a failure, and an earlier report stays', () => {
  it('no container of the site: exit 1, naming the project', () => {
    const s = stage();
    const r = run(s, { STUB_IDS: '' });
    expect(r.status, r.out).toBe(1);
    expect(r.out).toMatch(/ownpace-live-www has no container/);
  });

  it('docker that cannot be asked: exit 1, never "nothing there" (hard rule 9)', () => {
    const s = stage();
    const r = run(s, { STUB_PS_FAIL: '1' });
    expect(r.status, r.out).toBe(1);
    expect(r.out).toMatch(/docker could not be asked/);
  });

  it.each([
    ['docker logs fails', { STUB_LOGS_FAIL: '1' }, /docker logs .* failed/],
    ['docker cannot run GoAccess', { STUB_DOCKER_RUN_FAIL: '1' }, /docker could not run GoAccess/],
    ['GoAccess fails', { STUB_GOACCESS_FAIL: '1' }, /GoAccess failed/],
    ['GoAccess writes no HTML', { STUB_GOACCESS_EMPTY: '1' }, /not an HTML report/],
  ] as const)('%s: exit 1, and the report from the run before is kept as it was', (_l, extra, why) => {
    const s = stage();
    expect(run(s).status).toBe(0);
    const before = filesUnder(visitsDir(s));
    const r = run(s, extra);
    expect(r.status, r.out).toBe(1);
    expect(r.out).toMatch(why);
    expect(filesUnder(visitsDir(s))).toEqual(before);
  });

  it('no request through the public name yet: GoAccess reads nothing, no report, exit 0', () => {
    const s = stage();
    container(s, ID_FIRST, '2026-10-07T03:12:45Z', LOG.split('\n').filter((l) => !l.includes(NETBIRD)).join('\n'));
    const r = run(s);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toMatch(/0 request\(s\) came through the public name/);
    expect(r.given ?? '', 'GoAccess was given a line').toBe('');
    expect(filesUnder(visitsDir(s))).toEqual([]);
  });
});

describe('the script is written the way the others are', () => {
  const text = existsSync(join(ROOT, SCRIPT_REL)) ? readFileSync(join(ROOT, SCRIPT_REL), 'utf8') : '';
  const code = text
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');

  it("reads the .env and live's marker with the repository's readers, and never traces itself", () => {
    for (const helper of ['env-read.sh', 'stack-kind.sh', 'own-addresses.sh', 'www-live.sh']) {
      expect(text, `sources ${helper}`).toMatch(new RegExp(`^\\. "\\$\\{SCRIPT_DIR\\}/${helper.replace('.', '\\.')}"$`, 'm'));
    }
    expect(code).toMatch(/\bstack_is_live\b/);
    expect(code).toMatch(/\bcompose_project\b/);
    expect(code).toMatch(/\bwww_live_switch\b/);
    expect(code, 'set -x would print every value it reads').not.toMatch(/set\s+-[a-wyz]*x/);
    expect(text).toMatch(/^set -euo pipefail$/m);
  });

  it('keeps what it writes under ~/.persistent/<project>, never a directory the shell names', () => {
    expect(code).toMatch(/"\$\{HOME\}\/\.persistent\/\$\{COMPOSE_PROJECT\}\/site-visits"/);
    expect(code, 'MANAGED_ENV_PERSIST_DIR is the gate’s, and a shell could point it at the OTA stack').not.toMatch(
      /MANAGED_ENV_PERSIST_DIR/,
    );
  });
});

describe('the reports go when the website goes (privacy §9)', () => {
  it("the site's take-down in managed-bring-up.md deletes them", () => {
    const doc = readFileSync(join(ROOT, 'docs/managed-bring-up.md'), 'utf8');
    const takeDown = /\*\*Taking it down for good\*\*[\s\S]*?\n\n/.exec(doc)?.[0] ?? '';
    expect(takeDown, 'managed-bring-up.md has no **Taking it down for good** paragraph').not.toBe('');
    expect(takeDown).toContain('docker compose -p ownpace-live-www');
    expect(takeDown).toContain('rm -rf ~/.persistent/ownpace-live/site-visits');
  });
});
