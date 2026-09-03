// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * `TRIGGER_ACCESS_TOKEN` never travels without `TRIGGER_API_URL`.
 *
 * A Trigger.dev access token is not a login on its own. The CLI's `deploy`
 * calls `login({embedded:true})`, whose first branch reads the token and
 * validates it against `TRIGGER_API_URL` — and **when that is unset it
 * defaults to the SaaS cloud, `api.trigger.dev`**, where a self-hosted
 * `tr_pat_` is unknown. The CLI's answer is `Invalid or Missing Access
 * Token`, which reads as "your token is wrong" when the token is perfectly
 * good and the ADDRESS is what is missing.
 *
 * That sentence cost the owner two login dances in one day (2026-09-03). The
 * second came immediately after `trigger-remember-token.sh` reported success:
 * logout, login, a self-signed browser page, a minted token written to `.env`
 * — and then `deploy-tasks.sh` refusing in the exact words of the wall he had
 * just climbed. The token was fine. `deploy-tasks.sh`, the script that
 * HARVESTS the token, was the only one of the three that used it without
 * setting the URL, so the path had only ever been exercised in CI, where the
 * workflow sets the variable itself.
 *
 * So this pairs them. Any place that supplies the token, or that runs a CLI
 * command able to consume one from the environment, must set the URL in the
 * same breath. The three known places are listed with what each is for; a
 * fourth that sets one without the other fails here rather than in somebody's
 * terminal at the end of a bring-up.
 *
 * Read as TEXT: two of the three are shell, one is YAML, and what is under
 * test is whether they agree — not any value any of them exports.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');

const TOKEN = 'TRIGGER_ACCESS_TOKEN';
const URL_VAR = 'TRIGGER_API_URL';

/**
 * The variable being ASSIGNED, not merely named.
 *
 * Two traps, both hit while writing this file. `TRIGGER_API_URL` appears in
 * the prose of the very comment that explains the fix, so a bare substring
 * check passes on a file that deleted the assignment — the first draft did
 * exactly that and stayed green under the break. And `set-task-env.sh` names
 * `TRIGGER_API_URL_IN_NETWORK`, an unrelated variable that CONTAINS the name,
 * so the substring would have been satisfied there too.
 *
 * Requiring `=` (shell) or `:` (YAML) immediately after excludes both: the
 * underscore in `_IN_NETWORK` is not either character, and prose does not
 * assign.
 */
const ASSIGNS_URL = /TRIGGER_API_URL[=:]/;

/** The file with its comment lines removed, so prose cannot answer for code. */
function code(text: string): string {
  return text
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
}

/**
 * Every file that hands the Trigger CLI credentials, and what it is.
 *
 * `trigger-remember-token.sh` is deliberately NOT here: it only writes the
 * token into `.env` and runs no CLI command, so it has nothing to point at an
 * address. The scripts that READ that file are the ones that must pair it.
 */
const CREDENTIAL_CALLERS: ReadonlyArray<{ path: string; why: string }> = [
  {
    path: 'deploy/compose/deploy-tasks.sh',
    why: 'deploys the tasks; reads TRIGGER_ACCESS_TOKEN from .env, and it was the one that forgot',
  },
  {
    path: 'deploy/compose/set-task-env.sh',
    why: 'uploads the task environment through the same CLI',
  },
  {
    path: '.github/workflows/e2e-managed.yml',
    why: 'runs the whole managed gate with the token as a repository secret',
  },
];

describe('a token without an address is not a login', () => {
  it.each(CREDENTIAL_CALLERS)('$path sets TRIGGER_API_URL ($why)', ({ path }) => {
    const text = code(readFileSync(join(ROOT, path), 'utf8'));
    expect(
      ASSIGNS_URL.test(text),
      `${path} runs the Trigger CLI but never ASSIGNS ${URL_VAR}. With ${TOKEN} present and no ` +
        `${URL_VAR}, the CLI validates a self-hosted token against api.trigger.dev and answers ` +
        '"Invalid or Missing Access Token" — a sentence about the wrong thing, which sends the ' +
        'reader back through a login that was never the problem.',
    ).toBe(true);
  });

  it('the deploy sets it on the very command that consumes the token', () => {
    // Not merely SOMEWHERE in the file: on the invocation. A `TRIGGER_API_URL`
    // assigned in a comment, or exported in a branch the deploy does not take,
    // would satisfy `toContain` above and change nothing at the moment it
    // matters — which is the shape of the bug this guard exists for.
    const text = code(readFileSync(join(ROOT, 'deploy/compose/deploy-tasks.sh'), 'utf8'));
    const call = text.slice(text.indexOf('cd "${REPO_ROOT}/apps/worker"'));
    const deployLine = call.slice(0, call.indexOf('deploy --profile'));
    expect(
      deployLine,
      'deploy-tasks.sh sets TRIGGER_API_URL somewhere, but not on the `deploy` invocation ' +
        'itself — so the CLI still resolves the token against the cloud',
    ).toContain(`${URL_VAR}=`);
  });

  it('derives the address rather than hard-coding a second copy of it', () => {
    // `TRIGGER_API_ORIGIN` is what .env already carries and what managed.yml
    // and set-task-env.sh read. A literal `http://localhost:3090` here would
    // be a fourth copy of one address, and the port is configurable.
    const text = code(readFileSync(join(ROOT, 'deploy/compose/deploy-tasks.sh'), 'utf8'));
    expect(text).toMatch(/TRIGGER_API_URL="\$\{TRIGGER_API_ORIGIN:-/);
  });
});
