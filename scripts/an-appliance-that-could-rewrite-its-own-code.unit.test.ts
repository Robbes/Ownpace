// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN APPLIANCE THAT COULD REWRITE ITS OWN CODE (workplan 0119, Status of
 * 2026-11-03).
 *
 * The selfhost image ran as `appuser` (uid 10001), and its last RUN was
 * `chown -R appuser:appuser /app /data`. So the appliance owned `/app`, the
 * payload it runs (`start.mjs`, the bundle, PGlite, the migrations and the UI):
 * a compromised appliance could rewrite the code it loads at its next start,
 * which the API has not been able to do since 0146 T13 made its `/app` root's.
 * Nothing in the appliance writes there. It writes its config to `CONFIG_DIR`
 * and PGlite's database to `SELFHOST_PGLITE_DIR`, both under `/data`. And the
 * `chown -R` wrote every file of the payload a second time, in a layer of its
 * own: the published `edge` image (amd64, read from its manifest on
 * 2026-11-03) carried the payload's COPY as an 11.29 MB layer, the config's
 * COPY as 1.8 kB, and then the chown's RUN as 11.30 MB.
 *
 * Making `/app` root's has two ways to go wrong, and neither shows on CI:
 *
 * - **Modes.** COPY keeps a file's mode, and a checkout made under a umask of
 *   077 has 0600 files, which a root-owned `/app` keeps from uid 10001. CI's
 *   umask is 022. So the stage the runtime copies from sets the modes itself,
 *   last: `chmod -R u=rwX,go=rX` over exactly what the runtime copies.
 * - **Where PGlite goes.** `start.mjs` defaults `SELFHOST_PGLITE_DIR` into the
 *   payload, `/app/data/pglite`. `compose.pglite.yml` names
 *   `/data/state/pglite`, but a `docker run -e SELFHOST_PERSISTENCE=pglite` of
 *   the image would stop at start with "The appliance cannot write its
 *   database directory". So the image names the directory itself, the one the
 *   override names.
 *
 * Its HEALTHCHECK was shell form, `CMD node -e "…"`, which Docker runs as
 * `/bin/sh -c`. The probe needs no shell, and an image without one, as the
 * API's distroless runtime is, could not run it.
 *
 * So this file holds, for `apps/selfhost/Dockerfile`'s runtime stage (its last):
 *
 * 1. Everything it copies into `/app` comes from a stage of this Dockerfile,
 *    as root's (no `--chown` but root, no `--chmod`), and never from the build
 *    context, whose modes are the checkout's.
 * 2. Each such stage's last RUN, COPY or ADD is a RUN whose last command is
 *    `chmod -R u=rwX,go=rX` over the directory copied.
 * 3. No RUN in the runtime stage changes the owner or mode of anything; but
 *    `chown` of `/data`, to the user the stage then runs as, after making the
 *    mount point of every named volume the appliance's compose files give its
 *    `app` service. (A volume is seeded from the image's directory, ownership
 *    included; a mount point the image lacks comes up root's: the EACCES of
 *    `apps/selfhost/src/index.ts`'s startup hint.)
 * 4. `CONFIG_DIR` and `SELFHOST_PGLITE_DIR` are set, both under `/data`, and
 *    `SELFHOST_PGLITE_DIR` is the value `compose.pglite.yml` gives it; and the
 *    payload's `start.mjs` still reads both from the environment.
 * 5. Its one HEALTHCHECK is exec form (valid JSON: Docker takes anything else
 *    as the shell form, silently), runs `node`, asks `/healthz` on
 *    `process.env.PORT`, and holds no `$` a shell would have expanded.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const DOCKERFILE = 'apps/selfhost/Dockerfile';
const COMPOSE_DIR = 'deploy/selfhost';
const PGLITE_OVERRIDE = 'deploy/selfhost/compose.pglite.yml';
/** The packager that writes the payload's `start.mjs`. */
const PACKAGER = 'scripts/package-appliance.mjs';
const APP = '/app';
const DATA = '/data';
const MODES = 'u=rwX,go=rX';

type Instruction = { op: string; args: string };
type Stage = { name: string; base: string; body: Instruction[] };

/** A Dockerfile's stages, comments dropped before continuations are joined, as Docker reads it. */
function stagesOf(text: string): Stage[] {
  const logical = text
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n')
    .replace(/\\\r?\n/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const out: Stage[] = [];
  for (const line of logical) {
    const [, keyword = '', args = ''] = /^(\S+)\s*(.*)$/.exec(line) ?? [];
    const op = keyword.toUpperCase();
    if (op === 'FROM') {
      const words = args.split(/\s+/).filter((w) => !w.startsWith('--'));
      const as = words.findIndex((w) => w.toUpperCase() === 'AS');
      out.push({ name: as >= 0 ? words[as + 1]! : String(out.length), base: words[0]!, body: [] });
      continue;
    }
    out.at(-1)?.body.push({ op, args });
  }
  return out;
}

/** A COPY or ADD: its flags, its sources and its destination (shell form; the exec form is read too). */
function copyOf(args: string): { flags: Record<string, string>; sources: string[]; dest: string } {
  const words = args.trim().split(/\s+/);
  const flags: Record<string, string> = {};
  while (words[0]?.startsWith('--')) {
    const [k, v = ''] = words.shift()!.slice(2).split('=');
    flags[k!] = v;
  }
  const rest = words.join(' ');
  const paths = rest.startsWith('[') ? (JSON.parse(rest) as string[]) : words;
  return { flags, sources: paths.slice(0, -1), dest: paths.at(-1)! };
}

/** Strip a trailing slash, so `/app/` and `/app` compare equal. */
const norm = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p);
const under = (p: string, dir: string) => norm(p) === dir || norm(p).startsWith(`${dir}/`);

/** The commands of one RUN, split at `&&`, `||`, `;` and `|`, each as its words. */
function commandsOf(run: string): string[][] {
  return run
    .split(/&&|\|\||;|\|/)
    .map((c) => c.trim().split(/\s+/).filter(Boolean))
    .filter((w) => w.length > 0);
}

/** The exec form's words, or null for the shell form (or JSON Docker would not take). */
function execForm(args: string): string[] | null {
  const t = args.trim();
  if (!t.startsWith('[')) return null;
  try {
    const words = JSON.parse(t) as unknown;
    return Array.isArray(words) && words.every((w) => typeof w === 'string') ? (words as string[]) : null;
  } catch {
    return null;
  }
}

/** The runtime stage's ENV, as `KEY=value` pairs (the form this Dockerfile uses). */
function envOf(stage: Stage): Map<string, string> {
  const env = new Map<string, string>();
  for (const i of stage.body.filter((x) => x.op === 'ENV')) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(\S+)$/.exec(i.args.trim());
    if (m) env.set(m[1]!, m[2]!);
  }
  return env;
}

