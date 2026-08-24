// Copyright 2026 The Ownpace authors (Apache-2.0)
//
// THE TARGET NOTHING HAD EVER WRITTEN TO, against a real IMAP server.
//
// `imap-dav` is a first-class target type: `apps/api/src/routes/migrations`
// constructs it, `config.ts` parses it, `build-deps.ts` dispatches it and
// `mail-target-factory.ts` builds an `ImapFlowDavMailTarget` beneath it. Until
// this file, NOTHING that runs had ever selected it — mail written to an IMAP
// target rather than a JMAP one was covered by unit tests and by nothing else.
// Found by deriving the connector list from `config.ts` and grepping all three
// gates (`scripts/connector-coverage.unit.test.ts`).
//
// ## Why here and not in an e2e
//
// The first attempt was `test/e2e/selfhost-imap-dav-target.e2e.test.ts`, and
// `test/e2e/no-workspace-imports.unit.test.ts` refused it: `test/e2e` is not
// inside a workspace package, so pnpm links no `@openmig/*` into scope there
// and the import would have died on the runner with ERR_MODULE_NOT_FOUND —
// while `tsc` and `tsx` both resolved it locally through tsconfig paths. It
// compiled, it passed here, and it would have failed on the Spark. The rule's
// second half is the deeper one: an e2e talks to a RUNNING appliance over the
// wire, and pulling library code into one makes it partly a test of this
// checkout.
//
// Driving `buildDeps` is exactly that library-level question, so it belongs in
// an integration test — where the workspace is linked, Testcontainers provides
// a real Stalwart, and it runs on EVERY pull request on both architectures
// rather than nightly.
//
// ## What it proves
//
//   1. `parseMappingConfigJson` accepts a mail target of type `imap-dav`.
//   2. `buildDeps` DISPATCHES it — the `case 'imap-dav'` arm and the password
//      resolution from the environment beneath it.
//   3. `ensureMailbox` + `upsertEmail` land a real message on a real server,
//      verified with an INDEPENDENT IMAP client rather than the writer's own
//      report.
//   4. A second `upsertEmail` adopts rather than duplicating — the property a
//      target is most dangerous without, and one a `created` return would
//      hide. Checked BY COUNT on the server, because a writer can report
//      `adopted` and have appended anyway.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ImapFlow } from 'imapflow';
import { createPgDb } from '@openmig/ledger';
import { parseMappingConfigJson } from '@openmig/shared';
import type { MailFolder, RawMessage } from '@openmig/shared';
import { buildDeps } from './build-deps.ts';

const STALWART_IMAP_HOST = process.env.STALWART_IMAP_HOST;
const STALWART_IMAP_PORT = parseInt(process.env.STALWART_IMAP_PORT || '993', 10);
// The account the testcontainers setup provisions as the migration TARGET.
const TARGET_USER = process.env.STALWART_JMAP_USERNAME || 'target@dev.local';
const TARGET_PASSWORD = process.env.STALWART_JMAP_PASSWORD || 'target_password';

const PASSWORD_ENV = 'IMAP_DAV_TARGET_PASSWORD_FOR_TEST';
const MAILBOX = 'ImapDavTargetGate';

