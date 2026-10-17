// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A SECOND FACTOR OFFERED, AND A LOCK AFTER TEN WRONG PASSWORDS (workplan 0135 T4).
 *
 * After T1 and T2, the accounts that can make an address the API trusts
 * without mail reaching it are the ones with `user.write` in the first
 * organisation: the first human, the machine user and every operator. A
 * tester's own password matters as well: whoever signs in as a tester acts as
 * that tester. Upstream's lockout policy locks nobody
 * (`DefaultInstance.LockoutPolicy.MaxPasswordAttempts: 0` in `cmd/defaults.yaml`
 * at v4.19.4), so the public sign-in page let anybody guess a password for as
 * long as they liked.
 *
 * The owner's answers, 2026-10-17: *"The lockout limit: I proposed 10 wrong
 * passwords."* and *"Two-factor sign-in: yes. Offer, but not requireding."*
 * So `setup-zitadel.sh`, on every run:
 *
 * - **Locks an account after 10 wrong passwords.** The instance's lockout
 *   policy, `PUT /admin/v1/policies/password/lockout` (the path `admin.proto`
 *   declares at v4.19.4) with `maxPasswordAttempts`, written only when it
 *   differs, because the update replaces both of its fields and Zitadel
 *   refuses one that changes nothing; `maxOtpAttempts` goes back as it was
 *   read. `GET /admin/v1/policies/lockout` writes the number as a string,
 *   since it is a uint64 there, and leaves out a nought. It is read back on
 *   the instance and on what the project's organisation resolves
 *   (`GET /management/v1/policies/lockout`), whose own policy would stand in
 *   front of the instance's. The number is one constant in the script, and
 *   `managed.yml` gives a fresh instance the same.
 * - **Offers a second factor and forces none.** The login policy people
 *   resolve has `forceMfa` and `forceMfaLocalOnly` both false, read back on
 *   every run, also where nothing was written, so a change in the console is
 *   said and refused rather than kept. The login block writes both false
 *   where it writes, and counts a forced factor as "not the described policy
 *   yet". The instance's second factors include TOTP (an authenticator app)
 *   and U2F (a security key), which a fresh v4.19.4 instance has
 *   (`instance.go`); a missing one is added
 *   (`POST /admin/v1/policies/login/second_factors`) and both are read back
 *   (`…/second_factors/_search`). `managed.yml` gives a fresh instance
 *   `forceMfa: false`.
 *
 * Run, not read, against a stand-in provider that answers as protojson does
 * and refuses what Zitadel refuses. Against the script before this change it
 * failed: nothing set a lockout, and the login policy copied `forceMfa` from
 * whatever the instance held.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const setup = readFileSync(join(REPO_ROOT, 'deploy/compose/setup-zitadel.sh'), 'utf8');

/** Shell source with comment-only lines removed: a rule must not be satisfied by its own explanation. */
const directives = (text: string) =>
  text
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');

/**
 * A function of the real script, lifted whole, so the text under test is the
 * text that ships. A one-line function ends on its own line.
 */
function fn(name: string): string {
  const at = setup.indexOf(`\n${name}() {`);
  if (at < 0) return '';
  const first = setup.slice(at + 1, setup.indexOf('\n', at + 1));
  if (first.trimEnd().endsWith('}')) return `${first}\n`;
  return setup.slice(at + 1, setup.indexOf('\n}\n', at) + 3);
}

/** A line of the script that sets a plain variable, lifted as it ships. */
function assignment(name: string): string {
  return new RegExp(`^${name}=.*$`, 'm').exec(directives(setup))?.[0] ?? '';
}

/** The owner's number, 2026-10-17. */
const WRONG_PASSWORDS = 10;

const zitadelEnv = (): Record<string, unknown> => {
  const compose = parseYaml(readFileSync(join(REPO_ROOT, 'deploy/compose/managed.yml'), 'utf8')) as {
    services: Record<string, { environment?: Record<string, unknown> }>;
  };
  return compose.services.zitadel?.environment ?? {};
};

const PREAMBLE = [
  'set -euo pipefail',
  'ISSUER=https://id.example.test',
  'ENV_FILE=/stack/.env',
  'say() { echo "[setup-zitadel] $*"; }',
  'die() { echo "[setup-zitadel] FATAL: $*" >&2; exit 1; }',
  'refuse() { echo "[setup-zitadel] FATAL: $1 $2 answered HTTP 400: $3" >&2; exit 1; }',
];

