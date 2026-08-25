// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * ONE BOX, ONE STACK, ONE `.env` — AND A WRITE THAT DOES NOT QUIETLY FORK IT.
 *
 * The Spark runs a single managed stack (`managed.yml` pins
 * `name: ownpace-managed` and gives every service a fixed `container_name`,
 * both of which are global) and drives it from TWO checkouts: the operator's,
 * and the nightly gate's. The gate's checkout cannot keep a `.env` at all —
 * `actions/checkout` deletes ignored files before every run — so the workflow
 * restores one from `~/.persistent/ownpace-managed/`.
 *
 * That restore was a workaround for a checkout that cannot hold secrets. It
 * became a SECOND SOURCE OF TRUTH, and on 2026-08-24 the two copies disagreed:
 *
 *   - The `zitadel` Postgres role's password matched the GATE's copy, so a
 *     hand-run bring-up presented the operator's and got
 *     `password authentication failed for user "zitadel"` — after waiting the
 *     full 300-second readiness timeout, because a crash-looping container
 *     looks exactly like a slow one until the deadline passes.
 *   - `ZITADEL_PAT_EXPIRY` in one copy named a date the provisioning token in
 *     the database did not have, so the file's own account of the credential
 *     was a rotation out of date.
 *
 * The arrangement that fixes it is one canonical file with the operator's
 * checkout SYMLINKED to it. Which puts all the weight on `env-upsert.sh`,
 * because its write is write-temp-then-rename and `mv -f tmp link` REPLACES
 * THE LINK. One upsert — `TRIGGER_CLI_PROFILE`, a rotated PAT expiry, anything
 * — and the two files are separate again, with nothing said and no way to
 * notice until something authenticates.
 *
 * So this drives the real script against a real symlink, because that failure
 * lives in `mv`'s behaviour rather than anywhere it could be read out of the
 * source.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { copyFileSync, chmodSync, mkdirSync } from 'node:fs';
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  symlinkSync,
  lstatSync,
  readdirSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const UPSERT = join(REPO_ROOT, 'deploy/compose/env-upsert.sh');

let dir: string;
let canonical: string;
let link: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'one-env-'));
  // Two directories, as on the Spark: the persisted one holds the file, the
  // checkout only points at it.
  canonical = join(dir, 'persisted.env');
  link = join(dir, 'checkout.env');
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function upsert(file: string, ...pairs: string[]) {
  return spawnSync(UPSERT, [file, ...pairs], { encoding: 'utf8' });
}

describe('a symlinked .env survives being written through', () => {
  beforeEach(() => {
    writeFileSync(canonical, 'A=1\nB=2\n');
    symlinkSync(canonical, link);
  });

  it('is still a symlink afterwards', () => {
    expect(upsert(link, 'B=changed').status).toBe(0);
    expect(
      lstatSync(link).isSymbolicLink(),
      'the upsert replaced the link with a regular file — the two copies have forked',
    ).toBe(true);
  });

  it('the write lands in the CANONICAL file, which is the whole point', () => {
    upsert(link, 'B=changed', 'C=new');
    const written = readFileSync(canonical, 'utf8');
    expect(written).toContain('B=changed');
    expect(written).toContain('C=new');
    // Untouched keys stay, in place.
    expect(written).toContain('A=1');
  });

  it('reading through the link and reading the file give the same answer', () => {
    upsert(link, 'B=changed');
    expect(readFileSync(link, 'utf8')).toBe(readFileSync(canonical, 'utf8'));
  });

  it('leaves no temp file beside the link', () => {
    // mktemp puts its file beside whatever ENV_FILE names. Resolving first is
    // also what keeps the rename on one filesystem, and therefore atomic.
    upsert(link, 'B=changed');
    expect(readdirSync(dir).filter((f) => f.includes('upsert'))).toEqual([]);
  });

  it('survives repeated writes, which is how the drift actually happened', () => {
    // Not one upsert: a bring-up makes several, and it only takes one to fork.
    for (const pair of ['B=1', 'C=2', 'D=3', 'B=4']) upsert(link, pair);
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readFileSync(canonical, 'utf8')).toContain('B=4');
  });
});

