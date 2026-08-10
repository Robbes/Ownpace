// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
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
  targetDomainRefusal,
} from './target-domains';

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
});

describe('targetDomainRefusal', () => {
  it('is null for every coherent combination', () => {
    expect(targetDomainRefusal('jmap', ['email', 'contact', 'file'])).toBeNull();
    expect(targetDomainRefusal('imap', ['email'])).toBeNull();
    expect(targetDomainRefusal('caldav', ['calendar'])).toBeNull();
    expect(targetDomainRefusal('carddav', ['contact'])).toBeNull();
    expect(targetDomainRefusal('webdav', ['file'])).toBeNull();
    expect(targetDomainRefusal('jmap', [])).toBeNull();
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
