// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE SPEC DESCRIBED A REPORT THIS API HAS NEVER SENT.
 *
 * `openapi-spec.unit.test.ts` guards the spec's ROUTES, in both directions,
 * and has done since the file stopped being markdown in a yaml suit. It does
 * not look inside a schema. So while every path was pinned, the §20 report's
 * two enums drifted from the types that produce them and nothing said a word.
 *
 * Both were found on 2026-09-21, and the second is the serious one.
 *
 * ## `status` was missing the one value that BLOCKS a cutover
 *
 * The enum read `[PASS, FAIL, WARN, SKIPPED]`. `NOT_VERIFIABLE` has been a
 * member of `DataTypeVerificationStatus` since the domain-scope work, and it is
 * the status that means items were copied, the target cannot be read for this
 * domain, and their completeness is therefore unknown. The published spec
 * omitted precisely the answer a reader most needs to see.
 *
 * ## `dataType` pointed at the WRONG FIVE WORDS
 *
 * It was `$ref: Domain` — `email`, `calendar`, `contact`, `file`, `task`, which
 * is what a person ticks in the wizard. The report has always used its own
 * spelling: `mail`, `calendar`, `contacts`, `files`, `tasks`. Four of the five
 * differ. A client generated from that spec and validating a real `/verify`
 * response would have rejected EVERY domain row except `calendar` — and the
 * two lists are similar enough that reading them side by side is exactly how
 * you miss it.
 *
 * The third spelling is deliberate and documented (workplan 0113; the Verify
 * screen maps one onto the other rather than restating either). What was not
 * deliberate is the spec claiming the wrong one.
 *
 * WHY THIS IS TEXT-PAIRED rather than imported. The spec is a published
 * artefact for people who are NOT running this code — the whole point is that
 * a generator can read it without the repository. So the property under test
 * is that two separate files agree, and the test reads both as text and
 * compares. Importing the union would only prove the union equals itself.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

const API_ROOT = join(import.meta.dirname, '..');
const SPEC = join(API_ROOT, 'docs', 'openapi.yaml');
const TYPES = join(API_ROOT, '..', '..', 'packages', 'shared', 'src', 'verification-report.ts');

interface Schema {
  readonly enum?: readonly string[];
  readonly properties?: Record<string, { readonly enum?: readonly string[]; readonly $ref?: string }>;
}

const schemas = (parse(readFileSync(SPEC, 'utf8')) as { components: { schemas: Record<string, Schema> } })
  .components.schemas;
const source = readFileSync(TYPES, 'utf8');

describe('the §20 report the spec describes is the one this API sends', () => {
  it('lists every status a domain can carry, NOT_VERIFIABLE included', () => {
    // Read out of the union, not restated here: restating it would drift in
    // exactly the way this test exists to catch.
    const line = source.split('\n').find((l) => l.includes('export type DataTypeVerificationStatus'));
    expect(line, 'DataTypeVerificationStatus is gone or renamed').toBeTruthy();
    const declared = [...line!.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]!);
    expect(declared).toContain('NOT_VERIFIABLE');

    const documented = schemas.DomainVerification?.properties?.status?.enum ?? [];
    expect(
      [...documented].sort(),
      'the spec and the union disagree about what a domain status can be — a generated ' +
        'client will reject a response this API really sends',
    ).toEqual([...declared].sort());
  });

  it('names the domains the REPORT uses, not the ones the wizard uses', () => {
    // The near-miss that shipped: two five-member lists, one word in common
    // beyond `calendar`, and no test asking which one `/verify` actually emits.
    const line = source.split('\n').find((l) => l.includes('export const VERIFICATION_DOMAINS'));
    expect(line, 'VERIFICATION_DOMAINS is gone or renamed').toBeTruthy();
    const declared = [...line!.matchAll(/'([a-z]+)'/g)].map((m) => m[1]!);
    expect(declared.length, `no domains found in: ${line}`).toBe(5);

    const documented = schemas.VerificationDomain?.enum ?? [];
    expect([...documented].sort(), 'the spec names domains no report ever carries').toEqual(
      [...declared].sort(),
    );
  });

  it('points dataType at that schema and not at the wizard’s Domain', () => {
    // The actual defect, as a property: `$ref: Domain` type-checks, parses,
    // generates a client, and is wrong. Only the target of the ref says so.
    expect(schemas.DomainVerification?.properties?.dataType?.$ref).toBe(
      '#/components/schemas/VerificationDomain',
    );
  });

  it('leaves Domain alone — it is right about what it describes', () => {
    // Guarding against the lazy fix: making the two enums agree by editing the
    // WIZARD's would break every other schema that refers to it. The spellings
    // differ on purpose; only the reference was wrong.
    expect([...(schemas.Domain?.enum ?? [])].sort()).toEqual(
      ['calendar', 'contact', 'email', 'file', 'task'],
    );
  });
});
