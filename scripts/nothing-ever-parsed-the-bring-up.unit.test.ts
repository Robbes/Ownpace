// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * NOTHING EVER PARSED THE BRING-UP.
 *
 * `deploy/compose/bootstrap-managed.sh` is 1200 lines and starts the entire
 * managed stack. Twenty-two other shell scripts sit beside it — the credential
 * generators, the smoke, the Zitadel setup, the upgrade drill. Every test that
 * touches them reads them as TEXT: `readFileSync`, then a regex. Not one of
 * them ever hands the file to a shell.
 *
 * So a syntax error in any of them was invisible to CI. `lint` is ESLint and
 * does not look at `.sh`; there is no shellcheck; the `bash` that the sibling
 * tests spawn is always given a `-c` string or one small library, never the
 * script under test. The first thing that would notice is the nightly
 * E2E (managed) at 05:30, or the operator's own bring-up — a five-hour
 * feedback loop for a one-second question.
 *
 * HOW IT NEARLY ARRIVED. #546 and #547 each added a `note_*` helper to
 * `bootstrap-managed.sh` at the same place. git presents that as a conflict —
 * and factors the closing brace the two sides SHARE out of the conflict
 * region, so each side appears to end without one:
 *
 *     <<<<<<< HEAD
 *     note_mail_goes_nowhere_real() {
 *       ...
 *     =======
 *     note_status_page_probes_itself() {
 *       ...
 *     >>>>>>> origin/claude/a-status-page-nobody-started
 *     }
 *
 * Delete the three markers, keep both sides — the obvious resolution, and the
 * one a web editor invites — and the file is one brace short. Measured, on the
 * real merge, before this file existed:
 *
 *     $ bash -n deploy/compose/bootstrap-managed.sh
 *     deploy/compose/bootstrap-managed.sh: line 1262: syntax error: unexpected end of file
 *
 * The error surfaces 900 lines below the edit that caused it, which is the
 * other half of why this is worth a second: `bash -n` finds it instantly and
 * an eye reading the diff does not.
 *
 * WHAT THIS RULE IS NOT. `-n` answers "does this parse", nothing more. It will
 * not catch an unquoted variable, a wrong flag, a pipeline whose consumer
 * kills its producer (that is `no-pipeline-its-own-consumer-can-kill`), or a
 * function that does the wrong thing. It is the cheapest possible question and
 * the only one nobody was asking.
 *
 * It also cannot cry wolf: the judge is the interpreter the script itself
 * names, not a heuristic about shell. Each script's shebang picks its parser,
 * and a shebang this file does not recognise is a failure rather than a skip —
 * a scanner that silently passes over what it does not understand is how a
 * rule ends up covering nothing.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.turbo']);

/**
 * Shebangs the repo uses, mapped to the parser that judges them. Every script
 * is bash today; `sh` is listed because a POSIX one would need `sh -n` rather
 * than bash's superset, and finding that out from a wrong verdict is worse
 * than writing it down now.
 */
const PARSER_FOR: Record<string, string> = {
  '#!/bin/bash': 'bash',
  '#!/usr/bin/env bash': 'bash',
  '#!/bin/sh': 'sh',
  '#!/usr/bin/env sh': 'sh',
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (entry.endsWith('.sh')) out.push(p);
  }
  return out;
}

const shellScripts = walk(REPO_ROOT).map((p) => ({
  file: relative(REPO_ROOT, p),
  path: p,
  shebang: readFileSync(p, 'utf8').split('\n', 1)[0]?.trim() ?? '',
}));

/** Two helpers sharing one closing brace: the shape git's conflict produces. */
const ONE_BRACE_SHORT = `#!/usr/bin/env bash
set -euo pipefail

note() { echo "    $*"; }

note_mail_goes_nowhere_real() {
  note "mail goes to the catcher"
note_status_page_probes_itself() {
  note "the status page will probe itself"
}
`;

/** The same file with the brace the merge ate put back. */
const RESOLVED = ONE_BRACE_SHORT.replace(
  '  note "mail goes to the catcher"\nnote_status_page_probes_itself',
  '  note "mail goes to the catcher"\n}\n\nnote_status_page_probes_itself',
);

function parse(source: string): { status: number | null; stderr: string } {
  const dir = mkdtempSync(join(tmpdir(), 'parses-'));
  try {
    const script = join(dir, 'candidate.sh');
    writeFileSync(script, source);
    const r = spawnSync('bash', ['-n', script], { encoding: 'utf8' });
    return { status: r.status, stderr: r.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('every shell script the repo ships', () => {
  it('is actually found, so an empty scan cannot report success', () => {
    // The way a repo-wide rule dies is by scanning nothing. Name the script
    // this exists for, and a floor under the rest.
    expect(shellScripts.map((s) => s.file)).toContain('deploy/compose/bootstrap-managed.sh');
    expect(shellScripts.length).toBeGreaterThanOrEqual(20);
  });

  it.each(shellScripts.map((s) => [s.file, s.shebang, s.path] as const))(
    '%s parses',
    (file, shebang, path) => {
      const parser = PARSER_FOR[shebang];
      // An unknown interpreter is a failure, not a skip: the next person to add
      // one should be told to name its parser here rather than quietly losing
      // coverage of their script.
      expect(
        parser,
        `${file} starts with ${JSON.stringify(shebang)}; add it to PARSER_FOR with the parser that judges it`,
      ).toBeDefined();

      const r = spawnSync(parser!, ['-n', path], { encoding: 'utf8' });
      expect(r.status, `${parser} -n ${file}:\n${r.stderr}`).toBe(0);
    },
  );

  describe('the merge resolution it exists to catch', () => {
    it('refuses two functions sharing one closing brace', () => {
      const r = parse(ONE_BRACE_SHORT);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(/unexpected end of file/);
    });

    it('accepts the same file once the brace is back', () => {
      const r = parse(RESOLVED);
      expect(r.status, r.stderr).toBe(0);
    });
  });
});
