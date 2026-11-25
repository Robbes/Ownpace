# Cirrux — mail, calendars, contacts, tasks and Drive in one account

The **Cirrux** card is one account for a Cirrux mailbox: mail, calendars, contacts and task lists. This service signs in to them with the mailbox's email address and an app password. Files can go to the account's Cirrux Drive too, once you connect it on the **Accounts** page: Cirrux Drive has no WebDAV address and is reached only through Cirrux's own interface for apps, with your own Cirrux sign-in rather than the app password ([Files: Cirrux Drive](#drive)).

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

The test writes nothing. It signs in to the calendars and also measures each part of the account on its own: what the account carries follows **Carries:**, and what it found follows **Found:**. Files show as not carried, with the reason, until Cirrux Drive is connected on the account ([Files: Cirrux Drive](#drive)).

You can also add the account in advance, under **Accounts** → **Add an account**: choose **Destinations** under **Source or destination?**, then the **Cirrux** card, and press **Add and test**. The boxes are pre-filled there in the same way, in plain view.

## If the account is somebody else's {#somebody-else}

If the account belongs to a colleague, a family member or a client, you do not need their password. In **Start a migration**, under **Who signs in to the accounts?**, choose **They do, with a link**. Fill in the server and the account, leave the password out, and press **Save for** *them*. The destination step asks **Whose account is …?**: choose *their own*, and they connect it with the link. They type the password themselves, on the page your grant link opens: it names the server the password is checked with, tests it before anything is stored, and nobody sees it again, you included. Five wrong passwords lock that account on that link; a new link starts again. They need an app password from the mailbox's **Passwords** tab, not the password they sign in to Cirrux with. When files go to Cirrux, the same card then offers **Connect Cirrux Drive**, once the app password is stored: see [Files: Cirrux Drive](#drive). The first Drive grant records the workspace it reached, and a later one must reach the same.

On a self-hosted appliance there are no grant links: to let somebody type their own password, use the managed service's grant link; the appliance has none.

## What moves {#what-moves}

- **Email**, when the account is saved with its **Mail server**: the folders and the messages in them. Folders in Cirrux are labels. A folder this service creates becomes a label of the same name, nested under another where the name has a slash, and over IMAP every label shows as a folder again ([subfolders](https://cirrux.co/help/questions/subfolders-in-my-mailbox)).
- **Calendar**, **Contacts** and **Tasks**. Every Cirrux mailbox has a calendar, an address book called Contacts and a task list called Reminders. Task lists are calendars that hold tasks, on the same server as your calendars.
- Cirrux makes no second address book, so the contacts from every address book at your source go into Contacts.
- Each calendar at your source becomes a calendar of the same name at Cirrux, beside the mailbox's own Calendar.
- Each event and task is written with a marker, `SCHEDULE-AGENT=CLIENT`, that tells the server not to send invitations for it. Attendees and the organiser stay in your copy of each event. A server that ignores the marker could still send invitations. Cirrux's calendar server ignored it at first, and Cirrux says it keeps to it now; an invitation sent cannot be taken back. An event copied while the guests were left out names them in a comment (the iCalendar property `COMMENT`) instead, until it changes at your source and is copied again.
- **Files**, once Cirrux Drive is connected on the account: see [Files: Cirrux Drive](#drive). Until then, the row for files on **Where does it go?** does not offer the account, and your files can go to another destination in the same migration.
- A migration may run again and again: what is already in the target is recognised and not copied a second time.

## Files: Cirrux Drive {#drive}

Cirrux Drive is reached through Cirrux's own interface for apps, with a person's Cirrux sign-in ([Drive](https://cirrux.co/help/drive), [the interface](https://cirrux.co/help/api)). So files are a second sign-in on the same account, added after the account is saved. Whether the button is there depends on the service you use: Cirrux registers each service that may sign people in by hand, and a service without such a registration shows files as not carried, with **This service has no Cirrux client on this deployment yet**, and no button.

1. On the **Accounts** page, the Cirrux account shows **Connect Cirrux Drive**. Press it.
2. Cirrux's sign-in page opens in a new window. Sign in to Cirrux as the person whose Drive it is, and allow what Cirrux asks: who you are and which workspace, and reading, adding, changing and moving to the trash the files in your Drive.
3. The window says **Cirrux Drive is connected**. Close it. The account says **Cirrux Drive is connected: files can go to this account.**, and it has been measured again: **Carries:** now names files, and **Found:** what is at the top of your Drive.

Then the row for files on **Where does it go?** offers the account under **Your accounts**. It does not offer Cirrux under **A new account**: a new account has no Drive until it is saved and connected.

What happens to your files there:

- **Each file up to 2 GiB is copied.** Up to 100 MB in one request; a larger one in parts, which this service encrypts in Cirrux's own format before sending them, as Cirrux requires for files that size. A file over 2 GiB is not moved at all, said with that reason: Cirrux takes no file that large.
- **Folders are found by name**, and made where they are missing. Cirrux keeps one name per folder however it is capitalised, so `Photos` and `photos` are one folder there. A file whose name differs only in capitals from a file already in that folder is not written over: it is reported.
- **A file already in the folder under the same name is taken as the copy**, and not written. When a file changes at the source later, its copy is replaced, unless the copy was changed in Cirrux after this service last wrote it: then the copy in Cirrux stays as it is, and the file is reported as a conflict.
- **The time a file was last changed is kept**, as Cirrux shows it.
- **Nothing is deleted for good.** A file deleted at the source is removed from Cirrux only when you approve that removal, and then it is moved to Cirrux's trash, where it stays restorable for 30 days.
- **Storage is checked before anything is uploaded**: when the files would not fit in the workspace's storage, they are not sent, and the reason says so.
- **Cirrux sets a pace**: 600 requests a minute for one sign-in. When Cirrux asks this service to slow down, it waits as long as Cirrux says, and carries on.

The sign-in is kept with the account, encrypted, beside the app password. Cirrux replaces it every time this service renews it, so this service stores each new one and uses it once. A sign-in left unused for 30 days expires at Cirrux. When the sign-in no longer works, files fail with a sentence naming **Connect Cirrux Drive**: press it again, and the files carry on at the next run. Replacing the app password of the same mailbox keeps the Drive connected; an app password of another mailbox starts without it.

### Disconnecting Cirrux Drive {#disconnect}

To stop files going to the Drive and keep the account for everything else, press **Disconnect Cirrux Drive** on the Cirrux account on the **Accounts** page, beside **Connect Cirrux Drive again**. It asks first; press **Yes, disconnect**, or **Keep it connected** to leave it as it is.

- **Only the Drive sign-in goes.** This service deletes its copy of it. The app password stays, so mail, calendars, contacts and tasks carry on as before, and what is already in your Drive stays there: nothing in it is moved or deleted.
- **No file goes there any more.** The account shows files as not carried, and **Where does it go?** no longer offers it for files. A migration that sends files there stops at its files with a sentence naming **Connect Cirrux Drive**, and sends them nowhere else; its other data types carry on. A run already copying files stops within about a minute, at its next request to Cirrux.
- **At Cirrux, the sign-in ends by itself.** Cirrux offers no way for a service to end a sign-in, so it stays valid at Cirrux until it has gone unused for 30 days. To end it sooner, open **Settings → Security** in Cirrux Mail, which lists the apps you have authorized, and revoke this service there ([security](https://cirrux.co/help/security)).
- **To connect again**, press **Connect Cirrux Drive** and sign in, as the first time; the files carry on from where they stopped.

Pressed on an account with no Drive connected, it says there was nothing to disconnect.

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

- To stop files only, and keep the account for mail, calendars, contacts and tasks, disconnect Cirrux Drive ([Disconnecting Cirrux Drive](#disconnect)).
- A migration is deleted under **Migrations**. The confirmation says what that does: **Removes the migration’s settings and record; nothing at your source or destination is touched.** What was already copied stays at Cirrux.
- An account is deleted under **Accounts**, with **Delete**. That deletes this service's copy of the app password, and of the Cirrux Drive sign-in where one was connected. The app password itself stays valid at Cirrux, and the screen says so too: **We deleted our copy; this provider has no revocation we can trigger.** Cirrux names no way for a service to withdraw a Drive sign-in either; nothing here can use it again, and at Cirrux it expires once it is left unused for 30 days, or when you revoke it under **Settings → Security** in Cirrux Mail.
- So delete the app password at Cirrux: in Cirrux Mail, **Settings → Mailboxes**, the mailbox, its **Passwords** tab. Your Cirrux password stays as it is.
