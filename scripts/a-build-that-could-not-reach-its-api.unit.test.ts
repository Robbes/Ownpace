// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A BUILD THAT COULD NOT REACH ITS API (workplan 0132 T3).
 *
 * #1236 put every published port on 127.0.0.1, plus an address the operator
 * names. The Trigger.dev API's own port, 3090, got no address: nothing off
 * the machine needs it, and the deploy CLI asks it on `localhost`.
 *
 * The first managed gate after the merge (E2E (managed) #201) stopped at the
 * task deploy: "Failed to index deployment: Failed to fetch environment
 * variables: Connection error." The indexer is not the CLI. It is a `RUN` step
 * inside the image build, and it asks the API for the environment's variables.
 * The CLI (trigger.dev 4.5.16, `deploy/buildImage.js`) hands it the API's URL
 * with `localhost` replaced by `host.docker.internal`, and maps that name to
 * the machine's first non-loopback IPv4 (`getHostIP`). Before #1236 port 3090
 * answered there, because it answered on every interface. Now it answers on
 * 127.0.0.1 alone, so the build was refused.
 *
 * Opening 3090 on that address again would put the Trigger.dev dashboard, in
 * plain HTTP, back on whichever interface Node lists first. Instead the deploy
 * builds with `--network host`, so a `RUN` step shares the machine's own
 * loopback, and hands the CLI `127.0.0.1` rather than `localhost`: the CLI
 * rewrites only the word `localhost`, so nothing is redirected away from the
 * loopback the build now shares. `TRIGGER_API_URL` is an argument of the
 * indexer stage alone; the image the tasks run from does not carry it.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const LIB = join(ROOT, 'deploy/compose/trigger-cli-lib.sh');
const DEPLOY = join(ROOT, 'deploy/compose/deploy-tasks.sh');
const MANAGED = join(ROOT, 'deploy/compose/managed.yml');

/** The file without its comment lines, so a sentence about a flag is not the flag. */
function code(path: string): string {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
}

/** What the deploy hands the CLI for a given origin, from the library the script sources. */
function forTheBuild(origin: string): string {
  return execFileSync(
    'bash',
    ['-c', '. "$1"; trigger_api_url_for_the_build "$2"', '_', LIB, origin],
    { encoding: 'utf8' },
  ).trim();
}

/** The deploy invocation: from the worker directory to the end of the `npx … deploy` line. */
function deployInvocation(): string {
  const text = code(DEPLOY);
  const from = text.indexOf('cd "${REPO_ROOT}/apps/worker"');
  expect(from, 'deploy-tasks.sh no longer changes into apps/worker before the deploy').toBeGreaterThan(-1);
  const rest = text.slice(from);
  const deploy = rest.search(/npx -y "trigger\.dev@\$\{CLI_VERSION\}" deploy\b[^\n]*/);
  expect(deploy, 'deploy-tasks.sh no longer runs `npx trigger.dev deploy`').toBeGreaterThan(-1);
  const lineEnd = rest.indexOf('\n', deploy);
  return rest.slice(0, lineEnd === -1 ? undefined : lineEnd);
}

describe('the task deploy reaches the API from inside its own build', () => {
  it('builds with the host network, so a RUN step shares the machine loopback', () => {
    const call = deployInvocation();
    const deployLine = call.slice(call.search(/npx -y "trigger\.dev@/));
    expect(
      deployLine,
      'the deploy builds without `--network host`: its indexer runs in its own network, where ' +
        '127.0.0.1 is the build container, and the API answers only on the machine loopback',
    ).toMatch(/\s--network(\s+|=)host(\s|$)/);
  });

  it('hands the CLI an address the CLI does not rewrite', () => {
    const call = deployInvocation();
    const assigned = call.match(/TRIGGER_API_URL="([^"]*)"/);
    expect(assigned, 'the deploy invocation no longer sets TRIGGER_API_URL').not.toBeNull();
    expect(
      assigned![1],
      'TRIGGER_API_URL on the deploy is not the build address: the origin goes to the CLI as it ' +
        'is, and `localhost` in it becomes host.docker.internal, the machine outside address',
    ).toBe('${BUILD_API_URL}');
    expect(code(DEPLOY)).toMatch(
      /BUILD_API_URL="\$\(trigger_api_url_for_the_build "\$\{TRIGGER_API_ORIGIN:-http:\/\/localhost:\$\{TRIGGER_PORT:-3090\}\}"\)"/,
    );
  });

  it.each([
    ['http://localhost:3090', 'http://127.0.0.1:3090'],
    ['http://localhost:4090', 'http://127.0.0.1:4090'],
    ['http://localhost:3090/', 'http://127.0.0.1:3090/'],
    ['http://localhost', 'http://127.0.0.1'],
    ['https://localhost:3443', 'https://127.0.0.1:3443'],
    ['http://127.0.0.1:3090', 'http://127.0.0.1:3090'],
    // Another host is the operator's choice, and is passed on as it is.
    ['http://10.0.0.5:3090', 'http://10.0.0.5:3090'],
    ['http://localhost.example:3090', 'http://localhost.example:3090'],
    ['http://mylocalhost:3090', 'http://mylocalhost:3090'],
  ])('spells the loopback of %s as %s', (origin, expected) => {
    expect(forTheBuild(origin)).toBe(expected);
  });

  it('leaves no `localhost` for the CLI to replace', () => {
    // The CLI's replace is a plain `String.replace("localhost", …)`: the first
    // occurrence anywhere, host or not. An address that still holds the word
    // would be redirected to the machine outside address.
    for (const origin of ['http://localhost:3090', 'http://localhost', 'https://localhost:3443/']) {
      expect(forTheBuild(origin)).not.toContain('localhost');
    }
  });

  it('the API still answers on the machine loopback, where the build now looks', () => {
    const managed = code(MANAGED);
    expect(
      managed,
      'managed.yml no longer publishes the Trigger.dev API on 127.0.0.1: the build, on the host ' +
        'network, asks there',
    ).toMatch(/-\s*"127\.0\.0\.1:\$\{TRIGGER_PORT:-3090\}:3000"/);
  });
});
