// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Gmail as a MAIL source (workplan 0044) — the second Google provider, built
 * from parts that already exist and one part that is genuinely Gmail's own.
 *
 * WHAT IS REUSED, deliberately: the transport is plain IMAP over XOAUTH2
 * (`imap.gmail.com:993`), so the whole imapflow source — listing, fetching,
 * cursors, the trash scan that feeds deletion evidence — runs unchanged. The
 * token is minted by the SAME `GoogleTokenProvider` the Drive source uses,
 * with a different scope: `https://mail.google.com/`, which is the one scope
 * Google accepts for IMAP XOAUTH2 (the granular gmail.readonly scopes are for
 * the REST API and are refused at the IMAP door). The provider is handed to
 * the source as its `tokenProvider`, so every connection mints fresh and an
 * auth error mid-pass refreshes — no static token to expire.
 *
 * WHAT IS GMAIL'S OWN: labels. Gmail's IMAP surface presents each label as a
 * folder AND presents three views that contain other folders' messages again —
 * All Mail (`\All`), Starred (`\Flagged`) and Important (`\Important`). Copy
 * those and every message is migrated once per view it appears in; worse, the
 * ledger keys mail by Message-ID, so the second sighting reads as the item
 * having MOVED, and the moves queue fills with reports describing Gmail's UI
 * rather than anything the owner did. `gmailVisibleFolders` drops the three
 * views and keeps everything real: INBOX, the owner's labels, Sent, Drafts.
 * Trash and Spam are left to the existing `excludeSpecialUse` machinery, which
 * excludes them from the COPY while the mail engine scans the trash for
 * deletion evidence — exactly as it does for every other IMAP source.
 */

import type { MailFolder, MailItem, RawMessage, SourceConnector, SyncCursor, TokenProvider } from '@openmig/shared';
import { GoogleTokenProvider } from '@openmig/connectors';
import { buildImapSourceFrom } from './mail-source-factory';
import type { GoogleCredentialNaming, GoogleCredentialsAsFound } from './drive-source-factory';

/**
 * The one scope Google's IMAP endpoint accepts for XOAUTH2.
 *
 * Full mail access as far as the SCOPE is concerned — but this product never
 * writes through it: the source connector has no write path, and the target of
 * a migration is never Gmail. Stated because "readonly" is the Drive scope's
 * property, not this one's, and pretending otherwise would be a lie an audit
 * finds in a minute.
 */
export const GMAIL_SCOPE = 'https://mail.google.com/';

/** Appliance: the operator sets these in the environment. */
export const ENV_GMAIL_CREDENTIAL_NAMES: GoogleCredentialNaming = {
  clientId: 'GOOGLE_CLIENT_ID',
  clientSecret: 'GOOGLE_CLIENT_SECRET',
  // Its own variable, not GOOGLE_REFRESH_TOKEN: a refresh token carries the
  // scopes it was CONSENTED with, and a Drive-consented token answers
  // `invalid_scope` at mint time. Two names make "which consent is this"
  // visible in the config instead of discovered in an error.
  refreshToken: 'GOOGLE_MAIL_REFRESH_TOKEN',
  where: "the appliance's environment",
};

/** Managed: the operator stores them on the connection, encrypted. */
export const STORED_GMAIL_CREDENTIAL_NAMES: GoogleCredentialNaming = {
  clientId: 'clientId',
  clientSecret: 'clientSecret',
  refreshToken: 'refreshToken',
  where: "the source connection's stored credentials",
};

/** The managed `connection.kind` for a Gmail source (migration 0012). */
export const GMAIL_CONNECTION_KIND = 'gmail';

/**
 * Gmail's view-folders, which contain other folders' messages AGAIN.
 *
 * `\All` is every message; `\Flagged` (Starred) and `\Important` are Google's
 * own selections of them. None is a place a message lives — they are ways of
 * looking at messages that live somewhere else — and copying a view duplicates
 * its entire contents on the target.
 *
 * Recognised by the RAW LIST attribute (`MailFolder.listAttributes`), the only
 * signal that survives contact with reality: by NAME the folders are localised
 * ("[Gmail]/Alle berichten"), and by ROLE they are invisible — `specialUse`
 * maps the six RFC 6154 roles the product acts on and folds `\All`, `\Flagged`
 * and `\Important` into 'normal', exactly like a real folder. Lower-cased for
 * comparison because IMAP attributes are case-insensitive and
 * `mapImapSpecialUse` already compares them that way.
 */
