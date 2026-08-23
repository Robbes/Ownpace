// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The notification rules (workplan 0030 T1).
 *
 * The two load-bearing ones get the most tests, because they are the ones
 * that decide whether this channel is worth reading:
 *
 *   - an empty digest sends NOTHING (a weekly "all clear" trains its reader
 *     to filter the channel, taking the one that mattered with it);
 *   - a blind spot is never silence (rule 9 — "I found nothing" and "I could
 *     not look" must not be the same email, and here they are not even the
 *     same decision about whether to send).
 *
 * Plus the prose boundary: the server's own findings ride verbatim.
 */

import { describe, it, expect } from 'vitest';
import {
  renderDigest,
  renderEvent,
  wantsAttention,
  type MappingAttention,
} from './notifications.ts';

const quiet: MappingAttention = {
  mappingId: 'acme-mail',
  pendingDecisions: 0,
  deletionsWaiting: 0,
  movesWaiting: 0,
  failuresWaiting: 0,
  readyForCutover: false,
  autoApplied: 0,
  sharingOpen: 0,
};

describe('when NOT to send', () => {
  it('sends nothing when nothing is waiting — silence is the signal', () => {
    expect(renderDigest([quiet], 'en', 'daily')).toBeUndefined();
    expect(renderDigest([quiet, { ...quiet, mappingId: 'acme-files' }], 'nl', 'weekly')).
      toBeUndefined();
  });

  it('sends nothing for no mappings at all, rather than an empty list', () => {
    expect(renderDigest([], 'en', 'weekly')).toBeUndefined();
  });

  it('OMITS quiet mappings from a digest another mapping triggered', () => {
    const msg = renderDigest(
      [quiet, { ...quiet, mappingId: 'acme-files', failuresWaiting: 2 }],
      'en',
      'daily',
    );
    expect(msg?.body).toContain('acme-files');
    // The quiet one is not padding — a digest of one real item should read
    // as one item.
    expect(msg?.body).not.toContain('acme-mail');
  });
});

describe('a blind spot is never silence (rule 9)', () => {
  it('SENDS on a blind spot alone, with every count at zero', () => {
    const msg = renderDigest(
      [{ ...quiet, blindSpots: ['the file queue could not be read: ECONNREFUSED'] }],
      'en',
      'daily',
    );
    // The decisive assertion of this file: all-zero + unreadable must not be
    // reported as all-clear by staying quiet.
    expect(msg).toBeDefined();
    expect(msg?.body).toContain('COULD NOT BE READ');
    // Verbatim — the server's own reason, not a paraphrase.
    expect(msg?.body).toContain('the file queue could not be read: ECONNREFUSED');
  });

  it('counts as attention in the predicate too, not only in the renderer', () => {
    expect(wantsAttention(quiet)).toBe(false);
    expect(wantsAttention({ ...quiet, blindSpots: ['nope'] })).toBe(true);
  });
});

describe('what a digest says', () => {
  it('lists only the categories that have something in them', () => {
    const msg = renderDigest(
      [{ ...quiet, pendingDecisions: 3, failuresWaiting: 1 }],
      'en',
      'daily',
    );
    expect(msg?.body).toContain('3 changes needing a decision');
    expect(msg?.body).toContain('1 items that could not be copied');
    // Categories at zero are absent, not rendered as "0".
    expect(msg?.body).not.toContain('deletions to confirm');
    expect(msg?.body).not.toContain('moves to acknowledge');
  });

  it('names the cadence in the subject, in both languages', () => {
    const busy = { ...quiet, pendingDecisions: 1 };
    expect(renderDigest([busy], 'en', 'daily')?.subject).toContain('today');
    expect(renderDigest([busy], 'en', 'weekly')?.subject).toContain('this week');
    expect(renderDigest([busy], 'nl', 'daily')?.subject).toContain('vandaag');
    expect(renderDigest([busy], 'nl', 'weekly')?.subject).toContain('deze week');
  });

  it('reports readiness to finish, which has no count', () => {
    const msg = renderDigest([{ ...quiet, readyForCutover: true }], 'en', 'weekly');
    expect(msg?.body).toContain('ready to finish');
  });

  it('is Dutch end to end when the recipient is Dutch', () => {
    const msg = renderDigest([{ ...quiet, deletionsWaiting: 2 }], 'nl', 'daily');
    expect(msg?.subject).toContain('aandacht');
    expect(msg?.body).toContain('verwijderingen om te bevestigen');
    expect(msg?.body).toContain('Er gebeurt niets totdat u antwoordt');
  });
});

