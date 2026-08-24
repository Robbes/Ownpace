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
import { mkdtempSync, writeFileSync, readFileSync, rmSync, symlinkSync, lstatSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
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