if (!STALWART_IMAP_HOST) {
  console.warn('[imap-dav-target] Skipping: Stalwart not available. Set STALWART_IMAP_HOST to enable.');
  describe.skip('the imap-dav mail target against a real IMAP server', () => {
    it('skipped — Stalwart not configured', () => {
      expect(true).toBe(true);
    });
  });
} else {
  // `buildDeps` builds the WHOLE bundle — ledger and cursor store included —
  // even though this file only asks about the mail target. Its ledger arm reads
  // `DATABASE_URL`, and the integration run does not set that: the
  // Testcontainers Postgres is published as `TEST_DATABASE_URL`
  // (`vitest.global-setup.ts`). The first version of this file called
  // `buildDeps(config)` with no second argument and died on the runner with
  // "DATABASE_URL environment variable is required" — green here, red in CI,
  // the very failure the header warns about, one layer down.
  //
  // `LedgerOptions.ledgerDb` is the contract that exists for this; the
  // appliance passes its own handle the same way (`apps/selfhost/src/index.ts`).
  // Because the handle is the CALLER's, `deps.close()` deliberately leaves it
  // open — so this file closes it.
  //
  // Not a skip: Stalwart being up means containers started, and containers
  // starting means Postgres did too. A missing URL here is a broken harness,
  // not an unconfigured one.
  const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
  if (!TEST_DATABASE_URL) {
    throw new Error(
      'TEST_DATABASE_URL is not set while STALWART_IMAP_HOST is. Both come from ' +
      'the same Testcontainers global setup, so this is a harness fault rather ' +
      'than a missing option — do not paper over it by skipping.',
    );
  }

  // Unique per run: a leftover from an earlier run must never look like a pass.
  const MESSAGE_ID = `<imap-dav-${Date.now()}-${process.pid}@dev.local>`;

  const FOLDER: MailFolder = { path: MAILBOX, name: MAILBOX, specialUse: 'normal' };

  const MESSAGE: RawMessage = {
    item: {
      messageId: MESSAGE_ID,
      folder: FOLDER,
      keywords: [],
      receivedAt: '2026-08-24T12:00:00.000Z',
      sourceRef: `${MAILBOX}:1`,
    },
    rfc822: Buffer.from(
      [
        `Message-ID: ${MESSAGE_ID}`,
        'From: source@dev.local',
        `To: ${TARGET_USER}`,
        'Subject: imap-dav target coverage',
        'Date: Mon, 24 Aug 2026 12:00:00 +0000',
        '',
        "Written through the product's own imap-dav target.",
        '',
      ].join('\r\n'),
    ),
  };

  /**
   * How many copies of `MESSAGE_ID` the server holds in `MAILBOX`, asked with
   * an INDEPENDENT client. The writer's own return value is what is under
   * test; using it to check itself would prove nothing.
   */
  async function countOnServer(): Promise<number> {
    const client = new ImapFlow({
      host: STALWART_IMAP_HOST!,
      port: STALWART_IMAP_PORT,
      secure: true,
      tls: { rejectUnauthorized: false },
      auth: { user: TARGET_USER, pass: TARGET_PASSWORD },
      logger: false,
    });
    await client.connect();
    try {
      // "Does the mailbox exist yet" is answered by ASKING, not by locking it
      // and treating the exception as a no. `getMailboxLock(...).catch(() => 0)`
      // returns the same 0 for "not created yet" as for a rejected login or a
      // dropped connection — so the BEFORE assertion would pass for exactly the
      // reason that invalidates it. `list()` throws on a real fault and answers
      // an absent mailbox with data.
      const boxes = await client.list();
      if (!boxes.some((box) => box.path === MAILBOX)) return 0;

      const lock = await client.getMailboxLock(MAILBOX);
      try {
        const uids = await client.search({ header: { 'message-id': MESSAGE_ID } }, { uid: true });
        return Array.isArray(uids) ? uids.length : 0;
      } finally {
        lock.release();
      }
    } finally {
      // The only swallow in this file, and only because a throw from a `finally`
      // REPLACES the error that brought us here. The answer is already in hand.
      await client.logout().catch(() => undefined);
    }
  }

  function mappingJson(): string {
    return JSON.stringify({
      mappingId: '00000000-0000-4000-8000-00000000da01',
      tenantId: '00000000-0000-4000-8000-00000000da02',
      source: {
        type: 'imap-oauth2',
        host: STALWART_IMAP_HOST,
        port: STALWART_IMAP_PORT,
        user: 'source@dev.local',
        auth: { kind: 'login', passwordFromEnv: 'SOURCE_IMAP_PASSWORD_FOR_TEST' },
        tlsVerify: false,
      },
      // THE POINT OF THIS FILE.
      target: {
        type: 'imap-dav',
        host: STALWART_IMAP_HOST,
        port: STALWART_IMAP_PORT,
        user: TARGET_USER,
        auth: { kind: 'login', passwordFromEnv: PASSWORD_ENV },
        tls: true,
        tlsVerify: false,
      },
    });
  }

  describe('the imap-dav mail target against a real IMAP server', () => {
    let deps: Awaited<ReturnType<typeof buildDeps>> | undefined;
    let ledgerDb: ReturnType<typeof createPgDb> | undefined;
    let mailboxId = '';

    beforeAll(() => {
      // The `case 'imap-dav'` arm resolves both from the environment.
      process.env[PASSWORD_ENV] = TARGET_PASSWORD;
      process.env.SOURCE_IMAP_PASSWORD_FOR_TEST = 'source_password';
    });

    afterAll(async () => {
      await deps?.close();
      // Ours, because we opened it. `deps.close()` will not.
      await ledgerDb?.close();
    });

    it('the config parses, and buildDeps dispatches an imap-dav target', async () => {
      const config = parseMappingConfigJson(mappingJson());
      expect(config.target.type).toBe('imap-dav');
      ledgerDb = createPgDb(TEST_DATABASE_URL);
      deps = await buildDeps(config, { ledgerDb });
      expect(deps.target).toBeTruthy();
    });

    it('lands a real message, confirmed by an independent IMAP client', async () => {
      expect(deps, 'the dispatch test must have run first').toBeTruthy();
      // Nothing there BEFORE, or "it arrived" is unfalsifiable.
      expect(await countOnServer()).toBe(0);

      mailboxId = await deps!.target.ensureMailbox(FOLDER);
      expect(mailboxId).toBeTruthy();
      await deps!.target.upsertEmail(mailboxId, MESSAGE, []);

      expect(await countOnServer()).toBe(1);
    });

    it('a second write adopts it rather than duplicating it', async () => {
      expect(mailboxId, 'the landing test must have run first').toBeTruthy();
      await deps!.target.upsertEmail(mailboxId, MESSAGE, []);
      expect(await countOnServer(), 'a second upsert duplicated the message').toBe(1);
    });
  });
}
