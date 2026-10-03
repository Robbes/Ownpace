// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The failure a customer can act on (workplan 0110 T3).
 *
 * The owner's reframing made the CUSTOMER the primary reader — *"most of it
 * must be self-service. I'm to be contacted in rare / edge cases."* So the
 * property under test is not "a category is stored" but **"a person reading
 * this screen is told what to do"**, and the two are not the same: a label
 * rendered where a sentence belongs is exactly the failure this task exists
 * to avoid.
 *
 * The provider's own words stay on the screen beside it. That is the older
 * rule (the prose boundary) and it still holds — precision for whoever needs
 * it, the way out for whoever does not.
 */

import { render, screen } from '@testing-library/react';
import { afterEach, describe, it, expect } from 'vitest';
import LiveProgress from './LiveProgress.tsx';
import type { LiveProgressRow } from './LiveProgress.tsx';
import { STRINGS, LOCALES } from '../i18n/strings.ts';
import { LocaleProvider } from '../i18n/index.tsx';
import { FAILURE_CATEGORIES } from '@openmig/shared';
import { FAILURE_KEY } from '../i18n/failure-key.ts';

const row = (over: Partial<LiveProgressRow> = {}): LiveProgressRow => ({
  domain: 'email',
  state: 'failed',
  itemsSynced: 12,
  itemsFailed: 1,
  itemsRetrying: 0,
  ...over,
});

/**
 * LEFT ALONE IS NOT COPIED (workplan 0124 T2).
 *
 * Every other number on this strip is something that HAPPENED to an item. The
 * items hard rule 2 protects had nothing happen to them and no counter at all,
 * so a migration that adopted four hundred contacts showed four hundred fewer
 * of everything with no word for the gap.
 */
describe('what the strip says about items nothing happened to', () => {
  it('counts them, beside what was copied', () => {
    render(<LiveProgress domains={[row({ itemsAdopted: 402 })]} />);
    expect(screen.getByText(/402 left as they are/i)).toBeTruthy();
  });

  /**
   * AND SAYS WHAT IT MEANS, ON SCREEN (0154 T2). The meaning lived only in a
   * tooltip, which a phone never shows.
   */
  it('says what it means where it is read, not only in a tooltip', () => {
    render(<LiveProgress domains={[row({ itemsAdopted: 402 })]} />);
    expect(
      screen.getByText(/402 left as they are: already on the new system, or changed there since/),
    ).toBeTruthy();
  });

  /**
   * SILENCE, NOT "NONE". An appliance older than this field serves no count,
   * and a strip that answered "0 left as they are" would be reporting a
   * measurement nobody took (hard rule 9).
   */
  it('says nothing at all when nobody counted', () => {
    render(<LiveProgress domains={[row()]} />);
    expect(screen.queryByText(/left as they are/i)).toBeNull();
  });

  /**
   * And nothing for a counted zero either — the count was taken and there is
   * nothing to report, so a line saying "0" would be noise on a strip whose
   * whole rule is one thing per line. The DISTINCTION still has to survive the
   * wire (the report and the view row both keep a counted zero); it is this
   * screen that decides a zero is not worth a line.
   */
  it('renders no line for a counted zero', () => {
    render(<LiveProgress domains={[row({ itemsAdopted: 0 })]} />);
    expect(screen.queryByText(/left as they are/i)).toBeNull();
  });

  /**
   * ONE SENTENCE FOR BOTH KINDS. The ledger records "already there" and "you
   * edited our copy" under one status and cannot tell them apart afterwards, so
   * the fold must claim neither — it says what is true of both.
   */
  it('explains it without inventing a split the ledger cannot support', () => {
    render(<LiveProgress domains={[row({ itemsAdopted: 3 })]} />);
    const why = STRINGS.en['confirm.progress.leftAsIs.why'];
    expect(why).toMatch(/already on the new system/i);
    expect(why).toMatch(/changed there since/i);
    // And it never promises which of the two any particular item was.
    expect(screen.getByTitle(why)).toBeTruthy();
  });
});

describe('a failed domain says what to do about it', () => {
  it('renders the remedy sentence, not the category name', () => {
    render(
      <LiveProgress
        domains={[row({ lastErrorCategory: 'auth_expired', lastError: 'invalid_grant' })]}
      />,
    );
    // The word a customer cannot act on must not be what they are shown.
    expect(screen.queryByText('auth_expired')).toBeNull();
    expect(screen.getByText(/press Reconnect or Replace credentials, whichever its row shows/i)).toBeTruthy();
  });

  it('keeps the provider prose VERBATIM beside it — both, not one', () => {
    const raw = '{"error":"invalid_grant","error_description":"Token has been expired."}';
    render(<LiveProgress domains={[row({ lastErrorCategory: 'auth_expired', lastError: raw })]} />);
    expect(screen.getByText(raw)).toBeTruthy();
    expect(screen.getByText(/press Reconnect or Replace credentials, whichever its row shows/i)).toBeTruthy();
  });

  it('renders the prose alone when nothing was classified', () => {
    // Rows written before this shipped have no category. They must not lose
    // the error they always showed.
    render(<LiveProgress domains={[row({ lastError: 'something went wrong' })]} />);
    expect(screen.getByText('something went wrong')).toBeTruthy();
  });

  it("unknown carries the way OUT of self-service, not a shrug", () => {
    // The one category whose whole job is to end the self-service attempt
    // honestly rather than leave somebody staring at a blank.
    render(<LiveProgress domains={[row({ lastErrorCategory: 'unknown', lastError: 'x' })]} />);
    expect(screen.getByText(/send it to us/i)).toBeTruthy();
  });
});

