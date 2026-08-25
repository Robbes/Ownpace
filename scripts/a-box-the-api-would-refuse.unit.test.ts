// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A BOX THE API WOULD REFUSE (workplan 0102 T1).
 *
 * The sign-in page rendered the seed-token textarea whenever `oidcConfig()` was
 * falsy — which reads `VITE_OIDC_ISSUER`, a value baked into the bundle at
 * BUILD time.
 *
 * THE AUTHORITY IS SOMEWHERE ELSE. `selectAuthMode(JWT_ISSUER, JWT_SECRET)`
 * runs in the API at REQUEST time, and the moment `JWT_ISSUER` is set it
 * returns `managed`, verifies against the provider's JWKS, and never falls back
 * to `JWT_SECRET` — deliberately, so a lingering secret cannot silently
 * downgrade verification. A seed token is signed with that secret. On such a
 * stack it is well-formed, unexpired, and unusable.
 *
 * The two agreed only because `setup-zitadel.sh` writes both. They were still
 * two values in two processes, and #562 is what that costs: the issuer was
 * configured on the stack and missing from the bundle, so the page offered the
 * box, took a token, signed somebody in, and bounced them straight back to the
 * sign-in screen with nothing written on it.
 *
 * THE BREAK-GLASS ARGUMENT FOR KEEPING IT IS FALSE, and worth pinning so
 * nobody re-derives it: "if the provider is down, at least there is a way in"
 * does not hold, because managed mode refuses the seed token whether the
 * provider is up or down. It is not a safety net. It looks like one, which is
 * worse.
 *
 * IT CANNOT GO UNCONDITIONALLY EITHER. A deployment that has not run the
 * identity setup has no issuer, runs in `local` mode, and the seed token
 * genuinely is the only way in.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string): string => readFileSync(join(REPO_ROOT, rel), 'utf8');

/** Source with comment-only lines removed — a rule must not forbid its own
 *  explanation, which this repo has now got wrong ten times. */
function code(rel: string): string {
  return read(rel)
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');
}

describe('the API says what it will accept', () => {
  const index = code('apps/api/src/index.ts');

  it('serves the answer somewhere a page with no credential can read it', () => {
    expect(index, 'nothing reports the auth mode, so the page has to guess').toMatch(
      /app\.get\('\/api\/auth\/mode'/,
    );
  });

  it('derives it from selectAuthMode rather than re-reading the environment', () => {
    // Two places deciding "is this managed" is the bug one layer up, moved
    // down. `selectAuthMode` already encodes the precedence and the reason
    // for it.
    const handler = index.slice(index.indexOf('const authMode ='), index.indexOf("app.get('/api/auth/mode'"));
    expect(handler, 'the auth-mode handler is gone or was renamed').not.toEqual('');
    expect(handler, 'the handler decides the mode itself instead of asking selectAuthMode').toMatch(
      /selectAuthMode\(/,
    );
  });

  it('answers the QUESTION, not just the inputs', () => {
    /**
     * A page handed only `mode` would have to re-derive "managed means no" —
     * the same rule in a second process, which is precisely the shape of the
     * defect this endpoint exists to remove.
     */
    expect(index, 'the endpoint reports a mode and leaves the rule to the caller').toMatch(
      /acceptsSeedToken/,
    );
  });

  it('is unauthenticated, because its reader has nothing to authenticate with', () => {
    const line = index.match(/app\.get\('\/api\/auth\/mode'[^\n]*/)?.[0] ?? '';
    expect(
      line,
      'the auth-mode endpoint sits behind authenticate, so the only people who\n' +
        'can find out how to sign in are the ones already signed in.',
    ).not.toMatch(/authenticate/);
  });
});

describe('and the page renders what the API will accept', () => {
  const login = code('apps/web/src/pages/Login.tsx');

  it('asks', () => {
    expect(login, 'the sign-in page never asks the API what it accepts').toMatch(/fetchAuthMode/);
  });

  it('gates the paste box on the answer, not on the bundle', () => {
    /**
     * ANCHORED ON THE RENDER SITE. The first version searched the whole file
     * for `authMode.acceptsSeedToken &&` and passed with the box's gate put
     * back to `!issuer` — because the NEGATIVE use a few lines up, the one that
     * names the misconfigured state, matched it. A rule satisfied by a
     * different use of the same name is not a rule about this one.
     *
     * The textarea lives inside `tokenForm`; what matters is the condition
     * standing between `tokenForm` and the page.
     */
    const render = login.slice(login.indexOf('return ('));
    const at = render.indexOf('{tokenForm}');
    expect(at, 'the sign-in page renders no token form at all').toBeGreaterThan(-1);
    expect(
      render.slice(Math.max(0, at - 600), at),
      'the paste box is not gated on acceptsSeedToken, so it is still rendered\n' +
        'from a build-time value the API may well disagree with.',
    ).toMatch(/(?<!!)authMode\.acceptsSeedToken\s*&&/);
  });

  it('does not re-derive the rule from the mode', () => {
    // `mode` is reported for an operator reading the answer, not for the flow.
    // A page that branched on it would put the precedence rule in two
    // processes again.
    expect(
      login,
      "the page branches on mode === 'managed'. That rule lives in\n" +
        'selectAuthMode; reading the mode here is how the two drift apart.',
    ).not.toMatch(/mode\s*===\s*'managed'/);
  });

  it('offers neither credential while the answer is outstanding', () => {
    // A box that appears and is then taken away has offered a way in that was
    // never there — the flicker this task is named for, from the other side.
    expect(login, 'nothing renders a pending state').toMatch(/login\.checking/);
  });

  it('does not fall back to the box when it could not ask', () => {
    /**
     * A FAILURE IS NOT A FALLBACK. On a managed stack the box is refused
     * anyway, so offering it after a failed check invents a way in rather than
     * providing one — and an API that cannot answer this cannot verify a token
     * either.
     */
    expect(login, 'nothing says the check itself failed').toMatch(/login\.modeUnavailable/);
    const failure = login.slice(login.indexOf('modeError !== null'));
    expect(
      failure.slice(0, 400),
      'the could-not-ask branch renders the token form, which is a way in this\n' +
        'deployment may well refuse.',
    ).not.toMatch(/tokenForm/);
  });

  it('names the state where neither is available', () => {
    // Managed API, and a build that was never given the issuer's address
    // (#562). Neither credential is on offer; an empty screen under a heading
    // would say nothing at all.
    expect(login).toMatch(/login\.providerNotBuilt/);
  });
});