describe('immediate events', () => {
  it("carries a decision's summary verbatim — the server's words, not ours", () => {
    const summary = 'A mailbox appeared on the source that no mapping covers: nieuw@acme.nl';
    for (const locale of ['en', 'nl'] as const) {
      const msg = renderEvent({ kind: 'decision_raised', summary }, locale);
      expect(msg.body).toContain(summary);
    }
  });

  it("carries a run's lastError verbatim, in both languages", () => {
    const lastError = 'getaddrinfo ENOTFOUND stalwart';
    for (const locale of ['en', 'nl'] as const) {
      const msg = renderEvent(
        { kind: 'runs_failing', mappingId: 'acme-mail', consecutiveFailures: 4, lastError },
        locale,
      );
      expect(msg.body).toContain(lastError);
      expect(msg.body).toContain('4');
    }
  });

  it('distinguishes a passed check from a failed one, loudly', () => {
    const pass = renderEvent(
      { kind: 'verification_finished', mappingId: 'm', passed: true },
      'en',
    );
    const fail = renderEvent(
      { kind: 'verification_finished', mappingId: 'm', passed: false },
      'en',
    );
    expect(pass.body).toContain('passed');
    expect(fail.body).toContain('did NOT pass');
    expect(pass.body).not.toEqual(fail.body);
  });

  it('says what is true NOW after a rollback, and whose words the reason is', () => {
    // Somebody reading this at 22:00 has one question: where is my mail
    // arriving? So the body answers that first — old system authoritative,
    // syncing resumed — and only then gives the reason.
    const msg = renderEvent(
      {
        kind: 'rollback_finished',
        mappingId: 'm',
        reason: 'target rejected 4% of messages during the first hour',
      },
      'en',
    );
    expect(msg.body).toContain('rolled back');
    expect(msg.body).toContain('authoritative again');
    // DNS is verify-only: claiming the MX record was put back would be a lie
    // about the one thing that decides where mail actually lands.
    expect(msg.body).toContain('revert it by hand');
    // The operator's sentence, untouched — the prose boundary covers a
    // human's words for the same reason it covers the server's.
    expect(msg.body).toContain('target rejected 4% of messages during the first hour');
  });

  it('carries the rollback reason verbatim in Dutch too', () => {
    const msg = renderEvent(
      { kind: 'rollback_finished', mappingId: 'm', reason: 'target rejected 4% of messages' },
      'nl',
    );
    expect(msg.subject).toContain('teruggedraaid');
    // Frame translated, finding NOT translated (docs/i18n-prose-boundary.md).
    expect(msg.body).toContain('target rejected 4% of messages');
  });

  it('gives every event a subject in both languages', () => {
    const events = [
      { kind: 'decision_raised', summary: 's' },
      { kind: 'runs_failing', mappingId: 'm', consecutiveFailures: 1, lastError: 'e' },
      { kind: 'verification_finished', mappingId: 'm', passed: true },
      { kind: 'migration_finished', mappingId: 'm' },
      { kind: 'rollback_finished', mappingId: 'm', reason: 'r' },
    ] as const;
    for (const event of events) {
      for (const locale of ['en', 'nl'] as const) {
        const msg = renderEvent(event, locale);
        expect(msg.subject.length, `${event.kind}/${locale}`).toBeGreaterThan(0);
        expect(msg.body.length, `${event.kind}/${locale}`).toBeGreaterThan(0);
      }
    }
  });

  it('renders the two languages differently — a missing translation is a bug', () => {
    // Cheap parity check: if an NL string were left as its EN twin by
    // accident, this catches it for every event at once.
    for (const event of [
      { kind: 'migration_finished', mappingId: 'm' },
      { kind: 'verification_finished', mappingId: 'm', passed: true },
      { kind: 'rollback_finished', mappingId: 'm', reason: 'reason' },
    ] as const) {
      expect(renderEvent(event, 'en').subject).not.toEqual(renderEvent(event, 'nl').subject);
      expect(renderEvent(event, 'en').body).not.toEqual(renderEvent(event, 'nl').body);
    }
  });
});

