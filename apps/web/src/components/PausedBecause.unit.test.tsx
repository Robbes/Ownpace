// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A migration that stopped on purpose says so, and says why, on screen.
 *
 * The properties under test are about what a person MEETS, not about what the
 * payload carries:
 *
 *  - the reason is VISIBLE, never behind a hover — task #124's precedent,
 *    because a hover fails on touch, on a keyboard and in a screen reader;
 *  - a hold shows the operator's own words when there are any, and a default
 *    sentence when there are none, so a drain is never wordless;
 *  - nothing about it reads as a failure. Nothing failed.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import PausedBecause from './PausedBecause.tsx';
import LiveProgress from './LiveProgress.tsx';
import type { LiveProgressRow } from './LiveProgress.tsx';
import { STRINGS, LOCALES } from '../i18n/strings.ts';
import type { PauseReason } from '@openmig/shared';

const CEILING: PauseReason = {
  kind: 'daily-download-ceiling',
  provider: 'imap.gmail.com',
  windowResetsAt: '2026-09-09T06:00:00.000Z',
};

describe('the day’s download ceiling', () => {
  it('names whose limit it is, on screen', () => {
    render(<PausedBecause reason={CEILING} />);
    expect(screen.getByText(/imap\.gmail\.com/)).toBeVisible();
  });

  it('says when copying continues, rather than leaving a person guessing', () => {
    render(<PausedBecause reason={CEILING} />);
    // The formatted reset time, whatever the locale renders — asserted as
    // "the sentence carries a time" rather than as an exact string, which
    // would pin the formatter rather than the promise.
    expect(screen.getByRole('note').textContent).toMatch(/2026|9/);
  });

  it('says "when it resets" when the meter reported no window', () => {
    render(<PausedBecause reason={{ ...CEILING, windowResetsAt: null }} />);
    expect(screen.getByRole('note').textContent).toContain(
      STRINGS.en['pause.ceiling.unknown'].split('{provider}')[1]!.trim(),
    );
  });

  it('folds the reassurance rather than putting it in a hover', () => {
    render(<PausedBecause reason={CEILING} />);
    const why = screen.getByText(/The limit belongs to your old provider/);
    expect(why).not.toBeVisible();
    fireEvent.click(screen.getByText('Why?'));
    expect(why).toBeVisible();
  });

  it('is a note, not an alert — nothing failed', () => {
    const { container } = render(<PausedBecause reason={CEILING} />);
    expect(screen.getByRole('note')).toBeTruthy();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    // Red is what this screen uses for a failure. A scheduled pause in red is
    // how somebody comes to distrust a migration that is fine.
    expect(container.innerHTML).not.toMatch(/text-red-/);
  });
});

describe('an operator hold', () => {
  const since = '2026-09-08T09:00:00.000Z';

  it('shows the operator’s own words, verbatim', () => {
    render(
      <PausedBecause
        variant="banner"
        reason={{ kind: 'operator-hold', since, message: 'Back in about an hour.' }}
      />,
    );
    expect(screen.getByText('Back in about an hour.')).toBeVisible();
  });

  it('is never wordless when nobody typed a message', () => {
    render(<PausedBecause variant="banner" reason={{ kind: 'operator-hold', since }} />);
    expect(screen.getByText(STRINGS.en['pause.hold.default'])).toBeVisible();
  });

  it('does not print the default beside a custom message', () => {
    // Two sentences saying nearly the same thing is how a notice stops being
    // read; the operator's words REPLACE the default.
    render(
      <PausedBecause
        variant="banner"
        reason={{ kind: 'operator-hold', since, message: 'Back in about an hour.' }}
      />,
    );
    expect(screen.queryByText(STRINGS.en['pause.hold.default'])).toBeNull();
  });

  it('says since when', () => {
    render(<PausedBecause variant="banner" reason={{ kind: 'operator-hold', since }} />);
    expect(screen.getByText(new RegExp(STRINGS.en['pause.hold.since']))).toBeVisible();
  });
});