/** Run a program against a stand-in provider whose state is a JSON file. */
function against(state: unknown, body: string[]) {
  const home = mkdtempSync(join(tmpdir(), 'second-factor-'));
  try {
    const file = join(home, 'state.json');
    const writes = join(home, 'writes');
    writeFileSync(file, JSON.stringify(state));
    writeFileSync(writes, '');
    const program = [...PREAMBLE, `STATE="${file}"`, `WRITES="${writes}"`, ...body].join('\n');
    const r = spawnSync('bash', ['-c', program], { encoding: 'utf8' });
    return {
      code: r.status ?? -1,
      said: `${r.stdout ?? ''}${r.stderr ?? ''}`,
      writes: readFileSync(writes, 'utf8').trim().split('\n').filter(Boolean),
      after: JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>,
    };
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

// --------------------------------------------------------------- the lockout

interface Lockout {
  maxPasswordAttempts?: number;
  maxOtpAttempts?: number;
}

/**
 * Lock after the script's own number, against a provider holding `instance`
 * (and the project organisation's own policy, or null where it inherits).
 */
function lockout(instance: Lockout, organisation: Lockout | null = null, takes = true) {
  return against({ instance, organisation }, [
    `TAKES=${takes}`,
    'api() {',
    '  local s; s="$(cat "$STATE")"',
    '  case "$1 $2" in',
    // A uint64 is a string in protojson, and a nought is left out.
    '    "GET /admin/v1/policies/lockout") jq -c \'{policy: ((.instance | with_entries(select(.value != 0) | .value |= tostring)) + {isDefault: true})}\' <<<"$s" ;;',
    '    "GET /management/v1/policies/lockout")',
    '      jq -c \'(if .organisation == null then (.instance + {isDefault: true}) else .organisation end) as $p | {policy: ($p | with_entries(select(.value != 0 and .value != false) | .value |= (if type == "number" then tostring else . end)))}\' <<<"$s" ;;',
    '    "PUT /admin/v1/policies/password/lockout")',
    '      echo "$1 $2 $3" >> "$WRITES"',
    // The request's fields are uint32: numbers. Both are replaced; one left out is a nought.
    '      local next; next="$(jq -c \'{maxPasswordAttempts: (.maxPasswordAttempts // 0), maxOtpAttempts: (.maxOtpAttempts // 0)}\' <<<"$3")"',
    '      jq -e \'(.maxPasswordAttempts | type) == "number" and (.maxOtpAttempts | type) == "number"\' >/dev/null <<<"$next" || refuse "$1" "$2" "invalid UpdateLockoutPolicyRequest"',
    '      [ "$(jq -cS \'{maxPasswordAttempts: (.instance.maxPasswordAttempts // 0), maxOtpAttempts: (.instance.maxOtpAttempts // 0)}\' <<<"$s")" != "$(jq -cS . <<<"$next")" ] || refuse "$1" "$2" "Errors.IAM.LockoutPolicy.NotChanged"',
    '      [ "$TAKES" = true ] && jq -c --argjson n "$next" \'.instance = $n\' <<<"$s" > "$STATE"',
    '      echo \'{"details":{}}\' ;;',
    '    *) echo "unexpected call: $1 $2" >&2; exit 1 ;;',
    '  esac',
    '}',
    assignment('SIGN_IN_LOCKOUT_PASSWORDS'),
    fn('lockout_passwords'),
    fn('set_sign_in_lockout'),
    'set_sign_in_lockout "$SIGN_IN_LOCKOUT_PASSWORDS"',
  ]);
}

const LOCKOUT_PUT = 'PUT /admin/v1/policies/password/lockout ';

describe('the lockout: an account is locked after ten wrong passwords', () => {
  it('is the owner’s number, one constant in the script', () => {
    expect(assignment('SIGN_IN_LOCKOUT_PASSWORDS'), 'the script names no number of wrong passwords').toBe(
      `SIGN_IN_LOCKOUT_PASSWORDS=${WRONG_PASSWORDS}`,
    );
  });

  it('on upstream’s instance, which locks nobody: written once, the codes’ limit kept, and read back', () => {
    const { code, said, writes, after } = lockout({});
    expect(code, said).toBe(0);
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0]!.replace(LOCKOUT_PUT, ''))).toEqual({ maxPasswordAttempts: WRONG_PASSWORDS, maxOtpAttempts: 0 });
    expect(after.instance).toEqual({ maxPasswordAttempts: WRONG_PASSWORDS, maxOtpAttempts: 0 });
    expect(said).toContain(`${WRONG_PASSWORDS} wrong passwords`);
  });

  it('hands the codes’ limit back as it was read, since the update replaces both', () => {
    const { code, said, writes } = lockout({ maxPasswordAttempts: 3, maxOtpAttempts: 5 });
    expect(code, said).toBe(0);
    expect(JSON.parse(writes[0]!.replace(LOCKOUT_PUT, ''))).toEqual({ maxPasswordAttempts: WRONG_PASSWORDS, maxOtpAttempts: 5 });
  });

  it('writes nothing when it already reads ten, which Zitadel would refuse as NotChanged', () => {
    const { code, said, writes } = lockout({ maxPasswordAttempts: WRONG_PASSWORDS });
    expect(code, said).toBe(0);
    expect(writes).toEqual([]);
    expect(said).toContain(`${WRONG_PASSWORDS} wrong passwords`);
  });

  it('stops, naming it, when the write does not take', () => {
    const { code, said } = lockout({}, null, false);
    expect(code).not.toBe(0);
    expect(said).toContain('could not lock an account after');
    expect(said).toContain('/admin/v1/policies/lockout');
  });

  it('stops, naming it, when the organisation’s own lockout policy stands in front of the instance’s', () => {
    const { code, said } = lockout({}, { maxPasswordAttempts: 0, maxOtpAttempts: 0 });
    expect(code).not.toBe(0);
    expect(said).toContain('own lockout policy');
    expect(said).toContain('DELETE');
    expect(said).toContain('/management/v1/policies/lockout');
  });

  it('prints no token: its remedies say $PAT by name', () => {
    const { said } = lockout({}, null, false);
    expect(said).toContain('$PAT');
  });
});

