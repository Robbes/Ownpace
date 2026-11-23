// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A SERVICE THAT PHONES HOME.
 *
 * The privacy policy says the service runs in the EU and names every party that
 * receives anything (§7, §8); on 2026-09-28 the owner chose, for the question
 * ops-telemetry, *"Switch it off everywhere"* (workplan 0139). Six images in
 * `managed.yml` reported to, or asked, their makers by default until then, each
 * read at the version this repository pins. Three of them were Trigger.dev's
 * plane: its webapp (PostHog from the server and the dashboard, and Prisma's
 * checkpoint at every start), ClickHouse (crash reports) and MinIO (a release
 * check at every start), each switched off and held here until alpha.18
 * removed the plane (workplan 0167 T9), with its TLS front's `tls internal`.
 * Of the three left, two are switched off, and Nextcloud is not yet:
 *
 *  - ZITADEL (v4.19.2) sends a "service ping" once a day to
 *    `https://zitadel.com/api/ping`: the version, and the id, creation date and
 *    domains of every instance, and with `ResourceCount` the number of users,
 *    organisations and projects. `cmd/defaults.yaml` ships
 *    `ServicePing.Enabled: true` and says so: *"It's enabled by default"*.
 *    `Telemetry.Enabled` (the milestone push) ships `false`, and is written out
 *    here too, so a change of default cannot switch it on unseen. Every v4
 *    release has carried the ping (read at v4.0.0, v4.6.2 and v4.17.1), so the
 *    OTA stack's provider has sent it since it first started, as far as the
 *    machine let it out.
 *  - MAILPIT (v1.31.6, again at v1.32.0 on 2026-10-25, at v1.33.0 on
 *    2026-11-03, at v1.33.1 on 2026-11-11 and at v1.34.0 on 2026-11-18; the
 *    test stack's catcher, live has none) asks GitHub for its newest release
 *    whenever its web page asks for the server's info, unless
 *    `MP_DISABLE_VERSION_CHECK` says true (`internal/stats/stats.go`, the
 *    variable read in `cmd/root.go` as `1`, `true` or `yes`). stats.go is the
 *    same at the first four tags. At v1.34.0 the lookup (`fetchLatest`, by
 *    `axllent/ghru/v2` 2.3.0, still `api.github.com`) no longer holds up a
 *    page that asks while it runs, and its backoff after errors is bounded;
 *    `"disabled"` is still answered before it (`stats.go:159`). The lines of
 *    root.go that read the variable are the same at all five tags.
 *    None of its other requests goes to its maker: a webhook goes out only
 *    when one is configured, and the HTML check, link check and screenshot
 *    proxy fetch what a caught message names only when its API is asked for
 *    them (at v1.33.0 the link check's pattern also finds a link that starts
 *    a plain text body; at v1.33.1 the HTML check fetches at most 10 of the
 *    stylesheets a message links, 5 MiB in all, and stops when its caller
 *    goes; at v1.34.0 all four are bounded further, the webhook reuses its
 *    connections and the proxy closes its own, each still only when
 *    configured or asked).
 *    v1.33.0 adds one more: Rspamd, pinged at start and sent a message when
 *    its check is asked, only when `MP_ENABLE_RSPAMD` or `--enable-rspamd`
 *    names a server (`config/config.go`, `server/server.go`,
 *    `internal/rspamd/rspamd.go`, none of which v1.33.1 changed; v1.34.0
 *    hardens the client and still pings only then), the operator's server and
 *    not its maker; this stack names none, and no SpamAssassin server, relay
 *    or forward either, which v1.34.0 also leaves off unless named.
 *  - NEXTCLOUD (35 since the demo's move, workplan 0119 T5, 34 before; the
 *    demo's DAV target on the OTA stack every night, and the development one)
 *    sends its version, PHP version and install time to
 *    `updates.nextcloud.com`, asks `apps.nextcloud.com` for the app store, the
 *    announcements feed at `pushfeed.nextcloud.com`, and four public sites for
 *    a connectivity check (`config/config.sample.php` at `stable34`, and again
 *    at `v35.0.2`:
 *    `updatechecker`, `appstoreenabled` and `has_internet_connection` all
 *    true). `has_internet_connection` false is what the announcements crawler,
 *    the connectivity check and the lookup-server upload each read
 *    (`nextcloud_announcements` `lib/Cron/Crawler.php`,
 *    `apps/settings/lib/SetupChecks/InternetConnectivity.php`,
 *    `apps/lookup_server_connector/lib/BackgroundJobs/RetryJob.php`). The
 *    three are `config.php` values inside the instance, and they are LEFT ON
 *    for now; see below.
 *
 * THE RULE. Every service in every compose file under `deploy/` is in exactly
 * one of three lists below, keyed by file and service, and the lists name no
 * service that is not there:
 *
 *  - SWITCHED: it has a default that reports home, and the switch that stops it
 *    is written in the file, as a literal (a `${…}`, or a key with no value,
 *    comes from the shell or the `.env` and can be empty, or unset, on a
 *    machine this cannot see). The row records the image the default was read
 *    at, and a different image in the file fails here until somebody re-reads
 *    the default at the new version and moves the row. A new release is exactly
 *    where a new report appears: Zitadel's ping arrived with v4. A row whose
 *    fact was read for a whole major line records that line instead, and is
 *    compared by repository and major: Nextcloud's (read at `stable34`, and at
 *    `v35.0.2` when the demo moved),
 *    whose images are pinned by tag and digest since 2026-10-22, so that a
 *    patch or a rebuild the pin watch asks for does not fail here, and another
 *    major still does. A switched
 *    service takes nothing from `env_file` or `extends`, and no overlay, since
 *    neither is read here.
 *  - NO SWITCH: nothing in it reports home, and the row says why. It records the
 *    image's repository, so a different piece of software under the same service
 *    name is a new question.
 *  - LEFT ON: it reports home and is not switched off yet. The row says what it
 *    sends and why it is left on, records the image it was read at, and its
 *    check is what keeps it where no tester is.
 *
 * A service with neither `image` nor `build` is an overlay of the service of the
 * same name in another file beside it; what runs is that service's image, and an
 * overlay may set none of the switches below. The files are read with YAML merge
 * keys applied, as Compose applies them, so a `<<: *anchor` hides nothing.
 *
 * WHAT IS LEFT ON, AND WHERE. The demo's and the development Nextcloud, its
 * three settings above. A hook that set them false before Apache started was
 * built on 2026-09-29, and with it the demo's first CalDAV write answered 500
 * in E2E (managed) #215, the branch's run; #216 on main, which recreated the
 * same container without the hook, passed. What broke the write, one of the
 * three or the hook's run itself, is not known. The instance holds fixtures,
 * never a tester's data, and it is not on live: the LEFT_ON rows hold that. A
 * follow-up switches them off with a check that the demo's DAV writes still
 * work.
 *
 * And the demo's Stalwart (v1.2.0's Alpine build), which
 * `setup-stalwart.sh` starts with `docker run`, outside every compose file, on
 * the OTA stack every night, in the self-host end-to-end run and on a
 * developer's machine. It fetches its WebUI from
 * `github.com/stalwartlabs/webui/releases/download/v2` (a tag upstream moves
 * within 2.x) on first start and again when its cached copy expires, 90 days
 * on, its spam-filter rules from
 * `github.com/stalwartlabs/spam-filter/releases/latest`, and an ASN and country
 * database every day, from `github.com/sapics/ip-location-db`
 * (`crates/common/src/manager/defaults.rs` and `application.rs`, `Application`
 * and `SpamSettings` in `crates/registry/src/schema/structs_impl.rs`, read at
 * v1.1.1 and again at v1.2.0, the same). The `cdn.jsdelivr.net` addresses
 * v0.16 kept on a database v0.16.10 made are gone with the line: v1 opens no
 * database an earlier line made
 * (`crates/common/src/manager/schema.rs`). Each is an object in its
 * database, not in its one-line file on disk, so switching it off is new
 * objects in the provisioning plan, and Stalwart settings written without
 * being run are how this repository's Stalwart went wrong before
 * (`docs/stalwart-integration-fix.md`). So they are named and pinned below,
 * and left on where it runs, as the owner preferred on 2026-09-29 (workplan
 * 0139), never on live: `a-demo-on-a-real-address.unit.test.ts` holds the
 * scripted bring-up to starting it only with `--with-demo`.
 *
 * And the site's visit count (`site-visits.sh`, `docker run`, from live's
 * checkout once a day; the owner, 2026-10-05: *"go with GoAccess on the logs
 * and the sentence"*). GoAccess 1.12 (`allinurl/goaccess`, read at the tag
 * `v1.12`, `ef3c4f3c`) has no telemetry, update check or error report: what
 * in it can reach a network is its reverse lookup of hosts (`src/gdns.c`, for the HOSTS
 * panel, which the script ignores) and its WebSocket server (`src/websocket.c`,
 * only with `--real-time-html`, which it never passes). And it runs with
 * `--network none`, so nothing could leave if a later version added
 * something. Its image is built from that commit by
 * `deploy/compose/goaccess/Dockerfile` (#1675: upstream's image is on an
 * Alpine past its end of life) and run with `--pull never`, and the row below
 * fails on another commit, on a base not pinned by digest, or on a run that
 * has a network or may pull.
 *
 * WHAT THIS CANNOT SEE. A running container: it keeps the environment it was
 * started with until a deploy recreates it, which is why
 * `docs/managed-bring-up.md`, *Nothing phones home*, has the check to run on the
 * machine. The integration tests' throwaway Nextcloud and Stalwart, started by
 * Testcontainers on a CI runner. And what a service does once somebody
 * configures it to.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string): string => readFileSync(join(REPO_ROOT, path), 'utf8');

