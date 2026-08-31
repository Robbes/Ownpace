// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A password check that was valid for zero seconds, and the general rule that
 * would have stopped it.
 *
 * ## What happened
 *
 * `setup-zitadel.sh` turned self-registration on by writing the ORGANISATION's
 * login policy, with both verbs, because exactly one of them fits an org that
 * may or may not already have one:
 *
 *     api_try PUT  /management/v1/policies/login  {allowRegister, allowUsernamePassword, allowExternalIdp}
 *     api_try POST /management/v1/policies/login  (the same three)
 *
 * The POST is Zitadel's `AddCustomLoginPolicy`. It MINTS a custom org policy
 * out of the body it is handed — and a login policy has thirteen more fields
 * than those three. Every one arrived at its proto3 default, which for the five
 * `Duration` fields is zero. Read off the OTA instance, the custom org policy
 * beside the instance default it was shadowing:
 *
 *     password_check_lifetime          0    vs   864000000000000 ns
 *     external_login_check_lifetime    0    vs    43200000000000
 *     second_factor_check_lifetime     0    vs    64800000000000
 *     multi_factor_check_lifetime      0    vs    43200000000000
 *     mfa_init_skip_lifetime           0    vs  2592000000000000
 *
 * Zitadel checks the password, records the moment it did, and asks whether that
 * moment plus the lifetime is still in the future. For a lifetime of zero it
 * never is, so the next step it computes is the password step again:
 *
 *     POST /ui/login/password  ->  200, the same login page, no error at all
 *
 * Nobody could sign in. Every user, both browsers, correct passwords — while a
 * WRONG password still said so, because that path returns before the lifetime
 * is consulted. The stack was healthy from every angle anybody thought to ask
 * from: the API answered, the projections were current, and the policy read
 * back `allowRegister: true` exactly as the script had asked for it.
 *
 * ## The general rule, which is what this file is for
 *
 * These endpoints REPLACE. A body that names three fields does not mean "leave
 * the rest alone", it means "the rest are their defaults" — and for a duration
 * the default is the one value that can never be right. So a write to a policy
 * must be built from a read of that policy, never from a literal.
 *
 * The repository already knew this. Four hundred lines above, the domain policy
 * is written by echoing its own GET back with one field changed, and the
 * comment there says why: "PUT replaces the policy and omitting them would
 * reset them to false." The lesson was written next to one caller and not
 * applied to the other, which is the shape of #519 and #521 — so it is a test
 * now, over every policy write in the file rather than the one that bit.
 *
 * ## And the shadow, which broke the provider buttons in the other direction
 *
 * `configure_idp` adds an IdP to the INSTANCE policy, where it belongs. A
 * custom ORG policy shadows the instance one wholesale, its IdP list included —
 * so `allowExternalIdp: true` was being set on a policy carrying no providers,
 * and the button the script logs as "now offered on the sign-in screen" could
 * never appear on it. One organisation, one policy, and it is the instance's.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const SETUP_PATH = 'deploy/compose/setup-zitadel.sh';
const SETUP = readFileSync(join(REPO, SETUP_PATH), 'utf8');

/**
 * The jq PROGRAM of the first `jq` call inside `slice` — the single-quoted
 * argument, which is the only part of these lines worth testing.
 *
 * Extracted rather than copied, deliberately: a copy would keep passing after
 * the script's own expression was changed, which is the failure mode this file
 * exists to prevent. None of these programs contains a single quote; one that
 * did would fail here loudly rather than silently truncate.
 */
function jqProgram(slice: string): string {
  const at = slice.indexOf('jq ');
  expect(at, 'no jq call in this slice').toBeGreaterThan(-1);
  const open = slice.indexOf("'", at);
  const close = slice.indexOf("'", open + 1);
  expect(open, 'no quoted jq program').toBeGreaterThan(-1);
  expect(close, 'unterminated jq program').toBeGreaterThan(open);
  return slice.slice(open + 1, close);
}

/** Run jq with the script's own program. Returns stdout and the exit status. */
function jq(program: string, input: string, args: string[] = []) {
  const r = spawnSync('jq', [...args, program], { input, encoding: 'utf8' });
  expect(r.error, `jq did not run: ${String(r.error)}`).toBeUndefined();
  return { out: (r.stdout ?? '').trim(), code: r.status };
}

