// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The parity harness against a REAL IMAP server (workplan 0032 T0).
 *
 * `imap-parity.unit.test.ts` proves the harness can FAIL — it perturbs one
 * field at a time against stubs and asserts each is named. That is the property
 * that matters, and stubs are the right way to prove it.
 *
 * What stubs cannot prove is that `compareSources` survives a real connector:
 * real folder shapes, a real cursor, a real `fetch`, a source that
 * self-connects per call.
 *
 * ## THIS IS NOW THE REAL GATE (T1, 2026-08-06)
 *
 * Until today this file compared `ImapSource` with ITSELF, said so at the top,
 * and claimed nothing: a self-comparison agrees by construction. **The second
 * `source()` is now `imapFlowSource()`**, which is the one-line diff T0 was
 * built to make possible. Every field the two clients disagree about now
 * arrives as a named comparison on a named message — which is the entire
 * safety argument for moving 1430 lines off `imap-simple`.
 *
 * A green run still does not claim equivalence in general. It claims the two
 * clients agreed **on the folders and messages that exist on the server it was
 * pointed at**, and an empty mailbox agrees about nothing — which is why
 * `itemsCompared` and `bodiesCompared` are asserted rather than only
 * `differences`.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import imap from 'imap-simple';
import { ImapSource } from './imap-source';
import { ImapFlowSource } from './imapflow-source';
import { compareSources, describeDifferences } from './imap-parity';

const HOST = process.env.STALWART_IMAP_HOST;
const PORT = parseInt(process.env.STALWART_IMAP_PORT || '993', 10);
/**
 * Committed dev-fixture credentials for a throwaway container of `dev.local`
 * accounts — the same ones `setup-stalwart.sh` prints when it finishes. Not
 * secrets; hard rule 3 is about a real credential reaching a real server.
 */
const USER = 'source@dev.local';
const PASSWORD = 'source_password';
const SEEDED_FOLDER = 'INBOX';

/** The proven client — `imap-simple`, the one the nightly e2e has behind it. */
function source(): ImapSource {
  return new ImapSource({
    host: HOST!,
    port: PORT,
    tls: true,
    auth: { user: USER, password: PASSWORD },
  });
}

/**
 * The candidate — `imapflow`, built to the same `SourceConnector` contract.
 *
 * Identical config on purpose: the harness must vary exactly ONE thing, and
 * that thing is the client. A different host, a different TLS posture or a
 * different credential would produce differences that say nothing about the
 * migration.
 */
function imapFlowSource(): ImapFlowSource {
  return new ImapFlowSource({
    host: HOST!,
    port: PORT,
    tls: true,
    auth: { user: USER, password: PASSWORD },
  });
}

/**
 * Put messages in the mailbox, because a comparison over nothing is not a
 * comparison.
 *
 * Deliberately varied: one plain, one with a Message-ID that has surrounding
 * whitespace in the header, and one with none at all. Those are the three
 * shapes a client can disagree about — and the harness's whole reason for
 * existing is the middle one.
 */
const FIXTURES = [
  ['Message-ID: <parity-plain@dev.local>', 'Subject: plain'],
  ['Message-ID:  <parity-spaced@dev.local> ', 'Subject: spaced header'],
  ['Subject: no message id at all'],
] as const;

async function seed(): Promise<void> {
  const conn = await imap.connect({
    imap: {
      user: USER,
      password: PASSWORD,
      host: HOST!,
      port: PORT,
      tls: true,
      tlsOptions: { rejectUnauthorized: false },
      authTimeout: 10_000,
    },
  });
  try {
    await conn.openBox(SEEDED_FOLDER);
    for (const headers of FIXTURES) {
      const raw = [...headers, 'From: seed@dev.local', 'To: source@dev.local', '', 'body'].join('\r\n');
      // `append` is idempotent enough for this purpose: a re-run adds copies,
      // and copies do not change what the comparison proves — both sides see
      // exactly the same mailbox either way.
      await (conn as unknown as { append: (m: string, o?: unknown) => Promise<void> }).append(raw, {
        mailbox: SEEDED_FOLDER,
      });
    }
  } finally {
    await (conn as unknown as { end: () => Promise<void> }).end();
  }
}

if (!HOST) {
  console.warn(
    '[imap-parity] NOT RUN: no STALWART_IMAP_HOST. Under `pnpm test:integration` the global ' +
      'setup provides one, so seeing this means the harness did not start Stalwart.',
  );
  describe.skip('IMAP parity harness — NOT VERIFIED against a real server', () => {
    it('was not run, so nothing below is known to hold', () => {
      expect(true).toBe(true);
    });
  });
} else {
  describe('the parity harness against a live IMAP server', () => {
    beforeAll(async () => {
      await seed();
    }, 60_000);

    it('ImapSource and ImapFlowSource agree, field by field, on a real mailbox', async () => {
      const result = await compareSources(source(), imapFlowSource(), { sampleBodies: 2 });

      // THE GATE. Two different IMAP client libraries, the same server, the
      // same seeded mailbox — and every disagreement reported as a named field
      // on a named message rather than as a behaviour change discovered later
      // in somebody's mailbox.
      //
      // The one that matters most is `messageId`: `naturalKeyForItem()` hashes
      // it, so a normalisation difference is not an error, it is a re-copy of
      // every message on the next pass with every write succeeding.
      expect(result.differences, describeDifferences(result)).toEqual([]);

      // THE assertion that stops this being a tautology. Two empty mailboxes
      // agree perfectly; so does a harness that silently listed nothing. If the
      // seeding above ever breaks, this goes red rather than going green for
      // the wrong reason — and now that the comparison is between two real
      // clients, agreeing over nothing would be the most misleading possible
      // result.
      expect(result.foldersCompared).toBeGreaterThan(0);
      expect(result.itemsCompared).toBeGreaterThanOrEqual(FIXTURES.length);
      expect(result.bodiesCompared).toBeGreaterThan(0);
    }, 120_000);

    it('reads a Message-ID the natural key can be built from', async () => {
      // Not a parity check — a check that the fixture is what the parity check
      // needs. The seeded mailbox must actually contain a message whose id
      // survives listing, or the field this harness exists to guard is never
      // exercised and every future comparison of it is vacuous.
      const listed = await source().listSince({
        path: SEEDED_FOLDER,
        name: SEEDED_FOLDER,
        specialUse: 'inbox',
      });

      const ids = listed.items.map((i) => i.messageId).filter(Boolean);
      expect(ids.length, 'no message in the seeded mailbox carries a Message-ID').toBeGreaterThan(0);
      // Angle brackets INCLUDED, as `MailItem.messageId` documents ("including
      // angle brackets as received"). This is the exact convention T1 must
      // reproduce, so it is pinned here against the real server rather than
      // left to be inferred from `imap-source.ts`.
      expect(ids.some((id) => id.startsWith('<') && id.endsWith('>'))).toBe(true);
    }, 120_000);
  });
}
