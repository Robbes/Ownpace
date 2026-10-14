// Copyright 2026 The Ownpace authors (Apache-2.0)
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
} from './dropbox-source-factory.ts';

describe('refusing before anything is attempted', () => {
  it('names EVERY missing credential at once, in the appliance vocabulary', () => {
    expect(() => buildDropboxSourceFrom({}, {})).toThrow(
      /DROPBOX_APP_KEY, DROPBOX_APP_SECRET, DROPBOX_REFRESH_TOKEN/,
    );
    // Where to read on is the guide's section, beside the words; the words
    // name no file (0148 T7).
    expect(() => buildDropboxSourceFrom({}, {})).toThrow(
      expect.objectContaining({ refusal: expect.objectContaining({ guide: 'dropbox#own-app' }) }),
    );
    expect(() => buildDropboxSourceFrom({}, {})).not.toThrow(/docs\/[\w./-]+\.md/);
  });

  it("names the STORED keys for the managed edition — a fix the operator can apply", () => {
    expect(() =>
      buildDropboxSourceFrom({}, { appKey: 'k' }, STORED_DROPBOX_CREDENTIAL_NAMES),
    ).toThrow(/App secret, the sign-in from Connect with Dropbox are not set/);
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
