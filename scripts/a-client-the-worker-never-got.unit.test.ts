// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A CLIENT THE API HAS AND THE WORKER DOES NOT.
 *
 * `GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_CLIENT_SECRET` let a deployment
 * configure its own Google application once, so nobody pastes a client secret
 * into a wizard and the connection stores neither (ADR-0041, owner decision
 * 2026-09-01 — option B). Two halves of the stack read them, and each is
 * given them separately:
 *
 *   the API      `deploy/compose/managed.yml` names the variable on the `api`
 *                service, or `docker compose` passes it nothing.
 *   the worker   the same file names it on the `worker` service, for the same
 *                reason. (Until alpha.18 the jobs ran as Trigger.dev tasks,
 *                and `set-task-env.sh` uploaded it to them; workplan 0167 T9
 *                removed both.)
 *
 * MISSING THE SECOND IS THE WORST OF THE POSSIBLE SPLITS, and it is the one a
 * reasonable person makes: the API would build the consent, Google would
 * approve it, the connection would test green — and every sync pass would then
 * fail to mint a token, hours later, in a task log. Everything visible works;
 * the invisible half does not.
 *
 * This repository has paid for that shape twice already: two variables of
 * Trigger.dev's plane each cost a live afternoon, and three more were read by
 * the tasks and handed them by nobody, each with a working default, so
 * SETTING them did nothing, silently (`a-knob-the-tasks-can-never-see`).
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

/** The text of one service of managed.yml, from its line under `services:` to the next service. */
function serviceText(service: string): string {
  const managed = read('deploy/compose/managed.yml');
  const at = managed.indexOf(`\n  ${service}:\n`);
  if (at < 0) return '';
  const next = managed.slice(at + 1).search(/\n {2}[A-Za-z0-9_.-]+:\n|\n[^\s#]/);
  return next < 0 ? managed.slice(at) : managed.slice(at, at + 1 + next);
}

describe('both halves of the stack are given the client', () => {
  it.each(NAMES.map((n) => [n]))('managed.yml passes %s to the API', (name) => {
    expect(
      serviceText('api'),
      `the API service does not receive ${name} — compose passes nothing a service does not name`,
    ).toContain(`${name}: \${${name}`);
  });

  it.each(NAMES.map((n) => [n]))('managed.yml passes %s to the worker', (name) => {
    expect(
      serviceText('worker'),
      `the worker service does not receive ${name}, so every pass fails to mint a token`,
    ).toContain(`${name}: \${${name}`);
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
    expect(around, 'nothing near it says the worker reads it too').toMatch(/THE API \*AND\* THE WORKER/);
  });
});

describe('the fallback is gated where it has to be', () => {
  /**
   * BOTH SEAMS ASK THE SAME TABLE, and that is the fix rather than the tidy-up.
   *
   * These two used to pin the literal `withDeploymentGoogleClient(isGoogle…` in
   * each seam, which held for Google and could not see the shape of the defect
   * that followed: each seam nested the fillers BY HAND, and when Microsoft
   * arrived in workplan 0114 the run path kept the two it was born with. A
   * `microsoft` row that took the grant button was therefore built with no
   * `clientId` and every Graph face refused inside the pass, while its Test —
   * which nested all three — passed with real counts off the same account.
   *
   * So the question here is now "do both seams read the one table", and
   * `deployment-application.ts` answers which kinds each provider claims.
   * The behaviour half, per provider and derived from `GRANT_PROVIDERS`, is
   * `packages/orchestration/src/the-application-a-stored-row-leans-on.unit.test.ts`.
   */
  it('the run path fills from the one table rather than a hand-nested chain', () => {
    const seam = read('packages/orchestration/src/build-deps-from-mapping.ts');
    expect(seam).toContain('withDeploymentApplication(kind,');
    expect(seam, 'a seam nesting the fillers itself is one a provider can be missed from').not.toContain(
      'withDeploymentGoogleClient(',
    );
  });

  it('the PROBE applies the same fallback, or Test refuses what a pass accepts', () => {
    // "Test failed, create worked" is the same lie as its more famous twin,
    // and reads as a broken product rather than a missing field. It went wrong
    // the other way round once — Test passed and the run refused — which is
    // why both seams now read the same table instead of each other.
    const probe = read('packages/orchestration/src/probe-connection.ts');
    expect(probe).toContain('withDeploymentApplication(kind,');
    expect(probe).not.toContain('withDeploymentGoogleClient(');
  });

  it('the table gates every provider on the kinds that provider actually is', () => {
    // `clientId`/`clientSecret` are shared key names: Dropbox and Box store
    // their own app pairs under them. An ungated fallback would hand Google's
    // application to a Dropbox row, which then fails at Dropbox naming nothing
    // useful. Each provider names its kinds; none of them names all rows.
    const table = read('packages/orchestration/src/deployment-application.ts');
    for (const provider of ['google', 'dropbox', 'microsoft']) {
      expect(table, `${provider} has no row in the fill table`).toContain(`${provider}:`);
    }
    expect(table).toContain('GOOGLE_GRANT_KINDS');
    expect(table).toContain('DROPBOX_CONNECTION_KIND');
    expect(table).toContain('MICROSOFT_ACCOUNT_KIND');
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

/**
 * AND CIRRUX'S PUBLIC CLIENT (workplan 0160 T5; ADR-0052, decision 6). The same
 * split, with a sharper edge: the worker does not only read with the client, it
 * REFRESHES a Cirrux account's Drive sign-in on every pass and writes the
 * successor back. Given to the API alone, Connect Cirrux Drive would work, the
 * Test would measure the Drive, and every pass into it would be refused for a
 * client the worker never got.
 */
describe('Cirrux’s client reaches both halves of the stack', () => {
  const NAME = 'CIRRUX_OAUTH_CLIENT_ID';

  it('managed.yml passes it to the API', () => {
    expect(serviceText('api')).toContain(`${NAME}: \${${NAME}`);
  });

  it('managed.yml passes it to the worker', () => {
    expect(serviceText('worker'), `the worker service does not receive ${NAME}`).toContain(`${NAME}: \${${NAME}`);
  });

  it('the example env documents it, and says beside it that the worker needs it too', () => {
    const example = read('deploy/compose/managed.env.example');
    const at = example.indexOf(`${NAME}=`);
    expect(at, 'the setting is not in the example env').toBeGreaterThan(-1);
    expect(example.slice(Math.max(0, at - 1500), at), 'nothing near it says the worker reads it too').toMatch(
      /by the API AND the worker/,
    );
  });

  it('the pass and the API read the one variable, through the one helper', () => {
    expect(read('packages/shared/src/cirrux-drive.ts')).toContain(NAME);
    expect(read('packages/orchestration/src/build-deps-from-mapping.ts')).toContain('cirruxDeploymentClient(');
    expect(read('apps/api/src/routes/qualify-and-remember.ts')).toContain('cirruxDeploymentClient(');
    expect(read('apps/api/src/routes/migrations/cirrux-oauth-routes.ts')).toContain('cirruxDeploymentClient(');
  });
});
