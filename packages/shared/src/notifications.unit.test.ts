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

describe('the migration is named the way its owner named it', () => {
  /**
   * Reported from a live mailpit on 2026-09-14: an owner's summary opened
   * "Migration: 0cc9a844-4075-4d65-a562-374df8299b77". On the managed side
   * `mailbox_mapping.id` is a UUID and the name the owner typed in the wizard
   * lives in its own column, which the digest never read — so the email
   * addressed them by a handle that appears on no screen they have seen.
   */
  it('prints the NAME, and not the id, when the migration has one', () => {
    const msg = renderDigest(
      [{ ...quiet, mappingId: '0cc9a844-4075-4d65-a562-374df8299b77', name: 'Gmail to Nextcloud', failuresWaiting: 34 }],
      'en',
      'daily',
    );
    expect(msg?.body).toContain('Migration: Gmail to Nextcloud');
    // Not "as well as": a UUID beside the name is the noise this removes.
    expect(msg?.body).not.toContain('0cc9a844-4075-4d65-a562-374df8299b77');
  });

  it('falls back to the id for a migration that genuinely has no name', () => {
    // `mailbox_mapping.name` is nullable — rows the appliance wrote have none.
    // An id is a poor label; a blank one is worse, and leaves the reader
    // unable to tell which migration the counts belong to.
    const msg = renderDigest([{ ...quiet, failuresWaiting: 1 }], 'en', 'daily');
    expect(msg?.body).toContain('Migration: acme-mail');
  });

  it('says it in Dutch too, since the name is not ours to translate', () => {
    const msg = renderDigest(
      [{ ...quiet, name: 'Gmail naar Nextcloud', failuresWaiting: 2 }],
      'nl',
      'daily',
    );
    expect(msg?.body).toContain('Migratie: Gmail naar Nextcloud');
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
    expect(msg?.body).toContain('Deze zaken wachten op uw beslissing.');
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
        { kind: 'runs_failing', mapping: { id: 'acme-mail' }, consecutiveFailures: 4, lastError },
        locale,
      );
      expect(msg.body).toContain(lastError);
      expect(msg.body).toContain('4');
    }
  });

  it('distinguishes a passed check from a failed one, loudly', () => {
    const pass = renderEvent(
      { kind: 'verification_finished', mapping: { id: 'm' }, passed: true },
      'en',
    );
    const fail = renderEvent(
      { kind: 'verification_finished', mapping: { id: 'm' }, passed: false },
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
        mapping: { id: 'm' },
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
      { kind: 'rollback_finished', mapping: { id: 'm' }, reason: 'target rejected 4% of messages' },
      'nl',
    );
    expect(msg.subject).toContain('teruggedraaid');
    // Frame translated, finding NOT translated (docs/i18n-prose-boundary.md).
    expect(msg.body).toContain('target rejected 4% of messages');
  });

  it('gives every event a subject in both languages', () => {
    const events = [
      { kind: 'decision_raised', summary: 's' },
      { kind: 'runs_failing', mapping: { id: 'm' }, consecutiveFailures: 1, lastError: 'e' },
      { kind: 'verification_finished', mapping: { id: 'm' }, passed: true },
      { kind: 'migration_finished', mapping: { id: 'm' } },
      { kind: 'rollback_finished', mapping: { id: 'm' }, reason: 'r' },
      { kind: 'first_copy_complete', person: 'Anna Jansen', domains: ['email'] },
      { kind: 'looking_less_often', migrations: [{ mapping: { id: 'm' }, step: 'six-hourly' }] },
      {
        kind: 'contract_withdrawn',
        organisation: 'o',
        name: 'n',
        tier: 'Small',
        since: '1 October 2026',
        withdrawnAt: '3 October 2026 at 10:04 UTC',
        confirmTo: 'n@example.invalid',
        credits: 1,
        beganOnRequest: false,
      },
      {
        kind: 'order_confirmed',
        organisation: 'o',
        order: { kind: 'top_up', band: '100 GB', price: '€19.00' },
        orderedAt: '1 October 2026 at 09:30 UTC',
        withdrawUntil: null,
        beganOnRequest: false,
        terms: 'https://www.ownpace.eu/terms.html',
      },
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
      { kind: 'migration_finished', mapping: { id: 'm' } },
      { kind: 'verification_finished', mapping: { id: 'm' }, passed: true },
      { kind: 'rollback_finished', mapping: { id: 'm' }, reason: 'reason' },
    ] as const) {
      expect(renderEvent(event, 'en').subject).not.toEqual(renderEvent(event, 'nl').subject);
      expect(renderEvent(event, 'en').body).not.toEqual(renderEvent(event, 'nl').body);
    }
  });
});

