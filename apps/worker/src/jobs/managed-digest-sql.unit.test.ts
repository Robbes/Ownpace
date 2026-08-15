// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Who gets emailed, and about whom (0043 T2).
 *
 * `managed-digest.ts` was untested while its logic twin `managed-digest-run.ts`
 * had nineteen tests. Mostly that split is defensible — the file is a Pool, a
 * cron string and a transport, and a mocked test of wiring asserts the mocks.
 *
 * Two things in it are NOT wiring. The tenant predicate decides whose migration
 * is looked at, and the recipient predicate decides whose inbox the counts land
 * in. This job emails other people's customers, so a wrong predicate here is
 * discovered by one of them rather than by a log line. Reading them straight out
 * of the module is not much of a test, but it constrains the two clauses that
 * can put a migration's contents in front of the wrong person — which is more
 * than the file had before.
 *
 * The rest of the file remains deliberately untested wiring, and the workplan
 * says so rather than leaving it implicitly covered.
 *
 * Importing this module has SIDE EFFECTS — it constructs a Pool at import and
 * throws without DATABASE_URL — so the variable is set before the import and the
 * import is dynamic. That is a property of the module worth knowing about, and
 * it is the reason a fuller test of this file is awkward rather than merely
 * unwritten.
 */

import { describe, it, expect, beforeAll } from 'vitest';

let ACTIVE_TENANTS_SQL: string;
let DIGEST_RECIPIENTS_SQL: string;

beforeAll(async () => {
  process.env.DATABASE_URL ??= 'postgres://unused:unused@127.0.0.1:5432/none';
  const mod = await import('./managed-digest');
  ACTIVE_TENANTS_SQL = mod.ACTIVE_TENANTS_SQL;
  DIGEST_RECIPIENTS_SQL = mod.DIGEST_RECIPIENTS_SQL;
});

describe('which tenants the digest considers', () => {
  it('reads only ACTIVE tenants', () => {
    // A suspended or closed tenant must not be emailed about a migration it is
    // no longer paying for or has left.
    expect(ACTIVE_TENANTS_SQL).toMatch(/status\s*=\s*'active'/);
    expect(ACTIVE_TENANTS_SQL).toMatch(/from\s+tenant\b/i);
  });
});

describe("who receives a tenant's digest", () => {
  it("is scoped to the tenant, so one customer never sees another's counts", () => {
    // The parameterised tenant filter is the tenancy boundary for this job.
    expect(DIGEST_RECIPIENTS_SQL).toMatch(/tenant_id\s*=\s*\$1/);
  });

  it('is owners and admins only, and only active ones', () => {
    // A viewer does not get other people's migration counts in their inbox, and
    // a deactivated member stops receiving them.
    expect(DIGEST_RECIPIENTS_SQL).toMatch(/role\s+IN\s*\(\s*'owner'\s*,\s*'admin'\s*\)/i);
    expect(DIGEST_RECIPIENTS_SQL).toMatch(/status\s*=\s*'active'/);
  });
});