describe('every category can be said, in both languages', () => {
  it('has a non-empty sentence for every category in en and nl', () => {
    // A category with no sentence reaches a screen with nothing to say. The
    // Record<FailureCategory, StringKey> in the component makes a MISSING key
    // a typecheck failure; this makes an EMPTY one a test failure.
    //
    // THE MAP IS IMPORTED, not retyped here (2026-09-17). It used to be a
    // hand-copied literal of the six, which meant this test asserted that the
    // six it knew about had sentences — not that the categories the PRODUCT
    // has do. Adding `source_refused` and `format_refused` proved the point:
    // `FAILURE_CATEGORIES` grew, the copy did not, and the loop was checking
    // two of them against `undefined`. The file this map lives in opens by
    // explaining why a second copy of it is a defect; this was the second
    // copy.
    const keys = FAILURE_KEY;
    for (const category of FAILURE_CATEGORIES) {
      for (const locale of LOCALES) {
        const sentence = STRINGS[locale][keys[category]];
        expect(sentence, `${category} in ${locale}`).toBeTruthy();
        // A sentence, not a label: the remedy is the product.
        expect(sentence.length, `${category} in ${locale} is too short to be a remedy`)
          .toBeGreaterThan(30);
      }
    }
  });

  it('never shows a raw category token in either language', () => {
    for (const locale of LOCALES) {
      for (const category of FAILURE_CATEGORIES) {
        for (const [, sentence] of Object.entries(STRINGS[locale])) {
          expect(sentence).not.toBe(category);
        }
      }
    }
  });
});

describe('which side it happened on (workplan 0094 T5, second slice)', () => {
  it('says the side after the remedy when the pass could tell', () => {
    render(
      <LiveProgress
        domains={[row({ lastErrorCategory: 'auth_expired', lastError: 'invalid_grant', failedSide: 'source' })]}
      />,
    );
    expect(screen.getByText(/press Reconnect or Replace credentials, whichever its row shows/i)).toBeTruthy();
    expect(screen.getByText(/It happened on the source side\./)).toBeTruthy();
  });

  it('says nothing about the side when the pass could not tell — never a guess', () => {
    render(<LiveProgress domains={[row({ lastErrorCategory: 'auth_expired' })]} />);
    expect(screen.queryByText(/side\./)).toBeNull();
  });

  it('has a sentence for every side, in every locale', () => {
    for (const locale of LOCALES) {
      for (const key of ['failure.side.source', 'failure.side.target'] as const) {
        expect(STRINGS[locale][key]).toBeTruthy();
      }
    }
  });
});

/**
 * A DATA TYPE SWITCHED OFF AFTER COPYING (workplan 0125 T7).
 *
 * The strip hid every switched-off data type, because they were all `skipped`
 * and `skipped` means one the migration never had. A calendar with four
 * hundred copies that no longer follow the source vanished from the page with
 * them. `stopped` keeps its line, its count and a sentence; `skipped` still
 * has none.
 */
describe('a stopped data type keeps its line', () => {
  const calendar = (state: LiveProgressRow['state']) =>
    row({ domain: 'calendar', state, itemsSynced: 412, itemsFailed: 0 });

  it('shows it, with how many copies stay and that they no longer follow the source', () => {
    render(<LiveProgress domains={[calendar('stopped')]} />);
    expect(screen.getByText('Calendar')).toBeTruthy();
    expect(screen.getByText(STRINGS.en['confirm.state.stopped'])).toBeTruthy();
    expect(screen.getByText('412 copied · total not known')).toBeTruthy();
    expect(screen.getByText(STRINGS.en['confirm.progress.stopped'])).toBeTruthy();
  });

  it('says the three things the owner named, in both languages', () => {
    // The copies stay, they no longer follow the source, and switching it back
    // on continues where it stopped (0125 T7).
    expect(STRINGS.en['confirm.progress.stopped']).toMatch(/copies stay, but no longer follow the source/);
    expect(STRINGS.en['confirm.progress.stopped.why']).toMatch(/continues where it stopped/);
    expect(STRINGS.nl['confirm.progress.stopped']).toMatch(/kopieën blijven, maar volgen de bron niet meer/);
    expect(STRINGS.nl['confirm.progress.stopped.why']).toMatch(/gaat verder waar het stopte/);
  });

  it('a skipped one still has no line: the migration never had it', () => {
    render(<LiveProgress domains={[calendar('skipped')]} />);
    expect(screen.queryByText('Calendar')).toBeNull();
  });

  it('says it only of a stopped one', () => {
    render(<LiveProgress domains={[calendar('completed')]} />);
    expect(screen.queryByText(STRINGS.en['confirm.progress.stopped'])).toBeNull();
  });
});

