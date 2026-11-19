# Target Provider Documentation

This document describes the supported target providers for the IMAP/DAV target family, including configuration details, special-use folder handling, and known quirks.

## Who operates the target (ADR-0011)

**Every target listed here is operated by somebody who is not us.** A managed
European platform (Soverin, openDesk, mailbox.org, Infomaniak …) is run by that
provider under their own terms; a server you host yourself is run by you. This
tool migrates data *into* a target — it does not run, monitor, patch or back up
one, and it carries no service level for one.

This matters in three concrete places, so it is worth stating plainly rather
than leaving to be inferred:

- **Availability during a migration.** If the target is down, syncs fail and
  the failures queue says so verbatim. That is the target's outage, not a bug
  in the migration, and no amount of retrying here fixes it.
- **Backups.** Nothing in this product backs up the target. Once the migration
  finishes and the source is decommissioned, the target's backup arrangement is
  the only one protecting the data.
- **Support.** Questions about mailbox quotas, spam filtering, deliverability
  or client configuration on the target belong to whoever operates it.

The source side is the same story in reverse and with a stronger guarantee:
this tool never deletes anything on the source (hard rule 2), so the system
being migrated away from stays intact and remains the fallback until its owner
decides otherwise.

## Overview

The IMAP/DAV target family supports migration to European sovereign platforms that use standard IMAP for email delivery. This includes:

- **Soverin** (Netherlands) - OX-based mail suite
- **Cirrux** (Netherlands, hosted in Germany) - mail, calendar, contacts, tasks and a Drive
- **openDesk** (Germany) - Open-Xchange + Nextcloud bundle
- **Stalwart** - Reference server for development and testing
- Other IMAP-compatible providers

---

## Soverin

### Provider Details

- **Country:** Netherlands
- **Type:** Managed SaaS
- **Protocol:** IMAP/SMTP, CalDAV, CardDAV
- **Base URL:** Varies by instance
- **IMAP Port:** 993 (TLS required)

### Configuration Example

```json
{
  "type": "imap-dav",
  "host": "imap.soverin.net",
  "port": 993,
  "user": "user@example.com",
  "auth": {
    "kind": "login",
    "passwordFromEnv": "SOVERIN_PASSWORD"
  }
}
```

### Special-Use Folders

Soverin follows RFC 6154 for special-use mailbox names:

| Purpose | Soverin Name | RFC 6154 Flag |
|---------|--------------|---------------|
| Sent | `Sent` | `\Sent` |
| Drafts | `Drafts` | `\Drafts` |
| Trash | `Trash` | `\Trash` |
| Junk/Spam | `Junk` | `\Junk` |
| Archive | `Archive` | `\Archive` |

### Known Quirks

1. **Folder Separator:** Uses `/` (forward slash)
2. **Namespace:** Full IMAP namespace support
3. **Flags:** Supports standard IMAP flags + custom flags
4. **Quota:** Check via `GETQUOTAROOT` command

### Testing Notes

- Test with real Soverin account before production use
- Verify special-use folder creation works correctly
- Confirm flag preservation (especially `\Seen`, `\Answered`, `\Flagged`)

---

## Cirrux

