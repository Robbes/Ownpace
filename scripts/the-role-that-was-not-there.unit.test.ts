// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE ROLE THAT WAS NOT THERE LOOKED EXACTLY LIKE THE WRONG PASSWORD.
 *
 * `zitadel-db-password.sh`'s header promises exit 0 for a first bring-up: no
 * role, no database, Zitadel creates both itself on first start. The check that
 * delivers that promise asks over the network, because the socket answers with
 * `trust` and proves nothing (see
 * scripts/the-check-postgres-never-made.unit.test.ts, which fixed that layer).
 *
 * The network is also the layer that lies about the ROLE. Postgres answers a
 * NONEXISTENT role with the same `password authentication failed` (28P01) it
 * gives a wrong password — it will not disclose that a role is missing to a
 * connection that has not proven who it is. So the check's
 * `*"does not exist"*` branch, which the header relies on and which a text scan
 * is happy to find, is UNREACHABLE over the network: the text never contains
 * "does not exist". A first bring-up fell through to "refused", exit 1.
 *
 * On 2026-10-07 that is exactly what a fresh live stack produced. The bring-up
 * refused, told the operator to run `--sync`, and `--sync` ran
 * `ALTER ROLE "zitadel"` against a role that had never existed:
 *
 *     ERROR:  role "zitadel" does not exist
 *
 * The operator was sent to change a password for a role that was not there, on
 * a stack that was working its way through its own first start.
 *
 * THE FIX, AND WHY IT IS A SECOND QUESTION AND NOT A RETWEET OF THE FIRST.
 * The admin connection has already proven who it is, so Postgres answers it
 * truthfully: the role is there, or it is not. So after the network check
 * refuses, the script asks the admin `SELECT EXISTS (… pg_roles …)` over the
 * same authenticated channel. Absent → the first bring-up, exit 0, as promised.
 * Present → a real mismatch, exit 1, as before. Cannot tell → exit 2, because
 * hard rule 9 refuses naming a cause the check did not establish.
 *
 * RUN, not read. The whole defect is a `case` branch that reads correct and
 * never fires, so a text assertion is exactly the instrument that missed it.
 * These cases drive the real script against a `docker` stub that answers the
 * two questions the way Postgres does, and assert on the exit code and the
 * sentence.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  chmodSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE_DIR = join(REPO_ROOT, 'deploy/compose');
const SCRIPT = 'zitadel-db-password.sh';

const DB_ADDR = '172.31.0.7';
const ZITADEL_PW = 'zitadel-s3cret';
const ADMIN_PW = 'admin-s3cret';

/**
 * A `docker` that answers the two questions this script asks, the way Postgres
 * does, and records every call.
 *
 *   inspect                       → the container exists
 *   exec … sh -c 'hostname -i…'   → the container's own routable address
 *   exec … psql -U zitadel …      → the PASSWORD question: refuses, and says
 *                                   `password authentication failed` whether
 *                                   the role exists or not. This is the lie.
 *   exec … psql -U openmigrate …  → the ROLE question, over the admin
 *                                   connection: answers t/f truthfully.
 *
 * `rolePresent` is the whole test surface: flip it and the script must change
 * its answer.
 */
function dockerStub(rolePresent: string, adminProbeWorks: string): string {
  return `#!/usr/bin/env bash
# docker stub — answers the two questions zitadel-db-password.sh asks.
set -u
args=("$@")
case " $args " in
  *" inspect "*)
    exit 0 ;;
esac

if [ "\${args[0]}" != "exec" ]; then
  echo "docker stub: unexpected call: $*" >&2
  exit 97
fi

# docker exec <container> sh -c 'hostname -i …' — the address question.
if [[ " $* " == *" sh -c "* ]]; then
  echo "${DB_ADDR}"
  exit 0
fi

rest=("\${args[@]:1}")
psql=""
for ((i=0;i<\${#rest[@]};i++)); do
  [ "\${rest[$i]}" = "psql" ] && psql="\${rest[*]:i}"
done
[ -n "$psql" ] || { echo "docker stub: no psql in: $*" >&2; exit 96; }

if [[ "$psql" == *"-U zitadel"* ]]; then
  # The password question. Postgres does not say the role is missing.
  echo "psql: error: connection to server at \\"${DB_ADDR}\\", port 5432 failed: FATAL:  password authentication failed for user \\"zitadel\\"" >&2
  exit 2
fi

if [[ "$psql" == *"-U openmigrate"* ]]; then
  if [ "${adminProbeWorks}" != "1" ]; then
    echo "psql: error: connection to server at \\"${DB_ADDR}\\", port 5432 failed: FATAL:  password authentication failed for user \\"openmigrate\\"" >&2
    exit 2
  fi
  if [ "${rolePresent}" = "1" ]; then echo "t"; else echo "f"; fi
  exit 0
fi

echo "docker stub: unexpected psql: $psql" >&2
exit 95
`;
}

