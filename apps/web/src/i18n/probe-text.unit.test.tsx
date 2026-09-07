// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A probe result in the reader's language — except the half that is not ours
 * (workplan 0080; 0068 T10d).
 *
 * The owner met *Connected. 12 folders visible.* in a Dutch UI. The naive fix
 * is to translate the probe result, and it is wrong: half of what a probe
 * returns is the PROVIDER's, and `invalid_client` is the exact string you
 * paste into their console. Translating that destroys its only use.
 *
 * So both halves are pinned here, and the second one matters more than the
 * first: **a provider's refusal must survive untouched under `nl`.**
 */

import { describe, it, expect } from 'vitest';
import type { ProbeOutcome } from '@openmig/shared';
import {
  measuredText,
  probeText,
  qualificationEvidence,
  qualificationText,
  schedulingText,
} from './probe-text.ts';
import { STRINGS, type StringKey } from './strings.ts';

/** A `t` bound to one locale, with the same interpolation the app uses. */
const translator =
  (locale: 'en' | 'nl') =>
  (key: StringKey, vars?: Readonly<Record<string, string | number>>): string =>
    STRINGS[locale][key].replace(/\{(\w+)\}/g, (whole, name: string) =>
      vars && name in vars ? String(vars[name]) : whole,
    );

const en = translator('en');
const nl = translator('nl');

describe('probeText — what we authored', () => {
  const connected: ProbeOutcome = { code: 'connected', count: 12, unit: 'folder' };

  it('reads in English under en', () => {
    expect(probeText(en, connected, 'ignored')).toBe('Connected. 12 folders visible.');
  });

  it('reads in DUTCH under nl — the whole point of the change', () => {
    expect(probeText(nl, connected, 'ignored')).toBe('Verbonden. 12 mappen zichtbaar.');
  });

  it('counts one thing in the singular, in both languages', () => {
    const one: ProbeOutcome = { code: 'connected', count: 1, unit: 'folder' };
    expect(probeText(en, one, '')).toBe('Connected. 1 folder visible.');
    expect(probeText(nl, one, '')).toBe('Verbonden. 1 map zichtbaar.');
  });

  it('names the unit a source actually counts', () => {
    expect(probeText(nl, { code: 'connected', count: 3, unit: 'calendar' }, '')).toContain(
      "agenda's",
    );
    expect(probeText(en, { code: 'connected', count: 2, unit: 'addressBook' }, '')).toContain(
      'address books',
    );
  });

  it('puts the values where each LANGUAGE puts them, not where English does', () => {
    // The reason `t` gained interpolation at all: a sentence concatenated from
    // fragments has English word order baked into the concatenation.
    const status: ProbeOutcome = { code: 'targetStatus', url: 'https://mail.acme.test', status: 401 };
    expect(probeText(en, status, '')).toContain('The server at https://mail.acme.test answered 401.');
    expect(probeText(nl, status, '')).toContain('De server op https://mail.acme.test antwoordde 401.');
    // 401 gets the sentence that says the server is fine and the login is not.
    expect(probeText(nl, status, '')).toContain('weigerde de inloggegevens');
  });
});

describe('probeText — the deadline and the floor (2026-09-02)', () => {
  it('a probe that did not answer says so, with the seconds, in both languages', () => {
    const late: ProbeOutcome = { code: 'timedOut', seconds: 20 };
    expect(probeText(en, late, 'ignored')).toBe(
      'No answer within 20 seconds; kept anyway, so test later or narrow the root folder.',
    );
    expect(probeText(nl, late, 'ignored')).toContain('binnen 20 seconden');
  });

  it('a count that stopped at the cap reads as a floor', () => {
    const floor: ProbeOutcome = { code: 'connected', count: 5001, unit: 'folder', floor: true };
    expect(probeText(en, floor, '')).toBe('Connected. At least 5001 folders visible.');
    expect(probeText(nl, floor, '')).toBe('Verbonden. Ten minste 5001 mappen zichtbaar.');
  });
});

describe("probeText — what the PROVIDER said", () => {
  const theirs: ProbeOutcome = { code: 'providerRefused' };
  const verbatim = 'Dropbox refused the token request (400): {"error": "invalid_client"}';

  it('renders it untouched under nl', () => {
    // This is the string somebody pastes into the provider's console. A Dutch
    // rendering of it would be a Dutch rendering of somebody else's error code.
    expect(probeText(nl, theirs, verbatim)).toBe(verbatim);
  });

  it('renders it untouched under en too', () => {
    expect(probeText(en, theirs, verbatim)).toBe(verbatim);
  });
});

