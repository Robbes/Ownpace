// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The queues explain themselves in the screen's own words (the owner,
 * 2026-10-18).
 *
 * *What this means and what you can do* names each option by the button it
 * is about, and the chips on Deletions say how we know an item is gone. The
 * guidance lives in `@openmig/shared` and the buttons in this app's
 * dictionary, so nothing but this keeps them saying the same thing: a button
 * renamed in one place would leave the fold sending people to a button that
 * is not on the screen. Held here in both languages.
 */
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { QUEUE_GUIDANCE, type GuidedQueue } from '@openmig/shared';
import { LocaleProvider } from '../../i18n/index.tsx';
import { LOCALES, STRINGS } from '../../i18n/strings.ts';
import { EvidenceBadge, GuidancePanel } from './primitives.tsx';

type Key = keyof (typeof STRINGS)['en'];

/**
 * The words each option's label must start with, in order: the button (or
 * section) the screen draws for it. `null` is an option with no button of its
 * own (*Do nothing*).
 */
const LABELS: Record<GuidedQueue, ReadonlyArray<Key | null>> = {
  deletions: ['deletions.keep', 'deletions.apply', null],
  moves: ['moves.keep', 'moves.apply'],
  failures: ['failures.retry', 'failures.accept', 'failures.stillTrying'],
};

afterEach(() => {
  window.localStorage.removeItem('ownpace.locale');
});

describe('the guidance names the buttons the screen draws', () => {
  for (const locale of LOCALES) {
    const words = STRINGS[locale];

    it(`in ${locale}: every option is labelled with its button's name`, () => {
      for (const [queue, keys] of Object.entries(LABELS) as Array<[GuidedQueue, Array<Key | null>]>) {
        const options = QUEUE_GUIDANCE[queue][locale].options;
        expect(options.map((o) => o.label).length, queue).toBe(keys.length);
        options.forEach((option, i) => {
          const key = keys[i];
          if (key) expect(option.label, `${queue} option ${i}`).toMatch(new RegExp(`^${escape(words[key])}`));
        });
      }
    });

    it(`in ${locale}: the sentences that name a button or a chip name it as the screen does`, () => {
      // Moves: "…then press Leave it where it is."
      expect(QUEUE_GUIDANCE.moves[locale].closing).toContain(words['moves.keep']);
      // Deletions: "…never for an item marked Assumed." The chip's word, up to its colon.
      const assumed = words['evidence.inferred'].split(':')[0]!;
      expect(QUEUE_GUIDANCE.deletions[locale].options[1]!.text).toContain(assumed);
      // "…while deleting by hand is on": the switch on the same screen.
      const switchName = locale === 'nl' ? 'Handmatig verwijderen' : 'deleting by hand';
      expect(QUEUE_GUIDANCE.deletions[locale].options[1]!.text).toContain(switchName);
      expect(words['applyFlag.on'].toLowerCase()).toContain(switchName.toLowerCase());
    });
  }
});

describe('the fold', () => {
  it('says the guidance in the reader’s language, each option on one line', () => {
    window.localStorage.setItem('ownpace.locale', 'nl');
    render(
      <LocaleProvider>
        <GuidancePanel queue="moves" />
      </LocaleProvider>,
    );

    const fold = screen.getByText('Wat dit betekent en wat u kunt doen').closest('details')!;
    expect(fold).not.toHaveAttribute('open');
    const lines = [...fold.querySelectorAll('dl > div')].map((d) => d.textContent);
    expect(lines).toEqual([
      'Laat staan: aan geen van beide kanten verandert iets.',
      'Verwijder de oude kopie (alleen bestanden): het bestand staat al in de nieuwe map op het nieuwe systeem; dit verwijdert de kopie in de oude map.',
    ]);
  });

  it('says English outside a LocaleProvider, as the rest of the app does', () => {
    render(<GuidancePanel queue="failures" />);
    expect(screen.getByText('Try again:')).toBeInTheDocument();
    // Failures has no meaning line: the page's title says what the rows are.
    expect(screen.getByText('Try again:').closest('details')!.querySelector('p')).toBeNull();
  });
});

describe('the evidence chip', () => {
  it('says the client’s word in Dutch and keeps the token at the end of its title', () => {
    window.localStorage.setItem('ownpace.locale', 'nl');
    render(
      <LocaleProvider>
        <EvidenceBadge evidence="reported" />
        <EvidenceBadge evidence="trashed" />
        <EvidenceBadge evidence="inferred" />
      </LocaleProvider>,
    );

    expect(screen.getByText('Gemeld door de bron')).toHaveAttribute(
      'title',
      'De bron zelf meldde het object als verwijderd. (reported)',
    );
    expect(screen.getByText('In de prullenbak van de bron').getAttribute('title')).toMatch(/\(trashed\)$/);
    const assumed = screen.getByText('Vermoeden: ontbreekt in volledige scans');
    expect(assumed.getAttribute('title')).toMatch(/\(inferred\)$/);
    // Still told apart by its colour: an assumed deletion may not be acted on.
    expect(assumed.className).toContain('bg-amber-50');
    expect(screen.getByText('Gemeld door de bron').className).toContain('bg-emerald-50');
  });
});

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
