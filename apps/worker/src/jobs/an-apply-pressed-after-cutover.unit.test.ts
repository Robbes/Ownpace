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
 * pools at import, so a test cannot run them: the shape is pinned here. Both
 * run `apply-one-item.ts`, which builds and hands over the question, with
 * core's own function; this pins the shared run and each job's handing-in.
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

const JOBS = [
  ['run-apply-deletion.ts', 'applyDeletion'],
  ['run-apply-relocation.ts', 'applyRelocation'],
] as const;

/** The run both jobs share (`apply-one-item.ts`): where the question is built and handed over. */
const shared = readFileSync(join(import.meta.dirname, 'apply-one-item.ts'), 'utf8');

describe('the managed apply jobs after cutover', () => {
  it("apply-one-item.ts: every data type's deps carry the builder's own question", () => {
    const open = shared.slice(shared.indexOf('async function openDeps('), shared.indexOf('export interface ApplyJob {'));
    // One per data type the job can search: mail, calendar, contact, file, task.
    expect(open.match(/stillTheAuthority: d\.stillTheAuthority/g) ?? []).toHaveLength(5);
  });

  it('apply-one-item.ts: hands that question to core, asked at the removal', () => {
    const run = shared.slice(shared.indexOf('export async function applyOneItem('));
    expect(run).toContain('stillTheAuthority: deps.stillTheAuthority,');
    // Never an answer: neither a literal nor the pass's start-time value.
    expect(run).not.toMatch(/stillTheAuthority:\s*async\s*\(\)\s*=>/);
    expect(shared).not.toContain('sourceIsAuthorityOnExistence');
  });

  for (const [job, core] of JOBS) {
    const source = readFileSync(join(import.meta.dirname, job), 'utf8');

    it(`${job}: runs the shared run with core's own ${core}, and sets no question of its own`, () => {
      expect(source).toContain(`  apply: ${core},\n`);
      expect(source).toContain('applyOneItem(JOB, pool, payload)');
      expect(source).not.toContain('stillTheAuthority');
      expect(source).not.toContain('sourceIsAuthorityOnExistence');
    });
  }
});
