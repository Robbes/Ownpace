// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A SILENCE ON ONE SCREEN THAT DEPENDS ON A REFUSAL IN ANOTHER FILE.
 *
 * The connection card stopped saying *"The consent did not include
 * Calendars.Read"* on 2026-09-07, on the owner's instruction: *"I don't want
 * to tell people they already know by not ticking a grant-to-request."*
 *
 * That silence is only honest because of something two directories away.
 * `exchangeCode` compares what the consent ASKED for against what the
 * provider GRANTED, and when the grant is smaller it **stores nothing**:
 *
 *     Google granted less than was asked: the consent is missing {scopes}.
 *     Asking is granting — run Connect with Google again and leave every
 *     requested permission ticked, rather than storing a token that would
 *     fail later.
 *
 * So a face missing from a STORED grant is a face nobody ticked, and saying
 * "the consent did not include it" tells a person what they already decided.
 * Hide it, and nothing is lost.
 *
 * **Loosen that door and the silence becomes a lie.** The day a partial grant
 * can be stored, a card will show four faces, the migration will carry three,
 * and the one sentence explaining the gap will be the one this product
 * deliberately stopped printing — a defect with no error message anywhere,
 * found by a customer counting rows.
 *
 * The two are in different packages with no import between them and no test
 * that reads both, so nothing would have connected them. This file is that
 * connection: it fails if the refusal is removed, and its failure says which
 * screen decision was resting on it.
 *
 * ROOT-LEVEL, SO VITEST AND NODE BUILTINS ONLY (AGENTS.md): a test in
 * `scripts/` cannot resolve workspace imports, so both halves are read as
 * text. The BEHAVIOUR of each half is tested beside it —
 * `google-consent.unit.test.ts` for the refusal, `probe-text.unit.test.tsx`
 * for the silence. What has no other home is the DEPENDENCE.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

describe('the refusal this silence rests on is still guarded', () => {
  /**
   * PINNING THE TEST, NOT THE SOURCE — and that choice was made the hard way.
   *
   * The first version of this file matched `missing.length > 0` and `ok: false`
   * in `google-consent.ts`. Disabling the refusal with `if (false && …)` left
   * every one of those strings in place, so the guard stayed green over a door
   * that had been propped open — the vacuous-assertion family, in a file
   * written to prevent a silent failure.
   *
   * `exchangeCode`'s behaviour already has a real test: it drives the function
   * with a stubbed fetch returning a narrower scope and asserts the refusal.
   * That one goes red for a disabled guard, a deleted guard and a guard that
   * stopped naming the scope. So the honest thing for a file in `scripts/` —
   * which cannot import the function at all — is not to re-test it worse, but
   * to make sure THAT test still exists and still asks that question.
   *
   * Delete the refusal and its test goes red; delete the test to make it pass
   * and this goes red instead, naming the screen that was relying on it.
   */
  const behaviour = read('apps/api/src/routes/migrations/google-consent.unit.test.ts');

  it('a narrower grant is still driven through exchangeCode and refused', () => {
    expect(
      behaviour,
      'the test proving a partial grant is never stored has gone — with it goes the reason ' +
        'the connection card may stay silent about an ungranted face',
    ).toContain('granted less than was asked');
    // The half that makes it a REFUSAL rather than a logged note.
    const at = behaviour.indexOf('granted less than was asked');
    const around = behaviour.slice(Math.max(0, at - 700), at);
    expect(around, 'the refusal is no longer asserted as a refusal').toContain('r.ok).toBe(false)');
  });
});

describe('the card is silent about an ungranted face, and says why in one place', () => {
  const gate = read('packages/shared/src/qualification-gate.ts');

  it('notGranted earns no sentence', () => {
    // `reasonEarnsASentence` is the single decision; a screen that made its
    // own would drift from the other three that read the same record.
    const at = gate.indexOf('export function reasonEarnsASentence');
    expect(at, 'the one place that decides what a screen says is gone').toBeGreaterThan(-1);
    const body = gate.slice(at, gate.indexOf('\n}', at));
    expect(body, 'notGranted has started speaking again — is the consent door still closed?')
      .not.toContain('notGranted');
    // The two that DO speak, so this is not passing by the function being empty.
    expect(body).toContain('refused');
    expect(body).toContain('incomplete');
  });

  it('and the reasoning names the door it depends on, for whoever loosens it', () => {
    // The comment is the load-bearing part here: somebody editing the consent
    // needs to meet this decision, and they will not read a test they do not
    // know exists.
    const at = gate.indexOf('export function reasonEarnsASentence');
    const doc = gate.slice(Math.max(0, at - 2600), at);
    expect(doc, "the silence's justification is no longer written down").toContain(
      'exchangeCode',
    );
    expect(doc).toContain('partial grant');
  });
});
