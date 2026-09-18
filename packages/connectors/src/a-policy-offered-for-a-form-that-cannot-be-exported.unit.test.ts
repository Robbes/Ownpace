// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A POLICY OFFERED FOR A FORM THAT CANNOT BE EXPORTED (found live 2026-09-11).
 *
 * The refusal for a Google Form, a My Map and a Drive shortcut all read "Set
 * an export policy on the mapping to migrate these" — the same sentence as
 * for a Doc. Drive cannot export a Form, a Map or a shortcut in ANY format
 * (`files.export` answers 403), so the operator who followed that advice
 * changed a setting and watched the same items fail again. The sentence
 * has to depend on what the thing is, because the way out does.
 *
 * And every one of them is a DECISION (`isDecisionError`): the sync loop
 * parks it on first sight rather than retrying a policy five times.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDecisionError, statedFailureCategoryOf, classifyFailure } from '@openmig/shared';
import { NativeFileRefused, EXPORTABLE_NATIVE_TYPES, DRIVE_SHORTCUT_MIME } from './google-drive-source.ts';
import {
  NATIVE_EXPORT_EXTENSIONS,
  NATIVE_EXPORT_TYPES,
  stablePoliciesFor,
} from './google-drive-source.types.ts';

const G = 'application/vnd.google-apps.';

describe('NativeFileRefused says the thing that is true for THIS type', () => {
  it('a Doc under refuse: the export policy is the way out, and is named', () => {
    const e = new NativeFileRefused('Heen-en-Weer tas', `${G}document`);
    expect(e.message).toContain('is a Google Doc');
    expect(e.message).toContain('nativeFilePolicy="refuse"');
    expect(e.message).toContain('Set an export policy');
  });

  // Still the raw suffix for these four, deliberately: "a Google form" and "a
  // Google site" ARE what people say, and these refusals do not ask anybody to
  // choose anything, so there is no file to recognise. Only the four editor
  // types get a product name — see `nativeFileWord`.
  it.each(['form', 'map', 'site', 'script'])('a %s: no export exists, so no policy is offered', (kind) => {
    const e = new NativeFileRefused('Thema-avond', `${G}${kind}`);
    expect(e.message).toContain(`is a Google ${kind}`);
    expect(e.message).toContain(`cannot export a ${kind}`);
    expect(e.message).not.toContain('export policy on the mapping');
    expect(e.message).toContain('Accept leaving it behind');
  });

  it('a shortcut is a pointer, not content', () => {
    const e = new NativeFileRefused('Process mining tools overview', DRIVE_SHORTCUT_MIME);
    expect(e.message).toContain('is a Google Drive shortcut');
    expect(e.message).toContain('nothing to copy');
    expect(e.message).not.toContain('export policy');
  });

  it('an exportable type the chosen policy has no rendering for names the policy', () => {
    // DEFENSIVE, and deliberately kept. Since every policy gained a rendering
    // for every exportable type (drawings included, 2026-09-14), `refusalFor`
    // can no longer reach this branch with real data — the guard below is what
    // keeps that true. It comes back the moment somebody adds a fourth policy
    // or Drive grows a fifth exportable type, and the sentence it produces is
    // the one that would then have to be right.
    //
    // Constructed directly rather than through `refusalFor`, because the
    // constructor does not consult the table; the caller decides.
    const e = new NativeFileRefused('Sketch', `${G}drawing`, 'export-office');
    expect(e.message).toContain('export policy (export-office) has no rendering for a Drawing');
  });

  it('every refusal is a decision the loop parks, never a retry', () => {
    for (const mime of [`${G}document`, `${G}form`, DRIVE_SHORTCUT_MIME]) {
      expect(isDecisionError(new NativeFileRefused('x', mime))).toBe(true);
    }
    expect(isDecisionError(new Error('ECONNRESET'))).toBe(false);
  });

  it('the exportable set is exactly what the export policies can render', () => {
    const fromPolicies = new Set(Object.values(NATIVE_EXPORT_TYPES).flatMap((m) => Object.keys(m)));
    for (const mime of fromPolicies) expect(EXPORTABLE_NATIVE_TYPES.has(mime)).toBe(true);
    expect(EXPORTABLE_NATIVE_TYPES.has(`${G}form`)).toBe(false);
    expect(EXPORTABLE_NATIVE_TYPES.has(DRIVE_SHORTCUT_MIME)).toBe(false);
  });

  it('EVERY policy renders EVERY exportable type', () => {
    // The other direction, and the one that matters to an owner: a type listed
    // as exportable but unmapped by the policy they chose produces "choose a
    // policy that covers it" about a file no policy covers. Drawings were in
    // that state from the day the set was written until 2026-09-14 — listed
    // exportable, mapped by nothing — so the sentence sent people to a setting
    // that could not help.
    for (const [policy, map] of Object.entries(NATIVE_EXPORT_TYPES)) {
      for (const mime of EXPORTABLE_NATIVE_TYPES) {
        expect(map[mime], `${policy} has no rendering for ${mime}`).toBeDefined();
      }
    }
  });

  it('every rendering a policy produces has a file extension', () => {
    // Without one the export lands as "Aanbiedingstekst" holding ODT bytes,
    // which the owner's desktop offers no application for. The connector falls
    // back to the bare name when the extension is missing rather than
    // inventing one, so a gap here is silent — this is what finds it.
    for (const [policy, map] of Object.entries(NATIVE_EXPORT_TYPES)) {
      for (const target of Object.values(map)) {
        expect(NATIVE_EXPORT_EXTENSIONS[target], `${policy} exports ${target}`).toMatch(/^\.[a-z0-9]+$/);
      }
    }
  });
});

