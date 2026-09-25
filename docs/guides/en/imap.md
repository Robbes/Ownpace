# IMAP — mail with a user name and a password

IMAP is the standard way a mail program reads a mailbox. This service uses it on both sides: as a source, to read mail from a mailbox at any provider that offers IMAP, and as a target, to write mail into a mailbox at the provider you choose. On both sides this service signs in with a user name and a password. There is no consent button: the password is the access.

## What you need {#before}

- The IMAP server's name, its port and whether it uses SSL. Your mail provider publishes them for IMAP; usually it is port 993 with SSL.
- The mailbox's user name, as your provider gives it.
- A password. Most providers refuse a normal account password for IMAP when two-factor authentication is on, and want an app-specific password instead. Create one at the provider, for this one mailbox.
- For a target: the mailbox exists already, with enough room for what is coming. This service creates no accounts.

## Connecting {#connect}

The **IMAP** card asks for the same fields on both sides. You find it on the wizard's source step and on its target step.

### IMAP as the source {#imap-source}

1. On the source step, pick the **IMAP** card.
2. In **Host**, type the IMAP server's name, such as `imap.example.com`: the name alone, with no `https://` or path.
3. In **Port**, type the port your provider gives; the example in the box is `993`.
4. Leave **Use SSL/TLS** ticked, as it is by default, when your provider says SSL.
5. In **Username**, type the mailbox's user name.
6. In **Password**, type the app password, or the mailbox's password if the provider allows it for IMAP.
7. Press **Test and save connections**.

The test signs in read-only and writes nothing. When it works it says **Connected.**, with what it found underneath, and the connection is saved. For the next migration, pick it under **Reuse a saved source connection** rather than typing it all again. The **Open the setup checklist** link under the cards puts the preparation on a list that remembers what you have done.

### IMAP as the target {#imap-target}

1. On the target step, pick the **IMAP** card.
2. In **Host**, type the name of the IMAP server the mail goes to, such as `imap.example.com`.
3. In **Port**, type the port; the example in the box is `993`.
4. Leave **Use SSL/TLS** ticked when the provider says SSL.
5. In **Username** and **Password**, type the target mailbox's details.
6. Press **Test and save connections**.

Here too the test writes nothing: it signs in and counts the target mailbox's folders.

The **Target folder (optional)** box says where the mail lands. Empty merges into the account: the source's folders arrive beside the folders already there. With a folder name, such as `Gmail`, everything lands under that folder; useful when several sources share one target.

You can also add an IMAP connection in advance, under **Connections** → **Add a connection**. Choose the side under **Source or target?**, then the **IMAP** card, and press **Add and test**.

## What moves {#what-moves}

- **As a source** this card reads mail: the mailbox's folders and the messages in them. On the migration step, tick **Email** only. Calendars and contacts do not travel over IMAP: this service does not measure them on an IMAP connection either.
- **As a target** this card receives mail only. On the migration step, **Calendar**, **Contacts**, **Files** and **Tasks** are then off, with the line **Not available over the selected target protocol.** For those, create a second migration, to a CalDAV, CardDAV or WebDAV target ([the DAV guide](dav.md)) or to a Nextcloud ([the Nextcloud guide](nextcloud.md)).
- Folders the target does not have yet are created. Sent and Drafts become the target account's own Sent and Drafts. Under a **Target folder** they arrive as ordinary folders inside it, because a mail program can only have one of each.
- A migration may run again and again: a message already in the target is recognised and not copied a second time.

## When the test reports a problem {#when-test-says}

What a mail server itself answers, this service shows word for word, in the server's language; usually that is English.

- **The password is refused**, for example with `AUTHENTICATIONFAILED` or a line with `LOGIN failed`. Check the user name. With two-factor authentication on, most providers want an app-specific password instead of the account password.
- **The server cannot be reached**, or refuses the connection. Check **Host**, **Port** and **Use SSL/TLS** against what your provider gives for IMAP.
- **No answer within 20 seconds.** The test says so and keeps the connection anyway, so it can be tested again later.

## Stopping {#leaving}

- A migration is deleted under **Migrations**. The confirmation says what that does: **Removes the migration’s settings and record; nothing at your source or destination is touched.** What was already copied stays in the target.
- A connection is deleted under **Connections**, with **Delete**. That deletes this service's copy of the password. The password itself stays valid at the provider, and the screen says so too: **We deleted our copy; this provider has no revocation we can call.**
- So revoke the app password at your provider, or change the mailbox's password. Only the account holder can. An app password can be revoked without changing the person's own password.
