// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A TAG THAT FLOATS, AND THAT NOTHING EVER PULLS AGAIN, RUNS WHATEVER COPY THE
 * MACHINE PULLED FIRST (workplan 0119 §4; the lifecycle survey of 2026-10-21).
 *
 * `postgres:18-alpine`, `redis:7.4-bookworm`, `caddy:2-alpine`,
 * `nextcloud:34-apache` and `nginx:1.31-alpine` floated within their lines on
 * purpose, so that both managed stacks would take their patches. 0119 §4 said
 * so, and so did the comment beside the `latest` guard in
 * `bootstrap-managed.unit.test.ts`. Nothing took them. Compose pulls only an
 * image the machine does not have, nothing in the bring-up, `deploy-live.sh`
 * or the gates ran `docker compose pull`, and the web image is built with
 * `up --build` and no `--pull`. Both stacks, both sites and the runner share
 * one Docker daemon, so all of them ran whatever copy was pulled first, and
 * nothing recorded which: the security fixes in PostgreSQL 18.6 (2026-08-13)
 * could be missing from the databases that hold testers' data, and 0119 §4's
 * "the bring-up records what it pulled" was not true either.
 *
 * Since 2026-10-22 each is pinned by its exact version and its index digest,
 * and moves by a pull request that E2E (managed) proves on its branch; live
 * takes it from a release tag, and `up` pulls a digest the machine does not
 * have. Dependabot reads no file in `deploy/compose`: the weekly pin watch
 * (`scripts/idp-pin-watch.mjs`) says when a newer tag is listed, and the
 * weekly image scan (`scripts/image-scan.mjs`) counts the findings a newer
 * package fixes, which is when a rebuild under the same tag is worth its new
 * digest. Dependabot moves the FROM lines of `apps/web/Dockerfile`, tag and
 * digest. This holds four things:
 *
 *  - no image line of `deploy/compose/managed.yml`, `deploy/compose/dev.yml`
 *    or `deploy/compose/www.yml` floats within its line, by the image scan's
 *    own test (`isFloating` in `scripts/image-scan.mjs`: no digest and fewer
 *    than three numbers), unless it is named below with its reason;
 *  - every FROM of an outside image in `apps/*\/Dockerfile` carries a digest,
 *    which `.github/dependabot.yml` says they all do, and the web image's
 *    nginx did not;
 *  - the integration tests' Postgres and Nextcloud
 *    (`packages/testing/src/testcontainers-setup.ts`) are the dev stack's.
 *    The pin watch reads `dev.yml` and not that file, so a copy there that
 *    drifted would freeze unseen. And the dev stack's are `managed.yml`'s:
 *    every postgres line there names one reference, and so does every
 *    nextcloud line, and `dev.yml` names the same. The pin watch compares
 *    tags, not digests, so a rebuild moved in `managed.yml` and missed in
 *    `dev.yml` would leave the dev stack and the integration tests on the old
 *    build with nothing to say so; Nextcloud's move of 2026-10-25 was one;
 *  - a Postgres built here (`localhost/postgres`, workplan 0146 T15) is held
 *    by its Dockerfile's FROM, `deploy/compose/postgres/Dockerfile`, which
 *    carries the official image's exact version and index digest: the lines
 *    above are read through it, and the integration tests start that base;
 *  - `managed.yml`'s postgres lines end at the reference. `stand-up-live.sh`
 *    takes everything after `image:` on the first of them as the image it asks
 *    live's database with, so a `# comment` there, the way `dev.yml` writes
 *    its lines, would reach `docker run` as part of the reference, and every
 *    check of live's passwords would fail. (`db-roles.sh` stops at the
 *    reference since 2026-10-22.)
 *
 * `deploy/compose/db-roles.sh` asks with the postgres image `managed.yml`
 * runs, read from that file; `rotate-db-passwords.unit.test.ts` holds it there.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMPOSE_FILES, builtImage, parseRef, readImages, repoReader } from './idp-pin-watch.mjs';
