// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN ALERT SOMEONE READS (workplan 0142 T1).
 *
 * The status page went red and told nobody: it had no `alerting` block at all,
 * so an Ownpace row could stay red all night and the owner would learn of it
 * from a tester. The owner chose the channel on 2026-09-27, e-mail through the
 * relay the product already sends with. So:
 *
 * - `gatus.yaml` has an e-mail `alerting` block, and every value in it is a
 *   setting, so the public repository holds no address and no login;
 * - every Ownpace row carries one e-mail alert on the switch, three failures
 *   before it fires, and a second mail when it is green again; Sources and
 *   Targets carry none;
 * - each alert's description names its own row of the incident runbook, and
 *   holds no double quote and no backslash, which would stop the page loading;
 * - `managed.yml` hands the switch off by default, because gatus counts an
 *   alert with no value as ON, and every provider field a harmless default,
 *   falling back to the product's own relay and addresses first;
 * - and, expanded the way gatus expands it, the file loads with every alert
 *   off on an empty `.env`, and on with the switch on, even with a password
 *   or a sender holding a double quote.
 *
 * The gatus facts are from its source at v5.36.0 (`alert.go`, `config.go`),
 * and were checked by loading this file with gatus's own loader.
 *
 * It fails today: `gatus.yaml` has no `alerting` block.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const gatusText = readFileSync(join(ROOT, 'deploy/compose/gatus.yaml'), 'utf8');
const runbook = readFileSync(join(ROOT, 'docs/incident-runbook.md'), 'utf8');

interface Alert {
  type?: string;
  enabled?: unknown;
  'failure-threshold'?: number;
  'success-threshold'?: number;
  'send-on-resolved'?: boolean;
  description?: string;
}
interface Endpoint {
  name: string;
  group?: string;
  alerts?: Alert[];
}
interface Gatus {
  alerting?: { email?: Record<string, unknown> };
  endpoints: Endpoint[];
}

const raw = parse(gatusText) as Gatus;

const compose = parse(readFileSync(join(ROOT, 'deploy/compose/managed.yml'), 'utf8')) as {
  services: Record<string, { environment?: Record<string, string> }>;
};
const gatusEnvironment = compose.services.gatus?.environment ?? {};

/** Compose's interpolation of one value against a `.env`: `${A}`, `${A:-default}` nested, and `${A:?why}`. */
function interpolate(s: string, env: Record<string, string>): string {
  let out = '';
  for (let i = 0; i < s.length; ) {
    if (s[i] === '$' && s[i + 1] === '{') {
      let depth = 1;
      let j = i + 2;
      for (; j < s.length && depth > 0; j += 1) {
        if (s[j] === '{') depth += 1;
        if (s[j] === '}') depth -= 1;
      }
      const body = s.slice(i + 2, j - 1);
      const m = /^([A-Za-z_][A-Za-z0-9_]*)(?::([-?])([\s\S]*))?$/.exec(body);
      if (!m) throw new Error(`cannot interpolate \${${body}}`);
      const value = env[m[1]!];
      const set = value !== undefined && value !== '';
      if (!set && m[2] === '?') throw new Error(`${m[1]} is required: ${m[3]}`);
      out += set ? value : m[2] === '-' ? interpolate(m[3]!, env) : '';
      i = j;
    } else {
      out += s[i];
      i += 1;
    }
  }
  return out;
}

/** What the gatus container is handed, for a `.env` holding `env` beside the address every stack has. */
const handed = (env: Record<string, string>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(gatusEnvironment).map(([k, v]) => [k, interpolate(String(v), { WEB_URL: 'https://app.example.test', ...env })]),
  );

/**
 * The file as gatus reads it: `$$` kept as a literal dollar, with the marker
 * gatus itself swaps in (`parseAndValidateConfigBytes`), then every variable
 * replaced by the container's value, then parsed.
 */
function asGatusReadsIt(env: Record<string, string>): Gatus {
  const marker = '__GATUS_LITERAL_DOLLAR_SIGN__';
  const expanded = gatusText
    .split('$$')
    .join(marker)
    .replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, a: string, b: string) => env[a ?? b] ?? '')
    .split(marker)
    .join('$');
  return parse(expanded) as Gatus;
}

const ownpace = () => raw.endpoints.filter((e) => e.group === 'Ownpace');

describe('the alerting block', () => {
  it('is there, for e-mail, and every value in it is a setting', () => {
    const email = raw.alerting?.email;
    expect(email, 'gatus.yaml has no alerting block for e-mail').toBeDefined();
    expect(Object.keys(email!).sort()).toEqual(['from', 'host', 'password', 'port', 'to', 'username']);
    for (const [key, value] of Object.entries(email!)) {
      expect(String(value).trim(), `alerting.email.${key} is written into the file`).toMatch(/^\$\{ALERT_[A-Z_]+\}$/);
    }
  });
});

