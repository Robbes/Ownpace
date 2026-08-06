// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Stage the self-host appliance as a relocatable payload (workplan 0015 T3).
 *
 *   node scripts/package-appliance.mjs [--out dist/appliance]
 *   pnpm package:appliance
 *
 * ## What this is for
 *
 * [ADR-0027](../docs/adr/0027-windows-packaging-shell.md) says the Windows
 * appliance ships as a Windows Service plus a Start-menu shortcut — no Electron,
 * no native shell. An installer for that needs exactly one thing from this
 * repository: **a directory it can copy to `C:\Program Files\...` verbatim.**
 * This produces that directory.
 *
 * Everything here is platform-independent — staging a payload is just file
 * copying — so it runs and is tested on CI's Linux runners. The MSI that wraps
 * it, the service registration and the shortcut are Windows-only and are not
 * this script's job.
 *
 * ## Layout, and why each piece is where it is
 *
 * ```
 *   <out>/
 *     appliance.mjs        the bundled server (~2.8 MB, one file)
 *     start.mjs            the entry point a service manager runs
 *     package.json         {"type":"module"} — makes .mjs siblings resolvable
 *     migrations/*.sql     the REAL migration chain, byte-identical
 *     ui/                  the built operating UI (ADR-0026)
 *     node_modules/
 *       @electric-sql/pglite/   deliberately NOT bundled — see below
 * ```
 *
 * ### PGlite must stay external
 *
 * PGlite is Postgres compiled to WASM. It locates `pglite.wasm` and
 * `pglite.data` (~26 MB together) with `new URL('...', import.meta.url)`.
 * Bundling rewrites `import.meta.url` to point at the bundle, so those lookups
 * would resolve next to `appliance.mjs` instead of inside the package and the
 * database would fail to boot — at runtime, on a user's machine, with a message
 * about a missing file. Copying the package whole is both simpler and the only
 * thing that works.
 *
 * ### The bundle needs a `require` shim
 *
 * `pg` is CommonJS. Bundling CJS into an ESM output leaves its `require()` calls
 * of Node built-ins as esbuild's `__require` helper, which throws *"Dynamic
 * require of \"events\" is not supported"* the moment the module is evaluated.
 * The banner defines a real `require` via `createRequire`, which that helper
 * prefers when present.
 *
 * `pg` is bundled rather than externalised on purpose: the payload supports the
 * server path too, so an operator who already runs Postgres can point
 * `DATABASE_URL` at it (hard rule 5 — self-host must keep working).
 *
 * ### Migrations are staged, not bundled
 *
 * They are `.sql` read at runtime, and `runMigrations()` finds them by walking
 * up from its own `import.meta.url` to `packages/ledger/migrations`. Bundling
 * collapses that layout, so the walk lands somewhere arbitrary. `start.mjs`
 * passes `migrationsDir` explicitly instead — resolved from its own location,
 * so the payload can be copied anywhere.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Resolve a package's directory through Node's own resolver rather than by
 * guessing a path under `node_modules/.pnpm`, whose layout is an implementation
 * detail and encodes peer-resolution hashes.
 *
 * `from` matters under pnpm: its `node_modules` is strict, so a package is only
 * resolvable from the workspace package that actually declares it.
 * `@electric-sql/pglite` is a dependency of `packages/ledger`, not of the root.
 */
function packageDir(name, from = REPO) {
  const req = createRequire(join(from, 'package.json'));
  // `<name>/package.json` is the direct route, but a package with an `exports`
  // map only offers the subpaths it lists and PGlite does not list that one. So
  // resolve the entry point and walk up to the manifest that owns it.
  try {
    return dirname(req.resolve(`${name}/package.json`));
  } catch {
    let dir = dirname(req.resolve(name));
    while (!existsSync(join(dir, 'package.json'))) {
      const up = dirname(dir);
      if (up === dir) throw new Error(`Cannot locate the package root of ${name}`);
      dir = up;
    }
    return dir;
  }
}

const esbuildBin = () => join(packageDir('esbuild'), 'bin', 'esbuild');

