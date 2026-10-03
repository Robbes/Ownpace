// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The owner's pages keep a person's failure text and item names to themselves
 * when that person granted the account (ADR-0035 decision 5, the owner's
 * option C of 2026-10-03), and they keep them on the SERVER.
 *
 * Hiding the text in the browser would still send it: anybody signed in to the
 * organisation could read it in the network panel. So the routes withhold it,
 * and this guard reads them as text, the way the source-level guard beside
 * `a-door-that-asked-nobody` does, because they need a signed-in tenant and a
 * database to run. What it pins: the migration page's report is built with the
 * text withheld for such an account; the failure queue maps every row through
 * `withheldFailure` and says so; and the group action refuses to match a
 * substring of text it does not show, since the count it answers with would
 * otherwise read the text one guess at a time.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readsAPersonsGrant } from './whose-data.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const operating = readFileSync(join(HERE, 'operating-routes.ts'), 'utf8');
const migrations = readFileSync(join(HERE, 'index.ts'), 'utf8');

/** The body of the handler registered as `method path`, up to the next registration. */
function handler(source: string, method: 'get' | 'post', path: string): string {
  const start = source.indexOf(`router.${method}('${path}'`);
  expect(start, `no ${method.toUpperCase()} ${path} handler`).toBeGreaterThan(-1);
  const next = source.indexOf('\nrouter.', start + 1);
  return source.slice(start, next === -1 ? undefined : next);
}

describe('whose data a migration reads', () => {
  it("is a person's while their grant is held, and after they took it back", () => {
    expect(readsAPersonsGrant({ sourceSecretRef: 'enc:v1:abc', grantWithdrawnAt: null })).toBe(true);
    // The failures recorded while it held are still theirs.
    expect(readsAPersonsGrant({ sourceSecretRef: null, grantWithdrawnAt: new Date() })).toBe(true);
  });

  it("is the organisation's when nobody granted it through a link", () => {
    expect(readsAPersonsGrant({ sourceSecretRef: null, grantWithdrawnAt: null })).toBe(false);
  });
});

describe("the owner's pages, for an account a person granted", () => {
  it('reads the grant with the mapping, for every queue route', () => {
    expect(operating).toMatch(/sourceSecretRef: schema\.mailboxMapping\.sourceSecretRef/);
    expect(operating).toMatch(/grantWithdrawnAt: schema\.mailboxMapping\.grantWithdrawnAt/);
    expect(operating).toMatch(/personGranted: readsAPersonsGrant\(row\)/);
  });

  it('builds the migration page with the text withheld', () => {
    expect(migrations).toMatch(
      /buildDomainStatusReports\(domainStatus, failures, adopted, \{\s*withholdProse: readsAPersonsGrant\(mapping\),\s*\}\)/,
    );
  });

  it('serves the failure queue with every row withheld, and says so', () => {
    const get = handler(operating, 'get', '/:mappingId/failures');
    expect(get).toMatch(/s\.personGranted \? all\.map\(withheldFailure\) : all/);
    expect(get).toMatch(/needsDecision: shown\.filter/);
    expect(get).toMatch(/retrying: shown\.filter/);
    expect(get).toMatch(/s\.personGranted \? \{ textWithheld: true as const \} : \{\}/);
    // Nothing reaches the body unwithheld.
    expect(get).not.toMatch(/needsDecision: all\.filter/);
  });

  it('refuses to match a substring of the text it does not show, before matching anything', () => {
    const post = handler(operating, 'post', '/:mappingId/failures');
    const refusal = post.search(/if \(s\.personGranted && errorContains !== undefined && errorContains !== ''\)/);
    const match = post.indexOf('resolveFailureGroup(');
    expect(refusal, 'no refusal for a substring on a person-granted migration').toBeGreaterThan(-1);
    expect(match).toBeGreaterThan(refusal);
  });
});
