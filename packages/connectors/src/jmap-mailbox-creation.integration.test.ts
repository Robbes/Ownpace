// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * `JmapTargetWriter.ensureMailbox` against a REAL Stalwart (workplan 0092 T5).
 *
 * **This file exists because the path it covers had never once been executed
 * against a live server.** Every integration test that touched `ensureMailbox`
 * — `verification-real-sync`, `adoption-visibility`, `jmap-reindex` — passed it
 * `INBOX`, which the account already has, so all of them exercised ADOPTION and
 * none of them exercised CREATION. Two bugs lived in that gap:
 *
 *  - `createMailbox` returned `Object.keys(created)[0]`, the CREATION id, so
 *    every mailbox it made came back as the literal string `"0"` — which
 *    `upsertEmail` then writes into `mailboxIds`. Unit tests with a mocked
 *    server pinned whatever the code did; only a real import into a real
 *    mailbox can tell you the id was a lie.
 *  - `ensureMailbox` matched by name and created with a role, so a source
 *    "Sent" against an account that already had one under another name earned
 *    `A mailbox with role 'sent' already exists.` and took the email domain
 *    down (the owner's Soverin → Stalwart run, 2026-08-22).
 *
 * The mailbox assertions go over **IMAP**, deliberately. Asking JMAP whether
 * JMAP did the right thing lets one wrong id agree with itself; a second
 * protocol reading the same account cannot.
 *
 * NOTHING NEEDS CONFIGURING — `vitest.global-setup.ts` provisions Stalwart with
 * Testcontainers and exports the variables below. Run under
 * `pnpm test:integration`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { JmapTargetWriter } from './jmap-target.ts';
import type { MailFolder, RawMessage, TargetEntry } from '@openmig/shared';
// Relative, not `@openmig/testing` — `packages/testing` is a test-only package
// that nothing declares as a dependency, and `jmap-reindex.integration.test.ts`
// reaches it the same way. `scripts/workspace-deps.unit.test.ts` requires a
// DECLARED dependency for every `@openmig/*` specifier, so the bare import
// would fail that guard rather than resolve.
import {
  withImapTestClient,
  listMailboxPaths,
  countMessages,
  type ImapTestClientConfig,
} from '../../testing/src/imap-test-client.ts';
import type { ImapFlow } from 'imapflow';
import { mapImapSpecialUse } from './imap-conventions.ts';

const BASE = process.env.STALWART_JMAP_URL;
const USER = process.env.STALWART_JMAP_USERNAME ?? 'target@dev.local';
/**
 * The dev fixture credential, applied only against loopback — the same
 * reasoning `jmap-contact-target.integration.test.ts` states: `target_password`
 * is `setup-stalwart.sh`'s committed fixture password for a throwaway container
 * of `dev.local` accounts, and the default stops at the boundary where a real
 * credential could reach a real server (hard rule 3).
 */
const LOOPBACK = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/.test(BASE ?? '');
const PASSWORD = process.env.STALWART_JMAP_PASSWORD ?? (LOOPBACK ? 'target_password' : undefined);
const IMAP_HOST = process.env.STALWART_IMAP_HOST;
const IMAP_PORT = Number.parseInt(process.env.STALWART_IMAP_PORT ?? '993', 10);

if (!BASE || !PASSWORD || !IMAP_HOST) {
  console.warn(
    '[jmap-mailbox-creation] NOT RUN: no STALWART_JMAP_URL / STALWART_IMAP_HOST. Under ' +
      '`pnpm test:integration` the global setup provides both, so seeing this means the ' +
      'harness did not start Stalwart.',
  );
  describe.skip('JMAP mailbox creation — NOT VERIFIED against a real server', () => {
    it('was not run, so nothing below is known to hold', () => {
      expect(true).toBe(true);
    });
  });
} else {
  const imap: ImapTestClientConfig = {
    host: IMAP_HOST,
    port: IMAP_PORT,
    user: USER,
    password: PASSWORD,
  };

  /**
   * The account's sent-role mailboxes, by the server's LIST attributes.
   *
   * Through `mapImapSpecialUse` — the same mapping the IMAP source uses — so
   * this cannot disagree with the product about what a sent folder is, and by
   * ATTRIBUTE rather than by name, because the name is the very thing under
   * test.
   */
  async function sentMailboxes(client: ImapFlow): Promise<string[]> {
    const boxes = await client.list();
    return boxes
      .filter((b) => mapImapSpecialUse([...(b.flags ?? [])]) === 'sent')
      .map((b) => b.path);
  }

  describe('JmapTargetWriter.ensureMailbox against a real Stalwart', () => {
    // Unique per run: a previous run's leftovers must not make "it already
    // exists" look like a pass.
    const stamp = `${process.pid}-${Math.floor(Math.random() * 1e6)}`;
    const NEW_FOLDER = `Ownpace-IT-${stamp}`;
    /** One literal, so the cases cannot ask for subtly different folders. */
    const folder: MailFolder = { path: NEW_FOLDER, name: NEW_FOLDER, specialUse: 'normal' };
    /** The prefix case's own tree, cleaned up by the same `Ownpace-IT-` sweep. */
    const PREFIX = `Ownpace-IT-p${stamp}`;
    const writer = new JmapTargetWriter({ baseUrl: BASE, username: USER, password: PASSWORD });

    /** Whatever the account looked like before we touched it. */
    let mailboxesBefore: string[] = [];

    beforeAll(async () => {
      mailboxesBefore = await withImapTestClient(imap, listMailboxPaths);
      expect(mailboxesBefore).not.toContain(NEW_FOLDER);
    }, 60_000);

    afterAll(async () => {
      // Leave the fixture account as we found it. DEEPEST FIRST — a server is
      // entitled to refuse deleting a mailbox that still has children, and the
      // prefix cases below create exactly that shape. Sorted by length rather
      // than by depth because the delimiter is the server's choice, and a
      // longer path is a deeper one under any delimiter.
      await withImapTestClient(imap, async (client: ImapFlow) => {
        const ours = (await listMailboxPaths(client))
          .filter((p) => p.startsWith('Ownpace-IT-'))
          .sort((a, b) => b.length - a.length);
        for (const path of ours) await client.mailboxDelete(path).catch(() => undefined);
      }).catch(() => undefined);
    }, 60_000);

    it('creates the mailbox and answers with an id the SERVER issued', async () => {
      const id = await writer.ensureMailbox(folder);

      // The whole bug in one line. `"0"` is the creation id we SENT; a server
      // id is something else, whatever else it is.
      expect(id).not.toBe('0');
      expect(id).toBeTruthy();

      // And the mailbox is really there — asked over IMAP, which knows nothing
      // about what JMAP believes it did.
      const paths = await withImapTestClient(imap, listMailboxPaths);
      expect(paths).toContain(NEW_FOLDER);
    }, 120_000);

    it('writes a message INTO that mailbox, which the wrong id could not do', async () => {
      const id = await writer.ensureMailbox(folder);

      const messageId = `<created-mailbox-${stamp}@dev.local>`;
      const rfc822 = new TextEncoder().encode(
        [
          'From: fixture@dev.local',
          `To: ${USER}`,
          'Subject: written into a mailbox this test created',
          `Message-ID: ${messageId}`,
          `Date: ${new Date().toUTCString()}`,
          'Content-Type: text/plain; charset=utf-8',
          '',
          'If this is in the right folder, the id ensureMailbox returned was real.',
          '',
        ].join('\r\n'),
      );

      const message: RawMessage = {
        rfc822,
        item: {
          messageId,
          folder,
          keywords: [],
          receivedAt: new Date().toISOString(),
          sourceRef: `${NEW_FOLDER}:1`,
        },
      };
      const result = await writer.upsertEmail(id, message, []);
      expect(result.created).toBe(true);

      // Counted over IMAP, in the folder BY NAME. This is the assertion the
      // `"0"` bug could never have passed: a message addressed to a mailbox id
      // that is not a mailbox does not land here.
      const count = await withImapTestClient(imap, (client: ImapFlow) =>
        countMessages(client, NEW_FOLDER),
      );
      expect(count).toBe(1);

      // And JMAP agrees about which mailbox it is in — the two protocols
      // reporting the same folder is what closes the loop.
      const entries: TargetEntry[] = [];
      for await (const entry of writer.listEntries()) entries.push(entry);
      const mine = entries.find((e) => e.naturalKey.includes(`created-mailbox-${stamp}`));
      expect(mine, 'listEntries did not report the message just written').toBeDefined();
      expect(mine!.mailboxId).toBe(id);
    }, 120_000);

    it('adopts on a second call rather than creating a second mailbox', async () => {
      const first = await writer.ensureMailbox(folder);
      // A fresh writer, so this cannot pass out of the first one's cache.
      const other = new JmapTargetWriter({ baseUrl: BASE, username: USER, password: PASSWORD });
      const second = await other.ensureMailbox(folder);

      expect(second).toBe(first);
      const paths = await withImapTestClient(imap, listMailboxPaths);
      expect(paths.filter((p: string) => p === NEW_FOLDER)).toHaveLength(1);
    }, 120_000);

    it('creates a real TREE under a target folder prefix, on a server that has its own Sent', async () => {
      // The merge-or-subfolder choice (owner decision 2026-08-16). reconcile.ts
      // composes the prefix into `path` and leaves `name` as the source leaf;
      // this connector read `name || path` and dropped the prefix entirely, so
      // a prefixed "Sent" landed in the account's OWN Sent and a prefixed
      // "Projects" was created at the root. Both silently.
      //
      // Against a real server this is also the only proof that `parentId`
      // works at all — nothing in this codebase had ever sent one.
      const sentUnderPrefix: MailFolder = {
        path: `${PREFIX}/Sent`,
        name: 'Sent',
        specialUse: 'sent',
      };
      const id = await writer.ensureMailbox(sentUnderPrefix);
      expect(id).toBeTruthy();

      const boxes = await withImapTestClient(imap, (client: ImapFlow) => client.list());
      const paths = boxes.map((b) => b.path);

      // The prefix exists at the root, and Sent exists INSIDE it. Read over
      // IMAP, whose delimiter the server chose — so the assertion is "a child
      // of the prefix" rather than a guess at the separator.
      expect(paths, `no ${PREFIX} was created`).toContain(PREFIX);
      const child = boxes.find(
        (b) => b.path !== PREFIX && b.path.startsWith(PREFIX) && b.name === 'Sent',
      );
      expect(child, `nothing named Sent under ${PREFIX}: ${paths.join(', ')}`).toBeDefined();

      // And it is NOT the account's sent mailbox: exactly one of those still
      // exists, and it is the one that was there before we started.
      const sent = await withImapTestClient(imap, sentMailboxes);
      expect(sent).toHaveLength(1);
      expect(mailboxesBefore).toContain(sent[0]);
      expect(child!.path).not.toBe(sent[0]);
      // The child carries no special-use flag of its own — a folder that
      // happens to be called Sent is not the account's Sent.
      expect(mapImapSpecialUse([...(child!.flags ?? [])])).toBe('normal');
    }, 120_000);

    it('reuses the prefix for the next folder rather than making a second one', async () => {
      await writer.ensureMailbox({
        path: `${PREFIX}/Projects`,
        name: 'Projects',
        specialUse: 'normal',
      });

      const paths = await withImapTestClient(imap, listMailboxPaths);
      expect(paths.filter((p: string) => p === PREFIX)).toHaveLength(1);
      expect(
        paths.filter((p: string) => p.startsWith(PREFIX) && p.endsWith('Projects')),
      ).toHaveLength(1);
    }, 120_000);

    it("adopts the account's OWN sent mailbox for a source 'Sent' — the owner's failure", async () => {
      // Verbatim, from the Live progress panel on 2026-08-22:
      //   Failed to create mailbox: {"0":{"type":"invalidProperties",
      //   "description":"A mailbox with role 'sent' already exists.",
      //   "properties":["role"]}}
      //
      // The scenario needs the account to ALREADY have a sent mailbox — that
      // is what makes the collision possible at all. Stalwart provisions one
      // as "Sent Items" (see `shared-mailbox.integration.test.ts`'s
      // `sentFolderIn`). Asserted rather than skipped-around: if the fixture
      // ever stops providing it, this file quietly stops testing the owner's
      // bug, and a loud failure pointing at the fixture is the only way to
      // notice. Fix the fixture; do not relax this.
      const sentBefore = await withImapTestClient(imap, sentMailboxes);
      expect(
        sentBefore,
        'the fixture account has no \\Sent mailbox, so the role collision this test ' +
          'exists for cannot occur — the fixture changed',
      ).toHaveLength(1);

      // A throw here IS the regression; there is nothing subtler to assert.
      const sentId = await writer.ensureMailbox({
        path: 'Sent',
        name: 'Sent',
        specialUse: 'sent',
      } satisfies MailFolder);
      expect(sentId).toBeTruthy();

      // No second sent folder beside the one the account had, and the one that
      // is left is the one that was there before — adopted, not replaced.
      const sentAfter = await withImapTestClient(imap, sentMailboxes);
      expect(sentAfter).toEqual(sentBefore);
      // And NOTHING new appeared at all, beyond the folder this file created
      // on purpose. A roleless "Sent" sitting beside "Sent Items" would be the
      // same duplication in a shape the role check above cannot see.
      const paths = await withImapTestClient(imap, listMailboxPaths);
      expect(paths.filter((p: string) => !mailboxesBefore.includes(p) && p !== NEW_FOLDER)).toEqual(
        [],
      );
    }, 120_000);
  });
}