// ------------------------------------------------------- the second factor

interface Login {
  forceMfa?: boolean;
  forceMfaLocalOnly?: boolean;
  secondFactors: string[];
  /** Whether adding a second factor takes effect. */
  takes?: boolean;
}

const OTP = 'SECOND_FACTOR_TYPE_OTP';
const U2F = 'SECOND_FACTOR_TYPE_U2F';
/** Upstream's fresh instance at v4.19.4: `instance.go` adds TOTP and U2F, `cmd/defaults.yaml` forces nothing. */
const UPSTREAM: Login = { secondFactors: [OTP, U2F] };

function offer(login: Login) {
  return against(login, [
    `TAKES=${login.takes === false ? 'false' : 'true'}`,
    'api() {',
    '  local s; s="$(cat "$STATE")"',
    '  case "$1 $2" in',
    // protojson leaves out a false.
    '    "GET /management/v1/policies/login") jq -c \'{policy: ({isDefault: true, forceMfa: (.forceMfa // false), forceMfaLocalOnly: (.forceMfaLocalOnly // false)} | with_entries(select(.value != false)))}\' <<<"$s" ;;',
    '    "POST /admin/v1/policies/login/second_factors/_search") jq -c \'if (.secondFactors | length) > 0 then {details: {totalResult: (.secondFactors | length | tostring)}, result: .secondFactors} else {details: {}} end\' <<<"$s" ;;',
    '    "POST /admin/v1/policies/login/second_factors")',
    '      echo "$1 $2 $3" >> "$WRITES"',
    '      local t; t="$(jq -r .type <<<"$3")"',
    '      jq -e --arg t "$t" \'.secondFactors | index($t) | not\' >/dev/null <<<"$s" || refuse "$1" "$2" "Errors.IAM.LoginPolicy.MFA.AlreadyExists"',
    '      [ "$TAKES" = true ] && jq -c --arg t "$t" \'.secondFactors += [$t]\' <<<"$s" > "$STATE"',
    '      echo \'{"details":{}}\' ;;',
    '    *) echo "unexpected call: $1 $2" >&2; exit 1 ;;',
    '  esac',
    '}',
    assignment('SECOND_FACTORS_OFFERED'),
    fn('second_factors_allowed'),
    fn('mfa_forced'),
    fn('offer_second_factor'),
    'offer_second_factor',
  ]);
}

