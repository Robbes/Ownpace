// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE LOGIN PAGE NOBODY CHOSE.
 *
 * Zitadel v4 ships two login UIs and this stack never said which one it wanted.
 *
 * V1 is built into the server, at `/ui/login`. V2 is a SEPARATE application —
 * `ghcr.io/zitadel/zitadel-login`, a Next.js app that has to be deployed and
 * routed at `/ui/v2/login` — which `managed.yml` does not run and this project
 * has not adopted. A fresh v4 instance still comes up with
 * `loginV2.required = true` at instance scope, so the server sends every human
 * sign-in to a path where nothing is listening.
 *
 * WHAT A PERSON SEES IS NOT A LOGIN PAGE. "Sign in" reaches
 * `…/ui/v2/login/login?authRequest=V2_…` and the browser renders the
 * gRPC-gateway's not-found body: a JSON viewer showing `code: 5`,
 * `message: "Not Found"`. Nothing on that screen names the login UI, the
 * feature, or this stack — so the first guess is a routing fault at the reverse
 * proxy, and that is where the evening goes (Spark, 2026-08-25).
 *
 * AND THE GATE WAS GREEN FOR ALL OF IT. `smoke-managed.sh` signs in the way a
 * machine does — `/oauth/v2/authorize`, then `/v2/sessions` and CreateCallback
 * with a provisioning token, which is the mechanism the login UI itself uses —
 * and never loaded the page a person is sent to. The one thing that was broken
 * was the only path no assertion took.
 *
 * SO THE FIX IS TWO-SIDED, and this file pins both halves. The bring-up CHOOSES
 * the login version instead of inheriting whatever a new instance defaults to,
 * and the gate FETCHES the page a browser is sent to rather than the one a
 * machine can skip.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE = join(REPO_ROOT, 'deploy/compose');

/** Shell source with comment-only lines removed — a rule must not forbid its
 *  own explanation, the false positive this repo has now hit eight times. */
function directives(path: string): string {
  return readFileSync(join(COMPOSE, path), 'utf8')
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');
}

