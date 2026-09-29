// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A MONTH OF CONTAINER OUTPUT (workplan 0129 T3; the owner's decision, D2:
 * application and container logs are kept for a month).
 *
 * Docker keeps a container's output by size, never by age, and without a
 * `logging` block it keeps all of it, for ever, on the host's disk. So:
 *
 *  - every service of the appliance's compose file caps what it keeps, and no
 *    override file layered on it takes the cap away;
 *  - the appliance's guide says how to keep exactly 30 days, with the host's
 *    journal, because a size cap can only approximate a month.
 *
 * The managed guide said the same until 2026-09-28. On a managed machine the
 * owner chose Docker's default instead (ops-log-driver (a)), which privacy §9
 * describes: a container's output goes with the container. That half is
 * `a-journal-that-outlived-the-container` now, and it holds the opposite.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

interface Service {
  readonly logging?: { readonly driver?: string; readonly options?: Record<string, string> };
}
/**
 * Compose's own tags (`!reset`, `!override`) are not YAML the parser knows, and
 * it warns about each. The value is kept, so an override that set `logging` to
 * anything, a `!reset` included, still fails the check below.
 */
const services = (path: string): Record<string, Service> =>
  (parse(read(path), { merge: true, logLevel: 'error' }) as { services?: Record<string, Service> })
    .services ?? {};

describe("the appliance's containers", () => {
  const base = services('deploy/selfhost/compose.yml');

  it.each(Object.keys(base))('%s keeps a bounded amount of output', (name) => {
    const logging = base[name]!.logging;
    expect(logging?.driver).toBe('json-file');
    expect(logging?.options?.['max-size']).toMatch(/^\d+m$/);
    expect(logging?.options?.['max-file']).toMatch(/^\d+$/);
  });

  it('are all found, so the cases above are not vacuous', () => {
    expect(Object.keys(base).sort()).toEqual(['app', 'postgres']);
  });

  it.each(['compose.pglite.yml', 'compose.dev.yml', 'compose.drill.yml'])(
    'keep the cap when %s is layered on top',
    (file) => {
      for (const [name, service] of Object.entries(services(`deploy/selfhost/${file}`))) {
        expect(service.logging, `${file} sets logging on ${name}`).toBeUndefined();
      }
    },
  );
});

describe('exactly thirty days, with the host journal', () => {
  it('the appliance guide says how', () => {
    const guide = read('docs/selfhost-quickstart.md');
    expect(guide).toContain('MaxRetentionSec=1month');
    expect(guide).toMatch(/journald/);
  });
});
