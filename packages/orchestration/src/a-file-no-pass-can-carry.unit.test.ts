// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A FILE NO PASS CAN CARRY (workplan 0143 T4 (a)): the setting half.
 *
 * `packages/core`'s guard of the same name proves the refusal in the file loop.
 * This file proves where its number comes from:
 *
 * - `LARGEST_FILE_MB` unset is the owner's 10 GB (2026-09-27), a whole number
 *   of megabytes moves it, and anything else is refused by name rather than
 *   replaced;
 * - the managed file pass is built with it, read from the task environment,
 *   and `set-task-env.sh` uploads it, because a task container inherits
 *   nothing from compose;
 * - the appliance's file pass is built without it: no runner kills its passes.
 *
 * The wiring is read as text, as the job guards read a task body, because
 * building the managed pass needs a database and stored connections.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_LARGEST_FILE_MB, largestFileBytesFromEnv } from './largest-file-setting.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const MB = 1024 * 1024;

/** Comments removed: a comment may name the setting without passing it. */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

describe('LARGEST_FILE_MB', () => {
  it('is 10 GB unless it says otherwise', () => {
    expect(DEFAULT_LARGEST_FILE_MB).toBe(10 * 1024);
    for (const raw of [undefined, '', '  ']) {
      expect(largestFileBytesFromEnv(raw), String(raw)).toBe(10 * 1024 * MB);
    }
    expect(largestFileBytesFromEnv('2048')).toBe(2048 * MB);
  });

  it('refuses a value it cannot read, naming it, rather than holding the default', () => {
    for (const raw of ['0', '-5', '1.5', '10GB']) {
      expect(() => largestFileBytesFromEnv(raw), raw).toThrow(
        `LARGEST_FILE_MB must be a whole number of megabytes, at least 1 — got "${raw}"`,
      );
    }
  });
});

describe('the managed file pass', () => {
  it('is built with the limit, read from the task environment', () => {
    const builder = code(readFileSync(join(HERE, 'build-deps-from-mapping.ts'), 'utf8'));
    expect(builder).toMatch(
      /largestFileBytes: largestFileBytesFromEnv\(process\.env\.LARGEST_FILE_MB\),/,
    );
  });

  it('gets the setting uploaded to the tasks', () => {
    const script = readFileSync(join(ROOT, 'deploy', 'compose', 'set-task-env.sh'), 'utf8');
    expect(script).toContain('LARGEST_FILE_MB="${LARGEST_FILE_MB:-}"');
    expect(script).toMatch(/"LEDGER_RUN_RETENTION_DAYS", "LARGEST_FILE_MB",/);
  });
});

describe('the appliance’s file pass', () => {
  it('is built without it', () => {
    expect(code(readFileSync(join(HERE, 'orchestration.ts'), 'utf8'))).not.toContain('largestFileBytes');
  });
});
