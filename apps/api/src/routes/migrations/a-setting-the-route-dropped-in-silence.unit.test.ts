// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A SETTING THE ROUTE DROPPED IN SILENCE (workplan 0125 T3).
 *
 * `PUT /api/migrations/:mappingId` parsed a `sourceConfig` and then threw it
 * away, under a note saying those fields "would require updating related
 * tables". True of a connection's server and credentials. NOT true of the
 * fields that say whose data this mapping moves: those are per-mapping and
 * live in `source_config_override` on the row this route already updates.
 *
 * The cost was the owner's: twenty-one of his files were refused with a
 * sentence telling him to set an export policy on the mapping, and the product
 * had nowhere to do it. Anyone who tried through the API got 200 back and no
 * change — which is worse than an error, because a 200 says it worked.
 *
 * Two halves, and the second is the one with teeth:
 *
 *  1. the export policy is applied, merged over what the row already holds;
 *  2. a field that may NOT change is refused OUT LOUD, with the reason, and
 *     all of them at once.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { refusalsFor } from '@openmig/shared';
import { exportFormatOverride, proposedRevisions } from './index.ts';

const SOURCE = readFileSync(join(import.meta.dirname, 'index.ts'), 'utf-8');

/** A patch body, with only the fields a case is about. */
const body = (o: Record<string, unknown>) => o as Parameters<typeof proposedRevisions>[0];

describe('what a patch body proposes', () => {
  it('proposes nothing for a body that only moves the lifecycle', () => {
    // The common case by far, and it must not become slower or louder: a
    // pause, a cutover and a finish all come through here.
    expect(proposedRevisions(body({ status: 'paused' }))).toEqual([]);
  });

  it('does not propose the export policy, because that one is applied', () => {
    // `proposedRevisions` collects what is checked FOR REFUSAL. The policy is
    // permitted, so listing it here would put it through a check it passes and
    // change nothing — and the day somebody read this list as "what this route
    // writes" they would be wrong in the dangerous direction.
    expect(proposedRevisions(body({ sourceConfig: { nativeFilePolicy: 'export-odf' } }))).toEqual(
      [],
    );
  });

  it('names every refusable field the body carries, not the first', () => {
    const proposed = proposedRevisions(
      body({
        sourceType: 'google',
        targetType: 'nextcloud',
        sourceConfig: { rootFolderId: 'abc', nativeFilePolicy: 'export-pdf' },
        targetConfig: { username: 'someone@example.org' },
      }),
    );
    expect([...proposed]).toEqual([
      'source.type',
      'target.type',
      'source.rootFolderId',
      'target.account',
    ]);
    // And each comes back with a reason a person can act on.
    const refused = refusalsFor(proposed);
    expect(refused).toHaveLength(4);
    for (const r of refused) expect(r.reason).toMatch(/start a (new|second) migration|Connections page/i);
  });

  it('reads PRESENCE, not difference from what is stored', () => {
    // Deliberate: "may this change at all" is a property of the field. Comparing
    // against the row first would mean a read to decide whether to refuse, which
    // is a second answer to a question the table already answers — and it would
    // let a body restating a stored value through a door this route does not have.
    expect(proposedRevisions(body({ sourceType: 'google' }))).toContain('source.type');
  });

  it('ignores a target password, which is not an account change', () => {
    // Rotating a credential is what `auth_expired` sends somebody to do, on the
    // Connections page. A refusal here would contradict the remedy this product
    // gives most often.
    expect(proposedRevisions(body({ targetConfig: { password: 'new' } }))).toEqual([]);
  });
});

describe('the route honours the rule rather than restating it', () => {
  it('asks shared, and answers 409 with every refusal', () => {
    // A SOURCE-LEVEL GUARD, like `mapping-updated-at`, and for the same reason:
    // the mistake this prevents is an OMISSION. A handler that stopped calling
    // `refusalsFor` returns exactly what one that calls it returns, for every
    // body that proposes nothing — which is almost all of them.
    expect(SOURCE).toContain('refusalsFor(proposedRevisions(body))');
    expect(SOURCE).toMatch(/revision_refused/);
    // 409, not 400: the body is well-formed and the request is understood.
    // What refuses it is the state of the migration it names.
    expect(SOURCE).toMatch(/status\(409\)[\s\S]{0,200}revision_refused/);
  });

  it('returns before it writes, so a refused patch changes nothing', () => {
    // The refusal sits above the transaction. A check that ran after the write
    // would report the refusal and have already performed the change.
    const refusalAt = SOURCE.indexOf('revision_refused');
    const writeAt = SOURCE.indexOf('.update(schema.mailboxMapping)', refusalAt);
    expect(refusalAt).toBeGreaterThan(-1);
    expect(writeAt).toBeGreaterThan(refusalAt);
    expect(SOURCE.slice(refusalAt, writeAt)).toContain('return;');
  });

  it('MERGES the policy over the stored override rather than replacing it', () => {
    // THE ONE THAT WOULD HAVE COST SOMEBODY THEIR DATA. `source_config_override`
    // also carries the fields that say whose data this mapping moves — a Box
    // subject, a Drive root, an archive path. Writing a fresh object here would
    // blank them, and the next pass would fall back to the connection's own
    // subject: ADR-0033's one-subject-per-mapping rule, undone by a settings save.
    expect(SOURCE).toMatch(
      /sourceConfigOverride: \{ \.\.\.\(currentOverride \?\? \{\}\), \.\.\.revisedFormat \}/,
    );
  });

  it('validates the policy through the shared parser, not a local list', () => {
    // Hard rule 5: a value the appliance's mapping file refuses must not be one
    // this route stores. One parser, both editions — the same argument
    // `parseGoogleDriveSource`'s own header makes. The route reads the format
    // through `exportFormatOverride`, and that reads it through the parser.
    expect(SOURCE).toContain('exportFormatOverride(body.sourceConfig ?? {})');
    expect(() => exportFormatOverride({ nativeFilePolicy: 'export_office' })).toThrow(
      /source\.nativeFilePolicy: unsupported "export_office"/,
    );
  });

  it('no longer claims sourceConfig cannot be updated here', () => {
    // The note that made this a dead end for a year. Left in place it would
    // tell the next reader not to look.
    expect(SOURCE).not.toMatch(
      /sourceConfig, targetConfig, syncConfig\s*\n\s*\/\/ are not direct fields/,
    );
  });
});