describe('the bring-up chooses which login page people get', () => {
  const setup = directives('setup-zitadel.sh');

  it('asks the instance which login version it requires', () => {
    expect(
      setup,
      'setup-zitadel.sh never reads the instance feature set, so it cannot know\n' +
        'which login UI a new instance decided to require.',
    ).toMatch(/\/v2\/features\/instance/);
  });

  it('pins login v2 OFF, because this stack deploys no login v2', () => {
    /**
     * ANCHORED ON THE CALL, not on the file. The first version of this rule
     * searched the whole script for `loginV2 … required … false` and passed
     * with the call flipped to `required:true` — because the refusal message
     * below quotes the correct body, so the string was there either way. A rule
     * that a script's own error text can satisfy is a rule about documentation.
     */
    const call = setup.match(/api PUT \/v2\/features\/instance[^\n]*/)?.[0] ?? '';
    expect(call, 'nothing writes the login version').not.toEqual('');
    expect(
      call,
      'setup-zitadel.sh does not turn off the login v2 requirement. A fresh v4\n' +
        'instance requires it, and nothing here serves that path.',
    ).toMatch(/"loginV2"\s*:\s*\{\s*"required"\s*:\s*false/);
  });

  it('reads the setting back rather than trusting the write', () => {
    /**
     * The answer to this PUT is a `details` block saying a sequence advanced.
     * It names no feature and does not say which way one moved, so "the call
     * did not error" is not "the setting took" — the same correction the
     * registration policy needed, for the same reason: the cost of believing
     * it is a stack where every sign-in ends on a 404, discovered by a person
     * and not by this gate.
     */
    const writeAt = setup.search(/PUT \/v2\/features\/instance/);
    expect(writeAt, 'nothing writes the login version').toBeGreaterThan(-1);
    expect(
      setup.slice(writeAt),
      'the login version is written and never read back.',
    ).toMatch(/login_v2_required/);
  });

  it('names the remedy when it cannot make the setting take', () => {
    const writeAt = setup.search(/PUT \/v2\/features\/instance/);
    const after = setup.slice(writeAt);
    const dieAt = after.search(/\bdie\b/);
    expect(dieAt, 'a login version that would not take is passed over in silence').toBeGreaterThan(-1);
    expect(
      after.slice(dieAt, dieAt + 700),
      'the refusal does not say how to set it by hand — the failure this repo\n' +
        'has fixed twice already: a refusal that names no remedy.',
    ).toMatch(/curl/);
  });
});

describe('and the gate loads the page a browser is sent to', () => {
  const smoke = directives('smoke-managed.sh');

  it('fetches the login page, not only the machine sign-in', () => {
    expect(
      smoke,
      'nothing in the gate loads the login page. Every sign-in here goes through\n' +
        '/v2/sessions with a provisioning token, which is green whether or not a\n' +
        'human could have got through.',
    ).toMatch(/login_loc=/);
  });

  it('fails when people are sent to a login v2 this stack does not serve', () => {
    expect(
      smoke,
      'the gate does not recognise the /ui/v2/login redirect, which is the exact\n' +
        'shape of the outage this assertion exists for.',
    ).toMatch(/ui\/v2\/login/);
  });

  it('carries one cookie jar across both requests', () => {
    /**
     * Zitadel binds an authorization request to the user-agent cookie set on
     * the authorize response and refuses to render a login page for any other
     * agent: `User Agent does not correspond (EVENT-adk13)`. Two curls without
     * a shared jar are two agents, so the assertion would go red for a reason
     * that has nothing to do with what it is checking — a false failure is as
     * corrosive as a false pass, and harder to argue with at 2am.
     */
    expect(smoke, 'the authorize call keeps no cookies').toMatch(/-c "\$login_jar"/);
    expect(
      smoke,
      'the login page is fetched without sending the cookies the authorize call\n' +
        'set, so it will answer EVENT-adk13 whatever the login version is.',
    ).toMatch(/-b "\$login_jar"/);
  });

  it('requires the page to render a form, not merely to answer', () => {
    // The failing screen answered too — with JSON. A status code alone would
    // have called it healthy.
    expect(smoke).toMatch(/<form/);
  });
});

describe('the humans\' client is pinned to the UI this stack serves', () => {
  const setup = directives('setup-zitadel.sh');

  it('sets a login version on the application, not only on the instance', () => {
    /**
     * "If unset, the login UI is chosen by the instance default" — the proto's
     * own words. Two settings, and BOTH are written on purpose: the instance
     * one so a client that expresses no preference lands on the UI this stack
     * serves, the application one so the humans' client does not depend on the
     * instance default staying where it was put.
     */
    expect(
      setup,
      "the 'Ownpace Web' application expresses no login version, so which UI a\n" +
        'human gets is whatever the instance happens to default to.',
    ).toMatch(/loginVersion:\{loginV1:\{\}\}/);
  });

  it('reconciles it on a stack that already exists', () => {
    // Idempotent means "converges on the described state", not "does nothing the
    // second time" (hard rule 1). Every stack provisioned before #566 has no
    // login version on its application; a script that only sets it at CREATE
    // fixes none of them.
    expect(
      setup,
      'the login version is set when the application is created and never\n' +
        'reconciled, so every stack that already exists keeps whatever it had.',
    ).toMatch(/CURRENT_LOGIN=/);
    const cmp = setup.match(/if \[ "\$CURRENT_DEV"[\s\S]{0,400}?then/)?.[0] ?? '';
    expect(cmp, 'the login version is written but not compared, so it is written every run').toMatch(
      /CURRENT_LOGIN/,
    );
  });
});

describe("and the gate signs in through a client of its own", () => {
  const smoke = directives('smoke-managed.sh');

  /**
   * /v2/sessions + CreateCallback finalises `V2_`-prefixed authorization
   * requests and no others — `LinkSessionToAuthRequest` loads a write model
   * keyed on `V2_<id>`, and a login v1 request's bare number is
   * `Errors.AuthRequest.NotExisting` to it. Which kind the authorize endpoint
   * creates is the CLIENT's property. So the humans' client, pinned to v1,
   * cannot be the one this gate signs in with.
   *
   * E2E (managed) #80 is the bill for leaving that implicit: the instance flag
   * went off and every sign-in here failed on a sentence about no authorization
   * request having been started, which was not what happened.
   */
  it('does not sign in through the humans\' client', () => {
    /**
     * SCOPED TO `sign_in_as`, not to the file. The login-page assertion above
     * authorizes as IDP_CLIENT_ID deliberately — checking the humans' path is
     * the entire point of it — so a rule that forbade that client anywhere
     * would forbid the other half of this same fix.
     */
    const fn = smoke.match(/^sign_in_as\(\) \{[\s\S]*?\n\}/m)?.[0] ?? '';
    expect(fn, 'sign_in_as is gone or was renamed').not.toEqual('');
    expect(fn, 'sign_in_as starts no authorization request').toMatch(/oauth\/v2\/authorize/);
    expect(
      fn,
      "sign_in_as authorizes as IDP_CLIENT_ID — the humans' client, which is\n" +
        'pinned to login v1 and therefore cannot be finalised by the session API.',
    ).not.toMatch(/client_id=\$\{IDP_CLIENT_ID\}/);
  });

  it('pins its own client to login v2, which is what the session API needs', () => {
    /**
     * ANCHORED ON THE PAYLOAD. The first version searched the whole script and
     * passed with the setting deleted from the call — because the failure
     * message a few lines up quotes the correct shape, so the string was there
     * either way. Second time in this one file: a rule a script's own error
     * text can satisfy is a rule about documentation.
     */
    const at = smoke.indexOf('apps/oidc');
    expect(at, 'the gate creates no client of its own').toBeGreaterThan(-1);
    expect(
      smoke.slice(at, at + 700),
      "the gate's own client expresses no login version, so it follows the\n" +
        'instance default — which this same change turns off. Its authorization\n' +
        'requests would then be v1, and the session API cannot finalise those.',
    ).toMatch(/loginVersion:\{loginV2:\{\}\}/);
  });

  it('takes the client back, and sweeps one a dead run left behind', () => {
    // The same residue discipline as the smoke's people: a leftover OIDC client
    // on a real deployment is a standing credential nobody is rotating.
    expect(smoke, 'the take-back does not delete the client it created').toMatch(
      /IDP_SIGNIN_APP/,
    );
    expect(smoke, 'nothing sweeps a client a dead run left behind').toMatch(
      /idp_sweep_leftover_clients/,
    );
  });

  it("never sweeps the humans' application", () => {
    // A sweep that matched by project rather than by name would delete
    // 'Ownpace Web' — the sign-in of the running stack — as residue.
    const sweep = smoke.match(/idp_sweep_leftover_clients\(\)[\s\S]*?\n\}/)?.[0] ?? '';
    expect(sweep, 'the client sweep is gone').not.toEqual('');
    expect(
      sweep,
      'the sweep deletes by something other than the name this gate gives its\n' +
        "own clients, so it can reach 'Ownpace Web'.",
    ).toMatch(/Ownpace\\ Smoke/);
  });
});

describe('and the premise is pinned, not assumed', () => {
  /**
   * "Login v2 off" is right ONLY while this stack serves no login v2. The day
   * somebody deploys `zitadel-login`, pinning it off silently keeps people on
   * the old UI — a setting that was correct becoming wrong without anything
   * saying so. So the premise gets a rule of its own: adding the container
   * fails HERE, next to the explanation of what to change.
   */
  it('this stack deploys no login v2 application', () => {
    const managed = readFileSync(join(COMPOSE, 'managed.yml'), 'utf8');
    expect(
      managed,
      'a login v2 application appears in managed.yml. If it is now served, then\n' +
        "setup-zitadel.sh's `{\"loginV2\":{\"required\":false}}` is no longer the\n" +
        'right choice — set `required:true` with the `baseUri` it is routed at,\n' +
        'and update the gate to expect /ui/v2/login rather than reject it.',
    ).not.toMatch(/zitadel-login/);
  });
});
