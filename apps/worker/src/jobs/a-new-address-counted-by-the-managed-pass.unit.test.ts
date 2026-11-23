// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A NEW ADDRESS, COUNTED BY THE MANAGED PASS (workplan 0168 S5 (a); the
 * screens' review S2), read off the pass's own source, as its neighbours are.
 *
 * The engine counts what a changed address table did and puts the counts in
 * the pass's metrics (`a-copy-a-new-address-waits-for` holds that), which
 * `markCompleted` records as the data type's last pass. What the managed pass
 * adds is that it carries them in its result's type, so nothing reads them as
 * absent, and says them in the run log as it says the change after cutover:
 * counts only, never an address.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const pass = readFileSync(join(import.meta.dirname, 'run-delta-sync.ts'), 'utf8');

describe('the managed pass carries the address table’s counts', () => {
  it('names each in its result, beside the change after cutover', () => {
    const result = pass.slice(pass.indexOf('let result: {'), pass.indexOf("if (domain === 'email') {"));
    for (const field of ['addressChanged', 'addressChangesWaiting', 'addressChangesUnguarded', 'goneFromTarget']) {
      expect(result, field).toMatch(new RegExp(`\\b${field}\\?: number;`));
    }
  });

  it('records them as the data type’s last pass, through the pass’s metrics', () => {
    expect(pass).toMatch(/markCompleted\(tenantId, mappingId, domain, result\.metrics\);/);
  });

  it('says what waits, what has no version, and what is gone, in the run log, as counts', () => {
    expect(pass).toMatch(/\{ domain, addressChangesWaiting: waiting \}/);
    expect(pass).toMatch(/\{ domain, addressChangesUnguarded: unguarded \}/);
    expect(pass).toMatch(/\{ domain, goneFromTarget: gone \}/);
  });
});
