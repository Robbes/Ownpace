# Infomaniak — mail, calendars, contacts and tasks in one account

The **Infomaniak** card is one account at Infomaniak: mail, calendars, contacts and task lists. Files are not among them: kDrive is reached over WebDAV at an address of its own for each drive, which Infomaniak does not offer on every plan, and this service does not write to it yet. This service signs in with two logins, because Infomaniak gives mail a login of its own; there is no consent button.

The servers and logins below are the ones Infomaniak describes on its help pages, read on 19 November 2026: [the mail settings](https://www.infomaniak.com/fr/support/faq/2427/synchroniser-les-e-mails-sur-tous-vos-equipements), [a password for a mail address](https://www.infomaniak.com/fr/support/faq/1321/ajouter-un-appareil-creer-un-mot-de-passe-mail-depuis-le-service-mail), [application passwords](https://www.infomaniak.com/fr/support/faq/2855/gerer-les-mots-de-passe-dapplication) and [calendars and contacts](https://www.infomaniak.com/fr/support/faq/1544/synchroniser-contacts-calendar-apps-ios-manuellement-en-carddavcaldav). Those links are to the French pages; Infomaniak offers the same pages in English, and the names of its screens and buttons below are the ones its English pages use.

## What you need {#before}

- An Infomaniak account, with the mail address the mail goes to, and room for what is coming. This service creates no accounts.
- The account's sync login, for calendars, contacts and tasks. Infomaniak's calendars and contacts belong to your Infomaniak account, not to a mail address. The username is short, such as AB12345: open [config.infomaniak.com](https://config.infomaniak.com), choose a device other than iOS, such as Linux, then **Contacts** or **Calendars**, and open the manual synchronisation tab, which shows it. The password is an application password when two-step validation is on: in the Manager, under **Application passwords**, press **Generate an application password** and copy it, because it is shown once. Without two-step validation, it is your Infomaniak password.
- The mailbox's own login, if mail moves. Mail at Infomaniak signs in apart, with the full email address and a password made for that address; an application password does not work for mail. In the Manager: **Mail Service**, the domain, the address, its **Devices** tab, then **Add a device**, and choose **No user**. Infomaniak shows the password once, at least 16 characters long, so copy it at once; you can change it there later. For a my kSuite address, Infomaniak's page sends you to [another of its guides](https://faq.infomaniak.com/2904) for this.
- Whether mail moves too. Only then are the mail server and the mailbox's login needed; calendars, contacts and tasks need neither.

## Connecting {#connect}

### Infomaniak {#infomaniak}

On **Where does it go?**, choose **Add Infomaniak** under **A new account**, in each row whose data goes there: email, calendars, contacts or tasks. One form adds the account for all of them. Its servers are filled in already, folded under **Server settings (filled in for Infomaniak)**, with the line **Pre-filled from Infomaniak’s published settings, read …. Test checks them.** They are the values Infomaniak publishes, not measured ones: the test measures them.

- **Host**: `sync.infomaniak.com`, the one server Infomaniak names for calendars and contacts.
- **Port**: `443`. Infomaniak names the server without a port, which means the usual one for a secure connection.
- **Mail server**: `mail.infomaniak.com`. Only needed if this account will also receive mail.
- **Mail port**: `993`.

Leave them as they are, unless Infomaniak gives you other values. If mail moves, keep **Mail server** filled in: the test saves the account with what the boxes hold. Then fill in yourself:

1. **Username**: the sync username, such as AB12345, in capitals as Infomaniak shows it. Not your email address.
2. **Password**: the application password, or your Infomaniak password if two-step validation is off.
3. **Mailbox address**: the mailbox's full email address. Only if mail moves.
4. **Mailbox password**: the password made for that address on its **Devices** tab. Only if mail moves; an application password is refused here.
5. Press **Check the sign-in**.

Fill in both mailbox boxes, or neither: one without the other is refused, because it can sign in to nothing. There is no box for SSL/TLS: this service always uses it, for calendars, contacts and tasks and for mail. Leave **DAV base URL** empty: Infomaniak names the server and no path, and sends a calendar app that asks it where the calendars are to its own address, which is where this service looks. When the test fails on a server, **Server settings** opens by itself.

The test writes nothing. It signs in to the calendars with the sync login, and also measures each part of the account on its own, mail with the mailbox's login: what the account carries follows **Carries:**, and what it found follows **Found:**. Files show as not carried, with the reason.

You can also add the account in advance, under **Accounts** → **Add an account**: choose **Destinations** under **Source or destination?**, then the **Infomaniak** card, and press **Add and test**. The boxes are pre-filled there in the same way, in plain view.

## If the account is somebody else's {#somebody-else}

If the account belongs to a colleague, a family member or a client, you do not need their password. In **Start a migration**, under **Who signs in to the accounts?**, choose **They do, with a link**. Fill in the server and the account, leave the password out, and press **Save for** *them*. The destination step asks **Whose account is …?**: choose *their own*, and they connect it with the link. They type the password themselves, on the page your grant link opens: it names the server the password is checked with, tests it before anything is stored, and nobody sees it again, you included. Five wrong passwords lock that account on that link; a new link starts again. The page asks them for the sync password and the mailbox's own password; an app password is refused for mail.

On a self-hosted appliance there are no grant links: to let somebody type their own password, use the managed service's grant link; the appliance has none.

## What moves {#what-moves}

- **Email**, when the account is saved with its **Mail server**, **Mailbox address** and **Mailbox password**: the folders and the messages in them, written into the mailbox.
- **Calendar**, **Contacts** and **Tasks**. A task in Infomaniak's calendar belongs to a calendar, so task lists are calendars that hold tasks, on the same server as your calendars.
- Each event and task is written with a marker, `SCHEDULE-AGENT=CLIENT`, that tells the server not to send invitations for it. Attendees and the organiser stay in your copy of each event. A server that ignores the marker could still send invitations. Infomaniak does not say what its calendar server does with the marker, and an invitation sent cannot be taken back.
- **Files** do not go to Infomaniak: on **Where does it go?**, the row for files does not offer it. This service writes files over WebDAV, and kDrive's WebDAV address is one of its own for each drive, which Infomaniak does not offer on kSuite Free, kSuite Standard, my kSuite or my kSuite+ ([kDrive over WebDAV](https://www.infomaniak.com/fr/support/faq/2409/se-connecter-a-kdrive-par-webdav)). Your files can go to another destination in the same migration.
- A migration may run again and again: what is already in the target is recognised and not copied a second time.

## When the test reports a problem {#when-test-says}

What Infomaniak itself answers, this service shows word for word, in the server's language.

- **`PROPFIND failed with status 401`** for calendars or contacts: Infomaniak refuses the sync username or its password. Check that the username is the short one from config.infomaniak.com, such as AB12345, and not your email address, and that the password is an application password if two-step validation is on.
- A refusal from the mail server, for example with `AUTHENTICATIONFAILED`: the mailbox's address or password does not work for mail. The password must be the one made on the address's **Devices** tab: an application password is refused for mail, and so is your Infomaniak password.
- No calendars or address books found, where the account has them: Infomaniak's configuration assistant shows a fuller address for them, which its [Thunderbird page](https://www.infomaniak.com/fr/support/faq/2046/synchroniser-contacts-calendriers-thunderbird-app-desktop-en-carddavcaldav) explains how to find. Put it in **DAV base URL**.
- **Email** followed by **This account stores no mail login, so mail was not measured**: the account was saved without **Mailbox address** and **Mailbox password**. On the **Accounts** page, press **Replace credentials** on the account and fill both in, beside the sync login.
- **Email** followed by **This account stores no mail server address**: the account was saved without a **Mail server**. An account saved without it carries no mail, and a migration with **Email** ticked on it fails when it runs, with **This infomaniak connection stores no mail server, so its mail face cannot be built**. Delete that migration under **Migrations**, then the account under **Accounts**, and start again with the **Mail server** filled in. Calendars, contacts and tasks need no mail server, so a migration without **Email** can stay on that account.
- **No answer within 20 seconds.** The test says so.
- **A failed test starts afresh.** **Try again** takes away the account the failed test saved and opens the form again with what you typed, so corrected servers and ports are tested as typed. On the **Accounts** page, delete the account that failed and add it again.

## Stopping {#leaving}

- A migration is deleted under **Migrations**. The confirmation says what that does: **Removes the migration’s settings and record; nothing at your source or destination is touched.** What was already copied stays at Infomaniak.
- An account is deleted under **Accounts**, with **Delete**. That deletes this service's copy of both logins. The passwords themselves stay valid at Infomaniak, and the screen says so too: **We deleted our copy; this provider has no revocation we can trigger.**
- So revoke them at Infomaniak, each on its own: the application password in the Manager under **Application passwords**, and the mailbox's password on the address's **Devices** tab. The address's other devices keep working. If two-step validation is off, the sync login was your Infomaniak password itself: change it to end it.
