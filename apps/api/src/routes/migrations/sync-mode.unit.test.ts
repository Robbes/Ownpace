// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The sync-mode retraction, pinned (workplan 0026 T3 rows 7 and 8).
 *
 * Owner decision 2026-08-03: **bidirectional and asymmetric sync are
 * WITHDRAWN, not deferred.** Writing changes back to the source means
 * modifying the system the customer is migrating away from, which is the one
 * place hard rule 2 promises never to touch — and the machinery it would need
 * (conflict resolution, loop suppression so our own write does not read back
 * as a user change, a per-item causality record the ledger does not carry) is
 * a different product rather than a larger version of this one. SAD §11 and
 * §20 carry the dated notes.
 *
 * THE RETRACTION EXISTS IN EXACTLY ONE PLACE IN THE CODE: the mode enum on the
 * managed API's create/update schema. That is the entire enforcement surface,
 * and until this file nothing tested it. A retraction with no test is a
 * comment — one careless widening of the enum and the API accepts
 * `bidirectional` again, stores the word, changes no behaviour, and tells the
 * operator their two-way sync is configured. That is precisely the shape of
 * promise 0026 was opened to end, so it should not be able to come back
 * quietly.
 *
 * The values stay in the DATABASE enum on purpose (`schema-pg.ts` and the
 * baseline CHECK). Existing rows may carry them, and hard rule 2 does not
 * delete a customer's data to tidy a type. What changed is that the API no
 * longer pretends to honour a mode it never implemented.
 */

import { describe, it, expect } from 'vitest';
import { CreateMappingSchema, UpdateMappingSchema } from './index';

/** The minimum a create body needs; every test varies only the mode. */
function body(mode?: string) {
  return {
    name: 'a migration',
    sourceType: 'imap',
    targetType: 'jmap',
    sourceConfig: { host: 'src.example.nl', port: 993, username: 'a@example.nl' },
    targetConfig: {
      host: 'dst.example.nl',
      port: 993,
      username: 'a@example.nl',
      password: 'x',
    },
    ...(mode === undefined ? {} : { mode }),
  };
}

describe('the modes the engine actually implements', () => {
  it('accepts `mirror`', () => {
    expect(CreateMappingSchema.safeParse(body('mirror')).success).toBe(true);
  });

  it('accepts a body with no mode at all', () => {
    // The field is optional and the route defaults it to `mirror`; a create
    // that never mentions a mode is the common case and must not be refused.
    expect(CreateMappingSchema.safeParse(body()).success).toBe(true);
  });
});

describe('`one_time`, refused as NOT BUILT rather than withdrawn', () => {
  // Added 2026-08-05 (owner decision, 0026 T3). Tracing consumers for the
  // rows 7-8 retraction turned up that NOTHING branches on `mode` at all, so
  // `one_time` was as unimplemented as the two withdrawn modes — minus their
  // hard-rule-2 argument. Accepting it told an operator their migration would
  // stop after one pass while it went on mirroring indefinitely.
  it('is refused', () => {
    expect(CreateMappingSchema.safeParse(body('one_time')).success).toBe(false);
  });

  it('is refused as UNBUILT, not as withdrawn — they are different promises', () => {
    const result = CreateMappingSchema.safeParse(body('one_time'));
    if (result.success) throw new Error('expected a refusal');
    const message = JSON.stringify(result.error.issues);

    // The distinction is the whole point of a separate test. `bidirectional`
    // will never be built and the message says why; this one could be, and a
    // message that lumped them together would close a door nobody closed.
    expect(message).toContain('NOT WITHDRAWN but NOT BUILT');
    expect(message).toContain('keep mirroring');
  });
});

describe('the modes that were retracted', () => {
  for (const mode of ['bidirectional', 'asymmetric']) {
    it(`refuses \`${mode}\``, () => {
      expect(CreateMappingSchema.safeParse(body(mode)).success).toBe(false);
    });

    it(`tells the operator WHY \`${mode}\` is refused, not just that it is`, () => {
      const result = CreateMappingSchema.safeParse(body(mode));
      if (result.success) throw new Error('expected a refusal');
      const message = JSON.stringify(result.error.issues);

      // A bare "invalid enum value" would read as a typo to fix. This was a
      // decision, and the reason is the part that stops somebody re-opening
      // it: the alternative is writing to the source (hard rule 2).
      expect(message).toContain('withdrawn');
      expect(message).toContain('modifying the system being migrated away from');
      // And it names what DOES happen to target-side changes, so the refusal
      // is not simply a door closing.
      expect(message).toContain('surfaced as decisions');
    });
  }

  it('refuses them on UPDATE as well as create', () => {
    // The update path is a partial of the same base object. A retraction
    // enforced on one verb only is not a retraction — it is a speed bump.
    expect(UpdateMappingSchema.safeParse({ mode: 'bidirectional' }).success).toBe(false);
    expect(UpdateMappingSchema.safeParse({ mode: 'mirror' }).success).toBe(true);
  });
});

describe('what this test deliberately does NOT assert', () => {
  it('leaves every refused value in the DATABASE enum', async () => {
    // Hard rule 2. A tenant whose row was written before 2026-08-03 may carry
    // `bidirectional`, and removing it from the CHECK would make that row
    // unreadable — destroying data to tidy a type. The API refusing new ones
    // is the whole of the change; the ledger still describes what happened.
    const schemaPg = await import('@openmig/ledger/schema-pg');
    const enumValues = (
      schemaPg.mailboxMapping.mode as unknown as { enumValues: readonly string[] }
    ).enumValues;
    expect(enumValues).toContain('bidirectional');
    expect(enumValues).toContain('asymmetric');
    expect(enumValues).toContain('one_time');
  });
});
