# JMAP — a mailbox on a JMAP server

JMAP is a newer protocol for mail and contacts, which a mail server offers over the web. This service writes mail, contacts and files to a JMAP target. It signs in with a user name and a password; there is no consent button.

## What you need {#before}

- A mailbox on the JMAP server that exists already, with enough room for what is coming. This service creates no accounts.
- The server's name and port.
- That mailbox's user name and a password. Create an app password for that account in the server's own settings, where it offers one; this service signs in with the user name and that password.

## Connecting {#connect}

### JMAP {#jmap}

1. On **Where does it go?**, choose **Add JMAP** under **A new account**, in each row whose data goes there: email, contacts or files. One form adds the account for all of them.
2. In **Host**, type the server's name, such as `jmap.example.com`: the name alone, with no `https://` in front.
3. **Port** is filled in with `443`, which most servers use. Change it only if the server uses another port. There is no box for SSL/TLS: this service always talks to the server over `https://`.
4. In **Username** and **Password**, type the mailbox's details.
5. Press **Check the sign-in**.

The test asks for the session document every JMAP server offers, at `/.well-known/jmap` behind the address from Host and Port. It writes nothing. When the server answers, it says **Connected. The JMAP session document answered.**, with what the account carries underneath (**Carries:**): email and contacts when the server announces them.

**Where the copies land**, under the rows, says where the mail goes in that account. Left as it is, it merges into the account. Open **Put it in a folder of its own** and type a name in **Folder**, and everything lands under that folder.

You can also add a JMAP account in advance, under **Accounts** → **Add an account**: choose **Targets** under **Source or target?**, then the **JMAP** card, and press **Add and test**. The **Setup checklist** has the preparation for a JMAP target as a list that remembers what you have done.

## What moves {#what-moves}

- **Email**: the folders and the messages in them. Folders the target does not have yet are created.
- **Contacts**.
- **Files**, with one limit: the largest file the JMAP server takes in one upload. The server states that limit itself. The migration reports a larger file as failed, under **Failures**, with the server's limit, and carries on with the rest. To take such a file along, raise the server's upload limit, or send the files to a WebDAV target ([the DAV guide](dav.md)) or a Nextcloud ([the Nextcloud guide](nextcloud.md)).
- **Calendar** and **Tasks** do not go to a JMAP target. Recurring events cannot yet travel over JMAP intact: a series would arrive as single events. So this service writes calendars and task lists over CalDAV: on **Where does it go?**, their rows offer no JMAP, and they go to a CalDAV target in their own rows, for which **Start a migration** makes a migration of its own.
- A migration may run again and again: what is already in the target is recognised and not copied a second time.

## When the test reports a problem {#when-test-says}

- **The server at … answered 401. It is reachable and refused the credentials.** The user name or the password is wrong. Check both, or create a new app password.
- **The server at … answered** with another number, then **Check the target host and port.** No JMAP server answers at that address. Check **Host** and **Port**.
- **No answer within 20 seconds.** The test says so.
- **A failed test starts afresh.** **Try again** takes away the account the failed test saved and opens the form again with what you typed, so a corrected **Host** or **Port** is tested as typed. On the **Accounts** page, delete the account that failed and add it again.

What the server itself answers, this service shows word for word, in the server's language; usually that is English.

## Stopping {#leaving}

- A migration is deleted under **Migrations**. The confirmation says what that does: **Removes the migration’s settings and record; nothing at your source or destination is touched.** What was already copied stays in the target.
- An account is deleted under **Accounts**, with **Delete**. That deletes this service's copy of the password. The password itself stays valid at the server, and the screen says so too: **We deleted our copy; this provider has no revocation we can call.**
- So revoke the app password at the server, or change the password. Only the account holder can.