function fixture(rolePresent: string, adminProbeWorks: string) {
  const root = mkdtempSync(join(tmpdir(), 'zitadel-role-'));
  const compose = join(root, 'repo', 'deploy', 'compose');
  const bin = join(root, 'bin');
  mkdirSync(compose, { recursive: true });
  mkdirSync(bin, { recursive: true });
  for (const f of readFileSyncSafeList()) {
    copyFileSync(join(COMPOSE_DIR, f), join(compose, f));
    chmodSync(join(compose, f), 0o755);
  }
  writeFileSync(
    join(compose, '.env'),
    [
      'COMPOSE_PROJECT_NAME=ownpace-live',
      `ZITADEL_DB_PASSWORD=${ZITADEL_PW}`,
      `POSTGRES_USER=openmigrate`,
      `POSTGRES_PASSWORD=${ADMIN_PW}`,
      'ZITADEL_DB_NAME=zitadel',
      'ZITADEL_DB_USER=zitadel',
      '',
    ].join('\n'),
  );
  writeFileSync(join(bin, 'docker'), dockerStub(rolePresent, adminProbeWorks));
  chmodSync(join(bin, 'docker'), 0o755);
  return { root, compose };
}

function readFileSyncSafeList(): string[] {
  // The script sources env-read.sh; managed.yml carries the project name.
  return ['zitadel-db-password.sh', 'env-read.sh', 'managed.yml'];
}

function run(
  fx: { root: string; compose: string },
  args: string[],
): { status: number; out: string } {
  const r = spawnSync('bash', [join(fx.compose, SCRIPT), ...args], {
    cwd: fx.compose,
    env: {
      PATH: `${join(fx.root, 'bin')}:/usr/local/bin:/usr/bin:/bin`,
      HOME: fx.root,
      LANG: 'C.UTF-8',
    },
    encoding: 'utf8',
    timeout: 30_000,
  });
  return { status: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

describe('a role that is not there is a first bring-up, not a refused password', () => {
  it('the check passes a first bring-up, naming it as one', () => {
    const fx = fixture('0', '1');
    try {
      const r = run(fx, ['--check']);
      expect(r.status, `expected exit 0, got ${r.status}:\n${r.out}`).toBe(0);
      expect(r.out).toContain('first bring-up');
      expect(r.out, 'it still calls a missing role a mismatch').not.toContain('does NOT accept');
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  });

  it('the check refuses a role that IS there and does reject the password', () => {
    const fx = fixture('1', '1');
    try {
      const r = run(fx, ['--check']);
      expect(r.status).toBe(1);
      expect(r.out).toContain('does NOT accept');
      expect(r.out).toContain('--sync');
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  });

  it('--sync on a missing role does not ALTER it, and does not fail', () => {
    // The exact wall hit on 2026-10-07: the remedy for a first bring-up is to
    // start Zitadel, not to change a password for a role that has no name yet.
    const fx = fixture('0', '1');
    try {
      const r = run(fx, ['--sync']);
      expect(r.status, `--sync failed on a first bring-up:\n${r.out}`).toBe(0);
      expect(r.out).toContain('first bring-up');
      expect(r.out, '--sync ran an ALTER against a role that does not exist').not.toContain(
        'setting the zitadel role',
      );
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  });

  it('--sync on a real mismatch still sets the role', () => {
    const fx = fixture('1', '1');
    try {
      const r = run(fx, ['--sync']);
      expect(r.out).toContain('setting the zitadel role');
      // The proof the script makes after the ALTER is the network question
      // again, which the stub refuses — so the script must report that, not
      // claim success.
      expect(r.status).not.toBe(0);
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  });

  it('says NOTHING IS ESTABLISHED when the admin probe cannot answer', () => {
    // Hard rule 9: a role that refused plus an admin that cannot say whether
    // the role exists is not evidence of a first bring-up. Exit 2, not 0.
    const fx = fixture('0', '0');
    try {
      const r = run(fx, ['--check']);
      expect(r.status).toBe(2);
      expect(r.out).toContain('NOT ESTABLISHED');
      expect(r.out, 'it guessed a cause it did not establish').not.toContain('first bring-up');
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  });
});

describe('the fix keeps the questions it already asked honest', () => {
  const text = readFileSync(join(COMPOSE_DIR, SCRIPT), 'utf8');

  it('the admin probe goes over the network, never the socket', () => {
    // The socket answers with `trust` and proves nothing — the defect
    // scripts/the-check-postgres-never-made.unit.test.ts exists to stop. A
    // second question asked over the socket would reintroduce it one layer up.
    const fn = text.slice(text.indexOf('role_exists_over_admin() {'));
    expect(fn).toContain('-h "$DB_ADDR"');
    expect(fn).not.toMatch(/-h\s+(127\.|localhost|::1)/);
  });

  it('the admin probe asks pg_roles, not the role itself', () => {
    // The whole point: the answer comes from a connection that has proven
    // itself, so Postgres discloses existence.
    expect(text).toContain('FROM pg_roles WHERE rolname');
  });

  it('the first-run branch is reachable, not just present in the text', () => {
    // The guard that missed this bug asserted the `*"does not exist"*` branch
    // existed. It did, and it never fired. This asserts the branch that DOES
    // fire on a first bring-up, by running it above.
    expect(text).toContain('role_exists_over_admin');
    expect(text).toMatch(/no \$\{ZITADEL_USER\} role yet/);
  });
});