/**
 * THE FIRST COPY, ONE MAIL PER PERSON (workplan 0154 T7; the owner: "One per
 * person"). Who it is about and each data type that arrived, that it keeps
 * up until the switch, and that nothing is needed — so no "act on this".
 */
describe('everything has arrived — the first copy, once per person (0154 T7)', () => {
  const anna = { kind: 'first_copy_complete', person: 'Anna Jansen', domains: ['email', 'calendar', 'contact'] } as const;

  it('names the person and each data type that arrived, in both languages', () => {
    const en = renderEvent(anna, 'en');
    expect(en.subject).toBe('Ownpace — everything has arrived');
    expect(en.body).toContain('Person: Anna Jansen');
    expect(en.body).toContain('Everything has arrived: email, calendar and contacts.');
    expect(en.body).toContain('It is kept in step until you switch. Nothing needs your attention urgently.');
    const nl = renderEvent(anna, 'nl');
    expect(nl.subject).toBe('Ownpace — alles is aangekomen');
    expect(nl.body).toContain('Persoon: Anna Jansen');
    expect(nl.body).toContain('Alles is aangekomen: e-mail, agenda en contacten.');
    expect(nl.body).toContain('Het wordt bijgehouden tot u overstapt. U hoeft niets te doen.');
  });

  it('says one data type on its own, and names nobody for the appliance’s one person', () => {
    // On Free, outside the alpha (workplan 0157 T5): what keeping in step means.
    const free = { ...anna, onePassADay: true } as const;
    expect(renderEvent(free, 'en').body).toContain(
      'On Free that is one pass a day. A higher tier looks for changes as often as every 15 minutes: check tiers in the Billing section in the app.',
    );
    expect(renderEvent(free, 'nl').body).toContain(
      'Op Free is dat één ronde per dag. Bij een hoger pakket kijken we tot maximaal iedere 15 minuten naar wijzigingen: pas het pakket aan via Facturering in de app.',
    );
    expect(renderEvent(anna, 'en').body).not.toContain('On Free');
    const msg = renderEvent({ kind: 'first_copy_complete', domains: ['file'] }, 'en');
    expect(msg.body).toContain('Everything has arrived: files.');
    expect(msg.body).not.toContain('Person:');
  });

  it('does not ask the reader to act, having just said nothing is needed', () => {
    for (const locale of ['en', 'nl'] as const) {
      const body = renderEvent(anna, locale).body;
      expect(body).not.toContain('Open the app to act on this.');
      expect(body).not.toContain('Open de app om actie te ondernemen.');
    }
  });
});

/**
 * A SLOWER CADENCE, SAID ONCE (workplan 0157 T7; the owner, 2026-10-05: "sync
 * slow down once a migration is in step: yes", each step said in the app and
 * by email). One mail for an organisation's morning, each migration by its
 * name and its person, how often it looks now, and how to choose more often.
 */
