// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE MAIL THE API COULD NOT SEND.
 *
 * #546 added a mail catcher, an `access_requested` notification, a rendering in
 * two languages, a smoke that reads the caught message, and documentation for
 * all of it. It could not send a single email.
 *
 * `readNotifierConfig` reads `process.env` — `SMTP_HOST`, `NOTIFY_FROM`,
 * `NOTIFY_TO` and six more. `deploy/compose/managed.yml` lists the `api`
 * service's environment key by key, and named **none of them**. Compose passes
 * nothing it has not been told to pass, so the variable an operator sets in
 * `.env` never reached the process that reads it. Every grant, decline and
 * access request answered `notified: "off"` — truthfully, and uselessly.
 *
 * WHY NOTHING CAUGHT IT.
 *
 *   - The unit tests inject a channel directly (`__setChannelForTests`), which
 *     is right for testing the three outcomes and blind to how the real one is
 *     built.
 *   - `managed.env.example` documents all nine keys, and the bring-up warns
 *     when `SMTP_HOST=mailpit` looks wrong for the deployment — both describing
 *     a setting that could not take effect.
 *   - The self-host edition was never affected: `deploy/selfhost/compose.yml`
 *     uses `env_file: .env`, so the whole file arrives and the app simply
 *     works. Only the managed edition enumerates, and only an enumeration can
 *     forget an entry.
 *   - The managed smoke DOES assert a mail arrives, but it runs in the nightly
 *     gate, not on a pull request. The defect would have been found at 05:30,
 *     hours after the merge, by a red gate that names the assertion rather than
 *     the cause.
 *
 * So this compares the two lists directly: what `readNotifierConfig` consults,
 * against what the `api` service is handed. **Both sides are read from the
 * files themselves** — the env names are extracted from the function's own
 * body, so adding a tenth setting to it and forgetting compose fails here
 * rather than in a bring-up.
 *
 * FIFTH INSTANCE TODAY of "two files that must agree and nothing compares
 * them", after services-vs-bring-up, `${VAR:?}`-vs-example, task-reads-vs-
 * uploads, and gatus-vs-ready. The shape is worth naming: one file DESCRIBES a
 * capability and another ENABLES it, and the product reports the disabled state
 * so politely that nobody notices.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NOTIFICATIONS = join(REPO_ROOT, 'packages/shared/src/notifications.ts');
const MANAGED_YML = join(REPO_ROOT, 'deploy/compose/managed.yml');

/**
 * The env names `readNotifierConfig` actually reads, taken from its body rather
 * than from a list kept beside it — a list beside it is a third file that must
 * agree, which is the failure this file exists for.
 */
function namesReadByNotifierConfig(): string[] {
  const source = readFileSync(NOTIFICATIONS, 'utf8');
  const start = source.indexOf('export function readNotifierConfig');
  expect(start, 'readNotifierConfig moved or was renamed').toBeGreaterThan(-1);

  // The function ends at the next top-level `export function` / `export const`,
  // or the end of file. Crude, and deliberately so: a body that swallowed the
  // next declaration would only ever make this rule stricter.
  const rest = source.slice(start + 1);
  const nextTop = rest.search(/\nexport (function|const|interface|type) /);
  const body = nextTop === -1 ? rest : rest.slice(0, nextTop);

  const names = new Set<string>();
  for (const m of body.matchAll(/\benv\.([A-Z][A-Z0-9_]*)\b/g)) names.add(m[1]!);
  return [...names].sort();
}

/** What compose hands the managed `api` container. */
function apiEnvironmentKeys(): string[] {
  const doc = parseYaml(readFileSync(MANAGED_YML, 'utf8')) as {
    services: Record<string, { environment?: Record<string, unknown> | string[] }>;
  };
  const env = doc.services?.api?.environment;
  expect(env, 'managed.yml has no api service with an environment block').toBeTruthy();
  // Compose accepts both a mapping and a `KEY=value` list. Handle both so the
  // rule survives a stylistic change to the file it reads.
  return Array.isArray(env)
    ? env.map((entry) => String(entry).split('=', 1)[0]!)
    : Object.keys(env as Record<string, unknown>);
}

/**
 * Names the api container gets from somewhere other than its own environment
 * block, each with the reason it is not a hole. An exemption list is a promise
 * that somebody looked.
 */
const NOT_FROM_COMPOSE: Record<string, string> = {
  NODE_ENV: 'set in the api service already, and by the image as a fallback',
};

describe('the mail the api could not send', () => {
  const read = namesReadByNotifierConfig();
  const passed = apiEnvironmentKeys();

  it('finds both lists, so an empty comparison cannot pass', () => {
    // Either side coming back empty would make every case below vacuous.
    expect(read).toContain('SMTP_HOST');
    expect(read).toContain('NOTIFY_TO');
    expect(read.length).toBeGreaterThanOrEqual(8);
    expect(passed).toContain('DATABASE_URL');
    expect(passed.length).toBeGreaterThanOrEqual(15);
  });

  it.each(read.map((name) => [name] as const))(
    'the api container is handed %s, which readNotifierConfig reads',
    (name) => {
      if (NOT_FROM_COMPOSE[name]) {
        expect(passed, `${name}: ${NOT_FROM_COMPOSE[name]}`).toBeDefined();
        return;
      }
      expect(
        passed,
        `readNotifierConfig reads ${name}, but deploy/compose/managed.yml never passes it to the api service. ` +
          'Compose passes nothing it has not been told to pass, so setting it in .env does nothing — ' +
          `add "${name}: \${${name}:-}" to the api environment block.`,
      ).toContain(name);
    },
  );

  it('passes every setting optionally, so an unconfigured stack still boots', () => {
    // `${VAR:?}` here would refuse a bring-up over mail nobody has set up. The
    // channel reporting itself off is the correct behaviour for that stack;
    // refusing to start is not.
    const yml = readFileSync(MANAGED_YML, 'utf8');
    const required = read
      .filter((name) => !NOT_FROM_COMPOSE[name])
      .filter((name) => new RegExp(`^\\s+${name}: \\$\\{${name}:\\?`, 'm').test(yml));
    expect(required, 'a mail setting is required with ${VAR:?}, which stops a bring-up').toEqual([]);
  });

  it('the self-host edition takes the whole file, and needs no such list', () => {
    // Stated so a future reader does not "fix" self-host by enumerating it, and
    // so the asymmetry is on the record: only an enumeration can forget an entry.
    const selfhost = readFileSync(join(REPO_ROOT, 'deploy/selfhost/compose.yml'), 'utf8');
    expect(selfhost).toMatch(/env_file:\s*\n(\s*#.*\n)*\s*- \.env/);
  });
});
