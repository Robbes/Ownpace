// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A SECRET HANDED TO THE LOGGER: no code in `apps/` or `packages/` hands the
 * logger a value named as a credential or a mail address, outside a named list
 * (workplan 0178 §5.1, G4; the owner's D2 of 2026-11-26: measured first, then
 * blocking once each spot is answered).
 *
 * WHY. The shared logger (`packages/shared/src/logger.ts`) strips the
 * value-carrying fields of an Error, and the access log strips links, Referers
 * and OAuth's code and state (`apps/api/src/access-log.ts`). Neither looks at a
 * value handed over BY NAME: `log.info({ password })`, `log.warn(\`… ${token}\`)`
 * or `console.error(user.email)` print as given. Each guard that holds a log
 * today (`a-log-that-kept-the-link`, `a-database-fault-logged-without-its-values`)
 * holds one shape of it.
 *
 * THE RULE. Every tracked `.ts`, `.tsx` and `.mjs` file under `apps/` and
 * `packages/` that is not a test, a test's fixture or a test helper is parsed
 * (`scripts/sast-guard-source.ts`). A spot is a call to `log`, `logger`,
 * `appLog` or `console` at a level (`debug`, `info`, `warn`, `error`, `log`)
 * whose arguments hand over a name whose last word is password, passwd,
 * secret, token, api key, authorization, cookie or credential(s), or is email
 * or mail address: the argument itself, a value in a template, an object's key,
 * an array's element, either side of a `+` or a `?:`. A call is not followed,
 * so `mask(token)` is not a spot. Each file with spots is in PLACES, with their
 * number and the reason the value may be printed there.
 *
 * MEASURED on 2026-11-26, before it blocked: four spots, in two commands an
 * operator runs by hand, each printing what that operator asked for. They are
 * PLACES. Nothing on the request path, in a job or in a package printed one.
 *
 * WHAT IT DOES NOT SEE. A value under a name that does not say what it is; a
 * logger reached under another name; an object logged whole whose fields
 * include one.
 */

import { describe, it, expect } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isSecretName, isTestSource, readSource, secretLogSpots, trackedSources } from './sast-guard-source.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The files allowed to print a secret-named value, how many times, and why. */
const PLACES: Record<string, { spots: number; reason: string }> = {
  'apps/api/src/scripts/operator.ts': {
    spots: 2,
    reason:
      'The operator command, run by hand: `operator:list` prints the operators’ addresses, and `operator:add` confirms the address it just added, to the operator who typed it. Never loaded by the API.',
  },
  'apps/api/src/scripts/seed-managed.ts': {
    spots: 2,
    reason:
      'The demo seed, run by hand on a stack being set up: printing each demo owner’s address and sign-in token is what it is for (its own line says so). Never loaded by the API.',
  },
};

function spotsOnTheTree(): Map<string, Array<{ line: number; text: string }>> {
  const found = new Map<string, Array<{ line: number; text: string }>>();
  for (const file of trackedSources(ROOT, ['apps', 'packages'], /\.(ts|tsx|mjs)$/)) {
    if (isTestSource(file)) continue;
    const spots = secretLogSpots(file, readSource(ROOT, file));
    if (spots.length > 0) found.set(file, spots);
  }
  return found;
}

describe('a secret handed to the logger (0178 G4)', () => {
  it('knows a credential’s or an address’s name by its last word', () => {
    for (const name of ['password', 'refreshToken', 'access_token', 'clientSecret', 'apiKey', 'API_KEY', 'authorization', 'cookie', 'credentials', 'email', 'ownerEmail', 'mailAddress'])
      expect(isSecretName(name), name).toBe(true);
    for (const name of ['tokenUrl', 'tokenCount', 'passwordPolicy', 'emailed', 'secretRef', 'address', 'name', 'id']) expect(isSecretName(name), name).toBe(false);
  });

  it('refuses each way a secret-named value reaches the logger, and a call that masks it is no spot', () => {
    const bad = [
      'log.info({ password });',
      'log.info({ password: p });',
      'log.warn(`refreshed with ${refreshToken}`);',
      "logger.error('for ' + user.email);",
      'console.log(token);',
      'log.debug([cfg.clientSecret]);',
      'log.info(ok ? apiKey : "none");',
      'log.info({ ...{ cookie } });',
    ];
    for (const source of bad) expect(secretLogSpots('fixture.ts', source), source).toHaveLength(1);
    const fine = [
      'log.info(`token for ${mailboxId}`);',
      'log.info({ tokenUrl });',
      'log.warn(mask(token));',
      'log.info(`${tokens.length} tokens`);',
      '// log.info(password)',
      'other.info(password);',
      'log.child(password);',
    ];
    for (const source of fine) expect(secretLogSpots('fixture.ts', source), source).toHaveLength(0);
  });

  it('finds a secret handed to the logger only where PLACES says, as often as it says', () => {
    const found = spotsOnTheTree();
    const problems: string[] = [];
    for (const [file, spots] of found) {
      const place = PLACES[file];
      if (!place) problems.push(...spots.map((s) => `${file}:${s.line}: ${s.text} (not in PLACES: log an id or a count instead, or name the file with the reason this value may be printed)`));
      else if (spots.length !== place.spots) problems.push(`${file}: ${spots.length} spots, PLACES says ${place.spots}: ${spots.map((s) => s.line).join(', ')}`);
    }
    for (const file of Object.keys(PLACES)) if (!found.has(file)) problems.push(`${file}: in PLACES, and has no spot any more: take it out`);
    expect(problems).toEqual([]);
  });

  it('allows nothing the API, the worker or the appliance loads', () => {
    for (const file of Object.keys(PLACES)) expect(file, file).toMatch(/^apps\/api\/src\/scripts\//);
  });
});
