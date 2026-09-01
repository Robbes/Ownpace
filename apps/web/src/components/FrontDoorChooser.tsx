// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The front door, as one component both doors render (workplan 0107; owner
 * remark 2026-09-01).
 *
 * Until now the wizard drew this — grouped cards with an icon, a name, a hint,
 * and a family heading so Microsoft 365's two methods and Google's five
 * products read as one account each — as two functions inside
 * `CreateMapping.tsx`, and the connections add-form drew "the same authority"
 * as a drop-down. Same ids, same grouping, and to a person two different
 * products. The owner's words: *"the connections page is less clean and nice
 * than the migration page, while both show ways to register connections."*
 *
 * Extracted VERBATIM from the wizard — same markup, same classes, same text
 * nodes — so every test that picks a card by its button name keeps passing,
 * and so the wizard looks exactly as it did. The add-form then gets the same
 * thing by rendering the same component, which is the only way two screens
 * can stop drifting apart: not by matching, by sharing.
 *
 * `cardFor` is the one seam the wizard needs and the add-form does not: the
 * Google ACCOUNT card's hint follows what the deployment's application carries
 * (ADR-0041), and that is the wizard's knowledge, read from the API it already
 * asked. The component knows nothing about it.
 */
import React from 'react';
import { partitionFrontDoor } from '@openmig/shared';
import { useT } from '../i18n/index.tsx';
import { FamilyIcon, FrontDoorIcon } from './FrontDoorIcon.tsx';
import type { FrontDoorCard } from './front-door-cards.ts';

export interface FrontDoorChooserProps<C extends FrontDoorCard> {
  readonly cards: ReadonlyArray<C>;
  readonly selectedId: string;
  readonly onPick: (card: C) => void;
  /** Tailwind columns for the card grid — the wizard uses 2 for sources, 3 for targets. */
  readonly gridClass: string;
  /**
   * Substitute a card before it is DRAWN (the wizard's deployment-aware hint).
   * Typed as a plain card on the way out: the substitute only has to be
   * drawable, and `onPick` still receives the original — so a hint swap
   * cannot change which id gets picked.
   */
  readonly cardFor?: (card: C) => FrontDoorCard;
}

export function FrontDoorChooser<C extends FrontDoorCard>({
  cards,
  selectedId,
  onPick,
  gridClass,
  cardFor,
}: FrontDoorChooserProps<C>): React.ReactElement {
  const t = useT();
  const grouped = partitionFrontDoor(cards, (c) => c.id);
  const grid = `grid grid-cols-1 gap-4 ${gridClass}`;

  /** One chooser card — the body every group renders identically. */
  const renderCard = (raw: C): React.ReactElement => {
    const card: FrontDoorCard = cardFor ? cardFor(raw) : raw;
    const selected = selectedId === card.id;
    return (
      <button
        key={card.id}
        type="button"
        onClick={() => onPick(raw)}
        className={`p-4 border-2 rounded-lg text-left transition-colors ${
          selected ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
        }`}
      >
        <div className="flex items-start gap-3">
          <FrontDoorIcon type={card.id} />
          <div>
            <p className="font-medium text-gray-900">{card.nameKey ? t(card.nameKey) : card.name}</p>
            <p className="text-sm text-gray-500 mt-1">{t(card.hintKey)}</p>
          </div>
        </div>
      </button>
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