/**
 * A compose file as Compose reads it. `merge: true` applies YAML merge keys
 * (`<<: *anchor`), which Compose honours: without it an anchored key merged into
 * a service is invisible here and present in the container. `logLevel: 'error'`
 * because `compose.pglite.yml` uses Compose's own `!reset` tag, which a plain
 * YAML reader only warns about.
 */
export function readCompose(text: string): { services?: Record<string, Service | null> } | null {
  return parseYaml(text, { logLevel: 'error', merge: true }) as { services?: Record<string, Service | null> } | null;
}

type Mount = string | { readonly source?: string; readonly target?: string };
export interface Service {
  readonly image?: string;
  readonly build?: unknown;
  readonly command?: unknown;
  readonly entrypoint?: unknown;
  readonly env_file?: unknown;
  readonly extends?: unknown;
  readonly environment?: Readonly<Record<string, unknown>> | ReadonlyArray<string>;
  readonly volumes?: ReadonlyArray<Mount>;
  readonly network_mode?: string;
}

interface Entry {
  /** `deploy/compose/managed.yml:zitadel`, so a failure names the entry. */
  readonly key: string;
  readonly file: string;
  readonly name: string;
  readonly service: Service;
}

/** Every compose file under `deploy/`: a YAML file whose top level has `services`. */
export function composeFiles(root = REPO_ROOT): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const d of readdirSync(join(root, dir), { withFileTypes: true })) {
      const path = `${dir}/${d.name}`;
      if (d.isDirectory()) walk(path);
      else if (/\.ya?ml$/.test(d.name)) {
        const doc = readCompose(readFileSync(join(root, path), 'utf8'));
        if (doc && typeof doc === 'object' && doc.services && typeof doc.services === 'object') out.push(path);
      }
    }
  };
  walk('deploy');
  return out.sort();
}

