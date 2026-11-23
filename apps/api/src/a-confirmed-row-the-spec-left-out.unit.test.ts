// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A CONFIRMED-LIST ROW THE SPEC LEFT OUT (workplan 0168 T5; the review of the
 * screens, N8).
 *
 * Both editions send each row of the confirmed list with `address`, the
 * address table's word on it (`changed` or `older`, ADR-0055), and the screen
 * and the export read it. The published spec's row schema did not declare
 * it, so a client generated from the spec would drop the one field that
 * says a copy was written with a new address, on the list people delete
 * their originals by.
 *
 * Text-paired, as `a-spec-that-described-a-different-report.unit.test.ts`
 * is, and for its reason: the spec is read by people who do not run this
 * code, so the property is that two separate files agree. The marks are read
 * out of `AddressMark`'s own line, never restated here.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

const API_ROOT = join(import.meta.dirname, '..');
const SPEC = join(API_ROOT, 'docs', 'openapi.yaml');
const LIST = join(API_ROOT, '..', '..', 'packages', 'shared', 'src', 'confirmed-list.ts');

interface Prop {
  readonly type?: string;
  readonly enum?: readonly string[];
  readonly properties?: Record<string, Prop>;
  readonly items?: Prop;
  readonly additionalProperties?: Prop;
}

const spec = parse(readFileSync(SPEC, 'utf8')) as {
  paths: Record<string, { get?: { responses: Record<string, { content?: Record<string, { schema: Prop }> }> } }>;
};
const list = readFileSync(LIST, 'utf8');

/** The row schema of `GET /api/migrations/{mappingId}/confirmed-list`, one mapping's entry deep. */
function rowSchema(): Prop | undefined {
  const ok = spec.paths['/api/migrations/{mappingId}/confirmed-list']?.get?.responses['200'];
  return ok?.content?.['application/json']?.schema.additionalProperties?.properties?.rows?.items;
}

describe('the confirmed list the spec describes is the one both editions send', () => {
  it('declares each row’s address mark, with the marks the list gives', () => {
    const line = list.split('\n').find((l) => l.includes('export type AddressMark'));
    expect(line, 'AddressMark is gone or renamed').toBeTruthy();
    const marks = [...line!.matchAll(/'([a-z]+)'/g)].map((m) => m[1]!);
    expect(marks).toEqual(['changed', 'older']);

    const address = rowSchema()?.properties?.address;
    expect(address, 'the spec’s confirmed-list row has no `address`: a generated client drops it').toBeTruthy();
    expect(address!.type).toBe('string');
    expect([...(address!.enum ?? [])].sort()).toEqual([...marks].sort());
  });

  it('names the export’s address column, as the export writes it', () => {
    const header = list.split('\n').find((l) => l.includes("const header = ['domain'"));
    expect(header, 'the export’s header line is gone or renamed').toBeTruthy();
    expect(header).toContain("'address'");
    const exportDoc = (
      spec.paths['/api/migrations/{mappingId}/confirmed-list/export']?.get as { description?: string } | undefined
    )?.description;
    expect(exportDoc).toContain('`address`');
  });
});
