// Copyright 2026 The Ownpace authors (Apache-2.0)

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
 * The rest of the file remains deliberately untested wiring here, and the
 * workplan says so rather than leaving it implicitly covered. What the wiring
 * reads, and as whom, is `a-job-that-reads-each-organisation-as-itself`'s
 * (integration, 0138 T2), which runs it on the pools the job opens.
 *
 * Since 0138 T2 the module builds nothing at import (the job opens its pools in
 * its run), and each statement is a drizzle `sql` for one organisation, run in
 * that organisation's scope. Each is read here as the text and parameters it
 * sends, so the clauses are pinned as they reach Postgres. Which organisations
 * are considered at all is the list's (`ACTIVE_ORGANISATIONS_SQL`,
 * task-pools.ts), asked once across them.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { ACTIVE_ORGANISATIONS_SQL } from './task-pools.ts';

/** A statement for one organisation, as the text and parameters it sends. */
const sent = (query: SQL) => new PgDialect().sqlToQuery(query);
const ONE = '0043e000-e29b-41d4-a716-446655440001';

let DIGEST_ORGANISATION_SQL: string;
let DIGEST_RECIPIENTS_SQL: string;
let DIGEST_MAPPINGS_SQL: string;
let PARAMS: unknown[][];

// The import is the job's whole module graph, the Trigger.dev SDK and the
// ledger among it, loaded cold inside this hook. On main's self-hosted runner,
// with the rest of the unit project running beside it, that took longer than
// vitest's default 10 s for a hook (2026-09-24, on d323435), and the file failed
// having asserted nothing. A minute, as the suites that open a database in
// their hook allow.
beforeAll(async () => {
  const mod = await import('./managed-digest.ts');
  const statements = [mod.digestOrganisationSql(ONE), mod.digestRecipientsSql(ONE), mod.digestMappingsSql(ONE)].map(
    sent,
  );
  [DIGEST_ORGANISATION_SQL, DIGEST_RECIPIENTS_SQL, DIGEST_MAPPINGS_SQL] = statements.map((s) => s.sql) as [
    string,
    string,
    string,
  ];
  PARAMS = statements.map((s) => s.params);
}, 60_000);

describe('which tenants the digest considers', () => {
  it('reads only ACTIVE tenants', () => {
    // A suspended or closed tenant must not be emailed about a migration it is
    // no longer paying for or has left. The list is the one question the
    // digest asks across organisations (0138 T2).
    expect(ACTIVE_ORGANISATIONS_SQL).toMatch(/status\s*=\s*'active'/);
    expect(ACTIVE_ORGANISATIONS_SQL).toMatch(/from\s+tenant\b/i);
  });

  it('reads each one\'s own row by its id, for its name and its settings', () => {
    expect(DIGEST_ORGANISATION_SQL).toMatch(/from\s+tenant\b/i);
    expect(DIGEST_ORGANISATION_SQL).toMatch(/\bid\s*=\s*\$1/);
    expect(DIGEST_ORGANISATION_SQL).toMatch(/\bname\b/);
    expect(DIGEST_ORGANISATION_SQL).toMatch(/\bsettings\b/);
  });

  it('asks every statement about the one organisation it was handed', () => {
    for (const params of PARAMS) expect(params).toEqual([ONE]);
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

describe('what the digest knows about each migration', () => {
  it('reads the NAME as well as the id', () => {
    // The one assertion `runDigest`'s own tests cannot make: they fake
    // `listMappings`, so dropping this column leaves them green and sends
    // every owner a UUID instead of the name they typed in the wizard —
    // which is exactly what an owner found in their inbox on 2026-09-14.
    expect(DIGEST_MAPPINGS_SQL).toMatch(/\bname\b/);
    expect(DIGEST_MAPPINGS_SQL).toMatch(/\bid\b/);
    expect(DIGEST_MAPPINGS_SQL).toMatch(/\bstatus\b/);
    expect(DIGEST_MAPPINGS_SQL).toMatch(/from\s+mailbox_mapping\b/i);
  });

  it('stays scoped to the one tenant being digested', () => {
    // Not new, but it rides in the same string now: a mappings query without
    // this clause would put one customer's migrations in another's email.
    expect(DIGEST_MAPPINGS_SQL).toMatch(/tenant_id\s*=\s*\$1/);
  });
});

/**
 * ONE MORE THING IN IT THAT IS NOT MERELY WIRING (workplan 0128 D7, T5 slice
 * 7c): the digest's line for a grace period nobody chose at. `runDigest` asks
 * it only when this module hands it the read, so a module that stopped handing
 * it over would leave every `runDigest` test green while no managed owner was
 * told again. Read as text: the read needs a database to run.
 */
describe('the grace periods nobody chose at are asked of the ledger', () => {
  it('hands the digest the read, in the organisation\'s own transaction', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('./managed-digest.ts', import.meta.url), 'utf8');
    expect(source).toMatch(
      /graceEndedWithoutAChoice: async \(tenantId, mappingId\) =>\s*\(await withTenant\(pool, tenantId, \(tdb\) => readGraceEndedWithoutAChoice\(tdb, tenantId, mappingId\)\)\)/,
    );
  });
});
