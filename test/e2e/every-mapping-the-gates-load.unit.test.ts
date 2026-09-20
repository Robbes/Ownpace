// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * EVERY MAPPING THE GATES LOAD, PARSED BY THE PARSER THAT LOADS IT.
 *
 * The self-host gates hand `test/e2e/fixtures/*.mapping.json` to the appliance
 * through `deploy/selfhost/config/`, and the appliance reads them with
 * `parseMappingConfigJson`. Until this file, nothing checked that they parse:
 * a typo in a fixture — a field the parser refuses, a value spelled wrong —
 * failed for the first time on a real stack, several minutes into an e2e run,
 * as a container that would not come up. This is a second's worth of unit test
 * for the same finding.
 *
 * It is not a schema duplicate. It runs the PRODUCT's parser over the
 * PRODUCT's fixtures, so a field the parser stops accepting, or starts
 * requiring, breaks here rather than on the Spark box.
 *
 * The archive mappings are why it exists now: `where` (0116 T4) is a new
 * optional field, and the in-target gate's fixture is the first thing in the
 * repository to set it. A fixture the parser refuses would have taken a whole
 * e2e run to find out.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { parseMappingConfigJson } from '@openmig/shared';

const DIR = 'test/e2e/fixtures';
const MAPPINGS = readdirSync(DIR)
  .filter((name) => name.endsWith('.mapping.json'))
  .sort();

describe('the e2e mapping fixtures', () => {
  it('has fixtures to check at all', () => {
    // A guard on the guard: a rename that moved the fixtures elsewhere would
    // otherwise leave this file passing vacuously over an empty list.
    expect(MAPPINGS.length).toBeGreaterThanOrEqual(3);
  });

  for (const name of MAPPINGS) {
    it(`${name} parses through the appliance's own parser`, () => {
      const parsed = parseMappingConfigJson(readFileSync(`${DIR}/${name}`, 'utf8'));
      expect(parsed.mappingId, `${name} has no mappingId`).toBeTruthy();
      expect(parsed.tenantId, `${name} has no tenantId`).toBeTruthy();
    });
  }

  it('carries the in-target archive through as a target-relative location (0116 T4)', () => {
    // The one fixture that sets `where`. Read back through the parser rather
    // than off the JSON, because the point is that the PARSER keeps it: an
    // optional field it quietly dropped would send the pass looking for the
    // export on a disk the container has not got, and the sentence coming
    // back would be about the person's export.
    const parsed = parseMappingConfigJson(
      readFileSync(`${DIR}/selfhost-archive-in-target-import.mapping.json`, 'utf8'),
    );
    const source = parsed.domains?.files?.source ?? parsed.source;
    expect(source?.type).toBe('archive');
    expect(source?.type === 'archive' && source.where).toBe('target');
    expect(source?.type === 'archive' && source.path).toBe('exports/takeout-20240506T070810Z-001.zip');
  });

  it('leaves every other archive fixture on the disk, where it was', () => {
    // The default is `disk` and it is unset, not written out — so a fixture
    // that started saying `target` by accident shows up here.
    for (const name of MAPPINGS.filter((n) => n !== 'selfhost-archive-in-target-import.mapping.json')) {
      const parsed = parseMappingConfigJson(readFileSync(`${DIR}/${name}`, 'utf8'));
      const source = parsed.domains?.files?.source ?? parsed.source;
      if (source?.type !== 'archive') continue;
      expect(source.where, `${name} quietly moved its archive into the target`).toBeUndefined();
    }
  });
});
