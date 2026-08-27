# Grant links — letting somebody connect their own account

A grant link lets the person whose account is being migrated give access to it **themselves**,
without an Ownpace account and without ever sending anybody their password.

It exists because the alternative is worse in a specific way. Migrating a colleague's mailbox
needs a credential for that mailbox, and the two obvious ways to get one are both bad: asking
for their password, or sitting beside them while they sign in and copying a token out of a
browser. Both put one person's private credential through another person's hands. A link
removes the middle: they sign in on Google's own page, and what comes back is stored against
that one migration, encrypted, never shown to anyone.

**You send the link. We never do.** Ownpace does not email it, does not store the recipient's
address, and does not know who you sent it to. That is deliberate: an address we never learn is
an address we cannot leak, and you already know who the person is.

## Issuing one

On the migration's page, under **Grant links**:

1. Choose how long the link should work — **1 day**, **7 days** or **30 days**. Seven is
   pre-filled. Pick the shortest one that gives the person a fair chance to get to it.
2. Press **Create grant link**.
3. Copy the link and send it, however you normally reach that person.

**The link is shown once.** Nothing can show it to you again, because only a fingerprint of it
is stored — the same reason a password is never stored readable. If you lose it, revoke it and
issue another.

The link is a **key in a URL**. Anyone holding it can connect that account, so treat it the way
you would treat a password: send it the way you would send a password, and not somewhere it
will sit in a shared channel afterwards.

### If issuing refuses

The button refuses rather than handing out a link that would fail in somebody else's browser.
Each refusal names what to fix:

| It says | What to do |
|---|---|
| The migration has no source connection yet | Finish setting up the source first. |
| The source is not a Google account | Grant links cover Gmail, Google Calendar, Google Contacts and Google Drive today. For other sources, the credential still comes to you by hand. |
| No client id or client secret is stored | Add them on the source connection — see [Google Workspace setup](./google-workspace-setup.md), step 3. The consent runs against your own Google application. |
| `WEB_URL` is not set | A deployment setting. Whoever runs your Ownpace needs to set it and restart; a link built without it would point at the wrong machine. |

## What the other person sees

Before any button, the page tells them:

- **who is asking** — your organisation, by name;
- **what will be read** — their mail, calendar, contacts or files, in plain words;
- **that it is read-only** — nothing is ever deleted or changed in their account, and nobody
  sees their password, because they sign in on Google's own page;
- **the exact permission** Google will record, so they can find it again in their own account;
- **how long the link works**;
- the privacy policy and terms, before they go anywhere.

Then one button. When they press it they go to Google, sign in, and land back on a page that
says it is done. **That page contains no token and asks nothing else of them.** They can close
it and get on with their day.

## Managing them afterwards

The list under **Grant links** shows every link for the migration and what became of it:

- **Live** — it works, and nobody has used it yet.
- **Granted** — somebody connected the account with it. It is spent and cannot be used again.
- **Revoked** — you switched it off.
- **Expired unused** — it ran out before anybody got to it. This is the one to act on: somebody
  was asked and never managed to answer. Issue another and send it again.

**Revoke** switches a link off immediately. It stops a sign-in that is already in progress too,
not only future ones — so if you think a link went to the wrong place, revoke it first and ask
questions afterwards. Deleting the migration removes its links with it.

Revoking a link does **not** withdraw access somebody already granted. Those are two different
things, held by two different people, and that is the point:

| To stop | Who does it | Where |
|---|---|---|
| a link being used | you | the migration's Grant links list |
| access already granted | the person who granted it | their Google account's security settings, under the apps that have access |
| everything, permanently | you | delete the migration |

## "My link says it does not work"

The message a refused link shows is the same for every reason — used already, expired,
withdrawn, or never real. That is on purpose: telling somebody *which* one would also tell
anybody trying links at random which part they got right.

So there is nothing to diagnose from the message, and the answer is always the same: **look at
the list, and issue a fresh one.** The list will show you which of the four it was, and
re-issuing costs a moment. Ask them to open the new link on the device they normally use, and
to press the button rather than only opening the page — opening it does nothing and does not
use it up, which is why a link that was merely previewed is still live.

If the new link fails the same way, the problem is not the link. Check the source connection's
Google application still exists and its client secret has not been rotated.

## Two things this is not

**It is not an invitation.** An invitation asks somebody to *join your organisation* — they end
up with an account, a sign-in and a role. A grant link is the opposite: the person never gets
an account, never signs in to Ownpace, and never appears in your member list. They are being
migrated, not hired.

**It is not a progress page.** A grant link is for one thing — connecting an account — and it is
spent the moment that happens. Somebody wanting to watch how their migration is going is a
different question, and the answer to it is not built yet.