/**
 * OF ABOUT HOW MANY (workplan 0154 T2).
 *
 * The row said *"18,234 synced"*: how many had arrived, and not of how many.
 * Both editions now serve what discovery found on each row, and the row sets
 * the copies against it, as a line, a bar and bytes. The rules are
 * `progress-totals.ts`'s, tested there; these hold what the reader sees.
 */
describe('of about how many', () => {
  const GB = 1024 ** 3;
  const mail = (over: Partial<LiveProgressRow> = {}): LiveProgressRow =>
    row({ state: 'in_progress', itemsSynced: 18_234, itemsFailed: 0, itemsFound: 19_000, ...over });

  afterEach(() => window.localStorage.removeItem('ownpace.locale'));

  it('reads "18,234 of about 19,000", with a bar that says the same in words', () => {
    render(<LiveProgress domains={[mail()]} />);
    expect(screen.getByText('18,234 of about 19,000')).toBeTruthy();
    const bar = screen.getByRole('progressbar', { name: 'Email' });
    expect(bar.getAttribute('aria-valuenow')).toBe('95');
    expect(bar.getAttribute('aria-valuetext')).toBe('18,234 of about 19,000');
  });

  it('adds the bytes as one quantity, when both sides were measured', () => {
    render(<LiveProgress domains={[mail({ bytesTransferred: 3.1 * GB, bytesFound: 3.4 * GB })]} />);
    expect(screen.getByText('18,234 of about 19,000 · 3.1 of about 3.4 GB')).toBeTruthy();
  });

  it('in Dutch, with Dutch digits', () => {
    window.localStorage.setItem('ownpace.locale', 'nl');
    render(
      <LocaleProvider>
        <LiveProgress domains={[mail({ bytesTransferred: 3.1 * GB, bytesFound: 3.4 * GB, itemsAdopted: 12 })]} />
      </LocaleProvider>,
    );
    expect(screen.getByText('18.234 van ongeveer 19.000 · 3,1 van ongeveer 3,4 GB')).toBeTruthy();
    expect(
      screen.getByText(/12 ongemoeid gelaten: stonden al op het nieuwe systeem, of zijn daar sindsdien gewijzigd/),
    ).toBeTruthy();
  });

  /** Hard rule 9: no count from discovery, no total; never "of 0", and no empty bar. */
  it('says the total is not known when discovery has none, and draws no bar', () => {
    render(<LiveProgress domains={[mail({ itemsFound: undefined, bytesTransferred: 3.1 * GB })]} />);
    expect(screen.getByText('18,234 copied · total not known')).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.queryByText(/of about/)).toBeNull();
  });

  it('says none were found when discovery counted none and none arrived', () => {
    render(<LiveProgress domains={[row({ domain: 'task', state: 'completed', itemsSynced: 0, itemsFailed: 0, itemsFound: 0 })]} />);
    expect(screen.getByText('none found to copy')).toBeTruthy();
    expect(screen.queryByText(/of about 0/)).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  /** About is literal: the total grows with what arrived, and the bar stops at 100%. */
  it('never shows more than all of it', () => {
    render(<LiveProgress domains={[mail({ itemsSynced: 19_250 })]} />);
    expect(screen.getByText('19,250 of about 19,250')).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100');
  });

  it('draws what was left as it was after the copies, in the same bar', () => {
    render(<LiveProgress domains={[row({ domain: 'contact', state: 'completed', itemsSynced: 210, itemsFailed: 0, itemsAdopted: 402, itemsFound: 612 })]} />);
    const parts = screen.getByRole('progressbar').children;
    expect(parts).toHaveLength(2);
    expect((parts[0] as HTMLElement).style.width).toBe(`${(210 / 612) * 100}%`);
    expect((parts[1] as HTMLElement).style.width).toBe(`${(402 / 612) * 100}%`);
  });

  it('says what happened to the rest on one line', () => {
    render(<LiveProgress domains={[mail({ itemsFailed: 12, itemsRetrying: 3, itemsAdopted: 402 })]} />);
    const failed = screen.getByText('12 failed');
    const line = failed.parentElement;
    expect(line?.textContent).toBe(
      '12 failed · 3 retrying · 402 left as they are: already on the new system, or changed there since',
    );
  });
});
