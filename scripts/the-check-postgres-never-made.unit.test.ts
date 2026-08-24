// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A CREDENTIAL CHECK THAT POSTGRES NEVER MADE.
 *
 * `docker exec ownpace-db psql -U zitadel` connects over the UNIX SOCKET, and
 * the official Postgres image's generated `pg_hba.conf` answers the socket and
 * 127.0.0.1 with `trust`. PGPASSWORD is not sent and not checked. The query
 * succeeds with ANY password — including the wrong one. Only a connection to
 * the container's real network address reaches the appended
 * `host all all all scram-sha-256` line, which is the line every other
 * container's connection matches.
 *
 * On 2026-08-24 both the bring-up's preflight and `zitadel-db-password.sh`
 * asked over the socket. They reported
 *
 *     the zitadel role accepts the password in .env — nothing to do
 *
 * three times across two runs, and then Zitadel presented that same password
 * from its own container and was refused — `failed SASL auth: FATAL: password
 * authentication failed for user "zitadel" (SQLSTATE 28P01)` — after the
 * bring-up had spent the full 300-second readiness timeout looking like a slow
 * boot. The vacuous pass also short-circuited the repair: `--sync` exits at the
 * check, so the one command that fixes it refused to run, on the grounds that
 * there was nothing to fix.
 *
 * That is hard rule 10 exactly — a status must belong to the thing that
 * happened — and the preflight was written to enforce it.
 *
 * `deploy/compose/managed.yml` has carried this knowledge in its own header
 * since 2026-07-25, about the `openmigrate` role: "a local-socket/127.0.0.1
 * psql check ... never actually check the password ... only a connection from
 * another container's real IP exercises the scram-sha-256 rule". Nobody carried
 * it thirty lines down the same file to `zitadel`. A comment cannot make anyone
 * read it; this can.
 *
 * THE LIMIT, written down rather than discovered later: this is a text scan
 * over one logical command. A check assembled through variables (`CMD="psql
 * -U…"; $CMD`) evades it, and it deliberately keys on PGPASSWORD — a psql that
 * merely does work, rather than answering a question ABOUT a password, may use
 * whatever channel reaches the server. `.yml` is out of scope: pgbouncer's
 * healthcheck asks over 127.0.0.1 and is right to, because pgbouncer applies
 * its own `auth_type = scram-sha-256` to every connection, loopback included.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE_DIR = join(REPO_ROOT, 'deploy/compose');

const script = (name: string) => readFileSync(join(COMPOSE_DIR, name), 'utf8');
const zitadelDbPassword = script('zitadel-db-password.sh');
const bootstrap = script('bootstrap-managed.sh');

function shellScripts(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === '.git') continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith('.sh')) out.push(full);
    }
  };
  walk(root);
  return out;
}

/**
 * One shell command per entry: continuations joined, so `docker exec -e
 * PGPASSWORD=… \` on one line and its `psql …` on the next are judged
 * together, which is how both of the broken checks were written.
 */
export function logicalCommands(source: string): string[] {
  return source
    .replace(/\\\n\s*/g, ' ')
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'));
}

/** A psql that is being asked to VERIFY a password: it carries one. */
export function verifiesAPassword(command: string): boolean {
  return /\bPGPASSWORD\b/.test(command) && /\bpsql\b/.test(command);
}

/**
 * Does the command reach the server over something Postgres actually
 * authenticates? Absent `-h`, psql uses the socket. A literal loopback host is
 * no better: the image trusts 127.0.0.1 too.
 */
