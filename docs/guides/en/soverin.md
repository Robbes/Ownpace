# Soverin — mail, calendars and contacts in one account

The **Soverin** card is one account for a Soverin account: mail, calendars, contacts and task lists. Files are not among them. This service signs in with the account's address and password; there is no consent button.

## What you need {#before}

- Your Soverin account: the email address and the password. If Soverin offers you an app password, it goes in the same box.
- Whether mail moves too. Only then is the mail server needed; calendars and contacts need none.

## Connecting {#connect}

### Soverin {#soverin}

On **Where does it go?**, choose **Add Soverin** under **A new account**, in each row whose data goes there: email, calendars, contacts or tasks. One form adds the account for all of them. Its servers are filled in already, folded under **Server settings (filled in for Soverin)**, with the line **Pre-filled from Soverin’s published settings, read …. Test checks them.** They are the values Soverin publishes, not measured ones: the test measures them.

- **Host**: `caldav.soverin.net`, the server for calendars and contacts.
- **Port**: `443`.
- **Mail server**: `imap.soverin.net`. Only needed if this account will also receive mail.
- **Mail port**: `993`.

Leave them as they are, unless Soverin gives you other values. If mail moves, keep **Mail server** filled in: the test saves the account with what the boxes hold. Then fill in yourself:

1. **Username**: your Soverin email address.
2. **Password**: that account's password, or an app password if Soverin offers you one.
3. Press **Check the sign-in**.

There is no box for SSL/TLS: this service always uses it, for calendars and contacts and for mail. Leave **DAV base URL** empty: Soverin serves calendars and contacts at the root of that host. When the test fails on a server, **Server settings** opens by itself.

The test writes nothing. It signs in to the calendars and also measures each part of the account on its own: what the account carries follows **Carries:**, and what it found follows **Found:**. Whether one app password works for mail as well as for calendars and contacts is not certain: the test says so per part. If one part is refused and the other is not, that password does not cover the whole account.

You can also add the account in advance, under **Accounts** → **Add an account**: choose **Targets** under **Source or target?**, then the **Soverin** card, and press **Add and test**. The boxes are pre-filled there in the same way, in plain view.

## What moves {#what-moves}

- **Email**, when the account is saved with its **Mail server**: the folders and the messages in them.
- **Calendar**, **Contacts** and **Tasks**. Task lists are calendars that hold tasks, on the same server as your calendars.
- Each event is written with a marker, `SCHEDULE-AGENT=CLIENT`, that tells the server not to send invitations for it. Attendees and the organiser stay in your copy of each event. A server that ignores the marker could still send invitations.
- **Files** do not go to Soverin: on **Where does it go?**, the row for files does not offer it.
- A migration may run again and again: what is already in the target is recognised and not copied a second time.

## When the test reports a problem {#when-test-says}

What Soverin itself answers, this service shows word for word, in the server's language; usually that is English.

- **`PROPFIND failed with status 401`** for calendars or contacts: Soverin refuses the email address or the password for that part. Check both.
- A refusal from the mail server, for example with `AUTHENTICATIONFAILED`: the password does not work for mail. If it does work for calendars and contacts, that password does not cover mail.
- **Email** followed by **This account stores no mail server address, so mail was not measured**: the account was saved without a **Mail server**. If mail moves, see the next point.
- An account saved without a **Mail server** carries no mail. A migration with **Email** ticked is still made on it, and its mail fails when it runs, with **This soverin connection stores no mail server, so its mail face cannot be built**. Delete that migration under **Migrations**, then the account under **Accounts**, and start again with the **Mail server** filled in. Calendars and contacts need no mail server, so a migration without **Email** can stay on that account.
- **No answer within 20 seconds.** The test says so.
- **A failed test starts afresh.** **Try again** takes away the account the failed test saved and opens the form again with what you typed, so corrected servers and ports are tested as typed. On the **Accounts** page, delete the account that failed and add it again.

## Stopping {#leaving}

- A migration is deleted under **Migrations**. The confirmation says what that does: **Removes the migration’s settings and record; nothing at your source or destination is touched.** What was already copied stays at Soverin.
- An account is deleted under **Accounts**, with **Delete**. That deletes this service's copy of the password. The password itself stays valid at Soverin, and the screen says so too: **We deleted our copy; this provider has no revocation we can call.**
- So revoke the app password at Soverin, or change the account's password. Only the account holder can.