import { isFloating } from './image-scan.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), 'utf8');
const REPO = repoReader(REPO_ROOT);
/** An image line as its pins are: a build's are its Dockerfile's FROM (`localhost/postgres`). */
const pinned = (file: string, image: ReturnType<typeof readImages>[number]) => ({ ...(builtImage(REPO, file, image)?.base ?? image), line: image.line });

/**
 * Lines that still float, by repository, each with the reason it is not
 * pinned here. A listed one that is pinned since fails too, so the list
 * cannot rot in either direction.
 */
const NAMED_FLOATS: Readonly<Record<string, string>> = {
  busybox:
    'a one-shot chown of a volume (zitadel-machinekey) and the throwaway helpers four scripts run by hand, with no ' +
    "network and nothing it serves; the scripts name the same tag, the pin watch's busybox row holds them to this " +
    "line and says when a newer one is listed, and pinning it is a pull request of its own, every copy together",
};

const DIGEST = /^sha256:[0-9a-f]{64}$/;

describe('no image line of the deploy/compose stacks floats within its line', () => {
  const lines = COMPOSE_FILES.flatMap((file) => readImages(read(file)).map((image) => ({ file, ...pinned(file, image) })));

  it('read the image lines of the three files the pin watch reads', () => {
    // A reader that matches nothing passes everything below.
    expect(COMPOSE_FILES).toEqual(['deploy/compose/managed.yml', 'deploy/compose/dev.yml', 'deploy/compose/www.yml']);
    for (const file of COMPOSE_FILES) expect(lines.some((l) => l.file === file), `no image line in ${file}`).toBe(true);
    for (const repo of ['postgres', 'redis', 'caddy', 'nextcloud', 'nginx']) {
      expect(lines.some((l) => l.repo === repo), `no ${repo} image line`).toBe(true);
    }
  });

  it('every float is a named one, and every named one still floats', () => {
    const floating = [...new Set(lines.filter((l) => isFloating(l)).map((l) => l.repo))].sort();
    expect(
      floating,
      'A tag without a digest and with fewer than three numbers runs whatever copy the machine pulled first: ' +
        'nothing pulls it again. Pin it by its exact version and index digest, or name it in NAMED_FLOATS with its reason.',
    ).toEqual(Object.keys(NAMED_FLOATS).sort());
    for (const [repo, reason] of Object.entries(NAMED_FLOATS)) expect(reason.length, `${repo} gives no reason`).toBeGreaterThan(60);
  });

  it("managed.yml's postgres lines end at the reference, which stand-up-live.sh reads to the end of the line", () => {
    const postgres = read('deploy/compose/managed.yml')
      .split('\n')
      .map((text, i) => ({ text, line: i + 1 }))
      .filter((l) => /^\s*image:\s*(?:localhost\/)?postgres:/.test(l.text));
    expect(postgres.length, 'managed.yml names no postgres image').toBeGreaterThan(0);
    for (const { text, line } of postgres) {
      expect(text, `managed.yml:${line} carries more than the reference after image:`).toMatch(/^\s*image:\s*\S+\s*$/);
      expect(text, `managed.yml:${line} carries a comment after the reference`).not.toContain('#');
    }
  });

  it('the stores and fronts carry their exact version and their index digest', () => {
    // How many numbers an exact version of each has: PostgreSQL's releases are
    // `18.6` since version 10, so `18` is its line; `7.4` is Redis's.
    const EXACT: Readonly<Record<string, number>> = { postgres: 2, redis: 3, caddy: 3, nextcloud: 3, nginx: 3 };
    for (const [repo, numbers] of Object.entries(EXACT)) {
      for (const line of lines.filter((l) => l.repo === repo)) {
        const where = `${line.file}:${line.line} (${line.ref})`;
        expect((line.tag.match(/\d+/g) ?? []).length, `${where} names its line, not an exact version`).toBeGreaterThanOrEqual(numbers);
        expect(line.digest, `${where} carries no index digest`).toMatch(DIGEST);
      }
    }
  });
});

