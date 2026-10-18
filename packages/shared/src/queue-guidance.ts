// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * What the three queues mean, and what can be done about their rows, in the
 * words of the person working through them: English and Dutch side by side
 * (the owner, 2026-10-18, option A of the UX sweep's word choices).
 *
 * The queues' `whatThisMeans` and `howToResolve` (`operating-contract.ts`)
 * are the operator's. They name the API paths and fields a script or an
 * appliance's owner calls, and the API keeps serving them unchanged
 * (ADR-0026). Until this file the screens showed that text too, under *What
 * this means and what you can do*, and a tester read
 * `POST /mappings/{mappingId}/moves/{naturalKeyHash}/keep` and
 * `toNaturalKeyHash` beneath a Dutch heading.
 *
 * Shared, not in the web app's dictionary, for the reason
 * `APPLY_FLAG_WARNING_NL` is (`docs/i18n-prose-boundary.md`, class 4): the
 * words in front of the destructive path have one source, next to the
 * operator's, so a change to what an action does is made beside both. Update
 * BOTH languages or neither.
 *
 * Each option is labelled with the name the screen gives the button (or the
 * section) it is about, so a reader can find what the sentence talks about.
 * `apps/web/src/components/queues/primitives.unit.test.tsx` holds every
 * label to the screen's own words, in both languages.
 */

/** Something a person can do about a queue's rows, named as the screen names it. */
export interface QueueGuidanceOption {
  /** The button's (or the section's) name, as the screen draws it. */
  readonly label: string;
  /** What it does: the sentence after the label's colon. */
  readonly text: string;
}

/** What a queue means and what can be done about it, for the person reading it. */
export interface QueueGuidance {
  /** What the rows are. Absent where the page's own title already says it. */
  readonly meaning?: string;
  readonly options: readonly QueueGuidanceOption[];
  /** A last sentence, after the options: what can be done outside Ownpace. */
  readonly closing?: string;
}

/** The queues that carry guidance. */
export type GuidedQueue = 'deletions' | 'moves' | 'failures';

/** The languages a customer reads the app in (ADR-0013). */
export type GuidanceLocale = 'en' | 'nl';

export const QUEUE_GUIDANCE: Readonly<
  Record<GuidedQueue, Readonly<Record<GuidanceLocale, QueueGuidance>>>
> = {
  deletions: {
    en: {
      meaning:
        'These items were deleted on the old system. The new system still has its copy, and nothing is ' +
        'deleted there unless you choose so.',
      options: [
        { label: 'Keep our copy', text: 'the copy stays on the new system. This is usually the right answer.' },
        {
          label: 'Delete it here too',
          // *Assumed* is the chip an `inferred` deletion carries
          // (`evidence.inferred` in the web app's dictionary).
          text:
            'the copy on the new system is deleted as well. This works only while deleting by hand is on, ' +
            'and never for an item marked Assumed.',
        },
        { label: 'Do nothing', text: 'the row stays here and nothing happens.' },
      ],
    },
    nl: {
      meaning:
        'Deze items zijn op het oude systeem verwijderd. Het nieuwe systeem heeft de kopie nog, en daar ' +
        'wordt niets verwijderd tenzij u daarvoor kiest.',
      options: [
        {
          label: 'Behoud de kopie',
          text: 'de kopie blijft op het nieuwe systeem staan. Meestal is dit het juiste antwoord.',
        },
        {
          label: 'Verwijder het hier ook',
          text:
            'de kopie op het nieuwe systeem wordt ook verwijderd. Dit kan alleen zolang Handmatig ' +
            'verwijderen aan staat, en nooit voor een item met het label Vermoeden.',
        },
        { label: 'Niets doen', text: 'de regel blijft hier staan en er gebeurt niets.' },
      ],
    },
  },
  moves: {
    en: {
      meaning:
        'These items were moved to another folder on the old system. On the new system they are still ' +
        'where we put them.',
      options: [
        { label: 'Leave it where it is', text: 'nothing changes on either side.' },
        {
          label: 'Remove the old copy (files only)',
          text:
            'the file is already in its new folder on the new system; this deletes the copy in the old ' +
            'folder.',
        },
      ],
      closing: 'Or move it yourself on the new system, then press Leave it where it is.',
    },
    nl: {
      meaning:
        'Deze items zijn op het oude systeem naar een andere map verplaatst. Op het nieuwe systeem staan ' +
        'ze nog waar wij ze neerzetten.',
      options: [
        { label: 'Laat staan', text: 'aan geen van beide kanten verandert iets.' },
        {
          label: 'Verwijder de oude kopie (alleen bestanden)',
          text:
            'het bestand staat al in de nieuwe map op het nieuwe systeem; dit verwijdert de kopie in de ' +
            'oude map.',
        },
      ],
      closing: 'Of verplaats het zelf op het nieuwe systeem en druk daarna op Laat staan.',
    },
  },
  failures: {
    en: {
      options: [
        { label: 'Try again', text: 'the next pass tries this item again. Use it once the cause is fixed.' },
        {
          label: 'Migrate without it',
          text:
            'the migration goes on without this item, and it no longer counts as failed. This cannot be ' +
            'undone.',
        },
        {
          label: 'Still trying',
          text: 'these are tried again by themselves on every pass. You need not do anything.',
        },
      ],
    },
    nl: {
      options: [
        {
          label: 'Probeer opnieuw',
          text: 'de volgende ronde probeert dit item opnieuw. Gebruik dit als de oorzaak is opgelost.',
        },
        {
          label: 'Migreer zonder dit item',
          text:
            'de migratie gaat verder zonder dit item, en het telt niet meer als mislukt. Dit kunt u niet ' +
            'terugdraaien.',
        },
        {
          label: 'Wordt nog geprobeerd',
          text: 'deze worden elke ronde vanzelf opnieuw geprobeerd. U hoeft niets te doen.',
        },
      ],
    },
  },
};

/**
 * A queue's guidance in the reader's language: Dutch for `nl`, English for
 * anything else, as the rest of the app falls back.
 */
export function queueGuidance(queue: GuidedQueue, locale: string): QueueGuidance {
  return QUEUE_GUIDANCE[queue][locale === 'nl' ? 'nl' : 'en'];
}
