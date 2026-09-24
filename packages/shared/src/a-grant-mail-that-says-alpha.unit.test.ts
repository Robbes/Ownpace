// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A GRANT MAIL THAT SAYS ALPHA (workplan 0131 T1).
 *
 * The access-granted mail is the first thing a tester reads from the service,
 * before any page. During the alpha it says what the pages say: a small invited
 * group, nothing charged, nothing backed up, an alpha that can end, and keep
 * the old account until what arrived has been checked. In the language the
 * request was made in (ADR-0013).
 *
 * Off unless the deployment sets it. The API reads `OWNPACE_STAGE` and marks
 * the event (`accessGrantedEvent` in `apps/api/src/access-notify.ts`); this
 * file is about what the mail then says, and that a mail without the mark says
 * nothing about an alpha at all. The pages' half, and the check that the mail
 * and the note carry the same words, is
 * `apps/web/src/components/an-alpha-said-out-loud.unit.test.tsx`.
 */

import { describe, it, expect } from 'vitest';
import { renderEvent } from './notifications.ts';

const GRANTED = {
  kind: 'access_granted',
  organisation: 'Familie de Vries',
  appUrl: 'https://app.ownpace.eu',
  email: 'stranger@example.test',
} as const;

/** The note's words, 0131 T1's draft; they must match 0139's conditions once those exist. */
const SAID = {
  en:
    'Alpha: a small invited group is trying this service out. Nothing is charged, nothing is ' +
    'backed up, and the alpha can end. Keep your old account until you have checked what arrived.',
  nl:
    'Alfa: een kleine, uitgenodigde groep probeert deze dienst uit. Niets wordt in rekening ' +
    'gebracht, er worden geen back-ups gemaakt en de alfa kan stoppen. Houd uw oude account tot ' +
    'u hebt gecontroleerd wat er is aangekomen.',
} as const;

describe('the access-granted mail during the alpha', () => {
  it.each(['en', 'nl'] as const)('says it is an alpha, in %s', (locale) => {
    const { body } = renderEvent({ ...GRANTED, alpha: true }, locale);
    expect(body).toContain(SAID[locale]);
  });

  it.each(['en', 'nl'] as const)('says it once, as one paragraph of its own, in %s', (locale) => {
    const { body } = renderEvent({ ...GRANTED, alpha: true }, locale);
    expect(body.split(SAID[locale])).toHaveLength(2);
    expect(body.split('\n\n')).toContain(SAID[locale]);
  });

  it('keeps everything the mail said before', () => {
    // The paragraph is added, never swapped for a line the tester needs: where
    // to sign in, and which address the access is tied to.
    for (const locale of ['en', 'nl'] as const) {
      const plain = renderEvent(GRANTED, locale).body;
      const alpha = renderEvent({ ...GRANTED, alpha: true }, locale).body;
      for (const line of plain.split('\n')) expect(alpha).toContain(line);
      expect(renderEvent({ ...GRANTED, alpha: true }, locale).subject).toBe(
        renderEvent(GRANTED, locale).subject,
      );
    }
  });
});

describe('the access-granted mail outside the alpha', () => {
  it.each(['en', 'nl'] as const)('says nothing about an alpha, in %s', (locale) => {
    for (const event of [GRANTED, { ...GRANTED, alpha: false }]) {
      const { body } = renderEvent(event, locale);
      expect(body).not.toMatch(/\balpha\b|\balfa\b/i);
      expect(body).not.toContain(SAID[locale]);
    }
  });
});
