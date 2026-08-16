// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
/** RFC 6154 special-use mailbox roles we care about (plus 'normal' for everything else). */
export type SpecialUse = 'inbox' | 'sent' | 'drafts' | 'archive' | 'junk' | 'trash' | 'normal';

/** JMAP keywords / IMAP system flags we map. Subset used by the first slice. */
export type MailKeyword = '$seen' | '$flagged' | '$draft' | '$answered';

export interface MailFolder {
  /** Stable source path/name, e.g. "INBOX" or "INBOX/Projects". */
  readonly path: string;
  /** Human label (usually the last path segment) if known. */
  readonly name?: string;
  /** Detected special-use role (RFC 6154); 'normal' if none. */
  readonly specialUse: SpecialUse;
  /**
   * The server's RAW LIST attributes, verbatim, when the connector has them.
   *
   * `specialUse` maps the six roles the product acts on and folds everything
   * else to 'normal' — which erases attributes that are not roles but VIEWS.
   * Gmail advertises `\All` (All Mail), `\Flagged` (Starred) and `\Important`
   * on folders that re-present other folders' messages; a consumer that needs
   * to recognise those (gmail-source-factory, workplan 0044) must see the
   * attribute itself, because by name the folders are localised ("Alle
   * berichten") and by role they are indistinguishable from a real folder.
   * Optional: fakes and non-IMAP sources simply omit it.
   */
  readonly listAttributes?: ReadonlyArray<string>;
}

export interface MailAddress {
  readonly email: string;
  readonly name?: string;
}

/**
 * Normalized mail item flowing through the engine.
 * `messageId` is the idempotency anchor (the natural key); the RFC822 bytes are
 * fetched lazily via `sourceRef` by the source connector.
 */
export interface MailItem {
  /** RFC 5322 Message-ID, including angle brackets as received. The natural key. */
  readonly messageId: string;
  /** Folder this item belongs to (source-side). */
  readonly folder: MailFolder;
  /** Keywords/flags set on the message. */
  readonly keywords: ReadonlyArray<MailKeyword>;
  /** Original delivery/receipt time (IMAP INTERNALDATE), ISO 8601. */
  readonly receivedAt: string;
  /** Size in bytes, if known. */
  readonly size?: number;
  /** Opaque source handle the connector uses to fetch raw bytes (e.g. "INBOX:42"). */
  readonly sourceRef: string;
}

/** RFC822 bytes plus the item they belong to. */
export interface RawMessage {
  readonly item: MailItem;
  readonly rfc822: Uint8Array;
}
