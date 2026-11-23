// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE END OF THE ALPHA NAMES EVERY SWITCH (docs/ending-the-alpha.md).
 *
 * Ending the alpha is one setting, `OWNPACE_STAGE`, emptied in live's `.env`,
 * and it reaches four processes by four routes: the api's environment, the
 * worker's environment (until alpha.18 removed Trigger.dev, workplan 0167 T9,
 * the jobs could also run as Trigger.dev tasks, whose environment
 * `set-task-env.sh` uploaded), the web bundle's build arg, and the site's
 * build. Since 0109 T6 it turns billing on: the hold
 * at the data ceiling, the yes, the refusal of a start past the agreed tier,
 * and whether a first copy counts (managed 0040). A route the switch does not
 * reach fails silently: the tasks keep the alpha, and everything moved after
 * the alpha is marked as the alpha's and never counted, with no error
 * anywhere.
 *
 * So the runbook names every file where the stage enters a process, and this
 * file finds them: a source file that reads `.OWNPACE_STAGE` or
 * `.VITE_OWNPACE_STAGE`, and a script, compose file or Dockerfile that
 * expands `OWNPACE_STAGE`, reads it with `env_value`, lists it by name, or
 * declares the build arg. A new one fails here until the runbook says what it
 * does during the alpha and after it, and how the switch reaches it.
 *
 * It also holds the runbook's checks to what the code says: the worker's
 * environment, where the jobs read the stage from compose, the api's start lines
 * the acceptance check greps for, and the tester guide's file names, so a
 * check never looks for a sentence nothing prints any more.
 *
 * ROOT-LEVEL, SO VITEST AND NODE BUILTINS ONLY (AGENTS.md).
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = join(import.meta.dirname, '..');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');
const RUNBOOK_PATH = 'docs/ending-the-alpha.md';
const RUNBOOK = read(RUNBOOK_PATH);

/** A file that is a test, not a reader of the stage. */
const TEST = /\.(unit|integration|e2e|ui)\.test\.|\.spec\.|(^|\/)test\//;

/** Where the stage enters a process: the files a deploy has to reach. */
function stageReaders(): string[] {
  const tracked = execFileSync('git', ['ls-files', 'apps', 'packages', 'site', 'deploy/compose'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
    .split('\n')
    // A file deleted and not yet committed is still in the index: not a reader.
    .filter((f) => f !== '' && !TEST.test(f) && existsSync(join(ROOT, f)));
  const source = /\.(ts|tsx|mjs|js)$/;
  const plumbing = /\.(sh|yml|yaml)$|(^|\/)Dockerfile[^/]*$/;
  return tracked.filter((file) => {
    if (source.test(file)) return /\.(VITE_)?OWNPACE_STAGE\b/.test(read(file));
    if (plumbing.test(file)) {
      return /\$\{?OWNPACE_STAGE\b|env_value[^\n#]*\bOWNPACE_STAGE\b|ARG VITE_OWNPACE_STAGE\b|"OWNPACE_STAGE"/.test(
        read(file),
      );
    }
    return false;
  });
}

describe('the runbook names every place the stage enters', () => {
  const readers = stageReaders();

  it('finds the readers, so the check below is not vacuous', () => {
    for (const known of [
      'apps/worker/src/jobs/run-delta-sync.ts',
      'apps/web/Dockerfile',
      'deploy/compose/managed.yml',
      'site/build.mjs',
    ]) {
      expect(readers, `${known} reads the stage and was not found: the search is broken`).toContain(known);
    }
  });

  it('names each one, so a new reader is a new line in the runbook', () => {
    const missing = readers.filter((file) => !RUNBOOK.includes(file));
    expect(
      missing,
      `a file reads OWNPACE_STAGE and ${RUNBOOK_PATH} does not name it: add a row to "What the stage ` +
        'switches" saying what it does during the alpha and after it, and how the switch reaches it',
    ).toEqual([]);
  });
});

describe("the runbook's checks look for what the code prints", () => {
  it("the jobs read the stage from the worker's environment, and the runbook sends nobody to set-task-env.sh", () => {
    // alpha.18 removed Trigger.dev and its task environment (workplan 0167 T9):
    // compose hands the worker the stage, as it hands the api.
    const compose = read('deploy/compose/managed.yml');
    const start = compose.indexOf('\n  worker:\n');
    expect(start, 'managed.yml has no worker service').toBeGreaterThan(-1);
    const next = compose.slice(start + 1).search(/\n {2}[a-z][a-z0-9-]*:\n|\n[a-z]/);
    const worker = compose.slice(start, next === -1 ? undefined : start + 1 + next);
    expect(worker, 'the worker is not handed the stage').toMatch(/\n\s+OWNPACE_STAGE: \$\{OWNPACE_STAGE:-\}\n/);
    expect(existsSync(join(ROOT, 'deploy/compose/set-task-env.sh')), 'set-task-env.sh is back').toBe(false);
    expect(RUNBOOK, `${RUNBOOK_PATH} still names set-task-env.sh, which alpha.18 removed`).not.toContain('set-task-env.sh');
    expect(RUNBOOK).toContain('`worker.environment`');
  });

  it("the api's start lines while it asks for the texts", () => {
    const api = read('apps/api/src/conditions-not-accepted.ts');
    for (const line of ['[api] asking every member to accept', '[api] OWNPACE_STAGE=alpha']) {
      expect(api, `the api no longer logs "${line}" at start`).toContain(line);
    }
    expect(RUNBOOK).toContain("grep -c -e '\\[api\\] asking every member to accept' -e '\\[api\\] OWNPACE_STAGE=alpha'");
  });

  it("the tester guide's pages, the ones the site leaves out after the alpha", () => {
    const site = read('site/build.mjs');
    expect(site, 'the guide is no longer the alpha-only page').toMatch(/const ALPHA_ONLY = \['guide'\]/);
    const copy = read('site/copy.mjs');
    for (const [file, url] of [
      ['alpha-guide.html', 'https://www.ownpace.eu/alpha-guide.html'],
      ['alpha-handleiding.html', 'https://www.ownpace.eu/nl/alpha-handleiding.html'],
    ] as const) {
      expect(copy, `the guide is no longer ${file}`).toContain(`guide: '${file}'`);
      expect(RUNBOOK).toContain(url);
    }
  });
});

describe('the runbook is found where an operator looks', () => {
  it('from the docs index and the plans it ends', () => {
    for (const doc of [
      'docs/README.md',
      'docs/workplans/0109-the-invoice-speaks-tiers.md',
      'docs/workplans/0131-the-alpha-and-who-is-let-in.md',
    ]) {
      expect(read(doc), `${doc} does not link the runbook`).toMatch(/ending-the-alpha\.md/);
    }
  });
});