describe('everything is in step, so we look less often (0157 T7)', () => {
  const two = {
    kind: 'looking_less_often',
    migrations: [
      { mapping: { id: 'm1', name: 'Anna mail' }, person: 'Anna Jansen', step: 'six-hourly' },
      { mapping: { id: 'm2', name: 'Shared files' }, step: 'daily' },
    ],
  } as const;

  it('names each migration, its person and how often it looks now, in both languages', () => {
    const en = renderEvent(two, 'en');
    expect(en.subject).toBe('Ownpace — everything is in step, so we look less often');
    expect(en.body).toBe(
      [
        'Everything is in step, so we now look for changes less often:',
        '',
        'Migration: Anna mail',
        '  - Person: Anna Jansen',
        '  - Now every 6 hours',
        '',
        'Migration: Shared files',
        '  - Now once a day',
        '',
        'Choose more often any time, under \'How often to look for changes\' on each migration in the app. ' +
          'Open a migration and we look every hour again, for 14 days.',
      ].join('\n'),
    );
    const nl = renderEvent(two, 'nl');
    expect(nl.subject).toBe('Ownpace — alles is bijgewerkt, dus we doen het wat rustiger aan');
    expect(nl.body).toContain('Alles is bijgewerkt, dus we doen het nu wat rustiger aan:');
    expect(nl.body).toContain('Migratie: Anna mail\n  - Persoon: Anna Jansen\n  - Nu elke 6 uur');
    expect(nl.body).toContain('Migratie: Shared files\n  - Nu eens per dag');
    expect(nl.body).toContain('Opent u een migratie, dan kijken we weer 14 dagen elk uur.');
  });

  it('names a migration with no name by its id, as every event does', () => {
    const body = renderEvent(
      { kind: 'looking_less_often', migrations: [{ mapping: { id: 'm3', name: ' ' }, step: 'daily' }] },
      'en',
    ).body;
    expect(body).toContain('Migration: m3\n  - Now once a day');
  });

  it('does not ask the reader to act: it has just said how to choose more often', () => {
    for (const locale of ['en', 'nl'] as const) {
      const body = renderEvent(two, locale).body;
      expect(body).not.toContain('Open the app to act on this.');
      expect(body).not.toContain('Open de app om actie te ondernemen.');
    }
  });
});

/**
 * A WITHDRAWAL, RECEIVED (workplan 0111 T7; terms §7). What article 11a of the
 * Consumer Rights Directive asks the acknowledgement to say: what was sent and
 * when it arrived; then what follows from it, in the organisation's language,
 * and nothing asked of its reader.
 */
describe('a withdrawal, received — the acknowledgement on a durable medium (0111 T7)', () => {
  const withdrawn = {
    kind: 'contract_withdrawn',
    organisation: 'De Vries thuis',
    name: 'Sam de Vries',
    tier: 'Small',
    since: '1 oktober 2026',
    withdrawnAt: '3 oktober 2026 om 10:04 UTC',
    confirmTo: 'sam@example.invalid',
    credits: 1,
    beganOnRequest: false,
  } as const;

  it('says what was sent and when, that the organisation is on Free, and that it is credited in full', () => {
    const nl = renderEvent(withdrawn, 'nl');
    expect(nl.subject).toBe('Ownpace — uw herroeping is ontvangen');
    expect(nl.body).toBe(
      [
        'Organisatie: De Vries thuis',
        '',
        'We hebben uw herroeping van de overeenkomst ontvangen op 3 oktober 2026 om 10:04 UTC. Met deze e-mail bevestigen we dat.',
        '',
        'Wat u stuurde:',
        '  - Naam: Sam de Vries',
        '  - De overeenkomst: Ownpace Small, gesloten op 1 oktober 2026',
        '  - Bevestiging naar: sam@example.invalid',
        '',
        'Vanaf dat moment staat uw organisatie op Free. Uw account en uw migraties blijven, in het tempo van Free.',
        '',
        'Voor de dagen vóór uw herroeping wordt niets in rekening gebracht: wat gefactureerd is, crediteren we volledig, met een creditnota per factuur.',
        '',
        'Wat u meer betaalde dan u verschuldigd bent, betalen we binnen 14 dagen terug, met het betaalmiddel dat u gebruikte.',
      ].join('\n'),
    );
  });

  it('says the days used are billed when we were asked to begin early, in English too', () => {
    const en = renderEvent({ ...withdrawn, since: '1 October 2026', withdrawnAt: '3 October 2026 at 10:04 UTC', beganOnRequest: true }, 'en');
    expect(en.subject).toBe('Ownpace — we received your withdrawal');
    expect(en.body).toContain('We received your withdrawal from the contract on 3 October 2026 at 10:04 UTC. This email confirms it.');
    expect(en.body).toContain('  - The contract: Ownpace Small, concluded on 1 October 2026');
    expect(en.body).toContain('The days you used are billed in proportion to the agreed price.');
    expect(en.body).toContain('we pay back within 14 days, by the means of payment you used.');
  });

  it('says nothing needs crediting when nothing was invoiced, and asks nothing of its reader', () => {
    const en = renderEvent({ ...withdrawn, credits: 0 }, 'en');
    expect(en.body).toContain('Nothing was invoiced that needs crediting.');
    expect(en.body).not.toContain('pay back');
    expect(en.body).not.toMatch(/open the app/i);
  });
});

