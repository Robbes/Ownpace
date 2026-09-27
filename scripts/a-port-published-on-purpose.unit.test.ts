// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PORT PUBLISHED ON PURPOSE.
 *
 * Until workplan 0132 T3, eight ports on the reference machine had no host
 * address in front of them: Postgres, the Trigger.dev API and dashboard, the
 * identity provider, the API (with its unauthenticated `/metrics`), the web
 * app and the status page in `deploy/compose/managed.yml`, and the public
 * site in `deploy/compose/www.yml`. A publish without an address is Docker's
 * `0.0.0.0`: every interface. Docker writes its own firewall rules for a
 * published port, so a host firewall's ordinary input rules do not close it.
 * The registry, Mailpit and Nextcloud were the only ones bound to loopback.
 *
 * TWO STACKS MADE IT WORSE THAN "REACHABLE FROM OUTSIDE". The machine runs the
 * OTA stack and `ownpace-live` on one Docker daemon (0132 D7). A container
 * reaches every port the host publishes through its network's gateway, so a
 * port on every interface in either stack is a port the other stack's
 * containers can reach. Live's API and tasks connect to hosts a tester types
 * (0136), and the OTA stack's Postgres still holds the passwords this
 * repository contains. A port bound to 127.0.0.1 closes that path, whatever a
 * deny-list misses (0132 T1f).
 *
 * THE RULE. Every `ports:` entry in both files names its address. It is
 * `127.0.0.1`, or a `*_BIND` variable with a loopback default, named after the
 * port it publishes (`${WEB_BIND:-127.0.0.1}:${WEB_PORT:-3123}`). Nothing
 * defaults to every interface, and a bind with no default, or with `-` in
 * place of `:-`, is the same mistake by omission: an empty value is every
 * interface too.
 *
 * AND LOOPBACK STAYS WHEN A BIND IS SET. The bring-up, the smoke, the deploy
 * CLI and the seed all ask these ports on localhost from the host. A bind that
 * REPLACED loopback would leave them asking an address nothing listens on,
 * and the gate would blame the service (`a-port-the-gate-assumed`,
 * `a-publish-that-moved-and-a-caller-that-did-not`). So each of the eight keeps
 * a fixed `127.0.0.1` publish, and its bind ADDS one address when it is set:
 * the front's address for a port a public name is routed to, a mesh address
 * for a dashboard the owner opens from a laptop. Unset, the two entries render
 * the same, and Compose keeps one of them (compose-go's `EnforceUnicity`
 * drops a port entry that repeats another's address, port, target and
 * protocol). Mailpit and Nextcloud keep their older single publish; their
 * callers follow the bind, and their own guards pin that.
 *
 * THE DEMO'S STALWART TOO. `deploy/selfhost/setup-stalwart.sh` published its
 * JMAP and IMAPS ports with a bare `-p`, on every interface. It now takes
 * `STALWART_BIND`, loopback by default, and the host-side callers
 * (`stalwart-cli`, the demo's seeder) ask the address it publishes on.
 *
 * WHAT THIS CANNOT SEE. The `.env` on the machine. The routed ports answer the
 * public names only once the owner sets the front's address as their bind
 * there; that is 0132's merge precondition, written in its Status block and in
 * `docs/managed-bring-up.md`, and T3's exposure check and outside probe are
 * what prove it on the machine.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE = join(REPO_ROOT, 'deploy', 'compose');
const read = (path: string): string => readFileSync(join(REPO_ROOT, path), 'utf8');

type PortEntry = string | number | { target?: number | string; published?: number | string; host_ip?: string };
interface ComposeFile {
  readonly services: Record<string, { readonly ports?: ReadonlyArray<PortEntry> }>;
}

interface Publish {
  /** `managed.yml:web`, so a failure names the entry. */
  readonly where: string;
  readonly raw: string;
  /** The host address as written, or undefined when there is none. */
  readonly address: string | undefined;
  readonly hostPort: string;
  readonly target: string;
}

/** Split on the colons that are not inside a `${…}`. */
export function splitTop(s: string): string[] {
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

/** Every publish in one compose file, read into address, host port and target. */
export function publishesOf(file: string, yaml: string): Publish[] {
  const compose = parseYaml(yaml) as ComposeFile;
  const out: Publish[] = [];
  for (const [service, svc] of Object.entries(compose.services)) {
    for (const p of svc.ports ?? []) {
      const where = `${file}:${service}`;
      if (typeof p === 'object') {
        out.push({
          where,
          raw: JSON.stringify(p),
          address: p.host_ip,
          hostPort: String(p.published ?? ''),
          target: String(p.target ?? ''),
        });
        continue;
      }
      const raw = String(p);
      const parts = splitTop(raw.replace(/\/(tcp|udp)$/, ''));
      // `target` alone, `host:target`, or `address:host:target`.
      const [address, hostPort, target] =
        parts.length === 3
          ? [parts[0], parts[1]!, parts[2]!]
          : parts.length === 2
            ? [undefined, parts[0]!, parts[1]!]
            : [undefined, '', parts[0]!];
      out.push({ where, raw, address, hostPort, target });
    }
  }
  return out;
}

const LOOPBACK = '127.0.0.1';
/** `${NAME_BIND:-127.0.0.1}`, and nothing looser. */
const BIND = /^\$\{([A-Z][A-Z0-9_]*)_BIND:-127\.0\.0\.1\}$/;
/** `${NAME_PORT:-1234}` or `${NAME_PORT}`. */
const PORT = /^\$\{([A-Z][A-Z0-9_]*)_PORT(?::-\d+)?\}$/;

/** Why a publish breaks the rule, or undefined when it keeps it. */
export function refusal(p: Publish): string | undefined {
  if (p.address === undefined) {
    return 'no host address, so Docker publishes it on every interface (0.0.0.0)';
  }
  if (p.address === LOOPBACK) return undefined;
  const bind = BIND.exec(p.address);
  if (!bind) {
    return (
      `its address is ${p.address}; write 127.0.0.1, or \${NAME_BIND:-127.0.0.1} — a bind ` +
      'with no default, with `-` instead of `:-`, or with any other default is every ' +
      'interface the day it is empty'
    );
  }
  const port = PORT.exec(p.hostPort);
  if (!port || port[1] !== bind[1]) {
    return `its bind ${bind[1]}_BIND is not named after the port it publishes (${p.hostPort})`;
  }
  return undefined;
}

const managed = publishesOf('managed.yml', readFileSync(join(COMPOSE, 'managed.yml'), 'utf8'));
const www = publishesOf('www.yml', readFileSync(join(COMPOSE, 'www.yml'), 'utf8'));
const all = [...managed, ...www];

/**
 * The two whose bind REPLACES loopback, by an older decision: their host-side
 * callers read the bind and follow it, and their own guards pin both halves.
 */
const SINGLE_PUBLISH: Readonly<Record<string, string>> = {
  MAILPIT_BIND: 'the-mail-the-issuer-could-not-send, a-port-the-gate-assumed',
  NEXTCLOUD_BIND: 'a-publish-that-moved-and-a-caller-that-did-not',
};

/** The binds workplan 0132 T3 names; an owner's `.env` carries these names. */
const NAMED = {
  'managed.yml': [
    'POSTGRES_BIND',
    'API_BIND',
    'TRIGGER_BIND',
    'TRIGGER_TLS_BIND',
    'ZITADEL_BIND',
    'WEB_BIND',
    'STATUS_BIND',
  ],
  'www.yml': ['WWW_BIND'],
} as const;

const bindsIn = (publishes: Publish[]): string[] =>
  publishes.flatMap((p) => {
    const m = p.address === undefined ? null : BIND.exec(p.address);
    return m ? [`${m[1]}_BIND`] : [];
  });

describe('every port is published on an address somebody chose', () => {
  it('read both compose files', () => {
    // Vacuity: a parser that finds nothing passes every case below.
    expect(managed.length, 'no ports: entries found in managed.yml').toBeGreaterThanOrEqual(10);
    expect(www.length, 'no ports: entries found in www.yml').toBeGreaterThanOrEqual(1);
  });

  it('publishes nothing on every interface, and no bind without a loopback default', () => {
    const wrong = all.flatMap((p) => {
      const why = refusal(p);
      return why ? [`${p.where} "${p.raw}": ${why}`] : [];
    });
    expect(
      wrong,
      `${wrong.length} publish(es) not on an address anybody chose:\n  ${wrong.join('\n  ')}\n\n` +
        'Write "127.0.0.1:${X_PORT:-n}:target" and beside it ' +
        '"${X_BIND:-127.0.0.1}:${X_PORT:-n}:target" (workplan 0132 T3).',
    ).toEqual([]);
  });

  it.each(Object.entries(NAMED))('%s carries the binds the plan names', (file, names) => {
    const found = bindsIn(file === 'www.yml' ? www : managed);
    expect(found, `${file} publishes through none of ${names.join(', ')}`).toEqual(
      expect.arrayContaining([...names]),
    );
  });

  it('keeps a loopback publish beside every bind, so the host still reaches the port', () => {
    // A bind that replaced loopback would leave the bring-up, the smoke, the
    // deploy CLI and the seed asking localhost for a port that moved.
    const lonely = all.flatMap((p) => {
      const m = p.address === undefined ? null : BIND.exec(p.address);
      if (!m) return [];
      const name = `${m[1]}_BIND`;
      if (name in SINGLE_PUBLISH) return [];
      const beside = all.some(
        (q) =>
          q.where === p.where &&
          q.address === LOOPBACK &&
          q.hostPort === p.hostPort &&
          q.target === p.target,
      );
      return beside ? [] : [`${p.where} "${p.raw}"`];
    });
    expect(
      lonely,
      'these binds have no fixed 127.0.0.1 publish of the same port beside them, so\n' +
        'setting the bind moves the port away from every host-side caller:\n  ' +
        lonely.join('\n  '),
    ).toEqual([]);
  });

  it('lists every bind in managed.env.example, bare, so an empty one means loopback', () => {
    // `KEY=   # note` is the value "# note" to Compose (managed-env-contract),
    // which as a host address fails the bring-up outright. The keys are bare.
    const example = readFileSync(join(COMPOSE, 'managed.env.example'), 'utf8');
    const missing = NAMED['managed.yml'].filter((k) => !new RegExp(`^${k}=$`, 'm').test(example));
    expect(missing, 'managed.env.example does not list these binds as a bare `KEY=` line').toEqual([]);
  });
});

describe('the demo Stalwart publishes on loopback too', () => {
  const script = read('deploy/selfhost/setup-stalwart.sh');
  const code = script
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');
  const flags = [...code.matchAll(/-p\s+"([^"]+)"/g)].map((m) => m[1]!);

  it('found its publishes', () => {
    expect(flags.length, 'no -p "…" found in setup-stalwart.sh').toBeGreaterThanOrEqual(3);
  });

  it('takes the address from STALWART_BIND, loopback by default', () => {
    expect(
      /^BIND="\$\{STALWART_BIND:-127\.0\.0\.1\}"$/m.test(code),
      'setup-stalwart.sh has no BIND="${STALWART_BIND:-127.0.0.1}" line',
    ).toBe(true);
    const bare = flags.filter((f) => !f.startsWith('${BIND}:') || splitTop(f).length !== 3);
    expect(bare, 'these -p flags publish on every interface, or not on ${BIND}').toEqual([]);
  });

  it('asks the address it publishes on, rather than assuming localhost', () => {
    // stalwart-cli is a host binary and goes through the published port. With
    // STALWART_BIND set to a mesh address, a default of 127.0.0.1 would ask
    // an address nothing listens on and blame Stalwart for it.
    const cli = /^CLI_URL=.*$/m.exec(code)?.[0] ?? '';
    expect(cli, 'no CLI_URL= line in setup-stalwart.sh').not.toBe('');
    expect(cli, 'CLI_URL still defaults to loopback whatever the bind').not.toContain(LOOPBACK);
    expect(cli, 'CLI_URL does not default to the address the host asks on').toContain('${HOST_ADDR}');
    expect(/HOST_ADDR="\$BIND"/.test(code), 'HOST_ADDR is not derived from the bind').toBe(true);
  });

  it('the managed demo seeds the address the demo Stalwart publishes on', () => {
    const demo = read('deploy/compose/setup-managed-demo.sh')
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .join('\n');
    expect(demo.includes('STALWART_BIND'), 'setup-managed-demo.sh never reads STALWART_BIND').toBe(true);
    expect(
      /SEED_IMAP_HOST=127\.0\.0\.1/.test(demo),
      'the demo seeder still asks 127.0.0.1 whatever the bind',
    ).toBe(false);
  });
});

describe('the rule is not vacuous', () => {
  const one = (raw: string): Publish => publishesOf('x.yml', `services:\n  s:\n    ports:\n      - "${raw}"\n`)[0]!;

  it('refuses every shape that ends up on every interface', () => {
    for (const raw of [
      '${WEB_PORT:-3123}:80',
      '3123:80',
      '80',
      '0.0.0.0:${WEB_PORT:-3123}:80',
      '${WEB_BIND}:${WEB_PORT:-3123}:80',
      '${WEB_BIND-127.0.0.1}:${WEB_PORT:-3123}:80',
      '${WEB_BIND:-0.0.0.0}:${WEB_PORT:-3123}:80',
      '${WEB_BIND:-}:${WEB_PORT:-3123}:80',
      '${API_BIND:-127.0.0.1}:${WEB_PORT:-3123}:80',
    ]) {
      expect(refusal(one(raw)), raw).toBeDefined();
    }
  });

  it('accepts loopback, and a named bind with a loopback default', () => {
    for (const raw of [
      '127.0.0.1:${REGISTRY_PORT:-5000}:5000',
      '${WEB_BIND:-127.0.0.1}:${WEB_PORT:-3123}:80',
      '${ZITADEL_BIND:-127.0.0.1}:${ZITADEL_PORT:-3126}:${ZITADEL_PORT:-3126}',
    ]) {
      expect(refusal(one(raw)), raw).toBeUndefined();
    }
  });

  it('splits only on the colons outside a variable', () => {
    expect(splitTop('${A_BIND:-127.0.0.1}:${A_PORT:-1}:${A_PORT:-1}')).toEqual([
      '${A_BIND:-127.0.0.1}',
      '${A_PORT:-1}',
      '${A_PORT:-1}',
    ]);
  });
});