describe('probeText — when there is no outcome at all', () => {
  it('shows what arrived, rather than less', () => {
    // An older API, a cached response, a route not taught yet. Falling back to
    // the server's own sentence can never render less than before this existed.
    expect(probeText(nl, undefined, 'Connected. 12 folders visible.')).toBe(
      'Connected. 12 folders visible.',
    );
  });
});

describe('a credential refusal is OURS, so it is translated (workplan 0083)', () => {
  const refusal = {
    code: 'credentials_missing',
    fields: ['clientId', 'clientSecret'],
    en: 'dropbox source: clientId, clientSecret are not set. A Dropbox migration authenticates as the account that consented.',
    nl: 'dropbox source: clientId en clientSecret zijn niet ingesteld. Een Dropbox-migratie meldt zich aan als het account dat toestemming gaf.',
  } as const;

  it('renders the Dutch to a Dutch reader', () => {
    // The owner's report, in one assertion: this sentence was English on a
    // Dutch phone because it arrived labelled as the provider's.
    expect(probeText(nl, { code: 'credentialsRefused', refusal }, 'IGNORED', 'nl')).toBe(refusal.nl);
  });

  it('renders the English to an English reader', () => {
    expect(probeText(en, { code: 'credentialsRefused', refusal }, 'IGNORED', 'en')).toBe(refusal.en);
  });

  it('still names the exact fields in Dutch', () => {
    const dutch = probeText(nl, { code: 'credentialsRefused', refusal }, '', 'nl');
    // Translating `clientId` would name a box that is on no screen — the 0071
    // T2 defect, from the other direction.
    expect(dutch).toContain('clientId');
    expect(dutch).toContain('clientSecret');
  });

  it("does NOT translate a provider's own refusal, whatever the locale", () => {
    // The distinction the outcome exists to carry. `invalid_client` is the
    // string somebody pastes into Dropbox's console.
    expect(probeText(nl, { code: 'providerRefused' }, 'invalid_client', 'nl')).toBe('invalid_client');
  });

  it('defaults to English when no locale is passed', () => {
    // Every pre-existing call site omits the argument; none of them may start
    // rendering something different because this parameter was added.
    expect(probeText(en, { code: 'credentialsRefused', refusal }, 'IGNORED')).toBe(refusal.en);
  });
});

describe('schedulingText — the verdict a DAV target test carries (0105 T0)', () => {
  it('says auto-schedule in the reader\'s language, and that it was MEASURED', () => {
    const verdict = { capability: 'auto-schedule', sentence: 'server english' };
    expect(schedulingText(en, verdict)).toContain('measured on this target, not assumed');
    expect(schedulingText(nl, verdict)).toContain('gemeten op dit doel, niet aangenomen');
  });

  it('unknown is worded as unmeasured-never-safe in BOTH languages', () => {
    // The run-#6 lesson survives translation: a Dutch screen must not soften
    // "unmeasured" into anything a reader could file under "fine".
    const verdict = { capability: 'unknown', sentence: 'server english' };
    expect(schedulingText(en, verdict)).toContain('UNMEASURED');
    expect(schedulingText(en, verdict)).toContain('not safe');
    expect(schedulingText(nl, verdict)).toContain('NIET GEMETEN');
    expect(schedulingText(nl, verdict)).toContain('niet veilig');
  });

  it('none says fan-out cannot happen here', () => {
    expect(schedulingText(en, { capability: 'none', sentence: 'x' })).toContain('cannot happen here');
    expect(schedulingText(nl, { capability: 'none', sentence: 'x' })).toContain('uitwaaieren');
  });

  it('a capability this build has no words for falls back to the server\'s sentence', () => {
    // The probeText rule, inherited: never render less than what arrived.
    expect(schedulingText(nl, { capability: 'brand-new', sentence: 'the server said this' })).toBe(
      'the server said this',
    );
  });

  it('no verdict means nothing at all — not an empty line', () => {
    expect(schedulingText(en, undefined)).toBeNull();
  });
});

