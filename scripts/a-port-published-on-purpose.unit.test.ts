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
 * A BIND IS ONE IPv4 ADDRESS, AND THE BRING-UP SAYS SO BEFORE COMPOSE DOES.
 * The review of the build found three values that pass everything until the
 * first run that reads the key, and none of them names it: a NAME (the owner
 * was told to copy `TRIGGER_TLS_HOST`, which may be one) fails every compose
 * command against the file with `invalid IP address`; `0.0.0.0` renders beside
 * the fixed loopback publish and the container cannot bind; `KEY=  # note`
 * hands Compose the note. `bootstrap-managed.sh`'s `load_env` refuses all
 * three, naming the key, and the cases below run it for real. The same review
 * found the script's own advice for opening the dashboard from a laptop
 * without the bind, so that advice, and a note when the host is set and the
 * bind is not, are pinned here too.
 *
 * AND THE READERS READ WHAT A REGRESSION WOULD WRITE. The first version found
 * Stalwart's publishes only as a double-quoted `-p "…"`, and the seeder case
 * only refused one literal: an unquoted `-p ${PORT}:993` and a seeder on
 * `localhost` both passed. The publish reader, inside `docker run` only, takes
 * `-p` with its value apart, after `=` or attached, alone or after boolean
 * short flags (`-dp`), and `--publish` apart or after `=`, each quoted or not;
 * and `-P`, `--publish-all` and a literal host network, which publish with no
 * value to read, are refused outright. The seeder and `CLI_URL` must each ask
 * a variable taken from the bind.
 *
 * WHAT THIS CANNOT SEE. The `.env` on the machine. The routed ports answer the
 * public names only once the owner sets the front's address as their bind
 * there; that is 0132's merge precondition, written in its Status block and in
 * `docs/managed-bring-up.md`, and T3's exposure check and outside probe are
 * what prove it on the machine. Nor whether the machine's Docker starts a
 * container whose bind is a mesh address before the mesh has it: that is a
 * check after a reboot, in 0132 T0 step 5.
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
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
    // WWW_BIND too: www.yml reads it from the `.env` beside it, which is this
    // same file when the site is brought up from a stack's checkout.
    const example = readFileSync(join(COMPOSE, 'managed.env.example'), 'utf8');
    const missing = [...NAMED['managed.yml'], ...NAMED['www.yml']].filter(
      (k) => !new RegExp(`^${k}=$`, 'm').test(example),
    );
    expect(missing, 'managed.env.example does not list these binds as a bare `KEY=` line').toEqual([]);
  });
});

/**
 * The body of one shell function in `bootstrap-managed.sh`, from its
 * `name() {` line to the first `}` at the start of a line, or '' when the
 * script has no such function.
 */
function shellFunction(script: string, name: string): string {
  const start = script.indexOf(`\n${name}() {`);
  if (start < 0) return '';
  const end = script.indexOf('\n}\n', start);
  return end < 0 ? '' : script.slice(start + 1, end + 2);
}

const BOOTSTRAP = read('deploy/compose/bootstrap-managed.sh');

