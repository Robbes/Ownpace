// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE FOUR FACES A MICROSOFT ROW ADVERTISES, BUILT FROM STORED CREDENTIALS.
 *
 * Workplan 0114 T5a. `PROVIDER_ACCOUNT_DOMAINS.microsoft` has claimed mail,
 * calendar, contacts and files since T3. **None of the four could be built
 * from a stored connection**, and they failed in two different ways.
 *
 * THREE OF THEM FELL THROUGH. The Graph calendar, contacts and OneDrive
 * sources existed and were wired only in `build-deps.ts`, the appliance's
 * path, from `OAUTH2_*` environment variables. The managed seams asked
 * two-way questions — `googleDavServes(kind, …) ? Google : DAV` and
 * `dropbox / box / Drive / DAV` — so a `microsoft` row took the last branch
 * every time, reached `davEndpointFromCreds`, and was refused for a username
 * and password. **An OAuth provider has neither**, and the refusal arrived
 * inside a sync pass rather than at build time.
 *
 * THE FOURTH REFUSED OUTRIGHT. Mail does not go through those seams: it goes
 * through `buildSourceConnectorFromCredentials`, which switches on the CONFIG
 * TYPE rather than the connection kind, and answered *"only supports
 * imap-oauth2, graph-mail, gmail and google mail sources, got: microsoft"*.
 * That one was found by writing this file — the face table already said
 * `microsoft.email → graph-mail` and the seam did not read it, which is the
 * same defect one level up. The seam asks the table now.
 *
 * The companion guard,
 * `scripts/a-face-a-provider-account-cannot-build.unit.test.ts`, pins the
 * TABLE in both directions. This file pins the other half: that the seams
 * actually read it, and that what comes back is a Graph source rather than a
 * plausible-looking refusal.
 *
 * ## Why "did not throw" is the assertion
 *
 * These builders construct a token provider and a source object. They reach no
 * network until something asks them to list, so construction is exactly the
 * boundary worth testing here — and it is the boundary where the old behaviour
 * failed. What the sources then DO belongs to the connector tests and to the
 * managed gate, neither of which can run without credentials this file has no
 * business inventing.
 */

import { describe, it, expect } from 'vitest';
import {
  buildCalendarSourceFromConnection,
  buildContactSourceFromConnection,
  buildFileSourceFromConnection,
  buildSourceConnectorFromCredentials,
  buildTaskSourceFromConnection,
} from './build-deps-from-mapping.ts';
import { sourceFaceBuilder } from './source-face-builders.ts';

/** A grant as the consent leaves it: the pair, the refresh token, no password. */
const GRANTED = { clientId: 'entra-app-id', refreshToken: 'the-refresh-token' };
/** What a `microsoft` account row's config carries — an address and nothing to resolve. */
const ROW = { user: 'someone@contoso.example' };

const microsoft = (creds: Record<string, string> = GRANTED) => ({
  config: ROW as Record<string, unknown>,
  creds,
  kind: 'microsoft',
});

describe('a microsoft account row builds all five of its faces', () => {
  it('builds the mail face rather than refusing the source type', () => {
    // The FOURTH face, and the one that fails differently from the other
    // three. Mail does not go through the DAV fall-through — it goes through
    // `buildSourceConnectorFromCredentials`, which switches on the CONFIG
    // TYPE rather than the connection kind, and answered
    // "buildDepsFromMapping only supports imap-oauth2, graph-mail, gmail and
    // google mail sources, got: microsoft".
    //
    // Worth its own test for a reason beyond coverage: the face table claimed
    // `microsoft.email → graph-mail` before this seam honoured it. A table
    // whose rows nothing reads is the same defect one level up, so the seam
    // asks the table rather than comparing to a literal.
    expect(() =>
      buildSourceConnectorFromCredentials(
        { type: 'microsoft', user: 'someone@contoso.example' },
        GRANTED,
      ),
    ).not.toThrow();
  });

  it('builds the calendar face rather than asking for a DAV password', () => {
    expect(() => buildCalendarSourceFromConnection(microsoft())).not.toThrow();
  });

  it('builds the contact face', () => {
    expect(() => buildContactSourceFromConnection(microsoft())).not.toThrow();
  });

  it('builds the file face', () => {
    expect(() => buildFileSourceFromConnection(microsoft())).not.toThrow();
  });

  it('builds the task face — Microsoft To Do, the fifth (0114 T9)', () => {
    // The one task face that is not a CalDAV collection. Before T9 this seam
    // answered `dav` or refused; a Microsoft row reaching it now gets the
    // Graph To Do source, built from the same registration as its siblings.
    expect(() => buildTaskSourceFromConnection(microsoft())).not.toThrow();
  });

  it('resolves every face to a Graph builder, never to a protocol one', () => {
    expect(sourceFaceBuilder('microsoft', 'email')).toBe('graph-mail');
    expect(sourceFaceBuilder('microsoft', 'calendar')).toBe('graph-calendar');
    expect(sourceFaceBuilder('microsoft', 'contact')).toBe('graph-contacts');
    expect(sourceFaceBuilder('microsoft', 'file')).toBe('graph-drive');
    expect(sourceFaceBuilder('microsoft', 'task')).toBe('graph-todo');
  });
});

