// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE UPGRADE GATE'S OWN ARITHMETIC (workplan 0179 T5), held off the stack:
 * the gate runs once a night on the self-hosted runner, so a mistake in how it
 * names its mapping, reads the ledger or counts migrations would show only
 * there, as a red night or, worse, a green one that compared nothing.
 *
 *  - its mapping is the prepared one under its own id, writing under a folder
 *    of its own, and still enabling every data type the other gates do;
 *  - the ledger is read as counts per data type and state, and an empty ledger
 *    is refused, never compared;
 *  - the migrations crossed are counted from the two `schema_migrations` reads,
 *    and an upgrade that lost one, or ends short of this build's newest, is
 *    refused.
 */

import { describe, it, expect } from 'vitest';
import {
  UPGRADE_MAPPING_ID,
  UPGRADE_PREFIX,
  ledgerCounts,
  migrationsCrossed,
  upgradeMapping,
} from './upgrade-gate-lib.ts';

const PREPARED = {
  tenantId: 'selfhost',
  mappingId: 'e2e-restart-resume',
  schedule: { cron: '* * * * *' },
  source: { host: 'stalwart' },
  target: { baseUrl: 'http://stalwart:8080' },
  domains: { mail: { enabled: true }, calendar: { enabled: true }, files: { enabled: true } },
};

describe("the upgrade gate's mapping", () => {
  it('is the prepared mapping, under its own id and its own folder on the target', () => {
    const m = upgradeMapping(PREPARED);
    expect(m.mappingId).toBe(UPGRADE_MAPPING_ID);
    expect(m.targetFolderPrefix).toBe(UPGRADE_PREFIX);
    expect(m.domains).toEqual(PREPARED.domains);
    expect(m.source).toEqual(PREPARED.source);
  });

  it('leaves the prepared mapping as it was', () => {
    const before = JSON.stringify(PREPARED);
    upgradeMapping(PREPARED);
    expect(JSON.stringify(PREPARED)).toBe(before);
  });

  it('refuses a prepared mapping that already writes under a folder, rather than replace it', () => {
    expect(() => upgradeMapping({ ...PREPARED, targetFolderPrefix: 'Gmail' })).toThrow(/already writes under "Gmail"/);
  });
});

describe('the ledger, as counts', () => {
  it('reads psql -At output as data type, state and count', () => {
    expect(ledgerCounts('calendar|adopted|3\nemail|copied|5\n\nfile|copied|7\n')).toEqual({
      'calendar adopted': 3,
      'email copied': 5,
      'file copied': 7,
    });
  });

  it('refuses an empty ledger, which would compare nothing with nothing', () => {
    expect(() => ledgerCounts('\n')).toThrow(/holds no item/);
  });

  it('refuses a line it cannot read', () => {
    expect(() => ledgerCounts('email|copied|five')).toThrow(/cannot read/);
  });
});

describe('the migrations an upgrade crossed', () => {
  const built = ['0001_a.sql', '0002_b.sql', '0003_c.sql'];

  it('counts what the new build applied on top of the released one', () => {
    expect(migrationsCrossed(['0001_a.sql', '0002_b.sql'], built, built)).toEqual({ crossed: ['0003_c.sql'] });
  });

  it('counts none, and says so, when the two carry the same chain', () => {
    expect(migrationsCrossed(built, built, built)).toEqual({ crossed: [] });
  });

  it('refuses an upgrade that ends short of this build’s newest migration', () => {
    expect(() => migrationsCrossed(['0001_a.sql'], ['0001_a.sql', '0002_b.sql'], built)).toThrow(/0003_c\.sql/);
  });

  it('refuses an upgrade that lost a migration the released database had', () => {
    expect(() => migrationsCrossed(['0001_a.sql', '0002_b.sql'], ['0001_a.sql', '0003_c.sql'], built)).toThrow(/0002_b\.sql/);
  });
});
