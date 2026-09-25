// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The *Experimental* tag, and the fold that says why (workplan 0131 T2 (a);
 * the owner's D6, *"Label"*).
 *
 * A source that has not yet run against a real account is offered, and says
 * so. Whether it has is `SOURCE_PROOFS` in shared, and nothing here decides
 * it: these two pieces only draw the answer, in the three places a person
 * meets it (a source card at either door, a face in the wizard's data-type
 * step, and Google's whole-domain option).
 *
 * Two pieces, because 0145 T2 needs them apart. The WORD goes inside the
 * card's `<button>`, as text and never an icon alone, so a screen reader reads
 * it as part of the card's name. The FOLD goes beside the card: a `<details>`
 * inside a `<button>` could not be opened on its own, since pressing it would
 * press the card.
 */
import React from 'react';
import { SOURCE_PROOFS } from '@openmig/shared';
import { useT } from '../i18n/index.tsx';
import { Hint } from './Hint.tsx';

/**
 * The word, for inside a button or a label. It brings its own leading space,
 * so the accessible name reads "Box Experimental" and not "BoxExperimental".
 */
export const ExperimentalTag: React.FC = () => {
  const t = useT();
  return (
    <>
      {' '}
      <span className="ml-1 inline-block rounded bg-amber-100 px-1.5 py-0.5 align-middle text-xs font-medium text-amber-800">
        {t('frontDoor.experimental')}
      </span>
    </>
  );
};

/** The fold, for beside the card or the face the tag is on. */
export const ExperimentalWhy: React.FC = () => {
  const t = useT();
  return <Hint className="mt-1 px-1" why={t('frontDoor.experimental.why')} />;
};

/**
 * Is this credential field Google's whole-domain option, and is that option
 * still experimental? The option is the service-account key: pasting one
 * selects domain-wide delegation (ADR-0033) on every Google card.
 */
export function wholeDomainOptionIsExperimental(fieldKey: string): boolean {
  return fieldKey === 'serviceAccountKey' && SOURCE_PROOFS.wholeDomain.verdict === 'experimental';
}
