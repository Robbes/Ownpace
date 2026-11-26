// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The Cirrux ending escapes as the Google one does (hardening, alpha.21): the
 * two pages carry the same `esc`, safe in a text node and in a quoted
 * attribute alike, so the two cannot drift apart.
 */

import { describe, it, expect } from 'vitest';
import { cirruxResultPage } from './cirrux-consent.ts';

describe("the Cirrux ending's escape", () => {
  it('turns both quotes into entities, as well as the three text-node characters', () => {
    const page = cirruxResultPage({ outcome: { ok: false, reason: `<b>"it's" & more</b>` } });
    expect(page).toContain('&lt;b&gt;&quot;it&#39;s&quot; &amp; more&lt;/b&gt;');
  });
});
