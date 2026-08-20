// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * What erasure never touches (workplan 0085 T6).
 *
 * ## Why this is a module and not a sentence in a template
 *
 * "Delete my data" is the phrase a person uses to end a service, and it is
 * **exactly** the phrase they could reasonably read as meaning the opposite of
 * what happens here. Someone closing their account can plausibly believe any of
 * three things:
 *
 *   - that we will delete the mail we copied into their new mailbox (we do not
 *     — it is theirs, in their system);
 *   - that we will delete the mail in their old one (we never have: hard
 *     rule 2, nothing is ever removed from a source);
 *   - that "erased" means only our copy is gone (correct).
 *
 * Two of those three are wrong, and both wrong readings are frightening in a
 * way that would make somebody hesitate to close an account they are entitled
 * to close, or — worse — close it believing their migrated mail is about to
 * vanish and act on that belief. The distinction is not decoration. It is the
 * difference between "we forget you" and "we take it back".
 *
 * ## Why it is bilingual and structured rather than one blob
 *
 * The two boundaries are separate reassurances about separate systems, and a
 * reader is looking for the one that matches their worry. Rendering them as
 * distinct entries lets each surface put them where they belong — the close
 * response answers "what am I agreeing to", the completion report answers
 * "what just happened" — without either restating the other's prose slightly
 * differently and inviting the reader to hunt for the difference.
 *
 * Frame, not finding (`docs/i18n-prose-boundary.md`): every word here is ours,
 * so it is translated. Nothing in it quotes a provider or a ledger.
 */

export type ErasureBoundarySide = 'source' | 'target';

export interface ErasureBoundary {
  /** Which system this reassurance is about. */
  readonly side: ErasureBoundarySide;
  readonly heading: string;
  readonly body: string;
}

interface BoundaryCopy {
  readonly side: ErasureBoundarySide;
  readonly en: { readonly heading: string; readonly body: string };
  readonly nl: { readonly heading: string; readonly body: string };
}

const BOUNDARIES: readonly BoundaryCopy[] = [
  {
    // The source first. It is the older fear — people ask "will this delete my
    // old mail" before they have a new mailbox to worry about — and it is the
    // one the whole product has answered the same way since hard rule 2.
    side: 'source',
    en: {
      heading: 'Where your data came from',
      body:
        'We have never deleted anything from it. Not during the migration, not at the end of it, ' +
        'and not when you close your account — the only thing this product has ever done to a ' +
        'source is read it. Whatever is in there stays exactly as it is, and it is not ours to ' +
        'remove.',
    },
    nl: {
      heading: 'Waar uw gegevens vandaan kwamen',
      body:
        'Wij hebben daar nooit iets verwijderd. Niet tijdens de migratie, niet aan het eind ervan ' +
        'en niet wanneer u uw account opzegt — het enige wat dit product ooit met een bron doet, ' +
        'is die lezen. Wat daar staat, blijft precies zoals het is, en het is niet aan ons om het ' +
        'weg te halen.',
    },
  },
  {
    // The target second, and at more length, because this is the reading that
    // actually costs something: believing the copies are about to be taken back.
    side: 'target',
    en: {
      heading: 'Where your data went',
      body:
        'The mail, calendars, contacts and files we copied are in your own system, in your own ' +
        'account, and they stay there. Closing your account does not reach into your new mailbox ' +
        'and does not remove a single message from it. What we erase is our RECORD of the move — ' +
        'the list of what was copied where, and everything we stored to do the copying — not the ' +
        'copies themselves.',
    },
    nl: {
      heading: 'Waar uw gegevens naartoe zijn gegaan',
      body:
        'De e-mail, agenda’s, contacten en bestanden die wij hebben gekopieerd, staan in uw ' +
        'eigen systeem, in uw eigen account, en die blijven daar. Het opzeggen van uw account ' +
        'komt niet aan uw nieuwe postbus en verwijdert daar geen enkel bericht. Wat wij wissen is ' +
        'onze REGISTRATIE van de verhuizing — de lijst van wat waarheen is gekopieerd, en alles ' +
        'wat wij hebben opgeslagen om te kunnen kopiëren — niet de kopieën zelf.',
    },
  },
];

/** The two boundaries, in the order a worried reader wants them. */
export function erasureNeverTouches(lang: 'en' | 'nl' = 'en'): readonly ErasureBoundary[] {
  return BOUNDARIES.map((b) => ({
    side: b.side,
    heading: b[lang].heading,
    body: b[lang].body,
  }));
}

/**
 * The whole reassurance as prose, opening with the sentence that names the
 * ambiguity instead of hoping the reader resolves it correctly on their own.
 */
export function erasureScopeText(lang: 'en' | 'nl' = 'en'): string {
  const opener =
    lang === 'nl'
      ? '"Verwijder mijn gegevens" betekent hier onze gegevens over u — niet uw eigen gegevens. ' +
        'Twee dingen raken wij nooit aan:'
      : '"Delete my data" here means our data about you — not your own data. There are two things ' +
        'we never touch:';
  return [opener, ...erasureNeverTouches(lang).map((b) => `${b.heading}: ${b.body}`)].join('\n\n');
}
