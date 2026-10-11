// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * AN APPLY PRESSED AFTER CUTOVER (2026-10-05): the managed jobs' half, read
 * off their own source.
 *
 * The refusal is core's: `applyDeletion` and `applyRelocation` ask
 * `stillTheAuthority` and, after cutover, refuse with `after_cutover`
 * (`packages/core/src/an-apply-pressed-after-cutover.unit.test.ts` holds that
 * behaviourally, and the API route's half is in `apply-routes.integration`).
 * What each job adds is WHICH question it hands over, and both jobs open their
 * pools at import, so a test cannot run them: the shape is pinned here.
 *
 * The question is the one the deps builder made for the data type that holds
 * the item (`stillTheAuthorityOf`, from `readPathPhases`, read fresh each time
 * it is asked), so a cutover executed between the press and the job is the
 * one that answers. Never a literal, and never the start-of-pass answer the
 * same deps carry beside it.
 *
 * The owner, 2026-10-05, asked *"should pressing Apply on a deletion or move
 * that was queued before cutover be refused?"*: **"Refuse after cutover
 * (Recommended)"**.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const JOBS = ['run-apply-deletion.ts', 'run-apply-relocation.ts'] as const;

describe('the managed apply jobs after cutover', () => {
  for (const job of JOBS) {
    const source = readFileSync(join(import.meta.dirname, job), 'utf8');

    it(`${job}: every data type's deps carry the builder's own question`, () => {
      const open = source.slice(source.indexOf('async function openDeps('), source.indexOf('export const run'));
      // One per data type the job can search: mail, calendar, contact, file, task.
      expect(open.match(/stillTheAuthority: d\.stillTheAuthority/g) ?? []).toHaveLength(5);
    });

    it(`${job}: hands that question to core, asked at the removal`, () => {
      const run = source.slice(source.indexOf('export const run'));
      expect(run).toContain('stillTheAuthority: deps.stillTheAuthority,');
      // Never an answer: neither a literal nor the pass's start-time value.
      expect(run).not.toMatch(/stillTheAuthority:\s*async\s*\(\)\s*=>/);
      expect(run).not.toContain('sourceIsAuthorityOnExistence');
    });
  }
});
