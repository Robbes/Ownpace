# CalDAV, CardDAV and WebDAV — calendars, contacts and files on a server

Three cards for three kinds of data, with the same fields: **CalDAV** for calendars and task lists, **CardDAV** for contacts and **WebDAV** for files. Many servers offer all three under one account. Each card carries only its own kind, so you create one migration per kind. If your server is a Nextcloud, the **Nextcloud** card combines the three in one connection: see [the Nextcloud guide](nextcloud.md). This service signs in with a user name and a password; there is no consent button.

## What you need {#before}

- An account on the target server that exists already, with enough room for what is coming. This service creates no accounts.
- The server's name and port, or the full address if the server's DAV root is not at the host root.
- The account's user name and a password. Where the server offers one, use an app-specific password rather than the account's own login: it can be revoked without changing the person's password.

## Connecting {#connect}

On the target step, pick the card for what this migration takes. The three cards ask for the same fields; [The fields](#fields) below says what goes in each box. Then press **Test and save connections**. The test writes nothing: it signs in and shows what the account carries (**Carries:**) and what it found (**Found:**).

### CalDAV {#caldav}

For calendars and task lists. Fill in **Host**, **Port**, **Username** and **Password** as [The fields](#fields) says. This service finds the account's calendars itself, starting from the server; **DAV base URL** is needed only when the server's DAV root is not at the host root.

### CardDAV {#carddav}

For contacts. Fill in **Host**, **Port**, **Username** and **Password** as [The fields](#fields) says. This service finds the account's address books itself, starting from the server; here too **DAV base URL** is needed only when the DAV root is not at the host root.

### WebDAV {#webdav}

For files. Fill in **Host**, **Port**, **Username** and **Password** as [The fields](#fields) says. Unlike CalDAV and CardDAV, WebDAV finds nothing by itself: the files go into the folder the address leads to. With only a host and a port, that is the server's root. For the files of your own account, type the full WebDAV address of that folder in **DAV base URL**. A Nextcloud shows that address at the bottom of the Files settings page; for a Nextcloud, [the Nextcloud card](nextcloud.md) is simpler.

### The fields {#fields}

- **Host**: the server's name, such as `dav.example.com`: the name alone, with no `https://` in front.
- **Port**: the example in the box is `443`.
- **Use SSL/TLS**: leave it ticked; this service then talks to the server over `https://`.
- **DAV base URL**: only when the server’s DAV root is not at the host root. When filled in, this full URL is used and host and port are ignored.
- **Username** and **Password**: those of the account on the server, with an app password where the server offers one.

You can also add a connection in advance, under **Connections** → **Add a connection**: choose the target under **Source or target?**, then the card, and press **Add and test**. The **Setup checklist** has the preparation for each of the three as a list that remembers what you have done.

## What moves {#what-moves}

- **CalDAV**: calendars with their events, and task lists when you tick **Tasks** on the migration step. Whether the server carries task lists is measured by the test. If it measured that this account does not, **Tasks** is locked with the line **This account cannot carry this; test it again if that changed.**
- **CardDAV**: address books and the contacts in them.
- **WebDAV**: files and the folders they are in.
- Writing a calendar sends nobody an invitation. Attendees and the organiser stay in your copy of each event, and each event is written so that the server sends no invitations for it.
- What a card does not carry is off on the migration step, with the line **Not available over the selected target protocol.** Email never goes to a DAV target: that is what the IMAP and JMAP targets are for ([the IMAP guide](imap.md), [the JMAP guide](jmap.md)).
- A migration may run again and again: what is already in the target is recognised and not copied a second time.

## When the test reports a problem {#when-test-says}

What the server itself answers, this service shows word for word, in the server's language; usually that is English.

- **`PROPFIND failed with status 401`**: the server refuses the user name or the password. Check both, and use an app password if the server asks for one.
- **`PROPFIND failed with status`** with another number, or **`Failed to discover calendar home set`** or **`Failed to discover address book home set`**: the address does not lead to this account's calendars, contacts or files. Check **Host** and **Port**, or type the full address in **DAV base URL**.
- **No answer within 20 seconds.** The test says so and keeps the connection anyway, so it can be tested again later.

## Stopping {#leaving}

- A migration is deleted under **Migrations**. The confirmation says what that does: **Removes the migration’s settings and record; nothing at your source or destination is touched.** What was already copied stays in the target.
- A connection is deleted under **Connections**, with **Delete**. That deletes this service's copy of the password. The password itself stays valid at the server, and the screen says so too: **We deleted our copy; this provider has no revocation we can call.**
- So revoke the app password at the server, or change the password. Only the account holder can.