describe('the rows', () => {
  it('every Ownpace row carries one e-mail alert on the switch, and says when it is over', () => {
    expect(ownpace().map((e) => e.name)).toEqual(
      expect.arrayContaining(['Web app', 'API', 'Database', 'Sign-in', 'Scheduled syncs', 'Identity provider', 'Website']),
    );
    for (const endpoint of ownpace()) {
      expect(endpoint.alerts, `${endpoint.name} tells nobody`).toHaveLength(1);
      const alert = endpoint.alerts![0]!;
      expect(alert.type, endpoint.name).toBe('email');
      expect(alert.enabled, `${endpoint.name} does not read the switch`).toBe('${ALERT_ENABLED}');
      expect(alert['failure-threshold'], endpoint.name).toBeGreaterThanOrEqual(2);
      expect(alert['success-threshold'], endpoint.name).toBe(2);
      expect(alert['send-on-resolved'], endpoint.name).toBe(true);
    }
  });

  it('no Sources or Targets row carries one', () => {
    for (const endpoint of raw.endpoints.filter((e) => e.group !== 'Ownpace')) {
      expect(endpoint.alerts, `${endpoint.group} / ${endpoint.name} would alert the owner about somebody else`).toBeUndefined();
    }
  });

  it('each description names its own row of the incident runbook, with no quote or backslash in it', () => {
    for (const endpoint of ownpace()) {
      const description = endpoint.alerts?.[0]?.description ?? '';
      expect(description).toContain(`the ${endpoint.name} row of docs/incident-runbook.md`);
      expect(runbook, `the runbook has no row for ${endpoint.name}`).toContain(`| **${endpoint.name}** |`);
      // gatus refuses an alert whose description holds either, and with it the file.
      expect(description, `${endpoint.name}'s description would stop the page loading`).not.toMatch(/["\\]/);
    }
  });
});

describe('the settings managed.yml hands it', () => {
  it('turn it off by default, because gatus counts an alert with no value as on', () => {
    expect(gatusEnvironment.ALERT_ENABLED).toBe('${ALERT_ENABLED:-false}');
    expect(handed({}).ALERT_ENABLED).toBe('false');
  });

  it('give every provider field a harmless default when nothing is set', () => {
    const empty = handed({});
    expect(empty.ALERT_SMTP_HOST).toMatch(/\.invalid$/);
    expect(empty.ALERT_FROM).toMatch(/\.invalid$/);
    expect(empty.ALERT_TO).toMatch(/\.invalid$/);
    expect(empty.ALERT_SMTP_PORT).toMatch(/^\d+$/);
    expect(empty.ALERT_SMTP_USER).toBe('');
    expect(empty.ALERT_SMTP_PASSWORD).toBe('');
  });

  it('fall back to the product\u2019s own relay and addresses, so one login serves both', () => {
    const relay = {
      SMTP_HOST: 'smtp.relay.test',
      SMTP_PORT: '587',
      SMTP_USER: 'relay-user',
      SMTP_PASSWORD: 'relay-password',
      NOTIFY_FROM: 'Ownpace <notify@relay.test>',
      NOTIFY_TO: 'owner@relay.test',
    };
    const got = handed(relay);
    expect([got.ALERT_SMTP_HOST, got.ALERT_SMTP_PORT, got.ALERT_SMTP_USER, got.ALERT_SMTP_PASSWORD]).toEqual([
      'smtp.relay.test',
      '587',
      'relay-user',
      'relay-password',
    ]);
    expect([got.ALERT_FROM, got.ALERT_TO]).toEqual(['Ownpace <notify@relay.test>', 'owner@relay.test']);
    expect(handed({ ...relay, ALERT_TO: 'pager@relay.test' }).ALERT_TO).toBe('pager@relay.test');
  });
});

describe('the file as gatus reads it', () => {
  const alertsOf = (config: Gatus) => config.endpoints.filter((e) => e.group === 'Ownpace').map((e) => e.alerts![0]!);

  it('loads with every alert off on an empty .env', () => {
    const config = asGatusReadsIt(handed({}));
    expect(alertsOf(config).map((a) => a.enabled)).toEqual(alertsOf(config).map(() => false));
    expect(String(config.alerting!.email!.host)).toMatch(/\.invalid$/);
  });

  it('turns every alert on with the switch, and hands the provider a password and a sender exactly as set', () => {
    const password = 'p"a\\ss: #w\'rd';
    const from = '"Ownpace" <support@relay.test>';
    const config = asGatusReadsIt(
      handed({ ALERT_ENABLED: 'true', SMTP_HOST: 'smtp.relay.test', SMTP_PASSWORD: password, NOTIFY_FROM: from, NOTIFY_TO: 'owner@relay.test' }),
    );
    expect(alertsOf(config).every((a) => a.enabled === true)).toBe(true);
    expect(config.alerting!.email!.password).toBe(password);
    expect(config.alerting!.email!.from).toBe(from);
    expect(config.alerting!.email!.port).toBe(587);
  });
});
