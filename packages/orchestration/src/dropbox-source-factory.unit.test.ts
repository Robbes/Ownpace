// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
/**
 * The Dropbox factory (workplan 0055): the refusal is the behaviour worth
 * pinning — every missing value at once, in the vocabulary the operator can
 * act on, before anything is recorded as attempted.
 */

import { describe, it, expect } from 'vitest';
import {
  ENV_DROPBOX_CREDENTIAL_NAMES,
  STORED_DROPBOX_CREDENTIAL_NAMES,
  buildDropboxSourceFrom,
} from './dropbox-source-factory';

describe('refusing before anything is attempted', () => {
  it('names EVERY missing credential at once, in the appliance vocabulary', () => {
    expect(() => buildDropboxSourceFrom({}, {})).toThrow(
      /DROPBOX_APP_KEY, DROPBOX_APP_SECRET, DROPBOX_REFRESH_TOKEN/,
    );
    expect(() => buildDropboxSourceFrom({}, {})).toThrow(/dropbox-setup\.md/);
  });

  it("names the STORED keys for the managed edition — a fix the operator can apply", () => {
    expect(() =>
      buildDropboxSourceFrom({}, { appKey: 'k' }, STORED_DROPBOX_CREDENTIAL_NAMES),
    ).toThrow(/clientSecret, refreshToken/);
  });

  it('constructs with all three, no network touched', () => {
    expect(
      buildDropboxSourceFrom(
        { rootPath: '/Team' },
        { appKey: 'k', appSecret: 's', refreshToken: 'rt' },
        ENV_DROPBOX_CREDENTIAL_NAMES,
      ),
    ).toBeDefined();
  });
});
