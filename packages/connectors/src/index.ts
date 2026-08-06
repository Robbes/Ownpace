// Copyright 2026 OpenHands Agent (Apache-2.0)
// T1 contracts live in @openmig/shared (see ports.ts); implement impls per docs/workplans/0001-first-slice-jmap-mail.md.
export const packageName = '@openmig/connectors';

// The IMAP conventions both clients share — flag mapping both ways, the two
// message-id conventions, the cursor encoding. Client-neutral by design.
export * from './imap-conventions';

export * from './imap-source';

// The imapflow read path (0032 T1), shipped BESIDE the proven client rather
// than instead of it — `imap-parity.integration.test.ts` is what compares them.
export * from './imapflow-source';

// Session loading for every JMAP writer here (0031 T4 follow-up). Its own file
// because all four call sites must share it: the moment one of them keeps
// `JamClient.loadSession`, a rejected credential goes back to being reported as
// a missing account on that one path only.
export * from './jmap-session';

export * from './jmap-target';
// Contacts over JMAP (0031 T2). Beside the mail target rather than beside the
// DAV writers in @openmig/engines: it shares this file's transport concerns —
// session discovery, the unroutable advertised apiUrl, rate-limit retry — not
// theirs.
export * from './jmap-contact-target';

// Files as a JMAP target (0031 T3). Same reasoning as the contacts writer for
// why it lives here rather than beside the WebDAV writer in @openmig/engines.
export * from './jmap-file-target';

// Which domains a JMAP server can actually carry (0031 T4) — the question the
// per-domain target picker cannot be built without being able to ask.
export * from './jmap-capabilities';

// The imap-simple -> imapflow parity harness (0032 T0). Exported because T1/T2
// wire it into an integration test, and because a harness nobody can reach is
// a harness nobody runs.
export * from './imap-parity';

// The WRITE-path parity harness (0032 T2) — the half of T0's charter that was
// left for whenever the write path was ported.
export * from './imap-target-parity';
export * from './imap-dav-target';

// The imapflow WRITE path (0032 T2), shipped BESIDE the proven writer — the
// half that can lose data, so nothing is cut over until the parity harness has
// run against it.
export * from './imapflow-dav-target';

// DAV shared HTTP types
export * from './dav-http.types';

// CalDAV source connector
export * from './caldav-source';
export * from './caldav-source.types';

// CardDAV source connector
export * from './carddav-source';
export * from './carddav-source.types';

// WebDAV file source connector
export * from './webdav-source';
export * from './webdav-source.types';

// Token provider
export * from './token-provider';

// Graph Calendar source connector
export * from './graph-calendar-source';
export * from './graph-calendar-source.types';

// Graph Contacts source connector
export * from './graph-contacts-source';
export * from './graph-contacts-source.types';

export * from './graph-mail-source';
export * from './graph-mail-source.types';

export * from './mail-source-with-graph-fallback';

// The notification channel's SMTP binding (workplan 0030 T1) — the only
// nodemailer import in the workspace; see the file header for why it lives
// here rather than in @openmig/shared.
export * from './smtp-transport';
export * from './notifier-from-env';
export * from './graph-scope';
export * from './graph-directory';
export * from './directory-availability';
// Shared-address discovery (0027 T1) — and IMAP's honest "I cannot look".
export * from './graph-groups';
export * from './imap-groups';
// The permission inventory's read layer (0029 T1, SAD §14.2).
export * from './graph-permissions';
export * from './graph-permission-scan';
export * from './drive-sharing-availability';
// Proving the consent runbook actually worked (0027 T0).
export * from './graph-access-check';
