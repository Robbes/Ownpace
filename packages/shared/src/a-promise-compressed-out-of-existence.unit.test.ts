// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A DISCLOSURE SHORTENED AWAY IS A PROMISE NOBODY MADE.
 *
 * The scope manifest is §11.2's "no silent omissions": what migrates, what
 * migrates partially, what does not, shown before the green light rather than
 * discovered afterwards. On 2026-09-17 the owner read it on the confirm screen
 * and asked for less text — *"the explaining tekst about 'Migrates' in green,
 * 'Partial' in orange and 'Does not migrate' in grey contain alot of tekst.
 * Please compres/rewrite to contain the Essentials"* — and he was right: four
 * rows had grown to five and six lines, and three columns of paragraphs at the
 * moment of deciding is a wall nobody finishes.
 *
 * **Which puts two correct instincts in direct opposition.** Shorter is better
 * on that screen; every long sentence in there was a caveat somebody needs. The
 * resolution is `detail` (one line) plus `more` (the rest, folded) — and this
 * guard is what makes that resolution survive the next person who is asked for
 * less text. Each phrase below is a fact a customer acts on:
 *
 *  - that the JMAP contacts path cannot checksum-verify, so verification
 *    counts and checks presence instead;
 *  - that a generated Message-ID is added to the COPY and the original is
 *    never touched;
 *  - that permissions are inventoried and NOT applied for them;
 *  - that mailbox delegation cannot be read through Graph at all, so they must
 *    capture it themselves before cutover;
 *  - that a shared mailbox needs application permissions on the source.
 *
 * Each may be worded any way at all, and it may sit in `detail` or behind the
 * fold. It may not vanish.
 */

import { describe, it, expect } from 'vitest';
import { SCOPE_MANIFEST, type ScopeManifestEntry } from './scope-manifest.ts';

const COLUMNS = ['migrates', 'partial', 'doesNotMigrate'] as const;

const everyEntry = (): ScopeManifestEntry[] => COLUMNS.flatMap((c) => [...SCOPE_MANIFEST[c]]);

/** Everything a reader can reach about one row: the line plus what it folds. */
const wholeOf = (entry: ScopeManifestEntry): string => `${entry.detail} ${entry.more ?? ''}`;

/** Every word of the manifest a reader can reach, however it is laid out. */
const everything = (): string => everyEntry().map(wholeOf).join('\n');

describe('the line is one line', () => {
  it('keeps every `detail` to something a column can show', () => {
    // 90 characters is roughly a line of a three-column layout on a laptop.
    // The bound is arbitrary; having one is not — without it the rows grow
    // back a clause at a time, which is exactly how they got to six lines.
    for (const entry of everyEntry()) {
      expect(
        entry.detail.length,
        `"${entry.item}" is ${entry.detail.length} characters. Put the essential in ` +
          '`detail` and the rest in `more`, which the screen folds.',
      ).toBeLessThanOrEqual(90);
    }
  });

  it('never leaves a fold that says what the line already said', () => {
    // A fold worth opening ADDS something. One that does not is a click for
    // nothing, and a reader who finds one learns to skip folds — which is how
    // a real disclosure ends up unread.
    //
    // Deliberately not "longer than the line": `SharePoint extras` folds a
    // shorter sentence than it shows, and that fold is the most valuable one
    // in the column — the line lists what stays behind, the fold says the
    // files themselves come across.
    for (const entry of everyEntry()) {
      if (entry.more === undefined) continue;
      expect(entry.more.trim(), `"${entry.item}" folds nothing`).not.toBe('');
      expect(entry.detail, `"${entry.item}" folds a copy of its own line`).not.toContain(
        entry.more,
      );
    }
  });
});

describe('the caveats a customer acts on are still there', () => {
  // Phrase by phrase rather than whole sentences: the wording is free to
  // change, the fact is not.
  const MUST_SURVIVE: ReadonlyArray<readonly [string, RegExp]> = [
    ['JMAP contacts cannot be checksum-verified', /content-checksum sampling does not run/i],
    ['…so verification checks counts and presence', /checks counts and presence/i],
    ['a generated Message-ID goes on the copy', /generated Message-ID/i],
    ['…and the original is never modified', /original on the source is never modified/i],
    ['permissions are not applied for them', /nothing is auto-applied/i],
    ['mailbox delegation is unreadable through Graph', /NOT readable\s+through Graph/i],
    ['…so they capture it themselves', /Exchange Online PowerShell/i],
    ['a shared mailbox needs application permissions', /application permissions on the source/i],
    ['…and where to read about it', /docs\/shared-mailboxes\.md/i],
    ['distribution lists are manual', /Recreating them is manual|recreating them is manual/i],
    ['SharePoint files DO migrate', /files and folders[^.]*are migrated/i],
  ];

  for (const [what, pattern] of MUST_SURVIVE) {
    it(`still says ${what}`, () => {
      expect(
        pattern.test(everything()),
        `The manifest no longer tells the customer ${what}. If the wording changed, update ` +
          'this pattern; if the sentence was dropped to shorten a column, put it back — the ' +
          'fold exists so that nothing has to be dropped.',
      ).toBe(true);
    });
  }

  it('says nothing about a row it does not carry', () => {
    // The other direction of §11.2, and the reason this file is not just a
    // list of greps: a manifest that promised something the code does not do
    // would pass every test above. Proton and the auto-applied permission
    // write are the two the repository has already had to retract.
    expect(everything()).not.toMatch(/Proton/i);
    expect(everything()).not.toMatch(/reversible subset is auto-applied/i);
  });
});