describe('qualificationText — the card lists what it CARRIES (2026-09-07)', () => {
  /**
   * The owner read his own Nextcloud card and asked for the obvious:
   *
   *     Can carry: Email ? · Calendar ✓ 1 calendar · Contacts ✓ 1 address
   *     book · Files ✓ 4 folders · Tasks ✓ 0 task lists — '?' is unmeasured
   *
   * Five faces, three marks, two units and a disclaimer, to say that a
   * Nextcloud carries four things. Marking what a connection is NOT costs the
   * reader more than it tells them, and the cost grows with every domain the
   * product adds. So the line is the names of the carried faces and nothing
   * else — no marks, because being on it IS the mark.
   */
  const q = (
    mail: 'yes' | 'no' | 'unknown',
    calendar: 'yes' | 'no' | 'unknown',
    contact: 'yes' | 'no' | 'unknown',
    file: 'yes' | 'no' | 'unknown',
    task: 'yes' | 'no' | 'unknown' = 'yes',
  ) => ({
    domains: {
      mail: { answer: mail, detail: 'd' },
      calendar: { answer: calendar, detail: 'd' },
      contact: { answer: contact, detail: 'd' },
      file: { answer: file, detail: 'd' },
      task: { answer: task, detail: 'd' },
    },
  });

  it('names only the carried faces, in the domain order, in the reader\'s language', () => {
    // The order is `DISCOVERY_DOMAINS`', so Tasks reads last — beside the
    // faces, in the sequence the wizard's own ticks use (0113 T5).
    expect(qualificationText(en, q('unknown', 'yes', 'yes', 'no', 'yes'))).toBe(
      'Carries: Calendar · Contacts · Tasks',
    );
    expect(qualificationText(nl, q('yes', 'yes', 'yes', 'yes', 'yes'))).toBe(
      'Draagt: E-mail · Agenda · Contacten · Bestanden · Taken',
    );
  });

  it('carries no marks and no disclaimer, whatever else the record holds', () => {
    // The three marks and the hint were the line's whole vocabulary for a
    // year. A face that is not a yes is simply absent now, so none of them
    // has anything left to say.
    const line = qualificationText(en, q('unknown', 'yes', 'no', 'yes', 'unknown'))!;
    for (const gone of ['?', '✗', '✓', 'unmeasured']) {
      expect(line, `the carry line still renders "${gone}"`).not.toContain(gone);
    }
  });

  it('the owner\'s Nextcloud card, as it will now read', () => {
    // Email unmeasured because the row carries no mail server address; the
    // other four answered. One line, four words, no argument.
    expect(
      qualificationText(en, {
        domains: {
          mail: { answer: 'unknown' as const, reason: 'notAskable' as const, detail: 'no mail server address' },
          calendar: { answer: 'yes' as const, detail: 'x', count: 1, unit: 'calendar' as const },
          contact: { answer: 'yes' as const, detail: 'x', count: 1, unit: 'addressBook' as const },
          file: { answer: 'yes' as const, detail: 'x', count: 4, unit: 'folder' as const },
          task: { answer: 'yes' as const, detail: 'x', count: 0, unit: 'taskList' as const },
        },
      }),
    ).toBe('Carries: Calendar · Contacts · Files · Tasks');
  });

  it('a record written before the fifth face leaves it off, never crashes', () => {
    // THE ROW EVERY EXISTING CONNECTION HAS. Qualifications stored before
    // 2026-09-03 carry four faces; the browser reads them until each
    // connection is tested again. An absent face is unmeasured, and unmeasured
    // is not carried — so it is simply not on the line.
    const beforeTasks = {
      domains: {
        mail: { answer: 'yes' as const, detail: 'd' },
        calendar: { answer: 'yes' as const, detail: 'd' },
        contact: { answer: 'yes' as const, detail: 'd' },
        file: { answer: 'yes' as const, detail: 'd' },
      },
    };
    expect(qualificationText(en, beforeTasks)).toBe('Carries: Email · Calendar · Contacts · Files');
    // Nothing to explain for a face nobody measured — a bare "Tasks:" would
    // promise evidence that does not exist.
    expect(qualificationEvidence(en, beforeTasks)).toEqual([]);
  });

  it('a connection that carries nothing renders no lead at all', () => {
    // Rather than "Carries:" followed by silence. The evidence lines below
    // still speak wherever they have something to say.
    expect(qualificationText(en, q('no', 'no', 'no', 'no', 'no'))).toBeNull();
    expect(qualificationText(en, undefined)).toBeNull();
  });
});

