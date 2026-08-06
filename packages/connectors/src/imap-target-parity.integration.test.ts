// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The WRITE-path parity harness against a REAL IMAP server (workplan 0032 T2).
 *
 * `imap-target-parity.unit.test.ts` proves the harness can FAIL — it breaks one
 * writer at a time against stubs and asserts each fault is named. That is the
 * property that matters, and stubs are the right way to prove it.
 *
 * This is the gate: `ImapDavMailTarget` (the proven `imap-simple` writer, the
 * one the nightly e2e has behind it) against `ImapFlowDavMailTarget`, each into
 * its own freshly-created mailbox on the Testcontainers Stalwart, driven
 * through the same script. Every disagreement arrives as a named field on a
 * named operation rather than as a behaviour change found later in somebody's
 * mailbox.
 *
 * **This is the half that can lose data.** A read-path difference shows up as
 * items missing or counts off; a write-path difference shows up as a duplicate,
 * a lost flag, or a removal that took the wrong message — all of which are
 * successful operations that nothing complains about.
 *
 * NOTHING NEEDS CONFIGURING: `vitest.global-setup.ts` provisions Stalwart with
 * Testcontainers and exports `STALWART_IMAP_HOST` / `STALWART_IMAP_PORT` before
 * any test file loads, so this runs — and is gated in CI — under
 * `pnpm test:integration`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ImapFlow } from 'imapflow';
import { ImapDavMailTarget } from './imap-dav-target';
import { ImapFlowDavMailTarget } from './imapflow-dav-target';
import {
  compareMailTargets,
  describeTargetDifferences,
  type ParityMessage,
} from './imap-target-parity';

const HOST = process.env.STALWART_IMAP_HOST;
const PORT = parseInt(process.env.STALWART_IMAP_PORT || '993', 10);
/**
 * Committed dev-fixture credentials for a throwaway container of `dev.local`
 * accounts — the same ones `setup-stalwart.sh` prints when it finishes. Not
 * secrets; hard rule 3 is about a real credential reaching a real server.
 */
const USER = 'target@dev.local';
const PASSWORD = 'target_password';

/**
 * A mailbox per writer, stamped per run.
 *
 * Per writer because two writers sharing one mailbox makes the second adopt the
 * first's messages — the harness refuses that outright. Stamped because a
 * previous run's leftovers would make the second pass adopt instead of create
 * and turn the whole comparison green for the wrong reason.
 */
const STAMP = `${process.pid}-${Math.floor(Math.random() * 1e6)}`;
const BOX_A = `openmig-parity-a-${STAMP}`;
const BOX_B = `openmig-parity-b-${STAMP}`;

function config() {
  return {
    host: HOST!,
    port: PORT,
    tls: true,
    username: USER,
    password: PASSWORD,
    // The dev container serves a self-signed certificate. Both writers get the
    // SAME posture — the harness must vary exactly one thing, the client.
    rejectUnauthorized: false,
  };
}

/**
 * The messages the script writes.
 *
 * Deliberately varied on the axes a write path can differ about: flags (one
 * seen, one flagged, one with none), and a body with non-ASCII bytes, because a
 * client that mangles the encoding on APPEND produces a message that is present,
 * counted, and wrong — which only the content hash catches.
 */
function fixtures(): ParityMessage[] {
  const make = (n: number, keywords: ParityMessage['keywords'], body: string): ParityMessage => {
    const messageId = `openmig-target-parity-${STAMP}-${n}@dev.local`;
    return {
      messageId,
      rfc822: new TextEncoder().encode(
        [
          `Message-ID: <${messageId}>`,
          'From: seed@dev.local',
          `To: ${USER}`,
          `Subject: parity ${n}`,
          'Content-Type: text/plain; charset=utf-8',
          '',
          body,
        ].join('\r\n'),
      ),
      keywords,
    };
  };
  return [
    make(1, ['$seen'], 'plain body'),
    make(2, ['$flagged', '$seen'], 'flagged body'),
    make(3, [], 'niet-ASCII: café, Gelöschte, Прочитанные'),
  ];
}

/** Remove the two scratch mailboxes, whatever state the run left them in. */
async function dropMailboxes(): Promise<void> {
  const client = new ImapFlow({
    host: HOST!,
    port: PORT,
    secure: true,
    auth: { user: USER, pass: PASSWORD },
    tls: { rejectUnauthorized: false },
    logger: false,
    disableAutoIdle: true,
  });
  await client.connect();
  try {
    for (const box of [BOX_A, BOX_B]) {
      await client.mailboxDelete(box).catch(() => undefined);
    }
  } finally {
    await client.logout().catch(() => undefined);
  }
}

if (!HOST) {
  console.warn(
    '[imap-target-parity] NOT RUN: no STALWART_IMAP_HOST. Under `pnpm test:integration` the ' +
      'global setup provides one, so seeing this means the harness did not start Stalwart.',
  );
  describe.skip('IMAP target parity — NOT VERIFIED against a real server', () => {
    it('was not run, so nothing below is known to hold', () => {
      expect(true).toBe(true);
    });
  });
} else {
  describe('the write path: ImapDavMailTarget vs ImapFlowDavMailTarget', () => {
    const a = new ImapDavMailTarget(config());
    const b = new ImapFlowDavMailTarget(config());

    beforeAll(async () => {
      // A previous crashed run could have left them behind, and adopting into
      // one would make this comparison agree without writing anything.
      await dropMailboxes();
    }, 60_000);

    afterAll(async () => {
      await a.disconnect().catch(() => undefined);
      await b.disconnect().catch(() => undefined);
      await dropMailboxes().catch(() => undefined);
    }, 60_000);

    it('agrees on every operation the write path performs', async () => {
      const messages = fixtures();
      const result = await compareMailTargets(a, b, {
        messages,
        mailboxA: BOX_A,
        mailboxB: BOX_B,
      });

      // THE GATE. Two different IMAP client libraries, the same server, the
      // same script — and every disagreement reported as a named field on a
      // named operation.
      //
      // The ones that matter most: whether the second pass ADOPTED (a duplicate
      // is a successful write that doubles a mailbox), whether the mailbox
      // really holds what was written (a writer can report `adopted` and have
      // appended anyway), and whether the content hash matches the bytes that
      // went in (both writers agreeing on a wrong hash would make §20 report a
      // healthy migration as corrupt, or a corrupt one as healthy).
      expect(result.differences, describeTargetDifferences(result)).toEqual([]);

      // THE assertions that stop this being a tautology. Two writers that wrote
      // nothing agree perfectly; so does a harness that silently skipped its
      // script. If the fixtures or the mailbox creation ever break, this goes
      // red rather than green for the wrong reason.
      expect(result.messagesWritten).toBe(messages.length);
      expect(result.entriesListed).toBe(messages.length);
      expect(result.hashesCompared).toBe(messages.length);
    }, 180_000);
  });
}
