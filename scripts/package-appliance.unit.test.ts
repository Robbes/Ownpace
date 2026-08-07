// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The staged appliance payload actually runs (workplan 0015 T3).
 *
 * `scripts/package-appliance.mjs` produces the directory a Windows installer
 * copies to `C:\Program Files\...`. The failure mode worth guarding against is
 * specific and nasty: **a payload that stages cleanly and then dies on the
 * user's machine.** Bundling changes how a module finds files — `import.meta.url`
 * moves, `require` disappears, package layouts collapse — so the things that
 * break are exactly the things a file listing cannot see. Three real ones were
 * found this way and each is asserted below:
 *
 * 1. `pg` is CommonJS, and bundled into ESM its `require('events')` became
 *    esbuild's `__require` helper, which throws on evaluation.
 * 2. PGlite finds its 24 MB of WASM with `new URL(..., import.meta.url)`, so
 *    bundling it points those lookups at the bundle and the database never boots.
 * 3. `runMigrations()` walks up from its own module URL to
 *    `packages/ledger/migrations`, a path that does not survive bundling.
 *
 * So this test stages a payload into a temp directory, starts it as a REAL
 * child process with the repository nowhere in its path, and talks HTTP to it.
 * Nothing here imports from the workspace: the point is the payload standing on
 * its own.
 *
 * It does not build the operating UI — `--ui` points at a stub — because that
 * is a Vite build and this test is about assembly and boot, not about the UI's
 * contents. The real invocation's UI check is asserted separately.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import { shaFor, verifySha256 } from './package-appliance.mjs';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(REPO, 'scripts/package-appliance.mjs');

const TENANT = '00000000-0000-4000-8000-0000000000aa';
const MAPPING = '11111111-1111-4111-8111-1111111111aa';

/**
 * A mapping whose connectors point nowhere and whose schedule is 31 February —
 * a valid cron expression that never fires. The appliance needs a mapping to
 * exist; it must not need one that works.
 */
const MAPPING_JSON = JSON.stringify({
  tenantId: TENANT,
  mappingId: MAPPING,
  schedule: { cron: '0 5 31 2 *' },
  source: {
    type: 'imap-oauth2',
    host: '127.0.0.1',
    port: 1,
    user: 'nobody@invalid',
    auth: { kind: 'login', passwordFromEnv: 'OPENMIG_TEST_NOPE' },
  },
  target: {
    type: 'jmap',
    baseUrl: 'http://127.0.0.1:1',
    user: 'nobody@invalid',
    auth: { kind: 'basic', passwordFromEnv: 'OPENMIG_TEST_NOPE' },
  },
  domains: {},
});

let payload: string;
let stubUi: string;
let child: ChildProcess | undefined;
let base: string;
let log = '';