export function asksOverAnAuthenticatedChannel(command: string): boolean {
  const host = /\s-h\s+["']?([^\s"']+)/.exec(command);
  if (!host) return false;
  return !/^(localhost|127\.|::1$|\[::1\])/.test(host[1]);
}

describe('every password check reaches Postgres the way the thing it speaks for does', () => {
  const offenders = shellScripts(join(REPO_ROOT, 'deploy'))
    .concat(shellScripts(join(REPO_ROOT, 'scripts')))
    .flatMap((file) =>
      logicalCommands(readFileSync(file, 'utf8'))
        .filter(verifiesAPassword)
        .filter((c) => !asksOverAnAuthenticatedChannel(c))
        .map((c) => `${relative(REPO_ROOT, file)}: ${c.trim()}`),
    );

  it('none of them asks over the socket or the loopback, where pg_hba says trust', () => {
    expect(
      offenders,
      'a psql carrying PGPASSWORD but no non-loopback -h. Postgres answers that\n' +
        'connection with `trust` and never looks at the password, so whatever this\n' +
        'reports, it did not establish it:\n  ' +
        offenders.join('\n  '),
    ).toEqual([]);
  });

  it('the scan is looking at something — otherwise it passes by finding nothing', () => {
    // A rule whose corpus has silently gone empty is indistinguishable from a
    // rule that holds. `scripts/tests-clean-up-after-themselves` learnt the
    // same lesson from the other direction.
    const checked = shellScripts(join(REPO_ROOT, 'deploy'))
      .flatMap((f) => logicalCommands(readFileSync(f, 'utf8')))
      .filter(verifiesAPassword);
    expect(checked.length).toBeGreaterThan(0);
  });
});

describe('the rule itself, on the two commands that were actually written', () => {
  const broken = `docker exec -e PGPASSWORD="$pass" ownpace-db psql -U "$user" -d "$db" -tAc 'SELECT 1'`;
  const fixed = `docker exec -e PGPASSWORD="$2" "$CONTAINER" psql -h "$DB_ADDR" -p "$DB_PORT" -U "$1" -d "$3" -tAc 'SELECT 1'`;

  it('refuses the one that shipped', () => {
    expect(verifiesAPassword(broken)).toBe(true);
    expect(asksOverAnAuthenticatedChannel(broken)).toBe(false);
  });

  it('accepts the one that replaced it', () => {
    expect(asksOverAnAuthenticatedChannel(fixed)).toBe(true);
  });

  it('refuses a loopback host, which is the tempting near-miss', () => {
    // `-h 127.0.0.1` looks like a TCP connection and is trusted by the very
    // same pg_hba line as the socket. This is the fix somebody reaches for
    // first, and it changes nothing.
    for (const host of ['localhost', '127.0.0.1', '::1']) {
      expect(
        asksOverAnAuthenticatedChannel(`PGPASSWORD=x psql -h ${host} -U zitadel -c 'SELECT 1'`),
        `${host} was accepted as an authenticated channel`,
      ).toBe(false);
    }
  });

  it('joins a continuation, because that is how both checks were laid out', () => {
    const two = 'docker exec -e PGPASSWORD="$p" ownpace-db \\\n    psql -U "$u" -tAc \'SELECT 1\'';
    expect(logicalCommands(two).filter(verifiesAPassword)).toHaveLength(1);
  });

  it('ignores a commented-out example', () => {
    expect(
      logicalCommands('#   PGPASSWORD=x psql -U zitadel -c "SELECT 1"').filter(verifiesAPassword),
    ).toEqual([]);
  });
});

/**
 * The real `first_routable_address` out of the real script, run against real
 * input. Text assertions cannot tell a filter that works from one that returns
 * the loopback it was supposed to drop — and returning the loopback is the
 * whole defect, one layer down.
 */
const addressFilter = (() => {
  const at = zitadelDbPassword.indexOf('first_routable_address() {');
  const end = zitadelDbPassword.indexOf('\n}\n', at);
  return at < 0 || end < 0 ? '' : zitadelDbPassword.slice(at, end + 3);
})();

function firstRoutableAddress(input: string): string {
  const r = spawnSync('bash', ['-c', `set -o pipefail\n${addressFilter}\nfirst_routable_address`], {
    input,
    encoding: 'utf8',
  });
  return (r.stdout ?? '').trim();
}

describe('zitadel-db-password.sh resolves a real address, and will not do without one', () => {
  it('the function this suite runs was actually found in the script', () => {
    // A slice that came back empty would make every case below pass by
    // running nothing at all.
    expect(addressFilter, 'first_routable_address is not in zitadel-db-password.sh').not.toBe('');
  });

  it("takes the container's address out of busybox `hostname -i`", () => {
    expect(firstRoutableAddress('172.23.0.9\n')).toBe('172.23.0.9');
  });

  it('takes the first of several, which is what a multi-network container prints', () => {
    expect(firstRoutableAddress('172.23.0.9 172.19.0.4\n')).toBe('172.23.0.9');
  });

  it('reads an /etc/hosts line, where the address is not the whole token stream', () => {
    expect(firstRoutableAddress('172.23.0.9\tb0f4c1d2e3a4\n')).toBe('172.23.0.9');
  });

  it('DISCARDS the loopback rather than preferring against it', () => {
    // The single most important case here. `-h 127.0.0.1` is answered by the
    // same pg_hba `trust` line as the socket, so an address filter that lets
    // one through leaves the check exactly as vacuous as before.
    expect(firstRoutableAddress('127.0.0.1\n')).toBe('');
    expect(firstRoutableAddress('::1\n')).toBe('');
    expect(firstRoutableAddress('127.0.0.1\tlocalhost\n127.0.1.1\tbox\n')).toBe('');
  });

  it('skips the loopback to reach a routable one behind it', () => {
    expect(firstRoutableAddress('127.0.0.1 172.23.0.9\n')).toBe('172.23.0.9');
  });

  it('answers nothing, not a hostname, when there is no address in the input', () => {
    // Anything non-empty here becomes psql's `-h`, and a wrong host is a
    // connection refused reported as a password problem.
    expect(firstRoutableAddress('b0f4c1d2e3a4\nlocalhost\n')).toBe('');
    expect(firstRoutableAddress('hostname: invalid option -- i\n')).toBe('');
    expect(firstRoutableAddress('')).toBe('');
  });

  it('asks the container more than one way, because one command is one dependency', () => {
    // busybox and GNU `hostname -i` print different things, and `getent` is
    // not in a musl image at all. /etc/hosts is always there.
    const fn = zitadelDbPassword.slice(
      zitadelDbPassword.indexOf('resolve_db_addr() {'),
      zitadelDbPassword.indexOf('ask_pg() {'),
    );
    expect(fn).toContain('hostname -i');
    expect(fn).toContain('/etc/hosts');
  });

  it('REFUSES when it cannot resolve one, rather than falling back to the socket', () => {
    // An empty `-h` is the socket, which is the bug. A fallback here would be
    // the detector reintroducing the thing it detects (hard rule 9).
    const fn = zitadelDbPassword.slice(
      zitadelDbPassword.indexOf('resolve_db_addr() {'),
      zitadelDbPassword.indexOf('ask_pg() {'),
    );
    expect(fn).toContain('cannot_tell');
    expect(fn).not.toMatch(/DB_ADDR="?\$\{DB_ADDR:-/);
  });

  it('sets a global instead of returning through $( ), where exit cannot reach', () => {
    // `exit 2` inside a command substitution leaves the subshell only. The
    // caller carries on with an empty DB_ADDR — and an empty -h is the socket.
    expect(zitadelDbPassword).toMatch(/^resolve_db_addr$/m);
    expect(zitadelDbPassword).not.toMatch(/DB_ADDR="\$\(resolve_db_addr\)"/);
  });
});

describe('what it says is what it did', () => {
  it('the passing message names the channel it asked over', () => {
    // hard rule 10. "the role accepts the password in .env" was true of a
    // question nobody had asked; the operator had no way to see which.
    const pass = zitadelDbPassword.slice(zitadelDbPassword.indexOf('if out="$(ask_pg'));
    expect(pass).toContain('${DB_ADDR}:${DB_PORT}');
    expect(pass).toContain('not the socket');
  });

  it('distinguishes "the role refuses it" from "I could not ask"', () => {
    // Exit 2 exists so the caller cannot collapse the two. Sending an operator
    // to ALTER ROLE for a Postgres that was still starting is a wrong answer
    // with consequences.
    expect(zitadelDbPassword).toMatch(/cannot_tell\(\) \{[^}]*exit 2/);
    expect(zitadelDbPassword).toMatch(/^# {3}2 {2}nothing was established/m);
  });

  it('proves the sync over the same channel it checked over', () => {
    // A proof the socket would have handed over for free proves nothing —
    // including for an ALTER ROLE that set a different password than intended.
    const sync = zitadelDbPassword.slice(zitadelDbPassword.indexOf('ALTER ROLE'));
    expect(sync).toMatch(/ask_pg "\$ZITADEL_USER" "\$ZITADEL_PASS" "\$ZITADEL_DB"/);
  });

  it('escapes the password into the ALTER, which has no parameter form', () => {
    // Not hypothetical-only: a quote in the value would otherwise set a
    // DIFFERENT password and report success — the same class again.
    expect(zitadelDbPassword).toContain("${ZITADEL_PASS//\\'/\\'\\'}");
  });
});

describe('the bring-up asks the question by calling the script, not by copying it', () => {
  it('bootstrap-managed.sh has no psql credential probe of its own left', () => {
    const copies = logicalCommands(bootstrap).filter(verifiesAPassword);
    expect(copies, `bootstrap still asks this itself:\n  ${copies.join('\n  ')}`).toEqual([]);
  });

  it('it runs zitadel-db-password.sh --check', () => {
    expect(bootstrap).toMatch(/zitadel-db-password\.sh" --check/);
  });

  it('it acts on the three exit codes rather than on pass/fail', () => {
    const fn = bootstrap.slice(
      bootstrap.indexOf('assert_zitadel_role_password() {'),
      bootstrap.indexOf('# The diagnosis half'),
    );
    expect(fn).toMatch(/rc=\$\?/);
    expect(fn, 'a refusal and an unaskable question are handled the same').toMatch(/case "\$rc" in/);
    expect(fn).toContain('NOT verified here');
    expect(fn).toContain('zitadel-db-password.sh --sync');
  });

  it('still treats a missing role as a first bring-up rather than a failure', () => {
    // Zitadel creates both the role and the database itself, with the admin
    // credentials. Refusing here would break every fresh install. The branch
    // moved into the script with the query; the behaviour has not.
    expect(zitadelDbPassword).toMatch(/\*"does not exist"\*\)/);
  });
});