describe('access requested — the knock, addressed to the operator (0093 T3)', () => {
  const full = {
    kind: 'access_requested',
    email: 'stranger@example.test',
    organisation: 'Familie de Vries',
    tier: 'Small',
  } as const;

  it('carries the address, because replying to a person is the whole job', () => {
    for (const locale of ['en', 'nl'] as const) {
      expect(renderEvent(full, locale).body).toContain('stranger@example.test');
    }
  });

  it('carries NO note — the applicant’s own words stay in the database', () => {
    // The row's most useful field, and deliberately not in the mail. An email
    // is forwarded, archived and searched far more casually than a table is;
    // the queue shows the note behind authentication. Same reasoning that
    // keeps the name and the note out of the log line (§17).
    const withNote = { ...full, note: 'Moving 40 mailboxes off Microsoft 365' } as const;
    for (const locale of ['en', 'nl'] as const) {
      expect(renderEvent(withNote, locale).body).not.toContain('Moving 40 mailboxes');
    }
  });

  it('says plainly that nothing has been granted', () => {
    // The operator is being told to LOOK, not that a decision was made. A
    // subject line somebody skims at 23:00 must not read like a completed act.
    expect(renderEvent(full, 'en').body).toMatch(/[Nn]othing has been granted/);
  });

  it('omits the optional fields rather than printing them empty', () => {
    // `Organisation:` with nothing after it reads like a value that went
    // missing, and the operator goes looking for it. They left the field blank.
    const bare = { kind: 'access_requested', email: 'a@b.test' } as const;
    for (const locale of ['en', 'nl'] as const) {
      const { body } = renderEvent(bare, locale);
      expect(body).not.toMatch(/Organisation:\s*$/m);
      expect(body).not.toMatch(/Organisatie:\s*$/m);
      expect(body).toContain('a@b.test');
    }
  });

  it('closes with "open the app", because this reader HAS one', () => {
    // Unlike the two events addressed to a stranger. The operator's next step
    // is the queue, and the line that would confuse a non-member is the right
    // one here.
    expect(renderEvent(full, 'en').body).toMatch(/[Oo]pen the app/);
  });

  it('is in English whatever language is asked for: it is the operator’s (ADR-0013, amended 2026-10-11)', () => {
    expect(renderEvent(full, 'nl')).toEqual(renderEvent(full, 'en'));
    expect(renderEvent(full, 'nl').subject).toBe('Ownpace — somebody asked for access');
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
      // The app's sign-in page is the only URL, and its one query is the
      // mail's language (the UX sweep, 2026-10-17): nothing that could
      // smuggle a token in, and no fragment.
      const urls = body.match(/https?:\/\/\S+/g) ?? [];
      expect(urls).toEqual([`https://app.ownpace.eu/login?locale=${locale}`]);
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

  /**
   * THE SIGN-IN PAGE IN THE MAIL'S LANGUAGE (the UX sweep, 2026-10-17). The
   * bare app address opened the sign-in page in the browser's language, so a
   * Dutch tester with an English browser met it in English. The address now
   * ends in `/login?locale=` and the mail's own language, which the sign-in
   * page reads once on arrival. One trailing slash on the setting is not
   * doubled.
   */
  it.each([
    ['en', 'https://app.ownpace.eu'],
    ['nl', 'https://app.ownpace.eu/'],
  ] as const)('sends them to the sign-in page in the mail’s language (%s)', (locale, appUrl) => {
    const { body } = renderEvent({ ...event, appUrl }, locale);
    const said = locale === 'en' ? 'Sign in here:' : 'Meld u hier aan:';
    expect(body).toContain(`${said} https://app.ownpace.eu/login?locale=${locale}\n`);
  });

  it('does not tell somebody to open an app they cannot open yet', () => {
    // Every other event closes with "open the app to take action". This one is
    // read by somebody who has no account, so that line would be an instruction
    // they cannot follow.
    const other = renderEvent({ kind: 'migration_finished', mapping: { id: 'm-1' } }, 'en');
    expect(other.body).toContain('Open the app');
    expect(renderEvent(event, 'en').body).not.toContain('Open the app');
  });
});

describe('access declined — saying no is a courtesy too (0095 T5)', () => {
  const event = { kind: 'access_declined' } as const;

  it('has NOWHERE to put the operator\'s note, by construction', () => {
    // The queue labels that field "Note (for you, not for them)" in both
    // languages, and a promise made on a screen has to hold in the pipe behind
    // it. The strongest form of that is a TYPE with no fields: there is nothing
    // to pass in, so no later "just include the reason, it is friendlier" can
    // reach a reader without first changing the shape and failing here.
    //
    // Asserted as a property of the value, not by inspecting the string: the
    // event object itself is only its kind.
    expect(Object.keys(event)).toEqual(['kind']);

    // And the render is a pure function of it, so no note, organisation or
    // tier can appear in a body that was never given one.
    for (const locale of ['en', 'nl'] as const) {
      const { body } = renderEvent(event, locale);
      expect(body).not.toMatch(/note|notitie/i);
      expect(body).not.toMatch(/https?:\/\//);
    }
  });

  it('says a person read it, and that a reply reaches a person', () => {
    // A refusal nobody can answer is the kind that gets forwarded to a
    // regulator rather than back to us. There is no address to write to in the
    // body on purpose — the reply-to of the mail is the channel, and hardcoding
    // one here would put a second, staler address into circulation.
    for (const locale of ['en', 'nl'] as const) {
      const { body } = renderEvent(event, locale);
      expect(body).toMatch(/reply|contact op/i);
    }
  });

  it('is written in the language they asked in', () => {
    expect(renderEvent(event, 'en').subject).toBe('Ownpace — about your request');
    expect(renderEvent(event, 'nl').subject).toBe('Ownpace — over uw aanvraag');
    expect(renderEvent(event, 'nl').body).not.toEqual(renderEvent(event, 'en').body);
  });

  it('does not close by telling them to open the app', () => {
    // Same reason as the grant, and worse here: the reader has just been told
    // no, so pointing them at a door that will not open reads as a taunt.
    expect(renderEvent(event, 'en').body).not.toContain('Open the app');
    expect(renderEvent(event, 'nl').body).not.toContain('Open de app');
  });

  it('promises nothing it cannot keep — no "yet", no queue, no criteria', () => {
    // "Not right now" is what is true. "Not yet" is a promise nobody made, and
    // naming criteria invites an argument about them with somebody who is
    // already disappointed.
    const { body } = renderEvent(event, 'en');
    expect(body).not.toMatch(/waiting list|wait list|not yet|come back|reapply/i);
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
    expect(digest?.body).toContain('removed automatically (auto-apply)');
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
    expect(nl?.body).toContain('4 regels open op de Delen-checklist');
  });
});

/**
 * An order, confirmed (workplan 0111 T7, slice 7e; terms §6, §7; article 8(7)
 * of the Consumer Rights Directive): what was ordered, at which price and
 * when; while a consumer's fourteen days run, how to withdraw, and the
 * request to begin in the order button's own words when it was made; the
 * terms; and nothing asked of its reader.
 */
describe('an order, confirmed by email (0111 T7, slice 7e)', () => {
  const ordered = {
    kind: 'order_confirmed',
    organisation: 'De Vries thuis',
    order: { kind: 'tier', tier: 'Small', monthly: '€ 5,00' },
    orderedAt: '1 oktober 2026 om 09:30 UTC',
    withdrawUntil: '15 oktober 2026',
    beganOnRequest: true,
    terms: 'https://www.ownpace.eu/nl/voorwaarden.html',
  } as const;

  it('says what was ordered and when, how to withdraw, and the request to begin, in Dutch', () => {
    const nl = renderEvent(ordered, 'nl');
    expect(nl.subject).toBe('Ownpace — uw bestelling');
    expect(nl.body).toBe(
      [
        'Organisatie: De Vries thuis',
        '',
        'U bestelde met betalingsverplichting op 1 oktober 2026 om 09:30 UTC:',
        '  - Ownpace Small, € 5,00 per maand',
        '',
        'Met deze e-mail bevestigen we dat. Elke maand wordt vooraf gefactureerd (voorwaarden §8).',
        '',
        'Als consument kunt u deze overeenkomst zonder opgave van redenen herroepen, tot het einde van 15 oktober 2026. ' +
          'Gebruik Hier de overeenkomst herroepen op de pagina Facturering in de app, of stuur een ondubbelzinnige verklaring aan support@ownpace.eu. ' +
          'U kunt het modelformulier in §15 van de voorwaarden gebruiken.',
        '',
        'U vroeg ons direct te beginnen, binnen die 14 dagen. Herroept u, dan betaalt u voor het deel van de dienst dat al geleverd is, ' +
          'naar verhouding van de afgesproken prijs, en niet meer.',
        '',
        'De voorwaarden: https://www.ownpace.eu/nl/voorwaarden.html',
      ].join('\n'),
    );
  });

  it('says the days used cost nothing when the button did not ask, in English, for a band once', () => {
    const en = renderEvent(
      {
        ...ordered,
        order: { kind: 'top_up', band: '100 GB', price: '€19.00' },
        orderedAt: '1 October 2026 at 09:30 UTC',
        withdrawUntil: '15 October 2026',
        beganOnRequest: false,
        terms: 'https://www.ownpace.eu/terms.html',
      },
      'en',
    );
    expect(en.subject).toBe('Ownpace — your order');
    expect(en.body).toContain('You ordered, with obligation to pay, on 1 October 2026 at 09:30 UTC:');
    expect(en.body).toContain('  - 100 GB more data room, once, for €19.00');
    expect(en.body).toContain('This email confirms it. It is billed once.');
    expect(en.body).toContain('until the end of 15 October 2026. Use Withdraw from contract here on the Billing page');
    expect(en.body).toContain('If you withdraw, you pay nothing for the days already used.');
    expect(en.body).not.toContain('You asked us to begin');
    expect(en.body.endsWith('The terms: https://www.ownpace.eu/terms.html')).toBe(true);
  });

  it('says a year paid ahead: its months, its price, and that it is credit and not refunded (0111 T11)', () => {
    const year = { kind: 'year', tier: 'Medium', price: '€ 72,00', from: 'november 2026', to: 'oktober 2027' } as const;
    const nl = renderEvent({ ...ordered, order: year, withdrawUntil: null, beganOnRequest: false }, 'nl');
    expect(nl.body).toContain('  - Ownpace Medium, een jaar vooruit, november 2026 tot en met oktober 2027: € 72,00');
    expect(nl.body).toContain(
      'Met deze e-mail bevestigen we dat. Het wordt nu gefactureerd, als tegoed: elke maand van het jaar betaalt de helft ' +
        'van de maandprijs van het pakket dat ze gebruikte, en wat na het jaar over is, betaalt de maanden daarna tegen de ' +
        'volle prijs. Het wordt niet terugbetaald, en wat er over is vervalt als u uw account sluit (voorwaarden §8).',
    );
    const en = renderEvent(
      { ...ordered, order: { ...year, price: '€72.00', from: 'November 2026', to: 'October 2027' }, withdrawUntil: null },
      'en',
    );
    expect(en.body).toContain('  - Ownpace Medium, a year ahead, November 2026 to October 2027: €72.00');
    expect(en.body).toContain('It is billed now, as credit: each month of the year pays half the monthly price of the tier it used');
    expect(en.body).toContain('It is not refunded, and what is left ends if you close your account (terms §8).');
  });

  it('says nothing of withdrawing to a business, and asks nothing of its reader', () => {
    const en = renderEvent({ ...ordered, withdrawUntil: null, beganOnRequest: false }, 'en');
    expect(en.body).not.toMatch(/withdraw|consumer/i);
    expect(en.body).not.toMatch(/open the app/i);
  });
});

describe("a year's credit running out — said once, to whoever pays (0111 T11, slice Y3)", () => {
  const notice = {
    kind: 'credit_running_out',
    organisation: 'De Vries',
    month: 'oktober 2027',
    left: '€ 0,00',
    tier: 'Medium',
    cost: '€ 12,00',
    halfPrice: false,
  } as const;

  it('says what is left, what the month costs, and how to keep paying ahead, in Dutch', () => {
    const nl = renderEvent(notice, 'nl');
    expect(nl.subject).toBe('Ownpace — uw tegoed raakt op');
    expect(nl.body).toBe(
      [
        'Organisatie: De Vries',
        '',
        'Uw tegoed is niet genoeg voor heel oktober 2027:',
        '  - Tegoed over: € 0,00',
        '  - Ownpace Medium, oktober 2027: € 12,00',
        '',
        'Wat uw tegoed niet betaalt, wordt aan het begin van elke maand gefactureerd, per maand (voorwaarden §8).',
        '',
        'Wilt u vooruit blijven betalen, koop dan nog een jaar onder Een jaar vooruit op de pagina Facturering in de app: ' +
          'zes keer de maandprijs, voor twaalf maanden tegen de halve prijs.',
      ].join('\n'),
    );
  });

  it('says a month of a year at half price in its invoice line\'s words, in English, and asks nothing more', () => {
    const en = renderEvent(
      { ...notice, organisation: 'De Vries', month: 'November 2027', left: '€32.00', tier: 'Extra large', cost: '€40.00', halfPrice: true },
      'en',
    );
    expect(en.subject).toBe('Ownpace — your credit is running out');
    expect(en.body).toContain('Your credit does not pay for all of November 2027:');
    expect(en.body).toContain('  - Credit left: €32.00');
    expect(en.body).toContain('  - Ownpace Extra large, November 2027: €40.00, at half the monthly price (a year ahead)');
    expect(en.body).toContain('buy another year under A year ahead on the Billing page in the app');
    expect(en.body).not.toMatch(/open the app/i);
  });
});

describe('money to give back — addressed to the operator, in English (0111; 2026-10-11)', () => {
  const base = { kind: 'money_to_give_back', organisationId: 'org-1', creditNote: '2026-0010', invoice: '2026-0009' } as const;

  it('says a transfer by hand, with the amount and where to book it', () => {
    const { subject, body } = renderEvent({ ...base, reason: 'by_hand', cents: 400 }, 'en');
    expect(subject).toBe('Ownpace — money owed back to a customer');
    expect(body).toContain('Credit note 2026-0010 credits EUR 4.00 on invoice 2026-0009, which was paid, but not through Mollie.');
    expect(body).toContain('by bank transfer, within 14 days of the withdrawal (terms §7), and book it on the credit note in Moneybird.');
    expect(body).toContain('Organisation: org-1');
    expect(body).toContain('mark it there once it is paid back');
  });

  it('says a failed refund, and whether its payment must come off the credit note', () => {
    const booked = renderEvent({ ...base, reason: 'refund_failed', cents: 300, refundId: 're_1', inTheBooks: true }, 'en').body;
    expect(booked).toContain("Mollie's refund re_1 of EUR 3.00 for credit note 2026-0010 ended failed: the money did not go back.");
    expect(booked).toContain('take its payment off the credit note in Moneybird (booked under re_1).');
    const canceled = renderEvent({ ...base, reason: 'refund_canceled', cents: 300, refundId: 're_2', inTheBooks: false }, 'en').body;
    expect(canceled).toContain('ended canceled');
    expect(canceled).toContain('It was not booked in Moneybird, and will not be.');
  });

  it('says a late refund, which leaves the list by itself', () => {
    const { body } = renderEvent({ ...base, reason: 'refund_late', cents: 300, refundId: 're_3', refundStatus: 'queued' }, 'en');
    expect(body).toContain("Mollie's refund re_3 of EUR 3.00 for credit note 2026-0010 is still queued a week after it was made.");
    expect(body).toContain('lists it under Money to give back until Mollie ends it');
    expect(body).not.toContain('mark it there');
  });

  it('is in English whatever language is asked for, and names nobody', () => {
    const event = { ...base, reason: 'by_hand', cents: 400 } as const;
    expect(renderEvent(event, 'nl')).toEqual(renderEvent(event, 'en'));
  });
});
