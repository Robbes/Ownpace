// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The self-hosted gate seeds every domain the appliance it starts is
 * configured to sync (workplan 0113 T8).
 *
 * `e2e.yml` is the only place the appliance is driven end to end against real
 * servers: two Nextcloud accounts, a restart-resume idempotency pass per
 * domain, and a real apply-deletion per domain. Two files have to agree for
 * that to mean anything, and NOTHING makes them:
 *
 *   - `test/e2e/seed-dav-source.mjs` puts fixtures into the SOURCE account;
 *   - the workflow's own `mapping.json` patch decides which domains the
 *     appliance will look for.
 *
 * One is Node, the other is YAML embedding a `node -e` script; no compiler
 * reads across them. A domain configured but never seeded passes vacuously —
 * zero items, nothing to copy, nothing to verify, green. A domain seeded but
 * never configured is worse: the fixtures pile up in the source every run and
 * nothing ever reads them.
 *
 * That is exactly what happened to `task` between #746 and T8: the product
 * gained a fifth domain, every unit test went green, and this gate — the one
 * that would have caught a wrongly-wired domain rather than a forgotten one —
 * did not know it existed.
 *
 * Read as TEXT, for the reason the other guards here give: a root-level test
 * cannot resolve workspace imports, and the thing under test is the agreement
 * between two files rather than any value either exports.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const WORKFLOW = '.github/workflows/e2e.yml';
const SEEDER = 'test/e2e/seed-dav-source.mjs';

const workflow = readFileSync(join(ROOT, WORKFLOW), 'utf8');
const seeder = readFileSync(join(ROOT, SEEDER), 'utf8');

/**
 * The DAV domains, in the `MappingConfig.domains` spelling the workflow's
 * patch uses, paired with the fixture prefix the seeder writes for each.
 *
 * Mail is absent on purpose: it is seeded over IMAP by a different script
 * (`seed-imap-source.mjs`) and configured from the top-level source/target,
 * so it is not one of the pairs this guard can speak for.
 */
const DAV_DOMAINS: ReadonlyArray<{ config: string; fixture: string }> = [
  { config: 'calendar', fixture: 'dav-seed-event-' },
  { config: 'tasks', fixture: 'dav-seed-task-' },
  { config: 'contacts', fixture: 'dav-seed-contact-' },
  { config: 'files', fixture: 'dav-seed-file-' },
];

describe('every DAV domain the appliance is told to sync is also seeded', () => {
  it.each(DAV_DOMAINS)('$config is configured in the workflow', ({ config }) => {
    expect(
      workflow,
      `${WORKFLOW} does not point cfg.domains.${config} at the Nextcloud DAV root, so the ` +
        'appliance it starts will not sync that domain and its fixtures pile up unread',
    ).toContain(`cfg.domains.${config}.source.url`);
  });

  it.each(DAV_DOMAINS)('$config has fixtures in the source ($fixture…)', ({ fixture }) => {
    expect(
      seeder,
      `${SEEDER} writes no ${fixture}* fixtures, so that domain has nothing to copy and the ` +
        'gate passes it vacuously — zero items, zero to verify, green',
    ).toContain(fixture);
  });

  it('the task fixture is a VTODO in a collection that declares VTODO alone', () => {
    // The whole reason tasks are worth a lane here. A VTODO in Nextcloud's
    // default `personal` calendar (which declares VEVENT,VTODO) is the mixed
    // case, and the unit tests already cover it. The collection that declares
    // VTODO and nothing else is what this product read as a calendar for
    // years, and only a real server can prove the source now tells them apart.
    expect(seeder).toContain('BEGIN:VTODO');
    expect(seeder).toContain('supported-calendar-component-set');
    expect(seeder).toContain('<C:comp name="VTODO"/>');
    // Not in `personal`: that would quietly turn this back into the easy case.
    expect(seeder).toMatch(/taskListUrl\s*=.*\$\{TASK_LIST\}/);
  });

  it('is not passing vacuously — the workflow still configures domains this way', () => {
    // Every assertion above is `toContain`, and a workflow rewritten to
    // configure domains some other way would fail them all for the wrong
    // reason. `calendar` is the control: it predates this guard by a year and
    // is the plainest of the four.
    expect(
      workflow,
      `${WORKFLOW} no longer patches cfg.domains.* at all, so the checks above prove nothing ` +
        'about the newer domains. Update this guard to match how it configures them now',
    ).toContain('cfg.domains.calendar.source.url');
  });
});