/** Every `app` service's named-volume mount points, in every compose file of the appliance's directory. */
function appVolumeTargets(): Array<{ file: string; target: string }> {
  const out: Array<{ file: string; target: string }> = [];
  for (const f of readdirSync(join(ROOT, COMPOSE_DIR)).filter((n) => /\.ya?ml$/.test(n))) {
    const file = `${COMPOSE_DIR}/${f}`;
    const doc = (parseYaml(read(file), { merge: true, logLevel: 'error' }) ?? {}) as {
      services?: Record<string, { volumes?: unknown[] } | null>;
    };
    for (const v of doc.services?.app?.volumes ?? []) {
      // Short syntax only (`name:/target[:mode]`); a named volume's source has no slash.
      if (typeof v !== 'string') continue;
      const [source = '', target = ''] = v.split(':');
      if (source && !source.includes('/') && !source.startsWith('.') && !source.startsWith('$')) out.push({ file, target });
    }
  }
  return out;
}

describe(`${DOCKERFILE}: /app is root's, readable by the appliance and not writable by it`, () => {
  const stages = stagesOf(read(DOCKERFILE));
  const runtime = stages.at(-1)!;
  const intoApp = runtime.body
    .filter((i) => i.op === 'COPY' || i.op === 'ADD')
    .map((i) => ({ i, c: copyOf(i.args) }))
    .filter(({ c }) => under(c.dest, APP));

  it('its last stage is the runtime, and copies into /app (vacuity)', () => {
    expect(runtime.name).toBe('runtime');
    expect(intoApp.length, 'nothing copied into /app').toBeGreaterThan(0);
  });

  it('copies into /app only from a stage of this Dockerfile, as root\'s, with no mode of its own', () => {
    for (const { i, c } of intoApp) {
      const what = `${i.op} ${i.args}`;
      // From the build context, a file keeps the checkout's mode, which a
      // umask of 077 makes 0600; nothing after this COPY may change it (3).
      expect(i.op, `${what}: ADD fetches and unpacks; COPY from a stage`).toBe('COPY');
      expect(c.flags.from, `${what}: from the build context, with the checkout's modes`).toBeDefined();
      expect(stages.some((s) => s.name === c.flags.from), `${what}: no stage named ${c.flags.from}`).toBe(true);
      const chown = c.flags.chown;
      expect(chown === undefined || /^(?:0|root)(?::(?:0|root))?$/.test(chown), `${what}: /app would be ${chown}'s`).toBe(true);
      expect(c.flags.chmod, `${what}: the mode is the source stage's, set last there`).toBeUndefined();
    }
  });

  it(`the stage it copies from runs \`chmod -R ${MODES}\` over what it copies, last`, () => {
    for (const { i, c } of intoApp) {
      const stage = stages.find((s) => s.name === c.flags.from)!;
      const writes = stage.body.filter((x) => ['RUN', 'COPY', 'ADD'].includes(x.op));
      const last = writes.at(-1);
      expect(last?.op, `${c.flags.from}: its last RUN, COPY or ADD`).toBe('RUN');
      const final = commandsOf(last!.args).at(-1)!;
      expect(final.slice(0, 3), `${c.flags.from}: the last command of its last RUN is ${final.join(' ')}`).toEqual(['chmod', '-R', MODES]);
      const dirs = final.slice(3).map(norm);
      for (const source of c.sources) {
        expect(dirs.some((d) => under(source, d)), `${i.op} ${i.args}: ${source} is not under ${dirs.join(' ')}`).toBe(true);
      }
    }
  });

  it('no RUN in the runtime stage changes an owner or a mode, but chown of /data to its USER', () => {
    const users = runtime.body.filter((i) => i.op === 'USER');
    expect(users, 'the runtime names its USER once').toHaveLength(1);
    const user = users[0]!.args.trim();
    const userAt = runtime.body.indexOf(users[0]!);
    let chownsData = -1;
    runtime.body.forEach((i, at) => {
      if (i.op !== 'RUN') return;
      for (const words of commandsOf(i.args)) {
        if (!['chown', 'chmod', 'chgrp', 'setfacl'].includes(words[0]!)) continue;
        const command = words.join(' ');
        // `chown [-R] <owner> <path>…`: the owner, then the paths.
        const operands = words.slice(1).filter((w) => !w.startsWith('-'));
        expect(words[0], `${command}: a mode is the build stage's to set, not the runtime's`).toBe('chown');
        expect(operands[0], `${command}: /data is the runtime user's`).toBe(`${user}:${user}`);
        const paths = operands.slice(1);
        expect(paths.length, command).toBeGreaterThan(0);
        for (const p of paths) {
          expect(under(p, APP), `${command}: hands ${p} to ${user}, which may then rewrite the code it runs`).toBe(false);
          expect(norm(p), `${command}: only /data, whole`).toBe(DATA);
        }
        if (words.includes('-R')) chownsData = at;
      }
    });
    expect(chownsData, `no \`chown -R ${user}:${user} ${DATA}\` in the runtime stage`).toBeGreaterThanOrEqual(0);
    expect(chownsData, 'the chown comes after USER, as a user who may not').toBeLessThan(userAt);

    // The mount points are made in the same RUN, before the chown, so a fresh
    // named volume is seeded as the user's and not root's.
    const run = runtime.body[chownsData]!.args;
    const made = commandsOf(run)
      .filter((w) => w[0] === 'mkdir')
      .flatMap((w) => w.slice(1).filter((x) => !x.startsWith('-')).map(norm));
    const targets = appVolumeTargets();
    expect(targets.length, `no named volume on the app service in ${COMPOSE_DIR} (vacuity)`).toBeGreaterThan(0);
    for (const { file, target } of targets) {
      expect(under(target, DATA), `${file}: ${target} is not under ${DATA}, which the appliance owns`).toBe(true);
      expect(made, `${file} mounts a volume at ${target}, which the chown's RUN never makes`).toContain(norm(target));
    }
  });

  it('it writes under /data: CONFIG_DIR and SELFHOST_PGLITE_DIR, the latter as compose.pglite.yml names it', () => {
    const env = envOf(runtime);
    for (const name of ['CONFIG_DIR', 'SELFHOST_PGLITE_DIR']) {
      const value = env.get(name);
      expect(value, `${name} is not set in the runtime stage; start.mjs would put it inside /app`).toBeDefined();
      expect(under(value!, DATA), `${name}=${value}: not under ${DATA}`).toBe(true);
    }
    const override = parseYaml(read(PGLITE_OVERRIDE), { merge: true, logLevel: 'error' }) as {
      services: { app: { environment: Record<string, string> } };
    };
    expect(env.get('SELFHOST_PGLITE_DIR'), `${PGLITE_OVERRIDE} and a plain docker run keep one database in one place`).toBe(
      override.services.app.environment.SELFHOST_PGLITE_DIR,
    );
    // What makes the two lines above mean anything: the payload's launcher
    // reads them, and defaults each into itself when they are unset.
    const packager = read(PACKAGER);
    expect(packager).toContain('process.env.SELFHOST_PGLITE_DIR ??');
    expect(packager).toContain('process.env.CONFIG_DIR ??');
  });
});

