// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The front door: grouped cards with an icon, a name, a hint, and a family
 * heading, so Microsoft 365's two methods and Google's products read as one
 * account each (workplan 0107; owner remark 2026-09-01).
 *
 * The wizard drew it first, and the Accounts page's add-form drew "the same
 * authority" as a drop-down: same ids, same grouping, and to a person two
 * different products. Extracted verbatim, so both rendered one component,
 * which is the only way two screens stop drifting apart. The wizard has
 * retired since (0153 D5), and the Accounts page draws it.
 */
import React from 'react';
import { partitionFrontDoor, providerDisplayName, sourceCardIsExperimental } from '@openmig/shared';
import { useLocale } from '../i18n/index.tsx';
import { ExperimentalTag, ExperimentalWhy } from './ExperimentalTag.tsx';
import { FamilyIcon, FrontDoorIcon } from './FrontDoorIcon.tsx';
import type { FrontDoorCard } from './front-door-cards.ts';

export interface FrontDoorChooserProps<C extends FrontDoorCard> {
  readonly cards: ReadonlyArray<C>;
  /**
   * Which side these cards are for. Required, so no door can forget it: a
   * SOURCE card that has not yet met a real account carries the Experimental
   * tag (workplan 0131 T2), and whether a target should is still open (0131
   * open question 5), so a target card never does. Ids alone cannot say it:
   * `imap` is a card on both sides.
   */
  readonly role: 'source' | 'target';
  readonly selectedId: string;
  readonly onPick: (card: C) => void;
  /** Tailwind columns for the card grid. */
  readonly gridClass: string;
}

export function FrontDoorChooser<C extends FrontDoorCard>({
  cards,
  role,
  selectedId,
  onPick,
  gridClass,
}: FrontDoorChooserProps<C>): React.ReactElement {
  const { t, locale } = useLocale();
  const grouped = partitionFrontDoor(cards, (c) => c.id);
  // A card's name in the reader's language: Dutch writes a few its own way
  // (`providerDisplayName`: *Google-account*), and every other card keeps the
  // name it was given.
  const nameOf = (card: FrontDoorCard): string | undefined => {
    if (card.nameKey) return t(card.nameKey);
    const named = providerDisplayName(card.id, locale);
    return named !== providerDisplayName(card.id, 'en') ? named : card.name;
  };
  const grid = `grid grid-cols-1 gap-4 ${gridClass}`;

  /**
   * One chooser card — the body every group renders identically.
   *
   * The card is a `<button>` inside a cell of its own, so that an experimental
   * card's fold can sit BESIDE it (0131 T2, 0145 T2): the tag's word is inside
   * the button and part of its name, and the why folds under it, outside, where
   * it can be opened without picking the card. The button fills what its cell
   * leaves: a row of untagged cards stays one height, and a tagged card's
   * button ends a fold's height above an untagged neighbour's, with the fold
   * under it.
   */
  const renderCard = (raw: C): React.ReactElement => {
    const card: FrontDoorCard = raw;
    const selected = selectedId === card.id;
    const experimental = role === 'source' && sourceCardIsExperimental(raw.id);
    return (
      <div key={card.id} className="flex flex-col">
        <button
          type="button"
          onClick={() => onPick(raw)}
          className={`w-full flex-1 p-4 border-2 rounded-lg text-left transition-colors ${
            selected ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
          }`}
        >
          <div className="flex items-start gap-3">
            <FrontDoorIcon type={card.id} />
            <div>
              <p className="font-medium text-gray-900">
                {nameOf(card)}
                {experimental && <ExperimentalTag />}
              </p>
              <p className="text-sm text-gray-500 mt-1">{t(card.hintKey)}</p>
            </div>
          </div>
        </button>
        {experimental && <ExperimentalWhy />}
      </div>
    );
  };

  /*
   * Both doors render through the ONE shared partition (0107 T1): "Your
   * provider" first — the level people arrive thinking in, families as
   * headings so Microsoft 365's two methods and Google's products read as one
   * account each — then "Any server, by protocol", the honest fallback lane.
   * Neither door owns the algorithm, so neither can group differently.
   */
  return (
    <div className="space-y-5">
      {(grouped.families.length > 0 || grouped.providers.length > 0) && (
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-2">{t('wizard.group.provider')}</h4>
          <div className="space-y-3">
            {grouped.families.map((family) => (
              <div key={family.id}>
                <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-gray-500 mb-2">
                  <FamilyIcon family={family.id} />
                  {family.label}
                </p>
                <div className={grid}>{family.members.map(renderCard)}</div>
              </div>
            ))}
            {grouped.providers.length > 0 && (
              <div className={grid}>{grouped.providers.map(renderCard)}</div>
            )}
          </div>
        </div>
      )}
      {grouped.protocols.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-2">{t('wizard.group.protocol')}</h4>
          <div className={grid}>{grouped.protocols.map(renderCard)}</div>
        </div>
      )}
    </div>
  );
}