describe('access granted — the one event addressed to a non-member (0095)', () => {
  const event = {
    kind: 'access_granted',
    organisation: 'Familie de Vries',
    appUrl: 'https://app.ownpace.eu',
    email: 'stranger@example.test',
  } as const;

  it('carries NO link, code or token — nothing to keep, nothing to leak', () => {
    // The property, not a preference. The issuer owns identity (ADR-0042), so
    // this mail authorises nothing, which is what makes forwarding or
    // intercepting it harmless. The next person to "improve" this into a
    // one-click link should fail here first.
    for (const locale of ['en', 'nl'] as const) {
      const { body } = renderEvent(event, locale);
      // The app address is the only URL, and it carries no query or fragment
      // that could smuggle one in.
      const urls = body.match(/https?:\/\/\S+/g) ?? [];
      expect(urls).toEqual(['https://app.ownpace.eu']);
      expect(body).not.toMatch(/token|code=|invite=|\?t=|#/i);
    }
  });

  it('says which address to use, because the binding is on that address', () => {
    // Registering with a different address succeeds and lands somebody in an
    // account belonging to nothing (migration 0006 matches on the verified
    // address). So the email has to be explicit, in both languages.
    for (const locale of ['en', 'nl'] as const) {
      const { body } = renderEvent(event, locale);
      expect(body).toContain('stranger@example.test');
      expect(body).toContain('Familie de Vries');
      expect(body).toContain('https://app.ownpace.eu');
    }
  });

  it('is written in the language they asked in', () => {
    // ADR-0013: the reply comes back in the language of the request. The
    // access form records the locale precisely so this can.
    expect(renderEvent(event, 'en').subject).toBe('Ownpace — your access is ready');
    expect(renderEvent(event, 'nl').subject).toBe('Ownpace — uw toegang staat klaar');
    expect(renderEvent(event, 'nl').body).not.toEqual(renderEvent(event, 'en').body);
  });

  it('does not tell somebody to open an app they cannot open yet', () => {
    // Every other event closes with "open the app to take action". This one is
    // read by somebody who has no account, so that line would be an instruction
    // they cannot follow.
    const other = renderEvent({ kind: 'migration_finished', mappingId: 'm-1' }, 'en');
    expect(other.body).toContain('Open the app');
    expect(renderEvent(event, 'en').body).not.toContain('Open the app');
  });
});

describe('renderDigest — tenant-level attention (0043 T4)', () => {
  it('sends for a tenant-level decision even with NO mappings at all', () => {
    // The hole 0030 T4 recorded: the digest was a list of mappings, so a
    // decision belonging to the tenant had nowhere to ride and reached nobody.
    const message = renderDigest([], 'en', 'daily', { pendingDecisions: 3 });

    expect(message, 'a pending decision must not be silence').toBeDefined();
    expect(message!.body).toContain('Your organisation');
    expect(message!.body).toContain('3');
  });

  it('keeps silence as the signal when nothing at all is waiting', () => {
    // The rule that makes the channel worth reading survives the change: an
    // empty digest is still no email.
    expect(renderDigest([], 'en', 'daily', { pendingDecisions: 0 })).toBeUndefined();
    expect(renderDigest([], 'en', 'daily', {})).toBeUndefined();
    expect(renderDigest([], 'en', 'daily')).toBeUndefined();
  });

  it('carries a tenant-level blind spot verbatim', () => {
    // "I could not look" is not "nothing is waiting" (rule 9).
    const message = renderDigest([], 'en', 'weekly', {
      blindSpots: ['the decision queue: connection refused'],
    });

    expect(message).toBeDefined();
    expect(message!.body).toContain('connection refused');
  });

  it('says it in Dutch too', () => {
    // EN/NL parity is a compile-time property for the KEYS; this pins that the
    // Dutch heading actually reaches the body rather than falling back to EN.
    const message = renderDigest([], 'nl', 'daily', { pendingDecisions: 1 });

    expect(message!.body).toContain('Uw organisatie');
    expect(message!.body).not.toContain('Your organisation');
  });
});

describe('auto-applied removals are narrated (ADR-0031, workplan 0048)', () => {
  it('keeps the email alive on their own — silent tidying is the one forbidden mode', () => {
    const m: MappingAttention = { ...quiet, autoApplied: 3 };
    expect(wantsAttention(m)).toBe(true);
    const digest = renderDigest([m], 'en', 'daily');
    expect(digest?.body).toContain('3 old copies of moved or renamed files removed automatically');
    // And each is recorded — the sentence says so, because an owner reading
    // this must know there is an audit row per removal, not a bulk note.
    expect(digest?.body).toContain('each is recorded');
  });

  it('says it in Dutch too, and stays silent at zero', () => {
    const nl = renderDigest([{ ...quiet, autoApplied: 1 }], 'nl', 'weekly');
    expect(nl?.body).toContain('automatisch verwijderd');
    expect(renderDigest([quiet], 'en', 'daily')).toBeUndefined();
  });
});

describe('open sharing-checklist rows are narrated (ADR-0032, workplan 0052 T6a)', () => {
  it('keep the email alive on their own — a forgotten checklist is what the digest prevents', () => {
    const m: MappingAttention = { ...quiet, sharingOpen: 4 };
    expect(wantsAttention(m)).toBe(true);
    const en = renderDigest([m], 'en', 'daily');
    expect(en?.body).toContain('4 rows open on the sharing checklist');
    const nl = renderDigest([m], 'nl', 'weekly');
    expect(nl?.body).toContain('4 regels open op de deel-checklist');
  });
});
