// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A SERVICE THAT PHONES HOME.
 *
 * The privacy policy says the service runs in the EU and names every party that
 * receives anything (§7, §8); on 2026-09-28 the owner chose, for the question
 * ops-telemetry, *"Switch it off everywhere"* (workplan 0139). Six images in
 * `managed.yml` reported to, or asked, their makers by default until then, each
 * read at the version this repository pins:
 *
 *  - TRIGGER.DEV'S WEBAPP (v4.5.16), three ways. Its server's PostHog identified
 *    the user by id, email and name at every sign-in (`services/postAuth.server.ts`
 *    calls `telemetry.user.identify`, `services/telemetry.server.ts`) and sent
 *    events when a user, an organisation or a project was created. Its dashboard
 *    loaded PostHog in the browser and identified the signed-in user by id and
 *    email (`app/hooks/usePostHog.ts`), with a project key that defaults to
 *    Trigger.dev's own (`app/env.server.ts`, `POSTHOG_PROJECT_KEY`). And its
 *    entrypoint runs `prisma migrate deploy` at every start
 *    (`docker/scripts/entrypoint.sh`; prisma 6.14.0), whose CLI sends a
 *    checkpoint to `checkpoint.prisma.io` (`packages/cli/src/CLI.ts` calls
 *    `runCheckpointClientCheck` for every command; checkpoint-client 1.1.33):
 *    the version, OS, architecture, Node, CI, the command, hashes of the
 *    project's and the CLI's paths, the schema's providers and a stored random
 *    signature. Upstream's documented opt-out, `TRIGGER_TELEMETRY_DISABLED`,
 *    stops only the first: the constructor returns early when it is set to
 *    anything, and nothing else reads it. The browser's half starts whenever
 *    the key is not empty (`usePostHog` returns early on `undefined` or `""`
 *    only), so the key is set to the empty string beside it; the checkpoint
 *    stops only on `CHECKPOINT_DISABLE` (`utils/checkpoint.ts`, and the client
 *    again), so that is set too. The entrypoint's other children do not call
 *    out: pnpm 10.33.2 checks for its own update only on `install` and `add`
 *    (`pnpm/src/main.ts`), goose v3.27.1 has no network use of its own, and the
 *    dashboard agent's migration is plain drizzle-orm.
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
 *  - CLICKHOUSE (26.2.19.43) sends a crash report, and a report on a logical
 *    error, to `https://crash.clickhouse.com/`: the `config.xml` the image
 *    ships (`programs/server/config.xml` at `v26.2.19.43-stable`) sets
 *    `send_crash_reports.enabled` true, although the code's own default is
 *    false (`src/Daemon/CrashWriter.cpp`). A file in `config.d` turns it off,
 *    and it must be the only file ClickHouse merges that speaks of crash
 *    reports: it merges every `.xml`, `.conf`, `.yaml` and `.yml` in `config.d`
 *    and `conf.d`, in sorted order, so a later one wins
 *    (`src/Common/Config/ConfigProcessor.cpp`, `getConfigMergeFiles`).
 *  - MINIO (bitnamilegacy 2025.5.24) asks `dl.min.io` for the newest release at
 *    every start, with a User-Agent that carries the OS, the architecture,
 *    `docker`, its version and the CPU's count, vendor and model
 *    (`cmd/server-main.go`, `cmd/update.go` at `RELEASE.2025-05-24T17-08-30Z`),
 *    unless `MINIO_UPDATE` is `off`. Its call-home to SUBNET ships `off`
 *    (`internal/config/callhome/callhome.go`) and is written out here too.
 *  - MAILPIT (v1.31.1, the test stack's catcher; live has none) asks GitHub for
 *    its newest release whenever its web page asks for the server's info,
 *    unless `MP_DISABLE_VERSION_CHECK` says true (`internal/stats/stats.go`).
 *  - NEXTCLOUD (34, the demo's DAV target on the OTA stack every night, and the
 *    development one) sends its version, PHP version and install time to
 *    `updates.nextcloud.com`, asks `apps.nextcloud.com` for the app store, the
 *    announcements feed at `pushfeed.nextcloud.com`, and four public sites for
 *    a connectivity check (`config/config.sample.php` at `stable34`:
 *    `updatechecker`, `appstoreenabled` and `has_internet_connection` all
 *    true). `has_internet_connection` false is what the announcements crawler,
 *    the connectivity check and the lookup-server upload each read
 *    (`nextcloud_announcements` `lib/Cron/Crawler.php`,
 *    `apps/settings/lib/SetupChecks/InternetConnectivity.php`,
 *    `apps/lookup_server_connector/lib/BackgroundJobs/RetryJob.php`). The
 *    switches are `config.php` values, set by a hook the image runs before
 *    Apache starts (`/docker-entrypoint-hooks.d/before-starting`, the image's
 *    `entrypoint.sh`): a file mounted into `config/` instead would make that
 *    directory non-empty before the first install, and the entrypoint then
 *    skips copying the image's own config files, `smtp.config.php` among them.
 *
 * THE RULE. Every service in every compose file under `deploy/` is in exactly
 * one of two lists below, keyed by file and service, and the lists name no
 * service that is not there:
 *
 *  - SWITCHED: it has a default that reports home, and the switch that stops it
 *    is written in the file, as a literal (a `${…}`, or a key with no value,
 *    comes from the shell or the `.env` and can be empty, or unset, on a
 *    machine this cannot see). The row records the image the default was read
 *    at, and a different image in the file fails here until somebody re-reads
 *    the default at the new version and moves the row. A new release is exactly
 *    where a new report appears: Zitadel's ping arrived with v4. A switched
 *    service takes nothing from `env_file` or `extends`, and no overlay, since
 *    neither is read here.
 *  - NO SWITCH: nothing in it reports home, and the row says why. It records the
 *    image's repository, so a different piece of software under the same service
 *    name is a new question.
 *
 * A service with neither `image` nor `build` is an overlay of the service of the
 * same name in another file beside it; what runs is that service's image, and an
 * overlay may set none of the switches below. The files are read with YAML merge
 * keys applied, as Compose applies them, so a `<<: *anchor` hides nothing.
 *
 * WHAT IS LEFT ON, AND WHERE: the demo's Stalwart (v0.16.10), which
 * `setup-stalwart.sh` starts with `docker run`, outside every compose file, on
 * the OTA stack every night and in the self-host end-to-end run. In normal mode
 * it fetches its WebUI from `github.com/stalwartlabs/webui/releases/latest` on
 * first start and every 30 days, its spam-filter rules from
 * `github.com/stalwartlabs/spam-filter/releases/latest`, and an ASN and country
 * database from `cdn.jsdelivr.net` every day
 * (`crates/common/src/manager/defaults.rs`, `SpamSettings` in
 * `crates/registry/src/schema/structs_impl.rs`). Each is an object in its
 * database, not in its one-line file on disk, so switching it off is new
 * objects in the provisioning plan, and Stalwart settings written without
 * being run are how this repository's Stalwart went wrong before
 * (`docs/stalwart-integration-fix.md`). So they are named, pinned below, and
 * put to the owner rather than switched here.
 *
 * WHAT THIS CANNOT SEE. A running container, or a machine's `.env`: live's own
 * `TRIGGER_IMAGE_TAG` would run another webapp than the default read here, which
 * is why `docs/managed-bring-up.md`, *Nothing phones home*, has the check to run
 * on the machine. The deploy CLI, which runs on the host: at 4.5.16
 * `packages/cli-v3/src/telemetry/tracing.ts` is gone, and `handleTelemetry` in
 * `src/cli/common.ts` only runs the command, so no exporter of its own was
 * found. The integration tests' throwaway Nextcloud and Stalwart, started by
 * Testcontainers on a CI runner. And what a service does once somebody
 * configures it to: every key the webapp is given is in `WEBAPP_KEYS` below
 * with its reason, and any other key fails here until somebody has read what
 * it does.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, normalize } from 'node:path';
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
}