/** What Zitadel answers for a healthy instance default, field for field. */
const HEALTHY = JSON.stringify({
  policy: {
    details: { sequence: '3' },
    allowUsernamePassword: true,
    allowRegister: true,
    forceMfa: false,
    passwordlessType: 'PASSWORDLESS_TYPE_ALLOWED',
    isDefault: true,
    hidePasswordReset: false,
    ignoreUnknownUsernames: false,
    defaultRedirectUri: '',
    passwordCheckLifetime: '864000s',
    externalLoginCheckLifetime: '43200s',
    mfaInitSkipLifetime: '2592000s',
    secondFactorCheckLifetime: '64800s',
    multiFactorCheckLifetime: '43200s',
    secondFactors: ['SECOND_FACTOR_TYPE_OTP'],
    multiFactors: ['MULTI_FACTOR_TYPE_U2F_WITH_VERIFICATION'],
    idps: [],
    allowDomainDiscovery: false,
    disableLoginWithEmail: false,
    disableLoginWithPhone: false,
    forceMfaLocalOnly: false,
  },
});

describe('a policy write is built from a policy read, never from a literal', () => {
  /**
   * Every write to a policy ITSELF — not to a sub-resource under it, which is
   * an add rather than a replace. `POST /admin/v1/policies/login/idps` puts one
   * IdP on a list and is right to be a literal; `PUT /admin/v1/policies/login`
   * replaces the policy and can never be one.
   */
  const POLICY_WRITES = [...SETUP.matchAll(/\bapi(?:_try)?\s+(PUT|POST)\s+(\/\S*\/policies\/[a-z]+)(?=\s)/g)];

  it('finds the writes it is meant to be checking', () => {
    // A regex that matches nothing passes every assertion below it. This is
    // the vacuity guard: the file writes at least the domain policy and the
    // instance login policy, and if it stops doing either, that is a change
    // worth failing on rather than passing silently.
    const paths = POLICY_WRITES.map((m) => m[2]);
    expect(paths, 'no policy writes found — has the matcher gone stale?').toContain(
      '/admin/v1/policies/login',
    );
    expect(paths).toContain('/admin/v1/policies/domain');
  });

  it.each([
    ['/admin/v1/policies/login'],
    ['/admin/v1/policies/domain'],
  ])('%s is written from what it answered, not from nothing', (path) => {
    for (const m of POLICY_WRITES) {
      if (m[2] !== path) continue;
      // The body is whatever follows the path on that call. `jq -n` is jq's
      // "construct from null" flag — the literal-body form, and exactly the
      // shape that zeroed thirteen fields nobody named.
      const rest = SETUP.slice(m.index! + m[0].length, m.index! + m[0].length + 400);
      expect(
        rest,
        `${path} is written with a jq -n literal body.\n\n` +
          'These endpoints REPLACE. A body naming three fields does not leave\n' +
          'the rest alone, it sets them to their proto3 defaults — and for the\n' +
          'five Duration fields on a login policy that default is zero, which\n' +
          'is the one value a lifetime can never hold: a password check valid\n' +
          'for zero seconds is a check that is never valid, and sign-in becomes\n' +
          'a page that reloads itself with no error on it.\n\n' +
          'Read the policy, override the fields you mean, send the whole thing —\n' +
          'the way the domain policy above it already does.',
      ).not.toMatch(/jq\s+-[a-z]*n/);
    }
  });
});

