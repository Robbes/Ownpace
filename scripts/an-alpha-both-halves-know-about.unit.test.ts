// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN ALPHA BOTH HALVES KNOW ABOUT (workplan 0131 T1).
 *
 * The alpha is said out loud in two places that two different processes
 * build: a note on the signed-in pages, the sign-in page and the request page,
 * which the WEB BUNDLE renders, and one paragraph in the access-granted mail,
 * which the API sends. One setting in `.env`, `OWNPACE_STAGE=alpha`, switches
 * both, and it reaches them by two different mechanisms:
 *
 *   the web    a compose BUILD ARG. Vite bakes it into the bundle at build
 *              time, because `/login` and `/request-access` have no session to
 *              ask the API with, and a note that vanished when a read failed
 *              would go quiet exactly when something is wrong. The build arg
 *              is `VITE_OWNPACE_STAGE`, since Vite only exposes `VITE_` names.
 *   the API    its environment, which `managed.yml` lists key by key.
 *
 * MISSING EITHER IS A SPLIT NOBODY SEES. The web half alone: the pages say
 * alpha and the mail a tester reads first does not. The API half alone: the
 * mail says alpha and every page is silent. Both arrive with no error, because
 * an unset setting is the ordinary, correct state of every other deployment.
 * This repository has paid for "set in `.env`, never handed over" four times
 * already: the mail settings (`the-mail-the-api-could-not-send`), the issuer
 * (`the-issuer-the-bundle-never-learned`), the request limit
 * (`a-limit-the-api-was-never-handed`) and the helpdesk
 * (`a-helpdesk-the-api-was-never-handed`).
 *
 * EMPTY BY DEFAULT. Off unless the deployment sets it: the OTA stack, a
 * developer's stack and every appliance leave it unset. The appliance never
 * sets it at all: it lets nobody in and sends no grant mail, and the web app
 * refuses the note on the appliance whatever its bundle was built with
 * (`apps/web/src/services/stage.ts`).
 *
 * ROOT-LEVEL, SO VITEST AND NODE BUILTINS ONLY (AGENTS.md). The behaviour
 * halves live beside their code: `apps/web/src/components/an-alpha-said-out-loud.unit.test.tsx`
 * renders the note, and `packages/shared/src/a-grant-mail-that-says-alpha.unit.test.ts`
 * renders the mail.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string): string => readFileSync(join(REPO_ROOT, rel), 'utf8');

/** The one name an operator sets. */
const SETTING = 'OWNPACE_STAGE';
/** The name Vite exposes to the bundle. */
const BUILD_ARG = `VITE_${SETTING}`;

interface Compose {
  services: Record<
    string,
    { environment?: Record<string, unknown>; build?: { args?: Record<string, unknown> } }
  >;
}
const compose = (): Compose => parseYaml(read('deploy/compose/managed.yml')) as Compose;

describe('the readers name the setting, so the checks below compare real names', () => {
  it('the web app reads the build arg', () => {
    // The vacuity guard for the web half. If the reader were renamed, the
    // compose check below would keep passing on a name nothing reads.
    expect(read('apps/web/src/components/AlphaNote.tsx')).toContain(`import.meta.env.${BUILD_ARG}`);
  });

  it('the API reads the setting', () => {
    expect(read('apps/api/src/access-notify.ts')).toMatch(new RegExp(`\\benv\\.${SETTING}\\b`));
  });
});

describe('managed.yml hands the setting to both halves', () => {
  it('the web build receives it as a build arg, empty by default', () => {
    const args = compose().services.web?.build?.args ?? {};
    expect(
      Object.keys(args),
      `the web build is never handed ${BUILD_ARG}. A compose build arg is a different\n` +
        'boundary from the shell, so setting it in .env bakes nothing into the bundle,\n' +
        'and no page says alpha.',
    ).toContain(BUILD_ARG);
    expect(args[BUILD_ARG], 'the build arg must come from the one setting, and default to empty').toBe(
      `\${${SETTING}:-}`,
    );
  });

  it('the API receives it in its explicit environment, empty by default', () => {
    const env = compose().services.api?.environment ?? {};
    expect(
      Object.keys(env),
      `the api service is never handed ${SETTING}. Compose passes nothing it is not told\n` +
        'to pass, so the grant mail would never say alpha.',
    ).toContain(SETTING);
    expect(env[SETTING], `${SETTING} must default to empty: empty means off`).toBe(`\${${SETTING}:-}`);
  });
});

describe('the web image passes it to Vite', () => {
  const dockerfile = read('apps/web/Dockerfile');

  it('declares the build arg, empty by default, and exports it to the build', () => {
    expect(dockerfile).toMatch(new RegExp(`^ARG ${BUILD_ARG}=$`, 'm'));
    expect(dockerfile).toMatch(new RegExp(`^ENV ${BUILD_ARG}=\\$${BUILD_ARG}$`, 'm'));
  });

  it('before the build runs, or the build never sees it', () => {
    const env = dockerfile.search(new RegExp(`^ENV ${BUILD_ARG}=`, 'm'));
    const build = dockerfile.indexOf('pnpm --filter @openmig/web build');
    expect(build, 'the build step moved; check this guard still reads it').toBeGreaterThan(-1);
    expect(env).toBeGreaterThan(-1);
    expect(env).toBeLessThan(build);
  });
});

describe('an operator can find it', () => {
  it('managed.env.example names it, empty', () => {
    expect(read('deploy/compose/managed.env.example')).toMatch(new RegExp(`^${SETTING}=$`, 'm'));
  });

  it('and says beside it that the web image must be rebuilt', () => {
    // A build arg changes nothing until the image is built again. Said where the
    // value is set, not in a runbook read afterwards.
    const example = read('deploy/compose/managed.env.example');
    const at = example.search(new RegExp(`^${SETTING}=`, 'm'));
    expect(at).toBeGreaterThan(-1);
    const around = example.slice(Math.max(0, at - 1200), at);
    expect(around, 'nothing near it says the web image has to be rebuilt').toMatch(/rebuil/i);
  });
});

describe('the appliance is never handed it', () => {
  it.each([
    'deploy/selfhost/compose.yml',
    'deploy/selfhost/compose.dev.yml',
    'deploy/selfhost/compose.pglite.yml',
    'deploy/selfhost/compose.drill.yml',
    'deploy/selfhost/selfhost.env.example',
    'apps/selfhost/Dockerfile',
  ])('%s does not name it', (file) => {
    expect(read(file)).not.toContain(SETTING);
  });
});