interface Entry {
  /** `deploy/compose/managed.yml:trigger-api`, so a failure names the entry. */
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

/**
 * Keys that switch a third party on in Trigger.dev's webapp, all read at
 * v4.5.16 (`apps/webapp/app/env.server.ts`), each off while unset. The list
 * also stops an overlay setting one; `WEBAPP_KEYS` below is what holds the
 * webapp itself.
 */
export const WEBAPP_THIRD_PARTIES = Object.freeze([
  'SENTRY_DSN',
  'LOOPS_API_KEY',
  'ATTIO_API_KEY',
  'KAPA_AI_WEBSITE_ID',
  'PLAIN_API_KEY',
  'BETTERSTACK_API_KEY',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'AWS_BEARER_TOKEN_BEDROCK',
  'RESEND_API_KEY',
  'EMAIL_TRANSPORT',
  'ALERT_EMAIL_TRANSPORT',
  'ALERT_RESEND_API_KEY',
  'S2_ENABLED',
  'REALTIME_STREAMS_S2_ACCESS_TOKEN',
  'DASHBOARD_AGENT_SECRET_KEY',
  'SLACK_BOT_TOKEN',
  'ORG_SLACK_INTEGRATION_CLIENT_ID',
  'VERCEL_INTEGRATION_CLIENT_ID',
  'AUTH_GITHUB_CLIENT_ID',
  'AUTH_GOOGLE_CLIENT_ID',
  'DEPOT_TOKEN',
]);

/**
 * EVERY key `trigger-api` may set, and why it reaches no third party. A key not
 * here fails the webapp's row until somebody has read what it does at the
 * pinned version: a list of the third parties could only ever be as long as
 * the reading that wrote it.
 */
export const WEBAPP_KEYS: Readonly<Record<string, string>> = Object.freeze({
  DATABASE_URL: 'trigger-db, on this network',
  DIRECT_URL: 'trigger-db, on this network',
  SESSION_SECRET: 'a secret; names no host',
  MAGIC_LINK_SECRET: 'a secret; names no host',
  ENCRYPTION_KEY: 'a secret; names no host',
  LOGIN_SECRET: 'a secret; names no host, and env.server.ts at v4.5.16 does not read it',
  MANAGED_WORKER_SECRET: 'a secret; names no host',
  APP_ORIGIN: "the dashboard's own origin",
  LOGIN_ORIGIN: "the dashboard's own origin",
  API_ORIGIN: "the webapp's own port on the host's loopback, for the deploy CLI",
  REDIS_HOST: 'trigger-redis, on this network',
  REDIS_PORT: "trigger-redis's port",
  REDIS_TLS_DISABLED: 'plain Redis on this network',
  DEPLOY_REGISTRY_HOST: "trigger-registry, on the host's loopback",
  DEPLOY_REGISTRY_NAMESPACE: "a namespace in that registry",
  DEPLOY_IMAGE_PLATFORM: 'the architecture task images are built for',
  OBJECT_STORE_BASE_URL: 'minio, on this network',
  OBJECT_STORE_ACCESS_KEY_ID: "minio's user",
  OBJECT_STORE_SECRET_ACCESS_KEY: "minio's password",
  CLICKHOUSE_URL: 'clickhouse, on this network',
  RUN_REPLICATION_CLICKHOUSE_URL: 'clickhouse, on this network',
  REALTIME_STREAMS_DEFAULT_VERSION: 'v1 is Redis; v2 reaches S2 only with REALTIME_STREAMS_S2_ACCESS_TOKEN, a third party above',
  TRIGGER_BOOTSTRAP_ENABLED: 'writes the worker token to the shared volume',
  TRIGGER_BOOTSTRAP_WORKER_GROUP_NAME: "the worker group's name",
  TRIGGER_BOOTSTRAP_WORKER_TOKEN_PATH: 'a path on the shared volume',
  PORT: "the server's own port",
  APP_LOG_LEVEL: 'its log level',
  TRIGGER_TELEMETRY_DISABLED: "the switch for the server's PostHog",
  POSTHOG_PROJECT_KEY: "the switch for the dashboard's PostHog, empty",
  CHECKPOINT_DISABLE: "the switch for Prisma's checkpoint at every start",
});

/** Trigger.dev's webapp: both halves of its PostHog and Prisma's checkpoint off, and no key nobody has read. */
export function webappProblems(env: Record<string, string>): string[] {
  const problems: string[] = [];
  const disabled = env['TRIGGER_TELEMETRY_DISABLED'];
  if (disabled === undefined) problems.push('TRIGGER_TELEMETRY_DISABLED is not set, so the server sends PostHog events');
  else if (!literal(disabled) || disabled === '') {
    problems.push(`TRIGGER_TELEMETRY_DISABLED is "${disabled}"; upstream's docs ask for a value that is not empty, written in the file ("1")`);
  }
  const key = env['POSTHOG_PROJECT_KEY'];
  if (key === undefined) problems.push("POSTHOG_PROJECT_KEY is not set, so the dashboard loads PostHog in the browser with Trigger.dev's own key");
  else if (!literal(key)) {
    problems.push(`POSTHOG_PROJECT_KEY is ${key}, from the shell or the .env, and unset there it is Trigger.dev's own key; write POSTHOG_PROJECT_KEY: ""`);
  } else if (key !== '') problems.push(`POSTHOG_PROJECT_KEY is "${key}"; only the empty string stops the dashboard loading PostHog`);
  for (const p of exactly(env, 'CHECKPOINT_DISABLE', '1')) {
    problems.push(`${p}: the entrypoint's prisma migrate deploy sends a checkpoint to checkpoint.prisma.io at every start`);
  }
  for (const k of Object.keys(env)) {
    if (WEBAPP_THIRD_PARTIES.includes(k)) problems.push(`${k} is set, which switches a third party on`);
    else if (!(k in WEBAPP_KEYS)) {
      problems.push(`${k} is set and is not in WEBAPP_KEYS: read what it does at the pinned version, and add it with the reason it reaches no third party`);
    }
  }
  return problems;
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

/** The crash-report block of one ClickHouse XML config file, comments removed, or undefined. */
export function crashReportBlock(xml: string): string | undefined {
  const bare = xml.replace(/<!--[\s\S]*?-->/g, '');
  return /<send_crash_reports(?:\s[^>]*)?>([\s\S]*?)<\/send_crash_reports>/.exec(bare)?.[1];
}

interface ConfigFile {
  readonly path: string;
  readonly text: string;
}
const isYaml = (path: string): boolean => /\.ya?ml$/i.test(path);
/** Whether a file ClickHouse merges says anything about crash reports. */
const speaks = (f: ConfigFile): boolean =>
  isYaml(f.path) ? /\bsend_crash_reports\b/.test(f.text.replace(/#.*$/gm, '')) : crashReportBlock(f.text) !== undefined;

/** ClickHouse: exactly one file it merges speaks of crash reports, in XML, and turns both off. */
export function clickhouseProblems(files: ReadonlyArray<ConfigFile>): string[] {
  const speaking = files.filter(speaks);
  if (speaking.length === 0) {
    return ["no file ClickHouse merges from config.d or conf.d sets send_crash_reports, so the shipped config.xml's `true` applies"];
  }
  if (speaking.length > 1) {
    return [`${speaking.map((f) => f.path).join(' and ')} each set send_crash_reports; one file says it, so the order of config.d cannot decide it`];
  }
  const only = speaking[0]!;
  if (isYaml(only.path)) return [`${only.path} sets send_crash_reports in YAML; say it in XML, as clickhouse-no-crash-reports.xml does, where this check reads the values`];
  const block = crashReportBlock(only.text)!;
  const problems: string[] = [];
  for (const tag of ['enabled', 'send_logical_errors']) {
    const value = new RegExp(`<${tag}>\\s*([^<]*?)\\s*</${tag}>`).exec(block)?.[1];
    if (value !== 'false') {
      problems.push(`${only.path}: send_crash_reports.${tag} is ${value === undefined ? 'not set, so the shipped true applies' : `"${value}"`}; it must be false`);
    }
  }
  return problems;
}

/** The directories ClickHouse merges over `config.xml` (`getConfigMergeFiles`), and the files it takes from them. */
const CLICKHOUSE_MERGE_DIRS = Object.freeze(['/etc/clickhouse-server/config.d', '/etc/clickhouse-server/conf.d']);
const mergedName = (name: string): boolean => /\.(xml|conf|ya?ml)$/i.test(name) && !name.startsWith('.');

/**
 * Every file ClickHouse merges from a mount of this service, read from beside
 * the compose file, and a problem for each mount into a merge directory whose
 * files this cannot read.
 */
export function clickhouseMerged(svc: Service, composeFile: string, root = REPO_ROOT): { files: ConfigFile[]; problems: string[] } {
  const files: ConfigFile[] = [];
  const problems: string[] = [];
  for (const m of mountsOf(svc)) {
    const target = m.target.replace(/\/+$/, '');
    if (CLICKHOUSE_MERGE_DIRS.some((d) => d.startsWith(`${target}/`))) {
      problems.push(`${m.source} is mounted over ${target}, which holds config.d; this check reads the files mounted into it, not that`);
      continue;
    }
    const dir = CLICKHOUSE_MERGE_DIRS.find((d) => target === d || target.startsWith(`${d}/`));
    if (dir === undefined) continue;
    const whole = target === dir;
    const name = target.slice(dir.length + 1);
    // A subdirectory, or a name ClickHouse skips: nothing it merges.
    if (!whole && (name.includes('/') || !mergedName(name))) continue;
    if (!/^\.\.?\//.test(m.source) || m.source.includes('$')) {
      problems.push(`${m.source}:${m.target} is not a path beside the compose file, so this cannot read what ClickHouse merges from it`);
      continue;
    }
    const path = normalize(join(dirname(composeFile), m.source));
    const abs = join(root, path);
    if (!existsSync(abs)) {
      problems.push(`${path} is mounted into ${dir} and is not there`);
      continue;
    }
    if (statSync(abs).isDirectory()) {
      if (!whole) continue; // a directory at a file's name: ClickHouse merges regular files only
      for (const f of readdirSync(abs).sort()) {
        if (mergedName(f) && statSync(join(abs, f)).isFile()) files.push({ path: `${path}/${f}`, text: readFileSync(join(abs, f), 'utf8') });
      }
    } else if (whole) problems.push(`${path} is a file mounted over ${dir}, a directory`);
    else files.push({ path, text: readFileSync(abs, 'utf8') });
  }
  return { files, problems };
}

/** Caddy: every site issues its own certificate, so no certificate authority is asked. */
export function caddyProblems(caddyfile: string): string[] {
  const bare = caddyfile.replace(/#.*$/gm, '');
  const problems: string[] = [];
  // A site is a line that starts at the margin and ends in its block's `{`; the
  // global options block is a `{` alone, and a nested block is indented.
  const sites = [...bare.matchAll(/^(\S[^\n]*?)[ \t]+\{[ \t]*$/gm)].map((m) => m[1]!);
  if (sites.length === 0) problems.push('the Caddyfile has no site block to read');
  if ((bare.match(/^\s*tls\s+internal\s*$/gm) ?? []).length < sites.length) {
    problems.push(`${sites.length} site(s) and fewer \`tls internal\` lines: a site without it asks a public certificate authority, in the US, for a certificate`);
  }
  if (/\b(acme_ca|acme_dns|email)\b/.test(bare)) problems.push('the Caddyfile configures ACME, which asks a certificate authority');
  return problems;
}

/** Nextcloud's three switches, each a `config.php` boolean read at `stable34`. */
export const NEXTCLOUD_SWITCHES = Object.freeze(['updatechecker', 'appstoreenabled', 'has_internet_connection']);
/** Where the image runs a hook before Apache starts, after its install or upgrade (`entrypoint.sh`, `run_path before-starting`). */
const NEXTCLOUD_HOOKS = '/docker-entrypoint-hooks.d/before-starting/';
const NEXTCLOUD_HOOK_SOURCE = 'deploy/compose/nextcloud-no-phone-home.sh';

/**
 * The hook sets each switch once, to the boolean false, with `occ`. A string
 * "false" is true to PHP (`getSystemValueBool` casts it), and the connectivity
 * check compares with `=== false`.
 */
export function nextcloudHookProblems(script: string): string[] {
  const lines = script
    .split('\n')
    .map((l) => l.replace(/(^|\s)#.*$/, '').trim())
    .filter(Boolean);
  const problems: string[] = [];
  if (!lines.includes('set -euo pipefail')) {
    problems.push('the hook does not say `set -euo pipefail`, so an occ that fails would not stop the container');
  }
  for (const key of NEXTCLOUD_SWITCHES) {
    const sets = lines.filter((l) => new RegExp(`\\bconfig:system:set\\s+${key}(\\s|$)`).test(l));
    if (sets.length === 0) problems.push(`${key} is not set, so Nextcloud's own true applies`);
    else if (sets.length > 1) problems.push(`${key} is set ${sets.length} times; once, to false`);
    else if (!/^(php\s+\S*occ|occ)\s+config:system:set\s/.test(sets[0]!)) problems.push(`${key}: "${sets[0]}" is not an occ call`);
    else if (!/\s--type=boolean(\s|$)/.test(sets[0]!) || !/\s--value=false(\s|$)/.test(sets[0]!)) {
      problems.push(`${key}: "${sets[0]}"; it must be --type=boolean --value=false`);
    }
  }
  return problems;
}

/** The Nextcloud service runs the hook: mounted from this repository, executable and tracked so, and the image's own entrypoint and command. */
function nextcloudProblems(svc: Service, entry: Entry): string[] {
  const problems: string[] = [];
  if (svc.entrypoint !== undefined) problems.push("an entrypoint is set, and only the image's own runs the hooks");
  if (svc.command !== undefined) {
    const first = Array.isArray(svc.command) ? String(svc.command[0]) : String(svc.command).trim().split(/\s+/)[0];
    if (!/^apache/.test(first ?? '')) problems.push(`the command is ${first}, and the image runs its hooks only before Apache`);
  }
  const hooks = mountsOf(svc).filter((m) => m.target.startsWith(NEXTCLOUD_HOOKS) && m.target.endsWith('.sh'));
  if (hooks.length !== 1) return [...problems, `${hooks.length} hooks are mounted into ${NEXTCLOUD_HOOKS}; one, ${NEXTCLOUD_HOOK_SOURCE}`];
  const path = normalize(join(dirname(entry.file), hooks[0]!.source));
  if (path !== NEXTCLOUD_HOOK_SOURCE) return [...problems, `the hook mounted is ${path}, not ${NEXTCLOUD_HOOK_SOURCE}`];
  if (!existsSync(join(REPO_ROOT, path))) return [...problems, `${path} is not there`];
  if ((statSync(join(REPO_ROOT, path)).mode & 0o111) === 0) problems.push(`${path} is not executable, and the image skips a hook that is not`);
  const staged = spawnSync('git', ['ls-files', '-s', path], { cwd: REPO_ROOT, encoding: 'utf8' }).stdout;
  if (!staged.startsWith('100755 ')) problems.push(`${path} is not in git as 100755 (${staged.split(' ')[0] || 'untracked'}), so a checkout would mount it without its executable bit`);
  return [...problems, ...nextcloudHookProblems(read(path))];
}

interface Row {
  /** Exactly the `image:` the file writes, as the default was read at; `build` for our own. */
  readonly readAt: string;
  /** What it sends by default and where that was read, or why it needs no switch. */
  readonly why: string;
  /** Problems with the switch, or with the fact the row rests on; empty when it holds. */
  readonly holds?: (svc: Service, entry: Entry) => string[];
}

const TRIGGER_WEBAPP = 'ghcr.io/triggerdotdev/trigger.dev:${TRIGGER_IMAGE_TAG:-v4.5.16}';
const ZITADEL = 'ghcr.io/zitadel/zitadel:v4.19.2';
const CLICKHOUSE =
  'clickhouse/clickhouse-server:26.2.19.43@sha256:c2f2605585899d5103a0447daadbc0005f362200d5f0fcca7f40db3ca0dd36dd';
const MINIO =
  'bitnamilegacy/minio:2025.5.24-debian-12-r5@sha256:451fe6858cb770cc9d0e77ba811ce287420f781c7c1b806a386f6896471a349c';
const MAILPIT =
  'axllent/mailpit:v1.31.1@sha256:98b916bd3c8d61f7633a52d3ea2f58d00620cb01ca57ab59edde68c347a95365';
const NEXTCLOUD = 'nextcloud:34-apache';
/** The demo's Stalwart, outside every compose file; its fetches were read at this tag. */
const STALWART = 'stalwartlabs/stalwart:v0.16.10';

const NEXTCLOUD_PHONES =
  'its version and PHP version to updates.nextcloud.com, the app store at apps.nextcloud.com, the announcements feed and a ' +
  'connectivity check to four public sites (config.sample.php, Crawler.php, InternetConnectivity.php at stable34); ' +
  'nextcloud-no-phone-home.sh, a before-starting hook, sets updatechecker, appstoreenabled and has_internet_connection false';

export const SWITCHED: Readonly<Record<string, Row>> = {
  'deploy/compose/managed.yml:trigger-api': {
    readAt: TRIGGER_WEBAPP,
    why:
      "PostHog from the server at every sign-in (id, email, name) and on user, organisation and project creation, PostHog in " +
      "the dashboard's browser with the signed-in user's id and email, and Prisma's checkpoint to checkpoint.prisma.io at every " +
      'start (telemetry.server.ts, postAuth.server.ts, usePostHog.ts, env.server.ts, docker/scripts/entrypoint.sh at v4.5.16; ' +
      'prisma 6.14.0 CLI.ts and utils/checkpoint.ts)',
    holds: (svc) => webappProblems(environmentOf(svc)),
  },
  'deploy/compose/managed.yml:zitadel': {
    readAt: ZITADEL,
    why: 'a daily service ping with instance domains and resource counts, to zitadel.com (cmd/defaults.yaml at v4.19.2)',
    holds: (svc) => zitadelProblems(environmentOf(svc)),
  },
  'deploy/compose/managed.yml:clickhouse': {
    readAt: CLICKHOUSE,
    why: 'crash and logical-error reports to crash.clickhouse.com (programs/server/config.xml at v26.2.19.43-stable)',
    holds: (svc, entry) => {
      const { files, problems } = clickhouseMerged(svc, entry.file);
      return [...problems, ...clickhouseProblems(files)];
    },
  },
  'deploy/compose/managed.yml:minio': {
    readAt: MINIO,
    why:
      'a release check to dl.min.io at every start, its User-Agent carrying OS, architecture, version and CPU ' +
      '(cmd/server-main.go, cmd/update.go, cmd/common-main.go at RELEASE.2025-05-24T17-08-30Z)',
    holds: (svc) => {
      const env = environmentOf(svc);
      return [...exactly(env, 'MINIO_UPDATE', 'off'), ...exactly(env, 'MINIO_CALLHOME_ENABLE', 'off')];
    },
  },
  'deploy/compose/managed.yml:mailpit': {
    readAt: MAILPIT,
    why: "a release check to GitHub when its web page asks for the server's info (internal/stats/stats.go at v1.31.1)",
    holds: (svc) => exactly(environmentOf(svc), 'MP_DISABLE_VERSION_CHECK', 'true'),
  },
  'deploy/compose/managed.yml:nextcloud': {
    readAt: NEXTCLOUD,
    why: `${NEXTCLOUD_PHONES}; the demo's DAV target, on the OTA stack every night`,
    holds: nextcloudProblems,
  },
  'deploy/compose/dev.yml:nextcloud': {
    readAt: NEXTCLOUD,
    why: `${NEXTCLOUD_PHONES}; the development and self-host end-to-end DAV target`,
    holds: nextcloudProblems,
  },
  'deploy/compose/managed.yml:trigger-tls': {
    readAt: 'caddy:2-alpine',
    why:
      'Caddy 2 has no telemetry (its repository names it only for the opt-in `tracing` directive), and its one ' +
      'default that leaves the machine is automatic HTTPS, which asks a public certificate authority; `tls internal` ' +
      'in the mounted Caddyfile is the switch',
    holds: (svc, entry) => {
      const file = mountsOf(svc).find((m) => m.target === '/etc/caddy/Caddyfile');
      if (!file) return ['no Caddyfile is mounted at /etc/caddy/Caddyfile, so the image default runs'];
      return caddyProblems(read(`${dirname(entry.file)}/${file.source.replace(/^\.\//, '')}`));
    },
  },
};

const NONE = (what: string): string => `${what} has no telemetry, update check or error report of any kind`;

/** Repositories, not tags: a new version of the same software keeps the reason; other software does not. */
export const NO_SWITCH: Readonly<Record<string, Row>> = {
  'deploy/compose/managed.yml:postgres': { readAt: 'postgres', why: NONE('PostgreSQL') },
  'deploy/compose/managed.yml:trigger-db': { readAt: 'postgres', why: NONE('PostgreSQL') },
  'deploy/compose/managed.yml:pgbouncer': { readAt: 'edoburu/pgbouncer', why: NONE('PgBouncer') },
  'deploy/compose/managed.yml:trigger-redis': { readAt: 'redis', why: NONE('Redis') },
  'deploy/compose/managed.yml:trigger-registry': {
    readAt: 'registry',
    why:
      "distribution v3.1.1 builds OpenTelemetry's exporter from OTEL_* variables (tracing/tracing.go); with none set " +
      'its default is OTLP to localhost inside its own container, so nothing leaves',
    holds: (svc) => Object.keys(environmentOf(svc)).filter((k) => k.startsWith('OTEL_')).map((k) => `${k} is set, which could send its traces somewhere`),
  },
  'deploy/compose/managed.yml:trigger-docker-proxy': {
    readAt: 'tecnativa/docker-socket-proxy',
    why: 'HAProxy in front of the Docker socket: it answers the supervisor and calls nothing',
  },
  'deploy/compose/managed.yml:trigger-supervisor': {
    readAt: 'ghcr.io/triggerdotdev/supervisor',
    why:
      "its settings at v4.5.16 (apps/supervisor/src/env.ts) have no analytics or error report; it sends its traces to the webapp's " +
      'own /otel and serves its metrics on its own loopback',
    holds: (svc) => {
      const otel = environmentOf(svc)['OTEL_EXPORTER_OTLP_ENDPOINT'];
      return otel !== undefined && /^http:\/\/trigger-api:\d+\/otel$/.test(otel)
        ? []
        : [`OTEL_EXPORTER_OTLP_ENDPOINT is ${otel ?? 'not set'}; it must be the webapp's own http://trigger-api:<port>/otel`];
    },
  },
  'deploy/compose/managed.yml:zitadel-machinekey': { readAt: 'busybox', why: 'a one-shot chown of a volume, with no network use' },
  'deploy/compose/managed.yml:api': { readAt: 'build', why: "Ownpace's own API: what it sends, and to whom, is privacy §7's list" },
  'deploy/compose/managed.yml:web': { readAt: 'build', why: "Ownpace's own web app, served by nginx: no third-party script, font or tracker" },
  'deploy/compose/managed.yml:gatus': {
    readAt: 'ghcr.io/twin/gatus',
    why:
      "no telemetry at v5.36.0, and its page loads nothing from another host; its requests are gatus.yaml's probes, which " +
      'ask our own services and public pages of the providers it watches, and carry nothing about anyone',
  },
  'deploy/compose/www.yml:www': { readAt: 'nginx', why: NONE('nginx') },
  'deploy/compose/dev.yml:postgres': { readAt: 'postgres', why: NONE('PostgreSQL') },
  'deploy/selfhost/compose.yml:postgres': { readAt: 'postgres', why: NONE('PostgreSQL') },
  'deploy/selfhost/compose.yml:app': {
    readAt: 'build',
    why: "Ownpace's own appliance: self-host sends us nothing, the privacy policy's first line",
  },
};

/** Every key any switch reads, so an overlay cannot set one back. */
const SWITCH_KEYS = [
  'TRIGGER_TELEMETRY_DISABLED',
  'POSTHOG_PROJECT_KEY',
  'CHECKPOINT_DISABLE',
  ...WEBAPP_THIRD_PARTIES,
  'ZITADEL_SERVICEPING_ENABLED',
  'ZITADEL_TELEMETRY_ENABLED',
  'MINIO_UPDATE',
  'MINIO_CALLHOME_ENABLE',
  'MP_DISABLE_VERSION_CHECK',
];

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
    expect(running.length).toBeGreaterThanOrEqual(23);
    expect(overlays.length).toBeGreaterThanOrEqual(3);
  });

  it('every row names a service that is there', () => {
    const keys = new Set(running.map((e) => e.key));
    const stale = [...Object.keys(SWITCHED), ...Object.keys(NO_SWITCH)].filter((k) => !keys.has(k));
    expect(stale, 'a row for a service no compose file has; remove it, or fix its key').toEqual([]);
  });
});

describe('every service is in exactly one list, and says why', () => {
  it('each running service is switched or needs no switch, with its reason', () => {
    const verdicts = running.map((e) => ({
      key: e.key,
      lists: [SWITCHED, NO_SWITCH].filter((t) => e.key in t).length,
    }));
    expect(
      verdicts.filter((v) => v.lists !== 1).map((v) => `${v.key} is in ${v.lists} lists`),
      'A new service: read what it sends by default, at the version the file pins, and add its row to one list.',
    ).toEqual([]);
  });

  it('each reason is a reason', () => {
    for (const [key, row] of Object.entries({ ...SWITCHED, ...NO_SWITCH })) {
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
        imageOf(entry!.service),
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
    expect(image, "Stalwart's WebUI, spam-rule and ASN fetches were read at v0.16.10; re-read defaults.rs at the new pin").toBe(STALWART);
    const doc = read('docs/managed-bring-up.md');
    for (const host of ['github.com/stalwartlabs/webui', 'github.com/stalwartlabs/spam-filter', 'cdn.jsdelivr.net']) {
      expect(doc, `Nothing phones home no longer names Stalwart's ${host}`).toContain(host);
    }
  });
});

describe('the checks refuse what a regression would write', () => {
  const OFF = { TRIGGER_TELEMETRY_DISABLED: '1', POSTHOG_PROJECT_KEY: '', CHECKPOINT_DISABLE: '1' };

  it('the webapp: no switch, an empty or .env switch, a key, a third party, a key nobody read', () => {
    expect(webappProblems(OFF)).toEqual([]);
    expect(webappProblems({ POSTHOG_PROJECT_KEY: '', CHECKPOINT_DISABLE: '1' })).toHaveLength(1);
    expect(webappProblems({ ...OFF, TRIGGER_TELEMETRY_DISABLED: '' })).toHaveLength(1);
    expect(webappProblems({ ...OFF, TRIGGER_TELEMETRY_DISABLED: '${OFF:-1}' })).toHaveLength(1);
    expect(webappProblems({ TRIGGER_TELEMETRY_DISABLED: '1', CHECKPOINT_DISABLE: '1' })).toHaveLength(1);
    expect(webappProblems({ ...OFF, POSTHOG_PROJECT_KEY: 'phc_x' })).toHaveLength(1);
    expect(webappProblems({ ...OFF, SENTRY_DSN: '' })).toHaveLength(1);
    expect(webappProblems({ ...OFF, DEPOT_TOKEN: 'x', ALERT_RESEND_API_KEY: 'x' })).toHaveLength(2);
    expect(webappProblems({ ...OFF, A_KEY_NOBODY_READ: 'x' })).toHaveLength(1);
  });

  it("the webapp: Prisma's checkpoint left on, emptied, or taken from the .env", () => {
    expect(webappProblems({ TRIGGER_TELEMETRY_DISABLED: '1', POSTHOG_PROJECT_KEY: '' })).toHaveLength(1);
    expect(webappProblems({ ...OFF, CHECKPOINT_DISABLE: '' })).toHaveLength(1);
    expect(webappProblems({ ...OFF, CHECKPOINT_DISABLE: '${CHECKPOINT_DISABLE:-1}' })).toHaveLength(1);
  });

  it('a key written with no value is passed through from the shell or .env, in both shapes', () => {
    expect(webappProblems(environmentOf({ environment: { ...OFF, POSTHOG_PROJECT_KEY: null } }))).toHaveLength(1);
    expect(webappProblems(environmentOf({ environment: { ...OFF, CHECKPOINT_DISABLE: null } }))).toHaveLength(1);
    expect(environmentOf({ environment: { MINIO_UPDATE: 'off', MINIO_CALLHOME_ENABLE: null } })).toEqual({
      MINIO_UPDATE: 'off',
      MINIO_CALLHOME_ENABLE: '${MINIO_CALLHOME_ENABLE}',
    });
    expect(environmentOf({ environment: ['MINIO_UPDATE=off', 'MINIO_CALLHOME_ENABLE'] })).toEqual({
      MINIO_UPDATE: 'off',
      MINIO_CALLHOME_ENABLE: '${MINIO_CALLHOME_ENABLE}',
    });
    expect(exactly(environmentOf({ environment: ['MINIO_UPDATE'] }), 'MINIO_UPDATE', 'off')).toHaveLength(1);
    expect(environmentOf({ environment: { POSTHOG_PROJECT_KEY: '' } })).toEqual({ POSTHOG_PROJECT_KEY: '' });
  });

  it('a key merged in from an anchor is read, as Compose reads it', () => {
    const doc = readCompose(
      [
        'x-extra: &extra',
        '  SENTRY_DSN: https://key@sentry.example.invalid/1',
        'services:',
        '  trigger-api:',
        '    image: x',
        '    environment:',
        '      <<: *extra',
        '      TRIGGER_TELEMETRY_DISABLED: "1"',
        '      POSTHOG_PROJECT_KEY: ""',
        '      CHECKPOINT_DISABLE: "1"',
        '',
      ].join('\n'),
    )!;
    const env = environmentOf(doc.services!['trigger-api']!);
    expect(Object.keys(env)).toContain('SENTRY_DSN');
    expect(webappProblems(env)).toHaveLength(1);
  });

  it('Zitadel: a ping left on, left out, or given an endpoint', () => {
    const off = { ZITADEL_SERVICEPING_ENABLED: 'false', ZITADEL_TELEMETRY_ENABLED: 'false' };
    expect(zitadelProblems(off)).toEqual([]);
    expect(zitadelProblems({ ...off, ZITADEL_SERVICEPING_ENABLED: 'true' })).toHaveLength(1);
    expect(zitadelProblems({ ZITADEL_TELEMETRY_ENABLED: 'false' })).toHaveLength(1);
    expect(zitadelProblems({ ...off, ZITADEL_SERVICEPING_ENABLED: '${PING:-false}' })).toHaveLength(1);
    expect(zitadelProblems({ ...off, ZITADEL_SERVICEPING_ENDPOINT: 'https://example.invalid' })).toHaveLength(1);
  });

  it('ClickHouse: no file, a commented-out file, a true, two files that disagree, a YAML file', () => {
    const off = '<clickhouse><send_crash_reports><enabled>false</enabled><send_logical_errors>false</send_logical_errors></send_crash_reports></clickhouse>';
    expect(clickhouseProblems([{ path: 'a.xml', text: off }])).toEqual([]);
    expect(clickhouseProblems([])).toHaveLength(1);
    expect(clickhouseProblems([{ path: 'a.xml', text: `<!-- ${off} -->` }])).toHaveLength(1);
    expect(clickhouseProblems([{ path: 'a.xml', text: off.replace('<enabled>false', '<enabled>true') }])).toHaveLength(1);
    expect(clickhouseProblems([{ path: 'a.xml', text: off.replace(/<send_logical_errors>.*<\/send_logical_errors>/, '') }])).toHaveLength(1);
    expect(clickhouseProblems([{ path: 'a.xml', text: off }, { path: 'b.xml', text: off }])).toHaveLength(1);
    expect(clickhouseProblems([{ path: 'a.xml', text: off }, { path: 'z.yaml', text: 'send_crash_reports:\n  enabled: true\n' }])).toHaveLength(1);
    expect(clickhouseProblems([{ path: 'a.xml', text: off }, { path: 'z.yml', text: '# send_crash_reports: nothing\n' }])).toEqual([]);
    expect(clickhouseProblems([{ path: 'z.yaml', text: 'send_crash_reports:\n  enabled: false\n' }])).toHaveLength(1);
  });

  it('ClickHouse: every mount into config.d or conf.d is read, from wherever beside the compose file', () => {
    const root = mkdtempSync(join(tmpdir(), 'phones-home-'));
    mkdirSync(join(root, 'deploy/compose/extra'), { recursive: true });
    const on = '<clickhouse><send_crash_reports><enabled>true</enabled></send_crash_reports></clickhouse>';
    writeFileSync(join(root, 'deploy/compose/off.xml'), '<clickhouse><send_crash_reports><enabled>false</enabled><send_logical_errors>false</send_logical_errors></send_crash_reports></clickhouse>');
    writeFileSync(join(root, 'deploy/compose/zz.xml'), on);
    writeFileSync(join(root, 'deploy/compose/zz.yaml'), 'send_crash_reports:\n  enabled: true\n');
    writeFileSync(join(root, 'deploy/compose/extra/zz.conf'), on);
    writeFileSync(join(root, 'deploy/compose/extra/notes.txt'), on);
    const merged = (volumes: string[]): string[] => {
      const { files: found, problems } = clickhouseMerged({ volumes }, 'deploy/compose/managed.yml', root);
      return [...problems, ...clickhouseProblems(found)];
    };
    const base = './off.xml:/etc/clickhouse-server/config.d/off.xml:ro';
    expect(merged([base])).toEqual([]);
    expect(merged([base, '../compose/zz.xml:/etc/clickhouse-server/config.d/zz.xml:ro'])).toHaveLength(1);
    expect(merged([base, './zz.yaml:/etc/clickhouse-server/config.d/zz.yaml:ro'])).toHaveLength(1);
    expect(merged([base, './zz.xml:/etc/clickhouse-server/conf.d/zz.xml:ro'])).toHaveLength(1);
    expect(merged([base, './extra:/etc/clickhouse-server/config.d'])).toHaveLength(1);
    expect(merged([base, 'chconf:/etc/clickhouse-server/config.d/zz.xml'])).toHaveLength(1);
    expect(merged([base, '${CH_EXTRA:-./zz.xml}:/etc/clickhouse-server/config.d/zz.xml'])).toHaveLength(1);
    expect(merged([base, './missing.xml:/etc/clickhouse-server/config.d/missing.xml'])).toHaveLength(1);
    expect(merged([base, './extra:/etc/clickhouse-server'])).toHaveLength(1);
    // What ClickHouse does not merge says nothing: another extension, a dot file, another directory.
    expect(merged([base, './zz.xml:/etc/clickhouse-server/config.d/zz.xml.off:ro'])).toEqual([]);
    expect(merged([base, './zz.xml:/etc/clickhouse-server/config.d/.zz.xml:ro'])).toEqual([]);
    expect(merged([base, './zz.xml:/etc/clickhouse-server/users.d/zz.xml:ro'])).toEqual([]);
    // The switch mounted where ClickHouse does not read it is no switch.
    expect(merged(['./off.xml:/etc/clickhouse-server/config.d/off.xml.bak:ro'])).toHaveLength(1);
    rmSync(root, { recursive: true, force: true });
  });

  it('Nextcloud: a switch missing, true, a string, twice, or without set -e', () => {
    const good = [
      '#!/bin/bash',
      'set -euo pipefail',
      'occ() { php /var/www/html/occ "$@"; }',
      'occ config:system:set updatechecker --type=boolean --value=false',
      'occ config:system:set appstoreenabled --type=boolean --value=false',
      'occ config:system:set has_internet_connection --type=boolean --value=false',
      '',
    ].join('\n');
    expect(nextcloudHookProblems(good)).toEqual([]);
    expect(nextcloudHookProblems(good.replace('occ config:system:set appstoreenabled', '# occ config:system:set appstoreenabled'))).toHaveLength(1);
    expect(nextcloudHookProblems(good.replace('updatechecker --type=boolean --value=false', 'updatechecker --type=boolean --value=true'))).toHaveLength(1);
    expect(nextcloudHookProblems(good.replace('has_internet_connection --type=boolean --value=false', 'has_internet_connection --value=false'))).toHaveLength(1);
    expect(nextcloudHookProblems(`${good}occ config:system:set updatechecker --type=boolean --value=true\n`)).toHaveLength(1);
    expect(nextcloudHookProblems(good.replace('set -euo pipefail', ''))).toHaveLength(1);
    expect(nextcloudHookProblems(good.replace('occ config:system:set updatechecker', 'echo config:system:set updatechecker'))).toHaveLength(1);
  });

  it('Caddy: a site without `tls internal`, and ACME', () => {
    const good = '{\n\tdefault_sni {$H}\n}\n\n{$H}:3443 {\n\ttls internal\n\treverse_proxy x:3000\n}\n';
    expect(caddyProblems(good)).toEqual([]);
    expect(caddyProblems(good.replace('\ttls internal\n', ''))).toHaveLength(1);
    expect(caddyProblems(good.replace('\ttls internal\n', '\t# tls internal\n'))).toHaveLength(1);
    expect(caddyProblems(`${good}\nsecond.example:443 {\n\treverse_proxy y:80\n}\n`)).toHaveLength(1);
    expect(caddyProblems(good.replace('default_sni {$H}', 'email ops@example.invalid'))).toHaveLength(1);
  });
});

describe("Nextcloud's hook, run against a stand-in php", () => {
  function runHook(phpExit: number): { status: number | null; calls: string[]; stderr: string } {
    const dir = mkdtempSync(join(tmpdir(), 'nextcloud-hook-'));
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    const log = join(dir, 'calls');
    writeFileSync(log, '');
    writeFileSync(join(bin, 'php'), `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "$CALLS"\nexit ${phpExit}\n`);
    chmodSync(join(bin, 'php'), 0o755);
    const env = { ...(process.env as Record<string, string>), PATH: `${bin}:${process.env.PATH ?? ''}`, CALLS: log };
    // As the image runs it: the file itself, by its shebang.
    const r = spawnSync(join(REPO_ROOT, NEXTCLOUD_HOOK_SOURCE), [], { encoding: 'utf8', env });
    const calls = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
    rmSync(dir, { recursive: true, force: true });
    return { status: r.status, calls, stderr: r.stderr };
  }

  it('sets the three switches to the boolean false through occ, and exits 0', () => {
    const r = runHook(0);
    expect(r.status, r.stderr).toBe(0);
    expect(r.calls).toEqual(
      NEXTCLOUD_SWITCHES.map((k) => `/var/www/html/occ config:system:set ${k} --type=boolean --value=false`),
    );
  });

  it('stops at the first occ that fails, so the container does not start with a switch unset', () => {
    const r = runHook(1);
    expect(r.status).not.toBe(0);
    expect(r.calls).toHaveLength(1);
  });
});
