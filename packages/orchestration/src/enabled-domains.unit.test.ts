// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * What the run log says about the domains that did not run.
 *
 * The distinction under test is not cosmetic: "not selected" reports an owner
 * DECISION, and saying it about a domain the owner did select would put words
 * in their mouth on the screen they use to check whether a migration is
 * complete.
 */
import { describe, it, expect } from 'vitest';
import { describeAbsentDomains, ALL_SYNC_DOMAINS, type SyncDomain } from './enabled-domains.ts';

const set = (...d: SyncDomain[]) => new Set<SyncDomain>(d);

describe('describeAbsentDomains', () => {
  it('says nothing only when there is genuinely nothing absent to explain', () => {
    expect(describeAbsentDomains(set(...ALL_SYNC_DOMAINS), [...ALL_SYNC_DOMAINS])).toEqual([]);
  });

  it('still explains the unselected ones when every SELECTED domain ran', () => {
    // The first draft of this test expected silence here, which is the mistake
    // the log itself was making: contact and file are absent from the run, and
    // "they all ran" is only true of the two the owner picked.
    expect(describeAbsentDomains(set('email', 'calendar'), ['email', 'calendar'])).toEqual([
      'contact, file: not selected for this migration — not synced, not checked',
    ]);
  });

  it('names the unselected domains — the email-only mapping the owner asked about', () => {
    const [line, ...rest] = describeAbsentDomains(set('email'), ['email']);
    expect(line).toBe(
      'calendar, contact, file: not selected for this migration — not synced, not checked',
    );
    expect(rest).toEqual([]);
  });

  it('distinguishes "not selected" from "not part of this run"', () => {
    // Selected: email + calendar. This run was asked for email only.
    const lines = describeAbsentDomains(set('email', 'calendar'), ['email']);
    expect(lines).toEqual([
      'contact, file: not selected for this migration — not synced, not checked',
      'calendar: selected for this migration but not part of this run',
    ]);
  });

  it('never calls a selected domain unselected', () => {
    for (const domain of ALL_SYNC_DOMAINS) {
      const lines = describeAbsentDomains(set(domain), []).join('\n');
      expect(lines).not.toMatch(new RegExp(`${domain}[^\\n]*not selected`));
      expect(lines).toContain(`${domain}: selected for this migration but not part of this run`);
    }
  });

  it('accounts for every domain when nothing is selected and nothing ran', () => {
    expect(describeAbsentDomains(set(), [])).toEqual([
      'email, calendar, contact, file: not selected for this migration — not synced, not checked',
    ]);
  });

  it('keeps a stable reading order rather than the caller\'s or the database\'s', () => {
    // The set arrives from a SELECT with no ORDER BY and the run list from a
    // payload; neither is a reading order a person should have to follow.
    const lines = describeAbsentDomains(set('file', 'contact', 'email'), ['file']);
    expect(lines[0]).toBe('calendar: not selected for this migration — not synced, not checked');
    expect(lines[1]).toBe('email, contact: selected for this migration but not part of this run');
  });
});