describe('a link whose target does not exist yet', () => {
  it('CREATES the target file — that is a fresh machine, not a fault', () => {
    // The persisted `.env` does not exist before the first bring-up, and the
    // operator links to where it is going to live. Refusing here would make
    // the arrangement impossible to set up in the obvious order.
    const target = join(dir, 'not-yet.env');
    symlinkSync(target, link);

    expect(upsert(link, 'A=1').status).toBe(0);
    expect(readFileSync(target, 'utf8')).toContain('A=1');
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
  });

  it('refuses a link through a directory that does not exist, and names it', () => {
    // The distinction `readlink -f` itself draws: a missing final component is
    // tolerated (above), a missing directory on the way is not. Refusing here
    // is what stops the run dying later inside `mktemp` with a bare "No such
    // file or directory" naming a path nobody typed.
    const target = join(dir, 'no', 'such', 'dir', '.env');
    symlinkSync(target, link);
    const r = upsert(link, 'A=1');

    expect(r.status).toBe(1);
    expect(r.stderr).toContain('cannot be resolved');
    expect(r.stderr, 'a refusal that does not name the path it refused').toContain(target);
    expect(existsSync(target)).toBe(false);
  });
});

describe('a plain file is written exactly as before', () => {
  it('still upserts, so the symlink handling costs the ordinary case nothing', () => {
    writeFileSync(canonical, 'A=1\n');
    expect(upsert(canonical, 'A=2', 'B=3').status).toBe(0);

    const written = readFileSync(canonical, 'utf8');
    expect(written).toContain('A=2');
    expect(written).toContain('B=3');
    expect(lstatSync(canonical).isSymbolicLink()).toBe(false);
  });
});

/**
 * ONE WRITER, OR THE SYMLINK IS ONLY AS SAFE AS THE NEXT SCRIPT.
 *
 * `env-upsert.sh` resolves the link before writing, and the cases above prove
 * it. That buys nothing if something else writes `.env` another way — and
 * something did. `ensure-env-secrets.sh` used
 *
 *     sed -i "/^${name}=/d" "$ENV_FILE"
 *     echo "${name}=..." >>"$ENV_FILE"
 *
 * and GNU `sed -i` writes a temp file and renames it over its target. Without
 * `--follow-symlinks` the target is the LINK. Measured, not reasoned about:
 *
 *     $ ln -s real.env link.env          # real.env: A=1 B=2
 *     $ sed -i '/^A=/d' link.env
 *     link.env   NOW A REGULAR FILE, holding B=2
 *     real.env   UNTOUCHED, still A=1 B=2
 *
 * So the canonical file is left STALE while the checkout carries a fork
 * nobody can see — the 2026-08-24 divergence exactly, reintroduced by the
 * script that generates the credentials.
 *
 * It only ran when a key was absent, empty or a placeholder, so an established
 * `.env` never tripped it. The link would have survived every ordinary
 * bring-up and died on the first feature that added a new required secret,
 * which is the moment nobody would connect to a broken symlink.
 *
 * THE LIMIT: this reads shell source for two shapes — `sed -i` and `mv` aimed
 * at the env file. `>` and `>>` are NOT flagged: redirection opens through a
 * symlink and writes to the target, which is safe (`ensure-env-secrets.sh`'s
 * `touch` and bootstrap's `cp` of the example are fine for the same reason).
 * A write assembled through a variable evades it.
 */
