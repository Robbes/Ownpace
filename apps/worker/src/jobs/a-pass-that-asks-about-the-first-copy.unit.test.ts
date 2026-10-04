// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A PASS ASKS ABOUT THE FIRST COPY ONLY WHEN IT FINISHED ONE (workplan 0154 T7),
 * read off the two passes' own source.
 *
 * `announceFirstCopy` and the appliance's `everythingArrived` hold the rules
 * and their tests hold those against a real database. What a running pass
 * adds is WHEN it asks, which a test of the pass itself would need two
 * providers to reach. So the shape is pinned here instead:
 *
 *  - the managed pass notes the data types with no completed pass as it
 *    begins, marks one as finished only after `markCompleted` on a data type
 *    from that list, and asks after a closed run and on the way out of a
 *    failed one, never letting the asking fail the pass;
 *  - the appliance reads whether everything had arrived before it runs its
 *    data types, and says so only when it was not so then and is now, once.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const pass = readFileSync(join(import.meta.dirname, 'run-delta-sync.ts'), 'utf8');
const appliance = readFileSync(join(import.meta.dirname, '..', '..', '..', 'selfhost', 'src', 'index.ts'), 'utf8');

describe('the managed pass asks only when it finished a first copy', () => {
  it('notes what had no completed pass before its data types run', () => {
    expect(pass.indexOf('const unfinishedAtStart')).toBeGreaterThan(-1);
    expect(pass.indexOf('const unfinishedAtStart')).toBeLessThan(pass.indexOf('for (const domain of domains) {'));
  });

  it('counts a first copy finished only after marking one of those completed', () => {
    expect(pass).toMatch(
      /markCompleted\(tenantId, mappingId, domain, result\.metrics\);\s*\}\);\s*if \(unfinishedAtStart\.has\(domain\)\) finishedAFirstCopy = true;/,
    );
  });

  it('asks after a closed run and on the way out of a failed one, and never fails the pass', () => {
    expect(pass).toMatch(/await closeRun\('succeeded', 0\);\s*await sayTheFirstCopy\(\);/);
    expect(pass).toMatch(/await recordAppEvent\(failed\);\s*\/\/ Re-throw[^\n]*\n(?:\s*\/\/[^\n]*\n)*\s*await sayTheFirstCopy\(\);\s*throw await planeErrorFor\(/);
    const asking = pass.slice(pass.indexOf('const sayTheFirstCopy'), pass.indexOf('for (const domain of domains) {'));
    expect(asking).toMatch(/if \(!finishedAFirstCopy\) return;/);
    expect(asking).toMatch(/try \{[\s\S]*announceFirstCopy\(pool, tenantId, mappingId\)[\s\S]*\} catch \(err\) \{/);
  });
});

describe('the appliance says it on the pass that finds it newly so', () => {
  it('reads whether everything had arrived before it runs its data types', () => {
    expect(appliance.indexOf('const arrivedBefore')).toBeGreaterThan(-1);
    expect(appliance.indexOf('const arrivedBefore')).toBeLessThan(appliance.indexOf('const results = await runAllDomains('));
  });

  it('says it only when it was not so then and is now, once', () => {
    expect(appliance).toMatch(/if \(arrivedBefore === false && !firstCopySaid\) \{/);
    expect(appliance).toMatch(
      /if \(after\?\.complete && !firstCopySaid\) \{\s*firstCopySaid = true;\s*await tell\(\{ kind: 'first_copy_complete', domains: after\.domains \}\);/,
    );
  });
});
