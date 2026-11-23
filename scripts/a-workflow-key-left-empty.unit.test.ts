// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A WORKFLOW KEY LEFT EMPTY (workplan 0167 T9).
 *
 * GitHub refuses a whole workflow file whose `env`, `with`, `steps` or any
 * other key that must hold a mapping or a list holds nothing, and it says so
 * in one place only: a run named after the file, failed with no job, on the
 * next push. Nothing else fails. A dispatch of that workflow cannot start, and
 * its schedule stops without a word. T9 took the last two keys out of E2E
 * (managed)'s job `env:` and left the key above `steps:`, so the workflow every
 * managed change is proven by could not run on the branch.
 *
 * So every workflow is read here, and such a key that holds null fails, named
 * by its path. A trigger left empty (`workflow_dispatch:`, `push:`) is valid
 * and stays allowed: under `on`, only `inputs`, `outputs` and `secrets` must
 * hold something.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOWS = join(ROOT, '.github', 'workflows');

/** Keys whose value GitHub reads as a mapping or a list, never as nothing. */
const MUST_HOLD = new Set([
  'env',
  'with',
  'steps',
  'jobs',
  'inputs',
  'outputs',
  'secrets',
  'permissions',
  'defaults',
  'strategy',
  'matrix',
  'services',
  'container',
  'concurrency',
]);

/** The paths, in one file, of every key that must hold something and holds null. */
export function emptyKeys(document: unknown): string[] {
  const found: string[] = [];
  const walk = (node: unknown, path: string[]): void => {
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, [...path, String(i)]));
      return;
    }
    if (node === null || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      const underOn = path[0] === 'on';
      const mustHold = underOn ? ['inputs', 'outputs', 'secrets'].includes(key) : MUST_HOLD.has(key);
      if (value === null && mustHold) found.push([...path, key].join('.'));
      walk(value, [...path, key]);
    }
  };
  walk(document, []);
  return found;
}

describe('a workflow key left empty (0167 T9)', () => {
  const files = readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/.test(f));

  it('reads every workflow there is', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(files)('%s holds something in every key that must', (file) => {
    // `on` is read as the key it is written as, not YAML 1.1's boolean.
    const document = parse(readFileSync(join(WORKFLOWS, file), 'utf8'));
    expect(emptyKeys(document), `${file}: these keys hold nothing, so GitHub refuses the file`).toEqual([]);
  });

  it('finds a job env left above its steps, and lets an empty trigger be', () => {
    const job = parse('on:\n  workflow_dispatch:\njobs:\n  a:\n    runs-on: x\n    env:\n    steps:\n      - run: true\n');
    expect(emptyKeys(job)).toEqual(['jobs.a.env']);
    const inputs = parse('on:\n  workflow_dispatch:\n    inputs:\njobs:\n  a:\n    steps:\n      - run: true\n');
    expect(emptyKeys(inputs)).toEqual(['on.workflow_dispatch.inputs']);
  });
});
