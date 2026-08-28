// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A SITE ANOTHER STACK'S TEARDOWN DELETED.
 *
 * `www.ota.ownpace.eu` went missing repeatedly and looked like a crash. It was
 * not one. `docker inspect ownpace-www` answered **"no such object"** — no exit
 * code, no restart count, no OOM, nothing in the logs, because the container
 * had not stopped. It had been REMOVED.
 *
 * Docker Compose derives a project name from the containing DIRECTORY when a
 * file does not declare one. `www.yml`, `dev.yml` and `dev.ci.yml` all sit in
 * `deploy/compose/`, so all three were the project `compose`. E2E's cleanup
 * step runs on every run:
 *
 *     docker compose -f deploy/compose/dev.yml -f deploy/compose/dev.ci.yml \
 *       down --remove-orphans
 *
 * That addresses project `compose`. `ownpace-www` belongs to it and is
 * declared in neither file — Compose's exact definition of an orphan — so
 * `--remove-orphans` deleted the public site, every run. `managed.yml` escaped
 * only because it declares `name: ownpace-managed`.
 *
 * ## The rule, and why it is this one
 *
 * A `restart:` policy is a file SAYING its services are meant to stay running.
 * Anything that says so must own its compose project, rather than share a
 * default one with a stack somebody else tears down.
 *
 * Deliberately keyed on `restart:` rather than "every compose file must be
 * named". `dev.yml` and `dev.ci.yml` have no restart policies because they are
 * ephemeral — brought up for a run and torn down after — and naming them would
 * be a real risk rather than tidiness: their containers are live on the Spark
 * under the current default project, so a rename would strand those and start
 * duplicates competing for the same fixed-name network and published ports.
 * That is the port-collision class that already cost this repo a day. The rule
 * therefore constrains what must stay up and leaves what is meant to be
 * disposable alone.
 *
 * It also cannot pass vacuously: it asserts it actually found compose files
 * with restart policies, so a moved directory fails loudly instead of
 * silently checking nothing.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
// scripts/ -> repo root
const ROOT = resolve(HERE, '..');
const COMPOSE_DIR = join(ROOT, 'deploy/compose');

interface ComposeFile {
  readonly file: string;
  readonly declaresName: string | null;
  readonly staysUp: boolean;
}

/** The project a file resolves to: its own `name:`, or the directory's. */
function projectOf(f: ComposeFile): string {
  return f.declaresName ?? basename(COMPOSE_DIR);
}

const FILES: readonly ComposeFile[] = readdirSync(COMPOSE_DIR)
  .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
  .map((file) => {
    const text = readFileSync(join(COMPOSE_DIR, file), 'utf-8');
    // A top-level `name:` — column zero, so a service called `name` or a
    // nested key cannot be mistaken for one.
    const named = /^name:[ \t]*(\S+)/m.exec(text);
    return {
      file,
      declaresName: named?.[1] ?? null,
      // Comments stripped first: this very file's rationale is written into
      // www.yml's header and mentions `restart:`, and a guard that matched its
      // own explanation would pass for the wrong reason.
      staysUp: /^[ \t]*restart:/m.test(text.replace(/^[ \t]*#.*$/gm, '')),
    };
  });

describe('a long-lived stack owns its compose project', () => {
  it('found compose files to check', () => {
    expect(FILES.length, `no compose files under ${COMPOSE_DIR}`).toBeGreaterThan(0);
    expect(
      FILES.filter((f) => f.staysUp).length,
      'no file declares a restart policy — this guard would pass vacuously',
    ).toBeGreaterThan(0);
  });

  it('every file with a restart policy declares its own project name', () => {
    const unnamed = FILES.filter((f) => f.staysUp && f.declaresName === null).map((f) => f.file);
    expect(
      unnamed,
      'these declare `restart:` — so their services are meant to stay up — but no `name:`, ' +
        'which puts them in the project named after deploy/compose/. Any ' +
        '`docker compose -f <another file in that directory> down --remove-orphans` ' +
        'will DELETE them as orphans, which is how www.ota.ownpace.eu kept ' +
        'disappearing. Add a top-level `name:`.',
    ).toEqual([]);
  });

  it('no long-lived stack shares a project with anything else', () => {
    // The failure stated directly, in case a future file declares a `name:`
    // that happens to collide rather than omitting one.
    const clashes = FILES.filter((f) => f.staysUp)
      .map((f) => ({
        file: f.file,
        project: projectOf(f),
        sharedWith: FILES.filter((o) => o.file !== f.file && projectOf(o) === projectOf(f)).map(
          (o) => o.file,
        ),
      }))
      .filter((c) => c.sharedWith.length > 0);

    expect(
      clashes,
      'a stack meant to stay up shares a compose project with another file; a teardown ' +
        'of that other file removes it',
    ).toEqual([]);
  });

  it('www.yml specifically is out of the shared default project', () => {
    // Named rather than left to the general rule: this is the regression, and
    // a test that says which file it is about is the one somebody reads when
    // it goes red.
    const www = FILES.find((f) => f.file === 'www.yml');
    expect(www, 'deploy/compose/www.yml has moved or gone').toBeDefined();
    expect(www?.declaresName).toBe('ownpace-www');
  });
});
