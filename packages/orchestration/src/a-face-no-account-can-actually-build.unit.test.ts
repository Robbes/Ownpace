// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A FACE EVERY TABLE AGREES ON, AND NOTHING CAN BUILD.
 *
 * Workplan 0115 T4. There were already two guards standing either side of this
 * question, and the gap between them is where `apple` fell through:
 *
 *   `a-face-a-provider-account-cannot-build`  the face TABLE has a row
 *   `the-microsoft-account-row-builds-its-faces`  ONE kind's faces build
 *
 * The first checks a table against a table. The second checks reality — and
 * only for `microsoft`, because it was written the night `microsoft` needed
 * it. So `apple` arrived with every table agreeing, every guard green, a card
 * on the front door, a row the database would accept, and **not one of its
 * four faces able to build**:
 *
 *     calendar/contact  DAV connection config is missing url/baseUrl/host
 *     mail              buildDepsFromMapping only supports imap-oauth2,
 *                       graph-mail, gmail and google mail sources, got: apple
 *
 * That second sentence is VERBATIM the one 0114 T5a hit for `microsoft`. The
 * same defect, one provider later, found by hand again — which is the whole
 * argument for this file existing per KIND rather than per provider.
 *
 * ## Why it could not be caught by a table
 *
 * Because the missing thing was not a row. Apple's face table row is correct,
 * its domains are correct, its builders are correct. What it lacked was an
 * ENDPOINT — and the endpoint comes from the connection's stored config, which
 * for every other source is a host somebody typed. Apple's hosts are not a
 * customer choice, so nobody types them, so there was nothing there. No table
 * pairing can see that; only building can.
 *
 * ## The row each kind gets
 *
 * `PLAUSIBLE_ROW` below is a credential and config of the shape that kind's
 * own door actually saves. That is the honest input — a test that invented a
 * universal row would prove that a fiction builds. Getting a kind's shape
 * wrong here shows up as a failure, which is the right way round.
 *
 * ## What this asserts, and why "did not throw" is enough
 *
 * These builders construct a source object and a credential provider. They
 * reach no network until something asks them to list, so construction is
 * exactly the boundary this defect lived at — and reaching the network is what
 * Test and the gates are for, neither of which can run on credentials this
 * file has no business inventing.
 */

import { describe, it, expect } from 'vitest';
import {
  PROVIDER_ACCOUNT_KINDS,
  type ProviderAccountKind,
  type DiscoveryDomain,
} from '@openmig/shared';
import {
  buildCalendarSourceFromConnection,
  buildContactSourceFromConnection,
  buildFileSourceFromConnection,
  buildTaskSourceFromConnection,
  buildSourceConnectorFromCredentials,
  accountMailEndpoint,
} from './build-deps-from-mapping.ts';
import { everyFaceClaimedBy } from './source-face-builders.ts';

/** A stored row of each kind, in the shape that kind's own door saves. */
const PLAUSIBLE_ROW: Readonly<
  Record<ProviderAccountKind, { config: Record<string, unknown>; creds: Record<string, string> }>
> = {
  // A consent leaves a client pair and a refresh token; the address is the row's.
  google: {
    config: { user: 'someone@example.com' },
    creds: {
      clientId: 'google-client-id',
      // Google's builders require the SECRET as well; Microsoft's do not,
      // because a `microsoft` row may lean on the deployment's application
      // (ADR-0041) and Google's four kinds predate that. The asymmetry is real
      // and this table records it rather than smoothing it over — a row that
      // carried more than its door saves would prove that a fiction builds.
      clientSecret: 'google-client-secret',
      refreshToken: 'the-refresh-token',
    },
  },
  microsoft: {
    config: { user: 'someone@contoso.example' },
    creds: { clientId: 'entra-app-id', refreshToken: 'the-refresh-token' },
  },
  // A DAV account somebody typed: the host IS the config, which is exactly the
  // assumption `apple` broke.
  soverin: {
    config: { host: 'caldav.soverin.net', port: 443, mailHost: 'imap.soverin.net', mailPort: 993 },
    creds: { username: 'someone@soverin.net', password: 'the-password' },
  },
  // An address and an app-specific password. NOTHING else — no host, no port,
  // no client, no token. If this row ever grows a host, the thing this guard
  // exists to prove has stopped being true.
  apple: {
    config: { user: 'someone@icloud.com' },
    creds: { username: 'someone@icloud.com', password: 'abcd-efgh-ijkl-mnop' },
  },
};

