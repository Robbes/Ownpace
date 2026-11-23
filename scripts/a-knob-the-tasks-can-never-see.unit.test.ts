// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A VARIABLE A JOB READS AND NOBODY HANDS IT.
 *
 * A container inherits nothing from Compose but what its service names. Until
 * alpha.18 the jobs ran as Trigger.dev tasks, and the only way a value reached
 * one was `set-task-env.sh` uploading it; three variables were read by tasks
 * and uploaded by nobody (`LEDGER_RETENTION_DAYS`, the operator's override in
 * `retention.ts`; the plane's in-network address; and `LOG_LEVEL`). Each had a
 * working default, so nothing was broken. **What was broken is that setting
 * them did nothing, silently**: a knob that is missing gets reported, a knob
 * that is ignored gets believed.
 *
 * Since alpha.18 (workplan 0167 T9, ADR-0054) the jobs run in managed.yml's
 * `worker` service, and the same rule holds of its `environment:`: every
 * `process.env.X` a job or the runner reads is a name that service hands it,
 * or an exemption here with the reason it arrives another way.
 *
 * Same class as `every-service-somebody-starts` and the `${VAR:?}` parity rule:
 * two files that must agree, and nothing comparing them.
 *
 * THE LIMIT, written down rather than discovered: this reads
 * `apps/worker/src/jobs/*.ts` and `apps/worker/src/runner/*.ts` only. A
 * variable a job reaches through a package (`LOG_LEVEL`, read inside
 * `packages/shared`) is invisible to it; that one is named by hand, and held
 * below by name. Widening the scan to every package a job can reach means
 * resolving the import graph, and a guard that models its subject is a guard
 * that goes stale.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = ['apps/worker/src/jobs', 'apps/worker/src/runner'];

/** Variables only a test sets, each with its reason rather than a silent pass. */
const NOT_HANDED: Record<string, string> = {
  TEST_DATABASE_URL: 'testcontainers publishes it; no run in the worker reads it',
};

/** Every `process.env.X` the files of a directory read, excluding their tests. */
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

const managed = readFileSync(join(REPO_ROOT, 'deploy/compose/managed.yml'), 'utf8');
const worker = (parseYaml(managed) as { services: Record<string, { environment?: Record<string, unknown> }> }).services[
  'worker'
];
const workerEnv = new Set(Object.keys(worker?.environment ?? {}));

describe('every variable a job reads is one the worker service hands it', () => {
  const reads = DIRS.flatMap((d) => envReadsIn(join(REPO_ROOT, d)).map((r) => ({ ...r, dir: d })));
  const names = [...new Set(reads.map((r) => r.name))].sort();

  it('found the jobs, their reads and the service, rather than comparing two empty lists', () => {
    expect(names.length).toBeGreaterThan(1);
    expect(reads.length).toBeGreaterThan(names.length);
    // The one every job that spans organisations needs (the system role's,
    // workplan 0138 T3 step 2). If this is missing the scan is looking at nothing.
    expect(names).toContain('SYSTEM_DATABASE_URL');
    expect(workerEnv.size).toBeGreaterThan(30);
  });

  it.each(names)("managed.yml's worker service names %s", (name) => {
    if (NOT_HANDED[name]) return;
    const where = reads.filter((r) => r.name === name).map((r) => `${r.dir}/${r.file}`);
    expect(
      workerEnv.has(name),
      `${where.join(', ')} reads process.env.${name}, and the worker container inherits\n` +
        "nothing from Compose but what its service's environment names, so setting it in .env\n" +
        "does nothing at all, silently. Name it in managed.yml's worker service, or add it to\n" +
        'NOT_HANDED with the reason it arrives another way.',
    ).toBe(true);
  });

  it('the three that were once read and handed by nobody are named', () => {
    // LEDGER_RETENTION_DAYS and LOG_LEVEL; the third, the plane's in-network
    // address, went with the plane (workplan 0167 T9).
    for (const name of ['LEDGER_RETENTION_DAYS', 'LOG_LEVEL']) expect(workerEnv.has(name), name).toBe(true);
    expect(workerEnv.has('TRIGGER_API_URL_IN_NETWORK')).toBe(false);
  });

  it('every exemption names a variable something still reads', () => {
    const everywhere = DIRS.flatMap((d) =>
      readdirSync(join(REPO_ROOT, d))
        .filter((f) => f.endsWith('.ts'))
        .map((f) => readFileSync(join(REPO_ROOT, d, f), 'utf8')),
    ).join('\n');
    for (const name of Object.keys(NOT_HANDED)) {
      expect(everywhere, `${name} is exempted and nothing reads it`).toContain(name);
    }
  });
});
