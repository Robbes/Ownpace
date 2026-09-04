// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN ACCOUNT ROW STORED AS A PRODUCT IT IS NOT.
 *
 * Workplan 0115 T9. `sourceConnectionConfig` is the fourteenth table a
 * provider account kind has to appear in, and until now **two of the four
 * were missing from it** — silently, because the function ends in a
 * catch-all rather than a refusal.
 *
 * `google` had a branch. `microsoft` (0114) and `apple` (0115) did not, so
 * both fell through to the Azure default and every connection either kind
 * ever created was stored as
 *
 *     { type: 'imap-oauth2', host: undefined, tls: true, useSsl: true }
 *
 * — an O365 IMAP+XOAUTH2 mail source. For `microsoft`, whose four faces are
 * Graph builders. For `apple`, whose faces are DAV and IMAP against Apple's
 * published hosts. With no host, no tenant and no client id, because an
 * account row has none of those to give.
 *
 * ## Why nothing went red
 *
 * Because nothing on the run path reads it. `sourceFaceBuilder` branches on
 * the connection's KIND, and `davUrl` reads `url`/`baseUrl`/`host` and falls
 * back to the published root — so an Apple migration would have worked, and
 * the wrong `type` sat in the JSONB being wrong at nobody.
 *
 * That is the whole shape of this defect family: **a value only one surface
 * reads is a value no test asserts.** The surfaces that do read it are the GET
 * detail route, which echoes this object so the row identifies itself, and the
 * rotate panel, which prefills from it. Both showed an Apple account calling
 * itself an O365 mailbox.
 *
 * ## What this holds, and why it is a loop rather than three cases
 *
 * Every `ProviderAccountKind` — not the three that exist today. A fifth
 * account kind added next month gets this assertion for free, which is the
 * only way a table with a catch-all can be guarded: the catch-all will
 * happily answer for the new kind too, and answer wrongly, and stay green.
 *
 * The negative half matters as much: a PROTOCOL source must keep storing its
 * host and port, because for `imap` and `oauth2` the host is the account.
 * A fix that gave everything the two-key account shape would break every
 * mail source in the product and is not what this asks for.
 */

import { describe, it, expect } from 'vitest';
import { PROVIDER_ACCOUNT_KINDS, providerAccountDomains } from '@openmig/shared';
import { CreateMappingBase, sourceConnectionConfig } from './migrations/index.ts';

/** What the create door hands the builder, for an account: an address, no more. */
const ACCOUNT_VALUES = { username: 'someone@example.invalid', useSsl: true } as const;

describe('a provider account stores the kind it is', () => {
  for (const kind of PROVIDER_ACCOUNT_KINDS) {
    // `soverin` is a provider account but not a wizard SOURCE type — it is the
    // one target-side account — so it never reaches this builder. Asserting on
    // it would demand a branch for a call that cannot happen.
    if (!isASourceType(kind)) continue;

    it(`${kind} is stored as '${kind}', not as somebody else's product`, () => {
      const stored = sourceConnectionConfig({
        sourceType: kind as never,
        sourceConfig: { ...ACCOUNT_VALUES } as never,
      });

      expect(
        stored.type,
        `a '${kind}' connection is stored as '${String(stored.type)}'. The GET detail route ` +
          'echoes this object, so the row identifies itself as a product it is not, and the ' +
          'rotate panel prefills from that shape. If this reads `imap-oauth2`, the kind fell ' +
          'through to the Azure catch-all at the bottom of sourceConnectionConfig — which is ' +
          'how `microsoft` and `apple` were both stored until 0115 T9.',
      ).toBe(kind);

      // The address is what an account row IS. Everything else about it —
      // which faces it serves, where they live — is read from the kind.
      expect(stored.user, `'${kind}' stored no address`).toBe(ACCOUNT_VALUES.username);

      // AND NOT A HOST. An account kind's endpoints are the provider's, so a
      // host here is a value nobody typed and nobody can trust: `apple` would
      // be pointed away from `PROVIDER_ENDPOINTS`, and the Soverin lesson
      // (#133) is that a stored host reaches faces it was never measured for.
      expect(
        stored.host,
        `'${kind}' stored a host. An account row has no host to give — its faces resolve ` +
          'from the kind, and a stray one here overrides the published endpoint.',
      ).toBeUndefined();

      // Sanity that this kind is worth the assertions above: an account with
      // no faces would pass every line here while carrying nothing.
      expect(providerAccountDomains(kind).length, `${kind} serves no faces`).toBeGreaterThan(0);
    });
  }

  it('a PROTOCOL source still stores its server, which is the account for those', () => {
    // The control, and the regression this change could most easily cause.
    // `imap` and `oauth2` ARE a host: fold them into the account shape and
    // every mail source in the product loses the server it connects to.
    const imap = sourceConnectionConfig({
      sourceType: 'imap' as never,
      sourceConfig: { username: 'someone@example.invalid', host: 'mail.example.invalid', port: 993, useSsl: true } as never,
    });
    expect(imap.host, 'an imap source lost its host — the account shape reached a protocol row')
      .toBe('mail.example.invalid');
    expect(imap.port).toBe(993);

    const oauth2 = sourceConnectionConfig({
      sourceType: 'oauth2' as never,
      sourceConfig: { username: 'someone@contoso.invalid', useSsl: true } as never,
    });
    expect(oauth2.host, "oauth2 lost O365's fixed IMAP endpoint").toBe('outlook.office365.com');
  });
});

/**
 * Whether this account kind is offered as a wizard SOURCE.
 *
 * Read off `CreateMappingBase`'s own enum rather than restated, so a kind that
 * becomes a source (or stops being one) moves this test with it instead of
 * leaving a hand-written list to drift.
 */
function isASourceType(kind: string): boolean {
  return (CreateMappingBase.shape.sourceType.options as ReadonlyArray<string>).includes(kind);
}