/**
 * The Node runtime the payload ships when asked to (workplan 0015 T3).
 *
 * **Why ship one at all.** 0015's requirement is that an end user never touches
 * a terminal. An installer that also has to detect, prompt for or side-install
 * Node is a terminal-shaped problem wearing a dialog box, and the owner settled
 * it on 2026-08-06: the payload carries its own runtime. `node.exe` for win-x64
 * is ~93 MB, so this is OPT-IN — a Linux dev build has a perfectly good Node
 * already and should not pay for a download it will never run.
 *
 * Pinned rather than floating. A packaging step that silently changes the
 * interpreter between builds makes "works on my machine" unfalsifiable, and the
 * runtime we ship is one we are then responsible for patching — that should be
 * a visible edit to this line, in a diff someone reviews.
 */
const NODE_RUNTIME_VERSION = 'v24.19.0';

/** Where a platform's single-file runtime lives on nodejs.org, and what it is called here. */
const NODE_RUNTIMES = {
  'win-x64': { remote: 'win-x64/node.exe', local: 'node.exe' },
  'win-arm64': { remote: 'win-arm64/node.exe', local: 'node.exe' },
};

/**
 * The published SHA-256 for one file out of a `SHASUMS256.txt`.
 *
 * Separated from the download so it can be tested without the network, because
 * this is the half that matters: we are shipping somebody else's binary to
 * customers, and an unverified download is a supply-chain hole with a progress
 * bar. Returns null when the file is not listed — which must fail the build
 * rather than fall back to "no checksum, then".
 */
export function shaFor(shasumsText, remotePath) {
  for (const line of shasumsText.split('\n')) {
    // Format: "<64 hex>  <path>", two spaces, path relative to the release root.
    const m = line.match(/^([0-9a-f]{64})\s+(.+?)\s*$/);
    if (m && m[2] === remotePath) return m[1];
  }
  return null;
}

/** Throw unless `bytes` hashes to `expected`. */
export function verifySha256(bytes, expected, what) {
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== expected) {
    throw new Error(
      `Checksum mismatch for ${what}.\n  expected ${expected}\n  actual   ${actual}\n\n` +
        'Refusing to stage it. This is a runtime we would be shipping to customers, ' +
        'so a mismatch is a stop, never a warning.',
    );
  }
}

/**
 * Download and verify a Node runtime, caching it between builds.
 *
 * The cache is keyed by version and platform, so bumping
 * `NODE_RUNTIME_VERSION` fetches afresh rather than reusing a stale binary
 * under the same name.
 */
