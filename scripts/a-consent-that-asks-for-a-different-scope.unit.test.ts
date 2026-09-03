// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A CONSENT AND A TOKEN REQUEST THAT DISAGREE FAIL HOURS APART.
 *
 * Workplan 0114 T4. The Microsoft grant asks a user to consent to a set of
 * Graph scopes; a sync pass later asks Entra to mint an access token for a set
 * of Graph scopes. THOSE ARE TWO LISTS, in three files, in two packages:
 *
 *   apps/api/.../microsoft-consent.ts      MICROSOFT_DOMAIN_SCOPES   (consent)
 *   packages/orchestration/.../graph-domain-source-factory.ts
 *                                          DELEGATED_SCOPES          (sync)
 *   packages/orchestration/.../mail-source-factory.ts
 *                                          the mail scope, inline    (sync)
 *
 * When they agree, nothing happens, which is why nobody notices when they
 * stop. When they disagree the consent SUCCEEDS — the user clicks, the
 * refresh token is stored, the connection tests green — and the failure
 * arrives at the first sync pass, as an Entra refusal about a scope the user
 * was never asked for. The distance between the two events is the whole
 * problem: the person who would recognise the cause is not in the room by
 * then.
 *
 * T4 was written expecting to WIRE the token through. It turned out the
 * plumbing already existed — `graph-domain-source-factory` and
 * `mail-source-factory` both choose the delegated flow when a refresh token is
 * present, for all four domains. So the task became this instead: pin the two
 * lists to each other, because the thing that was actually missing was
 * anything stopping them drifting.
 *
 * Read as TEXT: three files in two packages, and what is being compared is a
 * pair of literals rather than a runtime value. Importing them would prove the
 * imports resolve, not that the strings match.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/**
 * The file with its comments removed.
 *
 * NECESSARY, not tidiness — and the third time this repository has learned it
 * (#749, #752). Every one of these files explains its scope choice by naming
 * the scope it did NOT take: the consent says why `Files.Read` rather than
 * `Files.Read.All`, and why `Tasks.Read` waits for 0114 T9. A matcher reading
 * raw text finds both, reports drift that does not exist, and the fix is to
 * delete the explanation — which is the worst possible outcome for a guard.
 *
 * A comment is prose about code, never code.
 */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

const read = (p: string) => code(readFileSync(join(REPO_ROOT, p), 'utf8'));

const CONSENT = 'apps/api/src/routes/migrations/microsoft-consent.ts';
const DOMAIN_FACTORY = 'packages/orchestration/src/graph-domain-source-factory.ts';
const MAIL_FACTORY = 'packages/orchestration/src/mail-source-factory.ts';

/** Every `Something.Read`-shaped Graph permission named in a file. */
function graphScopesIn(text: string): Set<string> {
  return new Set([...text.matchAll(/\b([A-Z][A-Za-z]+\.Read(?:Write)?(?:\.All)?)\b/g)].map((m) => m[1]!));
}

describe('the consent and the sync ask for the same Graph scopes', () => {
  it('finds scopes in all three files — this guard is not passing vacuously', () => {
    // Every assertion below is "the sets match", and two empty sets match. The
    // control is that each file still names scopes in a shape this recognises.
    expect(graphScopesIn(read(CONSENT)).size, `${CONSENT} names no Graph scopes`).toBeGreaterThan(0);
    expect(
      graphScopesIn(read(DOMAIN_FACTORY)).size,
      `${DOMAIN_FACTORY} names no Graph scopes`,
    ).toBeGreaterThan(0);
    expect(
      graphScopesIn(read(MAIL_FACTORY)).size,
      `${MAIL_FACTORY} names no Graph scopes`,
    ).toBeGreaterThan(0);
  });

  it('every scope the consent asks for is one the sync side requests', () => {
    const consent = graphScopesIn(read(CONSENT));
    const sync = new Set([...graphScopesIn(read(DOMAIN_FACTORY)), ...graphScopesIn(read(MAIL_FACTORY))]);

    const asked = [...consent].filter((s) => !sync.has(s)).sort();
    expect(
      asked,
      'the consent asks the user for scopes no sync path requests. The grant will succeed and ' +
        'the migration will fail at its first pass, hours later, with an Entra refusal about a ' +
        'permission nobody was asked for. Add the scope to the factory, or stop asking for it',
    ).toEqual([]);
  });

  it('every scope the sync requests is one the consent asked for', () => {
    // The other direction, and the more dangerous one: a token minted for a
    // scope the user never saw on a consent screen is a permission they did
    // not knowingly grant.
    const consent = graphScopesIn(read(CONSENT));
    const sync = new Set([...graphScopesIn(read(DOMAIN_FACTORY)), ...graphScopesIn(read(MAIL_FACTORY))]);

    const unrequested = [...sync].filter((s) => !consent.has(s)).sort();
    expect(
      unrequested,
      'a sync path requests a Graph scope the consent never asked the user for. Either the ' +
        'consent must ask for it — so the person sees it on the screen they approve — or the ' +
        'factory must stop requesting it',
    ).toEqual([]);
  });

  it('nothing on either side can write', () => {
    // 0114 T0's decision, pinned where it can be broken. A migration reads.
    const all = new Set([
      ...graphScopesIn(read(CONSENT)),
      ...graphScopesIn(read(DOMAIN_FACTORY)),
      ...graphScopesIn(read(MAIL_FACTORY)),
    ]);
    const writers = [...all].filter((s) => s.includes('ReadWrite')).sort();
    expect(
      writers,
      'a ReadWrite Graph scope appeared. A migration reads, and a token that cannot write is ' +
        'the cheapest guarantee of that (0114 T0)',
    ).toEqual([]);
  });
});