The `cirrux` account kind (workplan 0160): Soverin's shape, one app password reaching mail over
IMAP and calendars, contacts and task lists over CalDAV and CardDAV. Every value below was read
from Cirrux's own help pages on 2026-11-19; the page is named beside each one. ⏳ Built and held
by unit tests; not yet run against a live Cirrux mailbox (0160 T2 is the owner's run).

### Provider Details

- **Company:** Werk Slim B.V., Hilversum, Netherlands (`https://cirrux.co/terms`)
- **Hosting:** Exoscale DE-FRA1, Frankfurt; a backup mail exchanger at Exoscale AT-VIE2,
  Vienna, that only holds inbound mail while Frankfurt is unreachable
  (`https://cirrux.co/help/reliability`)
- **Type:** Managed SaaS. One price per seat, €2,99 a month or €29 a year with 20 GB; Plus
  100 GB (€4,99 / €49), Large 500 GB (€9,99 / €99), Max 2 TB (€19,99 / €199). Storage is one
  pool per workspace, shared by mail, Drive, documents and Gmail backups; a workspace over its
  tier for seven days is moved to the smallest tier that fits, and uploads past the pool are
  refused. No free mailbox: a mailbox is paid from day one, with a 14-day refund
  (`https://cirrux.co/help/billing`)
- **Protocols:** IMAP, SMTP, CalDAV, CardDAV, all over TLS (`https://cirrux.co/help/encryption`).
  No WebDAV anywhere in the help pages.

### Settings (`https://cirrux.co/help/setup`, Manual Configuration)

| Face | Server | Port | Username | Password |
|---|---|---|---|---|
| Mail in (IMAP) | `imap.cirrux.co` | 993 (SSL) or 143 (STARTTLS) | the email address | an app password |
| Mail out (SMTP) | `smtp.cirrux.co` | 465 (SSL) or 587 (STARTTLS) | the email address | an app password |
| Calendar | `api.cirrux.co` | not given | the email address | an app password |
| Contacts | `api.cirrux.co` | not given | the email address | an app password |
| Reminders | `api.cirrux.co` | not given | the email address | an app password |

- The `cirrux` form pre-fills `api.cirrux.co` on 443 (HTTPS's own port, for a server named
  without one), `imap.cirrux.co` on 993, and leaves the DAV base URL empty: **no DAV path, no
  principal URL and no `/.well-known` discovery is documented**. The DAV clients look for the
  calendar home from the host's root (RFC 6764 and the principal's `calendar-home-set`), which
  is what any calendar app given "api.cirrux.co" must do; the first live Test measures it.
- **App passwords** are per mailbox: Cirrux Mail → Settings → Mailboxes → the mailbox →
  Passwords → New app password, shown once. The account's own password is refused for IMAP,
  SMTP and CalDAV. A workspace admin can switch the Passwords tab off, and then no app password
  can be made (`https://cirrux.co/help/setup`).

### Known Quirks

1. **Folders are labels** (`https://cirrux.co/help/questions/subfolders-in-my-mailbox`): a
   slash nests a label, IMAP shows labels as nested folders, and a folder created over IMAP
   becomes a label. Whether a message appended into two folders becomes one message with two
   labels or two messages is not documented (0160 T2 checks it).
2. **Each mailbox starts with** a default calendar, an address book called Contacts and a task
   list called Reminders (`https://cirrux.co/help/calendar`, `https://cirrux.co/help/api/contacts`,
   `https://cirrux.co/help/api/tasks`). A calendar collection may hold events and tasks at once.
3. **Invitations:** Cirrux Calendar emails guests for changes made in its app or its API
   (`https://cirrux.co/help/api/calendar`). Whether its CalDAV server honours
   `SCHEDULE-AGENT=CLIENT` is not documented; Test reads the server's own `DAV:` compliance
   header, and 0160 T2 runs the canary.
4. **Server-side filters** run "as mail arrives" and can forward (`https://cirrux.co/help/mailboxes`);
   the webhook documentation says imported mail and mail saved over IMAP never counts as
   received (`https://cirrux.co/help/api/webhooks`). Whether filters run on appended mail is
   not documented.
5. **No published limits** on message or attachment size, or on IMAP and DAV request rates.
   The HTTP API's limit is 600 requests a minute per token (`https://cirrux.co/help/api`).

### What is not reachable without Cirrux's HTTP API

- **Drive** (`https://cirrux.co/help/api/drive`): no WebDAV. The API needs a **user-scoped
  OAuth token**; a workspace API key (`cxk_…`) is refused. Scopes `drive.read`, `drive.create`,
  `drive.update`, `drive.delete`. A simple upload takes base64 JSON up to 100 MB; larger files,
  up to 2 GiB, go chunked with client-side AES-256-GCM in Cirrux's `CXDRV2` format. Names are
  unique per folder ignoring case and Unicode form; `base_ctag` refuses a stale replace with
  `409 version_conflict`; trash keeps items 30 days; `/v1/drive/changes` is a delta feed.
  0160 T5.
- **Docs** (`https://cirrux.co/help/docs`, `https://cirrux.co/help/api/documents`): Cirrux's
  own editor, in preview for accounts given early access; documents are stored in Drive and
  read and written as Markdown. A Word or OpenDocument file migrated into Drive stays a file.