/** Run one of the bring-up's functions for real, against a `.env` of the test's. */
function runBootstrapFunction(
  name: string,
  envLines: readonly string[],
  call: string,
): { status: number; stdout: string; stderr: string } {
  const fn = shellFunction(BOOTSTRAP, name);
  const dir = mkdtempSync(join(tmpdir(), 'a-port-published-on-purpose-'));
  try {
    const envFile = join(dir, '.env');
    writeFileSync(envFile, `${envLines.join('\n')}\n`);
    // The script's own one-line helpers, so what is asserted is what an
    // operator would read, and the shared reader it sources.
    const helpers = ['note', 'die']
      .map((h) => new RegExp(`^${h}\\(\\) \\{.*\\}$`, 'm').exec(BOOTSTRAP)?.[0] ?? '')
      .join('\n');
    const program = [
      'set -euo pipefail',
      `. "${join(COMPOSE, 'env-read.sh')}"`,
      `ENV_FILE="${envFile}"`,
      'env_get() { env_value "$ENV_FILE" "$1"; }',
      helpers,
      fn,
      call,
    ].join('\n');
    const r = spawnSync('bash', ['-c', program], { encoding: 'utf8' });
    return { status: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('the bring-up refuses a bind that is not an address, before Compose does', () => {
  // A bind takes an IPv4 address. A NAME (`TRIGGER_TLS_HOST` may be one) fails
  // every compose command against the file with `invalid IP address`, the
  // gate's bring-up and teardown included. `0.0.0.0` renders beside the fixed
  // loopback publish of the same port, and the container then cannot bind at
  // all. `KEY=  # note` hands Compose the note. Nothing reads these keys until
  // the first run after the change, so the refusal is what names the key.
  const FN = 'refuse_a_bind_that_is_not_an_address';
  const refuse = (lines: readonly string[]) => runBootstrapFunction(FN, lines, `${FN} "$ENV_FILE"`);

  it('has the refusal, and load_env asks it before it asks Compose', () => {
    expect(shellFunction(BOOTSTRAP, FN), `bootstrap-managed.sh has no ${FN}()`).not.toBe('');
    const loadEnv = shellFunction(BOOTSTRAP, 'load_env');
    const asked = loadEnv.indexOf(`${FN} "$ENV_FILE"`);
    expect(asked, `load_env does not call ${FN} "$ENV_FILE"`).toBeGreaterThan(-1);
    // Before `config -q`, which would fail first on a name, with Compose's
    // words and no key.
    expect(asked, `${FN} must run before load_env asks Compose`).toBeLessThan(
      loadEnv.indexOf('config -q'),
    );
  });

  it('lets an empty bind and an IPv4 address through', () => {
    const r = refuse([
      'POSTGRES_BIND=',
      'WEB_BIND=100.64.0.1',
      "ZITADEL_BIND='192.0.2.10'",
      'STATUS_BIND=192.0.2.10   # the front',
      'MAILPIT_BIND=',
      'WWW_BIND=203.0.113.255',
    ]);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
  });

  it.each([
    ['WEB_BIND', '0.0.0.0', 'every interface'],
    ['STATUS_BIND', '::', 'every interface'],
    ['MAILPIT_BIND', '[::]', 'every interface'],
    ['ZITADEL_BIND', 'spark.example.net', 'not an IPv4 address'],
    ['TRIGGER_TLS_BIND', 'localhost', 'not an IPv4 address'],
    ['WWW_BIND', '256.1.1.1', 'not an IPv4 address'],
    ['API_BIND', '010.0.0.1', 'not an IPv4 address'],
    ['NEXTCLOUD_BIND', '100.64.0', 'not an IPv4 address'],
  ])('refuses %s=%s, naming the key and why', (key, value, why) => {
    const r = refuse(['POSTGRES_BIND=', `${key}=${value}`]);
    expect(r.status, r.stderr).not.toBe(0);
    expect(r.stderr).toContain(key);
    expect(r.stderr).toContain(why);
    expect(r.stderr, 'the refusal points at the section that explains binds').toContain(
      'Which address a port answers on',
    );
    // The gate's log is public. A value that is not an address may be the
    // name of a private machine, so the refusal says what is wrong with it
    // and never repeats it.
    if (why === 'not an IPv4 address') expect(r.stderr).not.toContain(value);
  });

  it('refuses a comment where the value belongs, which Compose reads as the address', () => {
    const r = refuse(['WEB_BIND=   # the front']);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('WEB_BIND');
    expect(r.stderr).toContain('comment');
  });

  it('reads the line in force, the last one, as Compose does', () => {
    expect(refuse(['WEB_BIND=0.0.0.0', 'WEB_BIND=192.0.2.10']).status).toBe(0);
    expect(refuse(['WEB_BIND=192.0.2.10', 'export WEB_BIND=0.0.0.0']).status).not.toBe(0);
  });
});

describe('the bring-up says the dashboard needs TRIGGER_TLS_BIND to leave the machine', () => {
  // trigger-tls publishes on loopback unless TRIGGER_TLS_BIND adds an address.
  // An operator who follows the script's own advice, TRIGGER_TLS_HOST and the
  // https origins, gets a dashboard the laptop never reaches, and the magic
  // link the account step prints goes nowhere.
  it("phase_env's advice and the decisions it lists name the bind", () => {
    const env = shellFunction(BOOTSTRAP, 'phase_env');
    const advice = env.slice(env.indexOf('TRIGGER_TLS_HOST=localhost —'));
    expect(advice.slice(0, advice.indexOf('\n  fi')), 'the localhost advice').toContain('TRIGGER_TLS_BIND');
    const decisions = env.slice(env.indexOf('<<EOF'), env.indexOf('\nEOF'));
    expect(decisions, 'the decisions a new .env asks for').toContain('TRIGGER_TLS_BIND');
  });

  const FN = 'note_dashboard_on_this_machine_only';
  const noteFor = (lines: readonly string[]) => runBootstrapFunction(FN, lines, FN);

  it('is said on every phase that reads the .env, not only on the first', () => {
    expect(shellFunction(BOOTSTRAP, FN), `bootstrap-managed.sh has no ${FN}()`).not.toBe('');
    expect(shellFunction(BOOTSTRAP, 'load_env')).toContain(`\n  ${FN}\n`);
  });

  it('notes an off-machine TRIGGER_TLS_HOST with no bind, and names the bind', () => {
    const r = noteFor(['TRIGGER_TLS_HOST=192.0.2.20', 'TRIGGER_TLS_BIND=']);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('TRIGGER_TLS_BIND');
    // The gate's log is public, and this is the machine's mesh address.
    expect(r.stdout).not.toContain('192.0.2.20');
  });

  it.each([
    [['TRIGGER_TLS_HOST=localhost', 'TRIGGER_TLS_BIND=']],
    [['TRIGGER_TLS_HOST=127.0.0.1']],
    [['TRIGGER_TLS_BIND=']],
    [['TRIGGER_TLS_HOST=192.0.2.20', 'TRIGGER_TLS_BIND=192.0.2.20']],
  ])('says nothing when the dashboard is meant for this machine, or already bound: %j', (lines) => {
    const r = noteFor(lines);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe('');
  });
});

describe('the demo Stalwart publishes on loopback too', () => {
  const script = read('deploy/selfhost/setup-stalwart.sh');
  const code = script
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');
  const flags = dockerRunPublishes(code);

  it('found its publishes', () => {
    expect(flags.length, 'no publish flag found in a docker run in setup-stalwart.sh').toBeGreaterThanOrEqual(3);
  });

  it('takes the address from STALWART_BIND, loopback by default', () => {
    expect(
      /^BIND="\$\{STALWART_BIND:-127\.0\.0\.1\}"$/m.test(code),
      'setup-stalwart.sh has no BIND="${STALWART_BIND:-127.0.0.1}" line',
    ).toBe(true);
    const bare = flags.filter((f) => !f.startsWith('${BIND}:') || splitTop(f).length !== 3);
    expect(bare, 'these publish flags publish on every interface, or not on ${BIND}').toEqual([]);
    expect(
      dockerRunsOnEveryInterface(code),
      'a docker run in setup-stalwart.sh answers on every interface without a -p',
    ).toEqual([]);
  });

  it('asks the address it publishes on, rather than assuming localhost', () => {
    // stalwart-cli is a host binary and goes through the published port. With
    // STALWART_BIND set to a mesh address, a default of 127.0.0.1 would ask
    // an address nothing listens on and blame Stalwart for it.
    const cli = /^CLI_URL=.*$/m.exec(code)?.[0] ?? '';
    expect(cli, 'no CLI_URL= line in setup-stalwart.sh').not.toBe('');
    expect(cli, 'CLI_URL still defaults to loopback whatever the bind').not.toContain(LOOPBACK);
    const host = /http:\/\/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?:/.exec(cli)?.[1] ?? '';
    expect(host, 'CLI_URL does not default to a host taken from a variable').not.toBe('');
    expect(
      host === 'BIND' || derivesFrom(code, host, /^"?\$\{?BIND\}?"?$/),
      `CLI_URL asks \${${host}}, and ${host} is not taken from the bind`,
    ).toBe(true);
  });

  it('the managed demo seeds the address the demo Stalwart publishes on', () => {
    const demo = read('deploy/compose/setup-managed-demo.sh')
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .join('\n');
    // Positively: SEED_IMAP_HOST is handed a variable, and that variable is
    // taken from STALWART_BIND. Refusing one literal let `localhost`, or no
    // SEED_IMAP_HOST at all (the seeder's own default is loopback), through.
    const seed = /^SEED_IMAP_HOST="?\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?"?\s/m.exec(demo)?.[1] ?? '';
    expect(seed, 'setup-managed-demo.sh does not hand SEED_IMAP_HOST a variable').not.toBe('');
    expect(
      derivesFrom(demo, seed, /^"?\$\{STALWART_BIND[:}]/),
      `SEED_IMAP_HOST is \${${seed}}, and ${seed} is not taken from STALWART_BIND`,
    ).toBe(true);
  });
});

/**
 * The `docker run` commands in this shell text, each on one line with its
 * continuation lines joined, so a `mkdir -p "$DIR"` elsewhere is not read.
 */
function dockerRuns(code: string): string[] {
  return code
    .replace(/\\\n/g, ' ')
    .split('\n')
    .filter((l) => /\bdocker\s+run\b/.test(l));
}

/**
 * `docker run`'s boolean short flags, the ones a `-p` or `-P` may follow in
 * one cluster (`-dp V`, `-itP`): detach, interactive, tty, quiet, publish-all.
 */
const RUN_BOOLEAN_SHORTS = 'ditqP';

/**
 * Every value a `docker run` in this shell text publishes. The forms read are
 * the short flag with its value apart, after `=` or attached (`-p V`, `-p=V`,
 * `-pV`), the same after boolean short flags in one cluster (`-dp V`,
 * `-itpV`), and the long flag apart or after `=` (`--publish V`,
 * `--publish=V`); each value bare, double-quoted or single-quoted.
 * `dockerRunsOnEveryInterface` reads the flags that publish without a value.
 */
function dockerRunPublishes(code: string): string[] {
  const publish = new RegExp(
    `(?:^|\\s)(?:-[${RUN_BOOLEAN_SHORTS}]*p(?:=|\\s+|(?=[^\\s=]))|--publish(?:=|\\s+))(["']?)([^"'\\s]+)\\1`,
    'g',
  );
  return dockerRuns(code).flatMap((c) => [...c.matchAll(publish)].map((m) => m[2]!));
}

/**
 * The flags in a `docker run` that answer on every interface with no `-p` to
 * read: `-P` alone or in a cluster of boolean short flags (`-dP`),
 * `--publish-all` with or without a value, and a literal host network
 * (`--network host`, `--net=host`), which publishes nothing and needs nothing.
 */
function dockerRunsOnEveryInterface(code: string): string[] {
  const everyInterface = new RegExp(
    `(?:^|\\s)((?:-[${RUN_BOOLEAN_SHORTS}]*P|--publish-all\\b)\\S*|--net(?:work)?(?:=|\\s+)["']?host["']?(?=\\s|$))`,
    'g',
  );
  return dockerRuns(code).flatMap((c) => [...c.matchAll(everyInterface)].map((m) => m[1]!));
}

/**
 * Whether `name` has at least one assignment in this shell text whose value
 * matches `from`. The assignments may sit in a `case` arm (`0.0.0.0) x=… ;;`).
 */
function derivesFrom(code: string, name: string, from: RegExp): boolean {
  return [...code.matchAll(new RegExp(`(?:^|[\\s;)])${name}=("[^"]*"|\\S+)`, 'gm'))].some((m) =>
    from.test(m[1]!),
  );
}

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

  it('reads every publish form inside a docker run, and nothing outside one', () => {
    const shell = [
      'mkdir -p "$DIR"',
      'docker run -d \\',
      '  -p ${JMAP_PORT}:8080 \\',
      '  --publish="${BIND}:${IMAPS_PORT}:993" \\',
      '  -p=127.0.0.1:1:2 \\',
      '  --publish ${BIND}:3:4 \\',
      '  -p${X}:5 \\',
      '  -p"${BIND}:6:7" \\',
      "  -p '${BIND}:8:9' \\",
      '  -dp 10:11 \\',
      '  -itp12:13 \\',
      '  "$IMAGE"',
    ].join('\n');
    expect(dockerRunPublishes(shell)).toEqual([
      '${JMAP_PORT}:8080',
      '${BIND}:${IMAPS_PORT}:993',
      '127.0.0.1:1:2',
      '${BIND}:3:4',
      '${X}:5',
      '${BIND}:6:7',
      '${BIND}:8:9',
      '10:11',
      '12:13',
    ]);
  });

  it('finds every way a docker run answers on every interface without a -p', () => {
    for (const flag of [
      '-P',
      '-dP',
      '-Pd',
      '-itPp1:2',
      '--publish-all',
      '--publish-all=true',
      '--network host',
      '--net=host',
    ]) {
      expect(dockerRunsOnEveryInterface(`docker run -d ${flag} "$IMAGE"`), flag).toEqual([flag]);
    }
    const quiet = [
      'mkdir -P "$DIR"',
      'docker run -d \\',
      '  -ePATH=/bin \\',
      '  --network "$NETWORK" \\',
      '  --network-alias host \\',
      '  -p "${BIND}:1:2" \\',
      '  "$IMAGE"',
    ].join('\n');
    expect(dockerRunsOnEveryInterface(quiet)).toEqual([]);
  });

  it('splits only on the colons outside a variable', () => {
    expect(splitTop('${A_BIND:-127.0.0.1}:${A_PORT:-1}:${A_PORT:-1}')).toEqual([
      '${A_BIND:-127.0.0.1}',
      '${A_PORT:-1}',
      '${A_PORT:-1}',
    ]);
  });
});