describe("every outside image an app's Dockerfile builds on carries a digest", () => {
  const dockerfiles = readdirSync(join(REPO_ROOT, 'apps'))
    .map((app) => `apps/${app}/Dockerfile`)
    .filter((p) => existsSync(join(REPO_ROOT, p)));

  /** Each FROM's image, with the stages declared before it left out: `FROM base AS build` builds on no outside image. */
  const bases = dockerfiles.flatMap((file) => {
    const stages = new Set<string>();
    const found: Array<{ file: string; ref: string }> = [];
    for (const m of read(file).matchAll(/^FROM\s+(?:--\S+\s+)*(\S+)(?:\s+AS\s+(\S+))?\s*$/gim)) {
      if (!stages.has(m[1]!.toLowerCase())) found.push({ file, ref: m[1]! });
      if (m[2]) stages.add(m[2].toLowerCase());
    }
    return found;
  });

  it('found the three images and their bases', () => {
    expect(dockerfiles).toEqual(expect.arrayContaining(['apps/api/Dockerfile', 'apps/selfhost/Dockerfile', 'apps/web/Dockerfile']));
    expect(bases.filter((b) => b.file === 'apps/web/Dockerfile').map((b) => parseRef(b.ref).repo)).toEqual(['node', 'nginx']);
  });

  it('each is tag and digest, which Dependabot moves together', () => {
    for (const { file, ref } of bases) {
      const image = parseRef(ref);
      expect(image.tag, `${file}: FROM ${ref} names no tag, so Dependabot has no version to compare`).not.toBe('');
      expect(image.digest, `${file}: FROM ${ref} carries no digest, so the build takes whatever copy the machine has`).toMatch(DIGEST);
    }
  });
});

describe("the dev stack runs managed.yml's Postgres and Nextcloud", () => {
  const managed = readImages(read('deploy/compose/managed.yml'));
  const dev = readImages(read('deploy/compose/dev.yml'));

  // Postgres is built here since 0146 T15: the same name, and so the same Dockerfile.
  for (const repo of ['localhost/postgres', 'nextcloud']) {
    it(repo, () => {
      const refs = [...new Set(managed.filter((i) => i.repo === repo).map((i) => i.ref))];
      expect(
        refs,
        `managed.yml names ${refs.length} ${repo} references, not one: its ${repo} lines move together`,
      ).toHaveLength(1);
      const ours = dev.filter((i) => i.repo === repo).map((i) => i.ref);
      expect(ours.length, `dev.yml runs ${ours.length} ${repo} images, not one`).toBe(1);
      expect(
        ours[0],
        `dev.yml runs ${ours[0]} while managed.yml runs ${refs[0]}: move both together, since the pin watch ` +
          'compares tags and not digests, and a rebuild missed here is one nothing reports',
      ).toBe(refs[0]);
    });
  }
});

describe("the integration tests run the dev stack's Postgres and Nextcloud", () => {
  const setup = read('packages/testing/src/testcontainers-setup.ts');
  // dev.yml's Postgres is built (0146 T15): the integration tests start its base.
  const dev = readImages(read('deploy/compose/dev.yml')).map((image) => ({ ...pinned('deploy/compose/dev.yml', image), ref: builtImage(REPO, 'deploy/compose/dev.yml', image)?.base.ref ?? image.ref }));

  for (const repo of ['postgres', 'nextcloud']) {
    it(repo, () => {
      const started = [...setup.matchAll(new RegExp(`new GenericContainer\\('(${repo}:[^']+)'\\)`, 'g'))].map((m) => m[1]!);
      expect(started.length, `testcontainers-setup.ts starts no ${repo}`).toBe(1);
      const ours = dev.filter((i) => i.repo === repo).map((i) => i.ref);
      expect(ours.length, `dev.yml runs no ${repo}`).toBe(1);
      expect(
        started[0],
        `testcontainers-setup.ts starts ${started[0]} while dev.yml runs ${ours[0]}: move both together, since the pin watch reads dev.yml only`,
      ).toBe(ours[0]);
    });
  }
});
