// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The qualification gate's three-state spine (workplan 0106 T3a): only a
 * well-formed MEASURED `no` constrains. Unknown never refuses, absence never
 * refuses, garbage never refuses — each pinned here, because the failure
 * mode this guards against is exactly the plausible-looking shortcut where
 * "not yes" quietly becomes "no" (the Soverin app-password lesson, again).
 */

import { describe, it, expect } from 'vitest';
import { measuredNoRefusal, qualifiedAnswerFor } from './qualification-gate.ts';

const QUALIFICATION = {
  domains: {
    mail: { answer: 'yes', detail: '12 folders visible.' },
    calendar: { answer: 'unknown', detail: 'Unmeasured — the probe was refused: 401.' },
    contact: { answer: 'no', detail: 'The session answered and does not advertise contacts.' },
    file: { answer: 'unknown', detail: 'No standard capability announces files.' },
  },
};

describe('qualifiedAnswerFor — the record in the wizard vocabulary', () => {
  it("maps 'email' onto the record's 'mail' answer", () => {
    expect(qualifiedAnswerFor(QUALIFICATION, 'email')).toEqual({
      answer: 'yes',
      detail: '12 folders visible.',
    });
  });

  it('answers undefined for a missing, null or malformed record — the same as unmeasured', () => {
    expect(qualifiedAnswerFor(undefined, 'contact')).toBeUndefined();
    expect(qualifiedAnswerFor(null, 'contact')).toBeUndefined();
    expect(qualifiedAnswerFor({ domains: 'garbage' }, 'contact')).toBeUndefined();
    expect(qualifiedAnswerFor({ domains: { contact: { answer: 'maybe' } } }, 'contact')).toBeUndefined();
  });
});

describe('measuredNoRefusal — only a measured no refuses', () => {
  it('refuses the measured-no domain, carrying the account’s own evidence and the remedy', () => {
    const msg = measuredNoRefusal(QUALIFICATION, ['email', 'contact']);
    expect(msg).toContain("'contact'");
    expect(msg).not.toContain("'email'");
    expect(msg).toContain('MEASURED');
    expect(msg).toContain('does not advertise contacts');
    expect(msg).toContain('test the connection again');
  });

  it('never refuses on unknown — a refusal is never a no, and neither is silence', () => {
    expect(measuredNoRefusal(QUALIFICATION, ['calendar', 'file'])).toBeNull();
  });

  it('never refuses on a connection with NO stored record — unqualified is not disqualified', () => {
    expect(measuredNoRefusal(undefined, ['email', 'calendar', 'contact', 'file'])).toBeNull();
    expect(measuredNoRefusal(null, ['contact'])).toBeNull();
  });

  it('never refuses on a malformed record — garbage reads as unmeasured, not as a wall', () => {
    expect(measuredNoRefusal('not-an-object', ['contact'])).toBeNull();
    expect(measuredNoRefusal({ domains: { contact: { answer: 'nope' } } }, ['contact'])).toBeNull();
    expect(measuredNoRefusal({ wrong: 'shape' }, ['contact'])).toBeNull();
  });

  it('lists every measured-no domain in one sentence', () => {
    const q = {
      domains: {
        mail: { answer: 'no', detail: 'No mail capability.' },
        calendar: { answer: 'no', detail: 'No calendar capability.' },
        contact: { answer: 'yes', detail: '' },
        file: { answer: 'unknown', detail: '' },
      },
    };
    const msg = measuredNoRefusal(q, ['email', 'calendar', 'contact', 'file']);
    expect(msg).toContain("'email', 'calendar'");
    expect(msg).toContain('No mail capability.');
    expect(msg).toContain('No calendar capability.');
  });
});