/**
 * A service's environment as strings, from either of Compose's two shapes. A
 * key with no value (`- KEY` in the list, `KEY:` in the map) passes the shell's
 * or the `.env`'s value through, and is removed from the container when neither
 * has one: it is not written in the file, so it reads as `${KEY}`.
 */
export function environmentOf(svc: Service): Record<string, string> {
  const env = svc.environment;
  if (!env) return {};
  if (Array.isArray(env)) {
    const out: Record<string, string> = {};
    for (const line of env as ReadonlyArray<string>) {
      const at = line.indexOf('=');
      if (at === -1) out[line] = `\${${line}}`;
      else out[line.slice(0, at)] = line.slice(at + 1);
    }
    return out;
  }
  return Object.fromEntries(
    Object.entries(env as Readonly<Record<string, unknown>>).map(([k, v]) => [k, v === null || v === undefined ? `\${${k}}` : String(v)]),
  );
}

/** Split on the colons that are not inside a `${…}`. */
function splitTop(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c === '$' && s[i + 1] === '{') {
      depth++;
      current += '${';
      i++;
      continue;
    }
    if (c === '}' && depth > 0) depth--;
    if (c === ':' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += c;
  }
  parts.push(current);
  return parts;
}

/** Each mount's source and target, from either of Compose's two shapes. */
export function mountsOf(svc: Service): Array<{ source: string; target: string }> {
  return (svc.volumes ?? []).map((m) => {
    if (typeof m === 'object') return { source: m.source ?? '', target: m.target ?? '' };
    const [source = '', target = ''] = splitTop(m);
    return { source, target };
  });
}

/** Written in the file, so no `.env` on any machine can empty it. */
const literal = (v: string | undefined): v is string => v !== undefined && !v.includes('$');

/** A problem when `env[key]` is not exactly `want`, written in the file. */
function exactly(env: Record<string, string>, key: string, want: string): string[] {
  const got = env[key];
  if (got === undefined) return [`${key} is not set, so the image's default applies`];
  if (!literal(got)) return [`${key} is ${got}, taken from the shell or the .env, where it can be empty or unset; write ${key}: "${want}"`];
  return got === want ? [] : [`${key} is "${got}"; it must be "${want}"`];
}

/** Zitadel: the daily service ping and the milestone push, both off. */
export function zitadelProblems(env: Record<string, string>): string[] {
  const problems = [
    ...exactly(env, 'ZITADEL_SERVICEPING_ENABLED', 'false'),
    ...exactly(env, 'ZITADEL_TELEMETRY_ENABLED', 'false'),
  ];
  for (const k of Object.keys(env)) {
    if (/^ZITADEL_(CONSOLE_POSTHOG|SERVICEPING_(ENDPOINT|TELEMETRY)|TELEMETRY_ENDPOINTS)/.test(k)) {
      problems.push(`${k} is set: with the two switches off it should have nothing to say`);
    }
  }
  return problems;
}

interface Row {
  /**
   * Exactly the `image:` the file writes, as the default was read at; `build`
   * for our own; or, with `line`, the repository and major line it was read
   * for (`nextcloud:35`).
   */
  readonly readAt: string;
  /**
   * The fact holds for the whole major line, so the row compares the
   * repository and the tag's first number: a patch or a rebuild keeps the
   * reason, another major is a new question.
   */
  readonly line?: true;
  /** What it sends by default and where that was read, or why it needs no switch. */
  readonly why: string;
  /** Problems with the switch, or with the fact the row rests on; empty when it holds. */
  readonly holds?: (svc: Service, entry: Entry) => string[];
}

