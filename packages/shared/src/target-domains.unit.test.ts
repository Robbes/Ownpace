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
  sourceTypeDomains,
  targetDomainRefusal,
} from './target-domains.ts';

describe('TARGET_TYPE_DOMAINS mirrors the engines', () => {
  it('jmap carries email, contact and file — and deliberately NOT calendar (0031 T1 parked)', () => {
    expect(TARGET_TYPE_DOMAINS.jmap).toEqual(['email', 'contact', 'file']);
  });

  it('the single-protocol targets carry exactly their own domain', () => {
    expect(TARGET_TYPE_DOMAINS.imap).toEqual(['email']);
    expect(TARGET_TYPE_DOMAINS.carddav).toEqual(['contact']);
    expect(TARGET_TYPE_DOMAINS.webdav).toEqual(['file']);
  });

  it('caldav carries two data types, because on the wire they are one thing', () => {
    // A task list is a calendar collection that declares VTODO in its
    // `supported-calendar-component-set` — same protocol, same credential,
    // same writer, one property apart (RFC 4791 §5.2.3, workplan 0113).
    expect(TARGET_TYPE_DOMAINS.caldav).toEqual(['calendar', 'task']);
  });

  it('soverin — the account-shaped kind — carries what its builders drive TODAY (0106 T4a+T4b)', () => {
    // email rides the imap-dav writer through the account's stored mailHost
    // (T4b), calendar + contact ride the existing DAV builders. Files stay
    // out until a qualification measures a file face — this table promises
    // only what the engines deliver.
    // Tasks joined in 0113 T5, on the CalDAV face this row already had.
    expect(TARGET_TYPE_DOMAINS.soverin).toEqual(['email', 'calendar', 'contact', 'task']);
  });
});

describe('targetDomainRefusal', () => {
  it('is null for every coherent combination', () => {
    expect(targetDomainRefusal('jmap', ['email', 'contact', 'file'])).toBeNull();
    expect(targetDomainRefusal('imap', ['email'])).toBeNull();
    expect(targetDomainRefusal('caldav', ['calendar'])).toBeNull();
    expect(targetDomainRefusal('caldav', ['calendar', 'task'])).toBeNull();
    expect(targetDomainRefusal('carddav', ['contact'])).toBeNull();
    expect(targetDomainRefusal('webdav', ['file'])).toBeNull();
    expect(targetDomainRefusal('soverin', ['email', 'calendar', 'contact', 'task'])).toBeNull();
    expect(targetDomainRefusal('jmap', [])).toBeNull();
  });

  it('soverin + file refuses in the account kind’s own name — files wait for a measured face', () => {
    const msg = targetDomainRefusal('soverin', ['file', 'calendar']);
    expect(msg).toContain('Soverin');
    expect(msg).toContain("'file'");
    expect(msg).toContain("carries 'email', 'calendar', 'contact', 'task' only");
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

  it("the account's ceiling is the DEPLOYMENT'S, and the default is narrow", () => {
    // ADR-0041, owner decision 2026-09-01. Absent means the static table,
    // which is what an appliance always gets — it registers its own OAuth
    // client and this table never spoke for it.
    expect(sourceTypeDomains('google')).toEqual(['calendar', 'contact']);
    expect(sourceDomainRefusal('google', ['calendar', 'contact'])).toBeNull();

    const refused = sourceDomainRefusal('google', ['calendar', 'email']);
    expect(refused).toContain('Google');
    expect(refused).toContain("'email'");
    // The narrow deployment's sentence names WHY, and names the way through.
    expect(refused).toContain('security assessment');
  });

  it('accepts all four where the deployment declared its own application does', () => {
    const four = ['email', 'calendar', 'contact', 'file'] as const;
    expect(sourceTypeDomains('google', four)).toEqual(four);
    expect(sourceDomainRefusal('google', [...four], four)).toBeNull();
    expect(sourceDomainRefusal('google', ['email'], four)).toBeNull();
    expect(sourceDomainRefusal('google', ['file'], four)).toBeNull();
  });

  it('stops naming a wall that is not there on such a deployment', () => {
    // The sentence is the point: an installation whose owner registered their
    // own application and accepted the restricted tier must not be told that
    // mail "needs a Google security assessment we have not bought yet". It
    // sends them looking for the wrong problem.
    //
    // There is still a refusal to make — a domain no ACCOUNT serves — and it
    // has to be about the ticks, not about a purchase.
    const three = ['email', 'calendar', 'contact'] as const;
    const msg = sourceDomainRefusal('google', ['email', 'file'], three);
    expect(msg).toContain("'file'");
    expect(msg).not.toContain('security assessment');
    expect(msg).toContain('the object types you granted');
  });

  it('leaves every OTHER source alone, declaration or not', () => {
    // The declaration is about one account kind's scope tiers. A Gmail
    // credential reads mail whoever deployed it, and widening these would be
    // the change facing the wrong way — a client offering what the server
    // refuses.
    const four = ['email', 'calendar', 'contact', 'file'] as const;
    expect(sourceTypeDomains('gmail', four)).toEqual(['email']);
    expect(sourceDomainRefusal('gmail', ['email', 'file'], four)).toContain('Gmail');
    expect(sourceDomainRefusal('google-drive', ['file', 'email'], four)).toContain('Google Drive');
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