describe('qualificationEvidence — only the sentences a person can act on (2026-09-07)', () => {
  const GOOGLE_403 =
    'The grant carries https://www.googleapis.com/auth/carddav, but the face did not answer: ' +
    'PROPFIND failed with status 403: accessNotConfigured — Google Contacts CardDAV API has not ' +
    'been used in project 123 before or it is disabled.';

  const face = (answer: 'no' | 'unknown', reason: string | undefined, detail: string) =>
    ({ answer, ...(reason ? { reason: reason as never } : {}), detail });

  it('a refused face speaks — its sentence IS the remedy', () => {
    const mixed = {
      domains: {
        mail: { answer: 'yes' as const, detail: '29 folders visible.' },
        calendar: { answer: 'yes' as const, detail: '5 calendars visible.' },
        contact: face('unknown', 'refused', GOOGLE_403),
        file: face('no', 'notGranted', 'The grant does not carry drive.readonly — re-consent.'),
      },
    };
    expect(qualificationEvidence(en, mixed)).toEqual([`Contacts: ${GOOGLE_403}`]);
    expect(qualificationEvidence(nl, mixed)).toEqual([`Contacten: ${GOOGLE_403}`]);
  });

  it('an incomplete face speaks too — the sentence names the field to fill', () => {
    // A Soverin account HAS a mailbox and this row is one `mailHost` short of
    // reaching it. Silence there is a dead end, which is why `incomplete` is
    // a reason of its own rather than a `notAskable`.
    const soverin = {
      domains: {
        mail: face('unknown', 'incomplete', 'This account stores no mail server address — add mailHost.'),
        calendar: { answer: 'yes' as const, detail: 'x' },
      },
    };
    expect(qualificationEvidence(en, soverin)).toEqual([
      'Email: This account stores no mail server address — add mailHost.',
    ]);
  });

  it('says nothing about a face this kind never had, or one nobody ticked', () => {
    // THE OWNER'S TWO INSTRUCTIONS, as one assertion.
    //
    // `structural`: the front door said what a Dropbox carries before the
    // connection existed; four lines repeating it under every card is noise
    // that grows with the domain list.
    //
    // `notAskable`: this row cannot express that face at all — the Nextcloud
    // card's three lines about a mail server nobody named.
    //
    // `notGranted`: *"I don't want to tell people they already know by not
    // ticking a grant-to-request."* Sound as well as kind — the consent door
    // refuses to store a partial grant, so an ungranted face is one nobody
    // asked for.
    const quiet = {
      domains: {
        mail: face('unknown', 'notAskable', 'This connection carries no mail server address.'),
        calendar: face('no', 'structural', 'A Dropbox carries files only; a calendar is not a face of this connection.'),
        contact: face('no', 'notGranted', 'The consent did not include Contacts.Read.'),
        file: { answer: 'yes' as const, detail: 'x' },
      },
    };
    expect(qualificationEvidence(en, quiet)).toEqual([]);
  });

  it('a record with no reason still speaks, so an upgrade swallows nothing', () => {
    // Rows written before the reason existed. They keep the behaviour they
    // had until the next Test rewrites them — the alternative is a build that
    // silently drops the one sentence a person needed.
    const older = {
      domains: {
        contact: face('unknown', undefined, GOOGLE_403),
        file: { answer: 'yes' as const, detail: 'x' },
      },
    };
    expect(qualificationEvidence(en, older)).toEqual([`Contacts: ${GOOGLE_403}`]);
  });

  it('nothing to show when every face answered, and nothing for no record at all', () => {
    const measured = {
      domains: {
        mail: { answer: 'yes' as const, detail: 'x' },
        calendar: face('no', 'structural', 'x'),
        contact: { answer: 'yes' as const, detail: 'x' },
        file: face('no', 'structural', 'x'),
      },
    };
    expect(qualificationEvidence(en, measured)).toEqual([]);
    expect(qualificationEvidence(en, undefined)).toEqual([]);
  });
});

