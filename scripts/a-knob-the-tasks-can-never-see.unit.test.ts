// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A VARIABLE A TASK READS AND NOBODY UPLOADS.
 *
 * Trigger.dev task containers inherit NOTHING from compose. The only way a
 * value reaches one is `set-task-env.sh` uploading it to the project
 * environment — which is why that script exists, and why its own header says
 * "a value only in this file and never uploaded is a value the digest will
 * never see."
 *
 * Three variables were read by tasks and uploaded by nobody:
 *
 *   LEDGER_RETENTION_DAYS       `retention.ts` calls it the operator override,
 *                               and on managed there was nowhere to put it.
 *   TRIGGER_API_URL_IN_NETWORK  the escape hatch beside the compose-network
 *                               default that makes due ticks work at all.
 *   LOG_LEVEL                   raising a task's logging was impossible.
 *
 * Each has a working default, so nothing was broken. **What was broken is that
 * setting them did nothing, silently** — which is the worse of the two
 * failures: a knob that is missing gets reported, a knob that is ignored gets
 * believed.
 *
 * Same class as `every-service-somebody-starts` and the `${VAR:?}` parity rule:
 * two files that must agree, and nothing comparing them. This is the third
 * instance found the same night, which is the argument for looking rather than
 * for any one of the three.
 *
 * THE LIMIT, written down rather than discovered: this reads
 * `apps/worker/src/jobs/*.ts` only. A variable a job reaches through a package
 * — `LOG_LEVEL`, read inside `packages/shared` — is invisible to it. That one
 * is uploaded now because the sweep that found the other two also found it by
 * hand, and it would not be caught again by this rule. Widening the scan to
 * every package a task can reach means resolving the import graph, and a guard
 * that models its subject is a guard that goes stale; the jobs directory is
 * where the reads that matter are written.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const setTaskEnv = readFileSync(join(REPO_ROOT, 'deploy/compose/set-task-env.sh'), 'utf8');
const JOBS = join(REPO_ROOT, 'apps/worker/src/jobs');

/**
 * Variables the platform injects, or that only a test sets. Each needs its
 * reason here rather than a silent pass.
 */
const NOT_UPLOADED: Record<string, string> = {
  TRIGGER_SECRET_KEY: 'injected into every run by the Trigger.dev platform itself',
  TRIGGER_API_URL: 'injected by the platform; the deploy CLI sets it for the build',
  TEST_DATABASE_URL: 'testcontainers publishes it; no task run ever reads it',
};

/** Every `process.env.X` a job reads, excluding its tests. */
export function envReadsIn(dir: string): Array<{ file: string; name: string }> {
  const out: Array<{ file: string; name: string }> = [];
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith('.ts') || /\.(unit|integration|e2e)\.test\.ts$/.test(entry)) continue;
    const source = readFileSync(join(dir, entry), 'utf8');
    for (const m of source.matchAll(/process\.env\.([A-Z_][A-Z0-9_]*)/g)) {
      out.push({ file: entry, name: m[1]! });
    }
  }
  return out;
}

describe('every variable a scheduled task reads is one somebody uploads', () => {
  const reads = envReadsIn(JOBS);
  const names = [...new Set(reads.map((r) => r.name))].sort();

  it('found the jobs and their reads, rather than passing on an empty list', () => {
    expect(names.length).toBeGreaterThan(1);
    expect(reads.length).toBeGreaterThan(names.length);
    // The one every job needs. If this is missing the scan is looking at
    // nothing, whatever else it reports.
    expect(names).toContain('DATABASE_URL');
  });

  /**
   * The two shapes an upload actually takes, and nothing else.
   *
   *   DATABASE_URL: process.env.TASK_DATABASE_URL   the required object
   *   "SMTP_HOST"                                   the optional list
   *
   * NOT a bare mention. The first version matched only the quoted form and
   * therefore missed every required variable — and a matcher loosened to the
   * bare name would have passed on the PROSE two lines above the list, which
   * now names all three of the variables this rule exists for. A rule its own
   * documentation satisfies is not a rule.
   */
  const uploads = (name: string) =>
    new RegExp(`"${name}"|\\b${name}\\s*:\\s*process\\.env\\.`).test(setTaskEnv);

  it.each(names)('set-task-env.sh uploads %s', (name) => {
    if (NOT_UPLOADED[name]) return;
    expect(
      uploads(name),
      `${basename(JOBS)}/* reads process.env.${name} inside a task container, which\n` +
        'inherits nothing from compose — so unless set-task-env.sh uploads it, setting\n' +
        'it in .env does nothing at all, silently. Add it to the optional list there,\n' +
        'or add it to NOT_UPLOADED with the reason it arrives another way.',
    ).toBe(true);
  });

  it('every exemption names a variable something still reads', () => {
    const everywhere = readdirSync(JOBS)
      .filter((f) => f.endsWith('.ts'))
      .map((f) => readFileSync(join(JOBS, f), 'utf8'))
      .join('\n');
    for (const name of Object.keys(NOT_UPLOADED)) {
      expect(everywhere, `${name} is exempted and nothing reads it`).toContain(name);
    }
  });
});

/**
 * The upload runs as `node -e '…'` — a SINGLE-QUOTED shell argument. An
 * apostrophe anywhere inside it closes the quote, and the rest of the file is
 * then parsed as shell.
 *
 * Not hypothetical: adding the comment that documents the three variables above
 * wrote "the operator's override" into that block and broke the script at a
 * line 60 further down, which `bash -n` reported as a syntax error near an
 * unrelated `(`. A trap that punishes ordinary English prose in a file whose
 * every other line is prose deserves a rule rather than a scar.
 */
describe('the embedded node script survives being written in English', () => {
  const start = setTaskEnv.indexOf("node -e '");
  const block = setTaskEnv.slice(start + "node -e '".length, setTaskEnv.indexOf("\n'", start));

  it('found the block, rather than checking an empty string', () => {
    expect(start).toBeGreaterThan(-1);
    expect(block).toContain('envvars');
  });

  it("contains no apostrophe, because one would close the shell's quote", () => {
    const offending = block
      .split('\n')
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line }) => line.includes("'"));
    expect(
      offending.map(({ line, n }) => `+${n}: ${line.trim()}`),
      "an apostrophe inside node -e '…' ends the argument; the rest of the file\n" +
        'is then parsed as shell, and the error names a line far from the cause.',
    ).toEqual([]);
  });
});