/** Wait for the child to answer, or for it to die and say why. */
async function waitForHealth(url: string, deadlineMs = 90_000): Promise<void> {
  const until = Date.now() + deadlineMs;
  for (;;) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) {
      throw new Error(`the appliance exited with ${child.exitCode}:\n${log}`);
    }
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // Not listening yet.
    }
    if (Date.now() > until) throw new Error(`never became healthy:\n${log}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

/** Start `start.mjs` from INSIDE the payload, with no repository in sight. */
function launch(port: number): ChildProcess {
  const proc = spawn(process.execPath, ['start.mjs'], {
    cwd: payload,
    // A deliberately bare environment. `npm_*`, `NODE_PATH` and friends leak a
    // checkout's resolution into a child and would hide exactly the breakage
    // this test exists to catch.
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout?.on('data', (b) => (log += b));
  proc.stderr?.on('data', (b) => (log += b));
  return proc;
}

async function stop(proc: ChildProcess | undefined): Promise<number | null> {
  if (!proc || proc.exitCode !== null) return proc?.exitCode ?? null;
  const exited = new Promise<number | null>((r) => proc.once('exit', (code) => r(code)));
  proc.kill('SIGTERM');
  const timer = new Promise<null>((r) => setTimeout(() => r(null), 15_000));
  const code = await Promise.race([exited, timer]);
  if (code === null) proc.kill('SIGKILL');
  return code;
}

// One staged payload for the whole file: staging copies 24 MB of PGlite, and
// every assertion below is about the same artefact anyway.
beforeAll(() => {
  payload = mkdtempSync(join(tmpdir(), 'openmig-payload-'));
  stubUi = mkdtempSync(join(tmpdir(), 'openmig-stubui-'));
  writeFileSync(join(stubUi, 'index.html'), '<!doctype html><title>stub</title>');

  // stderr captured, not inherited: esbuild writes its size summary there, and
  // a failing execFileSync attaches what it captured to the thrown error anyway.
  execFileSync(process.execPath, [SCRIPT, '--out', payload, '--ui', stubUi], {
    cwd: REPO,
    stdio: ['ignore', 'ignore', 'pipe'],
  });

  mkdirSync(join(payload, 'data/config'), { recursive: true });
  writeFileSync(join(payload, 'data/config/mapping.json'), MAPPING_JSON);
}, 180_000);

afterAll(async () => {
  await stop(child);
  for (const dir of [payload, stubUi]) if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('the staged payload', () => {
  it('contains everything the appliance needs and nothing it has to fetch', () => {
    for (const path of [
      'appliance.mjs',
      'start.mjs',
      'package.json',
      'migrations/0001_baseline.sql',
      'ui/index.html',
      // Whole, not bundled — its WASM is loaded relative to its own location.
      'node_modules/@electric-sql/pglite/package.json',
    ]) {
      expect(existsSync(join(payload, path)), path).toBe(true);
    }
    // `type: module` has to be present or Node walks OUT of the payload looking
    // for a package.json and picks up whatever the installing machine has.
    expect(JSON.parse(readFileSync(join(payload, 'package.json'), 'utf-8'))).toEqual({
      type: 'module',
    });
  });

  it('ships the migration chain byte-identical to the container image', () => {
    // Same bytes means the squash-equivalence proof still covers the appliance.
    // A payload that shipped subtly different SQL would diverge silently.
    const staged = readFileSync(join(payload, 'migrations/0001_baseline.sql'));
    const source = readFileSync(join(REPO, 'packages/ledger/migrations/0001_baseline.sql'));
    expect(staged.equals(source)).toBe(true);
  });

  it('leaves PGlite external, because bundling breaks its WASM lookup', () => {
    const bundle = readFileSync(join(payload, 'appliance.mjs'), 'utf-8');
    expect(bundle).toMatch(/from\s*["']@electric-sql\/pglite["']/);
    // …and the contrib subpath too. esbuild's package externals cover subpaths;
    // if that ever changes, pgcrypto gets inlined and `gen_random_uuid()` stops
    // existing halfway through the baseline.
    expect(bundle).toMatch(/from\s*["']@electric-sql\/pglite\/contrib\/pgcrypto["']/);
  });

  it('defines a real `require`, or bundled CommonJS throws on evaluation', () => {
    // Without the banner: Error: Dynamic require of "events" is not supported,
    // from pg/lib/client.js, at import time — before any of our code runs.
    expect(readFileSync(join(payload, 'appliance.mjs'), 'utf-8')).toMatch(
      /createRequire[\s\S]{0,120}import\.meta\.url/,
    );
  });
});

describe('the staged payload, running', () => {
  it('boots from its own directory with no DATABASE_URL and no repository', async () => {
    child = launch(18_431);
    base = 'http://127.0.0.1:18431';
    await waitForHealth(`${base}/healthz`);

    // It migrated ITSELF, from the staged SQL, through the bundled seam.
    expect(log).toContain('applying 0001_baseline.sql');
    expect(log).toContain('persistence: pglite');
  }, 180_000);

  it('answers the operating surface (ADR-0026)', async () => {
    for (const path of ['/status', '/deletions', '/moves', '/failures']) {
      const res = await fetch(`${base}${path}`);
      expect(res.status, path).toBe(200);
      expect(res.headers.get('content-type'), path).toContain('application/json');
    }
    const root = await fetch(`${base}/`, { redirect: 'manual' });
    expect(root.status).toBe(302);
    expect(root.headers.get('location')).toBe('/ui/confirm');
  }, 30_000);

  it('serves the staged UI, so /ui is not a build instruction', async () => {
    const res = await fetch(`${base}/ui/confirm`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<!doctype html>');
  }, 30_000);

  it('stops on SIGTERM, because a service manager signals rather than asks', async () => {
    // PGlite's data directory is being written to. Without a signal handler the
    // process is killed mid-write, and the thing lost is the database.
    const code = await stop(child);
    expect(code).toBe(0);
  }, 30_000);

  it('comes back up on the same data directory, and does not re-migrate', async () => {
    child = launch(18_432);
    log = '';
    await waitForHealth('http://127.0.0.1:18432/healthz');
    expect(log).toContain('schema up to date');
    expect(log).not.toContain('applying 0001_baseline.sql');

    const res = await fetch('http://127.0.0.1:18432/status');
    expect(((await res.json()) as { mappings: unknown[] }).mappings).toHaveLength(1);
  }, 180_000);
});

describe('an unwritable data directory fails as an unwritable data directory', () => {
  /**
   * The failure an INSTALLED payload hits and the one in `dist/appliance` never
   * does. `start.mjs` defaults its database and config to inside the payload,
   * which is right when you run it from a build directory and wrong the moment
   * an installer puts it under `C:\Program Files\` or `/opt` — a service
   * account cannot write there.
   *
   * Without a preflight that arrives as a permissions error from inside PGlite,
   * naming a path the operator never chose, on an end user's machine, at first
   * start. The bug is the same either way; what these pin is that the MESSAGE
   * says which directory and which variable to set (hard rule 9).
   *
   * NEITHER CASE USES `chmod`. A `chmod 0500` directory is writable by root, and
   * CI, containers and plenty of developer machines run as root — such a test
   * would skip, or pass vacuously exactly where it is most needed. Both cases
   * below fail for every user on every platform, Administrator included.
   */

  /** Run the payload to completion (or kill it), and return what it said. */
  async function runPayload(env: Record<string, string>, ms = 25_000) {
    const proc = spawn(process.execPath, ['start.mjs'], {
      cwd: payload,
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    proc.stdout?.on('data', (b) => (out += b));
    proc.stderr?.on('data', (b) => (out += b));
    const exited = new Promise<number | null>((r) => proc.once('exit', (c) => r(c)));
    const timer = new Promise<null>((r) => setTimeout(() => r(null), ms));
    const code = await Promise.race([exited, timer]);
    if (code === null) {
      // Still running: it booted when it should have refused. Kill it, and let
      // the assertions report that rather than hanging the suite.
      proc.kill('SIGKILL');
      await exited;
    }
    return { code, out };
  }

  it('cannot even create the directory: names it, and the variable to set', async () => {
    // `mkdir` beneath a regular FILE is ENOTDIR for everyone, everywhere.
    const dir = mkdtempSync(join(tmpdir(), 'openmig-notdir-'));
    const blocker = join(dir, 'not-a-directory');
    writeFileSync(blocker, 'a file, where a directory would have to be');
    const wanted = join(blocker, 'pglite');
    try {
      const { code, out } = await runPayload({ PORT: '18435', SELFHOST_PGLITE_DIR: wanted });

      expect(code).not.toBe(0);
      // OUR formatting, not Node's. Asserting the bare path would pass on the
      // underlying ENOTDIR message alone, which quotes the path too — so the
      // test would survive deleting the path from the message we control.
      expect(out).toContain(`cannot write its database directory:\n  ${wanted}`);
      expect(out).toContain('SELFHOST_PGLITE_DIR');
      expect(out).toContain('OUT of the install directory');
      expect(out).not.toContain('listening on');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('can create it but not WRITE in it: still refuses, and does not serve', async () => {
    // The Program Files case, which the one above does not reach: the directory
    // exists and is creatable, and the write is what fails. Arranged by making
    // the probe's own name a DIRECTORY, so `writeFileSync` gets EISDIR — again,
    // for every user on every platform.
    //
    // This is the case that makes the write probe load-bearing. Reduce the
    // preflight to a bare `mkdir` and this test boots the appliance instead of
    // refusing; downgrade the throw to a warning and it does the same.
    const dir = mkdtempSync(join(tmpdir(), 'openmig-eisdir-'));
    mkdirSync(join(dir, '.openmig-write-probe'));
    try {
      const { code, out } = await runPayload({ PORT: '18436', SELFHOST_PGLITE_DIR: dir });

      expect(code).not.toBe(0);
      expect(out).toContain(`cannot write its database directory:\n  ${dir}`);
      // The load-bearing half: it must not have started. A warning that let the
      // boot continue would leave the appliance serving from a directory it
      // cannot fully write, which is worse than refusing.
      expect(out).not.toContain('listening on');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

describe('the Postgres path survived bundling too', () => {
  /**
   * The payload supports both backends — an operator who already runs Postgres
   * points `DATABASE_URL` at it (hard rule 5), and the container image ships
   * this same payload with `SELFHOST_PERSISTENCE=postgres`. So `pg` is bundled,
   * and `pg` is the library whose CommonJS `require('events')` became esbuild's
   * throwing `__require` in the first place.
   *
   * There is no Postgres here to connect to, and that is fine: what has to be
   * proved is that the bundled driver LOADS and gets far enough to attempt a
   * connection. A module-level failure and a refused connection look nothing
   * alike, and only one of them means the bundle is broken.
   */
  it('loads the bundled pg driver and fails on the network, not on the module', async () => {
    const probe = join(payload, 'pg-probe.mjs');
    writeFileSync(
      probe,
      `import { start } from './appliance.mjs';\n` +
        `try {\n` +
        `  await start({ persistence: 'postgres',\n` +
        `    databaseUrl: 'postgresql://u:p@127.0.0.1:1/nope',\n` +
        `    configDir: ${JSON.stringify(join(payload, 'data/config'))},\n` +
        `    migrationsDir: ${JSON.stringify(join(payload, 'migrations'))},\n` +
        `    port: 0, host: '127.0.0.1' });\n` +
        `  console.log('UNEXPECTED_SUCCESS');\n` +
        `} catch (err) { console.log('ERR:' + (err && err.message)); }\n`,
    );

    let out: string;
    try {
      out = execFileSync(process.execPath, [probe], {
        cwd: payload,
        env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      out = String((err as { stdout?: string }).stdout ?? '') + String(err);
    }

    // A refused connection to 127.0.0.1:1 is the CORRECT outcome.
    expect(out).toMatch(/ECONNREFUSED|ECONNRESET|connect|timeout/i);
    // And the specific way bundling breaks this must not appear.
    expect(out).not.toMatch(/Dynamic require|Cannot find module|is not a function/i);
  }, 120_000);
});

describe('the payload says which build it is', () => {
  /**
   * Two copies of the appliance on one machine are indistinguishable by eye —
   * an installed one under `C:\Program Files\` and a test one in a download
   * folder — and until 2026-08-07 nothing in the startup log said which build
   * was running. `loaded 0 mapping(s)` is about DATA, not about code. That cost
   * an owner a confused half-hour re-testing a CSS fix against a payload copied
   * before the fix existed, and it will happen again the moment there is an
   * installed copy AND a test copy, which is every machine from here on.
   */
  it('stamps a version and commit into start.mjs', () => {
    const start = readFileSync(join(payload, 'start.mjs'), 'utf-8');
    // The placeholder must be SUBSTITUTED, not shipped.
    expect(start).not.toContain('__BUILD_IDENTITY__');
    expect(start).toMatch(/const BUILD = \{"version":"[^"]+","commit":"[^"]+"\}/);
  });

  it('prints it as the FIRST line, before anything can fail', async () => {
    // Ordering is the point. A build stamp printed after the database opens is
    // absent from exactly the logs where it is most needed — the ones where
    // startup failed and somebody is asking which build produced them.
    const { out } = await (async () => {
      const proc = spawn(process.execPath, ['start.mjs'], {
        cwd: payload,
        env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', PORT: '18437' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let text = '';
      proc.stdout?.on('data', (b) => (text += b));
      await new Promise<void>((r) => {
        const done = setTimeout(r, 20_000);
        const check = setInterval(() => {
          if (text.includes('listening on')) {
            clearTimeout(done);
            clearInterval(check);
            r();
          }
        }, 200);
      });
      proc.kill('SIGTERM');
      return { out: text };
    })();

    expect(out.split('\n')[0]).toMatch(/^\[appliance\] build \S+ \(\S+\)$/);
  }, 60_000);
});

describe('importing the script does not run it', () => {
  /**
   * This file imports `shaFor` and `verifySha256` from the packaging script.
   * Until 2026-08-06 the script called `main()` at module scope, so that import
   * STAGED A WHOLE PAYLOAD as a side effect — and in CI, where
   * `apps/web/dist-selfhost` is not built, it threw before a single test ran.
   *
   * It passed locally because a developer who has just built the UI cannot see
   * the difference. That is as close to the definition of "works on my machine"
   * as it gets, and it merged red because I ran only the linter before pushing.
   *
   * Asserted in a CHILD PROCESS rather than by importing here: this file has
   * already imported the module by the time any test runs, so an in-process
   * check would pass no matter what the script does at import time.
   */
  it('imports cleanly, staging nothing', async () => {
    const url = pathToFileURL(join(REPO, 'scripts', 'package-appliance.mjs')).href;
    const proc = spawn(
      process.execPath,
      ['--input-type=module', '-e', `await import(${JSON.stringify(url)}); console.log('OK')`],
      { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let out = '';
    proc.stdout?.on('data', (b) => (out += b));
    proc.stderr?.on('data', (b) => (out += b));
    const code = await new Promise<number | null>((r) => proc.once('exit', (c) => r(c)));

    expect(out).toContain('OK');
    expect(code).toBe(0);
    // The tell that `main()` ran: it announces itself before doing any work.
    expect(out, 'importing the module staged a payload').not.toContain('Staging the appliance');
  }, 60_000);
});

describe('the UI build is wired to actually compile Tailwind', () => {
  /**
   * The appliance shipped with UNCOMPILED CSS, in both editions, until
   * 2026-08-06 — found the first time anyone opened the UI in a browser rather
   * than asserting a status code against it.
   *
   * `src/index.css` carried Tailwind v3's `@tailwind base/components/utilities`
   * triple while Tailwind v4 was installed, with NO PostCSS config and NO Vite
   * plugin to process either. Vite copied the file through verbatim, the
   * browser ignored the at-rules, and every screen rendered with no utilities
   * at all — 3 KB of `:root { --background: … }` and nothing else.
   *
   * Nothing caught it because nothing looked. The packaging test asserted
   * `/ui/confirm` returns `<!doctype html>`; the e2e UI smoke asserts the
   * screens boot. Both are true of a completely unstyled page.
   *
   * These assert the WIRING rather than the output, because this suite stages
   * a stub UI on purpose. Three things had to be true and none of them were;
   * each is pinned here.
   *
   * The parenthetical that used to end that sentence — "a Vite build per unit
   * run would be minutes" — was measured on 2026-08-07 and is **8.6 seconds**,
   * `tsc` included. It was the only reason the SYMPTOM still had no test while
   * three named causes did, and the class of causes is open: Tailwind v4
   * detects its own content, so an upgrade that stops finding `src/**` emits a
   * valid, tiny, useless stylesheet with every assertion below still true.
   * `scripts/ui-build-output.unit.test.ts` now builds the real UI and looks at
   * what comes out.
   */
  const web = join(REPO, 'apps', 'web');

  it('uses the v4 entry, not the v3 directives that nothing processes', () => {
    const css = readFileSync(join(web, 'src', 'index.css'), 'utf-8');
    expect(css).toContain('@import "tailwindcss"');
    // Anchored to a real directive — start of line, ending in a semicolon.
    // A loose /@tailwind \w+/ also matches this file's own comment explaining
    // what was removed, which is how the first version of this test failed.
    expect(css, 'v3 directives are back; v4 does not understand them').not.toMatch(
      /^\s*@tailwind\s+(base|components|utilities)\s*;/m,
    );
  });

  it('runs Tailwind as a Vite plugin, or nothing processes the entry at all', () => {
    const config = readFileSync(join(web, 'vite.config.ts'), 'utf-8');
    expect(config).toContain('@tailwindcss/vite');
    expect(config, 'the plugin is imported but never added to plugins[]').toMatch(
      /plugins:\s*\[[^\]]*tailwindcss\(\)/,
    );
  });

  it('declares the plugin, so a clean install still builds styles', () => {
    const pkg = JSON.parse(readFileSync(join(web, 'package.json'), 'utf-8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect({ ...pkg.dependencies, ...pkg.devDependencies }).toHaveProperty(
      '@tailwindcss/vite',
    );
  });

  it('defines the design tokens in CSS, since the JS config never did', () => {
    // `border-border`, `bg-background` and friends are shadcn-style tokens the
    // components are written against. `tailwind.config.js` described a numeric
    // primary/success/warning palette that a search of every .tsx and .css in
    // the app finds ZERO uses of — so the config was not merely unprocessed, it
    // described a palette nobody wrote against. With the build fixed, an
    // undefined token now FAILS the build rather than being dropped silently,
    // which is how the missing ones were found.
    const css = readFileSync(join(web, 'src', 'index.css'), 'utf-8');
    expect(css).toContain('@theme');
    for (const token of ['--color-background', '--color-border', '--color-muted-foreground']) {
      expect(css, `${token} is not mapped, so its utilities will not resolve`).toContain(token);
    }
  });
});

