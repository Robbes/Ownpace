// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The startup line for a switched-off data type (workplan 0125 T7). Its
 * wording is the owner's list: how many copies stay, that they no longer
 * follow the source, and that switching it back on continues where it
 * stopped. It names the key the operator edits, not the ledger's domain word.
 */

import { describe, it, expect } from 'vitest';
import { switchedOffLine } from './switched-off.ts';

describe('switchedOffLine', () => {
  it('carries the three facts, and the key to switch it back on with', () => {
    expect(switchedOffLine('acme-mail', 'calendar', 412)).toBe(
      'acme-mail: domains.calendar is switched off. Its 412 copies stay on the target and no ' +
        'longer follow the source; switching it back on continues where it stopped.',
    );
  });

  it('says one copy as one copy', () => {
    expect(switchedOffLine('acme-mail', 'task', 1)).toContain(
      'Its 1 copy stays on the target and no longer follows the source',
    );
  });

  it('names the key the mapping file uses, which is not always the domain word', () => {
    expect(switchedOffLine('m', 'email', 2)).toContain('domains.mail is switched off');
    expect(switchedOffLine('m', 'contact', 2)).toContain('domains.contacts is switched off');
    expect(switchedOffLine('m', 'file', 2)).toContain('domains.files is switched off');
    expect(switchedOffLine('m', 'task', 2)).toContain('domains.tasks is switched off');
  });
});
