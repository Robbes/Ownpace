# Cirrux — mail, calendars, contacts and tasks in one account

The **Cirrux** card is one account for a Cirrux mailbox: mail, calendars, contacts and task lists. Files are not among them: Cirrux Drive has no WebDAV address, and Cirrux's own interface for apps is one this service cannot use yet. This service signs in with the mailbox's email address and an app password; there is no consent button.

The servers below are the ones Cirrux publishes on its [setup page](https://cirrux.co/help/setup), under Manual Configuration, and on its [calendar page](https://cirrux.co/help/calendar), read on 19 November 2026.

## What you need {#before}

- A Cirrux mailbox, in a workspace with room for what is coming. Cirrux shares storage across the whole workspace: mail, Drive and documents count towards one pool. A workspace that stays over its storage tier for seven days is moved to a larger tier, and uploads that do not fit are refused until there is room ([billing](https://cirrux.co/help/billing)). This service creates no accounts.
- An app password for that mailbox. In Cirrux Mail: **Settings → Mailboxes**, pick the mailbox, open its **Passwords** tab and click **New app password**. Cirrux shows it once, so copy it at once. The password you sign in to Cirrux with does not work here: Cirrux refuses it for mail, calendars and contacts. No **Passwords** tab means the workspace's admin has switched off apps outside Cirrux; ask them to turn it back on.
- Whether mail moves too. Only then is the mail server needed; calendars, contacts and tasks need none.

## Connecting {#connect}

### Cirrux {#cirrux}

On **Where does it go?**, choose **Add Cirrux** under **A new account**, in each row whose data goes there: email, calendars, contacts or tasks. One form adds the account for all of them. Its servers are filled in already, folded under **Server settings (filled in for Cirrux)**, with the line **Pre-filled from Cirrux’s published settings, read …. Test checks them.** They are the values Cirrux publishes, not measured ones: the test measures them.

- **Host**: `api.cirrux.co`, the server Cirrux names for calendars, contacts and reminders alike.
- **Port**: `443`. Cirrux names the server without a port, which means the usual one for a secure connection.
- **Mail server**: `imap.cirrux.co`. Only needed if this account will also receive mail.
- **Mail port**: `993`.

Leave them as they are, unless Cirrux gives you other values. If mail moves, keep **Mail server** filled in: the test saves the account with what the boxes hold. Then fill in yourself:

1. **Username**: the mailbox's email address.
2. **Password**: the app password you made for that mailbox on its **Passwords** tab.
3. Press **Check the sign-in**.

There is no box for SSL/TLS: this service always uses it, for calendars, contacts and tasks and for mail. Leave **DAV base URL** empty: Cirrux names the server and no path, and this service looks for the calendars and address books from there, as a calendar app does with the same server name. When the test fails on a server, **Server settings** opens by itself.

The test writes nothing. It signs in to the calendars and also measures each part of the account on its own: what the account carries follows **Carries:**, and what it found follows **Found:**. Files show as not carried, with the reason.

You can also add the account in advance, under **Accounts** → **Add an account**: choose **Destinations** under **Source or destination?**, then the **Cirrux** card, and press **Add and test**. The boxes are pre-filled there in the same way, in plain view.

## What moves {#what-moves}

- **Email**, when the account is saved with its **Mail server**: the folders and the messages in them. Folders in Cirrux are labels. A folder this service creates becomes a label of the same name, nested under another where the name has a slash, and over IMAP every label shows as a folder again ([subfolders](https://cirrux.co/help/questions/subfolders-in-my-mailbox)).
- **Calendar**, **Contacts** and **Tasks**. Every Cirrux mailbox has a calendar, an address book called Contacts and a task list called Reminders. Task lists are calendars that hold tasks, on the same server as your calendars.
- Each event is written with a marker, `SCHEDULE-AGENT=CLIENT`, that tells the server not to send invitations for it. Attendees and the organiser stay in your copy of each event. A server that ignores the marker could still send invitations, and Cirrux does not say whether its calendar server reads it. Cirrux's own calendar does email guests when an event is made in its app.
- **Files** do not go to Cirrux: on **Where does it go?**, the row for files does not offer it. This service writes files over WebDAV, and Cirrux Drive has no WebDAV address: it is reached through Cirrux's own apps and its interface for apps ([Drive](https://cirrux.co/help/drive)). Your files can go to another destination in the same migration.
- A migration may run again and again: what is already in the target is recognised and not copied a second time.

## Cirrux's own import {#cirrux-sync}

Cirrux can copy from Google and Microsoft itself. Its Google Sync and Microsoft Sync read mail, calendars and contacts, one way, and look for changes every hour ([Google Sync](https://cirrux.co/help/google-sync), [Microsoft Sync](https://cirrux.co/help/microsoft-sync)). They leave Google Drive and OneDrive files behind, and they name no tasks. For other providers, Cirrux's IMAP import copies mail each time you start it, and calendars and contacts come across as files you upload.

Choose one of the two for each kind of data. Both write into the same mailbox, calendars and address book, and neither knows what the other wrote.

## When the test reports a problem {#when-test-says}

What Cirrux itself answers, this service shows word for word, in the server's language; usually that is English.

- **`PROPFIND failed with status 401`** for calendars or contacts: Cirrux refuses the email address or the password for that part. Check both, and check that the password is an app password: the password you sign in to Cirrux with is refused.
- A refusal from the mail server, for example with `AUTHENTICATIONFAILED`: the password does not work for mail. App passwords belong to one mailbox, so check that this one was made on this mailbox's **Passwords** tab.
- No calendars or address books found, where the mailbox has them: Cirrux publishes the server and not the path under it. Ask Cirrux's support, at help@cirrux.co, for the address of your mailbox's calendars and address books, and put it in **DAV base URL**.
- **Email** followed by **This account stores no mail server address, so mail was not measured**: the account was saved without a **Mail server**. If mail moves, see the next point.
- An account saved without a **Mail server** carries no mail. A migration with **Email** ticked is still made on it, and its mail fails when it runs, with **This cirrux connection stores no mail server, so its mail face cannot be built**. Delete that migration under **Migrations**, then the account under **Accounts**, and start again with the **Mail server** filled in. Calendars, contacts and tasks need no mail server, so a migration without **Email** can stay on that account.
- **No answer within 20 seconds.** The test says so.
- **A failed test starts afresh.** **Try again** takes away the account the failed test saved and opens the form again with what you typed, so corrected servers and ports are tested as typed. On the **Accounts** page, delete the account that failed and add it again.

## Stopping {#leaving}

- A migration is deleted under **Migrations**. The confirmation says what that does: **Removes the migration’s settings and record; nothing at your source or destination is touched.** What was already copied stays at Cirrux.
- An account is deleted under **Accounts**, with **Delete**. That deletes this service's copy of the app password. The app password itself stays valid at Cirrux, and the screen says so too: **We deleted our copy; this provider has no revocation we can trigger.**
- So delete the app password at Cirrux: in Cirrux Mail, **Settings → Mailboxes**, the mailbox, its **Passwords** tab. Your Cirrux password stays as it is.
