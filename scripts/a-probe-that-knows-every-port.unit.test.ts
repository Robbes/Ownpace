// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PROBE THAT KNOWS EVERY PORT (workplan 0132 T3 (c)).
 *
 * `.github/workflows/exposure-probe.yml` asks from the internet what the
 * reference machine answers: it resolves the production names and the OTA
 * names, and tries every port either stack publishes, the site's and the
 * demo's two, on the addresses they resolve to and on the machine's own
 * address. "Nothing else answers" is only as good as the list of ports it
 * tried, and a list typed into the workflow is a list the next port added to
 * `managed.yml` is not on. So the list is DERIVED, by
 * `scripts/exposure-probe-ports.mjs`, from `deploy/compose/managed.yml`,
 * `deploy/compose/www.yml` and `deploy/compose/setup-managed-demo.sh`, and
 * this guard reads those files a second way (the compose files with a YAML
 * parser, the demo script for every `*_PORT` default) and fails on any port
 * the probe would not try. A synthetic extra port proves the comparison bites,
 * and that the derivation follows the file rather than a copy of it.
 *
 * Live's port VALUES are in live's `.env`, which a GitHub runner cannot read;
 * they reach the probe as the repository variable `EXPOSURE_PROBE_LIVE_PORTS`
 * (port numbers, not secrets). The machine's own public address, if the owner
 * stores it, is the secret `EXPOSURE_PROBE_HOST`.
 *
 * DISPATCH ONLY, AND ON A GITHUB-HOSTED RUNNER. A public repository's job logs
 * are public, and a failing probe names an open port, so it runs when the
 * owner is there to act on it (0132 open question 6's proposed answer): no
 * schedule, no push, no pull request. And it must ask from OUTSIDE: a
 * self-hosted runner is the machine itself, where every port answers on
 * loopback, so a probe from there proves nothing and would pass.
 *
 * What the probe prints, and that it prints no address, is
 * `scripts/exposure-probe.unit.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { derivePorts, readPorts } from './exposure-probe-ports.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');

const WORKFLOW = '.github/workflows/exposure-probe.yml';
const MANAGED = read('deploy/compose/managed.yml');
const WWW = read('deploy/compose/www.yml');
const DEMO = read('deploy/compose/setup-managed-demo.sh');

/** Split on the colons outside a `${…}` and outside `[…]`. */
function splitOutside(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if ((c === '$' && s[i + 1] === '{') || c === '[') depth++;
    if ((c === '}' || c === ']') && depth > 0) depth--;
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

/** The host port a value names: a number, or a variable's default. */
function hostPortOf(expr: string): string | undefined {
  if (/^\d+$/.test(expr)) return expr;
  return /^\$\{[A-Z0-9_]+:-(\d+)\}$/.exec(expr)?.[1];
}

/**
 * Every host port one compose file publishes, read with a YAML parser, as
 * `port → where`. An entry this cannot read is returned as a problem.
 */
function composePorts(file: string, text: string): { ports: Map<string, string[]>; problems: string[] } {
  const compose = parseYaml(text) as { services: Record<string, { ports?: unknown[] }> };
  const ports = new Map<string, string[]>();
  const problems: string[] = [];
  for (const [service, svc] of Object.entries(compose.services)) {
    for (const entry of svc.ports ?? []) {
      const where = `${file}:${service}`;
      if (typeof entry !== 'string' && typeof entry !== 'number') {
        problems.push(`${where}: ${JSON.stringify(entry)}`);
        continue;
      }
      const parts = splitOutside(String(entry).replace(/\/(tcp|udp|sctp)$/, ''));
      const host = parts.length === 3 ? parts[1]! : parts.length === 2 ? parts[0]! : '';
      const port = hostPortOf(host);
      if (!port) {
        problems.push(`${where}: ${String(entry)}`);
        continue;
      }
      ports.set(port, [...(ports.get(port) ?? []), where]);
    }
  }
  return { ports, problems };
}

/** Every `${…PORT…:-n}` default in a shell script's code lines. */
function scriptPorts(file: string, text: string): Map<string, string[]> {
  const ports = new Map<string, string[]>();
  const code = text
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');
  for (const m of code.matchAll(/\$\{([A-Z0-9_]*PORT[A-Z0-9_]*):-(\d+)\}/g)) {
    ports.set(m[2]!, [...(ports.get(m[2]!) ?? []), `${file}:${m[1]}`]);
  }
  return ports;
}

/** Every port the three files publish, read independently of the probe. */
function expected(managed: string, www: string, demo: string): Map<string, string[]> {
  const all = new Map<string, string[]>();
  const add = (m: Map<string, string[]>) => {
    for (const [p, w] of m) all.set(p, [...(all.get(p) ?? []), ...w]);
  };
  add(composePorts('managed.yml', managed).ports);
  add(composePorts('www.yml', www).ports);
  add(scriptPorts('setup-managed-demo.sh', demo));
  return all;
}

/** The ports in `want` the probe's list does not carry, each with where it is published. */
function missingFrom(want: Map<string, string[]>, probe: readonly number[]): string[] {
  const tried = new Set(probe.map(String));
  return [...want].filter(([p]) => !tried.has(p)).map(([p, where]) => `${p} (${where.join(', ')})`);
}

/** A service that publishes one more port, put where Compose would read it. */
function withExtraService(yaml: string, port: number): string {
  const extra =
    '  exposure-guard-extra:\n' +
    '    image: busybox\n' +
    '    ports:\n' +
    `      - "127.0.0.1:\${EXTRA_PORT:-${port}}:80"\n` +
    `      - "\${EXTRA_BIND:-127.0.0.1}:\${EXTRA_PORT:-${port}}:80"\n`;
  const out = yaml.replace(/^services:\n/m, `services:\n${extra}`);
  expect(out, 'the file has no `services:` line to add a service under').not.toBe(yaml);
  return out;
}

describe('the probe tries every port the stacks publish', () => {
  const want = expected(MANAGED, WWW, DEMO);

  it('read the files a second way, and found what they publish', () => {
    // Vacuity: a reader that finds nothing makes every comparison below pass.
    expect(composePorts('managed.yml', MANAGED).problems).toEqual([]);
    expect(composePorts('www.yml', WWW).problems).toEqual([]);
    expect(composePorts('managed.yml', MANAGED).ports.size).toBeGreaterThanOrEqual(10);
    expect(composePorts('www.yml', WWW).ports.size).toBeGreaterThanOrEqual(1);
    // The demo's two: the Stalwart ports setup-managed-demo.sh publishes.
    const demo = [...scriptPorts('setup-managed-demo.sh', DEMO).values()].flat().join(' ');
    expect(demo).toContain('STALWART_JMAP_PORT');
    expect(demo).toContain('STALWART_IMAPS_PORT');
  });

  it('derives a list that holds every one of them', () => {
    const derived = readPorts(ROOT);
    expect(derived.problems, 'the derivation met entries it could not read').toEqual([]);
    const missing = missingFrom(want, derived.ports.map((p) => p.port));
    expect(
      missing,
      `the outside probe would not try these published ports:\n  ${missing.join('\n  ')}\n` +
        'scripts/exposure-probe-ports.mjs reads them from the files; fix the reader, never type a port into the workflow',
    ).toEqual([]);
  });

  it.each([
    ['managed.yml', 4999],
    ['www.yml', 4998],
  ])('bites: a port %s gains is missing from today\'s list, and the derivation picks it up', (file, port) => {
    const managed = file === 'managed.yml' ? withExtraService(MANAGED, port) : MANAGED;
    const www = file === 'www.yml' ? withExtraService(WWW, port) : WWW;
    // Today's list, against the file with one more port: the comparison names it.
    const today = readPorts(ROOT).ports.map((p) => p.port);
    expect(missingFrom(expected(managed, www, DEMO), today)).toEqual([
      `${port} (${file}:exposure-guard-extra, ${file}:exposure-guard-extra)`,
    ]);
    // And the probe's own reader, given that file, tries it.
    const derived = derivePorts({ managed, www, demo: DEMO });
    expect(derived.problems).toEqual([]);
    expect(derived.ports.map((p) => p.port)).toContain(port);
  });

  it('refuses a publish it cannot turn into a port, rather than skipping it', () => {
    for (const entry of ['"80"', '"${EXTRA_PORT}:80"', '"127.0.0.1:8000-8002:80"']) {
      const managed = MANAGED.replace(
        /^services:\n/m,
        `services:\n  exposure-guard-extra:\n    image: busybox\n    ports:\n      - ${entry}\n`,
      );
      const derived = derivePorts({ managed, www: WWW, demo: DEMO });
      expect(derived.problems.join('\n'), entry).toContain('exposure-guard-extra');
    }
    // The long syntax too.
    const long = MANAGED.replace(
      /^services:\n/m,
      'services:\n  exposure-guard-extra:\n    image: busybox\n    ports:\n      - target: 80\n        published: 4997\n',
    );
    expect(derivePorts({ managed: long, www: WWW, demo: DEMO }).problems.join('\n')).toContain('exposure-guard-extra');
  });
});

interface Step {
  readonly name?: string;
  readonly run?: string;
  readonly uses?: string;
  readonly env?: Record<string, string>;
}
interface Workflow {
  readonly on?: Record<string, { inputs?: Record<string, { type?: string; options?: string[]; default?: string }> } | null>;
  readonly jobs?: Record<string, { 'runs-on'?: unknown; steps?: Step[] }>;
}

describe('the workflow', () => {
  const text = read(WORKFLOW);
  const wf = parseYaml(text) as Workflow;
  const jobs = Object.entries(wf.jobs ?? {});
  const steps = jobs.flatMap(([, j]) => j.steps ?? []);

  it('runs only when somebody dispatches it', () => {
    expect(Object.keys(wf.on ?? {}), `${WORKFLOW} must be triggered by workflow_dispatch and nothing else`).toEqual([
      'workflow_dispatch',
    ]);
  });

  it('runs on a GitHub-hosted runner, never the machine it probes', () => {
    expect(jobs.length).toBeGreaterThan(0);
    for (const [name, job] of jobs) {
      const runsOn = job['runs-on'];
      expect(typeof runsOn, `${name}: runs-on must be one GitHub-hosted label`).toBe('string');
      expect(String(runsOn), name).toMatch(/^(ubuntu|windows|macos)-[0-9a-z.-]+$/);
      expect(String(runsOn), name).not.toContain('self-hosted');
    }
  });

  it('takes the OTA names\' pass condition as an input, recording by default (open question 7)', () => {
    const input = wf.on?.workflow_dispatch?.inputs?.ota_names;
    expect(input, 'workflow_dispatch has no ota_names input').toBeDefined();
    expect(input?.type).toBe('choice');
    expect(input?.options).toEqual(['report', 'internet', 'mesh-only']);
    expect(input?.default).toBe('report');
  });

  it('takes what www.ownpace.eu must do as an input, recording by default until live serves it (0139 T10)', () => {
    const input = wf.on?.workflow_dispatch?.inputs?.site_name;
    expect(input, 'workflow_dispatch has no site_name input').toBeDefined();
    expect(input?.type).toBe('choice');
    expect(input?.options).toEqual(['report', 'required']);
    expect(input?.default).toBe('report');
  });

  it('runs the probe, which derives its ports from the files', () => {
    const probe = steps.filter((s) => /\bnode\s+scripts\/exposure-probe\.mjs\b/.test(s.run ?? ''));
    expect(probe, 'no step runs node scripts/exposure-probe.mjs').toHaveLength(1);
    expect(read('scripts/exposure-probe.mjs')).toMatch(/from '\.\/exposure-probe-ports\.mjs'/);
    const env = probe[0]!.env ?? {};
    expect(env.EXPOSURE_PROBE_LIVE_PORTS).toBe('${{ vars.EXPOSURE_PROBE_LIVE_PORTS }}');
    expect(env.EXPOSURE_PROBE_HOST).toBe('${{ secrets.EXPOSURE_PROBE_HOST }}');
    expect(env.EXPOSURE_PROBE_OTA_NAMES).toBe('${{ inputs.ota_names }}');
    expect(env.EXPOSURE_PROBE_SITE_NAME).toBe('${{ inputs.site_name }}');
  });

  it('types no port it derives', () => {
    const typed = readPorts(ROOT)
      .ports.map((p) => p.port)
      .filter((p) => new RegExp(`(?<![\\w.])${p}(?![\\w])`).test(text));
    expect(typed, `${WORKFLOW} writes these ports out; they come from the files`).toEqual([]);
  });
});
