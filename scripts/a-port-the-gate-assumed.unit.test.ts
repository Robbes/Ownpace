// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PORT THE GATE ASSUMED.
 *
 * E2E (managed) #84 went red on a stack whose mail was perfectly healthy:
 *
 *     curl: (7) Failed to connect to localhost port 3127
 *     mailpit is not answering at http://localhost:3127 — the mail path is unproven
 *
 * while the same run's `docker compose ps` said the catcher was `Up (healthy)`
 * on `100.97.25.131:3127`. `MAILPIT_BIND` is a documented setting; the box had
 * used it; the gate asked loopback anyway and then blamed the mail path.
 *
 * THE POINT FIX WAS NOT THE END OF IT. Every published port in `managed.yml`
 * is a setting, and grepping for the rest of the shape found four more: `API`
 * and `WEB` hard-coded their ports outright, and `STATUS_PORT`,
 * `TRIGGER_TLS_PORT` and `REGISTRY_PORT` were read as shell variables in a
 * script that SOURCES NO `.env` — so they were defaults wearing a variable's
 * clothes, quietly right only while nobody changed anything. `pasteable-hints`
 * is in this repository because a guard scoped to where a bug was found does
 * not stop the class; this is the same lesson, one file over.
 *
 * WHY IT MATTERS MORE THAN A RED LIGHT. Each of these fails POINTING AT THE
 * WRONG THING. "mailpit is not answering", "web app not serving", "nothing
 * answered https://127.0.0.1:3443" — every one of them accuses the service of
 * being down when the truth is that the gate looked in the wrong place. That
 * is a debugging session per instance, and it happens to whoever changed the
 * setting, who has the least reason to suspect the gate.
 *
 * SO THE RULE IS DERIVED FROM `managed.yml`, NOT FROM A LIST. Add a service
 * tomorrow with `${NEW_PORT:-9999}` and this covers it the moment the smoke
 * mentions it, without anybody remembering to come back here.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const COMPOSE = join(dirname(fileURLToPath(import.meta.url)), '..', 'deploy', 'compose');

/** The smoke with comments stripped: prose about a variable is not a read. */
const smoke = readFileSync(join(COMPOSE, 'smoke-managed.sh'), 'utf8')
  .split('\n')
  .filter((l) => !/^\s*#/.test(l))
  .join('\n');

/** Every port `managed.yml` lets an operator move, read out of its publishes. */
function configurablePorts(): string[] {
  const compose = readFileSync(join(COMPOSE, 'managed.yml'), 'utf8');
  const keys = new Set<string>();
  for (const m of compose.matchAll(/\$\{([A-Z_]*PORT)(?::-[^}]*)?\}/g)) keys.add(m[1]!);
  return [...keys].sort();
}

describe('the gate looks where the operator put things', () => {
  it('finds ports in managed.yml to have an opinion about', () => {
    expect(
      configurablePorts().length,
      'no ${..._PORT} publishes found in managed.yml — this rule has lost its\n' +
        'subject and needs rewriting for however ports are configured now.',
    ).toBeGreaterThan(3);
  });

  /**
   * The script greps `.env`; it does not source it. So a bare `${SOME_PORT}`
   * is read from a shell that never had it — always empty, always the default.
   * `smoke_env_value SOME_PORT` is what actually reads the setting.
   */
  it('reads every port it cares about from .env, not from its shell', () => {
    for (const key of configurablePorts()) {
      if (!smoke.includes(key)) continue; // the gate does not reach this service
      expect(
        smoke,
        `smoke-managed.sh mentions ${key} but never reads it with\n` +
          `\`smoke_env_value ${key}\`.\n\n` +
          'This script sources no .env, so any ${' +
          key +
          '} in it is read from a\n' +
          'shell that never had the value: it is the default wearing a\n' +
          "variable's clothes. When the operator moves that port the gate keeps\n" +
          'asking the old one and reports the SERVICE as down — which is how\n' +
          'E2E (managed) #84 spent a run blaming a healthy mail path.',
      ).toContain(`smoke_env_value ${key}`);
    }
  });

  /**
   * The other half of the same mistake: no variable at all. `API` and `WEB`
   * simply had the number in them, so there was nothing to read and nothing to
   * notice.
   */
  it('does not hard-code a port into an endpoint it lets you override', () => {
    const literals = [...smoke.matchAll(/^\s*[A-Z_]+="\$\{SMOKE_[A-Z_]+:-[^"]*?:(\d+)[^"]*"/gm)];
    expect(
      literals.map((m) => m[0]!.trim()),
      'these endpoints default to a literal port:\n\n' +
        literals.map((m) => `  ${m[0]!.trim()}`).join('\n') +
        '\n\nEvery published port in managed.yml is a setting. A literal here is\n' +
        'right until somebody uses the setting, and then the gate fails naming\n' +
        'the service rather than the port. Read it with smoke_env_value and\n' +
        'keep the number only as the last fallback.',
    ).toEqual([]);
  });
});
