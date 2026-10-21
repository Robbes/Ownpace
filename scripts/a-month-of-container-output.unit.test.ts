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
 *
 * THE MANAGED STACKS CAP IT TOO (2026-10-21). Docker's default kept all of it,
 * and a managed service whose image and settings do not change keeps its
 * container for months, so the databases', the Trigger.dev plane's and the
 * identity provider's output grew on a shared disk without end. Every service
 * of `deploy/compose/managed.yml` now writes `json-file` with the appliance's
 * cap, five files of 20 MB, the one-off `zitadel-machinekey` included, so the
 * check needs no list of exceptions. It is still Docker's default driver and
 * the output still goes with the container, so privacy §9 and
 * `a-journal-that-outlived-the-container` hold: lines go sooner, never later.
 * The website's `deploy/compose/www.yml` sets no cap, and that is held here
 * too: `site-visits.sh` counts visits from the whole of its log on every run,
 * and a rotated file would quietly shrink the totals.
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

describe("the managed stacks' containers", () => {
  const managed = services('deploy/compose/managed.yml');

  it.each(Object.keys(managed))('%s keeps a bounded amount of output', (name) => {
    const logging = managed[name]!.logging;
    expect(logging?.driver).toBe('json-file');
    expect(logging?.options?.['max-size']).toMatch(/^\d+m$/);
    expect(logging?.options?.['max-file']).toMatch(/^\d+$/);
  });

  it('are all found, the one-off ones among them, so the cases above are not vacuous', () => {
    expect(Object.keys(managed)).toEqual(
      expect.arrayContaining(['postgres', 'trigger-api', 'zitadel', 'zitadel-machinekey', 'api', 'web']),
    );
  });
});

describe("the website's containers", () => {
  const www = services('deploy/compose/www.yml');

  // site-visits.sh counts visits from the whole of this log on every run, so
  // a rotated file would shrink the totals; a deploy removes it with the
  // container, as privacy §9 says.
  it.each(Object.keys(www))('%s keeps all of its output until the container is removed', (name) => {
    expect(www[name]!.logging, `www.yml sets logging on ${name}`).toBeUndefined();
  });

  it('are all found, so the cases above are not vacuous', () => {
    expect(Object.keys(www).length).toBeGreaterThan(0);
  });
});

describe('exactly thirty days, with the host journal', () => {
  it('the appliance guide says how', () => {
    const guide = read('docs/selfhost-quickstart.md');
    expect(guide).toContain('MaxRetentionSec=1month');
    expect(guide).toMatch(/journald/);
  });
});
