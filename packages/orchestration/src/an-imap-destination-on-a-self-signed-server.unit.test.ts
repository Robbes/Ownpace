// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN IMAP DESTINATION ON A SELF-SIGNED SERVER, TESTED AS IT IS WRITTEN TO
 * (workplan 0174 T8).
 *
 * An `imap` destination row may say `tlsVerify: false`: a dev or demo server
 * with a self-signed certificate, opted out in writing (`ImapTlsVerifySetting`).
 * The pass's writer honours it (`buildImapDavTargetFrom` hands it on as
 * `rejectUnauthorized`). The probe did not: its IMAP branch built the mail
 * connection from `host`, `port`, `useSsl` and `user` only, so the test of the
 * same row verified the certificate the pass would not, and answered
 * `unreachable`. A grant link's password test is that probe (0174 §5.4), so
 * a person could never connect such a destination, and T8's integration case
 * for an IMAP destination on the Stalwart fixture could not pass.
 *
 * Held here: the probe's connection carries the row's `tlsVerify`, and a row
 * that says nothing keeps verification on (the connector's own `?? true`).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ImapFlowSource } from '@openmig/connectors';
import { probeTargetConnection } from './probe-connection.ts';

/** Placeholders, never a real login. */
const CREDS = { username: 'someone@example.invalid', password: 'fixture-not-a-password' };

/** What the probe's IMAP connection was built to do about the certificate. */
async function rejectUnauthorizedOf(config: Record<string, unknown>): Promise<unknown> {
  let seen: unknown = 'not built';
  vi.spyOn(ImapFlowSource.prototype, 'listFolders').mockImplementation(async function (this: unknown) {
    seen = (this as { config: { rejectUnauthorized?: boolean } }).config.rejectUnauthorized;
    return [];
  });
  const result = await probeTargetConnection('imap', config, CREDS);
  expect(result.ok, JSON.stringify(result)).toBe(true);
  return seen;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the probe of an imap destination reads the row’s tlsVerify', () => {
  it('does not verify a certificate the row opted out of verifying, as the pass does not', async () => {
    const config = { type: 'imap-dav', host: 'imap.example.invalid', port: 993, user: CREDS.username, tlsVerify: false };
    expect(await rejectUnauthorizedOf(config)).toBe(false);
  });

  it('leaves verification to the connector’s default when the row says nothing', async () => {
    const config = { type: 'imap-dav', host: 'imap.example.invalid', port: 993, user: CREDS.username };
    expect(await rejectUnauthorizedOf(config)).toBeUndefined();
  });
});
