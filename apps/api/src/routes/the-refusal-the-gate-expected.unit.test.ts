// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE GATE ASSERTS ON A REFUSAL'S SHAPE, AND THE REFUSAL IS WRITTEN HERE.
 *
 * `smoke-managed.sh` asks the Nextcloud door two questions whose expected
 * answers are typed into the script as literals: a connection posted without
 * its base URL must come back `missing_fields ["url"]`, and a mapping posted
 * with no address at all must be refused on `targetConfig.url` ALONE — not on
 * a host, which is the field that door stopped asking for (2026-09-07).
 *
 * Those literals are a copy of what this API answers, in a file the API's own
 * tests never read. Add a required field to the `nextcloud` descriptor, or
 * widen the create schema's address check, and both stay green here while the
 * nightly gate goes red at 3am on a diff whose author had no way to see it
 * coming. Half a day, and the fix is a one-character edit to a shell string.
 *
 * So the two sources are compared at PR time: the script's literal against
 * what the descriptor and the schema actually produce, computed by running
 * them. This does not re-test the refusals — `create-coherence` and the
 * descriptor's own suite do that. It tests that the GATE IS ASKING FOR THE
 * ANSWER THIS CODE GIVES.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { credentialFieldsFor } from '@openmig/shared';
import { CreateMappingSchema } from './migrations/index.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const SMOKE = readFileSync(join(ROOT, 'deploy/compose/smoke-managed.sh'), 'utf8');

/**
 * The literal the script COMPARES AGAINST, found by its comparison rather than
 * by its variable: the same name appears on the line that fills it and on a
 * `|| echo '[]'` fallback, and matching either of those would pin a string
 * that decides nothing.
 */
const smokeExpects = (variable: string): string => {
  const marker = `"$${variable}" = `;
  const line = SMOKE.split('\n').find((l) => l.includes(marker));
  if (!line) throw new Error(`the gate no longer compares $${variable} to anything`);
  const quoted = /'(\[[^']*\])'/.exec(line.slice(line.indexOf(marker)));
  if (!quoted) throw new Error(`no bracketed literal beside $${variable}: ${line.trim()}`);
  return quoted[1] as string;
};

describe('the Nextcloud refusals the managed gate asserts on', () => {
  it('answers the connection door exactly the fields the gate expects', () => {
    // The route's own filter, with the values the gate posts: a host, a port,
    // an account and a password — everything except the one field this door
    // is reached by.
    const values: Record<string, string> = {
      host: 'nextcloud.example.invalid',
      port: '443',
      username: 'u',
      password: 'p',
    };
    const missing = credentialFieldsFor('target', 'nextcloud')
      .filter((f) => f.required && !values[f.key]?.trim())
      .map((f) => f.key);

    expect(JSON.stringify(missing)).toBe(smokeExpects('nc_missing'));
  });

  it('refuses a mapping with no address on exactly the paths the gate expects', () => {
    const parsed = CreateMappingSchema.safeParse({
      name: 'gate: nextcloud with no address',
      sourceType: 'dropbox',
      sourceConfig: {
        username: 'gate@example.invalid',
        clientId: 'gate-app-key',
        clientSecret: 'gate-app-secret',
        refreshToken: 'gate-refresh-token',
      },
      targetType: 'nextcloud',
      targetConfig: { username: 'u', password: 'p' },
      syncConfig: { domains: ['file'] },
    });

    expect(parsed.success, 'a nextcloud target with no address was accepted').toBe(false);
    const paths = [
      ...new Set((parsed.error as z.ZodError).issues.map((i) => i.path.join('.'))),
    ];
    expect(JSON.stringify(paths)).toBe(smokeExpects('nc_paths'));
    // And the sentence the gate greps for, which is the half a person reads.
    const message = (parsed.error as z.ZodError).issues.map((i) => i.message).join(' ');
    expect(message).toContain('/remote.php/dav');
  });

  it('accepts the shape the gate creates with, so the positive half can pass', () => {
    // The body in the script, minus the URL it builds from the live stack's
    // own address. If this stops parsing, the gate's create stops being a
    // test of the loosened schema and becomes a test of something else.
    const parsed = CreateMappingSchema.safeParse({
      name: 'gate: nextcloud target',
      sourceType: 'dropbox',
      sourceConfig: {
        username: 'gate@example.invalid',
        clientId: 'gate-app-key',
        clientSecret: 'gate-app-secret',
        refreshToken: 'gate-refresh-token',
      },
      targetType: 'nextcloud',
      targetConfig: {
        url: 'http://nextcloud.example:8083/remote.php/dav',
        username: 'u',
        password: 'p',
      },
      syncConfig: { domains: ['file'] },
    });

    expect(
      parsed.success,
      parsed.success ? '' : JSON.stringify(parsed.error?.issues.map((i) => i.message)),
    ).toBe(true);
  });
});