- **OAuth clients are not self-service** (`https://cirrux.co/help/questions/oauth-client-for-my-app`):
  Cirrux sends a public client ID (PKCE S256, no secret) on request to help@cirrux.co, given
  the app's name, redirect URLs and scopes. Access tokens last 15 minutes, refresh tokens 30
  days, and every refresh retires the previous refresh token (`https://cirrux.co/help/api`).
- **Workspace API keys** reach the workspace and mail only (`workspace.read`, `email.read`,
  `email.write`, `email.send`), never calendars, contacts, tasks, Drive or documents
  (`https://cirrux.co/help/questions/script-or-agent-reads-and-sends-mail`). This tool writes
  mail over IMAP, so it needs none.
- **Webhooks** (`https://cirrux.co/help/api/webhooks`): one event, `email.received`, per
  mailbox, which does not fire for imported mail. A one-way migration into Cirrux has no use
  for it.

### Cirrux's own import, and where this tool complements it

Cirrux Sync reads Google (`https://cirrux.co/help/google-sync`) and Microsoft
(`https://cirrux.co/help/microsoft-sync`) accounts read-only, one way, every hour: mail,
calendars and contacts. It leaves Google Drive and OneDrive files behind, names no tasks, and
from Microsoft also leaves the online archive, event attachments, group calendars and contact
lists. For any other provider Cirrux has an IMAP import that runs when it is started
(`https://cirrux.co/help/imap-import`) and `.ics` / `.vcf` uploads. So for mail, calendars and
contacts from Google or a single Microsoft account Cirrux competes with this tool directly.
What this tool adds today: tasks (Microsoft To Do, Google Tasks, Apple Reminders into Cirrux's
CalDAV task lists), Apple iCloud and any IMAP/DAV source kept in step rather than copied once,
an administrator moving other people's Microsoft 365 mailboxes, and the ledger, verification
and decision queues. Files wait on the Drive connector (0160 T5).

---

## openDesk

### Provider Details

- **Country:** Germany (ZenDiS project)
- **Type:** Managed SaaS or self-hosted
- **Protocol:** IMAP/SMTP (Open-Xchange), CalDAV, CardDAV, WebDAV (Nextcloud)
- **Base URL:** Varies by instance
- **IMAP Port:** 993 (TLS required)

### Configuration Example

```json
{
  "type": "imap-dav",
  "host": "mail.opendesk.de",
  "port": 993,
  "user": "user@example.com",
  "auth": {
    "kind": "login",
    "passwordFromEnv": "OPENDESK_PASSWORD"
  }
}
```

### Special-Use Folders

openDesk (Open-Xchange) uses these folder names:

| Purpose | openDesk Name | Notes |
|---------|---------------|-------|
| Sent | `Sent Items` | Note: "Items" plural |
| Drafts | `Drafts` | Standard |
| Trash | `Deleted Items` | Note: "Items" plural |
| Junk | `Junk Email` | Note: Two words |
| Archive | `Archive` | Standard |

### Known Quirks

1. **Folder Names:** Open-Xchange uses "Items" plural for Sent and Trash
2. **Folder Separator:** Uses `/` (forward slash)
3. **Default Folders:** Pre-created on account setup
4. **Quota Display:** Available via `GETQUOTAROOT`

### Migration Notes

- **Proof Point:** Schleswig-Holstein migrated 40,000+ accounts and 100M+ mail/calendar items from Microsoft Exchange to Open-Xchange (late 2025)
- **Compatibility:** Full IMAP4rev1 support
- **Calendar/Contacts:** Use vdirsyncer for CalDAV/CardDAV sync (separate from IMAP email migration)

---

## Stalwart (Reference Server)

### Provider Details

- **Type:** Open-source reference server
- **Protocol:** JMAP + IMAP/DAV (dual protocol)
- **Use Case:** Local development, testing, self-hosting
- **IMAP Port:** 143 (STARTTLS) or 993 (TLS)

### Configuration Example (Development)

```json
{
  "type": "imap-dav",
  "host": "localhost",
  "port": 993,
  "user": "test@example.com",
  "auth": {
    "kind": "login",
    "passwordFromEnv": "STALWART_PASSWORD"
  }
}
```

### Special-Use Folders

Stalwart follows RFC 6154 strictly:

| Purpose | Stalwart Name | RFC 6154 Flag |
|---------|---------------|---------------|
| Sent | `Sent` | `\Sent` |
| Drafts | `Drafts` | `\Drafts` |
| Trash | `Trash` | `\Trash` |
| Junk | `Junk` | `\Junk` |
| Archive | `Archive` | `\Archive` |