describe('the organisation is given no login policy of its own', () => {
  it('never writes one — reset is the only verb allowed at the org endpoint', () => {
    const writes = [...SETUP.matchAll(/\bapi(?:_try)?\s+(\w+)\s+\/management\/v1\/policies\/login(?=\s)/g)];
    const verbs = writes.map((m) => m[1]);
    expect(
      verbs.filter((v) => v === 'PUT' || v === 'POST'),
      'setup-zitadel.sh writes the ORGANISATION login policy again.\n\n' +
        'A custom org policy shadows the instance policy wholesale — the five\n' +
        'sign-in lifetimes AND the list of providers `configure_idp` just put\n' +
        'buttons on. The POST that creates one from a three-field body is what\n' +
        'locked every user out of the OTA instance for six days.\n\n' +
        'This instance serves one organisation. Set these on the instance\n' +
        'policy (/admin/v1/policies/login), where the IdPs already go.',
    ).toEqual([]);
    // Vacuity: the reset must still be there, or the org keeps whatever an
    // older version of this script left on it and nothing above ever applies.
    expect(verbs, 'the org policy is never reset, so an existing one survives').toContain(
      'DELETE',
    );
  });

  it('decides on what the ORG resolves, not on what the instance holds', () => {
    // The instance policy being right proves nothing while something shadows
    // it — which is not hypothetical, it is what happened. Every read-back
    // therefore asks the management endpoint, which answers with the org's own
    // policy if it has one and the instance default if it has not.
    const block = SETUP.slice(SETUP.indexOf('allowing people to register'));
    for (const reader of [
      'read_allow_register',
      'read_allow_external',
      'read_inherits',
      'read_password_life',
    ]) {
      const at = block.indexOf(`${reader}() {`);
      expect(at, `${reader} is gone`).toBeGreaterThan(-1);
      expect(
        block.slice(at, block.indexOf('\n', at)),
        `${reader} no longer asks what a person signing in actually resolves`,
      ).toContain('api GET /management/v1/policies/login');
    }
  });

  it('refuses when the org still shadows the instance, and says how to remove it', () => {
    const block = SETUP.slice(SETUP.indexOf('allowing people to register'));
    expect(
      block,
      'nothing checks isDefault, so an org policy an older run left behind —\n' +
        'or one somebody made in the console — passes every other check here\n' +
        'and lets nobody in.',
    ).toContain('read_inherits');
    const at = block.indexOf('GOT_INHERITS="$(read_inherits)"');
    expect(at, 'the deciding read of isDefault is gone').toBeGreaterThan(-1);
    const refusal = block.slice(at, at + 1200);
    expect(refusal, 'failing it is not fatal').toContain('|| die');
    // A remedy somebody can act on at 23:00, which is this repo's standard for
    // a refusal: the exact call, not the name of a concept.
    expect(refusal).toContain('DELETE ${ISSUER}/management/v1/policies/login');
  });
});

