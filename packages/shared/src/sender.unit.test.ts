// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A NAME AND A NUMBER UNDER OWNPACE'S NAME (workplan 0176 §7, T3; D7, D11).
 *
 * The page a person opens shows the sender's name and number as things to
 * check. A free field there would carry *Call 0800 … , they know about this*
 * or a web address as easily as a name, so a name takes a name's characters
 * and a number a number's, and what is stored is read through the same rule
 * before a page shows it.
 */

import { describe, it, expect } from 'vitest';
import { SENDER_NAME_MAX_LENGTH, senderNameFrom, senderOnAPage, senderPhoneFrom } from './sender.ts';

describe('a name, as the people they send a link to know them', () => {
  it('takes a name in any script, with its marks and the signs names are written with', () => {
    for (const name of ['Anna', 'Anna de Vries', 'Zoë O’Brien-Müller', "D'Arcy", 'J. de Wit', 'J.P. de Wit', 'Ålborg', 'Сергей', 'محمد']) {
      expect(senderNameFrom(name)).toEqual({ ok: true, name });
    }
  });

  it('folds runs of spaces and trims, and an empty one is none', () => {
    expect(senderNameFrom('  Anna   de  Vries ')).toEqual({ ok: true, name: 'Anna de Vries' });
    expect(senderNameFrom('   ')).toEqual({ ok: true, name: null });
    expect(senderNameFrom(null)).toEqual({ ok: true, name: null });
  });

  it('refuses a number, an address, a web address and a sentence', () => {
    for (const typed of ['Call 0800 1234', 'pat@example.org', 'www.bank.example', 'https://x.example', 'Your bank: call us!']) {
      const verdict = senderNameFrom(typed);
      expect(verdict.ok, typed).toBe(false);
      if (!verdict.ok) expect(verdict.code).toBe('sender_name_refused');
    }
  });

  it('refuses one without a letter, and one longer than the column takes', () => {
    expect(senderNameFrom("'-.").ok).toBe(false);
    expect(senderNameFrom('A'.repeat(SENDER_NAME_MAX_LENGTH)).ok).toBe(true);
    expect(senderNameFrom('A'.repeat(SENDER_NAME_MAX_LENGTH + 1)).ok).toBe(false);
  });
});

describe("the member's own number (D11)", () => {
  it("is held to the organisation's number's rule, with its own code", () => {
    expect(senderPhoneFrom('+31 6  1234 5678')).toEqual({ ok: true, phone: '+31 6 1234 5678' });
    expect(senderPhoneFrom('')).toEqual({ ok: true, phone: null });
    const words = senderPhoneFrom('Call IT, they know');
    expect(words.ok).toBe(false);
    if (!words.ok) expect(words.code).toBe('sender_phone_refused');
  });
});

describe('what a page may show of what is stored', () => {
  it('shows a stored name and number as they are, and nothing of how the reader knows them (D7, reversed)', () => {
    // The owner, 2026-11-26: "Does the relationship matter and need to be
    // registered? I would like not to..." A page names the sender, and no more.
    expect(senderOnAPage({ name: 'Anna', phone: '+31 6 1234 5678' })).toEqual({
      name: 'Anna',
      phone: '+31 6 1234 5678',
    });
  });

  it('shows as none what the writer would refuse now, never as it is', () => {
    expect(senderOnAPage({ name: 'www.bank.example', phone: 'call us' })).toEqual({ name: null, phone: null });
    expect(senderOnAPage({ name: null, phone: null })).toEqual({ name: null, phone: null });
  });
});
