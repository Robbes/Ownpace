// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PASSWORD TYPED ON A LINK, TESTED AGAINST A REAL SERVER (workplan 0174
 * §5.4, §11, T3).
 *
 * The unit tests record the servers; this file asks Stalwart, as the
 * Testcontainers harness starts it (`docs/stalwart-integration-fix.md`, no
 * accounts in `config.json`), with the account it provisions, whether the
 * test the link runs tells a right password from a wrong one:
 *
 * - an IMAP SOURCE: the right password is `ok`; a wrong one is
 *   `refused_login`, which is the only category that counts a try (D4);
 * - a JMAP DESTINATION: the same, over the session document's Basic login;
 * - a server that does not answer is `unreachable`, never `refused_login`.
 *
 * The passwords are the harness's own placeholders, read from its
 * environment where it sets them. Under `pnpm test:integration` the global
 * setup starts Stalwart; without it, this file says so and runs nothing.
 */

import { describe, it, expect } from 'vitest';
import { probeAnswers } from '../probe-answer.ts';
import { runPasswordTest } from './password-test.ts';

const IMAP_HOST = process.env.STALWART_IMAP_HOST;
const IMAP_PORT = Number.parseInt(process.env.STALWART_IMAP_PORT ?? '993', 10);
const JMAP_URL = process.env.STALWART_JMAP_URL;
const JMAP_USER = process.env.STALWART_JMAP_USERNAME ?? 'target@dev.local';
const JMAP_PASSWORD = process.env.STALWART_JMAP_PASSWORD ?? 'target_password';
/** The source account the harness provisions, and its placeholder password (`testcontainers-setup.ts`). */
const SOURCE_USER = 'source@dev.local';
const SOURCE_PASSWORD = 'source_password';
const WRONG = 'placeholder-wrong-password';

if (!IMAP_HOST || !JMAP_URL) {
  console.warn(
    '[a-password-tested-against-stalwart] NOT RUN: no STALWART_IMAP_HOST / STALWART_JMAP_URL. Under ' +
      '`pnpm test:integration` the global setup provides both, so seeing this means the harness did not start Stalwart.',
  );
  describe.skip('a password tested against Stalwart — NOT VERIFIED against a real server', () => {
    it('was not run, so nothing below is known to hold', () => {
      expect(true).toBe(true);
    });
  });
} else {
  const answers = () => probeAnswers('an integration test of the grant link’s password test');

  /** The harness's IMAPS listener has a self-signed certificate: verification off, as its other IMAP suites set it. */
  const imapSource = (password: string, host = IMAP_HOST) => ({
    role: 'source' as const,
    kind: 'imap' as const,
    config: { type: 'imap-oauth2', host, port: IMAP_PORT, user: SOURCE_USER, tlsVerify: false },
    credentials: { username: SOURCE_USER, password },
    faces: ['email'] as const,
  });

  const jmapTarget = (password: string) => ({
    role: 'target' as const,
    kind: 'jmap' as const,
    config: { baseUrl: JMAP_URL.replace(/\/+$/, '') },
    credentials: { username: JMAP_USER, password },
    faces: ['email'] as const,
  });

  describe('the grant link’s password test against Stalwart', () => {
    it('an IMAP source: the right password connects, a wrong one is a refused login', async () => {
      const right = await runPasswordTest(imapSource(SOURCE_PASSWORD), ['password'], answers());
      expect(right.test).toMatchObject({ ok: true, secret: { password: SOURCE_PASSWORD } });

      const wrong = await runPasswordTest(imapSource(WRONG), ['password'], answers());
      expect(wrong.test).toEqual({ ok: false, category: 'refused_login' });
    }, 60_000);

    it('a JMAP destination: the right password connects, a wrong one is a refused login', async () => {
      const right = await runPasswordTest(jmapTarget(JMAP_PASSWORD), ['password'], answers());
      expect(right.test.ok).toBe(true);

      const wrong = await runPasswordTest(jmapTarget(WRONG), ['password'], answers());
      expect(wrong.test).toEqual({ ok: false, category: 'refused_login' });
    }, 60_000);

    it('a server that does not answer is unreachable, never a refused login', async () => {
      // A name under `.invalid` never resolves (RFC 6761).
      const down = await runPasswordTest(imapSource(SOURCE_PASSWORD, 'imap.ownpace-test.invalid'), ['password'], answers());
      expect(down.test).toEqual({ ok: false, category: 'unreachable' });
    }, 60_000);
  });
}