const GMAIL_VIEW_ATTRIBUTES = new Set(['\\all', '\\flagged', '\\important']);

/** The folders that are real: everything except Gmail's view-folders. */
export function gmailVisibleFolders(
  folders: ReadonlyArray<MailFolder>,
): ReadonlyArray<MailFolder> {
  return folders.filter(
    (f) => !(f.listAttributes ?? []).some((a) => GMAIL_VIEW_ATTRIBUTES.has(a.toLowerCase())),
  );
}

/**
 * A SourceConnector that hides Gmail's view-folders and delegates the rest.
 *
 * Explicit delegation of the interface's three methods rather than a spread —
 * a spread of a class instance loses its prototype methods and produces an
 * object that typechecks and cannot list a folder.
 *
 * Exported for unit tests: the delegation and the filter are the behaviour
 * worth pinning, and they need no IMAP server to prove.
 */
export class GmailFolderView implements SourceConnector {
  constructor(private readonly inner: SourceConnector) {}

  async listFolders(): Promise<ReadonlyArray<MailFolder>> {
    return gmailVisibleFolders(await this.inner.listFolders());
  }

  listSince(
    folder: MailFolder,
    cursor?: SyncCursor,
  ): ReturnType<SourceConnector['listSince']> {
    return this.inner.listSince(folder, cursor);
  }

  fetch(item: MailItem): Promise<RawMessage> {
    return this.inner.fetch(item);
  }
}

/** Test seam: how the token provider is made. Production uses the default. */
export type GmailTokenProviderFactory = (
  creds: { clientId: string; clientSecret: string; refreshToken: string },
  scope: string,
) => TokenProvider;

/**
 * Build the Gmail source, refusing at BUILD TIME when a credential is missing.
 *
 * The same shape as `buildGoogleDriveSourceFrom`, for the same reason: a
 * source constructed without usable credentials fails on its first listing,
 * inside a pass, as a folder-level error that reads like Gmail is down.
 * Refusing here names the missing values and where they go, in whichever
 * vocabulary — environment variable or stored credential — the operator can
 * actually act on.
 */
export function buildGmailSourceFrom(
  user: string,
  creds: GoogleCredentialsAsFound,
  naming: GoogleCredentialNaming = ENV_GMAIL_CREDENTIAL_NAMES,
  makeTokenProvider: GmailTokenProviderFactory = (c, scope) =>
    new GoogleTokenProvider(c, { scope }),
): SourceConnector {
  const missing: string[] = [];
  if (!creds.clientId) missing.push(naming.clientId);
  if (!creds.clientSecret) missing.push(naming.clientSecret);
  if (!creds.refreshToken) missing.push(naming.refreshToken);
  if (missing.length > 0) {
    throw new Error(
      `Gmail source is missing ${missing.join(', ')} in ${naming.where}. All three are ` +
        'required: the OAuth client (id + secret) and a refresh token consented with the ' +
        `${GMAIL_SCOPE} scope — a Drive-consented token will not mint mail tokens. ` +
        'docs/google-workspace-setup.md walks through obtaining each.',
    );
  }
  if (!user) {
    throw new Error(
      'Gmail source is missing the account address (`user`): XOAUTH2 authenticates a token ' +
        'FOR an address, and Google refuses the handshake without one.',
    );
  }

  const tokenProvider = makeTokenProvider(
    {
      clientId: creds.clientId!,
      clientSecret: creds.clientSecret!,
      refreshToken: creds.refreshToken!,
    },
    GMAIL_SCOPE,
  );

  return new GmailFolderView(
    buildImapSourceFrom(
      // Gmail's IMAP endpoint is fixed; asking the operator to type it would
      // only invite typos (the same argument the O365 path records).
      { host: 'imap.gmail.com', port: 993, tls: true, user },
      { authType: 'XOAUTH2', tokenProvider },
    ),
  );
}
