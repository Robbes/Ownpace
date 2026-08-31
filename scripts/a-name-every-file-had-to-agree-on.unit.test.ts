// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The self-host dev stack's docker identifiers, and the ten files that have to
 * agree on them.
 *
 * ## Why this is a test and not a careful rename
 *
 * A container, volume or network name is a handshake between a file that
 * CREATES it and a file that later finds it — and the two are never next to
 * each other. `setup-stalwart.sh` creates `ownpace-dev-stalwart`; `e2e.yml`
 * removes it forty seconds into a run it did not write; `dev.yml` declares the
 * network all of them join; three documents tell a human which to type.
 *
 * Every one of those is a plain string, and docker's failure mode for a
 * mismatched one is SILENCE. `docker rm -f <name that does not exist>` is a
 * no-op, and the line has `|| true` after it because a first run has nothing
 * to remove — so a cleanup step that names the wrong container reports success
 * having removed nothing, and the next run inherits the residue it was written
 * to prevent. Nothing goes red. The gate simply gets slower and then flaky.
 *
 * Renaming these was what made the risk concrete, but the risk is not the
 * rename: it is that this repository has ten files holding one string in
 * common with nothing checking that they still do. The rename is over in a
 * commit. This outlives it.
 *
 * ## What it does NOT claim
 *
 * That the gate passes. It cannot start docker, and internal agreement is not
 * the same as a working stack — it is the half that is checkable without one,
 * and the half a partial rename gets wrong.
 */

import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string): string => readFileSync(join(REPO, p), 'utf-8');

/** The canonical names. Changing one here should fail this file until every participant follows. */
const DEV = {
  network: 'ownpace_dev-network',
  stalwart: 'ownpace-dev-stalwart',
  stalwartData: 'ownpace-dev-stalwart-data',
  stalwartConfig: 'ownpace-dev-stalwart-config',
  nextcloud: 'ownpace-dev-nextcloud',
} as const;

/**
 * Every file that names one of the above. A file added to the stack and left
 * out of this list is not guarded — which is why the last test asks the
 * REPOSITORY rather than this list whether anything still says the old name.
 */
const PARTICIPANTS = [
  'deploy/compose/dev.yml',
  'deploy/compose/dev.ci.yml',
  'deploy/selfhost/compose.dev.yml',
  'deploy/selfhost/setup-stalwart.sh',
  'deploy/selfhost/setup-nextcloud-users.sh',
  '.github/workflows/e2e.yml',
  'test/e2e/selfhost-backup-restore.e2e.test.ts',
  'docs/testing.md',
  'docs/stalwart-integration-fix.md',
  'docs/managed-bring-up.md',
] as const;

/**
 * A line carrying this marker may name a PRE-RENAME identifier on purpose.
 *
 * The gate's runner has long-lived containers and volumes under the old names.
 * Renaming without removing them does not tidy anything up — it abandons them,
 * because the new cleanup looks for names that were never there. So the sweep
 * keeps both for a while, and says so on the line rather than in a commit
 * message nobody reads from inside a YAML file.
 *
 * Prose carries it too, in an HTML comment so it renders as nothing: a runbook
 * telling somebody what a thing USED to be called is the one place naming the
 * old generation is the whole point. `docs/managed-bring-up.md` is that case —
 * it warns an operator cleaning up an even older family not to take the dev
 * stack with it, and that warning is useless if it cannot say both names.
 */
const LEGACY = 'PRE-RENAME SWEEP';

