// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A GRANT MAIL THAT SAYS ALPHA (workplan 0131 T1).
 *
 * The access-granted mail is the first thing a tester reads from the service,
 * before any page. During the Alpha its paragraph opens with the pages'
 * welcome, the owner's own words (0131 D4's amendment, 2026-10-04), and then
 * says what the Alpha means: nothing charged, an Alpha that can end, no
 * backups apart from one copy before each update, kept up to 7 days, and keep
 * the old account until what arrived has been checked. The note on the pages
 * no longer says those facts (the owner: *"Welcome only"*), so the mail keeps
 * them word for word (*"Welcome, then the facts"*). In the language the
 * request was made in (ADR-0013).
 *
 * Off unless the deployment sets it. The API reads `OWNPACE_STAGE` and marks
 * the event (`accessGrantedEvent` in `apps/api/src/access-notify.ts`); this
 * file is about what the mail then says, and that a mail without the mark says
 * nothing about an alpha at all. The pages' half, and the check that the mail
 * opens with the note's own words, is
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

/**
 * The owner's welcome (2026-10-04), then the facts as 0131 T1 said them, with
 * the copy before an update since 0139 T4 (ops-app-sentences (a)), as the
 * Alpha conditions §6 and privacy §9 say it.
 */
const SAID = {
  en:
    'Welcome to the Alpha! Try Ownpace at your own pace, and help others move to European ' +
    'alternatives more easily. Nothing is charged, and the Alpha can end. There are no backups, ' +
    'apart from one copy before each update, kept up to 7 days. Keep your old account until you ' +
    'have checked what arrived.',
  nl:
    'Welkom bij de Alpha! Probeer Ownpace rustig aan uit, en help anderen makkelijker over te ' +
    'stappen naar Europese alternatieven. Er wordt niets in rekening gebracht en de Alpha kan ' +
    'stoppen. Er worden geen back-ups gemaakt, op één kopie vlak voor elke update na, die ' +
    'hoogstens 7 dagen wordt bewaard. Houd uw oude account tot u hebt gecontroleerd wat er is ' +
    'aangekomen.',
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