describe('the shipped Windows payload carries its own Node', () => {
  /**
   * Owner decision, 2026-08-06: the payload ships a Node runtime.
   *
   * 0015's requirement is that an end user never touches a terminal, and an
   * installer that must also detect, prompt for or side-install Node is a
   * terminal-shaped problem wearing a dialog box. The owner uninstalled Node
   * from the target laptop to make the point, which is the right test of the
   * requirement.
   *
   * The DOWNLOAD is not exercised here — it is ~93 MB and CI should not pay for
   * it on every push. What is exercised is the half that can be wrong quietly:
   * checksum selection and mismatch handling. We would be shipping somebody
   * else's binary to customers, and an unverified download is a supply-chain
   * hole with a progress bar.
   */
  const SHASUMS = [
    'aa'.repeat(32) + '  node-v24.19.0-linux-x64.tar.gz',
    'bb'.repeat(32) + '  win-x64/node.exe',
    'cc'.repeat(32) + '  win-arm64/node.exe',
  ].join('\n');

  it('picks the checksum for the exact file, not one that merely looks similar', () => {
    expect(shaFor(SHASUMS, 'win-x64/node.exe')).toBe('bb'.repeat(32));
    expect(shaFor(SHASUMS, 'win-arm64/node.exe')).toBe('cc'.repeat(32));
  });

  it('returns null for a file the release does not list, rather than guessing', () => {
    // The caller turns this into a refusal. A helper that fell back to "no
    // checksum, then" would stage an unverified runtime and say nothing.
    expect(shaFor(SHASUMS, 'win-x64/node.pdb')).toBeNull();
    expect(shaFor('', 'win-x64/node.exe')).toBeNull();
  });

  it('THROWS on a checksum mismatch, and names both hashes', () => {
    const bytes = Buffer.from('not the runtime you were promised');
    let err: Error | undefined;
    try {
      verifySha256(bytes, 'dd'.repeat(32), 'v24.19.0 win-x64/node.exe');
    } catch (e) {
      err = e as Error;
    }
    expect(err).toBeDefined();
    expect(err!.message).toContain('Checksum mismatch');
    expect(err!.message).toContain('dd'.repeat(32));
    expect(err!.message).toContain(createHash('sha256').update(bytes).digest('hex'));
    // A mismatch is a stop. If this ever becomes a warning, the payload ships
    // whatever arrived over the wire.
    expect(err!.message).toContain('never a warning');
  });

  it('accepts bytes that match', () => {
    const bytes = Buffer.from('the real thing');
    const sha = createHash('sha256').update(bytes).digest('hex');
    expect(() => verifySha256(bytes, sha, 'test')).not.toThrow();
  });

  it('does NOT ship a runtime unless asked, so a dev build stays small', () => {
    // The default payload is built in beforeAll. 93 MB is the price of a
    // shipped Windows installer, not of `pnpm package:appliance` on Linux.
    expect(existsSync(join(payload, 'node.exe'))).toBe(false);
  });
});

describe('staging refuses to produce a broken payload', () => {
  it('fails loudly when the operating UI has not been built', () => {
    // Not a warning. A payload without the UI installs fine and then serves the
    // user a page telling them to run a build command on a checkout they do not
    // have — the error belongs at packaging time, on a machine that can fix it.
    const out = mkdtempSync(join(tmpdir(), 'openmig-payload-nogui-'));
    try {
      expect(() =>
        execFileSync(process.execPath, [SCRIPT, '--out', out, '--ui', join(out, 'nope')], {
          cwd: REPO,
          stdio: ['ignore', 'ignore', 'pipe'],
        }),
      ).toThrow(/operating UI is not built/);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 120_000);
});
