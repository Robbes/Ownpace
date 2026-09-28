// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A HELPDESK THE API WAS NEVER HANDED.
 *
 * "Report a problem" (workplan 0130) is offered only when the API can read
 * `ZAMMAD_URL` and `ZAMMAD_TOKEN`; `ZAMMAD_GROUP` picks the group a ticket
 * lands in. `deploy/compose/managed.env.example` carries all three and step 8f
 * of `docs/managed-bring-up.md` says to set them there — but
 * `deploy/compose/managed.yml` lists the `api` service's environment key by
 * key and named none of them, so setting them in `.env` did nothing and the
 * form could not appear on any managed stack. Found by the 2026-09-24
 * readiness review's plan pass, one day after the form shipped.
 *
 * The third of its kind: `the-mail-the-api-could-not-send` compares the mail
 * keys and `a-limit-the-api-was-never-handed` the access-request limit's. The
 * names come from the code that reads them (`zammadConfigFrom` in
 * `apps/api/src/services/zammad.ts`), the list from the compose file.
 *
 * EMPTY BY DEFAULT, because empty is "no form", which is today's behaviour and
 * the right one for a stack whose owner runs no helpdesk.
 *
 * AND THE MAILBOX (the owner, for the alpha, 2026-09-28): without a Zammad, a
 * report goes by mail to `REPORT_MAIL_TO`, read by `reportMailConfigFrom` in
 * `apps/api/src/services/report-channel.ts`. The same trap applies to it, so
 * its names are read from that function's body too. Empty is `NOTIFY_TO`, which
 * the relay's own guard (`the-mail-the-api-could-not-send`) already holds.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string): string => readFileSync(join(REPO_ROOT, path), 'utf8');

/** The names a function reads from `env`, from its own body. */
function namesReadBy(file: string, fn: string): string[] {
  const source = read(file);
  const start = source.indexOf(`export function ${fn}`);
  expect(start, `${fn} moved or was renamed`).toBeGreaterThan(-1);
  const rest = source.slice(start + 1);
  const next = rest.search(/\nexport (async function|function|const|interface|type|class) /);
  const body = next === -1 ? rest : rest.slice(0, next);
  return [...new Set([...body.matchAll(/\benv\.([A-Z][A-Z0-9_]*)\b/g)].map((m) => m[1]!))];
}

/** The names `zammadConfigFrom` and `reportMailConfigFrom` read. */
function helpdeskNames(): string[] {
  return [
    ...namesReadBy('apps/api/src/services/zammad.ts', 'zammadConfigFrom'),
    ...namesReadBy('apps/api/src/services/report-channel.ts', 'reportMailConfigFrom'),
  ];
}

function apiEnvironment(): Record<string, unknown> {
  const doc = parseYaml(read('deploy/compose/managed.yml')) as {
    services: Record<string, { environment?: Record<string, unknown> }>;
  };
  const env = doc.services?.api?.environment;
  expect(env, 'managed.yml has no api service with an environment mapping').toBeTruthy();
  return env!;
}

describe('problem reports can be switched on for a managed stack', () => {
  const names = helpdeskNames();
  const passed = apiEnvironment();
  const example = read('deploy/compose/managed.env.example');

  it('finds the four settings, so an empty comparison cannot pass', () => {
    expect(names).toEqual(expect.arrayContaining(['ZAMMAD_URL', 'ZAMMAD_TOKEN', 'ZAMMAD_GROUP', 'REPORT_MAIL_TO']));
  });

  it.each(names.map((name) => [name] as const))('the api container is handed %s', (name) => {
    expect(
      Object.keys(passed),
      `the api reads ${name}, but managed.yml never passes it to the api service. Compose passes\n` +
        'nothing it has not been told to pass, so setting it in .env does nothing.',
    ).toContain(name);
    expect(passed[name], `${name} must default to empty: empty is no Zammad, and NOTIFY_TO for the mail.`).toBe(
      `\${${name}:-}`,
    );
  });

  it.each(names.map((name) => [name] as const))('managed.env.example names %s', (name) => {
    expect(example, `an operator cannot find ${name} in managed.env.example`).toMatch(
      new RegExp(`^${name}=`, 'm'),
    );
  });
});

/**
 * THE OTHER WAY TO A PERSON (workplan 0144 T6 (a)). Where no helpdesk is set,
 * or before sign-in, where the form cannot be reached at all, the web app
 * shows an address instead: on `/login`, `/request-access`, `/auth/callback`
 * and `/invitations`, and in the sidebar where *Report a problem* would be.
 * Those pages have no session to ask the API with, so the address is a web
 * BUILD argument, `VITE_SUPPORT_EMAIL`, and the same trap applies one boundary
 * over: set in `.env` and never handed to the build, it bakes nothing into the
 * bundle and no page names anybody. The Dockerfile's `ARG` is held by
 * `the-issuer-the-bundle-never-learned`, which derives it from what the app
 * reads. Empty by default: empty is "show nothing new", today's behaviour on
 * every stack but the one testers use.
 */
describe('the support address reaches the web build', () => {
  const BUILD_ARG = 'VITE_SUPPORT_EMAIL';

  it('the web app reads it, so the check below compares a real name', () => {
    expect(read('apps/web/src/components/SupportLine.tsx')).toContain(`import.meta.env.${BUILD_ARG}`);
  });

  it('managed.yml passes it among the web build\'s arguments, empty by default', () => {
    const doc = parseYaml(read('deploy/compose/managed.yml')) as {
      services: Record<string, { build?: { args?: Record<string, unknown> } }>;
    };
    const args = doc.services?.web?.build?.args ?? {};
    expect(
      Object.keys(args),
      `the web build is never handed ${BUILD_ARG}. A compose build arg is a different\n` +
        'boundary from the shell, so setting it in .env shows no address anywhere.',
    ).toContain(BUILD_ARG);
    expect(args[BUILD_ARG], `${BUILD_ARG} must default to empty: empty shows nothing new`).toBe(
      `\${${BUILD_ARG}:-}`,
    );
  });

  it('managed.env.example names it, empty', () => {
    // Empty in the example too: the address is the owner's and goes in the
    // live stack's own .env (0144 T0), never in this public repository.
    expect(read('deploy/compose/managed.env.example')).toMatch(new RegExp(`^${BUILD_ARG}=$`, 'm'));
  });
});