const ZITADEL = 'ghcr.io/zitadel/zitadel:v4.20.4';
const MAILPIT =
  'axllent/mailpit:v1.34.0@sha256:23a2ef85bc50853ab3093645d1d64679afd8887e89da5e48a88940c172591a4e';
/**
 * Read at `stable34` (config.sample.php and the two crawlers), so the line, not
 * one patch of it; read again at `v35.0.2` and nextcloud_announcements'
 * `stable35` on 2026-10-26, for the demo's move to 35 (workplan 0119 T5): the
 * same three defaults, the same four sites, the same feed, and the same three
 * readers of `has_internet_connection` (their diffs against 34 are a blank
 * line, phpseclib 3's namespace and the global-scale check moved behind an
 * interface).
 */
const NEXTCLOUD = 'nextcloud:35';
/**
 * The demo's Stalwart, outside every compose file, by its tag and the digest of its index; its
 * fetches were read at v1.1.1 and again at v1.2.0 (2026-11-23, upstream revision `b2d3df9a`), whose
 * `defaults.rs` and `Application` and `SpamSettings` defaults are v1.1.1's.
 */
const STALWART = 'stalwartlabs/stalwart:v1.2.0-alpine@sha256:2b7dfee66dfd116a903607826e03e4f8af8841207fae28098aa908c568ca919a';
/**
 * The site's visit count, outside every compose file (`site-visits.sh`); read
 * at the tag `v1.12` (`ef3c4f3c`), and since 2026-10-25 (#1675) built from that
 * commit by `deploy/compose/goaccess/Dockerfile`, under a name no registry
 * serves. Until then it was Docker Hub's `allinurl/goaccess:1.12`, on Alpine
 * 3.20.
 */
const GOACCESS = 'localhost/goaccess:1.12';
const GOACCESS_COMMIT = 'ef3c4f3c3e42b378e705fb3a1a5ef1c2e72e6348';

const NEXTCLOUD_PHONES =
  'its version and PHP version to updates.nextcloud.com, the app store at apps.nextcloud.com, the announcements feed and a ' +
  'connectivity check to four public sites (config.sample.php, Crawler.php, InternetConnectivity.php at stable34 and v35.0.2); ' +
  'updatechecker, appstoreenabled and has_internet_connection are not switched off yet: a hook that set them false made ' +
  "the demo's first CalDAV write answer 500 in E2E (managed) #215, and it holds fixtures, never a tester's data";

/**
 * The FROM of the Dockerfile a service's `build:` names, without its digest,
 * or a problem when there is none to read.
 */
function builtFrom(svc: Service, entry: Entry): { from?: string; problems: string[] } {
  const build = svc.build as string | { context?: string } | undefined;
  const context = typeof build === 'string' ? build : build?.context;
  if (!context) return { problems: ['no build context to read the Dockerfile from'] };
  const from = /^FROM\s+(\S+)\s*$/m.exec(read(`${dirname(entry.file)}/${context.replace(/^\.\//, '')}/Dockerfile`))?.[1];
  if (!from) return { problems: [`${context}/Dockerfile has no FROM to read`] };
  return { from: from.replace(/@sha256:[0-9a-f]{64}$/, ''), problems: [] };
}

export const SWITCHED: Readonly<Record<string, Row>> = {
  'deploy/compose/managed.yml:zitadel': {
    readAt: ZITADEL,
    why: 'a daily service ping with instance domains and resource counts, to zitadel.com (cmd/defaults.yaml at v4.19.2, unchanged at v4.19.4, its ServicePing and Telemetry unchanged at v4.19.5, v4.20.0, v4.20.1, v4.20.2, v4.20.3 and v4.20.4)',
    holds: (svc) => zitadelProblems(environmentOf(svc)),
  },
  'deploy/compose/managed.yml:mailpit': {
    readAt: MAILPIT,
    why: "a release check to GitHub when its web page asks for the server's info (internal/stats/stats.go at v1.31.6, unchanged at v1.32.0, v1.33.0 and v1.33.1; at v1.34.0 the lookup changed, and the switch still stops it first)",
    holds: (svc) => exactly(environmentOf(svc), 'MP_DISABLE_VERSION_CHECK', 'true'),
  },
};

const NONE = (what: string): string => `${what} has no telemetry, update check or error report of any kind`;

/**
 * The official PostgreSQL image built here without gosu, as uid 70 (workplan
 * 0146 T15, deploy/compose/postgres/Dockerfile; the appliance's since T15b,
 * deploy/selfhost/postgres/Dockerfile). A build is `build` to this file, so
 * the row holds the software by the Dockerfile's FROM instead.
 */
