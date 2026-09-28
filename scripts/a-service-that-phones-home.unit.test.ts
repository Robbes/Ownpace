// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A SERVICE THAT PHONES HOME.
 *
 * The privacy policy says the service runs in the EU and names every party that
 * receives anything (§7, §8); on 2026-09-28 the owner chose, for the question
 * ops-telemetry, *"Switch it off everywhere"* (workplan 0139). Four images on
 * both managed stacks reported to their makers by default until then, and one
 * more did on the test stack, each read at the version this repository pins:
 *
 *  - TRIGGER.DEV'S WEBAPP (v4.5.16) sent PostHog events from the server
 *    (`apps/webapp/app/services/telemetry.server.ts`: a user created, with
 *    email and name; an organisation and a project created), and its dashboard
 *    loaded PostHog in the browser and identified the signed-in user by id and
 *    email (`app/hooks/usePostHog.ts`), with a project key that defaults to
 *    Trigger.dev's own (`app/env.server.ts`, `POSTHOG_PROJECT_KEY`). Upstream's
 *    documented opt-out, `TRIGGER_TELEMETRY_DISABLED`, stops only the first:
 *    the constructor returns early when it is set to anything, and nothing
 *    else reads it. The browser's half starts whenever the key is not empty
 *    (`usePostHog` returns early on `undefined` or `""` only), so the key is
 *    set to the empty string beside it.
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
 *    false (`src/Daemon/CrashWriter.cpp`). A file in `config.d` turns it off.
 *  - MINIO (bitnamilegacy 2025.5.24) asks `dl.min.io` for the newest release at
 *    every start, with a User-Agent that carries the OS, the architecture,
 *    `docker`, its version and the CPU's count, vendor and model
 *    (`cmd/server-main.go`, `cmd/update.go` at `RELEASE.2025-05-24T17-08-30Z`),
 *    unless `MINIO_UPDATE` is `off`. Its call-home to SUBNET ships `off`
 *    (`internal/config/callhome/callhome.go`) and is written out here too.
 *  - MAILPIT (v1.31.1, the test stack's catcher; live has none) asks GitHub for
 *    its newest release whenever its web page asks for the server's info,
 *    unless `MP_DISABLE_VERSION_CHECK` says true (`internal/stats/stats.go`).
 *
 * THE RULE. Every service in every compose file under `deploy/` is in exactly
 * one of three lists below, keyed by file and service, and the lists name no
 * service that is not there:
 *
 *  - SWITCHED: it has a default that reports home, and the switch that stops it
 *    is written in the file, as a literal (a `${…}` from `.env` can be empty on
 *    a machine this cannot see). The row records the image the default was read
 *    at, and a different image in the file fails here until somebody re-reads
 *    the default at the new version and moves the row. A new release is exactly
 *    where a new report appears: Zitadel's ping arrived with v4.
 *  - NO SWITCH: nothing in it reports home, and the row says why. It records the
 *    image's repository, so a different piece of software under the same service
 *    name is a new question.
 *  - LEFT ON: the demo's and the development stack's Nextcloud, which keeps its
 *    update check, its app store and its connectivity check (`config.sample.php`
 *    at `stable34`: `updatechecker`, `appstoreenabled` and
 *    `has_internet_connection` true). It holds demo fixtures and never a tester's
 *    data, and its switches are `occ` settings inside the instance, not compose
 *    settings. The row's check is what keeps that true: neither live script lets
 *    the demo start, and the bring-up starts Nextcloud only for the demo.
 *
 * A service with neither `image` nor `build` is an overlay of the service of the
 * same name in another file beside it; what runs is that service's image, and an
 * overlay may set none of the switches below.
 *
 * WHAT THIS CANNOT SEE. A running container, or a machine's `.env`: live's own
 * `TRIGGER_IMAGE_TAG` would run another webapp than the default read here, which
 * is why `docs/managed-bring-up.md`, *Nothing phones home*, has the check to run
 * on the machine. The demo's Stalwart, which `setup-stalwart.sh` starts with
 * `docker run`, outside every compose file. The deploy CLI, which runs on the
 * host: at 4.5.16 `packages/cli-v3/src/telemetry/tracing.ts` is gone, and
 * `handleTelemetry` in `src/cli/common.ts` only runs the command, so no exporter
 * of its own was found. And what a
 * service does once somebody configures it to: the webapp's Sentry, Loops,
 * Attio, Kapa, Plain, BetterStack, S2, Slack, mail providers and model keys are
 * off because this file sets none of them, and the check below keeps it so.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string): string => readFileSync(join(REPO_ROOT, path), 'utf8');
/** `compose.pglite.yml` uses Compose's own `!reset` tag, which a plain YAML reader only warns about. */
const QUIET = { logLevel: 'error' } as const;