### Setup for Testing

```bash
# Start Stalwart with IMAP support
docker run -d \
  --name stalwart-imap \
  -p 993:993 \
  -p 143:143 \
  -v stalwart-data:/data \
  stalwartlabs/stalwart:latest
```

See `docs/stalwart-integration-fix.md` for complete setup instructions.

---

## Other IMAP Providers

The IMAP/DAV target writer is designed to work with any standards-compliant IMAP server. Common providers include:

### Mailbox.org

- **IMAP Host:** `imap.mailbox.org`
- **Port:** 993 (TLS)
- **Special Folders:** Follows RFC 6154

### Mailfence

- **IMAP Host:** `imap.mailfence.com`
- **Port:** 993 (TLS)
- **Special Folders:** Follows RFC 6154

### Posteo

- **IMAP Host:** `imap.posteo.de`
- **Port:** 993 (TLS)
- **Special Folders:** Uses `Sent`, `Drafts`, `Trash`, `Junk`

### Infomaniak

- **IMAP Host:** `imap.infomaniak.com`
- **Port:** 993 (TLS)
- **Special Folders:** Follows RFC 6154

---

## Special-Use Folder Handling

### Automatic Detection

The `ImapDavMailTarget` automatically detects special-use folders using:

1. **RFC 6154 LIST EXTENSIONS:** Server-advertised special-use attributes
2. **Fallback Naming:** Common folder name patterns (Sent, Trash, etc.)

### Manual Configuration

If automatic detection fails, you can configure folder mappings in your migration config:

```json
{
  "type": "imap-dav",
  "host": "imap.example.com",
  "port": 993,
  "user": "user@example.com",
  "auth": { "kind": "login", "passwordFromEnv": "PASSWORD" },
  "folderMapping": {
    "sent": "Sent Items",
    "trash": "Deleted Items",
    "drafts": "Drafts",
    "junk": "Spam"
  }
}
```

---

## Authentication Methods

### Password Authentication (LOGIN)

Most common for IMAP/DAV targets:

```json
{
  "auth": {
    "kind": "login",
    "passwordFromEnv": "TARGET_PASSWORD"
  }
}
```

### OAuth2 Authentication (XOAUTH2)

Supported for providers that offer OAuth2:

```json
{
  "auth": {
    "kind": "xoauth2",
    "tokenFromEnv": "TARGET_OAUTH2_TOKEN"
  }
}
```

---

## Testing Checklist

Before migrating to a new provider, verify:

- [ ] IMAP connection successful (port 993 TLS)
- [ ] Authentication works with credentials
- [ ] Mailbox creation works
- [ ] Special-use folders are correctly identified
- [ ] Message upload (APPEND) works
- [ ] Message-ID lookup works (SEARCH HEADER)
- [ ] Flags are preserved (`\Seen`, `\Answered`, etc.)
- [ ] INTERNALDATE is preserved
- [ ] Idempotency works (re-upload same message → no duplicates)

---

## Troubleshooting

### Common Issues

**Issue:** "Mailbox not found" on upload
- **Solution:** Ensure `ensureMailbox()` is called before uploading messages

**Issue:** "Permission denied" on folder creation
- **Solution:** Check user has LITERAL+ permission or use CREATE command

**Issue:** Message uploaded but not visible
- **Solution:** Check if message was uploaded to wrong mailbox; verify folder separator

**Issue:** Flags not preserved
- **Solution:** Ensure flags are mapped correctly (`$seen` → `\Seen`)

### Debug Mode

Enable verbose logging for debugging:

```bash
export IMAP_DEBUG=1
pnpm worker --config mapping.json
```

---

## References

- [RFC 6154 - IMAP MAILBOX Creation](https://datatracker.ietf.org/doc/html/rfc6154)
- [RFC 3501 - IMAP4rev1](https://datatracker.ietf.org/doc/html/rfc3501)
- [Soverin Documentation](https://soverin.net/docs)
- [openDesk Documentation](https://opendesk.de/documentation)
- [Stalwart Documentation](https://stalwartlabs.org/documentation)

---

*This document was created by an AI agent (OpenHands) on behalf of the user.*