const BUILT_POSTGRES: Row = {
  readAt: 'build',
  why: `${NONE('PostgreSQL')}; built here from the official image, with gosu removed and nothing added that runs`,
  holds: (svc, entry) => {
    const build = svc.build as string | { context?: string } | undefined;
    const context = typeof build === 'string' ? build : build?.context;
    if (!context) return ['no build context to read the Dockerfile from'];
    const from = /^FROM\s+(\S+)\s*$/m.exec(read(`${dirname(entry.file)}/${context.replace(/^\.\//, '')}/Dockerfile`))?.[1] ?? '';
    return /^postgres:[^/]+$/.test(from) ? [] : [`built FROM ${from || 'nothing'}, not the official postgres image`];
  },
};

/** Repositories, not tags: a new version of the same software keeps the reason; other software does not. */
export const NO_SWITCH: Readonly<Record<string, Row>> = {
  'deploy/compose/managed.yml:postgres': BUILT_POSTGRES,
  'deploy/compose/managed.yml:pgbouncer': {
    readAt: 'build',
    why: `${NONE('PgBouncer')}; built here since 2026-11-13 from edoburu's image, with five Alpine packages moved to the versions that carry their fixes and nothing added that runs`,
    holds: (svc, entry) => {
      const { from, problems } = builtFrom(svc, entry);
      if (from !== undefined && repositoryOf(from) !== 'edoburu/pgbouncer') problems.push(`built FROM ${from}, not edoburu/pgbouncer: read what it sends by default`);
      return problems;
    },
  },
  'deploy/compose/managed.yml:zitadel-machinekey': { readAt: 'busybox', why: 'a one-shot chown of a volume, with no network use' },
  'deploy/compose/managed.yml:api': { readAt: 'build', why: "Ownpace's own API: what it sends, and to whom, is privacy §7's list" },
  'deploy/compose/managed.yml:worker': {
    readAt: 'build',
    why:
      "Ownpace's own job worker (workplan 0167 T7; the only runner since alpha.18, T9), on the API's images: what " +
      "its jobs send, and to whom, is privacy §7's list, as the API's is",
  },
  'deploy/compose/managed.yml:web': { readAt: 'build', why: "Ownpace's own web app, served by nginx: no third-party script, font or tracker" },
  'deploy/compose/managed.yml:gatus': {
    readAt: 'ghcr.io/twin/gatus',
    why:
      "no telemetry at v5.38.0, and its page loads nothing from another host; its requests are gatus.yaml's probes, which " +
      'ask our own services and public pages of the providers it watches, and carry nothing about anyone',
  },
  'deploy/compose/www.yml:www': { readAt: 'nginx', why: NONE('nginx') },
  'deploy/compose/dev.yml:postgres': BUILT_POSTGRES,
  'deploy/selfhost/compose.yml:postgres': BUILT_POSTGRES,
  'deploy/selfhost/compose.yml:app': {
    readAt: 'build',
    why: "Ownpace's own appliance: self-host sends us nothing, the privacy policy's first line",
  },
};

/** The scripts that bring live up or deploy to it; neither may start the demo. */
const LIVE_SCRIPTS = Object.freeze(['stand-up-live.sh', 'deploy-live.sh']);

/**
 * The bring-up starts Nextcloud only for the demo, and neither live script lets
 * the demo start. `bootstrap` is `bootstrap-managed.sh`; `live` maps each of
 * `LIVE_SCRIPTS` to its text.
 */