type Mount = string | { readonly source?: string; readonly target?: string };
export interface Service {
  readonly image?: string;
  readonly build?: unknown;
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
        const doc = parseYaml(readFileSync(join(root, path), 'utf8'), QUIET) as { services?: unknown } | null;
        if (doc && typeof doc === 'object' && doc.services && typeof doc.services === 'object') out.push(path);
      }
    }
  };
  walk('deploy');
  return out.sort();
}

/** A service's environment as strings, from either of Compose's two shapes. */
export function environmentOf(svc: Service): Record<string, string> {
  const env = svc.environment;
  if (!env) return {};
  if (Array.isArray(env)) {
    const out: Record<string, string> = {};
    for (const line of env as ReadonlyArray<string>) {
      const at = line.indexOf('=');
      // `- KEY` alone passes the host's value through: not written in the file.
      if (at === -1) out[line] = `\${${line}}`;
      else out[line.slice(0, at)] = line.slice(at + 1);
    }
    return out;
  }
  return Object.fromEntries(
    Object.entries(env as Readonly<Record<string, unknown>>).map(([k, v]) => [k, v === null || v === undefined ? '' : String(v)]),
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
  if (!literal(got)) return [`${key} is ${got}, taken from the .env, which can be empty on a machine; write ${key}: "${want}"`];
  return got === want ? [] : [`${key} is "${got}"; it must be "${want}"`];
}

/**
 * Keys that switch a third party on in Trigger.dev's webapp, all read at
 * v4.5.16 (`apps/webapp/app/env.server.ts`), each off while unset.
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
  'RESEND_API_KEY',
  'S2_ENABLED',
  'REALTIME_STREAMS_S2_ACCESS_TOKEN',
  'DASHBOARD_AGENT_SECRET_KEY',
  'SLACK_BOT_TOKEN',
]);

/** Trigger.dev's webapp: both halves of its PostHog off, and no third party on. */
export function webappProblems(env: Record<string, string>): string[] {
  const problems: string[] = [];
  const disabled = env['TRIGGER_TELEMETRY_DISABLED'];
  if (disabled === undefined) problems.push('TRIGGER_TELEMETRY_DISABLED is not set, so the server sends PostHog events');
  else if (!literal(disabled) || disabled === '') {
    problems.push(`TRIGGER_TELEMETRY_DISABLED is "${disabled}"; upstream's docs ask for a value that is not empty, written in the file ("1")`);
  }
  const key = env['POSTHOG_PROJECT_KEY'];
  if (key === undefined) problems.push("POSTHOG_PROJECT_KEY is not set, so the dashboard loads PostHog in the browser with Trigger.dev's own key");
  else if (key !== '') problems.push(`POSTHOG_PROJECT_KEY is "${key}"; only the empty string stops the dashboard loading PostHog`);
  for (const k of WEBAPP_THIRD_PARTIES) {
    if (k in env) problems.push(`${k} is set, which switches a third party on`);
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

/** The crash-report block of one ClickHouse config file, comments removed, or undefined. */
export function crashReportBlock(xml: string): string | undefined {
  const bare = xml.replace(/<!--[\s\S]*?-->/g, '');
  return /<send_crash_reports(?:\s[^>]*)?>([\s\S]*?)<\/send_crash_reports>/.exec(bare)?.[1];
}

/** ClickHouse: the one config.d file that speaks of crash reports turns both off. */
export function clickhouseProblems(files: ReadonlyArray<{ readonly path: string; readonly xml: string }>): string[] {
  const speaking = files.filter((f) => crashReportBlock(f.xml) !== undefined);
  if (speaking.length === 0) {
    return ["no file mounted into /etc/clickhouse-server/config.d/ sets send_crash_reports, so the shipped config.xml's `true` applies"];
  }
  if (speaking.length > 1) {
    return [`${speaking.map((f) => f.path).join(' and ')} each set send_crash_reports; one file says it, so the order of config.d cannot decide it`];
  }
  const block = crashReportBlock(speaking[0]!.xml)!;
  const problems: string[] = [];
  for (const tag of ['enabled', 'send_logical_errors']) {
    const value = new RegExp(`<${tag}>\\s*([^<]*?)\\s*</${tag}>`).exec(block)?.[1];
    if (value !== 'false') {
      problems.push(`${speaking[0]!.path}: send_crash_reports.${tag} is ${value === undefined ? 'not set, so the shipped true applies' : `"${value}"`}; it must be false`);
    }
  }
  return problems;
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

/** Mounted ClickHouse config files, read from beside the compose file. */
function clickhouseConfigs(svc: Service, entry: Entry): Array<{ path: string; xml: string }> {
  const dir = dirname(entry.file);
  return mountsOf(svc)
    .filter((m) => m.target.startsWith('/etc/clickhouse-server/config.d/') && m.source.startsWith('./'))
    .map((m) => ({ path: `${dir}/${m.source.slice(2)}`, xml: read(`${dir}/${m.source.slice(2)}`) }));
}

export const SWITCHED: Readonly<Record<string, Row>> = {
  'deploy/compose/managed.yml:trigger-api': {
    readAt: TRIGGER_WEBAPP,
    why:
      'PostHog from the server on user, organisation and project creation, and in the dashboard browser with the ' +
      "signed-in user's id and email, to PostHog Cloud (telemetry.server.ts, usePostHog.ts, root.tsx, env.server.ts at v4.5.16)",
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
    holds: (svc, entry) => clickhouseProblems(clickhouseConfigs(svc, entry)),
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

/** Where the bring-up names the services it starts. */
function bringUpProblems(): string[] {
  const problems: string[] = [];
  const bootstrap = read('deploy/compose/bootstrap-managed.sh');
  const list = /\n {2}local services=\(\n([\s\S]*?)\n {2}\)\n/.exec(bootstrap)?.[1];
  if (list === undefined) problems.push("bootstrap-managed.sh's phase_app has no `local services=(` list to read");
  else if (/\bnextcloud\b/.test(list.replace(/#.*$/gm, ''))) problems.push("nextcloud is in bootstrap-managed.sh's default services, so every stack starts it");
  if (!bootstrap.includes('[ "$WITH_DEMO" -eq 1 ] && services+=(nextcloud)')) {
    problems.push('bootstrap-managed.sh no longer adds nextcloud only with --with-demo');
  }
  for (const script of ['stand-up-live.sh', 'deploy-live.sh']) {
    if (!/if \[ "\$arg" = --with-demo \]; then\n\s+refuse /.test(read(`deploy/compose/${script}`))) {
      problems.push(`${script} no longer refuses --with-demo, so live could start the demo's Nextcloud`);
    }
  }
  return problems;
}

const NEXTCLOUD_PHONES =
  "update checks to updates.nextcloud.com, the app store at apps.nextcloud.com and a connectivity check to four public sites " +
  "(config.sample.php at stable34); a demo target holding fixtures, never a tester's data, switched by `occ` inside the instance";

export const LEFT_ON: Readonly<Record<string, Row>> = {
  'deploy/compose/managed.yml:nextcloud': {
    readAt: 'nextcloud:34-apache',
    why: `${NEXTCLOUD_PHONES}; started only with --with-demo, which both live scripts refuse`,
    holds: () => bringUpProblems(),
  },
  'deploy/compose/dev.yml:nextcloud': {
    readAt: 'nextcloud:34-apache',
    why: `${NEXTCLOUD_PHONES}; the development and appliance-test stack, which no managed bring-up starts`,
    holds: () =>
      ['bootstrap-managed.sh', 'stand-up-live.sh', 'deploy-live.sh']
        .filter((s) => read(`deploy/compose/${s}`).includes('dev.yml'))
        .map((s) => `${s} names dev.yml, so a managed stack could start the development Nextcloud`),
  },
};

/** Every key any switch reads, so an overlay cannot set one back. */
const SWITCH_KEYS = [
  'TRIGGER_TELEMETRY_DISABLED',
  'POSTHOG_PROJECT_KEY',
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
  const doc = parseYaml(read(file), QUIET) as { services: Record<string, Service> };
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
    const stale = [...Object.keys(SWITCHED), ...Object.keys(NO_SWITCH), ...Object.keys(LEFT_ON)].filter((k) => !keys.has(k));
    expect(stale, 'a row for a service no compose file has; remove it, or fix its key').toEqual([]);
  });
});

describe('every service is in exactly one list, and says why', () => {
  it('each running service is switched, needs no switch, or is left on with its reason', () => {
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
        imageOf(entry!.service),
        `${key}'s default was read at ${row.readAt}. Re-read what the new version sends by default, then move this row.`,
      ).toBe(row.readAt);
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
      expect(imageOf(entry.service), `${key}'s defaults were read at ${row.readAt}`).toBe(row.readAt);
      expect(row.holds!(entry.service, entry), key).toEqual([]);
    });
  }
});

describe('an overlay runs its base image and switches nothing back on', () => {
  it('each overlay has a base beside it, and sets no switch', () => {
    const problems: string[] = [];
    for (const o of overlays) {
      const base = running.find((e) => e.name === o.name && dirname(e.file) === dirname(o.file) && e.file !== o.file);
      if (!base) problems.push(`${o.key} has no image, no build and no service of that name beside it`);
      for (const k of Object.keys(environmentOf(o.service))) {
        if (SWITCH_KEYS.includes(k)) problems.push(`${o.key} sets ${k}`);
      }
    }
    expect(problems).toEqual([]);
  });
});

describe('the checks refuse what a regression would write', () => {
  it('the webapp: no switch, an empty or .env switch, a key, a third party', () => {
    expect(webappProblems({ TRIGGER_TELEMETRY_DISABLED: '1', POSTHOG_PROJECT_KEY: '' })).toEqual([]);
    expect(webappProblems({ POSTHOG_PROJECT_KEY: '' })).toHaveLength(1);
    expect(webappProblems({ TRIGGER_TELEMETRY_DISABLED: '', POSTHOG_PROJECT_KEY: '' })).toHaveLength(1);
    expect(webappProblems({ TRIGGER_TELEMETRY_DISABLED: '${OFF:-1}', POSTHOG_PROJECT_KEY: '' })).toHaveLength(1);
    expect(webappProblems({ TRIGGER_TELEMETRY_DISABLED: '1' })).toHaveLength(1);
    expect(webappProblems({ TRIGGER_TELEMETRY_DISABLED: '1', POSTHOG_PROJECT_KEY: 'phc_x' })).toHaveLength(1);
    expect(webappProblems({ TRIGGER_TELEMETRY_DISABLED: '1', POSTHOG_PROJECT_KEY: '', SENTRY_DSN: '' })).toHaveLength(1);
  });

  it('Zitadel: a ping left on, left out, or given an endpoint', () => {
    const off = { ZITADEL_SERVICEPING_ENABLED: 'false', ZITADEL_TELEMETRY_ENABLED: 'false' };
    expect(zitadelProblems(off)).toEqual([]);
    expect(zitadelProblems({ ...off, ZITADEL_SERVICEPING_ENABLED: 'true' })).toHaveLength(1);
    expect(zitadelProblems({ ZITADEL_TELEMETRY_ENABLED: 'false' })).toHaveLength(1);
    expect(zitadelProblems({ ...off, ZITADEL_SERVICEPING_ENABLED: '${PING:-false}' })).toHaveLength(1);
    expect(zitadelProblems({ ...off, ZITADEL_SERVICEPING_ENDPOINT: 'https://example.invalid' })).toHaveLength(1);
  });

  it('ClickHouse: no file, a commented-out file, a true, two files that disagree', () => {
    const off = '<clickhouse><send_crash_reports><enabled>false</enabled><send_logical_errors>false</send_logical_errors></send_crash_reports></clickhouse>';
    expect(clickhouseProblems([{ path: 'a.xml', xml: off }])).toEqual([]);
    expect(clickhouseProblems([])).toHaveLength(1);
    expect(clickhouseProblems([{ path: 'a.xml', xml: `<!-- ${off} -->` }])).toHaveLength(1);
    expect(clickhouseProblems([{ path: 'a.xml', xml: off.replace('<enabled>false', '<enabled>true') }])).toHaveLength(1);
    expect(clickhouseProblems([{ path: 'a.xml', xml: off.replace(/<send_logical_errors>.*<\/send_logical_errors>/, '') }])).toHaveLength(1);
    expect(clickhouseProblems([{ path: 'a.xml', xml: off }, { path: 'b.xml', xml: off }])).toHaveLength(1);
  });

  it('Caddy: a site without `tls internal`, and ACME', () => {
    const good = '{\n\tdefault_sni {$H}\n}\n\n{$H}:3443 {\n\ttls internal\n\treverse_proxy x:3000\n}\n';
    expect(caddyProblems(good)).toEqual([]);
    expect(caddyProblems(good.replace('\ttls internal\n', ''))).toHaveLength(1);
    expect(caddyProblems(good.replace('\ttls internal\n', '\t# tls internal\n'))).toHaveLength(1);
    expect(caddyProblems(`${good}\nsecond.example:443 {\n\treverse_proxy y:80\n}\n`)).toHaveLength(1);
    expect(caddyProblems(good.replace('default_sni {$H}', 'email ops@example.invalid'))).toHaveLength(1);
  });

  it('reads an environment written as a list, and a key passed through from the host', () => {
    expect(environmentOf({ environment: ['MINIO_UPDATE=off', 'MINIO_CALLHOME_ENABLE'] })).toEqual({
      MINIO_UPDATE: 'off',
      MINIO_CALLHOME_ENABLE: '${MINIO_CALLHOME_ENABLE}',
    });
    expect(exactly(environmentOf({ environment: ['MINIO_UPDATE'] }), 'MINIO_UPDATE', 'off')).toHaveLength(1);
  });
});
