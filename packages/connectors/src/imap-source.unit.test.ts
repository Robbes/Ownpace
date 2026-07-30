// Copyright 2026 OpenHands Agent (Apache-2.0)
// Unit tests for IMAP source connector.

import { describe, it, expect, vi } from "vitest";
import type { ImapSimple } from "imap-simple";
import {
  ImapSource,
  type ImapSourceConfig,
  encodeImapCursor,
  decodeImapCursor,
  mapImapSpecialUse,
  foldersFromImapMailboxTree,
  type RawImapMailbox,
} from "../src/imap-source";
import type { SyncCursor } from "@openmig/shared";

describe("ImapSource", () => {
  describe("encodeImapCursor / decodeImapCursor", () => {
    it("encodes cursor correctly", () => {
      const encoded = encodeImapCursor(12345, 67890);
      expect(encoded).toBe("12345:67890");
    });

    it("decodes cursor correctly", () => {
      const cursor: SyncCursor = { value: "12345:67890" };
      const decoded = decodeImapCursor(cursor);
      expect(decoded).toEqual({ uidValidity: 12345, uidNext: 67890 });
    });

    it("throws on invalid cursor format", () => {
      const cursor: SyncCursor = { value: "invalid" };
      expect(() => decodeImapCursor(cursor)).toThrow(
        "Invalid IMAP cursor format",
      );
    });

    it("throws on non-numeric cursor values", () => {
      const cursor: SyncCursor = { value: "abc:def" };
      expect(() => decodeImapCursor(cursor)).toThrow(
        "Invalid IMAP cursor format",
      );
    });
  });

  describe("mapImapSpecialUse", () => {
    it("maps each RFC 6154 flag case-insensitively", () => {
      expect(mapImapSpecialUse(["\\Inbox"])).toBe("inbox");
      expect(mapImapSpecialUse(["\\Sent"])).toBe("sent");
      expect(mapImapSpecialUse(["\\Drafts"])).toBe("drafts");
      expect(mapImapSpecialUse(["\\Archive"])).toBe("archive");
      expect(mapImapSpecialUse(["\\Junk"])).toBe("junk");
      expect(mapImapSpecialUse(["\\Spam"])).toBe("junk");
      expect(mapImapSpecialUse(["\\Trash"])).toBe("trash");
      expect(mapImapSpecialUse(["\\Deleted"])).toBe("trash");
    });

    it("falls back to normal for an unflagged folder", () => {
      expect(mapImapSpecialUse(["\\HasNoChildren"])).toBe("normal");
      expect(mapImapSpecialUse([])).toBe("normal");
    });
  });

  describe("foldersFromImapMailboxTree", () => {
    // Regression test for a bug the self-host e2e's Apply-Deletion Gate found
    // (run #64): `listFolders()` read `mailbox.attributes`, but node-imap's own
    // `Folder` type — and everything that ever populates a real `getBoxes()`
    // response — calls the field `attribs`. `mailbox.attributes` was therefore
    // always `undefined`, every folder resolved to `specialUse: 'normal'`, and
    // both `excludeSpecialUse` (Trash/Junk were never excluded from content
    // sync) and the mail deletion signal (no bin was ever found to scan) were
    // silently broken. This fixture uses the REAL node-imap property name.
    it("reads `attribs`, not `attributes`, to detect a Trash folder", () => {
      const tree: Record<string, RawImapMailbox> = {
        INBOX: { attribs: ["\\HasNoChildren"] },
        "Deleted Items": { attribs: ["\\Trash", "\\HasNoChildren"] },
      };
      const folders = foldersFromImapMailboxTree(tree);
      const trash = folders.find((f) => f.path === "Deleted Items");
      expect(trash?.specialUse).toBe("trash");
    });

    it("recurses into nested mailboxes, building a fully-qualified path", () => {
      const tree: Record<string, RawImapMailbox> = {
        INBOX: { attribs: [] },
        Archive: {
          attribs: ["\\HasChildren"],
          delimiter: "/",
          children: {
            "2026": { attribs: [] },
          },
        },
      };
      const folders = foldersFromImapMailboxTree(tree);
      const nested = folders.find((f) => f.path === "Archive/2026");
      expect(nested).toBeDefined();
      expect(nested?.name).toBe("2026");
    });

    it("returns nothing for an absent tree rather than throwing", () => {
      expect(foldersFromImapMailboxTree(undefined)).toEqual([]);
      expect(foldersFromImapMailboxTree(null)).toEqual([]);
    });
  });

  describe("ImapSource.listFolders", () => {
    // Regression test for the OTHER half of run #64's bug, past the `attribs`
    // fix: `listFolders()` called the raw node-imap `getBoxes(namespace, cb)`
    // with zero arguments and cast the result to a promise-returning function.
    // That method is callback-only — called with nothing, `cb` stays
    // `undefined`, and node-imap enqueues LIST with no callback at all. The
    // `await` on that call was `await`ing `undefined` (a no-op), so `list` was
    // ALWAYS falsy and `listFolders()` ALWAYS fell back to a hardcoded
    // `[INBOX]`, regardless of what `attribs` said or what
    // `foldersFromImapMailboxTree` would have done with them — a unit test of
    // that pure function alone, as added alongside the first fix, could not
    // have caught this: it never exercises the call site. This test does, by
    // faking only the connection `imap-simple` hands back.
    function fakeConnection(tree: Record<string, RawImapMailbox>): ImapSimple {
      return {
        getBoxes: () => Promise.resolve(tree),
        openBox: () => Promise.resolve("INBOX"),
        end: () => undefined,
      } as unknown as ImapSimple;
    }

    it("actually sees a Trash-flagged folder from a real getBoxes() response", async () => {
      const source = new ImapSource({
        host: "imap.example.com",
        port: 993,
        tls: true,
        auth: { user: "test@example.com", password: "secret" },
      });
      vi.spyOn(source, "connect").mockResolvedValue(
        fakeConnection({
          INBOX: { attribs: ["\\HasNoChildren"] },
          "Deleted Items": { attribs: ["\\Trash", "\\HasNoChildren"] },
        }),
      );

      const folders = await source.listFolders();

      expect(folders.map((f) => f.path)).toContain("Deleted Items");
      expect(folders.find((f) => f.path === "Deleted Items")?.specialUse).toBe("trash");
    });
  });

  describe("ImapSource constructor", () => {
    it("creates instance with config", () => {
      const config: ImapSourceConfig = {
        host: "imap.example.com",
        port: 993,
        tls: true,
        auth: {
          user: "test@example.com",
          password: "secret",
        },
      };
      const source = new ImapSource(config);
      expect(source).toBeInstanceOf(ImapSource);
    });

    it("creates instance with XOAUTH2 config", () => {
      const config: ImapSourceConfig = {
        host: "outlook.office365.com",
        port: 993,
        tls: true,
        auth: {
          user: "test@example.com",
          accessToken: "bearer-token",
        },
        authType: "XOAUTH2",
      };
      const source = new ImapSource(config);
      expect(source).toBeInstanceOf(ImapSource);
    });
  });
});