describe('the dev stack agrees on what things are called', () => {
  it('declares the network under one name, in all four places', () => {
    // dev.yml is where it is DECLARED; the other three join it by that literal
    // name, and a compose file that joins a network under the wrong name
    // creates a second, empty one rather than failing.
    expect(read('deploy/compose/dev.yml')).toContain(`name: ${DEV.network}`);
    expect(read('deploy/compose/dev.ci.yml')).toContain(`name: ${DEV.network}`);
    expect(read('deploy/selfhost/compose.dev.yml')).toContain(`name: ${DEV.network}`);
    expect(read('deploy/selfhost/setup-stalwart.sh')).toContain(`STALWART_NETWORK:-${DEV.network}`);
  });

  it('names the containers the provisioning scripts default to', () => {
    // `container_name` is fixed precisely so `docker exec` can find it, which
    // only works while the script and the compose file say the same thing.
    expect(read('deploy/compose/dev.yml')).toContain(`container_name: ${DEV.nextcloud}`);
    expect(read('deploy/selfhost/setup-nextcloud-users.sh')).toContain(
      `NEXTCLOUD_CONTAINER:-${DEV.nextcloud}`,
    );
    expect(read('deploy/selfhost/setup-stalwart.sh')).toContain(`STALWART_CONTAINER:-${DEV.stalwart}`);
    expect(read('deploy/selfhost/setup-stalwart.sh')).toContain(`STALWART_VOLUME:-${DEV.stalwartData}`);
    expect(read('deploy/selfhost/setup-stalwart.sh')).toContain(
      `STALWART_CONFIG_VOLUME:-${DEV.stalwartConfig}`,
    );
  });

  it('removes and inspects only things the setup scripts actually create', () => {
    // THE ONE THAT CATCHES A HALF-DONE RENAME. `docker rm -f` on a name that
    // does not exist succeeds, so a cleanup naming yesterday's container is
    // indistinguishable from a clean machine until residue accumulates.
    const known = new Set<string>(Object.values(DEV));
    const workflow = read('.github/workflows/e2e.yml');

    const targets = workflow
      .split('\n')
      .filter((line) => !line.includes(LEGACY))
      .flatMap((line) => [
        ...line.matchAll(/docker\s+(?:rm\s+-f|volume\s+rm|logs)\s+([A-Za-z0-9_.-]+)/g),
      ])
      .map((m) => m[1]!)
      .filter((name) => /^(ownpace|openmig)/.test(name));

    // The fixture asserts its own premise: a regex that matched nothing would
    // make the loop below vacuous and this test permanently, silently green.
    expect(targets.length).toBeGreaterThan(0);
    for (const name of targets) {
      expect(known, `e2e.yml names "${name}", which no setup script creates`).toContain(name);
    }
  });

  it('has no participant still using the old name, outside a marked sweep', () => {
    for (const file of PARTICIPANTS) {
      const stale = read(file)
        .split('\n')
        .map((line, i) => [i + 1, line] as const)
        .filter(([, line]) => /openmig[-_]dev/.test(line) && !line.includes(LEGACY));
      expect(
        stale.map(([n, line]) => `${file}:${n}: ${line.trim()}`),
        `${file} still names a dev-stack identifier the old way`,
      ).toEqual([]);
    }
  });

  it('names the appliance the same in the workflow that builds it and the docs that describe it', () => {
    // The one name here a CUSTOMER types. `windows-payload.yml` passes it to
    // `--out` and then rebuilds it independently for the checksum step, and
    // `docs/release.md` is the checklist somebody verifies the release against
    // — three copies of one string, none next to another.
    const workflow = read('.github/workflows/windows-payload.yml');
    expect(workflow).toContain('--out "dist/ownpace-appliance-${{ matrix.platform }}"');
    expect(workflow).toContain('NAME="ownpace-appliance-${{ matrix.platform }}"');
    expect(read('docs/release.md')).toContain('ownpace-appliance-win-x64-v');
    expect(read('docs/windows-appliance-runbook.md')).toContain('cd ownpace-appliance-win-x64');
  });

  it('gives the dev database a name its own healthcheck agrees with', () => {
    // `pg_isready -U <user> -d <db>` against the wrong pair fails the
    // healthcheck forever, and compose reports the service as unhealthy
    // without ever saying the credentials are the reason.
    const dev = read('deploy/compose/dev.yml');
    for (const key of ['POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD']) {
      expect(dev, `${key} is not the dev database's name`).toContain(`${key}: ownpace`);
    }
    expect(dev).toContain('pg_isready -U ownpace -d ownpace');
  });

  it('leaves nothing anywhere else in the repository either', () => {
    // Asked of the tree rather than of PARTICIPANTS, because the list above is
    // only as complete as whoever last edited it. Records are exempt: the
    // changelog documents the PREVIOUS rename of this same abbreviation, and
    // editing it would describe something that never happened.
    const hits = execSync(
      `git grep -InP 'openmig[-_]dev' -- . ':!CHANGELOG.md' ':!docs/workplans' ':!scripts/a-name-every-file-had-to-agree-on.unit.test.ts' || true`,
      { cwd: REPO, encoding: 'utf-8' },
    )
      .split('\n')
      .filter((line) => line.trim() !== '' && !line.includes(LEGACY));
    expect(hits, 'these still name a dev-stack identifier the old way').toEqual([]);
  });
});
