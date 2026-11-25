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
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { confirmGuard } from './confirm-guard.ts';
import { QUEUE_EFFECTS, QUEUE_GUIDANCE, decisionEffectFields, type GuidedQueue } from '@openmig/shared';
import { LocaleProvider, useLocale } from '../../i18n/index.tsx';
import { LOCALES, STRINGS } from '../../i18n/strings.ts';
import { CONFIRM_GUARD_MS, ConfirmButton, EvidenceBadge, GuidancePanel, ServedEffect } from './primitives.tsx';

type Key = keyof (typeof STRINGS)['en'];

/**
 * The words each option's label must start with, in order: the button (or
 * section) the screen draws for it. `null` is an option with no button of its
 * own (*Do nothing*).
 */
const LABELS: Record<GuidedQueue, ReadonlyArray<Key | null>> = {
  deletions: ['deletions.keep', 'deletions.apply', 'deletions.all', null],
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
      // No switch is named: deleting by hand has none since alpha.21
      // (ADR-0024, 2026-11-25), so the fold must not send anyone looking for one.
      const switchName = locale === 'nl' ? 'handmatig verwijderen' : 'deleting by hand';
      expect(QUEUE_GUIDANCE.deletions[locale].options[1]!.text.toLowerCase()).not.toContain(switchName);
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

/**
 * WHAT A PRESS DID, IN THE READER'S LANGUAGE (workplan 0159 §6 item 18). The
 * line where the buttons were was the server's English under a Dutch page.
 * Both editions now say it in Dutch as well (`effectNl` beside `effect`, from
 * `QUEUE_EFFECTS`), and the row shows the half in its reader's language, as
 * the Decisions page does, with the same helper (`decisionEffectText`).
 */
describe('what a press did', () => {
  const KEPT = decisionEffectFields(QUEUE_EFFECTS.deletionKept);

  /** A switch the test can press, as the language menu does. */
  function SwitchToEnglish() {
    const { setLocale } = useLocale();
    return (
      <button type="button" onClick={() => setLocale('en')}>
        switch to English
      </button>
    );
  }

  function renderIn(locale: 'en' | 'nl', served: Parameters<typeof ServedEffect>[0]['served']) {
    window.localStorage.setItem('ownpace.locale', locale);
    return render(
      <LocaleProvider>
        <SwitchToEnglish />
        <ServedEffect served={served} />
      </LocaleProvider>,
    );
  }

  it('says the Dutch on a Dutch page, unmarked, and not the English', () => {
    renderIn('nl', KEPT);
    expect(screen.getByText(KEPT.effectNl)).not.toHaveAttribute('lang');
    expect(screen.queryByText(KEPT.effect)).not.toBeInTheDocument();
  });

  it('says the English on an English page', () => {
    renderIn('en', KEPT);
    expect(screen.getByText(KEPT.effect)).not.toHaveAttribute('lang');
    expect(screen.queryByText(KEPT.effectNl)).not.toBeInTheDocument();
  });

  it('keeps both halves, so the line follows a language switch', () => {
    renderIn('nl', KEPT);
    fireEvent.click(screen.getByRole('button', { name: 'switch to English' }));
    expect(screen.getByText(KEPT.effect)).not.toHaveAttribute('lang');
    expect(screen.queryByText(KEPT.effectNl)).not.toBeInTheDocument();
  });

  it('says the English as served, marked English, when the server sent no Dutch', () => {
    // An appliance from before the Dutch answers with `effect` alone.
    renderIn('nl', { effect: KEPT.effect });
    expect(screen.getByText(KEPT.effect)).toHaveAttribute('lang', 'en');
  });

  it('says nothing when nothing was served', () => {
    const { container } = render(<ServedEffect served={{}} />);
    expect(container).toBeEmptyDOMElement();
  });
});

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * THE SINGLE PRESS IGNORES A DOUBLE CLICK (workplan 0173 T0). Since alpha.21
 * the two presses are the only consent a delete by hand asks for (ADR-0024,
 * 2026-11-25), and a double click on *Delete it here too* was both: the first
 * click armed it, the second confirmed it. Now the second click of a double
 * click, and any click within `CONFIRM_GUARD_MS` of arming, is ignored, as
 * *Delete N* in `DeleteAllPanel` does since 2026-11-21.
 */
describe('the two presses are two decisions', () => {
  // The web test setup turns the guard off for every other test; on here.
  beforeEach(() => {
    confirmGuard.ms = CONFIRM_GUARD_MS;
  });
  afterEach(() => {
    confirmGuard.ms = 0;
    vi.useRealTimers();
  });

  function renderButton() {
    const onClick = vi.fn();
    render(<ConfirmButton onClick={onClick} label="Delete it here too" armedLabel="Confirm delete" />);
    return { onClick, button: () => screen.getByRole('button') };
  }

  it('a double click arms and does not confirm', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    const { onClick, button } = renderButton();
    fireEvent.click(button(), { detail: 1 });
    fireEvent.click(button(), { detail: 2 });
    expect(onClick).not.toHaveBeenCalled();
    expect(button()).toHaveTextContent('Confirm delete');
  });

  it('a second click within the guard after arming is ignored; one after it confirms', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    const { onClick, button } = renderButton();
    fireEvent.click(button(), { detail: 1 });
    vi.advanceTimersByTime(CONFIRM_GUARD_MS - 100);
    fireEvent.click(button(), { detail: 1 });
    expect(onClick).not.toHaveBeenCalled();
    expect(button()).toHaveTextContent('Confirm delete');

    vi.advanceTimersByTime(200);
    fireEvent.click(button(), { detail: 1 });
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('still disarms by itself after five seconds', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    const { onClick, button } = renderButton();
    fireEvent.click(button(), { detail: 1 });
    act(() => {
      vi.advanceTimersByTime(5_001);
    });
    expect(button()).toHaveTextContent('Delete it here too');
    fireEvent.click(button(), { detail: 1 });
    expect(onClick).not.toHaveBeenCalled();
  });
});
