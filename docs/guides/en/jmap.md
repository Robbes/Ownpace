# JMAP — a mailbox on a JMAP server

JMAP is a newer protocol for mail and contacts, which a mail server offers over the web. This service writes mail, contacts and files to a JMAP target. It signs in with a user name and a password; there is no consent button.

## What you need {#before}

- A mailbox on the JMAP server that exists already, with enough room for what is coming. This service creates no accounts.
- The server's name and port.
- That mailbox's user name and a password. Create an app password for that account in the server's own settings, where it offers one; this service signs in with the user name and that password.

## Connecting {#connect}

### JMAP {#jmap}

1. On the target step, pick the **JMAP** card.
2. In **Host**, type the server's name, such as `jmap.example.com`: the name alone, with no `https://` in front.
3. In **Port**, type the port; the example in the box is `443`.
4. Leave **Use SSL/TLS** ticked: this service then talks to the server over `https://`.
5. In **Username** and **Password**, type the mailbox's details.
6. Press **Test and save connections**.

The test asks for the session document every JMAP server offers, at `/.well-known/jmap` behind the address from Host and Port. It writes nothing. When the server answers, it says **Connected. The JMAP session document answered.**, with what the account carries underneath (**Carries:**): email and contacts when the server announces them.

The **Target folder (optional)** box says where the mail lands. Empty merges into the account; with a folder name, everything lands under that folder.

You can also add a JMAP connection in advance, under **Connections** → **Add a connection**: choose the target under **Source or target?**, then the **JMAP** card, and press **Add and test**. The **Setup checklist** has the preparation for a JMAP target as a list that remembers what you have done.

## What moves {#what-moves}

- **Email**: the folders and the messages in them. Folders the target does not have yet are created.
- **Contacts**.
- **Files**, with one limit: a file larger than 8 MB does not reach a JMAP target yet. The migration reports such a file as failed, under **Failures**, and carries on with the rest. To take larger files along, send the files to a WebDAV target ([the DAV guide](dav.md)) or a Nextcloud ([the Nextcloud guide](nextcloud.md)).
- **Calendar** and **Tasks** do not go to a JMAP target. Recurring events cannot yet travel over JMAP intact: a series would arrive as single events. So this service writes calendars and task lists over CalDAV. On the migration step they are off, with the line **Not available over the selected target protocol.** For calendars and tasks, create a second migration to a CalDAV target.
- A migration may run again and again: what is already in the target is recognised and not copied a second time.

## When the test reports a problem {#when-test-says}

- **The server at … answered 401. It is reachable and refused the credentials.** The user name or the password is wrong. Check both, or create a new app password.
- **The server at … answered** with another number, then **Check the target host and port.** No JMAP server answers at that address. Check **Host**, **Port** and **Use SSL/TLS**.
- **No answer within 20 seconds.** The test says so and keeps the connection anyway, so it can be tested again later.

What the server itself answers, this service shows word for word, in the server's language; usually that is English.

## Stopping {#leaving}

- A migration is deleted under **Migrations**. The confirmation says what that does: **Removes the migration’s settings and record; nothing at your source or destination is touched.** What was already copied stays in the target.
- A connection is deleted under **Connections**, with **Delete**. That deletes this service's copy of the password. The password itself stays valid at the server, and the screen says so too: **We deleted our copy; this provider has no revocation we can call.**
- So revoke the app password at the server, or change the password. Only the account holder can.
