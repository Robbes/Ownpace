# Soverin — mail, calendars and contacts in one connection

The **Soverin** card is one connection for a Soverin account: mail, calendars, contacts and task lists. Files are not among them. This service signs in with the account's address and password; there is no consent button.

## What you need {#before}

- Your Soverin account: the email address and the password. If Soverin offers you an app password, it goes in the same box.
- Whether mail moves too. Only then is the mail server needed; calendars and contacts need none.

## Connecting {#connect}

### Soverin {#soverin}

On the target step, pick the **Soverin** card. Four boxes are then filled in already, with the line **Pre-filled from Soverin’s published settings, read …. Test checks them.** They are the values Soverin publishes, not measured ones: the test measures them.

- **Host**: `caldav.soverin.net`, the server for calendars and contacts.
- **Port**: `443`.
- **Mail server**: `imap.soverin.net`. Only needed if this account will also receive mail.
- **Mail port**: `993`.

Leave them as they are, unless Soverin gives you other values. Then fill in yourself:

1. **Username**: your Soverin email address.
2. **Password**: that account's password, or an app password if Soverin offers you one.
3. Press **Test and save connections**.

Leave **Use SSL/TLS** ticked; it applies to calendars and contacts and to mail. Leave **DAV base URL** empty: Soverin serves calendars and contacts at the root of that host.

The test writes nothing. It signs in to the calendars and also measures each part of the account on its own: what the account carries follows **Carries:**, and what it found follows **Found:**. Whether one app password works for mail as well as for calendars and contacts is not certain: the test says so per part. If one part is refused and the other is not, that password does not cover the whole account.

You can also add the connection in advance, under **Connections** → **Add a connection**: choose the target under **Source or target?**, then the **Soverin** card, and press **Add and test**. The boxes are pre-filled there in the same way.

## What moves {#what-moves}

- **Email**, when the **Mail server** is filled in: the folders and the messages in them.
- **Calendar**, **Contacts** and **Tasks**. Task lists are calendars that hold tasks, on the same server as your calendars.
- Writing a calendar sends nobody an invitation. Attendees and the organiser stay in your copy of each event, and each event is written so that the server sends no invitations for it.
- **Files** do not go to Soverin. On the migration step they are off, with the line **Not available over the selected target protocol.**
- A migration may run again and again: what is already in the target is recognised and not copied a second time.

## When the test reports a problem {#when-test-says}

What Soverin itself answers, this service shows word for word, in the server's language; usually that is English.

- **`PROPFIND failed with status 401`** for calendars or contacts: Soverin refuses the email address or the password for that part. Check both.
- A refusal from the mail server, for example with `AUTHENTICATIONFAILED`: the password does not work for mail. If it does work for calendars and contacts, that password does not cover mail.
- **Email** followed by **This account stores no mail server address, so mail was not measured**: the **Mail server** is empty. Fill it in if mail moves.
- When the migration is created with **Email** ticked and an empty **Mail server**: **A soverin target carries email only when the account's mail server is stored: targetConfig.mailHost is missing.** Fill in the **Mail server**, or untick **Email**; calendars and contacts need no mail server.
- **No answer within 20 seconds.** The test says so and keeps the connection anyway, so it can be tested again later.

## Stopping {#leaving}

- A migration is deleted under **Migrations**. The confirmation says what that does: **Removes the migration’s settings and record; nothing at your source or destination is touched.** What was already copied stays at Soverin.
- A connection is deleted under **Connections**, with **Delete**. That deletes this service's copy of the password. The password itself stays valid at Soverin, and the screen says so too: **We deleted our copy; this provider has no revocation we can call.**
- So revoke the app password at Soverin, or change the account's password. Only the account holder can.
