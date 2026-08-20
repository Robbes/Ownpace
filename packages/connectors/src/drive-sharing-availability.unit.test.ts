// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The `Files.Read.All` gate (workplan 0029 T1, owner decision 2026-08-04).
 *
 * Two questions, and the second is the one that matters six months from now.
 * Does an unconfigured deployment default to NOT reading every file in the
 * tenant — and when it does not read them, does it SAY so, in words that tell
 * a deliberate decision apart from a broken consent?
 */

import { describe, it, expect } from 'vitest';
import {
  driveSharingAvailability,
  DRIVE_SHARING_NOT_CONSENTED,
} from './drive-sharing-availability.ts';

describe('which way an unconfigured deployment falls', () => {
  it('refuses when the flag was never set', () => {
    // The direction is the whole design: guessing "off" costs a stated blind
    // spot, guessing "on" costs a tenant-wide file read nobody asked for.
    expect(driveSharingAvailability({}).ok).toBe(false);
  });

  it('refuses on an empty value', () => {
    expect(driveSharingAvailability({ GRAPH_FILES_READ_CONSENTED: '' }).ok).toBe(false);
  });

  it('refuses on anything that is not exactly `true`', () => {
    // `1`, `yes` and `TRUE` all look like consent to a person writing an env
    // file, and none of them is. Refusing them is the safe reading, and the
    // runbook names the exact value.
    for (const v of ['1', 'yes', 'TRUE', 'True', 'on', 'false']) {
      expect(driveSharingAvailability({ GRAPH_FILES_READ_CONSENTED: v }).ok).toBe(false);
    }
  });

  it('allows the scan when the scope really was consented', () => {
    // A deployment that HAS granted it is not forced to fork: the section
    // appears with no code change.
    expect(driveSharingAvailability({ GRAPH_FILES_READ_CONSENTED: 'true' })).toEqual({ ok: true });
  });
});

describe('what the refusal says', () => {
  const refusal = driveSharingAvailability({});

  it('refuses the reading that nothing is shared', () => {
    if (refusal.ok) throw new Error('expected a refusal');
    // Hard rule 9. "No file shares found" and "nobody looked" are opposite
    // findings, and this section is the one an owner is most likely to be
    // wrong about.
    expect(refusal.reason).toContain('Nothing was looked at');
    expect(refusal.reason).toContain('not a statement that nothing is shared');
  });

  it('names the permission, the way to turn it on, and where it is explained', () => {
    if (refusal.ok) throw new Error('expected a refusal');
    expect(refusal.reason).toContain('Files.Read.All');
    expect(refusal.reason).toContain('GRAPH_FILES_READ_CONSENTED=true');
    expect(refusal.reason).toContain('docs/o365-application-access.md');
  });

  it('says it was a DECISION, not a missing consent', () => {
    if (refusal.ok) throw new Error('expected a refusal');
    // Without this the reader sees an unread section and goes to the portal
    // to fix a consent that is absent on purpose — an errand with no end.
    expect(refusal.reason).toContain('deliberately');
    expect(refusal.reason).toContain('cannot narrow it');
  });

  it('tells the reader what to do instead', () => {
    if (refusal.ok) throw new Error('expected a refusal');
    // A blind spot with no way forward is just bad news; this one has both a
    // manual route and the switch.
    expect(refusal.reason).toContain('by hand before cutover');
  });

  it('is one sentence set, shared by every door that says it', () => {
    if (refusal.ok) throw new Error('expected a refusal');
    expect(refusal.reason).toBe(DRIVE_SHARING_NOT_CONSENTED);
  });
});
