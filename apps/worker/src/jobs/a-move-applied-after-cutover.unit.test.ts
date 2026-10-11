// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * AFTER CUTOVER, AUTO-APPLY REMOVES NOTHING (2026-10-05): the managed half,
 * read off the pass's own source.
 *
 * The refusal is core's (`autoApplyRelocations` asks `stillTheAuthority` before
 * it reads the moves queue, stop code `after_cutover`), and
 * `packages/core/src/a-move-applied-after-cutover.unit.test.ts` holds it
 * behaviourally. What the managed pass adds is WHICH question it hands over,
 * and `run-delta-sync.ts` opens its pools at import, so a test cannot run it:
 * the shape is pinned here instead.
 *
 *  - the apply is handed the file deps' own question, the one the deps
 *    builder made from `readPathPhases` for the file data type, read fresh
 *    each time it is asked, and never an answer carried from the pass's start;
 *  - the run log says, in the owner's terms, that it did not run and why.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const pass = readFileSync(join(import.meta.dirname, 'run-delta-sync.ts'), 'utf8');
const apply = pass.slice(pass.indexOf('async function autoApplyOpenRelocations('), pass.indexOf('// Job input schema'));

describe('the managed relocation auto-apply after cutover', () => {
  it("is handed the file data type's question, asked fresh at the apply", () => {
    expect(apply).toMatch(/deps: Pick<FileSyncDeps, 'ledger' \| 'target' \| 'stillTheAuthority'>/);
    expect(apply).toContain('stillTheAuthority: deps.stillTheAuthority,');
    // Never an answer: neither a literal nor the pass's own start-time value.
    expect(apply).not.toMatch(/stillTheAuthority:\s*async\s*\(\)\s*=>/);
    expect(apply).not.toContain('sourceIsAuthorityOnExistence');
  });

  it('says in the run log that it did not run, and why', () => {
    expect(apply).toContain("report.stoppedCode === 'after_cutover'");
    expect(apply).toContain(
      'relocation auto-apply not run: after cutover the old system no longer decides what exists',
    );
  });
});
