// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The queues' guidance for the person reading them (the owner, 2026-10-18).
 *
 * Two languages side by side, updated together or neither, and none of the
 * operator's API words: those stay in the contract's `whatThisMeans` and
 * `howToResolve`, which the API keeps serving unchanged. Whether each label
 * names a button the screen draws is the web app's test
 * (`apps/web/src/components/queues/primitives.unit.test.tsx`), since the
 * buttons' words are in its dictionary.
 */

import { describe, expect, it } from 'vitest';
import {
  DELETION_GUIDANCE,
  DELETIONS_MEANING,
  FAILURE_GUIDANCE,
  MOVE_GUIDANCE,
  MOVES_MEANING,
  QUEUE_GUIDANCE,
  queueGuidance,
  type GuidedQueue,
  type QueueGuidance,
} from './index.ts';

const QUEUES = Object.keys(QUEUE_GUIDANCE) as GuidedQueue[];

function sentences(g: QueueGuidance): string[] {
  return [g.meaning ?? '', ...g.options.flatMap((o) => [o.label, o.text]), g.closing ?? ''].filter(Boolean);
}

describe('the queues’ guidance', () => {
  it('covers the three queues', () => {
    expect(QUEUES.sort()).toEqual(['deletions', 'failures', 'moves']);
  });

  it('says the same things in both languages: a meaning, options and a closing line in the same places', () => {
    for (const queue of QUEUES) {
      const { en, nl } = QUEUE_GUIDANCE[queue];
      expect(Boolean(nl.meaning), queue).toBe(Boolean(en.meaning));
      expect(Boolean(nl.closing), queue).toBe(Boolean(en.closing));
      expect(nl.options.length, queue).toBe(en.options.length);
    }
  });

  it('never says the operator’s API words', () => {
    for (const queue of QUEUES) {
      for (const text of [...sentences(QUEUE_GUIDANCE[queue].en), ...sentences(QUEUE_GUIDANCE[queue].nl)]) {
        expect(text, queue).not.toMatch(
          /POST|\/mappings|naturalKeyHash|allowApplyDeletions|needsDecision|reported|trashed|inferred|target|source/,
        );
      }
    }
  });

  it('speaks Dutch the product’s way: u, and no form of verhuizen', () => {
    for (const queue of QUEUES) {
      for (const text of sentences(QUEUE_GUIDANCE[queue].nl)) {
        expect(text, queue).not.toMatch(/\b(je|jij|jouw)\b|verhui/i);
      }
    }
  });

  it('picks Dutch for nl, and English for anything else', () => {
    expect(queueGuidance('moves', 'nl')).toBe(QUEUE_GUIDANCE.moves.nl);
    expect(queueGuidance('moves', 'en')).toBe(QUEUE_GUIDANCE.moves.en);
    expect(queueGuidance('moves', 'de')).toBe(QUEUE_GUIDANCE.moves.en);
  });

  it('leaves the operator’s guidance, which the API serves, as it was', () => {
    // The owner's option A (2026-10-18): a second text for the customer, not
    // a rewrite of the operator's. The API's callers still read the paths.
    expect(DELETION_GUIDANCE.apply).toMatch(/^POST \/mappings\/\{mappingId\}\/deletions\//);
    expect(MOVE_GUIDANCE.keep).toMatch(/^POST \/mappings\/\{mappingId\}\/moves\//);
    expect(FAILURE_GUIDANCE.retry).toMatch(/^POST \/mappings\/\{mappingId\}\/failures\//);
    expect(DELETIONS_MEANING).toContain('`evidence`');
    expect(MOVES_MEANING).toContain('`toNaturalKeyHash`');
  });
});
