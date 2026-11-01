// Copyright 2026 The Ownpace authors (Apache-2.0)

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

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  readFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
 * What this payload IS, stamped in at staging time.
 *
 * Two copies of the appliance on one machine are indistinguishable by eye — an
 * installed one under `C:\Program Files\` and a test one in a download
 * folder — and nothing in the startup log said which build was running.
 * `loaded 0 mapping(s)` is about DATA, not about code. On 2026-08-07 that cost
 * an owner a confused half-hour re-testing a CSS fix against a payload copied
 * before the fix existed.
 *
 * Version plus commit, and deliberately NO timestamp: the same commit must
 * stage the same bytes, or "is this the build I think it is" becomes
 * unanswerable in the other direction. `unknown` when there is no git — the
 * payload has to build outside a checkout, and a missing commit is worth
 * printing rather than worth failing over.
 */
function buildIdentity() {
  const version = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf-8')).version ?? '0.0.0';
  let commit = 'unknown';
  try {
    commit = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
      cwd: REPO,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    // Not a checkout, or no git on PATH. Not a reason to refuse to build.
  }
  return { version, commit };
}

/**
 * The Node runtime the payload ships when asked to (workplan 0015 T3).
 *
 * **Why ship one at all.** 0015's requirement is that an end user never touches
 * a terminal. An installer that also has to detect, prompt for or side-install
 * Node is a terminal-shaped problem wearing a dialog box, and the owner settled
 * it on 2026-08-06: the payload carries its own runtime. `node.exe` for win-x64
 * is ~100 MB (100.1 MB at 26.13.0, 93.9 MB at 24.22.1), so this is OPT-IN — a Linux dev build has a perfectly good Node
 * already and should not pay for a download it will never run.
 *
 * Pinned rather than floating, and pinned in ONE place: the version is the one
 * the self-host image's `FROM node:<x.y.z>-<variant>@sha256:…` line names, in
 * `apps/selfhost/Dockerfile`. That image runs this same payload, so the e2e
 * gates test the same Node version the Windows zip ships (as the linux build,
 * not the win-x64 node.exe). It used to be a constant here, which nothing
 * moved — Dependabot cannot see a string in a .mjs file — so the images went
 * to 24.22.0 while node.exe sat on 24.19.0, and a security release would reach
 * the containers and never the zip every release tag attaches. A bump is still
 * a visible edit in a reviewed diff: Dependabot's image PR, which now moves
 * both. Since 2026-11-01 that pull request also has to move the runtime's
 * SHA-256 in NODE_RUNTIME_SHA256 below, which Dependabot cannot: a guard fails
 * it until somebody does (NODE_RUNTIME_SHA256 says how).
 *
 * Read only on the `--with-node` path. The image build stages a payload
 * without it, and the unit test imports this module, so neither the image
 * build nor that import depends on the Dockerfile's text. A FROM line without
 * an exact `x.y.z` is a refusal, not a guess: a floating tag would let the
 * runtime change between two builds of the same commit.
 */
export function nodeRuntimeVersion(dockerfileText) {
  const m = dockerfileText.match(/^FROM\s+node:(\d+\.\d+\.\d+)-/m);
  if (!m) {
    throw new Error(
      'apps/selfhost/Dockerfile has no `FROM node:<x.y.z>-…` line, so the Node version the ' +
        'Windows payload ships cannot be read from it. Refusing to guess one.',
    );
  }
  return `v${m[1]}`;
}

/** Where the self-host image, and so the payload's Node version, is defined. */
const SELFHOST_DOCKERFILE = join(REPO, 'apps/selfhost/Dockerfile');

/** Where a platform's single-file runtime lives on nodejs.org, and what it is called here. */
export const NODE_RUNTIMES = {
  'win-x64': { remote: 'win-x64/node.exe', local: 'node.exe' },
  'win-arm64': { remote: 'win-arm64/node.exe', local: 'node.exe' },
};

/** A platform's entry in NODE_RUNTIMES, or a refusal naming the ones there are. */
function nodeRuntimeSpec(platform) {
  if (!Object.hasOwn(NODE_RUNTIMES, platform)) {
    throw new Error(
      `Unknown --with-node platform '${platform}'. Known: ${Object.keys(NODE_RUNTIMES).join(', ')}.`,
    );
  }
  return NODE_RUNTIMES[platform];
}

/**
 * The SHA-256 a `SHASUMS256.txt` lists for one file.
 *
 * Not where the build's sum comes from since 2026-11-01: that is
 * NODE_RUNTIME_SHA256, committed below. This reads the release's own signed
 * list, committed in `scripts/node-release/`, once its signature has
 * verified, so the build can refuse when the two disagree. Returns null when the file is not listed, which fails the build
 * rather than falling back to "no checksum, then".
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
 * THE SHA-256 OF EVERY RUNTIME THE PAYLOAD MAY SHIP, COMMITTED HERE (workplan
 * 0119 §2.5, 2026-11-01). Until then the build fetched `node.exe` and the
 * `SHASUMS256.txt` it compared it with from the SAME `nodejs.org` release
 * directory, so whoever could change the one (the host, anything in front of
 * it, anything on the path) could change the other, and the check said yes.
 * Now the sum a download must have is in this file, moved only by a reviewed
 * pull request, and nothing the host serves is asked for but `node.exe`: one
 * whose SHA-256 is not this one stops the build, and so does a version with no
 * sum here, before anything is downloaded.
 *
 * AND THE SUM IS THE ONE NODE'S RELEASER SIGNED. The release's own
 * `SHASUMS256.txt` and its detached `SHASUMS256.txt.sig` are committed in
 * `scripts/node-release/`, beside the Node.js release keyring
 * (NODE_RELEASE_KEYS). Before it fetches anything the build checks, with
 * `gpgv` and that keyring only, that the list is good and signed, that it is
 * the list of the version the Dockerfile names, and that it lists exactly the
 * sum below for the file; `a-runtime-only-its-own-host-vouched-for` checks the
 * same on every pull request. So a wrong sum here fails CI, not only the next
 * build, and a sum read off a tampered list when Node moved cannot pass.
 *
 * One version only: the one `apps/selfhost/Dockerfile` names. The guard fails
 * when it has no sum here for a platform in NODE_RUNTIMES, or another version
 * sits beside it, so a Node move cannot ship an unchecked runtime.
 *
 * WHERE THE SUMS COME FROM, for whichever version is pinned: the release's
 * `SHASUMS256.txt`, whose signature gpgv verifies with the keyring; the
 * clear-signed copy of the same list in the release announcement,
 * `apps/site/pages/en/blog/release/<version>.md` in
 * github.com/nodejs/nodejs.org; and the SHA-256 of each `node.exe` downloaded
 * and hashed. They are of `node.exe`, not of the release's `.zip`. What each
 * read gave for the version pinned (its signer, the signature's time, the
 * sizes) is in the pull request that pinned it and in workplan 0119's Status,
 * not here, where it would outlive the next move.
 *
 * TO MOVE NODE (Dependabot's image pull request for apps/selfhost/Dockerfile,
 * or by hand), in that same pull request, from the repository root:
 *
 *   v=v26.14.0   # the version the Dockerfile's FROM line now names
 *   curl -fsSLo scripts/node-release/SHASUMS256.txt "https://nodejs.org/dist/$v/SHASUMS256.txt"
 *   curl -fsSLo scripts/node-release/SHASUMS256.txt.sig "https://nodejs.org/dist/$v/SHASUMS256.txt.sig"
 *   gpgv --status-fd 1 --keyring "$PWD/scripts/node-release/release-keys.kbx" \
 *     scripts/node-release/SHASUMS256.txt.sig scripts/node-release/SHASUMS256.txt
 *   grep -E ' win-(x64|arm64)/node\.exe$' scripts/node-release/SHASUMS256.txt
 *
 * and replace the entry below with `$v` and those two sums. gpgv's status
 * lines must hold `[GNUPG:] GOODSIG`; its `Good signature` text alone is not
 * enough, since gpgv prints it for a revoked key and an expired one too, and
 * `a-runtime-only-its-own-host-vouched-for` reads the status lines on the pull
 * request as verifyNodeReleaseSignature does. A key it does not have means
 * NODE_RELEASE_KEYS moves first. docs/windows-appliance-runbook.md says the
 * same for a maintainer.
 */
export const NODE_RUNTIME_SHA256 = {
  'v26.13.0': {
    'win-x64': '14319838b3f355e0398c13569a90270bce4fc68f25189f58c59b03dadae0e6d5',
    'win-arm64': '4c9baa047c4ae555050179f25a63153f1c962af32e2aad97735fb550750c5e7a',
  },
};

/**
 * The committed SHA-256 for one runtime, or a refusal that says what to do.
 * Throws for a version or platform with no sum, and for a sum that is not 64
 * lowercase hex: never "no sum, then trust the host".
 */
export function pinnedNodeSha256(version, platform, pins = NODE_RUNTIME_SHA256) {
  const forVersion = Object.hasOwn(pins, version) ? pins[version] : undefined;
  const sum = forVersion && Object.hasOwn(forVersion, platform) ? forVersion[platform] : undefined;
  if (typeof sum !== 'string' || !/^[0-9a-f]{64}$/.test(sum)) {
    throw new Error(
      `No SHA-256 is committed for Node ${version} ${platform} in scripts/package-appliance.mjs ` +
        `(NODE_RUNTIME_SHA256), so the runtime apps/selfhost/Dockerfile names cannot be checked ` +
        'against anything but the host that serves it. Refusing to stage it.\n' +
        `To move Node: put https://nodejs.org/dist/${version}/SHASUMS256.txt and its .sig in ` +
        'scripts/node-release/, check them with `gpgv --keyring "$PWD/scripts/node-release/release-keys.kbx" ' +
        'scripts/node-release/SHASUMS256.txt.sig scripts/node-release/SHASUMS256.txt`, and make its ' +
        `${Object.values(NODE_RUNTIMES).map((r) => r.remote).join(' and ')} sums the NODE_RUNTIME_SHA256 ` +
        'entry for that version, in place of the old one (the comment above NODE_RUNTIME_SHA256 has the commands).',
    );
  }
  return sum;
}