describe('what starts again by itself when a hold lifts (0132 T6 (b))', () => {
  /**
   * Since T6 (b) a hold refuses every button that would start work, with the
   * operator's sentence, and a refused press is NOT remembered: a *Start*
   * refused leaves the migration unstarted, a refused sync or check is never
   * queued. The fold under the banner said *"new copying starts again by
   * itself once the update is done"*, which is true of the scheduled passes
   * and untrue of every press the hold turned away. A tester who believed it
   * would wait for a pass nobody was going to start.
   *
   * The two sentences are pinned word for word. A guard of keywords passed a
   * line that said the opposite (*"… it is scheduled and starts by itself
   * after the update, so you need not start it again"*), so these are the
   * sentences themselves: *by itself* said of the scheduled copying, and the
   * press told, in the imperative, to be made again.
   */
  const PINNED = {
    en: {
      scheduled:
        'Migrations already running finish normally, and scheduled copying starts again by itself once the update is done, from exactly where it stopped.',
      press: 'Any copying you tried to start during the pause did not start: start it again after the update.',
    },
    nl: {
      scheduled:
        'Migraties die al liepen worden normaal afgerond, en het geplande kopiëren start vanzelf weer zodra de update klaar is, precies waar het stopte.',
      press: 'Kopiëren dat u tijdens de pauze probeerde te starten, is niet gestart: start het na de update opnieuw.',
    },
  } as const;
  const ITSELF = { en: /by itself/i, nl: /vanzelf/i } as const;

  for (const locale of LOCALES) {
    const why = STRINGS[locale]['pause.hold.why'];

    it(`${locale}: says scheduled copying starts again by itself`, () => {
      expect(why).toContain(PINNED[locale].scheduled);
    });

    it(`${locale}: says a press made during the pause did not start and must be made again`, () => {
      expect(why).toContain(PINNED[locale].press);
    });

    it(`${locale}: promises "by itself" nowhere but of the scheduled copying`, () => {
      // Whatever else the line grows, it must not add a second promise.
      expect(why.split(PINNED[locale].scheduled).join('')).not.toMatch(ITSELF[locale]);
    });
  }
});

describe('the progress strip', () => {
  const row = (over: Partial<LiveProgressRow> = {}): LiveProgressRow => ({
    domain: 'email',
    state: 'in_progress',
    itemsSynced: 4210,
    itemsFailed: 0,
    itemsRetrying: 0,
    ...over,
  });

  it('carries a paused domain’s reason', () => {
    render(<LiveProgress domains={[row({ pausedReason: CEILING })]} />);
    expect(screen.getByText(/imap\.gmail\.com/)).toBeVisible();
  });

  it('says when a first copy last moved, before it has ever completed', () => {
    // The two-day first copy that read "never synced" while the counter
    // climbed. `lastActiveAt` is what stops a working migration looking dead.
    render(<LiveProgress domains={[row({ lastActiveAt: new Date().toISOString() })]} />);
    expect(screen.getByText(new RegExp(STRINGS.en['confirm.progress.lastActive']))).toBeVisible();
  });

  it('drops back to the completion once there is one', () => {
    // Two times would invite the reader to work out which one matters.
    render(
      <LiveProgress
        domains={[
          row({
            state: 'completed',
            lastSyncedAt: new Date().toISOString(),
            lastActiveAt: new Date().toISOString(),
          }),
        ]}
      />,
    );
    expect(screen.queryByText(new RegExp(STRINGS.en['confirm.progress.lastActive']))).toBeNull();
    expect(screen.getByText(new RegExp(STRINGS.en['confirm.progress.lastSynced']))).toBeVisible();
  });
});

describe('the words exist in both languages', () => {
  const KEYS = [
    'pause.label',
    'pause.ceiling',
    'pause.ceiling.unknown',
    'pause.ceiling.why',
    'pause.hold.heading',
    'pause.hold.default',
    'pause.hold.since',
    'pause.hold.why',
    'confirm.progress.lastActive',
  ] as const;

  for (const locale of LOCALES) {
    it(`${locale} has all of them, non-empty`, () => {
      for (const key of KEYS) {
        expect(STRINGS[locale][key], `${locale} is missing ${key}`).toBeTruthy();
      }
    });
  }

  it('the ceiling sentence names the provider and the reset in both', () => {
    for (const locale of LOCALES) {
      expect(STRINGS[locale]['pause.ceiling']).toContain('{provider}');
      expect(STRINGS[locale]['pause.ceiling']).toContain('{resets}');
      expect(STRINGS[locale]['pause.ceiling.unknown']).toContain('{provider}');
    }
  });
});

describe('new items waiting at the data ceiling (0109 T6)', () => {
  const AT_THE_CEILING: PauseReason = {
    kind: 'data-ceiling',
    ceilingGb: 750,
    held: 3,
    moveUp: { name: 'Medium', setupEur: 7, monthlyEur: 8 },
    topUp: { bandGb: 750, priceEur: 8 },
  };

  it('says what waits, that changes carry on, and both ways on with their prices', () => {
    render(<PausedBecause reason={AT_THE_CEILING} />);
    const text = screen.getByRole('note').textContent ?? '';
    expect(text).toContain('New items wait at your data ceiling of 750 GB: 3 not copied yet.');
    expect(text).toContain('Changes to what is already copied carry on.');
    expect(text).toContain('Move up to Medium: €7 once, then €8 a month.');
    expect(text).toContain('Or buy another 750 GB once, for €8.');
  });

  it('names no top-up on Tiny, and a ceiling past a thousand GB in TB', () => {
    render(<PausedBecause reason={{ ...AT_THE_CEILING, ceilingGb: 2000, topUp: null }} />);
    const text = screen.getByRole('note').textContent ?? '';
    expect(text).toContain('data ceiling of 2 TB');
    expect(text).not.toContain('Or buy another');
  });

  it('is a note, not an alert: nothing failed', () => {
    render(<PausedBecause reason={AT_THE_CEILING} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
