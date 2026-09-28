#!/usr/bin/env node
// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * EVERY PORT THE OUTSIDE PROBE TRIES, READ FROM THE FILES THAT PUBLISH THEM
 * (workplan 0132 T3 (c)).
 *
 * `.github/workflows/exposure-probe.yml` asks from the internet whether
 * anything but 443 answers on the machine's names and on its own address. Its
 * "nothing else answers" covers exactly the ports it tried, so the list is
 * derived here, never typed into the workflow: a port added to `managed.yml`
 * tomorrow is tried tomorrow.
 *
 *   deploy/compose/managed.yml            every `ports:` entry, both stacks
 *   deploy/compose/www.yml                the site's
 *   deploy/compose/setup-managed-demo.sh  the demo's two (its Stalwart's JMAP
 *                                         and IMAPS), and any other `*_PORT`
 *                                         default it hands on
 *
 * A port is the HOST side of a publish, with the value it has when the `.env`
 * does not set it: `${WEB_PORT:-3123}` is 3123. That is the OTA stack's. Live
 * sets its own `*_PORT` values in its `.env` (0132 T1b), which a GitHub runner
 * cannot read, so the probe adds them from the repository variable
 * `EXPOSURE_PROBE_LIVE_PORTS`.
 *
 * DEPENDENCY-FREE ON PURPOSE. The probe runs on a GitHub-hosted runner from a
 * bare checkout, with no `pnpm install`, so the compose files are read line by
 * line rather than with a YAML library. What this reader cannot turn into a
 * port (no host port, a variable with no default, a range, the long or flow
 * syntax) is a PROBLEM, and the probe refuses to run on a list with a problem
 * in it: a port skipped here is a port nobody tried.
 * `scripts/a-probe-that-knows-every-port.unit.test.ts` reads the same files
 * with a YAML parser and fails on any port this list does not carry.
 *
 * Usage:  node scripts/exposure-probe-ports.mjs   # one `port<TAB>where` per line
 */

import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The three files the list is derived from, relative to the repository root. */
export const SOURCES = {
  managed: 'deploy/compose/managed.yml',
  www: 'deploy/compose/www.yml',
  demo: 'deploy/compose/setup-managed-demo.sh',
};

/** Split on the colons outside a `${…}` and outside `[…]`. */
/**
 * A compose value as a problem line may show it: with any address in it
 * replaced. The value comes from the repository, so its addresses are
 * loopback, but the log is public and the rule is simpler kept whole.
 */
function shown(value) {
  return JSON.stringify(
    value.replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, '<address>').replace(/\[[0-9A-Fa-f:.]*\]/g, '<address>'),
  );
}

function splitOutside(s) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
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

/** The port a host-port expression names, or why it names none. */
function portOf(expr) {
  let m = /^(\d+)$/.exec(expr);
  if (!m) m = /^\$\{[A-Za-z_][A-Za-z0-9_]*:?-(\d+)\}$/.exec(expr);
  if (!m) {
    if (expr === '') return { why: 'no host port, so Docker picks one at random' };
    if (/^\d+-\d+$/.test(expr)) return { why: 'a range' };
    return { why: `a host port with no default (${expr})` };
  }
  const port = Number(m[1]);
  return port >= 1 && port <= 65535 ? { port } : { why: `not a port number (${m[1]})` };
}

/** One list item's value: quoted, or bare up to a comment. */
function itemValue(rest) {
  const quoted = /^(["'])(.*?)\1\s*(?:#.*)?$/.exec(rest);
  if (quoted) return quoted[2];
  return rest.replace(/\s+#.*$/, '').trim();
}

/**
 * Every host port one compose file publishes, as `{ port, where }`, and every
 * `ports:` entry this reader could not turn into one.
 */
export function composePublishes(file, text) {
  const publishes = [];
  const problems = [];
  let section = '';
  let service = '';
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const top = /^([A-Za-z_][\w-]*):/.exec(line);
    if (top) section = top[1];
    const svc = /^ {2}([A-Za-z0-9][\w.-]*):\s*(?:#.*)?$/.exec(line);
    if (svc && section === 'services') service = svc[1];
    const where = `${file}:${service || '?'}`;

    if (/^\s+ports:\s*[^\s#]/.test(line)) {
      problems.push(`${where}: ports in the flow syntax, which this reader does not read`);
      continue;
    }
    const block = /^(\s+)ports:\s*(?:#.*)?$/.exec(line);
    if (!block) continue;
    const indent = block[1].length;
    let longItemIndent = -1;
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j];
      if (/^\s*(?:#.*)?$/.test(l)) continue;
      const lIndent = l.length - l.trimStart().length;
      const item = /^(\s*)-\s+(.*)$/.exec(l);
      if (lIndent < indent || (lIndent === indent && !item)) break;
      if (longItemIndent >= 0 && lIndent > longItemIndent && !item) continue;
      if (!item) {
        problems.push(`${where}: a line in its ports block this reader does not read`);
        continue;
      }
      longItemIndent = -1;
      const value = itemValue(item[2]);
      if (/^[a-z_]+:(\s|$)/.test(value)) {
        problems.push(`${where}: a publish in the long syntax, which this reader does not read`);
        longItemIndent = item[1].length;
        continue;
      }
      const parts = splitOutside(value.replace(/\/(tcp|udp|sctp)$/, ''));
      const host = parts.length === 3 ? parts[1] : parts.length === 2 ? parts[0] : parts.length === 1 ? '' : undefined;
      if (host === undefined) {
        problems.push(`${where}: ${shown(value)} has more parts than address, host port and target`);
        continue;
      }
      const port = portOf(host);
      if ('why' in port) problems.push(`${where}: ${shown(value)} has ${port.why}`);
      else publishes.push({ port: port.port, where });
    }
  }
  return { publishes, problems };
}

/** Every `${…PORT…:-n}` default a shell script's code lines hand on, as `{ port, where }`. */
export function scriptPublishes(file, text) {
  const publishes = [];
  const code = text
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');
  for (const m of code.matchAll(/\$\{([A-Z0-9_]*PORT[A-Z0-9_]*):-(\d+)\}/g)) {
    publishes.push({ port: Number(m[2]), where: `${file}:${m[1]}` });
  }
  return { publishes, problems: [] };
}

/**
 * The probe's port list from the three files' text: each port once, in order,
 * with every place that publishes it, and every problem met on the way.
 */
export function derivePorts({ managed, www, demo }) {
  const read = [
    composePublishes('managed.yml', managed),
    composePublishes('www.yml', www),
    scriptPublishes('setup-managed-demo.sh', demo),
  ];
  const byPort = new Map();
  for (const { port, where } of read.flatMap((r) => r.publishes)) {
    byPort.set(port, (byPort.get(port) ?? new Set()).add(where));
  }
  return {
    ports: [...byPort]
      .sort(([a], [b]) => a - b)
      .map(([port, where]) => ({ port, where: [...where] })),
    problems: read.flatMap((r) => r.problems),
  };
}

/** The probe's port list from the files in a checkout. */
export function readPorts(root = REPO_ROOT) {
  const text = (rel) => readFileSync(join(root, rel), 'utf8');
  return derivePorts({ managed: text(SOURCES.managed), www: text(SOURCES.www), demo: text(SOURCES.demo) });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { ports, problems } = readPorts();
  for (const { port, where } of ports) console.log(`${port}\t${where.join(', ')}`);
  for (const p of problems) console.error(`exposure-probe-ports: cannot read ${p}`);
  if (problems.length) process.exitCode = 2;
}
