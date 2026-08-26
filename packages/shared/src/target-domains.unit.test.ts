// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The target/domain coherence matrix (0037 T4).
 *
 * The matrix mirrors the ENGINES, so these tests are the drift alarm: a new
 * writer (say, a JMAP calendar target when 0031 T1 unparks) must widen the
 * row here deliberately, and the refusal prose must keep naming both sides.
 */
import { describe, it, expect } from 'vitest';
import {
  TARGET_TYPE_DOMAINS,
  incoherentTargetDomains,
  sourceDomainRefusal,
  targetDomainRefusal,
} from './target-domains.ts';

describe('TARGET_TYPE_DOMAINS mirrors the engines', () => {
  it('jmap carries email, contact and file — and deliberately NOT calendar (0031 T1 parked)', () => {
    expect(TARGET_TYPE_DOMAINS.jmap).toEqual(['email', 'contact', 'file']);
  });

  it('the single-protocol targets carry exactly their own domain', () => {
    expect(TARGET_TYPE_DOMAINS.imap).toEqual(['email']);
    expect(TARGET_TYPE_DOMAINS.caldav).toEqual(['calendar']);
    expect(TARGET_TYPE_DOMAINS.carddav).toEqual(['contact']);
    expect(TARGET_TYPE_DOMAINS.webdav).toEqual(['file']);
  });

  it('soverin — the account-shaped kind — carries what its builders drive TODAY (0106 T4a)', () => {
    // calendar + contact ride the existing DAV builders. Mail is deliberately
    // absent until the mail target builder speaks this kind (T4b), and files
    // until a qualification measures a file face — this table promises only
    // what the engines deliver.
    expect(TARGET_TYPE_DOMAINS.soverin).toEqual(['calendar', 'contact']);
  });
});

describe('targetDomainRefusal', () => {
  it('is null for every coherent combination', () => {
    expect(targetDomainRefusal('jmap', ['email', 'contact', 'file'])).toBeNull();
    expect(targetDomainRefusal('imap', ['email'])).toBeNull();
    expect(targetDomainRefusal('caldav', ['calendar'])).toBeNull();
    expect(targetDomainRefusal('carddav', ['contact'])).toBeNull();
    expect(targetDomainRefusal('webdav', ['file'])).toBeNull();
    expect(targetDomainRefusal('soverin', ['calendar', 'contact'])).toBeNull();
    expect(targetDomainRefusal('jmap', [])).toBeNull();
  });

  it('soverin + email refuses in the account kind’s own name — mail waits for T4b', () => {
    const msg = targetDomainRefusal('soverin', ['email', 'calendar']);
    expect(msg).toContain('Soverin');
    expect(msg).toContain("'email'");
    expect(msg).toContain("carries 'calendar', 'contact' only");
  });

  it('names BOTH sides for carddav + email — the workplan example', () => {
    const msg = targetDomainRefusal('carddav', ['email', 'contact']);
    expect(msg).toContain('CardDAV');
    expect(msg).toContain("'email'");
    expect(msg).toContain("carries 'contact' only");
    expect(incoherentTargetDomains('carddav', ['email', 'contact'])).toEqual(['email']);
  });

  it('jmap + calendar names the parked owner decision and the CalDAV way out', () => {
    const msg = targetDomainRefusal('jmap', ['email', 'calendar']);
    expect(msg).toContain('JMAP');
    expect(msg).toContain("'calendar'");
    expect(msg).toContain('no JMAP calendar target');
    expect(msg).toContain('CalDAV');
  });

  it('lists every incoherent domain, pluralized', () => {
    const msg = targetDomainRefusal('imap', ['email', 'calendar', 'file']);
    expect(msg).toContain("'calendar', 'file'");
    expect(msg).toContain('data types');
  });
});

describe('sourceDomainRefusal — the source-side matrix', () => {
  it('places no constraint on the O365-family mail sources', () => {
    // Their connection is the combined one the DAV domains discover against.
    for (const type of ['imap', 'oauth2', 'graph'] as const) {
      expect(sourceDomainRefusal(type, ['email', 'calendar', 'contact', 'file'])).toBeNull();
    }
  });

  it('is null for every coherent Google combination', () => {
    expect(sourceDomainRefusal('google-drive', ['file'])).toBeNull();
    expect(sourceDomainRefusal('gmail', ['email'])).toBeNull();
    expect(sourceDomainRefusal('google-calendar', ['calendar'])).toBeNull();
    expect(sourceDomainRefusal('google-contacts', ['contact'])).toBeNull();
  });

  it('the Google DAV pair each name their own scope (workplan 0045)', () => {
    const cal = sourceDomainRefusal('google-calendar', ['calendar', 'email']);
    expect(cal).toContain('Google Calendar');
    expect(cal).toContain('auth/calendar');
    const card = sourceDomainRefusal('google-contacts', ['contact', 'file']);
    expect(card).toContain('Google Contacts');
    expect(card).toContain('auth/carddav');
  });

  it('drive + email keeps the wording the wizard and API render verbatim', () => {
    const msg = sourceDomainRefusal('google-drive', ['file', 'email']);
    expect(msg).toContain('Google Drive');
    expect(msg).toContain('Drive API only');
    expect(msg).toContain('separate mapping');
  });

  it('gmail + file names the mail scope, in its own honest sentence (workplan 0044)', () => {
    // Not Drive's sentence with the name swapped: Gmail's credential is scoped
    // to a mailbox, not an API, and the refusal says which consent it carries.
    const msg = sourceDomainRefusal('gmail', ['email', 'file']);
    expect(msg).toContain('Gmail');
    expect(msg).toContain('mail only');
    expect(msg).toContain('https://mail.google.com/');
    expect(msg).toContain("'file'");
    expect(msg).toContain('separate mapping');
  });
});