export function bringUpProblems(bootstrap: string, live: Readonly<Record<string, string>>): string[] {
  const problems: string[] = [];
  const list = /\n {2}local services=\(\n([\s\S]*?)\n {2}\)\n/.exec(bootstrap)?.[1];
  if (list === undefined) problems.push("bootstrap-managed.sh's phase_app has no `local services=(` list to read");
  else if (/\bnextcloud\b/.test(list.replace(/#.*$/gm, ''))) problems.push("nextcloud is in bootstrap-managed.sh's default services, so every stack starts it");
  if (!bootstrap.includes('[ "$WITH_DEMO" -eq 1 ] && services+=(nextcloud)')) {
    problems.push('bootstrap-managed.sh no longer adds nextcloud only with --with-demo');
  }
  for (const script of LIVE_SCRIPTS) {
    if (!/if \[ "\$arg" = --with-demo \]; then\n\s+refuse /.test(live[script] ?? '')) {
      problems.push(`${script} no longer refuses --with-demo, so live could start the demo's Nextcloud`);
    }
  }
  return problems;
}

/** The scripts that bring a managed stack up; none may name `dev.yml`, whose Nextcloud is left on. */
const MANAGED_SCRIPTS = Object.freeze(['bootstrap-managed.sh', ...LIVE_SCRIPTS]);

/**
 * Known to report home, and not switched off yet. Each row's check keeps it
 * where no tester is; moving it to SWITCHED is the way out of this list.
 */
export const LEFT_ON: Readonly<Record<string, Row>> = {
  'deploy/compose/managed.yml:nextcloud': {
    readAt: NEXTCLOUD,
    line: true,
    why: `${NEXTCLOUD_PHONES}; the demo's DAV target, on the OTA stack every night, started only with --with-demo, which both live scripts refuse`,
    holds: () =>
      bringUpProblems(
        read('deploy/compose/bootstrap-managed.sh'),
        Object.fromEntries(LIVE_SCRIPTS.map((s) => [s, read(`deploy/compose/${s}`)])),
      ),
  },
  'deploy/compose/dev.yml:nextcloud': {
    readAt: NEXTCLOUD,
    line: true,
    why: `${NEXTCLOUD_PHONES}; the development and self-host end-to-end DAV target, which no managed bring-up starts`,
    holds: () =>
      MANAGED_SCRIPTS.filter((s) => read(`deploy/compose/${s}`).includes('dev.yml')).map(
        (s) => `${s} names dev.yml, so a managed stack could start the development Nextcloud`,
      ),
  },
};

/** Every key any switch reads, so an overlay cannot set one back. */
const SWITCH_KEYS = ['ZITADEL_SERVICEPING_ENABLED', 'ZITADEL_TELEMETRY_ENABLED', 'MP_DISABLE_VERSION_CHECK'];

/** The image as the rows compare it: the full reference, its repository, or `build`. */
function imageOf(svc: Service): string {
  return svc.build !== undefined ? 'build' : (svc.image ?? '');
}
function repositoryOf(image: string): string {
  if (image === 'build') return image;
  const at = image.indexOf('@');
  const noDigest = at === -1 ? image : image.slice(0, at);
  const slash = noDigest.lastIndexOf('/');
  const colon = noDigest.indexOf(':', slash + 1);
  return colon === -1 ? noDigest : noDigest.slice(0, colon);
}
/** `nextcloud:35` for `nextcloud:35.0.2-apache@sha256:…`: the repository and its tag's first number. */
function lineOf(image: string): string {
  const repository = repositoryOf(image);
  const major = /^:v?(\d+)/.exec(image.slice(repository.length))?.[1];
  return major === undefined ? image : `${repository}:${major}`;
}
/** The image as a row compares it: whole, or by its line when the row says the fact holds for one. */
const asRead = (row: Row, svc: Service): string => (row.line ? lineOf(imageOf(svc)) : imageOf(svc));

const files = composeFiles();
const entries: Entry[] = files.flatMap((file) => {
  const doc = readCompose(read(file)) as { services: Record<string, Service | null> };
  return Object.entries(doc.services).map(([name, service]) => ({ key: `${file}:${name}`, file, name, service: service ?? {} }));
});
const running = entries.filter((e) => e.service.image !== undefined || e.service.build !== undefined);
const overlays = entries.filter((e) => e.service.image === undefined && e.service.build === undefined);

describe('the reading is not vacuous', () => {
  it('found the compose files and their services', () => {
    expect(files).toEqual(
      expect.arrayContaining([
        'deploy/compose/managed.yml',
        'deploy/compose/www.yml',
        'deploy/compose/dev.yml',
        'deploy/selfhost/compose.yml',
      ]),
    );
    expect(files.length).toBeGreaterThanOrEqual(7);
    // Fifteen since alpha.18 removed Trigger.dev's eleven (workplan 0167 T9).
    expect(running.length).toBeGreaterThanOrEqual(15);
    expect(running.filter((e) => /:(trigger-|minio|clickhouse)/.test(e.key))).toEqual([]);
    expect(overlays.length).toBeGreaterThanOrEqual(3);
  });

  it('every row names a service that is there', () => {
    const keys = new Set(running.map((e) => e.key));
    const stale = [...Object.keys(SWITCHED), ...Object.keys(NO_SWITCH), ...Object.keys(LEFT_ON)].filter((k) => !keys.has(k));
    expect(stale, 'a row for a service no compose file has; remove it, or fix its key').toEqual([]);
  });
});

describe('every service is in exactly one list, and says why', () => {
  it('each running service is switched, needs no switch, or is left on, with its reason', () => {
    const verdicts = running.map((e) => ({
      key: e.key,
      lists: [SWITCHED, NO_SWITCH, LEFT_ON].filter((t) => e.key in t).length,
    }));
    expect(
      verdicts.filter((v) => v.lists !== 1).map((v) => `${v.key} is in ${v.lists} lists`),
      'A new service: read what it sends by default, at the version the file pins, and add its row to one list.',
    ).toEqual([]);
  });

  it('each reason is a reason', () => {
    for (const [key, row] of Object.entries({ ...SWITCHED, ...NO_SWITCH, ...LEFT_ON })) {
      expect(row.why.length, `${key} gives no reason`).toBeGreaterThan(30);
    }
  });
});

describe('a switched service runs the version its default was read at, with the switch off', () => {
  for (const [key, row] of Object.entries(SWITCHED)) {
    it(key, () => {
      const entry = running.find((e) => e.key === key);
      expect(entry, `${key} is gone`).toBeDefined();
      expect(
        asRead(row, entry!.service),
        `${key}'s default was read at ${row.readAt}. Re-read what the new version sends by default, then move this row.`,
      ).toBe(row.readAt);
      const unread = (['env_file', 'extends'] as const).filter((k) => entry!.service[k] !== undefined);
      expect(unread.map((k) => `${key} has ${k}, which brings in settings this check cannot read`)).toEqual([]);
      expect(row.holds!(entry!.service, entry!), `${key}: ${row.why}`).toEqual([]);
    });
  }
});

describe('a service that needs no switch is still that software, and the fact holds', () => {
  for (const [key, row] of Object.entries(NO_SWITCH)) {
    it(key, () => {
      const entry = running.find((e) => e.key === key)!;
      expect(entry, `${key} is gone`).toBeDefined();
      expect(repositoryOf(imageOf(entry.service)), `${key} is other software now; read what it sends by default`).toBe(row.readAt);
      expect(row.holds?.(entry.service, entry) ?? [], key).toEqual([]);
    });
  }
});

describe('what is left on is left on where no tester is', () => {
  for (const [key, row] of Object.entries(LEFT_ON)) {
    it(key, () => {
      const entry = running.find((e) => e.key === key)!;
      expect(entry, `${key} is gone`).toBeDefined();
      expect(asRead(row, entry.service), `${key}'s defaults were read at ${row.readAt}; re-read them at the new pin`).toBe(row.readAt);
      expect(row.holds!(entry.service, entry), `${key}: ${row.why}`).toEqual([]);
    });
  }
});

describe('an overlay runs its base image and switches nothing back on', () => {
  it('each overlay has a base beside it, overlays no switched service, and sets no switch', () => {
    const problems: string[] = [];
    for (const o of overlays) {
      const base = running.find((e) => e.name === o.name && dirname(e.file) === dirname(o.file) && e.file !== o.file);
      if (!base) problems.push(`${o.key} has no image, no build and no service of that name beside it`);
      else if (base.key in SWITCHED) problems.push(`${o.key} overlays ${base.key}, whose switch is read from its own file only`);
      for (const k of Object.keys(environmentOf(o.service))) {
        if (SWITCH_KEYS.includes(k)) problems.push(`${o.key} sets ${k}`);
      }
    }
    expect(problems).toEqual([]);
  });
});

describe('what runs outside every compose file is named, at the version it was read at', () => {
  it("the demo's Stalwart (setup-stalwart.sh, docker run) is the one whose fetches docs/managed-bring-up.md names", () => {
    const image = /^IMAGE="([^"]+)"$/m.exec(read('deploy/selfhost/setup-stalwart.sh'))?.[1];
    expect(image, "Stalwart's WebUI, spam-rule and ASN fetches were read at v1.2.0; re-read defaults.rs at the new pin").toBe(STALWART);
    const doc = read('docs/managed-bring-up.md');
    for (const host of [
      'github.com/stalwartlabs/webui',
      'github.com/stalwartlabs/spam-filter',
      'github.com/sapics/ip-location-db',
    ]) {
      expect(doc, `Nothing phones home no longer names Stalwart's ${host}`).toContain(host);
    }
  });

  it("the site's visit count (site-visits.sh, docker run) is GoAccess built from the commit read, on bases pinned by digest, never pulled, with no network", () => {
    const script = read('deploy/compose/site-visits.sh');
    const image = /^GOACCESS_IMAGE="([^"]+)"$/m.exec(script)?.[1];
    expect(image, 'the image this checkout builds, under a name no registry serves (#1675)').toBe(GOACCESS);
    const dockerfile = read('deploy/compose/goaccess/Dockerfile');
    expect(
      /^ARG UPSTREAM_COMMIT=([0-9a-f]{40})$/m.exec(dockerfile)?.[1],
      'GoAccess was read at v1.12 (ef3c4f3c) for what it sends (nothing: no telemetry, update check or report). Re-read src/gdns.c and src/websocket.c at the new commit',
    ).toBe(GOACCESS_COMMIT);
    expect(dockerfile, 'the source is checked against the commit it was read at').toMatch(/test "\$\(git rev-parse HEAD\)" = "\$UPSTREAM_COMMIT"/);
    const froms = [...dockerfile.matchAll(/^FROM\s+(\S+)/gm)].map((m) => m[1]!);
    expect(froms.length, 'the Dockerfile builds FROM nothing').toBeGreaterThan(0);
    for (const from of froms) expect(from, 'pinned by tag and digest, as the images in managed.yml are').toMatch(/^[^@\s]+:[^@\s]+@sha256:[0-9a-f]{64}$/);
    const code = script
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .join('\n');
    expect(code, 'site-visits.sh no longer runs its image').toMatch(/\bdocker run\b/);
    expect(code, 'site-visits.sh no longer runs its image').toMatch(/"\$\{?GOACCESS_IMAGE\}?"/);
    expect(code, 'GoAccess runs with a network: nothing it might send could be stopped').toMatch(/--network none\b/);
    expect(code, 'an image missing on the machine would be pulled under its name').toMatch(/docker run [^\n]*--pull never\b/);
    expect(code, 'site-visits.sh no longer builds its image from goaccess/').toMatch(/docker build [^\n]*"\$\{?GOACCESS_IMAGE\}?" "\$\{?GOACCESS_CONTEXT\}?"/);
    expect(script).toMatch(/^GOACCESS_CONTEXT="\$\{SCRIPT_DIR\}\/goaccess"$/m);
    const doc = read('docs/managed-bring-up.md');
    const section = /^## Nothing phones home\n([\s\S]*?)^## /m.exec(doc)?.[1] ?? '';
    expect(section, 'Nothing phones home no longer names the visit count').toContain('allinurl/goaccess');
    expect(section, 'Nothing phones home no longer says GoAccess runs with no network').toContain('--network none');
  });
});

