// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The two things erasure never touches, and the sentence that names the
 * ambiguity rather than hoping the reader resolves it correctly (0085 T6).
 *
 * These assertions are about MEANING, not phrasing, which is unusual here and
 * deliberate: the failure this guards against is not a typo, it is a rewrite
 * that quietly drops one of the two reassurances or softens the one that
 * matters. So the tests pin what must be said — both sides present, the target
 * explicitly not reached into, "our record" distinguished from "the copies" —
 * and leave the wording free.
 */

import { describe, it, expect } from 'vitest';
import { erasureNeverTouches, erasureScopeText } from './erasure-scope.ts';

describe('both sides are covered, in both languages', () => {
  it.each(['en', 'nl'] as const)('%s names the source and the target', (lang) => {
    const sides = erasureNeverTouches(lang).map((b) => b.side);
    expect(sides).toEqual(['source', 'target']);
  });

  it('puts the source first — it is the older fear', () => {
    // "Will this delete my old mail" is asked before there is a new mailbox to
    // worry about, and it is the question hard rule 2 has always answered.
    expect(erasureNeverTouches('en')[0]!.side).toBe('source');
  });

  it.each(['en', 'nl'] as const)('%s gives every boundary a heading and a body', (lang) => {
    for (const b of erasureNeverTouches(lang)) {
      expect(b.heading.length).toBeGreaterThan(0);
      expect(b.body.length).toBeGreaterThan(40);
    }
  });

  it('the two languages say the same number of things', () => {
    expect(erasureNeverTouches('nl')).toHaveLength(erasureNeverTouches('en').length);
  });

  it('and do not share a single string — a missed translation is the failure', () => {
    const en = erasureNeverTouches('en');
    const nl = erasureNeverTouches('nl');
    for (let i = 0; i < en.length; i++) {
      expect(nl[i]!.heading).not.toBe(en[i]!.heading);
      expect(nl[i]!.body).not.toBe(en[i]!.body);
    }
  });
});

describe('the target reassurance answers the frightening reading', () => {
  const target = erasureNeverTouches('en').find((b) => b.side === 'target')!;

  it('says the copies stay', () => {
    expect(target.body).toMatch(/stay there|they stay/i);
  });

  it('says closing does not reach into the new mailbox', () => {
    expect(target.body).toMatch(/does not reach into|not remove a single message/i);
  });

  it('distinguishes our RECORD of the move from the copies themselves', () => {
    // The whole distinction in one clause: without it, "we erase everything
    // about your migration" is indistinguishable from "we take the mail back".
    expect(target.body).toMatch(/record/i);
    expect(target.body).toMatch(/not the copies|copies themselves/i);
  });
});

describe('the source reassurance is unconditional', () => {
  const source = erasureNeverTouches('en').find((b) => b.side === 'source')!;

  it('covers closing specifically, not just the migration', () => {
    // "We never delete from a source" is a statement about syncing. Somebody
    // closing an account is asking about a different moment.
    expect(source.body).toMatch(/close/i);
  });

  it('says reading is the only thing done to a source (hard rule 2)', () => {
    expect(source.body).toMatch(/read/i);
  });
});

describe('the prose names the ambiguity out loud', () => {
  it.each(['en', 'nl'] as const)('%s opens by disambiguating "delete my data"', (lang) => {
    const opener = erasureScopeText(lang).split('\n\n')[0]!;
    expect(opener).toMatch(lang === 'nl' ? /Verwijder mijn gegevens/i : /Delete my data/i);
    // The distinction that carries the whole thing: our data about you, not
    // your data.
    expect(opener).toMatch(lang === 'nl' ? /onze gegevens over u/i : /our data about you/i);
  });

  it('includes both boundaries after the opener', () => {
    const text = erasureScopeText('en');
    for (const b of erasureNeverTouches('en')) {
      expect(text).toContain(b.heading);
      expect(text).toContain(b.body);
    }
  });

  it('defaults to English rather than throwing on a missing argument', () => {
    expect(erasureScopeText()).toBe(erasureScopeText('en'));
    expect(erasureNeverTouches()).toEqual(erasureNeverTouches('en'));
  });
});