/** The release's signed list of the version pinned, committed: see NODE_RUNTIME_SHA256. */
export const NODE_RELEASE_DIR = join(REPO, 'scripts/node-release');

/**
 * THE NODE.JS RELEASE KEYS, PINNED HERE, NOT FETCHED (workplan 0119 §2.5,
 * 2026-11-01). `scripts/node-release/release-keys.kbx` is byte for byte
 * `gpg-only-active-keys/pubring.kbx` of github.com/nodejs/release-keys at
 * NODE_RELEASE_KEYS.commit (2026-09-01), the keyring of the releasers that
 * repository lists as active; its git blob id is NODE_RELEASE_KEYS.blob, which
 * anybody can compare with `git rev-parse <commit>:<path>` in a clone of that
 * repository, and the guard compares with the file. A release signed by a key
 * not in it (a new releaser) is refused: take the file at a newer commit of
 * that repository, and move the commit and the blob id below with it. Upstream
 * also retires keys and moves expiry dates in that file (twice in the ten days
 * before this pin), which no build here would notice: `scripts/idp-pin-watch.mjs`
 * compares the file at upstream's newest commit with the blob id below once a
 * week, and its summary issue names that commit when they differ.
 */
export const NODE_RELEASE_KEYS = {
  repo: 'https://github.com/nodejs/release-keys',
  commit: '481637f813e912c4aa3622d7964ab426c97b8e8d',
  path: 'gpg-only-active-keys/pubring.kbx',
  blob: 'bae91a9ce595d5775a2e2a998af04dee044c865d',
};
export const NODE_RELEASE_KEYRING = join(NODE_RELEASE_DIR, 'release-keys.kbx');