describe('the lifetimes, which are the part that locked everybody out', () => {
  const BODY = jqProgram(SETUP.slice(SETUP.indexOf('POLICY="$(jq')));
  const ZEROED = jqProgram(SETUP.slice(SETUP.indexOf('ZEROED="$(jq')));
  const POSITIVE = jqProgram(SETUP.slice(SETUP.indexOf('positive_password_life() {')));

  it('sends every lifetime the instance answered with, unchanged', () => {
    // The whole fix, exercised rather than described: the script's own body
    // expression, run over a healthy instance policy. Drop any of the five
    // from the object and this goes red naming it.
    const { out } = jq(BODY, HEALTHY, ['-c', '--argjson', 'x', 'false']);
    const body = JSON.parse(out) as Record<string, unknown>;
    const instance = (JSON.parse(HEALTHY) as { policy: Record<string, unknown> }).policy;
    for (const key of [
      'passwordCheckLifetime',
      'externalLoginCheckLifetime',
      'mfaInitSkipLifetime',
      'secondFactorCheckLifetime',
      'multiFactorCheckLifetime',
    ]) {
      expect(
        body[key],
        `${key} is not in the body sent to the instance policy.\n\n` +
          'UpdateLoginPolicy replaces. A field left out of the body is a field\n' +
          'set to its proto3 default, and for a Duration that is zero — which\n' +
          'is a check that is never valid.',
      ).toBe(instance[key]);
    }
  });

  it('carries no copy of Zitadel’s default durations', () => {
    // The numbers are the provider's, not ours. A fallback here would be a
    // second copy of them in this repository, free to drift from the first and
    // impossible to notice drifting.
    expect(
      BODY,
      'the body substitutes a duration when the instance did not answer with\n' +
        'one. There is no right number to invent — refuse instead, which is\n' +
        'what the ZEROED check below the body is for.',
    ).not.toMatch(/Lifetime:\s*\([^)]*\/\/\s*"/);
  });

  it('overrides exactly the three settings it is there to set', () => {
    const { out } = jq(BODY, HEALTHY, ['-c', '--argjson', 'x', 'true']);
    const body = JSON.parse(out) as Record<string, unknown>;
    expect(body['allowRegister']).toBe(true);
    expect(body['allowUsernamePassword']).toBe(true);
    expect(body['allowExternalIdp']).toBe(true);
    // …and follows the argument in both directions, or a deployment that
    // removes its last provider never gets the button turned back off.
    const off = JSON.parse(jq(BODY, HEALTHY, ['-c', '--argjson', 'x', 'false']).out) as Record<
      string,
      unknown
    >;
    expect(off['allowExternalIdp']).toBe(false);
  });

  it('names a zero lifetime rather than sending it back', () => {
    // Echoing the instance is only safe while the instance is sane. If one of
    // its own lifetimes is nought, writing it back puts the bug on the policy
    // EVERY organisation inherits — one level up from where it was found.
    const broken = JSON.stringify({
      passwordCheckLifetime: '0s',
      externalLoginCheckLifetime: '43200s',
      mfaInitSkipLifetime: null,
      secondFactorCheckLifetime: '64800s',
      multiFactorCheckLifetime: '43200s',
    });
    expect(jq(ZEROED, broken, ['-r']).out).toBe(
      'passwordCheckLifetime, mfaInitSkipLifetime',
    );
  });

  it('says nothing about a healthy one', () => {
    // The other half, and the reason the test above is not vacuous: a check
    // that fires on everything is a check nobody can ship behind.
    const { out } = jq(BODY, HEALTHY, ['-c', '--argjson', 'x', 'false']);
    expect(jq(ZEROED, out, ['-r']).out).toBe('');
  });

  const ACCEPTS: ReadonlyArray<[string, number]> = [
    ['864000s', 0],
    ['0s', 1],
  ];
  it.each(ACCEPTS)('reads a lifetime of %s with exit status %i', (value, code) => {
    expect(jq(POSITIVE, JSON.stringify({ policy: { passwordCheckLifetime: value } }), ['-e']).code)
      .toBe(code);
  });

  const REJECTS: ReadonlyArray<[string, unknown]> = [
    ['omitted, which is how proto3 writes a zero', { policy: {} }],
    ['null', { policy: { passwordCheckLifetime: null } }],
    ['a shape jq cannot read', { policy: { passwordCheckLifetime: 'a fortnight' } }],
  ];
  it.each(REJECTS)('rejects a lifetime that is %s', (_what, input) => {
    // Absent and zero are the SAME answer on this wire — a Duration holding
    // its default is omitted from the response — so a reader that treats
    // absent as unknown cannot see the bug at all. And an unreadable value is
    // refused rather than guessed at: refusing writes, guessing locks people
    // out.
    expect(jq(POSITIVE, JSON.stringify(input), ['-e']).code).not.toBe(0);
  });
});

describe('"already right" includes the part that broke', () => {
  it('checks four facts, not the two the block is named for', () => {
    // A probe that asked only about registration and providers would look at
    // the locked-out instance, find allowRegister: true, print "already
    // allowed", and leave every person on the sign-in page — for as many runs
    // as anybody cared to make. Converging on the described state (hard rule 1)
    // means the description has to include the part that broke.
    const at = SETUP.indexOf('policy_is_right() {');
    expect(at, 'policy_is_right is gone').toBeGreaterThan(-1);
    const fn = SETUP.slice(at, SETUP.indexOf('\n}', at));
    for (const fact of ['isDefault', 'allowRegister', 'allowUsernamePassword', 'allowExternalIdp']) {
      expect(fn, `the probe no longer looks at ${fact}`).toContain(fact);
    }
    expect(
      fn,
      'the probe no longer checks that a password check lasts longer than no\n' +
        'time at all — so the exact state that locked everybody out reads as\n' +
        '"already allowed" and is left alone.',
    ).toContain('positive_password_life');
  });
});
