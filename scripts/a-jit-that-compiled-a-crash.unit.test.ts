// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A SETTING THAT LOSES AN ALPHABETICAL RACE DOES NOTHING, SILENTLY.
 *
 * On 2026-09-13 the owner's DAV target segfaulted on every request for two
 * hours. The cause was PHP's tracing JIT, which the `nextcloud:34-apache`
 * image turns on in its own `opcache-recommended.ini`; the remedy is two
 * lines of ini, mounted from `deploy/compose/nextcloud-php.ini`. The full
 * bisection is in that file's header.
 *
 * This guards the two ways that remedy can be present and still not work.
 *
 * **1. It can lose the race.** PHP reads `conf.d` in alphabetical order and
 * the last value wins. `opcache-recommended.ini` sets `opcache.jit=1255`, so
 * a mount named `nextcloud-php.ini`, or `no-jit.ini`, or anything sorting
 * before `opcache-`, is read FIRST and then overwritten. Nothing warns. The
 * stack comes up, the setting is in the container, `php -i` on the CLI even
 * agrees — and the web SAPI still crashes. That is a worse failure than
 * having no fix at all, because it looks fixed.
 *
 * **2. It can be dropped.** The mount is one line in a `volumes:` list that
 * somebody will edit again. Without this, removing it is invisible until a
 * migration's destination falls over mid-pass.
 *
 * ROOT-LEVEL, SO VITEST AND NODE BUILTINS ONLY (AGENTS.md). Read as TEXT
 * rather than by standing the stack up, for the reason
 * `a-button-only-one-edition-answers.unit.test.ts` gives: the thing under
 * test is whether the line is THERE and sorts correctly, which is a property
 * of the file.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const compose = readFileSync(join(ROOT, 'deploy/compose/managed.yml'), 'utf8');
const ini = readFileSync(join(ROOT, 'deploy/compose/nextcloud-php.ini'), 'utf8');

/** The image's own file, which is what turns the JIT on. */
const IMAGE_INI = 'opcache-recommended.ini';

/** The mount line, as compose carries it. */
const MOUNT = /- \.\/nextcloud-php\.ini:(\/usr\/local\/etc\/php\/conf\.d\/[^\s:]+):ro/;

describe('the JIT stays off on the DAV target', () => {
  it('the ini actually disables it — both knobs, not one', () => {
    // `opcache.jit=disable` alone leaves a JIT buffer allocated, and
    // `jit_buffer_size=0` alone is the documented off switch. Setting both is
    // what was measured on the box: opcache ON, JIT off, zero segfaults.
    expect(ini).toMatch(/^opcache\.jit=disable$/m);
    expect(ini).toMatch(/^opcache\.jit_buffer_size=0$/m);
  });

  it('and does not switch opcache itself off — that was the wider hammer', () => {
    // The first thing that stopped the crashing was `opcache.enable=0`, and it
    // worked. It is not what shipped: it costs real throughput and Nextcloud's
    // own admin overview complains about it. The narrower fix was then proved
    // separately, and this keeps anyone from widening it back by reflex.
    expect(ini).not.toMatch(/^opcache\.enable=0$/m);
  });

  it('managed.yml mounts it into the PHP conf.d directory', () => {
    expect(
      MOUNT.test(compose),
      'deploy/compose/managed.yml no longer mounts nextcloud-php.ini into ' +
        '/usr/local/etc/php/conf.d/. Without it the image\'s own ' +
        'opcache-recommended.ini turns the JIT back on, and the DAV target ' +
        'segfaults on every request the first time a bulk operation makes a ' +
        'shared code path hot.',
    ).toBe(true);
  });

  it('under a name that sorts AFTER the image file, or it is overwritten', () => {
    const mountedAs = MOUNT.exec(compose)?.[1] ?? '';
    const basename = mountedAs.slice(mountedAs.lastIndexOf('/') + 1);

    expect(basename, 'no basename could be read from the mount').not.toBe('');
    expect(
      basename.localeCompare(IMAGE_INI),
      `mounted as '${basename}', which sorts BEFORE '${IMAGE_INI}'. PHP reads ` +
        'conf.d alphabetically and the last value wins, so this file would be ' +
        'read and then overwritten by the image\'s own — present, correct, and ' +
        'doing nothing. Rename it so it sorts later (the shipped name is ' +
        "'zz-ownpace-no-jit.ini').",
    ).toBeGreaterThan(0);
  });

  it('is not passing over the wrong files', () => {
    // Every assertion above is a pattern match, and all of them would pass
    // over an empty or unrelated file that happened not to contradict them.
    expect(compose).toContain('container_name: ownpace-nextcloud');
    expect(compose).toContain('SQLITE_DATABASE: nextcloud');
    expect(ini.length).toBeGreaterThan(500);
  });
});