describe('the checks refuse what a regression would write', () => {
  it('a key written with no value is passed through from the shell or .env, in both shapes', () => {
    const off = { ZITADEL_SERVICEPING_ENABLED: 'false', ZITADEL_TELEMETRY_ENABLED: 'false' };
    expect(zitadelProblems(environmentOf({ environment: { ...off, ZITADEL_SERVICEPING_ENABLED: null } }))).toHaveLength(1);
    expect(environmentOf({ environment: { MP_DISABLE_VERSION_CHECK: 'true', MP_UI_AUTH: null } })).toEqual({
      MP_DISABLE_VERSION_CHECK: 'true',
      MP_UI_AUTH: '${MP_UI_AUTH}',
    });
    expect(environmentOf({ environment: ['MP_DISABLE_VERSION_CHECK=true', 'MP_UI_AUTH'] })).toEqual({
      MP_DISABLE_VERSION_CHECK: 'true',
      MP_UI_AUTH: '${MP_UI_AUTH}',
    });
    expect(exactly(environmentOf({ environment: ['MP_DISABLE_VERSION_CHECK'] }), 'MP_DISABLE_VERSION_CHECK', 'true')).toHaveLength(1);
    expect(environmentOf({ environment: { ZITADEL_TELEMETRY_ENABLED: '' } })).toEqual({ ZITADEL_TELEMETRY_ENABLED: '' });
  });

  it('a key merged in from an anchor is read, as Compose reads it', () => {
    const doc = readCompose(
      [
        'x-extra: &extra',
        '  ZITADEL_SERVICEPING_ENDPOINT: https://ping.example.invalid',
        'services:',
        '  zitadel:',
        '    image: x',
        '    environment:',
        '      <<: *extra',
        '      ZITADEL_SERVICEPING_ENABLED: "false"',
        '      ZITADEL_TELEMETRY_ENABLED: "false"',
        '',
      ].join('\n'),
    )!;
    const env = environmentOf(doc.services!['zitadel']!);
    expect(Object.keys(env)).toContain('ZITADEL_SERVICEPING_ENDPOINT');
    expect(zitadelProblems(env)).toHaveLength(1);
  });

  it('Zitadel: a ping left on, left out, or given an endpoint', () => {
    const off = { ZITADEL_SERVICEPING_ENABLED: 'false', ZITADEL_TELEMETRY_ENABLED: 'false' };
    expect(zitadelProblems(off)).toEqual([]);
    expect(zitadelProblems({ ...off, ZITADEL_SERVICEPING_ENABLED: 'true' })).toHaveLength(1);
    expect(zitadelProblems({ ZITADEL_TELEMETRY_ENABLED: 'false' })).toHaveLength(1);
    expect(zitadelProblems({ ...off, ZITADEL_SERVICEPING_ENABLED: '${PING:-false}' })).toHaveLength(1);
    expect(zitadelProblems({ ...off, ZITADEL_SERVICEPING_ENDPOINT: 'https://example.invalid' })).toHaveLength(1);
  });

  it('Nextcloud left on: in the default bring-up, not only with --with-demo, or a live script that lets the demo start', () => {
    const bootstrap = [
      'phase_app() {',
      '  local services=(',
      '    postgres api web',
      '    # nextcloud is added below, for the demo only',
      '  )',
      '  [ "$WITH_DEMO" -eq 1 ] && services+=(nextcloud)',
      '}',
      '',
    ].join('\n');
    const refuses = 'for arg in "$@"; do\n  if [ "$arg" = --with-demo ]; then\n    refuse "--with-demo."\n  fi\ndone\n';
    const live = { 'stand-up-live.sh': refuses, 'deploy-live.sh': refuses };
    expect(bringUpProblems(bootstrap, live)).toEqual([]);
    expect(bringUpProblems(bootstrap.replace('postgres api web', 'postgres api web nextcloud'), live)).toHaveLength(1);
    expect(bringUpProblems(bootstrap.replace('  [ "$WITH_DEMO" -eq 1 ] && services+=(nextcloud)\n', ''), live)).toHaveLength(1);
    expect(bringUpProblems(bootstrap, { ...live, 'deploy-live.sh': refuses.replace('--with-demo ]', '--demo ]') })).toHaveLength(1);
    expect(bringUpProblems(bootstrap, { 'stand-up-live.sh': refuses })).toHaveLength(1);
  });
});