describe('the refusals speak the managed vocabulary', () => {
  /**
   * Hard rule 5's edge: both editions refuse for the same reasons, and NOT in
   * the same words. `OAUTH2_CLIENT_ID` is a variable a managed operator cannot
   * set — they edit a connection's credentials. The mail face had this fixed
   * already (`buildGraphMailSourceFromCredentials` says so in its own
   * comment); the other three had no managed caller to fix it for.
   */
  const refusalFor = (build: () => unknown): string => {
    try {
      build();
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
    return '';
  };

  it('names the stored clientId, not OAUTH2_CLIENT_ID', () => {
    for (const build of [
      () => buildCalendarSourceFromConnection(microsoft({})),
      () => buildContactSourceFromConnection(microsoft({})),
      () => buildFileSourceFromConnection(microsoft({})),
      () => buildTaskSourceFromConnection(microsoft({})),
    ]) {
      const reason = refusalFor(build);
      expect(reason, 'a row with no credentials built anyway').not.toBe('');
      expect(reason).toContain('clientId');
      expect(reason).not.toContain('OAUTH2_CLIENT_ID');
    }
  });

  it('names the stored fields on the mail face too', () => {
    const reason = refusalFor(() =>
      buildSourceConnectorFromCredentials({ type: 'microsoft', user: 'someone@contoso.example' }, {}),
    );
    expect(reason).toContain('clientId');
    expect(reason).not.toContain('OAUTH2_CLIENT_ID');
  });

  it('names the stored refreshToken when neither flow was chosen', () => {
    const reason = refusalFor(() =>
      buildCalendarSourceFromConnection(microsoft({ clientId: 'entra-app-id' })),
    );
    expect(reason).toContain('refreshToken');
    expect(reason).not.toContain('OAUTH2_REFRESH_TOKEN');
  });
});

describe('the other providers keep the builders they had', () => {
  // The regression this change could most easily cause: a seam rewritten
  // around a table that quietly re-aims an existing row. Every one of these
  // was already working before 0114 and must still resolve the same way.
  it('leaves Google, Dropbox, Box and the protocol rows where they were', () => {
    expect(sourceFaceBuilder('google', 'calendar')).toBe('google-dav');
    expect(sourceFaceBuilder('google', 'file')).toBe('google-drive');
    expect(sourceFaceBuilder('google_calendar', 'calendar')).toBe('google-dav');
    expect(sourceFaceBuilder('google_contacts', 'contact')).toBe('google-dav');
    expect(sourceFaceBuilder('google_drive', 'file')).toBe('google-drive');
    expect(sourceFaceBuilder('dropbox', 'file')).toBe('dropbox');
    expect(sourceFaceBuilder('box', 'file')).toBe('box');
    expect(sourceFaceBuilder('caldav', 'calendar')).toBe('dav');
    expect(sourceFaceBuilder('carddav', 'contact')).toBe('dav');
    expect(sourceFaceBuilder('webdav', 'file')).toBe('dav');
  });

  it('leaves the soverin account on DAV and IMAP, which is its own shape', () => {
    // Not a fall-through: Soverin publishes a DAV root and an IMAP host, and
    // its rows carry a password to use them with (0106 T4a/T4b).
    expect(sourceFaceBuilder('soverin', 'calendar')).toBe('dav');
    expect(sourceFaceBuilder('soverin', 'contact')).toBe('dav');
    expect(sourceFaceBuilder('soverin', 'task')).toBe('dav');
    expect(sourceFaceBuilder('soverin', 'email')).toBe('imap');
  });
});
