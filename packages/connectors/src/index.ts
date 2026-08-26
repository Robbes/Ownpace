// Copyright 2026 OpenHands Agent (Apache-2.0)
// T1 contracts live in @openmig/shared (see ports.ts); implement impls per docs/workplans/0001-first-slice-jmap-mail.md.
export const packageName = '@openmig/connectors';

// The IMAP conventions both clients share — flag mapping both ways, the two
// message-id conventions, the cursor encoding. Client-neutral by design.
export * from './imap-conventions.ts';


// The IMAP read path. `imap-parity.integration.test.ts` compared it field by
// field against the `imap-simple` implementation on a real server before that
// one was removed (0032 T3a/T3b).
export * from './imapflow-source.ts';

// Session loading for every JMAP writer here (0031 T4 follow-up). Its own file
// because all four call sites must share it: the moment one of them keeps
// `JamClient.loadSession`, a rejected credential goes back to being reported as
// a missing account on that one path only.
export * from './jmap-session.ts';

export * from './jmap-target.ts';
// Contacts over JMAP (0031 T2). Beside the mail target rather than beside the
// DAV writers in @openmig/engines: it shares this file's transport concerns —
// session discovery, the unroutable advertised apiUrl, rate-limit retry — not
// theirs.
export * from './jmap-contact-target.ts';

// Files as a JMAP target (0031 T3). Same reasoning as the contacts writer for
// why it lives here rather than beside the WebDAV writer in @openmig/engines.
export * from './jmap-file-target.ts';

// Which domains a JMAP server can actually carry (0031 T4) — the question the
// per-domain target picker cannot be built without being able to ask.
export * from './jmap-capabilities.ts';

// The IMAP write path. Both parity harnesses — read and write — and the
// `imap-simple` implementation they compared against were removed by 0032 T3b
// once the e2e was green on this path twice. What that bought and what it cost
// is written down in that workplan's T3b row rather than implied here.
export * from './imapflow-dav-target.ts';

// DAV shared HTTP types
export * from './dav-http.types.ts';

// CalDAV source connector
export * from './caldav-source.ts';
export * from './caldav-source.types.ts';

// CardDAV source connector
export * from './carddav-source.ts';
export * from './carddav-source.types.ts';

// WebDAV file source connector
export * from './webdav-source.ts';
export * from './webdav-source.types.ts';

// Token provider
export * from './token-provider.ts';

// Graph Calendar source connector
export * from './graph-calendar-source.ts';
export * from './graph-calendar-source.types.ts';

// Graph Contacts source connector
export * from './graph-contacts-source.ts';
export * from './graph-contacts-source.types.ts';
// Dropbox as a file source (workplan 0055).
export * from './dropbox-file-source.ts';
export * from './dropbox-file-source.types.ts';
export * from './dropbox-token-provider.ts';
export * from './box-file-source.ts';
export * from './box-file-source.types.ts';
export * from './box-token-provider.ts';
// OneDrive/SharePoint (workplan 0054) — unexported until its first caller.
export * from './graph-drive-source.ts';
export * from './graph-drive-source.types.ts';

export * from './graph-mail-source.ts';
export * from './graph-mail-source.types.ts';

export * from './mail-source-with-graph-fallback.ts';

// The notification channel's SMTP binding (workplan 0030 T1) — the only
// nodemailer import in the workspace; see the file header for why it lives
// here rather than in @openmig/shared.
export * from './smtp-transport.ts';
export * from './notifier-from-env.ts';
export * from './graph-scope.ts';
export * from './graph-directory.ts';
export * from './directory-availability.ts';
// Shared-address discovery (0027 T1) — and IMAP's honest "I cannot look".
export * from './graph-groups.ts';
export * from './imap-groups.ts';
// The permission inventory's read layer (0029 T1, SAD §14.2).
export * from './graph-permissions.ts';
export * from './graph-permission-scan.ts';
export * from './drive-sharing-availability.ts';
export * from './nextcloud-ocs.ts';
// Proving the consent runbook actually worked (0027 T0).
export * from './graph-access-check.ts';
// Google Drive as a file source (workplan 0042): the connector, the OAuth flow
// it deliberately knows nothing about, and the transport that joins them.
export * from './google-drive-source.ts';
export * from './google-drive-source.types.ts';
export * from './google-drive-transport.ts';
export * from './google-token-provider.ts';
export * from './token-revoker.ts';
export * from './google-jwt-bearer-provider.ts';
export * from './caldav-scheduling-probe.ts';