/** Build one face of one row, the way a pass would. */
function buildFace(kind: ProviderAccountKind, domain: DiscoveryDomain): unknown {
  const row = PLAUSIBLE_ROW[kind];
  const src = { config: row.config, creds: row.creds, kind };
  switch (domain) {
    case 'email':
      return buildSourceConnectorFromCredentials(
        { type: kind, ...row.config } as never,
        row.creds,
      );
    case 'calendar':
      return buildCalendarSourceFromConnection(src);
    case 'contact':
      return buildContactSourceFromConnection(src);
    case 'task':
      return buildTaskSourceFromConnection(src);
    case 'file':
      return buildFileSourceFromConnection(src);
    default:
      throw new Error(`this guard has no builder for the '${domain}' face`);
  }
}

describe('every face a provider account claims can actually be built', () => {
  it('covers every account kind — this guard is not passing vacuously', () => {
    // The control, and it is the point: the previous version of this question
    // existed for ONE kind, so a new kind was born uncovered. Adding a kind
    // now adds its cases here automatically, and a kind with no claimed face
    // would be the only way to be silently exempt.
    expect(PROVIDER_ACCOUNT_KINDS.length).toBeGreaterThan(3);
    for (const kind of PROVIDER_ACCOUNT_KINDS) {
      expect(everyFaceClaimedBy(kind).length, `${kind} claims no faces at all`).toBeGreaterThan(0);
    }
  });

  for (const kind of PROVIDER_ACCOUNT_KINDS) {
    for (const domain of everyFaceClaimedBy(kind)) {
      it(`${kind} builds its ${domain} face`, () => {
        expect(
          () => buildFace(kind, domain),
          `PROVIDER_ACCOUNT_DOMAINS says a '${kind}' account serves '${domain}', and building ` +
            'that face from a stored row of this kind throws. Every table can agree and this ' +
            'still fail — the endpoint, the credential shape or the builder is missing, and the ' +
            'refusal arrives INSIDE A SYNC PASS rather than at the door',
        ).not.toThrow();
      });
    }
  }
});

describe("a face a kind does not claim is refused, not guessed", () => {
  it('refuses the file face on apple by name rather than inventing one', () => {
    // The other direction, and Apple is the case that matters: iCloud Drive
    // has no third-party API at all, so a `file` face must REFUSE rather than
    // fall through to DAV and produce a source that lists nothing. A silent
    // empty listing is how "the migration carried no files" gets reported as
    // success.
    expect(() => buildFace('apple', 'file')).toThrow();
  });
});

describe('an account kind\'s mail face connects to its MAIL host', () => {
  // "Did not throw" cannot see this one. A mail source aimed at a DAV host
  // builds perfectly and fails at connect, with a message about the wrong
  // server — so the rule is asserted rather than observed.
  it('prefers the stored mailHost over the row\'s DAV host', () => {
    expect(
      accountMailEndpoint('soverin', {
        host: 'caldav.soverin.net',
        port: 443,
        mailHost: 'imap.soverin.net',
        mailPort: 993,
      }),
      'a soverin row holds a DAV host and an IMAP host; the mail face must take the IMAP one',
    ).toEqual({ host: 'imap.soverin.net', port: 993 });
  });

  it('falls back to the published endpoint when the row stores no host at all', () => {
    // Apple: nobody types these, so the row carries none.
    expect(accountMailEndpoint('apple', { user: 'someone@icloud.com' })).toEqual({
      host: 'imap.mail.me.com',
      port: 993,
    });
  });

  it('lets a stored mailHost beat even a published endpoint', () => {
    // The published value is where to look, never an override: a customer who
    // somehow needs a different address keeps being able to say so.
    expect(accountMailEndpoint('apple', { mailHost: 'imap.example.test', mailPort: 1993 })).toEqual(
      { host: 'imap.example.test', port: 1993 },
    );
  });

  it('refuses by name when there is no host anywhere', () => {
    expect(() => accountMailEndpoint('soverin', {})).toThrow(/mailHost/);
  });
});