describe(`${DOCKERFILE}: the HEALTHCHECK runs without a shell`, () => {
  const runtime = stagesOf(read(DOCKERFILE)).at(-1)!;
  const hc = runtime.body.filter((i) => i.op === 'HEALTHCHECK');

  it('is one, exec form, on node, asking /healthz on PORT, with nothing for a shell to expand', () => {
    expect(hc, 'one HEALTHCHECK in the runtime stage').toHaveLength(1);
    const command = /\bCMD\s+(.*)$/.exec(hc[0]!.args)?.[1];
    expect(command, `HEALTHCHECK ${hc[0]!.args}`).toBeDefined();
    const words = execForm(command!);
    // Docker reads a CMD that is not a JSON array of strings as the shell form,
    // and says nothing.
    expect(words, `HEALTHCHECK ${hc[0]!.args}: the shell form, or JSON Docker would not take`).not.toBeNull();
    expect(words![0]).toBe('node');
    expect(words![1]).toBe('-e');
    expect(words![2]).toContain('/healthz');
    expect(words![2]).toContain('process.env.PORT');
    for (const w of words!) expect(w, 'no shell runs this, so a $ stays a $').not.toContain('$');
  });

  it('refuses the shapes that slip', () => {
    for (const shell of [
      'node -e "fetch(1)"',
      '["node", "-e", "fetch(1)",]',
      "['node', '-e', 'fetch(1)']",
      '["node", "-e", 1]',
    ]) {
      expect(execForm(shell), shell).toBeNull();
    }
    expect(execForm('["node", "-e", "fetch(1)"]')).toEqual(['node', '-e', 'fetch(1)']);
  });
});
