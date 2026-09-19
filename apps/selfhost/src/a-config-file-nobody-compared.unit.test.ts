// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A CONFIG FILE NOBODY COMPARED AGAINST ANYTHING (workplan 0125 T2).
 *
 * T1 gave both editions a rule about what a live migration may change about
 * itself. Managed enforces it at its edit route, where a change arrives as a
 * REQUEST with the old values in the database beside it. The appliance's
 * config is a file its operator owns — no request, and until migration 0054 no
 * record of what the mapping previously said, so the file was compared against
 * nothing at all. Change `source.type` on a live migration, restart, and the
 * next pass compares what a different provider says against natural keys the
 * old one produced, recognises nothing, and copies the whole account again
 * beside the first copy.
 *
 * The RULE is `compareRevision` in `@openmig/shared` and is tested there, with
 * both editions calling the one copy (hard rule 5). What only this side can
 * lose is the WIRING, and it can lose it in three ways this file pins:
 *
 *  1. the check is never called at boot;
 *  2. it is called after the mapping has already been scheduled or discovered,
 *     so a pass runs against a config nothing vetted;
 *  3. it stops throwing, and a refusal becomes a log line beside a running
 *     migration — which is the shape of "we told you" that nobody reads.
 *
 * Read as TEXT rather than started as a server, for the reason
 * `a-button-only-one-edition-answers.unit.test.ts` gives: booting the appliance
 * needs a database, a config directory and a scheduler, and the thing under
 * test is whether the call is THERE and in the right place.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SOURCE = readFileSync(join(import.meta.dirname, 'index.ts'), 'utf8');

describe('the appliance compares the mapping it is loading against what it recorded', () => {
  it('calls the shared rule rather than carrying a second copy of the table', () => {
    // Hard rule 5. A refusal the appliance invents is a refusal that can
    // disagree with managed's, and the way that happens is a second table.
    expect(SOURCE).toContain('compareRevision');
    expect(SOURCE).toContain('revisionSnapshotOf');
  });

  it('runs it at startup, before the mapping is discovered or scheduled', () => {
    const startup = SOURCE.indexOf('await assertMappingRevision(m);');
    expect(startup, 'the boot check is gone — nothing compares the config any more').toBeGreaterThan(
      -1,
    );
    // The startup loop fires discovery and then schedules. Both must come
    // AFTER the check: a pass against a config nothing vetted is the whole
    // defect, and "we refused it afterwards" is not a refusal.
    const discovery = SOURCE.indexOf('void discoverAllDomains(', startup);
    expect(discovery).toBeGreaterThan(startup);
    expect(SOURCE.indexOf('scheduleMapping(m)', startup)).toBeGreaterThan(startup);
  });

  it('throws on a refusal — it does not log one beside a migration that keeps running', () => {
    const fn = SOURCE.slice(
      SOURCE.indexOf('const assertMappingRevision'),
      SOURCE.indexOf('// Read the current mailbox_mapping status.'),
    );
    expect(fn).toContain('verdict.refusals.length > 0');
    expect(fn).toContain('throw new Error(');
    // The refusal carries T1's own sentence and both values, so an operator
    // does not have to diff their own file to find out what they changed.
    expect(fn).toContain('r.reason');
    expect(fn).toContain('${r.from} -> ${r.to}');
  });

  it('records the snapshot AFTER the refusal check, never before it', () => {
    const fn = SOURCE.slice(
      SOURCE.indexOf('const assertMappingRevision'),
      SOURCE.indexOf('// Read the current mailbox_mapping status.'),
    );
    // Writing first would overwrite the evidence with the very values being
    // refused, and the next boot would find them agreeing with themselves.
    expect(fn.indexOf('throw new Error(')).toBeLessThan(
      fn.indexOf('UPDATE mailbox_mapping SET revision_state'),
    );
  });

  it('is not passing vacuously — it reads the appliance server', () => {
    expect(SOURCE).toContain("req.url === '/verify/report'");
    expect(SOURCE.length).toBeGreaterThan(10_000);
  });
});