describe('env-upsert.sh is the only thing that writes .env', () => {
  const COMPOSE = join(REPO_ROOT, 'deploy/compose');
  const scripts = readdirSync(COMPOSE)
    .filter((f) => f.endsWith('.sh') && f !== 'env-upsert.sh')
    .map((f) => join(COMPOSE, f));

  /**
   * Does this line name the LIVE `.env` — the one that may be a symlink?
   *
   * NOT `managed.env.example`: that is a tracked repo file, is never a link,
   * and `trigger-version.sh` rewrites its pinned tag with `sed -i` quite
   * correctly. A rule that flagged it would be crying wolf on the first run,
   * which is how guards get deleted. `/\.env` with a slash in front is what
   * separates them — `managed.env.example` has no `/` before its `.env`.
   */
  const namesTheLiveEnv = (line: string) => /\$\{?ENV_FILE\b|\/\.env(?![\w.])/.test(line);

  /** Source with comment lines dropped: prose about `sed -i` is not `sed -i`. */
  const code = (file: string) =>
    readFileSync(file, 'utf8')
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .join('\n');

  it('no script runs `sed -i` on the env file', () => {
    const offenders = scripts.flatMap((file) =>
      code(file)
        .split('\n')
        .filter((l) => /\bsed\b[^|]*-i\b/.test(l) && namesTheLiveEnv(l))
        .map((l) => `${basename(file)}: ${l.trim()}`),
    );
    expect(
      offenders,
      '`sed -i` replaces a symlinked .env with a regular file and leaves the\n' +
        'canonical copy stale. Use env-upsert.sh, which resolves the link:\n  ' +
        offenders.join('\n  '),
    ).toEqual([]);
  });

  it('no script renames a file over the env file', () => {
    // The same defect by the other route, and the one env-upsert.sh had to
    // solve for itself: `mv -f tmp link` REPLACES the link.
    const offenders = scripts.flatMap((file) =>
      code(file)
        .split('\n')
        .filter((l) => /\bmv\b/.test(l) && namesTheLiveEnv(l))
        .map((l) => `${basename(file)}: ${l.trim()}`),
    );
    expect(offenders).toEqual([]);
  });

  it('is looking at the scripts that exist, not at an empty list', () => {
    expect(scripts.length).toBeGreaterThan(5);
    expect(scripts.map((f) => basename(f))).toContain('ensure-env-secrets.sh');
  });

  it('the rule recognises the exact line that shipped', () => {
    const shipped = '  sed -i "/^${name}=/d" "$ENV_FILE"';
    expect(/\bsed\b[^|]*-i\b/.test(shipped) && namesTheLiveEnv(shipped)).toBe(true);
  });

  it('and leaves managed.env.example alone, which is a tracked file, not a link', () => {
    const legitimate =
      '  sed -i -E "s|^TRIGGER_IMAGE_TAG=v.*|TRIGGER_IMAGE_TAG=${want}|" "${SCRIPT_DIR}/managed.env.example"';
    expect(namesTheLiveEnv(legitimate)).toBe(false);
  });
});

describe('a symlink really does not survive sed -i, which is why the rule exists', () => {
  it('sed -i replaces the link and leaves the target stale', () => {
    // Run for real rather than asserted: this is a property of GNU sed, and a
    // comment claiming it would be the same kind of unchecked assertion that
    // caused the bug.
    writeFileSync(canonical, 'A=1\nB=2\n');
    symlinkSync(canonical, link);

    spawnSync('sed', ['-i', '/^A=/d', link], { encoding: 'utf8' });

    expect(lstatSync(link).isSymbolicLink(), 'sed -i left the link alone').toBe(false);
    expect(readFileSync(canonical, 'utf8'), 'the canonical file was written').toContain('A=1');
    expect(readFileSync(link, 'utf8')).not.toContain('A=1');
  });

  it('--follow-symlinks is the flag that would have made it safe', () => {
    // Named so the fix is discoverable — but env-upsert.sh is still the right
    // answer, because it is the one writer that is tested against a link.
    writeFileSync(canonical, 'A=1\nB=2\n');
    symlinkSync(canonical, link);

    spawnSync('sed', ['-i', '--follow-symlinks', '/^A=/d', link], { encoding: 'utf8' });

    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readFileSync(canonical, 'utf8')).not.toContain('A=1');
  });
});

/**
 * THE END-TO-END CASE: the real secret generator, against a real symlink.
 *
 * Everything above tests `env-upsert.sh`, and the rules further up refuse the
 * shapes that break a link. Neither proves the thing an operator cares about —
 * that running the script which GENERATES CREDENTIALS leaves the one canonical
 * file still canonical. `ensure-env-secrets.sh` is the script that would have
 * broken it, on the first feature to add a new required secret, so it is the
 * script that has to be driven at a link and watched.
 */
describe('ensure-env-secrets.sh, run for real, does not de-link the .env', () => {
  it('leaves the link a link, and writes the secrets to the canonical file', () => {
    const compose = join(REPO_ROOT, 'deploy/compose');
    const work = join(dir, 'checkout');
    mkdirSync(work, { recursive: true });
    for (const f of ['ensure-env-secrets.sh', 'env-upsert.sh']) {
      copyFileSync(join(compose, f), join(work, f));
      chmodSync(join(work, f), 0o755);
    }

    // The arrangement on the Spark: the canonical file lives elsewhere and the
    // checkout only points at it. Empty, so every secret has to be generated —
    // which is precisely the path that used to run `sed -i`.
    const persisted = join(dir, 'persisted-for-secrets.env');
    writeFileSync(persisted, '');
    symlinkSync(persisted, join(work, '.env'));

    const r = spawnSync('bash', [join(work, 'ensure-env-secrets.sh')], { encoding: 'utf8' });
    expect(r.status, `the script failed:\n${r.stderr}`).toBe(0);

    expect(
      lstatSync(join(work, '.env')).isSymbolicLink(),
      'generating secrets replaced the link with a regular file — the canonical\n' +
        'copy is now stale and nothing said so',
    ).toBe(true);

    const written = readFileSync(persisted, 'utf8');
    expect(written, 'the canonical file got none of the generated secrets').toMatch(
      /^ZITADEL_ADMIN_PASSWORD=.+$/m,
    );
    // Read back through the link too: one file, two names, same content.
    expect(readFileSync(join(work, '.env'), 'utf8')).toBe(written);
  });
});
