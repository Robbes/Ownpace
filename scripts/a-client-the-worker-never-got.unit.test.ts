// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A CLIENT THE API HAS AND THE WORKER DOES NOT.
 *
 * `GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_CLIENT_SECRET` let a deployment
 * configure its own Google application once, so nobody pastes a client secret
 * into a wizard and the connection stores neither (ADR-0041, owner decision
 * 2026-09-01 — option B). Two halves of the stack read them, and they are
 * supplied by two DIFFERENT mechanisms:
 *
 *   the API      `deploy/compose/managed.yml` names the variable on the
 *                service, or `docker compose` passes it nothing.
 *   the worker   `deploy/compose/set-task-env.sh` uploads it, because a
 *                Trigger.dev task container inherits nothing from compose.
 *
 * MISSING THE SECOND IS THE WORST OF THE POSSIBLE SPLITS, and it is the one a
 * reasonable person makes: the API would build the consent, Google would
 * approve it, the connection would test green — and every sync pass would then
 * fail to mint a token, hours later, in a task log. Everything visible works;
 * the invisible half does not.
 *
 * This repository has paid for that shape twice already. `TRIGGER_ENCRYPTION_KEY`
 * and `DEPLOY_IMAGE_PLATFORM` each cost a live afternoon, and
 * `set-task-env.sh`'s own header records three more variables that tasks read
 * and nobody uploaded — each with a working default, so SETTING them did
 * nothing, silently.
 *
 * ROOT-LEVEL, SO VITEST AND NODE BUILTINS ONLY. A test in `scripts/` cannot
 * import `@openmig/shared` (AGENTS.md). The BEHAVIOUR half lives beside its
 * code, in `packages/shared/src/google-deployment-client.unit.test.ts`: which
 * half wins, what a half-configured pair says, and the Dropbox row that must
 * never receive a Google client.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string): string => readFileSync(join(REPO_ROOT, rel), 'utf8');

const NAMES = ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET'] as const;

describe('both halves of the stack are given the client', () => {
  it.each(NAMES.map((n) => [n]))('managed.yml passes %s to the API', (name) => {
    const managed = read('deploy/compose/managed.yml');
    expect(
      managed,
      `the API service does not receive ${name} — compose passes nothing a service does not name`,
    ).toContain(`${name}: \${${name}`);
  });

  it.each(NAMES.map((n) => [n]))('set-task-env.sh uploads %s to the worker', (name) => {
    // TWO PLACES IN ONE FILE, and both are load-bearing: the shell must
    // forward the value into the `node -e` process, and the JS name list must
    // include it in the upload. Either alone is a variable that travels
    // halfway.
    const script = read('deploy/compose/set-task-env.sh');
    expect(script, `${name} is never forwarded into the upload process`).toContain(
      `${name}="\${${name}:-}"`,
    );
    expect(script, `${name} is forwarded but not in the uploaded list`).toContain(`"${name}"`);
  });

  it.each(NAMES.map((n) => [n]))('the example env documents %s', (name) => {
    expect(read('deploy/compose/managed.env.example')).toContain(`${name}=`);
  });

  it('and says beside the setting that the worker needs its own copy', () => {
    // The fact that saves the afternoon, at the moment somebody sets the
    // value — not in a runbook they will read afterwards.
    const example = read('deploy/compose/managed.env.example');
    const at = example.indexOf('GOOGLE_OAUTH_CLIENT_ID=');
    expect(at, 'the setting is not in the example env').toBeGreaterThan(-1);
    const around = example.slice(Math.max(0, at - 1500), at);
    expect(around, 'nothing near it mentions set-task-env.sh').toContain('set-task-env.sh');
  });
});

describe('the fallback is gated where it has to be', () => {
  it('the run path asks whether the connection is a Google one', () => {
    // `clientId`/`clientSecret` are shared key names: Dropbox and Box store
    // their own app pairs under them. An ungated fallback would hand Google's
    // application to a Dropbox row.
    const seam = read('packages/orchestration/src/build-deps-from-mapping.ts');
    expect(seam).toContain('withDeploymentGoogleClient(isGoogleGrantKind(kind)');
  });

  it('the PROBE applies the same fallback, or Test refuses what a pass accepts', () => {
    // "Test failed, create worked" is the same lie as its more famous twin,
    // and reads as a broken product rather than a missing field.
    const probe = read('packages/orchestration/src/probe-connection.ts');
    expect(probe).toContain('withDeploymentGoogleClient(isGoogleGrantKind(kind)');
  });

  it('the QUALIFICATION applies it too, or the badges go quiet', () => {
    // Without it a connection whose client lives in the deployment answers
    // "Unmeasured — the stored credentials carry no clientId/refreshToken
    // pair", which reads as a broken grant and is a missing exchange.
    const qualification = read('packages/orchestration/src/account-qualification.ts');
    expect(qualification).toContain('withDeploymentGoogleClient(');
  });

  it('the create door stops demanding what nobody has to type', () => {
    const create = read('apps/api/src/routes/migrations/index.ts');
    expect(create).toContain('googleCredentialKeysRequired()');
    // And the refresh token is never optional: it is the per-account half, and
    // no deployment-wide value can stand in for whose data this is.
    expect(create).toContain("(['refreshToken'] as const)");
  });

  it('Dropbox keeps its own demand, in its own words', () => {
    // The one branch that must NOT read the Google helper. Dropbox's App key
    // and App secret ride the same two field names and are not a Google
    // client.
    const create = read('apps/api/src/routes/migrations/index.ts');
    const dropbox = create.slice(
      create.indexOf("} else if (body.sourceType === 'dropbox') {"),
      create.indexOf("} else if (body.sourceType === 'box') {"),
    );
    expect(dropbox, 'the dropbox branch is gone — check this guard still reads it').not.toBe('');
    expect(dropbox, 'Dropbox is taking the Google credential rule').not.toContain(
      'googleCredentialKeysRequired',
    );
    expect(dropbox).toContain("'clientId', 'clientSecret', 'refreshToken'");
  });
});
