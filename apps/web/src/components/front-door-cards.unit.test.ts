// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * ONE LIST OF CARDS, AND IT IS THE LIST THE PRODUCT ACCEPTS.
 *
 * The cards moved out of the wizard so the connections add-form could draw
 * the same door (owner remark 2026-09-01). The property that makes that safe
 * is that the cards and `connectableTypes()` — what the create route accepts
 * per side — are the SAME SET. A kind added to shared without a card would be
 * a door with no handle; a card with no kind behind it would be a handle on a
 * wall. 0107 T1's drift lock pinned grouping; this pins the list itself.
 */

import { describe, it, expect } from 'vitest';
import { connectableTypes } from '@openmig/shared';
import {
  SOURCE_CARDS,
  TARGET_CARDS,
  frontDoorCards,
  migratableSourceCards,
} from './front-door-cards.ts';

describe('the front door offers exactly what the product accepts', () => {
  it.each([['source', SOURCE_CARDS] as const, ['target', TARGET_CARDS] as const])(
    '%s cards and connectableTypes are one set',
    (role, cards) => {
      const offered = [...cards.map((c) => c.id)].sort();
      const accepted = [...connectableTypes(role)].sort();
      expect(offered, `a ${role} kind has no card, or a card has no kind`).toEqual(accepted);
    },
  );

  it('the export archive is offered at BOTH doors now that it migrates (0116 T5/T6)', () => {
    // The two doors ask different questions (workplan 0116 T1). "Add a
    // connection" asks whether this product can REACH something; "create a
    // migration" asks it to copy OUT of it. For one slice the archive could
    // honestly answer only the first, and the wizard did not offer it — a
    // card walking six steps to a refusal spends somebody's attention to tell
    // them no. Since T5/T6 it copies out, so both doors offer it.
    expect(SOURCE_CARDS.map((c) => c.id)).toContain('archive');
    expect(migratableSourceCards().map((c) => c.id)).toContain('archive');
  });

  it('the wizard drops ONLY the connection-only cards — not a hand-copied list', () => {
    // Stated from the other side, so a filter that quietly grew a second
    // condition (or a card that quietly gained the flag) fails here rather
    // than removing a working source from the wizard in silence.
    const dropped = SOURCE_CARDS.filter(
      (c) => !migratableSourceCards().some((m) => m.id === c.id),
    );
    expect(dropped.every((c) => 'connectionOnly' in c && c.connectionOnly)).toBe(true);
  });

  it('frontDoorCards answers per side', () => {
    expect(frontDoorCards('source')).toBe(SOURCE_CARDS);
    expect(frontDoorCards('target')).toBe(TARGET_CARDS);
  });

  it('every card can be named — a literal or a translated name, never neither', () => {
    // A card with no name renders an empty heading over a hint, which is what
    // the owner would have to describe as "the one with the icon".
    for (const card of [...SOURCE_CARDS, ...TARGET_CARDS]) {
      expect(
        Boolean(('name' in card && card.name) || ('nameKey' in card && card.nameKey)),
        `${card.id} has no name`,
      ).toBe(true);
    }
  });

  it('has unique ids per side', () => {
    for (const cards of [SOURCE_CARDS, TARGET_CARDS]) {
      const ids = cards.map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});