async function stageNodeRuntime(out, platform) {
  const spec = NODE_RUNTIMES[platform];
  if (!spec) {
    throw new Error(
      `Unknown --with-node platform '${platform}'. Known: ${Object.keys(NODE_RUNTIMES).join(', ')}.`,
    );
  }
  const base = `https://nodejs.org/dist/${NODE_RUNTIME_VERSION}`;
  const cacheDir = join(REPO, 'node_modules', '.cache', 'openmig-node', NODE_RUNTIME_VERSION, platform);
  const cached = join(cacheDir, spec.local);

  if (!existsSync(cached)) {
    console.log(`  fetching Node ${NODE_RUNTIME_VERSION} for ${platform} …`);
    const shasums = await fetch(`${base}/SHASUMS256.txt`).then((r) => {
      if (!r.ok) throw new Error(`Could not fetch SHASUMS256.txt: HTTP ${r.status}`);
      return r.text();
    });
    const expected = shaFor(shasums, spec.remote);
    if (!expected) {
      throw new Error(
        `${spec.remote} is not listed in ${base}/SHASUMS256.txt, so it cannot be verified. ` +
          'Refusing to stage an unverified runtime.',
      );
    }
    const res = await fetch(`${base}/${spec.remote}`);
    if (!res.ok) throw new Error(`Could not fetch ${spec.remote}: HTTP ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    verifySha256(bytes, expected, `${NODE_RUNTIME_VERSION} ${spec.remote}`);
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(cached, bytes);
  }

  cpSync(cached, join(out, spec.local));
  return spec.local;
}

function parseArgs(argv) {
  let out = join(REPO, 'dist', 'appliance');
  // `--ui` exists so the packaging test does not have to run a Vite build to
  // check that a payload assembles and boots. Real invocations leave it alone.
  let ui = join(REPO, 'apps/web/dist-selfhost');
  // Opt-in, because it is a ~93 MB download and only a shipped Windows payload
  // needs it. See NODE_RUNTIMES.
  let withNode = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') out = resolve(argv[++i]);
    else if (argv[i] === '--ui') ui = resolve(argv[++i]);
    else if (argv[i] === '--with-node') withNode = argv[++i];
  }
  return { out, ui, withNode };
}

function dirSize(dir) {
  let bytes = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    bytes += entry.isDirectory() ? dirSize(p) : statSync(p).size;
  }
  return bytes;
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/**
 * The launcher. Written as a file rather than bundled because it is the one
 * piece an installer or a support engineer may legitimately want to read: it is
 * where the payload's paths and the service's environment meet.
 */
const START_MJS = `// Generated by scripts/package-appliance.mjs — do not edit in place.
//
// The appliance's entry point. A service manager runs THIS, not appliance.mjs,
// because the bundle cannot find its own migrations or UI: bundling collapses
// the package layout those are resolved from. Everything below is resolved
// relative to this file, so the payload directory can be copied anywhere.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { start } from './appliance.mjs';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Refuse to start against a directory we cannot write, and SAY WHICH.
 *
 * The defaults below put the database and config INSIDE the payload. That is
 * right when you run it out of \`dist/appliance\`, and wrong the moment an
 * installer copies the payload somewhere read-only — \`C:\\\\Program Files\\\\\` on
 * Windows, \`/opt\` or \`/usr/local\` on Linux — because a service account cannot
 * write there.
 *
 * Without this check that arrives as a permissions error from inside PGlite,
 * naming a path the operator never chose, on an end user's machine, at first
 * start. The failure is the same either way; what changes is whether the
 * message says what to do about it (hard rule 9: a failure must be reported as
 * itself, not as whatever it happens to break first).
 *
 * The probe is a real write, not a stat. On Windows an ACL that denies writes
 * is invisible to an existence check, and \`fs.access\` has its own well-known
 * gap between what it reports and what a subsequent write does.
 */
function ensureWritable(label, dir, envVar) {
  try {
    mkdirSync(dir, { recursive: true });
    const probe = join(dir, '.openmig-write-probe');
    writeFileSync(probe, '');
    rmSync(probe, { force: true });
  } catch (err) {
    throw new Error(
      \`The appliance cannot write its \${label} directory:\\n  \${dir}\\n\\n\` +
        \`Reason: \${err instanceof Error ? err.message : String(err)}\\n\\n\` +
        \`This usually means the payload was installed somewhere read-only and \` +
        \`\${envVar} was not set. Point it at a writable location the service \` +
        \`account owns — on Windows C:\\\\\\\\ProgramData\\\\\\\\OpenMigrate\\\\\\\\, on Linux \` +
        \`/var/lib/openmigrate — and keep it OUT of the install directory so an \` +
        \`upgrade or uninstall cannot take the migration ledger with it.\`,
      { cause: err },
    );
  }
}

const pgliteDataDir = process.env.SELFHOST_PGLITE_DIR ?? join(here, 'data', 'pglite');
const configDir = process.env.CONFIG_DIR ?? join(here, 'data', 'config');

// Checked before start(), so the message names the directory rather than
// arriving later as a failure in whatever touched it first.
if ((process.env.SELFHOST_PERSISTENCE ?? 'pglite') === 'pglite') {
  ensureWritable('database', pgliteDataDir, 'SELFHOST_PGLITE_DIR');
}
ensureWritable('config', configDir, 'CONFIG_DIR');

const handle = await start({
  // No DATABASE_URL, no server, no port to collide with, no initdb. Overridable
  // for an operator who already runs Postgres and would rather use it.
  persistence: process.env.SELFHOST_PERSISTENCE ?? 'pglite',
  pgliteDataDir,
  configDir,
  migrationsDir: process.env.SELFHOST_MIGRATIONS_DIR ?? join(here, 'migrations'),
  uiDir: process.env.SELFHOST_UI_DIR ?? join(here, 'ui'),
  host: process.env.HOST ?? '127.0.0.1',
  port: Number(process.env.PORT ?? 8080),
});

console.log(\`[appliance] listening on http://\${process.env.HOST ?? '127.0.0.1'}:\${handle.port}\`);

// A service manager stops a service by signalling it. Without this the process
// is killed mid-write, and PGlite's data directory is the thing being written.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    handle.stop().then(
      () => process.exit(0),
      (err) => {
        console.error('[appliance] shutdown failed', err);
        process.exit(1);
      },
    );
  });
}
`;

async function main() {
  const { out, ui, withNode } = parseArgs(process.argv.slice(2));
  console.log(`Staging the appliance into ${relative(REPO, out) || out}\n`);

  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  // 1. The server, as one file.
  console.log('  bundling apps/selfhost …');
  execFileSync(
    esbuildBin(),
    [
      join(REPO, 'apps/selfhost/src/index.ts'),
      '--bundle',
      '--platform=node',
      '--format=esm',
      '--target=node22',
      // See the header: WASM assets are found via import.meta.url.
      '--external:@electric-sql/pglite',
      "--banner:js=import{createRequire as __cr}from 'node:module';const require=__cr(import.meta.url);",
      `--outfile=${join(out, 'appliance.mjs')}`,
    ],
    { stdio: ['ignore', 'ignore', 'inherit'], cwd: REPO },
  );

  writeFileSync(join(out, 'start.mjs'), START_MJS);
  // Node decides .mjs vs .cjs by extension, but the nearest package.json still
  // has to exist — without one, Node walks up out of the payload and can pick up
  // whatever it finds on the installing machine.
  writeFileSync(join(out, 'package.json'), `${JSON.stringify({ type: 'module' }, null, 2)}\n`);

  // 2. PGlite, whole, because of its WASM assets.
  console.log('  copying @electric-sql/pglite …');
  const pglite = packageDir('@electric-sql/pglite', join(REPO, 'packages/ledger'));
  cpSync(pglite, join(out, 'node_modules/@electric-sql/pglite'), {
    recursive: true,
    dereference: true, // pnpm's store is symlinks; an installer copies files.
  });

  // 3. The migration chain, byte-identical to what a container gets. Same SQL
  //    means the squash-equivalence proof still covers the appliance.
  console.log('  copying migrations …');
  cpSync(join(REPO, 'packages/ledger/migrations'), join(out, 'migrations'), { recursive: true });

  // 4. The operating UI (ADR-0026). Built separately; absent is a hard error
  //    here because a payload without it would install and then serve a page
  //    telling the user to run a build command they have no checkout for.
  if (!existsSync(ui)) {
    throw new Error(
      `The operating UI is not built: ${relative(REPO, ui)} does not exist.\n` +
        'Run `pnpm --filter @openmig/web build:selfhost` first.',
    );
  }
  console.log('  copying the operating UI …');
  cpSync(ui, join(out, 'ui'), { recursive: true });

  let runtime = null;
  if (withNode) runtime = await stageNodeRuntime(out, withNode);

  const total = dirSize(out);
  console.log(`\nStaged ${mb(total)} in ${relative(REPO, out) || out}`);
  console.log(`  appliance.mjs  ${mb(statSync(join(out, 'appliance.mjs')).size)}`);
  console.log(`  pglite         ${mb(dirSize(join(out, 'node_modules/@electric-sql/pglite')))}`);
  console.log(`  ui             ${mb(dirSize(join(out, 'ui')))}`);
  if (runtime) console.log(`  ${runtime.padEnd(14)} ${mb(statSync(join(out, runtime)).size)}`);

  console.log(
    runtime
      ? `\nRun it with:  .\\${runtime} start.mjs   (nothing to install)`
      : '\nRun it with:  node start.mjs   (needs Node 22+; nothing else)\n' +
        'For a shipped Windows payload add --with-node win-x64, so the machine ' +
        'running it needs nothing at all.',
  );
}

await main();
