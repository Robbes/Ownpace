// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A FIXTURE THAT NAMED NO USER (a read-only check of the repository,
 * 2026-11-19: GEN-21 and IMG-1; workplan 0119).
 *
 * `packages/testing/fixtures/stalwart/Dockerfile` was `FROM
 * stalwartlabs/stalwart:v0.16.27` and one COPY. A check that reads a
 * Dockerfile, and not the image it builds on, took it for a container that
 * runs as root, since its last stage names no USER, and for a base that
 * floats, since its FROM carried no digest. The image does neither: its
 * base's config says `User: stalwart`, uid and gid 2000 in its /etc/passwd
 * (read at the index digest on 2026-11-19, at v1.1.1's on 2026-11-20, and at
 * v1.1.1's Alpine build's on 2026-11-23, the same). And nothing builds the
 * file. It
 * is the `stalwart-test-custom` image of 2026-07-05; the integration tests
 * (`packages/testing/src/testcontainers-setup.ts`) and `setup-stalwart.sh`
 * start the official image itself, as root on purpose
 * (docs/stalwart-integration-fix.md, Round 4).
 *
 * So the file says what the image does: its FROM by the pin's tag and the
 * digest of the tag's index (`a-float-nothing-ever-pulled` holds every
 * Dockerfile to a digest), and its last USER the base's own, by number
 * (hadolint's DL3066: a name is not resolvable by the host). This holds the
 * USER, and that the tag is the pin the other copies name, which moves only by
 * ADR-0022 ("Moving the pin" in the fix doc, which names this file).
 *
 * What it did not change: the image the tests ran, whose scan read Debian
 * 13's brotli 1.1.0-2 (CVE-2026-111497, on CISA's list of exploited
 * vulnerabilities, fixed in 1.1.0-2+deb13u1), apt 3.0.3 and zlib at
 * v0.16.27, the last v0.16. The owner took another line for that: the pin is
 * v1.1.1 (ADR-0022, 2026-11-20), whose image carries brotli 1.1.0-2+deb13u1
 * and apt 3.0.4, and zlib 1:1.3.dfsg+really1.3.1-1+b1 still unfixed. Since
 * 2026-11-23 it is v1.1.1's Alpine build (ADR-0022 of that date), the same
 * release on Alpine 3.24, with no krb5 and zlib 1.3.2-r1: the tag a copy names
 * may end in `-alpine`, and every copy names the same one.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), 'utf8');

export const FIXTURE = 'packages/testing/fixtures/stalwart/Dockerfile';
/** The base's own user, `stalwart`, by number: its config's `User`, resolved in its /etc/passwd. */
export const BASE_USER = '2000:2000';

/** Instruction lines, comments and blank lines left out, continuation lines joined. */
function instructions(text: string): string[] {
  const out: string[] = [];
  let open = '';
  for (const raw of text.split('\n')) {
    if (open === '' && /^\s*(#|$)/.test(raw)) continue;
    const line = open + raw;
    if (/\\\s*$/.test(raw)) {
      open = line.replace(/\\\s*$/, ' ');
      continue;
    }
    open = '';
    out.push(line.trim());
  }
  return out;
}

/** What is wrong with the fixture's Dockerfile, given the tag the other copies pin; empty when it holds. */
export function fixtureProblems(text: string, pin: string): string[] {
  const problems: string[] = [];
  const lines = instructions(text);
  const froms = lines.filter((l) => /^FROM\s/i.test(l));
  if (froms.length !== 1) return [`${FIXTURE} has ${froms.length} FROM lines, not one`];
  const from = /^FROM\s+(\S+)$/i.exec(froms[0]!)?.[1] ?? '';
  const ref = /^stalwartlabs\/stalwart:(v\d+\.\d+\.\d+(?:-alpine)?)@sha256:[0-9a-f]{64}$/.exec(from);
  if (!ref) problems.push(`${FIXTURE}'s FROM is ${from}, not stalwartlabs/stalwart by its tag and the digest of the tag's index`);
  else if (ref[1] !== pin) problems.push(`${FIXTURE} pins ${ref[1]}, and the other copies ${pin}: the pin moves in every copy together (ADR-0022)`);
  const users = lines.map((l, i) => ({ l, i })).filter(({ l }) => /^USER\s/i.test(l));
  const last = users.at(-1);
  if (!last) {
    problems.push(`${FIXTURE} names no USER, so a reading of the file takes it for a container that runs as root: say the base's, USER ${BASE_USER}`);
  } else {
    const user = last.l.replace(/^USER\s+/i, '');
    if (user !== BASE_USER) problems.push(`${FIXTURE}'s last USER is ${user}, not the base's own stalwart by number, ${BASE_USER}`);
    if (last.i < lines.indexOf(froms[0]!)) problems.push(`${FIXTURE}'s USER comes before its FROM, where no stage has begun`);
  }
  return problems;
}

/** The tag the integration tests and setup-stalwart.sh start, which must be one. */
function pinOfTheCopies(): string {
  const tags = new Set<string>();
  for (const file of ['packages/testing/src/testcontainers-setup.ts', 'deploy/selfhost/setup-stalwart.sh']) {
    for (const m of read(file).matchAll(/stalwartlabs\/stalwart:(v\d+\.\d+\.\d+(?:-alpine)?)/g)) tags.add(m[1]!);
  }
  expect([...tags], 'the integration tests and setup-stalwart.sh name one Stalwart tag').toHaveLength(1);
  return [...tags][0]!;
}

describe('the Stalwart fixture says what its image does', () => {
  const text = read(FIXTURE);
  const pin = pinOfTheCopies();

  it("its base by the pin and the digest of its index, and its last USER the base's, by number", () => {
    expect(fixtureProblems(text, pin)).toEqual([]);
  });

  it('fails a fixture that names no USER, root, a name, or another uid', () => {
    const without = text.replace(/^USER .*\n/m, '');
    expect(fixtureProblems(without, pin)).toEqual([expect.stringContaining('names no USER')]);
    for (const user of ['root', '0', '0:0', 'stalwart', '2000']) {
      expect(fixtureProblems(text.replace(/^USER .*$/m, `USER ${user}`), pin), user).toEqual([expect.stringContaining(`last USER is ${user}`)]);
    }
  });

  it('fails a base by tag alone, another image, another tag than the copies, or a USER before the FROM', () => {
    expect(fixtureProblems(text.replace(/@sha256:[0-9a-f]{64}/, ''), pin)).toEqual([expect.stringContaining('not stalwartlabs/stalwart by its tag and the digest')]);
    expect(fixtureProblems(text.replace('stalwartlabs/stalwart:', 'example/stalwart:'), pin)).toEqual([expect.stringContaining('not stalwartlabs/stalwart')]);
    expect(fixtureProblems(text, 'v0.16.999')).toEqual([expect.stringContaining('every copy together')]);
    // The Debian build of the same release, while the copies run the Alpine one, is another tag.
    const debian = text.replace(/(stalwartlabs\/stalwart:v\d+\.\d+\.\d+)-alpine@/, '$1@');
    expect(debian).not.toBe(text);
    expect(fixtureProblems(debian, pin)).toEqual([expect.stringContaining('every copy together')]);
    const early = `USER ${BASE_USER}\n${text.replace(/^USER .*\n/m, '')}`;
    expect(fixtureProblems(early, pin)).toEqual([expect.stringContaining('before its FROM')]);
  });
});
