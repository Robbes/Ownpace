// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * FREE SPACE BEFORE START, ON THE APPLIANCE TOO (workplan 0171 T9).
 *
 * The page asks `${mappingPath(id)}/destination-space` on either edition;
 * managed answers `/api/migrations/:id/destination-space`, and this asserts
 * the appliance answers its own spelling, through the same core
 * (`readDestinationSpace`), so the two cannot answer different shapes. Read
 * as text, as `a-button-only-one-edition-answers.unit.test.ts` explains.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SOURCE = readFileSync(join(import.meta.dirname, 'index.ts'), 'utf8');

describe('the appliance answers GET /mappings/:id/destination-space', () => {
  it('matches the path, as a GET', () => {
    expect(SOURCE).toContain("req.method === 'GET' && req.url ? /^\\/mappings\\/([^/]+)\\/destination-space$/");
  });

  it('answers through the shared core, with the same openers a pass builds', () => {
    expect(SOURCE).toContain('readDestinationSpace(');
    expect(SOURCE).toContain('destinationOpenersFromConfig(m.config, ledgerOptions)');
  });
});
