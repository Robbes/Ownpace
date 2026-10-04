# CalDAV, CardDAV and WebDAV — calendars, contacts and files on a server

Three cards for three kinds of data, with the same fields: **CalDAV** for calendars and task lists, **CardDAV** for contacts and **WebDAV** for files. Many servers offer all three under one account. Each card carries only its own kind, so each kind goes to its own card, and **Start a migration** makes a migration for each. If your server is a Nextcloud, the **Nextcloud** card combines the three in one account: see [the Nextcloud guide](nextcloud.md). This service signs in with a user name and a password; there is no consent button.

## What you need {#before}

- An account on the target server that exists already, with enough room for what is coming. This service creates no accounts.
- The server's name and port, or the full address if the server's DAV root is not at the host root.
- The account's user name and a password. Where the server offers one, use an app-specific password rather than the account's own login: it can be revoked without changing the person's password.

## Connecting {#connect}

On **Where does it go?**, each kind of data has a row of its own. In the row's list, under **A new account**, choose **Add CalDAV** for calendars and tasks, **Add CardDAV** for contacts or **Add WebDAV** for files, and the card's form opens below the rows. The three cards ask for the same fields; [The fields](#fields) below says what goes in each box. Then press **Check the sign-in**, which tests the account. The test writes nothing: it signs in and shows what the account carries (**Carries:**) and what it found (**Found:**).

### CalDAV {#caldav}

For calendars and task lists. Fill in **Host**, **Port**, **Username** and **Password** as [The fields](#fields) says. The test looks the account's calendars up from the server. The migration writes new calendars under the server's address, or under **DAV base URL** when it is filled in, in `calendars/` followed by the user name: the layout Nextcloud uses. On a server that keeps its calendars elsewhere, the test can pass and the migration still fail to write.

### CardDAV {#carddav}

For contacts. Fill in **Host**, **Port**, **Username** and **Password** as [The fields](#fields) says. The test looks the account's address books up from the server. The migration writes new address books under the server's address, or under **DAV base URL** when it is filled in, in `addressbooks/users/` followed by the user name: the layout Nextcloud uses. On a server that keeps its address books elsewhere, the test can pass and the migration still fail to write.

### WebDAV {#webdav}

For files. Fill in **Host**, **Port**, **Username** and **Password** as [The fields](#fields) says. WebDAV has no layout of its own: the files go into the folder the address leads to. With only a host and a port, that is the server's root. For the files of your own account, type the full WebDAV address of that folder in **DAV base URL**. A Nextcloud shows that address at the bottom of the Files settings page; for a Nextcloud, [the Nextcloud card](nextcloud.md) is simpler.

### The fields {#fields}

- **Host**: the server's name, such as `dav.example.com`: the name alone, with no `https://` in front.
- **Port**: `443` for most servers, which the box shows as its example. Type it in, or the port your server uses. There is no box for SSL/TLS: this service always talks to the server over `https://`.
- **DAV base URL**, under **Server settings** on **Where does it go?**: only when the server’s DAV root is not at the host root. When filled in, this full URL is used and host and port are ignored.
- **Username** and **Password**: those of the account on the server, with an app password where the server offers one.

You can also add the account in advance, under **Accounts** → **Add an account**: choose **Targets** under **Source or target?**, then the card, and press **Add and test**. **Where does it go?** then offers it under **Your accounts**. The **Setup checklist** has the preparation for each of the three as a list that remembers what you have done.

## What moves {#what-moves}

- **CalDAV**: calendars with their events, and task lists when you tick **Tasks** on **What moves?**. The test counts the task lists the account already has, after **Found:**.
- **CardDAV**: address books and the contacts in them.
- **WebDAV**: files and the folders they are in.
- Each event is written with a marker, `SCHEDULE-AGENT=CLIENT`, that tells the server not to send invitations for it. Attendees and the organiser stay in your copy of each event. A server that ignores the marker could still send invitations.
- Each row on **Where does it go?** offers only the cards that take its data, and where a card chosen in one row cannot take another row's data, that row says so: *CalDAV does not take contacts.* Email never goes to a DAV target: that is what the IMAP and JMAP targets are for ([the IMAP guide](imap.md), [the JMAP guide](jmap.md)).
- A migration may run again and again: what is already in the target is recognised and not copied a second time.

## When the test reports a problem {#when-test-says}

What the server itself answers, this service shows word for word, in the server's language; usually that is English.

- **`PROPFIND failed with status 401`**: the server refuses the user name or the password. Check both, and use an app password if the server asks for one.
- **`PROPFIND failed with status`** with another number, or **`Failed to discover calendar home set`** or **`Failed to discover address book home set`**: the address does not lead to this account's calendars, contacts or files. Check **Host** and **Port**, or type the full address in **DAV base URL**.
- **No answer within 20 seconds.** The test says so.
- **A failed test starts afresh.** **Try again** takes away the account the failed test saved and opens the form again with what you typed, so a corrected **Host**, **Port** or **DAV base URL** is tested as typed. On the **Accounts** page, delete the account that failed and add it again.

## Stopping {#leaving}

- A migration is deleted under **Migrations**. The confirmation says what that does: **Removes the migration’s settings and record; nothing at your source or destination is touched.** What was already copied stays in the target.
- An account is deleted under **Accounts**, with **Delete**. That deletes this service's copy of the password. The password itself stays valid at the server, and the screen says so too: **We deleted our copy; this provider has no revocation we can call.**
- So revoke the app password at the server, or change the password. Only the account holder can.
