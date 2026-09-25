# Nextcloud — calendars, contacts, files and tasks in one connection

The **Nextcloud** card is one connection for what a Nextcloud keeps: calendars, contacts, files and task lists. Mail is not among them. A Nextcloud is not a mail server, so your mail lives somewhere else; for mail, create a migration of its own to an IMAP or JMAP target ([the IMAP guide](imap.md), [the JMAP guide](jmap.md)). This service signs in with your user name and an app password; there is no consent button.

## What you need {#before}

- An account on the Nextcloud that exists already, with enough room for what is coming. This service creates no accounts.
- The address you open Nextcloud at in the browser, such as `https://cloud.example.com`.
- An [app password](#app-password) for that account.

## Connecting {#connect}

### Create an app password {#app-password}

Use an app password rather than the account's own password: it can be revoked without changing your own password.

1. Open your Nextcloud in the browser.
2. Go to **Settings** → **Security** → **Devices & sessions**.
3. Choose **Create new app password** and copy the password Nextcloud shows.

### Nextcloud {#nextcloud}

1. On the target step, pick the **Nextcloud** card.
2. In **DAV base URL**, type the address you open Nextcloud at, with `/remote.php/dav` on the end, such as `https://cloud.example.com/remote.php/dav`.
3. In **Username**, type your Nextcloud user name (see below).
4. In **Password**, type the app password.
5. Press **Test and save connections**.

There is no box for a host or a port. Nextcloud serves calendars, contacts and files under `/remote.php/dav` rather than at the root of the site, so a host and a port cannot say where it is.

Files go into your own files, under the user name you type: this service writes them to `/remote.php/dav/files/` followed by that name. So use the user name Nextcloud puts in that address. Nextcloud shows the WebDAV address at the bottom of the Files settings page.

The test writes nothing. It signs in and shows what the account carries (**Carries:**) and what it found (**Found:**).

You can also add the connection in advance, under **Connections** → **Add a connection**: choose the target under **Source or target?**, then the **Nextcloud** card, and press **Add and test**.

## What moves {#what-moves}

- **Calendar**, **Contacts**, **Files** and **Tasks**, as far as you tick them on the migration step.
- A task list is, in a Nextcloud, a calendar that holds tasks. Task lists move when **Tasks** is ticked.
- **Files** go into your own files, with the folders they are in.
- Writing a calendar sends nobody an invitation. Attendees and the organiser stay in your copy of each event, and each event is written so that the server sends no invitations for it.
- **Email** does not go to a Nextcloud. On the migration step it is off, with the line **Not available over the selected target protocol.**
- A migration may run again and again: what is already in the target is recognised and not copied a second time.

## When the test reports a problem {#when-test-says}

What Nextcloud itself answers, this service shows word for word, in the server's language; usually that is English.

- **`PROPFIND failed with status 401`**: Nextcloud refuses the user name or the password. Check both. If the app password was revoked, create a new one.
- **`PROPFIND failed with status`** with another number: the address does not lead to your Nextcloud's DAV root. Check that **DAV base URL** ends in `/remote.php/dav`.
- **No answer within 20 seconds.** The test says so and keeps the connection anyway, so it can be tested again later.

## Stopping {#leaving}

- A migration is deleted under **Migrations**. The confirmation says what that does: **Removes the migration’s settings and record; nothing at your source or destination is touched.** What was already copied stays in your Nextcloud.
- A connection is deleted under **Connections**, with **Delete**. That deletes this service's copy of the app password. The app password itself stays valid at Nextcloud, and the screen says so too: **We deleted our copy; this provider has no revocation we can call.**
- So revoke the app password at Nextcloud, under **Settings** → **Security** → **Devices & sessions**, where you created it.