/**
 * Check a detached OpenPGP signature over a `SHASUMS256.txt` with `gpgv` and
 * the pinned keyring, and return the signer's primary key fingerprint.
 *
 * `gpgv` reads only the keyring it is given, under an empty GNUPGHOME, so no
 * key of the machine's own counts. Exactly one signature, good and valid, or
 * it throws: a missing `gpgv`, an unknown key, a bad or expired signature, a
 * revoked key, or a second signature each stop the build, each saying which.
 *
 * A KEY THAT HAS EXPIRED SINCE IT SIGNED is good (#1780's review): four of
 * the eight keys in the pinned keyring carry an expiry date, and once one has
 * passed, gpgv reports a list that key signed while it was valid as
 * `EXPKEYSIG`, with exit 0 and a VALIDSIG, never `GOODSIG`. Refusing that
 * would turn every pull request and the tag build red on that date with
 * nothing in the repository changed. So it passes when the signature was made
 * before every expiry gpgv names for it (`KEYEXPIRED`), which is OpenPGP's
 * rule, and is refused when it was made at or after one, or when either time
 * cannot be read.
 */
export function verifyNodeReleaseSignature(shasums, signature, { keyring = NODE_RELEASE_KEYRING, gpgv = 'gpgv' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'openmig-node-sig-'));
  try {
    const home = join(dir, 'gnupg');
    mkdirSync(home, { mode: 0o700 });
    writeFileSync(join(dir, 'SHASUMS256.txt'), shasums);
    writeFileSync(join(dir, 'SHASUMS256.txt.sig'), signature);
    const run = spawnSync(
      gpgv,
      ['--status-fd', '1', '--keyring', resolve(keyring), join(dir, 'SHASUMS256.txt.sig'), join(dir, 'SHASUMS256.txt')],
      { env: { ...process.env, GNUPGHOME: home, LC_ALL: 'C' }, encoding: 'utf-8' },
    );
    if (run.error) {
      throw new Error(
        `Could not run ${gpgv} to check SHASUMS256.txt's signature: ${run.error.message}. ` +
          'Install GnuPG (Debian and Ubuntu ship gpgv with apt); the check is not optional.',
      );
    }
    const status = run.stdout.split('\n').filter((l) => l.startsWith('[GNUPG:] '));
    const lines = (word) => status.filter((l) => l.split(' ')[1] === word);
    const count = (word) => lines(word).length;
    const valid = lines('VALIDSIG');
    const where = relative(REPO, resolve(keyring)) || keyring;
    const said = `(gpgv exit ${run.status}):\n${(run.stdout + run.stderr).trim()}`;
    // VALIDSIG <fingerprint> <date> <signature time> … <primary key fingerprint>
    const fields = valid.length === 1 ? valid[0].trim().split(' ') : [];
    const signer = fields[fields.length - 1];
    const one = run.status === 0 && count('NEWSIG') === 1 && valid.length === 1;
    if (one && count('GOODSIG') === 1) return signer;
    if (one && count('GOODSIG') === 0 && count('EXPKEYSIG') === 1 && count('REVKEYSIG') === 0 && count('EXPSIG') === 0) {
      const time = (text) => (/^\d+$/.test(text ?? '') ? Number(text) : NaN);
      const at = (t) => (Number.isFinite(t) ? new Date(t * 1000).toISOString() : 'an unreadable time');
      const made = time(fields[4]);
      const expired = lines('KEYEXPIRED').map((l) => time(l.trim().split(' ')[2]));
      if (Number.isFinite(made) && expired.length > 0 && expired.every((t) => Number.isFinite(t) && made < t)) return signer;
      throw new Error(
        `SHASUMS256.txt's signature was made ${at(made)} by ${signer}, whose key in ${where} expired ` +
          `${expired.map(at).join(' and ') || 'at a time gpgv did not name'}: not before its expiry ${said}\n\n` +
          'Refusing to trust its sums: a key signs nothing once it has expired. If nodejs/release-keys has ' +
          "since moved that key's expiry, move NODE_RELEASE_KEYS to that commit (the pin watch's summary " +
          'issue names it).',
      );
    }
    if (count('REVKEYSIG') > 0) {
      throw new Error(
        `SHASUMS256.txt is signed by a key ${where} holds as revoked ${said}\n\n` +
          'Refusing to trust its sums: a revoked releaser key vouches for nothing, whenever it signed. ' +
          "Pin a release signed by another releaser's key.",
      );
    }
    throw new Error(
      `SHASUMS256.txt's signature does not verify with ${where} ${said}\n\n` +
        'Refusing to trust its sums. NO_PUBKEY above is a key not in the pinned keyring, a new releaser: ' +
        'move NODE_RELEASE_KEYS to a newer nodejs/release-keys commit. BADSIG is a list or a .sig that is ' +
        'not what was signed. EXPSIG is a signature past its own expiry. Anything else is in the status lines above.',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * The committed, signed `SHASUMS256.txt` says what NODE_RUNTIME_SHA256 says,
 * for this version and platform: returns the signer's fingerprint, or throws.
 * The list must be of `version` (it names `node-<version>.tar.gz`), so a list
 * left behind by a Node move cannot vouch for the new version's sums.
 */
export function signedPinFor(
  version,
  platform,
  { pins = NODE_RUNTIME_SHA256, dir = NODE_RELEASE_DIR, keyring = NODE_RELEASE_KEYRING, verifySignature = verifyNodeReleaseSignature } = {},
) {
  const spec = nodeRuntimeSpec(platform);
  const pinned = pinnedNodeSha256(version, platform, pins);
  const list = readFileSync(join(dir, 'SHASUMS256.txt'));
  const signer = verifySignature(list, readFileSync(join(dir, 'SHASUMS256.txt.sig')), { keyring });
  const text = list.toString('utf-8');
  if (!shaFor(text, `node-${version}.tar.gz`)) {
    throw new Error(
      `scripts/node-release/SHASUMS256.txt is not the list of Node ${version} (it names no ` +
        `node-${version}.tar.gz), so it says nothing about the sums pinned for that version. ` +
        "Commit that release's SHASUMS256.txt and .sig there (NODE_RUNTIME_SHA256 says how).",
    );
  }
  const signed = shaFor(text, spec.remote);
  if (signed !== pinned) {
    throw new Error(
      `The signed SHASUMS256.txt of Node ${version} lists ${signed ?? 'nothing'} for ${spec.remote}, ` +
        `and scripts/package-appliance.mjs pins ${pinned}. Refusing to stage it: the committed sum is ` +
        'not the one the release was signed with.',
    );
  }
  return signer;
}

/**
 * Fetch one Node runtime and return its bytes, or throw. The sum it must have
 * is read from this file, and checked against the committed signed list,
 * before anything is fetched; the host is asked for `node.exe` alone, and its
 * bytes must hash to that sum. Nothing the host serves can change what passes.
 * The options are for the guard, which runs this against a stubbed host.
 */
export async function fetchVerifiedNodeRuntime(
  nodeVersion,
  platform,
  { fetchImpl = fetch, pins = NODE_RUNTIME_SHA256, dir = NODE_RELEASE_DIR, keyring = NODE_RELEASE_KEYRING, verifySignature = verifyNodeReleaseSignature } = {},
) {
  const spec = nodeRuntimeSpec(platform);
  const pinned = pinnedNodeSha256(nodeVersion, platform, pins);
  const signer = signedPinFor(nodeVersion, platform, { pins, dir, keyring, verifySignature });
  const url = `https://nodejs.org/dist/${nodeVersion}/${spec.remote}`;
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`Could not fetch ${url}: HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  verifySha256(bytes, pinned, `${nodeVersion} ${spec.remote}`);
  return { bytes, sha256: pinned, signer };
}

/**
 * Download and verify a Node runtime, caching it between builds.
 *
 * The cache is keyed by version and platform, so a bump of the self-host
 * image's Node fetches afresh rather than reusing a stale binary under the
 * same name. A cached copy is hashed again against the committed sum before it
 * is used, and one that differs is discarded and fetched afresh, verified.
 */
async function stageNodeRuntime(out, platform) {
  const spec = nodeRuntimeSpec(platform);
  const nodeVersion = nodeRuntimeVersion(readFileSync(SELFHOST_DOCKERFILE, 'utf-8'));
  const pinned = pinnedNodeSha256(nodeVersion, platform);
  const cacheDir = join(REPO, 'node_modules', '.cache', 'openmig-node', nodeVersion, platform);
  const cached = join(cacheDir, spec.local);

  const signer = signedPinFor(nodeVersion, platform);
  console.log(
    `  Node ${nodeVersion} ${spec.remote}: pinned sha256 ${pinned} (scripts/package-appliance.mjs), ` +
      `as the committed SHASUMS256.txt lists it, signed by ${signer} (scripts/node-release/release-keys.kbx).`,
  );
  if (existsSync(cached)) {
    const seen = createHash('sha256').update(readFileSync(cached)).digest('hex');
    if (seen === pinned) {
      console.log(`  Node ${nodeVersion} ${spec.remote} from the cache: sha256 ${seen}, as pinned.`);
    } else {
      console.log(`  discarding a cached ${spec.remote} whose sha256 ${seen} is not the pinned ${pinned} …`);
      rmSync(cached);
    }
  }
  if (!existsSync(cached)) {
    console.log(`  fetching Node ${nodeVersion} (apps/selfhost/Dockerfile) for ${platform} …`);
    const { bytes, sha256 } = await fetchVerifiedNodeRuntime(nodeVersion, platform);
    console.log(`  Node ${nodeVersion} ${spec.remote}: ${bytes.length} bytes, sha256 ${sha256}, as pinned.`);
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
  // Opt-in, because it is a ~100 MB download and only a shipped Windows payload
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
    const probe = join(dir, '.ownpace-write-probe');
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

// Stamped in by package-appliance.mjs. See buildIdentity() there for why this
// exists: two payload copies on one machine look identical, and until this line
// the startup log said nothing about WHICH build was running.
const BUILD = __BUILD_IDENTITY__;
console.log(\`[appliance] build \${BUILD.version} (\${BUILD.commit})\`);
// The /version endpoint reads these (buildIdentity in @openmig/core) — the
// stamp the packager burned in beats whatever package.json shipped.
process.env.OPENMIG_VERSION ??= BUILD.version;
process.env.OPENMIG_COMMIT ??= BUILD.commit;

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
  // A runtime with no committed sum, or one the committed signed list does not
  // vouch for, stops the build; say so before the bundle, not after it.
  if (withNode) signedPinFor(nodeRuntimeVersion(readFileSync(SELFHOST_DOCKERFILE, 'utf-8')), withNode);
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

  const build = buildIdentity();
  writeFileSync(
    join(out, 'start.mjs'),
    START_MJS.replace('__BUILD_IDENTITY__', JSON.stringify(build)),
  );
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

  // 5. The Windows operator scripts — install/uninstall the scheduled task, run
  //    it in the foreground, collect evidence.
  //
  //    These used to live only in the repository, and Phase 3 of the runbook
  //    therefore told a Windows operator to go and fetch four files from a
  //    source checkout. That contradicts the entire premise: the product
  //    promises a Windows machine needs nothing installed, and then the INSTALL
  //    step asks for git. An MSI would ship them, so the payload does too.
  //
  //    Copied for every platform, not just `--with-node win-*`. A payload is
  //    staged on Linux and RUN on Windows — that split is the whole point of
  //    Phase 1 — so keying this off the bundled runtime would omit them from
  //    exactly the builds that need them most.
  //
  //    `.ps1` and `.cmd` must land in the SAME directory: each `.cmd` is a
  //    wrapper that invokes its `.ps1` sibling with -ExecutionPolicy Bypass,
  //    because stock Windows policy is Restricted and refuses a `.ps1` outright.
  const scriptsSrc = join(REPO, 'scripts/windows');
  if (!existsSync(scriptsSrc)) {
    throw new Error(`Windows operator scripts are missing: ${relative(REPO, scriptsSrc)}`);
  }
  console.log('  copying the Windows operator scripts …');
  cpSync(scriptsSrc, join(out, 'scripts'), { recursive: true });

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

/**
 * Run only when INVOKED, never when imported.
 *
 * This file exports pure helpers (`shaFor`, `verifySha256`) that its unit test
 * imports. Without this guard that import STAGES A WHOLE PAYLOAD as a side
 * effect — and in CI, where `apps/web/dist-selfhost` has not been built, it
 * throws before a single test runs. It passed locally only because a developer
 * who has just built the UI cannot see the difference, which is as close to the
 * definition of "works on my machine" as it gets.
 *
 * `process.argv[1]` through `pathToFileURL` rather than a string compare: the
 * two spellings of the same path differ on Windows (`C:\...` versus
 * `file:///C:/...`) and after any symlink.
 */
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main();
}