describe('a second factor: offered, and forced on nobody', () => {
  it('offers an authenticator app and a security key, by the names admin.proto gives them', () => {
    expect(assignment('SECOND_FACTORS_OFFERED')).toBe(`SECOND_FACTORS_OFFERED=(${OTP} ${U2F})`);
  });

  it('on upstream’s instance: nothing to write, and it still reads both back and says so', () => {
    const { code, said, writes } = offer(UPSTREAM);
    expect(code, said).toBe(0);
    expect(writes).toEqual([]);
    expect(said).toContain('offered, not forced');
  });

  it('adds a second factor the instance no longer allows, and reads it back', () => {
    const { code, said, writes, after } = offer({ secondFactors: [OTP] });
    expect(code, said).toBe(0);
    expect(writes).toEqual([`POST /admin/v1/policies/login/second_factors {"type":"${U2F}"}`]);
    expect(after.secondFactors).toEqual([OTP, U2F]);
  });

  it('adds both to an instance that allows none', () => {
    const { code, said, writes } = offer({ secondFactors: [] });
    expect(code, said).toBe(0);
    expect(writes).toHaveLength(2);
  });

  it('stops, naming it, when an added factor does not take', () => {
    const { code, said } = offer({ secondFactors: [OTP], takes: false });
    expect(code).not.toBe(0);
    expect(said).toContain(U2F);
  });

  it.each([
    ['forceMfa', { forceMfa: true }],
    ['forceMfaLocalOnly', { forceMfaLocalOnly: true }],
  ])('refuses a login policy that forces one (%s), which the owner did not choose', (field, forced) => {
    const { code, said } = offer({ ...UPSTREAM, ...forced });
    expect(code).not.toBe(0);
    expect(said).toContain(field);
    expect(said).toContain('/management/v1/policies/login');
  });
});

// ---------------------------------------------------- the login policy itself

/** Whether the login block counts a policy as already right, run as it ships. */
function counted(policy: Record<string, unknown>): boolean {
  const program = [
    ...PREAMBLE,
    'WANT_EXTERNAL=false',
    fn('positive_password_life'),
    fn('policy_is_right'),
    'policy_is_right <<<"$POLICY"',
  ].join('\n');
  const r = spawnSync('bash', ['-c', program], { encoding: 'utf8', env: { ...process.env, POLICY: JSON.stringify({ policy }) } });
  return r.status === 0;
}

const RIGHT = { isDefault: true, allowRegister: true, allowUsernamePassword: true, passwordCheckLifetime: '864000s' };

describe('the login block counts a forced second factor as not the described policy', () => {
  it('a policy that forces nothing is right, as protojson writes it (a false left out)', () => {
    expect(counted(RIGHT)).toBe(true);
  });

  it.each([['forceMfa'], ['forceMfaLocalOnly']])('%s true is not right, so the block writes', (field) => {
    expect(counted({ ...RIGHT, [field]: true })).toBe(false);
  });

  it('writes both false, never the instance’s own value copied back', () => {
    const code = directives(setup);
    const body = code.slice(code.indexOf('POLICY="$(jq -c'), code.indexOf("}' <<<\"$INSTANCE\")\""));
    expect(body).toMatch(/^\s+forceMfa: false,$/m);
    expect(body).toMatch(/^\s+forceMfaLocalOnly: false,$/m);
    expect(body).not.toMatch(/forceMfa: \(\.forceMfa/);
  });

  it('decides "nothing to write" with both in view, or a forced factor would survive the run', () => {
    const same = /^\s*SAME="\$\(jq -r .*$/m.exec(directives(setup))?.[0] ?? '';
    expect(same).toContain('forceMfa');
    expect(same).toContain('forceMfaLocalOnly');
  });
});

// ----------------------------------------------------------------- the bring-up

describe('the bring-up', () => {
  it('offers the second factor after the login block, locks after the notice, and says both in its summary', () => {
    const code = directives(setup);
    const login = code.search(/^policy_is_right\(\) \{/m);
    const notice = code.search(/^set_sign_in_notice "\$SIGN_IN_SITE"$/m);
    const offered = code.search(/^offer_second_factor$/m);
    const locked = code.search(/^set_sign_in_lockout "\$SIGN_IN_LOCKOUT_PASSWORDS"$/m);
    expect(offered, 'nothing offers a second factor').toBeGreaterThan(login);
    expect(locked, 'nothing sets the lockout').toBeGreaterThan(notice);
    const summary = code.slice(code.lastIndexOf('cat <<EOF'));
    expect(summary).toMatch(/second factor offered, not forced/);
    expect(summary).toMatch(/\$\{SIGN_IN_LOCKOUT_PASSWORDS\} wrong passwords/);
  });

  it('a fresh instance locks after the same number from its first start, and forces no second factor', () => {
    const env = zitadelEnv();
    expect(env.ZITADEL_DEFAULTINSTANCE_LOCKOUTPOLICY_MAXPASSWORDATTEMPTS).toBe(String(WRONG_PASSWORDS));
    expect(env.ZITADEL_DEFAULTINSTANCE_LOGINPOLICY_FORCEMFA).toBe('false');
  });
});
