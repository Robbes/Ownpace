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
    expect(() => buildBoxSourceFrom({}, {})).toThrow(/box-setup\.md/);
  });

  it('says WHY there is no refresh token — Box rotates them', () => {
    expect(() => buildBoxSourceFrom({}, {})).toThrow(/rotates refresh tokens/);
  });

  it('names the STORED keys for the managed edition — a fix the operator can apply', () => {
    expect(() =>
      buildBoxSourceFrom({}, { clientId: 'id' }, STORED_BOX_CREDENTIAL_NAMES),
    ).toThrow(/clientSecret, userId \(on the source config\)/);
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
