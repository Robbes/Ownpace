// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A BUILD THAT REACHED FOR THE LAN (workplan 0132 T3 (a); E2E (managed) #201).
 *
 * The deploy CLI builds the task image on this machine, and the image's
 * indexer calls the Trigger.dev API during the build, at the origin the
 * server advertises. Trigger.dev's CLI 4.5.16 rewrites an origin naming
 * `localhost` to `host.docker.internal` for the build, and maps that name to
 * the machine's first non-loopback IPv4 address (`normalizeApiUrlForBuild` and
 * `getAddHost` in its `deploy/buildImage.js`). While the API port was published
 * on every interface, that address answered. Since 0132 T3 (a) the port
 * answers on loopback only, and E2E (managed) #201 stopped in the build with
 * *"Failed to fetch environment variables: Connection error"*.
 *
 * So:
 *
 * - the server advertises `http://127.0.0.1:<port>`, which the CLI leaves
 *   alone. It is fixed in `managed.yml`, not read from `.env`, so an old `.env`
 *   naming `localhost` cannot put the failure back;
 * - the deploy builds on the host's network (`--network host`), where
 *   127.0.0.1 is the API;
 * - and the API port still answers on loopback only by default: nothing had
 *   to be published for the build.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

const compose = parse(read('deploy/compose/managed.yml')) as {
  services: Record<string, { environment?: Record<string, string>; ports?: string[] }>;
};
const api = compose.services['trigger-api'];

/** Shell comments removed: a comment may name the flag without passing it. */
function code(text: string): string {
  return text
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');
}

/** What CLI 4.5.16 hands the build, by its own rule (`normalizeApiUrlForBuild`). */
const forTheBuild = (origin: string) => origin.replace('localhost', 'host.docker.internal');

describe('the origin the server advertises', () => {
  it('is loopback by number, fixed in managed.yml', () => {
    expect(api, 'the trigger-api service is gone from managed.yml').toBeTruthy();
    expect(api!.environment?.API_ORIGIN).toBe('http://127.0.0.1:${TRIGGER_PORT:-3090}');
  });

  it('is left alone by the CLI when it builds, where localhost was not', () => {
    const advertised = api!.environment!.API_ORIGIN!;
    expect(forTheBuild(advertised)).toBe(advertised);
    // The origin #201 advertised, and what the build was handed instead.
    expect(forTheBuild('http://localhost:3090')).toBe('http://host.docker.internal:3090');
  });

  it('is not read from .env, so an old one cannot bring localhost back', () => {
    expect(api!.environment!.API_ORIGIN).not.toContain('TRIGGER_API_ORIGIN');
  });
});

describe('the deploy', () => {
  it('builds on the host network, where 127.0.0.1 is the API', () => {
    const text = code(read('deploy/compose/deploy-tasks.sh'));
    const call = text.slice(text.indexOf('cd "${REPO_ROOT}/apps/worker"'));
    const invocation = call.slice(call.indexOf('TRIGGER_PROJECT_REF='), call.indexOf('\n', call.indexOf('deploy --profile')));
    expect(invocation, 'the deploy invocation is no longer recognisable').toContain('deploy --profile');
    expect(invocation, 'the deploy builds on its own network, where 127.0.0.1 is the build').toMatch(
      /--network host\b/,
    );
  });

  it('logs the CLI in on loopback by number too', () => {
    const example = read('deploy/compose/managed.env.example');
    expect(example).toMatch(/^TRIGGER_API_ORIGIN=http:\/\/127\.0\.0\.1:3090$/m);
    expect(code(read('deploy/compose/deploy-tasks.sh'))).toMatch(
      /TRIGGER_API_URL="\$\{TRIGGER_API_ORIGIN:-http:\/\/127\.0\.0\.1:/,
    );
  });
});

describe('the API port', () => {
  it('still answers on loopback only unless TRIGGER_BIND says otherwise', () => {
    expect(api!.ports).toEqual([
      '127.0.0.1:${TRIGGER_PORT:-3090}:3000',
      '${TRIGGER_BIND:-127.0.0.1}:${TRIGGER_PORT:-3090}:3000',
    ]);
  });
});