describe('the refusal calls each file what its owner calls it', () => {
  /**
   * "A Google presentation" is the MIME suffix with a space in front of it, and
   * it went out to every customer whose deck was refused. The four types a
   * policy can render are exactly the ones where that matters: those refusals
   * ask somebody to choose a policy, and choosing one starts with recognising
   * which of your files is being talked about.
   */
  it.each([
    ['document', 'Doc'],
    ['spreadsheet', 'Sheet'],
    ['presentation', 'Slides deck'],
    ['drawing', 'Drawing'],
  ])('calls a %s a "%s"', (mime, word) => {
    const e = new NativeFileRefused('Thema-avond', `${G}${mime}`, 'export-office', 'unstable');
    expect(e.message).toContain(`is a Google ${word}`);
    // And in the way out too, not just the opening — the sentence that tells
    // somebody what to do is the one they act on.
    expect(e.message).toContain(`Move the ${word} out of scope`);
  });

  it('never leaks the raw MIME suffix for one of those four', () => {
    // The failure mode is a sentence half-translated: "is a Google Slides deck
    // ... move the presentation out of scope". Asserted as an absence because
    // that is how it would arrive — one interpolation somebody missed.
    for (const mime of ['document', 'spreadsheet', 'presentation']) {
      const e = new NativeFileRefused('Thema-avond', `${G}${mime}`, 'export-office', 'unstable');
      expect(e.message, `${mime} leaked into the sentence`).not.toContain(` ${mime}`);
    }
  });

  it('leaves the LEDGER key alone, which is the suffix and must stay it', () => {
    // `migration_discovery.refused_native` is `{"presentation": 3}` and the
    // screen translates that key in both locales. If the connector started
    // writing "Slides deck" there, every stored count would miss its label and
    // the confirm screen would show a raw word in a Dutch sentence.
    const source = readFileSync(join(import.meta.dirname, 'google-drive-source.ts'), 'utf8');
    expect(
      source,
      'the refused-native tally stopped keying on the MIME suffix, so stored counts no longer ' +
        'match `discovery.refusedNative.kind.*`',
    ).toMatch(/refusedNative\.set\(\s*kind/);
    const tally = source.slice(source.indexOf('this.refusedNative.set') - 200);
    expect(tally.slice(0, 260)).toMatch(/slice\(GOOGLE_NATIVE_PREFIX\.length\)/);
  });
});

describe('the way out does not say the same policy twice', () => {
  it('reads as one clause when export-pdf is the only alternative', () => {
    // Was: `"export-pdf" is measured stable for a Slides deck ("export-pdf" is
    // not editable afterwards)` — the name twice in a row, which reads as a
    // stutter and buries the only thing the clause is there to say.
    //
    // THE EXAMPLE MOVED on 2026-09-17 and the rule did not. A deck used to be
    // the one-alternative case; `export-odf` on a deck then measured
    // container-only, so a deck has two and takes the branch below. A DOC is
    // the one-alternative case now — `export-odf` is genuinely unstable for
    // one, so `export-pdf` stands alone. If that ever stops being true this
    // reds again, and the single-alternative wording needs a live example or
    // it is dead prose.
    const e = new NativeFileRefused('Q3 report', `${G}document`, 'export-office', 'unstable');
    expect(e.message).toContain('"export-pdf" is measured stable for a Doc, though a PDF is not editable afterwards');
    expect(e.message.match(/"export-pdf"/g), 'names export-pdf more than once').toHaveLength(1);
  });

  it('keeps the parenthetical when there are two, because it says WHICH', () => {
    // With two alternatives the aside is doing real work: it is the difference
    // between them, and it is the reason to prefer the other one.
    const e = new NativeFileRefused('Q3 report', `${G}document`, 'export-odf', 'unstable');
    expect(e.message).toContain('"export-office" and "export-pdf" are measured stable for a Doc ("export-pdf" is not editable afterwards)');
  });

  it('a refused DECK now gets an editable alternative, which it never had', () => {
    // The product change hiding inside a table edit. Until `export-odf` on a
    // deck was measured, the only measured way to carry a refused deck was a
    // PDF — a fixed rendering. Now the sentence leads with a format that
    // stays editable and marks the lossy one as the aside.
    const e = new NativeFileRefused('Thema-avond', `${G}presentation`, 'export-office', 'unstable');
    expect(e.message).toContain(
      '"export-odf" and "export-pdf" are measured stable for a Slides deck ' +
        '("export-pdf" is not editable afterwards)',
    );
  });
});

/**
 * AND IT SAYS IT TO THE LEDGER TOO, not only to the reader (workplan 0125 T4).
 *
 * Every assertion above is about the SENTENCE, and the sentence was the only
 * thing this error produced until 2026-09-18. `classifyFailure` then read that
 * sentence back, found no protocol vocabulary in it — correctly, there is none,
 * it is our own prose — and answered `unknown`, whose remedy is "send it to us
 * and we will look". Thirty of the owner's files reached his screen that way.
 *
 * So the branch that picks the sentence also states the category, and the two
 * are read off the same condition. The split is WHETHER A SETTING WOULD CHANGE
 * THE ANSWER, because the Failures page offers one press per group and a group
 * whose remedy is "change the export policy" must not contain an item no policy
 * can carry.
 */
describe('NativeFileRefused states which KIND of refusal this is', () => {
  it('a Doc under refuse is policy_refused: a setting is the way out', () => {
    // The owner's twenty-one. The source would have handed it over and the
    // destination was never asked.
    const e = new NativeFileRefused('Heen-en-Weer tas', `${G}document`);
    expect(statedFailureCategoryOf(e)).toBe('policy_refused');
  });

  it.each(['form', 'map', 'site', 'script'])(
    'a %s is source_refused: no setting changes what Drive will produce',
    (kind) => {
      // The owner's other nine. Grouping these with the twenty-one is the
      // defect: one button, and the two remedies are opposites.
      const e = new NativeFileRefused('Thema-avond', `${G}${kind}`);
      expect(statedFailureCategoryOf(e)).toBe('source_refused');
    },
  );

  it('a shortcut is source_refused: there is no content to have a policy about', () => {
    const e = new NativeFileRefused('Process mining tools overview', DRIVE_SHORTCUT_MIME);
    expect(statedFailureCategoryOf(e)).toBe('source_refused');
  });

  it('a measured-unstable export is policy_refused, because another policy carries it', () => {
    // Drive CAN export this one; what this migration declined is what the
    // export is worth. The sentence names the policies that are measured
    // stable, and the category says the same thing to the ledger.
    const e = new NativeFileRefused('Q3 report', `${G}document`, 'export-office', 'unstable');
    expect(e.message).toContain('is measured stable for a Doc');
    expect(statedFailureCategoryOf(e)).toBe('policy_refused');
  });

  it('a policy with no rendering is policy_refused: choose one that covers it', () => {
    const e = new NativeFileRefused('Q3 report', `${G}document`, 'export-pdf');
    expect(statedFailureCategoryOf(e)).toBe('policy_refused');
  });

  it.each([...EXPORTABLE_NATIVE_TYPES])(
    'every policy in force on %s still leaves a stable one to switch TO',
    (mimeType) => {
      // THE GUARD THAT MAKES `policy_refused` HONEST, and it is over the
      // measurement table rather than over the constructor.
      //
      // The category promises a person that changing a setting carries these
      // items. That promise is true today for a reason nothing states: every
      // exportable type has at least two policies measured stable, so whichever
      // one is in force there is another to move to. Nothing enforced it, and
      // the way it would break is ordinary — Google releases a type, somebody
      // adds it to `EXPORTABLE_NATIVE_TYPES` so the refusal stops telling
      // people it can never be exported, and nobody runs the instrument. Its
      // refusals would then be filed under a press whose remedy names no
      // format they can choose, which is the one-button-two-remedies defect
      // this category was added to end, one size down.
      //
      // Conditioning the constructor on it instead was tried and removed: the
      // branch cannot fire, so no test could prove it. This can, and it names
      // the type.
      for (const inForce of ['refuse', 'export-odf', 'export-office', 'export-pdf'] as const) {
        const alternatives = stablePoliciesFor(mimeType).filter((p) => p !== inForce);
        expect(
          alternatives.length,
          `under ${inForce} a refused ${mimeType} would be policy_refused with nowhere to go`,
        ).toBeGreaterThan(0);
      }
    },
  );

  it('every refusal states SOMETHING, so none of them reaches a screen as unknown', () => {
    // The class this closes. Any branch added to the constructor without a
    // category fails here, rather than shipping and being discovered on
    // somebody's live migration.
    for (const mimeType of [
      DRIVE_SHORTCUT_MIME,
      `${G}form`,
      ...EXPORTABLE_NATIVE_TYPES,
    ]) {
      for (const policy of ['refuse', 'export-odf', 'export-office', 'export-pdf'] as const) {
        for (const stability of ['stable', 'unstable'] as const) {
          const e = new NativeFileRefused('X', mimeType, policy, stability);
          const stated = statedFailureCategoryOf(e);
          expect(stated, `${mimeType} / ${policy} / ${stability}`).toBeDefined();
          expect(classifyFailure(e.message, 'source', stated)).toBe(stated);
          expect(classifyFailure(e.message, 'source', stated)).not.toBe('unknown');
        }
      }
    }
  });
});
