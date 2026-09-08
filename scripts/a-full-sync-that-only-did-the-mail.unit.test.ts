// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * One job runs passes, a full scan is an option on it, and EVERY domain
 * honours that option.
 *
 * ## The defect
 *
 * There were two pass-running jobs. `run-full-sync` existed because a full
 * pass passes no cursor store; that was its only real difference. Everything
 * else about it was `run-delta-sync` as of a much earlier release — no
 * per-domain `migration_status` rows, no pause handling, no deadline, no
 * failure category, no per-domain timings — because 431 lines of improvement
 * went into one copy and not the other.
 *
 * And it called `runShadowPass` directly rather than looping the mapping's
 * domains, so **it synced mail and nothing else**. `POST .../sync
 * {"type":"full"}` on a mapping carrying calendars, contacts, files and tasks
 * copied the mail, touched none of the rest, and reported success. The route
 * is reachable from the web app (`mapping-service.ts` → `triggerSync`), so
 * this was a customer-facing silence, not a theoretical one.
 *
 * It is the same defect `resolveDiscoveryJob` records from 2026-09-07 — the
 * preflight assuming every mapping is a mail mapping — one layer down. The
 * mail path keeps being mistaken for the whole product, which is why the fix
 * is to delete the copy rather than teach it the other four domains.
 *
 * ## The fan-out this actually guards
 *
 * `forceFullScan` has to reach FIVE domain arms in one `if/else if` chain.
 * That is the exact shape of `a-domain-the-dispatchers-forgot` and of 0113's
 * task-domain miss: a new option wired into email and calendar and quietly
 * absent from tasks looks completely fine in review and silently does half
 * the job. Each arm is asserted by name.
 *
 * ## Why read as text
 *
 * `resolveSyncJob` is pure and is called for real below. The rest is the shape
 * of a Trigger.dev task's payload schema and of five branches that need a
 * database, two DAV servers and a Trigger.dev runtime to reach.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveSyncJob } from '../apps/api/src/routes/migrations/job-resolution.ts';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The same text with its comments removed — a comment is prose about code. */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

const read = (rel: string): string => code(readFileSync(join(REPO_ROOT, rel), 'utf8'));

const DISPATCHER = 'apps/worker/src/jobs/run-delta-sync.ts';
const TENANT = '00000000-0000-4000-8000-000000000001';
const MAPPING = '11111111-1111-4111-8111-111111111111';

describe('there is one pass-running job', () => {
  it('has no second copy of the dispatcher', () => {
    expect(existsSync(join(REPO_ROOT, 'apps/worker/src/jobs/run-full-sync.ts'))).toBe(false);
  });

  it('resolves every sync request to that one task', () => {
    for (const opts of [
      {},
      { type: 'delta' as const },
      { type: 'full' as const },
      { forceFullScan: true },
      { forceFullScan: ['task'] },
    ]) {
      expect(resolveSyncJob(TENANT, MAPPING, opts).taskId).toBe('run-delta-sync');
    }
  });

  it('asks for a full scan when one was asked for, and not otherwise', () => {
    expect(resolveSyncJob(TENANT, MAPPING, { type: 'full' }).payload.forceFullScan).toBe(true);
    expect(resolveSyncJob(TENANT, MAPPING, {}).payload).not.toHaveProperty('forceFullScan');
    // Absent, not `false`: the job's schema marks it optional, and an explicit
    // false reads as a choice somebody made.
    expect(
      resolveSyncJob(TENANT, MAPPING, { forceFullScan: false }).payload,
    ).not.toHaveProperty('forceFullScan');
  });

  it('carries a list of domains through untouched', () => {
    expect(resolveSyncJob(TENANT, MAPPING, { forceFullScan: ['task', 'file'] }).payload)
      .toMatchObject({ forceFullScan: ['task', 'file'] });
  });
});

describe('the option reaches every domain, not just the first two', () => {
  const src = read(DISPATCHER);

  it('accepts a flag OR a list of domains', () => {
    expect(src).toMatch(/forceFullScan:\s*z\s*\n?\s*\.union\(\[z\.boolean\(\), z\.array\(z\.enum\(SYNC_DOMAINS\)\)\]\)/);
  });

  it('decides per domain rather than per pass', () => {
    expect(src).toMatch(/const fullScan = scansFromTheBeginning\(domain\)/);
  });

  for (const [domain, call] of [
    ['email', 'runShadowPass'],
    ['calendar', 'runCalendarSync'],
    ['contact', 'runContactSync'],
    ['task', 'runTaskSync'],
    ['file', 'runFileSync'],
  ] as const) {
    it(`${domain} honours it`, () => {
      // Each arm must spread `cursors: undefined` AFTER the deps, or the deps'
      // own store overwrites it and the "full" scan quietly resumes.
      const arm = new RegExp(
        `${call}\\(\\{[^}]*\\.\\.\\.deps[\\s\\S]{0,200}?fullScan \\? \\{ cursors: undefined \\}`,
      );
      expect(src, `${domain} does not honour forceFullScan`).toMatch(arm);
    });
  }

  it('does not reset the stored cursors', () => {
    // Owner's decision, 2026-09-08: "that is a different decision". Withholding
    // the store means the pass reads no saved position AND writes none, so the
    // saved position survives a full scan untouched.
    expect(src).not.toMatch(/cursors\.(clear|delete|reset)/);
  });
});
