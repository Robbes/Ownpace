# IMAP — mail with a user name and a password

IMAP is the standard way a mail program reads a mailbox. This service uses it on both sides: as a source, to read mail from a mailbox at any provider that offers IMAP, and as a target, to write mail into a mailbox at the provider you choose. On both sides this service signs in with a user name and a password. There is no consent button: the password is the access.

## What you need {#before}

- The IMAP server's name and its port for IMAP with SSL, which your mail provider publishes; usually that is port 993.
- The mailbox's user name, as your provider gives it.
- A password. Most providers refuse a normal account password for IMAP when two-factor authentication is on, and want an app-specific password instead. Create one at the provider, for this one mailbox.
- For a target: the mailbox exists already, with enough room for what is coming. This service creates no accounts.

## Connecting {#connect}

The **IMAP** card asks for the same fields on both sides. In **Start a migration** it is **Another mail provider** where a mailbox is left, and **Add IMAP** where the mail goes.

### IMAP as the source {#imap-source}

1. On **Which account are you leaving?**, tick **Another mail provider**. **Other ways to connect (IMAP)** leads to it too.
2. On **Connect your accounts**, type the IMAP server's name in **Host**, such as `imap.example.com`: the name alone, with no `https://` or path.
3. In **Port**, type the port your provider gives for IMAP with SSL: usually `993`, which the box shows as its example. There is no box for SSL/TLS: this service always connects with it.
4. In **Username**, type the mailbox's user name.
5. In **Password**, type the app password, or the mailbox's password if the provider allows it for IMAP.
6. Press **Check the sign-in**.

The test signs in read-only and writes nothing. When it works it says **Connected.**, with what it found underneath, and the account is saved. For the next migration, **Connect your accounts** offers it, so nothing is typed again. The **Setup steps** link under the form puts the preparation on a list that remembers what you have done.

### IMAP as the target {#imap-target}

1. On **Where does it go?**, in the row for email, choose **Add IMAP** under **A new account**.
2. In **Host**, type the name of the IMAP server the mail goes to, such as `imap.example.com`.
3. In **Port**, type the IMAP port your provider gives, usually `993`.
4. In **Username** and **Password**, type the target mailbox's details.
5. Press **Check the sign-in**.

Here too the test writes nothing: it signs in and counts the target mailbox's folders.

**Where the copies land**, under the rows, says where the mail goes in that account. Left as it is, the mail merges into the account: the source's folders arrive beside the folders already there. Open **Put it in a folder of its own** and type a name in **Folder**, such as `Gmail`, and everything lands under that folder. Where two migrations send mail to the same account, it opens by itself, filled in with the account each comes from.

You can also add an IMAP account in advance, under **Accounts** → **Add an account**. Choose **Sources** or **Targets** under **Source or target?**, then the **IMAP** card, and press **Add and test**.

## What moves {#what-moves}

- **As a source** this card reads mail: the mailbox's folders and the messages in them. On **What moves?**, a mail provider offers **Email** alone, and says why: over IMAP only mail is read. This service does not measure calendars or contacts on an IMAP account either.
- **As a target** this card receives mail only: on **Where does it go?**, only the row for email offers it. Calendars, contacts, files and tasks go to a CalDAV, CardDAV or WebDAV target ([the DAV guide](dav.md)) or to a Nextcloud ([the Nextcloud guide](nextcloud.md)), chosen in their own rows, and **Start a migration** makes a migration for each.
- Folders the target does not have yet are created. Sent and Drafts become the target account's own Sent and Drafts. In a folder of its own, they arrive as ordinary folders inside it, because a mail program can only have one of each.
- A migration may run again and again: a message already in the target is recognised and not copied a second time.

## When the test reports a problem {#when-test-says}

What a mail server itself answers, this service shows word for word, in the server's language; usually that is English.

- **The password is refused**, for example with `AUTHENTICATIONFAILED` or a line with `LOGIN failed`. Check the user name. With two-factor authentication on, most providers want an app-specific password instead of the account password.
- **The server cannot be reached**, or refuses the connection. Check **Host** and **Port** against what your provider gives for IMAP with SSL.
- **No answer within 20 seconds.** The test says so.
- **A failed test starts afresh.** **Try again** takes away the account the failed test saved and opens the form again with what you typed, so a corrected **Host**, **Port** or **Username** is tested as typed. On the **Accounts** page, delete the account that failed and add it again.

## Stopping {#leaving}

- A migration is deleted under **Migrations**. The confirmation says what that does: **Removes the migration’s settings and record; nothing at your source or destination is touched.** What was already copied stays in the target.
- An account is deleted under **Accounts**, with **Delete**. That deletes this service's copy of the password. The password itself stays valid at the provider, and the screen says so too: **We deleted our copy; this provider has no revocation we can call.**
- So revoke the app password at your provider, or change the mailbox's password. Only the account holder can. An app password can be revoked without changing the person's own password.
