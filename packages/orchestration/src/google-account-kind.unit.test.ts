// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The `google` ACCOUNT kind reaches the builders (workplan 0106 T3b).
 *
 * #640 made `google` a connection kind and put its faces in one table. Nothing
 * read that table on the way to a SOURCE, so a `google` row would have gone
 * down the generic DAV branch — `buildCalendarSource(davEndpointFromCreds(…))`
 * — and asked for a host and password that a Google account does not have. The
 * failure would have arrived inside a pass, as a credential error naming
 * fields nobody typed, which is the #597 shape exactly.
 *
 * Three seams had to learn the kind, and each is asserted here:
 *
 *  - the source builders, through `googleDavServes`;
 *  - the connection PROBE, so Test says something true rather than "no probe
 *    exists for a 'google' source connection";
 *  - the grant qualification, so an account row's faces are MEASURED. That one
 *    matters most: a single-purpose row's grant is one scope and the answer is
 *    nearly rhetorical, while an account row is where "you ticked two and
 *    Google gave one" becomes visible at all.
 *
 * Read off `PROVIDER_ACCOUNT_DOMAINS` rather than listed here, so Google
 * gaining mail when the restricted-scope assessment is bought stays one row
 * edit — the whole reason T3b is provider-shaped rather than Google-shaped.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROVIDER_ACCOUNT_DOMAINS } from '@openmig/shared';
import {
  GOOGLE_ACCOUNT_CONNECTION_KIND,
  GOOGLE_CALENDAR_CONNECTION_KIND,
  GOOGLE_CONTACTS_CONNECTION_KIND,
  googleDavServes,
} from './google-dav-source-factory.ts';
import { probeSourceConnection } from './probe-connection.ts';
import { isGoogleGrantKind } from './account-qualification.ts';

describe('googleDavServes reads the table, and there is no fork', () => {
  it('serves exactly the faces PROVIDER_ACCOUNT_DOMAINS.google names', () => {
    for (const domain of ['calendar', 'contact'] as const) {
      expect(
        googleDavServes(GOOGLE_ACCOUNT_CONNECTION_KIND, domain),
        `the account kind should ${PROVIDER_ACCOUNT_DOMAINS.google.includes(domain) ? '' : 'not '}serve ${domain}`,
      ).toBe(PROVIDER_ACCOUNT_DOMAINS.google.includes(domain));
    }
  });

  it('leaves the single-purpose kinds answering only for themselves', () => {
    // Cohabitation, in the owner's own word: the account kind does not
    // capture a `google_calendar` row's contact face, and a mapping created
    // before today keeps behaving exactly as it did.
    expect(googleDavServes(GOOGLE_CALENDAR_CONNECTION_KIND, 'calendar')).toBe(true);
    expect(googleDavServes(GOOGLE_CALENDAR_CONNECTION_KIND, 'contact')).toBe(false);
    expect(googleDavServes(GOOGLE_CONTACTS_CONNECTION_KIND, 'contact')).toBe(true);
    expect(googleDavServes(GOOGLE_CONTACTS_CONNECTION_KIND, 'calendar')).toBe(false);
  });

  it('says no to a kind that is not Google at all', () => {
    // The generic DAV branch must keep every ordinary caldav/carddav row.
    for (const kind of ['caldav', 'carddav', 'soverin', 'nextcloud', 'imap']) {
      expect(googleDavServes(kind, 'calendar')).toBe(false);
      expect(googleDavServes(kind, 'contact')).toBe(false);
    }
  });
});

describe('the probe answers for the account kind', () => {
  it('refuses in the Google CALENDAR builder’s words, not with a wiring gap', async () => {
    // Before this slice the answer was "No probe exists for a 'google' source
    // connection. This is a wiring gap" — true, and useless to somebody who
    // just pressed Test on a connection the product offered them.
    const result = await probeSourceConnection(
      GOOGLE_ACCOUNT_CONNECTION_KIND,
      { user: 'someone@example.invalid' },
      { clientId: 'cid' },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).not.toContain('wiring gap');
      // The calendar face is the headline, the same choice `soverin` made:
      // it is the face the scheduling verdict belongs to, and a headline
      // probe has to pick one.
      expect(result.reason).toContain('auth/calendar');
      // ...and it is the STORED vocabulary, because a managed row's
      // credentials are on the connection, not in anybody's environment.
      expect(result.reason).toContain("connection's stored credentials");
    }
  });
});

describe('the grant qualification covers the account kind', () => {
  it('treats `google` as grant-qualified', () => {
    expect(isGoogleGrantKind(GOOGLE_ACCOUNT_CONNECTION_KIND)).toBe(true);
  });

  it('still treats the single-purpose kinds as grant-qualified', () => {
    for (const kind of ['gmail', 'google_calendar', 'google_contacts', 'google_drive']) {
      expect(isGoogleGrantKind(kind)).toBe(true);
    }
  });

  it('does not sweep in the Basic-auth account kinds', () => {
    // They qualify by PROBE, not by grant (0106's "two ways an account
    // qualifies"). Confusing the two would exchange a refresh token that
    // does not exist.
    for (const kind of ['soverin', 'nextcloud', 'caldav', 'imap']) {
      expect(isGoogleGrantKind(kind)).toBe(false);
    }
  });
});

describe('the SEAMS read the predicate, not a kind literal', () => {
  // The lesson this repo keeps relearning: a decision function fully green
  // while the caller ignores it. `buildDepsFromMapping` needs a real Pool and
  // a real database, so it is exercised in the integration lane rather than
  // here — which would leave the one line that matters unasserted overnight.
  //
  // So the SOURCE is read. Both Google DAV branches must go through
  // `googleDavServes`, and neither may compare `src.kind` to a literal Google
  // kind — because a comparison that reappeared would silently exclude the
  // account row again, and the symptom would be a credential error naming
  // fields nobody typed, arriving inside a pass.
  const seams = readFileSync(
    join(import.meta.dirname, 'build-deps-from-mapping.ts'),
    'utf-8',
  );

  it('routes both Google DAV faces through googleDavServes', () => {
    expect(seams).toContain("googleDavServes(src.kind, 'calendar')");
    expect(seams).toContain("googleDavServes(src.kind, 'contact')");
  });

  it('compares no kind to a Google DAV literal', () => {
    // Not a style rule. `src.kind === GOOGLE_CALENDAR_CONNECTION_KIND` is
    // exactly what was there before, and it is what a later edit would most
    // naturally write back.
    for (const literal of [
      'GOOGLE_CALENDAR_CONNECTION_KIND',
      'GOOGLE_CONTACTS_CONNECTION_KIND',
      'GOOGLE_ACCOUNT_CONNECTION_KIND',
    ]) {
      expect(
        new RegExp(`src\\.kind\\s*===\\s*${literal}`).test(seams),
        `${literal} is compared directly — the account row would be excluded again`,
      ).toBe(false);
    }
  });
});
