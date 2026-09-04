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
 *  - the source builders, through the face table (`sourceFaceBuilder`, 0114
 *    T5a — it was `googleDavServes` until Microsoft became the third provider
 *    and a two-way condition stopped being enough);
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
} from './google-dav-source-factory.ts';
import { sourceFaceBuilder } from './source-face-builders.ts';
import { buildSourceConnectorFromCredentials } from './build-deps-from-mapping.ts';

/**
 * The seam file, read as text.
 *
 * Module scope because two describes now read it: the DAV/file dispatch and
 * the byte meter. One read, one fact.
 */
const seams = readFileSync(join(import.meta.dirname, 'build-deps-from-mapping.ts'), 'utf-8');
import { probeSourceConnection } from './probe-connection.ts';
import { isGoogleGrantKind } from './account-qualification.ts';

describe('the face table answers for the google account, and there is no fork', () => {
  it('gives every face PROVIDER_ACCOUNT_DOMAINS.google names a Google builder', () => {
    for (const domain of PROVIDER_ACCOUNT_DOMAINS.google) {
      expect(
        sourceFaceBuilder(GOOGLE_ACCOUNT_CONNECTION_KIND, domain),
        `the account kind claims ${domain} and must not fall through to a protocol builder`,
      ).toMatch(/^(gmail|google-)/);
    }
  });

  it('leaves the single-purpose kinds answering only for themselves', () => {
    // Cohabitation, in the owner's own word: the account kind does not
    // capture a `google_calendar` row's contact face, and a mapping created
    // before today keeps behaving exactly as it did.
    expect(sourceFaceBuilder(GOOGLE_CALENDAR_CONNECTION_KIND, 'calendar')).toBe('google-dav');
    expect(sourceFaceBuilder(GOOGLE_CALENDAR_CONNECTION_KIND, 'contact')).toBe('dav');
    expect(sourceFaceBuilder(GOOGLE_CONTACTS_CONNECTION_KIND, 'contact')).toBe('google-dav');
    expect(sourceFaceBuilder(GOOGLE_CONTACTS_CONNECTION_KIND, 'calendar')).toBe('dav');
  });

  it('says no to a kind that is not Google at all', () => {
    // The generic DAV branch must keep every ordinary caldav/carddav row.
    for (const kind of ['caldav', 'carddav', 'soverin', 'nextcloud', 'imap']) {
      expect(sourceFaceBuilder(kind, 'calendar')).toBe('dav');
      expect(sourceFaceBuilder(kind, 'contact')).toBe('dav');
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

  it('routes both DAV faces through the face table', () => {
    expect(seams).toContain("sourceFaceBuilder(src.kind, 'calendar')");
    expect(seams).toContain("sourceFaceBuilder(src.kind, 'contact')");
  });

  it('routes the FILE face through the face table', () => {
    // The same seam rule, one face later. The account row's file face is
    // Drive, reached with the same OAuth trio under the same stored names —
    // and a `src.kind === GOOGLE_DRIVE_CONNECTION_KIND` here is what would
    // exclude it again.
    expect(seams).toContain("sourceFaceBuilder(src.kind, 'file')");
  });

  it('compares no kind to a Google DRIVE literal in the file seam either', () => {
    expect(
      /src\.kind\s*===\s*GOOGLE_DRIVE_CONNECTION_KIND/.test(seams),
      'the Drive kind is compared directly — the account row loses its file face',
    ).toBe(false);
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

describe('the account row wears its mail and file faces too', () => {
  /**
   * ONE ACCOUNT, FOUR FACES — the half that was unreachable.
   *
   * `GOOGLE_ACCOUNT_SCOPE_CLASS` let a deployment declare that its own Google
   * application carries the restricted scopes, and the consent route built a
   * four-scope ask the same afternoon. Nothing downstream knew: a mapping with
   * `email` on a `google` source would have reached
   * `buildSourceConnectorFromCredentials` and been told *"only supports
   * imap-oauth2, graph-mail and gmail mail sources, got: google"* — inside a
   * pass, weeks after the grant was approved.
   *
   * A grant that works and a migration that cannot use it is the worse half of
   * a half-built feature, because the consent screen already said yes.
   */
  it('builds the mail face with the Gmail builder, not a refusal', () => {
    // Missing credentials on purpose: what is asserted is WHICH builder spoke.
    // A Gmail refusal naming the stored credential fields means the branch was
    // reached; the old sentence about unsupported source types means it was
    // not. No network either way.
    let reason = '';
    try {
      buildSourceConnectorFromCredentials({ type: 'google', user: 'someone@example.invalid' }, {});
    } catch (err) {
      reason = err instanceof Error ? err.message : String(err);
    }
    expect(reason, 'the google account never reached a mail builder').not.toBe('');
    expect(reason).not.toContain('only supports');
    expect(reason).toContain("connection's stored credentials");
  });

  it('builds the file face with the Drive builder', () => {
    expect(sourceFaceBuilder(GOOGLE_ACCOUNT_CONNECTION_KIND, 'file')).toBe('google-drive');
    expect(sourceFaceBuilder('google_drive', 'file')).toBe('google-drive');
  });

  it('leaves the file face of everything else alone', () => {
    // Dropbox and Box have their own builders in the same seam, and a
    // predicate that swept them in would aim a Google client at a Dropbox row.
    for (const kind of ['dropbox', 'box', 'webdav', 'nextcloud', 'gmail', 'google_calendar']) {
      expect(
        sourceFaceBuilder(kind, 'file'),
        `${kind} must not take the Drive builder`,
      ).not.toBe('google-drive');
    }
  });

  it("meters the account's mail face against Gmail's own ceiling", () => {
    // 0090's daily download ceiling belongs to Google's IMAP endpoint, not to
    // the row shape that reached it. Leaving `google` out of the host
    // resolution would have been the quiet version of this change: a mail
    // migration that works, spends against no budget, and gets the account
    // locked out exactly where the single-purpose kind refuses first.
    const host = seams.slice(seams.indexOf('const imapHost ='), seams.indexOf('const downloadPlan'));
    expect(host).toContain("mappingConfig.source.type === 'google'");
    expect(host).toContain("'imap.gmail.com'");
  });
});