describe('measuredText — collections AND volume, on one line (2026-09-07)', () => {
  const measured = {
    domains: {
      mail: { answer: 'yes' as const, detail: 'x', volume: { items: 12400, bytes: 3_400_000_000, estimated: true } },
      calendar: { answer: 'yes' as const, detail: 'x' },
      contact: { answer: 'yes' as const, detail: 'x', volume: { items: 1 } },
      file: { answer: 'yes' as const, detail: 'x', volume: { bytes: 1_900_000_000, nativeFilesExcluded: true } },
    },
  };

  it('words counts and bytes in the reader\'s language, ≈ only where estimated, and leaves an unmeasured face off the line', () => {
    const line = measuredText(en, measured, 'en')!;
    expect(line).toBe(
      'Found: Email 12,400 messages, ≈ 3.2 GB · Contacts 1 card · Files 1.8 GB, (Docs, Sheets and Slides not counted)',
    );
    const dutch = measuredText(nl, measured, 'nl')!;
    expect(dutch).toContain('Gevonden:');
    expect(dutch).toContain('12.400 berichten');
    expect(dutch).toContain('1 kaart');
    expect(dutch).toContain('niet meegeteld');
  });

  it('says how many it could not read, beside the count and not instead of it (2026-09-07)', () => {
    // The owner read "Contacts ✓ 1 address book · 0 cards" on a live account
    // and could not tell an empty address book from one whose every card
    // failed to map. Both facts now reach the line.
    const partlyUnreadable = {
      domains: {
        mail: { answer: 'yes' as const, detail: 'x' },
        calendar: { answer: 'yes' as const, detail: 'x' },
        contact: { answer: 'yes' as const, detail: 'x', volume: { items: 0, unreadable: 25 } },
        file: { answer: 'yes' as const, detail: 'x' },
      },
    };

    expect(measuredText(en, partlyUnreadable, 'en')).toBe(
      'Found: Contacts 0 cards, 25 could not be read',
    );
    expect(measuredText(nl, partlyUnreadable, 'nl')).toContain('25 niet te lezen');
  });

  it('says nothing extra when every item read cleanly', () => {
    const clean = {
      domains: {
        mail: { answer: 'yes' as const, detail: 'x' },
        calendar: { answer: 'yes' as const, detail: 'x' },
        contact: { answer: 'yes' as const, detail: 'x', volume: { items: 12, unreadable: 0 } },
        file: { answer: 'yes' as const, detail: 'x' },
      },
    };

    expect(measuredText(en, clean, 'en')).toBe('Found: Contacts 12 cards');
  });

  it('carries the collection count beside the volume, and says so when a face holds none', () => {
    // THE OWNER'S SECOND ASK. The collection counts used to sit on the
    // capability line as evidence that the tick was real; on screen they read
    // as quantities, and quantities belong with quantities. A face appears
    // here once, with everything known about it.
    const nextcloud = {
      domains: {
        calendar: { answer: 'yes' as const, detail: 'x', count: 1, unit: 'calendar' as const },
        contact: { answer: 'yes' as const, detail: 'x', count: 1, unit: 'addressBook' as const },
        file: {
          answer: 'yes' as const,
          detail: 'x',
          count: 4,
          unit: 'folder' as const,
          volume: { bytes: 3_800_000_000 },
        },
        // "Tasks ✓ 0 task lists" read as a contradiction and was not one:
        // zero collections is a real answer and the protocol works.
        task: { answer: 'yes' as const, detail: 'x', count: 0, unit: 'taskList' as const },
      },
    };
    expect(measuredText(en, nextcloud, 'en')).toBe(
      'Found: Calendar 1 calendar · Contacts 1 address book · Files 4 folders, 3.5 GB · Tasks none',
    );
    expect(measuredText(nl, nextcloud, 'nl')).toContain('Taken geen');
  });

  it('leaves a face that is not carried off the line entirely', () => {
    // It is not on the capability line either, so a quantity here would be
    // the only place the card mentions it — which is the noise this pair of
    // changes exists to remove.
    const partial = {
      domains: {
        mail: { answer: 'unknown' as const, reason: 'notAskable' as const, detail: 'x', count: 9, unit: 'folder' as const },
        calendar: { answer: 'yes' as const, detail: 'x', count: 2, unit: 'calendar' as const },
      },
    };
    expect(measuredText(en, partial, 'en')).toBe('Found: Calendar 2 calendars');
  });

  it('with no measured face at all there is no line', () => {
    const bare = {
      domains: {
        mail: { answer: 'yes' as const, detail: 'x' },
        calendar: { answer: 'no' as const, detail: 'x' },
        contact: { answer: 'unknown' as const, detail: 'x' },
        file: { answer: 'yes' as const, detail: 'x' },
      },
    };
    expect(measuredText(en, bare)).toBeNull();
    expect(measuredText(en, undefined)).toBeNull();
  });
});

describe('a face that answered but could not be measured says why, on the line (2026-09-02)', () => {
  const half = {
    domains: {
      mail: { answer: 'yes' as const, detail: 'x', volume: { failed: 'FETCH timed out after 30 s' } },
      calendar: { answer: 'yes' as const, detail: 'x' },
      contact: { answer: 'yes' as const, detail: 'x', volume: { items: 3 } },
      file: { answer: 'yes' as const, detail: 'x', volume: { bytes: 1024 } },
    },
  };

  it('the Measured line leaves the failed face off, and the evidence lines carry its reason', () => {
    expect(measuredText(en, half)).toBe('Found: Contacts 3 cards · Files 1.0 KB');
    expect(qualificationEvidence(en, half)).toEqual(['Email — not measured: FETCH timed out after 30 s']);
    expect(qualificationEvidence(nl, half)).toEqual(['E-mail — niet gemeten: FETCH timed out after 30 s']);
  });
});
