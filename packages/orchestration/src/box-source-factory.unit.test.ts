// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The Box factory (workplan 0056): the refusal is the behaviour worth
 * pinning — every missing value at once, in the vocabulary the operator can
 * act on, and the WHY of the credential shape (no refresh token: Box rotates
 * them) stated where the operator will read it.
 */

import { describe, it, expect } from 'vitest';
import {
  ENV_BOX_CREDENTIAL_NAMES,
  STORED_BOX_CREDENTIAL_NAMES,
  buildBoxSourceFrom,
} from './box-source-factory.ts';

describe('refusing before anything is attempted', () => {
  it('names EVERY missing credential at once, in the appliance vocabulary', () => {
    expect(() => buildBoxSourceFrom({}, {})).toThrow(/BOX_CLIENT_ID, BOX_CLIENT_SECRET/);
    // Where to read on is the guide's section, beside the words; the words
    // name no file (0148 T7).
    expect(() => buildBoxSourceFrom({}, {})).toThrow(
      expect.objectContaining({ refusal: expect.objectContaining({ guide: 'box#connect' }) }),
    );
    expect(() => buildBoxSourceFrom({}, {})).not.toThrow(/docs\/[\w./-]+\.md/);
  });

  it('says WHY there is no refresh token — Box rotates them', () => {
    expect(() => buildBoxSourceFrom({}, {})).toThrow(/replaces its sign-in tokens every time one is used/);
  });

  it("names the managed form's fields, as the tester reads them, and keeps the stored keys as the finding", () => {
    // Since 2026-10-14 (the owner): the words say *Client secret* and *Box
    // user ID*, as the Accounts form does; `fields` still carries the keys.
    let refusal: { fields?: readonly string[]; en: string; nl: string } | undefined;
    try {
      buildBoxSourceFrom({}, { clientId: 'id' }, STORED_BOX_CREDENTIAL_NAMES);
    } catch (e) {
      refusal = (e as { refusal?: typeof refusal }).refusal;
    }
    expect(refusal?.en).toMatch(/^box source: Client secret, Box user ID are not set\./);
    expect(refusal?.nl).toMatch(/^box source: Clientsecret en Box-gebruikers-ID zijn niet ingesteld\./);
    expect(refusal?.fields).toEqual(['clientSecret', 'userId (on the source config)']);
    expect(refusal?.en).not.toMatch(/BOX_CLIENT/);
  });

  it('constructs with all three, no network touched', () => {
    expect(
      buildBoxSourceFrom(
        { rootFolderId: '123' },
        { clientId: 'id', clientSecret: 's', subjectUserId: '42' },
        ENV_BOX_CREDENTIAL_NAMES,
      ),
    ).toBeDefined();
  });
});
