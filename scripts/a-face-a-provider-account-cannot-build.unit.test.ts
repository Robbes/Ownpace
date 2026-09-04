// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A FACE A PROVIDER ACCOUNT ADVERTISES AND CANNOT BUILD FAILS INSIDE A PASS.
 *
 * Workplan 0114 T5a. `PROVIDER_ACCOUNT_DOMAINS` is a promise made on a
 * screen: it decides which faces a person may tick when they add a Google,
 * Soverin or Microsoft account, and the wizard renders those ticks. Until
 * this guard, nothing paired that promise against the code that has to keep
 * it.
 *
 * **The gap was real.** `microsoft` claimed four faces from the day 0114 T3
 * added its row, and `build-deps-from-mapping` could build one of them. The
 * calendar and contact seams read `googleDavServes(kind, …) ? Google : DAV`;
 * the file seam read `dropbox / box / Drive / DAV`. Every one of those is a
 * two-way condition, and Microsoft is the third provider — so the account row
 * took the last branch, was handed to `davEndpointFromCreds`, and was refused
 * for a missing username and password. **Credentials that do not exist for an
 * OAuth provider**, named from inside a sync pass, hours after the connection
 * tested green.
 *
 * ## Why the distance matters more than the error
 *
 * A refusal at build time names a field and a remedy. That one said "missing
 * credentials" and named two fields nobody had been asked for. The person
 * reading it has no route back to the cause — a row added to one table and
 * not another, weeks earlier, by somebody with every reason to think a row
 * was all it took.
 *
 * ## Why TEXT, and why both directions
 *
 * Two files in two packages, and what is being compared is a pair of table
 * literals. Importing them would prove the imports resolve.
 *
 * Both directions, because they fail differently. **A claimed face with no
 * builder** is the defect above: advertised, ticked, dead at the first pass.
 * **A builder for an unclaimed face** is quieter and still worth catching: it
 * is a row somebody wrote for a face the product does not offer, so it has
 * never run, and it will be trusted the day the face is claimed.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The file with its comments removed.
 *
 * The FOURTH time this repository has needed this (#749, #752, and 0114 T4's
 * scope guard). Both files here explain their tables by naming faces they do
 * NOT carry: `PROVIDER_ACCOUNT_DOMAINS` says why `task` is absent from
 * Microsoft and why mail and files are absent from Google;
 * `ACCOUNT_FACE_BUILDERS` says why Soverin's `task` is the calendar builder.
 * Read raw, a matcher finds those and reports a disagreement that does not
 * exist — and the cheapest way to make it pass is to delete the explanation.
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

const ACCOUNTS = 'packages/shared/src/provider-accounts.ts';
const BUILDERS = 'packages/orchestration/src/source-face-builders.ts';

/** The `kind: [...]` rows of a named array-of-domains table. */
function claimedFaces(text: string, table: string): Map<string, Set<string>> {
  const block = text.slice(text.indexOf(`const ${table}`));
  const body = block.slice(block.indexOf('{') + 1, block.indexOf('\n};'));
  const rows = new Map<string, Set<string>>();
  for (const m of body.matchAll(/^\s*(\w+):\s*\[([^\]]*)\]/gm)) {
    rows.set(m[1]!, new Set([...m[2]!.matchAll(/'([a-z]+)'/g)].map((d) => d[1]!)));
  }
  return rows;
}

/** The `kind: { face: 'builder' }` rows of the builder table. */
function builtFaces(text: string, table: string): Map<string, Set<string>> {
  const block = text.slice(text.indexOf(`const ${table}`));
  const body = block.slice(block.indexOf('{') + 1, block.indexOf('\n};'));
  const rows = new Map<string, Set<string>>();
  for (const m of body.matchAll(/(\w+):\s*\{([^}]*)\}/g)) {
    rows.set(m[1]!, new Set([...m[2]!.matchAll(/^\s*(\w+):/gm)].map((d) => d[1]!)));
  }
  return rows;
}

/** Google's ceiling is BOTH its lists: the default two, plus what a restricted client unlocks. */
function everyClaimedFace(): Map<string, Set<string>> {
  const text = read(ACCOUNTS);
  const claimed = claimedFaces(text, 'PROVIDER_ACCOUNT_DOMAINS');
  const restricted = new Set(
    [...read(ACCOUNTS).matchAll(/GOOGLE_RESTRICTED_ACCOUNT_DOMAINS[^=]*=\s*\[([^\]]*)\]/g)].flatMap(
      (m) => [...m[1]!.matchAll(/'([a-z]+)'/g)].map((d) => d[1]!),
    ),
  );
  const google = claimed.get('google');
  if (google) for (const face of restricted) google.add(face);
  return claimed;
}

describe('every face a provider account claims has a builder', () => {
  it('finds both tables and their rows — this guard is not passing vacuously', () => {
    // Every assertion below iterates rows, and no rows iterate to nothing.
    // The control is that both tables are still shaped as this reads them.
    const claimed = everyClaimedFace();
    const built = builtFaces(read(BUILDERS), 'ACCOUNT_FACE_BUILDERS');
    expect(claimed.size, `${ACCOUNTS} yielded no provider account rows`).toBeGreaterThan(1);
    expect(built.size, `${BUILDERS} yielded no builder rows`).toBeGreaterThan(1);
    for (const [kind, faces] of claimed) {
      expect(faces.size, `${kind} claims no faces at all`).toBeGreaterThan(0);
    }
    expect(
      claimed.get('google')?.has('email'),
      'the restricted list was not folded into Google’s ceiling',
    ).toBe(true);
  });

  it('every face a provider account claims resolves to a builder', () => {
    const claimed = everyClaimedFace();
    const built = builtFaces(read(BUILDERS), 'ACCOUNT_FACE_BUILDERS');

    const stranded: string[] = [];
    for (const [kind, faces] of claimed) {
      for (const face of faces) if (!built.get(kind)?.has(face)) stranded.push(`${kind}.${face}`);
    }
    expect(
      stranded.sort(),
      'a provider account advertises a face on the wizard that no builder speaks for. It will ' +
        'be ticked, saved, tested green, and refused inside the first sync pass for credentials ' +
        `this provider has no concept of. Add the row to ACCOUNT_FACE_BUILDERS in ${BUILDERS}, ` +
        `or stop claiming the face in ${ACCOUNTS}`,
    ).toEqual([]);
  });

  it('no builder speaks for a face its provider account does not claim', () => {
    const claimed = everyClaimedFace();
    const built = builtFaces(read(BUILDERS), 'ACCOUNT_FACE_BUILDERS');

    const unclaimed: string[] = [];
    for (const [kind, faces] of built) {
      for (const face of faces) if (!claimed.get(kind)?.has(face)) unclaimed.push(`${kind}.${face}`);
    }
    expect(
      unclaimed.sort(),
      'a builder row exists for a face the product does not offer, so nothing has ever run it. ' +
        'Either claim the face in PROVIDER_ACCOUNT_DOMAINS — where the wizard will render it and ' +
        'a measured record will judge it — or drop the row',
    ).toEqual([]);
  });

  it('the account kinds in both tables are the same kinds', () => {
    // The failure underneath both directions above: a kind present in one
    // table and absent from the other passes every per-face check by
    // iterating nothing.
    const claimed = [...everyClaimedFace().keys()].sort();
    const built = [...builtFaces(read(BUILDERS), 'ACCOUNT_FACE_BUILDERS').keys()].sort();
    expect(built, 'the builder table and the account table name different providers').toEqual(claimed);
  });
});
